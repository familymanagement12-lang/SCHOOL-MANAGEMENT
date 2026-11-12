const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateClassScore } = require('./classScore');

test('scales pooled exercise and mid-semester marks to a class score out of 50', () => {
  assert.equal(calculateClassScore(42, 60), 35);
});

test('rounds the class score to two decimal places', () => {
  assert.equal(calculateClassScore(1, 3), 16.67);
});

test('returns zero when there are no assessments or possible marks', () => {
  assert.equal(calculateClassScore(0, 0), 0);
});

test('rejects invalid totals and non-finite marks by returning zero', () => {
  assert.equal(calculateClassScore(10, -1), 0);
  assert.equal(calculateClassScore(Number.NaN, 20), 0);
});
