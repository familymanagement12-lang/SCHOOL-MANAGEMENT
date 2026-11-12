require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const file of ['20261017_timetable_foundation.sql', '20261018_timetable_management.sql', '20261019_timetable_term_scope.sql', '20261020_timetable_integrity.sql']) {
      const migration = fs.readFileSync(path.join(__dirname, '../sql/migrations', file), 'utf8');
      await pool.query(migration);
      console.log(`Applied ${file}.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Timetable migration failed:', error.message);
  process.exitCode = 1;
});
