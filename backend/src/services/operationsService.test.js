const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateKitchenCosts,
  estimateKitchenCostForRange,
  estimateKitchenQuantityForRange,
  summarizeFinancialEntries,
} = require('./operationsService');

test('kitchen estimates use the selected frequency and actual calendar month length', () => {
  const item = {
    estimated_quantity: 10,
    estimated_unit_cost: 2,
    purchasing_frequency: 'weekly',
    expected_monthly_quantity: null,
  };
  assert.deepEqual(estimateKitchenCosts(item, new Date('2026-02-01T00:00:00Z')), {
    estimated_weekly_cost: 20,
    estimated_monthly_cost: 80,
  });
  assert.equal(estimateKitchenCosts({ ...item, purchasing_frequency: 'monthly' }, new Date('2026-02-01T00:00:00Z')).estimated_monthly_cost, 20);
  assert.equal(estimateKitchenCosts({ ...item, expected_monthly_quantity: 12 }, new Date('2026-02-01T00:00:00Z')).estimated_monthly_cost, 24);
});

test('weekly summaries include multiple entries per day, period weekday totals, and weekend transactions', () => {
  const report = summarizeFinancialEntries([
    { transaction_date: '2026-11-16', transaction_type: 'revenue', amount: '100' },
    { transaction_date: '2026-11-16', transaction_type: 'revenue', amount: '25' },
    { transaction_date: '2026-11-17', transaction_type: 'expense', amount: '40' },
    { transaction_date: '2026-11-21', transaction_type: 'expense', amount: '10' },
  ], { startDate: '2026-11-16', endDate: '2026-11-22' });

  assert.equal(report.weeks.length, 1);
  assert.equal(report.weeks[0].week_start, '2026-11-16');
  assert.equal(report.weeks[0].weekdays[0].revenue, 125);
  assert.equal(report.weeks[0].weekdays[1].expenses, 40);
  assert.equal(report.weeks[0].other_days_expenses, 10);
  assert.equal(report.total_revenue, 125);
  assert.equal(report.total_expenses, 50);
  assert.equal(report.net_balance, 75);
  assert.equal(report.weekday_totals[0].revenue, 125);
  assert.equal(report.average_daily_revenue, 25);
  assert.equal(report.average_daily_expenses, 10);
});

test('weekly summaries retain empty weeks across the selected range', () => {
  const report = summarizeFinancialEntries([], { startDate: '2026-11-16', endDate: '2026-11-29' });
  assert.deepEqual(report.weeks.map((week) => week.week_start), ['2026-11-16', '2026-11-23']);
});

test('kitchen period estimates prorate partial calendar months without assuming four weeks', () => {
  const item = {
    estimated_quantity: 7,
    estimated_unit_cost: 10,
    purchasing_frequency: 'weekly',
  };
  assert.equal(estimateKitchenCostForRange(item, '2026-02-01', '2026-02-28'), 280);
  assert.equal(estimateKitchenCostForRange(item, '2026-02-15', '2026-02-28'), 140);
  assert.equal(estimateKitchenQuantityForRange(item, '2026-02-01', '2026-02-28'), 28);
  assert.equal(estimateKitchenQuantityForRange(item, '2026-02-15', '2026-02-28'), 14);
});