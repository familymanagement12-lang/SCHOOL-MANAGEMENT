const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInventoryItem } = require('./inventoryService');

test('normalizes valid inventory items and optional staff assignment', () => {
  assert.deepEqual(normalizeInventoryItem({
    item_name: '  Projector  ',
    category: '  Classroom equipment ',
    quantity: '3',
    assigned_to: '12',
    description: '  Room 4  ',
  }), {
    value: {
      item_name: 'Projector',
      category: 'Classroom equipment',
      quantity: 3,
      assigned_to: 12,
      description: 'Room 4',
    },
  });
  assert.equal(normalizeInventoryItem({
    item_name: 'Paper',
    category: 'Supplies',
    quantity: '0',
  }).value.assigned_to, null);
});

test('rejects missing names, invalid quantities, and invalid staff identifiers', () => {
  assert.match(normalizeInventoryItem({ category: 'Supplies', quantity: 1 }).error, /Item name/);
  assert.match(normalizeInventoryItem({ item_name: 'Paper', category: 'Supplies', quantity: 1.5 }).error, /whole number/);
  assert.match(normalizeInventoryItem({ item_name: 'Paper', category: 'Supplies', quantity: -1 }).error, /whole number/);
  assert.match(normalizeInventoryItem({ item_name: 'Paper', category: 'Supplies', quantity: 1, assigned_to: 'invalid' }).error, /staff member/);
});

test('enforces bounded inventory fields', () => {
  assert.match(normalizeInventoryItem({
    item_name: 'x'.repeat(121),
    category: 'Supplies',
    quantity: 1,
  }).error, /Item name/);
  assert.match(normalizeInventoryItem({
    item_name: 'Paper',
    category: 'Supplies',
    quantity: 1,
    description: 'x'.repeat(501),
  }).error, /Description/);
});
