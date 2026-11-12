const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const {
  createClassAssessment,
  getStudentResults,
  getReportCard,
  listClassAssessments,
  recordResult,
  saveClassAssessmentScores,
} = require('../controllers/resultController');
const { setResultPublication } = require('../controllers/studentPortalController');

const router = express.Router();

router.use(authenticate);

router.get('/assessments', authorize(['admin', 'teacher']), listClassAssessments);
router.post('/assessments', authorize(['admin', 'teacher']), createClassAssessment);
router.put('/assessments/:assessmentId/scores', authorize(['admin', 'teacher']), saveClassAssessmentScores);
router.get('/:studentId/report', authorize(['admin', 'teacher']), getReportCard);
router.get('/:studentId', authorize(['admin', 'teacher']), getStudentResults);
router.post('/', authorize(['admin', 'teacher']), recordResult);
router.put('/publish', authorize(['admin', 'teacher']), setResultPublication);

module.exports = router;