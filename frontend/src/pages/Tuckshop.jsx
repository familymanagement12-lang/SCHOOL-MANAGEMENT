import { useEffect, useMemo, useState } from 'react';
import {
  approveKitchenPurchase, createKitchenPurchase, createTuckshopSale, getFeedingReport,
  getKitchenPurchases, getKitchenStock, getTuckshopProducts, getTuckshopSales,
  saveKitchenStock, saveTuckshopProduct,
} from '../api/feeding';
import { hasOperationalPermission } from '../utils/operationalPermissions';

const today = () => new Date().toLocaleDateString('en-CA');
const money = (value) => `GH₵${Number(value || 0).toFixed(2)}`;
const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function Tuckshop() {
  let user;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  const can = (...permissions) => hasOperationalPermission(user, ...permissions);
  const canProducts = can('tuckshop.products.read', 'tuckshop.products.manage', 'tuckshop.sales.create');
  const canSalesRead = can('tuckshop.sales.read');
  const canSalesCreate = can('tuckshop.sales.create');
  const canStockRead = can('tuckshop.stock.read', 'tuckshop.stock.manage', 'tuckshop.purchases.create', 'tuckshop.purchases.approve');
  const canPurchases = can('tuckshop.purchases.read', 'tuckshop.purchases.create', 'tuckshop.purchases.approve');
  const canReport = can('tuckshop.reports.read');
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [cart, setCart] = useState({});
  const [saleKey, setSaleKey] = useState(newIdempotencyKey());
  const [purchaseKey, setPurchaseKey] = useState(newIdempotencyKey());
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [productForm, setProductForm] = useState({ name: '', sku: '', unit_price: '', stock_quantity: '0' });
  const [editingProductId, setEditingProductId] = useState(null);
  const [editingStockItemId, setEditingStockItemId] = useState(null);
  const [stockForm, setStockForm] = useState({ name: '', unit: 'unit', quantity: '0', minimum_quantity: '0' });
  const [purchaseForm, setPurchaseForm] = useState({
    purchase_date: today(), supplier: '', reference: '', notes: '',
    stock_item_id: '', quantity: '1', unit_cost: '',
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
      setNotice(`Sale ${response.data.receipt_number} completed and recorded in Income & Expenditure.`);
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
      setProductForm({ name: '', sku: '', unit_price: '', stock_quantity: '0' });
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
      unit_price: product.unit_price,
      stock_quantity: product.stock_quantity,
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
        notes: purchaseForm.notes,
        idempotency_key: purchaseKey,
        items: [{
          stock_item_id: purchaseForm.stock_item_id,
          quantity: purchaseForm.quantity,
          unit_cost: purchaseForm.unit_cost,
        }],
      });
      setNotice(`Purchase ${response.data.id} recorded for approval. Finance and stock update when approved.`);
      setPurchaseKey(newIdempotencyKey());
      setPurchaseForm((current) => ({ ...current, supplier: '', reference: '', notes: '', unit_cost: '' }));
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
      setNotice(`Purchase ${purchase.id} approved and posted to Income & Expenditure.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to approve kitchen purchase.');
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
                <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="card">Card</option><option value="other">Other</option>
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
              <thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th></tr></thead>
              <tbody>{products.filter((product) => product.is_active).map((product) => (
                <tr key={product.id}><td>{product.name}</td><td>{product.sku || '—'}</td><td>{money(product.unit_price)}</td><td>{product.stock_quantity}</td></tr>
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
              <label>Price (GH₵)<input type="number" min="0" step="0.01" required value={productForm.unit_price} onChange={(event) => setProductForm({ ...productForm, unit_price: event.target.value })} /></label>
              <label>Stock<input type="number" min="0" step="1" required value={productForm.stock_quantity} onChange={(event) => setProductForm({ ...productForm, stock_quantity: event.target.value })} /></label>
              {editingProductId && <label className="tuckshop-checkbox"><input type="checkbox" checked={productForm.is_active !== false} onChange={(event) => setProductForm({ ...productForm, is_active: event.target.checked })} /> Active</label>}
              <button className="btn-primary" disabled={busy}>{editingProductId ? 'Save product' : 'Add product'}</button>
              {editingProductId && <button type="button" className="btn-secondary" onClick={() => { setEditingProductId(null); setProductForm({ name: '', sku: '', unit_price: '', stock_quantity: '0' }); }}>Cancel</button>}
            </form>
            <div className="table-wrap"><table>
              <thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{products.map((product) => <tr key={product.id}><td>{product.name}</td><td>{product.sku || '—'}</td><td>{money(product.unit_price)}</td><td>{product.stock_quantity}</td><td>{product.is_active ? 'Active' : 'Inactive'}</td><td><button className="btn-secondary" onClick={() => editProduct(product)}>Edit</button></td></tr>)}</tbody>
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
            <div className="panel-heading"><div><p className="eyebrow">Purchases and expenses</p><h2>Kitchen purchases</h2></div></div>
            {can('tuckshop.purchases.create') && (
              <form className="tuckshop-inline-form" onSubmit={recordPurchase}>
                <label>Date<input type="date" required value={purchaseForm.purchase_date} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchase_date: event.target.value })} /></label>
                <label>Stock item<select required value={purchaseForm.stock_item_id} onChange={(event) => setPurchaseForm({ ...purchaseForm, stock_item_id: event.target.value })}><option value="">Select item</option>{stockItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label>
                <label>Quantity<input type="number" min="0.001" step="0.001" required value={purchaseForm.quantity} onChange={(event) => setPurchaseForm({ ...purchaseForm, quantity: event.target.value })} /></label>
                <label>Unit cost (GH₵)<input type="number" min="0" step="0.01" required value={purchaseForm.unit_cost} onChange={(event) => setPurchaseForm({ ...purchaseForm, unit_cost: event.target.value })} /></label>
                <label>Supplier<input value={purchaseForm.supplier} onChange={(event) => setPurchaseForm({ ...purchaseForm, supplier: event.target.value })} /></label>
                <label>Invoice/reference<input value={purchaseForm.reference} onChange={(event) => setPurchaseForm({ ...purchaseForm, reference: event.target.value })} /></label>
                <button className="btn-primary" disabled={busy || !stockItems.length}>Record for approval</button>
              </form>
            )}
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Purpose</th><th>Supplier</th><th>Items</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{purchases.map((purchase) => <tr key={purchase.id}><td>{String(purchase.purchase_date).slice(0, 10)}</td><td>{purchase.purpose}</td><td>{purchase.supplier || '—'}</td><td>{purchase.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}</td><td>{money(purchase.total_amount)}</td><td>{purchase.status}</td><td>{purchase.purpose === 'kitchen' && purchase.status === 'pending' && can('tuckshop.purchases.approve') && <button className="btn-secondary" disabled={busy} onClick={() => approvePurchase(purchase)}>Approve</button>}</td></tr>)}</tbody>
            </table></div>
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
              {report.approvedPurchases?.map((purchase) => <div className="mini-stat" key={purchase.purpose}><span>{purchase.purpose} purchases ({purchase.count})</span><strong>{money(purchase.total)}</strong></div>)}
            </div>}
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
