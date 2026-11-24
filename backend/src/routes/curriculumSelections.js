const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const parentPortal = require('../controllers/parentPortalController');
const selection = require('../controllers/curriculumSelectionController');

const router = express.Router();
router.use(authenticate);

const parentRoutes = express.Router();
parentRoutes.use(authorize(['parent']), parentPortal.requireActiveParent);
parentRoutes.get('/', selection.getParentSelections);
parentRoutes.post('/children/:studentId', selection.submitSelection);
parentRoutes.post('/children/:studentId/change', selection.submitChangeRequest);
router.use('/parent', parentRoutes);

const adminRoutes = express.Router();
adminRoutes.use(authorize(['admin']));
adminRoutes.get('/', selection.getAdminSelections);
adminRoutes.put('/period', selection.saveSelectionPeriod);
adminRoutes.post('/:selectionId/decision', selection.decideSelection);
adminRoutes.post('/:selectionId/assign', selection.assignSelectionClass);
router.use('/admin', adminRoutes);

module.exports = router;
