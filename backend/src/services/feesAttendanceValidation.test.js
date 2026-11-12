const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeeStructure } = require('../controllers/feeStructureController');
const { recordStaffAttendance } = require('../controllers/attendanceController');

const invoke = async (handler, req) => {
  let status = 200;
  let body;
  await handler(req, {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  }, (error) => { throw error; });
  return { status, body };
};

const feeRequest = (overrides = {}) => ({
  user: { school_id: 1, id: 1 },
  body: {
    academic_year: '2026/2027',
    term: 'First Term',
    class_ids: [1],
    items: [{ fee_name: 'Tuition', amount: 100 }],
    ...overrides,
  },
});

test('rejects invalid class fee structures and malformed per-student adjustments', async () => {
  assert.equal((await invoke(createFeeStructure, feeRequest({ class_ids: [] }))).status, 400);
  assert.equal((await invoke(createFeeStructure, feeRequest({ class_ids: [1, 1] }))).status, 400);
  assert.equal((await invoke(createFeeStructure, feeRequest({ items: [{ fee_name: 'Tuition', amount: -1 }] }))).status, 400);
  assert.equal((await invoke(createFeeStructure, feeRequest({ items: [{ fee_name: 'Tuition', amount: '' }] }))).status, 400);
  assert.equal((await invoke(createFeeStructure, feeRequest({
    student_overrides: [{ student_id: 7, amount_due: 80 }],
  }))).status, 400);
  assert.equal((await invoke(createFeeStructure, feeRequest({
    student_overrides: [{ student_id: 7, amount_due: '', reason: 'Scholarship' }],
  }))).status, 400);
  assert.equal((await invoke(createFeeStructure, feeRequest({
    student_overrides: [{ student_id: 0, amount_due: 80, reason: 'Scholarship' }],
  }))).status, 400);
});

test('requires a reason when staff attendance is marked absent', async () => {
  const response = await invoke(recordStaffAttendance, {
    user: { school_id: 1, id: 1 },
    body: {
      date: '2026-11-12',
      records: [{ employee_id: 4, status: 'absent', reason: '' }],
    },
  });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /reason when absent/);
});

test('rejects invalid staff attendance dates, statuses, and duplicate staff entries', async () => {
  const base = { user: { school_id: 1, id: 1 }, body: { date: '2026-11-12', records: [] } };
  assert.equal((await invoke(recordStaffAttendance, { ...base, body: { ...base.body, date: '2026-02-30', records: [{ employee_id: 1, status: 'present' }] } })).status, 400);
  assert.equal((await invoke(recordStaffAttendance, { ...base, body: { ...base.body, records: [{ employee_id: 1, status: 'holiday' }] } })).status, 400);
  assert.equal((await invoke(recordStaffAttendance, { ...base, body: { ...base.body, records: [{ employee_id: 1, status: 'present' }, { employee_id: 1, status: 'late' }] } })).status, 400);
});
