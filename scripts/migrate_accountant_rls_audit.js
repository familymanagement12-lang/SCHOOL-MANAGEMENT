require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first.');
  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261114_accountant_rls_audit.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(migration);
    console.log('Accountant, finance audit, and RLS migration applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Accountant/RLS migration failed:', error.message);
  process.exitCode = 1;
});
