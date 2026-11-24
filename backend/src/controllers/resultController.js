const pool = require('../config/db');
const { calculateClassScore } = require('../services/classScore');
const { canonicalClassName } = require('../services/curriculumPolicy');

const listClassAssessments = async (req, res, next) => {
  const { school_id } = req.user;
  const { class_id, subject, term } = req.query;
  if (!class_id || !subject?.trim() || !term?.trim()) {
    return res.status(400).json({ message: 'Class, subject, and term are required.' });
  }
  try {
    const result = await pool.query(
      `SELECT a.id, a.class_id, a.subject, a.term, a.title, a.assessment_type,
              a.max_score, a.created_at,
              COALESCE(
                json_agg(json_build_object('student_id', s.student_id, 'score', s.score)
                         ORDER BY s.student_id) FILTER (WHERE s.student_id IS NOT NULL),
                '[]'::json
              ) AS scores
       FROM class_assessments a
       LEFT JOIN class_assessment_scores s ON s.assessment_id = a.id AND s.school_id = a.school_id
       WHERE a.school_id = $1 AND a.class_id = $2 AND a.subject = $3 AND a.term = $4
       GROUP BY a.id
       ORDER BY CASE a.assessment_type WHEN 'exercise' THEN 0 ELSE 1 END, a.created_at, a.id`,
      [school_id, class_id, subject.trim(), term.trim()]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createClassAssessment = async (req, res, next) => {
  const { school_id, id: userId } = req.user;
  const { class_id, subject, term, title, assessment_type, max_score } = req.body;
  const maximum = Number(max_score);
  if (!class_id || !subject?.trim() || !term?.trim() || !title?.trim()
      || !['exercise', 'midterm'].includes(assessment_type)
      || !Number.isFinite(maximum) || maximum <= 0 || maximum > 10000) {
    return res.status(400).json({ message: 'Provide a class, subject, term, assessment title, valid type, and maximum mark greater than zero.' });
  }
  try {
    const classExists = await pool.query(
      'SELECT id FROM classes WHERE id = $1 AND school_id = $2',
      [class_id, school_id]
    );
    if (!classExists.rows.length) return res.status(404).json({ message: 'Class not found in your school.' });

    const result = await pool.query(
      `INSERT INTO class_assessments
         (school_id, class_id, subject, term, title, assessment_type, max_score, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, class_id, subject, term, title, assessment_type, max_score, created_at`,
      [school_id, class_id, subject.trim(), term.trim(), title.trim(), assessment_type, maximum, userId]
    );
    res.status(201).json({ ...result.rows[0], scores: [] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'An assessment with that title already exists for this class, subject, and term.' });
    }
    next(error);
  }
};

const saveClassAssessmentScores = async (req, res, next) => {
  const { school_id } = req.user;
  const { scores } = req.body;
  if (!Array.isArray(scores)) return res.status(400).json({ message: 'Scores must be provided as a list.' });

  const seenStudents = new Set();
  for (const entry of scores) {
    if (!entry || typeof entry !== 'object') {
      return res.status(400).json({ message: 'Each score must include a student ID and mark.' });
    }
    const studentId = Number(entry?.student_id);
    if (!Number.isInteger(studentId) || seenStudents.has(studentId)) {
      return res.status(400).json({ message: 'Each student must appear once with a valid ID.' });
    }
    seenStudents.add(studentId);
    if (entry.score !== null && entry.score !== '' && (!Number.isFinite(Number(entry.score)) || Number(entry.score) < 0)) {
      return res.status(400).json({ message: 'Student marks must be zero or greater.' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assessmentResult = await client.query(
      `SELECT id, class_id, subject, term, max_score
       FROM class_assessments
       WHERE id = $1 AND school_id = $2
       FOR UPDATE`,
      [req.params.assessmentId, school_id]
    );
    if (!assessmentResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Assessment not found.' });
    }
    const assessment = assessmentResult.rows[0];
    const rosterResult = await client.query(
      'SELECT id FROM students WHERE school_id = $1 AND class_id = $2',
      [school_id, assessment.class_id]
    );
    const roster = new Set(rosterResult.rows.map((row) => Number(row.id)));
    const maximum = Number(assessment.max_score);
    for (const entry of scores) {
      if (!roster.has(Number(entry.student_id))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'A score belongs to a student outside this class.' });
      }
      if (entry.score !== null && entry.score !== '' && Number(entry.score) > maximum) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `Student marks cannot exceed ${maximum}.` });
      }
    }

    await client.query(
      'DELETE FROM class_assessment_scores WHERE assessment_id = $1 AND school_id = $2',
      [assessment.id, school_id]
    );
    for (const entry of scores) {
      if (entry.score === null || entry.score === '') continue;
      await client.query(
        `INSERT INTO class_assessment_scores (school_id, assessment_id, student_id, score)
         VALUES ($1, $2, $3, $4)`,
        [school_id, assessment.id, entry.student_id, Number(entry.score)]
      );
    }

    const totals = await client.query(
      `SELECT st.id AS student_id,
              COALESCE(SUM(COALESCE(m.score, 0)), 0)::numeric AS earned,
              COALESCE(SUM(a.max_score), 0)::numeric AS possible
       FROM students st
       JOIN class_assessments a
         ON a.school_id = st.school_id AND a.class_id = st.class_id
        AND a.subject = $3 AND a.term = $4
       LEFT JOIN class_assessment_scores m
         ON m.school_id = a.school_id AND m.assessment_id = a.id AND m.student_id = st.id
       WHERE st.school_id = $1 AND st.class_id = $2
       GROUP BY st.id`,
      [school_id, assessment.class_id, assessment.subject, assessment.term]
    );
    for (const row of totals.rows) {
      const classScore = calculateClassScore(row.earned, row.possible);
      await client.query(
        `INSERT INTO results (school_id, student_id, subject, class_score, exam_score, score, term)
         VALUES ($1, $2, $3, $4, 0, $4, $5)
         ON CONFLICT (student_id, subject, term)
         DO UPDATE SET class_score = EXCLUDED.class_score,
                       score = EXCLUDED.class_score + results.exam_score,
                       is_published = FALSE,
                       published_at = NULL`,
        [school_id, row.student_id, assessment.subject, classScore, assessment.term]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Class assessment marks saved.', students_updated: totals.rowCount });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const getStudentResults = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;
  const { studentId } = req.params;

  try {
    let filterQuery = '';
    const values = [studentId, school_id];

    if (role === 'parent') {
      filterQuery = `
        AND EXISTS (
          SELECT 1 FROM student_parent sp
          JOIN parents p ON sp.parent_id = p.id
          WHERE sp.student_id = s.id AND p.user_id = $3
        )
      `;
      values.push(userId);
    }

    const result = await pool.query(
      `SELECT r.id, r.subject, r.class_score, r.exam_score, r.score, r.term,
              r.is_published, r.published_at, r.created_at,
              r.class_id, r.curriculum, r.class_name_snapshot,
              r.year_level_snapshot, r.academic_year_snapshot,
              (
                SELECT COALESCE(
                  json_agg(json_build_object(
                    'title', a.title,
                    'assessment_type', a.assessment_type,
                    'score', m.score,
                    'max_score', a.max_score
                  ) ORDER BY a.created_at, a.id),
                  '[]'::json
                )
                FROM class_assessments a
                LEFT JOIN class_assessment_scores m
                  ON m.assessment_id = a.id AND m.student_id = s.id AND m.school_id = a.school_id
                WHERE a.school_id = r.school_id AND a.class_id = r.class_id
                  AND a.subject = r.subject AND a.term = r.term
              ) AS class_assessments
       FROM results r
       JOIN students s ON r.student_id = s.id
       WHERE s.id = $1 AND r.school_id = $2 ${filterQuery}
       ORDER BY r.term DESC, r.subject ASC`,
      values
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const recordResult = async (req, res, next) => {
  const { school_id } = req.user;
  const { student_id, subject, exam_score, term } = req.body;
  const examScore = Number(exam_score);

  if (!student_id || !subject?.trim() || exam_score === undefined || exam_score === '' || !term?.trim()
      || !Number.isFinite(examScore) || examScore < 0 || examScore > 50) {
    return res.status(400).json({ message: 'Student, subject, term, and an exam score from 0 to 50 are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO results (student_id, subject, class_score, exam_score, score, term, school_id) 
       SELECT $1, $2, 0, $3, $3, $4, $5
       FROM students WHERE id = $1 AND school_id = $5
       ON CONFLICT (student_id, subject, term) 
       DO UPDATE SET exam_score = EXCLUDED.exam_score,
                     score = results.class_score + EXCLUDED.exam_score,
                     is_published = FALSE,
                     published_at = NULL
       RETURNING *`,
      [student_id, subject.trim(), examScore, term.trim(), school_id]
    );

    if (!result.rows.length) return res.status(404).json({ message: 'Student not found in your school.' });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getReportCard = async (req, res, next) => {
  const { school_id } = req.user;
  const { studentId } = req.params;
  const term = req.query.term || 'Term 1';

  try {
    // 1. Get Student & Class Info
    const studentRes = await pool.query(`
      SELECT s.name, LPAD(s.id::text, 6, '0') as student_id, c.name as class_name, c.id as class_id,
             c.year_level as class_year_level, c.curriculum, c.teaching_model as class_teaching_model,
             sch.name as school_name, sch.logo_url, sch.address, sch.phone, sch.motto
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN schools sch ON s.school_id = sch.id
      WHERE s.id = $1 AND s.school_id = $2
    `, [studentId, school_id]);
    
    if (!studentRes.rows.length) return res.status(404).json({ message: 'Student not found.' });
    const student = studentRes.rows[0];
    student.class_name = canonicalClassName(student.class_name, student.class_year_level, student.curriculum);
    const snapshotRes = await pool.query(
      `SELECT class_id, class_name_snapshot, year_level_snapshot, curriculum,
              academic_year_snapshot
       FROM results
       WHERE student_id = $1 AND school_id = $2 AND term = $3
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [studentId, school_id, term]
    );
    const reportSnapshot = snapshotRes.rows[0];
    const reportClassId = reportSnapshot?.class_id ?? student.class_id;
    if (reportSnapshot) {
      student.class_name = reportSnapshot.class_name_snapshot || student.class_name;
      student.class_year_level = reportSnapshot.year_level_snapshot ?? student.class_year_level;
      student.curriculum = reportSnapshot.curriculum;
      student.academic_year = reportSnapshot.academic_year_snapshot;
    }

    // 2. Get Subject Results with Rank
    const subjectsRes = await pool.query(`
      WITH RankedResults AS (
        SELECT r.id, r.student_id, r.subject, r.class_score, r.exam_score, r.score,
               r.class_name_snapshot, r.year_level_snapshot, r.curriculum,
               r.academic_year_snapshot,
               RANK() OVER (PARTITION BY r.subject ORDER BY r.score DESC) as subject_rank,
               COUNT(*) OVER (PARTITION BY r.subject) as total_students
        FROM results r
        WHERE r.term = $1 AND r.school_id = $2 AND r.class_id = $3
      )
      SELECT * FROM RankedResults WHERE student_id = $4 ORDER BY subject
    `, [term, school_id, reportClassId, studentId]);

    // 3. Get Class Rank & Overall Average
    const classRankRes = await pool.query(`
      WITH StudentAverages AS (
        SELECT r.student_id, AVG(r.score) as term_average,
               RANK() OVER (ORDER BY AVG(r.score) DESC) as class_rank,
               COUNT(*) OVER () as total_in_class
        FROM results r
        WHERE r.term = $1 AND r.school_id = $2 AND r.class_id = $3
        GROUP BY r.student_id
      )
      SELECT * FROM StudentAverages WHERE student_id = $4
    `, [term, school_id, reportClassId, studentId]);

    // 4. Get Performance Trends
    const trendsRes = await pool.query(`
      SELECT term, ROUND(AVG(score), 2) as term_average FROM results
      WHERE student_id = $1 AND school_id = $2 GROUP BY term ORDER BY term ASC
    `, [studentId, school_id]);

    // 5. Get Attendance
    const attRes = await pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'present') as present, COUNT(*) FILTER (WHERE status = 'absent') as absent, COUNT(*) FILTER (WHERE status = 'late') as late FROM attendance WHERE student_id = $1 AND school_id = $2`, [studentId, school_id]);

    res.json({ student, term, results: subjectsRes.rows, classStats: classRankRes.rows[0] || { term_average: 0, class_rank: '-', total_in_class: 0 }, trends: trendsRes.rows, attendance: attRes.rows[0] });
  } catch (error) { next(error); }
};

module.exports = {
  createClassAssessment,
  getStudentResults,
  getReportCard,
  listClassAssessments,
  recordResult,
  saveClassAssessmentScores,
};