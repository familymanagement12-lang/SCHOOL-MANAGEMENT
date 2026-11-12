const pool = require('../config/db');

const getStudent = async (userId, schoolId) => {
  const result = await pool.query(
    `SELECT s.id, LPAD(s.id::text, 6, '0') AS student_id, s.name, s.dob,
            s.class_id, s.curriculum, c.name AS class_name, c.year_level,
            sc.name AS school_name, sc.academic_year, sc.current_term,
            u.is_active AS account_active
     FROM students s
     LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
     JOIN schools sc ON sc.id = s.school_id
     JOIN users u ON u.id = s.user_id AND u.school_id = s.school_id
     WHERE s.user_id = $1 AND s.school_id = $2`,
    [userId, schoolId]
  );
  return result.rows[0] || null;
};

const requireStudent = async (req, res) => {
  const student = await getStudent(req.user.id, req.user.school_id);
  if (!student) {
    res.status(404).json({ message: 'Student profile is not linked to this account.' });
    return null;
  }
  if (!student.account_active) {
    res.status(403).json({ message: 'This student account is inactive.' });
    return null;
  }
  return student;
};

const getProfile = async (req, res, next) => {
  try {
    const student = await requireStudent(req, res);
    if (!student) return;
    const guardians = await pool.query(
      `SELECT p.name, p.phone, sp.relationship
       FROM student_parent sp
       JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
       WHERE sp.student_id = $1 AND sp.school_id = $2
       ORDER BY p.name`,
      [student.id, req.user.school_id]
    );
    res.json({ ...student, guardians: guardians.rows });
  } catch (error) {
    next(error);
  }
};

