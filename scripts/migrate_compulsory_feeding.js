const path = require('path');
const { createRequire } = require('module');
const backendRequire = createRequire(path.join(__dirname, '../backend/package.json'));
backendRequire('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const fs = require('fs');
const { Pool } = backendRequire('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED or DATABASE_URL in backend/.env first.');
  const databaseUrl = new URL(connectionString);
  if (databaseUrl.hostname.includes('-pooler.')) {
    throw new Error('Feeding migrations require a direct database connection. Set DATABASE_URL_UNPOOLED.');
  }
  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261116_compulsory_feeding.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString: databaseUrl.toString() });
  try {
    await pool.query(migration);
    console.log('Compulsory feeding schema applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Compulsory feeding migration failed:', error.message);
  process.exitCode = 1;
});
