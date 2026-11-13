const crypto = require('crypto');
const pool = require('../config/db');
const {
  calculateCoverage,
  getCoverageStartDate,
  listSchoolDays,
  moneyToCents,
  parseDate,
} = require('../services/feedingCoverage');

const fail = (status, message) => Object.assign(new Error(message), { status });
const receiptNumber = (prefix) => `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const today = () => new Date().toISOString().slice(0, 10);
const amountFromCents = (cents) => (cents / 100).toFixed(2);
const errorResponse = (res, error, next) => {
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.code === '23505') return res.status(409).json({ message: 'This request has already been recorded.' });
  return next(error);
};

const getFeedingClasses = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, r.daily_rate
       FROM classes c
       LEFT JOIN feeding_class_rates r ON r.class_id = c.id AND r.school_id = c.school_id
       WHERE c.school_id = $1
       ORDER BY c.name`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const setFeedingRate = async (req, res, next) => {
  const rateCents = moneyToCents(req.body.daily_rate);
  if (rateCents === null || rateCents <= 0) return res.status(400).json({ message: 'Daily feeding rate must be a positive amount.' });
  try {
    const result = await pool.query(
      `INSERT INTO feeding_class_rates (school_id, class_id, daily_rate, updated_by)
       SELECT $1, c.id, $3, $4 FROM classes c WHERE c.id = $2 AND c.school_id = $1
       ON CONFLICT (school_id, class_id) DO UPDATE
       SET daily_rate = EXCLUDED.daily_rate, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING class_id, daily_rate`,
      [req.user.school_id, req.params.classId, amountFromCents(rateCents), req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Class not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const searchFeedingStudents = async (req, res, next) => {
  const search = String(req.query.search || '').trim();
  const classId = req.query.classId ? Number(req.query.classId) : null;
  if (search.length < 2) return res.status(400).json({ message: 'Enter at least two characters of the student name.' });
  if (classId !== null && (!Number.isInteger(classId) || classId <= 0)) return res.status(400).json({ message: 'Select a valid class.' });
  try {
    const result = await pool.query(
      `SELECT s.id, s.name, s.class_id, c.name AS class_name,
              r.daily_rate,
              COALESCE(cr.balance, 0) AS feeding_credit
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       LEFT JOIN feeding_class_rates r ON r.class_id = s.class_id AND r.school_id = s.school_id
       LEFT JOIN feeding_student_credits cr ON cr.student_id = s.id AND cr.school_id = s.school_id
       WHERE s.school_id = $1 AND s.name ILIKE $2
         AND ($3::INTEGER IS NULL OR s.class_id = $3)
       ORDER BY s.name LIMIT 50`,
      [req.user.school_id, `%${search}%`, classId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getCalendarEvents = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, event_type, start_date, end_date, created_at
       FROM school_calendar_events WHERE school_id = $1
       ORDER BY start_date, id`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createCalendarEvent = async (req, res, next) => {
  const { name, event_type, start_date, end_date } = req.body;
  if (!name?.trim() || !['holiday', 'vacation', 'school_day'].includes(event_type)
      || !parseDate(start_date) || !parseDate(end_date) || start_date > end_date) {
    return res.status(400).json({ message: 'Provide a name, event type, and valid date range.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO school_calendar_events (school_id, name, event_type, start_date, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, event_type, start_date, end_date`,
      [req.user.school_id, name.trim(), event_type, start_date, end_date, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const deleteCalendarEvent = async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM school_calendar_events WHERE id = $1 AND school_id = $2 RETURNING id',
      [req.params.id, req.user.school_id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'School calendar entry not found.' });
    res.json({ message: 'School calendar entry removed.' });
  } catch (error) {
    next(error);
  }
};

const recordFeedingPayment = async (req, res, next) => {
  const studentId = Number(req.body.student_id);
  const idempotencyKey = String(req.body.idempotency_key || '').trim();
  const amountCents = moneyToCents(req.body.amount_received);
  const paymentDate = req.body.payment_date || today();
  const paymentMethod = req.body.payment_method || 'cash';
  const paymentReference = String(req.body.payment_reference || '').trim() || null;
  if (!Number.isInteger(studentId) || studentId <= 0 || !idempotencyKey
      || amountCents === null || amountCents <= 0 || !parseDate(paymentDate)
      || !['cash', 'mobile_money', 'bank_transfer', 'other'].includes(paymentMethod)) {
    return res.status(400).json({ message: 'Choose a student, enter a positive amount and valid payment date, and provide an idempotency key.' });
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
      `SELECT id FROM feeding_payments
       WHERE school_id = $1 AND idempotency_key = $2`,
      [req.user.school_id, idempotencyKey]
    );
    if (duplicate.rows.length) {
      const saved = await getPayment(client, req.user.school_id, duplicate.rows[0].id);
      await client.query('COMMIT');
      return res.status(200).json(saved);
    }

    const studentResult = await client.query(
      `SELECT s.id, s.name, s.class_id, c.name AS class_name, r.daily_rate
       FROM students s
       JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       JOIN feeding_class_rates r ON r.class_id = s.class_id AND r.school_id = s.school_id
       WHERE s.id = $1 AND s.school_id = $2
       FOR UPDATE OF s`,
      [studentId, req.user.school_id]
    );
    if (!studentResult.rows.length) throw fail(400, 'Student not found, not assigned to a class, or no feeding rate is configured for the class.');
    const student = studentResult.rows[0];
    await client.query(
      `INSERT INTO feeding_student_credits (school_id, student_id)
       VALUES ($1, $2) ON CONFLICT (school_id, student_id) DO NOTHING`,
      [req.user.school_id, studentId]
    );
    const creditResult = await client.query(
      `SELECT balance FROM feeding_student_credits
       WHERE school_id = $1 AND student_id = $2 FOR UPDATE`,
      [req.user.school_id, studentId]
    );
    const coverage = calculateCoverage({
      amountReceived: amountFromCents(amountCents),
      dailyRate: student.daily_rate,
      existingCredit: creditResult.rows[0].balance,
    });
    const dailyRateCents = moneyToCents(student.daily_rate);
    const previousCoverage = await client.query(
      `SELECT MAX(coverage_end) AS coverage_end
       FROM feeding_payments
       WHERE school_id = $1 AND student_id = $2 AND days_covered > 0`,
      [req.user.school_id, studentId]
    );
    let coverageDates = [];
    if (coverage.daysCovered > 0) {
      const lastCovered = previousCoverage.rows[0].coverage_end
        ? String(previousCoverage.rows[0].coverage_end).slice(0, 10)
        : null;
      const firstEligibleDate = getCoverageStartDate(paymentDate, lastCovered);
      const calendarResult = await client.query(
        `SELECT name, event_type, start_date::TEXT, end_date::TEXT
         FROM school_calendar_events
         WHERE school_id = $1 AND start_date <= $3::DATE + INTERVAL '10 years'
           AND end_date >= $2::DATE`,
        [req.user.school_id, firstEligibleDate, firstEligibleDate]
      );
      coverageDates = listSchoolDays(firstEligibleDate, coverage.daysCovered, calendarResult.rows);
    }

    const receipt = receiptNumber('FED');
    const paymentResult = await client.query(
      `INSERT INTO feeding_payments (
         school_id, student_id, amount_received, daily_rate, credit_applied, days_covered,
         credit_added, coverage_start, coverage_end, payment_date, received_by,
         receipt_number, idempotency_key, payment_method, payment_reference
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        req.user.school_id, studentId, amountFromCents(amountCents), amountFromCents(dailyRateCents),
        amountFromCents(coverage.creditAppliedCents), coverage.daysCovered,
        amountFromCents(coverage.creditAddedCents), coverageDates[0] || null,
        coverageDates[coverageDates.length - 1] || null, paymentDate, req.user.id, receipt,
        idempotencyKey, paymentMethod, paymentReference,
      ]
    );
    const paymentId = paymentResult.rows[0].id;
    for (const date of coverageDates) {
      await client.query(
        `INSERT INTO feeding_coverage_days (school_id, payment_id, student_id, coverage_date)
         VALUES ($1, $2, $3, $4)`,
        [req.user.school_id, paymentId, studentId, date]
      );
    }
    await client.query(
      `UPDATE feeding_student_credits SET balance = $3, updated_at = NOW()
       WHERE school_id = $1 AND student_id = $2`,
      [req.user.school_id, studentId, amountFromCents(coverage.creditAddedCents)]
    );
    await client.query(
      `INSERT INTO transactions (school_id, type, category, amount, reference, description, date, source_type, source_id)
       VALUES ($1, 'income', 'Feeding Fees', $2, $3, $4, $5, 'feeding_payment', $6)`,
      [
        req.user.school_id, amountFromCents(amountCents), receipt,
        `Feeding payment received for ${student.name}`, paymentDate, paymentId,
      ]
    );
    const saved = await getPayment(client, req.user.school_id, paymentId);
    await client.query('COMMIT');
    res.status(201).json(saved);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(res, error, next);
  } finally {
    client?.release();
  }
};

const getPayment = async (client, schoolId, paymentId) => {
  const result = await client.query(
    `SELECT p.id, p.student_id, s.name AS student_name, c.name AS class_name,
            p.amount_received, p.daily_rate, p.credit_applied, p.days_covered,
            p.credit_added, p.coverage_start, p.coverage_end, p.payment_date,
            p.receipt_number, p.payment_method, p.payment_reference,
            p.created_at, u.name AS received_by_name
     FROM feeding_payments p
     JOIN students s ON s.id = p.student_id AND s.school_id = p.school_id
     LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
     LEFT JOIN users u ON u.id = p.received_by
     WHERE p.school_id = $1 AND p.id = $2`,
    [schoolId, paymentId]
  );
  return result.rows[0];
};

const getFeedingPayments = async (req, res, next) => {
  const studentId = req.query.studentId ? Number(req.query.studentId) : null;
  if (studentId !== null && (!Number.isInteger(studentId) || studentId <= 0)) return res.status(400).json({ message: 'Select a valid student.' });
  try {
    const result = await pool.query(
      `SELECT p.id, p.student_id, s.name AS student_name, c.name AS class_name,
              p.amount_received, p.daily_rate, p.credit_applied, p.days_covered,
              p.credit_added, p.coverage_start, p.coverage_end, p.payment_date,
              p.receipt_number, p.payment_method, p.payment_reference,
              p.created_at, u.name AS received_by_name
       FROM feeding_payments p
       JOIN students s ON s.id = p.student_id AND s.school_id = p.school_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       LEFT JOIN users u ON u.id = p.received_by
       WHERE p.school_id = $1 AND ($2::INTEGER IS NULL OR p.student_id = $2)
       ORDER BY p.payment_date DESC, p.id DESC LIMIT 500`,
      [req.user.school_id, studentId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getFeedingReceipt = async (req, res, next) => {
  try {
    const receipt = await getPayment(pool, req.user.school_id, req.params.id);
    if (!receipt) return res.status(404).json({ message: 'Feeding receipt not found.' });
    res.json(receipt);
  } catch (error) {
    next(error);
  }
};

const getFeedingRegister = async (req, res, next) => {
  const date = req.query.date || today();
  if (!parseDate(date)) return res.status(400).json({ message: 'Enter a valid register date.' });
  try {
    const result = await pool.query(
      `SELECT d.id, d.student_id, s.name AS student_name, c.name AS class_name,
              d.coverage_date, d.is_served, d.served_at, u.name AS served_by_name,
              p.receipt_number, p.daily_rate
       FROM feeding_coverage_days d
       JOIN students s ON s.id = d.student_id AND s.school_id = d.school_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       JOIN feeding_payments p ON p.id = d.payment_id AND p.school_id = d.school_id
       LEFT JOIN users u ON u.id = d.served_by
       WHERE d.school_id = $1 AND d.coverage_date = $2
       ORDER BY s.name`,
      [req.user.school_id, date]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const updateFeedingRegister = async (req, res, next) => {
  const isServed = req.body.is_served;
  if (typeof isServed !== 'boolean') return res.status(400).json({ message: 'Choose whether the student was served.' });
  try {
    const result = await pool.query(
      `UPDATE feeding_coverage_days
       SET is_served = $3, served_by = CASE WHEN $3 THEN $4 ELSE NULL END,
           served_at = CASE WHEN $3 THEN NOW() ELSE NULL END
       WHERE id = $1 AND school_id = $2
       RETURNING id, is_served, served_at`,
      [req.params.id, req.user.school_id, isServed, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Feeding register entry not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getFeedingReport = async (req, res, next) => {
  const { startDate, endDate } = req.query;
  if (!parseDate(startDate) || !parseDate(endDate) || startDate > endDate) {
    return res.status(400).json({ message: 'Provide a valid report date range.' });
  }
  try {
    const granted = ['admin', 'feeding_tuckshop_officer'].includes(req.user.role)
      ? new Set(['feeding.reports.read', 'tuckshop.reports.read'])
      : new Set((await pool.query(
        `SELECT permission FROM user_permissions
         WHERE school_id = $1 AND user_id = $2
           AND permission IN ('feeding.reports.read', 'tuckshop.reports.read')`,
        [req.user.school_id, req.user.id]
      )).rows.map((row) => row.permission));
    const [
      payments, sales, purchases, dailyCollections, classCollections, methodCollections,
      staffCollections, tuckshopSalesByDate,
    ] = await Promise.all([
      granted.has('feeding.reports.read')
        ? pool.query(
          `SELECT COUNT(*)::INTEGER AS count, COALESCE(SUM(amount_received), 0) AS total
           FROM feeding_payments WHERE school_id = $1 AND payment_date BETWEEN $2 AND $3`,
          [req.user.school_id, startDate, endDate]
        )
        : Promise.resolve(null),
      granted.has('tuckshop.reports.read')
        ? pool.query(
          `SELECT COUNT(*)::INTEGER AS count, COALESCE(SUM(s.total_amount), 0) AS total,
                  COUNT(*) FILTER (WHERE lines.line_count = lines.cost_line_count)::INTEGER AS costed_sales_count,
                  COALESCE(SUM(lines.cost_total) FILTER (WHERE lines.line_count = lines.cost_line_count), 0) AS cost_of_goods_sold,
                  COALESCE(SUM(s.total_amount - lines.cost_total)
                    FILTER (WHERE lines.line_count = lines.cost_line_count), 0) AS gross_profit
           FROM tuckshop_sales s
           LEFT JOIN (
             SELECT school_id, sale_id, COUNT(*) AS line_count,
                    COUNT(line_cost) AS cost_line_count, SUM(line_cost) AS cost_total
             FROM tuckshop_sale_items GROUP BY school_id, sale_id
           ) lines ON lines.school_id = s.school_id AND lines.sale_id = s.id
           WHERE s.school_id = $1 AND s.sale_date BETWEEN $2 AND $3`,
          [req.user.school_id, startDate, endDate]
        )
        : Promise.resolve(null),
      granted.has('feeding.reports.read') || granted.has('tuckshop.reports.read')
        ? pool.query(
          `SELECT purpose, COUNT(*)::INTEGER AS count, COALESCE(SUM(total_amount), 0) AS total
           FROM kitchen_purchases
           WHERE school_id = $1 AND status = 'approved' AND purchase_date BETWEEN $2 AND $3
             AND ($4::TEXT IS NULL OR purpose = $4)
           GROUP BY purpose`,
          [
            req.user.school_id, startDate, endDate,
            granted.has('feeding.reports.read') && granted.has('tuckshop.reports.read')
              ? null
              : granted.has('feeding.reports.read') ? 'feeding' : 'kitchen',
          ]
        )
        : Promise.resolve(null),
      granted.has('feeding.reports.read')
        ? pool.query(
          `SELECT payment_date::TEXT AS collection_date,
                  COUNT(*)::INTEGER AS payment_count,
                  COUNT(DISTINCT student_id)::INTEGER AS student_count,
                  COALESCE(SUM(amount_received), 0) AS total,
                  COALESCE(SUM(days_covered), 0)::INTEGER AS feeding_days
           FROM feeding_payments
           WHERE school_id = $1 AND payment_date BETWEEN $2 AND $3
           GROUP BY payment_date ORDER BY payment_date`,
          [req.user.school_id, startDate, endDate]
        )
        : Promise.resolve(null),
      granted.has('feeding.reports.read')
        ? pool.query(
          `SELECT c.name AS class_name, COUNT(*)::INTEGER AS payment_count,
                  COUNT(DISTINCT p.student_id)::INTEGER AS student_count,
                  COALESCE(SUM(p.amount_received), 0) AS total,
                  COALESCE(SUM(p.days_covered), 0)::INTEGER AS feeding_days
           FROM feeding_payments p
           JOIN students s ON s.id = p.student_id AND s.school_id = p.school_id
           LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
           WHERE p.school_id = $1 AND p.payment_date BETWEEN $2 AND $3
           GROUP BY c.name ORDER BY c.name NULLS LAST`,
          [req.user.school_id, startDate, endDate]
        )
        : Promise.resolve(null),
      granted.has('feeding.reports.read')
        ? pool.query(
          `SELECT payment_method, COUNT(*)::INTEGER AS payment_count,
                  COALESCE(SUM(amount_received), 0) AS total
           FROM feeding_payments
           WHERE school_id = $1 AND payment_date BETWEEN $2 AND $3
           GROUP BY payment_method ORDER BY payment_method`,
          [req.user.school_id, startDate, endDate]
        )
        : Promise.resolve(null),
      granted.has('feeding.reports.read')
        ? pool.query(
          `SELECT COALESCE(u.name, 'Former staff member') AS staff_name,
                  COUNT(*)::INTEGER AS payment_count,
                  COALESCE(SUM(p.amount_received), 0) AS total
           FROM feeding_payments p
           LEFT JOIN users u ON u.id = p.received_by
           WHERE p.school_id = $1 AND p.payment_date BETWEEN $2 AND $3
           GROUP BY COALESCE(u.name, 'Former staff member') ORDER BY staff_name`,
          [req.user.school_id, startDate, endDate]
        )
        : Promise.resolve(null),
      granted.has('tuckshop.reports.read')
        ? pool.query(
          `SELECT sale_date::TEXT AS sale_date,
                  COUNT(*)::INTEGER AS transaction_count,
                  COALESCE(SUM(total_amount) FILTER (WHERE payment_method = 'cash'), 0) AS cash_total,
                  COALESCE(SUM(total_amount) FILTER (WHERE payment_method = 'mobile_money'), 0) AS mobile_money_total,
                  COALESCE(SUM(total_amount) FILTER (WHERE payment_method NOT IN ('cash', 'mobile_money')), 0) AS other_total,
                  COALESCE(SUM(total_amount), 0) AS total
           FROM tuckshop_sales WHERE school_id = $1 AND sale_date BETWEEN $2 AND $3
           GROUP BY sale_date ORDER BY sale_date`,
          [req.user.school_id, startDate, endDate]
        )
        : Promise.resolve(null),
    ]);
    res.json({
      feeding: payments ? { count: payments.rows[0].count, total: payments.rows[0].total } : null,
      tuckshop: sales ? {
        count: sales.rows[0].count,
        total: sales.rows[0].total,
        costedSalesCount: sales.rows[0].costed_sales_count,
        costOfGoodsSold: sales.rows[0].cost_of_goods_sold,
        grossProfit: sales.rows[0].gross_profit,
      } : null,
      approvedPurchases: purchases ? purchases.rows : null,
      feedingCollections: dailyCollections ? {
        byDate: dailyCollections.rows,
        byClass: classCollections.rows,
        byPaymentMethod: methodCollections.rows,
        byStaff: staffCollections.rows,
      } : null,
      tuckshopCollections: tuckshopSalesByDate ? tuckshopSalesByDate.rows : null,
    });
  } catch (error) {
    next(error);
  }
};

const getTuckshopProducts = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, sku, unit_price, cost_price, stock_quantity, category,
              barcode, reorder_level, supplier, expiry_date, is_active, updated_at
       FROM tuckshop_products WHERE school_id = $1 ORDER BY name`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const saveTuckshopProduct = async (req, res, next) => {
  const {
    name, sku, unit_price, cost_price, stock_quantity, category, barcode,
    reorder_level, supplier, expiry_date, is_active,
  } = req.body;
  const priceCents = moneyToCents(unit_price);
  const costCents = moneyToCents(cost_price || 0);
  const stock = Number(stock_quantity);
  const reorderLevel = Number(reorder_level || 0);
  if (!name?.trim() || priceCents === null || !Number.isInteger(stock) || stock < 0
      || costCents === null || !Number.isInteger(reorderLevel) || reorderLevel < 0
      || (expiry_date && !parseDate(expiry_date))
      || (is_active !== undefined && typeof is_active !== 'boolean')) {
    return res.status(400).json({ message: 'Provide a name, valid price/cost, stock and reorder quantities, and a valid optional expiry date.' });
  }
  try {
    const values = [
      req.user.school_id, name.trim(), sku?.trim() || null,
      amountFromCents(priceCents), amountFromCents(costCents), stock,
      category?.trim() || null, barcode?.trim() || null, reorderLevel,
      supplier?.trim() || null, expiry_date || null, is_active !== false,
    ];
    const result = req.params.id
      ? await pool.query(
        `UPDATE tuckshop_products
         SET name = $2, sku = $3, unit_price = $4, cost_price = $5,
             stock_quantity = $6, category = $7, barcode = $8, reorder_level = $9,
             supplier = $10, expiry_date = $11, is_active = $12, updated_at = NOW()
         WHERE school_id = $1 AND id = $13
         RETURNING id, name, sku, unit_price, cost_price, stock_quantity, category,
                   barcode, reorder_level, supplier, expiry_date, is_active`,
        [...values, req.params.id]
      )
      : await pool.query(
        `INSERT INTO tuckshop_products (
           school_id, name, sku, unit_price, cost_price, stock_quantity, category,
           barcode, reorder_level, supplier, expiry_date, is_active, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, name, sku, unit_price, cost_price, stock_quantity, category,
                   barcode, reorder_level, supplier, expiry_date, is_active`,
        [...values, req.user.id]
      );
    if (!result.rows.length) return res.status(404).json({ message: 'Tuckshop product not found.' });
    res.status(req.params.id ? 200 : 201).json(result.rows[0]);
  } catch (error) {
    return errorResponse(res, error, next);
  }
};

const createTuckshopSale = async (req, res, next) => {
  const { items, idempotency_key: idempotencyKey, payment_method: paymentMethod } = req.body;
  if (!Array.isArray(items) || !items.length || items.length > 100 || !idempotencyKey
      || items.some((item) => !item || typeof item !== 'object')
      || !['cash', 'mobile_money', 'bank_transfer', 'card', 'other'].includes(paymentMethod)) {
    return res.status(400).json({ message: 'Add sale items, a valid payment method, and an idempotency key.' });
  }
  const normalizedItems = new Map();
  for (const item of items) {
    const productId = Number(item.product_id);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ message: 'Every sale item must have a valid product and positive whole-number quantity.' });
    }
    normalizedItems.set(productId, (normalizedItems.get(productId) || 0) + quantity);
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [String(req.user.school_id), idempotencyKey]
    );
    const existing = await client.query(
      'SELECT id FROM tuckshop_sales WHERE school_id = $1 AND idempotency_key = $2',
      [req.user.school_id, idempotencyKey]
    );
    if (existing.rows.length) {
      const saved = await getTuckshopSale(client, req.user.school_id, existing.rows[0].id);
      await client.query('COMMIT');
      return res.status(200).json(saved);
    }
    const ids = [...normalizedItems.keys()];
    const productsResult = await client.query(
      `SELECT id, name, unit_price, cost_price, stock_quantity
       FROM tuckshop_products
       WHERE school_id = $1 AND id = ANY($2::BIGINT[]) AND is_active = TRUE
       FOR UPDATE`,
      [req.user.school_id, ids]
    );
    if (productsResult.rows.length !== ids.length) throw fail(400, 'One or more sale products are unavailable.');
    const products = new Map(productsResult.rows.map((product) => [Number(product.id), product]));
    let totalCents = 0;
    let totalCostCents = 0;
    const saleLines = [];
    for (const [productId, quantity] of normalizedItems) {
      const product = products.get(productId);
      if (Number(product.stock_quantity) < quantity) throw fail(409, `Not enough stock for ${product.name}.`);
      const unitCents = moneyToCents(product.unit_price);
      const lineCents = unitCents * quantity;
      const costCents = moneyToCents(product.cost_price || 0);
      const lineCostCents = costCents * quantity;
      totalCents += lineCents;
      totalCostCents += lineCostCents;
      saleLines.push({ product, quantity, unitCents, lineCents, costCents, lineCostCents });
    }
    if (totalCents <= 0) throw fail(400, 'The sale total must be greater than zero.');

    const inserted = await client.query(
      `INSERT INTO tuckshop_sales (
         school_id, total_amount, payment_method, sold_by, receipt_number, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (school_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [req.user.school_id, amountFromCents(totalCents), paymentMethod, req.user.id, receiptNumber('TKS'), idempotencyKey]
    );
    if (!inserted.rows.length) {
      const duplicate = await client.query(
        'SELECT id FROM tuckshop_sales WHERE school_id = $1 AND idempotency_key = $2',
        [req.user.school_id, idempotencyKey]
      );
      const saved = await getTuckshopSale(client, req.user.school_id, duplicate.rows[0].id);
      await client.query('COMMIT');
      return res.status(200).json(saved);
    }
    const saleId = inserted.rows[0].id;
    for (const line of saleLines) {
      const stockResult = await client.query(
        `UPDATE tuckshop_products SET stock_quantity = stock_quantity - $3, updated_at = NOW()
         WHERE school_id = $1 AND id = $2 AND stock_quantity >= $3`,
        [req.user.school_id, line.product.id, line.quantity]
      );
      if (stockResult.rowCount !== 1) throw fail(409, `Not enough stock for ${line.product.name}.`);
      await client.query(
        `INSERT INTO tuckshop_sale_items
           (school_id, sale_id, product_id, product_name, quantity, unit_price, line_total, unit_cost, line_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          req.user.school_id, saleId, line.product.id, line.product.name, line.quantity,
          amountFromCents(line.unitCents), amountFromCents(line.lineCents),
          amountFromCents(line.costCents), amountFromCents(line.lineCostCents),
        ]
      );
    }
    await client.query(
      `INSERT INTO transactions (school_id, type, category, amount, reference, description, date, source_type, source_id)
       SELECT school_id, 'income', 'Tuckshop Sales', total_amount, receipt_number,
              'Tuckshop sale', sale_date, 'tuckshop_sale', id
       FROM tuckshop_sales WHERE school_id = $1 AND id = $2`,
      [req.user.school_id, saleId]
    );
    if (totalCostCents > 0) {
      const costTransaction = await client.query(
        `INSERT INTO transactions (school_id, type, category, amount, reference, description, date, source_type, source_id)
         SELECT school_id, 'expenditure', 'Tuckshop Cost of Goods Sold', $2, $3,
                'Cost of goods sold for tuckshop sale', sale_date, 'tuckshop_sale_cogs', id
         FROM tuckshop_sales WHERE school_id = $1 AND id = $4
         ON CONFLICT (school_id, source_type, source_id) DO NOTHING`,
        [req.user.school_id, amountFromCents(totalCostCents), receiptNumber('COGS'), saleId]
      );
      if (costTransaction.rowCount !== 1) throw fail(409, 'A cost-of-goods transaction already exists for this sale.');
    }
    const saved = await getTuckshopSale(client, req.user.school_id, saleId);
    await client.query('COMMIT');
    res.status(201).json(saved);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(res, error, next);
  } finally {
    client?.release();
  }
};

const getTuckshopSale = async (client, schoolId, saleId) => {
  const result = await client.query(
    `SELECT s.id, s.total_amount, s.payment_method, s.receipt_number, s.sale_date,
            s.created_at, u.name AS sold_by_name,
            COALESCE(json_agg(json_build_object(
              'product_id', i.product_id, 'product_name', i.product_name,
              'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total,
              'unit_cost', i.unit_cost, 'line_cost', i.line_cost
            )) FILTER (WHERE i.id IS NOT NULL), '[]'::JSON) AS items
     FROM tuckshop_sales s
     LEFT JOIN users u ON u.id = s.sold_by
     LEFT JOIN tuckshop_sale_items i ON i.sale_id = s.id AND i.school_id = s.school_id
     WHERE s.school_id = $1 AND s.id = $2
     GROUP BY s.id, u.name`,
    [schoolId, saleId]
  );
  return result.rows[0];
};

const getTuckshopSales = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.total_amount, s.payment_method, s.receipt_number, s.sale_date,
              s.created_at, u.name AS sold_by_name,
              COALESCE(json_agg(json_build_object(
                'product_id', i.product_id, 'product_name', i.product_name,
                'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total,
                'unit_cost', i.unit_cost, 'line_cost', i.line_cost
              )) FILTER (WHERE i.id IS NOT NULL), '[]'::JSON) AS items
       FROM tuckshop_sales s
       LEFT JOIN users u ON u.id = s.sold_by
       LEFT JOIN tuckshop_sale_items i ON i.sale_id = s.id AND i.school_id = s.school_id
       WHERE s.school_id = $1
       GROUP BY s.id, u.name ORDER BY s.sale_date DESC, s.id DESC LIMIT 500`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createTuckshopProductPurchase = async (req, res, next) => {
  const { items, idempotency_key: idempotencyKey } = req.body;
  const purchaseDate = req.body.purchase_date || today();
  const paymentMethod = req.body.payment_method || 'cash';
  const transportCents = moneyToCents(req.body.transport_cost || 0);
  const otherCents = moneyToCents(req.body.other_cost || 0);
  const advanceId = req.body.advance_id ? Number(req.body.advance_id) : null;
  if (!Array.isArray(items) || !items.length || items.length > 100 || !idempotencyKey
      || items.some((item) => !item || typeof item !== 'object')
      || !parseDate(purchaseDate) || transportCents === null || otherCents === null
      || !['cash', 'mobile_money', 'bank_transfer', 'other'].includes(paymentMethod)
      || (advanceId !== null && (!Number.isInteger(advanceId) || advanceId <= 0))) {
    return res.status(400).json({ message: 'Provide a valid date, supplier purchase details, payment method, items and idempotency key.' });
  }
  const normalizedItems = items.map((item) => ({
    productId: Number(item.product_id),
    quantity: Number(item.quantity),
    unitCostCents: moneyToCents(item.unit_cost),
  }));
  if (normalizedItems.some((item) => !Number.isInteger(item.productId) || item.productId <= 0
      || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.unitCostCents === null)) {
    return res.status(400).json({ message: 'Each purchase line needs a valid product, positive whole-number quantity and non-negative unit cost.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [String(req.user.school_id), idempotencyKey]);
    const duplicate = await client.query(
      'SELECT id, status, total_amount FROM tuckshop_product_purchases WHERE school_id = $1 AND idempotency_key = $2',
      [req.user.school_id, idempotencyKey]
    );
    if (duplicate.rows.length) {
      await client.query('COMMIT');
      return res.status(200).json(duplicate.rows[0]);
    }

    if (advanceId) {
      const advance = await client.query(
        'SELECT id FROM shopping_advances WHERE school_id = $1 AND id = $2 FOR UPDATE',
        [req.user.school_id, advanceId]
      );
      if (!advance.rows.length) throw fail(400, 'The selected shopping advance was not found.');
    }
    const productIds = [...new Set(normalizedItems.map((item) => item.productId))];
    const products = await client.query(
      'SELECT id FROM tuckshop_products WHERE school_id = $1 AND id = ANY($2::BIGINT[]) ORDER BY id FOR UPDATE',
      [req.user.school_id, productIds]
    );
    if (products.rows.length !== productIds.length) throw fail(400, 'One or more tuckshop products were not found.');
    const itemSubtotalCents = normalizedItems.reduce((sum, item) => sum + item.quantity * item.unitCostCents, 0);
    const totalCents = itemSubtotalCents + transportCents + otherCents;
    if (totalCents <= 0) throw fail(400, 'The purchase total must be greater than zero.');

    const created = await client.query(
      `INSERT INTO tuckshop_product_purchases (
         school_id, purchase_date, supplier, reference, supporting_reference, payment_method,
         transport_cost, other_cost, total_amount, advance_id, created_by, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, status, total_amount`,
      [
        req.user.school_id, purchaseDate, req.body.supplier?.trim() || null,
        req.body.reference?.trim() || null, req.body.supporting_reference?.trim() || null,
        paymentMethod, amountFromCents(transportCents), amountFromCents(otherCents),
        amountFromCents(totalCents), advanceId, req.user.id, idempotencyKey,
      ]
    );
    const purchaseId = created.rows[0].id;
    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO tuckshop_product_purchase_items
           (school_id, purchase_id, product_id, quantity, unit_cost, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          req.user.school_id, purchaseId, item.productId, item.quantity,
          amountFromCents(item.unitCostCents),
          amountFromCents(item.quantity * item.unitCostCents),
        ]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(created.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(res, error, next);
  } finally {
    client?.release();
  }
};

const getTuckshopProductPurchases = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.purchase_date, p.supplier, p.reference, p.supporting_reference,
              p.payment_method, p.transport_cost, p.other_cost, p.total_amount, p.status,
              p.advance_id, u.name AS purchased_by, a.name AS approved_by,
              COALESCE(json_agg(json_build_object(
                'product_id', i.product_id, 'product_name', product.name,
                'quantity', i.quantity, 'unit_cost', i.unit_cost, 'line_total', i.line_total
              )) FILTER (WHERE i.id IS NOT NULL), '[]'::JSON) AS items
       FROM tuckshop_product_purchases p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN users a ON a.id = p.approved_by
       LEFT JOIN tuckshop_product_purchase_items i ON i.purchase_id = p.id AND i.school_id = p.school_id
       LEFT JOIN tuckshop_products product ON product.id = i.product_id AND product.school_id = i.school_id
       WHERE p.school_id = $1
       GROUP BY p.id, u.name, a.name ORDER BY p.purchase_date DESC, p.id DESC LIMIT 500`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const approveTuckshopProductPurchase = async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const purchaseResult = await client.query(
      'SELECT * FROM tuckshop_product_purchases WHERE school_id = $1 AND id = $2 FOR UPDATE',
      [req.user.school_id, req.params.id]
    );
    if (!purchaseResult.rows.length) throw fail(404, 'Tuckshop purchase not found.');
    const purchase = purchaseResult.rows[0];
    if (purchase.status === 'approved') {
      await client.query('COMMIT');
      return res.json(purchase);
    }
    if (purchase.status !== 'pending') throw fail(409, 'Only pending tuckshop purchases can be approved.');
    const lockedProducts = await client.query(
      `SELECT id, stock_quantity, cost_price
       FROM tuckshop_products
       WHERE school_id = $1 AND id IN (
         SELECT product_id FROM tuckshop_product_purchase_items
         WHERE school_id = $1 AND purchase_id = $2
       )
       ORDER BY id FOR UPDATE`,
      [req.user.school_id, purchase.id]
    );
    const lines = await client.query(
      `SELECT product_id, SUM(quantity)::INTEGER AS quantity, SUM(line_total) AS line_total
       FROM tuckshop_product_purchase_items
       WHERE school_id = $1 AND purchase_id = $2
       GROUP BY product_id ORDER BY product_id`,
      [req.user.school_id, purchase.id]
    );
    if (!lines.rows.length) throw fail(409, 'The tuckshop purchase has no items.');
    const productsById = new Map(lockedProducts.rows.map((product) => [Number(product.id), product]));
    if (purchase.advance_id) {
      const advanceResult = await client.query(
        `SELECT a.amount_issued, a.returned_amount,
                COALESCE((
                  SELECT SUM(k.total_amount) FROM kitchen_purchases k
                  WHERE k.school_id = a.school_id AND k.advance_id = a.id AND k.status = 'approved'
                ), 0) + COALESCE((
                  SELECT SUM(t.total_amount) FROM tuckshop_product_purchases t
                  WHERE t.school_id = a.school_id AND t.advance_id = a.id AND t.status = 'approved'
                ), 0) AS spent
         FROM shopping_advances a
         WHERE a.school_id = $1 AND a.id = $2 FOR UPDATE`,
        [req.user.school_id, purchase.advance_id]
      );
      const advance = advanceResult.rows[0];
      if (!advance || Number(advance.spent) + Number(purchase.total_amount)
          > Number(advance.amount_issued) - Number(advance.returned_amount)) {
        throw fail(409, 'Approving this purchase would exceed the unreconciled shopping advance.');
      }
    }
    const merchandiseSubtotalCents = lines.rows.reduce((sum, line) => sum + moneyToCents(line.line_total), 0);
    const landedExtraCents = moneyToCents(purchase.transport_cost) + moneyToCents(purchase.other_cost);
    let extraAllocated = 0;
    for (let index = 0; index < lines.rows.length; index += 1) {
      const line = { ...lines.rows[index], ...productsById.get(Number(lines.rows[index].product_id)) };
      const baseCents = moneyToCents(line.line_total);
      const shareCents = index === lines.rows.length - 1
        ? landedExtraCents - extraAllocated
        : (merchandiseSubtotalCents > 0 ? Math.round(landedExtraCents * baseCents / merchandiseSubtotalCents) : 0);
      extraAllocated += shareCents;
      const lineCostCents = baseCents + shareCents;
      const oldQuantity = Number(line.stock_quantity);
      const newQuantity = oldQuantity + Number(line.quantity);
      const oldStockValueCents = oldQuantity * moneyToCents(line.cost_price || 0);
      const averageCostCents = Math.round((oldStockValueCents + lineCostCents) / newQuantity);
      await client.query(
        `UPDATE tuckshop_products
         SET stock_quantity = $3, cost_price = $4, updated_at = NOW()
         WHERE school_id = $1 AND id = $2`,
        [req.user.school_id, line.product_id, newQuantity, amountFromCents(averageCostCents)]
      );
    }
    const updated = await client.query(
      `UPDATE tuckshop_product_purchases SET status = 'approved', approved_by = $3, approved_at = NOW()
       WHERE school_id = $1 AND id = $2 RETURNING *`,
      [req.user.school_id, purchase.id, req.user.id]
    );
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(res, error, next);
  } finally {
    client?.release();
  }
};

const getTuckshopDailyReconciliation = async (req, res, next) => {
  const reconciliationDate = req.query.date || today();
  if (!parseDate(reconciliationDate)) return res.status(400).json({ message: 'Enter a valid reconciliation date.' });
  try {
    const result = await pool.query(
      `SELECT $2::DATE::TEXT AS reconciliation_date,
              COALESCE(s.transaction_count, 0)::INTEGER AS transaction_count,
              COALESCE(s.expected_cash, 0) AS expected_cash,
              COALESCE(s.expected_mobile_money, 0) AS expected_mobile_money,
              COALESCE(s.other_methods, 0) AS other_methods,
              COALESCE(s.total_sales, 0) AS total_sales,
              r.cash_counted, r.notes, u.name AS reconciled_by,
              CASE WHEN r.id IS NULL THEN NULL ELSE r.cash_counted - COALESCE(s.expected_cash, 0) END AS cash_variance,
              CASE WHEN r.id IS NULL THEN 'unreconciled' ELSE 'reconciled' END AS status
       FROM (SELECT $2::DATE AS reconciliation_date) requested
       LEFT JOIN (
         SELECT sale_date, COUNT(*)::INTEGER AS transaction_count,
                COALESCE(SUM(total_amount) FILTER (WHERE payment_method = 'cash'), 0) AS expected_cash,
                COALESCE(SUM(total_amount) FILTER (WHERE payment_method = 'mobile_money'), 0) AS expected_mobile_money,
                COALESCE(SUM(total_amount) FILTER (WHERE payment_method NOT IN ('cash', 'mobile_money')), 0) AS other_methods,
                COALESCE(SUM(total_amount), 0) AS total_sales
         FROM tuckshop_sales
         WHERE school_id = $1 AND sale_date = $2::DATE
         GROUP BY sale_date
       ) s ON s.sale_date = requested.reconciliation_date
       LEFT JOIN tuckshop_daily_reconciliations r
         ON r.school_id = $1 AND r.reconciliation_date = requested.reconciliation_date
       LEFT JOIN users u ON u.id = r.reconciled_by
       `,
      [req.user.school_id, reconciliationDate]
    );
    res.json(result.rows[0] || {
      reconciliation_date: reconciliationDate,
      transaction_count: 0,
      expected_cash: '0',
      expected_mobile_money: '0',
      other_methods: '0',
      total_sales: '0',
      cash_counted: null,
      cash_variance: null,
      status: 'unreconciled',
    });
  } catch (error) {
    next(error);
  }
};

const saveTuckshopDailyReconciliation = async (req, res, next) => {
  const reconciliationDate = req.body.reconciliation_date || today();
  const cashCountedCents = moneyToCents(req.body.cash_counted);
  if (!parseDate(reconciliationDate) || cashCountedCents === null) {
    return res.status(400).json({ message: 'Enter a valid date and non-negative cash count.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO tuckshop_daily_reconciliations
         (school_id, reconciliation_date, cash_counted, reconciled_by, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id, reconciliation_date) DO UPDATE
       SET cash_counted = EXCLUDED.cash_counted, reconciled_by = EXCLUDED.reconciled_by,
           notes = EXCLUDED.notes, updated_at = NOW()
       RETURNING id, reconciliation_date, cash_counted, notes`,
      [
        req.user.school_id, reconciliationDate, amountFromCents(cashCountedCents),
        req.user.id, req.body.notes?.trim() || null,
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getShoppingAdvances = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.amount_issued, a.recipient_name, a.issued_date, a.purpose,
              a.returned_amount, a.notes, a.idempotency_key, a.created_at,
              issued_by.name AS issued_by_name,
              COALESCE(k.spent, 0) + COALESCE(t.spent, 0) AS approved_expenses,
              GREATEST(0, a.amount_issued - a.returned_amount - COALESCE(k.spent, 0) - COALESCE(t.spent, 0)) AS unaccounted_amount,
              CASE
                WHEN COALESCE(k.pending, 0) + COALESCE(t.pending, 0) > 0 THEN 'awaiting_approval'
                WHEN a.returned_amount + COALESCE(k.spent, 0) + COALESCE(t.spent, 0) >= a.amount_issued THEN 'fully_reconciled'
                WHEN a.returned_amount + COALESCE(k.spent, 0) + COALESCE(t.spent, 0) > 0 THEN 'partially_reconciled'
                ELSE 'issued'
              END AS status
       FROM shopping_advances a
       LEFT JOIN users issued_by ON issued_by.id = a.issued_by
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved'), 0) AS spent,
                COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS pending
         FROM kitchen_purchases WHERE school_id = a.school_id AND advance_id = a.id
       ) k ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved'), 0) AS spent,
                COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS pending
         FROM tuckshop_product_purchases WHERE school_id = a.school_id AND advance_id = a.id
       ) t ON TRUE
       WHERE a.school_id = $1
       ORDER BY a.issued_date DESC, a.id DESC LIMIT 500`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createShoppingAdvance = async (req, res, next) => {
  const amountCents = moneyToCents(req.body.amount_issued);
  const issuedDate = req.body.issued_date || today();
  const idempotencyKey = String(req.body.idempotency_key || '').trim();
  const recipientName = String(req.body.recipient_name || '').trim();
  const purpose = String(req.body.purpose || '').trim();
  if (amountCents === null || amountCents <= 0 || !parseDate(issuedDate)
      || !idempotencyKey || !recipientName || !purpose) {
    return res.status(400).json({ message: 'Provide an amount, recipient, date, purpose and idempotency key.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO shopping_advances
         (school_id, amount_issued, recipient_name, recipient_user_id, issued_by, issued_date, purpose, idempotency_key, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (school_id, idempotency_key) DO NOTHING
       RETURNING id, amount_issued, recipient_name, issued_date, purpose, returned_amount, notes`,
      [
        req.user.school_id, amountFromCents(amountCents), recipientName,
        req.body.recipient_user_id || null, req.user.id, issuedDate, purpose, idempotencyKey,
        req.body.notes?.trim() || null,
      ]
    );
    if (!result.rows.length) {
      const duplicate = await pool.query(
        'SELECT id, amount_issued, recipient_name, issued_date, purpose, returned_amount, notes FROM shopping_advances WHERE school_id = $1 AND idempotency_key = $2',
        [req.user.school_id, idempotencyKey]
      );
      return res.status(200).json(duplicate.rows[0]);
    }
    res.status(201).json(result.rows[0]);
  } catch (error) {
    return errorResponse(res, error, next);
  }
};

const reconcileShoppingAdvance = async (req, res, next) => {
  const returnedCents = moneyToCents(req.body.returned_amount);
  if (returnedCents === null) return res.status(400).json({ message: 'Enter a valid non-negative amount returned.' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const advanceResult = await client.query(
      'SELECT * FROM shopping_advances WHERE school_id = $1 AND id = $2 FOR UPDATE',
      [req.user.school_id, req.params.id]
    );
    if (!advanceResult.rows.length) throw fail(404, 'Shopping advance not found.');
    const advance = advanceResult.rows[0];
    const spentResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS approved_amount
       FROM (
         SELECT total_amount AS amount FROM kitchen_purchases
         WHERE school_id = $1 AND advance_id = $2 AND status = 'approved'
         UNION ALL
         SELECT total_amount AS amount FROM tuckshop_product_purchases
         WHERE school_id = $1 AND advance_id = $2 AND status = 'approved'
       ) approved`,
      [req.user.school_id, req.params.id]
    );
    const approvedCents = moneyToCents(spentResult.rows[0].approved_amount);
    if (returnedCents + approvedCents > moneyToCents(advance.amount_issued)) {
      throw fail(409, 'The returned amount and approved purchases cannot exceed the advance issued.');
    }
    const updated = await client.query(
      `UPDATE shopping_advances SET returned_amount = $3, updated_at = NOW()
       WHERE school_id = $1 AND id = $2
       RETURNING id, amount_issued, returned_amount, recipient_name, issued_date, purpose`,
      [req.user.school_id, req.params.id, amountFromCents(returnedCents)]
    );
    await client.query('COMMIT');
    res.json({ ...updated.rows[0], approved_expenses: amountFromCents(approvedCents) });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(res, error, next);
  } finally {
    client?.release();
  }
};

const getKitchenStock = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, unit, quantity, minimum_quantity, updated_at
       FROM kitchen_stock_items WHERE school_id = $1 ORDER BY name`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const saveKitchenStock = async (req, res, next) => {
  const { name, unit, quantity, minimum_quantity } = req.body;
  const stockQuantity = Number(quantity);
  const minimum = Number(minimum_quantity || 0);
  if (!name?.trim() || !unit?.trim() || !Number.isFinite(stockQuantity) || stockQuantity < 0
      || !Number.isFinite(minimum) || minimum < 0) {
    return res.status(400).json({ message: 'Provide an item name, unit, and valid non-negative stock quantities.' });
  }
  try {
    const result = req.params.id
      ? await pool.query(
        `UPDATE kitchen_stock_items
         SET name = $3, unit = $4, quantity = $5, minimum_quantity = $6,
             updated_by = $7, updated_at = NOW()
         WHERE school_id = $1 AND id = $2
         RETURNING id, name, unit, quantity, minimum_quantity`,
        [req.user.school_id, req.params.id, name.trim(), unit.trim(), stockQuantity, minimum, req.user.id]
      )
      : await pool.query(
        `INSERT INTO kitchen_stock_items (school_id, name, unit, quantity, minimum_quantity, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, unit, quantity, minimum_quantity`,
        [req.user.school_id, name.trim(), unit.trim(), stockQuantity, minimum, req.user.id]
      );
    if (!result.rows.length) return res.status(404).json({ message: 'Kitchen stock item not found.' });
    res.status(req.params.id ? 200 : 201).json(result.rows[0]);
  } catch (error) {
    return errorResponse(res, error, next);
  }
};

const getKitchenPurchases = async (req, res, next) => {
  try {
    const permittedPurposes = ['admin', 'feeding_tuckshop_officer'].includes(req.user.role)
      ? ['feeding', 'kitchen']
      : (await pool.query(
        `SELECT permission FROM user_permissions
         WHERE school_id = $1 AND user_id = $2
           AND permission = ANY($3::TEXT[])`,
        [
          req.user.school_id, req.user.id,
          ['feeding.purchases.read', 'feeding.purchases.create', 'feeding.purchases.approve',
            'tuckshop.purchases.read', 'tuckshop.purchases.create', 'tuckshop.purchases.approve'],
        ]
      )).rows.map((row) => row.permission.startsWith('feeding.') ? 'feeding' : 'kitchen');
    const uniquePurposes = [...new Set(permittedPurposes)];
    const result = await pool.query(
      `SELECT p.id, p.purchase_date, p.purpose, p.expense_category, p.total_amount,
              p.supplier, p.reference, p.notes, p.status, p.created_at,
              p.payment_method, p.buyer_name, p.supporting_reference, p.description,
              p.advance_id, p.transport_cost, p.cutting_cost, p.porter_cost,
              p.grinding_cost, p.other_cost,
              u.name AS created_by_name, a.name AS approved_by_name,
              COALESCE(json_agg(json_build_object(
                'stock_item_id', i.stock_item_id, 'name', COALESCE(i.item_name, stock.name),
                'unit', i.unit, 'quantity', i.quantity, 'unit_cost', i.unit_cost,
                'tax_inclusive_unit_cost', i.tax_inclusive_unit_cost, 'line_total', i.line_total
              )) FILTER (WHERE i.id IS NOT NULL), '[]'::JSON) AS items
       FROM kitchen_purchases p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN users a ON a.id = p.approved_by
       LEFT JOIN kitchen_purchase_items i ON i.purchase_id = p.id AND i.school_id = p.school_id
       LEFT JOIN kitchen_stock_items stock ON stock.id = i.stock_item_id AND stock.school_id = i.school_id
       WHERE p.school_id = $1 AND p.purpose = ANY($2::TEXT[])
       GROUP BY p.id, u.name, a.name
       ORDER BY p.purchase_date DESC, p.id DESC LIMIT 500`,
      [req.user.school_id, uniquePurposes]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createKitchenPurchase = async (req, res, next) => {
  const { items, idempotency_key: idempotencyKey, purpose, purchase_date: purchaseDate } = req.body;
  const paymentMethod = req.body.payment_method || 'cash';
  const advanceId = req.body.advance_id ? Number(req.body.advance_id) : null;
  const allowedCategories = [
    'Feeding Supplies', 'Kitchen Supplies', 'Food Supplies', 'Gas',
    'Repairs', 'Transport', 'Market Charges', 'Other Feeding Expenses',
    'Other Kitchen Expenses',
  ];
  const expenseCategory = req.body.expense_category
    || (purpose === 'feeding' ? 'Feeding Supplies' : 'Kitchen Supplies');
  if (!['feeding', 'kitchen'].includes(purpose) || !parseDate(purchaseDate || today())
      || !Array.isArray(items) || !items.length || items.length > 100 || !idempotencyKey
      || items.some((item) => !item || typeof item !== 'object')
      || !['cash', 'mobile_money', 'bank_transfer', 'other'].includes(paymentMethod)
      || !allowedCategories.includes(expenseCategory)
      || (advanceId !== null && (!Number.isInteger(advanceId) || advanceId <= 0))) {
    return res.status(400).json({ message: 'Provide a valid purchase purpose, date, category, payment method, items and idempotency key.' });
  }
  const normalizedItems = items.map((item) => ({
    stockItemId: item.stock_item_id ? Number(item.stock_item_id) : null,
    itemName: String(item.item_name || '').trim(),
    unit: item.unit ? String(item.unit).trim() : null,
    quantity: Number(item.quantity),
    unitCostCents: moneyToCents(item.unit_cost),
    taxInclusiveUnitCostCents: item.tax_inclusive_unit_cost === undefined
      || item.tax_inclusive_unit_cost === null || item.tax_inclusive_unit_cost === ''
      ? null
      : moneyToCents(item.tax_inclusive_unit_cost),
    taxInclusiveProvided: item.tax_inclusive_unit_cost !== undefined
      && item.tax_inclusive_unit_cost !== null && item.tax_inclusive_unit_cost !== '',
  }));
  normalizedItems.forEach((item) => {
    item.purchaseUnitCostCents = item.taxInclusiveUnitCostCents ?? item.unitCostCents;
  });
  if (normalizedItems.some((item) => (item.stockItemId !== null
        && (!Number.isInteger(item.stockItemId) || item.stockItemId <= 0))
      || (!item.stockItemId && (!item.itemName || !item.unit))
      || !Number.isFinite(item.quantity) || item.quantity <= 0
      || item.unitCostCents === null
      || (item.taxInclusiveProvided && item.taxInclusiveUnitCostCents === null))) {
    return res.status(400).json({ message: 'Each purchase line needs an item, unit, positive quantity and non-negative price.' });
  }
  const charges = req.body.additional_costs === undefined ? [] : req.body.additional_costs;
  const allowedChargeTypes = ['transport', 'cutting', 'porter', 'grinding', 'loading', 'unloading', 'other'];
  if (!Array.isArray(charges) || charges.length > 30 || charges.some((charge) => (
    !charge || typeof charge !== 'object'
    || !allowedChargeTypes.includes(charge.charge_type)
    || moneyToCents(charge.amount) === null
    || !String(charge.description || charge.charge_type).trim()
  ))) {
    return res.status(400).json({ message: 'Check the additional purchase charges and their amounts.' });
  }
  const chargeRows = charges.map((charge) => ({
    type: charge.charge_type,
    description: String(charge.description || '').trim() || null,
    cents: moneyToCents(charge.amount),
  }));
  const chargeTotals = { transport: 0, cutting: 0, porter: 0, grinding: 0, other: 0 };
  for (const charge of chargeRows) {
    chargeTotals[charge.type === 'loading' || charge.type === 'unloading' ? 'other' : charge.type] += charge.cents;
  }
  const lineSubtotalCents = normalizedItems.reduce((sum, item) => sum + Math.round(item.quantity * item.purchaseUnitCostCents), 0);
  const totalChargeCents = chargeRows.reduce((sum, charge) => sum + charge.cents, 0);
  const totalCents = lineSubtotalCents + totalChargeCents;
  if (totalCents <= 0) return res.status(400).json({ message: 'Purchase total must be greater than zero.' });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [String(req.user.school_id), idempotencyKey]
    );
    const duplicate = await client.query(
      'SELECT id, status, total_amount FROM kitchen_purchases WHERE school_id = $1 AND idempotency_key = $2',
      [req.user.school_id, idempotencyKey]
    );
    if (duplicate.rows.length) {
      await client.query('COMMIT');
      return res.status(200).json(duplicate.rows[0]);
    }
    if (advanceId) {
      const advance = await client.query(
        'SELECT id FROM shopping_advances WHERE school_id = $1 AND id = $2 FOR UPDATE',
        [req.user.school_id, advanceId]
      );
      if (!advance.rows.length) throw fail(400, 'The selected shopping advance was not found.');
    }
    const ids = [...new Set(normalizedItems.map((item) => item.stockItemId).filter(Boolean))];
    const stockItems = await client.query(
      'SELECT id, name, unit FROM kitchen_stock_items WHERE school_id = $1 AND id = ANY($2::BIGINT[]) ORDER BY id FOR UPDATE',
      [req.user.school_id, ids]
    );
    if (stockItems.rows.length !== ids.length) throw fail(400, 'One or more kitchen stock items are unavailable.');
    const stockById = new Map(stockItems.rows.map((item) => [Number(item.id), item]));
    const purchaseResult = await client.query(
      `INSERT INTO kitchen_purchases (
         school_id, purchase_date, purpose, expense_category, total_amount,
         supplier, reference, notes, created_by, idempotency_key,
         payment_method, buyer_name, supporting_reference, description, advance_id,
         transport_cost, cutting_cost, porter_cost, grinding_cost, other_cost
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id, status, total_amount`,
      [
        req.user.school_id, purchaseDate || today(), purpose,
        expenseCategory,
        amountFromCents(totalCents), req.body.supplier?.trim() || null,
        req.body.reference?.trim() || null, req.body.notes?.trim() || null,
        req.user.id, idempotencyKey,
        paymentMethod, req.body.buyer_name?.trim() || null,
        req.body.supporting_reference?.trim() || null, req.body.description?.trim() || null,
        advanceId, amountFromCents(chargeTotals.transport), amountFromCents(chargeTotals.cutting),
        amountFromCents(chargeTotals.porter), amountFromCents(chargeTotals.grinding),
        amountFromCents(chargeTotals.other),
      ]
    );
    const purchaseId = purchaseResult.rows[0].id;
    for (const item of normalizedItems) {
      const lineCents = Math.round(item.quantity * item.purchaseUnitCostCents);
      const stockItem = item.stockItemId ? stockById.get(item.stockItemId) : null;
      await client.query(
        `INSERT INTO kitchen_purchase_items
           (school_id, purchase_id, stock_item_id, quantity, unit_cost, line_total,
            item_name, unit, tax_inclusive_unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          req.user.school_id, purchaseId, item.stockItemId, item.quantity,
          amountFromCents(item.unitCostCents), amountFromCents(lineCents),
          item.itemName || stockItem?.name, item.unit || stockItem?.unit || 'unit',
          item.taxInclusiveUnitCostCents === null ? null : amountFromCents(item.taxInclusiveUnitCostCents),
        ]
      );
    }
    for (const charge of chargeRows) {
      await client.query(
        `INSERT INTO kitchen_purchase_charges (school_id, purchase_id, charge_type, description, amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.school_id, purchaseId, charge.type, charge.description, amountFromCents(charge.cents)]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(purchaseResult.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(res, error, next);
  } finally {
    client?.release();
  }
};

const approveKitchenPurchase = async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const purchase = await client.query(
      `SELECT * FROM kitchen_purchases WHERE school_id = $1 AND id = $2 FOR UPDATE`,
      [req.user.school_id, req.params.id]
    );
    if (!purchase.rows.length) throw fail(404, 'Kitchen purchase not found.');
    const row = purchase.rows[0];
    if (row.purpose !== req.expectedPurchasePurpose) throw fail(403, 'You do not have permission to approve this purchase type.');
    if (row.status === 'approved') {
      await client.query('COMMIT');
      return res.json(row);
    }
    if (row.status !== 'pending') throw fail(409, 'Only pending purchases can be approved.');
    const items = await client.query(
      `SELECT stock_item_id, quantity
       FROM kitchen_purchase_items WHERE school_id = $1 AND purchase_id = $2`,
      [req.user.school_id, row.id]
    );
    if (!items.rows.length) throw fail(409, 'Purchase has no recorded items.');
    if (row.advance_id) {
      const advanceResult = await client.query(
        `SELECT a.amount_issued, a.returned_amount,
                COALESCE((
                  SELECT SUM(k.total_amount) FROM kitchen_purchases k
                  WHERE k.school_id = a.school_id AND k.advance_id = a.id AND k.status = 'approved'
                ), 0) + COALESCE((
                  SELECT SUM(t.total_amount) FROM tuckshop_product_purchases t
                  WHERE t.school_id = a.school_id AND t.advance_id = a.id AND t.status = 'approved'
                ), 0) AS spent
         FROM shopping_advances a
         WHERE a.school_id = $1 AND a.id = $2 FOR UPDATE`,
        [req.user.school_id, row.advance_id]
      );
      const advance = advanceResult.rows[0];
      if (!advance || Number(advance.spent) + Number(row.total_amount)
          > Number(advance.amount_issued) - Number(advance.returned_amount)) {
        throw fail(409, 'Approving this purchase would exceed the unreconciled shopping advance.');
      }
    }
    for (const item of items.rows) {
      if (!item.stock_item_id) continue;
      await client.query(
        `UPDATE kitchen_stock_items SET quantity = quantity + $3, updated_by = $4, updated_at = NOW()
         WHERE school_id = $1 AND id = $2`,
        [req.user.school_id, item.stock_item_id, item.quantity, req.user.id]
      );
    }
    const finance = await client.query(
      `INSERT INTO transactions (school_id, type, category, amount, reference, description, date, source_type, source_id)
       VALUES ($1, 'expenditure', $2, $3, $4, $5, $6, 'kitchen_purchase', $7)
       ON CONFLICT (school_id, source_type, source_id) DO NOTHING`,
      [
        req.user.school_id, row.expense_category, row.total_amount,
        row.reference || `PUR-${row.id}`, `${row.purpose === 'feeding' ? 'Feeding' : 'Kitchen'} purchase`,
        row.purchase_date, row.id,
      ]
    );
    if (finance.rowCount !== 1) throw fail(409, 'A finance transaction already exists for this purchase.');
    const updated = await client.query(
      `UPDATE kitchen_purchases SET status = 'approved', approved_by = $3, approved_at = NOW()
       WHERE school_id = $1 AND id = $2 RETURNING *`,
      [req.user.school_id, row.id, req.user.id]
    );
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(res, error, next);
  } finally {
    client?.release();
  }
};

module.exports = {
  approveKitchenPurchase,
  approveTuckshopProductPurchase,
  createCalendarEvent,
  createKitchenPurchase,
  createShoppingAdvance,
  createTuckshopProductPurchase,
  createTuckshopSale,
  deleteCalendarEvent,
  getFeedingClasses,
  getFeedingPayments,
  getFeedingReceipt,
  getFeedingRegister,
  getFeedingReport,
  getShoppingAdvances,
  getCalendarEvents,
  getKitchenPurchases,
  getKitchenStock,
  getTuckshopProducts,
  getTuckshopProductPurchases,
  getTuckshopSales,
  getTuckshopDailyReconciliation,
  recordFeedingPayment,
  reconcileShoppingAdvance,
  saveTuckshopDailyReconciliation,
  saveKitchenStock,
  saveTuckshopProduct,
  searchFeedingStudents,
  setFeedingRate,
  updateFeedingRegister,
};
