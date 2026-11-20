const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { createFinancialEntry, getFinancialRegister } = require('./operationsController');

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

test('feeding officers can read the operational tuckshop register', async () => {
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    const res = createResponse();
    await getFinancialRegister({
      user: { school_id: 3, role: 'feeding_tuckshop_officer' },
      query: { module: 'tuckshop' },
    }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.module, 'tuckshop');
  } finally {
    pool.query = originalQuery;
  }
});

test('feeding officers can record dated operational entries with descriptions', async () => {
  const originalQuery = pool.query;
  let inserted;
  pool.query = async (sql, params) => {
    inserted = { sql, params };
    return { rows: [{ id: 12, module: 'feeding_marketing', transaction_type: 'expense', amount: '45.00' }] };
  };
  try {
    const res = createResponse();
    await createFinancialEntry({
      user: { school_id: 3, id: 7, role: 'feeding_tuckshop_officer' },
      body: {
        module: 'feeding_marketing', transaction_type: 'expense', transaction_date: '2026-11-19',
        amount: 45, description: 'Transport to market', category: 'Transport',
      },
    }, res, assert.fail);
    assert.equal(res.statusCode, 201);
    assert.equal(inserted.params[1], 'feeding_marketing');
    assert.equal(inserted.params[4], '2026-11-16');

    const tuckshop = createResponse();
    await createFinancialEntry({
      user: { school_id: 3, id: 7, role: 'feeding_tuckshop_officer' },
      body: {
        module: 'tuckshop', transaction_type: 'revenue', transaction_date: '2026-11-19',
        amount: 100, description: 'Tuckshop sales',
      },
    }, tuckshop, assert.fail);
    assert.equal(tuckshop.statusCode, 201);
    assert.equal(inserted.params[1], 'tuckshop');
  } finally {
    pool.query = originalQuery;
  }
});