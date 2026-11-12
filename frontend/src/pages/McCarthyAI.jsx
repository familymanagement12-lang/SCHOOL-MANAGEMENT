import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Plus, Send, Sparkles, UserRound } from 'lucide-react';
import { askMcCarthyAi, getAiStatus } from '../api/ai';

const PROMPTS = {
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
    'Draft a lesson plan about fractions for Year 4.',
    'Create 5 revision questions about ecosystems.',
    'Recommend books about science.',
  ],
  librarian: ['Recommend books about science.', 'Summarize overdue library books.', 'Find books about African history.'],
  inventory: ['Summarize the school inventory.', 'Show stock totals by category.', 'Draft a short school management report.'],
};

function renderAnswer(content) {
  const lines = String(content || '').split(/\r?\n/);
  const blocks = [];
  let list = [];
  const flushList = () => {
    if (list.length) {
      blocks.push(<ul key={`list-${blocks.length}`}>{list.map((item, index) => <li key={index}>{item}</li>)}</ul>);
      list = [];
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flushList();
    if (!trimmed) return;
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) blocks.push(<h4 key={`heading-${index}`}>{heading[1]}</h4>);
    else blocks.push(<p key={`paragraph-${index}`}>{trimmed}</p>);
  });
  flushList();
  return blocks;
}

function McCarthyAI() {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [providerAvailable, setProviderAvailable] = useState(null);
  const [error, setError] = useState('');
  const conversationEnd = useRef(null);
  const user = useMemo(() => JSON.parse(localStorage.getItem('user') || 'null'), []);
  const prompts = PROMPTS[user?.role] || PROMPTS.admin;

  useEffect(() => {
    getAiStatus()
      .then((response) => setProviderAvailable(Boolean(response.data.available)))
      .catch(() => setProviderAvailable(false));
  }, []);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const sendMessage = async (text = question) => {
    const content = text.trim();
    if (!content || loading) return;
    const previous = messages.map(({ role, content: message }) => ({ role, content: message }));
    setMessages((current) => [...current, { role: 'user', content }]);
    setQuestion('');
    setError('');
    setLoading(true);
    try {
      const response = await askMcCarthyAi(content, previous);
      setProviderAvailable(Boolean(response.data.provider_available));
      setMessages((current) => [...current, {
        role: 'assistant',
        content: response.data.answer,
        source: response.data.source,
      }]);
    } catch (err) {
      const message = err.response?.data?.message || 'McCarthy AI could not answer right now. Please try again.';
      setError(message);
      setMessages((current) => [...current, { role: 'assistant', content: message, isError: true }]);
    } finally {
      setLoading(false);
    }
  };

  const startNewConversation = () => {
    setMessages([]);
    setQuestion('');
    setError('');
  };

  return (
    <div className="page module-page mccarthy-ai-page">
      <div className="module-shell">
        <section className="module-hero ai-hero">
          <div>
            <p className="eyebrow">School assistant</p>
            <h1>McCarthy AI</h1>
            <p>Ask about verified school records or get help preparing teaching material.</p>
          </div>
          <div className={`ai-availability ${providerAvailable ? 'is-ready' : providerAvailable === false ? 'is-limited' : ''}`}>
            <span />{providerAvailable === null ? 'Checking assistant' : providerAvailable ? 'AI assistant ready' : 'Database answers available'}
          </div>
        </section>

        {!providerAvailable && providerAvailable !== null && <div className="ai-notice" role="status">
          AI-generated summaries and teaching drafts are unavailable until the backend OpenAI key is configured. Verified school-data queries will still return directly from authorized database records.
        </div>}
        {error && <div className="error ai-error" role="alert">{error}</div>}

        <section className="data-panel ai-chat-panel" aria-label="McCarthy AI conversation">
          <div className="ai-chat-heading">
            <div><p className="eyebrow">Assistant</p><h2>Ask McCarthy AI</h2></div>
            <button className="btn-secondary ai-new-chat" type="button" onClick={startNewConversation} disabled={!messages.length && !question}>
              <Plus size={15} aria-hidden="true" /> New conversation
            </button>
          </div>

          <div className={`ai-messages ${messages.length ? 'has-messages' : ''}`} aria-live="polite">
            {!messages.length ? (
              <div className="ai-empty-state">
                <span className="ai-empty-icon"><Sparkles size={20} aria-hidden="true" /></span>
                <h3>How can I help?</h3>
                <p>Choose a prompt or ask a question. School facts are checked against records your role is allowed to see.</p>
                <div className="ai-prompt-list">
                  {prompts.map((prompt) => <button type="button" key={prompt} onClick={() => sendMessage(prompt)} disabled={loading}>{prompt}</button>)}
                </div>
              </div>
            ) : messages.map((message, index) => (
              <article className={`ai-message ${message.role === 'user' ? 'from-user' : 'from-assistant'} ${message.isError ? 'is-error' : ''}`} key={`${index}-${message.role}`}>
                <span className="ai-message-avatar" aria-hidden="true">{message.role === 'user' ? <UserRound size={15} /> : <Bot size={15} />}</span>
                <div className="ai-message-content">
                  <strong>{message.role === 'user' ? 'You' : 'McCarthy AI'}</strong>
                  <div className="ai-answer-text">{renderAnswer(message.content)}</div>
                  {message.source && <small className="ai-source">Source: {message.source}</small>}
                </div>
              </article>
            ))}
            {loading && <div className="ai-thinking"><span className="ai-thinking-dots"><i /><i /><i /></span>Checking authorized records and preparing an answer…</div>}
            <div ref={conversationEnd} />
          </div>

          <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a school question or request teaching material..."
              maxLength={2000}
              rows={2}
              aria-label="Your message"
              disabled={loading}
            />
            <div className="ai-composer-footer">
              <span>Read-only school records · Your messages are not saved after leaving this page</span>
              <button className="btn-primary" type="submit" disabled={loading || !question.trim()}>
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
