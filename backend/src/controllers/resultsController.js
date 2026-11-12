const pool = require('../config/db');

const recordResult = async (req, res, next) => {
  const { school_id } = req.user;
  const { student_id, subject, class_score, exam_score, term } = req.body;

  const classScore = Number(class_score);
  const examScore = Number(exam_score);
  if (!student_id || !subject || class_score === undefined || exam_score === undefined || !term
      || !Number.isFinite(classScore) || classScore < 0 || classScore > 50
      || !Number.isFinite(examScore) || examScore < 0 || examScore > 50) {
    return res.status(400).json({ message: 'Student ID, subject, term, and class/exam scores from 0 to 50 are required.' });
  }

  const score = classScore + examScore;

  try {
    const result = await pool.query(
      `INSERT INTO results (school_id, student_id, subject, class_score, exam_score, score, term) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (student_id, subject, term) 
       DO UPDATE SET class_score = EXCLUDED.class_score, exam_score = EXCLUDED.exam_score, score = EXCLUDED.score
       RETURNING *`,
      [school_id, student_id, subject, classScore, examScore, score, term]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getResultsByStudent = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;
  const { studentId } = req.params;

  try {
    const filterQuery = role === 'parent' ? 'AND s.parent_id = $3' : '';
    const values = role === 'parent' ? [studentId, school_id, userId] : [studentId, school_id];

    const result = await pool.query(
      `SELECT r.id, r.student_id, r.subject, r.class_score, r.exam_score, r.score, r.term, r.created_at
       FROM results r
       JOIN students s ON r.student_id = s.id
       WHERE r.student_id = $1 AND s.school_id = $2 ${filterQuery}
       ORDER BY r.term, r.subject`,
      values
    );

    res.json(result.rows);
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
      SELECT s.name, LPAD(s.id::text, 6, '0') as student_id, c.name as class_name, c.id as class_id
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.id = $1 AND s.school_id = $2
    `, [studentId, school_id]);
    if (!studentRes.rows.length) return res.status(404).json({ message: 'Student not found.' });
    const student = studentRes.rows[0];

    // 2. Get Subject Results with Rank
    const subjectsRes = await pool.query(`
      WITH RankedResults AS (
        SELECT r.id, r.student_id, r.subject, r.class_score, r.exam_score, r.score,
               RANK() OVER (PARTITION BY r.subject ORDER BY r.score DESC) as subject_rank,
               COUNT(*) OVER (PARTITION BY r.subject) as total_students
        FROM results r JOIN students st ON r.student_id = st.id
        WHERE r.term = $1 AND r.school_id = $2 AND st.class_id = $3
      )
      SELECT * FROM RankedResults WHERE student_id = $4 ORDER BY subject
    `, [term, school_id, student.class_id, studentId]);

    // 3. Get Class Rank & Overall Average
    const classRankRes = await pool.query(`
      WITH StudentAverages AS (
        SELECT r.student_id, AVG(r.score) as term_average,
               RANK() OVER (ORDER BY AVG(r.score) DESC) as class_rank,
               COUNT(*) OVER () as total_in_class
        FROM results r JOIN students st ON r.student_id = st.id
        WHERE r.term = $1 AND r.school_id = $2 AND st.class_id = $3
        GROUP BY r.student_id
      )
      SELECT * FROM StudentAverages WHERE student_id = $4
    `, [term, school_id, student.class_id, studentId]);

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

module.exports = { recordResult, getResultsByStudent, getReportCard };
