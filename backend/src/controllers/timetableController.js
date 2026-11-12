const pool = require('../config/db');
const { solveTimetable } = require('../services/timetableSolver');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ALL_DAYS = [...DAYS, 'Saturday', 'Sunday'];
const DEFAULT_PERIODS = [
  { name: 'Period 1', start_time: '08:00', end_time: '08:40', is_break: false },
  { name: 'Period 2', start_time: '08:40', end_time: '09:20', is_break: false },
  { name: 'Period 3', start_time: '09:20', end_time: '10:00', is_break: false },
  { name: 'Break', start_time: '10:00', end_time: '10:30', is_break: true },
  { name: 'Period 4', start_time: '10:30', end_time: '11:10', is_break: false },
  { name: 'Period 5', start_time: '11:10', end_time: '11:50', is_break: false },
];

const schemaSql = `
  ALTER TABLE schools ADD COLUMN IF NOT EXISTS subject_teaching_starts_from TEXT DEFAULT 'Class 4';

  CREATE TABLE IF NOT EXISTS timetable_rooms (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    capacity INTEGER,
    location TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (school_id, name)
  );

  CREATE TABLE IF NOT EXISTS timetable_periods (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    day_of_week TEXT CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_break BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (start_time < end_time)
  );

  CREATE TABLE IF NOT EXISTS teacher_subject_assignments (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (school_id, teacher_id, subject_id, class_id)
  );

  CREATE TABLE IF NOT EXISTS teacher_availability (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT FALSE,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (start_time < end_time)
  );

  CREATE TABLE IF NOT EXISTS class_availability (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT FALSE,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (start_time < end_time)
  );

  CREATE TABLE IF NOT EXISTS room_availability (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES timetable_rooms(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT FALSE,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (start_time < end_time)
  );

  CREATE TABLE IF NOT EXISTS subject_weekly_requirements (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    lessons_per_week INTEGER NOT NULL CHECK (lessons_per_week >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (school_id, class_id, subject_id)
  );

  CREATE TABLE IF NOT EXISTS timetable_generation_runs (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_year TEXT,
    term TEXT,
    status TEXT DEFAULT 'completed',
    summary JSONB DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS timetable_unscheduled_lessons (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    generation_run_id INTEGER REFERENCES timetable_generation_runs(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    required_lessons INTEGER NOT NULL DEFAULT 0,
    scheduled_lessons INTEGER NOT NULL DEFAULT 0,
    missing_lessons INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    suggestions JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  ALTER TABLE timetables ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL;
  ALTER TABLE timetables ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE timetables ADD COLUMN IF NOT EXISTS room_id INTEGER REFERENCES timetable_rooms(id) ON DELETE SET NULL;
  ALTER TABLE timetables ADD COLUMN IF NOT EXISTS period_id INTEGER REFERENCES timetable_periods(id) ON DELETE SET NULL;
  ALTER TABLE timetables ADD COLUMN IF NOT EXISTS academic_year TEXT;
  ALTER TABLE timetables ADD COLUMN IF NOT EXISTS term TEXT;
  ALTER TABLE timetables ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'DRAFT';
  ALTER TABLE timetables ADD COLUMN IF NOT EXISTS generation_run_id INTEGER REFERENCES timetable_generation_runs(id) ON DELETE SET NULL;

  CREATE INDEX IF NOT EXISTS idx_timetables_school_day_time ON timetables (school_id, day_of_week, start_time, end_time);
  CREATE INDEX IF NOT EXISTS idx_timetables_teacher_time ON timetables (school_id, teacher_id, day_of_week, start_time, end_time);
  CREATE INDEX IF NOT EXISTS idx_timetables_class_time ON timetables (school_id, class_id, day_of_week, start_time, end_time);
  CREATE INDEX IF NOT EXISTS idx_timetables_room_time ON timetables (school_id, room_id, day_of_week, start_time, end_time);
`;

let schemaReady = false;

const ensureSchema = async () => {
  if (!schemaReady) {
    await pool.query(schemaSql);
    schemaReady = true;
  }
};

const getCurrentVersion = async (schoolId, versionId = null) => {
  if (versionId) {
    const selected = await pool.query(
      'SELECT * FROM timetable_versions WHERE school_id = $1 AND id = $2',
      [schoolId, versionId]
    );
    return selected.rows[0] || null;
  }
  const result = await pool.query(
    `SELECT * FROM timetable_versions WHERE school_id = $1
     ORDER BY CASE status WHEN 'DRAFT' THEN 0 WHEN 'PUBLISHED' THEN 1 ELSE 2 END,
              revision DESC, updated_at DESC LIMIT 1`,
    [schoolId]
  );
  return result.rows[0] || null;
};

const lockDraftVersion = async (client, schoolId, versionId, expectedRevision) => {
  if (!versionId || expectedRevision === undefined || expectedRevision === null) {
    return { error: { status: 428, message: 'A timetable version and expected revision are required.' } };
  }
  const result = await client.query(
    'SELECT * FROM timetable_versions WHERE school_id = $1 AND id = $2 FOR UPDATE',
    [schoolId, versionId]
  );
  const version = result.rows[0];
  if (!version) return { error: { status: 404, message: 'Timetable version not found.' } };
  if (version.status !== 'DRAFT') return { error: { status: 409, message: 'Only a draft timetable can be modified.' } };
  if (Number(version.revision) !== Number(expectedRevision)) {
    return { error: { status: 409, message: 'This timetable changed after it was opened. Reload the latest draft before saving.', current_revision: Number(version.revision) } };
  }
  return { version };
};

const getDraftTerm = async (schoolId, versionId) => {
  const result = await pool.query(
    `SELECT id, term_id, academic_year, term, revision FROM timetable_versions
     WHERE school_id = $1 AND id = $2 AND status = 'DRAFT'`,
    [schoolId, versionId]
  );
  return result.rows[0] || null;
};

const bumpDraftVersion = async (client, schoolId, versionId, actorId, action, entryId, beforeData, afterData) => {
  const result = await client.query(
    `UPDATE timetable_versions SET revision = revision + 1, updated_at = NOW()
     WHERE school_id = $1 AND id = $2 AND status = 'DRAFT' RETURNING revision`,
    [schoolId, versionId]
  );
  await client.query(
    `INSERT INTO timetable_audit_log (school_id, version_id, entry_id, actor_id, action, before_data, after_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [schoolId, versionId, entryId || null, actorId, action, beforeData ? JSON.stringify(beforeData) : null, afterData ? JSON.stringify(afterData) : null]
  );
  return Number(result.rows[0].revision);
};

const getVersions = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT * FROM timetable_versions WHERE school_id = $1
       AND ($2::TEXT = 'admin' OR status = 'PUBLISHED')
       ORDER BY academic_year DESC, term, revision DESC`,
      [school_id, req.user.role]
    );
    const school = await pool.query('SELECT academic_year, current_term FROM schools WHERE id = $1', [school_id]);
    const configured = school.rows[0] || {};
    const years = [...new Set([configured.academic_year, ...result.rows.map((version) => version.academic_year)].filter(Boolean))]
      .sort((a, b) => b.localeCompare(a));
    res.json({ versions: result.rows, current_version: null, academic_years: years,
      terms: ['Term 1', 'Term 2', 'Term 3'], school: configured });
  } catch (error) { next(error); }
};

const createVersion = async (req, res, next) => {
  const { school_id } = req.user;
  const academicYear = String(req.body.academic_year || '').trim();
  const term = String(req.body.term || '').trim();
  if (!academicYear || !term || !['Term 1', 'Term 2', 'Term 3'].includes(term)) return res.status(400).json({ message: 'Select an academic year and one of the configured terms.' });
  try {
    await ensureSchema();
    const duplicate = await pool.query(
      `SELECT id FROM timetable_versions WHERE school_id = $1 AND academic_year = $2 AND term = $3 AND status = 'DRAFT'`,
      [school_id, academicYear, term]
    );
    if (duplicate.rows.length) return res.status(409).json({ message: 'An editable draft already exists for this academic year and term.' });
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      const termResult = await client.query(
        `INSERT INTO timetable_terms (school_id, academic_year, term) VALUES ($1,$2,$3)
         ON CONFLICT (school_id, academic_year, term) DO UPDATE SET term = EXCLUDED.term RETURNING id`,
        [school_id, academicYear, term]
      );
      result = await client.query(
        `INSERT INTO timetable_versions (school_id, academic_year, term, term_id, revision, created_by)
         SELECT $1,$2,$3,$5,COALESCE(MAX(revision),0)+1,$4 FROM timetable_versions
         WHERE school_id = $1 AND academic_year = $2 AND term = $3 RETURNING *`,
        [school_id, academicYear, term, req.user.id, termResult.rows[0].id]
      );
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'A draft for this academic year and term already exists.' });
    next(error);
  }
};

const copyPreviousTerm = async (req, res, next) => {
  const { school_id, id: userId } = req.user;
  const targetId = Number(req.params.id);
  const sourceId = Number(req.body.source_version_id);
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await ensureSchema();
    await client.query('BEGIN'); transactionOpen = true;
    const locked = await lockDraftVersion(client, school_id, targetId, req.body.expected_revision);
    if (locked.error) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(locked.error.status).json(locked.error);
    }
    const target = locked.version;
    const sourceResult = await client.query(`SELECT * FROM timetable_versions WHERE school_id = $1 AND id = $2 FOR SHARE`, [school_id, sourceId]);
    const source = sourceResult.rows[0];
    if (!source || source.id === target.id || source.term_id === target.term_id) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(400).json({ message: 'Choose a timetable from a different academic year or term to copy.' });
    }
    const occupied = await client.query(`SELECT
      EXISTS(SELECT 1 FROM timetables WHERE school_id=$1 AND version_id=$2) AS has_lessons,
      EXISTS(SELECT 1 FROM timetable_periods WHERE school_id=$1 AND term_id=$3) AS has_periods,
      EXISTS(SELECT 1 FROM subject_weekly_requirements WHERE school_id=$1 AND term_id=$3) AS has_requirements,
      EXISTS(SELECT 1 FROM teacher_subject_assignments WHERE school_id=$1 AND term_id=$3) AS has_assignments`,
    [school_id, target.id, target.term_id]);
    if (Object.values(occupied.rows[0]).some(Boolean)) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(409).json({ message: 'This term already has timetable content. Copying is available only into an empty draft.' });
    }
    await client.query(`UPDATE timetable_terms target SET subject_teaching_starts_from = source.subject_teaching_starts_from
      FROM timetable_terms source WHERE target.school_id=$1 AND target.id=$2 AND source.school_id=$1 AND source.id=$3`,
    [school_id, target.term_id, source.term_id]);
    await client.query(`INSERT INTO timetable_periods (school_id, term_id, name, day_of_week, start_time, end_time, is_break, sort_order, is_active)
      SELECT school_id, $2, name, day_of_week, start_time, end_time, is_break, sort_order, is_active
      FROM timetable_periods WHERE school_id=$1 AND term_id=$3`, [school_id, target.term_id, source.term_id]);
    await client.query(`INSERT INTO teacher_subject_assignments (school_id, term_id, teacher_id, subject_id, class_id)
      SELECT school_id, $2, teacher_id, subject_id, class_id FROM teacher_subject_assignments WHERE school_id=$1 AND term_id=$3
      ON CONFLICT (school_id, term_id, teacher_id, subject_id, class_id) DO NOTHING`, [school_id, target.term_id, source.term_id]);
    await client.query(`INSERT INTO timetable_class_teacher_assignments (school_id, term_id, class_id, teacher_id)
      SELECT school_id, $2, class_id, teacher_id FROM timetable_class_teacher_assignments WHERE school_id=$1 AND term_id=$3
      ON CONFLICT (school_id, term_id, class_id) DO NOTHING`, [school_id, target.term_id, source.term_id]);
    await client.query(`INSERT INTO subject_weekly_requirements (school_id, term_id, class_id, subject_id, lessons_per_week, double_periods_per_week, room_required)
      SELECT school_id, $2, class_id, subject_id, lessons_per_week, double_periods_per_week, room_required FROM subject_weekly_requirements WHERE school_id=$1 AND term_id=$3
      ON CONFLICT (school_id, term_id, class_id, subject_id) DO NOTHING`, [school_id, target.term_id, source.term_id]);
    await client.query(`INSERT INTO teacher_availability (school_id, term_id, teacher_id, day_of_week, start_time, end_time, is_available, reason)
      SELECT school_id, $2, teacher_id, day_of_week, start_time, end_time, is_available, reason FROM teacher_availability WHERE school_id=$1 AND term_id=$3`, [school_id, target.term_id, source.term_id]);
    await client.query(`INSERT INTO class_availability (school_id, term_id, class_id, day_of_week, start_time, end_time, is_available, reason)
      SELECT school_id, $2, class_id, day_of_week, start_time, end_time, is_available, reason FROM class_availability WHERE school_id=$1 AND term_id=$3`, [school_id, target.term_id, source.term_id]);
    await client.query(`INSERT INTO room_availability (school_id, term_id, room_id, day_of_week, start_time, end_time, is_available, reason)
      SELECT school_id, $2, room_id, day_of_week, start_time, end_time, is_available, reason FROM room_availability WHERE school_id=$1 AND term_id=$3`, [school_id, target.term_id, source.term_id]);
    await client.query(`INSERT INTO teacher_workload_limits (school_id, term_id, teacher_id, max_periods_per_week)
      SELECT school_id, $2, teacher_id, max_periods_per_week FROM teacher_workload_limits WHERE school_id=$1 AND term_id=$3
      ON CONFLICT (school_id, term_id, teacher_id) DO NOTHING`, [school_id, target.term_id, source.term_id]);
    const copied = await client.query(`INSERT INTO timetables
      (school_id, version_id, class_id, subject_id, teacher_id, room_id, period_id, period_count,
       day_of_week, start_time, end_time, subject, academic_year, term, term_id, status,
       class_name_snapshot, subject_name_snapshot, teacher_name_snapshot, room_name_snapshot, is_locked)
      SELECT t.school_id, $3, t.class_id, t.subject_id, t.teacher_id, t.room_id,
        (SELECT np.id FROM timetable_periods op JOIN timetable_periods np
          ON np.school_id=op.school_id AND np.term_id=$4 AND np.name=op.name AND np.start_time=op.start_time
           AND np.end_time=op.end_time AND np.day_of_week IS NOT DISTINCT FROM op.day_of_week
          WHERE op.id=t.period_id LIMIT 1), t.period_count, t.day_of_week, t.start_time, t.end_time, t.subject,
        $5, $6, $4, 'DRAFT', t.class_name_snapshot, t.subject_name_snapshot, t.teacher_name_snapshot, t.room_name_snapshot, FALSE
      FROM timetables t WHERE t.school_id=$1 AND t.version_id=$2 AND t.class_id IS NOT NULL RETURNING id`,
    [school_id, source.id, target.id, target.term_id, target.academic_year, target.term]);
    const revision = await bumpDraftVersion(client, school_id, target.id, userId, 'COPY_PREVIOUS_TERM', null, null,
      { source_version_id: source.id, source_academic_year: source.academic_year, source_term: source.term, lessons_copied: copied.rowCount });
    await client.query('COMMIT'); transactionOpen = false;
    res.status(201).json({ version_id: target.id, source_version_id: source.id, lessons_copied: copied.rowCount, revision });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
};

const normalizeTime = (value) => String(value || '').slice(0, 5);
const overlapsSql = '(start_time < $4::TIME AND end_time > $3::TIME)';

const sameId = (a, b) => String(a || '') === String(b || '');

const getSubjectName = (entry) => entry.subject_name || entry.subject || 'Subject';

const validateTime = (startTime, endTime) => {
  if (!startTime || !endTime) return 'Start and end times are required.';
  if (normalizeTime(startTime) >= normalizeTime(endTime)) return 'Start time must be before end time.';
  return null;
};

const loadPeriod = async (schoolId, termId, periodId) => {
  if (!periodId) return null;
  const result = await pool.query(
    'SELECT * FROM timetable_periods WHERE id = $1 AND school_id = $2 AND term_id = $3 AND is_active = TRUE',
    [periodId, schoolId, termId]
  );
  return result.rows[0] || null;
};

const resolveSubjectId = async (schoolId, subjectId, subject) => {
  if (subjectId) return Number(subjectId);
  if (!subject) return null;
  const result = await pool.query('SELECT id FROM subjects WHERE school_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1', [schoolId, subject]);
  return result.rows[0]?.id || null;
};

const resolveTeacherId = async (schoolId, termId, classId, subjectId, teacherId) => {
  if (teacherId) return Number(teacherId);
  if (subjectId) {
    const assignment = await pool.query(
      `SELECT teacher_id FROM teacher_subject_assignments
       WHERE school_id = $1 AND class_id = $2 AND subject_id = $3 AND term_id = $4
       ORDER BY id LIMIT 1`,
      [schoolId, classId, subjectId, termId]
    );
    if (assignment.rows[0]) return assignment.rows[0].teacher_id;
  }
  const klass = await pool.query(
    'SELECT class_teacher_id, year_level, teaching_model FROM classes WHERE school_id = $1 AND id = $2',
    [schoolId, classId]
  );
  const record = klass.rows[0];
  return record && Number(record.year_level) <= 3 && record.teaching_model === 'class_teacher'
    ? record.class_teacher_id
    : null;
};

const createConflict = (type, message, details = {}) => ({ type, message, details });

const calculateAvailableClassCapacity = (validDays, slots) => {
  const slotsByDay = new Map();
  for (const slot of slots) {
    const day = slot.day_of_week;
    if (day && validDays.includes(day)) {
      slotsByDay.set(day, (slotsByDay.get(day) || 0) + 1);
    }
  }
  return validDays.reduce((total, day) => total + (slotsByDay.get(day) || 0), 0);
};

const getEntryContext = async (schoolId, entryId) => {
  const result = await pool.query(
    `SELECT t.*, COALESCE(t.class_name_snapshot, c.name) AS class_name,
            COALESCE(t.subject_name_snapshot, s.name, t.subject) AS subject_name,
            COALESCE(t.teacher_name_snapshot, u.name) AS teacher_name,
            COALESCE(t.room_name_snapshot, r.name) AS room_name
     FROM timetables t
     LEFT JOIN classes c ON t.class_id = c.id
     LEFT JOIN subjects s ON t.subject_id = s.id
     LEFT JOIN users u ON t.teacher_id = u.id
     LEFT JOIN timetable_rooms r ON t.room_id = r.id
     WHERE t.school_id = $1 AND t.id = $2`,
    [schoolId, entryId]
  );
  return result.rows[0];
};

