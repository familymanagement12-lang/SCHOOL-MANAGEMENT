import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approveMarketPurchase,
  createMarketAdvance,
  createMarketPurchase,
  createMarketStockItem,
  getMarketAdvances,
  getMarketPurchases,
  getMarketStock,
  reconcileMarketAdvance,
} from '../api/feeding';
import { hasOperationalPermission } from '../utils/operationalPermissions';

const today = () => new Date().toLocaleDateString('en-CA');
const money = (value) => `GH₵${Number(value || 0).toFixed(2)}`;
const newRequestKey = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const newPurchaseItem = () => ({ stock_item_id: '', quantity: '1', unit_cost: '' });

function MarketStockOperations() {
  const [stock, setStock] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [returns, setReturns] = useState({});
  const [stockForm, setStockForm] = useState({ name: '', unit: '', minimum_quantity: '0' });
  const [purchaseForm, setPurchaseForm] = useState({
    purchase_date: today(), supplier: '', reference: '', payment_method: 'cash',
    buyer_name: '', supporting_reference: '', description: '', advance_id: '',
    items: [newPurchaseItem()],
  });
  const [advanceForm, setAdvanceForm] = useState({
    amount_issued: '', recipient_name: '', issued_date: today(), purpose: '', notes: '',
  });
  const [purchaseKey, setPurchaseKey] = useState(newRequestKey());
  const [advanceKey, setAdvanceKey] = useState(newRequestKey());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  let user;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  const canRead = hasOperationalPermission(user, 'feeding.market.read', 'feeding.market.manage');
  const canManage = hasOperationalPermission(user, 'feeding.market.manage');

  const refresh = useCallback(async () => {
    const [stockResponse, purchaseResponse, advanceResponse] = await Promise.all([
      getMarketStock(), getMarketPurchases(), getMarketAdvances(),
    ]);
    setStock(stockResponse.data);
    setPurchases(purchaseResponse.data);
    setAdvances(advanceResponse.data);
  }, []);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    Promise.all([getMarketStock(), getMarketPurchases(), getMarketAdvances()])
      .then(([stockResponse, purchaseResponse, advanceResponse]) => {
        if (!active) return;
        setStock(stockResponse.data);
        setPurchases(purchaseResponse.data);
        setAdvances(advanceResponse.data);
      })
      .catch((loadError) => active && setError(loadError.response?.data?.message || 'Unable to load market stock operations.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [canRead]);

  const purchaseTotal = useMemo(() => purchaseForm.items.reduce(
    (total, item) => total + Number(item.quantity || 0) * Number(item.unit_cost || 0),
    0
  ), [purchaseForm.items]);
  const weeklyTotals = useMemo(() => {
    const totals = new Map();
    purchases.filter((purchase) => purchase.status === 'approved').forEach((purchase) => {
      const date = new Date(`${String(purchase.purchase_date).slice(0, 10)}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      const week = date.toISOString().slice(0, 10);
      totals.set(week, (totals.get(week) || 0) + Number(purchase.total_amount));
    });
    return [...totals.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [purchases]);

  const submitStockItem = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await createMarketStockItem(stockForm);
      await refresh();
      setStockForm({ name: '', unit: '', minimum_quantity: '0' });
      setNotice('Market stock item added with zero opening quantity. Received stock changes only after purchase approval.');
    } catch (saveError) {
      setError(saveError.response?.data?.message || 'Unable to add stock item.');
    } finally {
      setBusy(false);
    }
  };

  const submitPurchase = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await createMarketPurchase({
        ...purchaseForm,
        purpose: 'feeding',
        expense_category: 'Market Charges',
        idempotency_key: purchaseKey,
      });
      await refresh();
      setPurchaseForm({
        purchase_date: today(), supplier: '', reference: '', payment_method: 'cash',
        buyer_name: '', supporting_reference: '', description: '', advance_id: '',
        items: [newPurchaseItem()],
      });
      setPurchaseKey(newRequestKey());
      setNotice('Market purchase recorded as pending approval. Stock updates only when approved.');
    } catch (saveError) {
      setError(saveError.response?.data?.message || 'Unable to record market purchase.');
    } finally {
      setBusy(false);
    }
  };

  const submitAdvance = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await createMarketAdvance({ ...advanceForm, idempotency_key: advanceKey });
      await refresh();
      setAdvanceForm({ amount_issued: '', recipient_name: '', issued_date: today(), purpose: '', notes: '' });
      setAdvanceKey(newRequestKey());
      setNotice('Market stock shopping advance issued.');
    } catch (saveError) {
      setError(saveError.response?.data?.message || 'Unable to issue market advance.');
    } finally {
      setBusy(false);
    }
  };

  const saveReturn = async (advance) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await reconcileMarketAdvance(advance.id, returns[advance.id] ?? advance.returned_amount);
      await refresh();
      setNotice('Market advance reconciliation saved.');
    } catch (saveError) {
      setError(saveError.response?.data?.message || 'Unable to reconcile this market advance.');
    } finally {
      setBusy(false);
    }
  };

  const approvePurchase = async (purchase) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await approveMarketPurchase(purchase.id);
      await refresh();
      setNotice('Market purchase approved and stock quantities updated.');
    } catch (approveError) {
      setError(approveError.response?.data?.message || 'Unable to approve this market purchase.');
    } finally {
      setBusy(false);
    }
  };

  if (!canRead) return null;

  return (
    <>
      <section className="data-panel">
        <div className="panel-heading"><div><p className="eyebrow">Operational stock</p><h2>Market stock register</h2></div></div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {notice && <p className="success-message" role="status">{notice}</p>}
        <div className="module-stats" aria-label="Market stock summary">
          <div className="mini-stat"><span>Registered stock items</span><strong>{stock.length}</strong></div>
          <div className="mini-stat"><span>Items at/below reorder point</span><strong>{stock.filter((item) => Number(item.quantity) <= Number(item.minimum_quantity)).length}</strong></div>
          <div className="mini-stat"><span>Purchases awaiting approval</span><strong>{purchases.filter((purchase) => purchase.status === 'pending').length}</strong></div>
          <div className="mini-stat"><span>Approved market spend</span><strong>{money(purchases.filter((purchase) => purchase.status === 'approved').reduce((sum, purchase) => sum + Number(purchase.total_amount), 0))}</strong></div>
        </div>
        {canManage && (
          <form className="feeding-import-form" onSubmit={submitStockItem}>
            <label>New stock item<input required maxLength="120" value={stockForm.name} onChange={(event) => setStockForm({ ...stockForm, name: event.target.value })} /></label>
            <label>Unit<input required maxLength="40" value={stockForm.unit} onChange={(event) => setStockForm({ ...stockForm, unit: event.target.value })} placeholder="kg, bag, crate…" /></label>
            <label>Reorder threshold<input type="number" min="0" step="0.001" value={stockForm.minimum_quantity} onChange={(event) => setStockForm({ ...stockForm, minimum_quantity: event.target.value })} /></label>
            <button type="submit" disabled={busy}>Add stock item</button>
          </form>
        )}
        {loading ? <p className="muted-copy">Loading market stock…</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Item</th><th>Unit</th><th>Current quantity</th><th>Reorder at</th><th>Updated</th></tr></thead>
            <tbody>{stock.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td><td>{item.unit}</td><td>{Number(item.quantity).toLocaleString()}</td>
                <td>{Number(item.minimum_quantity).toLocaleString()}</td>
                <td>{item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {!loading && !stock.length && <p className="empty-state">No market stock items are registered yet.</p>}
      </section>

      <section className="data-panel">
        <div className="panel-heading"><div><p className="eyebrow">Purchases · Market Charges</p><h2>Market purchasing and approval</h2></div></div>
        {canManage && (
          <form className="data-panel form-panel" onSubmit={submitPurchase}>
            <div className="feeding-import-form">
              <label>Purchase date<input type="date" required value={purchaseForm.purchase_date} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchase_date: event.target.value })} /></label>
              <label>Supplier<input value={purchaseForm.supplier} onChange={(event) => setPurchaseForm({ ...purchaseForm, supplier: event.target.value })} /></label>
              <label>Buyer<input value={purchaseForm.buyer_name} onChange={(event) => setPurchaseForm({ ...purchaseForm, buyer_name: event.target.value })} /></label>
              <label>Payment method<select value={purchaseForm.payment_method} onChange={(event) => setPurchaseForm({ ...purchaseForm, payment_method: event.target.value })}>
                <option value="cash">Cash</option><option value="mobile_money">Mobile money</option>
                <option value="bank_transfer">Bank transfer</option><option value="other">Other</option>
              </select></label>
              <label>Reference<input value={purchaseForm.reference} onChange={(event) => setPurchaseForm({ ...purchaseForm, reference: event.target.value })} /></label>
              <label>Supporting reference<input value={purchaseForm.supporting_reference} onChange={(event) => setPurchaseForm({ ...purchaseForm, supporting_reference: event.target.value })} /></label>
              <label>Linked advance (optional)<select value={purchaseForm.advance_id} onChange={(event) => setPurchaseForm({ ...purchaseForm, advance_id: event.target.value })}>
                <option value="">No advance</option>{advances.map((advance) => <option key={advance.id} value={advance.id}>{advance.recipient_name} · {money(advance.unaccounted_amount)} remaining</option>)}
              </select></label>
              <label>Description<input value={purchaseForm.description} onChange={(event) => setPurchaseForm({ ...purchaseForm, description: event.target.value })} /></label>
            </div>
            {purchaseForm.items.map((item, index) => (
              <div className="feeding-import-form" key={`market-item-${index}`}>
                <label>Stock item<select required value={item.stock_item_id} onChange={(event) => setPurchaseForm((form) => ({
                  ...form,
                  items: form.items.map((line, lineIndex) => lineIndex === index ? { ...line, stock_item_id: event.target.value } : line),
                }))}>
                  <option value="">Select stock item</option>{stock.map((stockItem) => <option value={stockItem.id} key={stockItem.id}>{stockItem.name} ({stockItem.unit})</option>)}
                </select></label>
                <label>Quantity<input type="number" min="0.001" step="0.001" required value={item.quantity} onChange={(event) => setPurchaseForm((form) => ({
                  ...form,
                  items: form.items.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: event.target.value } : line),
                }))} /></label>
                <label>Unit cost (GH₵)<input type="number" min="0" step="0.01" required value={item.unit_cost} onChange={(event) => setPurchaseForm((form) => ({
                  ...form,
                  items: form.items.map((line, lineIndex) => lineIndex === index ? { ...line, unit_cost: event.target.value } : line),
                }))} /></label>
                {purchaseForm.items.length > 1 && <button type="button" className="secondary-button" onClick={() => setPurchaseForm((form) => ({ ...form, items: form.items.filter((_, lineIndex) => lineIndex !== index) }))}>Remove item</button>}
              </div>
            ))}
            <div className="feeding-import-actions">
              <button type="button" className="secondary-button" onClick={() => setPurchaseForm((form) => ({ ...form, items: [...form.items, newPurchaseItem()] }))}>Add purchase item</button>
              <strong>Purchase total: {money(purchaseTotal)}</strong>
              <button type="submit" disabled={busy || !stock.length}>{busy ? 'Saving…' : 'Submit market purchase for approval'}</button>
            </div>
          </form>
        )}
        {!canManage && <p className="muted-copy">You have read-only access to the market purchase register.</p>}
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Supplier / buyer</th><th>Items</th><th>Advance</th><th>Total</th><th>Status</th>{canManage && <th>Action</th>}</tr></thead>
          <tbody>{purchases.map((purchase) => (
            <tr key={purchase.id}>
              <td>{String(purchase.purchase_date).slice(0, 10)}</td>
              <td>{purchase.supplier || '—'}<small>{purchase.buyer_name || 'Buyer not recorded'}</small></td>
              <td>{purchase.items.map((item) => `${item.name} × ${item.quantity} ${item.unit}`).join(', ')}</td>
              <td>{purchase.advance_id ? advances.find((advance) => Number(advance.id) === Number(purchase.advance_id))?.recipient_name || `Advance ${purchase.advance_id}` : '—'}</td>
              <td>{money(purchase.total_amount)}</td>
              <td>{purchase.status}</td>
              {canManage && <td>{purchase.status === 'pending' && <button type="button" className="secondary-button" disabled={busy} onClick={() => approvePurchase(purchase)}>Approve &amp; receive stock</button>}</td>}
            </tr>
          ))}</tbody>
        </table></div>
        {!loading && !purchases.length && <p className="empty-state">No market purchases recorded.</p>}
        <h3>Approved market purchases by week</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Week beginning</th><th>Approved purchases</th></tr></thead>
          <tbody>{weeklyTotals.map(([week, total]) => <tr key={week}><td>{week}</td><td>{money(total)}</td></tr>)}</tbody>
        </table></div>
        {!weeklyTotals.length && <p className="empty-state">No approved market purchases to report yet.</p>}
      </section>

      <section className="data-panel">
        <div className="panel-heading"><div><p className="eyebrow">Cash control</p><h2>Market shopping advances</h2></div></div>
        {canManage && (
          <form className="feeding-import-form" onSubmit={submitAdvance}>
            <label>Amount issued (GH₵)<input type="number" min="0.01" step="0.01" required value={advanceForm.amount_issued} onChange={(event) => setAdvanceForm({ ...advanceForm, amount_issued: event.target.value })} /></label>
            <label>Recipient<input required value={advanceForm.recipient_name} onChange={(event) => setAdvanceForm({ ...advanceForm, recipient_name: event.target.value })} /></label>
            <label>Issue date<input type="date" required value={advanceForm.issued_date} onChange={(event) => setAdvanceForm({ ...advanceForm, issued_date: event.target.value })} /></label>
            <label>Purpose<input required value={advanceForm.purpose} onChange={(event) => setAdvanceForm({ ...advanceForm, purpose: event.target.value })} /></label>
            <label>Notes<input value={advanceForm.notes} onChange={(event) => setAdvanceForm({ ...advanceForm, notes: event.target.value })} /></label>
            <button type="submit" disabled={busy}>Issue market advance</button>
          </form>
        )}
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Recipient / purpose</th><th>Issued</th><th>Approved purchases</th><th>Returned</th><th>Unaccounted</th><th>Status</th>{canManage && <th>Reconcile</th>}</tr></thead>
          <tbody>{advances.map((advance) => (
            <tr key={advance.id}>
              <td>{String(advance.issued_date).slice(0, 10)}</td>
              <td>{advance.recipient_name}<small>{advance.purpose.replace(/^Market stock:\s*/, '')}</small></td>
              <td>{money(advance.amount_issued)}</td><td>{money(advance.approved_expenses)}</td>
              <td>{money(advance.returned_amount)}</td><td>{money(advance.unaccounted_amount)}</td>
              <td>{advance.status.replaceAll('_', ' ')}</td>
              {canManage && <td><div className="feeding-import-actions">
                <input aria-label={`Returned amount for market advance ${advance.id}`} type="number" min="0" max={advance.amount_issued} step="0.01" value={returns[advance.id] ?? advance.returned_amount} onChange={(event) => setReturns((values) => ({ ...values, [advance.id]: event.target.value }))} />
                <button type="button" className="secondary-button" disabled={busy || advance.status === 'awaiting_approval'} onClick={() => saveReturn(advance)}>Save</button>
              </div></td>}
            </tr>
          ))}</tbody>
        </table></div>
        {!loading && !advances.length && <p className="empty-state">No market shopping advances recorded.</p>}
      </section>
    </>
  );
}

export default MarketStockOperations;
