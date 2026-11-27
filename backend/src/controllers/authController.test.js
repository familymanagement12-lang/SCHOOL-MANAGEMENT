const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { login } = require('./authController');

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

test('students authenticate with their username and receive the first-login password flag', async () => {
  const originalQuery = pool.query;
  const originalSecret = process.env.JWT_SECRET;
  const queryCalls = [];
  process.env.JWT_SECRET = 'test-secret-for-student-login-123456789';

  try {
    const password = await bcrypt.hash('15082012', 4);
    pool.query = async (sql, values) => {
      queryCalls.push({ sql, values });
      if (/SELECT u\.id, u\.email/.test(sql)) {
        return {
          rows: [{
            id: 4,
            email: 'student@example.invalid',
            password,
            role: 'student',
            school_id: 1,
            name: 'Gideon Akussah',
            username: 'gideon.akussah',
            must_change_password: true,
            email_verified: true,
            is_active: true,
            session_version: 1,
          }],
        };
      }
      return { rows: [] };
    };

    const res = createResponse();
    await login(
      { body: { identifier: 'gideon.akussah', password: '15082012' } },
      res,
      assert.fail,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.username, 'gideon.akussah');
    assert.equal(res.body.user.must_change_password, true);
    assert.equal(queryCalls[0].values[0], 'gideon.akussah');
    assert.match(queryCalls[0].sql, /u\.role <> 'student' AND lower\(u\.email\)/);
    assert.doesNotMatch(queryCalls[0].sql, /LPAD\(s\.id::text/);
  } finally {
    pool.query = originalQuery;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});

test('students cannot use their school ID or email address as their login identifier', async () => {
  const originalQuery = pool.query;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-secret-for-student-login-123456789';

  try {
    pool.query = async (sql) => {
      if (/SELECT u\.id, u\.email/.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    for (const identifier of ['000017', 'student@example.invalid']) {
      const res = createResponse();
      await login(
        { body: { identifier, password: '15082012' } },
        res,
        assert.fail,
      );
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.message, 'Invalid credentials.');
    }
  } finally {
    pool.query = originalQuery;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