const getConflictsForSlot = async (schoolId, entry, options = {}) => {
  const { excludeId = null, requireAssignment = true, ignoreVersionEntries = false } = options;
  const conflicts = [];
  const startTime = normalizeTime(entry.start_time);
  const endTime = normalizeTime(entry.end_time);

  const classRows = await pool.query(
    `SELECT t.id, t.subject, t.start_time, t.end_time, c.name AS class_name, s.name AS subject_name
     FROM timetables t
     JOIN classes c ON t.class_id = c.id
     LEFT JOIN subjects s ON t.subject_id = s.id
     WHERE t.school_id = $1 AND t.version_id = $7 AND t.day_of_week = $2 AND ${overlapsSql}
       AND t.class_id = $5 AND ($6::INTEGER IS NULL OR t.id <> $6::INTEGER)
       AND $8::BOOLEAN = FALSE`,
     [schoolId, entry.day_of_week, startTime, endTime, entry.class_id, excludeId, entry.version_id, ignoreVersionEntries]
  );
  classRows.rows.forEach((row) => {
    conflicts.push(createConflict(
      'CLASS_CONFLICT',
      `Class Conflict: ${row.class_name} is already scheduled for ${getSubjectName(row)} from ${normalizeTime(row.start_time)} to ${normalizeTime(row.end_time)} on ${entry.day_of_week}.`,
      row
    ));
  });

  if (entry.teacher_id) {
    const teacherRows = await pool.query(
      `SELECT t.id, t.subject, t.start_time, t.end_time, c.name AS class_name, s.name AS subject_name, u.name AS teacher_name
       FROM timetables t
       JOIN classes c ON t.class_id = c.id
       LEFT JOIN subjects s ON t.subject_id = s.id
       LEFT JOIN users u ON t.teacher_id = u.id
       WHERE t.school_id = $1 AND t.version_id = $7 AND t.day_of_week = $2 AND ${overlapsSql}
        AND t.teacher_id = $5 AND ($6::INTEGER IS NULL OR t.id <> $6::INTEGER)
        AND $8::BOOLEAN = FALSE`,
      [schoolId, entry.day_of_week, startTime, endTime, entry.teacher_id, excludeId, entry.version_id, ignoreVersionEntries]
    );
    teacherRows.rows.forEach((row) => {
      conflicts.push(createConflict(
        'TEACHER_CONFLICT',
        `Teacher Conflict: ${row.teacher_name} is already teaching ${getSubjectName(row)} in ${row.class_name} from ${normalizeTime(row.start_time)} to ${normalizeTime(row.end_time)} on ${entry.day_of_week}.`,
        row
      ));
    });

    const unavailable = await pool.query(
      `SELECT a.*, u.name AS teacher_name
       FROM teacher_availability a
       JOIN users u ON a.teacher_id = u.id
       WHERE a.school_id = $1 AND a.teacher_id = $5 AND a.day_of_week = $2 AND a.term_id = $6
         AND a.is_available = FALSE AND ${overlapsSql}`,
      [schoolId, entry.day_of_week, startTime, endTime, entry.teacher_id, entry.term_id]
    );
    unavailable.rows.forEach((row) => {
      conflicts.push(createConflict(
        'TEACHER_AVAILABILITY_CONFLICT',
        `Availability Conflict: ${row.teacher_name} is unavailable from ${normalizeTime(row.start_time)} to ${normalizeTime(row.end_time)} on ${entry.day_of_week}${row.reason ? ` (${row.reason})` : ''}.`,
        row
      ));
    });
  }

  const classUnavailable = await pool.query(
    `SELECT a.*, c.name AS class_name
     FROM class_availability a
     JOIN classes c ON a.class_id = c.id
     WHERE a.school_id = $1 AND a.class_id = $5 AND a.day_of_week = $2 AND a.term_id = $6
       AND a.is_available = FALSE AND ${overlapsSql}`,
    [schoolId, entry.day_of_week, startTime, endTime, entry.class_id, entry.term_id]
  );
  classUnavailable.rows.forEach((row) => {
    conflicts.push(createConflict(
      'CLASS_AVAILABILITY_CONFLICT',
      `Availability Conflict: ${row.class_name} is unavailable from ${normalizeTime(row.start_time)} to ${normalizeTime(row.end_time)} on ${entry.day_of_week}${row.reason ? ` (${row.reason})` : ''}.`,
      row
    ));
  });

  if (entry.room_id) {
    const roomRows = await pool.query(
      `SELECT t.id, t.start_time, t.end_time, c.name AS class_name, s.name AS subject_name, r.name AS room_name
       FROM timetables t
       JOIN classes c ON t.class_id = c.id
       LEFT JOIN subjects s ON t.subject_id = s.id
       LEFT JOIN timetable_rooms r ON t.room_id = r.id
       WHERE t.school_id = $1 AND t.version_id = $7 AND t.day_of_week = $2 AND ${overlapsSql}
        AND t.room_id = $5 AND ($6::INTEGER IS NULL OR t.id <> $6::INTEGER)
        AND $8::BOOLEAN = FALSE`,
      [schoolId, entry.day_of_week, startTime, endTime, entry.room_id, excludeId, entry.version_id, ignoreVersionEntries]
    );
    roomRows.rows.forEach((row) => {
      conflicts.push(createConflict(
        'ROOM_CONFLICT',
        `Room Conflict: ${row.room_name} is already used by ${row.class_name} for ${getSubjectName(row)} from ${normalizeTime(row.start_time)} to ${normalizeTime(row.end_time)} on ${entry.day_of_week}.`,
        row
      ));
    });

    const roomUnavailable = await pool.query(
      `SELECT a.*, r.name AS room_name
       FROM room_availability a
       JOIN timetable_rooms r ON a.room_id = r.id
       WHERE a.school_id = $1 AND a.room_id = $5 AND a.day_of_week = $2 AND a.term_id = $6
         AND a.is_available = FALSE AND ${overlapsSql}`,
      [schoolId, entry.day_of_week, startTime, endTime, entry.room_id, entry.term_id]
    );
    roomUnavailable.rows.forEach((row) => {
      conflicts.push(createConflict(
        'ROOM_AVAILABILITY_CONFLICT',
        `Availability Conflict: ${row.room_name} is unavailable from ${normalizeTime(row.start_time)} to ${normalizeTime(row.end_time)} on ${entry.day_of_week}${row.reason ? ` (${row.reason})` : ''}.`,
        row
      ));
    });
  }

  if (requireAssignment && (!entry.teacher_id || !entry.subject_id || !entry.class_id)) {
    conflicts.push(createConflict('TEACHER_REQUIRED', 'Every lesson must have a valid assigned teaching teacher.'));
  }

  if (requireAssignment && entry.teacher_id && entry.subject_id && entry.class_id) {
    const assignment = await pool.query(
      `SELECT id FROM teacher_subject_assignments
       WHERE school_id = $1 AND teacher_id = $2 AND subject_id = $3 AND class_id = $4 AND term_id = $5`,
      [schoolId, entry.teacher_id, entry.subject_id, entry.class_id, entry.term_id]
    );
    const context = await pool.query(
      `SELECT u.name AS teacher_name, s.name AS subject_name, c.name AS class_name,
              c.year_level, c.teaching_model,
              (SELECT ca.teacher_id FROM timetable_class_teacher_assignments ca
               WHERE ca.school_id = c.school_id AND ca.term_id = $5 AND ca.class_id = c.id) AS class_teacher_id
       FROM users u
       JOIN subjects s ON s.school_id = u.school_id
       JOIN classes c ON c.school_id = u.school_id
       WHERE u.id = $1 AND s.id = $2 AND c.id = $3 AND u.school_id = $4
         AND u.role = 'teacher' AND u.is_active = TRUE`,
      [entry.teacher_id, entry.subject_id, entry.class_id, schoolId, entry.term_id]
    );
    const row = context.rows[0] || {};
      const classTeacherMayTeach = Number(row.year_level) >= 1 && Number(row.year_level) <= 3
      && row.teaching_model === 'class_teacher'
      && String(row.class_teacher_id) === String(entry.teacher_id);
    if (!context.rows.length || (!assignment.rows.length && !classTeacherMayTeach)) {
      conflicts.push(createConflict(
        'SUBJECT_ASSIGNMENT_CONFLICT',
        `Subject Assignment Conflict: ${row.teacher_name || 'This teacher'} is not assigned to teach ${row.subject_name || 'this subject'} in ${row.class_name || 'this class'}.`,
        row
      ));
    }

    const workload = await pool.query(
      `SELECT max_periods_per_week,
              COALESCE((SELECT SUM(t.period_count) FROM timetables t
                WHERE t.school_id = $1 AND t.version_id = $2 AND t.teacher_id = $3
                  AND ($4::INTEGER IS NULL OR t.id <> $4::INTEGER)), 0)::INTEGER AS used_periods
       FROM teacher_workload_limits WHERE school_id = $1 AND teacher_id = $3 AND term_id = $5`,
      [schoolId, entry.version_id, entry.teacher_id, excludeId, entry.term_id]
    );
    const limit = workload.rows[0];
    if (limit && Number(limit.used_periods) + Number(entry.period_count || 1) > Number(limit.max_periods_per_week)) {
      conflicts.push(createConflict(
        'TEACHER_WORKLOAD_CONFLICT',
        `${row.teacher_name || 'This teacher'} would exceed the weekly workload limit of ${limit.max_periods_per_week} periods.`,
        { used_periods: Number(limit.used_periods), max_periods_per_week: Number(limit.max_periods_per_week) }
      ));
    }
  }

  const configuredPeriods = await pool.query(
    `SELECT name, start_time, end_time, is_break FROM timetable_periods
     WHERE school_id = $1 AND is_active = TRUE AND (day_of_week = $2 OR day_of_week IS NULL) AND term_id = $3
     ORDER BY sort_order, start_time`,
    [schoolId, entry.day_of_week, entry.term_id]
  );
  if (configuredPeriods.rows.length) {
    // A double lesson spans two configured teaching periods, so validate the
    // entire interval as a contiguous chain instead of requiring one period
    // row to match its combined start and end times.
    const periodsInSpan = configuredPeriods.rows
      .filter((period) => normalizeTime(period.start_time) >= startTime
        && normalizeTime(period.end_time) <= endTime)
      .sort((left, right) => normalizeTime(left.start_time).localeCompare(normalizeTime(right.start_time)));
    let coveredUntil = startTime;
    let overlapsBreak = false;
    for (const period of periodsInSpan) {
      const periodStart = normalizeTime(period.start_time);
      const periodEnd = normalizeTime(period.end_time);
      if (period.is_break && periodStart < endTime && periodEnd > startTime) overlapsBreak = true;
      if (periodStart !== coveredUntil) continue;
      if (period.is_break) break;
      coveredUntil = periodEnd;
      if (coveredUntil === endTime) break;
    }
    if (coveredUntil !== endTime) {
      conflicts.push(createConflict('OUTSIDE_CONFIGURED_PERIOD', 'Lesson must fit exactly within a configured teaching period.'));
    }
    if (overlapsBreak) {
      const breakPeriod = configuredPeriods.rows.find((period) => period.is_break
        && normalizeTime(period.start_time) < endTime && normalizeTime(period.end_time) > startTime);
      conflicts.push(createConflict('BREAK_PERIOD', `Lesson overlaps ${breakPeriod?.name || 'a non-teaching period'}.`));
    }
  }

  return conflicts;
};

