const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const feeding = require('../controllers/feedingController');
const payments = require('../controllers/paymentController');
const reports = require('../controllers/feedingReportController');

const router = express.Router();

router.use(authenticate);

router.get('/terms', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), feeding.getTerms);
router.post('/terms', authorize(['admin', 'feeding_tuckshop_officer']), feeding.createTerm);
router.get('/rates', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), feeding.getRates);
router.post('/rates', authorize(['admin', 'feeding_tuckshop_officer']), feeding.createRate);
router.post('/calendar-exceptions', authorize(['admin', 'feeding_tuckshop_officer']), feeding.createCalendarException);

router.get('/accounts', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), feeding.getAccounts);
router.get('/accounts/:studentId', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), feeding.getAccount);
router.patch('/accounts/:studentId/frequency', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), feeding.setPaymentFrequency);

router.get('/register', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), feeding.getRegister);
router.patch('/register/:obligationId/coverage', authorize(['admin', 'feeding_tuckshop_officer']), feeding.setCoverage);

router.get('/reports/export', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), reports.exportFeedingReport);
router.get('/reports', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), reports.getFeedingReport);

router.post('/payments', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), payments.recordPayment);
router.get('/payments', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), payments.listPaymentReceipts);
router.get('/payments/:receiptId', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), payments.readPaymentReceipt);
router.post('/payments/:receiptId/refunds', authorize(['admin', 'accountant', 'feeding_tuckshop_officer']), payments.refundPayment);

module.exports = router;
