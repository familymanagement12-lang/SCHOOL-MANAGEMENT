const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { updateEmployee, deactivateEmployee, bulkUpsertEmployees } = require('./employeesController');

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
    assert.match(query[0], /UPDATE employees\s+SET is_active = FALSE/);
    assert.match(query[0], /WHERE id = \$1 AND school_id = \$2/);
    assert.deepEqual(query[1], ['12', 3]);
    assert.match(res.body.message, /history has been kept/i);
  } finally {
    pool.query = originalQuery;
  }
});

test('bulk staff upload requires Employee Name but allows a blank Staff ID', async () => {
  const res = createResponse();
  await bulkUpsertEmployees(
    { user: { school_id: 3, id: 8, role: 'admin' }, body: { employees: [{ staff_id: '', full_name: '' }] } },
    res,
    assert.fail
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Employee Name is required/);
});

test('bulk staff upload validates duplicate Staff IDs', async () => {
  const res = createResponse();
  await bulkUpsertEmployees(
    {
      user: { school_id: 3, id: 8, role: 'admin' },
      body: { employees: [
        { staff_id: 'STAFF-1', full_name: 'Jane Doe' },
        { staff_id: 'STAFF-1', full_name: 'John Doe' },
      ] },
    },
    res,
    assert.fail
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Duplicate Staff ID/);
});

test('bulk staff upload creates active staff and commits one transaction', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  pool.connect = async () => ({
    query: async (sql, values) => {
      statements.push({ sql, values });
      if (/SELECT \* FROM employees/.test(sql)) return { rows: [] };
      if (/INSERT INTO employees/.test(sql) && /RETURNING \*/.test(sql)) {
        return { rows: [{ id: 44, full_name: values[2], staff_id: values[1], is_active: values[12] }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });
  try {
    const res = createResponse();
    await bulkUpsertEmployees(
      {
        user: { school_id: 3, id: 8, role: 'admin' },
        body: { employees: [{
          staff_id: 'STAFF-44',
          full_name: 'Jane Doe',
          employment_status: 'active',
          ssnit_number: 'C123',
          ghana_card: 'GHA-123',
        }] },
      },
      res,
      assert.fail
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, 1);
    assert.equal(res.body.updated, 0);
    assert.equal(statements.filter((entry) => entry.sql === 'BEGIN').length, 1);
    assert.equal(statements.filter((entry) => entry.sql === 'COMMIT').length, 1);
  } finally {
    pool.connect = originalConnect;
  }
});

test('bulk staff upload imports staff when optional identity and termination fields are blank', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  pool.connect = async () => ({
    query: async (sql, values) => {
      statements.push({ sql, values });
      if (/INSERT INTO employees/.test(sql) && /RETURNING \*/.test(sql)) {
        return { rows: [{ id: 45, full_name: values[2], staff_id: values[1], is_active: values[12] }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });
  try {
    const res = createResponse();
    await bulkUpsertEmployees(
      {
        user: { school_id: 3, id: 8, role: 'admin' },
        body: { employees: [{ full_name: 'Jane Doe' }] },
      },
      res,
      assert.fail
    );
    const insert = statements.find((entry) => /INSERT INTO employees/.test(entry.sql));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, 1);
    assert.equal(insert.values[1], null);
    assert.equal(insert.values[6], null);
    assert.equal(insert.values[7], null);
    assert.equal(insert.values[11], null);
    assert.equal(statements.some((entry) => /SELECT \* FROM employees/.test(entry.sql)), false);
  } finally {
    pool.connect = originalConnect;
  }
});
