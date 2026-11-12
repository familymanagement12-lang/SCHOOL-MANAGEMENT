const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { recordAttendance, getAttendanceByClass, getStaffAttendance, recordStaffAttendance } = require('../controllers/attendanceController');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize(['admin', 'teacher']), recordAttendance);
router.get('/staff', authorize(['admin']), getStaffAttendance);
router.post('/staff/bulk', authorize(['admin']), recordStaffAttendance);
router.get('/:classId', authorize(['admin', 'teacher']), getAttendanceByClass);

module.exports = router;
