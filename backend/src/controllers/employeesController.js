const pool = require('../config/db');

const getEmployees = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    const result = await pool.query(
      'SELECT * FROM employees WHERE school_id = $1 ORDER BY is_active DESC, full_name ASC',
      [school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createEmployee = async (req, res, next) => {
  const { school_id } = req.user;
  const { full_name, role, phone, email, basic_salary, allowance, deductions, bank_name, bank_account } = req.body;
  const normalizedName = typeof full_name === 'string' ? full_name.trim() : '';
  const normalizedRole = typeof role === 'string' ? role.trim() : '';

  if (!normalizedName || !normalizedRole) {
    return res.status(400).json({ message: 'Full name and role are required.' });
  }
  if (normalizedRole.length > 80) {
    return res.status(400).json({ message: 'Staff role must be 80 characters or fewer.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO employees (school_id, full_name, role, phone, email, basic_salary, allowance, deductions, bank_name, bank_account)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [school_id, normalizedName, normalizedRole, phone, email, basic_salary || 0, allowance || 0, deductions || 0, bank_name, bank_account]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const updateEmployee = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  const { full_name, role, phone, email, basic_salary, allowance, deductions, bank_name, bank_account, is_active } = req.body;
  const normalizedRole = role === undefined ? undefined : (typeof role === 'string' ? role.trim() : '');
  if (normalizedRole !== undefined && !normalizedRole) {
    return res.status(400).json({ message: 'Staff role is required.' });
  }
  if (normalizedRole && normalizedRole.length > 80) {
    return res.status(400).json({ message: 'Staff role must be 80 characters or fewer.' });
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return res.status(400).json({ message: 'Staff status must be active or inactive.' });
  }

  try {
    const result = await pool.query(
      `UPDATE employees SET 
        full_name = COALESCE($1, full_name), role = COALESCE($2, role), phone = COALESCE($3, phone), email = COALESCE($4, email),
        basic_salary = COALESCE($5, basic_salary), allowance = COALESCE($6, allowance), deductions = COALESCE($7, deductions),
        bank_name = COALESCE($8, bank_name), bank_account = COALESCE($9, bank_account), is_active = COALESCE($10, is_active)
       WHERE id = $11 AND school_id = $12 RETURNING *`,
      [full_name, normalizedRole, phone, email, basic_salary, allowance, deductions, bank_name, bank_account, is_active, id, school_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Employee not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const deactivateEmployee = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE employees SET is_active = FALSE WHERE id = $1 AND school_id = $2 RETURNING id',
      [id, school_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Employee not found.' });
    res.json({ message: 'Employee marked inactive. Their payroll and attendance history has been kept.' });
  } catch (error) { next(error); }
};

module.exports = { getEmployees, createEmployee, updateEmployee, deactivateEmployee };