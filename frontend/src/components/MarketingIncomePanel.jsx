import { useEffect, useMemo, useState } from 'react';
import { getMarketingIncome, recordMarketingIncome } from '../api/feeding';
import { hasOperationalPermission } from '../utils/operationalPermissions';

const today = () => new Date().toLocaleDateString('en-CA');
const money = (value) => `GH₵${Number(value || 0).toFixed(2)}`;
const newRequestKey = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function MarketingIncomePanel() {
  const [income, setIncome] = useState([]);
  const [form, setForm] = useState({
    income_date: today(),
    academic_year: '',
    term: '',
    amount: '',
    income_source: '',
    description: '',
    payment_method: 'cash',
    reference: '',
  });
  const [requestKey, setRequestKey] = useState(newRequestKey());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  let user;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  const canRead = hasOperationalPermission(user, 'feeding.marketing.read', 'feeding.marketing.manage');
  const canManage = hasOperationalPermission(user, 'feeding.marketing.manage');

  const refresh = async () => {
    const response = await getMarketingIncome();
    setIncome(response.data);
  };

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    getMarketingIncome()
      .then(({ data }) => active && setIncome(data))
      .catch((loadError) => active && setError(loadError.response?.data?.message || 'Unable to load marketing income.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [canRead]);

  const weeklyTotals = useMemo(() => {
    const totals = new Map();
    income.forEach((entry) => {
      const date = new Date(`${String(entry.income_date).slice(0, 10)}T00:00:00Z`);
      const offset = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - offset);
      const week = date.toISOString().slice(0, 10);
      totals.set(week, (totals.get(week) || 0) + Number(entry.amount));
    });
    return [...totals.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [income]);

  const termTotals = useMemo(() => {
    const totals = new Map();
    income.filter((entry) => entry.academic_year && entry.term).forEach((entry) => {
      const label = `${entry.academic_year} · ${entry.term}`;
      totals.set(label, (totals.get(label) || 0) + Number(entry.amount));
    });
    return [...totals.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [income]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await recordMarketingIncome({ ...form, idempotency_key: requestKey });
      await refresh();
      setForm({
        income_date: today(),
        academic_year: '',
        term: '',
        amount: '',
        income_source: '',
        description: '',
        payment_method: 'cash',
        reference: '',
      });
      setRequestKey(newRequestKey());
      setNotice('Marketing income recorded in its separate operational account.');
    } catch (saveError) {
      setError(saveError.response?.data?.message || 'Unable to record marketing income.');
    } finally {
      setBusy(false);
    }
  };

  if (!canRead) return null;

  return (
    <section className="data-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Operational marketing account</p><h2>Record and report marketing income</h2></div>
        <strong>{money(income.reduce((sum, entry) => sum + Number(entry.amount), 0))}</strong>
      </div>
      <p className="muted-copy">These entries are not lunch payments and do not create student balances or appear in Fees/Main Income &amp; Expenditure.</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {canManage && (
        <form className="feeding-import-form" onSubmit={submit}>
          <label>Date<input type="date" required value={form.income_date} onChange={(event) => setForm({ ...form, income_date: event.target.value })} /></label>
          <label>Amount (GH₵)<input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
          <label>Source / activity<input maxLength="120" required value={form.income_source} onChange={(event) => setForm({ ...form, income_source: event.target.value })} placeholder="Market sales, event…" /></label>
          <label>Description<input maxLength="500" required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label>Payment method<select value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })}>
            <option value="cash">Cash</option><option value="mobile_money">Mobile money</option>
            <option value="bank_transfer">Bank transfer</option><option value="other">Other</option>
          </select></label>
          <label>Academic year (required for term totals)<input required={Boolean(form.term)} value={form.academic_year} onChange={(event) => setForm({ ...form, academic_year: event.target.value })} placeholder="2026-2027" /></label>
          <label>Term (optional)<select value={form.term} onChange={(event) => setForm({ ...form, term: event.target.value })}>
            <option value="">Not specified</option><option>Term 1</option><option>Term 2</option><option>Term 3</option>
          </select></label>
          <label>Reference (optional)<input maxLength="120" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></label>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record marketing income'}</button>
        </form>
      )}
      {!canManage && <p className="muted-copy">You have read-only access to the marketing income account.</p>}

      <div className="split-layout">
        <div>
          <h3>Weekly collections</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Week beginning</th><th>Total income</th></tr></thead>
            <tbody>{weeklyTotals.map(([week, total]) => <tr key={week}><td>{week}</td><td>{money(total)}</td></tr>)}</tbody>
          </table></div>
        </div>
        <div>
          <h3>Term totals</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Academic year / term</th><th>Total income</th></tr></thead>
            <tbody>{termTotals.map(([term, total]) => <tr key={term}><td>{term}</td><td>{money(total)}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>
      <h3>Income detail</h3>
      {loading ? <p className="muted-copy">Loading marketing income…</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Source / description</th><th>Term</th><th>Method / reference</th><th>Amount</th><th>Recorded by</th></tr></thead>
          <tbody>{income.map((entry) => (
            <tr key={entry.id}>
              <td>{String(entry.income_date).slice(0, 10)}</td>
              <td>{entry.income_source}<small>{entry.description}</small></td>
              <td>{entry.academic_year && entry.term ? `${entry.academic_year} · ${entry.term}` : '—'}</td>
              <td>{entry.payment_method.replace('_', ' ')}{entry.reference ? ` · ${entry.reference}` : ''}</td>
              <td>{money(entry.amount)}</td>
              <td>{entry.recorded_by_name || '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {!loading && !income.length && <p className="empty-state">No marketing income has been recorded.</p>}
    </section>
  );
}

export default MarketingIncomePanel;
