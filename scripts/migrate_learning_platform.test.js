const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FOLLOW_UP_MIGRATIONS,
  assertExactPolicies,
  assertExactDefinitions,
  assertExactRuntimePrivileges,
  assertFunctionPrivileges,
} = require('./migrate_learning_platform');
const { authorizationPolicies, learningMaterialsPolicies, MATERIAL_CONSTRAINTS, MATERIAL_INDEXES, normalizeSqlDefinition } = require('./learningPlatformDefinitions');
const authSql = fs.readFileSync(path.join(__dirname,'../sql/migrations/20261127_assignment_database_authorization.sql'),'utf8');
const materialsSql = fs.readFileSync(path.join(__dirname,'../sql/migrations/20261127_learning_materials.sql'),'utf8');
const runner = fs.readFileSync(path.join(__dirname,'migrate_learning_platform.js'),'utf8');

test('assignment authorization is role scoped, forced, and preserves the separate migration ledger', () => {
  assert.deepEqual(FOLLOW_UP_MIGRATIONS.map((item)=>item.name),[
    '20261127_assignment_database_authorization','20261127_learning_materials',
  ]);
  assert.match(authSql,/assignment_staff_scope/);
  assert.match(authSql,/DROP POLICY IF EXISTS learning_assignments_school_scope/);
  assert.match(authSql,/FORCE ROW LEVEL SECURITY/);
  assert.match(authSql,/assignment_submissions_student_update/);
  assert.match(authSql,/assignment_marks_student_read[\s\S]*status='RELEASED'/);
  assert.match(authSql,/assignment_marks_parent_read[\s\S]*status='RELEASED'/);
  assert.match(authSql,/assignment_mark_private_notes/);
  assert.match(authSql,/PRIMARY KEY \(mark_id\)/);
  assert.match(authSql,/FOREIGN KEY \(mark_id\) REFERENCES public\.assignment_marks\(id\)/);
  assert.match(authSql,/mark\.school_id=assignment_mark_private_notes\.school_id/);
  assert.match(authSql,/INSERT INTO public\.app_schema_migrations/);
  assert.match(authSql,/assignment_database_authorization/);
});
test('runtime cannot select private marking notes from student-readable mark rows', () => {
  assert.match(authSql,/REVOKE ALL PRIVILEGES ON TABLE public\.learning_assignments/);
  assert.match(authSql,/REVOKE ALL ON public\.assignment_marks FROM/);
  assert.match(authSql,/GRANT SELECT \(id,school_id,assignment_id,submission_id,version_id,revision,marked_by,score,feedback,status,created_at\) ON public\.assignment_marks/);
  assert.doesNotMatch(authSql,/GRANT SELECT ON public\.assignment_marks/);
  assert.match(authSql,/CREATE POLICY assignment_mark_private_notes_staff_scope/);
});

test('Learning Materials migration applies forced RLS and explicit runtime grants', () => {
  assert.match(materialsSql,/CREATE TABLE public\.learning_materials/);
  assert.match(materialsSql,/CREATE TABLE public\.learning_material_files/);
  assert.match(materialsSql,/FORCE ROW LEVEL SECURITY/g);
  assert.match(materialsSql,/learning_materials_student_read/);
  assert.match(materialsSql,/learning_material_files_student_read/);
  assert.match(materialsSql,/GRANT SELECT,INSERT,UPDATE ON public\.learning_materials/);
  assert.match(materialsSql,/GRANT SELECT,INSERT ON public\.learning_material_files/);
  assert.match(materialsSql,/REVOKE ALL PRIVILEGES ON TABLE public\.learning_materials/);
});

test('learning platform runner uses the shared target guard, lock and transactional postconditions', () => {
  assert.match(runner,/withMigrationLock/);
  assert.match(runner,/runSqlTransaction/);
  assert.match(runner,/assertAssignmentSchemaPostconditions/);
  assert.match(runner,/assertAuthorizationPostconditions/);
  assert.match(runner,/assertLearningMaterialsPostconditions/);
  assert.match(runner,/Refusing assignment authorization migration/);
  assert.match(runner,/unrecorded material schema exists/);
});

test('exact intended assignment and Learning Materials policies pass definition verification', () => {
  assertExactPolicies(authorizationPolicies.map((policy) => ({ ...policy })), authorizationPolicies, 'assignment');
  assertExactPolicies(learningMaterialsPolicies.map((policy) => ({ ...policy })), learningMaterialsPolicies, 'materials');
  assertExactPolicies(learningMaterialsPolicies.map((policy) => ({ ...policy,roles:`{${policy.roles.join(',')}}` })),
    learningMaterialsPolicies,'catalog array text');
});

