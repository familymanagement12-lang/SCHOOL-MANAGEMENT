import { useEffect, useState } from 'react';
import api from '../api/api';

function FinanceAudit() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dashboard/finance/audit?limit=100')
      .then((response) => setEntries(response.data))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Unable to load finance audit history.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero"><div><p className="eyebrow">Finance controls</p><h1>Finance Audit Trail</h1><p>Recorded changes to fees, transactions, fee structures, payroll, and payroll deductions.</p></div></section>
        {error && <div className="error" role="alert">{error}</div>}
        {loading ? <p>Loading audit history…</p> : (
          <section className="data-panel table-wrap">
            <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Change details</th></tr></thead>
              <tbody>{entries.map((entry) => <tr key={entry.id}>
                <td>{new Date(entry.created_at).toLocaleString()}</td>
                <td>{entry.actor_name || entry.actor_role}</td>
                <td>{entry.action}</td>
                <td>{entry.table_name} #{entry.record_id}</td>
                <td><details><summary>View before / after</summary><pre style={{ whiteSpace: 'pre-wrap', maxWidth: 560, overflowWrap: 'anywhere' }}>{JSON.stringify({ before: entry.old_data, after: entry.new_data }, null, 2)}</pre></details></td>
              </tr>)}</tbody>
            </table>
            {!entries.length && <p className="empty-state">No finance changes have been recorded yet.</p>}
          </section>
        )}
      </div>
    </div>
  );
}

export default FinanceAudit;
