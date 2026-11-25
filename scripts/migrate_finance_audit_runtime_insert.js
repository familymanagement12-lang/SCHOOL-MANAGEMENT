require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED or DATABASE_URL before migrating.');
  if (new URL(connectionString).hostname.includes('-pooler')) {
    throw new Error('Finance audit permission migration requires a direct database connection.');
  }
  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261125_finance_audit_runtime_insert.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString });
  try {
    await pool.query(migration);
    console.log('Finance audit INSERT permission migration applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Finance audit permission migration failed:', error.message);
  process.exitCode = 1;
});
