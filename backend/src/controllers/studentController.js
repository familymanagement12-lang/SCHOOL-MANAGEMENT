const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { canonicalClassName } = require('../services/curriculumPolicy');

const withCanonicalClassName = (student) => ({
  ...student,
  class_name: canonicalClassName(
    student.class_name,
    student.year_level,
    student.class_curriculum || student.curriculum,
  ),
});

const studentSelect = `
  SELECT DISTINCT
    s.id,
    LPAD(s.id::text, 6, '0') AS student_id,
    s.name,
    TO_CHAR(s.dob, 'YYYY-MM-DD') AS dob,
    s.allergies,
    s.disability,
    s.class_id,
    c.name AS class_name,
    s.curriculum,
    c.curriculum AS class_curriculum,
    c.year_level,
    u.is_active AS account_active,
    u.id AS account_user_id
  FROM students s
  LEFT JOIN classes c ON s.class_id = c.id
  LEFT JOIN users u ON u.id = s.user_id AND u.school_id = s.school_id
`;

const normalizeClassId = (classId) => {
  if (classId === undefined || classId === null || classId === '') {
    return null;
  }

  const parsedClassId = Number(classId);
  return Number.isInteger(parsedClassId) && parsedClassId > 0 ? parsedClassId : NaN;
};

const ensureClassBelongsToSchool = async (classId, schoolId) => {
  if (!classId) {
    return null;
  }

  const result = await pool.query(
    'SELECT id, name, year_level, curriculum FROM classes WHERE id = $1 AND school_id = $2',
    [classId, schoolId]
  );
  if (!result.rows.length) {
    const error = new Error('Please select a valid class for this school.');
    error.status = 400;
    throw error;
  }
  if (result.rows[0].year_level >= 7 && result.rows[0].year_level <= 9
      && !['GES', 'PEARSON'].includes(result.rows[0].curriculum)) {
    const error = new Error('Assign GES or Pearson curriculum to this class before enrolling students.');
    error.status = 400;
    throw error;
  }
  return result.rows[0];
};

const getStudents = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;

  try {
    if (role === 'accountant') {
      const result = await pool.query(
        `SELECT s.id, LPAD(s.id::text, 6, '0') AS student_id, s.name,
                s.class_id, c.name AS class_name, s.curriculum, c.curriculum AS class_curriculum, c.year_level
         FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
         WHERE s.school_id = $1 ORDER BY s.id`,
        [school_id]
      );
      return res.json(result.rows.map(withCanonicalClassName));
    }
    const query = `${studentSelect} WHERE s.school_id = $1 ORDER BY s.id`;
    const values = [school_id];

    const result = await pool.query(query, values);
    res.json(result.rows.map(withCanonicalClassName));
  } catch (error) {
    next(error);
  }
};

const getStudentById = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `${studentSelect} WHERE s.id = $1 AND s.school_id = $2`,
      [id, school_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    res.json(withCanonicalClassName(result.rows[0]));
  } catch (error) {
    next(error);
  }
};

