const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertSafeMigrationTarget,
  assertAssignmentPrerequisites,
  runLearningAssignmentsMigration,
  SCHEMA_MIGRATION_LOCK_NAME,
  EXPECTED_INDEX_COUNTS,
  TIMETABLE_TERM_UNIQUE_INDEXES,
} = require('./migrate_learning_assignments');
const { SCHEMA_MIGRATION_LOCK_NAME: SHARED_LOCK_NAME } = require('./migrationSafety');

const approvedIdentity = {
  NEON_PROJECT_ID: 'twilight-tooth-59664905',
  NEON_BRANCH_ID: 'br-patient-mud-beoldlob',
  NEON_BRANCH_NAME: 'assignment-learning-dev-2026-11-26',
  NEON_ENDPOINT_ID: 'ep-spring-cloud-beki8ehk',
};

function targetEnv(host = 'ep-spring-cloud-beki8ehk.c-9.us-east-2.aws.neon.tech') {
  return {
    ...approvedIdentity,
    DATABASE_URL_UNPOOLED: `postgresql://test:test@${host}/neondb?sslmode=require`,
  };
}

test('migration safety accepts only the pinned development branch direct URL', () => {
  const target = assertSafeMigrationTarget(targetEnv());
  assert.equal(target.branchId, approvedIdentity.NEON_BRANCH_ID);
});

test('assignment index postconditions count every primary, unique, and lookup index', () => {
  assert.equal(EXPECTED_INDEX_COUNTS.learning_assignments, 5);
  assert.equal(EXPECTED_INDEX_COUNTS.assignment_submission_versions, 5);
});

test('assignment schema verification accepts only the two unique timetable-term indexes in migration history', () => {
  assert.deepEqual(Object.keys(TIMETABLE_TERM_UNIQUE_INDEXES).sort(), [
    'idx_timetable_terms_scope_ref','timetable_terms_school_year_term_id_unique_idx',
  ]);
  const protectedTermMigration = require('node:fs').readFileSync(
    require('node:path').join(__dirname,'../sql/migrations/20261019_timetable_term_scope.sql'),'utf8'
  );
  const reconciliation = require('node:fs').readFileSync(
    require('node:path').join(__dirname,'../sql/migrations/20261126_timetable_schema_reconciliation.sql'),'utf8'
  );
  assert.match(protectedTermMigration,/CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_terms_scope_ref/);
  assert.match(reconciliation,/DROP INDEX public\.timetable_terms_school_year_term_id_unique_idx/);
});

test('migration safety refuses production, unknown, and pooled endpoints', () => {
  assert.throws(
    () => assertSafeMigrationTarget(targetEnv('ep-spring-mouse-be8cccb8.c-9.us-east-2.aws.neon.tech')),
    /approved direct development endpoint/
  );
  assert.throws(
    () => assertSafeMigrationTarget(targetEnv('ep-unknown.c-9.us-east-2.aws.neon.tech')),
    /approved direct development endpoint/
  );
  assert.throws(
    () => assertSafeMigrationTarget(targetEnv('ep-spring-cloud-beki8ehk-pooler.c-9.us-east-2.aws.neon.tech')),
    /approved direct development endpoint/
  );
});

test('migration safety refuses missing identity and pooled-URL fallbacks', () => {
  const missingBranch = targetEnv();
  delete missingBranch.NEON_BRANCH_ID;
  assert.throws(
    () => assertSafeMigrationTarget(missingBranch),
    /NEON_BRANCH_ID must identify/
  );

  const missingDirectUrl = { ...approvedIdentity, DATABASE_URL: targetEnv().DATABASE_URL_UNPOOLED };
  assert.throws(
    () => assertSafeMigrationTarget(missingDirectUrl),
    /DATABASE_URL is never a fallback/
  );
});

test('assignment migration prerequisites fail closed before migration SQL can run', async () => {
  const statements = [];
  await assert.rejects(
    assertAssignmentPrerequisites({
      query: async (sql) => {
        statements.push(sql);
        return { rows: [] };
      },
    }),
    /missing prerequisites/
  );
  assert.equal(statements.length, 1);
  assert.match(statements[0], /information_schema\.columns/);
});

test('recorded assignment migration with missing schema fails instead of silently skipping', async () => {
  const statements = [];
  let poolEnded = false;
  const prerequisites = [
    ['schools','id'], ['users','id'], ['users','school_id'],
    ['classes','id'], ['classes','school_id'], ['subjects','id'], ['subjects','school_id'],
    ['students','id'], ['students','school_id'], ['timetable_terms','id'],
    ['timetable_terms','school_id'], ['timetable_terms','academic_year'], ['timetable_terms','term'],
  ].map(([table_name, column_name]) => ({ table_name, column_name }));
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('current_database()')) {
        return { rows: [{ database_name: 'neondb', role_name: 'neondb_owner', session_role: 'neondb_owner' }] };
      }
      if (sql.startsWith('SELECT to_regclass')) return { rows: [{ table_name: 'app_schema_migrations' }] };
      if (sql.includes('FROM information_schema.columns')) return { rows: prerequisites };
      if (sql.includes('SELECT 1 FROM public.app_schema_migrations')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (sql.includes('FROM pg_class c JOIN pg_namespace')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  await assert.rejects(runLearningAssignmentsMigration({
    env: targetEnv(),
    poolFactory: () => ({ connect: async () => client, end: async () => { poolEnded = true; } }),
    logger: { log() {}, error() {} },
  }), /schema drift: missing tables/);
  assert.equal(statements.some((sql) => sql === 'BEGIN'), false);
  assert.equal(statements.some((sql) => sql.includes('CREATE TABLE')), false);
  assert.equal(poolEnded, true);
});

test('assignment and protected migration runners share one advisory lock key', () => {
  assert.equal(SCHEMA_MIGRATION_LOCK_NAME, SHARED_LOCK_NAME);
});

test('migration safety requires the expected development database and PostgreSQL scheme', () => {
  const wrongDatabase = targetEnv();
  wrongDatabase.DATABASE_URL_UNPOOLED = wrongDatabase.DATABASE_URL_UNPOOLED.replace('/neondb?', '/postgres?');
  assert.throws(
    () => assertSafeMigrationTarget(wrongDatabase),
    /database name is not the approved development database/
  );

  const wrongScheme = targetEnv();
  wrongScheme.DATABASE_URL_UNPOOLED = wrongScheme.DATABASE_URL_UNPOOLED.replace('postgresql:', 'https:');
  assert.throws(
    () => assertSafeMigrationTarget(wrongScheme),
    /must use PostgreSQL/
  );
});
