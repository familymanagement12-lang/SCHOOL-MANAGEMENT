require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED or DATABASE_URL in backend/.env first.');
  if (new URL(connectionString).hostname.includes('-pooler')) {
    throw new Error('Staff employment type migration requires a direct database connection.');
  }
  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261125_staff_employment_type.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString });
  try {
    await pool.query(migration);
    console.log('Staff employment type migration applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Staff employment type migration failed:', error.message);
  process.exitCode = 1;
});
