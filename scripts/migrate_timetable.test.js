const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TIMETABLE_MIGRATION_FILES,
  getTimetableMigrations,
} = require('./migrate_timetable');

const migrationDirectory = path.join(__dirname, '../sql/migrations');

test('legacy timetable migrations retain their dependency order', () => {
  assert.deepEqual(TIMETABLE_MIGRATION_FILES, [
    '20261017_timetable_foundation.sql',
    '20261018_timetable_management.sql',
    '20261112_curriculum_foundation.sql',
    '20261019_timetable_term_scope.sql',
    '20261020_timetable_integrity.sql',
    '20261112_optional_class_year_level.sql',
    '20261112_optional_class_teacher.sql',
    '20261126_classification_foundation.sql',
    '20261124_curriculum_transition_workflow.sql',
    '20261124_subject_timetable_extension.sql',
    '20261125_timetable_validation_integrity.sql',
    '20261127_class_configuration_audit.sql',
    '20261128_class_configuration_audit_events.sql',
    '20261126_result_snapshot_insert_only.sql',
    '20261126_timetable_schema_reconciliation.sql',
    '20261126_runtime_privilege_hardening.sql',
  ]);
  assert.deepEqual(
    getTimetableMigrations().map(({ filename }) => filename),
    TIMETABLE_MIGRATION_FILES
  );
});

test('class audit migration preserves class IDs and records explicit creation, update, and deletion actions', () => {
  const migration = getTimetableMigrations()
    .find(({ filename }) => filename === '20261128_class_configuration_audit_events.sql');
  assert.match(migration.sql, /ADD COLUMN IF NOT EXISTS class_id_snapshot INTEGER/i);
  assert.match(migration.sql, /ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'UPDATED'/i);
  assert.match(migration.sql, /CHECK \(action IN \('CREATED', 'UPDATED', 'DELETED'\)\)/i);
  assert.match(migration.sql, /SET class_id_snapshot = class_id[\s\S]*class_id_snapshot IS NULL/i);
  assert.doesNotMatch(migration.sql, /\bDELETE\s+FROM\b|\bDROP\s+TABLE\b/i);
});

