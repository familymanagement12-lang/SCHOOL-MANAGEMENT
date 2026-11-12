const test = require('node:test');
const assert = require('node:assert/strict');
const {
  consumeRateLimit,
  conversationTitle,
  saveConversationTurn,
} = require('./aiConversationService');

function fakeDatabase(handler) {
  const statements = [];
  const client = {
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      return handler(sql, params);
    },
    release: () => { client.released = true; },
  };
  return { client, statements, connect: async () => client };
}

test('conversation titles remove control characters and stay within the display limit', () => {
  assert.equal(conversationTitle('  Prepare\n a\tlesson  '), 'Prepare a lesson');
  assert.equal(conversationTitle(''), 'New conversation');
  assert.equal(conversationTitle('x'.repeat(130)).length, 120);
});

test('persistent rate limiter serializes requests and records allowed calls', async () => {
  const db = fakeDatabase((sql) => ({ rows: sql.includes('COUNT(*)') ? [{ count: 1 }] : [], rowCount: 1 }));
  assert.equal(await consumeRateLimit({ school_id: 7, id: 12 }, 10, db), true);
  assert.ok(db.statements.some(({ sql }) => sql.includes('pg_advisory_xact_lock')));
  assert.ok(db.statements.some(({ sql }) => sql.includes('INSERT INTO ai_request_events')));
  assert.ok(db.statements.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(db.client.released, true);
});

test('persistent rate limiter rejects excess requests without recording another call', async () => {
  const db = fakeDatabase((sql) => ({ rows: sql.includes('COUNT(*)') ? [{ count: 2 }] : [], rowCount: 1 }));
  assert.equal(await consumeRateLimit({ school_id: 7, id: 12 }, 2, db), false);
  assert.ok(db.statements.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(db.statements.some(({ sql }) => sql.includes('INSERT INTO ai_request_events')), false);
  assert.equal(db.client.released, true);
});

test('conversation turns and usage are saved with the authenticated owner in one transaction', async () => {
  const conversationId = 'c7696f5c-04a5-4e51-95bc-16b10f1a04d3';
  const db = fakeDatabase((sql) => ({
    rows: sql.includes('INSERT INTO ai_conversations') ? [{ id: conversationId }] : [],
    rowCount: 1,
  }));
  const result = await saveConversationTurn({
    user: { school_id: 7, id: 12 },
    mode: 'general',
    question: 'Create a quiz',
    answer: 'Generated quiz',
    requestType: 'generation',
    model: 'gpt-4.1-mini',
    usage: { inputTokens: 25, outputTokens: 75 },
    estimatedCost: null,
  }, db);
  assert.equal(result, conversationId);
  const conversationInsert = db.statements.find(({ sql }) => sql.includes('INSERT INTO ai_conversations'));
  assert.deepEqual(conversationInsert.params.slice(0, 2), [7, 12]);
  assert.ok(db.statements.some(({ sql }) => sql.includes('INSERT INTO ai_messages')));
  assert.ok(db.statements.some(({ sql }) => sql.includes('INSERT INTO ai_usage_events')));
  assert.ok(db.statements.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(db.client.released, true);
});

test('conversation turns roll back when a requested conversation is not owned', async () => {
  const db = fakeDatabase((sql) => ({ rows: sql.includes('FOR UPDATE') ? [] : [], rowCount: 0 }));
  await assert.rejects(saveConversationTurn({
    user: { school_id: 7, id: 12 },
    conversationId: 'c7696f5c-04a5-4e51-95bc-16b10f1a04d3',
    mode: 'general',
    question: 'A question',
    answer: 'An answer',
  }, db), { code: 'AI_CONVERSATION_NOT_FOUND' });
  assert.ok(db.statements.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(db.statements.some(({ sql }) => sql.includes('INSERT INTO ai_messages')), false);
  assert.equal(db.client.released, true);
});
