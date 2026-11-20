const ExcelJS = require('exceljs');
const pool = require('../config/db');
const {
  estimateKitchenCosts,
  estimateKitchenCostForRange,
  estimateKitchenQuantityForRange,
  summarizeFinancialEntries,
  toUtcDate,
} = require('../services/operationsService');

const MODULES = new Set(['tuckshop', 'feeding_marketing']);
const FREQUENCIES = new Set(['daily', 'weekly', 'fortnightly', 'monthly', 'custom']);
const FINANCE_AUDIT_TABLES = [
  'operational_financial_entries', 'feeding_coverage_days', 'feeding_payment_ledger',
  'feeding_student_accounts', 'feeding_frequency_history',
  'feeding_terms', 'feeding_calendar_exceptions', 'feeding_class_rates', 'feeding_obligations',
];
const INVENTORY_AUDIT_TABLES = [
  'kitchen_item_plans', 'inventory_purchases', 'inventory_purchase_items',
  'inventory_purchase_receipts', 'inventory_purchase_receipt_items',
];
const text = (value, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const positiveInt = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const optionalPositiveNumber = (value) => value === '' || value === null || value === undefined
  ? null
  : Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : NaN;
const money = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const error = (status, message) => Object.assign(new Error(message), { status });
const fail = (res, next, caught) => caught.status
  ? res.status(caught.status).json({ message: caught.message })
  : next(caught);

function auditPayload(tableName, value) {
  if (!value || typeof value !== 'object') return value;
  const allowedFields = tableName === 'school_payment_receipts'
    ? ['receipt_number', 'payment_date', 'payment_method', 'reference', 'feeding_amount', 'feeding_academic_year', 'feeding_term', 'received_by']
    : tableName === 'school_payment_refunds'
      ? ['component', 'amount', 'reason', 'reference', 'refund_date', 'refunded_by', 'receipt_id']
      : null;
  if (!allowedFields) return value;
  return Object.fromEntries(allowedFields.filter((field) => field in value).map((field) => [field, value[field]]));
}

function parsePeriod(query) {
  let startDate = query.from || '';
  let endDate = query.to || '';
  if (query.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)) throw error(400, 'Month must use YYYY-MM format.');
    const [year, month] = query.month.split('-').map(Number);
    startDate = `${query.month}-01`;
    endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  } else if (!startDate && !endDate) {
    const today = new Date();
    startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
    endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  }
  if (!startDate || !endDate || !toUtcDate(startDate) || !toUtcDate(endDate) || startDate > endDate) {
    throw error(400, 'Choose a valid start and end date.');
  }
  return { startDate, endDate };
}

