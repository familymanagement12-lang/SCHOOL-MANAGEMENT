import api from './api';

export const getKitchenItems = (params = {}) => api.get('/operations/kitchen-items', { params });
export const createKitchenItem = (data) => api.post('/operations/kitchen-items', data);
export const updateKitchenItem = (id, data) => api.put(`/operations/kitchen-items/${id}`, data);
export const setKitchenItemActive = (id, is_active) => (
  api.patch(`/operations/kitchen-items/${id}/status`, { is_active })
);
export const exportKitchenItems = (params = {}) => api.get('/operations/kitchen-items/export', {
  params,
  responseType: 'blob',
});

export const getOperationalFinancialRegister = (params = {}) => (
  api.get('/operations/financial-register', { params })
);
export const createOperationalFinancialEntry = (data) => api.post('/operations/financial-register', data);
export const deleteOperationalFinancialEntry = (module, id) => (
  api.delete(`/operations/financial-register/${module}/${id}`)
);
export const exportOperationalFinancialRegister = (params = {}) => (
  api.get('/operations/financial-register/export', { params, responseType: 'blob' })
);