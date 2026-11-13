const test = require('node:test');
const assert = require('node:assert/strict');
const { isMainFinanceTransaction } = require('./financeScopes');

test('main income and expenditure excludes linked feeding and tuckshop entries only', () => {
  for (const sourceType of [
    'feeding_payment',
    'tuckshop_sale',
    'tuckshop_sale_cogs',
    'kitchen_purchase',
  ]) {
    assert.equal(isMainFinanceTransaction(sourceType), false);
  }
  assert.equal(isMainFinanceTransaction('fee_payment'), true);
  assert.equal(isMainFinanceTransaction(null), true);
  assert.equal(isMainFinanceTransaction(undefined), true);
});
