const express = require('express');
const { getSummary, getFinanceSummary, getFinanceAudit } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/auth');

const router = express.Router();

// Protected route - requires authentication
router.get('/summary', authenticate, authorize(['admin']), getSummary);
router.get('/finance', authenticate, authorize(['admin', 'accountant']), getFinanceSummary);
router.get('/finance/audit', authenticate, authorize(['admin', 'accountant']), getFinanceAudit);

module.exports = router;
