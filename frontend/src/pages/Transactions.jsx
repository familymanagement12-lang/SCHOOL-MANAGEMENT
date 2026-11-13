import { useEffect, useMemo, useState } from 'react';
import { getTransactions, getFinanceReport, createTransaction, deleteTransaction } from '../api/transactions';

function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    type: 'income',
    category: '',
    amount: '',
    reference: '',
    description: '',
    date: new Date().toISOString().split('T')[0]
  });

  // Report Generator State
  const [reportModal, setReportModal] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportDates, setReportDates] = useState({
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      const res = await getTransactions();
      setTransactions(res.data);
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load financial records');
      setLoading(false);
    }
  };

  const currencyCode = localStorage.getItem('sms_currency') || 'USD';
  const formatMoney = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: currencyCode });

  const totals = useMemo(() => transactions.reduce((acc, t) => {
    if (t.type === 'income') acc.income += Number(t.amount);
    if (t.type === 'expenditure') acc.expenditure += Number(t.amount);
    acc.balance = acc.income - acc.expenditure;
    return acc;
  }, { income: 0, expenditure: 0, balance: 0 }), [transactions]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await createTransaction(formData);
      setFormData({ ...formData, category: '', amount: '', reference: '', description: '' });
      await fetchTransactions();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record transaction');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this transaction permanently?')) return;
    try {
      await deleteTransaction(id);
      await fetchTransactions();
    } catch (err) {
      setError('Failed to delete transaction');
    }
  };

  const handleGenerateReport = async (e) => {
    e.preventDefault();
    setError('');
    setIsGenerating(true);
    try {
      const res = await getFinanceReport(reportDates.startDate, reportDates.endDate);
      setReportData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to generate report');
    } finally {
      setIsGenerating(false);
    }
  };

  if (loading) return <div className="page"><p>Loading...</p></div>;

  // Helper variables for the visual charts
  const totalFlow = reportData ? reportData.totalIncome + reportData.totalExpenditure : 0;
  const incomePct = totalFlow > 0 ? (reportData.totalIncome / totalFlow) * 100 : 50;
  const expPct = totalFlow > 0 ? (reportData.totalExpenditure / totalFlow) * 100 : 50;
  const topIncome = reportData && reportData.income.length > 0 ? reportData.income.reduce((a, b) => a.amount > b.amount ? a : b) : null;
  const topExpense = reportData && reportData.expenditure.length > 0 ? reportData.expenditure.reduce((a, b) => a.amount > b.amount ? a : b) : null;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero" style={{ background: 'linear-gradient(135deg, #166534 0%, #15803d 100%)', color: 'white' }}>
          <div>
            <p className="eyebrow" style={{ color: '#bbf7d0' }}>Financial Controls</p>
            <h1 style={{ color: 'white' }}>Income & Expenditure</h1>
            <p style={{ color: '#f0fdf4' }}>Track daily operational expenses and extra income sources.</p>
          </div>
        </section>

        <section className="module-stats">
          <div className="mini-stat"><span>Total Income</span><strong style={{ color: '#075e9a' }}>{formatMoney(totals.income)}</strong></div>
          <div className="mini-stat"><span>Total Expenditure</span><strong style={{ color: '#ef4444' }}>{formatMoney(totals.expenditure)}</strong></div>
          <div className="mini-stat"><span>Net Balance</span><strong style={{ color: totals.balance >= 0 ? '#075e9a' : '#ef4444' }}>{formatMoney(totals.balance)}</strong></div>
        </section>

        <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-heading">
              <div><p className="eyebrow">New Record</p><h2>Add Transaction</h2></div>
            </div>
            
            {error && <div className="error">{error}</div>}

            <label>Transaction Type</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', background: '#f8fafc', padding: '0.35rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <button 
                type="button" 
                onClick={() => setFormData({ ...formData, type: 'income' })}
                style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s ease', background: formData.type === 'income' ? '#075e9a' : 'transparent', color: formData.type === 'income' ? 'white' : '#64748b', boxShadow: formData.type === 'income' ? '0 2px 8px rgba(7, 94, 154, 0.3)' : 'none' }}
              >
                ⬇️ Income
              </button>
              <button 
                type="button" 
                onClick={() => setFormData({ ...formData, type: 'expenditure' })}
                style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s ease', background: formData.type === 'expenditure' ? '#ef4444' : 'transparent', color: formData.type === 'expenditure' ? 'white' : '#64748b', boxShadow: formData.type === 'expenditure' ? '0 2px 8px rgba(239, 68, 68, 0.4)' : 'none' }}
              >
                ⬆️ Expenditure
              </button>
            </div>

            <label>Date *</label>
            <input type="date" value={formData.date} onChange={(e) => setFormData({...formData, date: e.target.value})} required />
            
            <label>Category *</label>
            <input type="text" value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} placeholder={formData.type === 'income' ? 'e.g. Donations, Uniform Sales' : 'e.g. Electricity, Repairs'} required />
            
            <label>Amount *</label>
            <input type="number" min="0" step="0.01" value={formData.amount} onChange={(e) => setFormData({...formData, amount: e.target.value})} required />
            
            <label>Description</label>
            <input type="text" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Optional details..." />
            
            <label>Reference No. / Receipt ID</label>
            <input type="text" value={formData.reference} onChange={(e) => setFormData({...formData, reference: e.target.value})} />
            
            <button type="submit" className="btn-primary" style={{ marginTop: '0.5rem', background: formData.type === 'income' ? '#075e9a' : '#ef4444' }}>Record {formData.type === 'income' ? 'Income' : 'Expense'}</button>
          </form>

          <section className="data-panel">
            <div className="panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div><p className="eyebrow">Ledger</p><h2>Transaction History</h2></div>
              <button 
                type="button" 
                onClick={() => setReportModal(true)} 
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'linear-gradient(135deg, #075e9a 0%, #078fc4 100%)', color: 'white', padding: '0.75rem 1.25rem', borderRadius: '8px', border: 'none', fontWeight: 'bold', boxShadow: '0 4px 6px -1px rgba(7, 94, 154, 0.2)', cursor: 'pointer', transition: 'all 0.2s ease' }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 12px -2px rgba(7, 94, 154, 0.3)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(7, 94, 154, 0.2)'; }}
              >
                📊 Generate Financial Report
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Amount</th><th>Ref</th><th>Actions</th></tr></thead>
                <tbody>
                  {transactions.map(t => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(t.date).toLocaleDateString()}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.6rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 'bold', background: t.type === 'income' ? '#e5f4fb' : '#fee2e2', color: t.type === 'income' ? '#075e9a' : '#991b1b', textTransform: 'capitalize' }}>
                          {t.type === 'income' ? '⬇️' : '⬆️'} {t.type}
                        </span>
                      </td>
                      <td><strong>{t.category}</strong><div style={{ fontSize: '0.75rem', color: '#64748b' }}>{t.description}</div></td>
                      <td><strong style={{ color: t.type === 'income' ? '#075e9a' : '#dc2626' }}>{formatMoney(t.amount)}</strong></td>
                      <td style={{ fontSize: '0.85rem' }}>{t.reference || '-'}</td>
                      <td><button className="btn-small btn-delete" onClick={() => handleDelete(t.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {transactions.length === 0 && <p className="empty-state">No financial transactions recorded yet.</p>}
          </section>
        </section>
      </div>

      {reportModal && (
        <div className="modal-overlay" onClick={() => setReportModal(false)}>
          <div className="modal print-section" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px', padding: 0 }}>
            <div className="modal-header no-print">
              <h2>Financial Report</h2>
              <button className="btn-close" onClick={() => { setReportModal(false); setReportData(null); }}>x</button>
            </div>
            
            <div style={{ padding: '2rem' }}>
              {!reportData ? (
                <form onSubmit={handleGenerateReport}>
                  <p style={{ margin: '0 0 1.5rem 0', color: '#64748b' }}>Select a date range to generate a categorized income and expenditure summary.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#334155' }}>Start Date</label>
                      <input type="date" value={reportDates.startDate} onChange={e => setReportDates({...reportDates, startDate: e.target.value})} required style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#334155' }}>End Date</label>
                      <input type="date" value={reportDates.endDate} onChange={e => setReportDates({...reportDates, endDate: e.target.value})} required style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                    </div>
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn-secondary" onClick={() => setReportModal(false)}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={isGenerating}>{isGenerating ? 'Generating...' : 'Generate Summary'}</button>
                  </div>
                </form>
              ) : (
                <div>
                  <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', color: '#0f172a' }}>Financial Summary Report</h2>
                    <p style={{ color: '#64748b', marginTop: '0.5rem' }}>{new Date(reportDates.startDate).toLocaleDateString()} &mdash; {new Date(reportDates.endDate).toLocaleDateString()}</p>
                  </div>

                  {/* 1. Layman's Explanation Block */}
                  <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', marginBottom: '2rem', border: '1px solid #e2e8f0' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1.15rem' }}>📖 What this means in simple terms:</h3>
                    <p style={{ margin: 0, color: '#475569', lineHeight: '1.6', fontSize: '0.95rem' }}>
                      Between <strong>{new Date(reportDates.startDate).toLocaleDateString()}</strong> and <strong>{new Date(reportDates.endDate).toLocaleDateString()}</strong>, your school collected <strong>{formatMoney(reportData.totalIncome)}</strong> and spent <strong>{formatMoney(reportData.totalExpenditure)}</strong>. 
                      As a result, the school {reportData.netBalance >= 0 ? <span style={{color: '#075e9a', fontWeight: 'bold'}}>made a net profit</span> : <span style={{color: '#dc2626', fontWeight: 'bold'}}>took a net loss</span>} of <strong>{formatMoney(Math.abs(reportData.netBalance))}</strong>.
                      {topIncome && <> Your biggest source of money was <strong>{topIncome.category}</strong> ({formatMoney(topIncome.amount)}).</>}
                      {topExpense && <> Your biggest expense was <strong>{topExpense.category}</strong> ({formatMoney(topExpense.amount)}).</>}
                    </p>
                  </div>

                  {/* 2. Visual Charts Block */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '2rem', marginBottom: '2.5rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                      <h4 style={{ margin: 0, color: '#334155' }}>Income vs Expenditure</h4>
                      <div style={{ width: '160px', height: '160px', borderRadius: '50%', background: `conic-gradient(#075e9a ${incomePct}%, #ef4444 0)`, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', fontWeight: 'bold' }}>
                        <span style={{ color: '#075e9a' }}>■ Income ({Math.round(incomePct)}%)</span>
                        <span style={{ color: '#ef4444' }}>■ Expenses ({Math.round(expPct)}%)</span>
                      </div>
                    </div>

                    <div style={{ padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '12px', height: '100%' }}>
                      <h4 style={{ margin: '0 0 1rem 0', color: '#334155' }}>Where your money went (Top Expenses)</h4>
                      {reportData.expenditure.slice(0, 5).map((exp, idx) => {
                        const pct = Math.max((exp.amount / reportData.totalExpenditure) * 100, 1);
                        return (
                          <div key={idx} style={{ marginBottom: '0.85rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#475569', fontWeight: 'bold' }}><span>{exp.category}</span><span>{formatMoney(exp.amount)}</span></div>
                            <div style={{ width: '100%', background: '#f1f5f9', height: '10px', borderRadius: '99px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #f87171, #ef4444)', height: '100%', borderRadius: '99px' }} />
                            </div>
                          </div>
                        )
                      })}
                      {reportData.expenditure.length === 0 && <p style={{ fontSize: '0.9rem', color: '#64748b' }}>No expenses to show.</p>}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2.5rem', marginBottom: '2rem' }}>
                    <div>
                      <h3 style={{ color: '#075e9a', borderBottom: '2px solid #078fc4', paddingBottom: '0.5rem', margin: '0 0 1rem 0' }}>Income</h3>
                      {reportData.income.length === 0 ? <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No income recorded.</p> : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                          <tbody>
                            {reportData.income.map((item, idx) => (
                              <tr key={idx}><td style={{ padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{item.category}</td><td style={{ padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: '600', color: '#0f172a' }}>{formatMoney(item.amount)}</td></tr>
                            ))}
                            <tr><td style={{ padding: '0.75rem 0', fontWeight: '800', color: '#0f172a' }}>Total Income</td><td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: '800', color: '#075e9a' }}>{formatMoney(reportData.totalIncome)}</td></tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                    <div>
                      <h3 style={{ color: '#dc2626', borderBottom: '2px solid #ef4444', paddingBottom: '0.5rem', margin: '0 0 1rem 0' }}>Expenditure</h3>
                      {reportData.expenditure.length === 0 ? <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No expenditure recorded.</p> : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                          <tbody>
                            {reportData.expenditure.map((item, idx) => (
                              <tr key={idx}><td style={{ padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{item.category}</td><td style={{ padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: '600', color: '#0f172a' }}>{formatMoney(item.amount)}</td></tr>
                            ))}
                            <tr><td style={{ padding: '0.75rem 0', fontWeight: '800', color: '#0f172a' }}>Total Expenditure</td><td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: '800', color: '#dc2626' }}>{formatMoney(reportData.totalExpenditure)}</td></tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  <div style={{ background: reportData.netBalance >= 0 ? '#eff8fd' : '#fef2f2', padding: '1.5rem', borderRadius: '12px', border: `1px solid ${reportData.netBalance >= 0 ? '#b7dff1' : '#fecaca'}`, textAlign: 'center' }}>
                    <p style={{ margin: '0 0 0.25rem 0', color: '#475569', textTransform: 'uppercase', fontWeight: '800', fontSize: '0.85rem', letterSpacing: '0.05em' }}>Net Profit / Loss</p>
                    <h2 style={{ margin: 0, fontSize: '2.5rem', color: reportData.netBalance >= 0 ? '#075e9a' : '#dc2626' }}>{formatMoney(reportData.netBalance)}</h2>
                  </div>

                  <div className="modal-actions no-print" style={{ marginTop: '2rem', borderTop: 'none', paddingTop: 0 }}>
                    <button className="btn-secondary" onClick={() => setReportData(null)}>← Back to Dates</button>
                    <button className="btn-primary" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🖨️ Print Report</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Transactions;