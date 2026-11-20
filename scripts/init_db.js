require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

(async () => {
	if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env');
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
		await pool.query(schema);
		for (const file of ['20261017_timetable_foundation.sql', '20261018_timetable_management.sql', '20261019_timetable_term_scope.sql', '20261020_timetable_integrity.sql', '20261111_class_assessments.sql', '20261112_curriculum_foundation.sql', '20261112_student_support_fields.sql', '20261112_school_name.sql', '20261112_optional_class_year_level.sql', '20261112_optional_class_teacher.sql', '20261113_student_portal.sql', '20261114_accountant_rls_audit.sql', '20261115_school_store_management.sql', '20261116_student_fee_overrides_staff_attendance.sql', '20261117_ai_assistant_conversations.sql', '20261116_compulsory_feeding.sql']) {
			const migration = fs.readFileSync(path.join(__dirname, '../sql/migrations', file), 'utf8');
			await pool.query(migration);
		}
		console.log('Database schema and migrations applied. Next run npm run admin:seed.');
	} catch (error) {
		console.error('Database initialization failed:', error.message);
		process.exitCode = 1;
	} finally {
		await pool.end();
	}
})();
