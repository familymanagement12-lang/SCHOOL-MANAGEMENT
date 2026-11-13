const hasAllPermissions = (role, grantedPermissions, requiredPermissions) => (
  role === 'admin' || requiredPermissions.every((permission) => grantedPermissions.has(permission))
);

const hasAnyPermission = (role, grantedPermissions, candidatePermissions) => (
  role === 'admin' || candidatePermissions.some((permission) => grantedPermissions.has(permission))
);

module.exports = { hasAllPermissions, hasAnyPermission };
