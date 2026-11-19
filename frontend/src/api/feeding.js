import api from './api';

export const getFeedingTerms = () => api.get('/feeding/terms');
export const createFeedingTerm = (data) => api.post('/feeding/terms', data);
export const getFeedingRates = () => api.get('/feeding/rates');
export const createFeedingRate = (data) => api.post('/feeding/rates', data);
export const createFeedingCalendarException = (data) => api.post('/feeding/calendar-exceptions', data);
export const getFeedingAccounts = (params = {}) => api.get('/feeding/accounts', { params });
export const getFeedingAccount = (studentId, params = {}) => api.get(`/feeding/accounts/${studentId}`, { params });
export const setFeedingFrequency = (studentId, payment_frequency) => (
  api.patch(`/feeding/accounts/${studentId}/frequency`, { payment_frequency })
);
export const getFeedingRegister = (params = {}) => api.get('/feeding/register', { params });
export const updateFeedingCoverage = (obligationId, is_served) => (
  api.patch(`/feeding/register/${obligationId}/coverage`, { is_served })
);
export const getFeedingReport = (params = {}) => api.get('/feeding/reports', { params });
export const exportFeedingReport = (params = {}) => api.get('/feeding/reports/export', {
  params,
  responseType: 'blob',
});
export const recordSchoolPayment = (data) => api.post('/feeding/payments', data);
export const getPaymentReceipts = (params = {}) => api.get('/feeding/payments', { params });
export const getPaymentReceipt = (receiptId) => api.get(`/feeding/payments/${receiptId}`);
export const refundPayment = (receiptId, data) => api.post(`/feeding/payments/${receiptId}/refunds`, data);
