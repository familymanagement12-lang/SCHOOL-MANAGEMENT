import api from './api';

export const getStudents = () => api.get('/students');
export const getStudentById = (id) => api.get(`/students/${id}`);
export const createStudent = (data) => api.post('/students', data);
export const updateStudent = (id, data) => api.put(`/students/${id}`, data);
export const deleteStudent = (id) => api.delete(`/students/${id}`);
export const bulkCreateStudents = (data) => api.post('/students/bulk', data);
export const setStudentAccountStatus = (id, is_active) => api.put(`/students/${id}/account`, { is_active });
export const resetStudentAccountPassword = (id) => api.post(`/students/${id}/reset-password`);
