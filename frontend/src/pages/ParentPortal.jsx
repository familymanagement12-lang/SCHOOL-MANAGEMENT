import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import {
  Bell, BookOpenCheck, CalendarDays, ClipboardCheck, GraduationCap,
  LayoutDashboard, LogOut, Menu, Megaphone, UserRound, WalletCards, X,
} from 'lucide-react';
import api from '../api/api';
import { changePassword } from '../api/users';
import {
  getParentCurriculumSelections,
  requestParentCurriculumChange,
  submitParentCurriculumSelection,
} from '../api/curriculumSelections';

const ParentContext = createContext(null);
const navItems = [
  { to: '/parent', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/parent/curriculum', label: 'Curriculum selection', icon: GraduationCap },
  { to: '/parent/fees', label: 'School fees', icon: WalletCards },
  { to: '/parent/feeding', label: 'Feeding account', icon: BookOpenCheck },
  { to: '/parent/results', label: 'Academic results', icon: GraduationCap },
  { to: '/parent/attendance', label: 'Attendance', icon: ClipboardCheck },
  { to: '/parent/timetable', label: 'Timetable', icon: CalendarDays },
  { to: '/parent/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/parent/notifications', label: 'Notifications', icon: Bell },
  { to: '/parent/profile', label: 'My account', icon: UserRound },
];

function useParentChild() {
  return useContext(ParentContext);
}

function useParentResource(path, initialValue) {
  const [data, setData] = useState(initialValue);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!path) {
      setLoading(false);
      return () => { active = false; };
    }
    setData(initialValue);
    setLoading(true);
    setError('');
    api.get(path).then((response) => {
      if (active) setData(response.data);
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || 'Unable to load this information.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [path]);
  return { data, loading, error };
}

const money = (value, currency = 'GHS') => new Intl.NumberFormat(undefined, {
  style: 'currency', currency: currency || 'GHS', maximumFractionDigits: 2,
}).format(Number(value || 0));

function ParentPage({ title, description, children }) {
  return <div className="parent-page">
    <header className="parent-page-heading"><div><p className="eyebrow">Parent Portal</p><h1>{title}</h1><p>{description}</p></div></header>
    {children}
  </div>;
}

function LoadingPanel({ loading, error, children }) {
  if (loading) return <div className="parent-panel" role="status">Loading your information…</div>;
  if (error) return <div className="parent-error" role="alert">{error}</div>;
  return children;
}

function Stat({ label, value, note, variant = '' }) {
  return <article className={`parent-stat ${variant}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}

function ChildRequired({ children }) {
  const context = useParentChild();
  if (!context?.selectedChild) {
    return <ParentPage title="Select a child" description="Your account does not currently have an active child link. Please contact the school office.">
      <div className="parent-panel">School staff must create and approve family links before a child's private information is available here.</div>
    </ParentPage>;
  }
  return children;
}

function useChildResource(section, initialValue) {
  const { selectedChild } = useParentChild();
  return useParentResource(
    selectedChild ? `/parent-portal/children/${selectedChild.id}/${section}` : null,
    initialValue,
  );
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function printReceipt() {
  const cleanup = () => document.body.classList.remove('print-parent-receipt');
  document.body.classList.add('print-parent-receipt');
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

export function ParentPortalLayout() {
  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  }, []);
  const navigate = useNavigate();
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(localStorage.getItem('parent_selected_child') || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let active = true;
    api.get('/parent-portal/children').then((response) => {
      if (!active) return;
      setChildren(response.data);
      const current = response.data.find((child) => String(child.id) === selectedChildId);
      const next = current ? String(current.id) : String(response.data[0]?.id || '');
      setSelectedChildId(next);
      if (next) localStorage.setItem('parent_selected_child', next);
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || 'Unable to load your linked children.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const selectedChild = children.find((child) => String(child.id) === selectedChildId) || null;
  const selectChildById = (id) => {
    const value = String(id || '');
    setSelectedChildId(value);
    if (value) localStorage.setItem('parent_selected_child', value);
  };
  const selectChild = (event) => {
    selectChildById(event.target.value);
  };
  const logout = () => {
    localStorage.removeItem('sms_token');
    localStorage.removeItem('user');
    localStorage.removeItem('parent_selected_child');
    navigate('/login');
  };
  if (user?.role !== 'parent') return <Navigate to="/" replace />;

  return <ParentContext.Provider value={{ children, selectedChild, loading, error, selectChildById }}>
    <div className="parent-shell">
      {mobileOpen && <button className="parent-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`parent-sidebar${mobileOpen ? ' is-open' : ''}`}>
        <div className="parent-brand"><img src="/mccarthy-hill-school.svg" alt="" /><div><strong>McCarthy Hill</strong><span>Parent Portal</span></div>
          <button className="parent-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        </div>
        <div className="parent-user"><span>{user?.name?.slice(0, 1)?.toUpperCase() || 'P'}</span><div><strong>{user?.name || 'Parent'}</strong><small>Family account</small></div></div>
        <nav className="parent-nav" aria-label="Parent navigation">
          {navItems.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `parent-nav-link${isActive ? ' active' : ''}`}
            onClick={() => setMobileOpen(false)}><Icon size={18} /><span>{label}</span></NavLink>)}
        </nav>
        <button className="parent-logout" onClick={logout}><LogOut size={18} /> Log out</button>
      </aside>
      <div className="parent-content">
        <header className="parent-topbar">
          <div className="parent-topbar-title"><button className="parent-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <div><small>Good to see you</small><strong>{user?.name || 'Parent'}</strong></div>
          </div>
          <label className="parent-child-select"><span>Viewing child</span>
            <select value={selectedChildId} onChange={selectChild} disabled={loading || !children.length} aria-label="Select a child">
              {!children.length && <option value="">No linked children</option>}
              {children.map((child) => <option key={child.id} value={child.id}>{child.name} · {child.class_name || 'No class'}</option>)}
            </select>
          </label>
        </header>
        <main className="parent-main">
          {error && <div className="parent-error" role="alert">{error}</div>}
          {loading ? <div className="parent-panel" role="status">Loading linked children…</div> : <Outlet />}
        </main>
      </div>
    </div>
  </ParentContext.Provider>;
}

export function ParentDashboard() {
  const { selectChildById } = useParentChild();
  const { data, loading, error } = useParentResource('/parent-portal/dashboard', { children: [], announcements: [], recent_payments: [] });
  const { data: notifications, loading: notificationsLoading, error: notificationsError } = useParentResource('/notifications', []);
  const currency = data.children[0]?.currency || 'GHS';
  let parentName = 'Parent';
  try { parentName = JSON.parse(localStorage.getItem('user') || '{}').name || parentName; } catch { /* use generic greeting */ }
  return <ParentPage title={`Welcome, ${parentName}`}
    description="A clear overview of your children's school life and accounts.">
    <LoadingPanel loading={loading} error={error}>
      {!data.children.length ? <div className="parent-panel"><h2>No children linked yet</h2><p>Contact the school office to link your child to this account.</p></div> : <>
        <section className="parent-stats">
          <Stat label="Linked children" value={data.children.length} note="Approved school links" />
          <Stat label="School fees due" value={money(data.children.reduce((sum, child) => sum + Number(child.fees_outstanding), 0), currency)} note="Across all linked children" />
          <Stat label="Feeding due" value={money(data.children.reduce((sum, child) => sum + Math.max(0, Number(child.feeding_due) - Number(child.feeding_paid)), 0), currency)} note="Separate from school fees" />
          <Stat label="Unread notifications" value={notificationsLoading ? '…' : notificationsError ? 'Unavailable' : notifications.filter((item) => !item.is_read).length} note={<Link to="/parent/notifications">Open notification centre</Link>} />
        </section>
        <section className="parent-child-cards" aria-label="Linked children">
          {data.children.map((child) => {
            const percent = child.attendance_total ? Math.round((child.attendance_present / child.attendance_total) * 100) : 0;
            return <article className="parent-child-card" key={child.id}>
              <div className="parent-child-avatar">{child.name.slice(0, 1).toUpperCase()}</div>
              <div className="parent-child-title"><div><h2>{child.name}</h2><p>{child.class_name || 'Class not assigned'}</p></div><span className="parent-admission">ID {child.admission_number}</span></div>
              <div className="parent-child-metrics">
                <div><small>Academic year</small><strong>{child.academic_year || 'Not set'} · {child.current_term || 'No term'}</strong></div>
                <div><small>Attendance</small><strong>{percent}%</strong></div>
                <div><small>School fee balance</small><strong>{money(child.fees_outstanding, currency)}</strong></div>
                <div><small>Feeding balance</small><strong>{money(Math.max(0, Number(child.feeding_due) - Number(child.feeding_paid)), currency)}</strong></div>
                <div><small>Latest published result</small><strong>{child.latest_term ? `${child.latest_score}% · ${child.latest_term}` : 'Not published'}</strong></div>
              </div>
              <div className="parent-child-actions">
                <Link to="/parent/fees" onClick={() => selectChildById(child.id)}>Fees</Link>
                <Link to="/parent/feeding" onClick={() => selectChildById(child.id)}>Feeding</Link>
                <Link to="/parent/results" onClick={() => selectChildById(child.id)}>Results</Link>
              </div>
            </article>;
          })}
        </section>
        <section className="parent-panel"><div className="parent-panel-heading"><div><p className="eyebrow">For your family</p><h2>Recent announcements</h2></div><Link to="/parent/announcements">See all</Link></div>
          {data.announcements.length ? data.announcements.map((item) => <article className="parent-announcement" key={item.id}><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()}</small></article>) : <p className="parent-empty">No recent announcements.</p>}
        </section>
        <section className="parent-panel"><div className="parent-panel-heading"><div><p className="eyebrow">School account</p><h2>Recent payment activity</h2></div><Link to="/parent/fees">View fee details</Link></div>
          {data.recent_payments.length ? data.recent_payments.map((payment) => <article className="parent-announcement" key={payment.id}><strong>{payment.student_name} · {payment.receipt_number}</strong>
            <p>{payment.payment_date} · {payment.payment_method} · {money(payment.amount_total, currency)}</p>
            <small>School fees {money(payment.school_fee_amount, currency)} · Feeding {money(payment.feeding_amount, currency)}</small>
          </article>) : <p className="parent-empty">No recorded payments yet.</p>}
        </section>
        <div className="parent-note">School events, published homework and examination schedules will appear here when those modules are available to families.</div>
      </>}
    </LoadingPanel>
  </ParentPage>;
}

function CurriculumSelectionCard({ child, academicYear, period, onRefresh }) {
  const [curriculum, setCurriculum] = useState(child.curriculum === 'GES' ? 'PEARSON' : 'GES');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const periodOpen = Boolean(period?.enabled
    && Date.now() >= Date.parse(period.opens_at)
    && Date.now() <= Date.parse(period.deadline));
  const activeSelection = child.selection_id && child.status !== 'rejected';
  const activeChange = child.request_type === 'change_request'
    && ['pending_approval', 'approved_pending_class'].includes(child.status);
  const initialEligible = Number(child.year_level) === 6 && child.curriculum === 'COMMON';
  const hasPathway = ['GES', 'PEARSON'].includes(child.curriculum);
  const selectedLabel = curriculum === 'GES' ? 'GES - JHS 1 to JHS 3' : 'Pearson - Year 7 to Year 11';

  const submit = async (changeRequest) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (changeRequest) {
        await requestParentCurriculumChange(child.student_id, { curriculum, reason });
        setMessage('Your pathway change request was sent to the school for review.');
      } else {
        await submitParentCurriculumSelection(child.student_id, { curriculum, reason });
        setMessage('Your pathway selection was sent to the school for approval.');
      }
      setReason('');
      await onRefresh();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to submit your curriculum request.');
    } finally {
      setSaving(false);
    }
  };

  return <article className="parent-panel parent-curriculum-card">
    <div className="parent-panel-heading">
      <div><h2>{child.name}</h2><p>ID {child.admission_number} · {child.class_name || 'Class not assigned'}</p></div>
      <span className="parent-admission">{academicYear || child.academic_year || 'Academic year not set'}</span>
    </div>
    <div className="parent-curriculum-pathways">
      <div><strong>GES</strong><span>JHS 1 to JHS 3</span></div>
      <div><strong>Pearson</strong><span>Year 7 to Year 11</span></div>
    </div>

    {initialEligible && <>
      {activeSelection ? <div className="parent-curriculum-status">
        <strong>Pathway request: {child.selected_curriculum === 'GES' ? 'GES - JHS 1 to JHS 3' : 'Pearson - Year 7 to Year 11'}</strong>
        <span className={`parent-request-status ${child.status}`}>{child.status.replace(/_/g, ' ')}</span>
        {child.status === 'approved_pending_class' && <p>The school has approved the pathway. An administrator will assign the matching class.</p>}
        {child.status === 'assigned' && <p>Assigned class: {child.assigned_class_name || 'Class details unavailable'}</p>}
      </div> : <div className="parent-form parent-curriculum-form">
        {child.status === 'rejected' && <div className="parent-error"><strong>Previous request declined:</strong> {child.rejection_reason || 'Please contact the school office for details.'}</div>}
        {!periodOpen && <p className="parent-note">Curriculum selections are not open. Contact the school office if you need help.</p>}
        {periodOpen && <>
          <label>Choose a pathway
            <select value={curriculum} onChange={(event) => setCurriculum(event.target.value)}>
              <option value="GES">GES - JHS 1 to JHS 3</option>
              <option value="PEARSON">Pearson - Year 7 to Year 11</option>
            </select>
          </label>
          <label>Optional note for the school
            <textarea value={reason} maxLength={1000} rows={3}
              onChange={(event) => setReason(event.target.value)} />
          </label>
          <p className="parent-note">This submits a request for school approval. It does not choose a class section or change your child's current class.</p>
          <button className="parent-button primary" type="button" disabled={saving}
            onClick={() => submit(false)}>{saving ? 'Submitting…' : `Request ${selectedLabel}`}</button>
        </>}
      </div>}
    </>}

    {hasPathway && !initialEligible && <div className="parent-form parent-curriculum-form">
      {activeChange ? <div className="parent-curriculum-status">
        <strong>Pathway change request: {child.selected_curriculum === 'GES' ? 'GES' : 'Pearson'}</strong>
        <span className={`parent-request-status ${child.status}`}>{child.status.replace(/_/g, ' ')}</span>
        {child.status === 'approved_pending_class' && <p>The school has approved the change. An administrator will assign a matching class at the current stage.</p>}
      </div> : <>
        <h3>Request a pathway change</h3>
        <label>Requested pathway
          <select value={curriculum} onChange={(event) => setCurriculum(event.target.value)}>
            <option value="GES" disabled={child.curriculum === 'GES'}>GES - JHS 1 to JHS 3</option>
            <option value="PEARSON" disabled={child.curriculum === 'PEARSON'}>Pearson - Year 7 to Year 11</option>
          </select>
        </label>
        <label>Reason for the change
          <textarea value={reason} maxLength={1000} rows={3}
            onChange={(event) => setReason(event.target.value)} />
        </label>
        <p className="parent-note">The school must review this request and assign any new class. Your child's records are not changed when you submit it.</p>
        <button className="parent-button primary" type="button" disabled={saving || reason.trim().length < 10}
          onClick={() => submit(true)}>{saving ? 'Submitting…' : 'Request pathway change'}</button>
      </>}
    </div>}
    {error && <p className="parent-error" role="alert">{error}</p>}
    {message && <p className="parent-success" role="status">{message}</p>}
  </article>;
}

export function ParentCurriculumSelection() {
  const [data, setData] = useState({ children: [], selection_period: null, academic_year: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getParentCurriculumSelections().then((response) => {
      if (active) setData(response.data);
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || 'Unable to load curriculum selection details.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [refreshVersion]);
  const refresh = () => setRefreshVersion((current) => current + 1);

  return <ParentPage title="Curriculum selection" description="Choose a pathway for an eligible Year 6 child or request a change. The school reviews every request and assigns the class.">
    {loading ? <div className="parent-panel" role="status">Loading curriculum choices…</div>
      : error ? <div className="parent-error" role="alert">{error}</div>
        : data.children.length ? <>
          <div className="parent-note">GES continues as Year 6 → JHS 1 → JHS 2 → JHS 3. Pearson continues as Year 6 → Year 7 → Year 8 → Year 9 → Year 10 → Year 11. Parents request the curriculum only; class placement remains with school administrators.</div>
          <section className="parent-curriculum-list">
            {data.children.map((child) => <CurriculumSelectionCard key={child.student_id}
              child={child} academicYear={data.academic_year} period={data.selection_period}
              onRefresh={refresh} />)}
          </section>
        </> : <div className="parent-panel">No children are linked to your account. Contact the school office to add an approved link.</div>}
  </ParentPage>;
}

export function ParentFees() {
  const { selectedChild } = useParentChild();
  const currency = selectedChild?.currency || 'GHS';
  const { data, loading, error } = useChildResource('fees', { invoices: [], payments: [], balance: 0 });
  const [receipt, setReceipt] = useState(null);
  const [receiptError, setReceiptError] = useState('');
  const showReceipt = async (id) => {
    setReceiptError('');
    try { const response = await api.get(`/parent-portal/receipts/${id}`); setReceipt(response.data); }
    catch (requestError) { setReceiptError(requestError.response?.data?.message || 'Unable to load this receipt.'); }
  };
  return <ChildRequired><ParentPage title="School fees" description="Read-only fee invoices and payments recorded by school staff.">
    <LoadingPanel loading={loading} error={error}>
      <div className="parent-stats">
        <Stat label="Total payable" value={money(data.total_payable, currency)} />
        <Stat label="Payments received" value={money(data.total_paid, currency)} />
        <Stat label="Outstanding balance" value={money(data.balance, currency)} variant={Number(data.balance) > 0 ? 'is-warning' : 'is-good'} />
      </div>
      <div className="parent-panel"><div className="parent-panel-heading"><div><h2>Fee invoices</h2><p>{selectedChild?.name}</p></div>
        <button className="parent-button secondary" onClick={() => downloadCsv('school-fee-statement.csv', [
          ['Academic year', 'Term', 'Fee item', 'Due date', 'Amount payable', 'Paid', 'Balance', 'Adjustment'],
          ...data.invoices.map((row) => [row.academic_year, row.term, row.description, row.due_date, row.amount_due, row.amount_paid, row.balance, row.fee_override_reason]),
          [], ['Payment date', 'Receipt', 'Method', 'Reference', 'School fee allocation', 'Refunded'],
          ...data.payments.map((row) => [row.payment_date, row.receipt_number, row.payment_method, row.reference, row.amount, row.refunded_amount]),
        ])}>Download statement</button>
      </div>
        {data.invoices.length ? <div className="parent-table-wrap"><table><thead><tr><th>Term</th><th>Fee item</th><th>Due</th><th>Payable</th><th>Paid</th><th>Balance</th><th>Adjustment</th></tr></thead><tbody>
          {data.invoices.map((row) => <tr key={row.id}><td>{row.academic_year ? `${row.academic_year} · ${row.term || ''}` : '—'}</td><td>{row.description || 'School fees'}</td><td>{row.due_date || '—'}</td><td>{money(row.amount_due, currency)}</td><td>{money(row.amount_paid, currency)}</td><td>{money(row.balance, currency)}</td><td>{row.is_fee_override ? row.fee_override_reason || 'Approved adjustment' : '—'}</td></tr>)}
        </tbody></table></div> : <p className="parent-empty">No fee invoices are recorded.</p>}
      </div>
      <div className="parent-panel"><div className="parent-panel-heading"><div><h2>Verified payment history</h2><p>Only recorded school payments are shown.</p></div></div>
        {data.payments.length ? <div className="parent-table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Method / reference</th><th>School fee amount</th><th></th></tr></thead><tbody>
          {data.payments.map((row) => <tr key={row.receipt_id}><td>{row.payment_date}</td><td>{row.receipt_number}</td><td>{row.payment_method}{row.reference ? ` · ${row.reference}` : ''}</td><td>{money(row.amount, currency)}{Number(row.refunded_amount) ? ` · refunded ${money(row.refunded_amount, currency)}` : ''}</td><td><button className="parent-text-button" onClick={() => showReceipt(row.receipt_id)}>View receipt</button></td></tr>)}
        </tbody></table></div> : <p className="parent-empty">No verified school fee payments are recorded.</p>}
        {receiptError && <p className="parent-error" role="alert">{receiptError}</p>}
        {receipt && <div className="parent-receipt" role="dialog" aria-modal="true" aria-label="Payment receipt"><button className="parent-close-receipt" onClick={() => setReceipt(null)}>Close</button>
          <h2>The McCarthy Hill School</h2><p>Official payment receipt</p><hr />
          <p>Receipt: <strong>{receipt.receipt_number}</strong></p><p>Student: {receipt.student_name} ({receipt.admission_number})</p>
          <p>Date: {receipt.payment_date} · Method: {receipt.payment_method}</p><p>Reference: {receipt.reference || '—'}</p>
          <p>School fees: <strong>{money(receipt.school_fee_amount, currency)}</strong></p><p>Feeding: {money(receipt.feeding_amount, currency)}</p>
          <p>Total received: <strong>{money(receipt.amount_total, currency)}</strong></p><small>Received by {receipt.received_by_name || 'School'}</small>
          <button className="parent-button primary" onClick={printReceipt}>Print / Save receipt</button>
        </div>}
      </div>
    </LoadingPanel>
  </ParentPage></ChildRequired>;
}

export function ParentFeeding() {
  const { selectedChild } = useParentChild();
  const currency = selectedChild?.currency || 'GHS';
  const { data, loading, error } = useChildResource('feeding', { obligations: [], payments: [], total_due: 0, total_paid: 0, balance: 0, advance_credit: 0 });
  const [receipt, setReceipt] = useState(null);
  const [receiptError, setReceiptError] = useState('');
  const showReceipt = async (id) => {
    setReceiptError('');
    try { const response = await api.get(`/parent-portal/receipts/${id}`); setReceipt(response.data); }
    catch (requestError) { setReceiptError(requestError.response?.data?.message || 'Unable to load this receipt.'); }
  };
  return <ChildRequired><ParentPage title="Feeding account" description="Feeding is tracked separately from school tuition and uses the school's class-rate and allocation records.">
    <LoadingPanel loading={loading} error={error}>
      <div className="parent-stats"><Stat label="Feeding amount due" value={money(data.total_due, currency)} /><Stat label="Feeding payments allocated" value={money(data.total_paid, currency)} /><Stat label="Remaining feeding balance" value={money(data.balance, currency)} variant={Number(data.balance) > 0 ? 'is-warning' : 'is-good'} /><Stat label="Advance feeding credit" value={money(data.advance_credit, currency)} /></div>
      <div className="parent-panel"><div className="parent-panel-heading"><div><h2>Daily feeding record</h2><p>{selectedChild?.name} · rates and coverage from the school register</p></div>
        <button className="parent-button secondary" onClick={() => downloadCsv('feeding-statement.csv', [
          ['Date', 'Academic year', 'Term', 'Daily rate', 'Amount due', 'Paid', 'Coverage'],
          ...data.obligations.map((row) => [row.feeding_date, row.academic_year, row.term, row.daily_rate, row.amount_due, row.amount_paid, row.is_served ? 'Served' : 'Not marked served']),
          [], ['Date', 'Receipt', 'Method', 'Feeding received', 'Allocated', 'Refunded'],
          ...data.payments.map((row) => [row.payment_date, row.receipt_number, row.payment_method, row.feeding_amount, row.allocated_amount, row.refunded_amount]),
        ])}>Download statement</button>
      </div>
        {data.obligations.length ? <div className="parent-table-wrap"><table><thead><tr><th>Date</th><th>Term</th><th>Class rate</th><th>Amount due</th><th>Paid</th><th>Coverage</th></tr></thead><tbody>
          {data.obligations.map((row) => <tr key={row.id}><td>{row.feeding_date}</td><td>{row.academic_year} · {row.term}</td><td>{money(row.daily_rate, currency)}</td><td>{money(row.amount_due, currency)}</td><td>{money(row.amount_paid, currency)}</td><td>{row.is_served ? 'Served' : 'Not marked served'}</td></tr>)}
        </tbody></table></div> : <p className="parent-empty">No feeding obligations are configured for this child.</p>}
      </div>
      <div className="parent-panel"><div className="parent-panel-heading"><div><h2>Feeding payment history</h2><p>Combined payments are split into their recorded fee and feeding allocations.</p></div></div>
        {data.payments.length ? <div className="parent-table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Method / reference</th><th>Feeding payment</th><th>Allocated</th><th></th></tr></thead><tbody>
          {data.payments.map((row) => <tr key={row.id}><td>{row.payment_date}</td><td>{row.receipt_number}</td><td>{row.payment_method}{row.reference ? ` · ${row.reference}` : ''}</td><td>{money(row.feeding_amount, currency)}{Number(row.refunded_amount) ? ` · refunded ${money(row.refunded_amount, currency)}` : ''}</td><td>{money(row.allocated_amount, currency)}</td><td><button className="parent-text-button" onClick={() => showReceipt(row.id)}>View receipt</button></td></tr>)}
        </tbody></table></div> : <p className="parent-empty">No feeding payments are recorded.</p>}
        {receiptError && <p className="parent-error" role="alert">{receiptError}</p>}
        {receipt && <div className="parent-receipt" role="dialog" aria-modal="true" aria-label="Payment receipt"><button className="parent-close-receipt" onClick={() => setReceipt(null)}>Close</button>
          <h2>The McCarthy Hill School</h2><p>Official payment receipt</p><hr />
          <p>Receipt: <strong>{receipt.receipt_number}</strong></p><p>Student: {receipt.student_name} ({receipt.admission_number})</p>
          <p>Date: {receipt.payment_date} · Method: {receipt.payment_method}</p><p>Reference: {receipt.reference || '—'}</p>
          <p>School fees: {money(receipt.school_fee_amount, currency)}</p><p>Feeding: <strong>{money(receipt.feeding_amount, currency)}</strong></p>
          <p>Total received: <strong>{money(receipt.amount_total, currency)}</strong></p><small>Received by {receipt.received_by_name || 'School'}</small>
          <button className="parent-button primary" onClick={printReceipt}>Print / Save receipt</button>
        </div>}
      </div>
    </LoadingPanel>
  </ParentPage></ChildRequired>;
}

export function ParentResults() {
  const { selectedChild } = useParentChild();
  const { data, loading, error } = useChildResource('results', []);
  return <ChildRequired><ParentPage title="Academic results" description="Only examination results published by authorized staff are shown.">
    <LoadingPanel loading={loading} error={error}>{data.length ? <>
      <button className="parent-button secondary parent-print" onClick={() => window.print()}>Print / Save report</button>
      <div className="parent-panel parent-table-wrap"><table><thead><tr><th>Academic year · term</th><th>Class</th><th>Subject</th><th>Class assessment</th><th>Examination</th><th>Total</th><th>Published</th></tr></thead><tbody>
        {data.map((row) => <tr key={row.id}><td>{row.academic_year_snapshot || selectedChild?.academic_year || '—'} · {row.term}</td><td>{row.class_name_snapshot || selectedChild?.class_name || '—'}</td><td>{row.subject}</td><td>{row.class_score ?? '—'}</td><td>{row.exam_score ?? '—'}</td><td><strong>{row.score}</strong></td><td>{row.published_at ? new Date(row.published_at).toLocaleDateString() : 'Published'}</td></tr>)}
      </tbody></table></div>
    </> : <div className="parent-panel parent-empty">There are no published results for this child yet. Draft results are not visible.</div>}</LoadingPanel>
  </ParentPage></ChildRequired>;
}

export function ParentAttendance() {
  const { data, loading, error } = useChildResource('attendance', { records: [], totals: {}, attendance_percentage: 0 });
  return <ChildRequired><ParentPage title="Attendance" description="Official daily attendance records for your child.">
    <LoadingPanel loading={loading} error={error}><div className="parent-stats"><Stat label="Attendance rate" value={`${data.attendance_percentage}%`} />
      {['present', 'late', 'absent', 'excused'].map((status) => <Stat key={status} label={status[0].toUpperCase() + status.slice(1)} value={data.totals[status] || 0} />)}
    </div><div className="parent-panel parent-table-wrap"><table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>
      {data.records.map((row) => <tr key={row.id}><td>{row.date}</td><td className={`parent-status ${row.status}`}>{row.status}</td></tr>)}
    </tbody></table>{!data.records.length && <p className="parent-empty">No attendance records are available.</p>}</div>
      <div className="parent-note">Attendance explanations are not submitted here because the current school system does not have an absence enquiry approval workflow. Contact the school office; an explanation does not change the official register.</div>
    </LoadingPanel>
  </ParentPage></ChildRequired>;
}

export function ParentTimetable() {
  const { data, loading, error } = useChildResource('timetable', []);
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return <ChildRequired><ParentPage title="Class timetable" description="Published timetable for your child's current class and term.">
    <LoadingPanel loading={loading} error={error}>{data.length ? days.map((day) => {
      const entries = data.filter((entry) => entry.day_of_week === day);
      return entries.length ? <section className="parent-panel" key={day}><h2>{day}</h2><div className="parent-table-wrap"><table><thead><tr><th>Time</th><th>Subject</th><th>Teacher</th><th>Room</th></tr></thead><tbody>
        {entries.map((row) => <tr key={row.id}><td>{String(row.start_time).slice(0, 5)}–{String(row.end_time).slice(0, 5)}</td><td>{row.is_break ? row.period_name || 'Break' : row.subject}</td><td>{row.teacher || '—'}</td><td>{row.room || '—'}</td></tr>)}
      </tbody></table></div></section> : null;
    }) : <div className="parent-panel parent-empty">No published timetable is available for this class and term.</div>}</LoadingPanel>
  </ParentPage></ChildRequired>;
}

export function ParentAnnouncements() {
  const { data, loading, error } = useChildResource('announcements', []);
  return <ChildRequired><ParentPage title="School announcements" description="School-wide and your child's class notices.">
    <LoadingPanel loading={loading} error={error}>{data.length ? data.map((item) => <article className="parent-panel parent-announcement" key={item.id}>
      <small>{new Date(item.created_at).toLocaleString()} · {item.sender_name || 'School'}</small><h2>{item.title}</h2><p>{item.message}</p>
    </article>) : <div className="parent-panel parent-empty">No announcements are available for this child.</div>}</LoadingPanel>
  </ParentPage></ChildRequired>;
}

export function ParentCommunication() {
  const { children, selectedChild } = useParentChild();
  const { data, loading, error } = useParentResource('/parent-portal/enquiries', []);
  const [items, setItems] = useState([]);
  const [requestType, setRequestType] = useState('enquiry');
  const [studentId, setStudentId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setItems(data), [data]);
  useEffect(() => setStudentId(String(selectedChild?.id || '')), [selectedChild?.id]);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setActionError(''); setNotice('');
    try {
      const response = await api.post('/parent-portal/enquiries', {
        request_type: requestType,
        student_id: studentId || null,
        subject,
        message,
      });
      setItems((current) => [response.data, ...current]);
      setSubject(''); setMessage('');
      setNotice('Your message has been sent to the school. You can follow its status below.');
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Unable to send your message.');
    } finally { setSaving(false); }
  };
  return <ParentPage title="Contact the school" description="Send an enquiry or request a correction to your child's information. School staff will review it.">
    <form className="parent-panel parent-form" onSubmit={submit}>
      <h2>Send a message</h2>
      {actionError && <div className="parent-error" role="alert">{actionError}</div>}
      {notice && <div className="parent-success" role="status">{notice}</div>}
      <label>Request type<select value={requestType} onChange={(event) => setRequestType(event.target.value)}>
        <option value="enquiry">General enquiry</option><option value="profile_correction">Child information correction</option>
      </select></label>
      {children.length > 0 && <label>Related child{requestType === 'profile_correction' ? ' (required)' : ' (optional)'}
        <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
          {requestType !== 'profile_correction' && <option value="">No specific child</option>}
          {children.map((child) => <option key={child.id} value={child.id}>{child.name} · {child.admission_number}</option>)}
        </select>
      </label>}
      <label>Subject<input value={subject} maxLength="120" onChange={(event) => setSubject(event.target.value)} required /></label>
      <label>Message<textarea value={message} maxLength="4000" rows="5" onChange={(event) => setMessage(event.target.value)} required /></label>
      <button className="parent-button primary" disabled={saving}>{saving ? 'Sending…' : 'Send to school'}</button>
    </form>
    <LoadingPanel loading={loading} error={error}><section className="parent-panel"><h2>Previous messages</h2>
      {items.length ? items.map((item) => <article className="parent-enquiry" key={item.id}>
        <div className="parent-panel-heading"><div><strong>{item.subject}</strong><small>{item.student_name ? ` · ${item.student_name}` : ''} · {new Date(item.created_at).toLocaleString()}</small></div><span className={`parent-request-status ${item.status}`}>{item.status.replace('_', ' ')}</span></div>
        <p>{item.message}</p>
        {item.school_response && <div className="parent-response"><strong>School response</strong><p>{item.school_response}</p>{item.responded_at && <small>{new Date(item.responded_at).toLocaleString()}</small>}</div>}
      </article>) : <p className="parent-empty">No previous messages.</p>}
    </section></LoadingPanel>
  </ParentPage>;
}

export function ParentNotifications() {
  const { data, loading, error } = useParentResource('/notifications', []);
  const [items, setItems] = useState([]);
  const [actionError, setActionError] = useState('');
  useEffect(() => setItems(data), [data]);
  const markRead = async (id) => {
    try {
      const response = await api.put(`/notifications/${id}/read`);
      setItems((current) => current.map((item) => item.id === id ? response.data : item));
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Unable to update notification.');
    }
  };
  const markAllRead = async () => {
    try {
      await api.put('/notifications/mark-all-read');
      setItems((current) => current.map((item) => ({ ...item, is_read: true })));
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Unable to update notifications.');
    }
  };
  return <ParentPage title="Notifications" description="Private updates addressed to your parent account.">
    <LoadingPanel loading={loading} error={error}><div className="parent-panel">
      <div className="parent-panel-heading"><h2>Your notifications</h2><button className="parent-button secondary" onClick={markAllRead}>Mark all read</button></div>
      {actionError && <p className="parent-error" role="alert">{actionError}</p>}
      {items.length ? items.map((item) => <article className={`parent-notice${item.is_read ? '' : ' unread'}`} key={item.id}>
        <div><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()}</small></div>
        {!item.is_read && <button className="parent-text-button" onClick={() => markRead(item.id)}>Mark read</button>}
      </article>) : <p className="parent-empty">You have no notifications.</p>}
    </div></LoadingPanel>
  </ParentPage>;
}

export function ParentProfile() {
  const { data, loading, error } = useParentResource('/parent-portal/profile', null);
  const [form, setForm] = useState({ email: '', phone: '' });
  const [preferences, setPreferences] = useState(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) {
      setForm({ email: data.email || '', phone: data.phone || '' });
      setPreferences(data.preferences);
    }
  }, [data]);
  const saveContact = async (event) => {
    event.preventDefault();
    setSaving(true); setMessage(''); setActionError('');
    try {
      const response = await api.patch('/parent-portal/profile', form);
      setMessage(response.data.message);
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Unable to update contact details.');
    } finally { setSaving(false); }
  };
  const savePreferences = async () => {
    setSaving(true); setMessage(''); setActionError('');
    try {
      const response = await api.put('/parent-portal/preferences', preferences);
      setPreferences(response.data);
      setMessage('Notification preferences saved.');
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Unable to save notification preferences.');
    } finally { setSaving(false); }
  };
  const updatePassword = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const nextPassword = formData.get('newPassword');
    if (nextPassword !== formData.get('confirmPassword')) return setActionError('The passwords do not match.');
    setSaving(true); setMessage(''); setActionError('');
    try {
      await changePassword({ newPassword: nextPassword });
      formElement.reset();
      setMessage('Password updated successfully.');
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Unable to change password.');
    } finally { setSaving(false); }
  };
  return <ParentPage title="My account" description="Manage your contact details and portal preferences.">
    <LoadingPanel loading={loading} error={error}>{data && <>
      <div className="parent-panel"><h2>Registered information</h2><div className="parent-readonly"><span>Account name</span><strong>{data.name}</strong><span>Account status</span><strong>{data.is_active ? 'Active' : 'Suspended'}</strong></div></div>
      <form className="parent-panel parent-form" onSubmit={saveContact}><h2>Contact details</h2><p>Changes apply to your parent account. Child records and guardian links require school approval.</p>
        {actionError && <div className="parent-error" role="alert">{actionError}</div>}{message && <div className="parent-success" role="status">{message}</div>}
        <label>Email address<input type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>Registered phone<input type="tel" autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <button className="parent-button primary" disabled={saving}>Save contact details</button>
      </form>
      <div className="parent-panel"><h2>Linked children</h2>{data.children.map((child) => <div className="parent-linked-child" key={child.id}><strong>{child.name}</strong><span>{child.admission_number} · {child.class_name || 'No class'} · {child.relationship || 'Guardian'}</span></div>)}</div>
      <div className="parent-panel"><h2>Notification preferences</h2>{preferences && <>
        {Object.entries({ announcements: 'School announcements', fee_reminders: 'School fee reminders', feeding_reminders: 'Feeding balance reminders', emergency_notices: 'Emergency notices' }).map(([key, label]) => <label className="parent-checkbox" key={key}><input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences({ ...preferences, [key]: event.target.checked })} />{label}</label>)}
        <button className="parent-button secondary" disabled={saving} onClick={savePreferences}>Save preferences</button>
      </>}</div>
      <form className="parent-panel parent-form" onSubmit={updatePassword}><h2>Change password</h2>
        <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength="8" required /></label>
        <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength="8" required /></label>
        <button className="parent-button primary" disabled={saving}>Change password</button>
      </form>
    </>}</LoadingPanel>
  </ParentPage>;
}
