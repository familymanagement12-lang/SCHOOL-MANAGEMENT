const pool = require('../config/db');
const { normalizeClassConfiguration } = require('../services/classConfiguration');

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
  let classConfiguration;

  if (!name?.trim() || !classTeacherId) {
    return res.status(400).json({ message: 'Class name and one class teacher are required.' });
  }
  try { classConfiguration = normalizeClassConfiguration({ year_level, teaching_model, curriculum }, { isNew: true }); } catch (error) {
    return res.status(400).json({ message: error.message });
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
      [school_id, name.trim(), description || null, classTeacherId, classConfiguration.yearLevel, classConfiguration.teachingModel, classConfiguration.classCurriculum]
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
  const classTeacherId = Number(class_teacher_id);

  if (!name?.trim() || !classTeacherId) {
    return res.status(400).json({ message: 'Class name and one class teacher are required.' });
  }
  let classConfiguration;
  try { classConfiguration = normalizeClassConfiguration({ year_level, teaching_model, curriculum }); } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const teacher = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active = TRUE`,
      [classTeacherId, school_id]
    );
    if (!teacher.rows.length) return res.status(400).json({ message: 'Select an active teacher from this school as the class teacher.' });

    const result = await pool.query(
      `UPDATE classes SET name = $1, description = $2, teacher_id = $3, class_teacher_id = $3,
                          year_level = COALESCE($4, year_level),
                          teaching_model = COALESCE($5, teaching_model),
                          curriculum = COALESCE($6, curriculum)
      WHERE id = $7 AND school_id = $8
       RETURNING id, school_id, name, description, teacher_id, class_teacher_id, year_level, teaching_model, curriculum`,
      [name.trim(), description || null, classTeacherId, classConfiguration.yearLevel, classConfiguration.teachingModel, classConfiguration.classCurriculum, req.params.id, school_id]
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
