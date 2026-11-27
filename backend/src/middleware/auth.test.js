const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticate } = require('./auth');

const runAuthenticate = (account, queryError, role = 'teacher') => new Promise((resolve) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-at-least-32-characters';
  const token = jwt.sign({ id: 7, school_id: 3, role, session_version: 2 }, process.env.JWT_SECRET);
  const request = { headers: { authorization: `Bearer ${token}` } };
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) {
      this.body = body;
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
      resolve({ request, response: this });
    },
  };
  pool.query = async () => {
    if (queryError) throw queryError;
    return { rows: [account] };
  };
  authenticate(request, response, (error) => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    resolve({ request, response, error });
  });
});

test('authentication rejects stale assignment roles and fails closed when account verification fails', async () => {
  const originalQuery = pool.query;
  const originalSecret = process.env.JWT_SECRET;
  try {
    const staleRole = await runAuthenticate({ is_active: true, session_version: 2, role: 'teacher' }, null, 'admin');
    assert.equal(staleRole.response.statusCode, 401);
    assert.match(staleRole.response.body.message, /permissions changed/);
    assert.equal(staleRole.request.user, undefined);

    const unavailable = await runAuthenticate(null, new Error('account check unavailable'));
    assert.equal(unavailable.error.status, 503);
    assert.match(unavailable.error.message, /verification is temporarily unavailable/);
    assert.equal(unavailable.request.user, undefined);

    const valid = await runAuthenticate({ is_active: true, session_version: 2, role: 'teacher' }, null);
    assert.equal(valid.request.user.role, 'teacher');
    assert.equal(valid.response.statusCode, 200);
    assert.equal(valid.response.body, undefined);
  } finally {
    pool.query = originalQuery;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});

test('unauthenticated assignment requests stop before database account checks', () => {
  const originalQuery = pool.query;
  let queried = false;
  pool.query = async () => { queried = true; throw new Error('unexpected account lookup'); };
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    authenticate({ headers: {} }, response, assert.fail);
    assert.equal(response.statusCode, 401);
    assert.equal(queried, false);
  } finally {
    pool.query = originalQuery;
  }
});
