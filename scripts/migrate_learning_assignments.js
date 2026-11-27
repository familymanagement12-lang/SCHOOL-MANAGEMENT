const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  APPROVED_DEVELOPMENT_TARGET,
  SCHEMA_MIGRATION_LOCK_NAME,
  assertSafeMigrationTarget,
  assertConnectedMigrationIdentity,
  withMigrationLock,
  runSqlTransaction,
  removeFileTransactionEnvelope,
} = require('./migrationSafety');

const MIGRATION_NAME = '20261126_learning_assignments';
const MIGRATION_FILE = '20261126_learning_assignments.sql';
const ASSIGNMENT_TABLES = Object.freeze([
  'learning_assignments', 'assignment_recipients', 'assignment_submissions',
  'assignment_submission_versions', 'assignment_attachments',
  'assignment_submission_files', 'assignment_marks', 'assignment_audit_log',
]);

const EXPECTED_COLUMNS = Object.freeze({
  learning_assignments: ['id:int8:NO','school_id:int4:NO','teacher_id:int4:NO','class_id:int4:NO','subject_id:int4:NO','academic_year:text:NO','term:text:NO','term_id:int4:NO','title:text:NO','instructions:text:NO','category:text:NO','issue_at:timestamptz:YES','due_at:timestamptz:NO','total_marks:numeric:NO','submission_method:text:NO','allow_late:bool:NO','allow_resubmission:bool:NO','status:text:NO','published_at:timestamptz:YES','closed_at:timestamptz:YES','created_at:timestamptz:NO','updated_at:timestamptz:NO'],
  assignment_recipients: ['id:int8:NO','school_id:int4:NO','assignment_id:int8:NO','class_id:int4:NO','student_id:int4:NO','assigned_at:timestamptz:NO'],
  assignment_submissions: ['id:int8:NO','school_id:int4:NO','assignment_id:int8:NO','recipient_id:int8:NO','student_id:int4:NO','status:text:NO','draft_answer:text:NO','viewed_at:timestamptz:YES','latest_version:int4:NO','submitted_at:timestamptz:YES','updated_at:timestamptz:NO'],
  assignment_submission_versions: ['id:int8:NO','school_id:int4:NO','submission_id:int8:NO','version_number:int4:NO','answer:text:NO','submitted_at:timestamptz:NO','is_late:bool:NO','created_at:timestamptz:NO'],
  assignment_attachments: ['id:int8:NO','school_id:int4:NO','assignment_id:int8:NO','storage_key:text:NO','original_name:text:NO','content_type:text:NO','file_size:int8:NO','uploaded_by:int4:NO','created_at:timestamptz:NO'],
  assignment_submission_files: ['id:int8:NO','school_id:int4:NO','assignment_id:int8:NO','submission_id:int8:NO','version_id:int8:YES','storage_key:text:NO','original_name:text:NO','content_type:text:NO','file_size:int8:NO','uploaded_at:timestamptz:NO'],
  assignment_marks: ['id:int8:NO','school_id:int4:NO','assignment_id:int8:NO','submission_id:int8:NO','version_id:int8:NO','revision:int4:NO','marked_by:int4:NO','score:numeric:NO','feedback:text:NO','private_notes:text:NO','status:text:NO','created_at:timestamptz:NO'],
  assignment_audit_log: ['id:int8:NO','school_id:int4:NO','assignment_id:int8:NO','actor_id:int4:NO','action:text:NO','details:jsonb:NO','created_at:timestamptz:NO'],
});

const EXPECTED_CONSTRAINT_COUNTS = Object.freeze({
  assignment_attachments: [1, 2, 1, 1],
  assignment_audit_log: [1, 3, 0, 1],
  assignment_marks: [1, 3, 1, 3],
  assignment_recipients: [1, 3, 2, 0],
  assignment_submission_files: [1, 2, 1, 1],
  assignment_submission_versions: [1, 1, 3, 1],
  assignment_submissions: [1, 2, 3, 2],
  learning_assignments: [1, 5, 2, 6],
});