const createStudent = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, class_id, dob, allergies, disability } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Student name is required.' });
  }

  try {
    const normalizedClassId = normalizeClassId(class_id);
    if (Number.isNaN(normalizedClassId)) {
      return res.status(400).json({ message: 'Please select a valid class.' });
    }

    const assignedClass = await ensureClassBelongsToSchool(normalizedClassId, school_id);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO students (school_id, class_id, name, dob, allergies, disability)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *, LPAD(id::text, 6, '0') AS student_id`,
        [school_id, normalizedClassId, name, dob || null, allergies || null, disability || null]
      );
      const newStudent = result.rows[0];

      const studentPassword = crypto.randomBytes(4).toString('hex');
      const hashedStudentPassword = await bcrypt.hash(studentPassword, 10);
      const studentEmail = `stu_${newStudent.student_id}_${crypto.randomBytes(2).toString('hex')}@educore.local`;

      const studentUserRes = await client.query(
        'INSERT INTO users (school_id, name, email, password, role, must_change_password, email_verified) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [school_id, name, studentEmail, hashedStudentPassword, 'student', true, true]
      );

      await client.query('UPDATE students SET user_id = $1 WHERE id = $2', [studentUserRes.rows[0].id, newStudent.id]);

      await client.query('COMMIT');
      res.status(201).json({
        ...newStudent,
        class_name: canonicalClassName(assignedClass?.name, assignedClass?.year_level, assignedClass?.curriculum),
        studentPassword,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'A student with this information already exists.' });
    }
    next(error);
  }
};

const updateStudent = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  const { name, class_id, dob, allergies, disability } = req.body;

  try {
    const normalizedClassId = normalizeClassId(class_id);
    if (Number.isNaN(normalizedClassId)) {
      return res.status(400).json({ message: 'Please select a valid class.' });
    }

    const assignedClass = await ensureClassBelongsToSchool(normalizedClassId, school_id);

    const result = await pool.query(
      `UPDATE students
       SET name = $1, class_id = $2, dob = $3, allergies = $4, disability = $5
       WHERE id = $6 AND school_id = $7
       RETURNING *, LPAD(id::text, 6, '0') AS student_id`,
      [name, normalizedClassId, dob || null, allergies || null, disability || null, id, school_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    res.json({
      ...result.rows[0],
      class_name: canonicalClassName(assignedClass?.name, assignedClass?.year_level, assignedClass?.curriculum),
    });
  } catch (error) {
    next(error);
  }
};

const deleteStudent = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM students WHERE id = $1 AND school_id = $2 RETURNING *', [id, school_id]);
    if (!result.rows.length) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    res.json({ message: 'Student removed successfully.' });
  } catch (error) {
    next(error);
  }
};

const setStudentAccountStatus = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const { id } = req.params;
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ message: 'Account status must be active or inactive.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE users u SET is_active = $1
       FROM students s
       WHERE s.id = $2 AND s.school_id = $3 AND s.user_id = u.id AND u.school_id = s.school_id
       RETURNING s.id AS student_id, u.is_active`,
      [is_active, id, school_id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Student account not found.' });
    }
    await client.query(
      `INSERT INTO student_portal_audit_log (school_id, student_id, actor_id, action)
       VALUES ($1, $2, $3, $4)`,
      [school_id, result.rows[0].student_id, actorId, is_active ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED']
    );
    await client.query('COMMIT');
    res.json({ student_id: result.rows[0].student_id, is_active: result.rows[0].is_active });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const resetStudentAccountPassword = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query(
      `SELECT s.id AS student_id, LPAD(s.id::text, 6, '0') AS student_id_label, u.id AS user_id
       FROM students s JOIN users u ON u.id = s.user_id AND u.school_id = s.school_id
       WHERE s.id = $1 AND s.school_id = $2 AND u.role = 'student'
       FOR UPDATE OF u`,
      [id, school_id]
    );
    if (!account.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Student account not found.' });
    }
    const temporaryPassword = crypto.randomBytes(6).toString('base64url');
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    await client.query(
      'UPDATE users SET password = $1, must_change_password = TRUE WHERE id = $2',
      [hashedPassword, account.rows[0].user_id]
    );
    await client.query(
      `INSERT INTO student_portal_audit_log (school_id, student_id, actor_id, action)
       VALUES ($1, $2, $3, 'PASSWORD_RESET')`,
      [school_id, account.rows[0].student_id, actorId]
    );
    await client.query('COMMIT');
    res.json({
      student_id: account.rows[0].student_id_label,
      temporary_password: temporaryPassword,
      must_change_password: true,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const bulkCreateStudents = async (req, res, next) => {
  const { school_id } = req.user;
  const { class_id, students } = req.body;

  if (!students || !Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ message: 'A list of students is required.' });
  }

  try {
    const normalizedClassId = normalizeClassId(class_id);
    if (class_id && Number.isNaN(normalizedClassId)) {
      return res.status(400).json({ message: 'Please select a valid class.' });
    }

    await ensureClassBelongsToSchool(normalizedClassId, school_id);

    const client = await pool.connect();
    const createdStudents = [];
    try {
      await client.query('BEGIN');

      for (const studentData of students) {
        const { name, dob, allergies, disability } = studentData;

        if (!name) continue;

        const result = await client.query(
          `INSERT INTO students (school_id, class_id, name, dob, allergies, disability)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *, LPAD(id::text, 6, '0') AS student_id`,
          [school_id, normalizedClassId, name, dob || null, allergies || null, disability || null]
        );
        const newStudent = result.rows[0];

        const studentPassword = crypto.randomBytes(4).toString('hex');
        const hashedStudentPassword = await bcrypt.hash(studentPassword, 10);
        const studentEmail = `stu_${newStudent.student_id}_${crypto.randomBytes(2).toString('hex')}@educore.local`;

        const studentUserRes = await client.query(
          'INSERT INTO users (school_id, name, email, password, role, must_change_password, email_verified) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [school_id, name, studentEmail, hashedStudentPassword, 'student', true, true]
        );

        await client.query('UPDATE students SET user_id = $1 WHERE id = $2', [studentUserRes.rows[0].id, newStudent.id]);
        createdStudents.push(newStudent);
      }

      await client.query('COMMIT');
      res.status(201).json({ message: `Successfully added ${createdStudents.length} students.`, students: createdStudents });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'An account with one of the provided emails already exists. Please check your data.' });
    }
    next(error);
  }
};

module.exports = {
  getStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  bulkCreateStudents,
  setStudentAccountStatus,
  resetStudentAccountPassword,
};
