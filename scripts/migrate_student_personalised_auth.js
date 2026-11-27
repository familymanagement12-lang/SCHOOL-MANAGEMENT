require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { makeUniqueUsername, generateTemporaryPassword } = require('../backend/src/services/studentUsernameService');
const { withMigrationLock, runSqlTransaction, removeFileTransactionEnvelope } = require('./migrationSafety');

async function migrateStudentAuthentication({ env = process.env, poolFactory, logger = console } = {}) {
  return withMigrationLock({ env, poolFactory, logger, action: async (client) => {
    const summary = {
      total_existing_students: 0,
      existing_accounts_identified: 0,
      new_accounts_created: 0,
      usernames_assigned: 0,
      accounts_already_configured: 0,
      students_requiring_attention: 0,
      failed_records: 0,
    };

    await runSqlTransaction(client, async () => {
      const migration = fs.readFileSync(
        path.join(__dirname, '../sql/migrations/20261124_student_personalised_auth.sql'),
        'utf8'
      );
      await client.query(removeFileTransactionEnvelope(migration));

      const students = await client.query(
        'SELECT s.id, s.school_id, s.name, s.dob, s.user_id, u.username, u.role\n' +
        'FROM students s\n' +
        'LEFT JOIN users u ON u.id=s.user_id AND u.school_id=s.school_id\n' +
        'ORDER BY s.school_id, s.id'
      );
      summary.total_existing_students = students.rowCount;

      for (let index = 0; index < students.rows.length; index += 1) {
        const student = students.rows[index];
        if (student.user_id) {
          summary.existing_accounts_identified += 1;
          if (student.username) {
            summary.accounts_already_configured += 1;
            continue;
          }
        }
        if (!String(student.name || '').trim()) {
          summary.students_requiring_attention += 1;
          continue;
        }
        if (!student.dob) summary.students_requiring_attention += 1;

        const savepoint = 'student_auth_' + index;
        await client.query('SAVEPOINT ' + savepoint);
        try {
          let userId = student.user_id;
          let username = student.username;
          if (!username) {
            username = await makeUniqueUsername(client, student.school_id, student.name, userId);
            if (!username) throw new Error('Unable to generate a unique username.');
          }

          if (!userId) {
            const password = generateTemporaryPassword(student.dob);
            const hashedPassword = await bcrypt.hash(password.temporaryPassword, 10);
            const studentEmail = 'stu_' + String(student.id).padStart(6, '0') + '_' +
              crypto.randomBytes(4).toString('hex') + '@educore.local';
            const created = await client.query(
              'INSERT INTO users\n' +
              '  (school_id,name,email,password,role,must_change_password,is_active,email_verified,username)\n' +
              '  VALUES ($1,$2,$3,$4,\'student\',TRUE,TRUE,TRUE,$5) RETURNING id',
              [student.school_id, student.name, studentEmail, hashedPassword, username]
            );
            userId = created.rows[0].id;
            await client.query('UPDATE students SET user_id=$1 WHERE id=$2 AND school_id=$3', [userId, student.id, student.school_id]);
            await client.query(
              'INSERT INTO student_portal_audit_log\n' +
              '  (school_id,student_id,action,details)\n' +
              '  VALUES ($1,$2,\'ACCOUNT_CREATED\',$3::jsonb)',
              [student.school_id, student.id, JSON.stringify({
                username,
                temporary_password_source: password.source,
              })]
            );
            summary.new_accounts_created += 1;
            summary.usernames_assigned += 1;
          } else {
            await client.query('UPDATE users SET username=$1 WHERE id=$2 AND school_id=$3 AND role=$4', [username, userId, student.school_id, 'student']);
            await client.query(
              'INSERT INTO student_portal_audit_log\n' +
              '  (school_id,student_id,action,details)\n' +
              '  VALUES ($1,$2,\'USERNAME_ASSIGNED\',$3::jsonb)',
              [student.school_id, student.id, JSON.stringify({ username })]
            );
            summary.usernames_assigned += 1;
          }
          await client.query('RELEASE SAVEPOINT ' + savepoint);
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT ' + savepoint);
          await client.query('RELEASE SAVEPOINT ' + savepoint);
          summary.failed_records += 1;
          summary.students_requiring_attention += 1;
        }
      }

      if (summary.failed_records) {
        throw new Error(summary.failed_records + ' student account operation(s) failed; all changes were rolled back.');
      }
    });
    logger.log(JSON.stringify(summary, null, 2));
    return summary;
  } });
}

if (require.main === module) {
  migrateStudentAuthentication().catch((error) => {
    console.error('Student personalised authentication migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrateStudentAuthentication };
