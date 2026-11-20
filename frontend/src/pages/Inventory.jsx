import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import {
  getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem, adjustInventoryAssetQuantity,
  getInventoryDashboard, getInventorySuppliers, createInventorySupplier,
  updateInventorySupplier, setInventorySupplierStatus, getInventoryPurchases,
  createInventoryPurchase, decideInventoryPurchase, receiveInventoryPurchase, getInventoryIssuances,
  issueInventory, adjustInventoryStock, getInventoryAssets, registerInventoryAsset,
  updateInventoryAsset, getInventoryAssetHistory, getInventoryMaintenance,
  createInventoryMaintenance, completeInventoryMaintenance, getInventoryRequests,
  createInventoryRequest, decideInventoryRequest, fulfillInventoryRequest,
  getInventoryStocktakes, createInventoryStocktake, reconcileInventoryStocktake,
  getInventoryMovements, getInventoryRequestCatalogue, getInventoryReport,
  getInventoryStaff,
} from '../api/inventory';
import { getKitchenItems } from '../api/operations';
import { getUsers } from '../api/users';

const managerRoles = ['admin', 'inventory', 'store', 'storekeeper', 'feeding_tuckshop_officer'];
const initialItem = {
  item_name: '', item_code: '', barcode: '', category: 'School Store',
  item_type: 'consumable', unit: 'piece', quantity: '0', minimum_stock: '0',
  purchase_price: '0', supplier_id: '', assigned_to: '', storage_location: '',
  item_status: 'active', expiry_date: '', description: '', stock_reason: '',
};
const emptySupplier = { name: '', contact_name: '', email: '', phone: '', address: '', notes: '' };
const emptyTabs = [
  ['dashboard', 'Dashboard'], ['catalogue', 'Catalogue'], ['suppliers', 'Suppliers'],
  ['purchases', 'Purchases'], ['issuance', 'Stock out / issuance'], ['requests', 'Requests & approvals'],
  ['assets', 'Asset register'], ['maintenance', 'Maintenance'], ['stocktake', 'Stock taking'],
  ['alerts', 'Alerts'], ['reports', 'Reports'], ['history', 'Transaction history'],
];
const formatMoney = (value) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GHS' }).format(Number(value || 0));
const shortDate = (value) => value ? new Date(value).toLocaleDateString() : '-';
const errorMessage = (error, fallback) => error.response?.data?.message || fallback;
const transactionKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const pill = (value) => <span className="status-pill present">{String(value || '').replaceAll('_', ' ')}</span>;

function BarcodeLabel({ value, name }) {
  const barcodeRef = useRef(null);
  const [barcodeError, setBarcodeError] = useState('');
  useEffect(() => {
    try {
      JsBarcode(barcodeRef.current, value, { format: 'CODE128', displayValue: true, height: 54, margin: 4, fontSize: 13 });
      setBarcodeError('');
    } catch {
      setBarcodeError('This barcode value is not supported. Use letters and numbers.');
    }
  }, [value]);
  return (
    <div className="inventory-print-label">
      <strong>{name}</strong>
      {barcodeError ? <p className="error">{barcodeError}</p> : <svg ref={barcodeRef} aria-label={`Barcode ${value}`} />}
      <small>{value}</small>
    </div>
  );
}

function Inventory() {
  let user = null;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  const canManage = managerRoles.includes(user?.role);
  const isAdmin = ['admin', 'feeding_tuckshop_officer'].includes(user?.role);
  const [tab, setTab] = useState(canManage ? 'dashboard' : 'requests');
  const [inventory, setInventory] = useState([]);
  const [requestCatalogue, setRequestCatalogue] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierHistoryId, setSupplierHistoryId] = useState('');
  const [users, setUsers] = useState([]);
  const [staffDirectory, setStaffDirectory] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [kitchenPlans, setKitchenPlans] = useState([]);
  const [issuances, setIssuances] = useState([]);
  const [assets, setAssets] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [requests, setRequests] = useState([]);
  const [stocktakes, setStocktakes] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inventoryForm, setInventoryForm] = useState(initialItem);
  const [editingItem, setEditingItem] = useState(null);
  const [editingAssetCount, setEditingAssetCount] = useState(null);
  const [assetCountForm, setAssetCountForm] = useState({ target_quantity: '', reason: '', asset_ids: [], event_type: 'missing' });
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [scannerValue, setScannerValue] = useState('');
  const [supplierForm, setSupplierForm] = useState(emptySupplier);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [purchaseForm, setPurchaseForm] = useState({
    supplier_id: '', purchase_reference: '', purchase_date: new Date().toISOString().slice(0, 10),
    invoice_number: '', notes: '', items: [{ inventory_id: '', kitchen_item_plan_id: '', quantity_ordered: '', unit_price: '', expiry_date: '' }],
  });
  const [receivingPurchaseId, setReceivingPurchaseId] = useState('');
  const [deliveryForm, setDeliveryForm] = useState({ delivery_reference: '', notes: '', quantities: {} });
  const [issueForm, setIssueForm] = useState({
    inventory_id: '', recipient_type: 'student', recipient_name: '',
    department: '', quantity: '1', purpose: '',
  });
  const [lastReceipt, setLastReceipt] = useState(null);
  const [adjustmentForm, setAdjustmentForm] = useState({ inventory_id: '', quantity_change: '', reason: '', movement_type: 'adjustment' });
  const [requestForm, setRequestForm] = useState({ inventory_id: '', quantity_requested: '1', department: '', purpose: '' });
  const [requestQuantities, setRequestQuantities] = useState({});
  const [assetForm, setAssetForm] = useState({ inventory_id: '', asset_code: '', serial_number: '', barcode: '', condition: 'good', location: '', purchase_date: '', purchase_price: '0', notes: '' });
  const [assetActionForm, setAssetActionForm] = useState({});
  const [historyAsset, setHistoryAsset] = useState(null);
  const [maintenanceForm, setMaintenanceForm] = useState({ asset_id: '', description: '', maintenance_date: new Date().toISOString().slice(0, 10), cost: '0' });
  const [stocktakeForm, setStocktakeForm] = useState({ reference_number: '', notes: '', counts: {} });
  const [reportType, setReportType] = useState('inventory');
  const [reportDates, setReportDates] = useState({ from: '', to: '' });
  const [reportRows, setReportRows] = useState([]);
  const [printLabel, setPrintLabel] = useState(null);

  const refresh = async () => {
    setError('');
    try {
      if (!canManage) {
        const [inventoryResponse, requestResponse, catalogueResponse] = await Promise.all([
          getInventory(), getInventoryRequests(), getInventoryRequestCatalogue(),
        ]);
        setInventory(inventoryResponse.data);
        setRequests(requestResponse.data);
        setRequestCatalogue(catalogueResponse.data);
        return;
      }
      const responses = await Promise.all([
        getInventory(), getInventoryDashboard(), getInventorySuppliers(), getUsers(),
        getInventoryPurchases(), getInventoryIssuances(), getInventoryAssets(),
        getInventoryMaintenance(), getInventoryRequests(), getInventoryStocktakes(), getInventoryMovements(),
        getInventoryStaff(), getKitchenItems().catch(() => ({ data: [] })),
      ]);
      setInventory(responses[0].data);
      setRequestCatalogue(responses[0].data.filter((item) => item.item_type !== 'asset' && item.item_status === 'active'));
      setDashboard(responses[1].data);
      setSuppliers(responses[2].data);
      setUsers(responses[3].data.filter((entry) => entry.is_active !== false && entry.role !== 'student'));
      setPurchases(responses[4].data);
      setIssuances(responses[5].data);
      setAssets(responses[6].data);
      setMaintenance(responses[7].data);
      setRequests(responses[8].data);
      setStocktakes(responses[9].data);
      setMovements(responses[10].data);
      setStaffDirectory(responses[11].data);
      setKitchenPlans(responses[12].data);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Failed to load store data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!printLabel) return undefined;
    const timer = setTimeout(() => window.print(), 250);
    return () => clearTimeout(timer);
  }, [printLabel]);

  const categories = useMemo(() => [...new Set(inventory.map((item) => item.category).filter(Boolean))].sort(), [inventory]);
  const filteredInventory = useMemo(() => inventory.filter((item) => {
    const query = search.toLocaleLowerCase();
    const matchesText = !query || [item.item_name, item.item_code, item.barcode, item.description, item.assigned_to_name]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
    return matchesText && (!categoryFilter || item.category === categoryFilter)
      && (!typeFilter || item.item_type === typeFilter)
      && item.item_status !== 'archived';
  }), [inventory, search, categoryFilter, typeFilter]);
  const activeItems = useMemo(() => inventory.filter((item) => item.item_status === 'active'), [inventory]);
  const consumables = activeItems.filter((item) => item.item_type !== 'asset');
  const assetCatalogue = activeItems.filter((item) => item.item_type === 'asset');
  const assetCountDifference = editingAssetCount
    ? Number(assetCountForm.target_quantity) - Number(editingAssetCount.quantity)
    : 0;
  const removableAssets = editingAssetCount
    ? assets.filter((asset) => Number(asset.inventory_id) === Number(editingAssetCount.id) && asset.status === 'available')
    : [];
  const teacherOptions = users.filter((entry) => entry.role !== 'student');

  const runAction = async (action, successMessage) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      await refresh();
    } catch (requestError) {
      setError(errorMessage(requestError, 'The operation could not be completed.'));
    } finally {
      setSaving(false);
    }
  };

  const resetItemForm = () => { setEditingItem(null); setInventoryForm(initialItem); };
  const editItem = (item) => {
    setEditingItem(item.id);
    setInventoryForm({
      item_name: item.item_name || '', item_code: item.item_code || '', barcode: item.barcode || '',
      category: item.category || 'School Store', item_type: item.item_type || 'consumable',
      unit: item.unit || 'piece', quantity: String(item.quantity ?? 0),
      minimum_stock: String(item.minimum_stock ?? 0), purchase_price: String(item.purchase_price ?? 0),
      supplier_id: item.supplier_id || '', assigned_to: item.assigned_to || '',
      storage_location: item.storage_location || '', item_status: item.item_status || 'active',
      expiry_date: item.expiry_date ? String(item.expiry_date).slice(0, 10) : '',
      description: item.description || '', stock_reason: '',
    });
  };
  const saveItem = async (event) => {
    event.preventDefault();
    await runAction(async () => {
      const payload = {
        ...inventoryForm,
        quantity: Number(inventoryForm.quantity),
        minimum_stock: Number(inventoryForm.minimum_stock),
        purchase_price: Number(inventoryForm.purchase_price),
      };
      if (editingItem) await updateInventoryItem(editingItem, payload);
      else await createInventoryItem(payload);
      resetItemForm();
    }, editingItem ? 'Catalogue item updated.' : 'Item added to the catalogue.');
  };
  const archiveItem = async (item) => {
    if (!window.confirm(`Archive ${item.item_name}? Historical transactions will be retained.`)) return;
    await runAction(() => deleteInventoryItem(item.id), 'Item archived.');
  };
  const saveSupplier = async (event) => {
    event.preventDefault();
    await runAction(async () => {
      if (editingSupplier) await updateInventorySupplier(editingSupplier, supplierForm);
      else await createInventorySupplier(supplierForm);
      setSupplierForm(emptySupplier);
      setEditingSupplier(null);
    }, editingSupplier ? 'Supplier updated.' : 'Supplier registered.');
  };
  const addPurchaseLine = () => setPurchaseForm((previous) => ({
    ...previous, items: [...previous.items, { inventory_id: '', kitchen_item_plan_id: '', quantity_ordered: '', unit_price: '', expiry_date: '' }],
  }));
  const updatePurchaseLine = (index, field, value) => setPurchaseForm((previous) => ({
    ...previous,
    items: previous.items.map((item, lineIndex) => lineIndex === index ? { ...item, [field]: value } : item),
  }));
  const createPurchaseOrder = async (event) => {
    event.preventDefault();
    await runAction(async () => {
      await createInventoryPurchase({
        ...purchaseForm,
        items: purchaseForm.items.map((item) => ({
          ...item,
          kitchen_item_plan_id: item.kitchen_item_plan_id ? Number(item.kitchen_item_plan_id) : null,
          quantity_ordered: Number(item.quantity_ordered),
          unit_price: Number(item.unit_price),
          expiry_date: item.expiry_date || null,
        })),
      });
      setPurchaseForm({
        supplier_id: '', purchase_reference: '', purchase_date: new Date().toISOString().slice(0, 10),
        invoice_number: '', notes: '', items: [{ inventory_id: '', kitchen_item_plan_id: '', quantity_ordered: '', unit_price: '', expiry_date: '' }],
      });
    }, 'Purchase submitted for approval. Stock will change only after approval and delivery.');
  };
  const decidePurchase = (purchase, decision) => {
    const approval_comment = decision === 'rejected'
      ? window.prompt('Reason for rejecting this purchase?')?.trim()
      : window.prompt('Approval note (optional):')?.trim() || '';
    if (decision === 'rejected' && !approval_comment) return;
    if (!window.confirm(`${decision === 'approved' ? 'Approve' : 'Reject'} purchase ${purchase.purchase_reference}?`)) return;
    runAction(() => decideInventoryPurchase(purchase.id, decision, approval_comment), `Purchase ${decision}.`);
  };
  const openReceiving = (purchase) => {
    setReceivingPurchaseId(String(purchase.id));
    setDeliveryForm({
      delivery_reference: `DEL-${transactionKey().slice(0, 12).toUpperCase()}`,
      notes: '',
      quantities: Object.fromEntries(purchase.items
        .filter((line) => line.quantity_ordered > line.quantity_received)
        .map((line) => [line.id, ''])),
      serialNumbers: {},
      expiryDates: {},
    });
  };
  const submitDelivery = async (event) => {
    event.preventDefault();
    const purchase = purchases.find((entry) => String(entry.id) === receivingPurchaseId);
    if (!purchase) return;
    const lines = purchase.items
      .filter((line) => Number(deliveryForm.quantities[line.id]) > 0)
      .map((line) => ({
        purchase_item_id: line.id,
        quantity_received: Number(deliveryForm.quantities[line.id]),
        serial_numbers: (deliveryForm.serialNumbers?.[line.id] || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      }));
    await runAction(async () => {
      await receiveInventoryPurchase(purchase.id, {
        delivery_reference: deliveryForm.delivery_reference,
        notes: deliveryForm.notes,
        items: lines.map((line) => ({
          ...line,
          expiry_date: deliveryForm.expiryDates?.[line.purchase_item_id] || null,
        })),
      });
      setReceivingPurchaseId('');
      setDeliveryForm({ delivery_reference: '', notes: '', quantities: {}, serialNumbers: {}, expiryDates: {} });
    }, 'Delivery confirmed; received quantities were added to stock.');
  };
  const submitIssuance = async (event) => {
    event.preventDefault();
    if (issueForm.recipient_type !== 'department' && !issueForm.recipient_name.trim()) {
      setError('Enter the recipient name before issuing stock.');
      return;
    }
    await runAction(async () => {
      const response = await issueInventory({
        ...issueForm,
        quantity: Number(issueForm.quantity),
        idempotency_key: transactionKey(),
      });
      setLastReceipt(response.data);
      setIssueForm({ inventory_id: '', recipient_type: 'student', recipient_name: '', department: '', quantity: '1', purpose: '' });
    }, 'Stock issued and recorded.');
  };
  const submitAdjustment = async (event) => {
    event.preventDefault();
    await runAction(() => adjustInventoryStock({
      ...adjustmentForm,
      quantity_change: Number(adjustmentForm.quantity_change),
      idempotency_key: transactionKey(),
    }), 'Stock adjustment saved with its audit reason.');
  };
  const submitRequest = async (event) => {
    event.preventDefault();
    await runAction(async () => {
      await createInventoryRequest({ ...requestForm, quantity_requested: Number(requestForm.quantity_requested) });
      setRequestForm({ inventory_id: '', quantity_requested: '1', department: '', purpose: '' });
    }, 'Department request sent for approval.');
  };
  const decideRequest = (request, decision) => runAction(() => decideInventoryRequest(request.id, {
    decision,
    quantity_approved: decision === 'approved' ? Number(requestQuantities[request.id] || request.quantity_requested) : undefined,
    approval_comment: requestQuantities[`${request.id}-comment`] || '',
  }), decision === 'approved' ? 'Request approved.' : 'Request rejected.');
  const fulfillRequest = (request) => runAction(() => fulfillInventoryRequest(request.id, {
    quantity: Number(requestQuantities[`${request.id}-fulfill`] || 0),
    idempotency_key: transactionKey(),
  }), 'Approved request partially or fully fulfilled.');
  const registerAsset = async (event) => {
    event.preventDefault();
    await runAction(async () => {
      await registerInventoryAsset({ ...assetForm, purchase_price: Number(assetForm.purchase_price) });
      setAssetForm({ inventory_id: '', asset_code: '', serial_number: '', barcode: '', condition: 'good', location: '', purchase_date: '', purchase_price: '0', notes: '' });
    }, 'Asset registered and added to the catalogue asset count.');
  };
  const openAssetCountEditor = (item) => {
    setEditingAssetCount(item);
    setAssetCountForm({
      target_quantity: String(item.quantity),
      reason: '',
      asset_ids: [],
      event_type: 'missing',
    });
  };
  const submitAssetCountEdit = async (event) => {
    event.preventDefault();
    const targetQuantity = Number(assetCountForm.target_quantity);
    const difference = targetQuantity - Number(editingAssetCount?.quantity || 0);
    if (!editingAssetCount || !Number.isSafeInteger(targetQuantity) || targetQuantity < 0) {
      setError('Enter a whole-number asset quantity of zero or more.');
      return;
    }
    if (difference < 0 && assetCountForm.asset_ids.length !== -difference) {
      setError(`Select exactly ${-difference} available asset${difference === -1 ? '' : 's'} to remove.`);
      return;
    }
    await runAction(async () => {
      await adjustInventoryAssetQuantity({
        inventory_id: editingAssetCount.id,
        target_quantity: targetQuantity,
        reason: assetCountForm.reason,
        event_type: assetCountForm.event_type,
        asset_ids: assetCountForm.asset_ids,
        idempotency_key: transactionKey(),
      });
      setEditingAssetCount(null);
      setAssetCountForm({ target_quantity: '', reason: '', asset_ids: [], event_type: 'missing' });
    }, 'Reusable asset quantity updated with individual history recorded.');
  };
  const applyAssetAction = (asset, eventType) => runAction(() => updateInventoryAsset(asset.id, {
    ...(assetActionForm[asset.id] || {}),
    event_type: eventType,
  }), `Asset ${eventType.replaceAll('_', ' ')} recorded.`);
  const submitMaintenance = async (event) => {
    event.preventDefault();
    await runAction(() => createInventoryMaintenance({
      ...maintenanceForm, cost: Number(maintenanceForm.cost),
    }), 'Maintenance record created.');
  };
  const submitStocktake = async (event) => {
    event.preventDefault();
    const items = Object.entries(stocktakeForm.counts)
      .filter(([, counted]) => counted !== '' && counted !== undefined)
      .map(([inventory_id, counted_quantity]) => ({
        inventory_id: Number(inventory_id),
        counted_quantity: Number(counted_quantity),
        reason: stocktakeForm.notes || 'Physical stock count',
      }));
    await runAction(async () => {
      const response = await createInventoryStocktake({
        reference_number: stocktakeForm.reference_number,
        notes: stocktakeForm.notes,
        items,
      });
      setStocktakeForm({ reference_number: '', notes: '', counts: {} });
      if (window.confirm('Stocktake captured. Reconcile this count now? Reconciliation adjusts stock to the recorded counts.')) {
        await reconcileInventoryStocktake(response.data.id);
      }
    }, 'Stocktake recorded.');
  };
  const loadReport = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await getInventoryReport(reportType, reportDates);
      setReportRows(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Report could not be loaded.'));
    } finally {
      setSaving(false);
    }
  };
  const exportReport = () => {
    if (!reportRows.length) return;
    const columns = [...new Set(reportRows.flatMap((row) => Object.keys(row)))];
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [columns.map(quote).join(','), ...reportRows.map((row) => columns.map((column) => quote(row[column])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventory-${reportType}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const handleScanner = (event) => {
    if (event.key !== 'Enter') return;
    const value = scannerValue.trim();
    const match = inventory.find((item) => item.barcode === value || item.item_code === value);
    if (match) {
      setSearch(value);
      setCategoryFilter('');
      setTypeFilter('');
      if (tab === 'issuance') setIssueForm((previous) => ({ ...previous, inventory_id: String(match.id) }));
      setNotice(`Found ${match.item_name} (${match.quantity} ${match.unit || 'units'} available).`);
    } else {
      setError('No inventory item matched that barcode or item code.');
    }
    setScannerValue('');
  };

  if (loading) return <div className="page"><p>Loading school store...</p></div>;

  const visibleTabs = canManage
    ? emptyTabs
    : [['requests', 'Request supplies'], ['my-requests', 'My requests'], ['catalogue', 'My assigned items']];
  const currentUserRequests = requests.filter((request) => Number(request.requester_id) === Number(user?.id));

  return (
    <div className="page module-page inventory-workspace">
      <style>{`
        .inventory-tabs{display:flex;gap:.45rem;overflow-x:auto;padding:.35rem 0 1rem;margin-bottom:1rem}
        .inventory-tabs button{white-space:nowrap;border:1px solid #dbe3ee;background:#fff;color:#475569;border-radius:999px;padding:.62rem .95rem;font-weight:650;cursor:pointer}
        .inventory-tabs button.active{background:#0f766e;color:#fff;border-color:#0f766e}
        .inventory-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1rem}
        .inventory-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.8rem}
        .inventory-form-grid label{display:flex;flex-direction:column;gap:.35rem;font-weight:600;color:#334155}
        .inventory-form-grid input,.inventory-form-grid select,.inventory-form-grid textarea{width:100%;min-height:42px}
        .inventory-actions{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
        .inventory-alert{border-left:4px solid #f59e0b;padding:.75rem 1rem;background:#fffbeb;border-radius:.5rem;margin:.5rem 0}
        .inventory-print-label{display:inline-flex;flex-direction:column;align-items:center;gap:.2rem;padding:1rem;border:1px dashed #94a3b8;min-width:260px;background:#fff;color:#0f172a}
        .inventory-print-label svg{max-width:100%}
        .inventory-print-only{display:none}
        @media(max-width:700px){.inventory-form-grid{grid-template-columns:1fr}.inventory-workspace .module-hero{align-items:flex-start;gap:1rem}}
        .inventory-print-receipt,.inventory-print-report{display:none}
        @media print{body *{visibility:hidden!important}.inventory-print-only,.inventory-print-only *,.inventory-print-receipt,.inventory-print-receipt *,.inventory-print-report,.inventory-print-report *{visibility:visible!important}.inventory-print-only,.inventory-print-receipt,.inventory-print-report{display:block!important;position:fixed;inset:0;padding:1rem;background:#fff;color:#0f172a;overflow:visible}.inventory-print-label{break-inside:avoid;margin:.25rem}.inventory-print-report table{width:100%;border-collapse:collapse}.inventory-print-report th,.inventory-print-report td{border:1px solid #94a3b8;padding:.35rem;text-align:left}}
      `}</style>
      <div className="module-shell">
        <section className="module-hero" style={{ background: 'linear-gradient(130deg,#0f766e,#155e75)', color: '#fff', border: 0 }}>
          <div>
            <p className="eyebrow" style={{ color: '#ccfbf1' }}>The McCarthy Hill School · Operations</p>
            <h1 style={{ color: '#fff' }}>{canManage ? 'Store & Inventory' : 'Department supplies'}</h1>
            <p style={{ color: '#e0f2fe' }}>{canManage ? 'Manage school supplies, purchases, controlled stock movements, and reusable assets.' : 'Request the supplies your class or department needs and follow approval status.'}</p>
          </div>
          {canManage && <div style={{ minWidth: 250 }}>
            <label htmlFor="inventory-barcode-search" style={{ color: '#fff' }}>Scan or enter item barcode</label>
            <input id="inventory-barcode-search" type="search" value={scannerValue} onChange={(event) => setScannerValue(event.target.value)} onKeyDown={handleScanner} placeholder="Scan barcode, then press Enter" />
          </div>}
        </section>

        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}

        <nav className="inventory-tabs" aria-label="Inventory sections">
          {visibleTabs.map(([key, label]) => (
            <button type="button" className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>

        {canManage && tab === 'dashboard' && <>
          <section className="module-stats">
            <div className="mini-stat"><span>Catalogue items</span><strong>{dashboard?.summary?.item_types || 0}</strong></div>
            <div className="mini-stat"><span>Units in stock</span><strong>{dashboard?.summary?.total_units || 0}</strong></div>
            <div className="mini-stat"><span>Low stock</span><strong style={{ color: dashboard?.summary?.low_stock ? '#b45309' : '#0f766e' }}>{dashboard?.summary?.low_stock || 0}</strong></div>
            <div className="mini-stat"><span>Out of stock</span><strong style={{ color: dashboard?.summary?.out_of_stock ? '#b91c1c' : '#0f766e' }}>{dashboard?.summary?.out_of_stock || 0}</strong></div>
            <div className="mini-stat"><span>Stock valuation</span><strong>{formatMoney(dashboard?.summary?.stock_value)}</strong></div>
          </section>
          <section className="inventory-grid">
            <div className="data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Stock monitoring</p><h2>Alerts</h2></div><button className="btn-secondary" onClick={() => setTab('alerts')}>View all</button></div>
              {(dashboard?.alerts || []).slice(0, 8).map((alert) => <div className="inventory-alert" key={`${alert.alert_type}-${alert.id}-${alert.expiry_date}`}>
                <strong>{alert.item_name}</strong> · {alert.alert_type === 'expiry' ? `expires ${shortDate(alert.expiry_date)} (${alert.quantity} units in batch)` : `${alert.quantity} ${alert.unit} remaining · minimum ${alert.minimum_stock}`}
              </div>)}
              {!dashboard?.alerts?.length && <p className="empty-state">No low-stock or near-expiry alerts.</p>}
            </div>
            <div className="data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Workflow</p><h2>Requests awaiting approval</h2></div><button className="btn-secondary" onClick={() => setTab('requests')}>Review</button></div>
              <strong style={{ fontSize: '2rem' }}>{requests.filter((request) => request.status === 'pending_approval').length}</strong>
              <p>Pending departmental requests</p>
              <div className="inventory-actions">
                <button className="btn-primary" onClick={() => setTab('purchases')}>Record a purchase</button>
                <button className="btn-secondary" onClick={() => setTab('issuance')}>Issue stock</button>
              </div>
            </div>
          </section>
          <section className="data-panel" style={{ marginTop: '1rem' }}>
            <div className="panel-heading"><div><p className="eyebrow">Latest activity</p><h2>Recent stock movements</h2></div></div>
            <MovementTable movements={(dashboard?.recent_movements || []).slice(0, 8)} />
          </section>
        </>}

        {tab === 'catalogue' && <section className="split-layout">
          {editingAssetCount && <form className="data-panel form-panel" style={{ gridColumn: '1 / -1' }} onSubmit={submitAssetCountEdit}>
            <div className="panel-heading"><div><p className="eyebrow">Store · Asset register</p><h2>Adjust {editingAssetCount.item_name} quantity</h2></div></div>
            <p>Current quantity: <strong>{editingAssetCount.quantity}</strong>. Each change will update individual asset records and keep the asset history.</p>
            <div className="inventory-form-grid">
              <label>New quantity *
                <input type="number" min="0" step="1" required value={assetCountForm.target_quantity} onChange={(event) => setAssetCountForm({ ...assetCountForm, target_quantity: event.target.value, asset_ids: [] })} />
              </label>
              {assetCountDifference > 0 && <p>Increasing by {assetCountDifference} will register {assetCountDifference} individual available assets with generated asset codes and barcodes.</p>}
              {assetCountDifference < 0 && <>
                <label>Record removed assets as *
                  <select value={assetCountForm.event_type} onChange={(event) => setAssetCountForm({ ...assetCountForm, event_type: event.target.value })}>
                    <option value="missing">Missing</option>
                    {isAdmin && <option value="disposed">Disposed</option>}
                  </select>
                </label>
                <div style={{ gridColumn: '1 / -1' }}>
                  <strong>Select exactly {-assetCountDifference} available asset{assetCountDifference === -1 ? '' : 's'}:</strong>
                  {!removableAssets.length && <p className="error">There are no available individual assets to remove for this item.</p>}
                  {removableAssets.map((asset) => {
                    const selected = assetCountForm.asset_ids.includes(Number(asset.id));
                    const selectionFull = assetCountForm.asset_ids.length >= -assetCountDifference;
                    return <label key={asset.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.4rem' }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!selected && selectionFull}
                        onChange={(event) => setAssetCountForm((current) => ({
                          ...current,
                          asset_ids: event.target.checked
                            ? [...current.asset_ids, Number(asset.id)]
                            : current.asset_ids.filter((id) => id !== Number(asset.id)),
                        }))}
                      />
                      {asset.asset_code}{asset.serial_number ? ` · ${asset.serial_number}` : ''}
                    </label>;
                  })}
                </div>
              </>}
              <label style={{ gridColumn: '1 / -1' }}>Reason for quantity change *
                <textarea required minLength="5" maxLength="500" rows="2" value={assetCountForm.reason} onChange={(event) => setAssetCountForm({ ...assetCountForm, reason: event.target.value })} placeholder="Explain the physical count or why these assets were removed." />
              </label>
            </div>
            <div className="inventory-actions">
              <button type="submit" className="btn-primary" disabled={saving || !assetCountDifference || assetCountForm.reason.trim().length < 5 || (assetCountDifference < 0 && assetCountForm.asset_ids.length !== -assetCountDifference)}>
                {saving ? 'Saving…' : 'Save quantity'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEditingAssetCount(null)} disabled={saving}>Cancel</button>
            </div>
          </form>}
          {canManage && <form className="data-panel form-panel" onSubmit={saveItem}>
            <div className="panel-heading"><div><p className="eyebrow">{editingItem ? 'Catalogue maintenance' : 'New stock item'}</p><h2>{editingItem ? 'Edit inventory item' : 'Add catalogue item'}</h2></div></div>
            <div className="inventory-form-grid">
              <label>Item name *<input maxLength="120" required value={inventoryForm.item_name} onChange={(event) => setInventoryForm({ ...inventoryForm, item_name: event.target.value })} /></label>
              <label>Item code<input maxLength="80" value={inventoryForm.item_code} onChange={(event) => setInventoryForm({ ...inventoryForm, item_code: event.target.value })} placeholder="Generated if blank" /></label>
              <label>Barcode<input maxLength="120" value={inventoryForm.barcode} onChange={(event) => setInventoryForm({ ...inventoryForm, barcode: event.target.value })} placeholder="Generated from item code" /></label>
              <label>Category *<input maxLength="80" list="inventory-categories" required value={inventoryForm.category} onChange={(event) => setInventoryForm({ ...inventoryForm, category: event.target.value })} /><datalist id="inventory-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
              <label>Item type<select value={inventoryForm.item_type} onChange={(event) => setInventoryForm({ ...inventoryForm, item_type: event.target.value })}><option value="consumable">Consumable</option><option value="asset">Reusable asset</option></select></label>
              <label>Unit of measurement<input maxLength="40" required value={inventoryForm.unit} onChange={(event) => setInventoryForm({ ...inventoryForm, unit: event.target.value })} placeholder="piece, pack, box, ream" /></label>
              <label>{editingItem ? 'Current stock balance' : 'Opening stock'}<input type="number" min="0" step="1" required disabled={Boolean(editingItem && inventoryForm.item_type === 'asset')} value={inventoryForm.quantity} onChange={(event) => setInventoryForm({ ...inventoryForm, quantity: event.target.value })} />{editingItem && inventoryForm.item_type === 'asset' && <small>Use Edit quantity in the catalogue to adjust the asset register.</small>}</label>
              <label>Minimum stock alert level<input type="number" min="0" step="1" value={inventoryForm.minimum_stock} onChange={(event) => setInventoryForm({ ...inventoryForm, minimum_stock: event.target.value })} /></label>
              <label>Purchase price / unit<input type="number" min="0" step="0.01" value={inventoryForm.purchase_price} onChange={(event) => setInventoryForm({ ...inventoryForm, purchase_price: event.target.value })} /></label>
              <label>Supplier<select value={inventoryForm.supplier_id} onChange={(event) => setInventoryForm({ ...inventoryForm, supplier_id: event.target.value })}><option value="">Not specified</option>{suppliers.filter((supplier) => supplier.is_active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Storage location<input maxLength="120" value={inventoryForm.storage_location} onChange={(event) => setInventoryForm({ ...inventoryForm, storage_location: event.target.value })} placeholder="Store room, shelf or room" /></label>
              <label>Status<select value={inventoryForm.item_status} onChange={(event) => setInventoryForm({ ...inventoryForm, item_status: event.target.value })}><option value="active">Active</option><option value="discontinued">Discontinued</option><option value="archived">Archived</option></select></label>
              <label>Expiry date (if applicable)<input type="date" value={inventoryForm.expiry_date} onChange={(event) => setInventoryForm({ ...inventoryForm, expiry_date: event.target.value })} /></label>
              <label>Legacy system account assignment<select value={inventoryForm.assigned_to} onChange={(event) => setInventoryForm({ ...inventoryForm, assigned_to: event.target.value })}><option value="">Unassigned</option>{teacherOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.role})</option>)}</select><small>System accounts are separate from Staff Registry employee records.</small></label>
              <label style={{ gridColumn: '1/-1' }}>Description<textarea rows="2" maxLength="500" value={inventoryForm.description} onChange={(event) => setInventoryForm({ ...inventoryForm, description: event.target.value })} /></label>
              {editingItem && <label style={{ gridColumn: '1/-1' }}>Stock change reason (required only when changing quantity)<input maxLength="500" value={inventoryForm.stock_reason} onChange={(event) => setInventoryForm({ ...inventoryForm, stock_reason: event.target.value })} placeholder="Explain physical count, damage, correction, etc." /></label>}
            </div>
            <div className="inventory-actions" style={{ marginTop: '1rem' }}><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : editingItem ? 'Save changes' : 'Add item'}</button>{editingItem && <button type="button" className="btn-secondary" onClick={resetItemForm}>Cancel</button>}</div>
          </form>}
          <section className="data-panel" style={{ flex: canManage ? 2 : 1 }}>
            <div className="panel-heading"><div><p className="eyebrow">School supplies and property</p><h2>Inventory catalogue</h2></div></div>
            <div className="toolbar">
              <input type="search" placeholder="Search name, code, barcode, description..." value={search} onChange={(event) => setSearch(event.target.value)} />
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All types</option><option value="consumable">Consumables</option><option value="asset">Reusable assets</option></select>
            </div>
            <div className="table-wrap"><table><thead><tr><th>Item / barcode</th><th>Category / type</th><th>Stock</th><th>Min.</th><th>Value</th>{canManage && <th>Actions</th>}</tr></thead>
              <tbody>{filteredInventory.map((item) => <tr key={item.id}>
                <td><strong>{item.item_name}</strong><div style={{ color: '#64748b', fontSize: '.8rem' }}>{item.item_code} · {item.barcode}</div><div style={{ color: '#64748b', fontSize: '.8rem' }}>{item.description}</div></td>
                <td>{item.category}<div>{pill(item.item_type || 'consumable')}</div></td>
                <td><strong>{item.quantity} {item.unit || 'units'}</strong>{item.quantity <= (item.minimum_stock || 0) && item.item_status === 'active' && <div className="inventory-alert">Low stock</div>}</td>
                <td>{item.minimum_stock || 0}</td><td>{formatMoney(Number(item.quantity || 0) * Number(item.purchase_price || 0))}</td>
                {canManage && <td><div className="inventory-actions"><button type="button" className="btn-small btn-edit" onClick={() => editItem(item)}>Edit</button>{item.item_type === 'asset' && <button type="button" className="btn-small btn-secondary" onClick={() => openAssetCountEditor(item)}>Edit quantity</button>}<button type="button" className="btn-small btn-secondary" onClick={() => setPrintLabel({ name: item.item_name, value: item.barcode || item.item_code || `MH-ITM-${item.id}` })}>Label</button>{isAdmin && <button type="button" className="btn-small btn-delete" onClick={() => archiveItem(item)}>Archive</button>}</div></td>}
              </tr>)}</tbody></table></div>
            {!filteredInventory.length && <p className="empty-state">No matching inventory items.</p>}
          </section>
        </section>}

        {tab === 'my-requests' && !canManage && <section className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Request tracking</p><h2>My requests</h2></div></div><RequestTable requests={currentUserRequests} canApprove={false} quantities={requestQuantities} setQuantities={setRequestQuantities} onDecision={decideRequest} onFulfill={fulfillRequest} saving={saving} /></section>}

        {canManage && tab === 'suppliers' && <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={saveSupplier}>
            <div className="panel-heading"><div><p className="eyebrow">Procurement contacts</p><h2>{editingSupplier ? 'Update supplier' : 'Register supplier'}</h2></div></div>
            <div className="inventory-form-grid">
              <label>Supplier name *<input required maxLength="160" value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} /></label>
              <label>Contact person<input maxLength="160" value={supplierForm.contact_name} onChange={(event) => setSupplierForm({ ...supplierForm, contact_name: event.target.value })} /></label>
              <label>Email<input type="email" maxLength="254" value={supplierForm.email} onChange={(event) => setSupplierForm({ ...supplierForm, email: event.target.value })} /></label>
              <label>Phone<input maxLength="60" value={supplierForm.phone} onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })} /></label>
              <label>Address<input maxLength="500" value={supplierForm.address} onChange={(event) => setSupplierForm({ ...supplierForm, address: event.target.value })} /></label>
              <label>Notes<input maxLength="1000" value={supplierForm.notes} onChange={(event) => setSupplierForm({ ...supplierForm, notes: event.target.value })} /></label>
            </div>
            <div className="inventory-actions"><button className="btn-primary" disabled={saving}>{editingSupplier ? 'Save supplier' : 'Add supplier'}</button>{editingSupplier && <button type="button" className="btn-secondary" onClick={() => { setEditingSupplier(null); setSupplierForm(emptySupplier); }}>Cancel</button>}</div>
          </form>
          <div className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Supplier directory</p><h2>{suppliers.length} registered</h2></div></div>
            <div className="table-wrap"><table><thead><tr><th>Supplier</th><th>Contact</th><th>Supplied items</th><th>Purchases</th><th>Status</th><th>Actions</th></tr></thead><tbody>
              {suppliers.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.name}</strong><div>{supplier.email}</div><div>{supplier.phone}</div></td><td>{supplier.contact_name}<div>{supplier.address}</div></td><td>{(supplier.supplied_items || []).join(', ') || 'No catalogue items'}</td><td>{supplier.purchase_count} · {formatMoney(supplier.purchase_total)}</td><td>{pill(supplier.is_active ? 'active' : 'inactive')}</td><td><div className="inventory-actions"><button className="btn-small btn-edit" onClick={() => { setEditingSupplier(supplier.id); setSupplierForm({ name: supplier.name, contact_name: supplier.contact_name || '', email: supplier.email || '', phone: supplier.phone || '', address: supplier.address || '', notes: supplier.notes || '' }); }}>Edit</button><button className="btn-small btn-secondary" onClick={() => { setSupplierHistoryId(String(supplier.id)); setTab('purchases'); }}>Purchase history</button><button className="btn-small btn-secondary" onClick={() => runAction(() => setInventorySupplierStatus(supplier.id, !supplier.is_active), `Supplier ${supplier.is_active ? 'deactivated' : 'activated'}.`)}>{supplier.is_active ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}
            </tbody></table></div>{!suppliers.length && <p className="empty-state">No suppliers registered yet.</p>}
          </div>
        </section>}

        {canManage && tab === 'purchases' && <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={createPurchaseOrder}>
            <div className="panel-heading"><div><p className="eyebrow">Purchase order</p><h2>Record purchase</h2></div></div>
            <div className="inventory-form-grid">
              <label>Supplier *<select required value={purchaseForm.supplier_id} onChange={(event) => setPurchaseForm({ ...purchaseForm, supplier_id: event.target.value })}><option value="">Select supplier</option>{suppliers.filter((entry) => entry.is_active).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
              <label>Purchase reference *<input required maxLength="100" value={purchaseForm.purchase_reference} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchase_reference: event.target.value })} /></label>
              <label>Purchase date<input type="date" value={purchaseForm.purchase_date} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchase_date: event.target.value })} /></label>
              <label>Invoice number<input maxLength="120" value={purchaseForm.invoice_number} onChange={(event) => setPurchaseForm({ ...purchaseForm, invoice_number: event.target.value })} /></label>
            </div>
            <h3>Items purchased</h3>
            {purchaseForm.items.map((line, index) => <div className="inventory-form-grid" key={index} style={{ borderTop: '1px solid #e2e8f0', paddingTop: '.6rem', marginBottom: '.5rem' }}>
              <label>Catalogue item *<select required value={line.inventory_id} onChange={(event) => updatePurchaseLine(index, 'inventory_id', event.target.value)}><option value="">Select catalogue item</option>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.item_name} · {item.item_type === 'asset' ? 'Reusable asset' : 'Consumable'}</option>)}</select></label>
              <label>Kitchen plan link<select value={line.kitchen_item_plan_id} onChange={(event) => updatePurchaseLine(index, 'kitchen_item_plan_id', event.target.value)}><option value="">Not a kitchen plan item</option>{kitchenPlans.filter((plan) => !plan.inventory_id || String(plan.inventory_id) === String(line.inventory_id)).map((plan) => <option key={plan.id} value={plan.id}>{plan.item_name} · {plan.category}</option>)}</select></label>
              <label>Quantity *<input required type="number" min="1" step="1" value={line.quantity_ordered} onChange={(event) => updatePurchaseLine(index, 'quantity_ordered', event.target.value)} /></label>
              <label>Unit price *<input required type="number" min="0" step=".01" value={line.unit_price} onChange={(event) => updatePurchaseLine(index, 'unit_price', event.target.value)} /></label>
              <label>Expiry date<input type="date" value={line.expiry_date} onChange={(event) => updatePurchaseLine(index, 'expiry_date', event.target.value)} /></label>
            </div>)}
            <div className="inventory-actions"><button type="button" className="btn-secondary" onClick={addPurchaseLine}>Add another item</button><button className="btn-primary" disabled={saving}>Save purchase</button></div>
            <p>On order creation stock is unchanged. Record one or more delivery receipts to increase quantities.</p>
          </form>
          <div className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Purchase register</p><h2>Purchase history</h2></div></div>
            {supplierHistoryId && <button className="btn-secondary" onClick={() => setSupplierHistoryId('')}>Clear supplier history filter</button>}
            {purchases.filter((purchase) => !supplierHistoryId || String(purchase.supplier_id) === supplierHistoryId || suppliers.find((supplier) => String(supplier.id) === supplierHistoryId)?.name === purchase.supplier_name).map((purchase) => <article className="data-panel" key={purchase.id} style={{ marginBottom: '.75rem', boxShadow: 'none' }}>
              <div className="inventory-actions" style={{ justifyContent: 'space-between' }}><strong>{purchase.purchase_reference} · {purchase.supplier_name}</strong>{pill(purchase.status)}</div>
              <p>{shortDate(purchase.purchase_date)} · Invoice {purchase.invoice_number || '—'} · Total {formatMoney(purchase.total_cost)}{purchase.decision_by_name ? ` · Decided by ${purchase.decision_by_name}` : ''}</p>
              {purchase.approval_comment && <p>{purchase.approval_comment}</p>}
              <ul>{purchase.items.map((line) => <li key={line.id}>{line.item_name} ({line.item_type === 'asset' ? 'asset' : 'consumable'}){line.kitchen_item_name ? ` · Kitchen plan: ${line.kitchen_item_name}` : ''}: {line.quantity_received}/{line.quantity_ordered} received at {formatMoney(line.unit_price)} / unit</li>)}</ul>
              {isAdmin && purchase.status === 'pending_approval' && <div className="inventory-actions"><button className="btn-small btn-primary" onClick={() => decidePurchase(purchase, 'approved')}>Approve purchase</button><button className="btn-small btn-delete" onClick={() => decidePurchase(purchase, 'rejected')}>Reject purchase</button></div>}
              {['approved', 'ordered', 'partially_received'].includes(purchase.status) && <button className="btn-small btn-primary" onClick={() => openReceiving(purchase)}>Record delivery / partial delivery</button>}
              {receivingPurchaseId === String(purchase.id) && <form onSubmit={submitDelivery} style={{ marginTop: '1rem' }}>
                <label>Delivery reference (unique for retry protection)<input required maxLength="120" value={deliveryForm.delivery_reference} onChange={(event) => setDeliveryForm({ ...deliveryForm, delivery_reference: event.target.value })} /></label>
                {purchase.items.filter((line) => line.quantity_ordered > line.quantity_received).map((line) => <div key={line.id}><label>{line.item_name} · remaining {line.quantity_ordered - line.quantity_received}<input type="number" min="0" max={line.quantity_ordered - line.quantity_received} step="1" value={deliveryForm.quantities[line.id] || ''} onChange={(event) => setDeliveryForm({ ...deliveryForm, quantities: { ...deliveryForm.quantities, [line.id]: event.target.value } })} /></label>{line.item_type !== 'asset' && <label>Expiry date for this delivery (optional)<input type="date" value={deliveryForm.expiryDates?.[line.id] || ''} onChange={(event) => setDeliveryForm({ ...deliveryForm, expiryDates: { ...deliveryForm.expiryDates, [line.id]: event.target.value } })} /></label>}{line.item_type === 'asset' && <label>Serial numbers (one per received asset, optional)<textarea rows="2" placeholder="One serial number per line" value={deliveryForm.serialNumbers?.[line.id] || ''} onChange={(event) => setDeliveryForm({ ...deliveryForm, serialNumbers: { ...deliveryForm.serialNumbers, [line.id]: event.target.value } })} /></label>}</div>)}
                <label>Delivery notes<textarea rows="2" value={deliveryForm.notes} onChange={(event) => setDeliveryForm({ ...deliveryForm, notes: event.target.value })} /></label>
                <div className="inventory-actions"><button className="btn-primary" disabled={saving}>Confirm received quantities</button><button type="button" className="btn-secondary" onClick={() => setReceivingPurchaseId('')}>Cancel</button></div>
              </form>}
            </article>)}
            {!purchases.length && <p className="empty-state">No purchases recorded.</p>}
          </div>
        </section>}

        {tab === 'issuance' && canManage && <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={submitIssuance}>
            <div className="panel-heading"><div><p className="eyebrow">Controlled stock out</p><h2>Issue consumables</h2></div></div>
            <div className="inventory-form-grid">
              <label>Item *<select required value={issueForm.inventory_id} onChange={(event) => setIssueForm({ ...issueForm, inventory_id: event.target.value })}><option value="">Select item</option>{consumables.map((item) => <option key={item.id} value={item.id}>{item.item_name} · {item.quantity} {item.unit}</option>)}</select></label>
              <label>Recipient type *<select value={issueForm.recipient_type} onChange={(event) => setIssueForm({ ...issueForm, recipient_type: event.target.value, recipient_name: '', department: '' })}><option value="student">Student</option><option value="teacher">Teacher</option><option value="employee">Staff member</option><option value="department">Department</option></select></label>
              {issueForm.recipient_type === 'department'
                ? <label>Department *<input required value={issueForm.department} onChange={(event) => setIssueForm({ ...issueForm, department: event.target.value })} placeholder="e.g. Science Department" /></label>
                : <label>Recipient name *<input required maxLength="160" value={issueForm.recipient_name} onChange={(event) => setIssueForm({ ...issueForm, recipient_name: event.target.value })} placeholder="Enter recipient name" /></label>}
              <label>Quantity *<input required type="number" min="1" step="1" value={issueForm.quantity} onChange={(event) => setIssueForm({ ...issueForm, quantity: event.target.value })} /></label>
              <label>Purpose / reference *<input required maxLength="500" value={issueForm.purpose} onChange={(event) => setIssueForm({ ...issueForm, purpose: event.target.value })} placeholder="Class activity, term supplies..." /></label>
            </div>
            <button className="btn-primary" disabled={saving}>Confirm issue and deduct stock</button>
            <p>Issuance is saved atomically, is protected against retries, and cannot reduce stock below zero.</p>
          </form>
          <div className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Stock out report</p><h2>Recent issuances</h2></div></div><IssuanceTable issuances={issuances.slice(0, 50)} onPrint={setLastReceipt} /></div>
          {lastReceipt && <div className="data-panel"><div className="panel-heading"><h2>Issuance receipt</h2><button className="btn-secondary" onClick={() => window.print()}>Print receipt</button></div><div className="inventory-print-receipt"><ReceiptCard receipt={lastReceipt} /></div></div>}
        </section>}

        {tab === 'requests' && <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={submitRequest}>
            <div className="panel-heading"><div><p className="eyebrow">Departmental supply request</p><h2>Request inventory</h2></div></div>
            <div className="inventory-form-grid">
              <label>Consumable item *<select required value={requestForm.inventory_id} onChange={(event) => setRequestForm({ ...requestForm, inventory_id: event.target.value })}><option value="">Select an item</option>{(canManage ? consumables : requestCatalogue).map((item) => <option key={item.id} value={item.id}>{item.item_name} · {item.quantity} {item.unit} available</option>)}</select></label>
              <label>Quantity *<input type="number" required min="1" step="1" value={requestForm.quantity_requested} onChange={(event) => setRequestForm({ ...requestForm, quantity_requested: event.target.value })} /></label>
              <label>Department / class<input maxLength="160" value={requestForm.department} onChange={(event) => setRequestForm({ ...requestForm, department: event.target.value })} /></label>
              <label>Purpose *<textarea required maxLength="500" rows="2" value={requestForm.purpose} onChange={(event) => setRequestForm({ ...requestForm, purpose: event.target.value })} /></label>
            </div>
            <button className="btn-primary" disabled={saving}>Submit for approval</button>
          </form>
          <div className="data-panel"><div className="panel-heading"><div><p className="eyebrow">{canManage ? 'Storekeeper review queue' : 'Request tracking'}</p><h2>{canManage ? 'Requests & approvals' : 'My requests'}</h2></div></div>
            <RequestTable requests={canManage ? requests : currentUserRequests} canApprove={canManage} quantities={requestQuantities} setQuantities={setRequestQuantities} onDecision={decideRequest} onFulfill={fulfillRequest} saving={saving} />
          </div>
        </section>}

        {canManage && tab === 'assets' && <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={registerAsset}>
            <div className="panel-heading"><div><p className="eyebrow">Reusable school property</p><h2>Register individual asset</h2></div></div>
            <div className="inventory-form-grid">
              <label>Asset catalogue item *<select required value={assetForm.inventory_id} onChange={(event) => setAssetForm({ ...assetForm, inventory_id: event.target.value })}><option value="">Select asset type</option>{assetCatalogue.map((item) => <option key={item.id} value={item.id}>{item.item_name}</option>)}</select></label>
              <label>Asset code<input maxLength="100" value={assetForm.asset_code} onChange={(event) => setAssetForm({ ...assetForm, asset_code: event.target.value })} placeholder="Generated if blank" /></label>
              <label>Serial number<input maxLength="120" value={assetForm.serial_number} onChange={(event) => setAssetForm({ ...assetForm, serial_number: event.target.value })} /></label>
              <label>Barcode<input maxLength="120" value={assetForm.barcode} onChange={(event) => setAssetForm({ ...assetForm, barcode: event.target.value })} placeholder="Uses asset code if blank" /></label>
              <label>Condition<select value={assetForm.condition} onChange={(event) => setAssetForm({ ...assetForm, condition: event.target.value })}><option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="damaged">Damaged</option></select></label>
              <label>Storage location<input maxLength="120" value={assetForm.location} onChange={(event) => setAssetForm({ ...assetForm, location: event.target.value })} /></label>
              <label>Purchase date<input type="date" value={assetForm.purchase_date} onChange={(event) => setAssetForm({ ...assetForm, purchase_date: event.target.value })} /></label>
              <label>Purchase price<input type="number" min="0" step=".01" value={assetForm.purchase_price} onChange={(event) => setAssetForm({ ...assetForm, purchase_price: event.target.value })} /></label>
              <label>Notes<input maxLength="1000" value={assetForm.notes} onChange={(event) => setAssetForm({ ...assetForm, notes: event.target.value })} /></label>
            </div>
            <button className="btn-primary" disabled={saving}>Register asset and barcode</button>
            {!assetCatalogue.length && <p className="inventory-alert">Create a reusable-asset catalogue entry first.</p>}
          </form>
          <div className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Asset accountability</p><h2>Asset register · {assets.length}</h2></div></div>
            <div className="table-wrap"><table><thead><tr><th>Asset / barcode</th><th>Condition</th><th>Assignment</th><th>Status / location</th><th>History</th></tr></thead><tbody>
              {assets.map((asset) => <tr key={asset.id}><td><strong>{asset.item_name}</strong><div>{asset.asset_code} · {asset.serial_number || 'No serial'}</div><button className="btn-small btn-secondary" onClick={() => setPrintLabel({ name: asset.item_name, value: asset.barcode || asset.asset_code })}>Print barcode</button></td>
                <td>{pill(asset.condition)}</td>
                <td>{asset.assigned_to_name || asset.assigned_department || 'Unassigned'}
                  {asset.status !== 'disposed' && <div className="inventory-actions"><select aria-label={`Action for ${asset.asset_code}`} value={assetActionForm[asset.id]?.event_type || ''} onChange={(event) => setAssetActionForm({ ...assetActionForm, [asset.id]: { ...assetActionForm[asset.id], event_type: event.target.value } })}><option value="">Select action</option><option value="assigned">Assign</option><option value="transferred">Transfer</option><option value="returned">Return</option><option value="damaged">Report damage</option><option value="missing">Report missing</option>{isAdmin && <option value="disposed">Dispose</option>}<option value="condition_changed">Update condition</option></select>
                    {['assigned','transferred'].includes(assetActionForm[asset.id]?.event_type) && <input placeholder="Or department" aria-label="Assign to department" value={assetActionForm[asset.id]?.department || ''} onChange={(event) => setAssetActionForm({ ...assetActionForm, [asset.id]: { ...assetActionForm[asset.id], department: event.target.value } })} />}
                    {assetActionForm[asset.id]?.event_type === 'condition_changed' && <select aria-label="Asset condition" value={assetActionForm[asset.id]?.condition || asset.condition} onChange={(event) => setAssetActionForm({ ...assetActionForm, [asset.id]: { ...assetActionForm[asset.id], condition: event.target.value } })}><option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="damaged">Damaged</option><option value="missing">Missing</option>{isAdmin && <option value="disposed">Disposed</option>}</select>}
                    {['assigned','transferred'].includes(assetActionForm[asset.id]?.event_type) && <select aria-label="Assign to employee or department" value={assetActionForm[asset.id]?.assignee || ''} onChange={(event) => {
                      const selected = staffDirectory.find((entry) => `${entry.staff_type}-${entry.id}` === event.target.value);
                      setAssetActionForm({ ...assetActionForm, [asset.id]: {
                        ...assetActionForm[asset.id],
                        assigned_type: selected?.staff_type || 'user',
                        assigned_to: selected?.staff_type === 'user' ? String(selected.id) : '',
                        assigned_employee_id: selected?.staff_type === 'employee' ? String(selected.id) : '',
                        assignee: event.target.value,
                      } });
                    }}><option value="">Select staff member</option>{staffDirectory.map((entry) => <option key={`${entry.staff_type}-${entry.id}`} value={`${entry.staff_type}-${entry.id}`}>{entry.name} · {entry.staff_type === 'employee' ? 'Employee' : entry.role}</option>)}</select>}
                    {assetActionForm[asset.id]?.event_type && <button className="btn-small btn-primary" onClick={() => applyAssetAction(asset, assetActionForm[asset.id].event_type)}>Save</button>}
                  </div>}
                </td><td>{pill(asset.status)}<div>{asset.location || asset.assigned_department || ''}</div></td>
                <td><button className="btn-small btn-secondary" onClick={async () => { try { const response = await getInventoryAssetHistory(asset.id); setHistoryAsset({ asset, events: response.data }); } catch (requestError) { setError(errorMessage(requestError, 'Could not load asset history.')); } }}>View history</button></td></tr>)}
            </tbody></table></div>{!assets.length && <p className="empty-state">No reusable assets registered.</p>}
            {historyAsset && <div className="data-panel"><div className="panel-heading"><h3>{historyAsset.asset.asset_code} · assignment history</h3><button className="btn-secondary" onClick={() => setHistoryAsset(null)}>Close</button></div><ul>{historyAsset.events.map((event) => <li key={event.id}>{shortDate(event.created_at)} · {event.event_type.replaceAll('_', ' ')} · {event.from_user_name || event.from_department || '—'} → {event.to_user_name || event.to_department || '—'} · {event.notes || ''}</li>)}</ul></div>}
          </div>
        </section>}

        {canManage && tab === 'maintenance' && <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={submitMaintenance}>
            <div className="panel-heading"><div><p className="eyebrow">Care & repairs</p><h2>Record maintenance</h2></div></div>
            <div className="inventory-form-grid"><label>Asset *<select required value={maintenanceForm.asset_id} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, asset_id: event.target.value })}><option value="">Select asset</option>{assets.filter((asset) => asset.status !== 'disposed').map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} · {asset.item_name}</option>)}</select></label><label>Maintenance date<input type="date" value={maintenanceForm.maintenance_date} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, maintenance_date: event.target.value })} /></label><label>Cost<input type="number" min="0" step=".01" value={maintenanceForm.cost} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, cost: event.target.value })} /></label><label>Description *<textarea required rows="3" maxLength="1000" value={maintenanceForm.description} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, description: event.target.value })} /></label></div>
            <button className="btn-primary" disabled={saving}>Save maintenance record</button>
          </form>
          <div className="data-panel"><div className="panel-heading"><h2>Maintenance history</h2></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Asset</th><th>Work</th><th>Cost</th><th>Status</th><th /></tr></thead><tbody>{maintenance.map((record) => <tr key={record.id}><td>{shortDate(record.maintenance_date)}</td><td>{record.asset_code} · {record.item_name}</td><td>{record.description}</td><td>{formatMoney(record.cost)}</td><td>{pill(record.status)}</td><td>{record.status !== 'completed' && <button className="btn-small btn-primary" onClick={() => runAction(() => completeInventoryMaintenance(record.id), 'Maintenance completed and asset returned to service.')}>Complete</button>}</td></tr>)}</tbody></table></div></div>
        </section>}

        {canManage && tab === 'stocktake' && <section className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">Physical count</p><h2>Stock taking</h2></div></div>
          <form onSubmit={submitStocktake}>
            <div className="inventory-form-grid"><label>Stocktake reference *<input required maxLength="100" value={stocktakeForm.reference_number} onChange={(event) => setStocktakeForm({ ...stocktakeForm, reference_number: event.target.value })} /></label><label>Notes / count reason *<input required maxLength="1000" value={stocktakeForm.notes} onChange={(event) => setStocktakeForm({ ...stocktakeForm, notes: event.target.value })} /></label></div>
            <div className="table-wrap"><table><thead><tr><th>Item</th><th>System quantity</th><th>Physical count</th></tr></thead><tbody>{consumables.map((item) => <tr key={item.id}><td>{item.item_name}</td><td>{item.quantity} {item.unit}</td><td><input aria-label={`Physical count for ${item.item_name}`} type="number" min="0" step="1" value={stocktakeForm.counts[item.id] ?? ''} onChange={(event) => setStocktakeForm({ ...stocktakeForm, counts: { ...stocktakeForm.counts, [item.id]: event.target.value } })} /></td></tr>)}</tbody></table></div>
            <button className="btn-primary" disabled={saving || !Object.values(stocktakeForm.counts).some((value) => value !== '')}>Save count and reconcile</button>
          </form>
          <div className="table-wrap"><h3>Previous counts</h3><table><thead><tr><th>Reference</th><th>Date</th><th>Items</th><th>Status</th><th /></tr></thead><tbody>{stocktakes.map((take) => <tr key={take.id}><td>{take.reference_number}</td><td>{shortDate(take.created_at)}</td><td>{take.item_count}</td><td>{pill(take.status)}</td><td>{take.status === 'open' && <button className="btn-small btn-primary" onClick={() => { if (window.confirm('Reconcile this stocktake and adjust stock?')) runAction(() => reconcileInventoryStocktake(take.id), 'Stocktake reconciled.'); }}>Reconcile</button>}</td></tr>)}</tbody></table></div>
        </section>}

        {canManage && tab === 'alerts' && <section className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">Action required</p><h2>Low stock and expiry alerts</h2></div></div>
          {(dashboard?.alerts || []).map((alert) => <div className="inventory-alert" key={`${alert.alert_type}-${alert.id}-${alert.expiry_date}`}><strong>{alert.item_name}</strong> · {alert.alert_type === 'expiry' ? `Batch expires ${shortDate(alert.expiry_date)} · ${alert.quantity} remaining` : `${alert.quantity} ${alert.unit} remaining against minimum ${alert.minimum_stock}`}</div>)}
          {!dashboard?.alerts?.length && <p className="empty-state">No stock or expiry alerts.</p>}
        </section>}

        {canManage && tab === 'reports' && <section className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">Audit-ready exports</p><h2>Inventory reports</h2></div></div>
          <div className="inventory-actions"><select value={reportType} onChange={(event) => setReportType(event.target.value)}><option value="inventory">Inventory list & valuation</option><option value="movements">Stock-in / stock-out</option><option value="purchases">Purchases & suppliers</option><option value="issuances">Issuance and recipient history</option><option value="assets">Asset register & assignment</option><option value="maintenance">Maintenance</option><option value="requests">Department requests</option><option value="stocktakes">Stock-taking</option></select><label>From <input type="date" value={reportDates.from} onChange={(event) => setReportDates({ ...reportDates, from: event.target.value })} /></label><label>To <input type="date" value={reportDates.to} onChange={(event) => setReportDates({ ...reportDates, to: event.target.value })} /></label><button className="btn-primary" onClick={loadReport} disabled={saving}>Run report</button><button className="btn-secondary" onClick={exportReport} disabled={!reportRows.length}>Export CSV</button><button className="btn-secondary" onClick={() => window.print()} disabled={!reportRows.length}>Print</button></div>
          <div className="inventory-print-report"><ReportTable rows={reportRows} /></div>
        </section>}

        {canManage && tab === 'history' && <section className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">Immutable movement log</p><h2>Transaction history</h2></div></div>
          <MovementTable movements={movements} />
          {!movements.length && <p className="empty-state">No stock transactions recorded.</p>}
        </section>}
      </div>
      {printLabel && <div className="inventory-print-only"><BarcodeLabel value={printLabel.value} name={printLabel.name} /><button className="btn-secondary" onClick={() => setPrintLabel(null)}>Close label</button></div>}
    </div>
  );
}

function MovementTable({ movements }) {
  return <div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Movement</th><th>Change</th><th>Balance</th><th>Reason / reference</th><th>By</th></tr></thead><tbody>
    {movements.map((movement) => <tr key={movement.id}><td>{shortDate(movement.created_at)}</td><td>{movement.item_name}</td><td>{pill(movement.movement_type)}</td><td style={{ color: movement.quantity_change < 0 ? '#b91c1c' : '#047857' }}>{movement.quantity_change > 0 ? '+' : ''}{movement.quantity_change} {movement.unit}</td><td>{movement.quantity_after}</td><td>{movement.reason || movement.reference_type}</td><td>{movement.actor_name || 'System'}</td></tr>)}
  </tbody></table></div>;
}

function IssuanceTable({ issuances, onPrint }) {
  return <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Date</th><th>Recipient</th><th>Items</th><th>Purpose</th><th /></tr></thead><tbody>
    {issuances.map((issuance) => <tr key={issuance.id}><td>{issuance.reference_number}</td><td>{shortDate(issuance.issued_at)}</td><td>{issuance.recipient_name}<div>{String(issuance.recipient_type).replaceAll('_', ' ')}</div></td><td>{issuance.items.map((item) => `${item.item_name} × ${item.quantity} ${item.unit}`).join(', ')}</td><td>{issuance.purpose}</td><td><button className="btn-small btn-secondary" onClick={() => onPrint({ issuance, item: issuance.items[0], quantity: issuance.items[0]?.quantity })}>Receipt</button></td></tr>)}
  </tbody></table></div>;
}

