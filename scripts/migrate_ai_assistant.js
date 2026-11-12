require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first.');
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const databaseUrl = new URL(connectionString);
  if (databaseUrl.hostname.includes('-pooler.')) {
    if (!databaseUrl.hostname.endsWith('.neon.tech')) {
      throw new Error('Set DATABASE_URL_UNPOOLED to a direct, non-pooled migration connection.');
    }
    databaseUrl.hostname = databaseUrl.hostname.replace('-pooler.', '.');
  }
  const migration = fs.readFileSync(
    path.join(__dirname, '../sql/migrations/20261117_ai_assistant_conversations.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString: databaseUrl.toString() });
  try {
    await pool.query(migration);
    console.log('McCarthy AI conversation and usage schema applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('McCarthy AI migration failed:', error.message);
  process.exitCode = 1;
});
