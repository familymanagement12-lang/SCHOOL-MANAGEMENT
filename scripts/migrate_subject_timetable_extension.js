const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  assertSafeMigrationTarget,
  SCHEMA_MIGRATION_LOCK_NAME,
} = require('./migrationSafety');

const APPROVED_DATABASE = 'neondb';
const MIGRATION_FILES = [
  '20261124_subject_timetable_extension.sql',
  '20261125_timetable_validation_integrity.sql',
];

const PROTECTED_TIMETABLE_SEQUENCE = Object.freeze([
  '20261017_timetable_foundation',
  '20261018_timetable_management',
  '20261112_curriculum_foundation',
  '20261019_timetable_term_scope',
  '20261020_timetable_integrity',
  '20261112_optional_class_year_level',
  '20261112_optional_class_teacher',
  '20261126_classification_foundation',
  '20261124_curriculum_transition_workflow',
  '20261124_subject_timetable_extension',
  '20261125_timetable_validation_integrity',
  '20261127_class_configuration_audit',
  '20261128_class_configuration_audit_events',
  '20261126_result_snapshot_insert_only',
  '20261126_timetable_schema_reconciliation',
  '20261126_runtime_privilege_hardening',
]);

const RESULT_SNAPSHOT_PREREQUISITE_MIGRATIONS = Object.freeze([
  '20261112_curriculum_foundation',
  '20261112_optional_class_year_level',
  '20261126_classification_foundation',
  '20261124_curriculum_transition_workflow',
]);

const RESULT_SNAPSHOT_EXTERNAL_PREREQUISITES_QUERY = `
  SELECT (
    to_regclass('public.results') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'results' AND column_name = 'class_id'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'results' AND column_name = 'curriculum'
    )
  ) AS ready
`;

