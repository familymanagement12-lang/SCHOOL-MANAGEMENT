const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getAnnouncements, createAnnouncement } = require('../controllers/announcementController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin', 'teacher', 'librarian']), getAnnouncements);
router.post('/', authorize(['admin', 'teacher']), createAnnouncement);

module.exports = router;