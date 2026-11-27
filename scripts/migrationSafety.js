const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SCHEMA_MIGRATION_LOCK_NAME = 'mccarthy_hill_schema_migrations';
const APPROVED_DEVELOPMENT_TARGET = Object.freeze({
  projectId: 'twilight-tooth-59664905',
  branchId: 'br-patient-mud-beoldlob',
  branchName: 'assignment-learning-dev-2026-11-26',
  endpointId: 'ep-spring-cloud-beki8ehk',
  directHost: 'ep-spring-cloud-beki8ehk.c-9.us-east-2.aws.neon.tech',
  database: 'neondb',
  role: 'neondb_owner',
});

function assertSafeMigrationTarget(env = process.env) {
  if (!env.DATABASE_URL_UNPOOLED) {
    throw new Error('Refusing database change: DATABASE_URL_UNPOOLED is required; DATABASE_URL is never a fallback.');
  }

  let url;
  try {
    url = new URL(env.DATABASE_URL_UNPOOLED);
  } catch {
    throw new Error('Refusing database change: DATABASE_URL_UNPOOLED is not a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Refusing database change: DATABASE_URL_UNPOOLED must use PostgreSQL.');
  }

  if (env.MIGRATION_TARGET === 'local') {
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)
        || url.pathname !== '/mccarthy_hill_school'
        || !env.MIGRATION_ROLE
        || env.MIGRATION_ROLE === 'mccarthy_runtime_70aef860'
        || env.MIGRATION_ROLE === env.RUNTIME_DATABASE_ROLE) {
      throw new Error('Refusing database change: local mode requires loopback PostgreSQL, database mccarthy_hill_school, and an explicit non-runtime MIGRATION_ROLE.');
    }
    return Object.freeze({
      mode: 'local',
      database: 'mccarthy_hill_school',
      migrationRole: env.MIGRATION_ROLE,
      branchName: 'local-development',
      branchId: null,
    });
  }

  const expected = {
    NEON_PROJECT_ID: APPROVED_DEVELOPMENT_TARGET.projectId,
    NEON_BRANCH_ID: APPROVED_DEVELOPMENT_TARGET.branchId,
    NEON_BRANCH_NAME: APPROVED_DEVELOPMENT_TARGET.branchName,
    NEON_ENDPOINT_ID: APPROVED_DEVELOPMENT_TARGET.endpointId,
  };
  if (env.MIGRATION_TARGET && env.MIGRATION_TARGET !== 'neon-development') {
    throw new Error('Refusing database change: MIGRATION_TARGET is not an approved target mode.');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (env[key] !== value) {
      throw new Error(`Refusing database change: ${key} must identify the approved development target.`);
    }
  }
  if (url.hostname !== APPROVED_DEVELOPMENT_TARGET.directHost || url.hostname.includes('-pooler')) {
    throw new Error('Refusing database change: endpoint is not the approved direct development endpoint.');
  }
  if (url.pathname !== `/${APPROVED_DEVELOPMENT_TARGET.database}`) {
    throw new Error('Refusing database change: database name is not the approved development database.');
  }
  return Object.freeze({ ...APPROVED_DEVELOPMENT_TARGET, mode: 'neon-development', migrationRole: APPROVED_DEVELOPMENT_TARGET.role });
}

async function assertConnectedMigrationIdentity(client, target = APPROVED_DEVELOPMENT_TARGET) {
  const result = await client.query(
    'SELECT current_database() AS database_name, current_user AS role_name, session_user AS session_role'
  );
  const identity = result.rows[0];
  const expectedDatabase = target.database || target.databaseName;
  const expectedRole = target.migrationRole || target.role;
  if (!identity
      || identity.database_name !== expectedDatabase
      || identity.role_name !== expectedRole
      || identity.session_role !== expectedRole) {
    throw new Error('Refusing database change: connected database, current role, or session role is not approved.');
  }
  return identity;
}

async function withMigrationLock({
  env = process.env,
  poolFactory = (options) => new Pool(options),
  logger = console,
  action,
} = {}) {
  const target = assertSafeMigrationTarget(env);
  const pool = poolFactory({ connectionString: env.DATABASE_URL_UNPOOLED });
  let client;
  let lockAcquired = false;
  try {
    client = await pool.connect();
    await assertConnectedMigrationIdentity(client, target);
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [SCHEMA_MIGRATION_LOCK_NAME]);
    lockAcquired = true;
    return await action(client);
  } finally {
    if (client && lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [SCHEMA_MIGRATION_LOCK_NAME]);
      } catch (error) {
        logger.error('Unable to release the shared schema migration lock:', error.message);
      }
    }
    if (client) client.release();
    await pool.end();
  }
}

function removeFileTransactionEnvelope(sql) {
  return sql
    .replace(/^\s*BEGIN(?:\s+TRANSACTION)?\s*;\s*/i, '')
    .replace(/\s*COMMIT\s*;?\s*$/, '');
}

async function runSqlTransaction(client, operation) {
  await client.query('BEGIN');
  try {
    const value = await operation();
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function runMigrationFiles({
  filenames,
  migrationsDirectory = path.join(__dirname, '../sql/migrations'),
  env = process.env,
  poolFactory,
  logger = console,
  afterApply,
} = {}) {
  if (!Array.isArray(filenames) || filenames.length === 0) {
    throw new Error('Refusing database change: at least one registered migration file is required.');
  }
  const migrations = filenames.map((filename) => ({
    filename,
    sql: fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8'),
  }));
  return withMigrationLock({ env, poolFactory, logger, action: async (client) => {
    return runSqlTransaction(client, async () => {
      for (const migration of migrations) {
        await client.query(removeFileTransactionEnvelope(migration.sql));
      }
      if (afterApply) await afterApply(client);
      return migrations.map(({ filename }) => filename);
    });
  } });
}

module.exports = {
  APPROVED_DEVELOPMENT_TARGET,
  SCHEMA_MIGRATION_LOCK_NAME,
  assertSafeMigrationTarget,
  assertConnectedMigrationIdentity,
  withMigrationLock,
  removeFileTransactionEnvelope,
  runSqlTransaction,
  runMigrationFiles,
};