const LEGACY_SCHEMA_SIGNATURES = Object.freeze([
  {
    migrationName: '20261017_timetable_foundation',
    query: `SELECT (
      to_regclass('public.timetables') IS NOT NULL
      OR to_regclass('public.timetable_rooms') IS NOT NULL
    ) AS exists`,
  },
  {
    migrationName: '20261018_timetable_management',
    query: "SELECT to_regclass('public.timetable_versions') IS NOT NULL AS exists",
  },
  {
    migrationName: '20261019_timetable_term_scope',
    query: "SELECT to_regclass('public.timetable_terms') IS NOT NULL AS exists",
  },
  {
    migrationName: '20261020_timetable_integrity',
    query: `SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public'
        AND r.relname = 'timetable_versions'
        AND c.conname = 'timetable_versions_full_term_scope_fk'
    ) AS exists`,
  },
  {
    migrationName: '20261126_classification_foundation',
    query: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'classes'
        AND column_name = 'education_stage'
    ) AS exists`,
  },
  {
    migrationName: '20261112_curriculum_foundation',
    query: `SELECT (
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'classes'
          AND column_name = 'curriculum'
      )
      OR to_regclass('public.curriculum_subjects') IS NOT NULL
    ) AS exists`,
  },
  {
    migrationName: '20261124_curriculum_transition_workflow',
    query: `SELECT (
      to_regclass('public.curriculum_pathway_selections') IS NOT NULL
      OR to_regclass('public.student_class_history') IS NOT NULL
    ) AS exists`,
  },
  {
    migrationName: '20261124_subject_timetable_extension',
    query: `SELECT (
      to_regclass('public.subject_class_assignments') IS NOT NULL
      OR to_regclass('public.subject_scheduling_preferences') IS NOT NULL
    ) AS exists`,
  },
  {
    migrationName: '20261125_timetable_validation_integrity',
    query: `SELECT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'subject_scheduling_preferences_null_safe_unique_idx'
    ) AS exists`,
  },
  {
    migrationName: '20261127_class_configuration_audit',
    query: "SELECT to_regclass('public.class_configuration_audit') IS NOT NULL AS exists",
  },
  {
    migrationName: '20261128_class_configuration_audit_events',
    query: `SELECT (
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'class_configuration_audit'
          AND column_name = 'class_id_snapshot'
      )
      OR EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'class_configuration_audit'
          AND column_name = 'action'
      )
      OR EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = to_regclass('public.class_configuration_audit')
          AND c.conname = 'class_configuration_audit_action_check'
      )
    ) AS exists`,
  },
]);

// This fingerprint is the exact unrecorded development schema inspected on
// 2026-11-26. It permits only that reviewed baseline through the legacy-schema
// gate; any drift from the reviewed catalog causes a fail-closed refusal.
const REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT = 'b2e1f74b75c35ee09f6b2c69cc90f2af';
const REVIEWED_DEVELOPMENT_DATA_QUERY = `
  SELECT
    (SELECT COUNT(*) FROM schools) AS schools,
    (SELECT COUNT(*) FROM classes) AS classes,
    (SELECT COUNT(*) FROM classes WHERE curriculum = 'UNASSIGNED') AS unassigned_classes,
    (SELECT COUNT(*) FROM classes WHERE year_level IS NULL) AS null_year_classes,
    (SELECT COUNT(*) FROM classes WHERE teacher_id IS NOT NULL) AS legacy_teacher_classes,
    (SELECT COUNT(*) FROM classes WHERE class_teacher_id IS NOT NULL) AS assigned_class_teachers,
    (SELECT COUNT(*) FROM students) AS students,
    (SELECT COUNT(*) FROM students WHERE curriculum = 'UNASSIGNED') AS unassigned_students,
    (SELECT COUNT(*) FROM students WHERE class_id IS NULL) AS students_without_class,
    (SELECT COUNT(*) FROM results) AS results,
    (SELECT COUNT(*) FROM student_class_history) AS history_rows,
    (SELECT COUNT(*) FROM student_class_history WHERE effective_to IS NULL) AS active_history_rows,
    (SELECT COUNT(*) FROM timetables) AS timetable_rows,
    (SELECT COUNT(*) FROM timetable_terms) AS term_rows,
    (SELECT COUNT(*) FROM timetable_versions) AS version_rows,
    (SELECT COUNT(*) FROM subject_weekly_requirements) AS weekly_requirement_rows,
    (SELECT COUNT(*) FROM timetable_generation_runs) AS generation_run_rows,
    (SELECT COUNT(*) FROM curriculum_pathway_selections) AS pathway_rows
