const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const selectionController = require('./curriculumSelectionController');

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('parent pathway submissions require a linked child and never assign a class', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('FOR UPDATE OF s')) {
        return {
          rowCount: 1,
          rows: [{
            id: 44, name: 'Student', class_id: 12, curriculum: 'COMMON',
            year_level: 6, class_curriculum: 'COMMON',
            academic_year: '2026/2027', period_open: true,
          }],
        };
      }
      if (sql.includes('INSERT INTO curriculum_pathway_selections')) {
        return { rowCount: 1, rows: [{ id: 91, status: 'pending_approval', submitted_at: '2026-06-01T10:00:00Z' }] };
      }
      if (sql.includes('SELECT DISTINCT u.id')) return { rowCount: 1, rows: [{ id: 8 }] };
      if (sql.includes('INSERT INTO curriculum_selection_notification_log')) return { rowCount: 1, rows: [{ id: 1 }] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;
  const res = response();
  try {
    await selectionController.submitSelection({
      user: { id: 8, school_id: 3, role: 'parent' },
      params: { studentId: '44' },
      body: { curriculum: 'GES', class_id: 999 },
    }, res, (error) => { throw error; });
  } finally {
    pool.connect = originalConnect;
  }
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'pending_approval');
  assert.equal(statements.some((sql) => /UPDATE\s+students/i.test(sql)), false);
  assert.equal(statements.some((sql) => /class_id\s*=\s*\$1/i.test(sql)), false);
});

test('parent cannot submit a pathway choice for an unlinked student ID', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  pool.connect = async () => ({
    async query(sql) {
      statements.push(sql);
      if (sql.includes('FOR UPDATE OF s')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  const res = response();
  try {
    await selectionController.submitSelection({
      user: { id: 8, school_id: 3, role: 'parent' },
      params: { studentId: '44' },
      body: { curriculum: 'PEARSON' },
    }, res, (error) => { throw error; });
  } finally {
    pool.connect = originalConnect;
  }
  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /linked accounts/);
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO curriculum_pathway_selections')), false);
});

test('administrator approval records a decision but does not change the student class', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  let updatedStatus;
  pool.connect = async () => ({
    async query(sql, values) {
      statements.push(sql);
      if (sql.includes('FOR UPDATE') && sql.includes('FROM curriculum_pathway_selections')) {
        return {
          rowCount: 1,
          rows: [{
            id: 91, student_id: 44, student_name_snapshot: 'Student',
            parent_user_id: 8, academic_year: '2026/2027',
            request_type: 'initial_selection', selected_curriculum: 'GES',
            status: 'pending_approval',
          }],
        };
      }
      if (sql.includes('SET status = $1')) {
        updatedStatus = values[0];
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT DISTINCT u.id')) return { rowCount: 1, rows: [{ id: 8 }] };
      if (sql.includes('INSERT INTO curriculum_selection_notification_log')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  const res = response();
  try {
    await selectionController.decideSelection({
      user: { id: 2, school_id: 3, role: 'admin' },
      params: { selectionId: '91' },
      body: { decision: 'approve' },
    }, res, (error) => { throw error; });
  } finally {
    pool.connect = originalConnect;
  }
  assert.equal(res.body.status, 'approved_pending_class');
  assert.equal(updatedStatus, 'approved_pending_class');
  assert.equal(statements.some((sql) => /UPDATE\s+students/i.test(sql)), false);
});

test('class assignment is blocked until approval and validates the requested pathway stage', async () => {
  const originalConnect = pool.connect;
  let shouldAssignStudent = false;
  const selection = {
    id: 91, student_id: 44, student_name_snapshot: 'Student', parent_user_id: 8,
    academic_year: '2026/2027', request_type: 'initial_selection',
    selected_curriculum: 'GES', previous_curriculum: 'COMMON',
    status: 'approved_pending_class', current_class_id: 12,
    current_curriculum: 'COMMON', current_year_level: 6,
    current_class_curriculum: 'COMMON',
  };
  const res = response();
  pool.connect = async () => ({
    async query(sql) {
      if (sql.includes('FOR UPDATE OF selection, student')) return { rowCount: 1, rows: [{ ...selection, status: 'pending_approval' }] };
      if (sql.includes('FROM classes') && sql.includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [{ id: 18, name: 'JHS 1 - A', year_level: 7, curriculum: 'GES' }] };
      }
      if (/UPDATE\s+students/i.test(sql)) shouldAssignStudent = true;
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  try {
    await selectionController.assignSelectionClass({
      user: { id: 2, school_id: 3, role: 'admin' },
      params: { selectionId: '91' },
      body: { class_id: 18 },
    }, res, (error) => { throw error; });
  } finally {
    pool.connect = originalConnect;
  }
  assert.equal(res.statusCode, 409);
  assert.equal(shouldAssignStudent, false);

  const invalidRes = response();
  pool.connect = async () => ({
    async query(sql) {
      if (sql.includes('FOR UPDATE OF selection, student')) return { rowCount: 1, rows: [selection] };
      if (sql.includes('FROM classes') && sql.includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [{ id: 18, name: 'Year 7 - A', year_level: 7, curriculum: 'PEARSON' }] };
      }
      if (/UPDATE\s+students/i.test(sql)) shouldAssignStudent = true;
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  try {
    await selectionController.assignSelectionClass({
      user: { id: 2, school_id: 3, role: 'admin' },
      params: { selectionId: '91' },
      body: { class_id: 18 },
    }, invalidRes, (error) => { throw error; });
  } finally {
    pool.connect = originalConnect;
  }
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(shouldAssignStudent, false);
});
