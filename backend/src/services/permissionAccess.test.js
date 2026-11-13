const test = require('node:test');
const assert = require('node:assert/strict');
const { hasAllPermissions, hasAnyPermission } = require('./permissionAccess');

test('feeding and tuckshop permissions are independent and can coexist on one account', () => {
  const permissions = new Set(['feeding.payments.create', 'tuckshop.sales.create']);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['feeding.payments.create']), true);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['tuckshop.sales.create']), true);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['feeding.payments.create', 'tuckshop.sales.create']), true);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['tuckshop.products.manage']), false);
});

test('users without a grant cannot enter the protected feature', () => {
  const permissions = new Set(['feeding.payments.read']);
  assert.equal(hasAnyPermission('teacher', permissions, ['tuckshop.sales.create']), false);
  assert.equal(hasAllPermissions('teacher', permissions, ['feeding.payments.create']), false);
});

test('existing administrator role retains module access', () => {
  assert.equal(hasAllPermissions('admin', new Set(), ['feeding.payments.create', 'tuckshop.sales.create']), true);
  assert.equal(hasAnyPermission('admin', new Set(), ['feeding.access']), true);
});