`;

const REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT_QUERY = `
  WITH relation_names(name) AS (
    SELECT unnest($1::text[])
  ), components(value) AS (
    SELECT 'R|' || rn.name || '|' || COALESCE(cl.relkind::text, 'MISSING') || '|' ||
           COALESCE(pg_get_userbyid(cl.relowner), '') || '|' ||
           COALESCE(cl.relrowsecurity::text, '') || '|' ||
           COALESCE(cl.relforcerowsecurity::text, '') || '|' || COALESCE(cl.relacl::text, '')
    FROM relation_names rn LEFT JOIN pg_class cl ON cl.oid = to_regclass('public.' || rn.name)
    UNION ALL
    SELECT 'C|' || table_name || '|' || ordinal_position::text || '|' || column_name || '|' ||
           udt_name || '|' || is_nullable || '|' || COALESCE(column_default, '') || '|' ||
           is_identity || '|' || COALESCE(identity_generation, '') || '|' || is_generated || '|' ||
           COALESCE(generation_expression, '')
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    UNION ALL
    SELECT 'K|' || cl.relname || '|' || con.conname || '|' || con.contype::text || '|' ||
           pg_get_constraintdef(con.oid, true) || '|' || con.convalidated::text || '|' ||
           con.condeferrable::text || '|' || con.condeferred::text
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public' AND cl.relname = ANY($1::text[])
    UNION ALL
    SELECT 'I|' || tablename || '|' || indexname || '|' || indexdef
    FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1::text[])
    UNION ALL
    SELECT 'F|' || proc.proname || '|' || pg_get_function_identity_arguments(proc.oid) || '|' ||
           pg_get_function_result(proc.oid) || '|' || lang.lanname || '|' || proc.prosecdef::text || '|' ||
           proc.provolatile::text || '|' || COALESCE(array_to_string(proc.proconfig, ','), '') || '|' ||
           pg_get_userbyid(proc.proowner) || '|' || COALESCE(proc.proacl::text, '') || '|' ||
           pg_get_functiondef(proc.oid)
    FROM pg_proc proc
    JOIN pg_namespace ns ON ns.oid = proc.pronamespace
    JOIN pg_language lang ON lang.oid = proc.prolang
    WHERE ns.nspname = 'public' AND proc.proname = ANY($2::text[])
    UNION ALL
    SELECT 'T|' || cl.relname || '|' || trig.tgname || '|' ||
           pg_get_triggerdef(trig.oid, true) || '|' || proc.proname
    FROM pg_trigger trig
    JOIN pg_class cl ON cl.oid = trig.tgrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_proc proc ON proc.oid = trig.tgfoid
    WHERE ns.nspname = 'public' AND NOT trig.tgisinternal
      AND cl.relname = ANY($1::text[])
    UNION ALL
    SELECT 'P|' || cl.relname || '|' || pol.polname || '|' || pol.polcmd::text || '|' ||
           pol.polpermissive::text || '|' || pol.polroles::regrole[]::text || '|' ||
           COALESCE(pg_get_expr(pol.polqual, pol.polrelid, true), '') || '|' ||
           COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid, true), '')
    FROM pg_policy pol
    JOIN pg_class cl ON cl.oid = pol.polrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public' AND cl.relname = ANY($1::text[])
  )
  SELECT md5(string_agg(value, E'\\n' ORDER BY value)) AS fingerprint
  FROM components
`;

const REVIEWED_DEVELOPMENT_RELATIONS = Object.freeze([
  'schools', 'classes', 'students', 'results', 'subjects', 'users', 'timetables',
  'timetable_rooms', 'timetable_periods', 'teacher_subject_assignments', 'teacher_availability',
  'class_availability', 'room_availability', 'subject_weekly_requirements',
  'timetable_generation_runs', 'timetable_unscheduled_lessons', 'teacher_workload_limits',
  'timetable_versions', 'timetable_audit_log', 'timetable_terms',
  'timetable_class_teacher_assignments', 'curriculum_subjects',
  'curriculum_grading_configurations', 'curriculum_selection_periods',
  'curriculum_pathway_selections', 'curriculum_selection_notification_log',
  'student_class_history', 'subject_class_assignments', 'subject_scheduling_preferences',
  'class_configuration_audit', 'app_schema_migrations',
]);

const REVIEWED_DEVELOPMENT_FUNCTIONS = Object.freeze([
  'validate_class_teacher_assignment', 'validate_school_curriculum', 'sync_student_curriculum',
  'sync_class_student_curriculum', 'canonical_curriculum_class_name',
  'set_result_curriculum_snapshot', 'record_student_class_history',
]);

const TEACHER_SUBJECT_UNIQUENESS_QUERY = `
  SELECT object_name, definition, key_columns
  FROM (
    SELECT c.conname AS object_name,
           pg_get_constraintdef(c.oid) AS definition,
           ARRAY(
             SELECT a.attname::TEXT
             FROM unnest(c.conkey) AS key(attnum)
             JOIN pg_attribute a
               ON a.attrelid = c.conrelid AND a.attnum = key.attnum
             ORDER BY a.attname
           ) AS key_columns
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.teacher_subject_assignments')
      AND c.contype = 'u'
    UNION ALL
    SELECT index_class.relname AS object_name,
           pg_get_indexdef(i.indexrelid) AS definition,
           ARRAY(
             SELECT a.attname::TEXT
             FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinal)
             JOIN pg_attribute a
               ON a.attrelid = i.indrelid AND a.attnum = key.attnum
             WHERE key.ordinal <= i.indnkeyatts
             ORDER BY a.attname
           ) AS key_columns
    FROM pg_index i
    JOIN pg_class index_class ON index_class.oid = i.indexrelid
    WHERE i.indrelid = to_regclass('public.teacher_subject_assignments')
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid
      )
  ) unique_objects
  WHERE key_columns = ARRAY['class_id', 'school_id', 'subject_id', 'teacher_id']::TEXT[]
     OR object_name IN (
       'teacher_subject_assignments_school_id_teacher_id_subject_id_key',
       'teacher_subject_assignments_term_unique'
     )
