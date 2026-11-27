const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertSafeMigrationTarget,
  executeMigrations,
  loadMigrations,
  assertCompleteTimetableSequence,
  assertResultSnapshotPrerequisiteOrder,
  assertMigrationLedgerConsistency,
  assertTeacherSubjectConstraintDefinitions,
  assertClassAuditDefinitions,
  REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT,
  REVIEWED_DEVELOPMENT_DATA_QUERY,
  REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT_QUERY,
} = require('./migrate_subject_timetable_extension');
const { getTimetableMigrations } = require('./migrate_timetable');

const approvedIdentity = {
  NEON_PROJECT_ID: 'twilight-tooth-59664905',
  NEON_BRANCH_ID: 'br-patient-mud-beoldlob',
  NEON_BRANCH_NAME: 'assignment-learning-dev-2026-11-26',
  NEON_ENDPOINT_ID: 'ep-spring-cloud-beki8ehk',
};

const targetEnv = (overrides = {}, host = 'ep-spring-cloud-beki8ehk.c-9.us-east-2.aws.neon.tech', database = 'neondb') => ({
  ...approvedIdentity,
  ...overrides,
  DATABASE_URL_UNPOOLED: `postgresql://test:test@${host}/${database}?sslmode=require`,
});

const quietLogger = { log() {}, error() {} };

