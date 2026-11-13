const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { updateEmployee, deactivateEmployee } = require('./employeesController');

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

test('employee status update accepts only boolean values', async () => {
  const originalQuery = pool.query;
  let queried = false;
  pool.query = async () => { queried = true; return { rows: [] }; };
  try {
    const res = createResponse();
    await updateEmployee({ user: { school_id: 3 }, params: { id: '12' }, body: { is_active: 'false' } }, res, assert.fail);
    assert.equal(res.statusCode, 400);
    assert.equal(queried, false);
  } finally {
    pool.query = originalQuery;
  }
});

test('deactivating an employee preserves their row and is scoped to the school', async () => {
  const originalQuery = pool.query;
  let query;
  pool.query = async (...args) => {
    query = args;
    return { rows: [{ id: 12 }] };
  };
  try {
    const res = createResponse();
    await deactivateEmployee({ user: { school_id: 3 }, params: { id: '12' } }, res, assert.fail);
    assert.match(query[0], /^UPDATE employees SET is_active = FALSE/);
    assert.match(query[0], /WHERE id = \$1 AND school_id = \$2/);
    assert.deepEqual(query[1], ['12', 3]);
    assert.match(res.body.message, /history has been kept/i);
  } finally {
    pool.query = originalQuery;
  }
});
