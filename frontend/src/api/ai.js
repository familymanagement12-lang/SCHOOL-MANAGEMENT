import api from './api';

export const getAiStatus = () => api.get('/ai/status');
export const askMcCarthyAi = (question, options = {}) => api.post('/ai/chat', { question, ...options });
export const generateMcCarthyAi = (question, type, generation, conversationId, regenerate = false) => api.post('/ai/generate', {
  question,
  type,
  generation,
  conversationId,
  regenerate,
});
export const getAiConversations = () => api.get('/ai/conversations');
export const getAiConversation = (id) => api.get(`/ai/conversations/${encodeURIComponent(id)}`);
export const deleteAiConversation = (id) => api.delete(`/ai/conversations/${encodeURIComponent(id)}`);
export const getAiUsage = () => api.get('/ai/usage');
