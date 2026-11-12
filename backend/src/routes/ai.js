const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const {
  ALLOWED_ROLES,
  classifyQuestion,
  allowedIntent,
  collectVerifiedFacts,
  fallbackAnswer,
} = require('../services/aiAssistantService');
const {
  getAIConfig,
  validateGenerationOptions,
  getPersonalNames,
  redactPersonalContent,
  buildGenerationRequest,
  callOpenAI,
  estimateCostUsd,
} = require('../services/aiRuntimeService');
const {
  listConversations,
  consumeRateLimit,
  getConversation,
  deleteConversation,
  saveConversationTurn,
  getUsageSummary,
} = require('../services/aiConversationService');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.use(authenticate, authorize([...ALLOWED_ROLES]));

function providerConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function sendProviderError(res, error) {
  console.error('[mccarthy-ai] provider request failed', { status: error.status || 'timeout_or_network' });
  if (error.status === 429) {
    return res.status(503).json({ message: 'The assistant is busy right now. Please try again shortly.' });
  }
  if (error.status === 401 || error.status === 403) {
    return res.status(503).json({ message: 'The assistant is not ready yet. Please contact the school administrator.' });
  }
  return res.status(503).json({ message: 'I’m having trouble answering right now. Please try again shortly.' });
}

async function handleAssistantRequest(req, res, { forcedMode, generation }) {
  const maxInputChars = getAIConfig().maxInputChars;
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question || question.length > maxInputChars) {
    return res.status(400).json({ message: `Please enter a message of up to ${maxInputChars.toLocaleString()} characters.` });
  }
  let withinRateLimit;
  try {
    withinRateLimit = await consumeRateLimit(req.user, getAIConfig().requestsPerMinute);
  } catch (error) {
    console.error('[mccarthy-ai] rate-limit check failed', { code: error.code || 'unknown' });
    return res.status(500).json({ message: 'I couldn’t process that request just now. Please try again.' });
  }
  if (!withinRateLimit) {
    return res.status(429).json({ message: 'You’ve sent several messages in a short time. Please wait a moment and try again.' });
  }

  const inferredMode = classifyQuestion(question) === 'general' ? 'general' : 'school_data';
  const mode = forcedMode || req.body?.mode || inferredMode;
  if (!['general', 'school_data'].includes(mode)) {
    return res.status(400).json({ message: 'Choose either General AI or School Data.' });
  }
  if (generation && mode !== 'general') {
    return res.status(400).json({ message: 'Learning materials are only available in General AI mode.' });
  }

  const generationOptions = generation
    ? (req.body?.generation !== undefined && (!req.body.generation || typeof req.body.generation !== 'object' || Array.isArray(req.body.generation))
      ? { error: 'Check the lesson details and try again.' }
      : validateGenerationOptions({ ...(req.body?.generation || {}), generationType: req.body?.type || req.body?.generation?.generationType }))
    : null;
  if (generationOptions?.error) return res.status(400).json({ message: generationOptions.error });

  const conversationId = req.body?.conversationId || null;
  const replaceLastTurn = req.body?.regenerate === true;
  if (conversationId && (typeof conversationId !== 'string' || !UUID_PATTERN.test(conversationId))) {
    return res.status(400).json({ message: 'That conversation could not be found.' });
  }
  if (replaceLastTurn && !conversationId) {
    return res.status(400).json({ message: 'Start a conversation before regenerating an answer.' });
  }
  let history;
  if (conversationId) {
    let conversation;
    try {
      conversation = await getConversation(req.user, conversationId);
    } catch (error) {
      console.error('[mccarthy-ai] conversation read failed', { code: error.code || 'unknown' });
      return res.status(500).json({ message: 'That conversation could not be opened right now.' });
    }
    if (!conversation || conversation.mode !== mode) {
      return res.status(404).json({ message: 'That conversation could not be found.' });
    }
    const storedMessages = replaceLastTurn ? conversation.messages.slice(0, -2) : conversation.messages;
    history = storedMessages.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, maxInputChars) }));
  } else {
    history = [];
  }
  if (mode === 'school_data') {
    history = [];
  }

  let facts;
  let intent = 'general';
  if (mode === 'school_data') {
    intent = classifyQuestion(question);
    if (intent === 'unsupported_school_data') {
      return res.status(400).json({ message: 'That type of school information is not available here.' });
    }
    if (intent === 'general') {
      return res.status(400).json({ message: 'For lessons and learning help, switch to General AI.' });
    }
    if (!allowedIntent(req.user.role, intent)) {
      return res.status(403).json({ message: 'Sorry, you cannot view that information with this account.' });
    }
    try {
      facts = await collectVerifiedFacts(req.user, intent, question);
    } catch (error) {
      console.error('[mccarthy-ai] verified query failed', { intent, code: error.code || 'unknown' });
      return res.status(500).json({ message: 'I couldn’t get that information just now. Please try again.' });
    }
  } else {
    facts = { school: { name: 'The McCarthy Hill School' } };
  }

  let answer;
  let providerResult = null;
  let personalNames;
  if (facts.unavailable || facts.notAvailable) {
    answer = fallbackAnswer(intent, facts);
  } else if (providerConfigured()) {
    const providerQuestion = generation ? buildGenerationRequest(question, generationOptions.value) : question;
    try {
      personalNames = await getPersonalNames(req.user.school_id);
      providerResult = await callOpenAI(providerQuestion, history, facts, req.user.school_id, {
        mode,
        generation: generationOptions?.value,
        personalNames,
      });
      answer = providerResult.text;
    } catch (error) {
      return sendProviderError(res, error);
    }
  } else if (mode === 'school_data') {
    answer = fallbackAnswer(intent, facts);
  } else {
    return res.status(503).json({
      message: 'Lesson and learning-material help is not available yet. Please contact the school administrator.',
    });
  }

  try {
    const questionToStore = generation ? buildGenerationRequest(question, generationOptions.value) : question;
    personalNames = personalNames || await getPersonalNames(req.user.school_id);
    const [storedQuestion, storedAnswer] = await redactPersonalContent([questionToStore, answer], req.user.school_id, personalNames);
    const savedConversationId = await saveConversationTurn({
      user: req.user,
      conversationId,
      mode,
      question: storedQuestion,
      answer: storedAnswer,
      requestType: generation ? 'generation' : mode,
      model: providerResult?.model,
      usage: providerResult?.usage,
      estimatedCost: providerResult ? estimateCostUsd(providerResult.usage) : null,
      replaceLastTurn,
    });
    return res.json({
      answer: storedAnswer,
      conversation_id: savedConversationId,
      mode,
      generated: mode === 'general',
      source: mode === 'school_data' ? facts.source : null,
      provider_available: providerConfigured(),
      provider_used: Boolean(providerResult),
    });
  } catch (error) {
    if (error.code === 'AI_CONVERSATION_NOT_FOUND' || error.code === 'AI_CONVERSATION_MODE_MISMATCH' || error.code === 'AI_CONVERSATION_NO_TURN') {
      return res.status(404).json({ message: 'That conversation could not be found.' });
    }
    console.error('[mccarthy-ai] conversation save failed', { code: error.code || 'unknown' });
    return res.status(500).json({ message: 'I couldn’t save this conversation. Please try again.' });
  }
}

