const pool = require('../config/db');
const notificationEvents = require('../services/notificationService');

const recordFee = async (req, res, next) => {
  const { school_id } = req.user;
  const { student_id, amount_due, amount_paid, due_date } = req.body;

  if (!student_id || amount_due === undefined || amount_paid === undefined) {
    return res.status(400).json({ message: 'Student ID, amount_due, and amount_paid are required.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO fees (student_id, amount_due, amount_paid, due_date, school_id) SELECT $1, $2, $3, $4, $5 FROM students WHERE id = $1 AND school_id = $5 RETURNING *',
      [student_id, amount_due, amount_paid, due_date || null, school_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Student not found in your school.' });
    }

    if (amount_paid > 0) {
      const studentRes = await pool.query('SELECT name FROM students WHERE id = $1', [student_id]);
      const studentName = studentRes.rows[0]?.name || 'Student';

      await pool.query(
        `INSERT INTO transactions (school_id, type, category, amount, reference, description, date)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)`,
        [school_id, 'income', 'School Fees', amount_paid, `FEE-${result.rows[0].id}`, `Fee payment received for ${studentName}`]
      );
    }

    // Fire the background event
    notificationEvents.emit('fee.paid', {
      student_id,
      amount_paid,
      balance: result.rows[0].balance
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getFeesByStudent = async (req, res, next) => {
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
      `SELECT f.id, f.student_id, f.amount_due, f.amount_paid, f.balance, f.due_date, f.created_at
       FROM fees f
       JOIN students s ON f.student_id = s.id
       WHERE f.student_id = $1 AND f.school_id = $2 ${filterQuery}`,
      values
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

module.exports = { recordFee, getFeesByStudent };