const EXPECTED_INDEX_COUNTS = Object.freeze({
  assignment_attachments: 2,
  assignment_audit_log: 2,
  assignment_marks: 3,
  assignment_recipients: 4,
  assignment_submission_files: 3,
  assignment_submission_versions: 5,
  assignment_submissions: 4,
  learning_assignments: 5,
});

const EXPECTED_LOOKUP_INDEXES = Object.freeze({
  learning_assignments_teacher_term_idx: ['school_id','teacher_id','term_id','status','due_at'],
  learning_assignments_class_term_idx: ['school_id','class_id','term_id','status','due_at'],
  assignment_recipients_student_idx: ['school_id','student_id','assignment_id'],
  assignment_submission_versions_latest_idx: ['school_id','submission_id','version_number DESC'],
  assignment_submission_files_lookup_idx: ['school_id','assignment_id','submission_id','version_id'],
  assignment_marks_submission_idx: ['school_id','submission_id','revision DESC'],
  assignment_audit_log_history_idx: ['school_id','assignment_id','created_at DESC'],
});
const TIMETABLE_TERM_UNIQUE_INDEXES = Object.freeze({
  timetable_terms_school_year_term_id_unique_idx: 'CREATE UNIQUE INDEX timetable_terms_school_year_term_id_unique_idx ON public.timetable_terms USING btree (school_id, academic_year, term, id)',
  idx_timetable_terms_scope_ref: 'CREATE UNIQUE INDEX idx_timetable_terms_scope_ref ON public.timetable_terms USING btree (school_id, academic_year, term, id)',
});

const REQUIRED_CHECKS = Object.freeze([
  'learning_assignments_title_check','learning_assignments_instructions_check',
  'learning_assignments_category_check','learning_assignments_total_marks_check',
  'learning_assignments_submission_method_check','learning_assignments_status_check',
  'assignment_submissions_status_check','assignment_submissions_latest_version_check',
  'assignment_submission_versions_version_number_check','assignment_attachments_file_size_check',
  'assignment_submission_files_file_size_check','assignment_marks_revision_check',
  'assignment_marks_score_check','assignment_marks_status_check','assignment_audit_log_action_check',
]);

