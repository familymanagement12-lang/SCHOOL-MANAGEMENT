require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const {
  withMigrationLock,
  runSqlTransaction,
  removeFileTransactionEnvelope,
} = require('./migrationSafety');
const { assertAssignmentSchemaPostconditions } = require('./migrate_learning_assignments');
const {
  normalizeSqlDefinition,
  authorizationPolicies,
  learningMaterialsPolicies,
  staffScopeFunctionBody,
  MATERIAL_CONSTRAINTS,
  MATERIAL_INDEXES,
} = require('./learningPlatformDefinitions');

const FOLLOW_UP_MIGRATIONS = Object.freeze([
  // These were future-dated for 2026-11-29 without a documented release date.
  // Use the 2026-11-27 remediation date; dependency order remains explicit here.
  { name: '20261127_assignment_database_authorization', file: '20261127_assignment_database_authorization.sql' },
  { name: '20261127_learning_materials', file: '20261127_learning_materials.sql' },
]);
const MATERIAL_TABLES = ['learning_materials','learning_material_files'];
const RUNTIME_ROLE = 'mccarthy_runtime_70aef860';

async function getRecordedMigrations(client) {
  const table = await client.query("SELECT to_regclass('public.app_schema_migrations') AS relation");
  if (!table.rows[0]?.relation) throw new Error('Refusing learning platform migration: assignment migration ledger is missing.');
  const rows = await client.query(
    'SELECT migration_name FROM public.app_schema_migrations WHERE migration_name=ANY($1::text[])',
    [FOLLOW_UP_MIGRATIONS.map(({ name }) => name)]
  );
  return new Set(rows.rows.map((row) => row.migration_name));
}
async function assertAuthorizationPostconditions(client) {
  const relations = (await client.query(`
    SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
  `, [['learning_assignments','assignment_recipients','assignment_submissions',
    'assignment_submission_versions','assignment_attachments','assignment_submission_files',
    'assignment_marks','assignment_audit_log','assignment_mark_private_notes']])).rows;
  if (relations.length !== 9 || relations.some((row) => !row.relrowsecurity || !row.relforcerowsecurity
      || row.owner !== 'neondb_owner')) {
    throw new Error('Assignment authorization postcondition failed: expected owner-owned forced-RLS tables.');
  }
  const fn = await client.query(`
    SELECT p.prosecdef,p.proconfig,p.prosrc,p.proowner::regrole::text AS owner,l.lanname,p.provolatile FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND p.proname='assignment_staff_scope'
  `);
  if (fn.rowCount !== 1 || fn.rows[0].prosecdef
      || fn.rows[0].owner !== 'neondb_owner'
      || fn.rows[0].lanname !== 'sql' || fn.rows[0].provolatile !== 's'
      || normalizeSqlDefinition(fn.rows[0].prosrc) !== normalizeSqlDefinition(staffScopeFunctionBody)
      || !fn.rows[0].proconfig?.some((setting) => setting.replaceAll('"','').toLowerCase() === 'search_path=pg_catalog, public')) {
    throw new Error('Assignment authorization postcondition failed: staff-scope function is missing or unexpectedly elevated.');
  }
  const policies = (await client.query(`
    SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname='public'
      AND tablename=ANY($1::text[])
  `, [['learning_assignments','assignment_recipients','assignment_submissions',
    'assignment_submission_versions','assignment_attachments','assignment_submission_files',
    'assignment_marks','assignment_audit_log','assignment_mark_private_notes']])).rows;
  assertExactPolicies(policies, authorizationPolicies, 'Assignment authorization');
  const grants = (await client.query(`
    SELECT
      (has_table_privilege($1,'public.learning_assignments','SELECT')
        AND has_table_privilege($1,'public.learning_assignments','INSERT')
        AND has_table_privilege($1,'public.learning_assignments','UPDATE')) AS assignments,
      (has_table_privilege($1,'public.assignment_submissions','SELECT')
        AND has_table_privilege($1,'public.assignment_submissions','INSERT')
        AND has_table_privilege($1,'public.assignment_submissions','UPDATE')) AS submissions,
      has_column_privilege($1,'public.assignment_marks','score','SELECT') AS mark_read,
      has_column_privilege($1,'public.assignment_marks','score','INSERT') AS mark_insert,
      has_column_privilege($1,'public.assignment_marks','private_notes','SELECT') AS private_note_column_read,
      (has_table_privilege($1,'public.assignment_mark_private_notes','SELECT')
        AND has_table_privilege($1,'public.assignment_mark_private_notes','INSERT')) AS private_notes,
      has_sequence_privilege($1,'public.learning_assignments_id_seq','USAGE') AS assignment_sequence,
      has_function_privilege($1,'public.assignment_staff_scope(integer,integer,integer,integer,integer)','EXECUTE') AS staff_scope_execute
  `, [RUNTIME_ROLE])).rows[0];
  if (!grants || grants.mark_read !== true || grants.mark_insert !== true
      || grants.private_note_column_read !== false || grants.private_notes !== true
      || grants.assignment_sequence !== true || grants.staff_scope_execute !== true) {
    throw new Error('Assignment authorization postcondition failed: runtime DML grants are missing.');
  }
  await assertExactRuntimePrivileges(client, { includeAuthorization: true, includeMaterials: false });
  await assertFunctionPrivileges(client);
  await assertPrivateNotesConstraints(client);
}

