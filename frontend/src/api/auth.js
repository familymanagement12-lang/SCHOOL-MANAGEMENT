import api from './api';

export const login = (payload) => api.post('/auth/login', payload);
export const forgotPassword = (payload) => api.post('/auth/forgot-password', payload);
export const resetPasswordWithToken = (payload) => api.post('/auth/reset-password', payload);

export const getToken = () => localStorage.getItem('sms_token');
export const logout = () => {
  localStorage.removeItem('sms_token');
  localStorage.removeItem('user');
  api.defaults.headers.common.Authorization = undefined;
};
