require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first.');
  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261112_school_name.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(migration);
    const result = await pool.query('SELECT name FROM schools ORDER BY id LIMIT 1');
    if (result.rows[0]?.name !== 'The McCarthy Hill School') {
      throw new Error('The school name was not updated. Check the existing schools record.');
    }
    console.log('School name updated to The McCarthy Hill School.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('School name migration failed:', error.message);
  process.exitCode = 1;
});
