const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const {
  createFinancialEntry,
  getFinancialRegister,
  getOperationsAudit,
  updateFinancialEntry,
} = require('./operationsController');

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

test('feeding officers can edit only their own daily entries', async () => {
  const originalQuery = pool.query;
  let executed;
  pool.query = async (sql, params) => {
    executed = { sql, params };
    return { rows: [{ id: 12, description: 'Updated gas purchase', amount: '50.00' }], rowCount: 1 };
  };
  try {
    const res = createResponse();
    await updateFinancialEntry({
      user: { school_id: 3, id: 7, role: 'feeding_tuckshop_officer' },
      params: { module: 'feeding_marketing', id: '12' },
      body: {
        transaction_type: 'expense', transaction_date: '2026-11-20', amount: 50,
        description: 'Updated gas purchase', category: 'Gas',
      },
    }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.match(executed.sql, /recorded_by=\$15/);
    assert.equal(executed.params[13], true);
    assert.equal(executed.params[14], 7);
  } finally {
    pool.query = originalQuery;
  }
});

test('operations audit returns only the scoped finance and inventory log queries', async () => {
  const originalQuery = pool.query;
  const statements = [];
  pool.query = async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes('FROM finance_audit_log')) {
      return { rows: [{ id: 1, table_name: 'operational_financial_entries', created_at: '2026-11-20T10:00:00Z' }] };
    }
    return { rows: [{ id: 2, table_name: 'kitchen_item_plans', created_at: '2026-11-20T11:00:00Z' }] };
  };
  try {
    const res = createResponse();
    await getOperationsAudit({ user: { school_id: 3, role: 'feeding_tuckshop_officer' } }, res, assert.fail);
    assert.equal(res.body.length, 2);
    assert.equal(res.body[0].source, 'inventory');
    assert.equal(res.body[1].source, 'finance');
    assert.equal(statements.length, 2);
    assert.ok(statements.every(({ params }) => params[0] === 3));
  } finally {
    pool.query = originalQuery;
  }
});