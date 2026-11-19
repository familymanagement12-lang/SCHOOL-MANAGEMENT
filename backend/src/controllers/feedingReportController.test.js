const test = require('node:test');
const assert = require('node:assert/strict');
const { dateRange } = require('./feedingReportController');

test('daily, weekly, and monthly feeding report ranges use actual calendar boundaries', () => {
  assert.deepEqual(dateRange('daily', '2026-10-14'), {
    startDate: '2026-10-14',
    endDate: '2026-10-14',
  });
  assert.deepEqual(dateRange('weekly', '2026-10-18'), {
    startDate: '2026-10-12',
    endDate: '2026-10-18',
  });
  assert.deepEqual(dateRange('monthly', '2026-02-14'), {
    startDate: '2026-02-01',
    endDate: '2026-02-28',
  });
});
