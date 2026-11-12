const crypto = require('crypto');
const pool = require('../config/db');

const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const positiveInt = (value) => value !== null && value !== undefined && value !== ''
  && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const nonNegativeMoney = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => datePattern.test(value || '')
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const idempotencyKey = (value) => text(value, 120);

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const respondError = (error, res, next) => {
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.code === '23505') return res.status(409).json({ message: 'A record with that code or reference already exists.' });
  if (error.code === '23503') return res.status(409).json({ message: 'This record is in use and cannot be changed or removed.' });
  next(error);
};

const getAssetHistory = async (req, res, next) => {
  const assetId = positiveInt(req.params.id);
  if (!assetId) return res.status(400).json({ message: 'Choose a valid asset.' });
  try {
    const result = await pool.query(
      `SELECT e.*, actor.name AS actor_name, old_user.name AS from_user_name,
              new_user.name AS to_user_name, old_employee.full_name AS old_employee_name,
              new_employee.full_name AS new_employee_name, a.asset_code
       FROM inventory_asset_events e
       JOIN inventory_assets a ON a.id=e.asset_id AND a.school_id=e.school_id
       LEFT JOIN users actor ON actor.id=e.actor_id AND actor.school_id=e.school_id
       LEFT JOIN users old_user ON old_user.id=e.from_user_id AND old_user.school_id=e.school_id
       LEFT JOIN users new_user ON new_user.id=e.to_user_id AND new_user.school_id=e.school_id
       LEFT JOIN employees old_employee ON old_employee.id=e.from_employee_id AND old_employee.school_id=e.school_id
       LEFT JOIN employees new_employee ON new_employee.id=e.to_employee_id AND new_employee.school_id=e.school_id
       WHERE e.school_id=$1 AND e.asset_id=$2 ORDER BY e.created_at DESC`,
      [req.user.school_id, assetId]
    );
    res.json(result.rows.map((row) => ({
      ...row,
      from_user_name: row.from_user_name || row.old_employee_name || null,
      to_user_name: row.to_user_name || row.new_employee_name || null,
    })));
  } catch (error) {
    next(error);
  }
};

