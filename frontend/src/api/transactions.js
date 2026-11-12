import api from './api';

export const getTransactions = () => api.get('/transactions');
export const getFinanceReport = (startDate, endDate) => api.get(`/transactions/report?startDate=${startDate}&endDate=${endDate}`);
export const createTransaction = (data) => api.post('/transactions', data);
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`);