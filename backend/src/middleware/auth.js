const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const requestContext = require('../config/requestContext');

dotenv.config();

const normalizeRole = (role) => (role === 'store' ? 'inventory' : role);

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header missing' });
  }

  const token = authHeader.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  const pool = require('../config/db');
  pool.query(
    'SELECT is_active, session_version FROM users WHERE id=$1 AND school_id=$2',
    [payload.id, payload.school_id]
  ).then((result) => {
    const account = result.rows[0];
    if (!account || account.is_active === false) {
      return res.status(403).json({ message: 'This account is inactive.' });
    }
    if (payload.session_version !== undefined
      && Number(payload.session_version) !== Number(account.session_version ?? 1)) {
      return res.status(401).json({ message: 'Session has expired. Please sign in again.' });
    }
    req.user = { ...payload, role: normalizeRole(payload.role) };
    requestContext.run(req.user, next);
  }).catch(() => {
    req.user = { ...payload, role: normalizeRole(payload.role) };
    requestContext.run(req.user, next);
  });
};

const authorize = (allowedRoles = []) => (req, res, next) => {
  if (!allowedRoles.length) {
    return next();
  }

  const normalizedUserRole = normalizeRole(req.user?.role);
  const normalizedAllowedRoles = allowedRoles.map(normalizeRole);

  if (!req.user || !normalizedAllowedRoles.includes(normalizedUserRole)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  next();
};

module.exports = { authenticate, authorize, normalizeRole };
