export const isAdministrator = (user) => user?.role === 'admin';

export const hasOperationalPermission = (user, ...permissions) => (
  isAdministrator(user)
  || permissions.some((permission) => (
    (user?.role === 'feeding_tuckshop_officer'
      && (permission.startsWith('feeding.') || permission.startsWith('tuckshop.')))
    || user?.permissions?.includes(permission)
  ))
);
