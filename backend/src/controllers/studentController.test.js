const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { createStudent } = require('./studentController');

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

test('new student accounts are active, linked, and require a first-login password change', async () => {
  const originalConnect = pool.connect;
  let userInsert;
  const statements = [];
  pool.connect = async () => ({
    async query(sql, values) {
      statements.push(sql);
      if (/INSERT INTO students/.test(sql)) {
        return { rows: [{ id: 17, student_id: '000017', name: 'Gideon Senanu Akussah' }] };
      }
      if (/SELECT id FROM users/.test(sql)) return { rows: [] };
      if (/INSERT INTO users/.test(sql)) {
        userInsert = { sql, values };
        return { rows: [{ id: 29 }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });

  try {
    const res = createResponse();
    await createStudent({
      user: { school_id: 1, id: 2 },
      body: { name: 'Gideon Senanu Akussah', dob: '2012-08-15' },
    }, res, assert.fail);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.username, 'gideon.akussah');
    assert.equal(res.body.studentPassword, '15082012');
    assert.equal(res.body.account_active, true);
    assert.equal(res.body.account_requires_activation, false);
    assert.match(userInsert.sql, /'student',TRUE,TRUE,TRUE,\$5/);
    assert.equal(userInsert.values[4], 'gideon.akussah');
    assert.ok(statements.includes('COMMIT'));
  } finally {
    pool.connect = originalConnect;
  }
});
