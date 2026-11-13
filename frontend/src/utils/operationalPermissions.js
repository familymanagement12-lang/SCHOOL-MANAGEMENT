export const isAdministrator = (user) => user?.role === 'admin';

export const hasOperationalPermission = (user, ...permissions) => (
  isAdministrator(user)
  || (user?.role === 'feeding_tuckshop_officer'
    && permissions.some((permission) => (
      permission.startsWith('feeding.') || permission.startsWith('tuckshop.')
    )))
  || permissions.some((permission) => user?.permissions?.includes(permission))
);