test('result snapshot correction captures only on insert and never backfills existing results', () => {
  const migration = getTimetableMigrations()
    .find(({ filename }) => filename === '20261126_result_snapshot_insert_only.sql');
  assert.match(migration.sql, /IF TG_OP <> 'INSERT' THEN\s+RETURN NEW;/i);
  assert.match(migration.sql, /CREATE TRIGGER results_set_curriculum_snapshot\s+BEFORE INSERT ON results/i);
  assert.doesNotMatch(migration.sql, /BEFORE\s+INSERT\s+OR\s+UPDATE|UPDATE OF\s+student_id|UPDATE OF\s+school_id/i);
  assert.match(migration.sql, /WHERE s\.id = NEW\.student_id AND s\.school_id = NEW\.school_id/i);
  assert.match(migration.sql, /IF student_class IS NOT NULL THEN[\s\S]*?FROM classes c[\s\S]*?WHERE c\.id = student_class AND c\.school_id = NEW\.school_id[\s\S]*?IF NOT FOUND THEN[\s\S]*?RAISE EXCEPTION 'Student class % does not exist in this school\.'/i);
  assert.match(migration.sql, /NEW\.class_id := validated_class/i);
  assert.match(migration.sql, /NEW\.class_name_snapshot := snapshot_name/i);
  assert.match(migration.sql, /NEW\.year_level_snapshot := snapshot_year/i);
  assert.match(migration.sql, /NEW\.academic_year_snapshot := snapshot_academic_year/i);
  assert.doesNotMatch(migration.sql, /\bUPDATE\s+(?:public\.)?results\b|COALESCE\s*\(\s*NEW\.(?:class_name_snapshot|year_level_snapshot|academic_year_snapshot)/i);
});

test('runtime privilege hardening isolates the migration ledger and makes history append-only', () => {
  const migration = getTimetableMigrations()
    .find(({ filename }) => filename === '20261126_runtime_privilege_hardening.sql');
  assert.ok(migration);
  assert.match(migration.sql, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL ON TABLES FROM mccarthy_runtime_70aef860/i);
  assert.match(migration.sql, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL ON SEQUENCES FROM mccarthy_runtime_70aef860/i);
  assert.match(migration.sql, /REVOKE ALL PRIVILEGES ON TABLE public\.app_schema_migrations/i);
  assert.match(migration.sql, /GRANT INSERT ON TABLE public\.class_configuration_audit/i);
  assert.match(migration.sql, /GRANT SELECT ON TABLE public\.student_class_history/i);
  assert.doesNotMatch(migration.sql, /GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*student_class_history/i);
  assert.match(migration.sql, /CREATE POLICY class_configuration_audit_admin_insert[\s\S]*FOR INSERT/i);
  assert.match(migration.sql, /CREATE POLICY student_class_history_admin_read[\s\S]*FOR SELECT/i);
  assert.doesNotMatch(migration.sql, /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i);
});

test('result snapshot class validation covers isolated student and class fixtures', () => {
  const migration = getTimetableMigrations()
    .find(({ filename }) => filename === '20261126_result_snapshot_insert_only.sql');
  const sql = migration.sql;

  // These fixture cases exercise the intended trigger contract without PostgreSQL.
  function insertResult({ resultSchoolId, student, schools, classes }) {
    const school = schools.find(({ id }) => id === student?.schoolId);
    if (!student || student.schoolId !== resultSchoolId || !school) {
      throw new Error('Student not found in this school.');
    }
    if (student.classId == null) {
      return {
        classId: null,
        curriculum: student.curriculum ?? 'UNASSIGNED',
        classNameSnapshot: null,
        yearLevelSnapshot: null,
        academicYearSnapshot: school.academicYear,
      };
    }
    const klass = classes.find(({ id, schoolId }) => id === student.classId && schoolId === resultSchoolId);
    if (!klass) throw new Error(`Student class ${student.classId} does not exist in this school.`);
    return {
      classId: klass.id,
      curriculum: student.curriculum ?? 'UNASSIGNED',
      classNameSnapshot: klass.canonicalName,
      yearLevelSnapshot: klass.yearLevel,
      academicYearSnapshot: school.academicYear,
    };
  }

  const schools = [{ id: 1, academicYear: '2026/2027' }, { id: 2, academicYear: '2026/2027' }];
  const classes = [{ id: 10, schoolId: 1, canonicalName: 'Year 4 - A', yearLevel: 4 }];
  const validStudent = { id: 100, schoolId: 1, classId: 10, curriculum: 'COMMON' };

  assert.deepEqual(insertResult({ resultSchoolId: 1, student: validStudent, schools, classes }), {
    classId: 10, curriculum: 'COMMON', classNameSnapshot: 'Year 4 - A', yearLevelSnapshot: 4,
    academicYearSnapshot: '2026/2027',
  });
  assert.deepEqual(insertResult({
    resultSchoolId: 1, student: { ...validStudent, classId: null }, schools, classes,
  }), {
    classId: null, curriculum: 'COMMON', classNameSnapshot: null, yearLevelSnapshot: null,
    academicYearSnapshot: '2026/2027',
  });
  assert.throws(() => insertResult({
    resultSchoolId: 1, student: { ...validStudent, classId: 20 }, schools,
    classes: [...classes, { id: 20, schoolId: 2, canonicalName: 'Year 4', yearLevel: 4 }],
  }), /does not exist in this school/);
  assert.throws(() => insertResult({
    resultSchoolId: 1, student: { ...validStudent, classId: 404 }, schools, classes,
  }), /does not exist in this school/);
  assert.throws(() => insertResult({
    resultSchoolId: 1, student: { ...validStudent, schoolId: 2 }, schools, classes,
  }), /Student not found in this school/);
  assert.throws(() => insertResult({ resultSchoolId: 1, student: null, schools, classes }), /Student not found in this school/);

  assert.match(sql, /WHERE s\.id = NEW\.student_id AND s\.school_id = NEW\.school_id/i);
  assert.match(sql, /WHERE c\.id = student_class AND c\.school_id = NEW\.school_id/i);
});

test('ordinary result score and publication updates leave snapshot columns untouched', () => {
  const resultController = fs.readFileSync(path.join(__dirname, '../backend/src/controllers/resultController.js'), 'utf8');
  const portalController = fs.readFileSync(path.join(__dirname, '../backend/src/controllers/studentPortalController.js'), 'utf8');
  const scoreUpdates = [...resultController.matchAll(/DO UPDATE SET([\s\S]*?)(?=RETURNING|`)/gi)];
  const publicationUpdates = [...portalController.matchAll(/UPDATE results SET([\s\S]*?)WHERE/gi)];
  const snapshotColumns = /(?:class_id|curriculum|class_name_snapshot|year_level_snapshot|academic_year_snapshot)\s*=/i;

  assert.ok(scoreUpdates.length > 0, 'expected at least one result upsert update');
  assert.ok(publicationUpdates.length > 0, 'expected result publication updates');
  for (const update of scoreUpdates) assert.doesNotMatch(update[1], snapshotColumns);
  for (const update of publicationUpdates) assert.doesNotMatch(update[1], snapshotColumns);
});

test('result upsert conflict updates preserve stored class and curriculum snapshots', () => {
  const resultController = fs.readFileSync(path.join(__dirname, '../backend/src/controllers/resultController.js'), 'utf8');
  const resultsController = fs.readFileSync(path.join(__dirname, '../backend/src/controllers/resultsController.js'), 'utf8');
  const snapshotColumns = /(?:class_id|curriculum|class_name_snapshot|year_level_snapshot|academic_year_snapshot)\s*=/i;
  const updates = [resultController, resultsController]
    .flatMap((source) => [...source.matchAll(/DO UPDATE SET([\s\S]*?)(?=RETURNING|`)/gi)].map((match) => match[1]));

  assert.ok(updates.length > 0, 'expected result upsert conflict update clauses');
  for (const update of updates) assert.doesNotMatch(update, snapshotColumns);
});

