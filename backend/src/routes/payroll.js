const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getPayroll, generatePayroll, markAsPaid, addDeduction } = require('../controllers/payrollController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin', 'accountant']), getPayroll);
router.post('/generate', authorize(['admin', 'accountant']), generatePayroll);
router.put('/:id/pay', authorize(['admin', 'accountant']), markAsPaid);
router.post('/:id/deductions', authorize(['admin', 'accountant']), addDeduction);

module.exports = router;