const EXPECTED_FOREIGN_KEY_DEFINITIONS = Object.freeze({
  learning_assignments_school_id_fkey: 'foreign key (school_id) references schools(id) on delete cascade',
  learning_assignments_school_id_teacher_id_fkey: 'foreign key (school_id, teacher_id) references users(school_id, id) on delete restrict',
  learning_assignments_school_id_class_id_fkey: 'foreign key (school_id, class_id) references classes(school_id, id) on delete restrict',
  learning_assignments_school_id_subject_id_fkey: 'foreign key (school_id, subject_id) references subjects(school_id, id) on delete restrict',
  learning_assignments_school_id_academic_year_term_term_id_fkey: 'foreign key (school_id, academic_year, term, term_id) references timetable_terms(school_id, academic_year, term, id) on delete restrict',
  assignment_recipients_school_id_assignment_id_class_id_fkey: 'foreign key (school_id, assignment_id, class_id) references learning_assignments(school_id, id, class_id) on delete restrict',
  assignment_recipients_school_id_class_id_fkey: 'foreign key (school_id, class_id) references classes(school_id, id) on delete restrict',
  assignment_recipients_school_id_student_id_fkey: 'foreign key (school_id, student_id) references students(school_id, id) on delete restrict',
  assignment_submissions_school_id_assignment_id_recipient_i_fkey: 'foreign key (school_id, assignment_id, recipient_id) references assignment_recipients(school_id, assignment_id, id) on delete restrict',
  assignment_submissions_school_id_assignment_id_student_id_fkey: 'foreign key (school_id, assignment_id, student_id) references assignment_recipients(school_id, assignment_id, student_id) on delete restrict',
  assignment_submission_versions_school_id_submission_id_fkey: 'foreign key (school_id, submission_id) references assignment_submissions(school_id, id) on delete restrict',
  assignment_attachments_school_id_assignment_id_fkey: 'foreign key (school_id, assignment_id) references learning_assignments(school_id, id) on delete restrict',
  assignment_attachments_school_id_uploaded_by_fkey: 'foreign key (school_id, uploaded_by) references users(school_id, id) on delete restrict',
  assignment_submission_files_school_id_assignment_id_submiss_fkey: 'foreign key (school_id, assignment_id, submission_id) references assignment_submissions(school_id, assignment_id, id) on delete restrict',
  assignment_submission_files_school_id_version_id_submissio_fkey: 'foreign key (school_id, version_id, submission_id) references assignment_submission_versions(school_id, id, submission_id) on delete restrict',
  assignment_marks_school_id_assignment_id_submission_id_fkey: 'foreign key (school_id, assignment_id, submission_id) references assignment_submissions(school_id, assignment_id, id) on delete restrict',
  assignment_marks_school_id_version_id_submission_id_fkey: 'foreign key (school_id, version_id, submission_id) references assignment_submission_versions(school_id, id, submission_id) on delete restrict',
  assignment_marks_school_id_marked_by_fkey: 'foreign key (school_id, marked_by) references users(school_id, id) on delete restrict',
  assignment_audit_log_school_id_assignment_id_fkey: 'foreign key (school_id, assignment_id) references learning_assignments(school_id, id) on delete restrict',
  assignment_audit_log_school_id_actor_id_fkey: 'foreign key (school_id, actor_id) references users(school_id, id) on delete restrict',
  assignment_audit_log_school_id_fkey: 'foreign key (school_id) references schools(id) on delete cascade',
});

const EXPECTED_UNIQUE_DEFINITIONS = Object.freeze({
  learning_assignments_school_id_id_key: 'unique (school_id, id)',
  learning_assignments_school_id_id_class_id_key: 'unique (school_id, id, class_id)',
  assignment_recipients_school_id_assignment_id_student_id_key: 'unique (school_id, assignment_id, student_id)',
  assignment_recipients_school_id_assignment_id_id_key: 'unique (school_id, assignment_id, id)',
  assignment_submissions_school_id_id_key: 'unique (school_id, id)',
  assignment_submissions_school_id_assignment_id_student_id_key: 'unique (school_id, assignment_id, student_id)',
  assignment_submissions_school_id_assignment_id_id_key: 'unique (school_id, assignment_id, id)',
  assignment_submission_versions_school_id_id_key: 'unique (school_id, id)',
  assignment_submission_versions_school_id_id_submission_id_key: 'unique (school_id, id, submission_id)',
  assignment_submission_version_school_id_submission_id_versi_key: 'unique (school_id, submission_id, version_number)',
  assignment_attachments_storage_key_key: 'unique (storage_key)',
  assignment_submission_files_storage_key_key: 'unique (storage_key)',
  assignment_marks_school_id_submission_id_revision_key: 'unique (school_id, submission_id, revision)',
});

function normalizeCatalogDefinition(definition) {
  return String(definition || '').toLowerCase().replaceAll('"', '').replace(/\s+/g, ' ').trim();
}

const REQUIRED_POLICY = (table) => `${table}_school_scope`;

