const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classConfigurationChanged,
  classSubjectConfigurationChanged,
  normalizeClassConfiguration,
} = require('./classConfiguration');

test('new classes can remain explicitly pending without inferred curriculum or teaching model', () => {
  assert.deepEqual(normalizeClassConfiguration({}, { isNew: true }), {
    yearLevel: null,
    teachingModel: null,
    classCurriculum: 'UNASSIGNED',
    educationStage: 'UNASSIGNED',
    programme: null,
  });
});

test('Early Years classification does not require or infer a numeric level or curriculum', () => {
  assert.deepEqual(normalizeClassConfiguration({
    education_stage: 'EARLY_YEARS',
    teaching_model: 'class_teacher',
  }), {
    yearLevel: null,
    teachingModel: 'class_teacher',
    classCurriculum: 'UNASSIGNED',
    educationStage: 'EARLY_YEARS',
    programme: null,
  });
  assert.throws(
    () => normalizeClassConfiguration({
      education_stage: 'EARLY_YEARS',
      year_level: 1,
      teaching_model: 'class_teacher',
    }),
    /Early Years classes do not use a numeric year level/
  );
});

test('Primary classification requires a confirmed level without inferring curriculum', () => {
  assert.throws(
    () => normalizeClassConfiguration({ education_stage: 'PRIMARY', teaching_model: 'class_teacher' }),
    /Primary classes require a confirmed year level/
  );
  assert.equal(normalizeClassConfiguration({
    education_stage: 'PRIMARY',
    year_level: 4,
    class_teacher_id: 17,
    teaching_model: 'subject_teacher',
  }).classCurriculum, 'UNASSIGNED');
  assert.equal(normalizeClassConfiguration({
    education_stage: 'PRIMARY',
    year_level: 4,
    class_teacher_id: 17,
    curriculum: 'COMMON',
    teaching_model: 'class_teacher',
  }).classCurriculum, 'COMMON');
  assert.equal(normalizeClassConfiguration({
    education_stage: 'PRIMARY',
    year_level: 3,
    class_teacher_id: 17,
    teaching_model: 'class_teacher',
  }).teachingModel, 'class_teacher');
  assert.throws(
    () => normalizeClassConfiguration({
      education_stage: 'PRIMARY',
      year_level: 4,
      curriculum: 'COMMON',
      teaching_model: 'class_teacher',
    }),
    /Assign a class teacher/
  );
  assert.throws(
    () => normalizeClassConfiguration({
      education_stage: 'PRIMARY',
      year_level: 3,
      class_teacher_id: 17,
      teaching_model: 'subject_teacher',
    }),
    /Primary years 1 to 3 use the class-teacher/
  );
});

test('JHS requires explicit level and subject-teacher model while retaining explicit curriculum', () => {
  const jhs = normalizeClassConfiguration({
    education_stage: 'JHS',
    year_level: 8,
    curriculum: 'UNASSIGNED',
    teaching_model: 'subject_teacher',
  });
  assert.equal(jhs.yearLevel, 8);
  assert.equal(jhs.classCurriculum, 'UNASSIGNED');
  assert.equal(normalizeClassConfiguration({
    education_stage: 'JHS',
    year_level: 8,
    curriculum: 'PEARSON',
    teaching_model: 'subject_teacher',
  }).classCurriculum, 'PEARSON');
  assert.throws(
    () => normalizeClassConfiguration({
      education_stage: 'JHS',
      year_level: 10,
      curriculum: 'GES',
      teaching_model: 'subject_teacher',
    }),
    /JHS classes require a confirmed level from 7 to 9/
  );
  assert.throws(
    () => normalizeClassConfiguration({
      education_stage: 'JHS',
      year_level: 8,
      curriculum: 'GES',
      teaching_model: 'class_teacher',
    }),
    /JHS classes use the subject-teacher/
  );
});

test('Other programmes require a programme label', () => {
  assert.throws(
    () => normalizeClassConfiguration({ education_stage: 'OTHER', teaching_model: 'class_teacher' }),
    /programme name/
  );
  assert.equal(normalizeClassConfiguration({
    education_stage: 'OTHER',
    programme: 'Montessori',
    teaching_model: 'class_teacher',
  }).programme, 'Montessori');
});

test('Year 7–10 remain unclassified unless an administrator selects a section', () => {
  for (const year of [7, 8, 9, 10]) {
    assert.throws(
      () => normalizeClassConfiguration({ year_level: year, curriculum: 'UNASSIGNED' }),
      /Confirm the education stage/
    );
  }
});

test('existing unresolved numeric levels can be preserved but not changed implicitly', () => {
  const existing = {
    education_stage: 'UNASSIGNED',
    year_level: 10,
    curriculum: 'UNASSIGNED',
    teaching_model: 'subject_teacher',
  };
  assert.equal(normalizeClassConfiguration(existing, { existing }).yearLevel, 10);
  assert.throws(
    () => normalizeClassConfiguration({ ...existing, year_level: 9 }, { existing }),
    /Confirm the education stage/
  );
});

test('invalid levels, classifications, and teaching models are rejected', () => {
  assert.throws(() => normalizeClassConfiguration({ year_level: 12 }), /Year level must be between 1 and 11/);
  assert.throws(() => normalizeClassConfiguration({ education_stage: 'UNKNOWN' }), /Select Early Years/);
  assert.throws(() => normalizeClassConfiguration({
    education_stage: 'PRIMARY',
    year_level: 2,
    teaching_model: 'invalid',
  }), /Teaching model must be/);
});

test('classification and curriculum changes are detectable for audit requirements', () => {
  const current = {
    education_stage: 'UNASSIGNED',
    year_level: null,
    curriculum: 'UNASSIGNED',
    teaching_model: null,
    programme: null,
    class_teacher_id: null,
  };
  const unchanged = {
    yearLevel: null,
    teachingModel: null,
    classCurriculum: 'UNASSIGNED',
    educationStage: 'UNASSIGNED',
    programme: null,
    classTeacherId: null,
  };
  assert.equal(classConfigurationChanged(current, unchanged), false);
  assert.equal(classConfigurationChanged(current, {
    ...unchanged,
    educationStage: 'PRIMARY',
    yearLevel: 1,
  }), true);
  assert.equal(classConfigurationChanged(current, {
    ...unchanged,
    classCurriculum: 'GES',
  }), true);
  assert.equal(classSubjectConfigurationChanged(current, unchanged), false);
  assert.equal(classSubjectConfigurationChanged(current, {
    ...unchanged,
    educationStage: 'PRIMARY',
  }), true);
});
