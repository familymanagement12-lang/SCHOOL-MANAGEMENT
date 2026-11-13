import { useEffect, useMemo, useState } from 'react';
import {
  createCalendarEvent, deleteCalendarEvent, getCalendarEvents, getFeedingClasses, getFeedingPayments,
  getFeedingReceipt, getFeedingRegister, getFeedingReport, getKitchenPurchases,
  getKitchenStock, createKitchenPurchase, approveKitchenPurchase, createShoppingAdvance,
  getShoppingAdvances, reconcileShoppingAdvance, recordFeedingPayment,
  searchFeedingStudents, setFeedingRate, updateFeedingRegister,
} from '../api/feeding';
import { hasOperationalPermission } from '../utils/operationalPermissions';

const today = () => new Date().toLocaleDateString('en-CA');
const money = (value) => `GH₵${Number(value || 0).toFixed(2)}`;
const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function Feeding() {
  let user;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  const can = (...permissions) => hasOperationalPermission(user, ...permissions);
  const canRates = can('feeding.rates.read', 'feeding.rates.manage', 'feeding.payments.create');
  const canSearch = can('feeding.students.read', 'feeding.payments.create');
  const canLoadClasses = canRates || canSearch;
  const canPaymentRead = can('feeding.payments.read');
  const canPaymentCreate = can('feeding.payments.create');
  const canRegisterRead = can('feeding.register.read', 'feeding.register.manage');
  const canCalendarManage = can('feeding.calendar.manage');
  const canCalendarRead = can('feeding.access', 'feeding.calendar.manage');
  const canFeedingPurchases = can('feeding.purchases.read', 'feeding.purchases.create', 'feeding.purchases.approve');
  const canFeedingPurchaseCreate = can('feeding.purchases.create');
  const canAdvanceManage = can('feeding.advances.manage');
  const canReport = can('feeding.reports.read', 'tuckshop.reports.read');

  const [classes, setClasses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [register, setRegister] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [feedingPurchases, setFeedingPurchases] = useState([]);
  const [kitchenStock, setKitchenStock] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [advanceForm, setAdvanceForm] = useState({
    amount_issued: '', recipient_name: '', issued_date: today(), purpose: '', notes: '',
  });
  const [advanceKey, setAdvanceKey] = useState(newIdempotencyKey());
  const [advanceReturns, setAdvanceReturns] = useState({});
  const [purchaseForm, setPurchaseForm] = useState({ purchase_date: today(), supplier: '', reference: '', stock_item_id: '', quantity: '1', unit_cost: '', advance_id: '' });
  const [purchaseKey, setPurchaseKey] = useState(newIdempotencyKey());
  const [report, setReport] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [students, setStudents] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentKey, setPaymentKey] = useState(newIdempotencyKey());
  const [paymentDate, setPaymentDate] = useState(today());
  const [registerDate, setRegisterDate] = useState(today());
  const [reportDates, setReportDates] = useState({ startDate: today(), endDate: today() });
  const [calendarForm, setCalendarForm] = useState({ name: '', event_type: 'holiday', start_date: today(), end_date: today() });
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshPayments = async () => {
    if (!canPaymentRead) return;
    const response = await getFeedingPayments();
    setPayments(response.data);
  };
  const refreshRegister = async (date = registerDate) => {
    if (!canRegisterRead) return;
    const response = await getFeedingRegister(date);
    setRegister(response.data);
  };
  const refreshCalendar = async () => {
    if (!canCalendarRead) return;
    const response = await getCalendarEvents();
    setCalendarEvents(response.data);
  };

  useEffect(() => {
    let active = true;
    const tasks = [];
    if (canLoadClasses) tasks.push(getFeedingClasses().then((response) => active && setClasses(response.data)));
    if (canPaymentRead) tasks.push(getFeedingPayments().then((response) => active && setPayments(response.data)));
    if (canRegisterRead) tasks.push(getFeedingRegister(today()).then((response) => active && setRegister(response.data)));
    if (canCalendarRead) tasks.push(getCalendarEvents().then((response) => active && setCalendarEvents(response.data)));
    if (canFeedingPurchases) tasks.push(getKitchenPurchases().then((response) => active && setFeedingPurchases(response.data)));
    if (canFeedingPurchaseCreate || can('feeding.purchases.approve')) tasks.push(getKitchenStock().then((response) => active && setKitchenStock(response.data)));
    if (canAdvanceManage) tasks.push(getShoppingAdvances().then((response) => active && setAdvances(response.data)));
    Promise.all(tasks)
      .catch((err) => active && setError(err.response?.data?.message || 'Unable to load feeding information.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!canSearch || studentSearch.trim().length < 2) {
      setStudents([]);
      return () => { active = false; };
    }
    setStudents([]);
    const timer = setTimeout(() => {
      searchFeedingStudents(studentSearch.trim(), classFilter || undefined)
        .then((response) => active && setStudents(response.data))
        .catch((err) => active && setError(err.response?.data?.message || 'Student search failed.'));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [studentSearch, classFilter]);

  const predictedDays = useMemo(() => {
    const rate = Number(selectedStudent?.daily_rate || 0);
    const received = Number(amount || 0);
    const credit = Number(selectedStudent?.feeding_credit || 0);
    return rate > 0 && received > 0 ? Math.floor((Math.round(received * 100) + Math.round(credit * 100)) / Math.round(rate * 100)) : 0;
  }, [amount, selectedStudent]);
  const predictedCredit = useMemo(() => {
    const rateCents = Math.round(Number(selectedStudent?.daily_rate || 0) * 100);
    const total = Math.round((Number(amount || 0) + Number(selectedStudent?.feeding_credit || 0)) * 100);
    return rateCents > 0 ? ((total % rateCents) / 100).toFixed(2) : '0.00';
  }, [amount, selectedStudent]);

  const handlePayment = async (event) => {
    event.preventDefault();
    if (!selectedStudent) return setError('Select a student before recording the payment.');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await recordFeedingPayment({
        student_id: selectedStudent.id,
        amount_received: amount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        payment_reference: paymentReference,
        idempotency_key: paymentKey,
      });
      setPaymentKey(newIdempotencyKey());
      setReceipt(response.data);
      setAmount('');
      setPaymentReference('');
      setNotice(`Payment saved. ${response.data.days_covered} feeding day(s) covered; credit remaining ${money(response.data.credit_added)}.`);
      if (canPaymentRead) await refreshPayments();
      if (canSearch) {
        const fresh = await searchFeedingStudents(studentSearch.trim(), classFilter || undefined);
        setStudents(fresh.data);
        setSelectedStudent(fresh.data.find((student) => student.id === selectedStudent.id) || selectedStudent);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to record feeding payment.');
    } finally {
      setBusy(false);
    }
  };

  const handleRateSave = async (classRow) => {
    setBusy(true);
    setError('');
    try {
      await setFeedingRate(classRow.id, classRow.editRate ?? classRow.daily_rate);
      setNotice(`Rate saved for ${classRow.name}.`);
      const response = await getFeedingClasses();
      setClasses(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save class feeding rate.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterToggle = async (entry) => {
    setError('');
    try {
      await updateFeedingRegister(entry.id, !entry.is_served);
      await refreshRegister();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to update the feeding register.');
    }
  };

  const handleCalendarSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createCalendarEvent(calendarForm);
      setCalendarForm((current) => ({ ...current, name: '' }));
      await refreshCalendar();
      setNotice('School calendar entry saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save school calendar entry.');
    } finally {
      setBusy(false);
    }
  };

  const removeCalendarEvent = async (eventId) => {
    if (!window.confirm('Remove this school calendar entry?')) return;
    setError('');
    try {
      await deleteCalendarEvent(eventId);
      await refreshCalendar();
      setNotice('School calendar entry removed.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to remove school calendar entry.');
    }
  };

  const handleReport = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const response = await getFeedingReport(reportDates.startDate, reportDates.endDate);
      setReport(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load feeding report.');
    }
  };

  const recordFeedingPurchase = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createKitchenPurchase({
        purpose: 'feeding',
        purchase_date: purchaseForm.purchase_date,
        supplier: purchaseForm.supplier,
        reference: purchaseForm.reference,
        advance_id: purchaseForm.advance_id || null,
        idempotency_key: purchaseKey,
        items: [{ stock_item_id: purchaseForm.stock_item_id, quantity: purchaseForm.quantity, unit_cost: purchaseForm.unit_cost }],
      });
      setPurchaseForm((current) => ({ ...current, supplier: '', reference: '', unit_cost: '', advance_id: '' }));
      setPurchaseKey(newIdempotencyKey());
      const response = await getKitchenPurchases();
      setFeedingPurchases(response.data);
      setNotice('Feeding purchase submitted for approval. It will post to finance once approved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to record feeding purchase.');
    } finally {
      setBusy(false);
    }
  };

  const approveFeedingPurchase = async (purchase) => {
    setBusy(true);
    setError('');
    try {
      await approveKitchenPurchase(purchase.id, 'feeding');
      const response = await getKitchenPurchases();
      setFeedingPurchases(response.data);
      setNotice(`Feeding purchase ${purchase.id} approved and posted to finance.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to approve feeding purchase.');
    } finally {
      setBusy(false);
    }
  };

  const issueAdvance = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await createShoppingAdvance({
        ...advanceForm,
        idempotency_key: advanceKey,
      });
      setAdvanceKey(newIdempotencyKey());
      setAdvanceForm((current) => ({ ...current, amount_issued: '', recipient_name: '', purpose: '', notes: '' }));
      const response = await getShoppingAdvances();
      setAdvances(response.data);
      setNotice('Shopping advance recorded. It is not posted as an expense until approved purchases are reconciled.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to record shopping advance.');
    } finally {
      setBusy(false);
    }
  };

  const returnAdvance = async (advance) => {
    setBusy(true);
    setError('');
    try {
      await reconcileShoppingAdvance(advance.id, advanceReturns[advance.id] ?? advance.returned_amount);
      const response = await getShoppingAdvances();
      setAdvances(response.data);
      setNotice(`Advance #${advance.id} reconciliation saved.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reconcile shopping advance.');
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async (payment) => {
    try {
      const response = await getFeedingReceipt(payment.id);
      setReceipt(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to open the feeding receipt.');
    }
  };

  if (loading) return <div className="page"><p>Loading feeding information...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero">
          <div>
            <p className="eyebrow">School operations</p>
            <h1>School Feeding</h1>
            <p>Record complete feeding payments, school-day coverage, credits, and daily service.</p>
          </div>
        </section>

        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}

        {canRates && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Daily rates</p><h2>Class feeding prices</h2></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Class</th><th>Daily rate</th>{can('feeding.rates.manage') && <th>Action</th>}</tr></thead>
                <tbody>
                  {classes.map((classRow) => (
                    <tr key={classRow.id}>
                      <td>{classRow.name}</td>
                      <td>{can('feeding.rates.manage')
                        ? <input aria-label={`${classRow.name} daily rate`} type="number" min="0.01" step="0.01" value={classRow.editRate ?? classRow.daily_rate ?? ''} placeholder="Set rate" onChange={(event) => setClasses((rows) => rows.map((row) => row.id === classRow.id ? { ...row, editRate: event.target.value } : row))} />
                        : (classRow.daily_rate ? money(classRow.daily_rate) : 'Not set')}</td>
                      {can('feeding.rates.manage') && <td><button className="btn-secondary" disabled={busy || !classRow.editRate && !classRow.daily_rate} onClick={() => handleRateSave(classRow)}>Save rate</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(canSearch || canPaymentCreate) && (
          <section className="split-layout">
            <div className="data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Student</p><h2>Find student</h2></div></div>
              <label htmlFor="feeding-class">Filter by class</label>
              <select id="feeding-class" value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSelectedStudent(null); }}>
                <option value="">All classes</option>
                {classes.map((classRow) => <option key={classRow.id} value={classRow.id}>{classRow.name}</option>)}
              </select>
              <label htmlFor="feeding-student-search">Search by student name</label>
              <input id="feeding-student-search" value={studentSearch} onChange={(event) => { setStudentSearch(event.target.value); setSelectedStudent(null); }} placeholder="Type at least two characters" />
              {students.length > 0 && (
                <div className="feeding-student-results" role="listbox" aria-label="Student search results">
                  {students.map((student) => (
                    <button className="feeding-student-option" type="button" key={student.id} onClick={() => { setSelectedStudent(student); setStudents([]); }}>
                      <strong>{student.name}</strong><span>{student.class_name || 'No class'}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedStudent && (
                <div className="feeding-selected-student">
                  <strong>{selectedStudent.name}</strong><span>{selectedStudent.class_name}</span>
                  <span>Daily rate: {selectedStudent.daily_rate ? money(selectedStudent.daily_rate) : 'Not configured'}</span>
                  <span>Available feeding credit: {money(selectedStudent.feeding_credit)}</span>
                  <button type="button" className="btn-secondary" onClick={() => setSelectedStudent(null)}>Choose another student</button>
                </div>
              )}
            </div>

            {canPaymentCreate && (
              <form className="data-panel form-panel" onSubmit={handlePayment}>
                <div className="panel-heading"><div><p className="eyebrow">Payment</p><h2>Record feeding payment</h2></div></div>
                <label htmlFor="feeding-payment-amount">Amount received (GH₵)</label>
                <input id="feeding-payment-amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} />
                <label htmlFor="feeding-payment-date">Payment date</label>
                <input id="feeding-payment-date" type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
                <label htmlFor="feeding-payment-method">Payment method</label>
                <select id="feeding-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                  <option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option>
                </select>
                {paymentMethod !== 'cash' && <label htmlFor="feeding-payment-reference">Payment reference (optional)<input id="feeding-payment-reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label>}
                {selectedStudent && (
                  <div className="feeding-coverage-preview">
                    <strong>Automatic coverage estimate</strong>
                    <span>Class: {selectedStudent.class_name || 'Not assigned'}</span>
                    <span>Rate: {selectedStudent.daily_rate ? `${money(selectedStudent.daily_rate)} per feeding day` : 'Set a class rate first'}</span>
                    <span>Days covered: {predictedDays}</span>
                    <span>Credit remaining: {money(predictedCredit)}</span>
                    <small>School holidays, vacations, and weekends are excluded. Existing coverage is extended.</small>
                  </div>
                )}
                <button className="btn-primary" type="submit" disabled={busy || !selectedStudent || !selectedStudent.daily_rate}>
                  {busy ? 'Saving...' : 'Record complete payment'}
                </button>
              </form>
            )}
          </section>
        )}

        {canPaymentRead && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">History</p><h2>Feeding payments</h2></div></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Payment date</th><th>Student / class</th><th>Received</th><th>Method / reference</th><th>Rate</th><th>Days</th><th>Coverage</th><th>Credit</th><th>Received by</th><th>Receipt</th></tr></thead>
              <tbody>{payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{String(payment.payment_date).slice(0, 10)}</td>
                  <td>{payment.student_name}<br /><small>{payment.class_name}</small></td>
                  <td>{money(payment.amount_received)}</td><td>{payment.payment_method?.replace('_', ' ') || 'cash'}{payment.payment_reference && <><br /><small>{payment.payment_reference}</small></>}</td><td>{money(payment.daily_rate)}</td>
                  <td>{payment.days_covered}</td>
                  <td>{payment.coverage_start ? `${String(payment.coverage_start).slice(0, 10)} – ${String(payment.coverage_end).slice(0, 10)}` : 'Credit only'}</td>
                  <td>{money(payment.credit_added)}</td><td>{payment.received_by_name || '—'}</td>
                  <td><button className="btn-secondary" onClick={() => openReceipt(payment)}>{payment.receipt_number}</button></td>
                </tr>
              ))}</tbody>
            </table></div>
            {!payments.length && <p className="empty-state">No feeding payments recorded yet.</p>}
          </section>
        )}

        {canRegisterRead && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Daily service</p><h2>Feeding register</h2></div></div>
            <label htmlFor="feeding-register-date">School date</label>
            <input id="feeding-register-date" type="date" value={registerDate} onChange={async (event) => { setRegisterDate(event.target.value); await refreshRegister(event.target.value); }} />
            <div className="table-wrap"><table>
              <thead><tr><th>Student</th><th>Class</th><th>Receipt</th><th>Status</th>{can('feeding.register.manage') && <th>Action</th>}</tr></thead>
              <tbody>{register.map((entry) => (
                <tr key={entry.id}><td>{entry.student_name}</td><td>{entry.class_name || '—'}</td><td>{entry.receipt_number}</td>
                  <td>{entry.is_served ? `Served${entry.served_by_name ? ` by ${entry.served_by_name}` : ''}` : 'Not served'}</td>
                  {can('feeding.register.manage') && <td><button className="btn-secondary" onClick={() => handleRegisterToggle(entry)}>{entry.is_served ? 'Undo served' : 'Mark served'}</button></td>}
                </tr>
              ))}</tbody>
            </table></div>
            {!register.length && <p className="empty-state">No covered students are scheduled for this date.</p>}
          </section>
        )}

        {canFeedingPurchases && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Feeding expenses</p><h2>Feeding purchases</h2></div></div>
            {canFeedingPurchaseCreate && (
              <form className="feeding-calendar-form" onSubmit={recordFeedingPurchase}>
                <label>Date<input type="date" required value={purchaseForm.purchase_date} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchase_date: event.target.value })} /></label>
                <label>Stock item<select required value={purchaseForm.stock_item_id} onChange={(event) => setPurchaseForm({ ...purchaseForm, stock_item_id: event.target.value })}><option value="">Select item</option>{kitchenStock.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label>
                <label>Quantity<input type="number" min="0.001" step="0.001" required value={purchaseForm.quantity} onChange={(event) => setPurchaseForm({ ...purchaseForm, quantity: event.target.value })} /></label>
                <label>Unit cost (GH₵)<input type="number" min="0" step="0.01" required value={purchaseForm.unit_cost} onChange={(event) => setPurchaseForm({ ...purchaseForm, unit_cost: event.target.value })} /></label>
                <label>Supplier<input value={purchaseForm.supplier} onChange={(event) => setPurchaseForm({ ...purchaseForm, supplier: event.target.value })} /></label>
                <label>Invoice/reference<input value={purchaseForm.reference} onChange={(event) => setPurchaseForm({ ...purchaseForm, reference: event.target.value })} /></label>
                {canAdvanceManage && <label>Shopping advance (optional)<select value={purchaseForm.advance_id} onChange={(event) => setPurchaseForm({ ...purchaseForm, advance_id: event.target.value })}><option value="">No advance</option>{advances.map((advance) => <option key={advance.id} value={advance.id}>#{advance.id} {advance.recipient_name} — {money(advance.unaccounted_amount)} available</option>)}</select></label>}
                <button className="btn-primary" disabled={busy || !kitchenStock.length}>Record for approval</button>
              </form>
            )}
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{feedingPurchases.filter((purchase) => purchase.purpose === 'feeding').map((purchase) => (
                <tr key={purchase.id}><td>{String(purchase.purchase_date).slice(0, 10)}</td><td>{purchase.supplier || '—'}</td>
                  <td>{purchase.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}</td><td>{money(purchase.total_amount)}</td>
                  <td>{purchase.status}</td><td>{purchase.status === 'pending' && can('feeding.purchases.approve') && <button className="btn-secondary" disabled={busy} onClick={() => approveFeedingPurchase(purchase)}>Approve</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        )}

        {canAdvanceManage && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Market cash control</p><h2>Shopping advances</h2></div></div>
            <form className="feeding-calendar-form" onSubmit={issueAdvance}>
              <label>Amount issued (GH₵)<input type="number" min="0.01" step="0.01" required value={advanceForm.amount_issued} onChange={(event) => setAdvanceForm({ ...advanceForm, amount_issued: event.target.value })} /></label>
              <label>Recipient<input required value={advanceForm.recipient_name} onChange={(event) => setAdvanceForm({ ...advanceForm, recipient_name: event.target.value })} /></label>
              <label>Issue date<input type="date" required value={advanceForm.issued_date} onChange={(event) => setAdvanceForm({ ...advanceForm, issued_date: event.target.value })} /></label>
              <label>Purpose<input required value={advanceForm.purpose} onChange={(event) => setAdvanceForm({ ...advanceForm, purpose: event.target.value })} /></label>
              <label>Notes<input value={advanceForm.notes} onChange={(event) => setAdvanceForm({ ...advanceForm, notes: event.target.value })} /></label>
              <button className="btn-primary" disabled={busy}>Issue shopping advance</button>
            </form>
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Recipient / purpose</th><th>Issued</th><th>Approved purchases</th><th>Returned</th><th>Unaccounted</th><th>Status</th><th>Reconcile</th></tr></thead>
              <tbody>{advances.map((advance) => <tr key={advance.id}>
                <td>{String(advance.issued_date).slice(0, 10)}</td>
                <td>{advance.recipient_name}<br /><small>{advance.purpose}</small></td>
                <td>{money(advance.amount_issued)}</td>
                <td>{money(advance.approved_expenses)}</td>
                <td>{money(advance.returned_amount)}</td>
                <td>{money(advance.unaccounted_amount)}</td>
                <td>{advance.status.replace('_', ' ')}</td>
                <td><div className="feeding-calendar-form">
                  <input aria-label={`Returned amount for advance ${advance.id}`} type="number" min="0" max={advance.amount_issued} step="0.01" value={advanceReturns[advance.id] ?? advance.returned_amount} onChange={(event) => setAdvanceReturns({ ...advanceReturns, [advance.id]: event.target.value })} />
                  <button className="btn-secondary" disabled={busy || advance.status === 'awaiting_approval'} onClick={() => returnAdvance(advance)}>Save</button>
                </div></td>
              </tr>)}</tbody>
            </table></div>
            {!advances.length && <p className="empty-state">No shopping advances recorded.</p>}
          </section>
        )}

        {canCalendarRead && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">School-day calendar</p><h2>Holidays and vacations</h2></div></div>
            {canCalendarManage && (
              <form className="feeding-calendar-form" onSubmit={handleCalendarSubmit}>
                <label>Event<input required value={calendarForm.name} onChange={(event) => setCalendarForm({ ...calendarForm, name: event.target.value })} /></label>
                <label>Type<select value={calendarForm.event_type} onChange={(event) => setCalendarForm({ ...calendarForm, event_type: event.target.value })}>
                  <option value="holiday">Holiday</option><option value="vacation">School vacation</option><option value="school_day">Additional school day</option>
                </select></label>
                <label>Start<input type="date" required value={calendarForm.start_date} onChange={(event) => setCalendarForm({ ...calendarForm, start_date: event.target.value })} /></label>
                <label>End<input type="date" required value={calendarForm.end_date} onChange={(event) => setCalendarForm({ ...calendarForm, end_date: event.target.value })} /></label>
                <button className="btn-primary" disabled={busy}>Add calendar dates</button>
              </form>
            )}
            <div className="table-wrap"><table>
              <thead><tr><th>Event</th><th>Type</th><th>Start</th><th>End</th>{canCalendarManage && <th>Action</th>}</tr></thead>
              <tbody>{calendarEvents.map((event) => <tr key={event.id}><td>{event.name}</td><td>{event.event_type.replace('_', ' ')}</td><td>{String(event.start_date).slice(0, 10)}</td><td>{String(event.end_date).slice(0, 10)}</td>{canCalendarManage && <td><button className="btn-secondary" onClick={() => removeCalendarEvent(event.id)}>Remove</button></td>}</tr>)}</tbody>
            </table></div>
          </section>
        )}

        {canReport && (
          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Reports</p><h2>Feeding and tuckshop summary</h2></div></div>
            <form className="feeding-report-form" onSubmit={handleReport}>
              <label>From<input type="date" required value={reportDates.startDate} onChange={(event) => setReportDates({ ...reportDates, startDate: event.target.value })} /></label>
              <label>To<input type="date" required value={reportDates.endDate} onChange={(event) => setReportDates({ ...reportDates, endDate: event.target.value })} /></label>
              <button className="btn-primary">Generate report</button>
            </form>
            {report && <div className="module-stats">
              {report.feeding && <div className="mini-stat"><span>Feeding payments ({report.feeding.count})</span><strong>{money(report.feeding.total)}</strong></div>}
              {report.tuckshop && <div className="mini-stat"><span>Tuckshop sales ({report.tuckshop.count})</span><strong>{money(report.tuckshop.total)}</strong></div>}
              {report.tuckshop && <div className="mini-stat"><span>Cost of goods sold ({report.tuckshop.costedSalesCount} costed sales)</span><strong>{money(report.tuckshop.costOfGoodsSold)}</strong></div>}
              {report.tuckshop && <div className="mini-stat"><span>Gross profit on costed sales</span><strong>{money(report.tuckshop.grossProfit)}</strong></div>}
              {report.approvedPurchases?.map((purchase) => <div className="mini-stat" key={purchase.purpose}><span>{purchase.purpose} purchases ({purchase.count})</span><strong>{money(purchase.total)}</strong></div>)}
            </div>}
            {report?.feedingCollections && (
              <>
                <h3>Daily collections</h3>
                <div className="table-wrap"><table>
                  <thead><tr><th>Date</th><th>Payments</th><th>Students</th><th>Feeding days issued</th><th>Collected</th></tr></thead>
                  <tbody>{report.feedingCollections.byDate.map((row) => <tr key={row.collection_date}><td>{row.collection_date}</td><td>{row.payment_count}</td><td>{row.student_count}</td><td>{row.feeding_days}</td><td>{money(row.total)}</td></tr>)}</tbody>
                </table></div>
                <div className="split-layout">
                  <div><h3>Collections by class</h3><div className="table-wrap"><table><thead><tr><th>Class</th><th>Students</th><th>Payments</th><th>Total</th></tr></thead><tbody>{report.feedingCollections.byClass.map((row) => <tr key={row.class_name || 'unassigned'}><td>{row.class_name || 'Unassigned'}</td><td>{row.student_count}</td><td>{row.payment_count}</td><td>{money(row.total)}</td></tr>)}</tbody></table></div></div>
                  <div><h3>Collections by method</h3><div className="table-wrap"><table><thead><tr><th>Method</th><th>Payments</th><th>Total</th></tr></thead><tbody>{report.feedingCollections.byPaymentMethod.map((row) => <tr key={row.payment_method}><td>{row.payment_method.replace('_', ' ')}</td><td>{row.payment_count}</td><td>{money(row.total)}</td></tr>)}</tbody></table></div></div>
                </div>
                <h3>Collections by staff member</h3>
                <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Payments</th><th>Total</th></tr></thead><tbody>{report.feedingCollections.byStaff.map((row) => <tr key={row.staff_name}><td>{row.staff_name}</td><td>{row.payment_count}</td><td>{money(row.total)}</td></tr>)}</tbody></table></div>
              </>
            )}
            {report?.tuckshopCollections && (
              <>
                <h3>Tuckshop daily sales by payment method</h3>
                <div className="table-wrap"><table>
                  <thead><tr><th>Date</th><th>Transactions</th><th>Cash</th><th>Mobile money</th><th>Other</th><th>Total</th></tr></thead>
                  <tbody>{report.tuckshopCollections.map((row) => <tr key={row.sale_date}><td>{String(row.sale_date).slice(0, 10)}</td><td>{row.transaction_count}</td><td>{money(row.cash_total)}</td><td>{money(row.mobile_money_total)}</td><td>{money(row.other_total)}</td><td>{money(row.total)}</td></tr>)}</tbody>
                </table></div>
              </>
            )}
          </section>
        )}
      </div>

      {receipt && (
        <div className="modal-overlay" onClick={() => setReceipt(null)}>
          <section className="modal feeding-receipt" onClick={(event) => event.stopPropagation()}>
            <h2>Feeding payment receipt</h2>
            <p><strong>Receipt:</strong> {receipt.receipt_number}</p>
            <p><strong>Student:</strong> {receipt.student_name}</p>
            <p><strong>Class:</strong> {receipt.class_name || '—'}</p>
            <p><strong>Amount received:</strong> {money(receipt.amount_received)}</p>
            <p><strong>Daily rate:</strong> {money(receipt.daily_rate)}</p>
            <p><strong>Payment method:</strong> {receipt.payment_method?.replace('_', ' ') || 'cash'}</p>
            {receipt.payment_reference && <p><strong>Payment reference:</strong> {receipt.payment_reference}</p>}
            <p><strong>Feeding days covered:</strong> {receipt.days_covered}</p>
            <p><strong>Coverage:</strong> {receipt.coverage_start ? `${String(receipt.coverage_start).slice(0, 10)} – ${String(receipt.coverage_end).slice(0, 10)}` : 'Credit only'}</p>
            <p><strong>Credit:</strong> {money(receipt.credit_added)}</p>
            <p><strong>Payment date:</strong> {String(receipt.payment_date).slice(0, 10)}</p>
            <p><strong>Received by:</strong> {receipt.received_by_name || '—'}</p>
            <div className="modal-actions"><button className="btn-secondary" onClick={() => setReceipt(null)}>Close</button><button className="btn-primary" onClick={() => window.print()}>Print receipt</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

export default Feeding;
