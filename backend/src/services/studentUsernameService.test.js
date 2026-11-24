const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateBaseUsername,
  generateTemporaryPassword,
  validDob,
} = require('./studentUsernameService');

test('student usernames use first and last name in lowercase', () => {
  assert.equal(generateBaseUsername('Gideon Senanu Akussah'), 'gideon.akussah');
  assert.equal(generateBaseUsername('John Mensah'), 'john.mensah');
  assert.equal(generateBaseUsername('Mary Ama Boateng'), 'mary.boateng');
});

test('student username normalization removes accents and punctuation', () => {
  assert.equal(generateBaseUsername('José Men sáh-Jones'), 'jose.jones');
});

test('valid DOB produces DDMMYYYY temporary password', () => {
  assert.equal(validDob('2012-08-15'), '15082012');
  assert.deepEqual(generateTemporaryPassword('2012-08-15'), {
    temporaryPassword: '15082012',
    source: 'dob',
  });
});

test('missing DOB generates a secure random temporary password fallback', () => {
  const password = generateTemporaryPassword(null);
  assert.equal(password.source, 'random');
  assert.ok(password.temporaryPassword.length >= 12);
});

