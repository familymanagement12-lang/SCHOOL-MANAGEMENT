const pool = require('../config/db');
const notificationEvents = require('../services/notificationService');

const recordAttendance = async (req, res, next) => {
  const { school_id } = req.user;
  const { student_id, date, status } = req.body;

  if (!student_id || !date || !status) {
    return res.status(400).json({ message: 'Student ID, date, and status are required.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO attendance (student_id, date, status, school_id) SELECT $1, $2, $3, $4 FROM students WHERE id = $1 AND school_id = $4 RETURNING *',
      [student_id, date, status, school_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Student not found in your school.' });
    }

    // Fire the event in the background
    notificationEvents.emit('attendance.marked', {
      student_id,
      date,
      status
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Attendance already recorded for this student on this date.' });
    }
    next(error);
  }
};

const getAttendanceByClass = async (req, res, next) => {
  const { school_id } = req.user;
  const { classId } = req.params;

  try {
    const result = await pool.query(
      `SELECT a.id, a.student_id, s.name AS student_name, a.date, a.status
       FROM attendance a
       JOIN students s ON a.student_id = s.id
       WHERE s.class_id = $1 AND a.school_id = $2
       ORDER BY a.date DESC`,
      [classId, school_id]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

module.exports = { recordAttendance, getAttendanceByClass };
