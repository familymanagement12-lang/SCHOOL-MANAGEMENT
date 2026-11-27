const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertSafeMigrationTarget } = require('./migrate_learning_assignments');
const {
  GENERAL_MIGRATION_FILES,
  assertNoProtectedTimetableDdl,
  initializeDatabase,
} = require('./init_db');

const approvedEnv = {
  NEON_PROJECT_ID: 'twilight-tooth-59664905',
  NEON_BRANCH_ID: 'br-patient-mud-beoldlob',
  NEON_BRANCH_NAME: 'assignment-learning-dev-2026-11-26',
  NEON_ENDPOINT_ID: 'ep-spring-cloud-beki8ehk',
  DATABASE_URL_UNPOOLED: 'postgresql://test:test@ep-spring-cloud-beki8ehk.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require',
};

test('general initialization refuses timetable and subject-extension DDL', () => {
  assert.throws(
    () => assertNoProtectedTimetableDdl('CREATE TABLE IF NOT EXISTS timetables (id integer);', 'test schema'),
    /protected timetable DDL/
  );
  assert.throws(
    () => assertNoProtectedTimetableDdl('ALTER TABLE subjects ADD COLUMN applicable_year_levels integer[];', 'test migration'),
    /protected subject\/timetable extension DDL/
  );
  assert.throws(
    () => assertNoProtectedTimetableDdl('ALTER TABLE subjects ADD COLUMN applicable_education_stages text[];', 'test migration'),
    /protected subject\/timetable extension DDL/
  );
  assert.throws(
    () => assertNoProtectedTimetableDdl('CREATE INDEX idx_test ON timetable_versions (id);', 'test migration'),
    /protected timetable DDL/
  );
  assert.throws(
    () => assertNoProtectedTimetableDdl('CREATE TRIGGER test_trigger AFTER INSERT ON timetables FOR EACH ROW EXECUTE FUNCTION test();', 'test migration'),
    /protected timetable DDL/
  );
  assert.throws(
    () => assertNoProtectedTimetableDdl('ALTER TABLE classes ADD COLUMN education_stage text;', 'test migration'),
    /protected timetable DDL/
  );
  assert.throws(
    () => assertNoProtectedTimetableDdl('CREATE TABLE class_configuration_audit (id bigint);', 'test migration'),
    /protected timetable DDL/
  );
  assert.throws(
    () => assertNoProtectedTimetableDdl('DROP INDEX class_configuration_audit_history_idx;', 'test migration'),
    /protected timetable DDL/
  );

  const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
  assertNoProtectedTimetableDdl(schema, 'sql/schema.sql');
  for (const filename of GENERAL_MIGRATION_FILES) {
    const sql = fs.readFileSync(path.join(__dirname, '../sql/migrations', filename), 'utf8');
    assertNoProtectedTimetableDdl(sql, filename);
  }
});

test('general initialization validates the direct development target before creating a pool', async () => {
  let poolCreated = false;
  await assert.rejects(
    initializeDatabase({
      env: {
        ...approvedEnv,
        NEON_BRANCH_ID: 'br-production',
      },
      targetValidator: assertSafeMigrationTarget,
      poolFactory: () => {
        poolCreated = true;
        throw new Error('Pool must not be created for an unapproved target.');
      },
    }),
    /NEON_BRANCH_ID must identify/
  );
  assert.equal(poolCreated, false);

  await assert.rejects(
    initializeDatabase({
      env: {
        ...approvedEnv,
        DATABASE_URL_UNPOOLED: approvedEnv.DATABASE_URL_UNPOOLED.replace(
          'ep-spring-cloud-beki8ehk.c-9',
          'ep-spring-cloud-beki8ehk-pooler.c-9'
        ),
      },
      targetValidator: assertSafeMigrationTarget,
      poolFactory: () => {
        poolCreated = true;
        throw new Error('Pool must not be created for a pooled target.');
      },
    }),
    /approved direct development endpoint/
  );
  assert.equal(poolCreated, false);
});

test('approved init target uses the direct URL with an injected non-database pool', async () => {
  const queries = [];
  let poolOptions;
  let ended = false;
  await initializeDatabase({
    env: approvedEnv,
    poolFactory: (options) => {
      poolOptions = options;
      return {
        connect: async () => ({
          query: async (sql) => {
            queries.push(sql);
            if (sql.includes('current_database()')) {
              return { rows: [{ database_name: 'neondb', role_name: 'neondb_owner', session_role: 'neondb_owner' }] };
            }
            return { rows: [], rowCount: 0 };
          },
          release() {},
        }),
        end: async () => { ended = true; },
      };
    },
    logger: { log() {} },
  });

  assert.equal(poolOptions.connectionString, approvedEnv.DATABASE_URL_UNPOOLED);
  assert.equal(queries.filter((sql) => sql === 'BEGIN').length, 1);
  assert.equal(queries.filter((sql) => sql === 'COMMIT').length, 1);
  const executedScripts = queries.filter((sql) => !['BEGIN', 'COMMIT'].includes(sql)
    && !/current_database\(\)|pg_advisory_(?:un)?lock|FROM pg_class c JOIN pg_namespace/.test(sql));
  assert.equal(executedScripts.length, GENERAL_MIGRATION_FILES.length + 1);
  assert.ok(queries.some((sql) => sql.startsWith('SELECT pg_advisory_lock')));
  assert.ok(queries.some((sql) => sql.startsWith('SELECT pg_advisory_unlock')));
  assert.equal(ended, true);
});

test('db:init refuses existing public objects before starting its transaction', async () => {
  const statements = [];
  await assert.rejects(initializeDatabase({
    env: approvedEnv,
    poolFactory: () => ({
      connect: async () => ({
        query: async (sql) => {
          statements.push(sql);
          if (sql.includes('current_database()')) {
            return { rows: [{ database_name: 'neondb', role_name: 'neondb_owner', session_role: 'neondb_owner' }] };
          }
          if (sql.includes('FROM pg_class c JOIN pg_namespace')) return { rows: [{ relname: 'schools' }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
        release() {},
      }),
      end: async () => {},
    }),
    logger: { log() {}, error() {} },
  }), /public schema is not empty/);
  assert.equal(statements.some((sql) => sql === 'BEGIN'), false);
  assert.equal(statements.some((sql) => /CREATE TABLE|ALTER TABLE/i.test(sql)), false);
});
