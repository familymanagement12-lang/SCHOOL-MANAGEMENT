const pool = require('../config/db');
const { moneyToCents, parseDate } = require('../services/feedingService');

const recordFee = async (req, res, next) => {
  const { school_id } = req.user;
  const { student_id, amount_due, amount_paid, due_date, description } = req.body;

  const studentId = Number(student_id);
  const amountDueCents = moneyToCents(amount_due);
  const amountPaidCents = moneyToCents(amount_paid);
  if (!Number.isSafeInteger(studentId) || studentId <= 0
      || amountDueCents === null || amountDueCents <= 0
      || amountPaidCents !== 0
      || (due_date && !parseDate(due_date))
      || (description && (typeof description !== 'string' || description.trim().length > 500))) {
    return res.status(400).json({
      message: 'Create a positive fee invoice with no payment. Record receipts through the combined payments workflow.',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO fees (student_id, amount_due, amount_paid, due_date, description, school_id)
       SELECT $1, $2, 0, $3, $4, $5 FROM students
       WHERE id = $1 AND school_id = $5 RETURNING *`,
      [studentId, (amountDueCents / 100).toFixed(2), due_date || null, description?.trim() || null, school_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Student not found in your school.' });
    }

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
      `SELECT f.id, f.student_id, f.amount_due, f.amount_paid, f.balance, f.due_date,
              f.description, f.fee_structure_id, f.is_fee_override, f.fee_override_reason, f.created_at
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
