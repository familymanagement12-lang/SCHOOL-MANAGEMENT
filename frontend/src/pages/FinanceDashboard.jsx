import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/api';

const money = (value) => Number(value || 0).toLocaleString(undefined, {
  style: 'currency',
  currency: localStorage.getItem('sms_currency') || 'USD',
});

function FinanceDashboard() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/finance')
      .then((response) => setSummary(response.data))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Unable to load finance overview.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page"><p>Loading finance overview…</p></div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;

  return (
    <div className="page dashboard-page">
      <div className="dashboard-shell">
        <section className="dashboard-hero overview-hero">
          <div><p className="eyebrow">Finance workspace</p><h1>Finance Overview</h1><p className="hero-copy">Fees, transactions, payroll, and finance audit history.</p></div>
        </section>
        <section className="stats-grid">
          <article className="stat-card overview-stat stat-emerald"><div className="stat-topline"><span>Income</span></div><strong>{money(summary.transactions.income)}</strong></article>
          <article className="stat-card overview-stat stat-amber"><div className="stat-topline"><span>Expenditure</span></div><strong>{money(summary.transactions.expenditure)}</strong></article>
          <article className="stat-card overview-stat stat-sky"><div className="stat-topline"><span>Fee balance</span></div><strong>{money(summary.fees.balance)}</strong><p>{money(summary.fees.paid)} received</p></article>
          <article className="stat-card overview-stat stat-violet"><div className="stat-topline"><span>Pending payroll</span></div><strong>{money(summary.payroll.pending)}</strong><p>{summary.payroll.records} payroll records</p></article>
        </section>
        <section className="split-layout">
          <article className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Finance operations</p><h2>Manage school finances</h2></div></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              <Link to="/fees" className="btn-primary">Fees and payments</Link>
              <Link to="/transactions" className="btn-secondary">Income and expenditure</Link>
              <Link to="/payroll" className="btn-secondary">Payroll</Link>
              <Link to="/finance-audit" className="btn-secondary">Audit trail</Link>
            </div>
          </article>
          <article className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Access boundary</p><h2>Finance role</h2></div></div>
            <p>Accountant access is limited to fees, transactions, payroll, finance reports, and finance audit history. User administration, school settings, academic records, and staff management remain administrator-only.</p>
          </article>
        </section>
      </div>
    </div>
  );
}

export default FinanceDashboard;
