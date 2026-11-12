import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Check, Clipboard, Database, GraduationCap, History, Plus, RotateCw, Send, Sparkles, Trash2, UserRound,
} from 'lucide-react';
import {
  askMcCarthyAi,
  deleteAiConversation,
  generateMcCarthyAi,
  getAiConversation,
  getAiConversations,
  getAiStatus,
  getAiUsage,
} from '../api/ai';

const DATA_PROMPTS = {
  admin: [
    'How many students are enrolled in each class?',
    'Summarize attendance for the last 7 days.',
    'Which subjects have the lowest average results this term?',
    'Summarize outstanding school fees.',
    'Recommend books about science.',
    'Summarize overdue library books.',
  ],
  teacher: [
    'Summarize attendance for my classes this week.',
    'Which subjects have the lowest average results this term?',
    'Recommend books about science.',
  ],
  librarian: ['Recommend books about science.', 'Summarize overdue library books.', 'Find books about African history.'],
  inventory: ['Summarize the school inventory.', 'Show stock totals by category.'],
  store: ['Summarize the school inventory.', 'Show stock totals by category.'],
  storekeeper: ['Summarize the school inventory.', 'Show stock totals by category.'],
};

const GENERAL_PROMPTS = [
  'Create a Year 4 lesson plan about fractions.',
  'Write 5 revision questions about ecosystems.',
  'Explain photosynthesis in simple words.',
  'Create a short quiz with an answer key.',
];

const MATERIAL_TYPES = [
  ['chat', 'General question'],
  ['lesson_plan', 'Lesson plan'],
  ['daily_notes', 'Daily lesson notes'],
  ['weekly_plan', 'Weekly lesson plan'],
  ['term_plan', 'Term teaching plan'],
  ['quiz', 'Quiz and answer key'],
  ['multiple_choice', 'Multiple-choice questions'],
  ['essay_questions', 'Essay questions'],
  ['revision_questions', 'Revision questions'],
  ['exam_questions', 'Examination questions'],
  ['marking_scheme', 'Marking scheme'],
  ['explanation', 'Topic explanation'],
  ['study_guide', 'Study guide'],
  ['homework', 'Homework'],
  ['teaching_recommendations', 'Teaching recommendations'],
];

const INITIAL_GENERATION = {
  generationType: 'explanation',
  yearLevel: '',
  curriculum: '',
  className: '',
  subject: '',
  term: '',
  topic: '',
  learningObjectives: '',
  durationMinutes: '40',
  difficulty: 'intermediate',
  questionCount: '5',
  questionFormat: 'mixed',
  marksPerQuestion: '1',
};

function readUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

function renderAnswer(content) {
  const lines = String(content || '').split(/\r?\n/);
  const blocks = [];
  let list = [];
  const tableCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const isTableSeparator = (line) => tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
  const flushList = () => {
    if (list.length) {
      blocks.push(<ul key={`list-${blocks.length}`}>{list.map((item, index) => <li key={index}>{item}</li>)}</ul>);
      list = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const bullet = trimmed.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flushList();
    if (!trimmed) continue;
    if (trimmed.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = tableCells(trimmed);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <div className="ai-answer-table-wrap" key={`table-${index}`}>
          <table className="ai-answer-table">
            <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{cell}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] || ''}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) blocks.push(<h4 key={`heading-${index}`}>{heading[1]}</h4>);
    else blocks.push(<p key={`paragraph-${index}`}>{trimmed}</p>);
  }
  flushList();
  return blocks;
}

function formatConversationDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function McCarthyAI() {
  const user = useMemo(readUser, []);
  const [mode, setMode] = useState('general');
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [generation, setGeneration] = useState(INITIAL_GENERATION);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [providerAvailable, setProviderAvailable] = useState(null);
  const [maxInputChars, setMaxInputChars] = useState(4000);
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [failedQuestion, setFailedQuestion] = useState('');
  const [failedRegenerate, setFailedRegenerate] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(null);
  const conversationEnd = useRef(null);
  const prompts = mode === 'school_data'
    ? DATA_PROMPTS[user?.role] || DATA_PROMPTS.admin
    : GENERAL_PROMPTS;
  const lastUserIndex = messages.reduce((last, message, index) => (message.role === 'user' ? index : last), -1);
  const lastAssistantIndex = messages.reduce((last, message, index) => (message.role === 'assistant' && !message.isError ? index : last), -1);

  const refreshConversations = useCallback(async () => {
    try {
      const response = await getAiConversations();
      setConversations(response.data.conversations || []);
      setHistoryError('');
    } catch (requestError) {
      setHistoryError(requestError.response?.data?.message || 'Conversation history is unavailable right now.');
    }
  }, []);

  useEffect(() => {
    getAiStatus()
      .then((response) => {
        setProviderAvailable(Boolean(response.data.general_available));
        if (Number.isInteger(response.data.max_input_chars)) setMaxInputChars(response.data.max_input_chars);
      })
      .catch(() => setProviderAvailable(false));
    refreshConversations();
    if (user?.role === 'admin') {
      getAiUsage().then((response) => setUsage(response.data.usage)).catch(() => setUsage(null));
    }
  }, [refreshConversations, user?.role]);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const resetConversation = () => {
    setConversationId(null);
    setMessages([]);
    setQuestion('');
    setError('');
    setFailedQuestion('');
    setFailedRegenerate(false);
    setCopiedMessage(null);
  };

  const startNewConversation = () => resetConversation();

  const selectMode = (nextMode) => {
    if (nextMode === mode) return;
    resetConversation();
    setMode(nextMode);
  };

  const openConversation = async (id) => {
    if (!id || id === conversationId || loading) return;
    setHistoryLoading(true);
    setError('');
    try {
      const response = await getAiConversation(id);
      const conversation = response.data.conversation;
      setConversationId(conversation.id);
      setMode(conversation.mode);
      setMessages((conversation.messages || []).map(({ role, content }) => ({ role, content, mode: conversation.mode })));
      setQuestion('');
      setFailedQuestion('');
      setFailedRegenerate(false);
    } catch (requestError) {
      setHistoryError(requestError.response?.data?.message || 'That conversation could not be opened.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const clearConversation = async () => {
    if (!messages.length && !conversationId) return;
    if (conversationId) {
      if (!window.confirm('Clear and delete this conversation? This cannot be undone.')) return;
      try {
        await deleteAiConversation(conversationId);
        await refreshConversations();
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'That conversation could not be cleared.');
        return;
      }
    }
    resetConversation();
  };

  const sendMessage = async (text = question, { retry = false, regenerate = false } = {}) => {
    const content = text.trim();
    if (!content || loading || historyLoading) return;
    if (!retry && !regenerate) setMessages((current) => [...current, { role: 'user', content }]);
    setQuestion('');
    setError('');
    setFailedQuestion('');
    setFailedRegenerate(false);
    setLoading(true);
    try {
      const response = mode === 'general' && generation.generationType !== 'chat'
        ? await generateMcCarthyAi(content, generation.generationType, generation, conversationId, regenerate)
        : await askMcCarthyAi(content, { mode, conversationId, regenerate });
      setProviderAvailable(Boolean(response.data.provider_available));
      setConversationId(response.data.conversation_id);
      const assistantMessage = {
        role: 'assistant',
        content: response.data.answer,
        mode: response.data.mode || mode,
        generated: Boolean(response.data.generated),
      };
      setMessages((current) => {
        const next = regenerate && current[current.length - 1]?.role === 'assistant' ? current.slice(0, -1) : current;
        return [...next, assistantMessage];
      });
      await refreshConversations();
      if (user?.role === 'admin') {
        getAiUsage().then((result) => setUsage(result.data.usage)).catch(() => {});
      }
    } catch (requestError) {
      const message = requestError.response?.data?.message || 'McCarthy AI could not answer right now. Please try again.';
      setError(message);
      setFailedQuestion(content);
      setFailedRegenerate(regenerate);
    } finally {
      setLoading(false);
    }
  };

  const retryMessage = () => sendMessage(failedQuestion, { retry: true, regenerate: failedRegenerate });

  const regenerateLastAnswer = () => {
    if (lastUserIndex < 0 || lastAssistantIndex < 0 || !conversationId) return;
    sendMessage(messages[lastUserIndex].content, { regenerate: true });
  };

  const copyMessage = async (content, index) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessage(index);
      window.setTimeout(() => setCopiedMessage(null), 1800);
    } catch {
      setError('Could not copy that answer. You can select and copy the text instead.');
    }
  };

  const updateGeneration = (key, value) => {
    setGeneration((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="page module-page mccarthy-ai-page">
      <div className="module-shell">
        <section className="module-hero ai-hero">
          <div>
            <p className="eyebrow">School assistant</p>
            <h1>McCarthy AI</h1>
            <p>Get help preparing lessons or ask questions about school records.</p>
          </div>
          <div className={`ai-availability ${providerAvailable ? 'is-ready' : providerAvailable === false ? 'is-limited' : ''}`}>
            <span />{providerAvailable === null ? 'Getting ready' : providerAvailable ? 'Ready to help' : 'School records available'}
          </div>
        </section>

        {providerAvailable === false && <div className="ai-notice" role="status">
          School-record questions are available. Lesson and learning-material help has not been set up yet.
        </div>}
        {usage && <div className="ai-usage-summary" aria-label="AI usage in the last 30 days">
          <strong>AI use this month</strong>
          <span>{usage.requests} requests</span>
          <span>{Number(usage.input_tokens) + Number(usage.output_tokens)} tokens used</span>
          {usage.estimated_cost_usd !== null && <span>Estimated cost: ${Number(usage.estimated_cost_usd).toFixed(4)}</span>}
        </div>}
        {error && <div className="error ai-error" role="alert">
          <span>{error}</span>
          {failedQuestion && <button className="btn-secondary" type="button" onClick={retryMessage} disabled={loading}>Try again</button>}
        </div>}

        <section className="data-panel ai-chat-panel" aria-label="McCarthy AI conversation">
          <div className="ai-chat-heading">
            <div><p className="eyebrow">Assistant</p><h2>{mode === 'general' ? 'General AI' : 'School Data Assistant'}</h2></div>
            <div className="ai-chat-controls">
              <label className="ai-history-control">
                <History size={14} aria-hidden="true" />
                <select
                  aria-label="Open a previous conversation"
                  value={conversationId || ''}
                  onChange={(event) => openConversation(event.target.value)}
                  disabled={historyLoading || loading}
                >
                  <option value="">Previous conversations</option>
                  {conversations.map((conversation) => (
                    <option key={conversation.id} value={conversation.id}>
                      {formatConversationDate(conversation.updated_at)} · {conversation.title}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn-secondary ai-new-chat" type="button" onClick={startNewConversation} disabled={loading || historyLoading || (!messages.length && !question && !conversationId)}>
                <Plus size={15} aria-hidden="true" /> New
              </button>
              <button className="btn-secondary ai-clear-chat" type="button" onClick={clearConversation} disabled={loading || historyLoading || (!messages.length && !conversationId)} aria-label="Clear current conversation">
                <Trash2 size={14} aria-hidden="true" /> Clear
              </button>
            </div>
          </div>

          <div className="ai-mode-tabs" role="tablist" aria-label="Assistant mode">
            <button type="button" role="tab" aria-selected={mode === 'general'} className={mode === 'general' ? 'active' : ''} onClick={() => selectMode('general')} disabled={loading || historyLoading}>
              <GraduationCap size={15} aria-hidden="true" /> General AI
            </button>
            <button type="button" role="tab" aria-selected={mode === 'school_data'} className={mode === 'school_data' ? 'active' : ''} onClick={() => selectMode('school_data')} disabled={loading || historyLoading}>
              <Database size={14} aria-hidden="true" /> School Data
            </button>
          </div>
          <p className="ai-mode-description">
            {mode === 'general'
              ? 'Prepare learning materials and explain topics. Answers are AI-generated, not official school records.'
              : 'Ask about school records your account is allowed to see. Answers use approved school information.'}
          </p>
          {historyError && <p className="ai-history-error" role="status">{historyError}</p>}

          {mode === 'general' && (
            <details className="ai-generation-details">
              <summary>Learning material details</summary>
              <div className="ai-context-grid">
                <label>What do you need?
                  <select value={generation.generationType} onChange={(event) => updateGeneration('generationType', event.target.value)}>
                    {MATERIAL_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <label>Year
                  <input value={generation.yearLevel} onChange={(event) => updateGeneration('yearLevel', event.target.value)} placeholder="e.g. 4" inputMode="numeric" />
                </label>
                <label>Curriculum
                  <select value={generation.curriculum} onChange={(event) => updateGeneration('curriculum', event.target.value)}>
                    <option value="">Choose if known</option><option value="Common">Common (Years 1–6)</option>
                    <option value="GES">GES (Years 7–9)</option><option value="Pearson">Pearson</option>
                  </select>
                </label>
                <label>Subject
                  <input value={generation.subject} onChange={(event) => updateGeneration('subject', event.target.value)} placeholder="e.g. Science" maxLength={80} />
                </label>
                <label>Class name
                  <input value={generation.className} onChange={(event) => updateGeneration('className', event.target.value)} placeholder="e.g. Year 4 Blue" maxLength={80} />
                </label>
                <label>Term
                  <input value={generation.term} onChange={(event) => updateGeneration('term', event.target.value)} placeholder="e.g. Term 1" maxLength={40} />
                </label>
                <label>Topic
                  <input value={generation.topic} onChange={(event) => updateGeneration('topic', event.target.value)} placeholder="e.g. Fractions" maxLength={160} />
                </label>
                <label>Lesson length (minutes)
                  <input type="number" min="5" max="480" value={generation.durationMinutes} onChange={(event) => updateGeneration('durationMinutes', event.target.value)} />
                </label>
                <label>Difficulty
                  <select value={generation.difficulty} onChange={(event) => updateGeneration('difficulty', event.target.value)}>
                    <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
                  </select>
                </label>
                <label>Number of questions
                  <input type="number" min="1" max="50" value={generation.questionCount} onChange={(event) => updateGeneration('questionCount', event.target.value)} />
                </label>
                <label>Question style
                  <select value={generation.questionFormat} onChange={(event) => updateGeneration('questionFormat', event.target.value)}>
                    <option value="mixed">Mixed</option><option value="multiple_choice">Multiple choice</option>
                    <option value="short_answer">Short answer</option><option value="essay">Essay</option>
                  </select>
                </label>
                <label>Marks per question
                  <input type="number" min="0.5" max="100" step="0.5" value={generation.marksPerQuestion} onChange={(event) => updateGeneration('marksPerQuestion', event.target.value)} />
                </label>
                <label className="ai-objectives-field">Learning objectives
                  <textarea value={generation.learningObjectives} onChange={(event) => updateGeneration('learningObjectives', event.target.value)} maxLength={1000} rows={2} placeholder="What should learners know or be able to do?" />
                </label>
              </div>
            </details>
          )}

          <div className={`ai-messages ${messages.length ? 'has-messages' : ''}`} aria-live="polite">
            {!messages.length ? (
              <div className="ai-empty-state">
                <span className="ai-empty-icon"><Sparkles size={20} aria-hidden="true" /></span>
                <h3>How can I help?</h3>
                <p>{mode === 'general'
                  ? 'Choose a suggestion or ask for help with a lesson, quiz, or topic.'
                  : 'Choose a question or ask about information your account is allowed to see.'}</p>
                <div className="ai-prompt-list">
                  {prompts.map((prompt) => <button type="button" key={prompt} onClick={() => sendMessage(prompt)} disabled={loading || historyLoading}>{prompt}</button>)}
                </div>
              </div>
            ) : messages.map((message, index) => (
              <article className={`ai-message ${message.role === 'user' ? 'from-user' : 'from-assistant'} ${message.isError ? 'is-error' : ''}`} key={`${index}-${message.role}`}>
                <span className="ai-message-avatar" aria-hidden="true">{message.role === 'user' ? <UserRound size={15} /> : <Bot size={15} />}</span>
                <div className="ai-message-content">
                  <div className="ai-message-label">
                    <strong>{message.role === 'user' ? 'You' : 'McCarthy AI'}</strong>
                    {message.role === 'assistant' && !message.isError && <span className="ai-answer-badge">
                      {message.mode === 'school_data' ? 'School records' : 'AI-generated'}
                    </span>}
                  </div>
                  <div className="ai-answer-text">{renderAnswer(message.content)}</div>
                  {message.role === 'assistant' && !message.isError && <div className="ai-message-actions">
                    <button className="btn-secondary" type="button" onClick={() => copyMessage(message.content, index)} aria-label="Copy response">
                      {copiedMessage === index ? <Check size={13} /> : <Clipboard size={13} />}
                      {copiedMessage === index ? 'Copied' : 'Copy'}
                    </button>
                    {index === lastAssistantIndex && index === messages.length - 1 && <button className="btn-secondary" type="button" onClick={regenerateLastAnswer} disabled={loading || historyLoading || !conversationId}>
                      <RotateCw size={13} /> Regenerate
                    </button>}
                  </div>}
                </div>
              </article>
            ))}
            {loading && <div className="ai-thinking"><span className="ai-thinking-dots"><i /><i /><i /></span>Thinking…</div>}
            <div ref={conversationEnd} />
          </div>

          <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={mode === 'general' ? 'What would you like help with?' : 'Ask a question about school information...'}
              maxLength={maxInputChars}
              rows={2}
              aria-label="Your message"
              disabled={loading || historyLoading}
            />
            <div className="ai-composer-footer">
              <span>Conversations are saved to your account for up to 30 days. Personal names and contact details are removed.</span>
              <button className="btn-primary" type="submit" disabled={loading || historyLoading || !question.trim()}>
                <Send size={14} aria-hidden="true" />{loading ? 'Working…' : 'Send'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

export default McCarthyAI;
