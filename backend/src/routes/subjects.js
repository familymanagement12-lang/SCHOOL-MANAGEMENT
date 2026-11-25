const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getSubjects, createSubject, updateSubject, deleteSubject,
  upsertSubjectClassAssignment, getSubjectClassAssignments,
  upsertSubjectSchedulingPreference, getSubjectSchedulingPreferences } = require('../controllers/subjectController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin', 'teacher']), getSubjects);
router.post('/', authorize(['admin']), createSubject);
router.get('/class-assignments', authorize(['admin', 'teacher']), getSubjectClassAssignments);
router.post('/class-assignments', authorize(['admin']), upsertSubjectClassAssignment);
router.get('/scheduling-preferences', authorize(['admin', 'teacher']), getSubjectSchedulingPreferences);
router.post('/scheduling-preferences', authorize(['admin']), upsertSubjectSchedulingPreference);
router.put('/:id', authorize(['admin']), updateSubject);
router.delete('/:id', authorize(['admin']), deleteSubject);

module.exports = router;