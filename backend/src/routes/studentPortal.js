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
const assignments = require('../controllers/assignmentController');
const learningMaterials = require('../controllers/learningMaterialController');
const multer = require('multer');
const { MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD } = require('../services/assignmentStorage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_UPLOAD, fields: 10, parts: 20 },
});
const handleUpload = (req, res, next) => upload.array('files', MAX_FILES_PER_UPLOAD)(req, res, (error) => {
  if (error instanceof multer.MulterError) {
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'Each file must be 10 MB or smaller.'
        : 'Upload no more than five files in one request.',
    });
  }
  next(error);
});

router.use(authenticate, authorize(['student']));
router.get('/dashboard', getDashboard);
router.get('/profile', getProfile);
router.get('/subjects', getSubjects);
router.get('/timetable', getTimetable);
router.get('/attendance', getAttendance);
router.get('/results', getResults);
router.get('/announcements', getAnnouncements);
router.get('/assignments', assignments.getStudentAssignments);
router.get('/materials', learningMaterials.listStudentMaterials);
router.get('/materials/:id/files/:fileId', learningMaterials.downloadMaterialFile);
router.get('/assignments/:id', assignments.getStudentAssignment);
router.put('/assignments/:id/draft', assignments.saveStudentDraft);
router.post('/assignments/:id/files', handleUpload, assignments.uploadStudentSubmissionFiles);
router.post('/assignments/:id/submit', assignments.submitStudentAssignment);
router.get('/assignments/:id/attachments/:fileId', (req, res, next) => {
  req.params.fileType = 'reference';
  assignments.downloadAssignmentFile(req, res, next);
});
router.get('/assignments/:id/submission-files/:fileId', (req, res, next) => {
  req.params.fileType = 'submission';
  assignments.downloadAssignmentFile(req, res, next);
});

module.exports = router;
