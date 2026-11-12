const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getSubjects, createSubject, updateSubject, deleteSubject } = require('../controllers/subjectController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin', 'teacher']), getSubjects);
router.post('/', authorize(['admin']), createSubject);
router.put('/:id', authorize(['admin']), updateSubject);
router.delete('/:id', authorize(['admin']), deleteSubject);

module.exports = router;