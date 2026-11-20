const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const operations = require('../controllers/operationsController');

const router = express.Router();
const kitchenRoles = ['admin', 'accountant', 'inventory', 'store', 'storekeeper', 'feeding_tuckshop_officer'];
const kitchenManagers = ['admin', 'inventory', 'store', 'storekeeper'];
const financeRoles = ['admin', 'accountant', 'feeding_tuckshop_officer'];

router.use(authenticate);

router.get('/kitchen-items/export', authorize(kitchenRoles), operations.exportKitchenItems);
router.get('/kitchen-items', authorize(kitchenRoles), operations.listKitchenItems);
router.post('/kitchen-items', authorize(kitchenManagers), operations.saveKitchenItem);
router.put('/kitchen-items/:id', authorize(kitchenManagers), operations.saveKitchenItem);
router.patch('/kitchen-items/:id/status', authorize(kitchenManagers), operations.setKitchenItemActive);

router.get('/financial-register/export', authorize(financeRoles), operations.exportFinancialRegister);
router.get('/financial-register', authorize(financeRoles), operations.getFinancialRegister);
router.post('/financial-register', authorize(financeRoles), operations.createFinancialEntry);
router.delete('/financial-register/:module/:id', authorize(['admin', 'accountant']), operations.deleteFinancialEntry);

module.exports = router;