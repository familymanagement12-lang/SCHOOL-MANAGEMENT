const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getSettings, updateSettings } = require('../controllers/settingsController');

const router = express.Router();

router.use(authenticate);
router.get('/', authorize(['admin', 'teacher']), getSettings);
router.put('/', authorize(['admin']), updateSettings);

module.exports = router;