test('legacy timetable command delegates to the fail-closed migration runner', () => {
  const runnerSource = fs.readFileSync(path.join(__dirname, 'migrate_timetable.js'), 'utf8');
  const extensionRunnerSource = fs.readFileSync(path.join(__dirname, 'migrate_subject_timetable_extension.js'), 'utf8');
  const optionalYearSource = fs.readFileSync(path.join(__dirname, 'migrate_optional_class_year_level.js'), 'utf8');
  const optionalTeacherSource = fs.readFileSync(path.join(__dirname, 'migrate_optional_class_teacher.js'), 'utf8');
  const curriculumRunner = fs.readFileSync(path.join(__dirname, 'migrate_curriculum_foundation.js'), 'utf8');
  const curriculumTransitionRunner = fs.readFileSync(path.join(__dirname, 'migrate_curriculum_transition.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const initSource = fs.readFileSync(path.join(__dirname, 'init_db.js'), 'utf8');

  assert.equal(packageJson.scripts['db:migrate:timetable'], 'node scripts/migrate_timetable.js');
  assert.equal(packageJson.scripts['db:migrate:subject-timetable-extension'], 'node scripts/migrate_subject_timetable_extension.js');
  assert.equal(packageJson.scripts['db:migrate:curriculum'], 'node scripts/migrate_curriculum_foundation.js');
  assert.equal(packageJson.scripts['db:migrate:curriculum-transition'], 'node scripts/migrate_curriculum_transition.js');
  assert.match(runnerSource, /executeMigrations/);
  assert.match(extensionRunnerSource, /require\('\.\/migrate_timetable'\)\.main\(\)/);
  assert.doesNotMatch(runnerSource, /require\(['"]pg['"]\)|DATABASE_URL/);
  for (const source of [optionalYearSource, optionalTeacherSource]) {
    assert.match(source, /require\('\.\/migrate_timetable'\)\.main\(\)/);
    assert.doesNotMatch(source, /require\(['"]pg['"]\)|DATABASE_URL/);
  }
  for (const source of [curriculumRunner, curriculumTransitionRunner]) {
    assert.match(source, /require\('\.\/migrate_timetable'\)\.main\(\)/);
    assert.doesNotMatch(source, /require\(['"]pg['"]\)|DATABASE_URL|pool\.query/);
  }
  for (const filename of TIMETABLE_MIGRATION_FILES) {
    assert.doesNotMatch(initSource, new RegExp(filename));
  }
});

test('ambiguous class names and missing stages are never auto-classified by migrations', () => {
  const management = getTimetableMigrations().find(({ filename }) => filename === '20261018_timetable_management.sql');
  const classification = getTimetableMigrations().find(({ filename }) => filename === '20261126_classification_foundation.sql');
  const curriculum = getTimetableMigrations().find(({ filename }) => filename === '20261112_curriculum_foundation.sql');

  assert.doesNotMatch(management.sql, /SET\s+year_level\s*=\s*substring/i);
  assert.doesNotMatch(management.sql, /SET\s+teaching_model\s*=\s*CASE/i);
  assert.match(classification.sql, /education_stage TEXT NOT NULL DEFAULT 'UNASSIGNED'/);
  assert.doesNotMatch(classification.sql, /\bUPDATE\s+classes\b|\bINSERT\s+INTO\s+classes\b/i);
  assert.match(curriculum.sql, /SET curriculum = 'UNASSIGNED' WHERE curriculum IS NULL/i);
  assert.match(curriculum.sql, /class_stage = 'JHS'/);
  assert.doesNotMatch(curriculum.sql, /class_year BETWEEN 7 AND 9/i);
  assert.doesNotMatch(curriculum.sql, /INSERT INTO curriculum_subjects[\s\S]*'COMMON'/i);
});

test('timetable entries only backfill to one version matching the same school, year, term, and status', () => {
  const migration = getTimetableMigrations()
    .find(({ filename }) => filename === '20261018_timetable_management.sql');
  const normalizedSql = migration.sql.replace(/\r\n/g, '\n');
  const backfillGuard = normalizedSql.slice(normalizedSql.indexOf('DECLARE\n  unresolved RECORD'));
  const versionUpdate = backfillGuard.slice(backfillGuard.indexOf('UPDATE timetables t'));

  assert.match(backfillGuard, /HAVING COUNT\(v\.id\) <> 1/);
  assert.match(backfillGuard, /v\.school_id = t\.school_id/);
  assert.match(backfillGuard, /v\.academic_year = COALESCE\(t\.academic_year, s\.academic_year, 'Unassigned'\)/);
  assert.match(backfillGuard, /v\.term = COALESCE\(t\.term, s\.current_term, 'Unassigned'\)/);
  assert.match(backfillGuard, /v\.status = CASE WHEN t\.status = 'PUBLISHED' THEN 'PUBLISHED' ELSE 'DRAFT' END/);
  assert.match(versionUpdate, /t\.school_id = v\.school_id/);
  assert.match(versionUpdate, /v\.academic_year = COALESCE\(t\.academic_year, s\.academic_year, 'Unassigned'\)/);
  assert.match(versionUpdate, /v\.term = COALESCE\(t\.term, s\.current_term, 'Unassigned'\)/);
  assert.match(versionUpdate, /v\.status = CASE WHEN t\.status = 'PUBLISHED' THEN 'PUBLISHED' ELSE 'DRAFT' END/);
  assert.match(backfillGuard, /expected exactly one matching version/);
});

test('transition migration preserves historical results and does not invent class-history baselines', () => {
  const migration = getTimetableMigrations()
    .find(({ filename }) => filename === '20261124_curriculum_transition_workflow.sql');
  assert.doesNotMatch(migration.sql, /UPDATE\s+results\b/i);
  assert.doesNotMatch(migration.sql, /INSERT\s+INTO\s+student_class_history[\s\S]*?\bSELECT\s+s\./i);
  assert.match(migration.sql, /BEFORE INSERT ON results/);
  assert.match(migration.sql, /CREATE OR REPLACE FUNCTION canonical_curriculum_class_name/i);
  assert.match(migration.sql, /ADD COLUMN IF NOT EXISTS class_name_snapshot TEXT/i);
  assert.match(migration.sql, /ADD COLUMN IF NOT EXISTS year_level_snapshot INTEGER/i);
  assert.match(migration.sql, /ADD COLUMN IF NOT EXISTS academic_year_snapshot TEXT/i);
  assert.doesNotMatch(migration.sql, /BEFORE INSERT OR UPDATE OF student_id, school_id ON results/);
});

test('teacher-subject uniqueness migration targets the actual old name and term-scopes uniqueness', () => {
  const migration = getTimetableMigrations().find(({ filename }) => filename === '20261019_timetable_term_scope.sql');
  assert.match(migration.sql, /teacher_subject_assignments_school_id_teacher_id_subject_id_key/);
  assert.match(migration.sql, /UNIQUE \(school_id, teacher_id, subject_id, class_id\)/);
  assert.match(migration.sql, /teacher_subject_assignments_term_unique/);
  assert.match(migration.sql, /UNIQUE \(school_id, term_id, teacher_id, subject_id, class_id\)/);
  assert.doesNotMatch(
    migration.sql,
    /teacher_subject_assignments_school_id_teacher_id_subject_id_class_id_key/
  );
  assert.match(migration.sql, /unexpected definition; manual review is required/);
});

test('legacy SQL relies on per-migration runner transactions and does not delete records', () => {
  for (const migration of getTimetableMigrations()) {
    assert.doesNotMatch(migration.sql, /^\s*(BEGIN|COMMIT)\s*;/im, migration.filename);
    assert.doesNotMatch(migration.sql, /\b(DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i, migration.filename);
  }
});
