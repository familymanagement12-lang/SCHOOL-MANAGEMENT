require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first.');
  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261111_class_assessments.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(migration);
    console.log('Class assessment and 50/50 grading migration applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Class assessment migration failed:', error.message);
  process.exitCode = 1;
});
