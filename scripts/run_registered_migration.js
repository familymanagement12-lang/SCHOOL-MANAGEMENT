require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const {
  runMigrationFiles,
  withMigrationLock,
  runSqlTransaction,
  removeFileTransactionEnvelope,
} = require('./migrationSafety');

const REGISTERED_MIGRATIONS = Object.freeze({
  'accountant-rls': ['20261114_accountant_rls_audit.sql'],
  'ai-assistant': ['20261117_ai_assistant_conversations.sql'],
  'class-assessments': ['20261111_class_assessments.sql'],
  'feeding': ['20261116_compulsory_feeding.sql'],
  'feeding-officer-audit-edit': ['20261120_feeding_officer_audit_edit.sql'],
  'fee-overrides-staff-attendance': ['20261116_student_fee_overrides_staff_attendance.sql'],
  'finance-audit-runtime-insert': ['20261125_finance_audit_runtime_insert.sql'],
  'kitchen-weekly-operations': ['20261119_kitchen_weekly_operations.sql'],
  'parent-portal': ['20261124_parent_portal.sql'],
  'school-name': ['20261112_school_name.sql'],
  'school-store': ['20261115_school_store_management.sql'],
  'staff-bulk-upload': ['20261124_staff_bulk_upload.sql'],
  'staff-employment-type': ['20261125_staff_employment_type.sql', '20261125_staff_employment_type_freeform.sql'],
  'student-portal': ['20261113_student_portal.sql'],
  'student-support': ['20261112_student_support_fields.sql'],
});

async function runRegisteredMigration(commandName) {
  const filenames = REGISTERED_MIGRATIONS[commandName];
  if (!filenames) throw new Error('No general migration is registered for command ' + commandName + '.');
  if (commandName === 'student-portal') return runStudentPortalMigration();
  await runMigrationFiles({
    filenames,
    afterApply: commandName === 'school-name'
      ? async (client) => {
        const result = await client.query('SELECT name FROM schools ORDER BY id LIMIT 1');
        if (result.rows[0]?.name !== 'The McCarthy Hill School') {
          throw new Error('School name postcondition did not match.');
        }
      }
      : undefined,
  });
  console.log('Migration command ' + commandName + ' completed on the verified development target.');
}

const STUDENT_PORTAL_FILE = '20261113_student_portal.sql';
const STUDENT_PORTAL_COLUMNS = Object.freeze(['is_published', 'published_at', 'class_id', 'curriculum']);

async function inspectStudentPortalState(client) {
  const columns = (await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='results'
      AND column_name=ANY($1::text[])
  `, [STUDENT_PORTAL_COLUMNS])).rows.map((row) => row.column_name);
  const auditTable = (await client.query(
    "SELECT to_regclass('public.student_portal_audit_log') AS relation"
  )).rows[0]?.relation;
  const triggers = (await client.query(`
    SELECT pg_get_triggerdef(t.oid,true) AS trigger_definition,
           pg_get_functiondef(p.oid) AS function_definition
    FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND r.relname='results' AND NOT t.tgisinternal
  `)).rows;
  const snapshotTrigger = triggers.filter((trigger) => /results_set_curriculum_snapshot/i.test(trigger.trigger_definition));
  const competingSnapshotWriter = triggers.some((trigger) => !snapshotTrigger.includes(trigger)
    && /new\.(?:class_id|curriculum|class_name_snapshot|year_level_snapshot|academic_year_snapshot)/i.test(trigger.function_definition));
  const fullyPresent = STUDENT_PORTAL_COLUMNS.every((column) => columns.includes(column))
    && Boolean(auditTable) && snapshotTrigger.length === 1 && !competingSnapshotWriter;
  const insertOnlySnapshot = fullyPresent
    && /before insert on public\.results/i.test(snapshotTrigger[0].trigger_definition)
    && /tg_op\s*<>\s*'insert'/i.test(snapshotTrigger[0].function_definition);
  const anyPresent = columns.length > 0 || Boolean(auditTable) || triggers.length > 0;
  return { fullyPresent, insertOnlySnapshot, anyPresent };
}

async function runStudentPortalMigration({
  env = process.env,
  poolFactory,
  migrationsDirectory = path.join(__dirname, '../sql/migrations'),
  logger = console,
} = {}) {
  return withMigrationLock({ env, poolFactory, logger, action: async (client) => {
    const state = await inspectStudentPortalState(client);
    if (state.fullyPresent) {
      if (!state.insertOnlySnapshot) {
        throw new Error('Refusing student portal migration: the existing result snapshot trigger is not verified insert-only; use the protected timetable migration runner.');
      }
      logger.log('Student portal schema is present and the result snapshot trigger remains insert-only.');
      return { applied: false, verified: true };
    }
    if (state.anyPresent) {
      throw new Error('Refusing student portal migration: partial or legacy portal schema exists; manual reconciliation is required.');
    }

    const resultRows = await client.query('SELECT EXISTS (SELECT 1 FROM public.results) AS has_results');
    if (resultRows.rows[0]?.has_results) {
      throw new Error('Refusing student portal migration: it contains a historical result backfill and results already exist.');
    }
    const sql = fs.readFileSync(path.join(migrationsDirectory, STUDENT_PORTAL_FILE), 'utf8');
    await runSqlTransaction(client, async () => {
      await client.query(removeFileTransactionEnvelope(sql));
      const postcondition = await inspectStudentPortalState(client);
      if (!postcondition.fullyPresent) {
        throw new Error('Student portal migration postcondition failed; migration transaction rolled back.');
      }
    });
    logger.log('Student portal schema applied to an empty results table; run the protected timetable sequence before creating results.');
    return { applied: true, verified: true };
  } });
}

module.exports = {
  REGISTERED_MIGRATIONS,
  STUDENT_PORTAL_FILE,
  inspectStudentPortalState,
  runStudentPortalMigration,
  runRegisteredMigration,
};