router.get('/status', (req, res) => {
  res.json({
    available: providerConfigured(),
    general_available: providerConfigured(),
    school_data_available: true,
    max_input_chars: getAIConfig().maxInputChars,
  });
});

router.post('/chat', (req, res) => handleAssistantRequest(req, res, {}));
router.post('/generate', (req, res) => handleAssistantRequest(req, res, { forcedMode: 'general', generation: true }));

router.get('/conversations', async (req, res) => {
  try {
    const conversations = await listConversations(req.user, getAIConfig().retentionDays);
    return res.json({ conversations });
  } catch (error) {
    console.error('[mccarthy-ai] conversation list failed', { code: error.code || 'unknown' });
    return res.status(500).json({ message: 'Conversation history is not available right now.' });
  }
});

router.get('/conversations/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ message: 'That conversation could not be found.' });
  try {
    const conversation = await getConversation(req.user, req.params.id);
    if (!conversation) return res.status(404).json({ message: 'That conversation could not be found.' });
    return res.json({ conversation });
  } catch (error) {
    console.error('[mccarthy-ai] conversation read failed', { code: error.code || 'unknown' });
    return res.status(500).json({ message: 'That conversation could not be opened right now.' });
  }
});

router.delete('/conversations/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ message: 'That conversation could not be found.' });
  try {
    const deleted = await deleteConversation(req.user, req.params.id);
    if (!deleted) return res.status(404).json({ message: 'That conversation could not be found.' });
    return res.status(204).end();
  } catch (error) {
    console.error('[mccarthy-ai] conversation delete failed', { code: error.code || 'unknown' });
    return res.status(500).json({ message: 'That conversation could not be deleted right now.' });
  }
});

router.get('/usage', authorize(['admin']), async (req, res) => {
  try {
    return res.json({ usage: await getUsageSummary(req.user) });
  } catch (error) {
    console.error('[mccarthy-ai] usage summary failed', { code: error.code || 'unknown' });
    return res.status(500).json({ message: 'AI usage information is not available right now.' });
  }
});

module.exports = router;
