const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const {
  createSubject,
  upsertSubjectClassAssignment,
  updateSubject,
} = require('./subjectController');

const response = () => ({
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

test('creating a subject requires an explicit curriculum selection', async () => {
  let connected = false;
  const originalConnect = pool.connect;
  pool.connect = async () => {
    connected = true;
    throw new Error('A database connection is not expected in this test.');
  };
  try {
    const res = response();
    await createSubject({ user: { school_id: 1 }, body: { name: 'Mathematics' } }, res, assert.fail);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /one or more valid curricula/);
    assert.equal(connected, false);
  } finally {
    pool.connect = originalConnect;
  }
});

test('unclassified classes cannot receive subject assignments', async () => {
  const originalQuery = pool.query;
  const statements = [];
  pool.query = async (sql) => {
    statements.push(sql);
    if (/SELECT c\.id FROM classes/.test(sql)) return { rows: [] };
    if (/SELECT education_stage, curriculum FROM classes/.test(sql)) {
      return { rows: [{ education_stage: 'UNASSIGNED', curriculum: 'UNASSIGNED' }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const res = response();
    await upsertSubjectClassAssignment({
      user: { school_id: 1, id: 8 },
      body: { class_id: 3, subject_id: 4, curriculum: 'COMMON' },
    }, res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /education section and curriculum/);
    assert.match(statements[0], /education_stage <> 'UNASSIGNED'/);
    assert.match(statements[0], /applicable_year_levels/);
  } finally {
    pool.query = originalQuery;
  }
});

test('curriculum-incompatible subject assignments are rejected', async () => {
  const originalQuery = pool.query;
  const statements = [];
  pool.query = async (sql) => {
    statements.push(sql);
    if (/SELECT c\.id FROM classes/.test(sql)) return { rows: [] };
    if (/SELECT education_stage, curriculum FROM classes/.test(sql)) {
      return { rows: [{ education_stage: 'PRIMARY', curriculum: 'COMMON' }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const res = response();
    await upsertSubjectClassAssignment({
      user: { school_id: 1, id: 8 },
      body: { class_id: 3, subject_id: 4, curriculum: 'GES' },
    }, res, assert.fail);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /not valid for this class curriculum/);
    assert.match(statements[0], /s\.applicable_education_stages IS NOT NULL/);
    assert.match(statements[0], /c\.education_stage = ANY\(s\.applicable_education_stages\)/);
  } finally {
    pool.query = originalQuery;
  }
});

test('subject edits retain stored applicability when request omits optional applicability fields', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  let compatibilityValues;
  const client = {
    async query(sql, values = []) {
      statements.push(sql);
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (/SELECT applicable_education_stages, applicable_year_levels/.test(sql)) {
        return {
          rows: [{
            applicable_education_stages: ['JHS'],
            applicable_year_levels: [7],
          }],
          rowCount: 1,
        };
      }
      if (/FROM subject_class_assignments a/.test(sql)) {
        compatibilityValues = values;
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  try {
    const res = response();
    await updateSubject({
      user: { school_id: 1 },
      params: { id: 4 },
      body: { name: 'Mathematics', curricula: ['GES'] },
    }, res, assert.fail);

    assert.equal(res.statusCode, 409);
    assert.deepEqual(compatibilityValues.slice(3), [['JHS'], [7]]);
    assert.equal(statements.includes('ROLLBACK'), true);
  } finally {
    pool.connect = originalConnect;
  }
});
