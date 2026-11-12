const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInventoryItem, normalizeInventoryCatalogueItem } = require('./inventoryService');

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

test('normalizes catalogue metadata while preserving the original inventory fields', () => {
  assert.deepEqual(normalizeInventoryCatalogueItem({
    item_name: 'Exercise books',
    category: 'School Store',
    quantity: '24',
    item_code: ' SUP-001 ',
    item_type: 'consumable',
    unit: 'pack',
    minimum_stock: '5',
    purchase_price: '18.50',
    supplier_id: '3',
    storage_location: 'Store room A',
    item_status: 'active',
  }).value, {
    item_name: 'Exercise books',
    category: 'School Store',
    quantity: 24,
    assigned_to: null,
    description: null,
    item_code: 'SUP-001',
    barcode: null,
    item_type: 'consumable',
    unit: 'pack',
    minimum_stock: 5,
    purchase_price: 18.5,
    supplier_id: 3,
    storage_location: 'Store room A',
    item_status: 'active',
    expiry_date: null,
  });
});

test('rejects invalid catalogue type, prices, and stock levels', () => {
  const valid = { item_name: 'Laptop', category: 'Equipment', quantity: '0' };
  assert.match(normalizeInventoryCatalogueItem({ ...valid, item_type: 'other' }).error, /Item type/);
  assert.match(normalizeInventoryCatalogueItem({ ...valid, purchase_price: '-1' }).error, /Purchase price/);
  assert.match(normalizeInventoryCatalogueItem({ ...valid, minimum_stock: '1.5' }).error, /Minimum stock/);
});
