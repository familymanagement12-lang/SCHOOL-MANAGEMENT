const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeClassConfiguration } = require('./classConfiguration');

test('allows creating a named class without a year level', () => {
  assert.deepEqual(normalizeClassConfiguration({}, { isNew: true }), {
    yearLevel: null,
    teachingModel: 'class_teacher',
    classCurriculum: 'UNASSIGNED',
  });
});

test('preserves existing configuration when editing without year-level fields', () => {
  assert.deepEqual(normalizeClassConfiguration({}), {
    yearLevel: null,
    teachingModel: null,
    classCurriculum: null,
  });
});

test('retains existing year-level curriculum rules when a year is supplied', () => {
  assert.deepEqual(normalizeClassConfiguration({ year_level: '5' }), {
    yearLevel: 5,
    teachingModel: null,
    classCurriculum: 'COMMON',
  });
  assert.throws(
    () => normalizeClassConfiguration({ year_level: '8' }),
    /Years 7–9 require either GES or Pearson curriculum/,
  );
});

test('rejects invalid year levels and teaching models', () => {
  assert.throws(() => normalizeClassConfiguration({ year_level: '12' }), /Year level must be between 1 and 11/);
  assert.throws(() => normalizeClassConfiguration({ teaching_model: 'invalid' }), /Teaching model must be/);
});
