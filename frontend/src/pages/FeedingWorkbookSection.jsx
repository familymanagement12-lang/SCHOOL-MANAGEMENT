import { useEffect, useMemo, useState } from 'react';
import { getImportedFinanceFigures } from '../api/feeding';
import FeedingWorkbookArchive from '../components/FeedingWorkbookArchive';
import ImportedWorkbookHistory from '../components/ImportedWorkbookHistory';
import MarketingIncomePanel from '../components/MarketingIncomePanel';
import MarketStockOperations from '../components/MarketStockOperations';

const workbookBySection = {
  market: {
    title: 'Market Stock Register',
    eyebrow: 'Supplier purchases · advances · reconciliation',
    workbook: 'MARKET STOCK SEPT TO DEC, 2026.xlsx',
    description: 'Historical item and supplier detail from the Market Stock workbook. Figures marked supporting are retained for audit and are excluded from totals to avoid double-counting.',
  },
  marketing: {
    title: 'Feeding & Marketing',
    eyebrow: 'Historical weekly figures · academic years',
    workbook: 'FEEDING AND MARKETING 2024_2025.xlsx',
    description: 'Historical feeding income and marketing expenses by workbook period and week. Original worksheet, row, and column references are retained for traceability.',
  },
};

const money = (value) => `GH₵${Number(value || 0).toFixed(2)}`;

function FeedingWorkbookSection({ section }) {
  const config = workbookBySection[section];
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getImportedFinanceFigures()
      .then(({ data }) => {
        if (active) {
          setEntries(data.entries.filter((entry) => entry.source_file === config.workbook));
        }
      })
      .catch((err) => active && setError(err.response?.data?.message || 'Unable to load historical workbook records.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [config.workbook]);

  const filteredEntries = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return entries;
    return entries.filter((entry) => [
      entry.module, entry.entry_type, entry.period_label, entry.description,
      entry.sheet_name, entry.source_row, entry.source_column,
    ].some((value) => String(value || '').toLowerCase().includes(search)));
  }, [entries, query]);

  const total = (type) => entries
    .filter((entry) => entry.counts_in_totals && entry.entry_type === type)
    .reduce((sum, entry) => sum + Number(entry.amount), 0);

  return (
    <div className="page module-page feeding-workbook-page">
      <div className="module-shell">
        <section className="module-hero">
          <div>
            <p className="eyebrow">{config.eyebrow}</p>
            <h1>{config.title}</h1>
            <p>{config.description}</p>
          </div>
        </section>

        {error && <p className="error-message" role="alert">{error}</p>}

        <section className="module-stats" aria-label="Historical totals">
          <div className="mini-stat"><span>Income included in totals</span><strong>{money(total('income'))}</strong></div>
          <div className="mini-stat"><span>Expenses included in totals</span><strong>{money(total('expense'))}</strong></div>
          <div className="mini-stat"><span>Net historical balance</span><strong>{money(total('income') - total('expense'))}</strong></div>
          <div className="mini-stat"><span>Source detail records</span><strong>{entries.length}</strong></div>
        </section>

        <section className="data-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Workbook detail</p><h2>{config.workbook}</h2></div>
            <label>
              Search this workbook
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search period, description, worksheet…" />
            </label>
          </div>
          {loading ? <p className="muted-copy">Loading workbook detail…</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Period / week</th><th>Account</th><th>Type</th><th>Description</th>
                  <th>Amount</th><th>In totals</th><th>Source reference</th>
                </tr></thead>
                <tbody>{filteredEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.period_label}</td>
                    <td>{entry.module}</td>
                    <td>{entry.entry_type}</td>
                    <td>{entry.description}</td>
                    <td>{money(entry.amount)}</td>
                    <td>{entry.counts_in_totals ? 'Yes' : entry.support_reason || 'Supporting detail'}</td>
                    <td>{entry.sheet_name} · row {entry.source_row} · {entry.source_column}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {!loading && !filteredEntries.length && (
            <p className="empty-state">{entries.length ? 'No workbook records match this search.' : 'No historical figures were imported from this workbook.'}</p>
          )}
        </section>

        {section === 'market' && <MarketStockOperations />}
        {section === 'marketing' && <MarketingIncomePanel />}
        <ImportedWorkbookHistory modules={[section]} />
        <FeedingWorkbookArchive />
      </div>
    </div>
  );
}

export default FeedingWorkbookSection;
