const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const parent = require('../controllers/parentPortalController');

const router = express.Router();
router.use(authenticate);

const adminRoutes = express.Router();
adminRoutes.use(authorize(['admin']));
adminRoutes.get('/parents', parent.getAdminParents);
adminRoutes.post('/parents', parent.createAdminParent);
adminRoutes.patch('/parents/:userId', parent.manageAdminParent);
adminRoutes.post('/parents/:userId/invitations', parent.reissueParentAccess);
adminRoutes.post('/parents/:userId/children', parent.manageAdminParent);
adminRoutes.delete('/parents/:userId/children/:studentId', parent.removeAdminParentLink);
adminRoutes.get('/enquiries', parent.getAdminEnquiries);
adminRoutes.patch('/enquiries/:enquiryId', parent.updateAdminEnquiry);
router.use('/admin', adminRoutes);

const parentRoutes = express.Router();
parentRoutes.use(authorize(['parent']), parent.requireActiveParent);
parentRoutes.get('/dashboard', parent.getDashboard);
parentRoutes.get('/children', parent.getChildren);
parentRoutes.get('/profile', parent.getProfile);
parentRoutes.patch('/profile', parent.updateProfile);
parentRoutes.put('/preferences', parent.updatePreferences);
parentRoutes.get('/enquiries', parent.getEnquiries);
parentRoutes.post('/enquiries', parent.createEnquiry);
parentRoutes.get('/children/:studentId/fees', parent.getFees);
parentRoutes.get('/children/:studentId/feeding', parent.getFeeding);
parentRoutes.get('/children/:studentId/results', parent.getResults);
parentRoutes.get('/children/:studentId/attendance', parent.getAttendance);
parentRoutes.get('/children/:studentId/timetable', parent.getTimetable);
parentRoutes.get('/children/:studentId/announcements', parent.getAnnouncements);
parentRoutes.get('/receipts/:receiptId', parent.getReceipt);
router.use('/', parentRoutes);

module.exports = router;