async function assertAssignmentPrerequisites(client) {
  const result = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name = ANY($1::text[])
  `, [[
    'schools','users','classes','subjects','students','timetable_terms',
  ]]);
  const columns = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const required = [
    'schools.id', 'users.id','users.school_id', 'classes.id','classes.school_id',
    'subjects.id','subjects.school_id', 'students.id','students.school_id',
    'timetable_terms.id','timetable_terms.school_id','timetable_terms.academic_year','timetable_terms.term',
  ];
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length) {
    throw new Error(`Refusing learning assignments migration: missing prerequisites: ${missing.join(', ')}.`);
  }
}

async function assertAssignmentSchemaPostconditions(client, { requireLedger = true } = {}) {
  const relations = (await client.query(`
    SELECT c.relname, c.relowner::regrole::text AS owner,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
  `, [ASSIGNMENT_TABLES])).rows;
  const relationByName = new Map(relations.map((row) => [row.relname, row]));
  const missingTables = ASSIGNMENT_TABLES.filter((name) => !relationByName.has(name));
  if (missingTables.length) throw new Error(`Learning assignments schema drift: missing tables: ${missingTables.join(', ')}.`);
  for (const table of ASSIGNMENT_TABLES) {
    const relation = relationByName.get(table);
    if (relation.owner !== APPROVED_DEVELOPMENT_TARGET.role || !relation.rls || !relation.force_rls) {
      throw new Error(`Learning assignments schema drift: ${table} must be owner-owned with forced RLS.`);
    }
  }

  const columnRows = (await client.query(`
    SELECT table_name,column_name,udt_name,is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=ANY($1::text[])
  `, [ASSIGNMENT_TABLES])).rows;
  for (const [table, definitions] of Object.entries(EXPECTED_COLUMNS)) {
    const found = columnRows.filter((column) => column.table_name === table);
    const expected = definitions.map((definition) => {
      const [name, type, nullable] = definition.split(':');
      return `${name}:${type}:${nullable}`;
    }).sort();
    const actual = found.map((column) => `${column.column_name}:${column.udt_name}:${column.is_nullable}`).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Learning assignments schema drift: columns or types differ on ${table}.`);
    }
  }

  const constraints = (await client.query(`
    SELECT x.conname,x.contype,r.relname AS table_name,
           pg_get_constraintdef(x.oid,true) AS definition
    FROM pg_constraint x
    JOIN pg_class r ON r.oid=x.conrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='public' AND r.relname=ANY($1::text[])
  `, [ASSIGNMENT_TABLES])).rows;
  const perTable = (await client.query(`
    SELECT t.relname,count(*) FILTER(WHERE x.contype='p')::int AS p,
      count(*) FILTER(WHERE x.contype='f')::int AS f,
      count(*) FILTER(WHERE x.contype='u')::int AS u,
      count(*) FILTER(WHERE x.contype='c')::int AS c
    FROM unnest($1::text[]) t(relname)
    LEFT JOIN pg_class r ON r.relname=t.relname AND r.relnamespace='public'::regnamespace
    LEFT JOIN pg_constraint x ON x.conrelid=r.oid
    GROUP BY t.relname
  `, [ASSIGNMENT_TABLES])).rows;
  for (const row of perTable) {
    const expected = EXPECTED_CONSTRAINT_COUNTS[row.relname];
    if (!expected || [row.p,row.f,row.u,row.c].some((count, i) => count !== expected[i])) {
      throw new Error(`Learning assignments schema drift: constraint set differs on ${row.relname}.`);
    }
  }
  const constraintNames = new Set(constraints.map((row) => row.conname));
  const missingConstraints = REQUIRED_CHECKS.filter((name) => !constraintNames.has(name));
  if (missingConstraints.length) throw new Error(`Learning assignments schema drift: missing constraints: ${missingConstraints.join(', ')}.`);
  for (const row of constraints.filter((constraint) => constraint.contype === 'p')) {
    if (normalizeCatalogDefinition(row.definition) !== 'primary key (id)') {
      throw new Error(`Learning assignments schema drift: primary key definition differs on ${row.table_name}.`);
    }
  }
  const actualForeignKeys = constraints.filter((row) => row.contype === 'f')
    .map((row) => normalizeCatalogDefinition(row.definition)).sort();
  const expectedForeignKeys = Object.values(EXPECTED_FOREIGN_KEY_DEFINITIONS).sort();
  if (JSON.stringify(actualForeignKeys) !== JSON.stringify(expectedForeignKeys)) {
    throw new Error('Learning assignments schema drift: foreign key definitions differ.');
  }
  const actualUniques = constraints.filter((row) => row.contype === 'u')
    .map((row) => normalizeCatalogDefinition(row.definition)).sort();
  const expectedUniques = Object.values(EXPECTED_UNIQUE_DEFINITIONS).sort();
  if (JSON.stringify(actualUniques) !== JSON.stringify(expectedUniques)) {
    throw new Error('Learning assignments schema drift: unique constraint definitions differ.');
  }

  const indexes = (await client.query(`
    SELECT pi.tablename,pi.indexname,pi.indexdef,i.indisunique,i.indisvalid,i.indisready
    FROM pg_indexes pi
    JOIN pg_class ic ON ic.relname=pi.indexname
    JOIN pg_namespace ns ON ns.oid=ic.relnamespace AND ns.nspname=pi.schemaname
    JOIN pg_index i ON i.indexrelid=ic.oid
    WHERE pi.schemaname='public' AND pi.tablename=ANY($1::text[])
  `, [[...ASSIGNMENT_TABLES, 'timetable_terms']])).rows;
  const indexCount = new Map();
  for (const index of indexes) indexCount.set(index.tablename, (indexCount.get(index.tablename) || 0) + 1);
  for (const [table, expected] of Object.entries(EXPECTED_INDEX_COUNTS)) {
    if (indexCount.get(table) !== expected) throw new Error(`Learning assignments schema drift: index count differs on ${table}.`);
  }
  for (const [name, columns] of Object.entries(EXPECTED_LOOKUP_INDEXES)) {
    const index = indexes.find((item) => item.indexname === name);
    const normalizedDefinition = normalizeCatalogDefinition(index?.indexdef);
    const normalizedColumns = columns.join(', ').toLowerCase();
    if (!index
        || index.indisvalid !== true || index.indisready !== true
        || !normalizedDefinition.includes(`using btree (${normalizedColumns})`)
        ) {
      throw new Error(`Learning assignments schema drift: index ${name} is missing or differs.`);
    }
  }
  const timetableTermIndexes = indexes.filter((index) => Object.hasOwn(TIMETABLE_TERM_UNIQUE_INDEXES,index.indexname));
  if (!timetableTermIndexes.length || timetableTermIndexes.some((index) =>
    normalizeCatalogDefinition(index.indexdef) !== normalizeCatalogDefinition(TIMETABLE_TERM_UNIQUE_INDEXES[index.indexname])
      || index.indisunique !== true || index.indisvalid !== true || index.indisready !== true)) {
    throw new Error('Learning assignments schema drift: timetable-term unique index is missing or differs from both approved migration definitions.');
  }

  const policies = (await client.query(`
    SELECT tablename,policyname,roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])
  `, [ASSIGNMENT_TABLES])).rows;
  const hasRoleScopedAuthorization = policies.some((policy) => policy.policyname === 'learning_assignments_staff_scope');
  const expectedRolePolicies = {
    learning_assignments: ['learning_assignments_staff_scope','learning_assignments_student_read','learning_assignments_parent_read'],
    assignment_recipients: ['assignment_recipients_staff_scope','assignment_recipients_student_read','assignment_recipients_parent_read'],
    assignment_submissions: ['assignment_submissions_staff_scope','assignment_submissions_student_read','assignment_submissions_parent_read','assignment_submissions_student_update'],
    assignment_submission_versions: ['assignment_submission_versions_staff_scope','assignment_submission_versions_student_read','assignment_submission_versions_student_insert'],
    assignment_attachments: ['assignment_attachments_staff_scope','assignment_attachments_student_read'],
    assignment_submission_files: ['assignment_submission_files_staff_scope','assignment_submission_files_student_read','assignment_submission_files_student_insert','assignment_submission_files_student_update'],
    assignment_marks: ['assignment_marks_staff_scope','assignment_marks_student_read','assignment_marks_parent_read'],
    assignment_audit_log: ['assignment_audit_log_staff_read','assignment_audit_log_staff_insert','assignment_audit_log_student_insert'],
  };
  for (const table of ASSIGNMENT_TABLES) {
    const matches = policies.filter((policy) => policy.tablename === table);
    if (hasRoleScopedAuthorization) {
      const expectedNames = expectedRolePolicies[table];
      if (matches.length !== expectedNames.length
          || expectedNames.some((name) => !matches.some((policy) => policy.policyname === name))) {
        throw new Error(`Learning assignments schema drift: role authorization policies differ on ${table}.`);
      }
    } else if (matches.length !== 1
        || matches[0].policyname !== REQUIRED_POLICY(table)
        || matches[0].cmd !== 'ALL'
        || !matches[0].roles.includes('public')
        || !matches[0].qual?.includes("current_setting('app.school_id'")
        || matches[0].qual !== matches[0].with_check) {
      throw new Error(`Learning assignments schema drift: ${table} does not match its known school-scope RLS policy.`);
    }
  }

  if (requireLedger) {
    const recorded = await client.query(
      'SELECT 1 FROM public.app_schema_migrations WHERE migration_name=$1', [MIGRATION_NAME]
    );
    if (!recorded.rowCount) throw new Error('Learning assignments schema drift: migration ledger entry is missing.');
  }
  return true;
}

