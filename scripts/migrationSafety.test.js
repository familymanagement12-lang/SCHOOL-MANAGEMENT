const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APPROVED_DEVELOPMENT_TARGET,
  SCHEMA_MIGRATION_LOCK_NAME,
  assertSafeMigrationTarget,
  assertConnectedMigrationIdentity,
  withMigrationLock,
  removeFileTransactionEnvelope,
} = require('./migrationSafety');

const approvedEnv = {
  NEON_PROJECT_ID: APPROVED_DEVELOPMENT_TARGET.projectId,
  NEON_BRANCH_ID: APPROVED_DEVELOPMENT_TARGET.branchId,
  NEON_BRANCH_NAME: APPROVED_DEVELOPMENT_TARGET.branchName,
  NEON_ENDPOINT_ID: APPROVED_DEVELOPMENT_TARGET.endpointId,
  DATABASE_URL_UNPOOLED: `postgresql://test:test@${APPROVED_DEVELOPMENT_TARGET.directHost}/neondb`,
};

test('target guard rejects missing configuration and never falls back to DATABASE_URL', () => {
  assert.throws(() => assertSafeMigrationTarget({ ...approvedEnv, DATABASE_URL_UNPOOLED: undefined, DATABASE_URL: approvedEnv.DATABASE_URL_UNPOOLED }), /DATABASE_URL is never a fallback/);
  for (const key of ['NEON_PROJECT_ID', 'NEON_BRANCH_ID', 'NEON_BRANCH_NAME', 'NEON_ENDPOINT_ID']) {
    assert.throws(() => assertSafeMigrationTarget({ ...approvedEnv, [key]: 'wrong' }), new RegExp(`${key} must identify`));
  }
});

test('target guard rejects wrong endpoint, database, scheme, and pooled connections', () => {
  assert.throws(() => assertSafeMigrationTarget({ ...approvedEnv, DATABASE_URL_UNPOOLED: approvedEnv.DATABASE_URL_UNPOOLED.replace(APPROVED_DEVELOPMENT_TARGET.directHost, 'ep-wrong.c-9.us-east-2.aws.neon.tech') }), /approved direct development endpoint/);
  assert.throws(() => assertSafeMigrationTarget({ ...approvedEnv, DATABASE_URL_UNPOOLED: approvedEnv.DATABASE_URL_UNPOOLED.replace('/neondb', '/postgres') }), /database name/);
  assert.throws(() => assertSafeMigrationTarget({ ...approvedEnv, DATABASE_URL_UNPOOLED: approvedEnv.DATABASE_URL_UNPOOLED.replace('postgresql:', 'https:') }), /must use PostgreSQL/);
  assert.throws(() => assertSafeMigrationTarget({ ...approvedEnv, DATABASE_URL_UNPOOLED: approvedEnv.DATABASE_URL_UNPOOLED.replace(APPROVED_DEVELOPMENT_TARGET.directHost, `${APPROVED_DEVELOPMENT_TARGET.directHost.replace('.c-9', '-pooler.c-9')}`) }), /approved direct development endpoint/);
});

test('local development exception accepts loopback only with explicit owner and target mode', () => {
  const local = {
    MIGRATION_TARGET: 'local',
    MIGRATION_ROLE: 'postgres',
    DATABASE_URL_UNPOOLED: 'postgresql://postgres:test@127.0.0.1:5432/mccarthy_hill_school',
  };
  assert.equal(assertSafeMigrationTarget(local).mode, 'local');
  assert.throws(() => assertSafeMigrationTarget({ ...local, DATABASE_URL_UNPOOLED: local.DATABASE_URL_UNPOOLED.replace('127.0.0.1', 'db.example.com') }), /loopback PostgreSQL/);
  assert.throws(() => assertSafeMigrationTarget({ ...local, MIGRATION_ROLE: 'mccarthy_runtime_70aef860' }), /explicit non-runtime MIGRATION_ROLE/);
});

test('connected identity rejects wrong database, current role and session role', async () => {
  for (const identity of [
    { database_name: 'postgres', role_name: 'neondb_owner', session_role: 'neondb_owner' },
    { database_name: 'neondb', role_name: 'mccarthy_runtime', session_role: 'neondb_owner' },
    { database_name: 'neondb', role_name: 'neondb_owner', session_role: 'mccarthy_runtime' },
  ]) {
    await assert.rejects(assertConnectedMigrationIdentity({ query: async () => ({ rows: [identity] }) }), /connected database, current role, or session role/);
  }
});

test('identity failure happens before acquiring a migration lock or executing SQL', async () => {
  const statements = [];
  let released = false;
  await assert.rejects(withMigrationLock({
    env: approvedEnv,
    poolFactory: () => ({
      connect: async () => ({
        query: async (sql) => {
          statements.push(sql);
          return { rows: [{ database_name: 'neondb', role_name: 'runtime', session_role: 'runtime' }] };
        },
        release: () => { released = true; },
      }),
      end: async () => {},
    }),
    action: async () => { statements.push('MUTATION'); },
    logger: { error() {} },
  }), /connected database/);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /current_database/);
  assert.equal(released, true);
});

test('all guarded migration paths use the shared advisory lock', async () => {
  const statements = [];
  const identity = { database_name: 'neondb', role_name: 'neondb_owner', session_role: 'neondb_owner' };
  await withMigrationLock({
    env: approvedEnv,
    poolFactory: () => ({
      connect: async () => ({ query: async (sql) => { statements.push(sql); return { rows: [identity] }; }, release() {} }),
      end: async () => {},
    }),
    action: async () => 'ok',
    logger: { error() {} },
  });
  assert.ok(statements.some((sql) => sql.startsWith('SELECT pg_advisory_lock')));
  assert.ok(statements.some((sql) => sql.startsWith('SELECT pg_advisory_unlock')));
  assert.equal(SCHEMA_MIGRATION_LOCK_NAME, 'mccarthy_hill_schema_migrations');
});

test('concurrent guarded operations do not overlap while the shared lock is held', async () => {
  let lockTail = Promise.resolve();
  let active = 0;
  let maximumActive = 0;
  let firstEntered;
  const firstOperationEntered = new Promise((resolve) => { firstEntered = resolve; });
  let releaseFirst;
  const holdFirstOperation = new Promise((resolve) => { releaseFirst = resolve; });
  let secondEntered = false;

  const poolFactory = () => {
    let releaseLock;
    return {
      connect: async () => ({
        query: async (sql) => {
          if (sql.includes('current_database()')) {
            return { rows: [{ database_name: 'neondb', role_name: 'neondb_owner', session_role: 'neondb_owner' }] };
          }
          if (sql.startsWith('SELECT pg_advisory_lock')) {
            const previous = lockTail;
            lockTail = new Promise((resolve) => { releaseLock = resolve; });
            await previous;
          } else if (sql.startsWith('SELECT pg_advisory_unlock')) {
            releaseLock();
          }
          return { rows: [] };
        },
        release() {},
      }),
      end: async () => {},
    };
  };
  const run = (second = false) => withMigrationLock({
    env: approvedEnv,
    poolFactory,
    logger: { error() {} },
    action: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (!second) {
        firstEntered();
        await holdFirstOperation;
      } else {
        secondEntered = true;
      }
      active -= 1;
    },
  });

  const first = run();
  await firstOperationEntered;
  const second = run(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondEntered, false);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(secondEntered, true);
  assert.equal(maximumActive, 1);
});

test('migration SQL transaction envelopes can be nested under the guarded transaction', () => {
  assert.equal(removeFileTransactionEnvelope('BEGIN;\nSELECT 1;\nCOMMIT;'), 'SELECT 1;');
});