const getSubjects = async (req, res, next) => {
  try {
    const student = await requireStudent(req, res);
    if (!student) return;
    if (!student.class_id) return res.json([]);
    const result = await pool.query(
      `SELECT s.id, s.name, s.code, cs.curriculum,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', u.id, 'name', u.name))
                  FILTER (WHERE u.id IS NOT NULL),
                '[]'::json
              ) AS teachers
       FROM curriculum_subjects cs
       JOIN subjects s ON s.id = cs.subject_id AND s.school_id = cs.school_id
       JOIN classes c ON c.id = $2 AND c.school_id = cs.school_id
       LEFT JOIN timetable_terms tt ON tt.school_id = cs.school_id
         AND tt.academic_year = $3 AND tt.term = $4
       LEFT JOIN teacher_subject_assignments tsa ON tsa.school_id = cs.school_id
         AND tsa.class_id = c.id AND tsa.subject_id = s.id
         AND (tt.id IS NULL OR tsa.term_id = tt.id)
       LEFT JOIN users u ON u.id = tsa.teacher_id AND u.school_id = tsa.school_id
       WHERE cs.school_id = $1 AND cs.curriculum = $5
         AND (
           EXISTS (
             SELECT 1 FROM teacher_subject_assignments active_assignment
             WHERE active_assignment.school_id = cs.school_id
               AND active_assignment.class_id = c.id AND active_assignment.subject_id = s.id
               AND (tt.id IS NULL OR active_assignment.term_id = tt.id)
           )
           OR EXISTS (
             SELECT 1 FROM subject_weekly_requirements active_requirement
             WHERE active_requirement.school_id = cs.school_id
               AND active_requirement.class_id = c.id AND active_requirement.subject_id = s.id
               AND (tt.id IS NULL OR active_requirement.term_id = tt.id)
           )
         )
       GROUP BY s.id, cs.curriculum
       ORDER BY s.name`,
      [req.user.school_id, student.class_id, student.academic_year, student.current_term, student.curriculum]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getTimetable = async (req, res, next) => {
  try {
    const student = await requireStudent(req, res);
    if (!student) return;
    if (!student.class_id) return res.json([]);
    const result = await pool.query(
      `SELECT t.id, t.day_of_week, t.start_time, t.end_time,
              COALESCE(t.subject_name_snapshot, s.name, t.subject) AS subject,
              COALESCE(t.teacher_name_snapshot, u.name) AS teacher,
              COALESCE(t.room_name_snapshot, r.name) AS room,
              t.academic_year, t.term, p.is_break, p.name AS period_name
       FROM timetables t
       JOIN timetable_versions v ON v.id = t.version_id AND v.school_id = t.school_id
         AND v.status = 'PUBLISHED'
       LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
       LEFT JOIN users u ON u.id = t.teacher_id AND u.school_id = t.school_id
       LEFT JOIN timetable_rooms r ON r.id = t.room_id AND r.school_id = t.school_id
       LEFT JOIN timetable_periods p ON p.id = t.period_id AND p.school_id = t.school_id
       WHERE t.school_id = $1 AND t.class_id = $2 AND t.status = 'PUBLISHED'
         AND t.academic_year = $3 AND t.term = $4
       ORDER BY CASE t.day_of_week WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2
         WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5
         WHEN 'Saturday' THEN 6 ELSE 7 END, t.start_time`,
      [req.user.school_id, student.class_id, student.academic_year, student.current_term]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getAttendance = async (req, res, next) => {
  try {
    const student = await requireStudent(req, res);
    if (!student) return;
    const result = await pool.query(
      `SELECT id, date, status FROM attendance
       WHERE school_id = $1 AND student_id = $2
       ORDER BY date DESC`,
      [req.user.school_id, student.id]
    );
    const totals = result.rows.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {});
    const considered = result.rows.length - (totals.excused || 0);
    const presentEquivalent = (totals.present || 0) + (totals.late || 0);
    res.json({
      records: result.rows,
      totals,
      attendance_percentage: considered ? Math.round((presentEquivalent / considered) * 10000) / 100 : 0,
    });
  } catch (error) {
    next(error);
  }
};

const getResults = async (req, res, next) => {
  try {
    const student = await requireStudent(req, res);
    if (!student) return;
    const result = await pool.query(
      `SELECT r.id, r.subject, r.class_score, r.exam_score, r.score, r.term,
              r.published_at, r.created_at,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'title', a.title, 'assessment_type', a.assessment_type,
                  'score', m.score, 'max_score', a.max_score
                ) ORDER BY a.created_at, a.id)
                FROM class_assessments a
                LEFT JOIN class_assessment_scores m ON m.assessment_id = a.id
                  AND m.student_id = r.student_id AND m.school_id = a.school_id
                WHERE a.school_id = r.school_id AND a.class_id = $3
                  AND a.subject = r.subject AND a.term = r.term
              ), '[]'::json) AS class_assessments
       FROM results r
       WHERE r.school_id = $1 AND r.student_id = $2 AND r.curriculum = $4
         AND r.is_published = TRUE
       ORDER BY r.created_at DESC, r.subject`,
      [req.user.school_id, student.id, student.class_id || 0, student.curriculum]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getAnnouncements = async (req, res, next) => {
  try {
    const student = await requireStudent(req, res);
    if (!student) return;
    const result = await pool.query(
      `SELECT a.id, a.title, a.message, a.created_at, u.name AS sender_name
       FROM announcements a
       LEFT JOIN users u ON u.id = a.sender_id
       WHERE a.school_id = $1
         AND (a.audience = 'everyone' OR a.class_id = $2)
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [req.user.school_id, student.class_id || 0]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getDashboard = async (req, res, next) => {
  try {
    const student = await requireStudent(req, res);
    if (!student) return;
    const [attendance, results, announcements, timetable] = await Promise.all([
      pool.query(
        `SELECT         COUNT(*) FILTER (WHERE status <> 'excused')::int AS total,
                COUNT(*) FILTER (WHERE status IN ('present', 'late'))::int AS attended
         FROM attendance WHERE school_id = $1 AND student_id = $2`,
        [req.user.school_id, student.id]
      ),
      pool.query(
        `SELECT subject, score, term, created_at FROM results
         WHERE school_id = $1 AND student_id = $2 AND curriculum = $3 AND is_published = TRUE
         ORDER BY created_at DESC LIMIT 5`,
        [req.user.school_id, student.id, student.curriculum]
      ),
      pool.query(
        `SELECT id, title, message, created_at FROM announcements
         WHERE school_id = $1 AND (audience = 'everyone' OR class_id = $2)
         ORDER BY created_at DESC LIMIT 5`,
        [req.user.school_id, student.class_id || 0]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM timetables t
         JOIN timetable_versions v ON v.id = t.version_id AND v.school_id = t.school_id
           AND v.status = 'PUBLISHED'
         WHERE t.school_id = $1 AND t.class_id = $2 AND t.status = 'PUBLISHED'
           AND t.academic_year = $3 AND t.term = $4`,
        [req.user.school_id, student.class_id || 0, student.academic_year, student.current_term]
      ),
    ]);
    const totalAttendance = attendance.rows[0].total;
    res.json({
      profile: student,
      attendance_percentage: totalAttendance
        ? Math.round((attendance.rows[0].attended / totalAttendance) * 10000) / 100
        : 0,
      recent_results: results.rows,
      recent_announcements: announcements.rows,
      timetable_entries: timetable.rows[0].total,
      upcoming_exams: [],
      pending_assignments: [],
      unavailable_modules: ['assignments', 'learning_materials', 'examination_calendar'],
    });
  } catch (error) {
    next(error);
  }
};

const setResultPublication = async (req, res, next) => {
  const { school_id, id: actorId, role } = req.user;
  const { student_id, subject, term, published } = req.body;
  if (!student_id || !subject?.trim() || !term?.trim() || typeof published !== 'boolean') {
    return res.status(400).json({ message: 'Student, subject, term, and publication status are required.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE results SET is_published = $1, published_at = CASE WHEN $1 THEN NOW() ELSE NULL END
       WHERE school_id = $2 AND student_id = $3 AND subject = $4 AND term = $5
         AND ($6::text = 'admin' OR EXISTS (
           SELECT 1 FROM students st
           JOIN classes c ON c.id = st.class_id AND c.school_id = st.school_id
           WHERE st.id = results.student_id AND st.school_id = results.school_id
             AND (c.class_teacher_id = $7 OR EXISTS (
               SELECT 1 FROM subjects sb
               JOIN teacher_subject_assignments tsa ON tsa.subject_id = sb.id
                 AND tsa.school_id = sb.school_id AND tsa.class_id = c.id
               WHERE sb.school_id = results.school_id AND sb.name = results.subject
                 AND tsa.teacher_id = $7
             ))
         ))
       RETURNING id`,
      [published, school_id, student_id, subject.trim(), term.trim(), role, actorId]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No matching result found.' });
    }
    if (published) {
      await client.query(
        `INSERT INTO notifications (school_id, user_id, title, message)
         SELECT s.school_id, s.user_id, 'Results published',
                $3 || ' results for ' || $4 || ' are now available in your student portal.'
         FROM students s
         WHERE s.id = $1 AND s.school_id = $2 AND s.user_id IS NOT NULL`,
        [student_id, school_id, subject.trim(), term.trim()]
      );
    }
    await client.query(
      `INSERT INTO student_portal_audit_log (school_id, student_id, actor_id, action, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [school_id, student_id, actorId, published ? 'RESULTS_PUBLISHED' : 'RESULTS_UNPUBLISHED',
        JSON.stringify({ subject: subject.trim(), term: term.trim(), result_count: result.rowCount })]
    );
    await client.query('COMMIT');
    res.json({ message: published ? 'Results published.' : 'Results unpublished.', result_count: result.rowCount });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getDashboard,
  getProfile,
  getSubjects,
  getTimetable,
  getAttendance,
  getResults,
  getAnnouncements,
  setResultPublication,
};
