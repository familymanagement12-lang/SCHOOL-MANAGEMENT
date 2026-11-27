require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const bcrypt = require('bcryptjs');
const { withMigrationLock, runSqlTransaction } = require('./migrationSafety');

async function seedAdmin({ env = process.env, poolFactory, logger = console } = {}) {
  const email = env.ADMIN_EMAIL || 'admin@mccarthyhillschool.edu.gh';
  const password = env.ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('Set ADMIN_PASSWORD (at least 12 characters) before running this script.');
  }
  return withMigrationLock({ env, poolFactory, logger, action: async (client) => {
    await runSqlTransaction(client, async () => {
      let school = await client.query('SELECT id FROM schools ORDER BY id LIMIT 1');
      if (!school.rows.length) {
        school = await client.query(
          `INSERT INTO schools(name,address,phone,currency,academic_year,current_term) VALUES('The McCarthy Hill School',NULL,NULL,'GHS','2026/2027','Term 1') RETURNING id`
        );
      } else {
        await client.query(`UPDATE schools SET name='The McCarthy Hill School',currency='GHS' WHERE id=$1`, [school.rows[0].id]);
      }
      const schoolId = school.rows[0].id;
      const hash = await bcrypt.hash(password, 12);
      const existing = await client.query('SELECT id FROM users WHERE email=$1', [email]);
      if (existing.rows.length) {
        await client.query(
          `UPDATE users SET school_id=$1,name='School Administrator',password=$2,role='admin',is_active=TRUE,must_change_password=FALSE,email_verified=TRUE WHERE id=$3`,
          [schoolId, hash, existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO users(school_id,name,email,password,role,must_change_password,is_active,email_verified) VALUES($1,'School Administrator',$2,$3,'admin',FALSE,TRUE,TRUE)`,
          [schoolId, email, hash]
        );
      }
    });
    logger.log('Admin account operation completed on the verified development target; credentials were not printed.');
  } });
}

if (require.main === module) {
  seedAdmin().catch((error) => {
    console.error('Admin seed failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { seedAdmin };
