const pool = require('../config/db');
const { normalizeInventoryItem } = require('../services/inventoryService');

const getInventory = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;
  try {
    let query = `
      SELECT i.*, u.name as assigned_to_name
      FROM inventory i
      LEFT JOIN users u ON i.assigned_to = u.id AND u.school_id = i.school_id
      WHERE i.school_id = $1
    `;
    const values = [school_id];

    if (role === 'teacher') {
      query += ` AND i.assigned_to = $2`;
      values.push(userId);
    }
    
    query += ` ORDER BY i.category, i.item_name`;

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createInventoryItem = async (req, res, next) => {
  const { school_id } = req.user;
  const parsed = normalizeInventoryItem(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const { item_name, category, quantity, assigned_to, description } = parsed.value;
  try {
    if (assigned_to !== null) {
      const staffResult = await pool.query(
        `SELECT id FROM users
         WHERE id = $1 AND school_id = $2 AND role <> 'student' AND is_active = TRUE`,
        [assigned_to, school_id]
      );
      if (!staffResult.rows.length) {
        return res.status(400).json({ message: 'Choose an active staff account from this school.' });
      }
    }
    const result = await pool.query(
      `INSERT INTO inventory (school_id, item_name, category, quantity, assigned_to, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [school_id, item_name, category, quantity, assigned_to, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const updateInventoryItem = async (req, res, next) => {
  const { school_id } = req.user;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ message: 'Choose a valid inventory item.' });
  }
  const parsed = normalizeInventoryItem(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const { item_name, category, quantity, assigned_to, description } = parsed.value;
  try {
    if (assigned_to !== null) {
      const staffResult = await pool.query(
        `SELECT id FROM users
         WHERE id = $1 AND school_id = $2 AND role <> 'student' AND is_active = TRUE`,
        [assigned_to, school_id]
      );
      if (!staffResult.rows.length) {
        return res.status(400).json({ message: 'Choose an active staff account from this school.' });
      }
    }
    const result = await pool.query(
      `UPDATE inventory
       SET item_name = $1, category = $2, quantity = $3, assigned_to = $4, description = $5
       WHERE id = $6 AND school_id = $7 RETURNING *`,
      [item_name, category, quantity, assigned_to, description, id, school_id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Item not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const deleteInventoryItem = async (req, res, next) => {
  const { school_id } = req.user;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ message: 'Choose a valid inventory item.' });
  }
  try {
    const result = await pool.query('DELETE FROM inventory WHERE id = $1 AND school_id = $2 RETURNING *', [id, school_id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Item not found.' });
    res.json({ message: 'Item deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem };