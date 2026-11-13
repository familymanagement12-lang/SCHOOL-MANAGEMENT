import { useEffect, useMemo, useState } from 'react';
import {
  approveKitchenPurchase, approveTuckshopProductPurchase, createKitchenPurchase,
  createTuckshopProductPurchase, createTuckshopSale, getFeedingReport,
  getKitchenPurchases, getKitchenStock, getShoppingAdvances, getTuckshopDailyReconciliation,
  getTuckshopProductPurchases, getTuckshopProducts, getTuckshopSales,
  saveKitchenStock, saveTuckshopDailyReconciliation, saveTuckshopProduct,
} from '../api/feeding';
import { hasOperationalPermission } from '../utils/operationalPermissions';
import { downloadOperationsReport } from '../utils/feedingReportWorkbook';
import FeedingHistoricalFinance from '../components/FeedingHistoricalFinance';
import FeedingWorkbookArchive from '../components/FeedingWorkbookArchive';
import ImportedWorkbookHistory from '../components/ImportedWorkbookHistory';

const today = () => new Date().toLocaleDateString('en-CA');
const money = (value) => `GH₵${Number(value || 0).toFixed(2)}`;
const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function Tuckshop() {
  let user;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  const can = (...permissions) => hasOperationalPermission(user, ...permissions);
  const canProducts = can(
    'tuckshop.products.read', 'tuckshop.products.manage', 'tuckshop.sales.create',
    'tuckshop.purchases.create', 'tuckshop.purchases.approve',
  );
  const canSalesRead = can('tuckshop.sales.read');
  const canSalesCreate = can('tuckshop.sales.create');
  const canStockRead = can('tuckshop.stock.read', 'tuckshop.stock.manage', 'tuckshop.purchases.create', 'tuckshop.purchases.approve');
  const canPurchases = can('tuckshop.purchases.read', 'tuckshop.purchases.create', 'tuckshop.purchases.approve');
  const canPurchaseCreate = can('tuckshop.purchases.create');
  const canPurchaseApprove = can('tuckshop.purchases.approve');
  const canReconcile = can('tuckshop.sales.reconcile');
  const canReport = can('tuckshop.reports.read');
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [productPurchases, setProductPurchases] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [dailyReconciliation, setDailyReconciliation] = useState(null);
  const [reconciliationDate, setReconciliationDate] = useState(today());
  const [cashCounted, setCashCounted] = useState('');
  const [reconciliationNotes, setReconciliationNotes] = useState('');
  const [cart, setCart] = useState({});
  const [saleKey, setSaleKey] = useState(newIdempotencyKey());
  const [purchaseKey, setPurchaseKey] = useState(newIdempotencyKey());
  const [productPurchaseKey, setProductPurchaseKey] = useState(newIdempotencyKey());
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [productForm, setProductForm] = useState({
    name: '', sku: '', category: '', barcode: '', unit_price: '', cost_price: '0',
    stock_quantity: '0', reorder_level: '0', supplier: '', expiry_date: '',
  });
  const [editingProductId, setEditingProductId] = useState(null);
  const [editingStockItemId, setEditingStockItemId] = useState(null);
  const [stockForm, setStockForm] = useState({ name: '', unit: 'unit', quantity: '0', minimum_quantity: '0' });
  const [purchaseForm, setPurchaseForm] = useState({
    purchase_date: today(), supplier: '', reference: '', supporting_reference: '',
    buyer_name: '', description: '', notes: '', expense_category: 'Kitchen Supplies',
    payment_method: 'cash', advance_id: '', stock_item_id: '', item_name: '', unit: '',
    quantity: '1', unit_cost: '', tax_inclusive_unit_cost: '',
    transport_cost: '0', cutting_cost: '0', porter_cost: '0', grinding_cost: '0', other_cost: '0',
  });
  const [productPurchaseForm, setProductPurchaseForm] = useState({
    purchase_date: today(), product_id: '', quantity: '1', unit_cost: '',
    supplier: '', reference: '', payment_method: 'cash', advance_id: '',
    transport_cost: '0', other_cost: '0',
  });
  const [reportDates, setReportDates] = useState({ startDate: today(), endDate: today() });
  const [report, setReport] = useState(null);
  const [saleReceipt, setSaleReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    const tasks = [];
    if (canProducts) tasks.push(getTuckshopProducts().then((response) => setProducts(response.data)));
    if (canSalesRead) tasks.push(getTuckshopSales().then((response) => setSales(response.data)));
    if (canStockRead) tasks.push(getKitchenStock().then((response) => setStockItems(response.data)));
    if (canPurchases) tasks.push(getKitchenPurchases().then((response) => setPurchases(response.data)));
    if (canPurchases) tasks.push(getTuckshopProductPurchases().then((response) => setProductPurchases(response.data)));
    if (can('feeding.advances.manage')) tasks.push(getShoppingAdvances().then((response) => setAdvances(response.data)));
    if (canReconcile) tasks.push(
      getTuckshopDailyReconciliation(reconciliationDate).then((response) => {
        setDailyReconciliation(response.data);
        setCashCounted(response.data.cash_counted ?? '');
        setReconciliationNotes(response.data.notes ?? '');
      })
    );
    await Promise.all(tasks);
  };

  useEffect(() => {
    refresh()
      .catch((err) => setError(err.response?.data?.message || 'Unable to load tuckshop information.'))
      .finally(() => setLoading(false));
  }, []);

  const cartTotal = useMemo(() => Object.entries(cart).reduce((total, [id, quantity]) => {
    const product = products.find((item) => String(item.id) === id);
    return total + (product ? Number(product.unit_price) * Number(quantity) : 0);
  }, 0), [cart, products]);

  const addToCart = (product) => {
    setCart((current) => ({ ...current, [product.id]: (Number(current[product.id]) || 0) + 1 }));
  };

  const completeSale = async (event) => {
    event.preventDefault();
    const items = Object.entries(cart).filter(([, quantity]) => Number(quantity) > 0)
      .map(([product_id, quantity]) => ({ product_id, quantity: Number(quantity) }));
    if (!items.length) return setError('Add at least one product to the sale.');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await createTuckshopSale({
        items,
        payment_method: paymentMethod,
        idempotency_key: saleKey,
      });
      setSaleKey(newIdempotencyKey());
      setSaleReceipt(response.data);
      setCart({});
      setNotice(`Sale ${response.data.receipt_number} completed and recorded in the separate Tuckshop operational account.`);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to complete sale.');
    } finally {
      setBusy(false);
    }
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveTuckshopProduct(productForm, editingProductId);
      setProductForm({
        name: '', sku: '', category: '', barcode: '', unit_price: '', cost_price: '0',
        stock_quantity: '0', reorder_level: '0', supplier: '', expiry_date: '',
      });
      setEditingProductId(null);
      await refresh();
      setNotice('Product saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save product.');
    } finally {
      setBusy(false);
    }
  };

  const editProduct = (product) => {
    setEditingProductId(product.id);
    setProductForm({
      name: product.name,
      sku: product.sku || '',
      category: product.category || '',
      barcode: product.barcode || '',
      unit_price: product.unit_price,
      cost_price: product.cost_price || '0',
      stock_quantity: product.stock_quantity,
      reorder_level: product.reorder_level || '0',
      supplier: product.supplier || '',
      expiry_date: product.expiry_date ? String(product.expiry_date).slice(0, 10) : '',
      is_active: product.is_active,
    });
  };

  const saveStockItem = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveKitchenStock(stockForm, editingStockItemId);
      setStockForm({ name: '', unit: 'unit', quantity: '0', minimum_quantity: '0' });
      setEditingStockItemId(null);
      await refresh();
      setNotice('Kitchen stock item saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save kitchen stock item.');
    } finally {
      setBusy(false);
    }
  };

  const recordPurchase = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await createKitchenPurchase({
        purpose: 'kitchen',
        purchase_date: purchaseForm.purchase_date,
        supplier: purchaseForm.supplier,
        reference: purchaseForm.reference,
        supporting_reference: purchaseForm.supporting_reference,
        buyer_name: purchaseForm.buyer_name,
        description: purchaseForm.description,
        notes: purchaseForm.notes,
        expense_category: purchaseForm.expense_category,
        payment_method: purchaseForm.payment_method,
        advance_id: purchaseForm.advance_id || null,
        idempotency_key: purchaseKey,
        items: [{
          stock_item_id: purchaseForm.stock_item_id,
          item_name: purchaseForm.item_name,
          unit: purchaseForm.unit,
          quantity: purchaseForm.quantity,
          unit_cost: purchaseForm.unit_cost,
          tax_inclusive_unit_cost: purchaseForm.tax_inclusive_unit_cost || null,
        }],
        additional_costs: [
          ['transport', purchaseForm.transport_cost],
          ['cutting', purchaseForm.cutting_cost],
          ['porter', purchaseForm.porter_cost],
          ['grinding', purchaseForm.grinding_cost],
          ['other', purchaseForm.other_cost],
        ].filter(([, value]) => Number(value) > 0)
          .map(([charge_type, amount]) => ({ charge_type, amount })),
      });
      setNotice(`Purchase ${response.data.id} recorded for approval. Finance and stock update when approved.`);
      setPurchaseKey(newIdempotencyKey());
      setPurchaseForm((current) => ({
        ...current, supplier: '', reference: '', supporting_reference: '',
        buyer_name: '', description: '', notes: '', advance_id: '',
        item_name: '', unit: '', unit_cost: '', tax_inclusive_unit_cost: '',
        transport_cost: '0', cutting_cost: '0', porter_cost: '0', grinding_cost: '0', other_cost: '0',
      }));
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to record kitchen purchase.');
    } finally {
      setBusy(false);
    }
  };

  const approvePurchase = async (purchase) => {
    setBusy(true);
    setError('');
    try {
      await approveKitchenPurchase(purchase.id);
      await refresh();
      setNotice(`Purchase ${purchase.id} approved and reflected in the separate operational records and stock.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to approve kitchen purchase.');
    } finally {
      setBusy(false);
    }
  };

  const recordProductPurchase = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await createTuckshopProductPurchase({
        purchase_date: productPurchaseForm.purchase_date,
        supplier: productPurchaseForm.supplier,
        reference: productPurchaseForm.reference,
        payment_method: productPurchaseForm.payment_method,
        advance_id: productPurchaseForm.advance_id || null,
        transport_cost: productPurchaseForm.transport_cost,
        other_cost: productPurchaseForm.other_cost,
        idempotency_key: productPurchaseKey,
        items: [{
          product_id: productPurchaseForm.product_id,
          quantity: productPurchaseForm.quantity,
          unit_cost: productPurchaseForm.unit_cost,
        }],
      });
      setProductPurchaseKey(newIdempotencyKey());
      setProductPurchaseForm((current) => ({
        ...current, supplier: '', reference: '', unit_cost: '',
        transport_cost: '0', other_cost: '0',
      }));
      setNotice(`Tuckshop stock purchase ${response.data.id} recorded for approval.`);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to record tuckshop stock purchase.');
    } finally {
      setBusy(false);
    }
  };

  const approveProductPurchase = async (purchase) => {
    setBusy(true);
    setError('');
    try {
      await approveTuckshopProductPurchase(purchase.id);
      await refresh();
      setNotice(`Tuckshop stock purchase ${purchase.id} approved and stock cost updated.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to approve tuckshop stock purchase.');
    } finally {
      setBusy(false);
    }
  };

  const loadReconciliation = async (date) => {
    try {
      const response = await getTuckshopDailyReconciliation(date);
      setDailyReconciliation(response.data);
      setCashCounted(response.data.cash_counted ?? '');
      setReconciliationNotes(response.data.notes ?? '');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load daily cash reconciliation.');
    }
  };

  const saveReconciliation = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveTuckshopDailyReconciliation({
        reconciliation_date: reconciliationDate,
        cash_counted: cashCounted,
        notes: reconciliationNotes,
      });
      await loadReconciliation(reconciliationDate);
      setNotice('Daily cash reconciliation saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save daily cash reconciliation.');
    } finally {
      setBusy(false);
    }
  };

  const handleReport = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const response = await getFeedingReport(reportDates.startDate, reportDates.endDate);
      setReport(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load tuckshop report.');
    }
  };

  const downloadReport = async () => {
    try {
      await downloadOperationsReport(report, reportDates.startDate, reportDates.endDate);
    } catch (err) {
      setError(err.message || 'Unable to export the tuckshop report.');
    }
  };

  if (loading) return <div className="page"><p>Loading tuckshop information...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero">
          <div><p className="eyebrow">School operations</p><h1>Tuckshop &amp; Kitchen</h1><p>Manage products, POS sales, kitchen stock, purchases, and reports.</p></div>
        </section>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}

        {canSalesCreate && canProducts && (
          <section className="split-layout">
            <div className="data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Point of sale</p><h2>Products</h2></div></div>
              <div className="tuckshop-product-grid">
                {products.filter((product) => product.is_active).map((product) => (
                  <button type="button" className="tuckshop-product-card" key={product.id} disabled={Number(product.stock_quantity) < 1} onClick={() => addToCart(product)}>
                    <strong>{product.name}</strong><span>{money(product.unit_price)}</span><small>In stock: {product.stock_quantity}</small>
                  </button>
                ))}
                {!products.some((product) => product.is_active) && <p className="empty-state">No active tuckshop products.</p>}
              </div>
            </div>
            <form className="data-panel form-panel" onSubmit={completeSale}>
              <div className="panel-heading"><div><p className="eyebrow">POS</p><h2>Current sale</h2></div></div>
              {Object.entries(cart).map(([id, quantity]) => {
                const product = products.find((item) => String(item.id) === id);
                if (!product) return null;
                return <div className="tuckshop-cart-row" key={id}><span>{product.name}</span><input aria-label={`${product.name} quantity`} type="number" min="0" max={product.stock_quantity} value={quantity} onChange={(event) => setCart((current) => ({ ...current, [id]: event.target.value }))} /><strong>{money(Number(product.unit_price) * Number(quantity))}</strong><button type="button" aria-label={`Remove ${product.name}`} onClick={() => setCart((current) => { const next = { ...current }; delete next[id]; return next; })}>×</button></div>;
              })}
              <label htmlFor="tuckshop-payment-method">Payment method</label>
              <select id="tuckshop-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option>
              </select>
              <div className="tuckshop-total"><span>Total</span><strong>{money(cartTotal)}</strong></div>
              <button className="btn-primary" disabled={busy || cartTotal <= 0}>Complete sale</button>
            </form>
          </section>
        )}

        {can('tuckshop.products.read') && !canSalesCreate && !can('tuckshop.products.manage') && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Catalogue</p><h2>Tuckshop products</h2></div></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Product</th><th>SKU / barcode</th><th>Price</th><th>Stock</th></tr></thead>
              <tbody>{products.filter((product) => product.is_active).map((product) => (
                <tr key={product.id}><td>{product.name}</td><td>{product.sku || product.barcode || '—'}</td><td>{money(product.unit_price)}</td><td>{product.stock_quantity}</td></tr>
              ))}</tbody>
            </table></div>
            {!products.some((product) => product.is_active) && <p className="empty-state">No active tuckshop products.</p>}
          </section>
        )}

        {can('tuckshop.products.manage') && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Catalogue</p><h2>Manage products</h2></div></div>
            <form className="tuckshop-inline-form" onSubmit={saveProduct}>
              <label>Product name<input required value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} /></label>
              <label>SKU (optional)<input value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} /></label>
              <label>Barcode<input value={productForm.barcode} onChange={(event) => setProductForm({ ...productForm, barcode: event.target.value })} /></label>
              <label>Category<input value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })} /></label>
              <label>Price (GH₵)<input type="number" min="0" step="0.01" required value={productForm.unit_price} onChange={(event) => setProductForm({ ...productForm, unit_price: event.target.value })} /></label>
              <label>Current unit cost (GH₵)<input type="number" min="0" step="0.01" required value={productForm.cost_price} onChange={(event) => setProductForm({ ...productForm, cost_price: event.target.value })} /></label>
              <label>Stock<input type="number" min="0" step="1" required value={productForm.stock_quantity} onChange={(event) => setProductForm({ ...productForm, stock_quantity: event.target.value })} /></label>
              <label>Reorder level<input type="number" min="0" step="1" required value={productForm.reorder_level} onChange={(event) => setProductForm({ ...productForm, reorder_level: event.target.value })} /></label>
              <label>Supplier<input value={productForm.supplier} onChange={(event) => setProductForm({ ...productForm, supplier: event.target.value })} /></label>
              <label>Expiry date<input type="date" value={productForm.expiry_date} onChange={(event) => setProductForm({ ...productForm, expiry_date: event.target.value })} /></label>
              {editingProductId && <label className="tuckshop-checkbox"><input type="checkbox" checked={productForm.is_active !== false} onChange={(event) => setProductForm({ ...productForm, is_active: event.target.checked })} /> Active</label>}
              <button className="btn-primary" disabled={busy}>{editingProductId ? 'Save product' : 'Add product'}</button>
              {editingProductId && <button type="button" className="btn-secondary" onClick={() => { setEditingProductId(null); setProductForm({ name: '', sku: '', category: '', barcode: '', unit_price: '', cost_price: '0', stock_quantity: '0', reorder_level: '0', supplier: '', expiry_date: '' }); }}>Cancel</button>}
            </form>
            <div className="table-wrap"><table>
              <thead><tr><th>Product</th><th>SKU / barcode</th><th>Price</th><th>Cost</th><th>Stock</th><th>Expiry</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{products.map((product) => <tr key={product.id}><td>{product.name}</td><td>{product.sku || product.barcode || '—'}</td><td>{money(product.unit_price)}</td><td>{money(product.cost_price)}</td><td>{product.stock_quantity} {Number(product.stock_quantity) <= Number(product.reorder_level) ? '(reorder)' : ''}</td><td>{product.expiry_date ? String(product.expiry_date).slice(0, 10) : '—'}</td><td>{product.is_active ? 'Active' : 'Inactive'}</td><td><button className="btn-secondary" onClick={() => editProduct(product)}>Edit</button></td></tr>)}</tbody>
            </table></div>
          </section>
        )}

        {canSalesRead && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">History</p><h2>Tuckshop sales</h2></div></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Receipt</th><th>Items</th><th>Payment</th><th>Total</th><th>Sold by</th></tr></thead>
              <tbody>{sales.map((sale) => <tr key={sale.id}><td>{String(sale.sale_date).slice(0, 10)}</td><td>{sale.receipt_number}</td><td>{sale.items.map((item) => `${item.product_name} × ${item.quantity}`).join(', ')}</td><td>{sale.payment_method.replace('_', ' ')}</td><td>{money(sale.total_amount)}</td><td>{sale.sold_by_name || '—'}</td></tr>)}</tbody>
            </table></div>
            {!sales.length && <p className="empty-state">No tuckshop sales recorded.</p>}
          </section>
        )}

        {canStockRead && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Kitchen inventory</p><h2>Kitchen stock</h2></div></div>
            {can('tuckshop.stock.manage') && (
              <form className="tuckshop-inline-form" onSubmit={saveStockItem}>
                <label>Item<input required value={stockForm.name} onChange={(event) => setStockForm({ ...stockForm, name: event.target.value })} /></label>
                <label>Unit<input required value={stockForm.unit} onChange={(event) => setStockForm({ ...stockForm, unit: event.target.value })} /></label>
                <label>Current quantity<input type="number" min="0" step="0.001" required value={stockForm.quantity} onChange={(event) => setStockForm({ ...stockForm, quantity: event.target.value })} /></label>
                <label>Low-stock level<input type="number" min="0" step="0.001" required value={stockForm.minimum_quantity} onChange={(event) => setStockForm({ ...stockForm, minimum_quantity: event.target.value })} /></label>
                <button className="btn-primary" disabled={busy}>{editingStockItemId ? 'Save stock item' : 'Add stock item'}</button>
                {editingStockItemId && <button type="button" className="btn-secondary" onClick={() => { setEditingStockItemId(null); setStockForm({ name: '', unit: 'unit', quantity: '0', minimum_quantity: '0' }); }}>Cancel</button>}
              </form>
            )}
            <div className="table-wrap"><table>
              <thead><tr><th>Item</th><th>Quantity</th><th>Low-stock level</th><th>Status</th>{can('tuckshop.stock.manage') && <th>Action</th>}</tr></thead>
              <tbody>{stockItems.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.quantity} {item.unit}</td><td>{item.minimum_quantity} {item.unit}</td><td>{Number(item.quantity) <= Number(item.minimum_quantity) ? 'Low stock' : 'In stock'}</td>{can('tuckshop.stock.manage') && <td><button className="btn-secondary" onClick={() => { setEditingStockItemId(item.id); setStockForm({ name: item.name, unit: item.unit, quantity: item.quantity, minimum_quantity: item.minimum_quantity }); }}>Edit</button></td>}</tr>)}</tbody>
            </table></div>
            {!stockItems.length && <p className="empty-state">No kitchen stock items yet.</p>}
          </section>
        )}

        {canPurchases && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Purchases and expenses</p><h2>Kitchen and market purchases</h2></div></div>
            {can('tuckshop.purchases.create') && (
              <form className="tuckshop-inline-form" onSubmit={recordPurchase}>
                <label>Date<input type="date" required value={purchaseForm.purchase_date} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchase_date: event.target.value })} /></label>
                <label>Stock item (optional)<select value={purchaseForm.stock_item_id} onChange={(event) => setPurchaseForm({ ...purchaseForm, stock_item_id: event.target.value })}><option value="">Enter an unstocked item below</option>{stockItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label>
                <label>Item name<input required={!purchaseForm.stock_item_id} value={purchaseForm.item_name} onChange={(event) => setPurchaseForm({ ...purchaseForm, item_name: event.target.value })} /></label>
                <label>Unit<input required={!purchaseForm.stock_item_id} value={purchaseForm.unit} onChange={(event) => setPurchaseForm({ ...purchaseForm, unit: event.target.value })} /></label>
                <label>Quantity<input type="number" min="0.001" step="0.001" required value={purchaseForm.quantity} onChange={(event) => setPurchaseForm({ ...purchaseForm, quantity: event.target.value })} /></label>
                <label>Unit cost before tax (GH₵)<input type="number" min="0" step="0.01" required value={purchaseForm.unit_cost} onChange={(event) => setPurchaseForm({ ...purchaseForm, unit_cost: event.target.value })} /></label>
                <label>Tax-inclusive unit cost (optional; used for total)<input type="number" min="0" step="0.01" value={purchaseForm.tax_inclusive_unit_cost} onChange={(event) => setPurchaseForm({ ...purchaseForm, tax_inclusive_unit_cost: event.target.value })} /></label>
                <label>Expense category<select value={purchaseForm.expense_category} onChange={(event) => setPurchaseForm({ ...purchaseForm, expense_category: event.target.value })}>
                  {['Kitchen Supplies', 'Food Supplies', 'Gas', 'Repairs', 'Transport', 'Market Charges', 'Other Kitchen Expenses'].map((category) => <option key={category}>{category}</option>)}
                </select></label>
                <label>Payment method<select value={purchaseForm.payment_method} onChange={(event) => setPurchaseForm({ ...purchaseForm, payment_method: event.target.value })}>
                  <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option>
                </select></label>
                <label>Supplier<input value={purchaseForm.supplier} onChange={(event) => setPurchaseForm({ ...purchaseForm, supplier: event.target.value })} /></label>
                <label>Invoice/reference<input value={purchaseForm.reference} onChange={(event) => setPurchaseForm({ ...purchaseForm, reference: event.target.value })} /></label>
                <label>Supporting reference<input value={purchaseForm.supporting_reference} onChange={(event) => setPurchaseForm({ ...purchaseForm, supporting_reference: event.target.value })} /></label>
                <label>Buyer<input value={purchaseForm.buyer_name} onChange={(event) => setPurchaseForm({ ...purchaseForm, buyer_name: event.target.value })} /></label>
                {can('feeding.advances.manage') && <label>Shopping advance (optional)<select value={purchaseForm.advance_id} onChange={(event) => setPurchaseForm({ ...purchaseForm, advance_id: event.target.value })}><option value="">No advance</option>{advances.map((advance) => <option key={advance.id} value={advance.id}>#{advance.id} {advance.recipient_name} — {money(advance.unaccounted_amount)} available</option>)}</select></label>}
                <label>Transport cost<input type="number" min="0" step="0.01" value={purchaseForm.transport_cost} onChange={(event) => setPurchaseForm({ ...purchaseForm, transport_cost: event.target.value })} /></label>
                <label>Cutting cost<input type="number" min="0" step="0.01" value={purchaseForm.cutting_cost} onChange={(event) => setPurchaseForm({ ...purchaseForm, cutting_cost: event.target.value })} /></label>
                <label>Porter cost<input type="number" min="0" step="0.01" value={purchaseForm.porter_cost} onChange={(event) => setPurchaseForm({ ...purchaseForm, porter_cost: event.target.value })} /></label>
                <label>Grinding cost<input type="number" min="0" step="0.01" value={purchaseForm.grinding_cost} onChange={(event) => setPurchaseForm({ ...purchaseForm, grinding_cost: event.target.value })} /></label>
                <label>Other charges<input type="number" min="0" step="0.01" value={purchaseForm.other_cost} onChange={(event) => setPurchaseForm({ ...purchaseForm, other_cost: event.target.value })} /></label>
                <label>Description<input value={purchaseForm.description} onChange={(event) => setPurchaseForm({ ...purchaseForm, description: event.target.value })} /></label>
                <label>Notes<input value={purchaseForm.notes} onChange={(event) => setPurchaseForm({ ...purchaseForm, notes: event.target.value })} /></label>
                <button className="btn-primary" disabled={busy}>Record for approval</button>
              </form>
            )}
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Purpose</th><th>Supplier / reference</th><th>Category / payment</th><th>Items</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{purchases.map((purchase) => <tr key={purchase.id}><td>{String(purchase.purchase_date).slice(0, 10)}</td><td>{purchase.purpose}</td><td>{purchase.supplier || '—'}<br /><small>{purchase.reference || purchase.supporting_reference || ''}</small></td><td>{purchase.expense_category}<br /><small>{purchase.payment_method?.replace('_', ' ')}</small></td><td>{purchase.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}</td><td>{money(purchase.total_amount)}</td><td>{purchase.status}</td><td>{purchase.purpose === 'kitchen' && purchase.status === 'pending' && can('tuckshop.purchases.approve') && <button className="btn-secondary" disabled={busy} onClick={() => approvePurchase(purchase)}>Approve</button>}</td></tr>)}</tbody>
            </table></div>
          </section>
        )}

        {canPurchases && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Stock valuation</p><h2>Tuckshop merchandise purchases</h2></div></div>
            {canPurchaseCreate && (
              <form className="tuckshop-inline-form" onSubmit={recordProductPurchase}>
                <label>Date<input type="date" required value={productPurchaseForm.purchase_date} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, purchase_date: event.target.value })} /></label>
                <label>Product<select required value={productPurchaseForm.product_id} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, product_id: event.target.value })}><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
                <label>Quantity<input type="number" min="1" step="1" required value={productPurchaseForm.quantity} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, quantity: event.target.value })} /></label>
                <label>Unit cost (GH₵)<input type="number" min="0" step="0.01" required value={productPurchaseForm.unit_cost} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, unit_cost: event.target.value })} /></label>
                <label>Supplier<input value={productPurchaseForm.supplier} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, supplier: event.target.value })} /></label>
                <label>Invoice/reference<input value={productPurchaseForm.reference} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, reference: event.target.value })} /></label>
                <label>Payment method<select value={productPurchaseForm.payment_method} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, payment_method: event.target.value })}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
                {can('feeding.advances.manage') && <label>Shopping advance (optional)<select value={productPurchaseForm.advance_id} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, advance_id: event.target.value })}><option value="">No advance</option>{advances.map((advance) => <option key={advance.id} value={advance.id}>#{advance.id} {advance.recipient_name} — {money(advance.unaccounted_amount)} available</option>)}</select></label>}
                <label>Transport cost<input type="number" min="0" step="0.01" value={productPurchaseForm.transport_cost} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, transport_cost: event.target.value })} /></label>
                <label>Other cost<input type="number" min="0" step="0.01" value={productPurchaseForm.other_cost} onChange={(event) => setProductPurchaseForm({ ...productPurchaseForm, other_cost: event.target.value })} /></label>
                <button className="btn-primary" disabled={busy || !products.length}>Record stock purchase for approval</button>
              </form>
            )}
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th>Costs</th><th>Total</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{productPurchases.map((purchase) => <tr key={purchase.id}><td>{String(purchase.purchase_date).slice(0, 10)}</td><td>{purchase.supplier || '—'}</td><td>{purchase.items.map((item) => `${item.product_name} × ${item.quantity} @ ${money(item.unit_cost)}`).join(', ')}</td><td>Transport {money(purchase.transport_cost)}; Other {money(purchase.other_cost)}</td><td>{money(purchase.total_amount)}</td><td>{purchase.payment_method.replace('_', ' ')}</td><td>{purchase.status}</td><td>{purchase.status === 'pending' && canPurchaseApprove && <button className="btn-secondary" disabled={busy} onClick={() => approveProductPurchase(purchase)}>Approve</button>}</td></tr>)}</tbody>
            </table></div>
            {!productPurchases.length && <p className="empty-state">No merchandise purchases recorded.</p>}
          </section>
        )}

        {canReconcile && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Daily close</p><h2>Cash reconciliation</h2></div></div>
            <label>Sales date<input type="date" required value={reconciliationDate} onChange={(event) => { setReconciliationDate(event.target.value); if (event.target.value) loadReconciliation(event.target.value); }} /></label>
            {dailyReconciliation && <div className="module-stats">
              <div className="mini-stat"><span>Transactions</span><strong>{dailyReconciliation.transaction_count}</strong></div>
              <div className="mini-stat"><span>Expected cash</span><strong>{money(dailyReconciliation.expected_cash)}</strong></div>
              <div className="mini-stat"><span>Mobile money</span><strong>{money(dailyReconciliation.expected_mobile_money)}</strong></div>
              <div className="mini-stat"><span>Other methods</span><strong>{money(dailyReconciliation.other_methods)}</strong></div>
              <div className="mini-stat"><span>Total sales</span><strong>{money(dailyReconciliation.total_sales)}</strong></div>
              <div className="mini-stat"><span>Cash variance</span><strong>{dailyReconciliation.cash_variance == null ? 'Not counted' : money(dailyReconciliation.cash_variance)}</strong></div>
            </div>}
            <form className="tuckshop-inline-form" onSubmit={saveReconciliation}>
              <label>Cash counted (GH₵)<input type="number" min="0" step="0.01" required value={cashCounted} onChange={(event) => setCashCounted(event.target.value)} /></label>
              <label>Notes<input value={reconciliationNotes} onChange={(event) => setReconciliationNotes(event.target.value)} /></label>
              <button className="btn-primary" disabled={busy}>Save reconciliation</button>
            </form>
            {dailyReconciliation?.reconciled_by && <p className="muted-copy">Last reconciled by {dailyReconciliation.reconciled_by}.</p>}
          </section>
        )}

        {canReport && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Reports</p><h2>Tuckshop report</h2></div></div>
            <form className="feeding-report-form" onSubmit={handleReport}>
              <label>From<input type="date" required value={reportDates.startDate} onChange={(event) => setReportDates({ ...reportDates, startDate: event.target.value })} /></label>
              <label>To<input type="date" required value={reportDates.endDate} onChange={(event) => setReportDates({ ...reportDates, endDate: event.target.value })} /></label>
              <button className="btn-primary">Generate report</button>
            </form>
            {report && <div className="module-stats">
              {report.tuckshop && <div className="mini-stat"><span>Sales ({report.tuckshop.count})</span><strong>{money(report.tuckshop.total)}</strong></div>}
              {report.tuckshop && <div className="mini-stat"><span>Cost of goods sold ({report.tuckshop.costedSalesCount} costed sales)</span><strong>{money(report.tuckshop.costOfGoodsSold)}</strong></div>}
              {report.tuckshop && <div className="mini-stat"><span>Gross profit on costed sales</span><strong>{money(report.tuckshop.grossProfit)}</strong></div>}
              {report.approvedPurchases?.map((purchase) => <div className="mini-stat" key={purchase.purpose}><span>{purchase.purpose} purchases ({purchase.count})</span><strong>{money(purchase.total)}</strong></div>)}
            </div>}
            {report && <button type="button" className="btn-secondary" onClick={downloadReport}>Download Excel report</button>}
            {report?.weeklyOperations && <>
              <h3>Weekly income and expenses</h3>
              <div className="table-wrap"><table>
                <thead><tr><th>Week beginning</th><th>Feeding income</th><th>Tuckshop sales</th><th>Feeding expenses</th><th>Kitchen expenses</th><th>Tuckshop stock purchases</th><th>Cost of goods sold</th><th>Total income</th><th>Total expenses</th><th>Net</th></tr></thead>
                <tbody>{report.weeklyOperations.map((row) => <tr key={row.week_start}>
                  <td>{row.week_start}</td><td>{money(row.feeding_income)}</td><td>{money(row.tuckshop_sales)}</td>
                  <td>{money(row.feeding_expenses)}</td><td>{money(row.kitchen_expenses)}</td>
                  <td>{money(row.tuckshop_purchases)}</td><td>{money(row.tuckshop_cogs)}</td>
                  <td>{money(row.total_income)}</td><td>{money(row.total_expenses)}</td>
                  <td>{money(Number(row.total_income) - Number(row.total_expenses))}</td>
                </tr>)}</tbody>
              </table></div>
              <p className="muted-copy">Tuckshop stock purchases are inventory; expenditure is recognized as cost of goods sold.</p>
            </>}
            {report?.operationalLedgerEntries && <>
              <h3>Feeding &amp; Tuckshop operational income and expenditure</h3>
              <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Reference</th><th>Description</th><th>Amount</th></tr></thead>
                <tbody>{report.operationalLedgerEntries.map((entry) => (
                  <tr key={`${entry.source_type}-${entry.source_id}`}>
                    <td>{entry.entry_date}</td><td>{entry.type}</td><td>{entry.category}</td>
                    <td>{entry.reference || '—'}</td><td>{entry.description}</td><td>{money(entry.amount)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {!report.operationalLedgerEntries.length && <p className="muted-copy">No operational income or expenditure was recorded in this date range.</p>}
            </>}
            <FeedingHistoricalFinance modules={['tuckshop']} />
            <ImportedWorkbookHistory modules={['purchases']} />
            <FeedingWorkbookArchive />
            {report?.purchaseDetails && <div className="table-wrap">
              <h3>Purchase detail</h3>
              <table>
                <thead><tr><th>Date</th><th>Source</th><th>Category</th><th>Supplier</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>{report.purchaseDetails.map((purchase) => <tr key={`${purchase.source}-${purchase.id}`}>
                  <td>{purchase.purchase_date}</td><td>{purchase.source}</td><td>{purchase.category}</td>
                  <td>{purchase.supplier || '—'}</td><td>{purchase.items || '—'}</td>
                  <td>{money(purchase.total_amount)}</td><td>{purchase.status}</td>
                </tr>)}</tbody>
              </table>
            </div>}
            {report?.tuckshopCollections && <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Transactions</th><th>Cash</th><th>Mobile money</th><th>Other</th><th>Total</th></tr></thead>
              <tbody>{report.tuckshopCollections.map((row) => <tr key={row.sale_date}><td>{String(row.sale_date).slice(0, 10)}</td><td>{row.transaction_count}</td><td>{money(row.cash_total)}</td><td>{money(row.mobile_money_total)}</td><td>{money(row.other_total)}</td><td>{money(row.total)}</td></tr>)}</tbody>
            </table></div>}
          </section>
        )}
      </div>

      {saleReceipt && (
        <div className="modal-overlay" onClick={() => setSaleReceipt(null)}>
          <section className="modal feeding-receipt" onClick={(event) => event.stopPropagation()}>
            <h2>Tuckshop receipt</h2><p><strong>Receipt:</strong> {saleReceipt.receipt_number}</p>
            {saleReceipt.items.map((item) => <p key={item.product_id}>{item.product_name} × {item.quantity} — {money(item.line_total)}</p>)}
            <p><strong>Total:</strong> {money(saleReceipt.total_amount)}</p><p><strong>Payment:</strong> {saleReceipt.payment_method.replace('_', ' ')}</p>
            <div className="modal-actions"><button className="btn-secondary" onClick={() => setSaleReceipt(null)}>Close</button><button className="btn-primary" onClick={() => window.print()}>Print receipt</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

export default Tuckshop;
