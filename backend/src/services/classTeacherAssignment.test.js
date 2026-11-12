const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeClassTeacherAssignment } = require('./classTeacherAssignment');

test('allows creating a class without a teacher assignment', () => {
  assert.deepEqual(normalizeClassTeacherAssignment(undefined), { provided: false, teacherId: null });
  assert.deepEqual(normalizeClassTeacherAssignment(''), { provided: true, teacherId: null });
  assert.deepEqual(normalizeClassTeacherAssignment(null), { provided: true, teacherId: null });
});

test('normalizes a selected teacher ID', () => {
  assert.deepEqual(normalizeClassTeacherAssignment('12'), { provided: true, teacherId: 12 });
});

test('rejects invalid teacher IDs', () => {
  for (const value of ['abc', '0', '-1', '1.5']) {
    assert.throws(() => normalizeClassTeacherAssignment(value), /Select an active teacher/);
  }
});