test('catalog SQL formatting normalization preserves predicate meaning and accepts harmless deparser formatting', () => {
  const source = learningMaterialsPolicies.find((policy) => policy.policyname === 'learning_materials_student_read');
  const catalogPolicy = {
    ...source,
    roles: ['public'],
    qual: "((school_id = NULLIF(current_setting('app.school_id'::text, true), ''::text)::integer) AND (current_setting('app.role'::text, true) = 'student'::text) AND (status = 'PUBLISHED'::text) AND (EXISTS ( SELECT 1 FROM students st WHERE ((st.school_id = learning_materials.school_id) AND (st.class_id = learning_materials.class_id) AND (st.user_id = NULLIF(current_setting('app.user_id'::text, true), ''::text)::integer)))))",
  };
  assert.equal(normalizeSqlDefinition(catalogPolicy.qual), normalizeSqlDefinition(source.qual));
  assert.doesNotThrow(() => assertExactPolicies([catalogPolicy], [source], 'materials'));
  assert.notEqual(normalizeSqlDefinition('school_id = 1 OR user_id = 2'), normalizeSqlDefinition('school_id = 1 AND user_id = 2'));
  assert.equal(normalizeSqlDefinition("user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER"),
    normalizeSqlDefinition("user_id=(NULLIF(current_setting('app.user_id'::text,true),''::text))::integer"));
});

test('same-name policy drift in command, role, USING, or WITH CHECK fails closed', () => {
  const base = learningMaterialsPolicies.map((policy) => ({ ...policy, roles: [...policy.roles] }));
  const mutations = [
    (rows) => { rows.find((row) => row.policyname === 'learning_materials_student_read').tablename = 'learning_material_files'; },
    (rows) => { rows.find((row) => row.policyname === 'learning_materials_student_read').cmd = 'ALL'; },
    (rows) => { rows.find((row) => row.policyname === 'learning_materials_student_read').roles = ['authenticated']; },
    (rows) => { rows.find((row) => row.policyname === 'learning_materials_student_read').qual = 'true'; },
    (rows) => { rows.find((row) => row.policyname === 'learning_materials_staff_scope').with_check = 'true'; },
    (rows) => { rows.find((row) => row.policyname === 'learning_materials_staff_scope').with_check = null; },
  ];
  for (const mutate of mutations) {
    const drifted = base.map((policy) => ({ ...policy, roles: [...policy.roles] }));
    mutate(drifted);
    assert.throws(() => assertExactPolicies(drifted, learningMaterialsPolicies, 'materials'), /differs for policy/);
  }
});

test('same-name constraint and index drift in expressions, actions, columns, or uniqueness fails closed', () => {
  const goodConstraints = Object.entries(MATERIAL_CONSTRAINTS).map(([name, definition]) => ({ conname:name,definition }));
  assert.doesNotThrow(() => assertExactDefinitions(goodConstraints, MATERIAL_CONSTRAINTS, 'constraints'));
  for (const [name, alteration] of [
    ['learning_materials_title_check', 'CHECK (length(trim(title)) BETWEEN 1 AND 201)'],
    ['learning_materials_school_id_fkey', 'FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT'],
    ['learning_materials_school_id_id_key', 'UNIQUE (id, school_id)'],
  ]) {
    const drifted = goodConstraints.map((row) => row.conname === name ? { ...row,definition:alteration } : row);
    assert.throws(() => assertExactDefinitions(drifted, MATERIAL_CONSTRAINTS, 'constraints'), /definition differs/);
  }
  const goodIndexes = Object.entries(MATERIAL_INDEXES).map(([name, definition]) => ({ name,definition }));
  assert.doesNotThrow(() => assertExactDefinitions(goodIndexes, MATERIAL_INDEXES, 'indexes'));
  for (const [name, alteration] of [
    ['learning_materials_class_term_idx', 'CREATE INDEX learning_materials_class_term_idx ON public.learning_materials USING btree (school_id, term_id)'],
    ['learning_materials_school_id_id_key', 'CREATE INDEX learning_materials_school_id_id_key ON public.learning_materials USING btree (school_id, id)'],
    ['learning_materials_class_term_idx', 'CREATE INDEX learning_materials_class_term_idx ON public.learning_materials USING btree (school_id, class_id) WHERE status = \'PUBLISHED\''],
  ]) {
    const drifted = goodIndexes.map((row) => row.name === name ? { ...row,definition:alteration } : row);
    assert.throws(() => assertExactDefinitions(drifted, MATERIAL_INDEXES, 'indexes'), /definition differs/);
  }
});

test('constraint and index comparison tolerates formatting but retains actions, order, and predicates', () => {
  assert.equal(
    normalizeSqlDefinition('CHECK (((length(TRIM(BOTH FROM title)) >= 1) AND (length(TRIM(BOTH FROM title)) <= 200)))'),
    normalizeSqlDefinition(MATERIAL_CONSTRAINTS.learning_materials_title_check)
  );
  assert.equal(
    normalizeSqlDefinition('CREATE INDEX learning_materials_class_term_idx ON public.learning_materials USING btree (school_id, class_id, term_id, status, created_at DESC)'),
    normalizeSqlDefinition(MATERIAL_INDEXES.learning_materials_class_term_idx)
  );
  assert.notEqual(
    normalizeSqlDefinition('FOREIGN KEY (school_id, teacher_id) REFERENCES users(school_id, id) ON DELETE CASCADE'),
    normalizeSqlDefinition(MATERIAL_CONSTRAINTS.learning_materials_school_id_teacher_id_fkey)
  );
});

