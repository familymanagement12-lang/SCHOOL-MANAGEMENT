const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { adjustAssetQuantity } = require('./storeInventoryController');

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
