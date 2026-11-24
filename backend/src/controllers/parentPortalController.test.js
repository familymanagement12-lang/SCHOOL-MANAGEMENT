const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const parentPortal = require('./parentPortalController');
const authController = require('./authController');

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('parent cannot retrieve fees for an unlinked student ID', async () => {
  const originalQuery = pool.query;
  let queries = 0;
  pool.query = async () => {
    queries += 1;
    return { rowCount: 0, rows: [] };
  };
  const res = response();
  try {
    await parentPortal.getFees({
      user: { id: 8, school_id: 3, role: 'parent' },
      params: { studentId: '44' },
    }, res, (error) => { throw error; });
  } finally {
    pool.query = originalQuery;
  }
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Child not found in your linked accounts.');
  assert.equal(queries, 1);
});

test('suspended parent tokens cannot access parent APIs', async () => {
  const originalQuery = pool.query;
  pool.query = async (_sql, values) => {
    assert.deepEqual(values, [8, 3]);
    return { rowCount: 0, rows: [] };
  };
  const res = response();
  let continued = false;
  try {
    await parentPortal.requireActiveParent({
      user: { id: 8, school_id: 3, role: 'parent' },
    }, res, () => { continued = true; });
  } finally {
    pool.query = originalQuery;
  }
  assert.equal(res.statusCode, 403);
  assert.equal(continued, false);
  assert.equal(res.body.message, 'This parent account is inactive.');
});

test('parent results query is limited to published results and the linked child', async () => {
  const originalQuery = pool.query;
  let resultQuery = '';
  pool.query = async (sql, values) => {
    if (sql.includes('SELECT s.id, s.name')) {
      return {
        rowCount: 1,
        rows: [{ id: 44, name: 'Student', class_id: 2, academic_year: '2026/2027', current_term: 'Term 1' }],
      };
    }
    if (sql.includes('INSERT INTO parent_portal_audit_log')) return { rowCount: 1, rows: [] };
    resultQuery = sql;
    assert.deepEqual(values, [3, 44]);
    return { rowCount: 0, rows: [] };
  };
  const res = response();
  try {
    await parentPortal.getResults({
      user: { id: 8, school_id: 3, role: 'parent' },
      params: { studentId: '44' },
    }, res, (error) => { throw error; });
  } finally {
    pool.query = originalQuery;
  }
  assert.match(resultQuery, /is_published = TRUE/);
  assert.deepEqual(res.body, []);
});

test('parent login accepts the registered phone identifier', async () => {
  const originalQuery = pool.query;
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  const password = await bcrypt.hash('safe-test-password', 4);
  let loginQuery = '';
  pool.query = async (sql, values) => {
    loginQuery = sql;
    assert.deepEqual(values, ['+1 (415) 555-0199']);
    return {
      rowCount: 1,
      rows: [{
        id: 8, email: 'parent@example.test', password, role: 'parent',
        school_id: 3, name: 'Parent', is_active: true, must_change_password: false,
      }],
    };
  };
  const res = response();
  try {
    await authController.login({
      body: { identifier: '+1 (415) 555-0199', password: 'safe-test-password' },
    }, res, (error) => { throw error; });
  } finally {
    pool.query = originalQuery;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
  assert.match(loginQuery, /FROM parents p/);
  assert.match(loginQuery, /regexp_replace/);
  assert.equal(res.body.user.role, 'parent');
  assert.ok(res.body.token);
});
