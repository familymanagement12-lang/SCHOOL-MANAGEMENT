const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem } = require('../controllers/inventoryController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize(['admin', 'inventory', 'teacher']), getInventory);
router.post('/', authorize(['admin', 'inventory']), createInventoryItem);
router.put('/:id', authorize(['admin', 'inventory']), updateInventoryItem);
router.delete('/:id', authorize(['admin', 'inventory']), deleteInventoryItem);

module.exports = router;
