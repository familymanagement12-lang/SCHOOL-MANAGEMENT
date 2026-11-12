import api from './api';

export const getAiStatus = () => api.get('/ai/status');
export const askMcCarthyAi = (question, history = []) => api.post('/ai/chat', { question, history });