function privilegeClient({ missing, extra, badSequence, columnDrift } = {}) {
  return { async query(sql, values) {
    if (sql.includes('has_table_privilege')) {
      const table = values[1].split('.').at(-1);
      const defaults = {
        learning_materials:['SELECT','INSERT','UPDATE'],learning_material_files:['SELECT','INSERT'],
        learning_assignments:['SELECT','INSERT','UPDATE'],assignment_recipients:['SELECT','INSERT','DELETE'],
        assignment_submissions:['SELECT','INSERT','UPDATE'],assignment_submission_versions:['SELECT','INSERT'],
        assignment_attachments:['SELECT','INSERT'],assignment_submission_files:['SELECT','INSERT','UPDATE'],
        assignment_mark_private_notes:['SELECT','INSERT'],assignment_audit_log:['SELECT','INSERT'],assignment_marks:[],
      };
      const allowed = new Set(defaults[table] || []);
      if (missing?.table === table) allowed.delete(missing.privilege);
      if (extra?.table === table) allowed.add(extra.privilege);
      return { rows: [{ can_select:allowed.has('SELECT'),can_insert:allowed.has('INSERT'),can_update:allowed.has('UPDATE'),
        can_delete:allowed.has('DELETE'),can_truncate:allowed.has('TRUNCATE'),can_reference:allowed.has('REFERENCES'),can_trigger:allowed.has('TRIGGER') }] };
    }
    if (sql.includes('information_schema.columns')) return { rows: [
      'id','school_id','assignment_id','submission_id','version_id','revision','marked_by','score','feedback','status','created_at','private_notes',
    ].map((column_name) => ({ column_name })) };
    if (sql.includes('has_column_privilege')) {
      const [, , column, privilege] = values;
      const selected = new Set(['id','school_id','assignment_id','submission_id','version_id','revision','marked_by','score','feedback','status','created_at']);
      const inserted = new Set(['school_id','assignment_id','submission_id','version_id','revision','marked_by','score','feedback','status']);
      let granted = privilege === 'SELECT' ? selected.has(column) : privilege === 'INSERT' ? inserted.has(column) : false;
      if (columnDrift?.column === column && columnDrift.privilege === privilege) granted = columnDrift.granted;
      return { rows: [{ granted }] };
    }
    if (sql.includes('has_sequence_privilege')) return { rows: [{
      can_use:badSequence !== values[1],can_select:true,can_update:false,
    }] };
    throw new Error('Unexpected privilege query.');
  } };
}

test('runtime grants reject missing privileges, unexpected writes, and incorrect sequence access', async () => {
  await assert.doesNotReject(assertExactRuntimePrivileges(privilegeClient()));
  await assert.rejects(assertExactRuntimePrivileges(privilegeClient({ missing:{table:'learning_material_files',privilege:'INSERT'} })), /grant postcondition failed/);
  await assert.rejects(assertExactRuntimePrivileges(privilegeClient({ extra:{table:'learning_material_files',privilege:'DELETE'} })), /grant postcondition failed/);
  await assert.rejects(assertExactRuntimePrivileges(privilegeClient({ badSequence:'public.learning_materials_id_seq' })), /sequence grant postcondition failed/);
});

test('assignment runtime grants enforce column-level marking access and no broad mark writes', async () => {
  await assert.doesNotReject(assertExactRuntimePrivileges(privilegeClient(), { includeAuthorization:true }));
  await assert.rejects(assertExactRuntimePrivileges(privilegeClient({
    extra:{table:'assignment_marks',privilege:'UPDATE'},
  }), { includeAuthorization:true }), /grant postcondition failed for assignment_marks/);
  await assert.rejects(assertExactRuntimePrivileges(privilegeClient({
    columnDrift:{column:'private_notes',privilege:'SELECT',granted:true},
  }), { includeAuthorization:true }), /assignment_marks\.private_notes SELECT/);
});

test('staff-scope function privileges reject PUBLIC execute and altered grants', async () => {
  const valid = [{grantee:'mccarthy_runtime_70aef860',privilege_type:'EXECUTE',is_grantable:false},
    {grantee:'neondb_owner',privilege_type:'EXECUTE',is_grantable:true}];
  await assert.doesNotReject(assertFunctionPrivileges({ query:async()=>({rows:valid}) }));
  await assert.doesNotReject(assertFunctionPrivileges({ query:async()=>({rows:[valid[0]]}) }));
  await assert.rejects(assertFunctionPrivileges({ query:async()=>({rows:[...valid,
    {grantee:'PUBLIC',privilege_type:'EXECUTE',is_grantable:false}]}) }), /PUBLIC execute is prohibited/);
});
