const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateBaseUsername,
  makeUniqueUsername,
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

test('duplicate student names receive the next available numeric suffix', async () => {
  const taken = new Set(['gideon.akussah']);
  const db = {
    async query(_sql, [username]) {
      return { rows: taken.has(username) ? [{ id: 1 }] : [] };
    },
  };
  const firstDuplicate = await makeUniqueUsername(db, 1, 'Gideon Senanu Akussah');
  assert.equal(firstDuplicate, 'gideon.akussah2');
  taken.add(firstDuplicate);
  assert.equal(await makeUniqueUsername(db, 1, 'Gideon Senanu Akussah'), 'gideon.akussah3');
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

