const express = require('express');
const { login, forgotPassword, resetPasswordWithToken } = require('../controllers/authController');

const router = express.Router();

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPasswordWithToken);

module.exports = router;
