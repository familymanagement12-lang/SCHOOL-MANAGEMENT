import api from './api';

export const getPayroll = (month, year) => {
  const query = (month && year) ? `?month=${month}&year=${year}` : '';
  return api.get(`/payroll${query}`);
};
export const generatePayroll = (data) => api.post('/payroll/generate', data);
export const markAsPaid = (id) => api.put(`/payroll/${id}/pay`);
export const addDeduction = (id, data) => api.post(`/payroll/${id}/deductions`, data);