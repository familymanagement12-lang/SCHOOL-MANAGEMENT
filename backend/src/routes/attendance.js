const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { recordAttendance, getAttendanceByClass } = require('../controllers/attendanceController');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize(['admin', 'teacher']), recordAttendance);
router.get('/:classId', authorize(['admin', 'teacher']), getAttendanceByClass);

module.exports = router;
