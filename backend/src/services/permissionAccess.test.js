const test = require('node:test');
const assert = require('node:assert/strict');
const { hasAllPermissions, hasAnyPermission } = require('./permissionAccess');

test('feeding and tuckshop officers can use both modules without individual grants', () => {
  const permissions = new Set();
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['feeding.payments.create']), true);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['tuckshop.sales.create']), true);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['feeding.payments.create', 'tuckshop.sales.create']), true);
  assert.equal(hasAnyPermission('feeding_tuckshop_officer', permissions, ['feeding.access', 'tuckshop.access']), true);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['finance.transactions.read']), false);
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
