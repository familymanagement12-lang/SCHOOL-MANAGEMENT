const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');
const { GENERAL_MIGRATION_FILES } = require('./init_db');
const {
  REGISTERED_MIGRATIONS,
  runStudentPortalMigration,
} = require('./run_registered_migration');

const scriptsDirectory = __dirname;
const source = (name) => fs.readFileSync(path.join(scriptsDirectory, name), 'utf8');
const allRegisteredGeneral = new Set(Object.values(REGISTERED_MIGRATIONS).flat());
allRegisteredGeneral.add('20261124_student_personalised_auth.sql');
allRegisteredGeneral.add('20261113_student_portal.sql');

test('every general initialization migration has a governed entry point', () => {
  for (const filename of GENERAL_MIGRATION_FILES) assert.ok(allRegisteredGeneral.has(filename), filename);
  for (const filename of allRegisteredGeneral) {
    assert.ok(
      GENERAL_MIGRATION_FILES.includes(filename)
        || filename === '20261124_student_personalised_auth.sql'
        || filename === '20261113_student_portal.sql',
      filename
    );
  }
});

test('every package migration command reaches a guarded runner or protected alias', () => {
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    if (!name.startsWith('db:migrate:')) continue;
    const scriptName = command.match(/scripts\/([^ ]+\.js)/)?.[1];
    assert.ok(scriptName, name + ' must point to a migration entry point');
    const body = source(scriptName);
    const protectedAlias = /require\(['"]\.\/migrate_(?:timetable|subject_timetable_extension)['"]\)/.test(body);
    const sharedGuard = /migrationSafety|run_registered_migration/.test(body);
    assert.ok(protectedAlias || sharedGuard, name + ' bypasses guarded migration infrastructure');
  }
});

test('data seed entry points use the shared target, identity, lock and transaction guard', () => {
  for (const filename of ['seed_admin.js','demo_school_seed.js','setup_timetable_demo.js']) {
    const body = source(filename);
    assert.match(body, /withMigrationLock/);
    assert.match(body, /runSqlTransaction/);
  }
  assert.match(source('demo_school_seed.js'), /ALLOW_DEMO_SEED/);
  assert.match(source('setup_timetable_demo.js'), /ALLOW_TIMETABLE_DEMO_SETUP/);
});

test('legacy migration scripts cannot open a pool or fall back to DATABASE_URL', () => {
  const allowed = new Set([
    'migrate_subject_timetable_extension.js',
    'migrate_learning_assignments.js',
    'migrate_learning_platform.js',
  ]);
  const names = fs.readdirSync(scriptsDirectory).filter((name) => /^migrate_.*\.js$/.test(name) && !name.endsWith('.test.js'));
  for (const name of names) {
    const body = source(name);
    if (allowed.has(name)) {
      assert.match(body, /migrationSafety/);
      assert.doesNotMatch(body, /process\.env\.DATABASE_URL\b/);
      continue;
    }
    assert.doesNotMatch(body, /require\(['"]pg['"]\)/, name);
    assert.doesNotMatch(body, /process\.env\.DATABASE_URL\b/, name);
    assert.doesNotMatch(body, /new Pool\(/, name);
  }
});

function studentPortalClient({ existingSchema = false, hasResults = false } = {}) {
  const statements = [];
  const columns = ['is_published', 'published_at', 'class_id', 'curriculum'];
  return {
    statements,
    client: {
      async query(sql) {
        statements.push(sql);
        if (sql.includes('current_database()')) {
          return { rows: [{ database_name: 'neondb', role_name: 'neondb_owner', session_role: 'neondb_owner' }] };
        }
        if (sql.includes('information_schema.columns')) {
          return { rows: existingSchema ? columns.map((column_name) => ({ column_name })) : [] };
        }
        if (sql.includes('to_regclass')) return { rows: [{ relation: existingSchema ? 'student_portal_audit_log' : null }] };
        if (sql.includes('FROM pg_trigger')) {
          return { rows: existingSchema ? [{
            trigger_definition: 'CREATE TRIGGER results_set_curriculum_snapshot BEFORE INSERT ON public.results FOR EACH ROW EXECUTE FUNCTION set_result_curriculum_snapshot()',
            function_definition: "IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;",
          }] : [] };
        }
        if (sql.includes('SELECT EXISTS (SELECT 1 FROM public.results)')) return { rows: [{ has_results: hasResults }] };
        return { rows: [], rowCount: 0 };
      },
      release() {},
    },
  };
}

test('student portal runner skips an existing insert-only schema without reapplying its historical backfill', async () => {
  const fixture = studentPortalClient({ existingSchema: true });
  const result = await runStudentPortalMigration({
    env: {
      NEON_PROJECT_ID: 'twilight-tooth-59664905',
      NEON_BRANCH_ID: 'br-patient-mud-beoldlob',
      NEON_BRANCH_NAME: 'assignment-learning-dev-2026-11-26',
      NEON_ENDPOINT_ID: 'ep-spring-cloud-beki8ehk',
      DATABASE_URL_UNPOOLED: 'postgresql://test:test@ep-spring-cloud-beki8ehk.c-9.us-east-2.aws.neon.tech/neondb',
    },
    poolFactory: () => ({ connect: async () => fixture.client, end: async () => {} }),
    logger: { log() {}, error() {} },
  });
  assert.deepEqual(result, { applied: false, verified: true });
  assert.equal(fixture.statements.some((sql) => sql === 'BEGIN'), false);
  assert.equal(fixture.statements.some((sql) => /UPDATE results/i.test(sql)), false);
});

test('student portal backfill refuses to run when historical result rows exist', async () => {
  const fixture = studentPortalClient({ hasResults: true });
  await assert.rejects(runStudentPortalMigration({
    env: {
      NEON_PROJECT_ID: 'twilight-tooth-59664905',
      NEON_BRANCH_ID: 'br-patient-mud-beoldlob',
      NEON_BRANCH_NAME: 'assignment-learning-dev-2026-11-26',
      NEON_ENDPOINT_ID: 'ep-spring-cloud-beki8ehk',
      DATABASE_URL_UNPOOLED: 'postgresql://test:test@ep-spring-cloud-beki8ehk.c-9.us-east-2.aws.neon.tech/neondb',
    },
    poolFactory: () => ({ connect: async () => fixture.client, end: async () => {} }),
    logger: { log() {}, error() {} },
  }), /historical result backfill and results already exist/);
  assert.equal(fixture.statements.some((sql) => sql === 'BEGIN'), false);
  assert.equal(fixture.statements.some((sql) => /UPDATE results/i.test(sql)), false);
});
