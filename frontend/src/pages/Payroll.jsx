import { useEffect, useState, useMemo } from 'react';
import { getPayroll, generatePayroll, markAsPaid, addDeduction } from '../api/payroll';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Payroll() {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const [payroll, setPayroll] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [deductionModal, setDeductionModal] = useState(null);
  const [deductionForm, setDeductionForm] = useState({ type: 'Lateness', amount: '', description: '' });

  useEffect(() => {
    fetchPayroll();
  }, [selectedMonth, selectedYear]);

  const fetchPayroll = async () => {
    setLoading(true);
    try {
      const res = await getPayroll(selectedMonth, selectedYear);
      setPayroll(res.data);
    } catch (err) {
      console.error('Payroll Error:', err);
      setError(err.response?.data?.message || err.message || 'Failed to load payroll records.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setError(''); setSuccessMsg('');
    setIsGenerating(true);
    try {
      const res = await generatePayroll({ month: selectedMonth, year: selectedYear });
      setSuccessMsg(res.data.message);
      await fetchPayroll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to generate payroll.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePay = async (id) => {
    if (!window.confirm('Mark this salary as paid?')) return;
    try {
      await markAsPaid(id);
      await fetchPayroll();
    } catch (err) {
      setError('Failed to mark as paid.');
    }
  };

  const handleAddDeduction = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await addDeduction(deductionModal.id, deductionForm);
      setDeductionModal(null);
      setDeductionForm({ type: 'Lateness', amount: '', description: '' });
      await fetchPayroll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add deduction.');
    }
  };

  const currencyCode = localStorage.getItem('sms_currency') || 'USD';
  const formatMoney = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: currencyCode });

  const stats = useMemo(() => {
    return payroll.reduce((acc, p) => {
      acc.total += Number(p.net_salary);
      if (p.status === 'paid') acc.paid += Number(p.net_salary);
      else acc.pending += Number(p.net_salary);
      return acc;
    }, { total: 0, paid: 0, pending: 0 });
  }, [payroll]);

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', color: 'white', borderRadius: '16px', boxShadow: '0 10px 25px -5px rgba(49, 46, 129, 0.25)' }}>
          <div style={{ flex: 1 }}>
            <p className="eyebrow" style={{ color: '#c7d2fe', fontWeight: '600' }}>Financial Administration</p>
            <h1 style={{ color: '#ffffff', fontSize: '2.5rem', marginTop: '0.25rem', marginBottom: '0.5rem' }}>Payroll Processing</h1>
            <p style={{ color: '#e0e7ff', fontSize: '1.1rem', opacity: 0.9 }}>Generate monthly salaries, track pending payments, and record distributions.</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} style={{ padding: '0.75rem', borderRadius: '8px', border: 'none', fontWeight: 'bold' }}>
              {MONTHS.map((m, idx) => <option key={idx} value={idx + 1}>{m}</option>)}
            </select>
            <input type="number" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} style={{ padding: '0.75rem', borderRadius: '8px', border: 'none', fontWeight: 'bold', width: '90px' }} />
            <button onClick={handleGenerate} disabled={isGenerating} className="btn-primary" style={{ background: '#10b981', marginLeft: '0.5rem' }}>{isGenerating ? 'Generating...' : '⚡ Generate Run'}</button>
          </div>
        </section>

        <section className="module-stats">
          <div className="mini-stat"><span>Total Payroll ({MONTHS[selectedMonth-1]})</span><strong style={{ color: '#0f172a' }}>{formatMoney(stats.total)}</strong></div>
          <div className="mini-stat"><span>Total Paid</span><strong style={{ color: '#10b981' }}>{formatMoney(stats.paid)}</strong></div>
          <div className="mini-stat"><span>Pending Clearance</span><strong style={{ color: stats.pending > 0 ? '#ef4444' : '#64748b' }}>{formatMoney(stats.pending)}</strong></div>
          <div className="mini-stat"><span>Staff Included</span><strong style={{ color: '#3b82f6' }}>{payroll.length}</strong></div>
        </section>

        <section className="data-panel" style={{ padding: '2rem' }}>
          <div className="panel-heading"><div><p className="eyebrow">Ledger</p><h2>Salary Distribution List</h2></div></div>
          {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}
          {successMsg && <div style={{ color: '#059669', background: '#d1fae5', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', fontWeight: 'bold' }}>{successMsg}</div>}
          
          {loading ? <p>Loading payroll records...</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Gross</th><th>Deductions</th><th>Net Pay</th><th>Bank Info</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {payroll.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.full_name}</strong><div style={{ fontSize: '0.75rem', color: '#64748b' }}>{p.role}</div></td>
                      <td>{formatMoney(p.gross_salary)}</td>
                      <td>
                        <div style={{ color: '#ef4444', fontWeight: 'bold' }}>- {formatMoney(p.deductions)}</div>
                        {p.deductions_list?.length > 0 && (
                          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem', maxWidth: '200px', whiteSpace: 'normal', lineHeight: '1.2' }}>
                            {p.deductions_list.map(d => `${d.type}: -${formatMoney(d.amount)}`).join(', ')}
                          </div>
                        )}
                        {p.status === 'pending' && (
                          <button className="btn-small" style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fca5a5', padding: '0.15rem 0.4rem', fontSize: '0.7rem', marginTop: '0.3rem' }} onClick={() => setDeductionModal(p)}>+ Add Deduction</button>
                        )}
                      </td>
                      <td><strong style={{ color: '#059669' }}>{formatMoney(p.net_salary)}</strong></td>
                      <td style={{ fontSize: '0.85rem', color: '#475569' }}>{p.bank_name}<br/>{p.bank_account}</td>
                      <td><span className={`status-pill ${p.status === 'paid' ? 'present' : 'absent'}`}>{p.status.toUpperCase()}</span></td>
                      <td>
                        {p.status === 'pending' ? (
                          <button className="btn-small btn-primary" style={{ background: '#3b82f6' }} onClick={() => handlePay(p.id)}>Mark Paid</button>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 'bold' }}>✓ Cleared</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {payroll.length === 0 && <p className="empty-state">No payroll records generated for {MONTHS[selectedMonth-1]} {selectedYear}.</p>}
            </div>
          )}
        </section>
      </div>

      {deductionModal && (
        <div className="modal-overlay" onClick={() => setDeductionModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Deduction</h2>
              <button className="btn-close" onClick={() => setDeductionModal(null)}>x</button>
            </div>
            <form onSubmit={handleAddDeduction}>
              <p style={{ margin: '0 0 1rem 0', color: '#475569', fontSize: '0.9rem' }}>Deducting from <strong>{deductionModal.full_name}</strong>'s {MONTHS[selectedMonth-1]} salary.</p>
              
              <label>Deduction Type *</label>
              <select value={deductionForm.type} onChange={(e) => setDeductionForm({...deductionForm, type: e.target.value})} required>
                <option value="Lateness">Lateness Penalty</option>
                <option value="Absence">Absence Penalty</option>
                <option value="Loan Repayment">Loan Repayment</option>
                <option value="Damages">Damages / Penalties</option>
                <option value="Other">Other</option>
              </select>
              <label>Amount *</label>
              <input type="number" min="0" step="0.01" value={deductionForm.amount} onChange={(e) => setDeductionForm({...deductionForm, amount: e.target.value})} required />
              <label>Description / Reason</label>
              <input type="text" value={deductionForm.description} onChange={(e) => setDeductionForm({...deductionForm, description: e.target.value})} placeholder="e.g. Missed 2 days of work without notice" />
              
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setDeductionModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ background: '#ef4444' }}>Apply Penalty</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
export default Payroll;