function mondayFor(value) {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

async function fetchKitchenItems(schoolId, query) {
  const period = parsePeriod(query);
  const monthStart = `${period.endDate.slice(0, 7)}-01`;
  const monthEnd = new Date(Date.UTC(Number(period.endDate.slice(0, 4)), Number(period.endDate.slice(5, 7)), 0))
    .toISOString().slice(0, 10);
  const result = await pool.query(
    `SELECT k.*,
            s.name AS supplier_name,
            i.item_name AS inventory_item_name,
            COALESCE(p.pending_quantity, 0)::numeric AS pending_approval_quantity,
            COALESCE(p.pending_cost, 0)::numeric AS pending_approval_cost,
            COALESCE(p.approved_quantity, 0)::numeric AS approved_purchase_quantity,
            COALESCE(p.outstanding_quantity, 0)::numeric AS approved_outstanding_quantity,
            COALESCE(a.actual_quantity, 0)::numeric AS actual_quantity,
            COALESCE(a.actual_cost, 0)::numeric(14,2) AS actual_cost,
            COALESCE(a.weekly_cost, 0)::numeric(14,2) AS actual_weekly_cost,
            COALESCE(a.monthly_cost, 0)::numeric(14,2) AS actual_monthly_cost
     FROM kitchen_item_plans k
     LEFT JOIN inventory_suppliers s ON s.id=k.supplier_id AND s.school_id=k.school_id
     LEFT JOIN inventory i ON i.id=k.inventory_id AND i.school_id=k.school_id
     LEFT JOIN LATERAL (
       SELECT
         SUM(pi.quantity_ordered) FILTER (WHERE p.status='pending_approval') AS pending_quantity,
         SUM(pi.quantity_ordered * pi.unit_price) FILTER (WHERE p.status='pending_approval') AS pending_cost,
         SUM(pi.quantity_ordered) FILTER (WHERE p.status IN ('approved','ordered','partially_received','received')) AS approved_quantity,
         SUM(pi.quantity_ordered - pi.quantity_received) FILTER (WHERE p.status IN ('approved','ordered','partially_received')) AS outstanding_quantity
       FROM inventory_purchase_items pi
       JOIN inventory_purchases p ON p.id=pi.purchase_id AND p.school_id=pi.school_id
       WHERE pi.school_id=k.school_id AND pi.kitchen_item_plan_id=k.id
     ) p ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         SUM(ri.quantity_received) FILTER (WHERE pr.received_at::date BETWEEN $2::date AND $3::date) AS actual_quantity,
         SUM(ri.quantity_received * ri.unit_price) FILTER (WHERE pr.received_at::date BETWEEN $2::date AND $3::date) AS actual_cost,
         SUM(ri.quantity_received * ri.unit_price) FILTER (WHERE pr.received_at::date BETWEEN $4::date AND $3::date) AS weekly_cost,
         SUM(ri.quantity_received * ri.unit_price) FILTER (WHERE pr.received_at::date BETWEEN $5::date AND $6::date) AS monthly_cost
       FROM inventory_purchase_items pi
       JOIN inventory_purchases p ON p.id=pi.purchase_id AND p.school_id=pi.school_id
       JOIN inventory_purchase_receipt_items ri ON ri.purchase_item_id=pi.id AND ri.school_id=pi.school_id
       JOIN inventory_purchase_receipts pr ON pr.id=ri.receipt_id AND pr.school_id=ri.school_id
       WHERE pi.school_id=k.school_id AND pi.kitchen_item_plan_id=k.id
     ) a ON TRUE
     WHERE k.school_id=$1
       AND ($7::boolean OR k.is_active)
       AND ($8::text IS NULL OR k.category=$8)
       AND ($9::text IS NULL OR k.purchasing_frequency=$9)
       AND ($10::text IS NULL OR k.item_name ILIKE '%' || $10 || '%' OR k.notes ILIKE '%' || $10 || '%')
     ORDER BY k.is_active DESC, k.category, k.item_name`,
    [schoolId, period.startDate, period.endDate, mondayFor(period.endDate), monthStart, monthEnd,
      query.include_inactive === 'true', query.category || null, query.frequency || null, text(query.search, 100) || null]
  );

  return result.rows.map((row) => {
    const estimates = estimateKitchenCosts(row, new Date(`${period.endDate}T00:00:00Z`));
    const actualQuantity = Number(row.actual_quantity || 0);
    const actualCost = Number(row.actual_cost || 0);
    const estimatedCost = estimateKitchenCostForRange(row, period.startDate, period.endDate);
    const estimatedQuantity = estimateKitchenQuantityForRange(row, period.startDate, period.endDate);
    const variance = actualCost - estimatedCost;
    const quantityVariance = actualQuantity - estimatedQuantity;
    const actualUnitCost = actualQuantity ? Number((actualCost / actualQuantity).toFixed(2)) : 0;
    const unitCostVariance = actualUnitCost - Number(row.estimated_unit_cost || 0);
    const actualWeeklyCost = Number(row.actual_weekly_cost || 0);
    const actualMonthlyCost = Number(row.actual_monthly_cost || 0);
    const weeklyVariance = actualWeeklyCost - estimates.estimated_weekly_cost;
    const monthlyVariance = actualMonthlyCost - estimates.estimated_monthly_cost;
    return {
      ...row,
      ...estimates,
      estimated_period_quantity: estimatedQuantity,
      estimated_period_cost: estimatedCost,
      quantity_variance: Number(quantityVariance.toFixed(3)),
      quantity_variance_percent: estimatedQuantity
        ? Number((quantityVariance / estimatedQuantity * 100).toFixed(2)) : null,
      unit_cost_variance: Number(unitCostVariance.toFixed(2)),
      unit_cost_variance_percent: Number(row.estimated_unit_cost)
        ? Number((unitCostVariance / Number(row.estimated_unit_cost) * 100).toFixed(2)) : null,
      weekly_variance: Number(weeklyVariance.toFixed(2)),
      weekly_variance_percent: estimates.estimated_weekly_cost
        ? Number((weeklyVariance / estimates.estimated_weekly_cost * 100).toFixed(2)) : null,
      monthly_variance: Number(monthlyVariance.toFixed(2)),
      monthly_variance_percent: estimates.estimated_monthly_cost
        ? Number((monthlyVariance / estimates.estimated_monthly_cost * 100).toFixed(2)) : null,
      actual_unit_cost: actualUnitCost,
      actual_variance: Number(variance.toFixed(2)),
      actual_variance_percent: estimatedCost ? Number((variance / estimatedCost * 100).toFixed(2)) : null,
      period_start: period.startDate,
      period_end: period.endDate,
    };
  });
}

const listKitchenItems = async (req, res, next) => {
  try {
    res.json(await fetchKitchenItems(req.user.school_id, req.query));
  } catch (caught) {
    fail(res, next, caught);
  }
};

const saveKitchenItem = async (req, res, next) => {
  const { school_id: schoolId, id: actorId } = req.user;
  const itemName = text(req.body.item_name, 160);
  const category = text(req.body.category, 100);
  const unit = text(req.body.unit, 40);
  const frequency = req.body.purchasing_frequency;
  const quantity = optionalPositiveNumber(req.body.estimated_quantity);
  const monthlyQuantity = optionalPositiveNumber(req.body.expected_monthly_quantity);
  const unitCost = money(req.body.estimated_unit_cost);
  const customDays = frequency === 'custom' ? positiveInt(req.body.custom_interval_days) : null;
  const inventoryId = req.body.inventory_id ? positiveInt(req.body.inventory_id) : null;
  const supplierId = req.body.supplier_id ? positiveInt(req.body.supplier_id) : null;

  if (!itemName || !category || !unit || !FREQUENCIES.has(frequency)
      || !Number.isFinite(quantity) || quantity <= 0
      || (monthlyQuantity !== null && (!Number.isFinite(monthlyQuantity) || monthlyQuantity <= 0))
      || unitCost === null || (frequency === 'custom' && (!customDays || customDays > 365))
      || (req.body.inventory_id && !inventoryId) || (req.body.supplier_id && !supplierId)) {
    return res.status(400).json({ message: 'Enter an item, category, positive quantity, unit, frequency, valid cost, and custom days when needed.' });
  }

  try {
    if (inventoryId) {
      const item = await pool.query('SELECT id FROM inventory WHERE id=$1 AND school_id=$2 AND item_status=\'active\'', [inventoryId, schoolId]);
      if (!item.rowCount) throw error(400, 'Choose an active inventory item from this school.');
    }
    if (supplierId) {
      const supplier = await pool.query('SELECT id FROM inventory_suppliers WHERE id=$1 AND school_id=$2 AND is_active=TRUE', [supplierId, schoolId]);
      if (!supplier.rowCount) throw error(400, 'Choose an active supplier from this school.');
    }

    const id = positiveInt(req.params.id);
    if (req.params.id && !id) throw error(400, 'Choose a valid kitchen item.');
    const values = [inventoryId, supplierId, itemName, category, quantity, monthlyQuantity, unit,
      frequency, customDays, unitCost, text(req.body.notes, 1000) || null];
    const result = id
      ? await pool.query(
        `UPDATE kitchen_item_plans
         SET inventory_id=$1, supplier_id=$2, item_name=$3, category=$4, estimated_quantity=$5,
             expected_monthly_quantity=$6, unit=$7, purchasing_frequency=$8, custom_interval_days=$9,
             estimated_unit_cost=$10, notes=$11, updated_by=$12, updated_at=NOW()
         WHERE id=$13 AND school_id=$14 RETURNING *`,
        [...values, actorId, id, schoolId]
      )
      : await pool.query(
        `INSERT INTO kitchen_item_plans
           (school_id, inventory_id, supplier_id, item_name, category, estimated_quantity,
            expected_monthly_quantity, unit, purchasing_frequency, custom_interval_days,
            estimated_unit_cost, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
        [schoolId, ...values, actorId]
      );
    if (id && !result.rowCount) throw error(404, 'Kitchen item not found.');
    res.status(id ? 200 : 201).json(result.rows[0]);
  } catch (caught) {
    fail(res, next, caught);
  }
};

const setKitchenItemActive = async (req, res, next) => {
  const id = positiveInt(req.params.id);
  if (!id || typeof req.body.is_active !== 'boolean') return res.status(400).json({ message: 'Choose a kitchen item and active status.' });
  try {
    const result = await pool.query(
      `UPDATE kitchen_item_plans SET is_active=$1, updated_by=$2, updated_at=NOW()
       WHERE id=$3 AND school_id=$4 RETURNING *`,
      [req.body.is_active, req.user.id, id, req.user.school_id]
    );
    if (!result.rowCount) throw error(404, 'Kitchen item not found.');
    res.json(result.rows[0]);
  } catch (caught) {
    fail(res, next, caught);
  }
};

const exportKitchenItems = async (req, res, next) => {
  try {
    const items = await fetchKitchenItems(req.user.school_id, { ...req.query, include_inactive: 'true' });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Kitchen Register');
    sheet.columns = [
      { header: 'Item', key: 'item_name', width: 24 }, { header: 'Category', key: 'category', width: 18 },
      { header: 'Unit', key: 'unit', width: 14 }, { header: 'Frequency', key: 'purchasing_frequency', width: 16 },
      { header: 'Estimated quantity / cycle', key: 'estimated_quantity', width: 22 },
      { header: 'Estimated unit cost', key: 'estimated_unit_cost', width: 18 },
      { header: 'Estimated weekly cost', key: 'estimated_weekly_cost', width: 20 },
      { header: 'Actual weekly cost', key: 'actual_weekly_cost', width: 20 },
      { header: 'Weekly variance', key: 'weekly_variance', width: 18 },
      { header: 'Weekly variance percent', key: 'weekly_variance_percent', width: 24 },
      { header: 'Estimated monthly cost', key: 'estimated_monthly_cost', width: 20 },
      { header: 'Actual monthly cost', key: 'actual_monthly_cost', width: 20 },
      { header: 'Monthly variance', key: 'monthly_variance', width: 19 },
      { header: 'Monthly variance percent', key: 'monthly_variance_percent', width: 25 },
      { header: 'Estimated selected-period cost', key: 'estimated_period_cost', width: 29 },
      { header: 'Pending approval quantity', key: 'pending_approval_quantity', width: 25 },
      { header: 'Approved purchase quantity', key: 'approved_purchase_quantity', width: 26 },
      { header: 'Approved outstanding quantity', key: 'approved_outstanding_quantity', width: 29 },
      { header: 'Actual quantity (period)', key: 'actual_quantity', width: 24 },
      { header: 'Estimated quantity (period)', key: 'estimated_period_quantity', width: 28 },
      { header: 'Quantity variance', key: 'quantity_variance', width: 20 },
      { header: 'Quantity variance percent', key: 'quantity_variance_percent', width: 26 },
      { header: 'Actual unit cost (period)', key: 'actual_unit_cost', width: 24 },
      { header: 'Unit cost variance', key: 'unit_cost_variance', width: 22 },
      { header: 'Unit cost variance percent', key: 'unit_cost_variance_percent', width: 27 },
      { header: 'Actual cost (period)', key: 'actual_cost', width: 22 },
      { header: 'Selected-period variance', key: 'actual_variance', width: 25 },
      { header: 'Selected-period variance percent', key: 'actual_variance_percent', width: 32 },
      { header: 'Supplier', key: 'supplier_name', width: 24 }, { header: 'Notes', key: 'notes', width: 32 },
    ];
    sheet.addRows(items);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="kitchen-register.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (caught) {
    fail(res, next, caught);
  }
};

async function fetchFinancialEntries(schoolId, query) {
  const module = query.module;
  if (!MODULES.has(module)) throw error(400, 'Choose tuckshop or feeding and marketing.');
  const period = parsePeriod(query);
  const academicYear = text(query.academic_year, 40) || null;
  const term = text(query.term, 80) || null;
  const result = await pool.query(
    `SELECT e.id, e.module, e.transaction_type, e.transaction_date::text,
            e.week_start::text, e.academic_year, e.term, e.amount,
            e.payment_method, e.category, e.description, e.reference,
            e.recorded_by, u.name AS recorded_by_name, e.created_at
     FROM operational_financial_entries e
     LEFT JOIN users u ON u.id=e.recorded_by AND u.school_id=e.school_id
     WHERE e.school_id=$1 AND e.module=$2
       AND e.transaction_date BETWEEN $3::date AND $4::date
       AND ($5::text IS NULL OR e.academic_year=$5)
       AND ($6::text IS NULL OR e.term=$6)
     ORDER BY e.transaction_date, e.created_at, e.id`,
    [schoolId, module, period.startDate, period.endDate, academicYear, term]
  );
  return {
    module,
    period,
    entries: result.rows,
    report: summarizeFinancialEntries(result.rows, period),
  };
}

const getFinancialRegister = async (req, res, next) => {
  try {
    res.json(await fetchFinancialEntries(req.user.school_id, req.query));
  } catch (caught) {
    fail(res, next, caught);
  }
};

const createFinancialEntry = async (req, res, next) => {
  const module = req.body.module;
  const type = req.body.transaction_type;
  const date = req.body.transaction_date;
  const amount = money(req.body.amount);
  const description = text(req.body.description, 1000);
  if (!MODULES.has(module) || !['revenue', 'expense'].includes(type)
      || !toUtcDate(date) || amount === null || amount <= 0 || !description) {
    return res.status(400).json({ message: 'Choose a register, type, valid date, positive amount, and description.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO operational_financial_entries
         (school_id, module, transaction_type, transaction_date, week_start,
          academic_year, term, amount, payment_method, category, description, reference, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, module, transaction_type, transaction_date::text, week_start::text,
                 academic_year, term, amount, payment_method, category, description, reference,
                 recorded_by, created_at`,
      [req.user.school_id, module, type, date, mondayFor(date), text(req.body.academic_year, 40) || null,
        text(req.body.term, 80) || null, amount, text(req.body.payment_method, 40) || null,
        text(req.body.category, 100) || null, description, text(req.body.reference, 120) || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (caught) {
    fail(res, next, caught);
  }
};

const deleteFinancialEntry = async (req, res, next) => {
  const id = positiveInt(req.params.id);
  const module = req.params.module;
  if (!id || !MODULES.has(module)) return res.status(400).json({ message: 'Choose a valid register entry.' });
  try {
    const result = await pool.query(
      'DELETE FROM operational_financial_entries WHERE id=$1 AND school_id=$2 AND module=$3 RETURNING id',
      [id, req.user.school_id, module]
    );
    if (!result.rowCount) throw error(404, 'Register entry not found.');
    res.json({ deleted: true });
  } catch (caught) {
    fail(res, next, caught);
  }
};

const updateFinancialEntry = async (req, res, next) => {
  const id = positiveInt(req.params.id);
  const module = req.params.module;
  const type = req.body.transaction_type;
  const date = req.body.transaction_date;
  const amount = money(req.body.amount);
  const description = text(req.body.description, 1000);
  if (!id || !MODULES.has(module) || !['revenue', 'expense'].includes(type)
      || !toUtcDate(date) || amount === null || amount <= 0 || !description) {
    return res.status(400).json({ message: 'Choose a register, type, valid date, positive amount, and description.' });
  }
  try {
    const officerOwnEntry = req.user.role === 'feeding_tuckshop_officer';
    const result = await pool.query(
      `UPDATE operational_financial_entries
       SET transaction_type=$1, transaction_date=$2, week_start=$3,
           academic_year=$4, term=$5, amount=$6, payment_method=$7,
           category=$8, description=$9, reference=$10, updated_at=NOW()
       WHERE id=$11 AND school_id=$12 AND module=$13
         AND ($14::boolean=FALSE OR recorded_by=$15)
       RETURNING id, module, transaction_type, transaction_date::text, week_start::text,
                 academic_year, term, amount, payment_method, category, description, reference,
                 recorded_by, created_at, updated_at`,
      [type, date, mondayFor(date), text(req.body.academic_year, 40) || null,
        text(req.body.term, 80) || null, amount, text(req.body.payment_method, 40) || null,
        text(req.body.category, 100) || null, description, text(req.body.reference, 120) || null,
        id, req.user.school_id, module, officerOwnEntry, req.user.id]
    );
    if (!result.rowCount) throw error(404, 'Register entry not found or not editable.');
    res.json(result.rows[0]);
  } catch (caught) {
    fail(res, next, caught);
  }
};

const getOperationsAudit = async (req, res, next) => {
  try {
    const [financeRows, inventoryRows] = await Promise.all([
      pool.query(
        `SELECT id, actor_id, actor_role, table_name, record_id, action,
                old_data, new_data, created_at
         FROM finance_audit_log
         WHERE school_id=$1 AND (
           table_name=ANY($2::text[])
           OR (table_name='school_payment_receipts' AND
             GREATEST(COALESCE(NULLIF(new_data->>'feeding_amount','')::numeric,0),
                      COALESCE(NULLIF(old_data->>'feeding_amount','')::numeric,0)) > 0)
           OR (table_name='school_payment_refunds' AND
             COALESCE(new_data->>'component',old_data->>'component')='feeding')
         )
         ORDER BY created_at DESC LIMIT 200`,
        [req.user.school_id, FINANCE_AUDIT_TABLES]
      ),
      pool.query(
        `SELECT id, actor_id, actor_role, table_name, record_id, action,
                old_data, new_data, created_at
         FROM inventory_audit_log
         WHERE school_id=$1 AND table_name=ANY($2::text[])
         ORDER BY created_at DESC LIMIT 200`,
        [req.user.school_id, INVENTORY_AUDIT_TABLES]
      ),
    ]);
    const entries = [
      ...financeRows.rows.map((row) => ({
        ...row,
        old_data: auditPayload(row.table_name, row.old_data),
        new_data: auditPayload(row.table_name, row.new_data),
        source: 'finance',
      })),
      ...inventoryRows.rows.map((row) => ({ ...row, source: 'inventory' })),
    ].sort((left, right) => new Date(right.created_at) - new Date(left.created_at)).slice(0, 200);
    res.json(entries);
  } catch (caught) {
    fail(res, next, caught);
  }
};

const exportFinancialRegister = async (req, res, next) => {
  try {
    const { module, period, entries, report } = await fetchFinancialEntries(req.user.school_id, req.query);
    const workbook = new ExcelJS.Workbook();
    const summary = workbook.addWorksheet('Weekly summary');
    summary.addRow(['Register', module === 'tuckshop' ? 'Tuckshop & Purchases' : 'Feeding & Marketing', 'Daily average revenue', report.average_daily_revenue]);
    summary.addRow(['Period', `${period.startDate} to ${period.endDate}`, 'Daily average expenses', report.average_daily_expenses]);
    summary.addRow([]);
    summary.addRow(['Week starting', 'Monday revenue', 'Tuesday revenue', 'Wednesday revenue', 'Thursday revenue', 'Friday revenue', 'Other-day revenue', 'Weekly revenue', 'Monday expenses', 'Tuesday expenses', 'Wednesday expenses', 'Thursday expenses', 'Friday expenses', 'Other-day expenses', 'Weekly expenses', 'Net balance', 'Revenue change', 'Expense change', 'Net change']);
    for (const week of report.weeks) {
      summary.addRow([
        week.week_start,
        ...week.weekdays.map((day) => day.revenue), week.other_days_revenue, week.revenue,
        ...week.weekdays.map((day) => day.expenses), week.other_days_expenses, week.expenses, week.net_balance,
        week.revenue_change_from_previous, week.expense_change_from_previous, week.change_from_previous,
      ]);
    }
    summary.addRow(['Period totals', ...report.weekday_totals.map((day) => day.revenue), '', report.total_revenue,
      ...report.weekday_totals.map((day) => day.expenses), '', report.total_expenses, report.net_balance, '', '', '']);
    summary.getRow(4).font = { bold: true };
    summary.getRow(summary.rowCount).font = { bold: true };
    summary.views = [{ state: 'frozen', ySplit: 4 }];
    summary.columns = [{ width: 18 }, ...Array.from({ length: 18 }, () => ({ width: 18 }))];

    const detail = workbook.addWorksheet('Daily entries');
    detail.columns = [
      { header: 'Date', key: 'transaction_date', width: 14 }, { header: 'Week starting', key: 'week_start', width: 14 },
      { header: 'Type', key: 'transaction_type', width: 14 }, { header: 'Amount', key: 'amount', width: 16 },
      { header: 'Description', key: 'description', width: 38 }, { header: 'Category', key: 'category', width: 20 },
      { header: 'Payment method', key: 'payment_method', width: 18 }, { header: 'Reference', key: 'reference', width: 20 },
      { header: 'Academic year', key: 'academic_year', width: 18 }, { header: 'Term', key: 'term', width: 18 },
      { header: 'Recorded by', key: 'recorded_by_name', width: 24 },
    ];
    detail.addRows(entries);
    detail.getRow(1).font = { bold: true };
    detail.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `${module.replaceAll('_', '-')}-${period.startDate}-${period.endDate}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (caught) {
    fail(res, next, caught);
  }
};

module.exports = {
  listKitchenItems,
  saveKitchenItem,
  setKitchenItemActive,
  exportKitchenItems,
  getFinancialRegister,
  createFinancialEntry,
  updateFinancialEntry,
  deleteFinancialEntry,
  getOperationsAudit,
  exportFinancialRegister,
};