const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRuntimeConfig } = require('./runtimeConfig');

const production = {
  NODE_ENV: 'production',
  APP_DATABASE_URL: 'postgresql://app:secret@db.example.test/school',
  JWT_SECRET: 'a'.repeat(48),
  CORS_ORIGIN: 'https://school.example.test',
  FRONTEND_URL: 'https://school.example.test',
  LEARNING_FILES_BUCKET: 'mccarthy-learning-files',
  AWS_REGION: 'us-east-1',
};

test('production runtime requires explicit HTTPS origins and private file storage settings', () => {
  assert.equal(validateRuntimeConfig(production), true);
  assert.throws(() => validateRuntimeConfig({ ...production, CORS_ORIGIN: '*' }), /explicit HTTPS origins/);
  assert.throws(() => validateRuntimeConfig({ ...production, FRONTEND_URL: 'http://school.example.test' }), /HTTPS origin/);
  assert.throws(() => validateRuntimeConfig({ ...production, LEARNING_FILES_BUCKET: '' }), /LEARNING_FILES_BUCKET/);
  assert.throws(() => validateRuntimeConfig({ ...production, AWS_REGION: '' }), /AWS_REGION/);
  assert.throws(() => validateRuntimeConfig({ ...production, LEARNING_FILES_ENDPOINT: 'http://storage.example.test' }), /must use HTTPS/);
});

test('runtime configuration preserves explicit APP_DATABASE_URL and JWT requirements', () => {
  assert.throws(() => validateRuntimeConfig({ ...production, APP_DATABASE_URL: '', DATABASE_URL: production.APP_DATABASE_URL }), /APP_DATABASE_URL is required/);
  assert.throws(() => validateRuntimeConfig({ ...production, JWT_SECRET: 'short' }), /32 characters/);
});
