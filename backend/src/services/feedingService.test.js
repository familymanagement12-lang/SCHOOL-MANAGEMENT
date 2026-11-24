const test = require('node:test');
const assert = require('node:assert/strict');
const {
  allocateCents,
  allocateRefundCents,
  amountFromCents,
  listFeedingDays,
  moneyToCents,
  paymentStatus,
  periodRange,
  rateForDate,
} = require('./feedingService');

const term = {
  start_date: '2026-09-01',
  end_date: '2026-12-18',
  scheduled_weekdays: [1, 2, 3, 4, 5],
};

test('daily, weekly, monthly, and termly payment frequencies select their actual obligation periods', () => {
  assert.deepEqual(periodRange('daily', '2026-10-14', term), {
    startDate: '2026-10-14', endDate: '2026-10-14',
  });
  assert.deepEqual(periodRange('weekly', '2026-10-14', term), {
    startDate: '2026-10-12', endDate: '2026-10-18',
  });
  assert.deepEqual(periodRange('monthly', '2026-10-14', term), {
    startDate: '2026-10-01', endDate: '2026-10-31',
  });
  assert.deepEqual(periodRange('termly', '2026-10-14', term), {
    startDate: '2026-09-01', endDate: '2026-12-18',
  });
  assert.equal(periodRange('termly', '2026-08-31', term), null);
});

test('feeding days exclude weekends and school holidays, with approved school days overriding them', () => {
  const dates = listFeedingDays(term, [
    { event_type: 'holiday', start_date: '2026-10-12', end_date: '2026-10-15', class_id: null },
    { event_type: 'school_day', start_date: '2026-10-14', end_date: '2026-10-14', class_id: 4 },
  ], 4, '2026-10-10', '2026-10-18');
  assert.deepEqual(dates, ['2026-10-14', '2026-10-16']);
});

test('effective-dated rate changes select the historical rate for each service date', () => {
  const rates = [
    { id: 1, effective_date: '2026-09-01', daily_rate: '10.00' },
    { id: 2, effective_date: '2026-10-01', daily_rate: '12.00' },
  ];
  assert.equal(rateForDate(rates, '2026-09-30').daily_rate, '10.00');
  assert.equal(rateForDate(rates, '2026-10-01').daily_rate, '12.00');
  assert.equal(rateForDate(rates, '2026-08-31'), null);
});

test('feeding payments allocate partial amounts and keep unapplied advance credit', () => {
  const result = allocateCents(850, [
    { id: 1, amount_due_cents: 500, amount_paid_cents: 0 },
    { id: 2, amount_due_cents: 500, amount_paid_cents: 200 },
  ]);
  assert.deepEqual(result, {
    allocations: [
      { obligation_id: 1, amount_cents: 500 },
      { obligation_id: 2, amount_cents: 300 },
    ],
    advance_cents: 50,
  });
  assert.deepEqual(allocateCents(1500, [
    { id: 3, amount_due_cents: 500, amount_paid_cents: 0 },
  ]), {
    allocations: [{ obligation_id: 3, amount_cents: 500 }],
    advance_cents: 1000,
  });
});

test('combined components allocate independently and refunds reverse only unrefunded allocations', () => {
  const schoolFee = allocateCents(400, [
    { id: 1, amount_due_cents: 500, amount_paid_cents: 0 },
  ]);
  const feeding = allocateCents(900, [
    { id: 2, amount_due_cents: 600, amount_paid_cents: 0 },
  ]);
  assert.equal(schoolFee.advance_cents, 0);
  assert.equal(feeding.advance_cents, 300);
  assert.deepEqual(allocateRefundCents(450, [
    { allocation_id: 2, amount_cents: 300, refunded_cents: 100 },
    { allocation_id: 1, amount_cents: 250, refunded_cents: 0 },
  ]), {
    allocations: [
      { allocation_id: 2, amount_cents: 200, refunded_cents: 100 },
      { allocation_id: 1, amount_cents: 250, refunded_cents: 0 },
    ],
    unallocated_cents: 0,
  });
  assert.equal(allocateRefundCents(300, [
    { allocation_id: 1, amount_cents: 200, refunded_cents: 100 },
  ]).unallocated_cents, 200);
});

test('money parsing is precise and daily coverage requires a fully paid obligation', () => {
  assert.equal(moneyToCents('30'), 3000);
  assert.equal(amountFromCents(3000), '30.00');
  assert.equal(moneyToCents('3000.00'), 300000);
  assert.equal(moneyToCents('1.5'), 150);
  assert.equal(moneyToCents('1.005'), null);
  assert.equal(moneyToCents('-1'), null);
  assert.equal(paymentStatus(500, 0), 'unpaid');
  assert.equal(paymentStatus(500, 125), 'partial');
  assert.equal(paymentStatus(500, 500), 'paid');
});
