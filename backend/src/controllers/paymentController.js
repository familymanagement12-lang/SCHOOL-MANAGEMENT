const crypto = require('crypto');
const pool = require('../config/db');
const notificationEvents = require('../services/notificationService');
const { ensureTermObligations, findFeedingTerm } = require('../services/feedingDataService');
const {
  allocateCents,
  allocateRefundCents,
  amountFromCents,
  moneyToCents,
  parseDate,
} = require('../services/feedingService');

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const receiptNumber = () => `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const today = () => new Date().toISOString().slice(0, 10);
const sendError = (res, error, next) => {
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.code === '23505') return res.status(409).json({ message: 'This payment request has already been recorded.' });
  return next(error);
};

const receiptQuery = `
  SELECT r.id, r.student_id, LPAD(s.id::TEXT, 6, '0') AS admission_number,
         s.name AS student_name, c.name AS class_name,
         r.receipt_number, r.payment_date::TEXT, r.payment_method, r.reference,
         r.amount_total, r.school_fee_amount, r.feeding_amount,
         r.feeding_academic_year, r.feeding_term,
         GREATEST(
           r.feeding_amount
           - COALESCE((
             SELECT SUM(a.amount) FROM school_payment_allocations a
             WHERE a.school_id = r.school_id AND a.receipt_id = r.id AND a.component = 'feeding'
           ), 0)
           + COALESCE((
             SELECT SUM(ra.amount)
             FROM school_payment_refund_allocations ra
             JOIN school_payment_allocations a
               ON a.id = ra.payment_allocation_id AND a.school_id = ra.school_id
             WHERE a.school_id = r.school_id AND a.receipt_id = r.id AND a.component = 'feeding'
           ), 0)
           - COALESCE((
             SELECT SUM(f.amount) FROM school_payment_refunds f
             WHERE f.school_id = r.school_id AND f.receipt_id = r.id AND f.component = 'feeding'
           ), 0),
           0
         ) AS feeding_advance_credit,
         r.received_by, u.name AS received_by_name, r.created_at,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', a.id, 'component', a.component, 'amount', a.amount,
             'fee_id', a.fee_id, 'fee_description', f.description,
             'feeding_date', o.feeding_date, 'academic_year', o.academic_year,
             'term', o.term, 'class_name', o.class_name_snapshot
           ) ORDER BY a.id)
           FROM school_payment_allocations a
           LEFT JOIN fees f ON f.id = a.fee_id AND f.school_id = a.school_id
           LEFT JOIN feeding_obligations o ON o.id = a.obligation_id AND o.school_id = a.school_id
           WHERE a.school_id = r.school_id AND a.receipt_id = r.id
         ), '[]'::JSON) AS allocations,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', f.id, 'component', f.component, 'amount', f.amount,
             'reason', f.reason, 'reference', f.reference, 'refund_date', f.refund_date
           ) ORDER BY f.id)
           FROM school_payment_refunds f
           WHERE f.school_id = r.school_id AND f.receipt_id = r.id
         ), '[]'::JSON) AS refunds
  FROM school_payment_receipts r
  JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
  LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
  LEFT JOIN users u ON u.id = r.received_by AND u.school_id = r.school_id`;

const getPaymentReceipt = async (client, schoolId, receiptId) => {
  const result = await client.query(
    `${receiptQuery} WHERE r.school_id = $1 AND r.id = $2`,
    [schoolId, receiptId]
  );
  return result.rows[0] || null;
};

const recordPayment = async (req, res, next) => {
  const studentId = Number(req.body.student_id);
  const schoolFeeCents = moneyToCents(req.body.school_fee_amount ?? 0);
  const feedingCents = moneyToCents(req.body.feeding_amount ?? 0);
  const paymentDate = req.body.payment_date || today();
  const paymentMethod = req.body.payment_method || 'cash';
  const reference = typeof req.body.reference === 'string' ? req.body.reference.trim() : '';
  const idempotencyKey = typeof req.body.idempotency_key === 'string'
    ? req.body.idempotency_key.trim() : '';
  if (!Number.isSafeInteger(studentId) || studentId <= 0
      || schoolFeeCents === null || feedingCents === null
      || schoolFeeCents + feedingCents <= 0
      || schoolFeeCents + feedingCents > 9999999999
      || !parseDate(paymentDate)
      || !['cash', 'mobile_money', 'bank_transfer', 'other'].includes(paymentMethod)
      || (req.body.reference !== undefined && req.body.reference !== null && typeof req.body.reference !== 'string')
      || reference.length > 120 || !idempotencyKey || idempotencyKey.length > 200) {
    return res.status(400).json({ message: 'Provide a student, valid payment components, date, method, and unique request key.' });
  }
  if (req.user.role === 'feeding_tuckshop_officer' && schoolFeeCents > 0) {
    return res.status(403).json({ message: 'Feeding officers can record feeding payments only.' });
  }
  const academicYear = typeof req.body.academic_year === 'string' ? req.body.academic_year.trim() : '';
  const termName = typeof req.body.term === 'string' ? req.body.term.trim() : '';
  if ((req.body.academic_year !== undefined && typeof req.body.academic_year !== 'string')
      || (req.body.term !== undefined && typeof req.body.term !== 'string')
      || Boolean(academicYear) !== Boolean(termName)
      || (academicYear && (!/^\d{4}[/-]\d{4}$/.test(academicYear) || termName.length > 80))) {
    return res.status(400).json({ message: 'Academic year and term must be supplied together.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [String(req.user.school_id), idempotencyKey]
    );
    const duplicate = await client.query(
      `SELECT id, student_id, amount_total, school_fee_amount, feeding_amount,
              feeding_academic_year, feeding_term,
              payment_date::TEXT, payment_method, reference
       FROM school_payment_receipts
       WHERE school_id = $1 AND idempotency_key = $2`,
      [req.user.school_id, idempotencyKey]
    );
    if (duplicate.rowCount) {
      const saved = duplicate.rows[0];
      const sameRequest = Number(saved.student_id) === studentId
        && moneyToCents(saved.school_fee_amount) === schoolFeeCents
        && moneyToCents(saved.feeding_amount) === feedingCents
        && saved.payment_date === paymentDate
        && saved.payment_method === paymentMethod
        && (saved.reference || '') === reference
        && (saved.feeding_academic_year || '') === (feedingCents ? academicYear : '')
        && (saved.feeding_term || '') === (feedingCents ? termName : '');
      if (!sameRequest) throw Object.assign(new Error('The request key was already used for a different payment.'), { status: 409 });
      const receipt = await getPaymentReceipt(client, req.user.school_id, saved.id);
      await client.query('COMMIT');
      return res.status(200).json(receipt);
    }

    const studentResult = await client.query(
      `SELECT s.id, s.name, s.class_id, a.id AS account_id
       FROM students s
       LEFT JOIN feeding_student_accounts a ON a.school_id = s.school_id AND a.student_id = s.id
       WHERE s.school_id = $1 AND s.id = $2
       FOR UPDATE OF s`,
      [req.user.school_id, studentId]
    );
    if (!studentResult.rowCount) throw Object.assign(new Error('Student not found.'), { status: 404 });
    const student = studentResult.rows[0];

    let term = null;
    if (feedingCents > 0) {
      if (!student.account_id) throw Object.assign(new Error('The student does not have a feeding account.'), { status: 409 });
      term = await findFeedingTerm(
        client,
        req.user.school_id,
        academicYear ? { academicYear, term: termName } : { date: paymentDate }
      );
      if (!term) throw Object.assign(new Error('Configure or select a feeding term for this feeding payment.'), { status: 409 });
      if (!student.class_id) throw Object.assign(new Error('Assign the student to a class before recording feeding payments.'), { status: 409 });
      const generated = await ensureTermObligations(client, req.user.school_id, term, [studentId]);
      if (generated.unconfigured.some((row) => row.student_id === studentId)) {
        throw Object.assign(new Error('A daily feeding rate is missing for one or more scheduled days in this term.'), { status: 409 });
      }
    }

    const feeRows = schoolFeeCents ? await client.query(
      `SELECT id, description, amount_due, amount_paid, balance
       FROM fees
       WHERE school_id = $1 AND student_id = $2 AND balance > 0
       ORDER BY due_date NULLS LAST, created_at, id
       FOR UPDATE`,
      [req.user.school_id, studentId]
    ) : { rows: [] };
    const feeObligations = feeRows.rows.map((fee) => ({
      id: fee.id,
      amount_due_cents: moneyToCents(fee.balance),
      amount_paid_cents: 0,
    }));
    const tuitionAllocation = allocateCents(schoolFeeCents, feeObligations);
    if (tuitionAllocation.advance_cents > 0) {
      throw Object.assign(new Error('School-fee payment exceeds the student’s outstanding billed fees.'), { status: 409 });
    }

    const receiptNo = receiptNumber();
    const receipt = await client.query(
      `INSERT INTO school_payment_receipts
         (school_id, student_id, receipt_number, payment_date, payment_method,
          reference, amount_total, school_fee_amount, feeding_amount,
          feeding_academic_year, feeding_term, idempotency_key, received_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        req.user.school_id, studentId, receiptNo, paymentDate, paymentMethod,
        reference || null, amountFromCents(schoolFeeCents + feedingCents),
        amountFromCents(schoolFeeCents), amountFromCents(feedingCents),
        feedingCents ? term.academic_year : null, feedingCents ? term.term : null,
        idempotencyKey, req.user.id,
      ]
    );
    const receiptId = receipt.rows[0].id;
    let remainingFeeBalance = null;

    for (const allocation of tuitionAllocation.allocations) {
      const amount = amountFromCents(allocation.amount_cents);
      await client.query(
        `INSERT INTO school_payment_allocations
           (school_id, receipt_id, student_id, component, fee_id, amount)
         VALUES ($1, $2, $3, 'school_fee', $4, $5)`,
        [req.user.school_id, receiptId, studentId, allocation.obligation_id, amount]
      );
      await client.query(
        `UPDATE fees SET amount_paid = amount_paid + $1
         WHERE school_id = $2 AND student_id = $3 AND id = $4`,
        [amount, req.user.school_id, studentId, allocation.obligation_id]
      );
    }

    if (schoolFeeCents > 0) {
      await client.query(
        `INSERT INTO transactions
           (school_id, type, category, amount, reference, description, date, payment_receipt_id)
         VALUES ($1, 'income', 'School Fees', $2, $3, $4, $5, $6)`,
        [
          req.user.school_id, amountFromCents(schoolFeeCents),
          reference || receiptNo, `School-fee payment for ${student.name}`,
          paymentDate, receiptId,
        ]
      );
      const balance = await client.query(
        'SELECT COALESCE(SUM(balance), 0) AS balance FROM fees WHERE school_id = $1 AND student_id = $2',
        [req.user.school_id, studentId]
      );
      remainingFeeBalance = balance.rows[0].balance;
    }

    if (feedingCents > 0) {
      const obligations = await client.query(
        `SELECT o.id, ROUND(o.amount_due * 100)::BIGINT AS amount_due_cents,
                (COALESCE(a.allocated, 0) - COALESCE(r.reversed, 0))::BIGINT AS amount_paid_cents
         FROM feeding_obligations o
         LEFT JOIN LATERAL (
           SELECT SUM(p.amount) * 100 AS allocated
           FROM school_payment_allocations p
           WHERE p.school_id = o.school_id AND p.obligation_id = o.id
         ) a ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(ra.amount) * 100 AS reversed
           FROM school_payment_refund_allocations ra
           JOIN school_payment_allocations p
             ON p.id = ra.payment_allocation_id AND p.school_id = ra.school_id
           WHERE p.school_id = o.school_id AND p.obligation_id = o.id
         ) r ON TRUE
         WHERE o.school_id = $1 AND o.student_id = $2
           AND o.academic_year = $3 AND o.term = $4
         ORDER BY o.feeding_date, o.id
         FOR UPDATE OF o`,
        [req.user.school_id, studentId, term.academic_year, term.term]
      );
      const feedingAllocation = allocateCents(feedingCents, obligations.rows);
      for (const allocation of feedingAllocation.allocations) {
        await client.query(
          `INSERT INTO school_payment_allocations
             (school_id, receipt_id, student_id, component, obligation_id, amount)
           VALUES ($1, $2, $3, 'feeding', $4, $5)`,
          [
            req.user.school_id, receiptId, studentId,
            allocation.obligation_id, amountFromCents(allocation.amount_cents),
          ]
        );
      }
      await client.query(
        `INSERT INTO feeding_payment_ledger
           (school_id, student_id, entry_type, amount, payment_date, receipt_id, reference, recorded_by)
         VALUES ($1, $2, 'income', $3, $4, $5, $6, $7)`,
        [
          req.user.school_id, studentId, amountFromCents(feedingCents),
          paymentDate, receiptId, reference || null, req.user.id,
        ]
      );
    }

    const savedReceipt = await getPaymentReceipt(client, req.user.school_id, receiptId);
    await client.query('COMMIT');
    if (schoolFeeCents > 0) {
      notificationEvents.emit('fee.paid', {
        student_id: studentId,
        amount_paid: amountFromCents(schoolFeeCents),
        balance: remainingFeeBalance,
      });
    }
    res.status(201).json(savedReceipt);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendError(res, error, next);
  } finally {
    client?.release();
  }
};

const refundPayment = async (req, res, next) => {
  const receiptId = Number(req.params.receiptId);
  const component = req.body.component;
  const amountCents = moneyToCents(req.body.amount);
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  const reference = typeof req.body.reference === 'string' ? req.body.reference.trim() : '';
  const idempotencyKey = typeof req.body.idempotency_key === 'string'
    ? req.body.idempotency_key.trim() : '';
  const refundDate = req.body.refund_date || today();
  if (!Number.isSafeInteger(receiptId) || receiptId <= 0
      || !['school_fee', 'feeding'].includes(component)
      || amountCents === null || amountCents <= 0 || !reason || reason.length > 500
      || reference.length > 120 || !idempotencyKey || idempotencyKey.length > 200
      || (req.body.reference !== undefined && req.body.reference !== null && typeof req.body.reference !== 'string')
      || !parseDate(refundDate)) {
    return res.status(400).json({ message: 'Provide a receipt, component, positive amount, reason, refund date, and request key.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [String(req.user.school_id), idempotencyKey]
    );
    const duplicate = await client.query(
      `SELECT id, receipt_id, component, amount, reason, reference, refund_date::TEXT
       FROM school_payment_refunds WHERE school_id = $1 AND idempotency_key = $2`,
      [req.user.school_id, idempotencyKey]
    );
    if (duplicate.rowCount) {
      const saved = duplicate.rows[0];
      if (Number(saved.receipt_id) !== receiptId || saved.component !== component
          || moneyToCents(saved.amount) !== amountCents || saved.reason !== reason
          || (saved.reference || '') !== reference || saved.refund_date !== refundDate) {
        throw Object.assign(new Error('The request key was already used for a different refund.'), { status: 409 });
      }
      await client.query('COMMIT');
      return res.status(200).json(saved);
    }

    const original = await client.query(
      `SELECT id, student_id, receipt_number, school_fee_amount, feeding_amount
       FROM school_payment_receipts
       WHERE school_id = $1 AND id = $2
       FOR UPDATE`,
      [req.user.school_id, receiptId]
    );
    if (!original.rowCount) throw Object.assign(new Error('Payment receipt not found.'), { status: 404 });
    const receipt = original.rows[0];
    const componentAmount = moneyToCents(component === 'school_fee'
      ? receipt.school_fee_amount : receipt.feeding_amount);
    const refunded = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS amount
       FROM school_payment_refunds
       WHERE school_id = $1 AND receipt_id = $2 AND component = $3`,
      [req.user.school_id, receiptId, component]
    );
    const refundableCents = componentAmount - moneyToCents(refunded.rows[0].amount);
    if (amountCents > refundableCents) {
      throw Object.assign(new Error('Refund exceeds the unrefunded amount for this receipt component.'), { status: 409 });
    }

    const refundResult = await client.query(
      `INSERT INTO school_payment_refunds
         (school_id, receipt_id, student_id, component, amount, reason,
          reference, idempotency_key, refunded_by, refund_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, receipt_id, component, amount, reason, reference, refund_date::TEXT`,
      [
        req.user.school_id, receiptId, receipt.student_id, component,
        amountFromCents(amountCents), reason, reference || null,
        idempotencyKey, req.user.id, refundDate,
      ]
    );
    const refund = refundResult.rows[0];
    let remaining = amountCents;
    if (component === 'school_fee') {
      const allocations = await client.query(
        `SELECT a.id, a.fee_id, ROUND(a.amount * 100)::BIGINT AS amount_cents,
                COALESCE(r.refunded_cents, 0)::BIGINT AS refunded_cents
         FROM school_payment_allocations a
         LEFT JOIN LATERAL (
           SELECT SUM(ra.amount * 100)::BIGINT AS refunded_cents
           FROM school_payment_refund_allocations ra
           WHERE ra.school_id = a.school_id AND ra.payment_allocation_id = a.id
         ) r ON TRUE
         WHERE a.school_id = $1 AND a.receipt_id = $2 AND a.component = 'school_fee'
         ORDER BY a.id DESC`,
        [req.user.school_id, receiptId]
      );
      const refundPlan = allocateRefundCents(remaining, allocations.rows.map((allocation) => ({
        allocation_id: allocation.id,
        fee_id: allocation.fee_id,
        amount_cents: Number(allocation.amount_cents),
        refunded_cents: Number(allocation.refunded_cents),
      })));
      if (refundPlan.unallocated_cents) throw Object.assign(new Error('Refund exceeds the amount allocated to school-fee balances.'), { status: 409 });
      for (const line of refundPlan.allocations) {
        const amount = amountFromCents(line.amount_cents);
        await client.query(
          `INSERT INTO school_payment_refund_allocations
             (school_id, refund_id, payment_allocation_id, component, amount)
           VALUES ($1, $2, $3, 'school_fee', $4)`,
          [req.user.school_id, refund.id, line.allocation_id, amount]
        );
        const update = await client.query(
          `UPDATE fees SET amount_paid = amount_paid - $1
           WHERE school_id = $2 AND student_id = $3 AND id = $4
             AND amount_paid >= $1`,
          [amount, req.user.school_id, receipt.student_id, line.fee_id]
        );
        if (!update.rowCount) throw Object.assign(new Error('The linked school-fee balance changed; refund was cancelled.'), { status: 409 });
      }
      await client.query(
        `INSERT INTO transactions
           (school_id, type, category, amount, reference, description, date, payment_refund_id)
         VALUES ($1, 'expenditure', 'School Fees Refund', $2, $3, $4, $5, $6)`,
        [
          req.user.school_id, amountFromCents(amountCents),
          reference || `REF-${refund.id}`,
          `Refund against receipt ${receipt.receipt_number}: ${reason}`,
          refundDate, refund.id,
        ]
      );
    } else {
      const creditResult = await client.query(
        `SELECT ROUND(r.feeding_amount * 100)::BIGINT
                - COALESCE(f.refunded_cents, 0)
                - COALESCE(a.allocated_cents, 0)
                + COALESCE(a.reversed_cents, 0) AS credit_cents
         FROM school_payment_receipts r
         LEFT JOIN LATERAL (
           SELECT SUM(amount * 100)::BIGINT AS refunded_cents
           FROM school_payment_refunds
           WHERE school_id = r.school_id AND receipt_id = r.id AND component = 'feeding'
         ) f ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(p.amount * 100)::BIGINT AS allocated_cents,
                  SUM(COALESCE(refunds.reversed_cents, 0))::BIGINT AS reversed_cents
           FROM school_payment_allocations p
           LEFT JOIN LATERAL (
             SELECT SUM(ra.amount * 100)::BIGINT AS reversed_cents
             FROM school_payment_refund_allocations ra
             WHERE ra.payment_allocation_id = p.id AND ra.school_id = p.school_id
           ) refunds ON TRUE
           WHERE p.school_id = r.school_id AND p.receipt_id = r.id AND p.component = 'feeding'
         ) a ON TRUE
         WHERE r.school_id = $1 AND r.id = $2`,
        [req.user.school_id, receiptId]
      );
      const availableCredit = Math.max(0, Number(creditResult.rows[0].credit_cents) + amountCents);
      const creditRefund = Math.min(remaining, availableCredit);
      if (creditRefund > 0) {
        await client.query(
          `INSERT INTO school_payment_refund_allocations
             (school_id, refund_id, component, amount)
           VALUES ($1, $2, 'feeding', $3)`,
          [req.user.school_id, refund.id, amountFromCents(creditRefund)]
        );
        remaining -= creditRefund;
      }
      if (remaining > 0) {
        const allocations = await client.query(
          `SELECT a.id, ROUND(a.amount * 100)::BIGINT AS amount_cents,
                  COALESCE(r.refunded_cents, 0)::BIGINT AS refunded_cents
           FROM school_payment_allocations a
           LEFT JOIN LATERAL (
             SELECT SUM(ra.amount * 100)::BIGINT AS refunded_cents
             FROM school_payment_refund_allocations ra
             WHERE ra.school_id = a.school_id AND ra.payment_allocation_id = a.id
           ) r ON TRUE
           WHERE a.school_id = $1 AND a.receipt_id = $2 AND a.component = 'feeding'
           ORDER BY a.id DESC`,
          [req.user.school_id, receiptId]
        );
        const refundPlan = allocateRefundCents(remaining, allocations.rows.map((allocation) => ({
          allocation_id: allocation.id,
          amount_cents: Number(allocation.amount_cents),
          refunded_cents: Number(allocation.refunded_cents),
        })));
        for (const allocation of refundPlan.allocations) {
          await client.query(
            `INSERT INTO school_payment_refund_allocations
               (school_id, refund_id, payment_allocation_id, component, amount)
             VALUES ($1, $2, $3, 'feeding', $4)`,
            [req.user.school_id, refund.id, allocation.allocation_id, amountFromCents(allocation.amount_cents)]
          );
        }
        remaining = refundPlan.unallocated_cents;
      }
      if (remaining) throw Object.assign(new Error('Refund exceeds the available feeding advance and unrefunded allocations.'), { status: 409 });
      await client.query(
        `INSERT INTO feeding_payment_ledger
           (school_id, student_id, entry_type, amount, payment_date, refund_id, reference, recorded_by)
         VALUES ($1, $2, 'refund', $3, $4, $5, $6, $7)`,
        [
          req.user.school_id, receipt.student_id, amountFromCents(amountCents),
          refundDate, refund.id, reference || null, req.user.id,
        ]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(refund);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendError(res, error, next);
  } finally {
    client?.release();
  }
};

const listPaymentReceipts = async (req, res, next) => {
  const studentId = req.query.student_id ? Number(req.query.student_id) : null;
  if (studentId !== null && (!Number.isSafeInteger(studentId) || studentId <= 0)) {
    return res.status(400).json({ message: 'Choose a valid student.' });
  }
  try {
    const feedingOnly = req.user.role === 'feeding_tuckshop_officer';
    const result = await pool.query(
      `${receiptQuery}
       WHERE r.school_id = $1 AND ($2::INTEGER IS NULL OR r.student_id = $2)
         AND (NOT $3::BOOLEAN OR r.school_fee_amount = 0)
       ORDER BY r.payment_date DESC, r.id DESC
       LIMIT 500`,
      [req.user.school_id, studentId, feedingOnly]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const readPaymentReceipt = async (req, res, next) => {
  const receiptId = Number(req.params.receiptId);
  if (!Number.isSafeInteger(receiptId) || receiptId <= 0) {
    return res.status(400).json({ message: 'Choose a valid receipt.' });
  }
  try {
    const feedingOnly = req.user.role === 'feeding_tuckshop_officer';
    const result = await pool.query(
      `${receiptQuery}
       WHERE r.school_id = $1 AND r.id = $2
         AND (NOT $3::BOOLEAN OR r.school_fee_amount = 0)`,
      [req.user.school_id, receiptId, feedingOnly]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Payment receipt not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listPaymentReceipts,
  readPaymentReceipt,
  recordPayment,
  refundPayment,
};