function ReceiptCard({ receipt }) {
  if (!receipt?.issuance) return null;
  const items = receipt.issuance.items?.length
    ? receipt.issuance.items
    : receipt.item ? [{ item_name: receipt.item.item_name, quantity: receipt.quantity }] : [];
  return <div><h3>The McCarthy Hill School · Stock Issuance</h3><p>Reference: {receipt.issuance.reference_number}</p><p>Recipient: {receipt.issuance.recipient_name} ({String(receipt.issuance.recipient_type).replaceAll('_', ' ')})</p><p>Issued: {shortDate(receipt.issuance.issued_at)}</p><p>Purpose: {receipt.issuance.purpose}</p><table><thead><tr><th>Item</th><th>Quantity</th><th>Balance after issue</th></tr></thead><tbody>{items.map((item) => <tr key={item.inventory_id || item.item_name}><td>{item.item_name}</td><td>{item.quantity}</td><td>{receipt.issuance.items?.length ? '—' : receipt.quantity_after ?? '—'}</td></tr>)}</tbody></table><p>Received by: __________________________ · Signature: __________________________</p></div>;
}

function RequestTable({ requests, canApprove, quantities, setQuantities, onDecision, onFulfill, saving }) {
  return <div className="table-wrap"><table><thead><tr><th>Request</th><th>Requester / purpose</th><th>Qty</th><th>Status</th><th>Decision / fulfilment</th></tr></thead><tbody>
    {requests.map((request) => <tr key={request.id}><td><strong>{request.item_name}</strong><div>{shortDate(request.created_at)} · {request.department || 'No department'}</div></td><td>{request.requester_name}<div>{request.purpose}</div>{request.approval_comment && <small>{request.approval_comment}</small>}</td><td>Requested {request.quantity_requested}<div>Approved {request.quantity_approved} · fulfilled {request.quantity_fulfilled}</div></td><td>{pill(request.status)}</td><td>
      {canApprove && request.status === 'pending_approval' && <div className="inventory-actions"><input aria-label={`Approved quantity for request ${request.id}`} type="number" min="1" max={request.quantity_requested} value={quantities[request.id] ?? request.quantity_requested} onChange={(event) => setQuantities({ ...quantities, [request.id]: event.target.value })} /><input aria-label={`Approval comment for request ${request.id}`} placeholder="Approval comment" value={quantities[`${request.id}-comment`] || ''} onChange={(event) => setQuantities({ ...quantities, [`${request.id}-comment`]: event.target.value })} /><button className="btn-small btn-primary" disabled={saving} onClick={() => onDecision(request, 'approved')}>Approve</button><button className="btn-small btn-delete" disabled={saving} onClick={() => onDecision(request, 'rejected')}>Reject</button></div>}
      {canApprove && ['approved','partially_fulfilled'].includes(request.status) && <div className="inventory-actions"><input aria-label={`Fulfil quantity for request ${request.id}`} type="number" min="1" max={request.quantity_approved - request.quantity_fulfilled} placeholder={`Remaining ${request.quantity_approved - request.quantity_fulfilled}`} value={quantities[`${request.id}-fulfill`] || ''} onChange={(event) => setQuantities({ ...quantities, [`${request.id}-fulfill`]: event.target.value })} /><button className="btn-small btn-primary" disabled={saving} onClick={() => onFulfill(request)}>Fulfil</button></div>}
    </td></tr>)}
  </tbody></table>{!requests.length && <p className="empty-state">No requests yet.</p>}</div>;
}

function ReportTable({ rows }) {
  if (!rows.length) return <p className="empty-state">Run a report to view and export results.</p>;
  const columns = Object.keys(rows[0]);
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || row.reference_number || `${index}`}>{columns.map((column) => <td key={column}>{String(row[column] ?? '-')}</td>)}</tr>)}</tbody></table></div>;
}

export default Inventory;
