const pool = require('../config/db');
const notificationEvents = require('../services/notificationService');
const validStatuses = ['present', 'absent', 'late', 'excused'];
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

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

const getStaffAttendance = async (req, res, next) => {
  const { school_id } = req.user;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  if (!validDate(date)) return res.status(400).json({ message: 'Date must be a valid calendar date in YYYY-MM-DD format.' });
  try {
    const result = await pool.query(
      `SELECT e.id AS employee_id, e.full_name, e.role AS staff_role,
              a.id AS attendance_id, a.status, a.reason, a.attendance_date
       FROM employees e
       LEFT JOIN staff_attendance a
         ON a.employee_id=e.id AND a.school_id=e.school_id AND a.attendance_date=$2::date
       WHERE e.school_id=$1 AND (e.is_active=TRUE OR a.id IS NOT NULL)
       ORDER BY e.is_active DESC, e.full_name`,
      [school_id, date]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const recordStaffAttendance = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const date = req.body.date;
  const entries = req.body.records;
  if (!validDate(date) || !Array.isArray(entries) || !entries.length || entries.length > 1000) {
    return res.status(400).json({ message: 'Provide a valid date and at least one staff attendance record.' });
  }
  const records = entries.map((entry) => ({
    employeeId: Number(entry.employee_id),
    status: entry.status,
    reason: typeof entry.reason === 'string' ? entry.reason.trim() : '',
  }));
  if (records.some((entry) => !Number.isSafeInteger(entry.employeeId) || entry.employeeId < 1
      || !validStatuses.includes(entry.status) || entry.reason.length > 500
      || (entry.status === 'absent' && !entry.reason))
      || new Set(records.map((entry) => entry.employeeId)).size !== records.length) {
    return res.status(400).json({ message: 'Each staff record needs a unique staff member, valid status, and a reason when absent.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const employeeIds = records.map((entry) => entry.employeeId);
    const employees = await client.query(
      `SELECT id FROM employees
       WHERE school_id=$1 AND is_active=TRUE AND id=ANY($2::integer[])`,
      [school_id, employeeIds]
    );
    if (employees.rowCount !== employeeIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Choose active staff members from this school.' });
    }

    for (const entry of records) {
      await client.query(
        `INSERT INTO staff_attendance
           (school_id, employee_id, attendance_date, status, reason, marked_by)
         VALUES ($1,$2,$3::date,$4,$5,$6)
         ON CONFLICT (school_id, employee_id, attendance_date)
         DO UPDATE SET status=EXCLUDED.status, reason=EXCLUDED.reason,
                       marked_by=EXCLUDED.marked_by, updated_at=NOW()`,
        [school_id, entry.employeeId, date, entry.status, entry.reason || null, actorId]
      );
    }
    await client.query('COMMIT');
    res.json({ message: `Saved attendance for ${records.length} staff members.`, records_saved: records.length });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    next(error);
  } finally {
    client?.release();
  }
};

module.exports = { recordAttendance, getAttendanceByClass, getStaffAttendance, recordStaffAttendance };
