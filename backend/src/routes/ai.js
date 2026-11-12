const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const {
  ALLOWED_ROLES,
  classifyQuestion,
  allowedIntent,
  collectVerifiedFacts,
  fallbackAnswer,
  callOpenAI,
} = require('../services/aiAssistantService');

const router = express.Router();
const windows = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_QUESTION_LENGTH = 2000;

router.use(authenticate, authorize([...ALLOWED_ROLES]));

router.get('/status', (req, res) => {
  res.json({ available: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_API_KEY ? (process.env.OPENAI_MODEL || 'gpt-6.1-sol') : null });
});

router.post('/chat', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ message: `Enter a message between 1 and ${MAX_QUESTION_LENGTH} characters.` });
  }
  const key = `${req.user.school_id}:${req.user.id}`;
  const now = Date.now();
  if (windows.size > 5000) {
    for (const [entryKey, value] of windows) {
      if (now - value.startedAt >= WINDOW_MS) windows.delete(entryKey);
    }
  }
  let window = windows.get(key);
  if (!window || now - window.startedAt >= WINDOW_MS) {
    window = { startedAt: now, count: 0 };
    windows.set(key, window);
  }
  if (window.count >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ message: 'You have reached the assistant limit of 10 messages per minute. Please wait and try again.' });
  }
  window.count += 1;

  const history = Array.isArray(req.body.history) ? req.body.history.slice(-8).flatMap((message) => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') return [];
    return [{ role: message.role, content: message.content.slice(0, MAX_QUESTION_LENGTH) }];
  }) : [];
  const intent = classifyQuestion(question);
  if (!allowedIntent(req.user.role, intent)) {
    return res.status(403).json({ message: 'Your role does not have access to that school information.' });
  }

  try {
    const facts = await collectVerifiedFacts(req.user, intent, question);
    let answer;
    let providerUsed = false;
    if (process.env.OPENAI_API_KEY && !facts.unavailable) {
      try {
        answer = await callOpenAI(question, history, facts, req.user.school_id);
        providerUsed = true;
      } catch (error) {
        console.error('[mccarthy-ai] provider request failed', { status: error.status || 'timeout_or_network' });
        if (error.status === 429) return res.status(503).json({ message: 'The AI provider is busy. Try again shortly.' });
        return res.status(503).json({ message: 'McCarthy AI could not reach the AI provider. Please try again later.' });
      }
    } else {
      answer = fallbackAnswer(intent, facts);
    }
    console.info('[mccarthy-ai-audit]', JSON.stringify({ school_id: req.user.school_id, user_id: req.user.id, role: req.user.role, intent, provider_used: providerUsed, at: new Date().toISOString() }));
    return res.json({ answer, source: facts.source, provider_available: Boolean(process.env.OPENAI_API_KEY), provider_used: providerUsed });
  } catch (error) {
    console.error('[mccarthy-ai] verified query failed', { intent, code: error.code || 'unknown' });
    return res.status(500).json({ message: 'I could not read the verified school records for that request. Please try again or contact an administrator.' });
  }
});

module.exports = router;
