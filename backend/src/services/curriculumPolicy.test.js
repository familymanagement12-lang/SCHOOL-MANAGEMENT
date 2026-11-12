const test = require('node:test');
const assert = require('node:assert/strict');
const { curriculumForYearLevel } = require('./curriculumPolicy');

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
