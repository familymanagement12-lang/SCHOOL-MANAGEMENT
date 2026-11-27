const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../middleware/auth');
const { MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD } = require('../services/assignmentStorage');
const assignments = require('../controllers/assignmentController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_UPLOAD, fields: 10, parts: 20 },
});
const handleUpload = (req, res, next) => upload.array('files', MAX_FILES_PER_UPLOAD)(req, res, (error) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'Each file must be 10 MB or smaller.'
        : 'Upload no more than five files in one request.',
    });
  }
  next(error);
});

router.use(authenticate);
router.get('/meta', authorize(['admin', 'teacher']), assignments.getMeta);
router.get('/', authorize(['admin', 'teacher']), assignments.listAssignments);
router.post('/', authorize(['admin', 'teacher']), assignments.createAssignment);
router.put('/:id', authorize(['admin', 'teacher']), assignments.updateAssignment);
router.post('/:id/publish', authorize(['admin', 'teacher']), assignments.publishAssignment);
router.get('/:id/submissions', authorize(['admin', 'teacher']), assignments.getSubmissions);
router.put('/:id/submissions/:submissionId/mark', authorize(['admin', 'teacher']), assignments.markSubmission);
router.post('/:id/attachments', authorize(['admin', 'teacher']), handleUpload, assignments.uploadAssignmentFiles);
router.get('/:id/attachments/:fileId', authorize(['admin', 'teacher', 'student']), assignments.downloadAssignmentFile);
router.get('/:id/submission-files/:fileId', authorize(['admin', 'teacher', 'student']), (req, res, next) => {
  req.params.fileType = 'submission';
  assignments.downloadAssignmentFile(req, res, next);
});

module.exports = router;
