const ExcelJS = require('exceljs');
const pool = require('../config/db');
const { ensureTermObligations, findFeedingTerm } = require('../services/feedingDataService');
const { addDays, parseDate } = require('../services/feedingService');

const today = () => new Date().toISOString().slice(0, 10);
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const reportTypes = new Set([
  'daily', 'weekly', 'monthly', 'termly', 'class_collections',
  'outstanding', 'advance_credit', 'payment_history',
]);

const dateRange = (type, date, startDate, endDate) => {
  if (type === 'daily') return { startDate: date, endDate: date };
  if (type === 'weekly') {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    const start = addDays(date, 1 - weekday);
    return { startDate: start, endDate: addDays(start, 6) };
  }
  if (type === 'monthly') {
    const [year, month] = date.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      startDate: `${year}-${String(month).padStart(2, '0')}-01`,
      endDate: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  if (startDate || endDate) return { startDate: startDate || endDate, endDate: endDate || startDate };
  return { startDate: date, endDate: date };
};

const obligationReport = async (client, schoolId, { startDate, endDate, classId, outstandingOnly }) => {
  const result = await client.query(
    `SELECT o.feeding_date::TEXT AS date, o.academic_year, o.term,
            o.class_id, o.class_name_snapshot AS class_name,
            s.id AS student_id, LPAD(s.id::TEXT, 6, '0') AS admission_number,
            s.name AS student_name, COALESCE(fh.payment_frequency, a.payment_frequency) AS payment_frequency,
            o.daily_rate, o.amount_due,
            GREATEST(COALESCE(p.paid, 0) - COALESCE(r.refunded, 0), 0) AS amount_paid,
            GREATEST(o.amount_due - COALESCE(p.paid, 0) + COALESCE(r.refunded, 0), 0) AS outstanding_balance,
            COALESCE(d.is_served, FALSE) AS is_served
     FROM feeding_obligations o
     JOIN students s ON s.id = o.student_id AND s.school_id = o.school_id
     JOIN feeding_student_accounts a ON a.student_id = s.id AND a.school_id = s.school_id
     LEFT JOIN LATERAL (
       SELECT fh.payment_frequency
       FROM feeding_frequency_history fh
       WHERE fh.school_id = o.school_id AND fh.student_id = o.student_id
         AND fh.effective_from <= o.feeding_date
       ORDER BY fh.effective_from DESC, fh.created_at DESC, fh.id DESC LIMIT 1
     ) fh ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(pa.amount) AS paid FROM school_payment_allocations pa
       WHERE pa.school_id = o.school_id AND pa.obligation_id = o.id
     ) p ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(ra.amount) AS refunded
       FROM school_payment_refund_allocations ra
       JOIN school_payment_allocations pa
         ON pa.id = ra.payment_allocation_id AND pa.school_id = ra.school_id
       WHERE pa.school_id = o.school_id AND pa.obligation_id = o.id
         AND ra.component = 'feeding'
     ) r ON TRUE
     LEFT JOIN feeding_coverage_days d
       ON d.school_id = o.school_id AND d.obligation_id = o.id
     WHERE o.school_id = $1 AND o.feeding_date BETWEEN $2 AND $3
       AND ($4::INTEGER IS NULL OR o.class_id = $4)
       AND (NOT $5::BOOLEAN OR o.amount_due > COALESCE(p.paid, 0) - COALESCE(r.refunded, 0))
     ORDER BY o.feeding_date, o.class_name_snapshot, s.name, o.id`,
    [schoolId, startDate, endDate, classId, outstandingOnly]
  );
  return result.rows;
};

const makeReport = async (req, res, next, exportExcel = false) => {
  const type = String(req.query.report_type || 'daily');
  const date = req.query.date || today();
  const classId = req.query.class_id ? Number(req.query.class_id) : null;
  const hasAcademicYear = Boolean(req.query.academic_year);
  const hasTerm = Boolean(req.query.term);
  if (!reportTypes.has(type) || !parseDate(date)
      || (classId !== null && (!Number.isSafeInteger(classId) || classId <= 0))
      || hasAcademicYear !== hasTerm) {
    return res.status(400).json({ message: 'Choose a valid feeding report type, date, and class.' });
  }

  let term = null;
  let range;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const hasDateRange = Boolean(req.query.start_date || req.query.end_date);
    if (['termly', 'outstanding'].includes(type) || (req.query.academic_year && req.query.term)) {
      const academicYear = String(req.query.academic_year || '').trim();
      const termName = String(req.query.term || '').trim();
      if (academicYear && (!/^\d{4}[/-]\d{4}$/.test(academicYear) || !termName || termName.length > 80)) {
        throw invalid('Provide a valid academic year and term.');
      }
      term = await findFeedingTerm(
        client,
        req.user.school_id,
        academicYear ? { academicYear, term: termName } : { date }
      );
      if (!term) throw invalid('No configured feeding term matches the report selection.');
    }

    range = type === 'termly' || (type === 'outstanding' && !hasDateRange)
      ? { startDate: term.start_date, endDate: term.end_date }
      : dateRange(type, date, req.query.start_date, req.query.end_date);
    if (!parseDate(range.startDate) || !parseDate(range.endDate) || range.startDate > range.endDate
        || new Date(`${range.endDate}T00:00:00Z`) - new Date(`${range.startDate}T00:00:00Z`) > 366 * 86400000) {
      throw invalid('Report date range must be valid and no longer than one year.');
    }

    const terms = await client.query(
      `SELECT id, academic_year, term, start_date::TEXT, end_date::TEXT, scheduled_weekdays
       FROM feeding_terms
       WHERE school_id = $1 AND start_date <= $3 AND end_date >= $2
       ORDER BY start_date`,
      [req.user.school_id, range.startDate, range.endDate]
    );
    let unconfigured = [];
    for (const feedingTerm of terms.rows) {
      const generated = await ensureTermObligations(client, req.user.school_id, feedingTerm);
      unconfigured = unconfigured.concat(generated.unconfigured);
    }

    let rows;
    if (type === 'outstanding' || ['daily', 'weekly', 'monthly', 'termly'].includes(type)) {
      rows = await obligationReport(client, req.user.school_id, {
        ...range, classId, outstandingOnly: type === 'outstanding',
      });
      if (type === 'outstanding') {
        const totals = new Map();
        for (const row of rows) {
          const key = `${row.student_id}:${row.class_id || ''}`;
          const total = totals.get(key) || {
            student_id: row.student_id,
            admission_number: row.admission_number,
            student_name: row.student_name,
            class_id: row.class_id,
            class_name: row.class_name,
            academic_year: row.academic_year,
            term: row.term,
            scheduled_days: 0,
            amount_due: 0,
            amount_paid: 0,
            outstanding_balance: 0,
          };
          total.scheduled_days += 1;
          total.amount_due += Number(row.amount_due);
          total.amount_paid += Number(row.amount_paid);
          total.outstanding_balance += Number(row.outstanding_balance);
          totals.set(key, total);
        }
        rows = [...totals.values()].map((row) => ({
          ...row,
          amount_due: row.amount_due.toFixed(2),
          amount_paid: row.amount_paid.toFixed(2),
          outstanding_balance: row.outstanding_balance.toFixed(2),
        }));
      }
    } else if (type === 'advance_credit') {
      const result = await client.query(
        `SELECT s.id AS student_id, LPAD(s.id::TEXT, 6, '0') AS admission_number,
                s.name AS student_name, c.name AS class_name, credit.amount AS advance_credit
         FROM students s
         LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
         JOIN LATERAL (
           SELECT SUM(r.feeding_amount)
                  - SUM(COALESCE(f.refunded, 0))
                  - SUM(COALESCE(a.allocated, 0) - COALESCE(a.reversed, 0)) AS amount
           FROM school_payment_receipts r
           LEFT JOIN LATERAL (
             SELECT SUM(refund.amount) AS refunded FROM school_payment_refunds refund
             WHERE refund.school_id = r.school_id AND refund.receipt_id = r.id
               AND refund.component = 'feeding'
           ) f ON TRUE
           LEFT JOIN LATERAL (
             SELECT SUM(pa.amount) AS allocated,
                    SUM(COALESCE(refunds.reversed, 0)) AS reversed
             FROM school_payment_allocations pa
             LEFT JOIN LATERAL (
               SELECT SUM(ra.amount) AS reversed
               FROM school_payment_refund_allocations ra
               WHERE ra.payment_allocation_id = pa.id AND ra.school_id = pa.school_id
             ) refunds ON TRUE
             WHERE pa.school_id = r.school_id AND pa.receipt_id = r.id
               AND pa.component = 'feeding'
           ) a ON TRUE
           WHERE r.school_id = s.school_id AND r.student_id = s.id
         ) credit ON credit.amount > 0
         WHERE s.school_id = $1 AND ($2::INTEGER IS NULL OR s.class_id = $2)
         ORDER BY c.name, s.name`,
        [req.user.school_id, classId]
      );
      rows = result.rows;
    } else {
      const result = await client.query(
        `SELECT l.payment_date::TEXT AS date, l.entry_type,
                s.id AS student_id, LPAD(s.id::TEXT, 6, '0') AS admission_number,
                s.name AS student_name, c.name AS class_name,
                l.amount, l.reference, r.receipt_number, r.payment_method,
                COALESCE(r.school_fee_amount, 0) AS school_fee_amount,
                COALESCE(r.feeding_amount, 0) AS feeding_amount
         FROM feeding_payment_ledger l
         JOIN students s ON s.id = l.student_id AND s.school_id = l.school_id
         LEFT JOIN school_payment_receipts r ON r.id = l.receipt_id AND r.school_id = l.school_id
         LEFT JOIN school_payment_refunds f ON f.id = l.refund_id AND f.school_id = l.school_id
         LEFT JOIN LATERAL (
           SELECT h.class_id FROM feeding_student_class_history h
           WHERE h.school_id = s.school_id AND h.student_id = s.id
             AND h.effective_from <= COALESCE(r.payment_date, f.refund_date, l.payment_date)
             AND (h.effective_to IS NULL OR h.effective_to >= COALESCE(r.payment_date, f.refund_date, l.payment_date))
           ORDER BY h.effective_from DESC LIMIT 1
         ) history ON TRUE
         LEFT JOIN classes c ON c.id = history.class_id AND c.school_id = s.school_id
         WHERE l.school_id = $1 AND l.payment_date BETWEEN $2 AND $3
           AND ($4::INTEGER IS NULL OR history.class_id = $4)
         ORDER BY l.payment_date DESC, l.id DESC LIMIT 10000`,
        [req.user.school_id, range.startDate, range.endDate, classId]
      );
      rows = result.rows;
      if (type === 'class_collections') {
        const totals = new Map();
        for (const row of rows) {
          const key = row.class_name || 'Unassigned';
          const total = totals.get(key) || { class_name: key, collected: 0, refunded: 0, net_collection: 0 };
          const amount = Number(row.amount);
          if (row.entry_type === 'income') total.collected += amount;
          else total.refunded += amount;
          total.net_collection = total.collected - total.refunded;
          totals.set(key, total);
        }
        rows = [...totals.values()].sort((a, b) => a.class_name.localeCompare(b.class_name));
      }
    }
    await client.query('COMMIT');

    if (exportExcel) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Feeding Report');
      sheet.columns = rows.length
        ? Object.keys(rows[0]).map((key) => ({ header: key.replace(/_/g, ' '), key, width: Math.min(32, Math.max(14, key.length + 2)) }))
        : [{ header: 'Result', key: 'result', width: 20 }];
      sheet.addRows(rows);
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="feeding-${type}-${range.startDate}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    res.json({
      report_type: type,
      range,
      academic_year: term?.academic_year || null,
      term: term?.term || null,
      unconfigured_feeding_days: unconfigured.filter((row) => row.feeding_date >= range.startDate
        && row.feeding_date <= range.endDate && (classId === null || row.class_id === classId)).length,
      rows,
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    client?.release();
  }
};

module.exports = {
  dateRange,
  exportFeedingReport: (req, res, next) => makeReport(req, res, next, true),
  getFeedingReport: (req, res, next) => makeReport(req, res, next),
};
