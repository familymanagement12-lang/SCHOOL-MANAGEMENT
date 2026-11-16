const test = require('node:test');
const assert = require('node:assert/strict');
const { OPERATIONAL_PERMISSIONS } = require('./operationalPermissions');
const { getEffectivePermissions, hasAllPermissions, hasAnyPermission } = require('./permissionAccess');

test('feeding and tuckshop officers receive every operational permission by role', () => {
  const permissions = new Set();
  const effective = getEffectivePermissions('feeding_tuckshop_officer', permissions);
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, OPERATIONAL_PERMISSIONS), true);
  assert.equal(hasAnyPermission('feeding_tuckshop_officer', permissions, ['feeding.access', 'tuckshop.access']), true);
  assert.deepEqual([...effective].sort(), [...OPERATIONAL_PERMISSIONS].sort());
  assert.equal(hasAllPermissions('feeding_tuckshop_officer', permissions, ['finance.transactions.read']), false);
});

test('operational role permissions do not extend to other roles', () => {
  assert.equal(hasAllPermissions('teacher', new Set(), ['feeding.payments.create']), false);
  assert.equal(hasAnyPermission('accountant', new Set(), ['tuckshop.sales.create']), false);
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
