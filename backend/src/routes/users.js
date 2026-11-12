const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const authorizeRoles = require('../middleware/authorizeRoles');
const { getUsers, createUser, changePassword, resetUserPassword, updateUser, verifyEmail, deleteUser } = require('../controllers/usersController');

// Public route (Must be defined before authenticated routes)
router.get('/verify', verifyEmail);

// Only Admins can create users; Teachers and librarians can view users for assignment tasks.
router.get('/', authenticate, authorizeRoles('admin', 'teacher', 'librarian', 'inventory', 'storekeeper'), getUsers);
router.post('/', authenticate, authorizeRoles('admin'), createUser);
router.put('/change-password', authenticate, changePassword);
router.post('/:id/reset-password', authenticate, authorizeRoles('admin'), resetUserPassword);
router.put('/:id', authenticate, authorizeRoles('admin'), updateUser);
router.delete('/:id', authenticate, authorizeRoles('admin'), deleteUser);

module.exports = router;
