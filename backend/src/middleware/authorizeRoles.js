/**
 * Middleware to enforce role-based access control.
 * Must be used AFTER your JWT authentication middleware.
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    // Assuming req.user is set by your JWT authentication middleware
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: 'Unauthorized: User role not identified' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: You lack the permissions for this action' });
    }

    next();
  };
};

module.exports = authorizeRoles;