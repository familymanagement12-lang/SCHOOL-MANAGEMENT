import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFeesByStudent } from '../api/fees';
import { getStudents } from '../api/students';
import { getClasses } from '../api/classes';
import { createFeeStructure } from '../api/fees';
import {
  getFeedingAccount, getFeedingTerms, getPaymentReceipts, recordSchoolPayment, refundPayment,
} from '../api/feeding';

const newPaymentKey = () => window.crypto?.randomUUID?.()
  || `payment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const refundableAmount = (receipt, component) => {
  const amount = Number(component === 'school_fee' ? receipt.school_fee_amount : receipt.feeding_amount);
  const refunded = receipt.refunds
    .filter((refund) => refund.component === component)
    .reduce((total, refund) => total + Number(refund.amount), 0);
  return Math.max(0, amount - refunded);
};

const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    return null;
  }
};

function Fees() {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [fees, setFees] = useState([]);
  const [feedingAccount, setFeedingAccount] = useState(null);
  const [feedingTerms, setFeedingTerms] = useState([]);
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [paymentReceipts, setPaymentReceipts] = useState([]);
  const [refundReceipt, setRefundReceipt] = useState(null);
  const [refundForm, setRefundForm] = useState({
    component: 'school_fee',
    amount: '',
    reason: '',
    reference: '',
    refund_date: new Date().toISOString().split('T')[0],
  });
  const refundKey = useRef(newPaymentKey());
  const paymentKey = useRef(newPaymentKey());
  const [formData, setFormData] = useState({
    school_fee_amount: '',
    feeding_amount: '',
    payment_method: 'cash',
    payment_date: new Date().toISOString().split('T')[0],
    reference: '',
    academic_year: '',
    term: '',
  });
  const [showStructureModal, setShowStructureModal] = useState(false);
  const [structureData, setStructureData] = useState({
    academic_year: '2026/2027',
    term: 'First Term',
    class_ids: [],
    items: [{ fee_name: 'Tuition Fee', amount: '' }, { fee_name: 'PTA Fee', amount: '' }],
    student_overrides: {},
  });
  const [isBilling, setIsBilling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = getCurrentUser();

  useEffect(() => {
    fetchSetupData();
  }, []);

  useEffect(() => {
    if (selectedStudent) {
      fetchFees(selectedStudent);
      getPaymentReceipts({ student_id: selectedStudent })
        .then((response) => setPaymentReceipts(response.data))
        .catch((requestError) => setError(requestError.response?.data?.message || 'Unable to load payment receipts.'));
      getFeedingAccount(selectedStudent)
        .then((response) => setFeedingAccount(response.data))
        .catch(() => setFeedingAccount(null));
    } else {
      setFees([]);
      setPaymentReceipts([]);
      setFeedingAccount(null);
    }
  }, [selectedStudent]);

  const fetchSetupData = async () => {
    try {
      const [studentsRes, classesRes] = await Promise.all([
        getStudents(),
        getClasses()
      ]);
      const termsRes = await getFeedingTerms();
      setStudents(studentsRes.data);
      setClasses(classesRes.data);
      setFeedingTerms(termsRes.data);
      setSelectedStudent(studentsRes.data[0]?.id ? String(studentsRes.data[0].id) : '');
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load data');
      setLoading(false);
    }
  };

  const fetchFees = async (studentId) => {
    try {
      const response = await getFeesByStudent(studentId);
      setFees(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load fees');
    }
  };

  const selectedStudentRecord = students.find((student) => String(student.id) === selectedStudent);
  const selectedStructureStudents = useMemo(
    () => students.filter((student) => structureData.class_ids.map(String).includes(String(student.class_id))),
    [students, structureData.class_ids]
  );
  const standardStructureAmount = useMemo(
    () => Math.round(structureData.items.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 100) / 100,
    [structureData.items]
  );

  const totals = useMemo(() => fees.reduce((sum, fee) => ({
    due: sum.due + Number(fee.amount_due || 0),
    paid: sum.paid + Number(fee.amount_paid || 0),
    balance: sum.balance + Number(fee.balance || 0),
  }), { due: 0, paid: 0, balance: 0 }), [fees]);

  const currencyCode = localStorage.getItem('sms_currency') || 'GHS';
  const formatMoney = (value) => Number(value || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: currencyCode,
  });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setPaymentReceipt(null);

    try {
      const response = await recordSchoolPayment({
        student_id: selectedStudent,
        school_fee_amount: formData.school_fee_amount || 0,
        feeding_amount: formData.feeding_amount || 0,
        payment_method: formData.payment_method,
        payment_date: formData.payment_date,
        reference: formData.reference,
        academic_year: formData.academic_year || undefined,
        term: formData.term || undefined,
        idempotency_key: paymentKey.current,
      });
      setPaymentReceipt(response.data);
      paymentKey.current = newPaymentKey();
      setFormData({
        school_fee_amount: '',
        feeding_amount: '',
        payment_method: 'cash',
        payment_date: new Date().toISOString().split('T')[0],
        reference: '',
        academic_year: '',
        term: '',
      });
      await fetchFees(selectedStudent);
      getFeedingAccount(selectedStudent).then((account) => setFeedingAccount(account.data)).catch(() => {});
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record payment');
    }
  };

  const handleRefund = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await refundPayment(refundReceipt.id, {
        ...refundForm,
        idempotency_key: refundKey.current,
      });
      setRefundReceipt(null);
      refundKey.current = newPaymentKey();
      const [receiptResponse] = await Promise.all([
        getPaymentReceipts({ student_id: selectedStudent }),
        fetchFees(selectedStudent),
      ]);
      setPaymentReceipts(receiptResponse.data);
      getFeedingAccount(selectedStudent).then((account) => setFeedingAccount(account.data)).catch(() => {});
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record refund');
    }
  };

  const handleGenerateStructure = async (event) => {
    event.preventDefault();
    setError('');
    setIsBilling(true);

    if (structureData.class_ids.length === 0) {
      setError('Please select at least one class to apply this structure to.');
      setIsBilling(false);
      return;
    }

    try {
      // Use direct API call to the new structure endpoint
      const student_overrides = Object.entries(structureData.student_overrides)
        .filter(([, override]) => override.amount_due !== '' && Math.round(Number(override.amount_due) * 100) !== Math.round(standardStructureAmount * 100))
        .map(([student_id, override]) => ({
          student_id: Number(student_id),
          amount_due: Number(override.amount_due),
          reason: override.reason,
        }));
      const res = await createFeeStructure({
        ...structureData,
        student_overrides,
      });
      
      setShowStructureModal(false);
      setStructureData({ academic_year: '2026/2027', term: 'First Term', class_ids: [], items: [{ fee_name: 'Tuition Fee', amount: '' }], student_overrides: {} });
      
      if (selectedStudent) await fetchFees(selectedStudent);
      alert(res.data.message);
    } catch (err) {
      console.error('Fee Structure Upload Error:', err.response || err);
      setError(err.response?.data?.message || 'Failed to generate fee structure. Ensure server.js is updated and SQL is imported.');
    } finally {
      setIsBilling(false);
    }
  };

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero fees-hero">
          <div>
            <p className="eyebrow">Fees</p>
            <h1>Payments Desk</h1>
            <p>Manage school-fee invoices and record cashier payments for school fees, feeding, or both.</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <select value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)}>
              <option value="">Choose student</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.student_id} - {student.name}
                </option>
              ))}
            </select>
            {['admin', 'accountant'].includes(user?.role) && (
              <button className="btn-secondary" onClick={() => setShowStructureModal(true)} style={{ whiteSpace: 'nowrap', backgroundColor: 'white', color: '#0f172a' }}>
                ➕ Create Fee Structure
              </button>
            )}
          </div>
        </section>

        <section className="module-stats">
          <div className="mini-stat"><span>Amount Due</span><strong>{formatMoney(totals.due)}</strong></div>
          <div className="mini-stat"><span>Paid</span><strong>{formatMoney(totals.paid)}</strong></div>
          <div className="mini-stat"><span>Balance</span><strong>{formatMoney(totals.balance)}</strong></div>
        </section>

        <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Cashier-recorded payment</p>
                <h2>{selectedStudentRecord?.name || 'Select a student'}</h2>
              </div>
            </div>

            {error && <div className="error">{error}</div>}

            {selectedStudent && (
              <div style={{ marginBottom: '0.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Outstanding Balance</span>
                <div style={{ fontSize: '1.5rem', fontWeight: '800', color: totals.balance > 0 ? '#ef4444' : '#10b981', marginTop: '0.25rem' }}>
                  {formatMoney(totals.balance)}
                </div>
              </div>
            )}

            <p>Enter the amounts received offline. School-fee receipts are allocated to outstanding billed fees; feeding is recorded in its separate operational ledger.</p>
            <label>School fees received</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.school_fee_amount}
              onChange={(event) => setFormData({ ...formData, school_fee_amount: event.target.value })}
              placeholder="0.00"
            />

            <label>Feeding fees received</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.feeding_amount}
              onChange={(event) => setFormData({ ...formData, feeding_amount: event.target.value })}
              placeholder="0.00"
            />
            {feedingAccount && <p>Feeding balance this period: {formatMoney(feedingAccount.outstanding_balance)} · Advance credit: {formatMoney(feedingAccount.advance_credit)}</p>}

            <label>Payment method</label>
            <select value={formData.payment_method} onChange={(event) => setFormData({ ...formData, payment_method: event.target.value })}>
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile money (recorded by cashier)</option>
              <option value="bank_transfer">Bank transfer (recorded by cashier)</option>
              <option value="other">Other offline payment</option>
            </select>

            <label>Payment Date</label>
            <input
              type="date"
              value={formData.payment_date}
              onChange={(event) => setFormData({ ...formData, payment_date: event.target.value })}
            />

            <label>Payment reference (optional)</label>
            <input
              value={formData.reference}
              onChange={(event) => setFormData({ ...formData, reference: event.target.value })}
              maxLength={120}
            />

            <label>Feeding academic term (optional)</label>
            <select
              value={formData.academic_year && formData.term ? `${formData.academic_year}|${formData.term}` : ''}
              onChange={(event) => {
                const [academic_year = '', term = ''] = event.target.value.split('|');
                setFormData({ ...formData, academic_year, term });
              }}
            >
              <option value="">Use the term covering the payment date</option>
              {feedingTerms.map((feedingTerm) => (
                <option key={feedingTerm.id} value={`${feedingTerm.academic_year}|${feedingTerm.term}`}>
                  {feedingTerm.academic_year} · {feedingTerm.term}
                </option>
              ))}
            </select>

            <button type="submit" className="btn-primary" disabled={!selectedStudent || !(Number(formData.school_fee_amount) > 0 || Number(formData.feeding_amount) > 0)}>Record Payment</button>
            {paymentReceipt && <div className="success">
              Receipt {paymentReceipt.receipt_number}: School fees {formatMoney(paymentReceipt.school_fee_amount)} · Feeding {formatMoney(paymentReceipt.feeding_amount)} · Total {formatMoney(paymentReceipt.amount_total)}.
              <div><Link to={`/payment-receipt/${paymentReceipt.id}`}>Open printable receipt</Link></div>
            </div>}
          </form>

          <section className="data-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">History</p>
                <h2>Fee Records</h2>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Due</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Due Date</th>
                    <th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.map((fee) => (
                    <tr key={fee.id}>
                      <td>{fee.description || '-'}{fee.is_fee_override && <div style={{ color: '#b45309', fontSize: '.8rem' }}>Individual adjustment: {fee.fee_override_reason}</div>}</td>
                      <td>{formatMoney(fee.amount_due)}</td>
                      <td>{formatMoney(fee.amount_paid)}</td>
                      <td><span className={Number(fee.balance) > 0 ? 'balance-due' : 'balance-clear'}>{formatMoney(fee.balance)}</span></td>
                      <td>{fee.due_date || '-'}</td>
                      <td>
                        {Number(fee.amount_paid) > 0 && <Link to={`/receipt/${selectedStudent}/${fee.id}`} className="btn-small btn-secondary" style={{ textDecoration: 'none', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>🖨️ Print</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fees.length === 0 && <p className="empty-state">No fee records for this student yet.</p>}
          </section>
        </section>

        <section className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">Shared receipts</p><h2>Payment and refund history</h2></div></div>
          <div className="table-wrap">
            <table><thead><tr><th>Date</th><th>Receipt</th><th>School fees</th><th>Feeding</th><th>Total</th><th>Refunds</th><th>Reference</th><th>Actions</th></tr></thead>
              <tbody>{paymentReceipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td>{receipt.payment_date}</td><td>{receipt.receipt_number}</td>
                  <td>{formatMoney(receipt.school_fee_amount)}</td><td>{formatMoney(receipt.feeding_amount)}</td>
                  <td>{formatMoney(receipt.amount_total)}</td>
                  <td>{receipt.refunds.map((refund) => `${refund.component}: ${formatMoney(refund.amount)}`).join(', ') || '-'}</td>
                  <td>{receipt.reference || '-'}</td>
                  <td className="actions">
                    <Link className="btn-small btn-edit" to={`/payment-receipt/${receipt.id}`}>Receipt</Link>
                    {(refundableAmount(receipt, 'school_fee') > 0 || refundableAmount(receipt, 'feeding') > 0)
                      && <button className="btn-small btn-edit" onClick={() => {
                        const component = refundableAmount(receipt, 'school_fee') > 0 ? 'school_fee' : 'feeding';
                        setRefundForm({
                          component, amount: '', reason: '', reference: '',
                          refund_date: new Date().toISOString().split('T')[0],
                        });
                        setRefundReceipt(receipt);
                        refundKey.current = newPaymentKey();
                      }}>Refund</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!paymentReceipts.length && <p className="empty-state">No receipts recorded for this student.</p>}
        </section>
      </div>

      {refundReceipt && <div className="modal-overlay" onClick={() => setRefundReceipt(null)}>
        <div className="modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header"><h2>Refund receipt {refundReceipt.receipt_number}</h2><button className="btn-close" onClick={() => setRefundReceipt(null)}>x</button></div>
          <form className="form-panel" onSubmit={handleRefund}>
            <label>Component<select value={refundForm.component} onChange={(event) => setRefundForm({ ...refundForm, component: event.target.value })}>
              {refundableAmount(refundReceipt, 'school_fee') > 0 && <option value="school_fee">School fees</option>}
              {refundableAmount(refundReceipt, 'feeding') > 0 && <option value="feeding">Feeding</option>}
            </select></label>
            <label>Refund amount<input type="number" min="0.01" step="0.01" value={refundForm.amount} onChange={(event) => setRefundForm({ ...refundForm, amount: event.target.value })} required /></label>
            <label>Reason<input value={refundForm.reason} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} maxLength={500} required /></label>
            <label>Reference<input value={refundForm.reference} onChange={(event) => setRefundForm({ ...refundForm, reference: event.target.value })} maxLength={120} /></label>
            <label>Refund date<input type="date" value={refundForm.refund_date} onChange={(event) => setRefundForm({ ...refundForm, refund_date: event.target.value })} required /></label>
            <button type="submit" className="btn-primary">Record refund</button>
          </form>
        </div>
      </div>}

      {showStructureModal && (
        <div className="modal-overlay" onClick={() => setShowStructureModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '950px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2>Create Fee Structure</h2>
              <button className="btn-close" onClick={() => setShowStructureModal(false)}>x</button>
            </div>
            <form onSubmit={handleGenerateStructure}>
              
              {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                <div>
                  <label>Academic Year</label>
                  <select value={structureData.academic_year} onChange={(e) => setStructureData({...structureData, academic_year: e.target.value})}>
                    <option value="2025/2026">2025/2026</option>
                    <option value="2026/2027">2026/2027</option>
                    <option value="2027/2028">2027/2028</option>
                  </select>
                </div>
                <div>
                  <label>Term / Semester</label>
                  <select value={structureData.term} onChange={(e) => setStructureData({...structureData, term: e.target.value})}>
                    <option value="First Term">First Term</option>
                    <option value="Second Term">Second Term</option>
                    <option value="Third Term">Third Term</option>
                  </select>
                </div>
              </div>

              <label>Classes to apply this structure to:</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', maxHeight: '150px', overflowY: 'auto' }}>
                {classes.map(cls => (
                  <label key={cls.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontWeight: 'normal', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      style={{ width: 'auto', margin: 0 }}
                      checked={structureData.class_ids.includes(cls.id)}
                      onChange={(e) => {
                        const updated = e.target.checked 
                          ? [...structureData.class_ids, cls.id]
                          : structureData.class_ids.filter(id => id !== cls.id);
                        setStructureData({...structureData, class_ids: updated});
                      }}
                    />
                    {cls.name}
                  </label>
                ))}
              </div>

              {selectedStructureStudents.length > 0 && (
                <section style={{ marginBottom: '1.5rem' }}>
                  <div style={{ marginBottom: '.75rem' }}>
                    <h3 style={{ marginBottom: '.25rem' }}>Individual student fee adjustments</h3>
                    <p style={{ color: '#64748b', margin: 0 }}>Leave an amount blank to use the class total of {formatMoney(standardStructureAmount)}. Enter a different amount and a reason for a student-specific adjustment.</p>
                  </div>
                  <div className="table-wrap" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                    <table>
                      <thead><tr><th>Student</th><th>Class amount</th><th>Student amount</th><th>Reason for difference</th></tr></thead>
                      <tbody>{selectedStructureStudents.map((student) => {
                        const override = structureData.student_overrides[student.id] || { amount_due: '', reason: '' };
                        return <tr key={student.id}>
                          <td>{student.student_id} · {student.name}</td>
                          <td>{formatMoney(standardStructureAmount)}</td>
                          <td><input aria-label={`Fee amount for ${student.name}`} type="number" min="0" step=".01" value={override.amount_due} onChange={(event) => setStructureData((previous) => ({
                            ...previous,
                            student_overrides: {
                              ...previous.student_overrides,
                              [student.id]: { ...override, amount_due: event.target.value },
                            },
                          }))} placeholder="Use class amount" /></td>
                          <td><input aria-label={`Fee adjustment reason for ${student.name}`} value={override.reason} onChange={(event) => setStructureData((previous) => ({
                            ...previous,
                            student_overrides: {
                              ...previous.student_overrides,
                              [student.id]: { ...override, reason: event.target.value },
                            },
                          }))} placeholder="Required if amount differs" maxLength={500} required={override.amount_due !== '' && Math.round(Number(override.amount_due) * 100) !== Math.round(standardStructureAmount * 100)} /></td>
                        </tr>;
                      })}</tbody>
                    </table>
                  </div>
                </section>
              )}

              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
                <span style={{ fontSize: '1.1rem', color: '#0f172a' }}>Fee Items</span>
                <button 
                  type="button" 
                  className="btn-small btn-secondary" 
                  onClick={() => setStructureData({...structureData, items: [...structureData.items, {fee_name: '', amount: ''}]})}
                  style={{ background: 'white' }}
                >
                  + Add Fee Item
                </button>
              </label>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {structureData.items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <input type="text" placeholder="e.g. ICT Fee" value={item.fee_name} onChange={(e) => {
                      const newItems = [...structureData.items];
                      newItems[idx].fee_name = e.target.value;
                      setStructureData({...structureData, items: newItems});
                    }} required style={{ flex: 2, margin: 0 }} />
                    
                    <input type="number" min="0" step="0.01" placeholder="Amount" value={item.amount} onChange={(e) => {
                      const newItems = [...structureData.items];
                      newItems[idx].amount = e.target.value;
                      setStructureData({...structureData, items: newItems});
                    }} required style={{ flex: 1, margin: 0 }} />
                    
                    <button type="button" onClick={() => {
                      if (structureData.items.length > 1) {
                        setStructureData({...structureData, items: structureData.items.filter((_, i) => i !== idx)});
                      }
                    }} style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', fontSize: '1.2rem', cursor: 'pointer', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>&times;</button>
                  </div>
                ))}
              </div>

              <div style={{ background: '#eff8fd', padding: '1.25rem', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', border: '1px solid #078fc4' }}>
                <span style={{ fontWeight: 'bold', color: '#075e9a', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Amount:</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '900', color: '#075e9a' }}>
                  {formatMoney(structureData.items.reduce((sum, item) => sum + Number(item.amount || 0), 0))}
                </span>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowStructureModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isBilling}>
                  {isBilling ? 'Applying...' : 'Save & Apply Structure'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Fees;
