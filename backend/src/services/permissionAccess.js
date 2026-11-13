const { OPERATIONAL_PERMISSIONS } = require('./operationalPermissions');

const isFeedingTuckshopPermission = (permission) => OPERATIONAL_PERMISSIONS.includes(permission);

const hasAllPermissions = (role, grantedPermissions, requiredPermissions) => (
  role === 'admin'
  || (role === 'feeding_tuckshop_officer' && requiredPermissions.every(isFeedingTuckshopPermission))
  || requiredPermissions.every((permission) => grantedPermissions.has(permission))
);

const hasAnyPermission = (role, grantedPermissions, candidatePermissions) => (
  role === 'admin'
  || (role === 'feeding_tuckshop_officer' && candidatePermissions.some(isFeedingTuckshopPermission))
  || candidatePermissions.some((permission) => grantedPermissions.has(permission))
);

module.exports = { hasAllPermissions, hasAnyPermission };
