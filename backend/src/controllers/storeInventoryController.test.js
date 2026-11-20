const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const {
  adjustAssetQuantity,
  createPurchase,
  decidePurchase,
  getInventoryStaff,
  issueInventory,
  receivePurchaseDelivery,
} = require('./storeInventoryController');

function createResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function installDatabase(handler) {
  const statements = [];
  const client = {
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      return handler(sql, params);
    },
    release: () => {},
  };
  const originalConnect = pool.connect;
  pool.connect = async () => client;
  return { statements, restore: () => { pool.connect = originalConnect; } };
}

test('inventory staff directory contains employee-register records only', async () => {
  const originalQuery = pool.query;
  let executedSql = '';
  pool.query = async (sql, params) => {
    executedSql = sql;
    assert.deepEqual(params, [3]);
    return { rows: [{ id: 12, name: 'Employee Record', role: 'Teacher', staff_type: 'employee' }] };
  };
  try {
    const res = createResponse();
    await getInventoryStaff({ user: { school_id: 3 } }, res, assert.fail);
    assert.deepEqual(res.body, [{ id: 12, name: 'Employee Record', role: 'Teacher', staff_type: 'employee' }]);
    assert.match(executedSql, /FROM employees/);
    assert.doesNotMatch(executedSql, /FROM users/);
  } finally {
    pool.query = originalQuery;
  }
});

test('issuance saves a manually entered recipient name without looking up an account', async () => {
  const statements = [];
  const database = installDatabase((sql, params) => {
    statements.push({ sql, params });
    if (sql.includes('SELECT id, reference_number FROM inventory_issuances')) return { rows: [] };
    if (sql.includes('FROM inventory WHERE id=$1')) {
      return { rows: [{ id: 8, item_name: 'Paper', item_type: 'consumable', item_status: 'active', quantity: 5, purchase_price: '2' }] };
    }
    if (sql.includes('INSERT INTO inventory_issuances')) return { rows: [{ id: 21, recipient_type: 'employee', recipient_name: 'Lydia Annol' }] };
    if (sql.includes('INSERT INTO inventory_issuance_items')) return { rows: [{ id: 22 }] };
    if (sql.includes('FROM inventory_stock_batches')) return { rows: [] };
    return { rows: [], rowCount: 1 };
  });
  try {
    const res = createResponse();
    await issueInventory({
      user: { school_id: 3, id: 7 },
      body: {
        inventory_id: 8, recipient_type: 'employee', recipient_name: ' Lydia Annol ',
        quantity: 1, purpose: 'Office supplies', idempotency_key: 'staff-account-issue-1',
      },
    }, res, assert.fail);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.issuance.recipient_type, 'employee');
    assert.ok(!statements.some(({ sql }) => /FROM (users|employees|students)/.test(sql)));
    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO inventory_issuances'));
    assert.equal(insert.params[1], 'employee');
    assert.equal(insert.params[2], null);
    assert.equal(insert.params[3], 'Lydia Annol');
  } finally {
    database.restore();
  }
});

