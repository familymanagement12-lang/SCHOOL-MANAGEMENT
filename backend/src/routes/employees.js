const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getEmployees, createEmployee, updateEmployee, deactivateEmployee } = require('../controllers/employeesController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin']), getEmployees);
router.post('/', authorize(['admin']), createEmployee);
router.put('/:id', authorize(['admin']), updateEmployee);
router.delete('/:id', authorize(['admin']), deactivateEmployee);

module.exports = router;