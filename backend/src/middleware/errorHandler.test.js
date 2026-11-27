const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('./errorHandler');

test('unexpected errors do not expose database or storage internals', () => {
  let body;
  const response = { status(code) { this.code=code; return this; }, json(value) { body=value; return this; } };
  const original = console.error;
  console.error = () => {};
  try {
    errorHandler(new Error('relation private_table does not exist'),{},response,()=>{});
  } finally { console.error=original; }
  assert.equal(response.code,500);
  assert.equal(body.message,'The request could not be completed. Please try again later.');
});

test('configured public storage errors retain their actionable message', () => {
  let body;
  const response = { status(code) { this.code=code; return this; }, json(value) { body=value; return this; } };
  errorHandler({ status:503,message:'secret detail',publicMessage:'Private storage is not configured.' },{},response,()=>{});
  assert.equal(response.code,503);
  assert.equal(body.message,'Private storage is not configured.');
});
