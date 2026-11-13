export const isAdministrator = (user) => user?.role === 'admin';

export const hasOperationalPermission = (user, ...permissions) => (
  isAdministrator(user)
  || permissions.some((permission) => user?.permissions?.includes(permission))
);
