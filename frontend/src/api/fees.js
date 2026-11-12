import api from './api';

export const recordFee = (data) => api.post('/fees', data);
export const getFeesByStudent = (studentId) => api.get(`/fees/${studentId}`);
