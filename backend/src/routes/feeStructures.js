const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { createFeeStructure } = require('../controllers/feeStructureController');

const router = express.Router();

router.use(authenticate);
router.post('/', authorize(['admin', 'accountant']), createFeeStructure);

module.exports = router;