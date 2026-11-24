require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');
const { makeUniqueUsername, generateTemporaryPassword } = require('../backend/src/services/studentUsernameService');

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED or DATABASE_URL in backend/.env first.');
  if (new URL(connectionString).hostname.includes('-pooler')) {
    throw new Error('Student authentication migration requires a direct database connection.');
  }

  const pool = new Pool({ connectionString });
  const summary = {
    total_existing_students: 0,
    existing_accounts_identified: 0,
    new_accounts_created: 0,
    usernames_assigned: 0,
    accounts_already_configured: 0,
    students_requiring_attention: 0,
    failed_records: 0,
  };
  try {
    const migration = fs.readFileSync(
      path.join(__dirname, '../sql/migrations/20261124_student_personalised_auth.sql'),
      'utf8'
    );
    await pool.query(migration);

    const students = await pool.query(`
      SELECT s.id, s.school_id, s.name, s.dob, s.user_id, u.username, u.role
      FROM students s
      LEFT JOIN users u ON u.id=s.user_id AND u.school_id=s.school_id
      ORDER BY s.school_id, s.id
    `);
    summary.total_existing_students = students.rowCount;

    for (const student of students.rows) {
      try {
        if (student.user_id) {
          summary.existing_accounts_identified++;
          if (student.username) {
            summary.accounts_already_configured++;
            continue;
          }
        }
        if (!String(student.name || '').trim()) {
          summary.students_requiring_attention++;
          continue;
        }
        if (!student.dob) {
          summary.students_requiring_attention++;
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          let userId = student.user_id;
          let username = student.username;

          if (!username) {
            username = await makeUniqueUsername(client, student.school_id, student.name, userId);
            if (!username) throw new Error('Unable to generate a username.');
          }

          if (!userId) {
            const password = generateTemporaryPassword(student.dob);
            const hashedPassword = await bcrypt.hash(password.temporaryPassword, 10);
            const studentEmail = `stu_${String(student.id).padStart(6, '0')}_${crypto.randomBytes(4).toString('hex')}@educore.local`;
            const created = await client.query(
              `INSERT INTO users
                 (school_id,name,email,password,role,must_change_password,is_active,email_verified,username)
               VALUES ($1,$2,$3,$4,'student',TRUE,FALSE,TRUE,$5)
               RETURNING id`,
              [student.school_id, student.name, studentEmail, hashedPassword, username]
            );
            userId = created.rows[0].id;
            await client.query('UPDATE students SET user_id=$1 WHERE id=$2 AND school_id=$3', [userId, student.id, student.school_id]);
            await client.query(
              `INSERT INTO student_portal_audit_log
                 (school_id,student_id,action,details)
               VALUES ($1,$2,'ACCOUNT_CREATED',$3::jsonb)`,
              [student.school_id, student.id, JSON.stringify({
                username,
                temporary_password_source: password.source,
              })]
            );
            summary.new_accounts_created++;
            summary.usernames_assigned++;
          } else {
            await client.query('UPDATE users SET username=$1 WHERE id=$2 AND school_id=$3 AND role=$4', [username, userId, student.school_id, 'student']);
            await client.query(
              `INSERT INTO student_portal_audit_log
                 (school_id,student_id,action,details)
               VALUES ($1,$2,'USERNAME_ASSIGNED',$3::jsonb)`,
              [student.school_id, student.id, JSON.stringify({ username })]
            );
            summary.usernames_assigned++;
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        summary.failed_records++;
        console.error(`Student ${student.id} failed: ${error.message}`);
        summary.students_requiring_attention++;
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Student personalised authentication migration failed:', error.message);
  process.exitCode = 1;
});
