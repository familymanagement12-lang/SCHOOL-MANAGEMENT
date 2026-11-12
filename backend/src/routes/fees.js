const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { recordFee, getFeesByStudent } = require('../controllers/feesController');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize(['admin', 'accountant']), recordFee);
router.get('/:studentId', authorize(['admin', 'accountant']), getFeesByStudent);

module.exports = router;
