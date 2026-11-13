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
  if (!Number.isInteger(studentId) || studentId <= 0 || !idempotencyKey
      || amountCents === null || amountCents <= 0 || !parseDate(paymentDate)) {
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
         receipt_number, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        req.user.school_id, studentId, amountFromCents(amountCents), amountFromCents(dailyRateCents),
        amountFromCents(coverage.creditAppliedCents), coverage.daysCovered,
        amountFromCents(coverage.creditAddedCents), coverageDates[0] || null,
        coverageDates[coverageDates.length - 1] || null, paymentDate, req.user.id, receipt, idempotencyKey,
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
            p.receipt_number, p.created_at, u.name AS received_by_name
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
              p.receipt_number, p.created_at, u.name AS received_by_name
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
    const granted = req.user.role === 'admin'
      ? new Set(['feeding.reports.read', 'tuckshop.reports.read'])
      : new Set((await pool.query(
        `SELECT permission FROM user_permissions
         WHERE school_id = $1 AND user_id = $2
           AND permission IN ('feeding.reports.read', 'tuckshop.reports.read')`,
        [req.user.school_id, req.user.id]
      )).rows.map((row) => row.permission));
    const [payments, sales, purchases] = await Promise.all([
      granted.has('feeding.reports.read')
        ? pool.query(
          `SELECT COUNT(*)::INTEGER AS count, COALESCE(SUM(amount_received), 0) AS total
           FROM feeding_payments WHERE school_id = $1 AND payment_date BETWEEN $2 AND $3`,
          [req.user.school_id, startDate, endDate]
        )
        : Promise.resolve(null),
      granted.has('tuckshop.reports.read')
        ? pool.query(
          `SELECT COUNT(*)::INTEGER AS count, COALESCE(SUM(total_amount), 0) AS total
           FROM tuckshop_sales WHERE school_id = $1 AND sale_date BETWEEN $2 AND $3`,
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
    ]);
    res.json({
      feeding: payments ? { count: payments.rows[0].count, total: payments.rows[0].total } : null,
      tuckshop: sales ? { count: sales.rows[0].count, total: sales.rows[0].total } : null,
      approvedPurchases: purchases ? purchases.rows : null,
    });
  } catch (error) {
    next(error);
  }
};

const getTuckshopProducts = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, sku, unit_price, stock_quantity, is_active, updated_at
       FROM tuckshop_products WHERE school_id = $1 ORDER BY name`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const saveTuckshopProduct = async (req, res, next) => {
  const { name, sku, unit_price, stock_quantity, is_active } = req.body;
  const priceCents = moneyToCents(unit_price);
  const stock = Number(stock_quantity);
  if (!name?.trim() || priceCents === null || !Number.isInteger(stock) || stock < 0
      || (is_active !== undefined && typeof is_active !== 'boolean')) {
    return res.status(400).json({ message: 'Provide a product name, valid non-negative price and stock quantity.' });
  }
  try {
    const values = [req.user.school_id, name.trim(), sku?.trim() || null, amountFromCents(priceCents), stock, is_active !== false];
    const result = req.params.id
      ? await pool.query(
        `UPDATE tuckshop_products
         SET name = $2, sku = $3, unit_price = $4, stock_quantity = $5,
             is_active = $6, updated_at = NOW()
         WHERE school_id = $1 AND id = $7
         RETURNING id, name, sku, unit_price, stock_quantity, is_active`,
        [...values, req.params.id]
      )
      : await pool.query(
        `INSERT INTO tuckshop_products (school_id, name, sku, unit_price, stock_quantity, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, sku, unit_price, stock_quantity, is_active`,
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
      || !['cash', 'mobile_money', 'card', 'other'].includes(paymentMethod)) {
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
      `SELECT id, name, unit_price, stock_quantity
       FROM tuckshop_products
       WHERE school_id = $1 AND id = ANY($2::BIGINT[]) AND is_active = TRUE
       FOR UPDATE`,
      [req.user.school_id, ids]
    );
    if (productsResult.rows.length !== ids.length) throw fail(400, 'One or more sale products are unavailable.');
    const products = new Map(productsResult.rows.map((product) => [Number(product.id), product]));
    let totalCents = 0;
    const saleLines = [];
    for (const [productId, quantity] of normalizedItems) {
      const product = products.get(productId);
      if (Number(product.stock_quantity) < quantity) throw fail(409, `Not enough stock for ${product.name}.`);
      const unitCents = moneyToCents(product.unit_price);
      const lineCents = unitCents * quantity;
      totalCents += lineCents;
      saleLines.push({ product, quantity, unitCents, lineCents });
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
           (school_id, sale_id, product_id, product_name, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.school_id, saleId, line.product.id, line.product.name, line.quantity,
          amountFromCents(line.unitCents), amountFromCents(line.lineCents),
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
              'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total
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
                'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total
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
    const permittedPurposes = req.user.role === 'admin'
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
              u.name AS created_by_name, a.name AS approved_by_name,
              COALESCE(json_agg(json_build_object(
                'stock_item_id', i.stock_item_id, 'name', stock.name,
                'quantity', i.quantity, 'unit_cost', i.unit_cost, 'line_total', i.line_total
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
  if (!['feeding', 'kitchen'].includes(purpose) || !parseDate(purchaseDate || today())
      || !Array.isArray(items) || !items.length || items.length > 100 || !idempotencyKey) {
    return res.status(400).json({ message: 'Provide a valid purchase purpose, date, items, and idempotency key.' });
  }
  const normalizedItems = items.map((item) => ({
    stockItemId: Number(item.stock_item_id),
    quantity: Number(item.quantity),
    unitCostCents: moneyToCents(item.unit_cost),
  }));
  if (normalizedItems.some((item) => !Number.isInteger(item.stockItemId) || item.stockItemId <= 0
      || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.unitCostCents === null)) {
    return res.status(400).json({ message: 'Each purchase line needs a valid stock item, positive quantity, and non-negative unit cost.' });
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
      'SELECT id, status, total_amount FROM kitchen_purchases WHERE school_id = $1 AND idempotency_key = $2',
      [req.user.school_id, idempotencyKey]
    );
    if (duplicate.rows.length) {
      await client.query('COMMIT');
      return res.status(200).json(duplicate.rows[0]);
    }
    const ids = [...new Set(normalizedItems.map((item) => item.stockItemId))];
    const stockItems = await client.query(
      'SELECT id FROM kitchen_stock_items WHERE school_id = $1 AND id = ANY($2::BIGINT[]) FOR UPDATE',
      [req.user.school_id, ids]
    );
    if (stockItems.rows.length !== ids.length) throw fail(400, 'One or more kitchen stock items are unavailable.');
    const totalCents = normalizedItems.reduce((sum, item) => sum + Math.round(item.quantity * item.unitCostCents), 0);
    if (totalCents <= 0) throw fail(400, 'Purchase total must be greater than zero.');
    const purchaseResult = await client.query(
      `INSERT INTO kitchen_purchases (
         school_id, purchase_date, purpose, expense_category, total_amount,
         supplier, reference, notes, created_by, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, status, total_amount`,
      [
        req.user.school_id, purchaseDate || today(), purpose,
        purpose === 'feeding' ? 'Feeding Supplies' : 'Kitchen Supplies',
        amountFromCents(totalCents), req.body.supplier?.trim() || null,
        req.body.reference?.trim() || null, req.body.notes?.trim() || null,
        req.user.id, idempotencyKey,
      ]
    );
    const purchaseId = purchaseResult.rows[0].id;
    for (const item of normalizedItems) {
      const lineCents = Math.round(item.quantity * item.unitCostCents);
      await client.query(
        `INSERT INTO kitchen_purchase_items
           (school_id, purchase_id, stock_item_id, quantity, unit_cost, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          req.user.school_id, purchaseId, item.stockItemId, item.quantity,
          amountFromCents(item.unitCostCents), amountFromCents(lineCents),
        ]
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
    if (!items.rows.length) throw fail(409, 'Purchase has no stock items.');
    for (const item of items.rows) {
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
  createCalendarEvent,
  createKitchenPurchase,
  createTuckshopSale,
  deleteCalendarEvent,
  getFeedingClasses,
  getFeedingPayments,
  getFeedingReceipt,
  getFeedingRegister,
  getFeedingReport,
  getCalendarEvents,
  getKitchenPurchases,
  getKitchenStock,
  getTuckshopProducts,
  getTuckshopSales,
  recordFeedingPayment,
  saveKitchenStock,
  saveTuckshopProduct,
  searchFeedingStudents,
  setFeedingRate,
  updateFeedingRegister,
};
