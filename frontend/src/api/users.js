import api from './api';

export const getUsers = () => api.get('/users');
export const registerUser = (userData) => api.post('/users', userData);
export const changePassword = (data) => api.put('/users/change-password', data);
export const resetUserPassword = (id) => api.post(`/users/${id}/reset-password`);
export const updateUser = (id, data) => api.put(`/users/${id}`, data);
export const deleteUser = (id) => api.delete(`/users/${id}`);