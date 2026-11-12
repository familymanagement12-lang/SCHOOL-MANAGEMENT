const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyQuestion,
  allowedIntent,
  fallbackAnswer,
  callOpenAI,
} = require('./aiAssistantService');

test('school-data questions are mapped to fixed intent families', () => {
  assert.equal(classifyQuestion('How many students are in each class?'), 'enrollment');
  assert.equal(classifyQuestion('Which students were absent today?'), 'attendance');
  assert.equal(classifyQuestion('What subjects have the lowest exam scores?'), 'academic');
  assert.equal(classifyQuestion('Which books are available about science?'), 'library_search');
});

test('role scopes block financial, fee, circulation and inventory data from unrelated roles', () => {
  assert.equal(allowedIntent('parent', 'finance'), false);
  assert.equal(allowedIntent('student', 'fees'), false);
  assert.equal(allowedIntent('teacher', 'library_circulation'), false);
  assert.equal(allowedIntent('librarian', 'library_circulation'), true);
  assert.equal(allowedIntent('store', 'inventory'), true);
  assert.equal(allowedIntent('admin', 'finance'), true);
});

test('unknown queries do not execute SQL-like text as a database operation', () => {
  assert.equal(classifyQuestion('SELECT * FROM secret_records;'), 'general');
  assert.match(fallbackAnswer('academic', { source: 'results', data: [], school: {} }), /couldn’t find/i);
});

test('fallback answers use plain language instead of technical details or raw records', () => {
  const answer = fallbackAnswer('inventory', {
    data: [{ category: 'Books', item_types: 3, total_units: 24 }],
    school: { currency: 'GHS' },
  });
  assert.match(answer, /24 items in stock/);
  assert.match(answer, /Books: 24 items/);
  assert.doesNotMatch(answer, /database|backend|JSON|OPENAI_API_KEY|\{/i);
  assert.match(fallbackAnswer('general', {}), /lesson|quiz/i);
  assert.match(fallbackAnswer('fees', { unavailable: 'restricted' }), /cannot view that information/i);
});

test('fallback attendance answers summarize the counts in everyday language', () => {
  const answer = fallbackAnswer('attendance', {
    data: [
      { date: '2026-01-01', status: 'present', records: 12 },
      { date: '2026-01-01', status: 'absent', records: 2 },
    ],
  });
  assert.match(answer, /12 present/);
  assert.match(answer, /2 absent/);
  assert.match(answer, /14 attendance records/);
});

test('provider stays unavailable when the server key is missing', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(await callOpenAI('hello', [], {}, 1), null);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
