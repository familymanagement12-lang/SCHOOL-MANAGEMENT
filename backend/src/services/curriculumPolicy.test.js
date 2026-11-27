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

test('year levels never infer curriculum and unassigned values remain explicit', () => {
  assert.equal(curriculumForYearLevel(5), 'UNASSIGNED');
  assert.equal(curriculumForYearLevel(5, 'COMMON'), 'COMMON');
  assert.equal(curriculumForYearLevel(8), 'UNASSIGNED');
  assert.equal(curriculumForYearLevel(10), 'UNASSIGNED');
  assert.equal(curriculumForYearLevel(10, 'PEARSON'), 'PEARSON');
  assert.throws(() => curriculumForYearLevel(0));
  assert.throws(() => curriculumForYearLevel(12));
});

test('section labels require explicit education-stage classification', () => {
  assert.equal(classStageLabel(2, 'COMMON', 'PRIMARY'), 'Year 2');
  assert.equal(classStageLabel(7, 'GES', 'JHS'), 'JHS 1');
  for (const year of [7, 8, 9, 10]) {
    assert.equal(classStageLabel(year, 'PEARSON', 'UNASSIGNED'), null);
  }
  assert.equal(canonicalClassName('Year 10 - A', 10, 'PEARSON', 'UNASSIGNED'), 'Year 10 - A');
  assert.equal(canonicalClassName('Year 7 - A', 7, 'GES', 'JHS'), 'JHS 1 - A');
  assert.equal(canonicalClassName('JHS 2', 8, 'GES', 'JHS'), 'JHS 2');
  assert.equal(canonicalClassName('Blue', 6, 'COMMON', 'PRIMARY'), 'Year 6 - Blue');
});

test('confirmed Year 6 transition options remain available', () => {
  assert.deepEqual(nextClassStages(6, 'COMMON'), [
    { year_level: 7, curriculum: 'GES' },
    { year_level: 7, curriculum: 'PEARSON' },
  ]);
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