`;

const LEGACY_TEACHER_SUBJECT_CONSTRAINT = 'teacher_subject_assignments_school_id_teacher_id_subject_id_key';
const TERM_TEACHER_SUBJECT_CONSTRAINT = 'teacher_subject_assignments_term_unique';
const LEGACY_TEACHER_SUBJECT_DEFINITION = 'UNIQUE (school_id, teacher_id, subject_id, class_id)';
const TERM_TEACHER_SUBJECT_DEFINITION =
  'UNIQUE (school_id, term_id, teacher_id, subject_id, class_id)';
const LEGACY_TEACHER_SUBJECT_COLUMNS = 'class_id,school_id,subject_id,teacher_id';
const TERM_TEACHER_SUBJECT_COLUMNS = 'class_id,school_id,subject_id,teacher_id,term_id';

const CLASS_AUDIT_DEFINITIONS_QUERY = `
  SELECT 'column:' || column_name AS object_name, data_type AS observed_definition,
         is_nullable AS observed_nullability, COALESCE(column_default, '') AS observed_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'class_configuration_audit'
    AND column_name IN ('class_id_snapshot', 'action')
  UNION ALL
  SELECT 'constraint:' || c.conname, pg_get_constraintdef(c.oid), '', ''
  FROM pg_constraint c
  WHERE c.conrelid = to_regclass('public.class_configuration_audit')
    AND c.conname = 'class_configuration_audit_action_check'
  UNION ALL
  SELECT 'policy:' || p.polname,
         CASE p.polcmd WHEN 'a' THEN 'INSERT' ELSE p.polcmd::TEXT END || '|' ||
           COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''),
         '', ''
  FROM pg_policy p
  WHERE p.polrelid = to_regclass('public.class_configuration_audit')
    AND p.polname = 'class_configuration_audit_teacher_insert'
  UNION ALL
  SELECT 'table_rls', 'enabled=' || c.relrowsecurity || ';forced=' || c.relforcerowsecurity, '', ''
  FROM pg_class c
  WHERE c.oid = to_regclass('public.class_configuration_audit')
    AND (
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'class_configuration_audit'
          AND column_name IN ('class_id_snapshot', 'action')
      )
      OR EXISTS (
        SELECT 1 FROM pg_constraint constraint_info
        WHERE constraint_info.conrelid = c.oid
          AND constraint_info.conname = 'class_configuration_audit_action_check'
      )
      OR EXISTS (
        SELECT 1 FROM pg_policy policy_info
        WHERE policy_info.polrelid = c.oid
          AND policy_info.polname = 'class_configuration_audit_teacher_insert'
      )
    )