test('adding asset quantity creates individually tracked assets and a stock movement atomically', async () => {
  let nextAssetId = 20;
  const database = installDatabase((sql) => {
    if (sql.includes('FROM inventory WHERE id=$1')) {
      return { rows: [{ id: 8, item_name: 'Laptop', item_type: 'asset', item_status: 'active', quantity: 1, unit: 'piece', storage_location: 'Store', purchase_price: '500' }], rowCount: 1 };
    }
    if (sql.includes('FROM inventory_assets') && sql.includes("status NOT IN")) {
      return { rows: [{ id: 19 }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO inventory_assets')) {
      return { rows: [{ id: nextAssetId++, asset_code: 'ASSET-TEST', condition: 'good', notes: 'Added from Store' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  try {
    const res = createResponse();
    await adjustAssetQuantity({
      user: { school_id: 3, id: 7, role: 'storekeeper' },
      body: { inventory_id: 8, target_quantity: 3, reason: 'Physical count found two extra units', event_type: 'missing', idempotency_key: 'asset-count-add-1' },
    }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      message: 'Asset quantity updated with individual history recorded.',
      quantity: 3,
      added: 2,
      removed: 0,
    });
    assert.equal(database.statements.filter(({ sql }) => sql.includes('INSERT INTO inventory_assets')).length, 2);
    assert.equal(database.statements.filter(({ sql }) => sql.includes("event_type, condition, notes, actor_id") && sql.includes('INSERT INTO inventory_asset_events')).length, 2);
    assert.ok(database.statements.some(({ sql }) => sql.includes('INSERT INTO inventory_stock_movements')));
    assert.ok(database.statements.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    database.restore();
  }
});

test('reducing asset quantity requires selected available assets and stores their reason', async () => {
  const database = installDatabase((sql, params) => {
    if (sql.includes('FROM inventory WHERE id=$1')) {
      return { rows: [{ id: 8, item_name: 'Laptop', item_type: 'asset', item_status: 'active', quantity: 2, unit: 'piece', storage_location: 'Store', purchase_price: '500' }], rowCount: 1 };
    }
    if (sql.includes('FROM inventory_assets') && sql.includes("status NOT IN")) {
      return { rows: [{ id: 19 }, { id: 20 }], rowCount: 2 };
    }
    if (sql.includes("status='available'")) {
      return { rows: params[2].map((id) => ({ id })), rowCount: params[2].length };
    }
    return { rows: [], rowCount: 1 };
  });
  try {
    const res = createResponse();
    await adjustAssetQuantity({
      user: { school_id: 3, id: 7, role: 'admin' },
      body: { inventory_id: 8, target_quantity: 1, reason: 'Laptop damaged beyond repair', event_type: 'disposed', asset_ids: [19], idempotency_key: 'asset-count-remove-1' },
    }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.quantity, 1);
    assert.equal(res.body.removed, 1);
    const assetUpdate = database.statements.find(({ sql }) => sql.includes('UPDATE inventory_assets SET status=$1'));
    assert.equal(assetUpdate.params[0], 'disposed');
    assert.equal(assetUpdate.params[2], 'Laptop damaged beyond repair');
    assert.ok(database.statements.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    database.restore();
  }
});

test('only admins may reduce asset quantity by disposal', async () => {
  const database = installDatabase(() => assert.fail('Database should not be reached for unauthorized disposal.'));
  try {
    const res = createResponse();
    await adjustAssetQuantity({
      user: { school_id: 3, id: 7, role: 'storekeeper' },
      body: { inventory_id: 8, target_quantity: 0, reason: 'No longer usable asset', event_type: 'disposed', asset_ids: [19], idempotency_key: 'asset-count-remove-2' },
    }, res, assert.fail);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /Only administrators/);
  } finally {
    database.restore();
  }
});

test('new purchases stay pending and link kitchen plan lines without changing stock', async () => {
  const database = installDatabase((sql) => {
    if (sql.includes('FROM inventory_suppliers')) return { rows: [{ id: 4 }], rowCount: 1 };
    if (sql.includes('SELECT id, item_type, item_status FROM inventory')) {
      return { rows: [{ id: 8, item_type: 'consumable', item_status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM kitchen_item_plans')) return { rows: [{ id: 9, inventory_id: 8 }], rowCount: 1 };
    if (sql.includes('INSERT INTO inventory_purchases')) return { rows: [{ id: 21, status: 'pending_approval' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  try {
    const res = createResponse();
    await createPurchase({
      user: { school_id: 3, id: 7 },
      body: {
        supplier_id: 4,
        purchase_reference: 'KITCHEN-21',
        items: [{ inventory_id: 8, kitchen_item_plan_id: 9, quantity_ordered: 5, unit_price: 2 }],
      },
    }, res, assert.fail);
    assert.equal(res.statusCode, 201);
    const purchaseInsert = database.statements.find(({ sql }) => sql.includes('INSERT INTO inventory_purchases'));
    assert.match(purchaseInsert.sql, /'pending_approval'/);
    const lineInsert = database.statements.find(({ sql }) => sql.includes('INSERT INTO inventory_purchase_items'));
    assert.equal(lineInsert.params[6], 9);
    assert.equal(database.statements.some(({ sql }) => sql.startsWith('UPDATE inventory SET quantity=')), false);
  } finally {
    database.restore();
  }
});

test('only pending purchases can be approved or rejected', async () => {
  const originalQuery = pool.query;
  let executedSql = '';
  pool.query = async (sql, params) => {
    executedSql = sql;
    assert.deepEqual(params, ['approved', 7, null, 21, 3]);
    return { rows: [{ id: 21, status: 'approved' }], rowCount: 1 };
  };
  try {
    const res = createResponse();
    await decidePurchase({
      user: { school_id: 3, id: 7, role: 'admin' },
      params: { id: '21' },
      body: { decision: 'approved' },
    }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.match(executedSql, /status='pending_approval'/);
  } finally {
    pool.query = originalQuery;
  }
});

test('delivery cannot be received before purchase approval', async () => {
  const database = installDatabase((sql) => {
    if (sql.includes('SELECT id, status FROM inventory_purchases')) {
      return { rows: [{ id: 21, status: 'pending_approval' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  try {
    const res = createResponse();
    await receivePurchaseDelivery({
      user: { school_id: 3, id: 7 },
      params: { id: '21' },
      body: { delivery_reference: 'DELIVERY-21', items: [{ purchase_item_id: 31, quantity_received: 2 }] },
    }, res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.equal(database.statements.some(({ sql }) => sql.includes('INSERT INTO inventory_purchase_receipts')), false);
    assert.ok(database.statements.some(({ sql }) => sql === 'ROLLBACK'));
  } finally {
    database.restore();
  }
});
