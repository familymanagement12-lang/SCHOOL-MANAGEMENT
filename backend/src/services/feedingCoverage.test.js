const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateCoverage,
  getCoverageStartDate,
  isSchoolDay,
  listSchoolDays,
} = require('./feedingCoverage');

test('one hundred cedis at twenty per school day covers five days', () => {
  assert.deepEqual(calculateCoverage({ amountReceived: 100, dailyRate: 20 }), {
    amountReceivedCents: 10000,
    creditAppliedCents: 0,
    daysCovered: 5,
    creditAddedCents: 0,
  });
});

test('ninety-five cedis at twenty per school day covers four days and retains fifteen cedis credit', () => {
  assert.deepEqual(calculateCoverage({ amountReceived: 95, dailyRate: 20 }), {
    amountReceivedCents: 9500,
    creditAppliedCents: 0,
    daysCovered: 4,
    creditAddedCents: 1500,
  });
});

test('unused feeding credit combines with a later payment without losing cents', () => {
  assert.deepEqual(calculateCoverage({ amountReceived: 5, dailyRate: 20, existingCredit: 15 }), {
    amountReceivedCents: 500,
    creditAppliedCents: 1500,
    daysCovered: 1,
    creditAddedCents: 0,
  });
});

test('feeding coverage excludes weekends, holidays, and vacation periods', () => {
  const events = [
    { event_type: 'holiday', start_date: '2026-11-16', end_date: '2026-11-16' },
    { event_type: 'vacation', start_date: '2026-11-18', end_date: '2026-11-19' },
  ];
  assert.equal(isSchoolDay('2026-11-14', events), false);
  assert.equal(isSchoolDay('2026-11-16', events), false);
  assert.deepEqual(listSchoolDays('2026-11-13', 4, events), [
    '2026-11-13', '2026-11-17', '2026-11-20', '2026-11-23',
  ]);
});

test('a calendar school-day exception may add a feeding day during a holiday', () => {
  const events = [
    { event_type: 'holiday', start_date: '2026-11-16', end_date: '2026-11-16' },
    { event_type: 'school_day', start_date: '2026-11-16', end_date: '2026-11-16' },
  ];
  assert.equal(isSchoolDay('2026-11-16', events), true);
});

test('additional payments continue from the next eligible date after existing coverage', () => {
  assert.equal(getCoverageStartDate('2026-11-13', '2026-11-17'), '2026-11-18');
  assert.equal(getCoverageStartDate('2026-11-20', '2026-11-17'), '2026-11-20');
});
