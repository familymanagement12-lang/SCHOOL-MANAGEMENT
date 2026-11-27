const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../middleware/auth');
const { MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD } = require('../services/assignmentStorage');
const materials = require('../controllers/learningMaterialController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_UPLOAD, fields: 10, parts: 20 },
});
const handleUpload = (req,res,next) => upload.array('files',MAX_FILES_PER_UPLOAD)(req,res,(error) => {
  if (error instanceof multer.MulterError) {
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      message: error.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 10 MB or smaller.' : 'Upload no more than five files in one request.',
    });
  }
  next(error);
});

router.use(authenticate);
router.get('/meta',authorize(['admin','teacher']),materials.getMeta);
router.get('/',authorize(['admin','teacher']),materials.listStaffMaterials);
router.post('/',authorize(['admin','teacher']),handleUpload,materials.createMaterial);
router.get('/:id/files/:fileId',authorize(['admin','teacher']),materials.downloadMaterialFile);

module.exports = router;
