require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first.');
  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261112_optional_class_year_level.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(migration);
    console.log('Year level is now optional for classes. Existing class data was preserved.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Optional class year-level migration failed:', error.message);
  process.exitCode = 1;
});
