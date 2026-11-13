const test = require('node:test');
const assert = require('node:assert/strict');
const { hasAllPermissions, hasAnyPermission } = require('./permissionAccess');

test('feeding and tuckshop officers need explicit operational grants', () => {
  const permissions = new Set();
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['feeding.payments.create']), false);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['tuckshop.sales.create']), false);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['feeding.payments.create', 'tuckshop.sales.create']), false);
  assert.equal(hasAnyPermission('feeding_tuckshop_officer', permissions, ['feeding.access', 'tuckshop.access']), false);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['finance.transactions.read']), false);
  permissions.add('feeding.payments.create');
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['feeding.payments.create']), true);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['tuckshop.sales.create']), false);
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
