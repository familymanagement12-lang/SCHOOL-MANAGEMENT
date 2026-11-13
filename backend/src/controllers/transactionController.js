const pool = require('../config/db');
const { MAIN_FINANCE_TRANSACTION_FILTER } = require('../services/financeScopes');

const getTransactions = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    const result = await pool.query(
      `SELECT * FROM transactions
       WHERE school_id = $1 AND ${MAIN_FINANCE_TRANSACTION_FILTER}
       ORDER BY date DESC, created_at DESC`,
      [school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getFinanceReport = async (req, res, next) => {
  const { school_id } = req.user;
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) return res.status(400).json({ message: 'Start and end dates are required.' });

  try {
    const result = await pool.query(
      `SELECT type, category, SUM(amount) as total
       FROM transactions
       WHERE school_id = $1 AND ${MAIN_FINANCE_TRANSACTION_FILTER}
         AND date >= $2 AND date <= $3
       GROUP BY type, category
       ORDER BY type, total DESC`,
      [school_id, startDate, endDate]
    );

    const report = { income: [], expenditure: [], totalIncome: 0, totalExpenditure: 0, netBalance: 0 };

    result.rows.forEach(row => {
      const amount = parseFloat(row.total);
      if (row.type === 'income') {
        report.income.push({ category: row.category, amount });
        report.totalIncome += amount;
      } else {
        report.expenditure.push({ category: row.category, amount });
        report.totalExpenditure += amount;
      }
    });

    report.netBalance = report.totalIncome - report.totalExpenditure;

    res.json(report);
  } catch (error) {
    next(error);
  }
};

const createTransaction = async (req, res, next) => {
  const { school_id } = req.user;
  const { type, category, amount, reference, description, date } = req.body;
  const numericAmount = Number(amount);
  if (!['income', 'expenditure'].includes(type) || !category?.trim()
      || !Number.isFinite(numericAmount) || numericAmount <= 0 || !date) {
    return res.status(400).json({ message: 'Choose a transaction type, category, positive amount, and date.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO transactions (school_id, type, category, amount, reference, description, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [school_id, type, category.trim(), numericAmount, reference || null, description || null, date]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const deleteTransaction = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM transactions WHERE id = $1 AND school_id = $2 AND source_type IS NULL RETURNING *',
      [id, school_id]
    );
    if (!result.rows.length) {
      const linked = await pool.query(
        'SELECT source_type FROM transactions WHERE id = $1 AND school_id = $2',
        [id, school_id]
      );
      if (linked.rows[0]?.source_type) {
        return res.status(409).json({ message: 'Operational finance entries cannot be deleted here. Correct the original feeding, tuckshop, or purchase record instead.' });
      }
      return res.status(404).json({ message: 'Transaction not found.' });
    }
    res.json({ message: 'Transaction deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getTransactions, getFinanceReport, createTransaction, deleteTransaction };