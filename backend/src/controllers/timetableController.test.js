const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');
const { createMissingDatabaseSchemaHandler } = require('../middleware/databaseSchemaError');
const { getVersions } = require('./timetableController');

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

test('timetable and AI request services contain no runtime DDL or schema bootstrap', () => {
  const files = [
    path.join(__dirname, 'timetableController.js'),
    path.join(__dirname, '../services/aiAssistantService.js'),
  ];
  const ddl = /\b(?:CREATE\s+(?:TABLE|INDEX|UNIQUE|OR\s+REPLACE|EXTENSION|FUNCTION|TRIGGER|TYPE|POLICY)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|CONSTRAINT))\b/i;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, ddl, `${path.basename(file)} must not execute request-time DDL`);
    assert.doesNotMatch(source, /ensureSchema|schemaSql/);
  }
});

test('timetable versions reads existing schema without issuing DDL', async () => {
  const originalQuery = pool.query;
  const statements = [];
  pool.query = async (sql) => {
    statements.push(sql);
    if (/FROM timetable_versions/.test(sql)) return { rows: [] };
    if (/FROM schools/.test(sql)) {
      return { rows: [{ academic_year: '2026/2027', current_term: 'Term 1' }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const res = createResponse();
    await getVersions({ user: { school_id: 1, role: 'admin' } }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(statements.map((sql) => sql.trim().split(/\s+/)[0].toUpperCase()), ['SELECT', 'SELECT']);
    assert.deepEqual(res.body.academic_years, ['2026/2027']);
  } finally {
    pool.query = originalQuery;
  }
});

test('missing timetable schema is returned as a controlled service-unavailable error', async () => {
  const originalQuery = pool.query;
  pool.query = async () => {
    throw Object.assign(new Error('relation "timetable_versions" does not exist'), { code: '42P01' });
  };

  try {
    const req = { user: { school_id: 1, role: 'admin' } };
    const res = createResponse();
    let forwardedError;
    await getVersions(req, res, (error) => { forwardedError = error; });

    const handler = createMissingDatabaseSchemaHandler(
      'Timetable database schema is unavailable. Apply the versioned timetable migrations before retrying.'
    );
    handler(forwardedError, req, res, assert.fail);

    assert.equal(res.statusCode, 503);
    assert.match(res.body.message, /versioned timetable migrations/);
  } finally {
    pool.query = originalQuery;
  }
});