function createFakeClient(databaseName = 'neondb', {
  ledgerExists = true,
  existingSchemaMarkers = [],
  resultSnapshotPrerequisitesReady = true,
  schemaFingerprint = REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT,
} = {}) {
  const applied = new Set();
  const executions = new Map();
  const statements = [];
  const markers = new Set(existingSchemaMarkers);

  return {
    applied,
    executions,
    statements,
    markers,
    release() {},
    async query(sql, values = []) {
      const statement = sql.trim();
      statements.push(statement);
      if (statement.startsWith('SELECT current_database()')) {
        return {
          rows: [{ database_name: databaseName, role_name: 'neondb_owner', session_role: 'neondb_owner' }],
          rowCount: 1,
        };
      }
      if (statement === REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT_QUERY.trim()) {
        return { rows: [{ fingerprint: schemaFingerprint }], rowCount: 1 };
      }
      if (statement === REVIEWED_DEVELOPMENT_DATA_QUERY.trim()) {
        return {
          rows: [{
            schools: '1', classes: '25', unassigned_classes: '25', null_year_classes: '25',
            legacy_teacher_classes: '0', assigned_class_teachers: '0', students: '343',
            unassigned_students: '343', students_without_class: '0', results: '0',
            history_rows: '343', active_history_rows: '343', timetable_rows: '0', term_rows: '0',
            version_rows: '0', weekly_requirement_rows: '0', generation_run_rows: '0', pathway_rows: '0',
          }],
          rowCount: 1,
        };
      }
      if (statement.includes("to_regclass('public.results')")) {
        return { rows: [{ ready: resultSnapshotPrerequisitesReady }], rowCount: 1 };
      }
      if (statement.startsWith('SELECT pg_advisory_lock') || statement.startsWith('SELECT pg_advisory_unlock')) {
        return { rows: [], rowCount: 1 };
      }
      if (statement.startsWith("SELECT to_regclass('public.app_schema_migrations')")) {
        return { rows: [{ table_name: ledgerExists ? 'app_schema_migrations' : null }], rowCount: 1 };
      }
      if (statement === 'SELECT migration_name FROM public.app_schema_migrations') {
        return { rows: [...applied].map((migration_name) => ({ migration_name })), rowCount: applied.size };
      }
      if (statement.startsWith("SELECT 'column:' || column_name")) {
        return { rows: [], rowCount: 0 };
      }
      if (statement.includes("to_regclass('public.timetables')")) {
        const exists = markers.has('20261017_timetable_foundation');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("to_regclass('public.timetable_versions')")) {
        const exists = markers.has('20261018_timetable_management');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("to_regclass('public.timetable_terms')")) {
        const exists = markers.has('20261019_timetable_term_scope');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("c.conname = 'timetable_versions_full_term_scope_fk'")) {
        const exists = markers.has('20261020_timetable_integrity');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("column_name = 'education_stage'")) {
        const exists = markers.has('20261126_classification_foundation');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("column_name = 'curriculum'")) {
        const exists = markers.has('20261112_curriculum_foundation');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("to_regclass('public.curriculum_pathway_selections')")) {
        const exists = markers.has('20261124_curriculum_transition_workflow');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("to_regclass('public.subject_class_assignments')")) {
        const exists = markers.has('20261124_subject_timetable_extension');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("c.relname = 'subject_scheduling_preferences_null_safe_unique_idx'")) {
        const exists = markers.has('20261125_timetable_validation_integrity');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("to_regclass('public.class_configuration_audit')")) {
        const exists = markers.has('20261127_class_configuration_audit');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.includes("column_name = 'class_id_snapshot'")) {
        const exists = markers.has('20261128_class_configuration_audit_events');
        return { rows: [{ exists }], rowCount: 1 };
      }
      if (statement.startsWith('SELECT object_name, definition, key_columns')) {
        const termMigrationApplied = applied.has('20261019_timetable_term_scope');
        return {
          rows: termMigrationApplied
            ? [{
              object_name: 'teacher_subject_assignments_term_unique',
              definition: 'UNIQUE (school_id, term_id, teacher_id, subject_id, class_id)',
              key_columns: ['class_id', 'school_id', 'subject_id', 'teacher_id', 'term_id'],
            }]
            : [],
          rowCount: termMigrationApplied ? 1 : 0,
        };
      }
      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (statement.startsWith('CREATE TABLE IF NOT EXISTS public.app_schema_migrations')) {
        return { rows: [], rowCount: 0 };
      }
      if (statement.startsWith('SELECT 1 FROM public.app_schema_migrations')) {
        return { rows: applied.has(values[0]) ? [{ '?column?': 1 }] : [], rowCount: applied.has(values[0]) ? 1 : 0 };
      }
      if (statement.startsWith('INSERT INTO public.app_schema_migrations')) {
        applied.add(values[0]);
        return { rows: [], rowCount: 1 };
      }
      if (statement.startsWith('-- migration:')) {
        executions.set(statement, (executions.get(statement) || 0) + 1);
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
  };
}

test('subject/timetable migration runner accepts only the pinned development target', () => {
  assert.equal(assertSafeMigrationTarget(targetEnv()).branchId, approvedIdentity.NEON_BRANCH_ID);
  assert.throws(() => assertSafeMigrationTarget(targetEnv({ NEON_PROJECT_ID: 'production-project' })), /NEON_PROJECT_ID/);
  assert.throws(() => assertSafeMigrationTarget(targetEnv({ NEON_BRANCH_ID: 'production-branch' })), /NEON_BRANCH_ID/);
  assert.throws(() => assertSafeMigrationTarget(targetEnv({ NEON_BRANCH_NAME: 'production' })), /NEON_BRANCH_NAME/);
  assert.throws(() => assertSafeMigrationTarget(targetEnv({ NEON_ENDPOINT_ID: 'ep-production' })), /NEON_ENDPOINT_ID/);
  assert.throws(
    () => assertSafeMigrationTarget(targetEnv({}, 'ep-production.c-9.us-east-2.aws.neon.tech')),
    /approved direct development endpoint/
  );
  assert.throws(
    () => assertSafeMigrationTarget(targetEnv({}, 'ep-spring-cloud-beki8ehk-pooler.c-9.us-east-2.aws.neon.tech')),
    /approved direct development endpoint/
  );
  assert.throws(() => assertSafeMigrationTarget(targetEnv({}, undefined, 'postgres')), /database name is not the approved development database/);
});

test('invalid migration target is rejected before opening a pool', async () => {
  let poolCreated = false;
  await assert.rejects(
    executeMigrations({
      env: targetEnv({ NEON_BRANCH_ID: 'production-branch' }),
      poolFactory() {
        poolCreated = true;
        throw new Error('Pool must not be created.');
      },
      migrations: getTimetableMigrations(),
      logger: quietLogger,
    }),
    /NEON_BRANCH_ID/
  );
  assert.equal(poolCreated, false);
});

test('snapshot migration prerequisite order follows curriculum and result snapshot schema definitions', () => {
  const migrations = getTimetableMigrations();
  assert.doesNotThrow(() => assertResultSnapshotPrerequisiteOrder(migrations));
  const reordered = [...migrations];
  const snapshotIndex = reordered.findIndex(({ migrationName }) => migrationName === '20261126_result_snapshot_insert_only');
  const [snapshot] = reordered.splice(snapshotIndex, 1);
  reordered.splice(reordered.findIndex(({ migrationName }) => migrationName === '20261124_curriculum_transition_workflow'), 0, snapshot);
  assert.throws(() => assertResultSnapshotPrerequisiteOrder(reordered), /must precede/);
});

test('already recorded migrations are skipped on subsequent runs', async () => {
  const client = createFakeClient();
  const migrations = [
    { filename: 'first.sql', migrationName: 'first', sql: '-- migration: first' },
    { filename: 'second.sql', migrationName: 'second', sql: '-- migration: second' },
  ];
  const pool = {
    async connect() { return client; },
    async end() {},
  };
  const options = {
    env: targetEnv(),
    poolFactory: () => pool,
    migrations,
    logger: quietLogger,
  };

  await executeMigrations(options);
  await executeMigrations(options);

  assert.equal(client.applied.size, 2);
  assert.equal(client.executions.get('-- migration: first'), 1);
  assert.equal(client.executions.get('-- migration: second'), 1);
  assert.equal(client.statements.filter((statement) => statement === 'SELECT pg_advisory_lock(hashtext($1))').length, 2);
});

test('timetable migration entry points require the complete dependency-ordered sequence', () => {
  const migrations = getTimetableMigrations();
  assert.doesNotThrow(() => assertCompleteTimetableSequence(migrations));
  assert.throws(
    () => assertCompleteTimetableSequence(migrations.slice(6)),
    /complete protected sequence in dependency order/
  );
  assert.throws(
    () => assertCompleteTimetableSequence([...migrations].reverse()),
    /complete protected sequence in dependency order/
  );
});

test('result snapshot ledger entry requires its prerequisite migrations to be recorded', () => {
  const migrations = getTimetableMigrations();
  assert.doesNotThrow(() => assertMigrationLedgerConsistency(migrations, new Set([
    '20261017_timetable_foundation',
    '20261018_timetable_management',
    '20261019_timetable_term_scope',
    '20261020_timetable_integrity',
  ])));
  assert.throws(() => assertMigrationLedgerConsistency(migrations, new Set([
    '20261126_result_snapshot_insert_only',
  ])), /recorded without its prerequisite migrations/);
});

test('result snapshot migration requires student portal result columns before taking the migration lock', async () => {
  const client = createFakeClient('neondb', { resultSnapshotPrerequisitesReady: false });
  const pool = {
    async connect() { return client; },
    async end() {},
  };

  await assert.rejects(executeMigrations({
    env: targetEnv(),
    poolFactory: () => pool,
    migrations: getTimetableMigrations().map((migration) => ({
      ...migration,
      sql: `-- migration: ${migration.migrationName}`,
    })),
    logger: quietLogger,
  }), /20261113_student_portal must provide results\.class_id and results\.curriculum/);
  assert.equal(client.statements.some((statement) => statement.startsWith('SELECT pg_advisory_lock')), false);
  assert.equal(client.executions.size, 0);
});

test('teacher-subject reconciliation accepts only the known old or exact term-scoped definition', () => {
  const legacy = [{
    object_name: 'teacher_subject_assignments_school_id_teacher_id_subject_id_key',
    definition: 'UNIQUE (school_id, teacher_id, subject_id, class_id)',
    key_columns: ['class_id', 'school_id', 'subject_id', 'teacher_id'],
  }];
  const termScoped = [{
    object_name: 'teacher_subject_assignments_term_unique',
    definition: 'UNIQUE (school_id, term_id, teacher_id, subject_id, class_id)',
    key_columns: ['class_id', 'school_id', 'subject_id', 'teacher_id', 'term_id'],
  }];

  assert.doesNotThrow(() => assertTeacherSubjectConstraintDefinitions(legacy, false));
  assert.doesNotThrow(() => assertTeacherSubjectConstraintDefinitions(termScoped, true));
  assert.throws(
    () => assertTeacherSubjectConstraintDefinitions([{
      ...legacy[0],
      object_name: 'legacy_teacher_subject_scope',
    }], false),
    /No unknown constraint or index was dropped/
  );
  assert.throws(
    () => assertTeacherSubjectConstraintDefinitions([{
      ...termScoped[0],
      definition: 'UNIQUE (school_id, teacher_id, subject_id)',
    }], true),
    /expected teacher_subject_assignments_term_unique/
  );
  assert.throws(
    () => assertTeacherSubjectConstraintDefinitions([...legacy, ...termScoped], true),
    /no alternate legacy teacher-subject uniqueness/
  );
});

test('class audit reconciliation rejects partial or mismatched definitions without baselining', () => {
  const expectedDefinitions = [
    {
      object_name: 'column:class_id_snapshot',
      observed_definition: 'integer',
      observed_nullability: 'YES',
      observed_default: '',
    },
    {
      object_name: 'column:action',
      observed_definition: 'text',
      observed_nullability: 'NO',
      observed_default: "'UPDATED'::text",
    },
    {
      object_name: 'constraint:class_configuration_audit_action_check',
      observed_definition: "CHECK ((action = ANY (ARRAY['CREATED'::text, 'UPDATED'::text, 'DELETED'::text])))",
      observed_nullability: '',
      observed_default: '',
    },
    {
      object_name: 'policy:class_configuration_audit_teacher_insert',
      observed_definition: "INSERT|((school_id = current_setting('app.school_id')) AND changed_by = current_setting('app.user_id') AND current_setting('app.role') = 'teacher')",
      observed_nullability: '',
      observed_default: '',
    },
    {
      object_name: 'table_rls',
      observed_definition: 'enabled=true;forced=true',
      observed_nullability: '',
      observed_default: '',
    },
  ];

  assert.doesNotThrow(() => assertClassAuditDefinitions([], false));
  assert.doesNotThrow(() => assertClassAuditDefinitions(expectedDefinitions, true));
  assert.throws(
    () => assertClassAuditDefinitions([expectedDefinitions[0]], false),
    /unrecorded 20261128_class_configuration_audit_events definitions/
  );
  assert.throws(
    () => assertClassAuditDefinitions([
      { ...expectedDefinitions[0], observed_definition: 'text' },
      ...expectedDefinitions.slice(1),
    ], true),
    /expected column:class_id_snapshot to be integer NULLABLE=YES, observed text NULLABLE=YES/
  );
});

test('unrecorded existing timetable schema blocks migrations before ledger creation or SQL execution', async () => {
  const client = createFakeClient('neondb', {
    ledgerExists: false,
    existingSchemaMarkers: ['20261017_timetable_foundation'],
    schemaFingerprint: 'unreviewed-schema',
  });
  const migrations = getTimetableMigrations().map((migration) => ({
    ...migration,
    sql: `-- migration: ${migration.migrationName}`,
  }));
  const pool = {
    async connect() { return client; },
    async end() {},
  };

  await assert.rejects(
    executeMigrations({
      env: targetEnv(),
      poolFactory: () => pool,
      migrations,
      logger: quietLogger,
    }),
    /unrecorded schema differs from the exact reviewed development baseline/
  );
  assert.equal(client.executions.size, 0);
  assert.equal(client.statements.some((statement) => statement.startsWith('CREATE TABLE IF NOT EXISTS public.app_schema_migrations')), false);
});

test('recorded legacy migrations do not trigger reconciliation blocking', async () => {
  const client = createFakeClient('neondb', {
    existingSchemaMarkers: [
      '20261017_timetable_foundation',
      '20261018_timetable_management',
      '20261019_timetable_term_scope',
      '20261020_timetable_integrity',
    ],
  });
  for (const migrationName of [
    '20261017_timetable_foundation',
    '20261018_timetable_management',
    '20261019_timetable_term_scope',
    '20261020_timetable_integrity',
  ]) client.applied.add(migrationName);
  const migrations = getTimetableMigrations().map((migration) => ({
    ...migration,
    sql: `-- migration: ${migration.migrationName}`,
  }));
  const pool = {
    async connect() { return client; },
    async end() {},
  };

  await executeMigrations({
    env: targetEnv(),
    poolFactory: () => pool,
    migrations,
    logger: quietLogger,
  });
  assert.equal(client.executions.size, migrations.length - 4);
});

test('migration runner refuses a database name mismatch before locking or migrating', async () => {
  const client = createFakeClient('production');
  const pool = {
    async connect() { return client; },
    async end() {},
  };
  await assert.rejects(
    executeMigrations({
      env: targetEnv(),
      poolFactory: () => pool,
      migrations: [{ filename: 'first.sql', migrationName: 'first', sql: '-- migration: first' }],
      logger: quietLogger,
    }),
    /connected database does not match/
  );
  assert.equal(client.statements.some((statement) => statement.startsWith('SELECT pg_advisory_lock')), false);
  assert.equal(client.executions.size, 0);
});

test('failed migration rolls back without recording completion', async () => {
  const client = createFakeClient();
  const originalQuery = client.query.bind(client);
  client.query = async (sql, values) => {
    if (sql.trim() === '-- migration: failing') throw new Error('migration failure');
    return originalQuery(sql, values);
  };
  const pool = {
    async connect() { return client; },
    async end() {},
  };

  await assert.rejects(
    executeMigrations({
      env: targetEnv(),
      poolFactory: () => pool,
      migrations: [{ filename: 'failing.sql', migrationName: 'failing', sql: '-- migration: failing' }],
      logger: quietLogger,
    }),
    /migration failure/
  );
  assert.equal(client.applied.has('failing'), false);
  assert.equal(client.statements.includes('ROLLBACK'), true);
});

test('subject preference integrity migration preserves duplicates and requires administrator review', () => {
  const migration = loadMigrations().find(({ filename }) => filename === '20261125_timetable_validation_integrity.sql');
  assert.ok(migration);
  assert.doesNotMatch(migration.sql, /\bDELETE\s+FROM\s+subject_scheduling_preferences\b/i);
  assert.match(migration.sql, /HAVING COUNT\(\*\) > 1/);
  assert.match(migration.sql, /duplicate groups require administrator review/i);
  assert.match(migration.sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
});