const recordMovement = async (client, { schoolId, inventoryId, type, change, quantityAfter, unitPrice = 0, referenceType, referenceId = null, key = null, reason = null, actorId }) => {
  await client.query(
    `INSERT INTO inventory_stock_movements
       (school_id, inventory_id, movement_type, quantity_change, quantity_after,
        unit_price, reference_type, reference_id, idempotency_key, reason, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [schoolId, inventoryId, type, change, quantityAfter, unitPrice, referenceType, referenceId, key, reason, actorId]
  );
};

const getInventoryDashboard = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    const [summary, alerts, movements, requests] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS item_types,
                COALESCE(SUM(quantity), 0)::int AS total_units,
                COUNT(*) FILTER (WHERE quantity = 0 AND item_status = 'active')::int AS out_of_stock,
                COUNT(*) FILTER (WHERE quantity > 0 AND quantity <= minimum_stock AND item_status = 'active')::int AS low_stock,
                COALESCE(SUM(quantity * purchase_price), 0)::numeric(14,2) AS stock_value
         FROM inventory WHERE school_id = $1 AND item_status <> 'archived'`,
        [school_id]
      ),
      pool.query(
        `SELECT i.id, i.item_name, i.item_code, i.barcode, i.quantity, i.minimum_stock,
                i.unit, i.expiry_date, 'low_stock' AS alert_type
         FROM inventory i
         WHERE i.school_id = $1 AND i.item_status = 'active'
           AND i.quantity <= i.minimum_stock
         UNION ALL
         SELECT i.id, i.item_name, i.item_code, i.barcode, b.quantity_remaining AS quantity,
                i.minimum_stock, i.unit, b.expiry_date, 'expiry' AS alert_type
         FROM inventory_stock_batches b
         JOIN inventory i ON i.id = b.inventory_id AND i.school_id = b.school_id
         WHERE b.school_id = $1 AND b.quantity_remaining > 0
           AND b.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
         ORDER BY alert_type, item_name`,
        [school_id]
      ),
      pool.query(
        `SELECT m.id, m.movement_type, m.quantity_change, m.quantity_after, m.reference_type,
                m.reason, m.created_at, i.item_name, i.unit, u.name AS actor_name
         FROM inventory_stock_movements m
         JOIN inventory i ON i.id = m.inventory_id AND i.school_id = m.school_id
         LEFT JOIN users u ON u.id = m.actor_id AND u.school_id = m.school_id
         WHERE m.school_id = $1 ORDER BY m.created_at DESC LIMIT 12`,
        [school_id]
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM inventory_requests WHERE school_id = $1 GROUP BY status`,
        [school_id]
      ),
    ]);
    res.json({
      summary: summary.rows[0],
      alerts: alerts.rows,
      recent_movements: movements.rows,
      request_counts: requests.rows,
    });
  } catch (error) {
    next(error);
  }
};

const listSuppliers = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM inventory_purchases p WHERE p.supplier_id=s.id AND p.school_id=s.school_id) AS purchase_count,
              COALESCE((SELECT SUM(pi.quantity_ordered * pi.unit_price)
                FROM inventory_purchases p JOIN inventory_purchase_items pi
                  ON pi.purchase_id=p.id AND pi.school_id=p.school_id
                WHERE p.supplier_id=s.id AND p.school_id=s.school_id),0)::numeric(14,2) AS purchase_total,
              COALESCE((SELECT array_agg(DISTINCT i.item_name ORDER BY i.item_name)
                FROM inventory i WHERE i.supplier_id=s.id AND i.school_id=s.school_id),'{}') AS supplied_items
       FROM inventory_suppliers s
       WHERE s.school_id = $1 ORDER BY s.name`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const saveSupplier = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const { name, contact_name, email, phone, address, notes } = req.body;
  const supplierName = text(name, 160);
  if (!supplierName) return res.status(400).json({ message: 'Supplier name is required.' });
  try {
    const values = [supplierName, text(contact_name, 160) || null, text(email, 254) || null,
      text(phone, 60) || null, text(address, 500) || null, text(notes, 1000) || null];
    const result = req.params.id
      ? await pool.query(
        `UPDATE inventory_suppliers SET name=$1, contact_name=$2, email=$3, phone=$4,
             address=$5, notes=$6, updated_at=NOW()
         WHERE id=$7 AND school_id=$8 RETURNING *`,
        [...values, positiveInt(req.params.id), school_id]
      )
      : await pool.query(
        `INSERT INTO inventory_suppliers
           (school_id, name, contact_name, email, phone, address, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [school_id, ...values, actorId]
      );
    if (req.params.id && !result.rows.length) return res.status(404).json({ message: 'Supplier not found.' });
    res.status(req.params.id ? 200 : 201).json(result.rows[0]);
  } catch (error) {
    respondError(error, res, next);
  }
};

const setSupplierStatus = async (req, res, next) => {
  const id = positiveInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'Choose a valid supplier.' });
  const isActive = req.body.is_active;
  if (typeof isActive !== 'boolean') return res.status(400).json({ message: 'Supplier status must be active or inactive.' });
  try {
    const result = await pool.query(
      `UPDATE inventory_suppliers SET is_active=$1, updated_at=NOW()
       WHERE id=$2 AND school_id=$3 RETURNING *`,
      [isActive, id, req.user.school_id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Supplier not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    respondError(error, res, next);
  }
};

const listPurchases = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.purchase_reference, p.purchase_date, p.invoice_number, p.status,
              p.notes, p.created_at, s.name AS supplier_name,
              COALESCE(SUM(pi.quantity_ordered * pi.unit_price), 0)::numeric(14,2) AS total_cost,
              COALESCE(json_agg(json_build_object(
                'id', pi.id, 'inventory_id', pi.inventory_id, 'item_name', i.item_name,
                'quantity_ordered', pi.quantity_ordered, 'quantity_received', pi.quantity_received,
                'unit_price', pi.unit_price, 'line_total', pi.quantity_ordered * pi.unit_price,
                'expiry_date', pi.expiry_date, 'item_type', i.item_type
              ) ORDER BY pi.id) FILTER (WHERE pi.id IS NOT NULL), '[]'::json) AS items
       FROM inventory_purchases p
       JOIN inventory_suppliers s ON s.id=p.supplier_id AND s.school_id=p.school_id
       LEFT JOIN inventory_purchase_items pi ON pi.purchase_id=p.id AND pi.school_id=p.school_id
       LEFT JOIN inventory i ON i.id=pi.inventory_id AND i.school_id=pi.school_id
       WHERE p.school_id=$1
       GROUP BY p.id, s.name ORDER BY p.purchase_date DESC, p.id DESC LIMIT 200`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createPurchase = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const { supplier_id, purchase_reference, purchase_date, invoice_number, notes, items } = req.body;
  const supplierId = positiveInt(supplier_id);
  const reference = text(purchase_reference, 100);
  if (!supplierId || !reference || !Array.isArray(items) || !items.length || items.length > 100) {
    return res.status(400).json({ message: 'Choose a supplier, purchase reference, and at least one purchase line.' });
  }
  if (purchase_date && !validDate(purchase_date)) return res.status(400).json({ message: 'Purchase date must use YYYY-MM-DD format.' });
  const normalizedItems = [];
  const seenItems = new Set();
  for (const item of items) {
    const inventoryId = positiveInt(item.inventory_id);
    const quantity = positiveInt(item.quantity_ordered);
    const unitPrice = nonNegativeMoney(item.unit_price);
    if (!inventoryId || !quantity || unitPrice === null) return res.status(400).json({ message: 'Each purchase line needs an item, positive quantity, and non-negative unit price.' });
    if (seenItems.has(inventoryId)) return res.status(400).json({ message: 'Use only one line per item in a purchase.' });
    seenItems.add(inventoryId);
    const expiryDate = item.expiry_date ? String(item.expiry_date) : null;
    if (expiryDate && !validDate(expiryDate)) return res.status(400).json({ message: 'Expiry dates must use YYYY-MM-DD format.' });
    normalizedItems.push({ inventoryId, quantity, unitPrice, expiryDate });
  }

  try {
    const result = await transaction(async (client) => {
      const supplier = await client.query(
        'SELECT id FROM inventory_suppliers WHERE id=$1 AND school_id=$2 AND is_active=TRUE FOR UPDATE',
        [supplierId, school_id]
      );
      if (!supplier.rows.length) throw fail(400, 'Choose an active supplier from this school.');
      for (const item of normalizedItems) {
        const inventoryItem = await client.query(
          `SELECT id, item_type, item_status FROM inventory
           WHERE id=$1 AND school_id=$2 FOR UPDATE`,
          [item.inventoryId, school_id]
        );
        if (!inventoryItem.rows.length || inventoryItem.rows[0].item_status !== 'active') {
          throw fail(400, 'Each purchased item must be active and belong to this school.');
        }
      }
      const purchase = await client.query(
        `INSERT INTO inventory_purchases
           (school_id, supplier_id, purchase_reference, purchase_date, invoice_number, notes, created_by)
         VALUES ($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7) RETURNING *`,
        [school_id, supplierId, reference, purchase_date || null, text(invoice_number, 120) || null, text(notes, 1000) || null, actorId]
      );
      for (const item of normalizedItems) {
        await client.query(
          `INSERT INTO inventory_purchase_items
             (school_id, purchase_id, inventory_id, quantity_ordered, unit_price, expiry_date)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [school_id, purchase.rows[0].id, item.inventoryId, item.quantity, item.unitPrice, item.expiryDate]
        );
      }
      return purchase.rows[0];
    });
    res.status(201).json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const receivePurchaseDelivery = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const purchaseId = positiveInt(req.params.id);
  const deliveryReference = text(req.body.delivery_reference, 120);
  const items = req.body.items;
  if (!purchaseId || !deliveryReference || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: 'A delivery reference and at least one received line are required.' });
  }
  const receivedLines = [];
  for (const line of items) {
    const purchaseItemId = positiveInt(line.purchase_item_id);
    const quantity = positiveInt(line.quantity_received);
    const unitPrice = line.unit_price === undefined ? null : nonNegativeMoney(line.unit_price);
    const expiryDate = line.expiry_date ? String(line.expiry_date) : null;
    const serialNumbers = Array.isArray(line.serial_numbers)
      ? line.serial_numbers.map((value) => text(value, 120)).filter(Boolean)
      : [];
    if (!purchaseItemId || !quantity || (line.unit_price !== undefined && unitPrice === null)
        || (expiryDate && !validDate(expiryDate))
        || (serialNumbers.length && serialNumbers.length !== quantity)) {
      return res.status(400).json({ message: 'Each received line needs a purchase item, positive quantity, and valid unit price.' });
    }
    receivedLines.push({ purchaseItemId, quantity, unitPrice, expiryDate, serialNumbers });
  }
  if (new Set(receivedLines.map((item) => item.purchaseItemId)).size !== receivedLines.length) {
    return res.status(400).json({ message: 'Include each purchase item only once per delivery.' });
  }

  try {
    const receipt = await transaction(async (client) => {
      const purchaseResult = await client.query(
        'SELECT id, status FROM inventory_purchases WHERE id=$1 AND school_id=$2 FOR UPDATE',
        [purchaseId, school_id]
      );
      if (!purchaseResult.rows.length) throw fail(404, 'Purchase not found.');
      if (purchaseResult.rows[0].status === 'cancelled' || purchaseResult.rows[0].status === 'received') {
        throw fail(409, 'This purchase is already closed.');
      }
      const insertedReceipt = await client.query(
        `INSERT INTO inventory_purchase_receipts
           (school_id, purchase_id, delivery_reference, received_by, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [school_id, purchaseId, deliveryReference, actorId, text(req.body.notes, 1000) || null]
      );
      for (const line of receivedLines) {
        const purchaseLine = await client.query(
          `SELECT pi.id, pi.inventory_id, pi.quantity_ordered, pi.quantity_received,
                  pi.unit_price, pi.expiry_date, i.quantity, i.purchase_price, i.item_type
           FROM inventory_purchase_items pi
           JOIN inventory i ON i.id=pi.inventory_id AND i.school_id=pi.school_id
           WHERE pi.id=$1 AND pi.purchase_id=$2 AND pi.school_id=$3
           FOR UPDATE OF pi, i`,
          [line.purchaseItemId, purchaseId, school_id]
        );
        if (!purchaseLine.rows.length) throw fail(400, 'A received line does not belong to this purchase.');
        const row = purchaseLine.rows[0];
        if (row.quantity_received + line.quantity > row.quantity_ordered) {
          throw fail(400, 'The delivery quantity cannot exceed the remaining purchase quantity.');
        }
        const unitPrice = line.unitPrice ?? Number(row.unit_price);
        const updatedItem = await client.query(
          `UPDATE inventory SET quantity=quantity+$1,
              purchase_price=CASE WHEN quantity+$1=0 THEN $2::numeric
                ELSE ROUND(((quantity * purchase_price) + ($1 * $2::numeric)) / (quantity + $1), 2) END,
              expiry_date=CASE WHEN $3::date IS NULL THEN expiry_date
                WHEN expiry_date IS NULL OR $3::date < expiry_date THEN $3::date
                ELSE expiry_date END
           WHERE id=$4 AND school_id=$5 RETURNING quantity`,
          [line.quantity, unitPrice, line.expiryDate || row.expiry_date, row.inventory_id, school_id]
        );
        const receiptItem = await client.query(
          `INSERT INTO inventory_purchase_receipt_items
             (school_id, receipt_id, purchase_item_id, quantity_received, unit_price, expiry_date)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [school_id, insertedReceipt.rows[0].id, row.id, line.quantity, unitPrice, line.expiryDate || row.expiry_date]
        );
        if (row.item_type === 'asset') {
          for (let index = 0; index < line.quantity; index += 1) {
            const assetCode = `ASSET-${crypto.randomUUID().toUpperCase()}`;
            const asset = await client.query(
              `INSERT INTO inventory_assets
                 (school_id, inventory_id, asset_code, serial_number, barcode, condition,
                  purchase_date, purchase_price, purchase_receipt_item_id, created_by)
               VALUES ($1,$2,$3,$4,$3,'new',CURRENT_DATE,$5,$6,$7) RETURNING id, condition`,
              [school_id, row.inventory_id, assetCode, line.serialNumbers[index] || null,
                unitPrice, receiptItem.rows[0].id, actorId]
            );
            await client.query(
              `INSERT INTO inventory_asset_events (school_id, asset_id, event_type, condition, notes, actor_id)
               VALUES ($1,$2,'registered',$3,$4,$5)`,
              [school_id, asset.rows[0].id, asset.rows[0].condition,
                `Received on delivery ${deliveryReference}.`, actorId]
            );
          }
        }
        const receivedExpiryDate = line.expiryDate || row.expiry_date;
        if (receivedExpiryDate) {
          await client.query(
            `INSERT INTO inventory_stock_batches
               (school_id, inventory_id, receipt_item_id, quantity_received, quantity_remaining, unit_price, expiry_date)
             VALUES ($1,$2,$3,$4,$4,$5,$6)`,
            [school_id, row.inventory_id, receiptItem.rows[0].id, line.quantity, unitPrice, receivedExpiryDate]
          );
        }
        await client.query(
          'UPDATE inventory_purchase_items SET quantity_received=quantity_received+$1 WHERE id=$2 AND school_id=$3',
          [line.quantity, row.id, school_id]
        );
        await recordMovement(client, {
          schoolId: school_id, inventoryId: row.inventory_id, type: 'purchase_receipt',
          change: line.quantity, quantityAfter: updatedItem.rows[0].quantity,
          unitPrice, referenceType: 'purchase_receipt', referenceId: insertedReceipt.rows[0].id,
          key: `${deliveryReference}:${row.id}`, actorId,
        });
      }
      const remaining = await client.query(
        `SELECT COUNT(*)::int AS remaining FROM inventory_purchase_items
         WHERE purchase_id=$1 AND school_id=$2 AND quantity_received < quantity_ordered`,
        [purchaseId, school_id]
      );
      const receivedCount = await client.query(
        `SELECT COUNT(*)::int AS received FROM inventory_purchase_items
         WHERE purchase_id=$1 AND school_id=$2 AND quantity_received > 0`,
        [purchaseId, school_id]
      );
      const status = remaining.rows[0].remaining === 0 ? 'received'
        : receivedCount.rows[0].received > 0 ? 'partially_received' : 'ordered';
      await client.query(
        'UPDATE inventory_purchases SET status=$1, updated_at=NOW() WHERE id=$2 AND school_id=$3',
        [status, purchaseId, school_id]
      );
      return insertedReceipt.rows[0];
    });
    res.status(201).json(receipt);
  } catch (error) {
    respondError(error, res, next);
  }
};

const getRecipients = async (req, res, next) => {
  const query = text(req.query.q, 120);
  if (query.length < 2) return res.json([]);
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  try {
    const [students, teachers, employees] = await Promise.all([
      pool.query(
        `SELECT id, name, id::text AS identifier FROM students
         WHERE school_id=$1 AND (name ILIKE $2 OR id::text ILIKE $2)
         ORDER BY name LIMIT 10`,
        [req.user.school_id, pattern]
      ),
      pool.query(
        `SELECT id, name, id::text AS identifier FROM users
         WHERE school_id=$1 AND is_active=TRUE AND role='teacher'
           AND (name ILIKE $2 OR email ILIKE $2 OR id::text ILIKE $2)
         ORDER BY name LIMIT 10`,
        [req.user.school_id, pattern]
      ),
      pool.query(
        `SELECT id, full_name AS name, id::text AS identifier FROM employees
         WHERE school_id=$1 AND is_active=TRUE
           AND (full_name ILIKE $2 OR email ILIKE $2 OR id::text ILIKE $2)
         ORDER BY full_name LIMIT 10`,
        [req.user.school_id, pattern]
      ),
    ]);
    res.json([
      ...students.rows.map((row) => ({ ...row, type: 'student' })),
      ...teachers.rows.map((row) => ({ ...row, type: 'teacher' })),
      ...employees.rows.map((row) => ({ ...row, type: 'employee' })),
    ]);
  } catch (error) {
    next(error);
  }
};

const getRequestCatalogue = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, item_name, category, quantity, unit
       FROM inventory
       WHERE school_id=$1 AND item_status='active' AND item_type='consumable'
       ORDER BY category,item_name`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getInventoryStaff = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, role, 'user'::text AS staff_type FROM users
       WHERE school_id=$1 AND is_active=TRUE AND role <> 'student'
       UNION ALL
       SELECT id, full_name AS name, role, 'employee'::text AS staff_type FROM employees
       WHERE school_id=$1 AND is_active=TRUE
       ORDER BY name`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const issueInventory = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const { inventory_id, recipient_type, recipient_id, recipient_name, department, quantity, purpose } = req.body;
  const inventoryId = positiveInt(inventory_id);
  const qty = positiveInt(quantity);
  const purposeText = text(purpose, 500);
  const key = idempotencyKey(req.body.idempotency_key);
  if (!inventoryId || !qty || !purposeText || !key) {
    return res.status(400).json({ message: 'Choose an item, positive quantity, purpose, and transaction key.' });
  }
  if (!['student', 'teacher', 'employee', 'department'].includes(recipient_type)) {
    return res.status(400).json({ message: 'Choose a valid recipient type.' });
  }
  try {
    const result = await transaction(async (client) => {
      const prior = await client.query(
        'SELECT id, reference_number FROM inventory_issuances WHERE school_id=$1 AND idempotency_key=$2',
        [school_id, key]
      );
      if (prior.rows.length) throw fail(409, `This issuance was already processed as ${prior.rows[0].reference_number}.`);
      let recipientId = null;
      let resolvedName = text(recipient_name, 160);
      if (recipient_type === 'student') {
        recipientId = positiveInt(recipient_id);
        const recipient = await client.query('SELECT id, name FROM students WHERE id=$1 AND school_id=$2', [recipientId, school_id]);
        if (!recipient.rows.length) throw fail(400, 'Select a student from this school.');
        resolvedName = recipient.rows[0].name;
      } else if (recipient_type === 'teacher') {
        recipientId = positiveInt(recipient_id);
        const recipient = await client.query(`SELECT id, name FROM users WHERE id=$1 AND school_id=$2 AND role='teacher' AND is_active=TRUE`, [recipientId, school_id]);
        if (!recipient.rows.length) throw fail(400, 'Select an active teacher from this school.');
        resolvedName = recipient.rows[0].name;
      } else if (recipient_type === 'employee') {
        recipientId = positiveInt(recipient_id);
        const recipient = await client.query('SELECT id, full_name AS name FROM employees WHERE id=$1 AND school_id=$2 AND is_active=TRUE', [recipientId, school_id]);
        if (!recipient.rows.length) throw fail(400, 'Select an active employee from this school.');
        resolvedName = recipient.rows[0].name;
      } else {
        resolvedName = text(department, 160);
        if (!resolvedName) throw fail(400, 'Enter a department as the recipient.');
      }
      if (!resolvedName) throw fail(400, 'Recipient name is required.');

      const item = await client.query(
        `SELECT id, item_name, quantity, purchase_price, item_type, item_status
         FROM inventory WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [inventoryId, school_id]
      );
      if (!item.rows.length || item.rows[0].item_status !== 'active') throw fail(404, 'Inventory item not found or inactive.');
      if (item.rows[0].item_type !== 'consumable') throw fail(400, 'Reusable assets must be assigned from Asset Management.');
      if (item.rows[0].quantity < qty) throw fail(409, `Insufficient stock. ${item.rows[0].quantity} ${item.rows[0].quantity === 1 ? 'unit' : 'units'} available.`);

      const reference = `ISS-${crypto.randomUUID().toUpperCase()}`;
      const issuance = await client.query(
        `INSERT INTO inventory_issuances
           (school_id, recipient_type, recipient_id, recipient_name, department,
            issued_by, purpose, reference_number, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [school_id, recipient_type, recipientId, resolvedName,
          recipient_type === 'department' ? resolvedName : text(department, 160) || null,
          actorId, purposeText, reference, key]
      );
      const line = await client.query(
        `INSERT INTO inventory_issuance_items
           (school_id, issuance_id, inventory_id, quantity, unit_price)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [school_id, issuance.rows[0].id, inventoryId, qty, item.rows[0].purchase_price]
      );
      await client.query(
        'UPDATE inventory SET quantity=quantity-$1 WHERE id=$2 AND school_id=$3',
        [qty, inventoryId, school_id]
      );
      const quantityAfter = item.rows[0].quantity - qty;
      let remainingToConsume = qty;
      const batches = await client.query(
        `SELECT id, quantity_remaining FROM inventory_stock_batches
         WHERE school_id=$1 AND inventory_id=$2 AND quantity_remaining>0
         ORDER BY expiry_date NULLS LAST, received_at, id FOR UPDATE`,
        [school_id, inventoryId]
      );
      for (const batch of batches.rows) {
        if (remainingToConsume === 0) break;
        const consumed = Math.min(remainingToConsume, batch.quantity_remaining);
        await client.query(
          'UPDATE inventory_stock_batches SET quantity_remaining=quantity_remaining-$1 WHERE id=$2 AND school_id=$3',
          [consumed, batch.id, school_id]
        );
        remainingToConsume -= consumed;
      }
      await recordMovement(client, {
        schoolId: school_id, inventoryId, type: 'issuance', change: -qty,
        quantityAfter, unitPrice: item.rows[0].purchase_price,
        referenceType: 'issuance', referenceId: line.rows[0].id, key, actorId, reason: purposeText,
      });
      return { issuance: issuance.rows[0], item: item.rows[0], quantity, quantity_after: quantityAfter };
    });
    res.status(201).json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const listIssuances = async (req, res, next) => {
  const { school_id, id: userId, role } = req.user;
  const values = [school_id];
  let ownFilter = '';
  if (role === 'teacher') { values.push(userId); ownFilter = ' AND x.issued_by=$2'; }
  try {
    const result = await pool.query(
      `SELECT x.*, u.name AS issued_by_name,
              COALESCE(json_agg(json_build_object(
                'inventory_id', ii.inventory_id, 'item_name', i.item_name,
                'quantity', ii.quantity, 'unit_price', ii.unit_price, 'unit', i.unit
              )) FILTER (WHERE ii.id IS NOT NULL), '[]'::json) AS items
       FROM inventory_issuances x
       LEFT JOIN users u ON u.id=x.issued_by AND u.school_id=x.school_id
       LEFT JOIN inventory_issuance_items ii ON ii.issuance_id=x.id AND ii.school_id=x.school_id
       LEFT JOIN inventory i ON i.id=ii.inventory_id AND i.school_id=x.school_id
       WHERE x.school_id=$1${ownFilter}
       GROUP BY x.id, u.name ORDER BY x.issued_at DESC LIMIT 200`,
      values
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const listAssets = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT a.*, i.item_name, i.category, u.name AS assigned_to_name, e.full_name
       FROM inventory_assets a
       JOIN inventory i ON i.id=a.inventory_id AND i.school_id=a.school_id
       LEFT JOIN users u ON u.id=a.assigned_to AND u.school_id=a.school_id
       LEFT JOIN employees e ON e.id=a.assigned_employee_id AND e.school_id=a.school_id
       WHERE a.school_id=$1 ORDER BY a.created_at DESC`,
      [req.user.school_id]
    );
    res.json(result.rows.map((row) => ({ ...row, assigned_to_name: row.assigned_to_name || row.full_name || null })));
  } catch (error) {
    next(error);
  }
};

const registerAsset = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const inventoryId = positiveInt(req.body.inventory_id);
  const serialNumber = text(req.body.serial_number, 120) || null;
  const assetCode = text(req.body.asset_code, 100) || `ASSET-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const barcode = text(req.body.barcode, 120) || assetCode;
  const price = nonNegativeMoney(req.body.purchase_price ?? 0);
  if (!inventoryId || price === null) return res.status(400).json({ message: 'Choose an asset catalogue item and a valid price.' });
  try {
    const result = await transaction(async (client) => {
      const item = await client.query(
        `SELECT id, item_type, item_status, quantity, purchase_price
         FROM inventory WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [inventoryId, school_id]
      );
      if (!item.rows.length || item.rows[0].item_type !== 'asset' || item.rows[0].item_status !== 'active') {
        throw fail(400, 'Choose an active reusable-asset catalogue item.');
      }
      const asset = await client.query(
        `INSERT INTO inventory_assets
           (school_id, inventory_id, asset_code, serial_number, barcode, condition, location,
            purchase_date, purchase_price, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11) RETURNING *`,
        [school_id, inventoryId, assetCode, serialNumber, barcode,
          ['new', 'good', 'fair', 'damaged'].includes(req.body.condition) ? req.body.condition : 'good',
          text(req.body.location, 120) || null,
          req.body.purchase_date && datePattern.test(req.body.purchase_date) ? req.body.purchase_date : null,
          price, text(req.body.notes, 1000) || null, actorId]
      );
      const itemUpdate = await client.query(
        `UPDATE inventory SET quantity=quantity+1,
            purchase_price=CASE WHEN quantity=0 THEN $1
              ELSE ROUND(((quantity * purchase_price) + $1) / (quantity + 1), 2) END
         WHERE id=$2 AND school_id=$3 RETURNING quantity`,
        [price, inventoryId, school_id]
      );
      await recordMovement(client, {
        schoolId: school_id, inventoryId, type: 'asset_register', change: 1,
        quantityAfter: itemUpdate.rows[0].quantity, unitPrice: price,
        referenceType: 'asset', referenceId: asset.rows[0].id,
        key: `asset-register:${assetCode}`, actorId, reason: 'Reusable asset registered.',
      });
      await client.query(
        `INSERT INTO inventory_asset_events (school_id, asset_id, event_type, condition, notes, actor_id)
         VALUES ($1,$2,'registered',$3,$4,$5)`,
        [school_id, asset.rows[0].id, asset.rows[0].condition, asset.rows[0].notes, actorId]
      );
      return asset.rows[0];
    });
    res.status(201).json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const updateAsset = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const assetId = positiveInt(req.params.id);
  if (!assetId) return res.status(400).json({ message: 'Choose a valid asset.' });
  const { assigned_to, assigned_employee_id, assigned_type, department, event_type, condition, location, notes } = req.body;
  const allowedEvents = ['assigned', 'transferred', 'returned', 'condition_changed', 'damaged', 'missing', 'disposed'];
  if (!allowedEvents.includes(event_type)) return res.status(400).json({ message: 'Choose a valid asset history action.' });
  const normalizedCondition = ['new', 'good', 'fair', 'damaged', 'missing', 'disposed'].includes(condition)
    ? condition : null;
  const isDisposal = event_type === 'disposed' || (event_type === 'condition_changed' && normalizedCondition === 'disposed');
  if (isDisposal && req.user.role !== 'admin') return res.status(403).json({ message: 'Only administrators may dispose of assets.' });
  const removesStock = ['disposed', 'missing'].includes(event_type)
    || (event_type === 'condition_changed' && normalizedCondition === 'missing')
    || (event_type === 'condition_changed' && normalizedCondition === 'disposed');
  const assignedTo = ['assigned', 'transferred'].includes(event_type) && assigned_type !== 'employee'
    ? positiveInt(assigned_to) : null;
  const assignedEmployeeId = ['assigned', 'transferred'].includes(event_type) && assigned_type === 'employee'
    ? positiveInt(assigned_employee_id || assigned_to) : null;
  const targetDepartment = text(department, 160) || null;
  if (['assigned', 'transferred'].includes(event_type) && !assignedTo && !assignedEmployeeId && !targetDepartment) {
    return res.status(400).json({ message: 'Assign the asset to a staff member or department.' });
  }
  try {
    const result = await transaction(async (client) => {
      const asset = await client.query(
        `SELECT * FROM inventory_assets WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [assetId, school_id]
      );
      if (!asset.rows.length) throw fail(404, 'Asset not found.');
      if (['missing', 'disposed'].includes(asset.rows[0].status)) {
        throw fail(409, 'Missing or disposed assets cannot be changed again.');
      }
      if (assignedTo) {
        const staff = await client.query(
          `SELECT id FROM users WHERE id=$1 AND school_id=$2 AND is_active=TRUE
           AND role IN ('teacher','admin','inventory','store','storekeeper','accountant','librarian')`,
          [assignedTo, school_id]
        );
        if (!staff.rows.length) throw fail(400, 'Choose an active staff account from this school.');
      }
      const row = asset.rows[0];
      let newStatus = row.status;
      let newAssignedTo = row.assigned_to;
      let newAssignedEmployeeId = row.assigned_employee_id;
      let newDepartment = row.assigned_department;
      if (['assigned', 'transferred'].includes(event_type)) {
        if (assignedTo) {
          const staff = await client.query(
            `SELECT id FROM users WHERE id=$1 AND school_id=$2 AND is_active=TRUE
             AND role IN ('teacher','admin','inventory','store','storekeeper','accountant','librarian')`,
            [assignedTo, school_id]
          );
          if (!staff.rows.length) throw fail(400, 'Choose an active staff account from this school.');
        }
        if (assignedEmployeeId) {
          const employee = await client.query(
            'SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND is_active=TRUE',
            [assignedEmployeeId, school_id]
          );
          if (!employee.rows.length) throw fail(400, 'Choose an active employee from this school.');
        }
        newStatus = 'assigned';
        newAssignedTo = assignedTo;
        newAssignedEmployeeId = assignedEmployeeId;
        newDepartment = targetDepartment;
      } else if (event_type === 'returned') {
        newStatus = 'available'; newAssignedTo = null; newAssignedEmployeeId = null; newDepartment = null;
      } else if (event_type === 'missing') {
        newStatus = 'missing'; newAssignedTo = null; newAssignedEmployeeId = null; newDepartment = null;
      } else if (event_type === 'disposed') {
        newStatus = 'disposed'; newAssignedTo = null; newAssignedEmployeeId = null; newDepartment = null;
      } else if (event_type === 'damaged') {
        newStatus = 'maintenance';
      } else if (event_type === 'condition_changed' && normalizedCondition === 'missing') {
        newStatus = 'missing'; newAssignedTo = null; newAssignedEmployeeId = null; newDepartment = null;
      } else if (event_type === 'condition_changed' && normalizedCondition === 'disposed') {
        newStatus = 'disposed'; newAssignedTo = null; newAssignedEmployeeId = null; newDepartment = null;
      }
      const updated = await client.query(
        `UPDATE inventory_assets SET assigned_to=$1, assigned_employee_id=$2,
             assigned_department=$3, status=$4, condition=COALESCE($5,condition),
             location=COALESCE($6,location), notes=COALESCE($7,notes), updated_at=NOW()
         WHERE id=$8 AND school_id=$9 RETURNING *`,
        [newAssignedTo, newAssignedEmployeeId, newDepartment, newStatus, normalizedCondition,
          text(location, 120) || null, text(notes, 1000) || null, assetId, school_id]
      );
      await client.query(
        `INSERT INTO inventory_asset_events
           (school_id, asset_id, event_type, from_user_id, to_user_id, from_employee_id, to_employee_id,
            from_department, to_department, condition, notes, actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [school_id, assetId, event_type, row.assigned_to, newAssignedTo,
          row.assigned_employee_id, newAssignedEmployeeId, row.assigned_department, newDepartment,
          normalizedCondition || updated.rows[0].condition, text(notes, 1000) || null, actorId]
      );
      if (removesStock) {
        const inventory = await client.query(
          'SELECT quantity FROM inventory WHERE id=$1 AND school_id=$2 FOR UPDATE',
          [row.inventory_id, school_id]
        );
        if (inventory.rows[0].quantity < 1) throw fail(409, 'Asset catalogue stock is already zero.');
        const adjusted = await client.query(
          'UPDATE inventory SET quantity=quantity-1 WHERE id=$1 AND school_id=$2 RETURNING quantity',
          [row.inventory_id, school_id]
        );
        await recordMovement(client, {
          schoolId: school_id, inventoryId: row.inventory_id,
          type: isDisposal ? 'adjustment' : 'damage', change: -1,
          quantityAfter: adjusted.rows[0].quantity, referenceType: 'asset',
          referenceId: assetId, key: `asset-${isDisposal ? 'disposed' : 'missing'}:${assetId}`,
          actorId, reason: `Asset ${isDisposal ? 'disposed' : 'missing'}.`,
        });
      }
      return updated.rows[0];
    });
    res.json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const listMaintenance = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.*, a.asset_code, i.item_name, u.name AS created_by_name
       FROM inventory_maintenance m
       JOIN inventory_assets a ON a.id=m.asset_id AND a.school_id=m.school_id
       JOIN inventory i ON i.id=a.inventory_id AND i.school_id=a.school_id
       LEFT JOIN users u ON u.id=m.created_by AND u.school_id=m.school_id
       WHERE m.school_id=$1 ORDER BY m.maintenance_date DESC, m.id DESC LIMIT 200`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createMaintenance = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const assetId = positiveInt(req.body.asset_id);
  const description = text(req.body.description, 1000);
  const cost = nonNegativeMoney(req.body.cost ?? 0);
  if (!assetId || !description || cost === null) return res.status(400).json({ message: 'Choose an asset, describe the maintenance, and enter a valid cost.' });
  try {
    const result = await transaction(async (client) => {
      const asset = await client.query(
        'SELECT id, status FROM inventory_assets WHERE id=$1 AND school_id=$2 FOR UPDATE',
        [assetId, school_id]
      );
      if (!asset.rows.length) throw fail(404, 'Asset not found.');
      const maintenance = await client.query(
        `INSERT INTO inventory_maintenance
           (school_id, asset_id, description, maintenance_date, cost, status, created_by)
         VALUES ($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,'open',$6) RETURNING *`,
        [school_id, assetId, description,
          req.body.maintenance_date && validDate(req.body.maintenance_date) ? req.body.maintenance_date : null,
          cost, actorId]
      );
      await client.query(
        `UPDATE inventory_assets SET status='maintenance', updated_at=NOW()
         WHERE id=$1 AND school_id=$2`,
        [assetId, school_id]
      );
      return maintenance.rows[0];
    });
    res.status(201).json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const completeMaintenance = async (req, res, next) => {
  const maintenanceId = positiveInt(req.params.id);
  if (!maintenanceId) return res.status(400).json({ message: 'Choose a valid maintenance record.' });
  try {
    const result = await transaction(async (client) => {
      const record = await client.query(
        `UPDATE inventory_maintenance SET status='completed', completed_at=NOW()
         WHERE id=$1 AND school_id=$2 AND status <> 'completed' RETURNING asset_id`,
        [maintenanceId, req.user.school_id]
      );
      if (!record.rows.length) throw fail(404, 'Open maintenance record not found.');
      await client.query(
        `UPDATE inventory_assets SET status=CASE WHEN assigned_to IS NULL AND assigned_employee_id IS NULL AND assigned_department IS NULL THEN 'available' ELSE 'assigned' END,
             updated_at=NOW()
         WHERE id=$1 AND school_id=$2`,
        [record.rows[0].asset_id, req.user.school_id]
      );
      return { message: 'Maintenance completed.' };
    });
    res.json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const listRequests = async (req, res, next) => {
  const isTeacher = req.user.role === 'teacher';
  try {
    const result = await pool.query(
      `SELECT r.*, i.item_name, i.unit, u.name AS requester_name, a.name AS approver_name
       FROM inventory_requests r
       JOIN inventory i ON i.id=r.inventory_id AND i.school_id=r.school_id
       JOIN users u ON u.id=r.requester_id AND u.school_id=r.school_id
       LEFT JOIN users a ON a.id=r.approved_by AND a.school_id=r.school_id
       WHERE r.school_id=$1${isTeacher ? ' AND r.requester_id=$2' : ''}
       ORDER BY r.created_at DESC LIMIT 200`,
      isTeacher ? [req.user.school_id, req.user.id] : [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createRequest = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const inventoryId = positiveInt(req.body.inventory_id);
  const quantity = positiveInt(req.body.quantity_requested);
  const purpose = text(req.body.purpose, 500);
  if (!inventoryId || !quantity || !purpose) return res.status(400).json({ message: 'Choose an item, positive quantity, and purpose.' });
  try {
    const item = await pool.query(
      `SELECT id, item_type, item_status FROM inventory WHERE id=$1 AND school_id=$2`,
      [inventoryId, school_id]
    );
    if (!item.rows.length || item.rows[0].item_status !== 'active') return res.status(404).json({ message: 'Active inventory item not found.' });
    if (item.rows[0].item_type !== 'consumable') return res.status(400).json({ message: 'Reusable assets are managed through Asset Management.' });
    const result = await pool.query(
      `INSERT INTO inventory_requests
         (school_id, requester_id, department, inventory_id, quantity_requested, purpose)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [school_id, actorId, text(req.body.department, 160) || null, inventoryId, quantity, purpose]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    respondError(error, res, next);
  }
};

const decideRequest = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const requestId = positiveInt(req.params.id);
  const { decision, approval_comment } = req.body;
  const quantityApproved = positiveInt(req.body.quantity_approved);
  if (!requestId || !['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Choose approve or reject for a valid request.' });
  if (decision === 'approved' && !quantityApproved) return res.status(400).json({ message: 'Enter the approved quantity.' });
  try {
    const result = await transaction(async (client) => {
      const request = await client.query(
        'SELECT * FROM inventory_requests WHERE id=$1 AND school_id=$2 FOR UPDATE',
        [requestId, school_id]
      );
      if (!request.rows.length) throw fail(404, 'Request not found.');
      const row = request.rows[0];
      if (row.status !== 'pending_approval') throw fail(409, 'This request has already been reviewed.');
      if (decision === 'approved' && quantityApproved > row.quantity_requested) throw fail(400, 'Approved quantity cannot exceed the requested quantity.');
      const updated = await client.query(
        `UPDATE inventory_requests SET status=$1, quantity_approved=$2,
             approval_comment=$3, approved_by=$4, approved_at=NOW(), updated_at=NOW()
         WHERE id=$5 AND school_id=$6 RETURNING *`,
        [decision, decision === 'approved' ? quantityApproved : 0,
          text(approval_comment, 1000) || null, actorId, requestId, school_id]
      );
      return updated.rows[0];
    });
    res.json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const fulfillRequest = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const requestId = positiveInt(req.params.id);
  const quantity = positiveInt(req.body.quantity);
  const key = idempotencyKey(req.body.idempotency_key);
  if (!requestId || !quantity || !key) return res.status(400).json({ message: 'Choose a valid request, fulfilment quantity, and transaction key.' });
  try {
    const result = await transaction(async (client) => {
      const existingMovement = await client.query(
        'SELECT id FROM inventory_stock_movements WHERE school_id=$1 AND idempotency_key=$2',
        [school_id, key]
      );
      if (existingMovement.rows.length) throw fail(409, 'This fulfilment was already processed.');
      const requestResult = await client.query(
        `SELECT r.*, i.item_name, i.quantity, i.purchase_price, i.item_type, i.item_status,
                requester.name AS requester_name
           FROM inventory_requests r
           JOIN inventory i ON i.id=r.inventory_id AND i.school_id=r.school_id
           JOIN users requester ON requester.id=r.requester_id AND requester.school_id=r.school_id
         WHERE r.id=$1 AND r.school_id=$2 FOR UPDATE OF r, i`,
        [requestId, school_id]
      );
      if (!requestResult.rows.length) throw fail(404, 'Request not found.');
      const row = requestResult.rows[0];
      if (!['approved', 'partially_fulfilled'].includes(row.status)) throw fail(409, 'Only approved requests can be fulfilled.');
      const outstanding = row.quantity_approved - row.quantity_fulfilled;
      if (quantity > outstanding) throw fail(400, 'Fulfilment quantity exceeds the approved outstanding amount.');
      if (quantity > row.quantity) throw fail(409, `Insufficient stock. ${row.quantity} ${row.quantity === 1 ? 'unit' : 'units'} available.`);
      const reference = `REQ-${requestId}-FUL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const issuance = await client.query(
        `INSERT INTO inventory_issuances
           (school_id, recipient_type, recipient_id, recipient_name, department,
            issued_by, purpose, reference_number, idempotency_key)
         VALUES ($1,'department',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [school_id, row.requester_id, row.department || row.requester_name || 'School department',
          row.department || null, actorId, row.purpose, reference, key]
      );
      const line = await client.query(
        `INSERT INTO inventory_issuance_items (school_id, issuance_id, inventory_id, quantity, unit_price)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [school_id, issuance.rows[0].id, row.inventory_id, quantity, row.purchase_price]
      );
      const item = await client.query(
        'UPDATE inventory SET quantity=quantity-$1 WHERE id=$2 AND school_id=$3 RETURNING quantity',
        [quantity, row.inventory_id, school_id]
      );
      const nextFulfilled = row.quantity_fulfilled + quantity;
      const status = nextFulfilled === row.quantity_approved ? 'fulfilled' : 'partially_fulfilled';
      await client.query(
        `UPDATE inventory_requests SET quantity_fulfilled=$1, status=$2, updated_at=NOW()
         WHERE id=$3 AND school_id=$4`,
        [nextFulfilled, status, requestId, school_id]
      );
      await recordMovement(client, {
        schoolId: school_id, inventoryId: row.inventory_id, type: 'issuance',
        change: -quantity, quantityAfter: item.rows[0].quantity, unitPrice: row.purchase_price,
        referenceType: 'request_fulfilment', referenceId: line.rows[0].id,
        key, actorId, reason: row.purpose,
      });
      return { status, quantity_fulfilled: nextFulfilled, quantity_after: item.rows[0].quantity };
    });
    res.json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const adjustStock = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const inventoryId = positiveInt(req.body.inventory_id);
  const change = Number(req.body.quantity_change);
  const reason = text(req.body.reason, 500);
  const key = idempotencyKey(req.body.idempotency_key);
  const type = req.body.movement_type === 'damage' ? 'damage' : 'adjustment';
  if (!inventoryId || !Number.isSafeInteger(change) || change === 0 || !reason || !key) {
    return res.status(400).json({ message: 'Choose an item, non-zero whole-number adjustment, reason, and transaction key.' });
  }
  try {
    const result = await transaction(async (client) => {
      const prior = await client.query(
        'SELECT id FROM inventory_stock_movements WHERE school_id=$1 AND idempotency_key=$2',
        [school_id, key]
      );
      if (prior.rows.length) throw fail(409, 'This stock adjustment was already processed.');
      const item = await client.query(
        'SELECT id, quantity, purchase_price, item_type FROM inventory WHERE id=$1 AND school_id=$2 FOR UPDATE',
        [inventoryId, school_id]
      );
      if (!item.rows.length) throw fail(404, 'Inventory item not found.');
      if (item.rows[0].item_type === 'asset') throw fail(400, 'Reusable asset quantities are managed through Asset Management.');
      if (item.rows[0].quantity + change < 0) throw fail(409, 'This adjustment would make stock negative.');
      const updated = await client.query(
        'UPDATE inventory SET quantity=quantity+$1 WHERE id=$2 AND school_id=$3 RETURNING quantity',
        [change, inventoryId, school_id]
      );
      const after = updated.rows[0].quantity;
      if (change < 0) {
        let remaining = -change;
        const batches = await client.query(
          `SELECT id, quantity_remaining FROM inventory_stock_batches
           WHERE school_id=$1 AND inventory_id=$2 AND quantity_remaining>0
           ORDER BY expiry_date NULLS LAST, received_at, id FOR UPDATE`,
          [school_id, inventoryId]
        );
        for (const batch of batches.rows) {
          if (!remaining) break;
          const removed = Math.min(remaining, batch.quantity_remaining);
          await client.query('UPDATE inventory_stock_batches SET quantity_remaining=quantity_remaining-$1 WHERE id=$2 AND school_id=$3', [removed, batch.id, school_id]);
          remaining -= removed;
        }
      }
      await recordMovement(client, {
        schoolId: school_id, inventoryId, type, change, quantityAfter: after,
        unitPrice: item.rows[0].purchase_price, referenceType: type,
        key, reason, actorId,
      });
      return { quantity_after: after };
    });
    res.json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const listStocktakes = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.*, COUNT(ti.id)::int AS item_count,
              u.name AS created_by_name
       FROM inventory_stocktakes t
       LEFT JOIN inventory_stocktake_items ti ON ti.stocktake_id=t.id AND ti.school_id=t.school_id
       LEFT JOIN users u ON u.id=t.created_by AND u.school_id=t.school_id
       WHERE t.school_id=$1 GROUP BY t.id,u.name ORDER BY t.created_at DESC LIMIT 100`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createStocktake = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const reference = text(req.body.reference_number, 100);
  const entries = req.body.items;
  if (!reference || !Array.isArray(entries) || !entries.length || entries.length > 500) {
    return res.status(400).json({ message: 'Enter a stocktake reference and at least one counted item.' });
  }
  const normalized = entries.map((entry) => ({
    inventoryId: positiveInt(entry.inventory_id),
    counted: Number(entry.counted_quantity),
    reason: text(entry.reason, 500),
  }));
  if (normalized.some((entry) => !entry.inventoryId || !Number.isSafeInteger(entry.counted) || entry.counted < 0 || !entry.reason)
      || new Set(normalized.map((entry) => entry.inventoryId)).size !== normalized.length) {
    return res.status(400).json({ message: 'Each item must have a unique inventory ID, non-negative count, and reason.' });
  }
  try {
    const result = await transaction(async (client) => {
      const stocktake = await client.query(
        `INSERT INTO inventory_stocktakes (school_id, reference_number, notes, created_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [school_id, reference, text(req.body.notes, 1000) || null, actorId]
      );
      for (const entry of normalized) {
        const item = await client.query(
          'SELECT id, quantity, item_type FROM inventory WHERE id=$1 AND school_id=$2 FOR UPDATE',
          [entry.inventoryId, school_id]
        );
        if (!item.rows.length) throw fail(400, 'A stocktake item does not belong to this school.');
        if (item.rows[0].item_type !== 'consumable') throw fail(400, 'Reusable assets are tracked individually and cannot be counted as consumable stock.');
        await client.query(
          `INSERT INTO inventory_stocktake_items
             (school_id, stocktake_id, inventory_id, system_quantity, counted_quantity, reason)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [school_id, stocktake.rows[0].id, entry.inventoryId, item.rows[0].quantity, entry.counted, entry.reason]
        );
      }
      return stocktake.rows[0];
    });
    res.status(201).json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const reconcileStocktake = async (req, res, next) => {
  const stocktakeId = positiveInt(req.params.id);
  if (!stocktakeId) return res.status(400).json({ message: 'Choose a valid stocktake.' });
  try {
    const result = await transaction(async (client) => {
      const stocktake = await client.query(
        'SELECT * FROM inventory_stocktakes WHERE id=$1 AND school_id=$2 FOR UPDATE',
        [stocktakeId, req.user.school_id]
      );
      if (!stocktake.rows.length) throw fail(404, 'Stocktake not found.');
      if (stocktake.rows[0].status !== 'open') throw fail(409, 'This stocktake was already reconciled.');
      const counts = await client.query(
        `SELECT ti.*, i.quantity, i.purchase_price, i.item_type
         FROM inventory_stocktake_items ti
         JOIN inventory i ON i.id=ti.inventory_id AND i.school_id=ti.school_id
         WHERE ti.stocktake_id=$1 AND ti.school_id=$2
         ORDER BY i.id FOR UPDATE OF ti, i`,
        [stocktakeId, req.user.school_id]
      );
      if (counts.rows.some((row) => row.item_type !== 'consumable')) {
        throw fail(409, 'This stocktake contains reusable assets; reconcile asset records individually instead.');
      }
      for (const row of counts.rows) {
        const difference = row.counted_quantity - row.quantity;
        if (difference === 0) continue;
        const updated = await client.query(
          'UPDATE inventory SET quantity=$1 WHERE id=$2 AND school_id=$3 RETURNING quantity',
          [row.counted_quantity, row.inventory_id, req.user.school_id]
        );
        if (difference < 0) {
          let remaining = -difference;
          const batches = await client.query(
            `SELECT id, quantity_remaining FROM inventory_stock_batches
             WHERE school_id=$1 AND inventory_id=$2 AND quantity_remaining>0
             ORDER BY expiry_date NULLS LAST, received_at, id FOR UPDATE`,
            [req.user.school_id, row.inventory_id]
          );
          for (const batch of batches.rows) {
            if (!remaining) break;
            const removed = Math.min(remaining, batch.quantity_remaining);
            await client.query(
              'UPDATE inventory_stock_batches SET quantity_remaining=quantity_remaining-$1 WHERE id=$2 AND school_id=$3',
              [removed, batch.id, req.user.school_id]
            );
            remaining -= removed;
          }
        }
        await recordMovement(client, {
          schoolId: req.user.school_id, inventoryId: row.inventory_id,
          type: 'stocktake', change: difference, quantityAfter: updated.rows[0].quantity,
          unitPrice: row.purchase_price, referenceType: 'stocktake',
          referenceId: stocktakeId, key: `stocktake:${stocktakeId}:${row.inventory_id}`,
          reason: row.reason, actorId: req.user.id,
        });
      }
      await client.query(
        `UPDATE inventory_stocktakes SET status='reconciled', reconciled_by=$1, reconciled_at=NOW()
         WHERE id=$2 AND school_id=$3`,
        [req.user.id, stocktakeId, req.user.school_id]
      );
      return { message: 'Stocktake reconciled.', reconciled_items: counts.rows.length };
    });
    res.json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const getInventoryReport = async (req, res, next) => {
  const { school_id } = req.user;
  const from = req.query.from && datePattern.test(req.query.from) ? req.query.from : null;
  const to = req.query.to && datePattern.test(req.query.to) ? req.query.to : null;
  const report = req.query.type || 'inventory';
  const reports = {
    inventory: `SELECT id,item_name,item_code,barcode,item_type,category,quantity,unit,minimum_stock,purchase_price,storage_location,item_status,expiry_date
      FROM inventory WHERE school_id=$1 ORDER BY category,item_name`,
    movements: `SELECT m.*,i.item_name,i.unit,u.name AS actor_name FROM inventory_stock_movements m
      JOIN inventory i ON i.id=m.inventory_id AND i.school_id=m.school_id
      LEFT JOIN users u ON u.id=m.actor_id AND u.school_id=m.school_id
      WHERE m.school_id=$1 AND ($2::date IS NULL OR m.created_at::date >= $2)
        AND ($3::date IS NULL OR m.created_at::date <= $3) ORDER BY m.created_at DESC`,
    purchases: `SELECT p.purchase_reference,p.purchase_date,p.invoice_number,p.status,s.name AS supplier_name,
      SUM(pi.quantity_ordered*pi.unit_price)::numeric(14,2) AS total_cost
      FROM inventory_purchases p JOIN inventory_suppliers s ON s.id=p.supplier_id AND s.school_id=p.school_id
      JOIN inventory_purchase_items pi ON pi.purchase_id=p.id AND pi.school_id=p.school_id
      WHERE p.school_id=$1 AND ($2::date IS NULL OR p.purchase_date >= $2)
        AND ($3::date IS NULL OR p.purchase_date <= $3) GROUP BY p.id,s.name ORDER BY p.purchase_date DESC`,
    issuances: `SELECT x.reference_number,x.recipient_type,x.recipient_name,x.department,x.issued_at,
      x.purpose,u.name AS issued_by_name,i.item_name,ii.quantity,ii.unit_price,i.unit
      FROM inventory_issuances x JOIN inventory_issuance_items ii ON ii.issuance_id=x.id AND ii.school_id=x.school_id
      JOIN inventory i ON i.id=ii.inventory_id AND i.school_id=x.school_id
      LEFT JOIN users u ON u.id=x.issued_by AND u.school_id=x.school_id
      WHERE x.school_id=$1 AND ($2::date IS NULL OR x.issued_at::date >= $2)
        AND ($3::date IS NULL OR x.issued_at::date <= $3) ORDER BY x.issued_at DESC`,
    assets: `SELECT a.asset_code,a.serial_number,a.barcode,a.condition,a.status,a.assigned_department,
      a.location,a.purchase_date,a.purchase_price,i.item_name,COALESCE(u.name,e.full_name) AS assigned_to_name
      FROM inventory_assets a JOIN inventory i ON i.id=a.inventory_id AND i.school_id=a.school_id
      LEFT JOIN users u ON u.id=a.assigned_to AND u.school_id=a.school_id
      LEFT JOIN employees e ON e.id=a.assigned_employee_id AND e.school_id=a.school_id
      WHERE a.school_id=$1 ORDER BY a.asset_code`,
    maintenance: `SELECT m.maintenance_date,m.description,m.cost,m.status,m.completed_at,a.asset_code,i.item_name
      FROM inventory_maintenance m JOIN inventory_assets a ON a.id=m.asset_id AND a.school_id=m.school_id
      JOIN inventory i ON i.id=a.inventory_id AND i.school_id=a.school_id
      WHERE m.school_id=$1 AND ($2::date IS NULL OR m.maintenance_date >= $2)
        AND ($3::date IS NULL OR m.maintenance_date <= $3) ORDER BY m.maintenance_date DESC`,
    requests: `SELECT r.created_at,r.status,r.purpose,r.quantity_requested,r.quantity_approved,r.quantity_fulfilled,
      i.item_name,u.name AS requester_name,a.name AS approver_name,r.approval_comment
      FROM inventory_requests r JOIN inventory i ON i.id=r.inventory_id AND i.school_id=r.school_id
      JOIN users u ON u.id=r.requester_id AND u.school_id=r.school_id
      LEFT JOIN users a ON a.id=r.approved_by AND a.school_id=r.school_id
      WHERE r.school_id=$1 AND ($2::date IS NULL OR r.created_at::date >= $2)
        AND ($3::date IS NULL OR r.created_at::date <= $3) ORDER BY r.created_at DESC`,
    stocktakes: `SELECT t.reference_number,t.status,t.created_at,t.reconciled_at,i.item_name,
      ti.system_quantity,ti.counted_quantity,ti.reason
      FROM inventory_stocktakes t JOIN inventory_stocktake_items ti ON ti.stocktake_id=t.id AND ti.school_id=t.school_id
      JOIN inventory i ON i.id=ti.inventory_id AND i.school_id=ti.school_id
      WHERE t.school_id=$1 AND ($2::date IS NULL OR t.created_at::date >= $2)
        AND ($3::date IS NULL OR t.created_at::date <= $3) ORDER BY t.created_at DESC`,
  };
  if (!reports[report]) return res.status(400).json({ message: 'Choose a supported report type.' });
  if ((req.query.from && !from) || (req.query.to && !to)) {
    return res.status(400).json({ message: 'Report dates must be valid calendar dates in YYYY-MM-DD format.' });
  }
  try {
    const result = await pool.query(reports[report], [school_id, from, to]);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const listMovements = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.*, i.item_name, i.unit, u.name AS actor_name
       FROM inventory_stock_movements m
       JOIN inventory i ON i.id=m.inventory_id AND i.school_id=m.school_id
       LEFT JOIN users u ON u.id=m.actor_id AND u.school_id=m.school_id
       WHERE m.school_id=$1 ORDER BY m.created_at DESC LIMIT 300`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const searchInventory = async (req, res, next) => {
  const query = text(req.query.q, 120);
  if (!query) return res.json([]);
  try {
    const result = await pool.query(
      `SELECT id,item_name,item_code,barcode,category,item_type,quantity,unit
       FROM inventory WHERE school_id=$1 AND item_status='active'
         AND (item_name ILIKE $2 OR item_code ILIKE $2 OR barcode ILIKE $2)
       ORDER BY item_name LIMIT 20`,
      [req.user.school_id, `%${query.replace(/[\\%_]/g, '\\$&')}%`]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getInventoryDashboard, listSuppliers, saveSupplier, setSupplierStatus,
  listPurchases, createPurchase, receivePurchaseDelivery,
  getRecipients, getRequestCatalogue, getInventoryStaff, issueInventory, listIssuances, listAssets, getAssetHistory, registerAsset,
  updateAsset, listMaintenance, createMaintenance, completeMaintenance,
  listRequests, createRequest, decideRequest, fulfillRequest, adjustStock,
  listStocktakes, createStocktake, reconcileStocktake, getInventoryReport,
  listMovements, searchInventory, transaction, recordMovement, respondError,
};
