const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { createClass, updateClass, deleteClass } = require('./classController');

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

test('class creation and deletion record reasoned audit snapshots transactionally', async () => {
  const originalConnect = pool.connect;
  const clients = [];
  const classRecord = {
    id: 21,
    school_id: 3,
    name: 'Pending Class',
    description: 'New group',
    teacher_id: null,
    class_teacher_id: null,
    year_level: null,
    teaching_model: null,
    curriculum: 'UNASSIGNED',
    education_stage: 'UNASSIGNED',
    programme: null,
  };
  pool.connect = async () => {
    const statements = [];
    const client = {
      statements,
      async query(sql, values = []) {
        statements.push({ sql, values });
        if (/INSERT INTO classes/.test(sql)) return { rows: [classRecord], rowCount: 1 };
        if (/SELECT id, name, description/.test(sql) && /FOR UPDATE/.test(sql)) {
          return { rows: [classRecord], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    clients.push(client);
    return client;
  };

  try {
    const createdResponse = createResponse();
    await createClass({
      user: { school_id: 3, id: 8 },
      body: {
        name: 'Pending Class',
        description: 'New group',
        class_teacher_id: '',
        education_stage: 'UNASSIGNED',
        curriculum: 'UNASSIGNED',
        change_reason: 'New class approved',
      },
    }, createdResponse, assert.fail);
    assert.equal(createdResponse.statusCode, 201);

    const creationAudit = clients[0].statements.find(({ sql }) => /INSERT INTO class_configuration_audit/.test(sql));
    assert.ok(creationAudit);
    assert.deepEqual(creationAudit.values.slice(0, 5), [3, 21, 8, 'CREATED', 'New class approved']);
    assert.deepEqual(JSON.parse(creationAudit.values[5]), {});
    assert.equal(JSON.parse(creationAudit.values[6]).name, 'Pending Class');
    assert.ok(clients[0].statements.some(({ sql }) => sql === 'COMMIT'));

    const deletedResponse = createResponse();
    await deleteClass({
      user: { school_id: 3, id: 8 },
      params: { id: 21 },
      body: { change_reason: 'Programme discontinued' },
    }, deletedResponse, assert.fail);
    assert.equal(deletedResponse.body.message, 'Class deleted successfully.');

    const deletionAudit = clients[1].statements.find(({ sql }) => /INSERT INTO class_configuration_audit/.test(sql));
    assert.ok(deletionAudit);
    assert.deepEqual(deletionAudit.values.slice(0, 5), [3, 21, 8, 'DELETED', 'Programme discontinued']);
    assert.equal(JSON.parse(deletionAudit.values[5]).name, 'Pending Class');
    assert.deepEqual(JSON.parse(deletionAudit.values[6]), {});
    assert.ok(clients[1].statements.findIndex(({ sql }) => /INSERT INTO class_configuration_audit/.test(sql))
      < clients[1].statements.findIndex(({ sql }) => /^DELETE FROM classes/.test(sql)));
    assert.ok(clients[1].statements.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    pool.connect = originalConnect;
  }
});

test('class creation and deletion reject missing audit reasons before connecting', async () => {
  const originalConnect = pool.connect;
  let connectCalled = false;
  pool.connect = async () => {
    connectCalled = true;
    throw new Error('Database connection must not be used.');
  };

  try {
    const createRes = createResponse();
    await createClass({
      user: { school_id: 3, id: 8 },
      body: { name: 'Pending Class' },
    }, createRes, assert.fail);
    assert.equal(createRes.statusCode, 400);

    const deleteRes = createResponse();
    await deleteClass({
      user: { school_id: 3, id: 8 },
      params: { id: 21 },
      body: {},
    }, deleteRes, assert.fail);
    assert.equal(deleteRes.statusCode, 400);
    assert.equal(connectCalled, false);
  } finally {
    pool.connect = originalConnect;
  }
});

test('class name and description changes are audited with the prior configuration', async () => {
  const originalConnect = pool.connect;
  const priorClass = {
    id: 21,
    school_id: 3,
    name: 'Pending Class',
    description: 'Existing details',
    year_level: null,
    curriculum: 'UNASSIGNED',
    teaching_model: null,
    education_stage: 'UNASSIGNED',
    programme: null,
    class_teacher_id: null,
    teacher_id: null,
  };
  const updatedClass = { ...priorClass, name: 'Renamed Class', description: 'Existing details' };
  const statements = [];
  pool.connect = async () => ({
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (/FOR UPDATE/.test(sql)) return { rows: [priorClass], rowCount: 1 };
      if (/UPDATE classes/.test(sql)) return { rows: [updatedClass], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });

  try {
    const res = createResponse();
    await updateClass({
      user: { school_id: 3, id: 8 },
      params: { id: 21 },
      body: { name: 'Renamed Class', change_reason: 'Correcting the class label' },
    }, res, assert.fail);
    assert.equal(res.body.name, 'Renamed Class');

    const audit = statements.find(({ sql }) => /INSERT INTO class_configuration_audit/.test(sql));
    assert.ok(audit);
    assert.equal(audit.values[3], 'UPDATED');
    assert.equal(audit.values[4], 'Correcting the class label');
    assert.equal(JSON.parse(audit.values[5]).name, 'Pending Class');
    assert.equal(JSON.parse(audit.values[5]).description, 'Existing details');
    assert.equal(JSON.parse(audit.values[6]).name, 'Renamed Class');
    assert.equal(JSON.parse(audit.values[6]).description, 'Existing details');
    assert.ok(statements.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    pool.connect = originalConnect;
  }
});
