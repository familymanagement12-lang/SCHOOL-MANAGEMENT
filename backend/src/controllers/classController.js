const pool = require('../config/db');
const { curriculumForYearLevel } = require('../services/curriculumPolicy');

const getClasses = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;

  try {
    let query = `SELECT id, name, description, teacher_id, class_teacher_id,
                        year_level, teaching_model, curriculum
                 FROM classes WHERE school_id = $1 ORDER BY year_level NULLS LAST, name`;
    let values = [school_id];

    // Teachers should ONLY see their assigned classes
    if (role === 'teacher') {
      query = `SELECT id, name, description, teacher_id, class_teacher_id,
              year_level, teaching_model, curriculum
           FROM classes WHERE school_id = $1 AND class_teacher_id = $2
           ORDER BY year_level NULLS LAST, name`;
      values = [school_id, userId];
    }

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createClass = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;
  const { name, description, class_teacher_id, teacher_id, year_level, teaching_model, curriculum } = req.body;
  const classTeacherId = Number(role === 'teacher' ? userId : (class_teacher_id || teacher_id));
  const yearLevel = Number(year_level);
  const teachingModel = teaching_model || (yearLevel <= 3 ? 'class_teacher' : 'subject_teacher');
  let classCurriculum;

  if (!name?.trim() || !Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 11 || !classTeacherId) {
    return res.status(400).json({ message: 'Class name, year level from 1 to 11, and one class teacher are required.' });
  }
  try { classCurriculum = curriculumForYearLevel(yearLevel, curriculum); } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  if (!['class_teacher', 'subject_teacher'].includes(teachingModel)) {
    return res.status(400).json({ message: 'Teaching model must be class_teacher or subject_teacher.' });
  }

  try {
    const teacher = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active = TRUE`,
      [classTeacherId, school_id]
    );
    if (!teacher.rows.length) return res.status(400).json({ message: 'Select an active teacher from this school as the class teacher.' });

    const result = await pool.query(
      `INSERT INTO classes (school_id, name, description, teacher_id, class_teacher_id, year_level, teaching_model, curriculum)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
       RETURNING id, school_id, name, description, teacher_id, class_teacher_id, year_level, teaching_model, curriculum`,
      [school_id, name.trim(), description || null, classTeacherId, yearLevel, teachingModel, classCurriculum]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Class already exists for this school.' });
    }
    next(error);
  }
};

const updateClass = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, description, class_teacher_id, year_level, teaching_model, curriculum } = req.body;
  const yearLevel = Number(year_level);
  const classTeacherId = Number(class_teacher_id);
  const teachingModel = teaching_model || (yearLevel <= 3 ? 'class_teacher' : 'subject_teacher');

  if (!name?.trim() || !Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 11 || !classTeacherId) {
    return res.status(400).json({ message: 'Class name, year level from 1 to 11, and one class teacher are required.' });
  }
  let classCurriculum;
  try { classCurriculum = curriculumForYearLevel(yearLevel, curriculum); } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  if (!['class_teacher', 'subject_teacher'].includes(teachingModel)) {
    return res.status(400).json({ message: 'Teaching model must be class_teacher or subject_teacher.' });
  }

  try {
    const teacher = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active = TRUE`,
      [classTeacherId, school_id]
    );
    if (!teacher.rows.length) return res.status(400).json({ message: 'Select an active teacher from this school as the class teacher.' });

    const result = await pool.query(
      `UPDATE classes SET name = $1, description = $2, teacher_id = $3, class_teacher_id = $3,
                          year_level = $4, teaching_model = $5, curriculum = $6
      WHERE id = $7 AND school_id = $8
       RETURNING id, school_id, name, description, teacher_id, class_teacher_id, year_level, teaching_model, curriculum`,
      [name.trim(), description || null, classTeacherId, yearLevel, teachingModel, classCurriculum, req.params.id, school_id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Class not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'Class already exists for this school.' });
    next(error);
  }
};

const deleteClass = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM classes WHERE id = $1 AND school_id = $2 RETURNING *', [id, school_id]);
    if (!result.rows.length) {
      return res.status(404).json({ message: 'Class not found.' });
    }
    res.json({ message: 'Class deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getClasses, createClass, updateClass, deleteClass };
