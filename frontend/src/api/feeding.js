import api from './api';

export const getFeedingClasses = () => api.get('/feeding/classes');
export const setFeedingRate = (classId, daily_rate) => api.put(`/feeding/classes/${classId}/rate`, { daily_rate });
export const searchFeedingStudents = (search, classId) => api.get('/feeding/students', { params: { search, classId } });
export const getCalendarEvents = () => api.get('/feeding/calendar');
export const createCalendarEvent = (data) => api.post('/feeding/calendar', data);
export const deleteCalendarEvent = (id) => api.delete(`/feeding/calendar/${id}`);
export const getFeedingPayments = (studentId) => api.get('/feeding/payments', { params: studentId ? { studentId } : {} });
export const recordFeedingPayment = (data) => api.post('/feeding/payments', data);
export const getFeedingReceipt = (id) => api.get(`/feeding/payments/${id}/receipt`);
export const getFeedingRegister = (date) => api.get('/feeding/register', { params: { date } });
export const updateFeedingRegister = (id, is_served) => api.put(`/feeding/register/${id}`, { is_served });
export const getFeedingReport = (startDate, endDate) => api.get('/feeding/reports', { params: { startDate, endDate } });
export const getFeedingWorkbooks = () => api.get('/feeding/workbooks');
export const getImportedFinanceFigures = () => api.get('/feeding/imported-finance');
export const downloadFeedingWorkbook = (id, fileName) => api.get(`/feeding/workbooks/${id}/download`, {
  responseType: 'blob',
}).then((response) => {
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
export const getWorkbookImports = () => api.get('/feeding/imports');
export const getWorkbookImport = (id) => api.get(`/feeding/imports/${id}`);
export const previewWorkbookImport = (file, module, academic_year, term) => {
  const form = new FormData();
  form.append('workbook', file);
  form.append('module', module);
  if (academic_year) form.append('academic_year', academic_year);
  if (term) form.append('term', term);
  return api.post('/feeding/imports/preview', form);
};
export const reviewWorkbookImportRow = (importId, rowId, data) => api.put(
  `/feeding/imports/${importId}/rows/${rowId}`,
  data
);
export const confirmWorkbookImport = (importId) => api.post(`/feeding/imports/${importId}/confirm`);
export const downloadWorkbookImport = (id) => api.get(`/feeding/imports/${id}/download`, {
  responseType: 'blob',
}).then((response) => {
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `feeding-workbook-import-${id}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
export const getImportedWorkbookRows = (module) => api.get(`/feeding/history/${module}`);
export const getShoppingAdvances = () => api.get('/feeding/advances');
export const createShoppingAdvance = (data) => api.post('/feeding/advances', data);
export const reconcileShoppingAdvance = (id, returned_amount) => api.put(`/feeding/advances/${id}/reconcile`, { returned_amount });
export const getTuckshopProducts = () => api.get('/feeding/tuckshop/products');
export const saveTuckshopProduct = (data, id) => id ? api.put(`/feeding/tuckshop/products/${id}`, data) : api.post('/feeding/tuckshop/products', data);
export const getTuckshopSales = () => api.get('/feeding/tuckshop/sales');
export const createTuckshopSale = (data) => api.post('/feeding/tuckshop/sales', data);
export const getTuckshopProductPurchases = () => api.get('/feeding/tuckshop/purchases');
export const createTuckshopProductPurchase = (data) => api.post('/feeding/tuckshop/purchases', data);
export const approveTuckshopProductPurchase = (id) => api.post(`/feeding/tuckshop/purchases/${id}/approve`);
export const getTuckshopDailyReconciliation = (date) => api.get('/feeding/tuckshop/reconciliation', { params: { date } });
export const saveTuckshopDailyReconciliation = (data) => api.put('/feeding/tuckshop/reconciliation', data);
export const getKitchenStock = () => api.get('/feeding/kitchen/stock');
export const saveKitchenStock = (data, id) => id ? api.put(`/feeding/kitchen/stock/${id}`, data) : api.post('/feeding/kitchen/stock', data);
export const getKitchenPurchases = () => api.get('/feeding/kitchen/purchases');
export const createKitchenPurchase = (data) => api.post(`/feeding/${data.purpose === 'feeding' ? 'feeding' : 'kitchen'}/purchases`, data);
export const approveKitchenPurchase = (id, purpose = 'kitchen') => api.post(`/feeding/${purpose === 'feeding' ? 'feeding' : 'kitchen'}/purchases/${id}/approve`);