function assertExactPolicies(actual, expected, label) {
  const expectedByName = new Map(expected.map((policy) => [policy.policyname, policy]));
  if (actual.length !== expected.length) {
    throw new Error(`${label} postcondition failed: expected ${expected.length} policies, found ${actual.length}.`);
  }
  for (const policy of actual) {
    const wanted = expectedByName.get(policy.policyname);
    if (!wanted) throw new Error(`${label} postcondition failed: unexpected policy ${policy.policyname}.`);
    const catalogRoles = Array.isArray(policy.roles) ? policy.roles
      : typeof policy.roles === 'string' ? policy.roles.replace(/^\{|\}$/g, '').split(',').filter(Boolean) : [];
    const actualRoles = catalogRoles.map((role) => String(role).replace(/^"|"$/g,'').toLowerCase()).sort();
    const wantedRoles = [...wanted.roles].sort();
    const sameExpression = (left, right) => left === null || right === null
      ? left === right
      : normalizeSqlDefinition(left) === normalizeSqlDefinition(right);
    const mismatches = [];
    if (policy.tablename !== wanted.tablename) mismatches.push('table');
    if (String(policy.cmd).toUpperCase() !== wanted.cmd) mismatches.push('command');
    if (String(policy.permissive).toUpperCase() !== wanted.permissive) mismatches.push('permissive mode');
    if (JSON.stringify(actualRoles) !== JSON.stringify(wantedRoles)) mismatches.push('roles');
    if (!sameExpression(policy.qual, wanted.qual)) mismatches.push('USING');
    if (!sameExpression(policy.with_check, wanted.with_check)) mismatches.push('WITH CHECK');
    if (mismatches.length) {
      const details = [];
      if (mismatches.includes('USING')) details.push(`USING expected=${normalizeSqlDefinition(wanted.qual)} actual=${normalizeSqlDefinition(policy.qual)}`);
      if (mismatches.includes('WITH CHECK')) details.push(`WITH CHECK expected=${normalizeSqlDefinition(wanted.with_check)} actual=${normalizeSqlDefinition(policy.with_check)}`);
      throw new Error(`${label} postcondition failed: ${mismatches.join(', ')} differs for policy ${policy.policyname}.${details.length ? ` ${details.join('; ')}` : ''}`);
    }
  }
}

async function assertFunctionPrivileges(client) {
  const grants = (await client.query(`
    SELECT CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE acl.grantee::regrole::text END AS grantee,
      acl.privilege_type,acl.is_grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
    WHERE n.nspname='public' AND p.proname='assignment_staff_scope'
  `)).rows;
  const runtime = grants.filter((grant) => grant.grantee === RUNTIME_ROLE);
  const unexpected = grants.filter((grant) => ![RUNTIME_ROLE,'neondb_owner'].includes(grant.grantee));
  if (grants.some((grant) => grant.grantee === 'PUBLIC') || unexpected.length
      || runtime.length !== 1 || runtime[0].privilege_type !== 'EXECUTE' || runtime[0].is_grantable !== false) {
    throw new Error('Assignment authorization postcondition failed: function EXECUTE grants differ (PUBLIC execute is prohibited).');
  }
}

