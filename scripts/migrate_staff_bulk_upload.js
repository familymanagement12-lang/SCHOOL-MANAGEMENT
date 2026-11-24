require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Set DATABASE_URL_UNPOOLED or DATABASE_URL in backend/.env first.');
  }
  if (new URL(connectionString).hostname.includes('-pooler')) {
    throw new Error('Staff bulk upload migration requires a direct Neon connection.');
  }

  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261124_staff_bulk_upload.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString });
  try {
    await pool.query(migration);
    console.log('Staff bulk upload migration applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Staff bulk upload migration failed:', error.message);
  process.exitCode = 1;
});
