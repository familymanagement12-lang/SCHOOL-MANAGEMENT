const pool = require('../config/db');
const {
  FREQUENCIES,
  addDays,
  amountFromCents,
  moneyToCents,
  parseDate,
  paymentStatus,
  periodRange,
} = require('../services/feedingService');
const { ensureTermObligations, findFeedingTerm } = require('../services/feedingDataService');

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const today = () => new Date().toISOString().slice(0, 10);
const sendError = (res, error, next) => {
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.code === '23505') return res.status(409).json({ message: 'A record with these details already exists.' });
  return next(error);
};

const getTerms = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.academic_year, t.term, t.start_date::TEXT, t.end_date::TEXT,
              t.scheduled_weekdays, t.created_at,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', e.id, 'class_id', e.class_id, 'name', e.name,
                  'event_type', e.event_type, 'start_date', e.start_date,
                  'end_date', e.end_date
                ) ORDER BY e.start_date, e.id)
                FROM feeding_calendar_exceptions e
                WHERE e.school_id = t.school_id AND e.term_id = t.id
              ), '[]'::JSON) AS exceptions
       FROM feeding_terms t
       WHERE t.school_id = $1
       ORDER BY t.start_date DESC, t.id DESC`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createTerm = async (req, res, next) => {
  const academicYear = String(req.body.academic_year || '').trim();
  const term = String(req.body.term || '').trim();
  const startDate = req.body.start_date;
  const endDate = req.body.end_date;
  const weekdays = req.body.scheduled_weekdays;
  if (typeof req.body.academic_year !== 'string' || typeof req.body.term !== 'string'
      || !/^\d{4}[/-]\d{4}$/.test(academicYear) || !term || term.length > 80
      || !parseDate(startDate) || !parseDate(endDate) || startDate > endDate
      || new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`) > 366 * 86400000
      || !Array.isArray(weekdays) || !weekdays.length || weekdays.length > 7
      || weekdays.some((day) => !Number.isInteger(Number(day)) || Number(day) < 1 || Number(day) > 7)
      || new Set(weekdays.map(Number)).size !== weekdays.length) {
    return res.status(400).json({ message: 'Provide a valid academic year, term dates, and unique scheduled weekdays (Monday=1 through Sunday=7).' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [String(req.user.school_id), 'feeding-term-calendar']
    );
    const overlap = await client.query(
      `SELECT 1 FROM feeding_terms
       WHERE school_id = $1 AND start_date <= $3 AND end_date >= $2
       LIMIT 1`,
      [req.user.school_id, startDate, endDate]
    );
    if (overlap.rowCount) throw invalid('Feeding terms cannot overlap; correct the configured date ranges.');
    const result = await client.query(
      `INSERT INTO feeding_terms
         (school_id, academic_year, term, start_date, end_date, scheduled_weekdays, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::SMALLINT[], $7)
       RETURNING id, academic_year, term, start_date::TEXT, end_date::TEXT, scheduled_weekdays`,
      [req.user.school_id, academicYear, term, startDate, endDate, weekdays.map(Number), req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendError(res, error, next);
  } finally {
    client?.release();
  }
};

const getRates = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.class_id, c.name AS class_name,
              r.academic_year, r.term, r.daily_rate,
              r.effective_date::TEXT, r.created_at, u.name AS created_by_name
       FROM feeding_class_rates r
       JOIN classes c ON c.id = r.class_id AND c.school_id = r.school_id
       LEFT JOIN users u ON u.id = r.created_by AND u.school_id = r.school_id
       WHERE r.school_id = $1
       ORDER BY r.academic_year DESC, r.term, c.name, r.effective_date DESC, r.id DESC`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createRate = async (req, res, next) => {
  const classId = Number(req.body.class_id);
  const amountCents = moneyToCents(req.body.daily_rate);
  const academicYear = String(req.body.academic_year || '').trim();
  const termName = String(req.body.term || '').trim();
  const effectiveDate = req.body.effective_date;
  const rateLockKey = `${classId}:${academicYear}:${termName}`;
  if (!Number.isSafeInteger(classId) || classId <= 0 || !amountCents || amountCents > 9999999999
      || !/^\d{4}[/-]\d{4}$/.test(academicYear) || !termName || !parseDate(effectiveDate)) {
    return res.status(400).json({ message: 'Provide a class, valid academic term, positive daily rate, and effective date.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [String(req.user.school_id), rateLockKey]
    );
    const term = await findFeedingTerm(client, req.user.school_id, { academicYear, term: termName });
    if (!term || effectiveDate < term.start_date || effectiveDate > term.end_date) {
      throw invalid('Configure the academic term and choose a rate effective date within it.');
    }
    await client.query(
      'SELECT id FROM feeding_terms WHERE school_id = $1 AND id = $2 FOR UPDATE',
      [req.user.school_id, term.id]
    );
    const classResult = await client.query(
      'SELECT id FROM classes WHERE school_id = $1 AND id = $2',
      [req.user.school_id, classId]
    );
    if (!classResult.rowCount) throw Object.assign(new Error('Class not found.'), { status: 404 });
    const existing = await client.query(
      `SELECT MIN(effective_date)::TEXT AS first_rate,
              MAX(effective_date)::TEXT AS latest_rate
       FROM feeding_class_rates
       WHERE school_id = $1 AND class_id = $2 AND academic_year = $3 AND term = $4
      `,
      [req.user.school_id, classId, academicYear, termName]
    );
    if (existing.rows[0].first_rate && effectiveDate <= today()) {
      throw invalid('Rate changes must take effect after today. Existing financial history is immutable.');
    }
    if (existing.rows[0].latest_rate && effectiveDate <= existing.rows[0].latest_rate) {
      throw invalid('A new rate must start after the latest rate change for this class and term.');
    }
    const result = await client.query(
      `INSERT INTO feeding_class_rates
         (school_id, class_id, academic_year, term, daily_rate, effective_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, class_id, academic_year, term, daily_rate, effective_date::TEXT`,
      [req.user.school_id, classId, academicYear, termName, amountFromCents(amountCents), effectiveDate, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendError(res, error, next);
  } finally {
    client?.release();
  }
};

const createCalendarException = async (req, res, next) => {
  const termId = Number(req.body.term_id);
  const classId = req.body.class_id === null || req.body.class_id === undefined || req.body.class_id === ''
    ? null : Number(req.body.class_id);
  const name = String(req.body.name || '').trim();
  const eventType = req.body.event_type;
  const startDate = req.body.start_date;
  const endDate = req.body.end_date;
  if (!Number.isSafeInteger(termId) || termId <= 0 || !name || name.length > 120
      || !['holiday', 'vacation', 'school_day'].includes(eventType)
      || !parseDate(startDate) || !parseDate(endDate) || startDate > endDate
      || (classId !== null && (!Number.isSafeInteger(classId) || classId <= 0))) {
    return res.status(400).json({ message: 'Provide a valid calendar exception, term, and event type.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const term = await client.query(
      `SELECT start_date::TEXT, end_date::TEXT
       FROM feeding_terms WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [termId, req.user.school_id]
    );
    if (!term.rowCount || startDate < term.rows[0].start_date || endDate > term.rows[0].end_date) {
      throw invalid('The calendar exception must be within a configured feeding term.');
    }
    if (classId !== null) {
      const classResult = await client.query(
        'SELECT id FROM classes WHERE id = $1 AND school_id = $2',
        [classId, req.user.school_id]
      );
      if (!classResult.rowCount) throw invalid('Class not found.');
    }
    const existingObligations = await client.query(
      `SELECT 1 FROM feeding_obligations o
       WHERE o.school_id = $1 AND o.feeding_date BETWEEN $2 AND $3
         AND ($4::INTEGER IS NULL OR o.class_id = $4)
         AND (
           o.feeding_date <= CURRENT_DATE
           OR EXISTS (
             SELECT 1 FROM school_payment_allocations pa
             WHERE pa.school_id = o.school_id AND pa.obligation_id = o.id
           )
           OR EXISTS (
             SELECT 1 FROM feeding_coverage_days cd
             WHERE cd.school_id = o.school_id AND cd.obligation_id = o.id
           )
         )
       LIMIT 1`,
      [req.user.school_id, startDate, endDate, classId]
    );
    if (existingObligations.rowCount) {
      throw Object.assign(new Error('Calendar exceptions cannot change past, paid, or served feeding obligations.'), { status: 409 });
    }
    const result = await client.query(
      `INSERT INTO feeding_calendar_exceptions
         (school_id, term_id, class_id, name, event_type, start_date, end_date, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, term_id, class_id, name, event_type, start_date::TEXT, end_date::TEXT`,
      [req.user.school_id, termId, classId, name, eventType, startDate, endDate, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendError(res, error, next);
  } finally {
    client?.release();
  }
};

const getAccounts = async (req, res, next) => {
  const classId = req.query.class_id ? Number(req.query.class_id) : null;
  if (classId !== null && (!Number.isSafeInteger(classId) || classId <= 0)) {
    return res.status(400).json({ message: 'Choose a valid class.' });
  }
  try {
    const result = await pool.query(
      `SELECT s.id, LPAD(s.id::TEXT, 6, '0') AS admission_number,
              s.name, s.class_id, c.name AS class_name,
              a.payment_frequency, a.created_at AS account_created_at,
              r.daily_rate
       FROM students s
       JOIN feeding_student_accounts a ON a.school_id = s.school_id AND a.student_id = s.id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       LEFT JOIN LATERAL (
         SELECT fr.daily_rate
         FROM feeding_terms t
         JOIN feeding_class_rates fr
           ON fr.school_id = t.school_id
          AND fr.academic_year = t.academic_year AND fr.term = t.term
         WHERE t.school_id = s.school_id AND fr.class_id = s.class_id
           AND CURRENT_DATE BETWEEN t.start_date AND t.end_date
           AND fr.effective_date <= CURRENT_DATE
         ORDER BY fr.effective_date DESC, fr.id DESC LIMIT 1
       ) r ON TRUE
       WHERE s.school_id = $1
         AND ($2::INTEGER IS NULL OR s.class_id = $2)
         AND ($3::TEXT IS NULL OR s.name ILIKE '%' || $3 || '%'
              OR LPAD(s.id::TEXT, 6, '0') ILIKE '%' || $3 || '%')
       ORDER BY c.name NULLS LAST, s.name
       LIMIT 1000`,
      [req.user.school_id, classId,
        req.query.search ? String(req.query.search).trim().slice(0, 100) : null]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const setPaymentFrequency = async (req, res, next) => {
  const studentId = Number(req.params.studentId);
  const frequency = req.body.payment_frequency;
  if (!Number.isSafeInteger(studentId) || studentId <= 0 || !FREQUENCIES.has(frequency)) {
    return res.status(400).json({ message: 'Choose a student and a daily, weekly, monthly, or termly payment frequency.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const account = await client.query(
      `SELECT id, payment_frequency,
              EXISTS (
                SELECT 1 FROM feeding_obligations o
                WHERE o.school_id = feeding_student_accounts.school_id
                  AND o.student_id = feeding_student_accounts.student_id
                  AND o.feeding_date = CURRENT_DATE
              ) AS has_today_obligation
       FROM feeding_student_accounts
       WHERE school_id = $1 AND student_id = $2 FOR UPDATE`,
      [req.user.school_id, studentId]
    );
    if (!account.rowCount) throw Object.assign(new Error('Feeding account not found.'), { status: 404 });
    const effectiveFrom = account.rows[0].has_today_obligation
      ? addDays(today(), 1)
      : today();
    if (account.rows[0].payment_frequency !== frequency) {
      await client.query(
        `INSERT INTO feeding_frequency_history (school_id, student_id, payment_frequency, effective_from, changed_by)
         VALUES ($1, $2, $3, $5, $4)`,
        [req.user.school_id, studentId, frequency, req.user.id, effectiveFrom]
      );
      await client.query(
        `UPDATE feeding_student_accounts
         SET payment_frequency = $3, updated_by = $4, updated_at = NOW()
         WHERE school_id = $1 AND student_id = $2`,
        [req.user.school_id, studentId, frequency, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ student_id: studentId, payment_frequency: frequency, effective_from: effectiveFrom });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendError(res, error, next);
  } finally {
    client?.release();
  }
};

const getAccount = async (req, res, next) => {
  const studentId = Number(req.params.studentId);
  const date = req.query.date || today();
  if (!Number.isSafeInteger(studentId) || studentId <= 0 || !parseDate(date)) {
    return res.status(400).json({ message: 'Choose a valid student and date.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const studentResult = await client.query(
      `SELECT s.id, LPAD(s.id::TEXT, 6, '0') AS admission_number, s.name,
              s.class_id, c.name AS class_name, a.payment_frequency,
              a.created_at AS account_created_at
       FROM students s
       JOIN feeding_student_accounts a ON a.school_id = s.school_id AND a.student_id = s.id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       WHERE s.school_id = $1 AND s.id = $2`,
      [req.user.school_id, studentId]
    );
    if (!studentResult.rowCount) throw Object.assign(new Error('Student feeding account not found.'), { status: 404 });
    const student = studentResult.rows[0];
    const frequencyResult = await client.query(
      `SELECT payment_frequency FROM feeding_frequency_history
       WHERE school_id = $1 AND student_id = $2 AND effective_from <= $3
       ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1`,
      [req.user.school_id, studentId, date]
    );
    if (frequencyResult.rowCount) student.payment_frequency = frequencyResult.rows[0].payment_frequency;
    const term = await findFeedingTerm(client, req.user.school_id, { date });
    if (!term) {
      const [history, frequencyHistory, creditResult] = await Promise.all([
        client.query(
          `SELECT r.id, r.receipt_number, r.payment_date::TEXT, r.payment_method,
                  r.reference, r.school_fee_amount, r.feeding_amount,
                  r.amount_total, r.created_at,
                  COALESCE((
                    SELECT SUM(f.amount) FROM school_payment_refunds f
                    WHERE f.school_id = r.school_id AND f.receipt_id = r.id
                  ), 0) AS refunded_amount
           FROM school_payment_receipts r
           WHERE r.school_id = $1 AND r.student_id = $2
           ORDER BY r.payment_date DESC, r.id DESC LIMIT 100`,
          [req.user.school_id, studentId]
        ),
        client.query(
          `SELECT payment_frequency, effective_from::TEXT, u.name AS changed_by_name
           FROM feeding_frequency_history h
           LEFT JOIN users u ON u.id = h.changed_by AND u.school_id = h.school_id
           WHERE h.school_id = $1 AND h.student_id = $2
           ORDER BY h.effective_from DESC, h.id DESC`,
          [req.user.school_id, studentId]
        ),
        client.query(
          `SELECT COALESCE(SUM(r.feeding_amount), 0)
                  - COALESCE(SUM(f.refunded), 0)
                  - COALESCE(SUM(a.allocated - a.reversed), 0) AS credit
           FROM school_payment_receipts r
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(p.amount), 0) AS allocated,
                    COALESCE(SUM(refunds.reversed), 0) AS reversed
             FROM school_payment_allocations p
             LEFT JOIN LATERAL (
               SELECT SUM(ra.amount) AS reversed
               FROM school_payment_refund_allocations ra
               WHERE ra.payment_allocation_id = p.id AND ra.school_id = p.school_id
             ) refunds ON TRUE
             WHERE p.school_id = r.school_id AND p.receipt_id = r.id AND p.component = 'feeding'
           ) a ON TRUE
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(amount), 0) AS refunded
             FROM school_payment_refunds
             WHERE school_id = r.school_id AND receipt_id = r.id AND component = 'feeding'
           ) f ON TRUE
           WHERE r.school_id = $1 AND r.student_id = $2`,
          [req.user.school_id, studentId]
        ),
      ]);
      await client.query('COMMIT');
      return res.json({
        student, term: null, current_period: null, daily_rate: null,
        amount_due: '0.00', amount_paid: '0.00', outstanding_balance: '0.00',
        advance_credit: amountFromCents(Math.max(0, moneyToCents(creditResult.rows[0].credit) || 0)),
        obligations: [], payment_history: history.rows, frequency_history: frequencyHistory.rows,
        configuration_message: 'No feeding term covers the selected date.',
      });
    }
    const generated = await ensureTermObligations(client, req.user.school_id, term, [studentId]);
    const period = periodRange(student.payment_frequency, date, term);
    const obligationsResult = await client.query(
      `SELECT o.id, o.feeding_date::TEXT, o.academic_year, o.term, o.class_id,
              o.class_name_snapshot AS class_name, o.daily_rate, o.amount_due,
              GREATEST(COALESCE(a.paid, 0) - COALESCE(r.refunded, 0), 0) AS amount_paid,
              COALESCE(d.is_served, FALSE) AS is_served
       FROM feeding_obligations o
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount) AS paid FROM school_payment_allocations p
         WHERE p.school_id = o.school_id AND p.obligation_id = o.id
       ) a ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(ra.amount) AS refunded
         FROM school_payment_refund_allocations ra
         JOIN school_payment_allocations p
           ON p.id = ra.payment_allocation_id AND p.school_id = ra.school_id
         WHERE p.school_id = o.school_id AND p.obligation_id = o.id
           AND ra.component = 'feeding'
       ) r ON TRUE
       LEFT JOIN feeding_coverage_days d
         ON d.school_id = o.school_id AND d.obligation_id = o.id
       WHERE o.school_id = $1 AND o.student_id = $2
         AND o.feeding_date BETWEEN $3 AND $4
       ORDER BY o.feeding_date, o.id`,
      [req.user.school_id, studentId,
        period.startDate > term.start_date ? period.startDate : term.start_date,
        period.endDate < term.end_date ? period.endDate : term.end_date]
    );
    const amounts = obligationsResult.rows.reduce((totals, obligation) => {
      totals.due += moneyToCents(obligation.amount_due) || 0;
      totals.paid += moneyToCents(obligation.amount_paid) || 0;
      return totals;
    }, { due: 0, paid: 0 });
    const creditResult = await client.query(
      `SELECT COALESCE(SUM(r.feeding_amount), 0)
              - COALESCE(SUM(f.refunded), 0)
              - COALESCE(SUM(a.allocated - a.reversed), 0) AS credit
       FROM school_payment_receipts r
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(p.amount), 0) AS allocated,
                COALESCE(SUM(refunds.reversed), 0) AS reversed
         FROM school_payment_allocations p
         LEFT JOIN LATERAL (
           SELECT SUM(ra.amount) AS reversed
           FROM school_payment_refund_allocations ra
           WHERE ra.payment_allocation_id = p.id AND ra.school_id = p.school_id
         ) refunds ON TRUE
         WHERE p.school_id = r.school_id AND p.receipt_id = r.id AND p.component = 'feeding'
       ) a ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(amount), 0) AS refunded
         FROM school_payment_refunds
         WHERE school_id = r.school_id AND receipt_id = r.id AND component = 'feeding'
       ) f ON TRUE
       WHERE r.school_id = $1 AND r.student_id = $2`,
      [req.user.school_id, studentId]
    );
    const [history, frequencyHistory] = await Promise.all([
      client.query(
        `SELECT r.id, r.receipt_number, r.payment_date::TEXT, r.payment_method,
                r.reference, r.school_fee_amount, r.feeding_amount,
                r.amount_total, r.created_at,
                COALESCE((
                  SELECT SUM(f.amount) FROM school_payment_refunds f
                  WHERE f.school_id = r.school_id AND f.receipt_id = r.id
                ), 0) AS refunded_amount
         FROM school_payment_receipts r
         WHERE r.school_id = $1 AND r.student_id = $2
         ORDER BY r.payment_date DESC, r.id DESC LIMIT 100`,
        [req.user.school_id, studentId]
      ),
      client.query(
        `SELECT payment_frequency, effective_from::TEXT, u.name AS changed_by_name
         FROM feeding_frequency_history h
         LEFT JOIN users u ON u.id = h.changed_by AND u.school_id = h.school_id
         WHERE h.school_id = $1 AND h.student_id = $2
         ORDER BY h.effective_from DESC, h.id DESC`,
        [req.user.school_id, studentId]
      ),
    ]);
    await client.query('COMMIT');
    res.json({
      student,
      term: { academic_year: term.academic_year, term: term.term, start_date: term.start_date, end_date: term.end_date },
      current_period: period,
      daily_rate: obligationsResult.rows[0]?.daily_rate || null,
      amount_due: amountFromCents(amounts.due),
      amount_paid: amountFromCents(amounts.paid),
      outstanding_balance: amountFromCents(Math.max(0, amounts.due - amounts.paid)),
      advance_credit: amountFromCents(Math.max(0, moneyToCents(creditResult.rows[0].credit) || 0)),
      coverage_days: obligationsResult.rows.filter((row) => row.is_served).length,
      obligations: obligationsResult.rows.map((row) => ({
        ...row,
        payment_status: paymentStatus(moneyToCents(row.amount_due), moneyToCents(row.amount_paid)),
        coverage_status: row.is_served ? 'served' : 'not_served',
      })),
      payment_history: history.rows,
      frequency_history: frequencyHistory.rows,
      unconfigured_feeding_days: generated.unconfigured
        .filter((row) => row.student_id === studentId).length,
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendError(res, error, next);
  } finally {
    client?.release();
  }
};

const getRegister = async (req, res, next) => {
  const date = req.query.date || today();
  const classId = req.query.class_id ? Number(req.query.class_id) : null;
  if (!parseDate(date) || (classId !== null && (!Number.isSafeInteger(classId) || classId <= 0))) {
    return res.status(400).json({ message: 'Choose a valid register date and class.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const term = await findFeedingTerm(client, req.user.school_id, {
      date, academicYear: req.query.academic_year, term: req.query.term,
    });
    if (!term) throw invalid('Configure or select a feeding term that covers the register date.');
    const accounts = await client.query(
      `SELECT s.id FROM students s
       JOIN feeding_student_accounts a ON a.school_id = s.school_id AND a.student_id = s.id
       WHERE s.school_id = $1
         AND ($2::INTEGER IS NULL OR EXISTS (
           SELECT 1 FROM feeding_student_class_history h
           WHERE h.school_id = s.school_id AND h.student_id = s.id
             AND h.class_id = $2 AND $3::DATE >= h.effective_from
             AND (h.effective_to IS NULL OR $3::DATE <= h.effective_to)
         ) OR EXISTS (
           SELECT 1 FROM feeding_obligations o
           WHERE o.school_id = s.school_id AND o.student_id = s.id
             AND o.feeding_date = $3 AND o.class_id = $2
         ))`,
      [req.user.school_id, classId, date]
    );
    const generated = await ensureTermObligations(
      client, req.user.school_id, term, accounts.rows.map((row) => row.id)
    );
    const result = await client.query(
      `SELECT s.id AS student_id, LPAD(s.id::TEXT, 6, '0') AS admission_number,
              s.name AS student_name, COALESCE(fh.payment_frequency, a.payment_frequency) AS payment_frequency,
              o.id AS obligation_id, o.class_id, o.class_name_snapshot AS class_name,
              o.daily_rate, o.amount_due, o.feeding_date::TEXT AS coverage_date,
              COALESCE(p.paid, 0) - COALESCE(r.refunded, 0) AS amount_paid,
              GREATEST(o.amount_due - (COALESCE(p.paid, 0) - COALESCE(r.refunded, 0)), 0) AS outstanding_balance,
              COALESCE(d.is_served, FALSE) AS is_served,
              CASE WHEN o.id IS NULL THEN 'not_scheduled'
                   ELSE CASE WHEN COALESCE(p.paid, 0) - COALESCE(r.refunded, 0) >= o.amount_due THEN 'paid'
                             WHEN COALESCE(p.paid, 0) - COALESCE(r.refunded, 0) > 0 THEN 'partial'
                             ELSE 'unpaid' END
              END AS payment_status,
              CASE WHEN d.is_served THEN 'served' ELSE 'not_served' END AS coverage_status
       FROM students s
       JOIN feeding_student_accounts a ON a.school_id = s.school_id AND a.student_id = s.id
       LEFT JOIN feeding_obligations o
         ON o.school_id = s.school_id AND o.student_id = s.id AND o.feeding_date = $2
       LEFT JOIN LATERAL (
         SELECT payment_frequency FROM feeding_frequency_history fh
         WHERE fh.school_id = s.school_id AND fh.student_id = s.id
           AND fh.effective_from <= $2::DATE
         ORDER BY fh.effective_from DESC, fh.created_at DESC, fh.id DESC LIMIT 1
       ) fh ON TRUE
       LEFT JOIN LATERAL (
         SELECT class_id FROM feeding_student_class_history h
         WHERE h.school_id = s.school_id AND h.student_id = s.id
           AND $2::DATE >= h.effective_from
           AND (h.effective_to IS NULL OR $2::DATE <= h.effective_to)
         ORDER BY h.effective_from DESC LIMIT 1
       ) h ON TRUE
       LEFT JOIN classes c ON c.id = h.class_id AND c.school_id = s.school_id
       LEFT JOIN LATERAL (
         SELECT SUM(pa.amount) AS paid FROM school_payment_allocations pa
         WHERE pa.school_id = s.school_id AND pa.obligation_id = o.id
       ) p ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(ra.amount) AS refunded
         FROM school_payment_refund_allocations ra
         JOIN school_payment_allocations pa
           ON pa.id = ra.payment_allocation_id AND pa.school_id = ra.school_id
         WHERE pa.school_id = s.school_id AND pa.obligation_id = o.id
           AND ra.component = 'feeding'
       ) r ON TRUE
       LEFT JOIN feeding_coverage_days d
         ON d.school_id = s.school_id AND d.obligation_id = o.id
       WHERE s.school_id = $1
         AND ($3::INTEGER IS NULL OR COALESCE(o.class_id, h.class_id) = $3)
       ORDER BY c.name NULLS LAST, s.name`,
      [req.user.school_id, date, classId]
    );
    await client.query('COMMIT');
    const unconfiguredCount = generated.unconfigured.filter((row) => row.feeding_date === date
      && (classId === null || row.class_id === classId)).length;
    res.json({
      date,
      academic_year: term.academic_year,
      term: term.term,
      unconfigured_feeding_days: unconfiguredCount,
      rows: result.rows,
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendError(res, error, next);
  } finally {
    client?.release();
  }
};

const setCoverage = async (req, res, next) => {
  const obligationId = Number(req.params.obligationId);
  const isServed = req.body.is_served;
  if (!Number.isSafeInteger(obligationId) || obligationId <= 0 || typeof isServed !== 'boolean') {
    return res.status(400).json({ message: 'Choose a feeding obligation and served status.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO feeding_coverage_days
         (school_id, obligation_id, student_id, coverage_date, is_served, served_by, served_at)
       SELECT o.school_id, o.id, o.student_id, o.feeding_date, $3,
              CASE WHEN $3 THEN $4::INTEGER ELSE NULL END,
              CASE WHEN $3 THEN NOW() ELSE NULL END
       FROM feeding_obligations o
       WHERE o.school_id = $1 AND o.id = $2
       ON CONFLICT (school_id, obligation_id)
       DO UPDATE SET is_served = EXCLUDED.is_served,
         served_by = EXCLUDED.served_by, served_at = EXCLUDED.served_at,
         updated_at = NOW()
       RETURNING id, obligation_id, coverage_date::TEXT, is_served, served_at`,
      [req.user.school_id, obligationId, isServed, req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Feeding obligation not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCalendarException,
  createRate,
  createTerm,
  getAccount,
  getAccounts,
  getRates,
  getRegister,
  getTerms,
  setCoverage,
  setPaymentFrequency,
};
