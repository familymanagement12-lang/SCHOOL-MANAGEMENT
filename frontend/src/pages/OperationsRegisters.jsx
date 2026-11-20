import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createKitchenItem,
  createOperationalFinancialEntry,
  deleteOperationalFinancialEntry,
  exportKitchenItems,
  exportOperationalFinancialRegister,
  getKitchenItems,
  getOperationalFinancialRegister,
  setKitchenItemActive,
  updateKitchenItem,
} from '../api/operations';
import { getInventory, getInventorySuppliers } from '../api/inventory';
import './operations-registers.css';

const currentMonth = new Date().toISOString().slice(0, 7);
const currency = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'GHS' });
const dateLabel = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const today = () => new Date().toISOString().slice(0, 10);
const emptyKitchenItem = {
  item_name: '', category: '', estimated_quantity: '', expected_monthly_quantity: '', unit: '',
  purchasing_frequency: 'weekly', custom_interval_days: '', estimated_unit_cost: '', supplier_id: '',
  inventory_id: '', notes: '',
};
const emptyEntry = {
  transaction_type: 'revenue', transaction_date: today(), amount: '', payment_method: '',
  category: '', description: '', reference: '', academic_year: '', term: '',
};

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function OperationsRegisters() {
  let user = null;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  const isOfficer = user?.role === 'feeding_tuckshop_officer';
  const canManageKitchen = ['admin', 'inventory', 'store', 'storekeeper'].includes(user?.role);
  const canViewKitchen = ['admin', 'accountant', 'inventory', 'store', 'storekeeper', 'feeding_tuckshop_officer'].includes(user?.role);
  const canManageFinance = ['admin', 'accountant'].includes(user?.role);
  const canWriteFinance = ['admin', 'accountant', 'feeding_tuckshop_officer'].includes(user?.role);
  const [section, setSection] = useState(isOfficer ? 'feeding' : 'kitchen');
  const [module, setModule] = useState(isOfficer ? 'feeding_marketing' : 'tuckshop');
  const [periodMode, setPeriodMode] = useState('month');
  const [month, setMonth] = useState(currentMonth);
  const [from, setFrom] = useState(`${currentMonth}-01`);
  const [to, setTo] = useState(today());
  const [academicYear, setAcademicYear] = useState('');
  const [term, setTerm] = useState('');
  const [selectedWeek, setSelectedWeek] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [frequencyFilter, setFrequencyFilter] = useState('');
  const [search, setSearch] = useState('');
  const [kitchenItems, setKitchenItems] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [kitchenForm, setKitchenForm] = useState(emptyKitchenItem);
  const [editingKitchenItem, setEditingKitchenItem] = useState(null);
  const [financialData, setFinancialData] = useState({ entries: [], report: null });
  const [entryForm, setEntryForm] = useState(emptyEntry);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const periodParams = useMemo(() => (periodMode === 'month'
    ? { month }
    : { from, to }), [periodMode, month, from, to]);

  const loadKitchenItems = async () => {
    const response = await getKitchenItems({
      ...periodParams,
      category: categoryFilter || undefined,
      frequency: frequencyFilter || undefined,
      search: search || undefined,
      include_inactive: 'true',
    });
    setKitchenItems(response.data);
  };

  const loadFinancialData = async () => {
    const response = await getOperationalFinancialRegister({
      module,
      ...periodParams,
      academic_year: academicYear || undefined,
      term: term || undefined,
    });
    setFinancialData(response.data);
  };

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const requests = [];
      if (canViewKitchen) requests.push(loadKitchenItems());
      else setKitchenItems([]);
      if (canWriteFinance) requests.push(loadFinancialData());
      else setFinancialData({ entries: [], report: null });
      await Promise.all(requests);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load the operations registers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [periodParams, categoryFilter, frequencyFilter, search, module, academicYear, term]);

  useEffect(() => {
    if (!canManageKitchen) return;
    Promise.all([getInventory(), getInventorySuppliers()])
      .then(([inventoryResponse, supplierResponse]) => {
        setInventory(inventoryResponse.data.filter((item) => item.item_status === 'active' && item.item_type !== 'asset'));
        setSuppliers(supplierResponse.data.filter((supplier) => supplier.is_active));
      })
      .catch(() => {});
  }, [canManageKitchen]);

  const run = async (action, successMessage) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice(successMessage);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'The operation could not be completed.');
    } finally {
      setSaving(false);
    }
  };

  const saveKitchen = (event) => {
    event.preventDefault();
    const payload = {
      ...kitchenForm,
      estimated_quantity: Number(kitchenForm.estimated_quantity),
      expected_monthly_quantity: kitchenForm.expected_monthly_quantity ? Number(kitchenForm.expected_monthly_quantity) : null,
      estimated_unit_cost: Number(kitchenForm.estimated_unit_cost),
      custom_interval_days: kitchenForm.custom_interval_days ? Number(kitchenForm.custom_interval_days) : null,
      supplier_id: kitchenForm.supplier_id || null,
      inventory_id: kitchenForm.inventory_id || null,
    };
    run(async () => {
      if (editingKitchenItem) await updateKitchenItem(editingKitchenItem, payload);
      else await createKitchenItem(payload);
      setKitchenForm(emptyKitchenItem);
      setEditingKitchenItem(null);
    }, editingKitchenItem ? 'Kitchen plan updated.' : 'Kitchen item added to the plan.');
  };

  const editKitchen = (item) => {
    setEditingKitchenItem(item.id);
    setKitchenForm({
      item_name: item.item_name,
      category: item.category,
      estimated_quantity: String(item.estimated_quantity),
      expected_monthly_quantity: item.expected_monthly_quantity ? String(item.expected_monthly_quantity) : '',
      unit: item.unit,
      purchasing_frequency: item.purchasing_frequency,
      custom_interval_days: item.custom_interval_days ? String(item.custom_interval_days) : '',
      estimated_unit_cost: String(item.estimated_unit_cost),
      supplier_id: item.supplier_id ? String(item.supplier_id) : '',
      inventory_id: item.inventory_id ? String(item.inventory_id) : '',
      notes: item.notes || '',
    });
  };

  const submitEntry = (event) => {
    event.preventDefault();
    run(async () => {
      await createOperationalFinancialEntry({
        ...entryForm,
        module,
        amount: Number(entryForm.amount),
        academic_year: academicYear || entryForm.academic_year,
        term: term || entryForm.term,
      });
      setEntryForm({ ...emptyEntry, transaction_date: today() });
    }, 'Daily entry recorded.');
  };

  const exportKitchen = async () => {
    try {
      const response = await exportKitchenItems({
        ...periodParams,
        category: categoryFilter || undefined,
        frequency: frequencyFilter || undefined,
        search: search || undefined,
        include_inactive: 'true',
      });
      saveBlob(response.data, `kitchen-register-${month}.xlsx`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Kitchen register export failed.');
    }
  };

  const exportFinance = async () => {
    try {
      const response = await exportOperationalFinancialRegister({
        module, ...periodParams, academic_year: academicYear || undefined, term: term || undefined,
      });
      saveBlob(response.data, `${module.replaceAll('_', '-')}-register.xlsx`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Financial register export failed.');
    }
  };

  const categories = [...new Set(kitchenItems.map((item) => item.category))].sort();
  const weeks = financialData.report?.weeks || [];
  const entries = selectedWeek
    ? financialData.entries.filter((entry) => entry.week_start === selectedWeek)
    : financialData.entries;
  const report = financialData.report;

  return (
    <div className="page module-page operations-registers">
      <section className="module-hero">
        <div>
          <p className="eyebrow">Market Stock - Kitchen Register</p>
          <h1>Market Stock, Tuckshop & Feeding</h1>
          <p>Plan kitchen purchasing and record daily tuckshop or feeding-marketing activity.</p>
        </div>
      </section>

      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="success" role="status">{notice}</div>}

      <div className="inventory-tabs" role="tablist" aria-label="Operations registers">
        {canViewKitchen && <button type="button" className={section === 'kitchen' ? 'active' : ''} onClick={() => setSection('kitchen')}>Market Stock</button>}
        {(canManageFinance || isOfficer) && <button type="button" className={section === 'tuckshop' ? 'active' : ''} onClick={() => { setSection('tuckshop'); setModule('tuckshop'); }}>Tuckshop & purchases</button>}
        {canWriteFinance && <button type="button" className={section === 'feeding' ? 'active' : ''} onClick={() => { setSection('feeding'); setModule('feeding_marketing'); }}>Feeding & marketing</button>}
      </div>

      <section className="data-panel operations-period">
        <div className="operations-period-grid">
          <label>Reporting period<select value={periodMode} onChange={(event) => setPeriodMode(event.target.value)}><option value="month">Month</option><option value="custom">Custom date range</option></select></label>
          {periodMode === 'month' ? <label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label> : <>
            <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </>}
          <label>Academic year<input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="e.g. 2026/2027" /></label>
          <label>Term<input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="e.g. First Term" /></label>
        </div>
      </section>

      {loading ? <div className="page"><p>Loading registers...</p></div> : <>
        {section === 'kitchen' && <>
          <section className="module-stats">
            <div className="mini-stat"><span>Estimated weekly budget</span><strong>{currency(kitchenItems.filter((item) => item.is_active).reduce((sum, item) => sum + Number(item.estimated_weekly_cost || 0), 0))}</strong></div>
            <div className="mini-stat"><span>Estimated monthly budget</span><strong>{currency(kitchenItems.filter((item) => item.is_active).reduce((sum, item) => sum + Number(item.estimated_monthly_cost || 0), 0))}</strong></div>
            <div className="mini-stat"><span>Actual expenditure - period</span><strong>{currency(kitchenItems.reduce((sum, item) => sum + Number(item.actual_cost || 0), 0))}</strong></div>
            <div className="mini-stat"><span>Pending approval - linked purchases</span><strong>{currency(kitchenItems.reduce((sum, item) => sum + Number(item.pending_approval_cost || 0), 0))}</strong></div>
          </section>

          <section className="data-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Planning register</p><h2>Kitchen items</h2></div>
              <div className="inventory-actions">
                <button className="btn-secondary" onClick={exportKitchen}>Export Excel</button>
                <button className="btn-secondary" onClick={() => window.print()}>Print</button>
                {canManageKitchen && <Link className="btn-secondary" to="/inventory">Purchase register</Link>}
              </div>
            </div>
            <div className="inventory-actions">
              <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Item or note" /></label>
              <label>Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Frequency<select value={frequencyFilter} onChange={(event) => setFrequencyFilter(event.target.value)}><option value="">All frequencies</option>{['daily', 'weekly', 'fortnightly', 'monthly', 'custom'].map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}</select></label>
            </div>
            <div className="table-wrap"><table><thead><tr><th>Item / category</th><th>Plan</th><th>Estimated unit</th><th>Unit variance - period</th><th>Estimated weekly</th><th>Actual weekly</th><th>Weekly variance</th><th>Estimated monthly</th><th>Actual monthly</th><th>Monthly variance</th><th>Estimated period quantity</th><th>Actual period quantity</th><th>Quantity variance</th><th>Estimated period cost</th><th>Actual period cost</th><th>Period cost variance</th><th>Purchases / status</th>{canManageKitchen && <th />}</tr></thead><tbody>
              {kitchenItems.map((item) => <tr key={item.id}>
                <td><strong>{item.item_name}</strong><div>{item.category} - {item.supplier_name || 'No supplier'}</div>{item.notes && <small>{item.notes}</small>}</td>
                <td>{item.estimated_quantity} {item.unit} - {item.purchasing_frequency}{item.custom_interval_days ? ` / ${item.custom_interval_days} days` : ''}</td>
                <td>{currency(item.estimated_unit_cost)}<div>Actual {currency(item.actual_unit_cost)}</div></td>
                <td>{currency(item.unit_cost_variance)}{item.unit_cost_variance_percent !== null && <div>{item.unit_cost_variance_percent}%</div>}</td>
                <td>{currency(item.estimated_weekly_cost)}</td>
                <td>{currency(item.actual_weekly_cost)}</td>
                <td>{currency(item.weekly_variance)}{item.weekly_variance_percent !== null && <div>{item.weekly_variance_percent}%</div>}</td>
                <td>{currency(item.estimated_monthly_cost)}</td>
                <td>{currency(item.actual_monthly_cost)}</td>
                <td>{currency(item.monthly_variance)}{item.monthly_variance_percent !== null && <div>{item.monthly_variance_percent}%</div>}</td>
                <td>{item.estimated_period_quantity} {item.unit}</td>
                <td>{item.actual_quantity} {item.unit}</td>
                <td>{item.quantity_variance} {item.unit}{item.quantity_variance_percent !== null && <div>{item.quantity_variance_percent}%</div>}</td>
                <td>{currency(item.estimated_period_cost)}</td>
                <td>{currency(item.actual_cost)}</td>
                <td>{currency(item.actual_unit_cost)}</td>
                <td>{currency(item.actual_variance)}{item.actual_variance_percent !== null && <div>{item.actual_variance_percent}%</div>}</td>
                <td>{item.pending_approval_quantity} pending - {item.approved_purchase_quantity} approved<div>{item.approved_outstanding_quantity} to receive</div></td>
                {canManageKitchen && <td><div className="inventory-actions"><button className="btn-small btn-edit" onClick={() => editKitchen(item)}>Edit</button><button className="btn-small btn-secondary" onClick={() => run(() => setKitchenItemActive(item.id, !item.is_active), `Kitchen item ${item.is_active ? 'deactivated' : 'activated'}.`)}>{item.is_active ? 'Deactivate' : 'Activate'}</button></div></td>}
              </tr>)}
            </tbody></table></div>
            {!kitchenItems.length && <p className="empty-state">No kitchen items match this filter.</p>}
          </section>

          {canManageKitchen && <form className="data-panel form-panel" onSubmit={saveKitchen}>
            <div className="panel-heading"><div><p className="eyebrow">Planning only</p><h2>{editingKitchenItem ? 'Edit kitchen item' : 'Add kitchen item'}</h2></div></div>
            <div className="operations-period-grid">
              <label>Item name *<input required maxLength="160" value={kitchenForm.item_name} onChange={(event) => setKitchenForm({ ...kitchenForm, item_name: event.target.value })} /></label>
              <label>Category *<input required maxLength="100" value={kitchenForm.category} onChange={(event) => setKitchenForm({ ...kitchenForm, category: event.target.value })} placeholder="Produce, protein, dry goods..." /></label>
              <label>Estimated quantity per purchase *<input required type="number" min="0.001" step="0.001" value={kitchenForm.estimated_quantity} onChange={(event) => setKitchenForm({ ...kitchenForm, estimated_quantity: event.target.value })} /></label>
              <label>Expected monthly quantity<input type="number" min="0.001" step="0.001" value={kitchenForm.expected_monthly_quantity} onChange={(event) => setKitchenForm({ ...kitchenForm, expected_monthly_quantity: event.target.value })} /></label>
              <label>Unit *<input required maxLength="40" value={kitchenForm.unit} onChange={(event) => setKitchenForm({ ...kitchenForm, unit: event.target.value })} placeholder="Bags, crates, kg..." /></label>
              <label>Purchasing frequency *<select value={kitchenForm.purchasing_frequency} onChange={(event) => setKitchenForm({ ...kitchenForm, purchasing_frequency: event.target.value })}>{['daily', 'weekly', 'fortnightly', 'monthly', 'custom'].map((frequency) => <option key={frequency}>{frequency}</option>)}</select></label>
              {kitchenForm.purchasing_frequency === 'custom' && <label>Custom interval in days *<input required type="number" min="1" max="365" step="1" value={kitchenForm.custom_interval_days} onChange={(event) => setKitchenForm({ ...kitchenForm, custom_interval_days: event.target.value })} /></label>}
              <label>Estimated unit cost *<input required type="number" min="0" step="0.01" value={kitchenForm.estimated_unit_cost} onChange={(event) => setKitchenForm({ ...kitchenForm, estimated_unit_cost: event.target.value })} /></label>
              <label>Supplier<select value={kitchenForm.supplier_id} onChange={(event) => setKitchenForm({ ...kitchenForm, supplier_id: event.target.value })}><option value="">Not specified</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Inventory item link<select value={kitchenForm.inventory_id} onChange={(event) => setKitchenForm({ ...kitchenForm, inventory_id: event.target.value })}><option value="">Link when purchasing</option>{inventory.map((item) => <option key={item.id} value={item.id}>{item.item_name} - {item.unit}</option>)}</select></label>
              <label className="operations-notes">Notes<input maxLength="1000" value={kitchenForm.notes} onChange={(event) => setKitchenForm({ ...kitchenForm, notes: event.target.value })} /></label>
            </div>
            <div className="inventory-actions"><button className="btn-primary" disabled={saving}>{editingKitchenItem ? 'Save plan' : 'Add item'}</button>{editingKitchenItem && <button type="button" className="btn-secondary" onClick={() => { setEditingKitchenItem(null); setKitchenForm(emptyKitchenItem); }}>Cancel</button>}</div>
            <p>Plans are estimates only. They do not create an order, stock movement, or expense.</p>
          </form>}
        </>}

        {section !== 'kitchen' && <>
          <div className="operations-register-heading">
            <div><p className="eyebrow">{module === 'tuckshop' ? 'Tuckshop & Purchases' : 'Feeding & Marketing'}</p><h2>{module === 'tuckshop' ? 'Weekly income and expenses' : 'Weekly revenue and expense register'}</h2></div>
            <div className="inventory-actions"><button className="btn-secondary" onClick={exportFinance}>Export Excel</button><button className="btn-secondary" onClick={() => window.print()}>Print</button></div>
          </div>

          <section className="module-stats">
            <div className="mini-stat"><span>Total revenue</span><strong>{currency(report?.total_revenue)}</strong></div>
            <div className="mini-stat"><span>Total expenses</span><strong>{currency(report?.total_expenses)}</strong></div>
            <div className="mini-stat"><span>Net balance</span><strong>{currency(report?.net_balance)}</strong></div>
            <div className="mini-stat"><span>Daily average - revenue</span><strong>{currency(report?.average_daily_revenue)}</strong></div>
            <div className="mini-stat"><span>Daily average - expenses</span><strong>{currency(report?.average_daily_expenses)}</strong></div>
          </section>

          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Week starts Monday - other-day records retained</p><h2>{weeks.length} calendar weeks</h2></div>
              <label>Show detail for<select value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)}><option value="">All weeks</option>{weeks.map((week) => <option key={week.week_start} value={week.week_start}>{dateLabel(week.week_start)} to {dateLabel(week.week_end)}</option>)}</select></label>
            </div>
            <div className="table-wrap"><table className="weekly-register-table"><thead><tr><th>Week</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Other days</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Revenue change</th><th>Expense change</th><th>Net change</th></tr></thead><tbody>
              {weeks.map((week, index) => <tr key={week.week_start} onClick={() => setSelectedWeek(selectedWeek === week.week_start ? '' : week.week_start)}>
                <td><strong>Week {index + 1}</strong><div>{dateLabel(week.week_start)} to {dateLabel(week.week_end)}</div></td>
                {week.weekdays.map((day) => <td key={day.day}>{currency(day.revenue)}<div className="register-expense">{currency(day.expenses)}</div></td>)}
                <td>{currency(week.other_days_revenue)}<div className="register-expense">{currency(week.other_days_expenses)}</div></td>
                <td>{currency(week.revenue)}</td><td>{currency(week.expenses)}</td><td>{currency(week.net_balance)}</td>
                <td>{week.revenue_change_from_previous === null ? '-' : currency(week.revenue_change_from_previous)}</td>
                <td>{week.expense_change_from_previous === null ? '-' : currency(week.expense_change_from_previous)}</td>
                <td>{week.change_from_previous === null ? '-' : currency(week.change_from_previous)}</td>
              </tr>)}
              <tr className="weekly-register-total"><th>Period total</th>{report?.weekday_totals?.map((day) => <th key={day.day}>{currency(day.revenue)}<div className="register-expense">{currency(day.expenses)}</div></th>)}<th>{currency((report?.total_revenue || 0) - (report?.weekday_revenue_total || 0))}<div className="register-expense">{currency((report?.total_expenses || 0) - (report?.weekday_expense_total || 0))}</div></th><th>{currency(report?.total_revenue)}</th><th>{currency(report?.total_expenses)}</th><th>{currency(report?.net_balance)}</th><th>-</th><th>-</th><th>-</th></tr>
            </tbody></table></div>
            {!weeks.length && <p className="empty-state">No weeks in this period.</p>}
          </section>

          {canWriteFinance && <form className="data-panel form-panel" onSubmit={submitEntry}>
            <div className="panel-heading"><div><p className="eyebrow">Daily records - multiple entries per date</p><h2>Record revenue or expense</h2></div></div>
            <div className="operations-period-grid">
              <label>Type *<select value={entryForm.transaction_type} onChange={(event) => setEntryForm({ ...entryForm, transaction_type: event.target.value })}><option value="revenue">Revenue</option><option value="expense">Expense</option></select></label>
              <label>Date *<input required type="date" value={entryForm.transaction_date} onChange={(event) => setEntryForm({ ...entryForm, transaction_date: event.target.value })} /></label>
              <label>Amount (GHS) *<input required type="number" min="0.01" step="0.01" value={entryForm.amount} onChange={(event) => setEntryForm({ ...entryForm, amount: event.target.value })} /></label>
              {entryForm.transaction_type === 'revenue' && <label>Payment method<select value={entryForm.payment_method} onChange={(event) => setEntryForm({ ...entryForm, payment_method: event.target.value })}><option value="">Not recorded</option><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>}
              <label>{entryForm.transaction_type === 'expense' ? 'Expense category' : 'Revenue category'}<input maxLength="100" value={entryForm.category} onChange={(event) => setEntryForm({ ...entryForm, category: event.target.value })} placeholder={entryForm.transaction_type === 'expense' ? 'Gas, transport, market purchases...' : 'Daily sales'} /></label>
              <label>Description / notes *<input required maxLength="1000" value={entryForm.description} onChange={(event) => setEntryForm({ ...entryForm, description: event.target.value })} placeholder={entryForm.transaction_type === 'expense' ? 'Describe this expense' : 'Daily sales summary'} /></label>
              <label>Reference<input maxLength="120" value={entryForm.reference} onChange={(event) => setEntryForm({ ...entryForm, reference: event.target.value })} /></label>
              {!academicYear && <label>Academic year<input maxLength="40" value={entryForm.academic_year} onChange={(event) => setEntryForm({ ...entryForm, academic_year: event.target.value })} placeholder="e.g. 2026/2027" /></label>}
              {!term && <label>Term<input maxLength="80" value={entryForm.term} onChange={(event) => setEntryForm({ ...entryForm, term: event.target.value })} placeholder="e.g. First Term" /></label>}
            </div>
            <button className="btn-primary" disabled={saving}>Record entry</button>
          </form>}

          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Descriptions retained</p><h2>Daily detail - {entries.length} records</h2></div></div>
            <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Description</th><th>Category</th><th>Method / reference</th><th>Recorded by</th>{canManageFinance && <th />}</tr></thead><tbody>
              {entries.map((entry) => <tr key={entry.id}><td>{dateLabel(entry.transaction_date)}</td><td>{entry.transaction_type}</td><td>{currency(entry.amount)}</td><td>{entry.description}</td><td>{entry.category || '-'}</td><td>{entry.payment_method || '-'}{entry.reference && <div>{entry.reference}</div>}</td><td>{entry.recorded_by_name || '-'}</td>{canManageFinance && <td><button className="btn-small btn-delete" onClick={() => {
                if (window.confirm('Delete this register entry?')) run(() => deleteOperationalFinancialEntry(module, entry.id), 'Register entry deleted.');
              }}>Delete</button></td>}</tr>)}
            </tbody></table></div>
            {!entries.length && <p className="empty-state">No daily entries recorded for this period.</p>}
          </section>
        </>}
      </>}
    </div>
  );
}

export default OperationsRegisters;