async function assertPrivateNotesConstraints(client) {
  const result = await client.query(`
    SELECT conname,pg_get_constraintdef(oid,true) AS definition
    FROM pg_constraint WHERE conrelid='public.assignment_mark_private_notes'::regclass AND contype<>'n'
  `);
  const expected = {
    assignment_mark_private_notes_pkey: 'PRIMARY KEY (mark_id)',
    assignment_mark_private_notes_mark_id_fkey:
      'FOREIGN KEY (mark_id) REFERENCES assignment_marks(id) ON DELETE RESTRICT',
  };
  assertExactDefinitions(result.rows, expected, 'Assignment private-notes constraints');
  const indexes = (await client.query(`SELECT indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename='assignment_mark_private_notes'`)).rows;
  const expectedIndexes = {
    assignment_mark_private_notes_pkey:
      'CREATE UNIQUE INDEX assignment_mark_private_notes_pkey ON public.assignment_mark_private_notes USING btree (mark_id)',
  };
  assertExactDefinitions(indexes.map((index) => ({ name: index.indexname, definition: index.indexdef })), expectedIndexes,
    'Assignment private-notes indexes');
}

function assertExactDefinitions(actual, expected, label) {
  const entries = Object.entries(expected);
  if (actual.length !== entries.length) {
    throw new Error(`${label} postcondition failed: expected ${entries.length} definitions, found ${actual.length}.`);
  }
  for (const [name, definition] of entries) {
    const row = actual.find((item) => (item.conname || item.name || item.indexname) === name);
    if (!row || normalizeSqlDefinition(row.definition) !== normalizeSqlDefinition(definition)) {
      throw new Error(`${label} postcondition failed: definition differs for ${name}.`
        + ` expected=${normalizeSqlDefinition(definition)} actual=${normalizeSqlDefinition(row?.definition)}`);
    }
  }
}

