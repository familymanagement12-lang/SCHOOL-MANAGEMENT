const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const authorizePermission = require('../middleware/authorizePermission');
const authorizeAnyPermission = require('../middleware/authorizeAnyPermission');
const {
  approveKitchenPurchase,
  approveTuckshopProductPurchase,
  createCalendarEvent,
  createKitchenPurchase,
  createShoppingAdvance,
  createTuckshopProductPurchase,
  createTuckshopSale,
  deleteCalendarEvent,
  getFeedingClasses,
  getFeedingPayments,
  getFeedingReceipt,
  getFeedingRegister,
  getFeedingReport,
  getImportedFinanceFigures,
  getImportedWorkbooks,
  downloadImportedWorkbook,
  getShoppingAdvances,
  getCalendarEvents,
  getKitchenPurchases,
  getKitchenStock,
  getTuckshopProducts,
  getTuckshopProductPurchases,
  getTuckshopSales,
  getTuckshopDailyReconciliation,
  recordFeedingPayment,
  reconcileShoppingAdvance,
  saveTuckshopDailyReconciliation,
  saveKitchenStock,
  saveTuckshopProduct,
  searchFeedingStudents,
  setFeedingRate,
  updateFeedingRegister,
} = require('../controllers/feedingController');
const feedingImportController = require('../controllers/feedingImportController');

const router = express.Router();
router.use(authenticate);
const workbookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('workbook');
const uploadWorkbook = (req, res, next) => workbookUpload(req, res, (error) => {
  if (!error) return next();
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Workbook uploads are limited to 10 MB.' });
  }
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ message: 'Upload one workbook using the workbook field.' });
  }
  return next(error);
});
const purchasePurpose = (purpose) => (req, res, next) => {
  req.expectedPurchasePurpose = purpose;
  if (req.method === 'POST' && req.path.endsWith('/purchases') && req.body.purpose !== purpose) {
    return res.status(400).json({ message: `This purchase form only records ${purpose} purchases.` });
  }
  next();
};

router.get('/classes', authorizeAnyPermission('feeding.students.read', 'feeding.rates.read', 'feeding.rates.manage', 'feeding.payments.create'), getFeedingClasses);
router.put('/classes/:classId/rate', authorizePermission('feeding.rates.manage'), setFeedingRate);
router.get('/students', authorizeAnyPermission('feeding.students.read', 'feeding.payments.create'), searchFeedingStudents);
router.get('/calendar', authorizeAnyPermission('feeding.access', 'feeding.calendar.manage'), getCalendarEvents);
router.post('/calendar', authorizePermission('feeding.calendar.manage'), createCalendarEvent);
router.delete('/calendar/:id', authorizePermission('feeding.calendar.manage'), deleteCalendarEvent);
router.get('/payments', authorizePermission('feeding.payments.read'), getFeedingPayments);
router.post('/payments', authorizePermission('feeding.payments.create'), recordFeedingPayment);
router.get('/payments/:id/receipt', authorizePermission('feeding.payments.read'), getFeedingReceipt);
router.get('/register', authorizeAnyPermission('feeding.register.read', 'feeding.register.manage'), getFeedingRegister);
router.put('/register/:id', authorizePermission('feeding.register.manage'), updateFeedingRegister);
router.get('/reports', authorizeAnyPermission('feeding.reports.read', 'tuckshop.reports.read'), getFeedingReport);
router.get('/imported-finance', authorizeAnyPermission('feeding.reports.read', 'tuckshop.reports.read', 'feeding.market.read', 'feeding.market.manage', 'feeding.marketing.read', 'feeding.marketing.manage'), getImportedFinanceFigures);
router.get('/workbooks', authorizeAnyPermission('feeding.reports.read', 'tuckshop.reports.read', 'feeding.market.read', 'feeding.market.manage', 'feeding.marketing.read', 'feeding.marketing.manage', 'feeding.import.review'), getImportedWorkbooks);
router.get('/workbooks/:id/download', authorizeAnyPermission('feeding.reports.read', 'tuckshop.reports.read', 'feeding.market.read', 'feeding.market.manage', 'feeding.marketing.read', 'feeding.marketing.manage', 'feeding.import.review'), downloadImportedWorkbook);
router.get('/imports', authorizePermission('feeding.import.review'), feedingImportController.listWorkbookImports);
router.post('/imports/preview', authorizePermission('feeding.import.review'), uploadWorkbook, feedingImportController.previewWorkbookImport);
router.get('/imports/:id/download', authorizePermission('feeding.import.review'), feedingImportController.downloadWorkbookImport);
router.get('/imports/:id', authorizePermission('feeding.import.review'), feedingImportController.getWorkbookImport);
router.put('/imports/:id/rows/:rowId', authorizePermission('feeding.import.review'), feedingImportController.reviewWorkbookImportRow);
router.post('/imports/:id/confirm', authorizePermission('feeding.import.confirm'), feedingImportController.confirmWorkbookImport);
router.get('/history/:module', authorizeAnyPermission(
  'feeding.students.read', 'feeding.payments.read', 'feeding.reports.read',
  'feeding.purchases.read', 'tuckshop.purchases.read', 'tuckshop.reports.read',
  'feeding.market.read', 'feeding.market.manage', 'feeding.marketing.read',
  'feeding.marketing.manage'
), feedingImportController.getHistoricalWorkbookRows);
router.get('/advances', authorizePermission('feeding.advances.manage'), getShoppingAdvances);
router.post('/advances', authorizePermission('feeding.advances.manage'), createShoppingAdvance);
router.put('/advances/:id/reconcile', authorizePermission('feeding.advances.manage'), reconcileShoppingAdvance);

