const pool = require('../config/db');

async function consumeRateLimit(user, requestsPerMinute, db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${user.school_id}:${user.id}`]);
    const count = await client.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM ai_request_events
       WHERE school_id = $1 AND user_id = $2 AND created_at >= NOW() - INTERVAL '1 minute'`,
      [user.school_id, user.id]
    );
    if (count.rows[0].count >= requestsPerMinute) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `DELETE FROM ai_request_events
       WHERE school_id = $1 AND user_id = $2 AND created_at < NOW() - INTERVAL '2 minutes'`,
      [user.school_id, user.id]
    );
    await client.query(
      'INSERT INTO ai_request_events (school_id, user_id) VALUES ($1, $2)',
      [user.school_id, user.id]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function conversationTitle(message) {
  const normalized = String(message || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 117) + (normalized.length > 117 ? '...' : '') || 'New conversation';
}

async function removeExpiredConversations(user, retentionDays, db = pool) {
  await db.query(
    `DELETE FROM ai_conversations
     WHERE school_id = $1 AND user_id = $2
       AND updated_at < NOW() - make_interval(days => $3)`,
    [user.school_id, user.id, retentionDays]
  );
}

async function listConversations(user, retentionDays, db = pool) {
  await removeExpiredConversations(user, retentionDays, db);
  const result = await db.query(
    `SELECT id, title, mode, created_at, updated_at
     FROM ai_conversations
     WHERE school_id = $1 AND user_id = $2
     ORDER BY updated_at DESC
     LIMIT 50`,
    [user.school_id, user.id]
  );
  return result.rows;
}

async function getConversation(user, conversationId, db = pool) {
  const conversation = await db.query(
    `SELECT id, title, mode, created_at, updated_at
     FROM ai_conversations
     WHERE id = $1 AND school_id = $2 AND user_id = $3`,
    [conversationId, user.school_id, user.id]
  );
  if (!conversation.rows.length) return null;
  const messages = await db.query(
    `SELECT role, content, created_at
     FROM ai_messages
     WHERE conversation_id = $1 AND school_id = $2 AND user_id = $3
     ORDER BY created_at, id`,
    [conversationId, user.school_id, user.id]
  );
  return { ...conversation.rows[0], messages: messages.rows };
}

async function deleteConversation(user, conversationId, db = pool) {
  const result = await db.query(
    'DELETE FROM ai_conversations WHERE id = $1 AND school_id = $2 AND user_id = $3',
    [conversationId, user.school_id, user.id]
  );
  return result.rowCount > 0;
}

async function saveConversationTurn({
  user,
  conversationId,
  mode,
  question,
  answer,
  requestType,
  model,
  usage,
  estimatedCost,
  replaceLastTurn = false,
}, db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let id = conversationId;
    if (id) {
      const current = await client.query(
        `SELECT id, mode FROM ai_conversations
         WHERE id = $1 AND school_id = $2 AND user_id = $3
         FOR UPDATE`,
        [id, user.school_id, user.id]
      );
      if (!current.rows.length) {
        const error = new Error('Conversation not found.');
        error.code = 'AI_CONVERSATION_NOT_FOUND';
        throw error;
      }
      if (current.rows[0].mode !== mode) {
        const error = new Error('Conversation mode cannot be changed.');
        error.code = 'AI_CONVERSATION_MODE_MISMATCH';
        throw error;
      }
      if (replaceLastTurn) {
        const latest = await client.query(
          `SELECT id, role FROM ai_messages
           WHERE conversation_id = $1 AND school_id = $2 AND user_id = $3
           ORDER BY created_at DESC, id DESC
           LIMIT 2
           FOR UPDATE`,
          [id, user.school_id, user.id]
        );
        if (latest.rows.length !== 2 || latest.rows[0].role !== 'assistant' || latest.rows[1].role !== 'user') {
          const error = new Error('The previous answer could not be regenerated.');
          error.code = 'AI_CONVERSATION_NO_TURN';
          throw error;
        }
        await client.query(
          `DELETE FROM ai_messages
           WHERE conversation_id = $1 AND school_id = $2 AND user_id = $3
             AND id = ANY($4::BIGINT[])`,
          [id, user.school_id, user.id, latest.rows.map((row) => row.id)]
        );
      }
    } else {
      const result = await client.query(
        `INSERT INTO ai_conversations (school_id, user_id, title, mode)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [user.school_id, user.id, conversationTitle(question), mode]
      );
      id = result.rows[0].id;
    }

    await client.query(
      `INSERT INTO ai_messages (conversation_id, school_id, user_id, role, content)
       VALUES ($1, $2, $3, 'user', $4), ($1, $2, $3, 'assistant', $5)`,
      [id, user.school_id, user.id, question, answer]
    );
    await client.query(
      'UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1 AND school_id = $2 AND user_id = $3',
      [id, user.school_id, user.id]
    );
    if (model && usage) {
      await client.query(
        `INSERT INTO ai_usage_events
           (school_id, user_id, conversation_id, model, request_type, input_tokens, output_tokens, estimated_cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          user.school_id, user.id, id, model, requestType,
          usage.inputTokens, usage.outputTokens, estimatedCost,
        ]
      );
    }
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function getUsageSummary(user, db = pool) {
  const result = await db.query(
    `SELECT COUNT(*)::INTEGER AS requests,
            COALESCE(SUM(input_tokens), 0)::BIGINT AS input_tokens,
            COALESCE(SUM(output_tokens), 0)::BIGINT AS output_tokens,
            CASE WHEN COUNT(*) > 0 AND COUNT(estimated_cost_usd) = COUNT(*)
              THEN COALESCE(SUM(estimated_cost_usd), 0)::NUMERIC(12, 8)
              ELSE NULL
            END AS estimated_cost_usd
     FROM ai_usage_events
     WHERE school_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
    [user.school_id]
  );
  return { period_days: 30, ...result.rows[0] };
}

module.exports = {
  consumeRateLimit,
  conversationTitle,
  listConversations,
  getConversation,
  deleteConversation,
  saveConversationTurn,
  getUsageSummary,
};
