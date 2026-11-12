const pool = require('../config/db');

const getNotifications = async (req, res, next) => {
  const { school_id, id: user_id } = req.user;
  try {
    const result = await pool.query(
      `SELECT * FROM notifications WHERE school_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [school_id, user_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res, next) => {
  const { school_id, id: user_id } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND school_id = $2 AND user_id = $3 RETURNING *`,
      [id, school_id, user_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Notification not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const markAllAsRead = async (req, res, next) => {
  const { school_id, id: user_id } = req.user;
  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE school_id = $1 AND user_id = $2 AND is_read = FALSE`,
      [school_id, user_id]
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead };