const {
  amountFromCents,
  listFeedingDays,
  rateForDate,
} = require('./feedingService');

async function findFeedingTerm(client, schoolId, { date, academicYear, term } = {}) {
  const result = await client.query(
    `SELECT id, academic_year, term, start_date::TEXT, end_date::TEXT,
            scheduled_weekdays
     FROM feeding_terms
     WHERE school_id = $1
       AND ($2::TEXT IS NULL OR academic_year = $2)
       AND ($3::TEXT IS NULL OR term = $3)
       AND ($4::DATE IS NULL OR $4::DATE BETWEEN start_date AND end_date)
     ORDER BY start_date DESC, id DESC
     LIMIT 1`,
    [schoolId, academicYear || null, term || null, date || null]
  );
  return result.rows[0] || null;
}

async function applyAvailableCredit(client, schoolId, studentIds) {
  if (!studentIds.length) return;
  const receipts = await client.query(
    `SELECT r.id AS receipt_id, r.student_id,
            ROUND(r.feeding_amount * 100)::BIGINT AS received_cents,
            COALESCE(a.allocated_cents, 0)::BIGINT AS allocated_cents,
            COALESCE(f.refunded_cents, 0)::BIGINT AS refunded_cents,
            COALESCE(a.reversed_cents, 0)::BIGINT AS reversed_cents
     FROM school_payment_receipts r
     LEFT JOIN LATERAL (
       SELECT SUM(p.amount * 100)::BIGINT AS allocated_cents,
              SUM(COALESCE(refunds.reversed_cents, 0))::BIGINT AS reversed_cents
       FROM school_payment_allocations p
       LEFT JOIN LATERAL (
         SELECT SUM(ra.amount * 100)::BIGINT AS reversed_cents
         FROM school_payment_refund_allocations ra
         WHERE ra.payment_allocation_id = p.id AND ra.school_id = p.school_id
       ) refunds ON TRUE
       WHERE p.school_id = r.school_id AND p.receipt_id = r.id
         AND p.component = 'feeding'
     ) a ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(refund.amount * 100)::BIGINT AS refunded_cents
       FROM school_payment_refunds refund
       WHERE refund.school_id = r.school_id AND refund.receipt_id = r.id
         AND refund.component = 'feeding'
     ) f ON TRUE
     WHERE r.school_id = $1 AND r.student_id = ANY($2::INTEGER[])
       AND r.feeding_amount > 0
     ORDER BY r.payment_date, r.id
     FOR UPDATE OF r`,
    [schoolId, studentIds]
  );
  const obligations = await client.query(
    `SELECT o.id, o.student_id,
            ROUND(o.amount_due * 100)::BIGINT AS due_cents,
            (COALESCE(a.allocated_cents, 0) - COALESCE(a.reversed_cents, 0))::BIGINT AS paid_cents
     FROM feeding_obligations o
     LEFT JOIN LATERAL (
       SELECT SUM(p.amount * 100)::BIGINT AS allocated_cents,
              SUM(COALESCE(refunds.reversed_cents, 0))::BIGINT AS reversed_cents
       FROM school_payment_allocations p
       LEFT JOIN LATERAL (
         SELECT SUM(ra.amount * 100)::BIGINT AS reversed_cents
         FROM school_payment_refund_allocations ra
         WHERE ra.payment_allocation_id = p.id AND ra.school_id = p.school_id
       ) refunds ON TRUE
       WHERE p.school_id = o.school_id AND p.obligation_id = o.id
     ) a ON TRUE
     WHERE o.school_id = $1 AND o.student_id = ANY($2::INTEGER[])
     ORDER BY o.student_id, o.feeding_date, o.id
     FOR UPDATE OF o`,
    [schoolId, studentIds]
  );

  const obligationsByStudent = new Map();
  for (const obligation of obligations.rows) {
    const list = obligationsByStudent.get(obligation.student_id) || [];
    list.push({
      id: obligation.id,
      amount_due_cents: Number(obligation.due_cents),
      amount_paid_cents: Number(obligation.paid_cents),
    });
    obligationsByStudent.set(obligation.student_id, list);
  }

  const rows = [];
  for (const receipt of receipts.rows) {
    const available = Number(receipt.received_cents) - Number(receipt.refunded_cents)
      - Number(receipt.allocated_cents) + Number(receipt.reversed_cents);
    if (available <= 0) continue;
    const studentObligations = obligationsByStudent.get(receipt.student_id) || [];
    for (const obligation of studentObligations) {
      if (available <= 0) break;
      const outstanding = Math.max(
        0,
        obligation.amount_due_cents - obligation.amount_paid_cents
      );
      if (!outstanding) continue;
      const amount = Math.min(available, outstanding);
      rows.push({
        receiptId: receipt.receipt_id,
        studentId: receipt.student_id,
        obligationId: obligation.id,
        amount: amountFromCents(amount),
      });
      obligation.amount_paid_cents += amount;
      available -= amount;
    }
  }

  if (!rows.length) return;
  await client.query(
    `INSERT INTO school_payment_allocations
       (school_id, receipt_id, student_id, component, obligation_id, amount)
     SELECT $1, value.receipt_id, value.student_id, 'feeding', value.obligation_id, value.amount
     FROM UNNEST($2::BIGINT[], $3::INTEGER[], $4::BIGINT[], $5::NUMERIC[])
       AS value(receipt_id, student_id, obligation_id, amount)`,
    [
      schoolId,
      rows.map((row) => row.receiptId),
      rows.map((row) => row.studentId),
      rows.map((row) => row.obligationId),
      rows.map((row) => row.amount),
    ]
  );
}

async function ensureTermObligations(client, schoolId, term, studentIds = null) {
  const termLock = await client.query(
    'SELECT id FROM feeding_terms WHERE school_id = $1 AND id = $2 FOR SHARE',
    [schoolId, term.id]
  );
  if (!termLock.rowCount) return { students: [], unconfigured: [] };
  const studentResult = await client.query(
    `SELECT s.id, s.class_id
     FROM students s
     JOIN feeding_student_accounts a
       ON a.school_id = s.school_id AND a.student_id = s.id
     WHERE s.school_id = $1
       AND ($2::INTEGER[] IS NULL OR s.id = ANY($2::INTEGER[]))
     ORDER BY s.id
     FOR UPDATE OF s`,
    [schoolId, studentIds]
  );
  if (!studentResult.rows.length) return { students: [], unconfigured: [] };
  const ids = studentResult.rows.map((row) => row.id);
  const histories = await client.query(
    `SELECT h.student_id, h.class_id, h.effective_from::TEXT,
            h.effective_to::TEXT, c.name AS class_name
     FROM feeding_student_class_history h
     LEFT JOIN classes c ON c.id = h.class_id AND c.school_id = h.school_id
     WHERE h.school_id = $1 AND h.student_id = ANY($2::INTEGER[])
       AND h.effective_from <= $4::DATE
       AND (h.effective_to IS NULL OR h.effective_to >= $3::DATE)
     ORDER BY h.student_id, h.effective_from`,
    [schoolId, ids, term.start_date, term.end_date]
  );
  const exceptionsResult = await client.query(
    `SELECT id, class_id, event_type, start_date::TEXT, end_date::TEXT
     FROM feeding_calendar_exceptions
     WHERE school_id = $1 AND term_id = $2
       AND start_date <= $4::DATE AND end_date >= $3::DATE`,
    [schoolId, term.id, term.start_date, term.end_date]
  );
  const ratesResult = await client.query(
    `SELECT id, class_id, daily_rate, effective_date::TEXT
     FROM feeding_class_rates
     WHERE school_id = $1 AND academic_year = $2 AND term = $3
       AND effective_date <= $4::DATE
     ORDER BY class_id, effective_date, id`,
    [schoolId, term.academic_year, term.term, term.end_date]
  );

  const historyByStudent = new Map();
  for (const history of histories.rows) {
    const list = historyByStudent.get(history.student_id) || [];
    list.push(history);
    historyByStudent.set(history.student_id, list);
  }
  const ratesByClass = new Map();
  for (const rate of ratesResult.rows) {
    const list = ratesByClass.get(rate.class_id) || [];
    list.push(rate);
    ratesByClass.set(rate.class_id, list);
  }

  const dayCache = new Map();
  const rows = [];
  const unconfigured = [];
  for (const student of studentResult.rows) {
    const history = historyByStudent.get(student.id) || [];
    for (const period of history) {
      if (!period.class_id) continue;
      const start = period.effective_from > term.start_date ? period.effective_from : term.start_date;
      const end = period.effective_to && period.effective_to < term.end_date
        ? period.effective_to : term.end_date;
      if (start > end) continue;
      const cacheKey = String(period.class_id);
      if (!dayCache.has(cacheKey)) {
        dayCache.set(cacheKey, listFeedingDays(
          term, exceptionsResult.rows, period.class_id, term.start_date, term.end_date
        ));
      }
      const dates = dayCache.get(cacheKey).filter((date) => date >= start && date <= end);
      const rates = ratesByClass.get(period.class_id) || [];
      for (const feedingDate of dates) {
        const applicableRate = rateForDate(rates, feedingDate);
        if (!applicableRate) {
          unconfigured.push({
            student_id: student.id,
            class_id: period.class_id,
            class_name: period.class_name,
            feeding_date: feedingDate,
          });
          continue;
        }
        rows.push({
          studentId: student.id,
          date: feedingDate,
          academicYear: term.academic_year,
          termName: term.term,
          classId: period.class_id,
          className: period.class_name,
          rateId: applicableRate.id,
          dailyRate: applicableRate.daily_rate,
        });
      }
    }
  }

  if (rows.length) {
    await client.query(
      `INSERT INTO feeding_obligations
         (school_id, student_id, feeding_date, academic_year, term,
          class_id, class_name_snapshot, rate_id, daily_rate, amount_due)
       SELECT $1, value.student_id, value.feeding_date, value.academic_year, value.term,
              value.class_id, value.class_name, value.rate_id, value.daily_rate, value.daily_rate
       FROM UNNEST(
         $2::INTEGER[], $3::DATE[], $4::TEXT[], $5::TEXT[], $6::INTEGER[],
         $7::TEXT[], $8::BIGINT[], $9::NUMERIC[]
       ) AS value(student_id, feeding_date, academic_year, term, class_id, class_name, rate_id, daily_rate)
       ON CONFLICT (school_id, student_id, feeding_date) DO UPDATE
       SET academic_year = EXCLUDED.academic_year,
           term = EXCLUDED.term,
           class_id = EXCLUDED.class_id,
           class_name_snapshot = EXCLUDED.class_name_snapshot,
           rate_id = EXCLUDED.rate_id,
           daily_rate = EXCLUDED.daily_rate,
           amount_due = EXCLUDED.amount_due
       WHERE feeding_obligations.feeding_date >= CURRENT_DATE
         AND NOT EXISTS (
           SELECT 1 FROM school_payment_allocations pa
           WHERE pa.school_id = feeding_obligations.school_id
             AND pa.obligation_id = feeding_obligations.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM feeding_coverage_days cd
           WHERE cd.school_id = feeding_obligations.school_id
             AND cd.obligation_id = feeding_obligations.id
         )`,
      [
        schoolId,
        rows.map((row) => row.studentId),
        rows.map((row) => row.date),
        rows.map((row) => row.academicYear),
        rows.map((row) => row.termName),
        rows.map((row) => row.classId),
        rows.map((row) => row.className),
        rows.map((row) => row.rateId),
        rows.map((row) => row.dailyRate),
      ]
    );
  }

  await client.query(
    `DELETE FROM feeding_obligations o
     WHERE o.school_id = $1 AND o.academic_year = $2 AND o.term = $3
       AND o.student_id = ANY($4::INTEGER[])
       AND o.feeding_date >= CURRENT_DATE
       AND NOT EXISTS (
         SELECT 1
         FROM UNNEST($5::INTEGER[], $6::DATE[]) AS scheduled(student_id, feeding_date)
         WHERE scheduled.student_id = o.student_id
           AND scheduled.feeding_date = o.feeding_date
       )
       AND NOT EXISTS (
         SELECT 1 FROM school_payment_allocations pa
         WHERE pa.school_id = o.school_id AND pa.obligation_id = o.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM feeding_coverage_days cd
         WHERE cd.school_id = o.school_id AND cd.obligation_id = o.id
       )`,
    [
      schoolId,
      term.academic_year,
      term.term,
      ids,
      rows.map((row) => row.studentId),
      rows.map((row) => row.date),
    ]
  );

  await applyAvailableCredit(client, schoolId, ids);
  return { students: studentResult.rows, unconfigured };
}

module.exports = { applyAvailableCredit, ensureTermObligations, findFeedingTerm };
