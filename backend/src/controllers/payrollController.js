const pool = require('../config/db');

const getPayroll = async (req, res, next) => {
  const { school_id } = req.user;
  const { month, year } = req.query;
  
  try {
    let query = `
      SELECT p.*, e.full_name, e.role, e.bank_name, e.bank_account,
        COALESCE(
          (SELECT json_agg(json_build_object('id', pd.id, 'type', pd.type, 'amount', pd.amount, 'description', pd.description))
           FROM payroll_deductions pd WHERE pd.payroll_id = p.id), '[]'::json
        ) as deductions_list
      FROM payroll p
      JOIN employees e ON p.employee_id = e.id
      WHERE p.school_id = $1
    `;
    const values = [school_id];

    if (month && year) {
      query += ` AND p.month = $2 AND p.year = $3`;
      values.push(month, year);
    }
    
    query += ` ORDER BY p.year DESC, p.month DESC, e.full_name ASC`;
    
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const generatePayroll = async (req, res, next) => {
  const { school_id } = req.user;
  const { month, year } = req.body;

  if (!month || !year) return res.status(400).json({ message: 'Month and year are required.' });

  try {
    // 1. Fetch all active employees
    const empRes = await pool.query('SELECT * FROM employees WHERE school_id = $1 AND is_active = TRUE', [school_id]);
    const employees = empRes.rows;
    if (employees.length === 0) return res.status(400).json({ message: 'No active employees found to generate payroll.' });

    let generatedCount = 0;

    // 2. Generate a payroll entry for each active employee if one doesn't exist for this month/year yet
    for (const emp of employees) {
      const checkRes = await pool.query('SELECT id FROM payroll WHERE school_id = $1 AND employee_id = $2 AND month = $3 AND year = $4', [school_id, emp.id, month, year]);
      
      if (checkRes.rows.length === 0) {
        const basic = parseFloat(emp.basic_salary) || 0;
        const allow = parseFloat(emp.allowance) || 0;
        const ded = parseFloat(emp.deductions) || 0;
        const gross = basic + allow;
        const net = gross - ded;

        const payrollRes = await pool.query(
          `INSERT INTO payroll (school_id, employee_id, month, year, basic_salary, allowance, deductions, gross_salary, net_salary) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [school_id, emp.id, month, year, basic, allow, ded, gross, net]
        );

        if (ded > 0) {
          await pool.query(
            'INSERT INTO payroll_deductions (payroll_id, employee_id, school_id, type, amount, description) VALUES ($1, $2, $3, $4, $5, $6)',
            [payrollRes.rows[0].id, emp.id, school_id, 'Standard Deduction', ded, 'Default monthly deduction set in employee profile']
          );
        }
        generatedCount++;
      }
    }
    res.json({ message: `Successfully generated payroll for ${generatedCount} employees.`, generatedCount });
  } catch (error) { next(error); }
};

const markAsPaid = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  try {
    // 1. Mark as paid (Only if it is currently pending to prevent double-charging)
    const result = await pool.query(
      `UPDATE payroll SET status = 'paid', paid_at = NOW() WHERE id = $1 AND school_id = $2 AND status = 'pending' RETURNING *`, 
      [id, school_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Payroll record not found or already paid.' });
    }

    const payrollRecord = result.rows[0];

    // 2. Fetch employee details for the ledger description
    const empRes = await pool.query('SELECT full_name FROM employees WHERE id = $1', [payrollRecord.employee_id]);
    const empName = empRes.rows[0]?.full_name || 'Staff';

    // 3. Automatically record the expenditure in the Transactions ledger
    await pool.query(
      `INSERT INTO transactions (school_id, type, category, amount, reference, description, date)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)`,
      [school_id, 'expenditure', 'Salaries & Wages', payrollRecord.net_salary, `PAY-${payrollRecord.id}`, `Salary payment for ${empName} (${payrollRecord.month}/${payrollRecord.year})`]
    );

    res.json(payrollRecord);
  } catch (error) { next(error); }
};

const addDeduction = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  const { type, amount, description } = req.body;

  if (!type || !amount) return res.status(400).json({ message: 'Type and amount are required.' });

  try {
    const pr = await pool.query('SELECT employee_id, status FROM payroll WHERE id = $1 AND school_id = $2', [id, school_id]);
    if (!pr.rows.length) return res.status(404).json({ message: 'Payroll record not found.' });
    if (pr.rows[0].status === 'paid') return res.status(400).json({ message: 'Cannot modify a cleared payroll record.' });

    await pool.query('BEGIN');
    
    await pool.query(
      'INSERT INTO payroll_deductions (payroll_id, employee_id, school_id, type, amount, description) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, pr.rows[0].employee_id, school_id, type, amount, description]
    );

    await pool.query(
      `UPDATE payroll SET deductions = deductions + $1, net_salary = net_salary - $1 WHERE id = $2`,
      [amount, id]
    );

    await pool.query('COMMIT');
    res.status(201).json({ message: 'Deduction applied successfully.' });
  } catch (error) {
    await pool.query('ROLLBACK');
    next(error);
  }
};

module.exports = { getPayroll, generatePayroll, markAsPaid, addDeduction };