async function runLearningAssignmentsMigration({
  env = process.env,
  poolFactory = (options) => new Pool(options),
  migrationsDirectory = path.join(__dirname, '../sql/migrations'),
  logger = console,
} = {}) {
  return withMigrationLock({ env, poolFactory, logger, action: async (client) => {
    await assertAssignmentPrerequisites(client);
    const ledger = await client.query("SELECT to_regclass('public.app_schema_migrations') AS table_name");
    let recorded = false;
    if (ledger.rows[0]?.table_name) {
      const result = await client.query('SELECT 1 FROM public.app_schema_migrations WHERE migration_name=$1', [MIGRATION_NAME]);
      recorded = result.rowCount > 0;
    }
    if (recorded) {
      await assertAssignmentSchemaPostconditions(client);
      logger.log('Learning assignments migration is recorded and its schema postconditions match.');
      return { applied: false, verified: true };
    }

    const anyAssignmentObject = await client.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) LIMIT 1
    `, [ASSIGNMENT_TABLES]);
    if (anyAssignmentObject.rowCount) {
      throw new Error('Refusing learning assignments migration: unrecorded assignment schema exists; manual reconciliation is required.');
    }

    const sql = fs.readFileSync(path.join(migrationsDirectory, MIGRATION_FILE), 'utf8');
    await runSqlTransaction(client, async () => {
      await client.query(removeFileTransactionEnvelope(sql));
      await assertAssignmentSchemaPostconditions(client);
    });
    logger.log('Learning assignments migration applied and schema postconditions verified.');
    return { applied: true, verified: true };
  } });
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
  const target = assertSafeMigrationTarget(process.env);
  console.log(`Verified development target ${target.branchName} (${target.branchId}).`);
  await runLearningAssignmentsMigration();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Learning assignments migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  APPROVED_DEVELOPMENT_TARGET,
  SCHEMA_MIGRATION_LOCK_NAME,
  ASSIGNMENT_TABLES,
  EXPECTED_INDEX_COUNTS,
  EXPECTED_LOOKUP_INDEXES,
  TIMETABLE_TERM_UNIQUE_INDEXES,
  assertSafeMigrationTarget,
  assertConnectedMigrationIdentity,
  assertAssignmentPrerequisites,
  assertAssignmentSchemaPostconditions,
  runLearningAssignmentsMigration,
  main,
};