`;

function loadMigrations(
  migrationsDirectory = path.join(__dirname, '../sql/migrations'),
  filenames = MIGRATION_FILES
) {
  return filenames.map((filename) => ({
    filename,
    migrationName: filename.replace(/\.sql$/, ''),
    sql: fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8'),
  }));
}

function normalizedColumns(columns) {
  return Array.isArray(columns) ? columns.map(String).sort().join(',') : '';
}

function assertTeacherSubjectConstraintDefinitions(rows, migrationApplied) {
  const termConstraint = rows.find(({ object_name }) => object_name === TERM_TEACHER_SUBJECT_CONSTRAINT);
  if (termConstraint && (
    termConstraint.definition !== TERM_TEACHER_SUBJECT_DEFINITION
    || normalizedColumns(termConstraint.key_columns) !== TERM_TEACHER_SUBJECT_COLUMNS
  )) {
    throw new Error(
      `Refusing timetable migration reconciliation: expected ${TERM_TEACHER_SUBJECT_CONSTRAINT} ` +
      `to be "${TERM_TEACHER_SUBJECT_DEFINITION}" with columns [${TERM_TEACHER_SUBJECT_COLUMNS}], ` +
      `observed "${termConstraint.definition}" with columns [${normalizedColumns(termConstraint.key_columns)}].`
    );
  }

  const legacyConstraints = rows.filter(({ key_columns, object_name }) => (
    normalizedColumns(key_columns) === LEGACY_TEACHER_SUBJECT_COLUMNS
    || object_name === LEGACY_TEACHER_SUBJECT_CONSTRAINT
  ));
  for (const constraint of legacyConstraints) {
    const isExpectedLegacyConstraint = constraint.object_name === LEGACY_TEACHER_SUBJECT_CONSTRAINT
      && constraint.definition === LEGACY_TEACHER_SUBJECT_DEFINITION
      && normalizedColumns(constraint.key_columns) === LEGACY_TEACHER_SUBJECT_COLUMNS;
    if (migrationApplied || !isExpectedLegacyConstraint) {
      throw new Error(
        `Refusing timetable migration reconciliation: expected no alternate legacy teacher-subject ` +
        `uniqueness after ${TERM_TEACHER_SUBJECT_CONSTRAINT} is applied, and only the known ` +
        `${LEGACY_TEACHER_SUBJECT_CONSTRAINT} definition "${LEGACY_TEACHER_SUBJECT_DEFINITION}" ` +
        `before it; observed "${constraint.object_name}" as "${constraint.definition}" with columns ` +
        `[${normalizedColumns(constraint.key_columns)}]. No unknown constraint or index was dropped.`
      );
    }
  }

  if (migrationApplied && !termConstraint) {
    throw new Error(
      `Refusing timetable migration reconciliation: ${TERM_TEACHER_SUBJECT_CONSTRAINT} is recorded ` +
      `as applied but is missing; expected "${TERM_TEACHER_SUBJECT_DEFINITION}", observed <missing>.`
    );
  }
}

function assertClassAuditDefinitions(rows, migrationApplied) {
  if (!migrationApplied) {
    if (rows.length) {
      const observed = rows.map(({ object_name, observed_definition }) => (
        `${object_name}="${observed_definition}"`
      )).join(', ');
      throw new Error(
        `Refusing timetable migration reconciliation: unrecorded ` +
        `20261128_class_configuration_audit_events definitions were observed (${observed}); ` +
        'no automatic baseline or migration skip is allowed.'
      );
    }
    return;
  }

  const byName = new Map(rows.map((row) => [row.object_name, row]));
  const assertions = [
    ['column:class_id_snapshot', 'integer', 'YES'],
    ['column:action', 'text', 'NO'],
  ];
  for (const [objectName, expectedType, expectedNullability] of assertions) {
    const observed = byName.get(objectName);
    if (!observed || observed.observed_definition !== expectedType
      || observed.observed_nullability !== expectedNullability) {
      throw new Error(
        `Refusing timetable migration reconciliation: expected ${objectName} to be ` +
        `${expectedType} NULLABLE=${expectedNullability}, observed ` +
        `${observed
          ? `${observed.observed_definition} NULLABLE=${observed.observed_nullability}`
          : '<missing>'}.`
      );
    }
  }

  const actionColumn = byName.get('column:action');
  if (!actionColumn.observed_default.includes('UPDATED')) {
    throw new Error(
      `Refusing timetable migration reconciliation: expected column:action default to contain UPDATED, ` +
      `observed "${actionColumn.observed_default}".`
    );
  }
  const actionConstraint = byName.get('constraint:class_configuration_audit_action_check');
  if (!actionConstraint || !['created', 'updated', 'deleted', 'action', 'check'].every((part) => (
    actionConstraint.observed_definition.toLowerCase().includes(part)
  ))) {
    throw new Error(
      `Refusing timetable migration reconciliation: expected class_configuration_audit_action_check ` +
      'to constrain action to CREATED, UPDATED, and DELETED, observed ' +
      `"${actionConstraint?.observed_definition || '<missing>'}".`
    );
  }
  const teacherInsertPolicy = byName.get('policy:class_configuration_audit_teacher_insert');
  if (!teacherInsertPolicy || !['insert', 'app.school_id', 'app.user_id', 'app.role', 'teacher'].every((part) => (
    teacherInsertPolicy.observed_definition.toLowerCase().includes(part)
  ))) {
    throw new Error(
      `Refusing timetable migration reconciliation: expected scoped teacher INSERT policy ` +
      'class_configuration_audit_teacher_insert, observed ' +
      `"${teacherInsertPolicy?.observed_definition || '<missing>'}".`
    );
  }
  const rls = byName.get('table_rls');
  if (!rls || rls.observed_definition !== 'enabled=true;forced=true') {
    throw new Error(
      `Refusing timetable migration reconciliation: expected forced row-level security on ` +
      `class_configuration_audit, observed "${rls?.observed_definition || '<missing>'}".`
    );
  }
}

async function assertKnownMigrationDefinitions(client, migrations, appliedNames) {
  const migrationName = '20261019_timetable_term_scope';
  if (migrations.some((migration) => migration.migrationName === migrationName)) {
    const result = await client.query(TEACHER_SUBJECT_UNIQUENESS_QUERY);
    assertTeacherSubjectConstraintDefinitions(
      result.rows,
      appliedNames.has(migrationName)
    );
  }

  const auditMigrationName = '20261128_class_configuration_audit_events';
  if (migrations.some((migration) => migration.migrationName === auditMigrationName)) {
    const result = await client.query(CLASS_AUDIT_DEFINITIONS_QUERY);
    assertClassAuditDefinitions(
      result.rows,
      appliedNames.has(auditMigrationName)
    );
  }
}

async function assertNoUntrackedTimetableSchema(client, migrations, appliedNames) {
  await assertKnownMigrationDefinitions(client, migrations, appliedNames);
  const migrationNames = new Set(migrations.map(({ migrationName }) => migrationName));
  let unrecordedSchemaObserved = false;
  for (const signature of LEGACY_SCHEMA_SIGNATURES) {
    if (!migrationNames.has(signature.migrationName) || appliedNames.has(signature.migrationName)) continue;
    const result = await client.query(signature.query);
    if (result.rows[0]?.exists) {
      unrecordedSchemaObserved = true;
    }
  }

  if (!unrecordedSchemaObserved) return;
  if ([...appliedNames].some((name) => PROTECTED_TIMETABLE_SEQUENCE.includes(name))) {
    throw new Error(
      'Refusing to migrate: protected schema exists with a partial protected ledger; manual reconciliation is required.'
    );
  }

  const fingerprint = await client.query(REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT_QUERY, [
    REVIEWED_DEVELOPMENT_RELATIONS,
    REVIEWED_DEVELOPMENT_FUNCTIONS,
  ]);
  if (fingerprint.rows[0]?.fingerprint !== REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT) {
    throw new Error(
      'Refusing to migrate: unrecorded schema differs from the exact reviewed development baseline.'
    );
  }

  const data = await client.query(REVIEWED_DEVELOPMENT_DATA_QUERY);
  const expectedData = {
    schools: '1', classes: '25', unassigned_classes: '25', null_year_classes: '25',
    legacy_teacher_classes: '0', assigned_class_teachers: '0', students: '343',
    unassigned_students: '343', students_without_class: '0', results: '0',
    history_rows: '343', active_history_rows: '343', timetable_rows: '0', term_rows: '0',
    version_rows: '0', weekly_requirement_rows: '0', generation_run_rows: '0', pathway_rows: '0',
  };
  const observedData = data.rows[0] || {};
  const dataMatches = Object.entries(expectedData).every(([key, value]) => (
    String(observedData[key]) === value
  ));
  if (!dataMatches) {
    throw new Error(
      'Refusing to migrate: development data aggregates differ from the reviewed preservation baseline.'
    );
  }
}

function assertCompleteTimetableSequence(migrations) {
  const names = migrations.map(({ migrationName }) => migrationName);
  const includesProtectedMigration = names.some((name) => PROTECTED_TIMETABLE_SEQUENCE.includes(name));
  if (!includesProtectedMigration) return;
  if (names.length !== PROTECTED_TIMETABLE_SEQUENCE.length
      || names.some((name, index) => name !== PROTECTED_TIMETABLE_SEQUENCE[index])) {
    throw new Error(
      'Refusing to migrate: timetable migrations must run through the complete protected sequence in dependency order.'
    );
  }
}

function assertResultSnapshotPrerequisiteOrder(migrations) {
  const positions = new Map(migrations.map(({ migrationName }, index) => [migrationName, index]));
  const snapshotPosition = positions.get('20261126_result_snapshot_insert_only');
  if (snapshotPosition === undefined) return;

  for (const prerequisite of RESULT_SNAPSHOT_PREREQUISITE_MIGRATIONS) {
    const prerequisitePosition = positions.get(prerequisite);
    if (prerequisitePosition === undefined || prerequisitePosition >= snapshotPosition) {
      throw new Error(
        `Refusing to migrate: ${prerequisite} must precede 20261126_result_snapshot_insert_only.`
      );
    }
  }

}

function assertMigrationLedgerConsistency(migrations, appliedNames) {
  const registeredNames = new Set(migrations.map(({ migrationName }) => migrationName));
  const unexpected = [...appliedNames].filter((name) => (
    PROTECTED_TIMETABLE_SEQUENCE.includes(name) && !registeredNames.has(name)
  ));
  if (unexpected.length) {
    throw new Error(
      `Refusing to migrate: protected migration ledger entries are absent from the registered sequence: ${unexpected.join(', ')}.`
    );
  }

  if (appliedNames.has('20261126_result_snapshot_insert_only')) {
    const missingPrerequisites = RESULT_SNAPSHOT_PREREQUISITE_MIGRATIONS
      .filter((name) => !appliedNames.has(name));
    if (missingPrerequisites.length) {
      throw new Error(
        `Refusing to migrate: result snapshot is recorded without its prerequisite migrations: ${missingPrerequisites.join(', ')}.`
      );
    }
  }
  if ([...appliedNames].some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error('Refusing to migrate: migration ledger contains an empty or invalid migration name.');
  }
}

async function applyMigrations(client, migrations, logger, target = APPROVED_DEVELOPMENT_TARGET) {
  const database = await client.query(
    'SELECT current_database() AS database_name, current_user AS role_name, session_user AS session_role'
  );
  const expectedDatabase = target.database || APPROVED_DATABASE;
  const expectedRole = target.migrationRole || 'neondb_owner';
  if (database.rows[0]?.database_name !== expectedDatabase) {
    throw new Error('Refusing to migrate: connected database does not match the approved development database.');
  }
  if (database.rows[0]?.role_name !== expectedRole
      || database.rows[0]?.session_role !== expectedRole) {
    throw new Error('Refusing to migrate: connection role must be the explicitly approved migration owner.');
  }

  const migrationNames = migrations.map(({ migrationName }) => migrationName);
  if (new Set(migrationNames).size !== migrationNames.length) {
    throw new Error('Refusing to migrate: migration list contains duplicate names.');
  }

  if (migrationNames.includes('20261126_result_snapshot_insert_only')) {
    const prerequisites = await client.query(RESULT_SNAPSHOT_EXTERNAL_PREREQUISITES_QUERY);
    if (!prerequisites.rows[0]?.ready) {
      throw new Error(
        'Refusing to migrate: 20261113_student_portal must provide results.class_id and results.curriculum first.'
      );
    }
  }

  await client.query('SELECT pg_advisory_lock(hashtext($1))', [SCHEMA_MIGRATION_LOCK_NAME]);
  let transactionOpen = false;
  const rollback = async () => {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      logger.error('Unable to roll back the subject/timetable migration transaction:', error.message);
    }
    transactionOpen = false;
  };
  try {
    const ledgerTable = await client.query("SELECT to_regclass('public.app_schema_migrations') AS table_name");
    const appliedNames = new Set();
    if (ledgerTable.rows[0]?.table_name) {
      const appliedRows = await client.query('SELECT migration_name FROM public.app_schema_migrations');
      for (const row of appliedRows.rows) appliedNames.add(row.migration_name);
    }
    await assertNoUntrackedTimetableSchema(client, migrations, appliedNames);
    assertMigrationLedgerConsistency(migrations, appliedNames);

    await client.query('BEGIN');
    transactionOpen = true;
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
          migration_name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query('COMMIT');
      transactionOpen = false;
    } catch (error) {
      await rollback();
      throw error;
    }

    for (const migration of migrations) {
      await client.query('BEGIN');
      transactionOpen = true;
      try {
        const applied = await client.query(
          'SELECT 1 FROM public.app_schema_migrations WHERE migration_name = $1',
          [migration.migrationName]
        );
        if (applied.rowCount) {
          await client.query('COMMIT');
          transactionOpen = false;
          logger.log(`Skipping ${migration.filename}; it is already recorded.`);
          continue;
        }

        await client.query(migration.sql);
        await client.query(
          'INSERT INTO public.app_schema_migrations (migration_name) VALUES ($1)',
          [migration.migrationName]
        );
        await client.query('COMMIT');
        transactionOpen = false;
        logger.log(`Applied ${migration.filename}.`);
      } catch (error) {
        if (transactionOpen) await rollback();
        throw error;
      }
    }
  } finally {
    if (transactionOpen) await rollback();
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [SCHEMA_MIGRATION_LOCK_NAME]);
    } catch (error) {
      logger.error('Unable to release the subject/timetable migration lock:', error.message);
    }
  }
}

async function executeMigrations({
  env = process.env,
  poolFactory = (options) => new Pool(options),
  migrations = loadMigrations(),
  logger = console,
} = {}) {
  const target = assertSafeMigrationTarget(env);
  assertCompleteTimetableSequence(migrations);
  assertResultSnapshotPrerequisiteOrder(migrations);
  const pool = poolFactory({ connectionString: env.DATABASE_URL_UNPOOLED });
  let client;
  try {
    client = await pool.connect();
    logger.log(`Verified development target ${target.branchName} (${target.branchId}).`);
    await applyMigrations(client, migrations, logger, target);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

async function main() {
  await require('./migrate_timetable').main();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Timetable migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  APPROVED_DATABASE,
  REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT,
  REVIEWED_DEVELOPMENT_SCHEMA_FINGERPRINT_QUERY,
  REVIEWED_DEVELOPMENT_DATA_QUERY,
  REVIEWED_DEVELOPMENT_RELATIONS,
  REVIEWED_DEVELOPMENT_FUNCTIONS,
  assertSafeMigrationTarget,
  executeMigrations,
  loadMigrations,
  assertNoUntrackedTimetableSchema,
  assertCompleteTimetableSequence,
  assertResultSnapshotPrerequisiteOrder,
  assertMigrationLedgerConsistency,
  assertTeacherSubjectConstraintDefinitions,
  assertClassAuditDefinitions,
  assertKnownMigrationDefinitions,
  main,
};
