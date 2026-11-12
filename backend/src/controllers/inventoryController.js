const pool = require('../config/db');
const { normalizeInventoryCatalogueItem } = require('../services/inventoryService');
const { transaction, recordMovement, respondError } = require('./storeInventoryController');

const getInventory = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;
  try {
    let query = `
      SELECT i.*, u.name AS assigned_to_name, s.name AS supplier_name
      FROM inventory i
      LEFT JOIN users u ON i.assigned_to=u.id AND u.school_id=i.school_id
      LEFT JOIN inventory_suppliers s ON i.supplier_id=s.id AND s.school_id=i.school_id
      WHERE i.school_id=$1
    `;
    const values = [school_id];
    if (role === 'teacher') {
      query += ' AND i.assigned_to=$2';
      values.push(userId);
    }
    query += ' ORDER BY i.category,i.item_name';
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const validateAssignedStaff = async (client, schoolId, assignedTo) => {
  if (assignedTo === null) return;
  const result = await client.query(
    `SELECT id FROM users
     WHERE id=$1 AND school_id=$2 AND role <> 'student' AND is_active=TRUE`,
    [assignedTo, schoolId]
  );
  if (!result.rows.length) {
    const error = new Error('Choose an active staff account from this school.');
    error.status = 400;
    throw error;
  }
};

const validateSupplier = async (client, schoolId, supplierId) => {
  if (supplierId === null) return;
  const result = await client.query(
    'SELECT id FROM inventory_suppliers WHERE id=$1 AND school_id=$2 AND is_active=TRUE',
    [supplierId, schoolId]
  );
  if (!result.rows.length) {
    const error = new Error('Choose an active supplier from this school.');
    error.status = 400;
    throw error;
  }
};

const createInventoryItem = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const parsed = normalizeInventoryCatalogueItem(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const item = parsed.value;
  if (item.item_type === 'asset' && item.quantity !== 0) {
    return res.status(400).json({ message: 'Reusable assets must be registered individually; their catalogue opening quantity must be zero.' });
  }
  try {
    const result = await transaction(async (client) => {
      await validateAssignedStaff(client, school_id, item.assigned_to);
      await validateSupplier(client, school_id, item.supplier_id);
      const inserted = await client.query(
        `INSERT INTO inventory
           (school_id,item_name,category,quantity,assigned_to,description,item_code,barcode,
            item_type,unit,minimum_stock,purchase_price,supplier_id,storage_location,item_status,expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::date)
         RETURNING *`,
        [school_id,item.item_name,item.category,item.quantity,item.assigned_to,item.description,
          item.item_code,item.barcode,item.item_type,item.unit,item.minimum_stock,item.purchase_price,
          item.supplier_id,item.storage_location,item.item_status,item.expiry_date]
      );
      if (!inserted.rows[0].item_code || !inserted.rows[0].barcode) {
        const code = inserted.rows[0].item_code || `MH-ITM-${inserted.rows[0].id}`;
        const updated = await client.query(
          `UPDATE inventory SET item_code=COALESCE(NULLIF(item_code,''),$1),
              barcode=COALESCE(NULLIF(barcode,''),$1)
           WHERE id=$2 AND school_id=$3 RETURNING *`,
          [code, inserted.rows[0].id, school_id]
        );
        inserted.rows[0] = updated.rows[0];
      }
      if (item.quantity > 0) {
        await recordMovement(client, {
          schoolId: school_id, inventoryId: inserted.rows[0].id, type: 'opening_balance',
          change: item.quantity, quantityAfter: item.quantity, unitPrice: item.purchase_price,
          referenceType: 'catalogue', referenceId: inserted.rows[0].id,
          key: `opening:${inserted.rows[0].id}`, actorId,
          reason: 'Opening balance recorded when the item was created.',
        });
      }
      return inserted.rows[0];
    });
    res.status(201).json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const updateInventoryItem = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ message: 'Choose a valid inventory item.' });
  }
  const parsed = normalizeInventoryCatalogueItem(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const item = parsed.value;
  try {
    const result = await transaction(async (client) => {
      await validateAssignedStaff(client, school_id, item.assigned_to);
      await validateSupplier(client, school_id, item.supplier_id);
      const current = await client.query(
        'SELECT quantity, item_type FROM inventory WHERE id=$1 AND school_id=$2 FOR UPDATE',
        [id, school_id]
      );
      if (!current.rows.length) {
        const error = new Error('Item not found.');
        error.status = 404;
        throw error;
      }
      if (item.item_type === 'asset' && item.quantity !== current.rows[0].quantity) {
        const error = new Error('Reusable asset quantities are managed through Asset Management.');
        error.status = 400;
        throw error;
      }
      if (item.item_type !== current.rows[0].item_type) {
        const history = await client.query(
          `SELECT EXISTS (SELECT 1 FROM inventory_stock_movements WHERE inventory_id=$1 AND school_id=$2)
               OR EXISTS (SELECT 1 FROM inventory_assets WHERE inventory_id=$1 AND school_id=$2)
               OR EXISTS (SELECT 1 FROM inventory_purchase_items WHERE inventory_id=$1 AND school_id=$2)
               OR EXISTS (SELECT 1 FROM inventory_issuance_items WHERE inventory_id=$1 AND school_id=$2)
               OR EXISTS (SELECT 1 FROM inventory_stocktake_items WHERE inventory_id=$1 AND school_id=$2) AS has_history`,
          [id, school_id]
        );
        if (history.rows[0].has_history || current.rows[0].quantity !== 0 || item.quantity !== 0) {
          const error = new Error('Item type cannot change after stock or transaction history exists.');
          error.status = 409;
          throw error;
        }
      }
      const difference = item.quantity - current.rows[0].quantity;
      const reason = typeof req.body.stock_reason === 'string' ? req.body.stock_reason.trim() : '';
      if (difference && !reason) {
        const error = new Error('Enter a reason when changing the stock balance. Use Stock adjustments to record a movement.');
        error.status = 400;
        throw error;
      }
      const updated = await client.query(
        `UPDATE inventory SET item_name=$1,category=$2,quantity=$3,assigned_to=$4,description=$5,
             item_code=$6,barcode=$7,item_type=$8,unit=$9,minimum_stock=$10,purchase_price=$11,
             supplier_id=$12,storage_location=$13,item_status=$14,expiry_date=$15::date
         WHERE id=$16 AND school_id=$17 RETURNING *`,
        [item.item_name,item.category,item.quantity,item.assigned_to,item.description,
          item.item_code,item.barcode,item.item_type,item.unit,item.minimum_stock,item.purchase_price,
          item.supplier_id,item.storage_location,item.item_status,item.expiry_date,id,school_id]
      );
      if (difference) {
        await recordMovement(client, {
          schoolId: school_id, inventoryId: id,
          type: difference < 0 ? 'damage' : 'adjustment',
          change: difference, quantityAfter: item.quantity, unitPrice: item.purchase_price,
          referenceType: 'catalogue_edit', referenceId: id,
          key: `catalogue-edit:${id}:${Date.now()}:${actorId}`,
          actorId, reason,
        });
      }
      return updated.rows[0];
    });
    res.json(result);
  } catch (error) {
    respondError(error, res, next);
  }
};

const deleteInventoryItem = async (req, res, next) => {
  const { school_id } = req.user;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: 'Choose a valid inventory item.' });
  try {
    const result = await pool.query(
      `UPDATE inventory SET item_status='archived'
       WHERE id=$1 AND school_id=$2 AND quantity=0 AND item_status <> 'archived'
       RETURNING id`,
      [id, school_id]
    );
    if (!result.rows.length) {
      const existing = await pool.query(
        'SELECT id, quantity, item_status FROM inventory WHERE id=$1 AND school_id=$2',
        [id, school_id]
      );
      if (!existing.rows.length) return res.status(404).json({ message: 'Item not found.' });
      if (existing.rows[0].quantity > 0) return res.status(409).json({ message: 'An item with stock cannot be deleted. Record a reasoned stock adjustment, then archive it.' });
      return res.status(409).json({ message: 'Item is already archived.' });
    }
    res.json({ message: 'Item archived. Its transaction and audit history were preserved.' });
  } catch (error) {
    respondError(error, res, next);
  }
};

module.exports = { getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem };
