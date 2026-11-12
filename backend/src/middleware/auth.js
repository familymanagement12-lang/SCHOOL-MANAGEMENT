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

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { ...payload, role: normalizeRole(payload.role) };
    requestContext.run(req.user, next);
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
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
