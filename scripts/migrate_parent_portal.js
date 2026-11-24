require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Set DATABASE_URL_UNPOOLED or a direct (non-pooled) DATABASE_URL in backend/.env first.');
  }
  const databaseUrl = new URL(connectionString);
  if (databaseUrl.hostname.includes('-pooler')) {
    throw new Error('Parent portal migrations require a direct Neon connection; use DATABASE_URL_UNPOOLED.');
  }

  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261124_parent_portal.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString });
  try {
    await pool.query(migration);
    console.log('Parent portal migration applied without deleting existing records.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Parent portal migration failed:', error.message);
  process.exitCode = 1;
});
