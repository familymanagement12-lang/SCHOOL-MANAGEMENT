require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED or DATABASE_URL before migrating.');
  if (new URL(connectionString).hostname.includes('-pooler')) {
    throw new Error('Subject/timetable extension migration requires a direct database connection.');
  }
  const pool = new Pool({ connectionString });
  try {
    for (const file of ['20261124_subject_timetable_extension.sql', '20261125_timetable_validation_integrity.sql']) {
      const migration = fs.readFileSync(path.join(__dirname, '../sql/migrations', file), 'utf8');
      await pool.query(migration);
      console.log(`Applied ${file}.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Subject/timetable extension migration failed:', error.message);
  process.exitCode = 1;
});
