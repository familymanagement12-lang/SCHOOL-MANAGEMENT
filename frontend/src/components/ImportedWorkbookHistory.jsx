import { useEffect, useMemo, useState } from 'react';
import { getImportedWorkbookRows } from '../api/feeding';
import { hasOperationalPermission } from '../utils/operationalPermissions';

const moduleLabels = {
  lunch: 'Lunch Register',
  purchases: 'Kitchen & Tuckshop Purchases',
  market: 'Market Stock',
  marketing: 'Feeding & Marketing',
};
const modulePermissions = {
  lunch: ['feeding.students.read', 'feeding.payments.read', 'feeding.reports.read'],
  purchases: ['feeding.purchases.read', 'tuckshop.purchases.read', 'feeding.reports.read', 'tuckshop.reports.read'],
  market: ['feeding.market.read', 'feeding.market.manage'],
  marketing: ['feeding.marketing.read', 'feeding.marketing.manage', 'feeding.reports.read'],
};

function ImportedWorkbookHistory({ modules }) {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  }, []);
  const accessibleModules = modules.filter((module) => (
    hasOperationalPermission(user, ...modulePermissions[module])
  ));

  useEffect(() => {
    let active = true;
    if (!accessibleModules.length) return undefined;
    setLoading(true);
    setError('');
    Promise.all(accessibleModules.map(async (module) => {
      const response = await getImportedWorkbookRows(module);
      return response.data.map((row) => ({ ...row, module }));
    }))
      .then((result) => active && setRows(result.flat()))
      .catch((loadError) => active && setError(loadError.response?.data?.message || 'Unable to load confirmed workbook rows.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [accessibleModules.join(',')]);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return rows;
    return rows.filter((row) => [
      moduleLabels[row.module],
      row.file_name,
      row.sheet_name,
      row.source_row,
      row.row_kind,
      JSON.stringify(row.review_values),
      ...(row.issues || []),
    ].some((value) => String(value || '').toLowerCase().includes(search)));
  }, [query, rows]);

  if (!accessibleModules.length) return null;

  return (
    <section className="data-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Confirmed source rows</p><h2>Imported workbook detail</h2></div>
        <label>
          Search rows
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workbook, worksheet, row, cells…" />
        </label>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {loading ? <p className="muted-copy">Loading confirmed source rows…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Workbook section</th><th>Worksheet / row</th><th>Row type</th><th>Reviewed cells</th><th>Notes</th><th>Imported</th></tr></thead>
            <tbody>{filteredRows.slice(0, 100).map((row) => (
              <tr key={`${row.module}-${row.id}`}>
                <td>{moduleLabels[row.module]}<small>{row.file_name}</small></td>
                <td>{row.sheet_name}<small>Row {row.source_row}</small></td>
                <td>{row.row_kind.replaceAll('_', ' ')}</td>
                <td><details><summary>View source cells</summary><pre>{JSON.stringify(row.review_values, null, 2)}</pre></details></td>
                <td>{(row.issues || []).join(' ') || '—'}</td>
                <td>{row.imported_at ? new Date(row.imported_at).toLocaleString() : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!loading && !filteredRows.length && <p className="empty-state">{rows.length ? 'No confirmed rows match this search.' : 'No confirmed source rows are available for this section.'}</p>}
      {filteredRows.length > 100 && <p className="muted-copy">Showing the first 100 matches. Use search to narrow the results.</p>}
    </section>
  );
}

export default ImportedWorkbookHistory;
