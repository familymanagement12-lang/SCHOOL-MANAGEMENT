const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const {
  getDashboard,
  getProfile,
  getSubjects,
  getTimetable,
  getAttendance,
  getResults,
  getAnnouncements,
} = require('../controllers/studentPortalController');

const router = express.Router();

router.use(authenticate, authorize(['student']));
router.get('/dashboard', getDashboard);
router.get('/profile', getProfile);
router.get('/subjects', getSubjects);
router.get('/timetable', getTimetable);
router.get('/attendance', getAttendance);
router.get('/results', getResults);
router.get('/announcements', getAnnouncements);

module.exports = router;