async function assertExactRuntimePrivileges(client, { includeAuthorization = false, includeMaterials = true } = {}) {
  const tables = {};
  if (includeMaterials) Object.assign(tables, {
    learning_materials: ['SELECT','INSERT','UPDATE'],
    learning_material_files: ['SELECT','INSERT'],
  });
  if (includeAuthorization) Object.assign(tables, {
    learning_assignments: ['SELECT','INSERT','UPDATE'],
    assignment_recipients: ['SELECT','INSERT','DELETE'],
    assignment_submissions: ['SELECT','INSERT','UPDATE'],
    assignment_submission_versions: ['SELECT','INSERT'],
    assignment_attachments: ['SELECT','INSERT'],
    assignment_submission_files: ['SELECT','INSERT','UPDATE'],
    assignment_marks: [],
    assignment_mark_private_notes: ['SELECT','INSERT'],
    assignment_audit_log: ['SELECT','INSERT'],
  });
  for (const [table, expected] of Object.entries(tables)) {
    const result = await client.query(`SELECT
      has_table_privilege($1,$2,'SELECT') AS can_select,
      has_table_privilege($1,$2,'INSERT') AS can_insert,
      has_table_privilege($1,$2,'UPDATE') AS can_update,
      has_table_privilege($1,$2,'DELETE') AS can_delete,
      has_table_privilege($1,$2,'TRUNCATE') AS can_truncate,
      has_table_privilege($1,$2,'REFERENCES') AS can_reference,
      has_table_privilege($1,$2,'TRIGGER') AS can_trigger`, [RUNTIME_ROLE, `public.${table}`]);
    const actual = Object.entries(result.rows[0] || {})
      .filter(([, granted]) => granted === true).map(([privilege]) => privilege.replace('can_','').toUpperCase()).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
      throw new Error(`Runtime grant postcondition failed for ${table}: expected ${expected.join(', ')}, found ${actual.join(', ') || 'none'}.`);
    }
  }
  if (includeAuthorization) {
    const markColumns = (await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='assignment_marks' ORDER BY ordinal_position`)).rows;
    const expectedColumns = {
      SELECT: ['id','school_id','assignment_id','submission_id','version_id','revision','marked_by','score','feedback','status','created_at'],
      INSERT: ['school_id','assignment_id','submission_id','version_id','revision','marked_by','score','feedback','status'],
      UPDATE: [],
      REFERENCES: [],
    };
    for (const privilege of Object.keys(expectedColumns)) {
      const allowed = new Set(expectedColumns[privilege]);
      for (const { column_name: column } of markColumns) {
        const result = await client.query('SELECT has_column_privilege($1,$2,$3,$4) AS granted',
          [RUNTIME_ROLE,'public.assignment_marks',column,privilege]);
        if (result.rows[0]?.granted !== allowed.has(column)) {
          throw new Error(`Runtime grant postcondition failed for assignment_marks.${column} ${privilege}.`);
        }
      }
    }
  }
  const sequenceNames = includeMaterials ? ['learning_materials_id_seq','learning_material_files_id_seq'] : [];
  if (includeAuthorization) sequenceNames.push('learning_assignments_id_seq','assignment_recipients_id_seq',
    'assignment_submissions_id_seq','assignment_submission_versions_id_seq','assignment_attachments_id_seq',
    'assignment_submission_files_id_seq','assignment_marks_id_seq','assignment_audit_log_id_seq');
  for (const sequence of sequenceNames) {
    const result = await client.query(`SELECT
      has_sequence_privilege($1,$2,'USAGE') AS can_use,
      has_sequence_privilege($1,$2,'SELECT') AS can_select,
      has_sequence_privilege($1,$2,'UPDATE') AS can_update`, [RUNTIME_ROLE, `public.${sequence}`]);
    const grants = result.rows[0];
    if (!grants || grants.can_use !== true || grants.can_select !== true || grants.can_update !== false) {
      throw new Error(`Runtime sequence grant postcondition failed for ${sequence}.`);
    }
  }
}

async function assertLearningMaterialsPostconditions(client, { requireLedger = true } = {}) {
  const relations = (await client.query(`
    SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
  `, [MATERIAL_TABLES])).rows;
  if (relations.length !== MATERIAL_TABLES.length || relations.some((row) => !row.relrowsecurity
      || !row.relforcerowsecurity || row.owner !== 'neondb_owner')) {
    throw new Error('Learning materials schema drift: expected both owner-owned forced-RLS tables.');
  }
  const columns = (await client.query(`
    SELECT table_name,column_name,udt_name,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name=ANY($1::text[])
  `, [MATERIAL_TABLES])).rows;
  const expected = {
    learning_materials: [
      ['id','int8','NO',"nextval('learning_materials_id_seq'::regclass)"],['school_id','int4','NO',null],
      ['teacher_id','int4','NO',null],['class_id','int4','NO',null],['subject_id','int4','NO',null],
      ['academic_year','text','NO',null],['term','text','NO',null],['term_id','int4','NO',null],
      ['title','text','NO',null],['description','text','NO',"''::text"],['status','text','NO',"'PUBLISHED'::text"],
      ['created_at','timestamptz','NO','now()'],['updated_at','timestamptz','NO','now()'],
    ],
    learning_material_files: [
      ['id','int8','NO',"nextval('learning_material_files_id_seq'::regclass)"],['school_id','int4','NO',null],
      ['material_id','int8','NO',null],['storage_key','text','NO',null],['original_name','text','NO',null],
      ['content_type','text','NO',null],['file_size','int8','NO',null],['uploaded_by','int4','NO',null],
      ['created_at','timestamptz','NO','now()'],
    ],
  };
  for (const [table, definitions] of Object.entries(expected)) {
    const actual = columns.filter((column) => column.table_name === table)
      .map((column) => [column.column_name,column.udt_name,column.is_nullable,
        column.column_default === null ? null : normalizeSqlDefinition(column.column_default)])
      .sort((a,b) => a[0].localeCompare(b[0]));
    const wanted = definitions.map(([name,type,nullable,defaultValue]) => [name,type,nullable,
      defaultValue === null ? null : normalizeSqlDefinition(defaultValue)]).sort((a,b) => a[0].localeCompare(b[0]));
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      throw new Error(`Learning materials schema drift: columns differ on ${table}.`);
    }
  }
  const constraints=(await client.query(`
    SELECT conname,contype,pg_get_constraintdef(oid,true) AS definition
    FROM pg_constraint WHERE contype<>'n' AND conrelid=ANY(ARRAY[
      'public.learning_materials'::regclass,'public.learning_material_files'::regclass
    ])
  `)).rows;
  const materialConstraints = Object.fromEntries(Object.entries(MATERIAL_CONSTRAINTS)
    .filter(([name]) => name.startsWith('learning_material')));
  assertExactDefinitions(constraints, materialConstraints, 'Learning materials constraints');
  const indexes=(await client.query(`SELECT indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename=ANY($1::text[])`,[MATERIAL_TABLES])).rows;
  assertExactDefinitions(indexes.map((index) => ({ name:index.indexname,definition:index.indexdef })),
    MATERIAL_INDEXES,'Learning materials indexes');
  const policies = (await client.query(`
    SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
    WHERE schemaname='public' AND tablename=ANY($1::text[])
  `, [MATERIAL_TABLES])).rows;
  assertExactPolicies(policies, learningMaterialsPolicies, 'Learning materials');
  const grants = (await client.query(`
    SELECT (has_table_privilege($1,'public.learning_materials','SELECT')
        AND has_table_privilege($1,'public.learning_materials','INSERT')
        AND has_table_privilege($1,'public.learning_materials','UPDATE')) AS materials,
      (has_table_privilege($1,'public.learning_material_files','SELECT')
        AND has_table_privilege($1,'public.learning_material_files','INSERT')) AS files,
      has_sequence_privilege($1,'public.learning_materials_id_seq','USAGE') AS sequence
  `, [RUNTIME_ROLE])).rows[0];
  if (!grants || Object.values(grants).some((value) => value !== true)) {
    throw new Error('Learning materials schema drift: runtime grants are missing.');
  }
  await assertExactRuntimePrivileges(client);
  if (requireLedger) {
    const ledger = await client.query(
      "SELECT 1 FROM public.app_schema_migrations WHERE migration_name='20261127_learning_materials'"
    );
    if (!ledger.rowCount) throw new Error('Learning materials schema drift: migration ledger entry is missing.');
  }
  return true;
}

async function runLearningPlatformMigrations({
  env = process.env,
  poolFactory,
  migrationsDirectory = path.join(__dirname, '../sql/migrations'),
  logger = console,
} = {}) {
  return withMigrationLock({ env,poolFactory,logger,action: async (client) => {
    await assertAssignmentSchemaPostconditions(client);
    const recorded = await getRecordedMigrations(client);
    const authRecorded = recorded.has(FOLLOW_UP_MIGRATIONS[0].name);
    const materialsRecorded = recorded.has(FOLLOW_UP_MIGRATIONS[1].name);
    if (authRecorded) await assertAuthorizationPostconditions(client);
    else {
      const baseline = (await client.query(`SELECT count(*)::INTEGER AS n FROM pg_policies
        WHERE schemaname='public' AND tablename=ANY($1::text[]) AND policyname LIKE '%_school_scope'`,
      [['learning_assignments','assignment_recipients','assignment_submissions','assignment_submission_versions',
        'assignment_attachments','assignment_submission_files','assignment_marks','assignment_audit_log']])).rows[0]?.n;
      if (baseline !== 8) throw new Error('Refusing assignment authorization migration: policy state is not the known legacy baseline.');
    }
    if (materialsRecorded) await assertLearningMaterialsPostconditions(client);
    else {
      const existing = await client.query(`SELECT relname FROM pg_class
        WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])`, [MATERIAL_TABLES]);
      if (existing.rowCount) throw new Error('Refusing learning materials migration: unrecorded material schema exists.');
    }
    if (authRecorded && materialsRecorded) {
      logger.log('Assignment database authorization and learning materials schema match their migration records.');
      return { applied: false, verified: true };
    }
    await runSqlTransaction(client, async () => {
      for (const migration of FOLLOW_UP_MIGRATIONS) {
        const done = migration.name === FOLLOW_UP_MIGRATIONS[0].name ? authRecorded : materialsRecorded;
        if (done) continue;
        const sql = fs.readFileSync(path.join(migrationsDirectory,migration.file),'utf8');
        await client.query(removeFileTransactionEnvelope(sql));
        if (migration === FOLLOW_UP_MIGRATIONS[0]) await assertAuthorizationPostconditions(client);
        else await assertLearningMaterialsPostconditions(client);
      }
      await assertAssignmentSchemaPostconditions(client);
      await assertAuthorizationPostconditions(client);
      await assertLearningMaterialsPostconditions(client);
    });
    logger.log('Assignment authorization and learning materials migrations applied and verified.');
    return { applied: true, verified: true };
  }});
}

async function main() { return runLearningPlatformMigrations(); }
if (require.main === module) main().catch((error) => {
  console.error('Learning platform migration failed:', error.message);
  process.exitCode = 1;
});

module.exports = {
  FOLLOW_UP_MIGRATIONS,
  assertAuthorizationPostconditions,
  assertLearningMaterialsPostconditions,
  assertExactPolicies,
  assertExactDefinitions,
  assertExactRuntimePrivileges,
  assertFunctionPrivileges,
  runLearningPlatformMigrations,
  main,
};
