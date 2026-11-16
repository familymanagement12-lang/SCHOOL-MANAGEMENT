const test = require('node:test');
const assert = require('node:assert/strict');
const { recordPayment } = require('./paymentController');

const invoke = async (handler, req) => {
  let status = 200;
  let body;
  await handler(req, {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  }, (error) => { throw error; });
  return { status, body };
};

const paymentRequest = (role, overrides = {}) => ({
  user: { id: 8, school_id: 2, role },
  body: {
    student_id: 15,
    school_fee_amount: 0,
    feeding_amount: '25.00',
    payment_date: '2026-10-14',
    payment_method: 'cash',
    reference: '',
    idempotency_key: 'test-payment-1',
    ...overrides,
  },
});

test('feeding officers cannot post tuition or use unsupported payment methods', async () => {
  const tuition = await invoke(recordPayment, paymentRequest('feeding_tuckshop_officer', {
    school_fee_amount: '20.00',
    feeding_amount: 0,
  }));
  assert.equal(tuition.status, 403);

  const unsupportedMethod = await invoke(recordPayment, paymentRequest('accountant', {
    payment_method: 'online_gateway',
  }));
  assert.equal(unsupportedMethod.status, 400);
});
