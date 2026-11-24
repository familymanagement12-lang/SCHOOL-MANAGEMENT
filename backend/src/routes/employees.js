const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getEmployees, createEmployee, updateEmployee, deactivateEmployee, bulkUpsertEmployees } = require('../controllers/employeesController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin']), getEmployees);
router.post('/', authorize(['admin']), createEmployee);
router.post('/bulk', authorize(['admin']), bulkUpsertEmployees);
router.put('/:id', authorize(['admin']), updateEmployee);
router.delete('/:id', authorize(['admin']), deactivateEmployee);

module.exports = router;