router.get('/tuckshop/products', authorizeAnyPermission(
  'tuckshop.products.read', 'tuckshop.products.manage', 'tuckshop.sales.create',
  'tuckshop.purchases.create', 'tuckshop.purchases.approve'
), getTuckshopProducts);
router.post('/tuckshop/products', authorizePermission('tuckshop.products.manage'), saveTuckshopProduct);
router.put('/tuckshop/products/:id', authorizePermission('tuckshop.products.manage'), saveTuckshopProduct);
router.get('/tuckshop/sales', authorizePermission('tuckshop.sales.read'), getTuckshopSales);
router.post('/tuckshop/sales', authorizePermission('tuckshop.sales.create'), createTuckshopSale);
router.get('/tuckshop/purchases', authorizeAnyPermission('tuckshop.purchases.read', 'tuckshop.purchases.create', 'tuckshop.purchases.approve'), getTuckshopProductPurchases);
router.post('/tuckshop/purchases', authorizePermission('tuckshop.purchases.create'), createTuckshopProductPurchase);
router.post('/tuckshop/purchases/:id/approve', authorizePermission('tuckshop.purchases.approve'), approveTuckshopProductPurchase);
router.get('/tuckshop/reconciliation', authorizePermission('tuckshop.sales.reconcile'), getTuckshopDailyReconciliation);
router.put('/tuckshop/reconciliation', authorizePermission('tuckshop.sales.reconcile'), saveTuckshopDailyReconciliation);
router.get('/kitchen/stock', authorizeAnyPermission('feeding.purchases.create', 'feeding.purchases.approve', 'tuckshop.stock.read', 'tuckshop.stock.manage', 'tuckshop.purchases.create', 'tuckshop.purchases.approve'), getKitchenStock);
router.post('/kitchen/stock', authorizePermission('tuckshop.stock.manage'), saveKitchenStock);
router.put('/kitchen/stock/:id', authorizePermission('tuckshop.stock.manage'), saveKitchenStock);
router.get('/kitchen/purchases', authorizeAnyPermission(
  'feeding.purchases.read', 'feeding.purchases.create', 'feeding.purchases.approve',
  'tuckshop.purchases.read', 'tuckshop.purchases.create', 'tuckshop.purchases.approve'
), getKitchenPurchases);
router.post('/kitchen/purchases', authorizePermission('tuckshop.purchases.create'), purchasePurpose('kitchen'), createKitchenPurchase);
router.post('/feeding/purchases', authorizePermission('feeding.purchases.create'), purchasePurpose('feeding'), createKitchenPurchase);
router.post('/kitchen/purchases/:id/approve', authorizePermission('tuckshop.purchases.approve'), purchasePurpose('kitchen'), approveKitchenPurchase);
router.post('/feeding/purchases/:id/approve', authorizePermission('feeding.purchases.approve'), purchasePurpose('feeding'), approveKitchenPurchase);

module.exports = router;
