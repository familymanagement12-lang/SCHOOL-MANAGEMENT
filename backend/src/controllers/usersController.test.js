const test = require('node:test');
const assert = require('node:assert/strict');
const previousResendKey = process.env.RESEND_API_KEY;
process.env.RESEND_API_KEY = '';
const pool = require('../config/db');
const { createUser } = require('./usersController');
if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
else process.env.RESEND_API_KEY = previousResendKey;

const createResponse = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const createRequest = () => ({
  user: { school_id: 1, id: 2, role: 'admin' },
  body: { name: 'QA Teacher', email: 'qa-teacher@example.invalid', role: 'teacher' },
});

test('teacher account and employee profile are committed in one transaction', async () => {
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const originalConsoleError = console.error;
  const statements = [];
  pool.connect = async () => ({
    async query(sql) {
      statements.push(sql);
      if (/INSERT INTO users/.test(sql)) {
        return { rows: [{ id: 7, name: 'QA Teacher', email: 'qa-teacher@example.invalid', role: 'teacher' }] };
      }
      if (/SELECT id FROM employees/.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });
  pool.query = async () => { throw new Error('Expected employee operations to use the account transaction.'); };
  console.error = () => {};

  try {
    const res = createResponse();
    await createUser(createRequest(), res, assert.fail);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.id, 7);
    assert.ok(res.body.generatedPassword);
    const employeeInsertIndex = statements.findIndex((sql) => /INSERT INTO employees/.test(sql));
    const commitIndex = statements.indexOf('COMMIT');
    assert.ok(employeeInsertIndex > statements.findIndex((sql) => /INSERT INTO users/.test(sql)));
    assert.ok(commitIndex > employeeInsertIndex);
  } finally {
    pool.connect = originalConnect;
    pool.query = originalQuery;
    console.error = originalConsoleError;
  }
});

test('employee RLS failure rolls back the new teacher account', async () => {
  const originalConnect = pool.connect;
  const originalConsoleError = console.error;
  const statements = [];
  const rlsError = Object.assign(new Error('RLS denied employee insert'), { code: '42501' });
  pool.connect = async () => ({
    async query(sql) {
      statements.push(sql);
      if (/INSERT INTO users/.test(sql)) {
        return { rows: [{ id: 8, name: 'QA Teacher', email: 'qa-teacher@example.invalid', role: 'teacher' }] };
      }
      if (/SELECT id FROM employees/.test(sql)) return { rows: [] };
      if (/INSERT INTO employees/.test(sql)) throw rlsError;
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });
  console.error = () => {};

  try {
    const res = createResponse();
    let forwardedError;
    await createUser(createRequest(), res, (error) => { forwardedError = error; });

    assert.equal(forwardedError, rlsError);
    assert.equal(res.statusCode, 200);
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(statements.includes('COMMIT'), false);
  } finally {
    pool.connect = originalConnect;
    console.error = originalConsoleError;
  }
});
