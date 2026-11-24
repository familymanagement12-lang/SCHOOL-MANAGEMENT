const express = require('express');
const { login, forgotPassword, resetPasswordWithToken } = require('../controllers/authController');
const loginRateLimit = require('../middleware/loginRateLimit');

const router = express.Router();

router.post('/login', loginRateLimit, login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPasswordWithToken);

module.exports = router;
