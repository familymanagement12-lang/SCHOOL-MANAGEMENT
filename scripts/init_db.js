require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const {
  assertSafeMigrationTarget,
  withMigrationLock,
  runSqlTransaction,
  removeFileTransactionEnvelope,
} = require('./migrationSafety');

const GENERAL_MIGRATION_FILES = Object.freeze([
  '20261111_class_assessments.sql',
  '20261112_student_support_fields.sql',
  '20261112_school_name.sql',
  '20261114_accountant_rls_audit.sql',
  '20261115_school_store_management.sql',
  '20261116_student_fee_overrides_staff_attendance.sql',
  '20261117_ai_assistant_conversations.sql',
  '20261116_compulsory_feeding.sql',
  '20261119_kitchen_weekly_operations.sql',
  '20261120_feeding_officer_audit_edit.sql',
  '20261124_parent_portal.sql',
  '20261124_staff_bulk_upload.sql',
  '20261124_student_personalised_auth.sql',
  '20261125_staff_employment_type.sql',
  '20261125_staff_employment_type_freeform.sql',
  '20261125_finance_audit_runtime_insert.sql',
]);

const PROTECTED_RELATION = '(?:timetables|timetable_[a-z0-9_]*|teacher_subject_assignments|teacher_availability|class_availability|room_availability|subject_weekly_requirements|teacher_workload_limits|subject_class_assignments|subject_scheduling_preferences|class_configuration_audit)';
const PROTECTED_RELATION_DDL = new RegExp(
  `\\b(?:CREATE\\s+(?:UNIQUE\\s+)?TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ALTER\\s+TABLE(?:\\s+IF\\s+EXISTS)?|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?|TRUNCATE(?:\\s+TABLE)?)\\s+(?:ONLY\\s+)?(?:public\\.)?${PROTECTED_RELATION}\\b`,
  'i'
);
const PROTECTED_INDEX_DDL = new RegExp(
  `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\b[^;]*?\\bON\\s+(?:ONLY\\s+)?(?:public\\.)?${PROTECTED_RELATION}\\b`,
  'i'
);
const PROTECTED_TRIGGER_OR_POLICY_DDL = new RegExp(
  `\\b(?:CREATE|ALTER|DROP)\\s+(?:TRIGGER|POLICY)\\b[^;]*?\\bON\\s+(?:ONLY\\s+)?(?:public\\.)?${PROTECTED_RELATION}\\b`,
  'i'
);
const PROTECTED_INDEX_NAME_DDL = /\bDROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+(?:public\.)?(?:idx_timetable_[a-z0-9_]*|timetable_[a-z0-9_]*_idx|subject_class_assignments_[a-z0-9_]*_idx|subject_scheduling_preferences_[a-z0-9_]*_idx|class_configuration_audit_[a-z0-9_]*_idx)\b/i;
const SUBJECT_EXTENSION_COLUMNS = /\b(?:is_active|is_archived|is_compulsory|lesson_duration_minutes|applicable_year_levels|applicable_education_stages|scheduling_preferences)\b/i;
const CLASSIFICATION_DDL = /\bALTER\s+TABLE(?:\s+IF\s+EXISTS)?\s+(?:public\.)?classes\b[^;]*?\b(?:year_level|teaching_model|curriculum|education_stage|programme|class_teacher_id)\b/i;

function assertNoProtectedTimetableDdl(sql, source) {
  if (PROTECTED_RELATION_DDL.test(sql)
      || PROTECTED_INDEX_DDL.test(sql)
      || PROTECTED_TRIGGER_OR_POLICY_DDL.test(sql)
      || PROTECTED_INDEX_NAME_DDL.test(sql)
      || CLASSIFICATION_DDL.test(sql)) {
    throw new Error(`Refusing database initialization: ${source} contains protected timetable DDL; use the verified timetable migration runner.`);
  }

  const subjectTable = sql.match(/\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?subjects\b([\s\S]*?);/i);
  const subjectAlterations = [...sql.matchAll(/\bALTER\s+TABLE(?:\s+IF\s+EXISTS)?\s+(?:public\.)?subjects\b([\s\S]*?);/gi)];
  if ((subjectTable && SUBJECT_EXTENSION_COLUMNS.test(subjectTable[1]))
      || subjectAlterations.some((match) => SUBJECT_EXTENSION_COLUMNS.test(match[1]))) {
    throw new Error(`Refusing database initialization: ${source} contains protected subject/timetable extension DDL; use the verified timetable migration runner.`);
  }
}

async function initializeDatabase({
  env = process.env,
  poolFactory,
  targetValidator = assertSafeMigrationTarget,
  logger = console,
} = {}) {
  const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
  const migrations = GENERAL_MIGRATION_FILES.map((filename) => ({
    filename,
    sql: fs.readFileSync(path.join(__dirname, '../sql/migrations', filename), 'utf8'),
  }));
  assertNoProtectedTimetableDdl(schema, 'sql/schema.sql');
  for (const migration of migrations) assertNoProtectedTimetableDdl(migration.sql, migration.filename);

  const target = targetValidator(env);
  await withMigrationLock({ env, poolFactory, logger, action: async (client) => {
    const existingObjects = await client.query(`
      SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
      LIMIT 1
    `);
    if (existingObjects.rowCount) {
      throw new Error('Refusing database initialization: public schema is not empty; use individually reviewed migration commands instead of db:init.');
    }
    await runSqlTransaction(client, async () => {
      await client.query(removeFileTransactionEnvelope(schema));
      for (const migration of migrations) {
        await client.query(removeFileTransactionEnvelope(migration.sql));
      }
    });
    logger.log(`General database initialization completed for verified development target ${target.branchName} (${target.branchId}).`);
    logger.log('Protected histories remain separate: use the dedicated timetable and learning-assignment runners.');
  } });
}

if (require.main === module) {
  initializeDatabase().catch((error) => {
    console.error('Database initialization failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  GENERAL_MIGRATION_FILES,
  assertNoProtectedTimetableDdl,
  initializeDatabase,
};
