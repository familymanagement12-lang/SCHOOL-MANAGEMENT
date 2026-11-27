const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const assignmentStorage = require('../services/assignmentStorage');
const {
  createAssignment,
  downloadAssignmentFile,
  getParentAssignments,
  getStudentAssignments,
  markSubmission,
  saveStudentDraft,
  uploadStudentSubmissionFiles,
} = require('./assignmentController');

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

test('student submission uploads use the student-owned submission path under the mounted API base URL', async () => {
  const originalConnect = pool.connect;
  const originalPutPrivateFile = assignmentStorage.putPrivateFile;
  const statements = [];
  pool.connect = async () => ({
    async query(sql) {
      statements.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (/FROM students st JOIN assignment_submissions/.test(sql)) return { rows: [{
        id: 5, submission_method: 'file', allow_late: false,
        due_at: new Date('2026-12-01T18:00:00Z'), issue_at: null,
        published_at: new Date('2026-11-27T08:00:00Z'), status: 'PUBLISHED',
        database_now: new Date('2026-11-27T09:00:00Z'), submission_id: 8,
        submission_status: 'ASSIGNED',
      }], rowCount: 1 };
      if (/SELECT COUNT\(\*\)::INTEGER AS n FROM assignment_submission_files/.test(sql)) {
        return { rows: [{ n: 0 }], rowCount: 1 };
      }
      if (/INSERT INTO assignment_submission_files/.test(sql)) return { rows: [{ id: 44 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });
  assignmentStorage.putPrivateFile = async () => ({
    storage_key: 'school/1/assignments/5/submissions/8/test',
    original_name: 'answer.png', content_type: 'image/png', file_size: 68,
  });

  try {
    const res = createResponse();
    await uploadStudentSubmissionFiles({
      baseUrl: '/api/student-portal',
      user: { school_id: 1, id: 22, role: 'student' },
      params: { id: '5' },
      files: [{ originalname: 'answer.png', buffer: Buffer.from('mock') }],
    }, res, assert.fail);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body, { files: [44] });
    assert.ok(statements.some((sql) => /FROM students st JOIN assignment_submissions/.test(sql)));
    assert.ok(statements.some((sql) => /INSERT INTO assignment_submission_files/.test(sql)));
    assert.equal(statements.at(-1), 'COMMIT');
  } finally {
    pool.connect = originalConnect;
    assignmentStorage.putPrivateFile = originalPutPrivateFile;
  }
});

test('parent cannot view or audit assignment records for an unlinked child', async () => {
  const originalQuery = pool.query;
  const statements = [];
  pool.query = async (sql) => {
    statements.push(sql);
    return { rows: [], rowCount: 0 };
  };
  try {
    const res = createResponse();
    await getParentAssignments({
      user: { school_id: 3, id: 17, role: 'parent' },
      params: { studentId: '42' },
    }, res, assert.fail);
    assert.equal(res.statusCode, 404);
    assert.match(statements[0], /student_parent/);
    assert.equal(statements.some((sql) => /INSERT INTO parent_portal_audit_log/.test(sql)), false);
    assert.equal(statements.some((sql) => /FROM assignment_recipients/.test(sql)), false);
  } finally {
    pool.query = originalQuery;
  }
});

test('teacher cannot mark a submission outside the teacher assignment scope', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  pool.connect = async () => ({
    async query(sql, values) {
      statements.push({ sql, values });
      if (/SELECT a\.\*/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  });
  try {
    const res = createResponse();
    await markSubmission({
      user: { school_id: 3, id: 17, role: 'teacher' },
      params: { id: '55', submissionId: '91' },
      body: { score: 8, feedback: '', private_notes: '', release: false, request_resubmission: false },
    }, res, assert.fail);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(statements[1].values, [3, '55', 'teacher', 17]);
    assert.equal(statements.some(({ sql }) => /INSERT INTO assignment_marks/.test(sql)), false);
    assert.equal(statements.at(-1).sql, 'ROLLBACK');
  } finally {
    pool.connect = originalConnect;
  }
});

test('teacher private marking notes are stored outside student-readable marks', async () => {
  const originalConnect=pool.connect;
  const statements=[];
  pool.connect=async()=>({
    async query(sql) {
      statements.push(sql);
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK') return {rows:[],rowCount:0};
      if(/SELECT a\.\*/.test(sql)) return {rows:[{id:55,status:'PUBLISHED',total_marks:10,allow_resubmission:false,title:'Quiz'}],rowCount:1};
      if(/SELECT \* FROM assignment_submissions/.test(sql)) return {rows:[{id:91,latest_version:1,student_id:42}],rowCount:1};
      if(/SELECT id FROM assignment_submission_versions/.test(sql)) return {rows:[{id:99}],rowCount:1};
      if(/SELECT COALESCE\(MAX\(revision\)/.test(sql)) return {rows:[{next_revision:1}],rowCount:1};
      if(/INSERT INTO assignment_marks/.test(sql)) return {rows:[{id:123}],rowCount:1};
      return {rows:[],rowCount:1};
    },release(){},
  });
  try {
    const res=createResponse();
    await markSubmission({
      user:{school_id:1,id:2,role:'teacher'},params:{id:'55',submissionId:'91'},
      body:{score:8,feedback:'Good',private_notes:'Check spelling',release:false,request_resubmission:false},
    },res,assert.fail);
    const markInsert=statements.find((sql)=>/INSERT INTO assignment_marks/.test(sql));
    assert.ok(markInsert);
    assert.doesNotMatch(markInsert,/private_notes/);
    assert.ok(statements.some((sql)=>/INSERT INTO assignment_mark_private_notes/.test(sql)));
    assert.equal(statements.at(-1),'COMMIT');
  } finally { pool.connect=originalConnect; }
});

test('student cannot download an attachment unless assigned to that published assignment', async () => {
  const originalQuery = pool.query;
  const originalGetPrivateFile = assignmentStorage.getPrivateFile;
  let statement;
  let storageRequested = false;
  pool.query = async (sql) => {
    statement = sql;
    return { rows: [], rowCount: 0 };
  };
  assignmentStorage.getPrivateFile = async () => { storageRequested = true; throw new Error('must not read storage'); };
  try {
    const res = createResponse();
    await downloadAssignmentFile({
      user: { school_id: 3, id: 17, role: 'student' },
      params: { id: '55', fileId: '72', fileType: 'reference' },
    }, res, assert.fail);
    assert.equal(res.statusCode, 404);
    assert.match(statement, /st\.user_id=\$4/);
    assert.match(statement, /a\.status='PUBLISHED'/);
    assert.equal(storageRequested, false);
  } finally {
    pool.query = originalQuery;
    assignmentStorage.getPrivateFile = originalGetPrivateFile;
  }
});

test('student assignment list is bound to the authenticated student and exposes only released marks', async () => {
  const originalQuery = pool.query;
  let query;
  let values;
  pool.query = async (sql, params) => {
    query = sql;
    values = params;
    return { rows: [], rowCount: 0 };
  };
  try {
    const res = createResponse();
    await getStudentAssignments({ user: { school_id: 3, id: 17, role: 'student' } }, res, assert.fail);
    assert.match(query, /st\.school_id=\$1 AND st\.user_id=\$2/);
    assert.match(query, /a\.status='PUBLISHED'/);
    assert.match(query, /m\.status='RELEASED'/);
    assert.doesNotMatch(query, /private_notes/);
    assert.deepEqual(values, [3, 17]);
  } finally {
    pool.query = originalQuery;
  }
});

test('student draft writes require an available published assignment within its deadline policy', async () => {
  const originalQuery = pool.query;
  let statement;
  let parameters;
  pool.query = async (sql, values) => {
    statement = sql;
    parameters = values;
    return { rows: [], rowCount: 0 };
  };
  try {
    const res = createResponse();
    const next = (error) => { if (error) throw error; };
    await saveStudentDraft({
      user: { school_id: 3, id: 17, role: 'student' },
      params: { id: '55' }, body: { answer: 'My draft' },
    }, res, next);
    assert.equal(res.statusCode, 409);
    assert.match(statement, /st\.user_id=\$4/);
    assert.match(statement, /COALESCE\(a\.issue_at,a\.published_at\)<=NOW\(\)/);
    assert.match(statement, /a\.due_at>=NOW\(\) OR a\.allow_late=TRUE/);
    assert.deepEqual(parameters, ['My draft', 3, '55', 17]);
  } finally {
    pool.query = originalQuery;
  }
});

test('assignment creation does not require an id route parameter', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  pool.connect = async () => ({
    async query(sql) {
      statements.push(sql);
      if (/FROM timetable_terms/.test(sql)) {
        return { rows: [{ id: 5, academic_year: '2026/2027', term: 'Term 1' }] };
      }
      if (/SELECT EXISTS \(/.test(sql)) return { rows: [{ allowed: true }] };
      if (/INSERT INTO learning_assignments/.test(sql)) return { rows: [{ id: 41 }] };
      if (/SELECT id FROM students/.test(sql)) return { rows: [{ id: 9 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });

  try {
    const res = createResponse();
    await createAssignment({
      user: { school_id: 1, id: 2, role: 'teacher' },
      params: {},
      body: {
        class_id: 3,
        subject_id: 4,
        term_id: 5,
        title: 'Assignment create regression',
        instructions: 'Submit the answer.',
        category: 'homework',
        submission_method: 'online',
        total_marks: 10,
        due_at: '2026-12-01T15:00',
        selected_student_ids: [9],
      },
    }, res, assert.fail);

    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body, { id: 41, status: 'DRAFT', recipient_count: 1 });
    assert.ok(statements.some((sql) => /INSERT INTO learning_assignments/.test(sql)));
    assert.equal(statements.at(-1), 'COMMIT');
  } finally {
    pool.connect = originalConnect;
  }
});
