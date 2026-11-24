const test = require('node:test');
const assert = require('node:assert/strict');
const {
  curriculumForYearLevel,
  classStageLabel,
  canonicalClassName,
  nextClassStages,
  isNextClassStage,
  pathwayProgression,
} = require('./curriculumPolicy');

test('Years 1–6 always use the common curriculum', () => {
  for (let year = 1; year <= 6; year += 1) {
    assert.equal(curriculumForYearLevel(year), 'COMMON');
    assert.throws(() => curriculumForYearLevel(year, 'GES'));
  }
});

test('Years 7–9 require and preserve their selected pathway', () => {
  for (let year = 7; year <= 9; year += 1) {
    assert.throws(() => curriculumForYearLevel(year));
    assert.equal(curriculumForYearLevel(year, 'GES'), 'GES');
    assert.equal(curriculumForYearLevel(year, 'PEARSON'), 'PEARSON');
  }
});

test('Years 10–11 are automatically Pearson and reject GES or Common', () => {
  for (let year = 10; year <= 11; year += 1) {
    assert.equal(curriculumForYearLevel(year), 'PEARSON');
    assert.equal(curriculumForYearLevel(year, 'PEARSON'), 'PEARSON');
    assert.throws(() => curriculumForYearLevel(year, 'GES'));
    assert.throws(() => curriculumForYearLevel(year, 'COMMON'));
  }
});

test('unsupported year levels are rejected', () => {
  assert.throws(() => curriculumForYearLevel(0));
  assert.throws(() => curriculumForYearLevel(12));
});

test('Year 6 transitions to the correct GES and Pearson class names', () => {
  assert.deepEqual(nextClassStages(6, 'COMMON'), [
    { year_level: 7, curriculum: 'GES' },
    { year_level: 7, curriculum: 'PEARSON' },
  ]);
  assert.equal(classStageLabel(7, 'GES'), 'JHS 1');
  assert.equal(classStageLabel(7, 'PEARSON'), 'Year 7');
  assert.deepEqual(pathwayProgression('GES').map(({ label }) => label), ['Year 6', 'JHS 1', 'JHS 2', 'JHS 3']);
  assert.deepEqual(pathwayProgression('PEARSON').map(({ label }) => label), [
    'Year 6', 'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11',
  ]);
});

test('promotion follows only the selected pathway and stops at its final stage', () => {
  assert.equal(isNextClassStage(
    { year_level: 7, curriculum: 'GES' },
    { year_level: 8, curriculum: 'GES' },
  ), true);
  assert.equal(isNextClassStage(
    { year_level: 7, curriculum: 'GES' },
    { year_level: 8, curriculum: 'PEARSON' },
  ), false);
  assert.equal(isNextClassStage(
    { year_level: 10, curriculum: 'PEARSON' },
    { year_level: 11, curriculum: 'PEARSON' },
  ), true);
  assert.deepEqual(nextClassStages(9, 'GES'), []);
  assert.deepEqual(nextClassStages(11, 'PEARSON'), []);
});

test('GES class names are normalized to JHS labels while Pearson labels remain Year labels', () => {
  assert.equal(canonicalClassName('Year 7 - A', 7, 'GES'), 'JHS 1 - A');
  assert.equal(canonicalClassName('JHS 2', 8, 'GES'), 'JHS 2');
  assert.equal(canonicalClassName('JHS 1 - B', 7, 'PEARSON'), 'Year 7 - B');
  assert.equal(canonicalClassName('Blue', 6, 'COMMON'), 'Blue');
});
