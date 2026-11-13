const pool = require('../config/db');
const { hasAnyPermission } = require('../services/permissionAccess');

const authorizeAnyPermission = (...permissions) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Authentication is required.' });
  if (req.user.role === 'admin') return next();
  try {
    const result = await pool.query(
      `SELECT permission
       FROM user_permissions
       WHERE school_id = $1 AND user_id = $2 AND permission = ANY($3::TEXT[])
       LIMIT 1`,
      [req.user.school_id, req.user.id, permissions]
    );
    const granted = new Set(result.rows.map((row) => row.permission));
    if (!hasAnyPermission(req.user.role, granted, permissions)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = authorizeAnyPermission;
