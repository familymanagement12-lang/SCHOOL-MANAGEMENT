const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const {
  getStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  bulkCreateStudents,
  setStudentAccountStatus,
  resetStudentAccountPassword
} = require('../controllers/studentController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin', 'teacher', 'accountant']), getStudents);
router.post('/bulk', authorize(['admin', 'teacher']), bulkCreateStudents);
router.put('/:id/account', authorize(['admin']), setStudentAccountStatus);
router.post('/:id/reset-password', authorize(['admin']), resetStudentAccountPassword);
router.get('/:id', authorize(['admin', 'teacher']), getStudentById);
router.post('/', authorize(['admin', 'teacher']), createStudent);
router.put('/:id', authorize(['admin', 'teacher']), updateStudent);
router.delete('/:id', authorize(['admin']), deleteStudent);

module.exports = router;
