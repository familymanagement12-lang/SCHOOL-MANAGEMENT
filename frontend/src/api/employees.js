import api from './api';

export const getEmployees = () => api.get('/employees');
export const createEmployee = (data) => api.post('/employees', data);
export const updateEmployee = (id, data) => api.put(`/employees/${id}`, data);
export const deactivateEmployee = (id) => api.delete(`/employees/${id}`);
export const bulkUpsertEmployees = (employees) => api.post('/employees/bulk', { employees });