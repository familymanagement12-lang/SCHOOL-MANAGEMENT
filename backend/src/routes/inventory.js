const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem } = require('../controllers/inventoryController');
const store = require('../controllers/storeInventoryController');

const router = express.Router();

router.use(authenticate);

const storeRoles = ['admin', 'inventory', 'store', 'storekeeper', 'feeding_tuckshop_officer'];
const requestRoles = ['admin', 'inventory', 'storekeeper', 'teacher'];

router.get('/dashboard', authorize(storeRoles), store.getInventoryDashboard);
router.get('/search', authorize(storeRoles), store.searchInventory);
router.get('/request-catalogue', authorize(requestRoles), store.getRequestCatalogue);
router.get('/staff', authorize(storeRoles), store.getInventoryStaff);
router.get('/reports', authorize(storeRoles), store.getInventoryReport);
router.get('/movements', authorize(storeRoles), store.listMovements);

router.get('/suppliers', authorize(storeRoles), store.listSuppliers);
router.post('/suppliers', authorize(storeRoles), store.saveSupplier);
router.put('/suppliers/:id', authorize(storeRoles), store.saveSupplier);
router.patch('/suppliers/:id/status', authorize(storeRoles), store.setSupplierStatus);

router.get('/purchases', authorize(storeRoles), store.listPurchases);
router.post('/purchases', authorize(storeRoles), store.createPurchase);
router.patch('/purchases/:id/decision', authorize(['admin', 'feeding_tuckshop_officer']), store.decidePurchase);
router.post('/purchases/:id/receive', authorize(storeRoles), store.receivePurchaseDelivery);

router.get('/issuances', authorize(storeRoles), store.listIssuances);
router.post('/issuances', authorize(storeRoles), store.issueInventory);
router.post('/adjustments', authorize(storeRoles), store.adjustStock);

router.get('/assets', authorize(storeRoles), store.listAssets);
router.post('/assets', authorize(storeRoles), store.registerAsset);
router.patch('/assets/quantity', authorize(storeRoles), store.adjustAssetQuantity);
router.get('/assets/:id/history', authorize(storeRoles), store.getAssetHistory);
router.patch('/assets/:id', authorize(storeRoles), store.updateAsset);

router.get('/maintenance', authorize(storeRoles), store.listMaintenance);
router.post('/maintenance', authorize(storeRoles), store.createMaintenance);
router.patch('/maintenance/:id/complete', authorize(storeRoles), store.completeMaintenance);

router.get('/requests', authorize(requestRoles), store.listRequests);
router.post('/requests', authorize(requestRoles), store.createRequest);
router.patch('/requests/:id/decision', authorize(storeRoles), store.decideRequest);
router.post('/requests/:id/fulfill', authorize(storeRoles), store.fulfillRequest);

router.get('/stocktakes', authorize(storeRoles), store.listStocktakes);
router.post('/stocktakes', authorize(storeRoles), store.createStocktake);
router.post('/stocktakes/:id/reconcile', authorize(storeRoles), store.reconcileStocktake);

router.get('/', authorize(['admin', 'inventory', 'storekeeper', 'teacher']), getInventory);
router.post('/', authorize(storeRoles), createInventoryItem);
router.put('/:id', authorize(storeRoles), updateInventoryItem);
router.delete('/:id', authorize(['admin', 'feeding_tuckshop_officer']), deleteInventoryItem);

module.exports = router;
