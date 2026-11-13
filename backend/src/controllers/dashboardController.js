const pool = require('../config/db');
const {
  MAIN_FINANCE_AUDIT_FILTER,
  MAIN_FINANCE_TRANSACTION_FILTER,
} = require('../services/financeScopes');

const getSummary = async (req, res, next) => {
  const { school_id } = req.user; // From auth middleware

  try {
    // Get total students
    const studentsResult = await pool.query(
      'SELECT COUNT(*) as total FROM students WHERE school_id = $1',
      [school_id]
    );
    const totalStudents = parseInt(studentsResult.rows[0].total, 10);

    // Get total classes
    const classesResult = await pool.query(
      'SELECT COUNT(*) as total FROM classes WHERE school_id = $1',
      [school_id]
    );
    const totalClasses = parseInt(classesResult.rows[0].total, 10);

    // Get total fees collected
    const feesResult = await pool.query(
      'SELECT COALESCE(SUM(amount_paid), 0) as total_collected FROM fees f JOIN students s ON f.student_id = s.id WHERE s.school_id = $1',
      [school_id]
    );
    const totalFeesCollected = parseFloat(feesResult.rows[0].total_collected);

    // Get attendance today summary
    const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const attendanceResult = await pool.query(
      `SELECT status, COUNT(*) as count FROM attendance a 
       JOIN students s ON a.student_id = s.id 
       WHERE s.school_id = $1 AND a.date = $2 
       GROUP BY status`,
      [school_id, todayDate]
    );

    const attendanceToday = {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    };

    attendanceResult.rows.forEach((row) => {
      attendanceToday[row.status] = parseInt(row.count, 10);
    });

    // 1. Fee Collection Trends (Monthly for the last 6 active months)
    const feeTrendsResult = await pool.query(
      `SELECT TO_CHAR(created_at, 'Mon') as month, SUM(amount_paid) as total 
       FROM fees 
       WHERE school_id = $1 AND amount_paid > 0 
       GROUP BY TO_CHAR(created_at, 'Mon'), EXTRACT(MONTH FROM created_at)
       ORDER BY EXTRACT(MONTH FROM created_at) LIMIT 6`,
      [school_id]
    );

    // 2. Top-performing Classes
    const topClassesResult = await pool.query(
      `SELECT c.name, ROUND(AVG(r.score), 2) as avg_score 
       FROM results r 
       JOIN students s ON r.student_id = s.id 
       JOIN classes c ON s.class_id = c.id 
       WHERE r.school_id = $1 
       GROUP BY c.id, c.name 
       ORDER BY avg_score DESC LIMIT 5`,
      [school_id]
    );

    // 3. Top-performing Students
    const topStudentsResult = await pool.query(
      `SELECT s.name, c.name as class_name, ROUND(AVG(r.score), 2) as avg_score 
       FROM results r 
       JOIN students s ON r.student_id = s.id 
       LEFT JOIN classes c ON s.class_id = c.id 
       WHERE r.school_id = $1 
       GROUP BY s.id, s.name, c.name 
       ORDER BY avg_score DESC LIMIT 5`,
      [school_id]
    );

    // 4. Students At Risk (Most Absences)
    const atRiskResult = await pool.query(
      `SELECT s.name, c.name as class_name, COUNT(*) as absences 
       FROM attendance a 
       JOIN students s ON a.student_id = s.id 
       LEFT JOIN classes c ON s.class_id = c.id 
       WHERE a.school_id = $1 AND a.status = 'absent' 
       GROUP BY s.id, s.name, c.name 
       ORDER BY absences DESC LIMIT 5`,
      [school_id]
    );

    // 5. Attendance Trends (Last 7 Days)
    const attendanceTrendsResult = await pool.query(
      `SELECT CAST(date AS TEXT) as date, 
              COUNT(*) FILTER (WHERE status = 'present') as present,
              COUNT(*) as total
       FROM attendance 
       WHERE school_id = $1 
       GROUP BY date 
       ORDER BY date DESC LIMIT 7`,
      [school_id]
    );

    res.json({
      totalStudents,
      totalClasses,
      totalFeesCollected,
      attendanceToday,
      feeTrends: feeTrendsResult.rows,
      topClasses: topClassesResult.rows,
      topStudents: topStudentsResult.rows,
      atRiskStudents: atRiskResult.rows,
      attendanceTrends: attendanceTrendsResult.rows
    });
  } catch (error) {
    next(error);
  }
};

const getFinanceSummary = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    const [transactions, fees, payroll] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income,
           COALESCE(SUM(amount) FILTER (WHERE type = 'expenditure'), 0) AS expenditure
         FROM transactions WHERE school_id = $1 AND ${MAIN_FINANCE_TRANSACTION_FILTER}`,
        [school_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount_due), 0) AS due,
                COALESCE(SUM(amount_paid), 0) AS paid,
                COALESCE(SUM(balance), 0) AS balance
         FROM fees WHERE school_id = $1`,
        [school_id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS records,
                COALESCE(SUM(net_salary) FILTER (WHERE status = 'pending'), 0) AS pending,
                COALESCE(SUM(net_salary) FILTER (WHERE status = 'paid'), 0) AS paid
         FROM payroll WHERE school_id = $1`,
        [school_id]
      ),
    ]);
    res.json({
      transactions: transactions.rows[0],
      fees: fees.rows[0],
      payroll: payroll.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

const getFinanceAudit = async (req, res, next) => {
  const { school_id } = req.user;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  try {
    const result = await pool.query(
      `SELECT a.id, a.actor_id, u.name AS actor_name, a.actor_role,
              a.table_name, a.record_id, a.action, a.old_data, a.new_data, a.created_at
       FROM finance_audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.school_id = $1 AND ${MAIN_FINANCE_AUDIT_FILTER}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $2`,
      [school_id, limit]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

module.exports = { getSummary, getFinanceSummary, getFinanceAudit };
