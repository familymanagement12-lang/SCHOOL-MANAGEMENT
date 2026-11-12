const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getTransactions, getFinanceReport, createTransaction, deleteTransaction } = require('../controllers/transactionController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin', 'accountant']), getTransactions);
router.get('/report', authorize(['admin', 'accountant']), getFinanceReport);
router.post('/', authorize(['admin', 'accountant']), createTransaction);
router.delete('/:id', authorize(['admin', 'accountant']), deleteTransaction);

module.exports = router;