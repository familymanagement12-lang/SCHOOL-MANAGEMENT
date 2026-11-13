import { useEffect, useMemo, useState } from 'react';
import { getImportedFinanceFigures } from '../api/feeding';

const money = (value) => `GH₵${Number(value || 0).toFixed(2)}`;
const accountName = (module) => ({
  feeding: 'Feeding',
  tuckshop: 'Tuckshop',
  marketing: 'Marketing',
}[module] || module);

function FeedingHistoricalFinance({ modules }) {
  const [data, setData] = useState({ entries: [], totals: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getImportedFinanceFigures()
      .then((response) => active && setData(response.data))
      .catch((err) => active && setError(err.response?.data?.message || 'Unable to load imported workbook figures.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const entries = useMemo(
    () => data.entries.filter((entry) => modules.includes(entry.module)),
    [data.entries, modules]
  );
  const totals = useMemo(
    () => data.totals.filter((entry) => modules.includes(entry.module)),
    [data.totals, modules]
  );
  const countedTotal = (type) => totals
    .filter((entry) => entry.entry_type === type)
    .reduce((sum, entry) => sum + Number(entry.total || 0), 0);

  return (
    <section className="feeding-historical-finance">
      <h3>Imported workbook figures · operational accounts</h3>
      <p className="muted-copy">
        Historical figures are available in the separate Feeding/Tuckshop accounts. They do not enter Fees income and expenditure and do not change student balances or stock.
      </p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {loading && <p className="muted-copy">Loading imported workbook figures…</p>}
      {!loading && !error && (
        <>
          <div className="module-stats">
            <div className="mini-stat"><span>Imported income</span><strong>{money(countedTotal('income'))}</strong></div>
            <div className="mini-stat"><span>Imported expenditure</span><strong>{money(countedTotal('expense'))}</strong></div>
            <div className="mini-stat"><span>Net</span><strong>{money(countedTotal('income') - countedTotal('expense'))}</strong></div>
            <div className="mini-stat">
              <span>Source detail retained</span>
              <strong>{entries.filter((entry) => !entry.counts_in_totals).length}</strong>
            </div>
          </div>
          {modules.includes('feeding') && (
            <p className="muted-copy">
              Reconciliation note: Feeding Week 4 is GH₵11,125 in the dated term ledger and GH₵12,620 in the Lunch and annual summaries. The dated ledger drives totals; the other figure remains available below as supporting detail.
            </p>
          )}
          <details>
            <summary>View all imported workbook figures ({entries.length})</summary>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Period</th><th>Account</th><th>Type</th><th>Figure</th><th>Source detail</th><th>Amount</th><th>Totals</th>
                </tr></thead>
                <tbody>{entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.period_label}</td>
                    <td>{accountName(entry.module)}</td>
                    <td>{entry.entry_type}</td>
                    <td>{entry.description}</td>
                    <td>{entry.source_file} · {entry.sheet_name} · row {entry.source_row} ({entry.source_column})</td>
                    <td>{money(entry.amount)}</td>
                    <td>{entry.counts_in_totals ? 'Counted' : entry.support_reason || 'Supporting only'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {!entries.length && <p className="muted-copy">No figures have been imported for this account.</p>}
          </details>
        </>
      )}
    </section>
  );
}

export default FeedingHistoricalFinance;
