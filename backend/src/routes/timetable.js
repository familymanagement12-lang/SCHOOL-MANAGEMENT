const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { createMissingDatabaseSchemaHandler } = require('../middleware/databaseSchemaError');
const {
  getTimetable,
  getTimetableMeta,
  getVersions,
  createVersion,
  copyPreviousTerm,
  createTimetableEntry,
  updateTimetableEntry,
  deleteTimetableEntry,
  setEntryLock,
  upsertClassTeacher,
  upsertAssignment,
  deleteAssignment,
  upsertRequirement,
  upsertRoom,
  upsertPeriod,
  upsertAvailability,
  upsertWorkloadLimit,
  updateTimetableSettings,
  getValidation,
  getHealth,
  getSuggestions,
  generateTimetable,
  publishTimetable,
} = require('../controllers/timetableController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin', 'teacher']), getTimetable);
router.get('/meta', authorize(['admin']), getTimetableMeta);
router.get('/versions', authorize(['admin', 'teacher']), getVersions);
router.post('/versions', authorize(['admin']), createVersion);
router.post('/versions/:id/copy', authorize(['admin']), copyPreviousTerm);
router.get('/validation', authorize(['admin']), getValidation);
router.get('/health', authorize(['admin']), getHealth);
router.get('/suggestions', authorize(['admin']), getSuggestions);
router.post('/', authorize(['admin']), createTimetableEntry);
router.post('/assignments', authorize(['admin']), upsertAssignment);
router.post('/class-teachers', authorize(['admin']), upsertClassTeacher);
router.delete('/assignments/:id', authorize(['admin']), deleteAssignment);
router.post('/requirements', authorize(['admin']), upsertRequirement);
router.post('/rooms', authorize(['admin']), upsertRoom);
router.post('/periods', authorize(['admin']), upsertPeriod);
router.post('/availability', authorize(['admin']), upsertAvailability);
router.post('/workload', authorize(['admin']), upsertWorkloadLimit);
router.put('/settings', authorize(['admin']), updateTimetableSettings);
router.post('/generate', authorize(['admin']), generateTimetable);
router.post('/publish', authorize(['admin']), publishTimetable);
router.post('/suggestions', authorize(['admin']), getSuggestions);
router.put('/:id', authorize(['admin']), updateTimetableEntry);
router.put('/:id/lock', authorize(['admin']), setEntryLock);
router.delete('/:id', authorize(['admin']), deleteTimetableEntry);

router.use(createMissingDatabaseSchemaHandler(
  'Timetable database schema is unavailable. Apply the versioned timetable migrations before retrying.'
));

module.exports = router;
