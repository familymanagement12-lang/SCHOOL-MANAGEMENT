const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAssignmentInput, canSubmit, isValidSchoolDateTime } = require('./assignmentPolicy');

const validAssignment = {
  title: 'Fractions practice',
  instructions: 'Complete the questions in your exercise book.',
  category: 'homework',
  submission_method: 'both',
  total_marks: 20,
  issue_at: '2026-11-26T08:00',
  due_at: '2026-11-27T15:00',
  selected_student_ids: [4, 7],
};

test('valid assignment input is normalized without losing the recipient selection', () => {
  const result = validateAssignmentInput({ ...validAssignment, title: '  Fractions practice  ' });
  assert.equal(result.error, undefined);
  assert.equal(result.value.title, 'Fractions practice');
  assert.deepEqual(result.value.selected_student_ids, [4, 7]);
});

test('assignment validation rejects invalid dates, marks and duplicate students', () => {
  assert.match(validateAssignmentInput({ ...validAssignment, due_at: '2026-02-31T12:00' }).error, /due date/);
  assert.match(validateAssignmentInput({ ...validAssignment, total_marks: 0 }).error, /Total marks/);
  assert.match(validateAssignmentInput({ ...validAssignment, selected_student_ids: [4, 4] }).error, /more than once/);
});

test('school-local datetime validation rejects impossible dates and times', () => {
  assert.equal(isValidSchoolDateTime('2026-11-27T15:00'), true);
  assert.equal(isValidSchoolDateTime('2026-11-27T25:00'), false);
  assert.equal(isValidSchoolDateTime('2026-02-31T15:00'), false);
});

test('late submissions are allowed only when the assignment permits them', () => {
  const now = new Date('2026-11-27T16:00:00Z');
  assert.equal(canSubmit({ dueAt: '2026-11-27T15:00:00Z', allowLate: false, now }), false);
  assert.equal(canSubmit({ dueAt: '2026-11-27T15:00:00Z', allowLate: true, now }), true);
});