const findSuggestions = async (schoolId, entry, limit = 6, excludeId = null) => {
  const periods = await pool.query(
    `SELECT * FROM timetable_periods
     WHERE school_id = $1 AND term_id = $2 AND is_active = TRUE AND is_break = FALSE
     ORDER BY day_of_week NULLS FIRST, sort_order, start_time`,
    [schoolId, entry.term_id]
  );
  const candidates = [];
  const source = periods.rows.length ? periods.rows : DEFAULT_PERIODS.flatMap((p, index) => DAYS.map((day) => ({ ...p, day_of_week: day, sort_order: index + 1 })));

  for (let index = 0; index < source.length; index += 1) {
    const period = source[index];
    if (period.is_break) continue;
    const days = period.day_of_week ? [period.day_of_week] : DAYS;
    for (const day of days) {
      let endTime = normalizeTime(period.end_time);
      if (Number(entry.period_count || 1) === 2) {
        const nextPeriod = source.slice(index + 1).find((candidate) => !candidate.is_break
          && (candidate.day_of_week === day || candidate.day_of_week === null)
          && normalizeTime(candidate.start_time) === normalizeTime(period.end_time));
        if (!nextPeriod) continue;
        endTime = normalizeTime(nextPeriod.end_time);
      }
      const candidate = {
        ...entry,
        day_of_week: day,
        start_time: normalizeTime(period.start_time),
        end_time: endTime,
        period_id: period.id || null,
      };
      const conflicts = await getConflictsForSlot(schoolId, candidate, { requireAssignment: true, excludeId });
      if (!conflicts.length) {
        candidates.push({
          day_of_week: day,
          start_time: candidate.start_time,
          end_time: candidate.end_time,
          period_id: candidate.period_id,
          reason: 'Teacher, class, subject authorization, room, availability, workload and configured-period checks passed.',
        });
      }
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
};

const hydrateTimetableRows = async (schoolId, filters = {}) => {
  const values = [schoolId];
  const clauses = ['t.school_id = $1'];

  if (filters.versionId) {
    values.push(filters.versionId);
    clauses.push(`t.version_id = $${values.length}`);
  }

  if (filters.classId) {
    values.push(filters.classId);
    clauses.push(`t.class_id = $${values.length}`);
  }
  if (filters.teacherId) {
    values.push(filters.teacherId);
    clauses.push(`(t.teacher_id = $${values.length} OR c.class_teacher_id = $${values.length})`);
  }
  if (filters.roomId) {
    values.push(filters.roomId);
    clauses.push(`t.room_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`t.status = $${values.length}`);
  }

  const result = await pool.query(
        `SELECT t.*, COALESCE(t.class_name_snapshot, c.name) AS class_name, c.class_teacher_id, c.year_level, c.teaching_model,
          ct.name AS class_teacher_name, COALESCE(t.subject_name_snapshot, s.name, t.subject) AS subject_name, COALESCE(t.teacher_name_snapshot, u.name) AS teacher_name,
            COALESCE(t.room_name_snapshot, r.name) AS room_name, p.name AS period_name, p.is_break
       FROM timetables t
       LEFT JOIN classes c ON t.school_id = c.school_id AND t.class_id = c.id
         LEFT JOIN users ct ON ct.id = c.class_teacher_id
     LEFT JOIN subjects s ON t.subject_id = s.id
     LEFT JOIN users u ON t.teacher_id = u.id
     LEFT JOIN timetable_rooms r ON t.room_id = r.id
     LEFT JOIN timetable_periods p ON t.period_id = p.id
     WHERE ${clauses.join(' AND ')}
     ORDER BY array_position(ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'], t.day_of_week),
              t.start_time, c.name`,
    values
  );
  return result.rows.map((row) => ({ ...row, subject: row.subject_name || row.subject }));
};

const getTimetable = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;
  const { classId, teacherId, roomId, status } = req.query;
  const versionId = req.query.version_id || req.query.versionId;

  try {
    await ensureSchema();
    const school = await pool.query('SELECT academic_year, current_term FROM schools WHERE id = $1', [school_id]);
    const academicYear = req.query.academic_year || school.rows[0]?.academic_year;
    const term = req.query.term || school.rows[0]?.current_term;
    let version = null;
    if (versionId) {
      const selected = await pool.query(
        `SELECT * FROM timetable_versions WHERE school_id = $1 AND id = $2
         AND ($3::TEXT = 'admin' OR status = 'PUBLISHED')`,
        [school_id, versionId, role]
      );
      version = selected.rows[0] || null;
    }
    if (versionId && !version) return res.status(404).json({ message: 'Timetable version not found.' });
    if (!version && academicYear && term) {
      const result = await pool.query(
        `SELECT * FROM timetable_versions WHERE school_id = $1 AND academic_year = $2 AND term = $3
         AND status ${role === 'admin' ? "IN ('DRAFT','PUBLISHED')" : "= 'PUBLISHED'"}
         ORDER BY CASE status WHEN 'DRAFT' THEN 0 ELSE 1 END, revision DESC LIMIT 1`,
        [school_id, academicYear, term]
      );
      version = result.rows[0];
    }
    if (!version) return res.json([]);
    const filters = { classId, teacherId, roomId, status: role === 'admin' ? status : undefined, versionId: version.id };

    if (role === 'student') {
      const result = await pool.query('SELECT class_id FROM students WHERE user_id = $1 AND school_id = $2 LIMIT 1', [userId, school_id]);
      filters.classId = result.rows[0]?.class_id || 0;
    } else if (role === 'parent') {
      const rows = await pool.query(
        `SELECT s.class_id FROM students s
         JOIN student_parent sp ON s.id = sp.student_id
         JOIN parents p ON sp.parent_id = p.id
         WHERE p.user_id = $1 AND s.school_id = $2`,
        [userId, school_id]
      );
      if (!rows.rows.length) return res.json([]);
      const result = await pool.query(
        `SELECT t.*, COALESCE(t.class_name_snapshot, c.name) AS class_name, COALESCE(t.subject_name_snapshot, s.name, t.subject) AS subject_name,
                COALESCE(t.teacher_name_snapshot, u.name) AS teacher_name, COALESCE(t.room_name_snapshot, r.name) AS room_name, p.name AS period_name
         FROM timetables t
     LEFT JOIN classes c ON t.school_id = c.school_id AND t.class_id = c.id
         LEFT JOIN subjects s ON t.subject_id = s.id
         LEFT JOIN users u ON t.teacher_id = u.id
         LEFT JOIN timetable_rooms r ON t.room_id = r.id
         LEFT JOIN timetable_periods p ON t.period_id = p.id
         WHERE t.school_id = $1 AND t.version_id = $3 AND t.class_id = ANY($2::INTEGER[])
         ORDER BY t.day_of_week, t.start_time`,
        [school_id, rows.rows.map((row) => row.class_id).filter(Boolean), version.id]
      );
      return res.json(result.rows.map((row) => ({ ...row, subject: row.subject_name || row.subject })));
    } else if (role === 'teacher') {
      filters.teacherId = userId;
      if (classId) {
        const assigned = await pool.query(
          'SELECT id FROM classes WHERE school_id = $1 AND id = $2 AND class_teacher_id = $3',
          [school_id, classId, userId]
        );
        if (!assigned.rows.length && Number(teacherId) !== Number(userId)) {
          return res.status(403).json({ message: 'Teachers can only view their own lessons and assigned classes.' });
        }
      }
    }

    const rows = await hydrateTimetableRows(school_id, filters);
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

const getTimetableMeta = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    await ensureSchema();
    const [classes, teachers, subjects, rooms, settings, versions] = await Promise.all([
      pool.query(`SELECT c.id, c.name, c.description, c.teacher_id, c.class_teacher_id, c.year_level, c.teaching_model, u.name AS class_teacher_name
        FROM classes c LEFT JOIN users u ON u.id = c.class_teacher_id WHERE c.school_id = $1 ORDER BY c.year_level NULLS LAST, c.name`, [school_id]),
      pool.query("SELECT id, name, email, subjects FROM users WHERE school_id = $1 AND role = 'teacher' AND is_active = TRUE ORDER BY name", [school_id]),
      pool.query('SELECT * FROM subjects WHERE school_id = $1 ORDER BY name', [school_id]),
      pool.query('SELECT * FROM timetable_rooms WHERE school_id = $1 AND is_active = TRUE ORDER BY name', [school_id]),
      pool.query('SELECT academic_year, current_term FROM schools WHERE id = $1', [school_id]),
      pool.query('SELECT * FROM timetable_versions WHERE school_id = $1 ORDER BY academic_year DESC, term, revision DESC', [school_id]),
    ]);
    const version = req.query.version_id ? versions.rows.find((row) => Number(row.id) === Number(req.query.version_id)) : null;
    if (req.query.version_id && !version) return res.status(404).json({ message: 'Timetable version not found.' });
    let periods = [], assignments = [], classTeacherAssignments = [], availability = [], requirements = [], workloadLimits = [];
    let termSettings = {};
    if (version) {
      const termId = version.term_id;
      const scoped = await Promise.all([
        pool.query('SELECT * FROM timetable_periods WHERE school_id = $1 AND term_id = $2 ORDER BY day_of_week NULLS FIRST, sort_order, start_time', [school_id, termId]),
        pool.query(`SELECT a.*, u.name AS teacher_name, s.name AS subject_name, c.name AS class_name FROM teacher_subject_assignments a
          JOIN users u ON a.teacher_id = u.id JOIN subjects s ON a.subject_id = s.id JOIN classes c ON a.class_id = c.id
          WHERE a.school_id = $1 AND a.term_id = $2 ORDER BY c.name, s.name, u.name`, [school_id, termId]),
        pool.query(`SELECT a.*, u.name AS teacher_name, c.name AS class_name FROM timetable_class_teacher_assignments a
          JOIN users u ON a.teacher_id = u.id JOIN classes c ON a.class_id = c.id
          WHERE a.school_id = $1 AND a.term_id = $2 ORDER BY c.name`, [school_id, termId]),
        pool.query(`SELECT 'teacher' AS type, id, teacher_id AS owner_id, NULL::INTEGER AS class_id, NULL::INTEGER AS room_id, day_of_week, start_time, end_time, is_available, reason FROM teacher_availability WHERE school_id = $1 AND term_id = $2
          UNION ALL SELECT 'class', id, NULL::INTEGER, class_id, NULL::INTEGER, day_of_week, start_time, end_time, is_available, reason FROM class_availability WHERE school_id = $1 AND term_id = $2
          UNION ALL SELECT 'room', id, NULL::INTEGER, NULL::INTEGER, room_id, day_of_week, start_time, end_time, is_available, reason FROM room_availability WHERE school_id = $1 AND term_id = $2 ORDER BY type, day_of_week, start_time`, [school_id, termId]),
        pool.query(`SELECT r.*, c.name AS class_name, s.name AS subject_name FROM subject_weekly_requirements r JOIN classes c ON r.class_id = c.id JOIN subjects s ON r.subject_id = s.id
          WHERE r.school_id = $1 AND r.term_id = $2 ORDER BY c.name, s.name`, [school_id, termId]),
        pool.query(`SELECT l.*, u.name AS teacher_name FROM teacher_workload_limits l JOIN users u ON u.id = l.teacher_id WHERE l.school_id = $1 AND l.term_id = $2 ORDER BY u.name`, [school_id, termId]),
        pool.query('SELECT academic_year, term, subject_teaching_starts_from FROM timetable_terms WHERE school_id = $1 AND id = $2', [school_id, termId]),
      ]);
      [periods, assignments, classTeacherAssignments, availability, requirements, workloadLimits] = scoped.slice(0, 6).map((result) => result.rows);
      termSettings = scoped[6].rows[0] || {};
    }
    const academicYears = [...new Set([settings.rows[0]?.academic_year, ...versions.rows.map((row) => row.academic_year)].filter(Boolean))].sort((a, b) => b.localeCompare(a));
    res.json({ classes: classes.rows, teachers: teachers.rows, subjects: subjects.rows, rooms: rooms.rows,
      periods, assignments, class_teacher_assignments: classTeacherAssignments, availability, requirements, versions: versions.rows, current_version: version,
      academic_years: academicYears, terms: ['Term 1', 'Term 2', 'Term 3'], workload_limits: workloadLimits,
      settings: { ...settings.rows[0], ...termSettings } });
  } catch (error) {
    next(error);
  }
};

const resolveLessonSlot = async (schoolId, termId, payload) => {
  const periodCount = Number(payload.period_count || 1);
  if (![1, 2].includes(periodCount)) return { error: 'Lessons may occupy one period or a supported consecutive double period.' };
  const period = await loadPeriod(schoolId, termId, payload.period_id);
  if (payload.period_id && !period) return { error: 'The selected period is inactive or does not belong to this school.' };
  let endTime = normalizeTime(period?.end_time || payload.end_time);
  if (periodCount === 2) {
    if (!period || period.is_break) return { error: 'Double periods must start in a configured teaching period.' };
    const next = await pool.query(
      `SELECT * FROM timetable_periods
       WHERE school_id = $1 AND term_id = $4 AND is_active = TRUE AND is_break = FALSE
         AND start_time = $2 AND (day_of_week = $3 OR day_of_week IS NULL)
       ORDER BY day_of_week DESC NULLS LAST, sort_order LIMIT 1`,
      [schoolId, period.end_time, payload.day_of_week, termId]
    );
    if (!next.rows[0]) return { error: 'There is no consecutive teaching period for this double-period lesson.' };
    endTime = normalizeTime(next.rows[0].end_time);
  }
  const startTime = normalizeTime(period?.start_time || payload.start_time);
  const timeError = validateTime(startTime, endTime);
  return timeError ? { error: timeError } : { period, periodCount, startTime, endTime };
};

const sendConflictResponse = async (res, schoolId, version, entry, conflicts, excludeId = null) => {
  const suggestions = await findSuggestions(schoolId, { ...entry, version_id: version.id }, 6, excludeId);
  return res.status(409).json({ message: conflicts[0].message, conflicts, suggestions, current_revision: Number(version.revision) });
};

const createTimetableEntry = async (req, res, next) => {
  const { school_id, id: userId } = req.user;
  const payload = req.body;
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await ensureSchema();
    await client.query('BEGIN');
    transactionOpen = true;
    const locked = await lockDraftVersion(client, school_id, payload.version_id, payload.expected_revision);
    if (locked.error) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(locked.error.status).json(locked.error);
    }
    const version = locked.version;
    const slot = await resolveLessonSlot(school_id, version.term_id, payload);
    if (slot.error) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ message: slot.error });
    }
    const subjectId = await resolveSubjectId(school_id, payload.subject_id, payload.subject);
    const teacherId = await resolveTeacherId(school_id, version.term_id, payload.class_id, subjectId, payload.teacher_id);
    if (!payload.class_id || !payload.day_of_week || !subjectId) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ message: 'Class, day, and subject are required.' });
    }
    const entry = {
      version_id: version.id,
      term_id: version.term_id,
      class_id: Number(payload.class_id),
      subject_id: subjectId,
      teacher_id: teacherId,
      room_id: payload.room_id || null,
      period_id: slot.period?.id || null,
      period_count: slot.periodCount,
      day_of_week: payload.day_of_week,
      start_time: slot.startTime,
      end_time: slot.endTime,
    };
    const conflicts = await getConflictsForSlot(school_id, entry);
    if (conflicts.length) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return sendConflictResponse(res, school_id, version, entry, conflicts);
    }

    const subjectName = await client.query('SELECT name FROM subjects WHERE id = $1 AND school_id = $2', [subjectId, school_id]);
    const inserted = await client.query(
      `INSERT INTO timetables
       (school_id, version_id, class_id, subject_id, teacher_id, room_id, period_id, period_count,
        day_of_week, start_time, end_time, subject, academic_year, term, term_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'DRAFT') RETURNING *`,
      [school_id, version.id, entry.class_id, entry.subject_id, entry.teacher_id, entry.room_id,
        entry.period_id, entry.period_count, entry.day_of_week, entry.start_time, entry.end_time,
        subjectName.rows[0]?.name || payload.subject || 'Subject', version.academic_year, version.term, version.term_id]
    );
    await client.query(`UPDATE timetables t SET class_name_snapshot = (SELECT name FROM classes WHERE id = t.class_id),
      subject_name_snapshot = (SELECT name FROM subjects WHERE id = t.subject_id),
      teacher_name_snapshot = (SELECT name FROM users WHERE id = t.teacher_id),
      room_name_snapshot = (SELECT name FROM timetable_rooms WHERE id = t.room_id) WHERE t.id = $1`, [inserted.rows[0].id]);
    const revision = await bumpDraftVersion(client, school_id, version.id, userId, 'CREATE_LESSON', inserted.rows[0].id, null, inserted.rows[0]);
    await client.query('COMMIT');
    transactionOpen = false;
    const row = await getEntryContext(school_id, inserted.rows[0].id);
    res.status(201).json({ ...row, subject: row.subject_name || row.subject, revision });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23P01') return res.status(409).json({ message: 'This lesson overlaps a class, teacher, or room booking.', conflicts: [{ type: 'DATABASE_OVERLAP', message: error.detail || error.message }] });
    next(error);
  } finally { client.release(); }
};

const updateTimetableEntry = async (req, res, next) => {
  const { school_id, id: userId } = req.user;
  const { id } = req.params;
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await ensureSchema();
    await client.query('BEGIN');
    transactionOpen = true;
    const existing = await getEntryContext(school_id, id);
    if (!existing) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Timetable entry not found.' });
    }
    if (existing.is_locked) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'This approved lesson is locked. Unlock it before editing.' });
    }
    const locked = await lockDraftVersion(client, school_id, existing.version_id, req.body.expected_revision);
    if (locked.error) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(locked.error.status).json(locked.error);
    }

    const payload = { ...existing, ...req.body };
    const slot = await resolveLessonSlot(school_id, locked.version.term_id, payload);
    if (slot.error) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ message: slot.error });
    }
    const subjectId = await resolveSubjectId(school_id, payload.subject_id, payload.subject);
    const entry = {
      version_id: existing.version_id,
      term_id: locked.version.term_id,
      class_id: Number(payload.class_id),
      subject_id: subjectId,
      teacher_id: await resolveTeacherId(school_id, locked.version.term_id, payload.class_id, subjectId, payload.teacher_id),
      room_id: payload.room_id || null,
      period_id: slot.period?.id || null,
      period_count: slot.periodCount,
      day_of_week: payload.day_of_week,
      start_time: slot.startTime,
      end_time: slot.endTime,
    };

    const conflicts = await getConflictsForSlot(school_id, entry, { excludeId: id });
    if (conflicts.length) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return sendConflictResponse(res, school_id, locked.version, entry, conflicts, id);
    }

    const subjectName = await client.query('SELECT name FROM subjects WHERE id = $1 AND school_id = $2', [subjectId, school_id]);
    const updated = await client.query(
      `UPDATE timetables SET class_id=$1, subject_id=$2, teacher_id=$3, room_id=$4,
        period_id=$5, period_count=$6, day_of_week=$7, start_time=$8, end_time=$9,
        subject=$10, class_name_snapshot=(SELECT name FROM classes WHERE id=$1),
        subject_name_snapshot=(SELECT name FROM subjects WHERE id=$2),
        teacher_name_snapshot=(SELECT name FROM users WHERE id=$3),
        room_name_snapshot=(SELECT name FROM timetable_rooms WHERE id=$4), updated_at=NOW()
       WHERE id=$11 AND school_id=$12 AND version_id=$13 RETURNING *`,
      [entry.class_id, entry.subject_id, entry.teacher_id, entry.room_id, entry.period_id,
        entry.period_count, entry.day_of_week, entry.start_time, entry.end_time,
        subjectName.rows[0]?.name || payload.subject || existing.subject, id, school_id, existing.version_id]
    );
    const revision = await bumpDraftVersion(client, school_id, existing.version_id, userId, 'UPDATE_LESSON', id, existing, updated.rows[0]);
    await client.query('COMMIT');
    transactionOpen = false;
    res.json({ ...updated.rows[0], revision });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23P01') return res.status(409).json({ message: 'This lesson overlaps a class, teacher, or room booking.', conflicts: [{ type: 'DATABASE_OVERLAP', message: error.detail || error.message }] });
    next(error);
  } finally { client.release(); }
};

const deleteTimetableEntry = async (req, res, next) => {
  const { school_id, id: userId } = req.user;
  const { id } = req.params;
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await ensureSchema();
    await client.query('BEGIN');
    transactionOpen = true;
    const existing = await getEntryContext(school_id, id);
    if (!existing) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Timetable entry not found.' });
    }
    if (existing.is_locked) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'This approved lesson is locked. Unlock it before deleting.' });
    }
    const locked = await lockDraftVersion(client, school_id, existing.version_id, req.body.expected_revision);
    if (locked.error) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(locked.error.status).json(locked.error);
    }
    await client.query('DELETE FROM timetables WHERE id = $1 AND school_id = $2 AND version_id = $3', [id, school_id, existing.version_id]);
    const revision = await bumpDraftVersion(client, school_id, existing.version_id, userId, 'DELETE_LESSON', id, existing, null);
    await client.query('COMMIT');
    transactionOpen = false;
    res.json({ message: 'Timetable entry deleted successfully.', revision });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
};

const setEntryLock = async (req, res, next) => {
  const { school_id, id: userId } = req.user;
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await ensureSchema();
    await client.query('BEGIN');
    transactionOpen = true;
    const existing = await getEntryContext(school_id, req.params.id);
    if (!existing) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(404).json({ message: 'Timetable entry not found.' });
    }
    const version = await lockDraftVersion(client, school_id, existing.version_id, req.body.expected_revision);
    if (version.error) {
      await client.query('ROLLBACK'); transactionOpen = false;
      return res.status(version.error.status).json(version.error);
    }
    const locked = Boolean(req.body.is_locked);
    await client.query('UPDATE timetables SET is_locked = $1, updated_at = NOW() WHERE school_id = $2 AND id = $3 AND version_id = $4',
      [locked, school_id, req.params.id, existing.version_id]);
    const revision = await bumpDraftVersion(client, school_id, existing.version_id, userId, locked ? 'LOCK_LESSON' : 'UNLOCK_LESSON', req.params.id, existing, { is_locked: locked });
    await client.query('COMMIT'); transactionOpen = false;
    res.json({ is_locked: locked, revision });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
};

const upsertAssignment = async (req, res, next) => {
  const { school_id } = req.user;
  const { teacher_id, subject_id, class_id, version_id } = req.body;
  if (!teacher_id || !subject_id || !class_id || !version_id) return res.status(400).json({ message: 'Select a draft term, teacher, subject, and class.' });
  try {
    await ensureSchema();
    const version = await getDraftTerm(school_id, version_id);
    if (!version) return res.status(409).json({ message: 'Term configuration can only be changed for the selected draft.' });
    const valid = await pool.query(
      `SELECT u.id FROM users u
       JOIN subjects s ON s.school_id = u.school_id
       JOIN classes c ON c.school_id = u.school_id
       JOIN curriculum_subjects cs ON cs.school_id = c.school_id
         AND cs.subject_id = s.id AND cs.curriculum = c.curriculum
       WHERE u.id = $1 AND s.id = $2 AND c.id = $3 AND u.school_id = $4
         AND u.role = 'teacher' AND u.is_active = TRUE`,
      [teacher_id, subject_id, class_id, school_id]
    );
    if (!valid.rows.length) return res.status(400).json({ message: 'Choose an active teacher, subject, and class from this school.' });
    const result = await pool.query(
      `INSERT INTO teacher_subject_assignments (school_id, term_id, teacher_id, subject_id, class_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (school_id, term_id, teacher_id, subject_id, class_id) DO UPDATE SET teacher_id = EXCLUDED.teacher_id
       RETURNING *`,
      [school_id, version.term_id, teacher_id, subject_id, class_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const deleteAssignment = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    await ensureSchema();
    const version = await getDraftTerm(school_id, req.body.version_id);
    if (!version) return res.status(409).json({ message: 'Select an editable draft term before changing assignments.' });
    await pool.query('DELETE FROM teacher_subject_assignments WHERE id = $1 AND school_id = $2 AND term_id = $3', [req.params.id, school_id, version.term_id]);
    res.json({ message: 'Assignment deleted.' });
  } catch (error) {
    next(error);
  }
};

const upsertClassTeacher = async (req, res, next) => {
  const { school_id } = req.user;
  const { class_id, teacher_id, version_id } = req.body;
  if (!class_id || !teacher_id || !version_id) return res.status(400).json({ message: 'Select a draft term, class, and class teacher.' });
  try {
    await ensureSchema();
    const version = await getDraftTerm(school_id, version_id);
    if (!version) return res.status(409).json({ message: 'Class teacher assignments can only be changed for the selected draft term.' });
    const valid = await pool.query(`SELECT c.id FROM classes c JOIN users u ON u.school_id = c.school_id
      WHERE c.id = $1 AND u.id = $2 AND c.school_id = $3 AND u.role = 'teacher' AND u.is_active = TRUE`,
    [class_id, teacher_id, school_id]);
    if (!valid.rows.length) return res.status(400).json({ message: 'Choose a class and active teacher from this school.' });
    const result = await pool.query(`INSERT INTO timetable_class_teacher_assignments (school_id, term_id, class_id, teacher_id)
      VALUES ($1,$2,$3,$4) ON CONFLICT (school_id, term_id, class_id) DO UPDATE SET teacher_id = EXCLUDED.teacher_id RETURNING *`,
    [school_id, version.term_id, class_id, teacher_id]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
};

const upsertRequirement = async (req, res, next) => {
  const { school_id } = req.user;
  const { class_id, subject_id, lessons_per_week, double_periods_per_week = 0, room_required = false, version_id } = req.body;
  if (!class_id || !subject_id || !version_id || lessons_per_week === undefined
    || !Number.isInteger(Number(lessons_per_week)) || Number(lessons_per_week) < 0
    || !Number.isInteger(Number(double_periods_per_week)) || Number(double_periods_per_week) < 0
    || Number(double_periods_per_week) * 2 > Number(lessons_per_week)) {
    return res.status(400).json({ message: 'Provide a class, subject, non-negative whole weekly period count, and a valid double-period count.' });
  }
  try {
    await ensureSchema();
    const version = await getDraftTerm(school_id, version_id);
    if (!version) return res.status(409).json({ message: 'Weekly requirements can only be changed for the selected draft term.' });
    const valid = await pool.query(
      `SELECT c.id FROM classes c JOIN subjects s ON s.school_id = c.school_id
       JOIN curriculum_subjects cs ON cs.school_id = c.school_id
         AND cs.subject_id = s.id AND cs.curriculum = c.curriculum
       WHERE c.id = $1 AND s.id = $2 AND c.school_id = $3`,
      [class_id, subject_id, school_id]
    );
    if (!valid.rows.length) return res.status(400).json({ message: 'Choose a class and subject from this school.' });
    const result = await pool.query(
      `INSERT INTO subject_weekly_requirements (school_id, term_id, class_id, subject_id, lessons_per_week, double_periods_per_week, room_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (school_id, term_id, class_id, subject_id) DO UPDATE
         SET lessons_per_week = EXCLUDED.lessons_per_week,
             double_periods_per_week = EXCLUDED.double_periods_per_week,
             room_required = EXCLUDED.room_required
       RETURNING *`,
      [school_id, version.term_id, class_id, subject_id, lessons_per_week, double_periods_per_week, Boolean(room_required)]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const upsertWorkloadLimit = async (req, res, next) => {
  const { school_id } = req.user;
  const { teacher_id, max_periods_per_week, version_id } = req.body;
  if (!teacher_id || !version_id || !Number.isInteger(Number(max_periods_per_week)) || Number(max_periods_per_week) < 1) {
    return res.status(400).json({ message: 'An active teacher and positive whole-number weekly period limit are required.' });
  }
  try {
    await ensureSchema();
    const version = await getDraftTerm(school_id, version_id);
    if (!version) return res.status(409).json({ message: 'Workload limits can only be changed for the selected draft term.' });
    const teacher = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active = TRUE`,
      [teacher_id, school_id]
    );
    if (!teacher.rows.length) return res.status(400).json({ message: 'Select an active teacher from this school.' });
    const result = await pool.query(
      `INSERT INTO teacher_workload_limits (school_id, term_id, teacher_id, max_periods_per_week)
       VALUES ($1,$2,$3,$4) ON CONFLICT (school_id, term_id, teacher_id)
       DO UPDATE SET max_periods_per_week = EXCLUDED.max_periods_per_week RETURNING *`,
      [school_id, version.term_id, teacher_id, max_periods_per_week]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
};

const upsertRoom = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, capacity, location, is_active } = req.body;
  if (!name) return res.status(400).json({ message: 'Room name is required.' });
  try {
    await ensureSchema();
    const result = await pool.query(
      `INSERT INTO timetable_rooms (school_id, name, capacity, location, is_active)
       VALUES ($1,$2,$3,$4,COALESCE($5, TRUE))
       ON CONFLICT (school_id, name) DO UPDATE SET capacity = EXCLUDED.capacity, location = EXCLUDED.location, is_active = EXCLUDED.is_active
       RETURNING *`,
      [school_id, name, capacity || null, location || null, is_active]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const upsertPeriod = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, day_of_week, start_time, end_time, is_break, sort_order, is_active, version_id } = req.body;
  const timeError = validateTime(start_time, end_time);
  if (!name || timeError) return res.status(400).json({ message: timeError || 'Period name is required.' });
  try {
    await ensureSchema();
    const version = await getDraftTerm(school_id, version_id);
    if (!version) return res.status(409).json({ message: 'School periods can only be changed for the selected draft term.' });
    const result = await pool.query(
      `INSERT INTO timetable_periods (school_id, term_id, name, day_of_week, start_time, end_time, is_break, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,FALSE),COALESCE($8,0),COALESCE($9,TRUE))
       RETURNING *`,
      [school_id, version.term_id, name, day_of_week || null, normalizeTime(start_time), normalizeTime(end_time), is_break, sort_order, is_active]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const upsertAvailability = async (req, res, next) => {
  const { school_id } = req.user;
  const { type, teacher_id, class_id, room_id, day_of_week, start_time, end_time, is_available, reason, version_id } = req.body;
  const tableByType = { teacher: 'teacher_availability', class: 'class_availability', room: 'room_availability' };
  const ownerColumn = { teacher: 'teacher_id', class: 'class_id', room: 'room_id' }[type];
  const ownerId = type === 'teacher' ? teacher_id : type === 'class' ? class_id : room_id;
  const timeError = validateTime(start_time, end_time);
  if (!tableByType[type] || !ownerId || !day_of_week || timeError) return res.status(400).json({ message: timeError || 'Type, owner, day, and time are required.' });
  try {
    await ensureSchema();
    const version = await getDraftTerm(school_id, version_id);
    if (!version) return res.status(409).json({ message: 'Availability can only be changed for the selected draft term.' });
    const result = await pool.query(
      `INSERT INTO ${tableByType[type]} (school_id, term_id, ${ownerColumn}, day_of_week, start_time, end_time, is_available, reason)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,FALSE),$8)
       RETURNING *`,
      [school_id, version.term_id, ownerId, day_of_week, normalizeTime(start_time), normalizeTime(end_time), is_available, reason || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const updateTimetableSettings = async (req, res, next) => {
  const { school_id } = req.user;
  const { subject_teaching_starts_from, version_id } = req.body;
  try {
    await ensureSchema();
    const version = await getDraftTerm(school_id, version_id);
    if (!version) return res.status(409).json({ message: 'Settings can only be changed for the selected draft term.' });
    const result = await pool.query(
      `UPDATE timetable_terms SET subject_teaching_starts_from = COALESCE($1, subject_teaching_starts_from)
       WHERE school_id = $2 AND id = $3 RETURNING academic_year, term, subject_teaching_starts_from`,
      [subject_teaching_starts_from, school_id, version.term_id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getValidation = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    await ensureSchema();
    if (!req.query.version_id) return res.status(400).json({ message: 'Select the academic year and term before validating.' });
    const version = await getCurrentVersion(school_id, req.query.version_id);
    if (!version) return res.status(404).json({ message: 'No timetable version exists for this school.' });
    const entries = await hydrateTimetableRows(school_id, { ...req.query, versionId: version.id });
    const conflicts = [];
    for (const entry of entries) {
      const entryConflicts = await getConflictsForSlot(school_id, entry, { excludeId: entry.id });
      conflicts.push(...entryConflicts.map((conflict) => ({ ...conflict, entry_id: entry.id })));
    }

    const requirements = await pool.query(
            `SELECT r.*, c.name AS class_name, c.year_level, s.name AS subject_name,
              COALESCE(SUM(t.period_count), 0)::INTEGER AS generated_periods,
              COUNT(t.id)::INTEGER AS generated_lessons,
              COUNT(*) FILTER (WHERE t.period_count = 2)::INTEGER AS scheduled_double_periods,
              EXISTS (SELECT 1 FROM teacher_subject_assignments a
          WHERE a.school_id = r.school_id AND a.term_id = r.term_id AND a.class_id = r.class_id AND a.subject_id = r.subject_id) AS has_subject_teacher,
              EXISTS (SELECT 1 FROM timetable_class_teacher_assignments ca JOIN users u ON u.id = ca.teacher_id
          WHERE ca.school_id = r.school_id AND ca.term_id = r.term_id AND ca.class_id = r.class_id AND u.is_active = TRUE) AS has_class_teacher,
              c.teaching_model
       FROM subject_weekly_requirements r
       JOIN classes c ON r.class_id = c.id
       JOIN subjects s ON r.subject_id = s.id
       LEFT JOIN timetables t ON t.school_id = r.school_id AND t.version_id = $2
         AND t.class_id = r.class_id AND t.subject_id = r.subject_id
       WHERE r.school_id = $1 AND r.term_id = $3
      GROUP BY r.id, c.name, c.year_level, c.teaching_model, s.name
       ORDER BY c.name, s.name`,
      [school_id, version.id, version.term_id]
    );
    const weekly = requirements.rows.map((row) => ({
      ...row,
      missing_lessons: Math.max(0, Number(row.lessons_per_week) - Number(row.generated_periods)),
      extra_lessons: Math.max(0, Number(row.generated_periods) - Number(row.lessons_per_week)),
      missing_double_periods: Math.max(0, Number(row.double_periods_per_week || 0) - Number(row.scheduled_double_periods)),
      missing_teacher_assignment: row.teaching_model === 'class_teacher' && Number(row.year_level) <= 3
        ? !row.has_class_teacher : !row.has_subject_teacher,
    }));

    if (!weekly.length) {
      conflicts.push(createConflict(
        'WEEKLY_REQUIREMENTS_MISSING',
        'Configure weekly subject requirements before validating or publishing this timetable.'
      ));
    }

    for (const requirement of weekly) {
      if (requirement.missing_teacher_assignment) {
        conflicts.push(createConflict(
          'SUBJECT_ASSIGNMENT_MISSING',
          `${requirement.class_name} has no assigned teacher for ${requirement.subject_name}.`,
          { class_id: requirement.class_id, subject_id: requirement.subject_id }
        ));
      }
      if (requirement.missing_double_periods > 0) {
        conflicts.push(createConflict(
          'DOUBLE_PERIOD_REQUIREMENT_MISSING',
          `${requirement.class_name} needs ${requirement.missing_double_periods} more double period(s) for ${requirement.subject_name}.`,
          { class_id: requirement.class_id, subject_id: requirement.subject_id }
        ));
      }
    }

    res.json({
      version_id: version.id,
      revision: Number(version.revision),
      total_lessons: entries.length,
      conflicts,
      weekly_requirements: weekly,
      is_valid: conflicts.length === 0 && weekly.every((row) => row.missing_lessons === 0 && row.extra_lessons === 0 && row.missing_double_periods === 0),
    });
  } catch (error) {
    next(error);
  }
};

const getHealth = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    await ensureSchema();
    if (!req.query.version_id) return res.status(400).json({ message: 'Select the academic year and term before viewing timetable health.' });
    const validation = await new Promise((resolve, reject) => {
      const fakeRes = { json: resolve };
      getValidation({ user: req.user, query: { version_id: req.query.version_id } }, fakeRes, reject);
    });
    const counts = validation.conflicts.reduce((acc, conflict) => {
      acc[conflict.type] = (acc[conflict.type] || 0) + 1;
      return acc;
    }, {});
    const unscheduled = validation.weekly_requirements.reduce((sum, row) => sum + row.missing_lessons, 0);
    res.json({
      total_lessons: validation.weekly_requirements.reduce((sum, row) => sum + Number(row.lessons_per_week || 0), 0),
      scheduled_lessons: validation.total_lessons,
      unscheduled_lessons: unscheduled,
      teacher_conflicts: counts.TEACHER_CONFLICT || 0,
      class_conflicts: counts.CLASS_CONFLICT || 0,
      room_conflicts: counts.ROOM_CONFLICT || 0,
      availability_conflicts: (counts.TEACHER_AVAILABILITY_CONFLICT || 0) + (counts.CLASS_AVAILABILITY_CONFLICT || 0) + (counts.ROOM_AVAILABILITY_CONFLICT || 0),
      conflicts: validation.conflicts,
      weekly_requirements: validation.weekly_requirements,
    });
  } catch (error) {
    next(error);
  }
};

const getSuggestions = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    await ensureSchema();
    const payload = { ...req.query, ...req.body };
    const version = await getCurrentVersion(school_id, payload.version_id);
    if (!version || version.status !== 'DRAFT') return res.status(400).json({ message: 'Select an editable draft for an academic year and term first.' });
    const period = await loadPeriod(school_id, version.term_id, payload.period_id);
    const subjectId = await resolveSubjectId(school_id, payload.subject_id, payload.subject);
    const entry = {
      class_id: Number(payload.class_id),
      subject_id: subjectId,
      teacher_id: await resolveTeacherId(school_id, version.term_id, payload.class_id, subjectId, payload.teacher_id),
      version_id: version.id,
      term_id: version.term_id,
      room_id: payload.room_id || null,
      day_of_week: payload.day_of_week,
      start_time: normalizeTime(period?.start_time || payload.start_time),
      end_time: normalizeTime(period?.end_time || payload.end_time),
    };
    res.json({ suggestions: await findSuggestions(school_id, entry, 10) });
  } catch (error) {
    next(error);
  }
};

const generateTimetable = async (req, res, next) => {
  const { school_id, id: userId } = req.user;
  const { class_ids, days = DAYS, overwrite_draft = false, version_id, expected_revision } = req.body;
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await ensureSchema();
    await client.query('BEGIN');
    transactionOpen = true;
    const locked = await lockDraftVersion(client, school_id, version_id, expected_revision);
    if (locked.error) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(locked.error.status).json(locked.error);
    }
    const version = locked.version;
    const selectedClassIds = class_ids?.length ? class_ids.map(Number) : null;
    const validDays = Array.isArray(days) ? days.filter((day) => DAYS.includes(day)) : DAYS;
    if (!validDays.length) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ message: 'Select at least one configured school day.' });
    }

      const requirements = await client.query(
      `SELECT r.*, c.name AS class_name, c.year_level, c.teaching_model,
              (SELECT ca.teacher_id FROM timetable_class_teacher_assignments ca
               WHERE ca.school_id = c.school_id AND ca.term_id = r.term_id AND ca.class_id = c.id) AS class_teacher_id,
              s.name AS subject_name,
              (SELECT COUNT(*)::INTEGER FROM students st WHERE st.class_id = c.id AND st.school_id = c.school_id) AS student_count
       FROM subject_weekly_requirements r
       JOIN classes c ON c.id = r.class_id AND c.school_id = r.school_id
       JOIN subjects s ON s.id = r.subject_id AND s.school_id = r.school_id
       WHERE r.school_id = $1 AND r.term_id = $3 AND ($2::INTEGER[] IS NULL OR r.class_id = ANY($2::INTEGER[]))
       ORDER BY r.lessons_per_week DESC, c.name, s.name`,
      [school_id, selectedClassIds, version.term_id]
    );
    if (!requirements.rows.length) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ message: 'Configure weekly subject requirements before generating a timetable.' });
    }

    const periodResult = await client.query(
      `SELECT * FROM timetable_periods WHERE school_id = $1 AND term_id = $2 AND is_active = TRUE
       ORDER BY day_of_week NULLS FIRST, sort_order, start_time`,
      [school_id, version.term_id]
    );
    const allConfiguredPeriods = periodResult.rows.length ? periodResult.rows : DEFAULT_PERIODS.map((period, index) => ({ ...period, id: null, day_of_week: null, sort_order: index + 1 }));
    const periods = allConfiguredPeriods.filter((period) => !period.is_break);
    const slots = periods.flatMap((period) => (period.day_of_week ? [period.day_of_week] : validDays)
      .filter((day) => validDays.includes(day))
      .map((day) => ({ ...period, day_of_week: day, start_time: normalizeTime(period.start_time), end_time: normalizeTime(period.end_time) })));
    const rooms = (await client.query(
      'SELECT * FROM timetable_rooms WHERE school_id = $1 AND is_active = TRUE ORDER BY name', [school_id]
    )).rows;
    const workLimits = (await client.query(
      'SELECT teacher_id, max_periods_per_week FROM teacher_workload_limits WHERE school_id = $1 AND term_id = $2', [school_id, version.term_id]
    )).rows.reduce((result, row) => ({ ...result, [String(row.teacher_id)]: Number(row.max_periods_per_week) }), {});
    const versionLessons = (await client.query(
      'SELECT * FROM timetables WHERE school_id = $1 AND version_id = $2',
      [school_id, version.id]
    )).rows;
    const currentLessons = overwrite_draft
      ? versionLessons.filter((entry) => entry.is_locked || (selectedClassIds && !selectedClassIds.includes(Number(entry.class_id))))
      : versionLessons;
    const requirementsByClass = new Map();
    for (const requirement of requirements.rows) {
      requirementsByClass.set(requirement.class_id, (requirementsByClass.get(requirement.class_id) || 0) + Number(requirement.lessons_per_week));
    }
    const capacityFailures = [];
    const totalWeeklySlots = calculateAvailableClassCapacity(validDays, slots);
    for (const requirement of requirements.rows) {
      const available = totalWeeklySlots;
      if (requirementsByClass.get(requirement.class_id) > available && !capacityFailures.some((failure) => failure.class_id === requirement.class_id)) {
        capacityFailures.push({
          class_id: requirement.class_id,
          subject_id: requirement.subject_id,
          required_lessons: requirementsByClass.get(requirement.class_id),
          available_lessons: available,
          reason: `${requirement.class_name} requires ${requirementsByClass.get(requirement.class_id)} periods but only ${available} non-break periods are available across the selected week. Add periods or reduce weekly requirements.`,
        });
      }
    }

    const lessonUnits = [];
    const unitFailures = [];
    for (const requirement of requirements.rows) {
      const classEntries = currentLessons.filter((entry) => Number(entry.class_id) === Number(requirement.class_id)
        && Number(entry.subject_id) === Number(requirement.subject_id));
      const usedPeriods = classEntries.reduce((sum, entry) => sum + Number(entry.period_count || 1), 0);
      const existingDoubles = classEntries.filter((entry) => Number(entry.period_count) === 2).length;
      let remainingPeriods = Math.max(0, Number(requirement.lessons_per_week) - usedPeriods);
      let doubles = Math.max(0, Number(requirement.double_periods_per_week || 0) - existingDoubles);
      if (doubles * 2 > remainingPeriods) {
        unitFailures.push({ ...requirement, missing_lessons: remainingPeriods, reason: `Existing lessons leave too few unfilled periods to satisfy the ${requirement.double_periods_per_week} required double periods.` });
        continue;
      }

      let assignmentRows = (await client.query(
        `SELECT u.id AS teacher_id, u.name AS teacher_name FROM teacher_subject_assignments a
         JOIN users u ON u.id = a.teacher_id
         WHERE a.school_id = $1 AND a.class_id = $2 AND a.subject_id = $3 AND a.term_id = $4
           AND u.role = 'teacher' AND u.is_active = TRUE ORDER BY u.id`,
        [school_id, requirement.class_id, requirement.subject_id, version.term_id]
      )).rows;
      if (!assignmentRows.length && Number(requirement.year_level) <= 3 && requirement.teaching_model === 'class_teacher') {
        assignmentRows = (await client.query(
          `SELECT id AS teacher_id, name AS teacher_name FROM users
           WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active = TRUE`,
          [requirement.class_teacher_id, school_id]
        )).rows;
      }
      if (!assignmentRows.length) {
        unitFailures.push({ ...requirement, missing_lessons: remainingPeriods, reason: Number(requirement.year_level) >= 4
          ? `No active subject teacher is assigned to ${requirement.subject_name} in ${requirement.class_name}.`
          : `No active class or specialist teacher is available for ${requirement.subject_name} in ${requirement.class_name}.` });
        continue;
      }
      const lessonPeriods = [];
      for (let index = 0; index < doubles; index += 1) lessonPeriods.push(2);
      for (let index = 0; index < remainingPeriods - (doubles * 2); index += 1) lessonPeriods.push(1);

      for (const periodCount of lessonPeriods) {
        const candidates = [];
        for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
          const first = slots[slotIndex];
          let endTime = first.end_time;
          if (periodCount === 2) {
            const next = slots.find((slot) => slot.day_of_week === first.day_of_week
              && slot.start_time === first.end_time && !slot.is_break);
            if (!next) continue;
            endTime = next.end_time;
          }
          const candidateRooms = requirement.room_required ? rooms.filter((room) => (
            !room.capacity || Number(room.capacity) >= Number(requirement.student_count)
          )) : [null];
          for (const room of candidateRooms) {
            const candidate = {
              version_id: version.id,
              term_id: version.term_id,
              class_id: requirement.class_id,
              subject_id: requirement.subject_id,
              teacher_id: assignmentRows[0].teacher_id,
              room_id: room?.id || null,
              period_id: first.id || null,
              period_count: periodCount,
              day_of_week: first.day_of_week,
              start_time: first.start_time,
              end_time: endTime,
            };
            for (const teacher of assignmentRows) {
              const teacherCandidate = { ...candidate, teacher_id: teacher.teacher_id };
              const candidateConflicts = await getConflictsForSlot(school_id, teacherCandidate, { ignoreVersionEntries: overwrite_draft });
              if (!candidateConflicts.length) candidates.push(teacherCandidate);
            }
          }
        }
        lessonUnits.push({
          class_id: requirement.class_id,
          subject_id: requirement.subject_id,
          period_count: periodCount,
          candidates,
          reason: requirement.room_required && !rooms.length
            ? `No active room is available for ${requirement.class_name} ${requirement.subject_name}.`
            : 'No legal period satisfies teacher, class, room, availability, subject, or workload rules.',
          requirement,
        });
      }
    }

    const solve = capacityFailures.length || unitFailures.length
      ? { solved: false, placements: [], unscheduled: lessonUnits }
      : solveTimetable({ lessons: lessonUnits, fixedLessons: currentLessons, workloadLimits: workLimits });
    const failureByRequirement = new Map();
    for (const unit of [...unitFailures, ...solve.unscheduled.map((item) => {
      const unit = lessonUnits.find((candidate) => candidate.class_id === item.class_id && candidate.subject_id === item.subject_id && candidate.period_count === item.period_count);
      return { ...item, requirement: unit?.requirement || item.requirement };
    })]) {
      const key = `${unit.class_id}:${unit.subject_id}`;
      const existing = failureByRequirement.get(key);
      if (existing) existing.missing_lessons += Number(unit.period_count || unit.missing_lessons || 1);
      else failureByRequirement.set(key, {
        ...unit.requirement,
        class_id: unit.class_id,
        subject_id: unit.subject_id,
        teacher_id: unit.teacher_id || null,
        missing_lessons: Number(unit.missing_lessons || unit.period_count || 1),
        reason: unit.reason || 'No complete conflict-free placement was found.',
      });
    }
    for (const failure of capacityFailures) failureByRequirement.set(`${failure.class_id}:${failure.subject_id}`, failure);
    const unscheduled = [...failureByRequirement.values()];

    const run = await client.query(
      `INSERT INTO timetable_generation_runs (school_id, academic_year, term, term_id, created_by, status, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [school_id, version.academic_year, version.term, version.term_id, userId, solve.solved && !unscheduled.length ? 'completed' : 'failed',
        JSON.stringify({ scheduled: 0, unscheduled: unscheduled.length, search_nodes: solve.visited_nodes || 0 })]
    );
    const runId = run.rows[0].id;
    for (const item of unscheduled) {
      await client.query(
        `INSERT INTO timetable_unscheduled_lessons
         (school_id, generation_run_id, class_id, subject_id, teacher_id, required_lessons, scheduled_lessons, missing_lessons, reason, suggestions)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,'[]'::jsonb)`,
        [school_id, runId, item.class_id, item.subject_id, item.teacher_id || null,
          item.lessons_per_week || item.required_lessons || 0, item.missing_lessons || 0, item.reason]
      );
    }

    if (!solve.solved || unscheduled.length) {
      const summary = {
        scheduled: 0,
        unscheduled: unscheduled.reduce((sum, item) => sum + Number(item.missing_lessons || 0), 0),
        diagnostics: unscheduled,
        search_nodes: solve.visited_nodes || 0,
      };
      await client.query('UPDATE timetable_generation_runs SET summary = $1 WHERE id = $2', [JSON.stringify(summary), runId]);
      await client.query('COMMIT');
      transactionOpen = false;
      return res.status(422).json({
        message: 'A complete timetable could not be generated. No lesson changes were saved.',
        generation_run_id: runId,
        unscheduled,
        summary,
      });
    }

    if (overwrite_draft) {
      await client.query('DELETE FROM timetables WHERE school_id = $1 AND version_id = $2 AND is_locked = FALSE AND ($3::INTEGER[] IS NULL OR class_id = ANY($3::INTEGER[]))', [school_id, version.id, selectedClassIds]);
    }
    const saved = [];
    for (const entry of solve.placements) {
      const requirement = lessonUnits.find((unit) => unit.class_id === entry.class_id && unit.subject_id === entry.subject_id)?.requirement;
      const inserted = await client.query(
        `INSERT INTO timetables
         (school_id, version_id, class_id, subject_id, teacher_id, room_id, period_id, period_count,
          day_of_week, start_time, end_time, subject, academic_year, term, term_id, status, generation_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'DRAFT',$16) RETURNING *`,
        [school_id, version.id, entry.class_id, entry.subject_id, entry.teacher_id, entry.room_id,
          entry.period_id, entry.period_count, entry.day_of_week, entry.start_time, entry.end_time,
          requirement?.subject_name || 'Subject', version.academic_year, version.term, version.term_id, runId]
      );
      await client.query(`UPDATE timetables t SET class_name_snapshot = (SELECT name FROM classes WHERE id = t.class_id),
        subject_name_snapshot = (SELECT name FROM subjects WHERE id = t.subject_id),
        teacher_name_snapshot = (SELECT name FROM users WHERE id = t.teacher_id),
        room_name_snapshot = (SELECT name FROM timetable_rooms WHERE id = t.room_id) WHERE t.id = $1`, [inserted.rows[0].id]);
      saved.push(inserted.rows[0]);
    }
    const revision = await bumpDraftVersion(client, school_id, version.id, userId, 'GENERATE_DRAFT', null, null, {
      generation_run_id: runId, lessons_added: saved.length, overwrite: overwrite_draft,
    });
    const summary = { scheduled: saved.reduce((sum, item) => sum + Number(item.period_count || 1), 0), lessons_created: saved.length, unscheduled: 0, revision };
    await client.query('UPDATE timetable_generation_runs SET status = \'completed\', summary = $1 WHERE id = $2', [JSON.stringify(summary), runId]);
    await client.query('COMMIT');
    transactionOpen = false;
    res.status(201).json({ generation_run_id: runId, scheduled: saved, unscheduled: [], summary });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23P01') return res.status(409).json({ message: 'A concurrent change created a class, teacher, or room overlap. Reload the draft and try again.' });
    next(error);
  } finally {
    client.release();
  }
};

const publishTimetable = async (req, res, next) => {
  const { school_id, id: userId } = req.user;
  const { version_id, expected_revision } = req.body;
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await ensureSchema();
    await client.query('BEGIN');
    transactionOpen = true;
    const locked = await lockDraftVersion(client, school_id, version_id, expected_revision);
    if (locked.error) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(locked.error.status).json(locked.error);
    }
    const version = locked.version;
    const validation = await new Promise((resolve, reject) => {
      getValidation({ user: req.user, query: { version_id: version.id } }, {
        json: resolve,
        status(code) { this.statusCode = code; return this; },
      }, reject);
    });
    if (!validation.is_valid) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({
        message: 'Publishing failed. Fix all conflicts and complete every required lesson first.',
        validation,
      });
    }

    await client.query(
      `UPDATE timetable_versions SET status = 'ARCHIVED', archived_at = NOW(), updated_at = NOW()
       WHERE school_id = $1 AND academic_year = $2 AND term = $3 AND status = 'PUBLISHED'`,
      [school_id, version.academic_year, version.term]
    );
    await client.query(
      `UPDATE timetable_versions SET status = 'PUBLISHED', published_at = NOW(),
          revision = revision + 1, updated_at = NOW()
       WHERE school_id = $1 AND id = $2 AND revision = $3 AND status = 'DRAFT'`,
      [school_id, version.id, expected_revision]
    );
    await client.query(
      `UPDATE timetables SET status = 'ARCHIVED' WHERE school_id = $1 AND version_id IN
        (SELECT id FROM timetable_versions WHERE school_id = $1 AND academic_year = $2 AND term = $3 AND status = 'ARCHIVED')`,
      [school_id, version.academic_year, version.term]
    );
    await client.query("UPDATE timetables SET status = 'PUBLISHED' WHERE school_id = $1 AND version_id = $2", [school_id, version.id]);
    await client.query(
      `INSERT INTO timetable_audit_log (school_id, version_id, actor_id, action, before_data, after_data)
       VALUES ($1,$2,$3,'PUBLISH', $4, $5)`,
      [school_id, version.id, userId, JSON.stringify({ status: 'DRAFT', revision: Number(expected_revision) }), JSON.stringify({ status: 'PUBLISHED', validation })]
    );
    const current = await client.query('SELECT * FROM timetable_versions WHERE school_id = $1 AND id = $2', [school_id, version.id]);
    await client.query('COMMIT');
    transactionOpen = false;
    res.json({ message: 'Timetable published successfully.', version: current.rows[0], validation });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
};

module.exports = {
  getTimetable,
  getTimetableMeta,
  getVersions,
  createVersion,
  copyPreviousTerm,
  createTimetableEntry,
  updateTimetableEntry,
  deleteTimetableEntry,
  setEntryLock,
  upsertClassTeacher,
  upsertAssignment,
  deleteAssignment,
  upsertRequirement,
  upsertWorkloadLimit,
  upsertRoom,
  upsertPeriod,
  upsertAvailability,
  updateTimetableSettings,
  getValidation,
  getHealth,
  getSuggestions,
  generateTimetable,
  publishTimetable,
  calculateAvailableClassCapacity,
};
