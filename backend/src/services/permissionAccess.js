const { OPERATIONAL_PERMISSIONS } = require('./operationalPermissions');

const getEffectivePermissions = (role, grantedPermissions) => {
  const permissions = new Set(grantedPermissions);
  if (role === 'feeding_tuckshop_officer') {
    OPERATIONAL_PERMISSIONS.forEach((permission) => permissions.add(permission));
  }
  return permissions;
};

const hasPermission = (role, grantedPermissions, permission) => (
  role === 'admin'
  || grantedPermissions.has(permission)
  || (role === 'feeding_tuckshop_officer' && OPERATIONAL_PERMISSIONS.includes(permission))
);

const hasAllPermissions = (role, grantedPermissions, requiredPermissions) => (
  role === 'admin'
  || requiredPermissions.every((permission) => hasPermission(role, grantedPermissions, permission))
);

const hasAnyPermission = (role, grantedPermissions, candidatePermissions) => (
  role === 'admin'
  || candidatePermissions.some((permission) => hasPermission(role, grantedPermissions, permission))
);

module.exports = { getEffectivePermissions, hasAllPermissions, hasAnyPermission };
