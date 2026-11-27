const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { createMissingDatabaseSchemaHandler } = require('../middleware/databaseSchemaError');
const {
  getClasses, createClass, updateClass, deleteClass,
} = require('../controllers/classController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin', 'teacher', 'accountant', 'feeding_tuckshop_officer']), getClasses);
router.post('/', authorize(['admin', 'teacher']), createClass);
router.put('/:id', authorize(['admin']), updateClass);
router.delete('/:id', authorize(['admin']), deleteClass);

router.use(createMissingDatabaseSchemaHandler(
  'Class configuration database schema is unavailable. Apply the versioned classification and audit migrations before retrying.'
));

module.exports = router;
