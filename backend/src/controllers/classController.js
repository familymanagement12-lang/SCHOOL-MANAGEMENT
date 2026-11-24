const pool = require('../config/db');
const { normalizeClassConfiguration } = require('../services/classConfiguration');
const { normalizeClassTeacherAssignment } = require('../services/classTeacherAssignment');
const {
  canonicalClassName,
} = require('../services/curriculumPolicy');

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
    res.json(result.rows.map((row) => ({
      ...row,
      name: canonicalClassName(row.name, row.year_level, row.curriculum),
    })));
  } catch (error) {
    next(error);
  }
};

const createClass = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, description, class_teacher_id, teacher_id, year_level, teaching_model, curriculum } = req.body;
  let classTeacherAssignment;
  let classConfiguration;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Class name is required.' });
  }
  try { classTeacherAssignment = normalizeClassTeacherAssignment(class_teacher_id !== undefined ? class_teacher_id : teacher_id); } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  try { classConfiguration = normalizeClassConfiguration({ year_level, teaching_model, curriculum }, { isNew: true }); } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const className = canonicalClassName(name, classConfiguration.yearLevel, classConfiguration.classCurriculum);

  try {
    if (classTeacherAssignment.teacherId !== null) {
      const teacher = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active = TRUE`,
        [classTeacherAssignment.teacherId, school_id]
      );
      if (!teacher.rows.length) return res.status(400).json({ message: 'Select an active teacher from this school as the class teacher.' });
    }

    const result = await pool.query(
      `INSERT INTO classes (school_id, name, description, teacher_id, class_teacher_id, year_level, teaching_model, curriculum)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
       RETURNING id, school_id, name, description, teacher_id, class_teacher_id, year_level, teaching_model, curriculum`,
      [school_id, className, description || null, classTeacherAssignment.teacherId, classConfiguration.yearLevel, classConfiguration.teachingModel, classConfiguration.classCurriculum]
    );

    res.status(201).json({
      ...result.rows[0],
      name: canonicalClassName(result.rows[0].name, result.rows[0].year_level, result.rows[0].curriculum),
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Class already exists for this school.' });
    }
    next(error);
  }
};

const updateClass = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, description, class_teacher_id, teacher_id, year_level, teaching_model, curriculum } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Class name is required.' });
  }
  let classTeacherAssignment;
  try { classTeacherAssignment = normalizeClassTeacherAssignment(class_teacher_id !== undefined ? class_teacher_id : teacher_id); } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const currentClass = await client.query(
      `SELECT id, year_level, curriculum, teaching_model
       FROM classes WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [req.params.id, school_id]
    );
    if (!currentClass.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Class not found.' });
    }

    let classConfiguration;
    try {
      classConfiguration = normalizeClassConfiguration({
        year_level: year_level === undefined ? currentClass.rows[0].year_level : year_level,
        curriculum: curriculum === undefined ? currentClass.rows[0].curriculum : curriculum,
        teaching_model: teaching_model === undefined ? currentClass.rows[0].teaching_model : teaching_model,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ message: error.message });
    }
    const className = canonicalClassName(name, classConfiguration.yearLevel, classConfiguration.classCurriculum);

    if (classTeacherAssignment.teacherId !== null) {
      const teacher = await client.query(
        `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active = TRUE`,
        [classTeacherAssignment.teacherId, school_id]
      );
      if (!teacher.rows.length) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(400).json({ message: 'Select an active teacher from this school as the class teacher.' });
      }
    }

    const result = await client.query(
      `UPDATE classes SET name = $1, description = $2,
                          teacher_id = CASE WHEN $3 THEN $4 ELSE teacher_id END,
                          class_teacher_id = CASE WHEN $3 THEN $4 ELSE class_teacher_id END,
                          year_level = $5,
                          teaching_model = $6,
                          curriculum = $7
      WHERE id = $8 AND school_id = $9
       RETURNING id, school_id, name, description, teacher_id, class_teacher_id, year_level, teaching_model, curriculum`,
      [className, description || null, classTeacherAssignment.provided, classTeacherAssignment.teacherId, classConfiguration.yearLevel, classConfiguration.teachingModel, classConfiguration.classCurriculum, req.params.id, school_id]
    );
    await client.query('COMMIT');
    transactionOpen = false;
    res.json(result.rows[0]);
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ message: 'Class already exists for this school.' });
    next(error);
  } finally {
    client?.release();
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
