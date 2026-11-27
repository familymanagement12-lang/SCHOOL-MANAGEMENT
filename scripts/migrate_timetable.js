const {
  executeMigrations,
  loadMigrations,
} = require('./migrate_subject_timetable_extension');

const TIMETABLE_MIGRATION_FILES = Object.freeze([
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

function getTimetableMigrations() {
  return loadMigrations(undefined, TIMETABLE_MIGRATION_FILES);
}

async function main() {
  require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
  await executeMigrations({ migrations: getTimetableMigrations() });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Timetable migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  TIMETABLE_MIGRATION_FILES,
  getTimetableMigrations,
  main,
};
