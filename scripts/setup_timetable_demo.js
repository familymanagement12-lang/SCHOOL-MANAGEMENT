require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const { withMigrationLock, runSqlTransaction } = require('./migrationSafety');

let pool;
const schoolName = process.env.DEMO_SCHOOL_NAME || 'The McCarthy Hill School';
const academicYear = process.env.DEMO_ACADEMIC_YEAR || '2026/2027';
const termName = process.env.DEMO_TERM || 'Term 1';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

async function getSchool() {
  const result = await pool.query('SELECT id FROM schools WHERE name = $1 LIMIT 1', [schoolName]);
  if (!result.rows[0]) throw new Error(`School not found: ${schoolName}`);
  return result.rows[0];
}

async function ensureTerm(schoolId) {
  const termResult = await pool.query(
    `INSERT INTO timetable_terms (school_id, academic_year, term)
     VALUES ($1, $2, $3)
     ON CONFLICT (school_id, academic_year, term) DO NOTHING
     RETURNING id`,
    [schoolId, academicYear, termName]
  );

  if (termResult.rows[0]) return termResult.rows[0].id;

  const existing = await pool.query(
    'SELECT id FROM timetable_terms WHERE school_id = $1 AND academic_year = $2 AND term = $3 LIMIT 1',
    [schoolId, academicYear, termName]
  );

  return existing.rows[0]?.id;
}

async function ensureVersion(schoolId, termId) {
  const existing = await pool.query(
    `SELECT id, revision, status FROM timetable_versions
     WHERE school_id = $1 AND academic_year = $2 AND term = $3
     ORDER BY revision DESC, id DESC LIMIT 1`,
    [schoolId, academicYear, termName]
  );

  if (existing.rows[0]) return existing.rows[0];

  const inserted = await pool.query(
    `INSERT INTO timetable_versions (school_id, academic_year, term, term_id, status, revision, created_by)
     VALUES ($1, $2, $3, $4, 'DRAFT', 1, NULL)
     RETURNING id, revision, status, academic_year, term`,
    [schoolId, academicYear, termName, termId]
  );

  return inserted.rows[0];
}

async function ensurePeriods(schoolId, termId) {
  const count = await pool.query(
    'SELECT COUNT(*)::INT AS count FROM timetable_periods WHERE school_id = $1 AND term_id = $2',
    [schoolId, termId]
  );

  if (count.rows[0].count > 0) {
    return;
  }

  const defaultPeriods = [
    ['Period 1', '08:00', '08:40'],
    ['Period 2', '08:40', '09:20'],
    ['Period 3', '09:20', '10:00'],
    ['Period 4', '10:15', '10:55'],
    ['Period 5', '10:55', '11:35'],
    ['Period 6', '11:35', '12:15'],
    ['Period 7', '13:00', '13:40'],
    ['Period 8', '13:40', '14:20']
  ];

  await pool.query('DELETE FROM timetable_periods WHERE school_id = $1 AND term_id = $2', [schoolId, termId]);

  for (let index = 0; index < defaultPeriods.length; index += 1) {
    const [name, startTime, endTime] = defaultPeriods[index];
    await pool.query(
      `INSERT INTO timetable_periods (school_id, term_id, name, day_of_week, start_time, end_time, sort_order, is_active)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, TRUE)`,
      [schoolId, termId, name, startTime, endTime, index + 1]
    );
  }
}

async function ensureRequirements(schoolId, termId) {
  const classes = await pool.query('SELECT id, name, year_level FROM classes WHERE school_id = $1 ORDER BY year_level, name', [schoolId]);
  const subjects = await pool.query('SELECT id, name FROM subjects WHERE school_id = $1 ORDER BY name', [schoolId]);

  let total = 0;
  for (const classRow of classes.rows) {
    for (const subjectRow of subjects.rows) {
      const lessonsPerWeek = classRow.year_level <= 3 ? 2 : 3;
      await pool.query(
        `INSERT INTO subject_weekly_requirements (school_id, term_id, class_id, subject_id, lessons_per_week, double_periods_per_week, room_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (school_id, term_id, class_id, subject_id)
         DO UPDATE SET lessons_per_week = EXCLUDED.lessons_per_week,
                       double_periods_per_week = EXCLUDED.double_periods_per_week,
                       room_required = EXCLUDED.room_required`,
        [schoolId, termId, classRow.id, subjectRow.id, lessonsPerWeek, 0, false]
      );
      total += 1;
    }
  }

  return total;
}

async function setupTimetableDemo() {
    const school = await getSchool();
    const termId = await ensureTerm(school.id);
    if (!termId) {
      throw new Error('Could not create or find a timetable term for the demo school.');
    }

    const version = await ensureVersion(school.id, termId);
    await ensurePeriods(school.id, termId);
    const requirementCount = await ensureRequirements(school.id, termId);

    console.log(`Ready: ${schoolName}`);
    console.log(`Academic year: ${academicYear}`);
    console.log(`Term: ${termName}`);
    console.log(`Version id: ${version.id}`);
    console.log(`Weekly requirements set: ${requirementCount}`);
    console.log('The timetable draft is ready for generation in the app.');
}

async function main({ env = process.env, poolFactory, logger = console } = {}) {
  if (env.ALLOW_TIMETABLE_DEMO_SETUP !== 'true' || env.MIGRATION_TARGET !== 'local') {
    throw new Error('Timetable demo setup requires ALLOW_TIMETABLE_DEMO_SETUP=true and MIGRATION_TARGET=local.');
  }
  return withMigrationLock({ env, poolFactory, logger, action: async (client) => {
    pool = client;
    await runSqlTransaction(client, setupTimetableDemo);
  } });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Timetable setup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
