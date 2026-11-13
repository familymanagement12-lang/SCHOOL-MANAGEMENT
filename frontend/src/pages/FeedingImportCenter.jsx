import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  confirmWorkbookImport,
  downloadWorkbookImport,
  getWorkbookImport,
  getWorkbookImports,
  previewWorkbookImport,
  reviewWorkbookImportRow,
} from '../api/feeding';
import { hasOperationalPermission } from '../utils/operationalPermissions';

const workbookChoices = [
  { module: 'lunch', label: 'Lunch Register', fileName: 'LUNCH 2026_2027.xlsx' },
  { module: 'purchases', label: 'Kitchen & Tuckshop Purchases', fileName: 'PURCHASES FOR TUCK SHOP AND KITCHEN 2026_2027.xlsx' },
  { module: 'market', label: 'Market Stock', fileName: 'MARKET STOCK SEPT TO DEC, 2026.xlsx' },
  { module: 'marketing', label: 'Feeding & Marketing', fileName: 'FEEDING AND MARKETING 2024_2025.xlsx' },
];
const pageSize = 50;
const statusLabel = (status) => status.charAt(0).toUpperCase() + status.slice(1);
const messageFrom = (error) => error.response?.data?.message || error.message || 'The workbook request failed.';
const isNonEating = (row) => /DON['’]?T EAT|DO NOT EAT|NOT EATING/i.test(String(row.original_values?.B || ''));

function FeedingImportCenter() {
  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  }, []);
  const mayConfirm = hasOperationalPermission(user, 'feeding.import.confirm');
  const [selectedModule, setSelectedModule] = useState(workbookChoices[0].module);
  const [file, setFile] = useState(null);
  const [academicYear, setAcademicYear] = useState('');
  const [term, setTerm] = useState('');
  const [imports, setImports] = useState([]);
  const [currentImport, setCurrentImport] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [editingRowId, setEditingRowId] = useState(null);
  const [draftValues, setDraftValues] = useState({});
  const [exclusionReason, setExclusionReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyRowId, setBusyRowId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshImports = useCallback(async () => {
    const response = await getWorkbookImports();
    setImports(response.data);
  }, []);

  useEffect(() => {
    refreshImports().catch((loadError) => setError(messageFrom(loadError)));
  }, [refreshImports]);

  const openImport = async (id) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await getWorkbookImport(id);
      setCurrentImport(response.data);
      setPage(0);
      setEditingRowId(null);
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async (event) => {
    event.preventDefault();
    if (!file) {
      setError('Choose the matching workbook file before previewing.');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await previewWorkbookImport(file, selectedModule, academicYear, term);
      setCurrentImport(response.data);
      setPage(0);
      await refreshImports();
      setNotice(response.data.alreadyPreviewed
        ? 'This exact workbook was already previewed. Its existing review was opened.'
        : 'Workbook preview created. Nothing has been confirmed or added to the operational ledger.');
    } catch (previewError) {
      setError(messageFrom(previewError));
    } finally {
      setLoading(false);
    }
  };

  const saveCorrection = async (row) => {
    setBusyRowId(row.id);
    setError('');
    setNotice('');
    try {
      const response = await reviewWorkbookImportRow(currentImport.id, row.id, { review_values: draftValues });
      setCurrentImport((existing) => ({
        ...existing,
        rows: existing.rows.map((item) => item.id === row.id ? response.data.row : item),
        counts: response.data.counts,
        audit: response.data.audit,
      }));
      setEditingRowId(null);
      setNotice(`Source row ${row.source_row} updated for review.`);
    } catch (saveError) {
      setError(messageFrom(saveError));
    } finally {
      setBusyRowId(null);
    }
  };

  const excludeRow = async (row) => {
    if (!exclusionReason.trim()) {
      setError('Enter a reason before excluding a source row.');
      return;
    }
    setBusyRowId(row.id);
    setError('');
    setNotice('');
    try {
      const response = await reviewWorkbookImportRow(currentImport.id, row.id, {
        exclude: true,
        exclusion_reason: exclusionReason,
      });
      setCurrentImport((existing) => ({
        ...existing,
        rows: existing.rows.map((item) => item.id === row.id ? response.data.row : item),
        counts: response.data.counts,
        audit: response.data.audit,
      }));
      setEditingRowId(null);
      setExclusionReason('');
      setNotice(`Source row ${row.source_row} excluded with a recorded reason.`);
    } catch (excludeError) {
      setError(messageFrom(excludeError));
    } finally {
      setBusyRowId(null);
    }
  };

  const handleConfirm = async () => {
    if (!currentImport || !mayConfirm) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await confirmWorkbookImport(currentImport.id);
      setNotice(response.data.message);
      await openImport(currentImport.id);
      await refreshImports();
    } catch (confirmError) {
      setError(messageFrom(confirmError));
    } finally {
      setLoading(false);
    }
  };

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (currentImport?.rows || []).filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!search) return true;
      return [
        row.sheet_name,
        row.source_row,
        row.row_kind,
        row.status,
        ...Object.values(row.review_values || {}).map((value) => typeof value === 'object' ? JSON.stringify(value) : value),
        ...(row.issues || []),
      ].some((value) => String(value || '').toLowerCase().includes(search));
    });
  }, [currentImport, query, statusFilter]);
  const visibleRows = filteredRows.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentChoice = workbookChoices.find((choice) => choice.module === selectedModule);
  const unresolvedCount = Number(currentImport?.counts?.incomplete || 0);

  return (
    <div className="page module-page feeding-import-center">
      <div className="module-shell">
        <section className="module-hero">
          <div>
            <p className="eyebrow">Workbook review · isolated operational archive</p>
            <h1>Workbook Import Centre</h1>
            <p>Upload an original workbook, review its rows, correct or exclude questionable data, then confirm. This archive never posts to Fees, the main Income &amp; Expenditure, student balances, or live stock.</p>
          </div>
        </section>

        {error && <p className="error-message" role="alert">{error}</p>}
        {notice && <p className="success-message" role="status">{notice}</p>}

        <section className="data-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Step 1 · Preview only</p><h2>Upload a source workbook</h2></div>
          </div>
          <form className="feeding-import-form" onSubmit={handlePreview}>
            <label>
              Workbook section
              <select value={selectedModule} onChange={(event) => setSelectedModule(event.target.value)}>
                {workbookChoices.map((choice) => <option key={choice.module} value={choice.module}>{choice.label}</option>)}
              </select>
            </label>
            <label className="feeding-import-file">
              Original workbook (.xlsx)
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
              <small>Expected file: {currentChoice.fileName}. Maximum upload size: 10 MB.</small>
            </label>
            <label>
              Academic year (optional)
              <input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="2026-2027" />
            </label>
            <label>
              Term (optional)
              <select value={term} onChange={(event) => setTerm(event.target.value)}>
                <option value="">Not specified</option>
                <option>Term 1</option><option>Term 2</option><option>Term 3</option>
              </select>
            </label>
            <button type="submit" disabled={loading}>{loading ? 'Working…' : 'Preview workbook'}</button>
          </form>
        </section>

        <section className="data-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Step 2 · Review and report</p><h2>Saved imports</h2></div>
            <button type="button" className="secondary-button" onClick={() => refreshImports().catch((e) => setError(messageFrom(e)))}>Refresh</button>
          </div>
          {!imports.length ? <p className="empty-state">No workbook previews have been created.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Workbook</th><th>Section</th><th>Status</th><th>Rows</th><th>Previewed</th><th>Confirmed</th><th>Actions</th></tr></thead>
                <tbody>{imports.map((item) => (
                  <tr key={item.id}>
                    <td>{item.file_name}<small>{item.academic_year || 'Academic year not specified'}{item.term ? ` · ${item.term}` : ''}</small></td>
                    <td>{workbookChoices.find((choice) => choice.module === item.module)?.label || item.module}</td>
                    <td>{statusLabel(item.status)}</td>
                    <td>{item.summary?.total || 0}</td>
                    <td>{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</td>
                    <td>{item.confirmed_at ? new Date(item.confirmed_at).toLocaleString() : '—'}</td>
                    <td className="feeding-import-actions">
                      <button type="button" className="secondary-button" onClick={() => openImport(item.id)}>Review</button>
                      <button type="button" className="secondary-button" onClick={() => downloadWorkbookImport(item.id).catch((e) => setError(messageFrom(e)))}>Download source</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>

        {currentImport && (
          <section className="data-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Source: {currentImport.file_name}</p><h2>Preview and row review</h2></div>
              <div className="feeding-import-actions">
                <button type="button" className="secondary-button" onClick={() => downloadWorkbookImport(currentImport.id).catch((e) => setError(messageFrom(e)))}>Download original</button>
                {currentImport.status === 'preview' && mayConfirm && (
                  <button type="button" onClick={handleConfirm} disabled={loading || !currentImport.counts?.valid || unresolvedCount > 0}>
                    {loading ? 'Confirming…' : 'Confirm reviewed rows'}
                  </button>
                )}
              </div>
            </div>
            <p className="muted-copy">
              {currentImport.status === 'confirmed'
                ? `Confirmed by ${currentImport.confirmed_by || 'an authorized user'} on ${currentImport.confirmed_at ? new Date(currentImport.confirmed_at).toLocaleString() : 'recorded date unavailable'}.`
                : 'Correct or exclude incomplete rows before confirmation. Worksheet headings and subtotals are automatically excluded as non-data rows.'}
            </p>
            <div className="module-stats" aria-label="Import row counts">
              {['total', 'valid', 'incomplete', 'duplicates', 'rejected', 'skipped', 'imported', 'corrected'].map((key) => (
                <div className="mini-stat" key={key}><span>{key === 'valid' ? 'Ready' : statusLabel(key)}</span><strong>{currentImport.counts?.[key] || 0}</strong></div>
              ))}
            </div>
            {currentImport.module === 'lunch' && <p className="import-issue">Rows marked “DON’T EAT” remain visible as historical source detail only. They are never linked to current students or counted as active payers.</p>}
            {!mayConfirm && currentImport.status === 'preview' && <p className="muted-copy">You can review and correct rows, but a user with import-confirm permission must confirm the archive.</p>}
            <div className="feeding-import-filters">
              <label>Search source rows<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search cells, worksheet, row, issue…" /></label>
              <label>Status
                <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }}>
                  <option value="all">All statuses</option>
                  {['ready', 'incomplete', 'duplicate', 'rejected', 'excluded', 'skipped', 'imported'].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                </select>
              </label>
              <span>{filteredRows.length} matching rows · source hash {currentImport.source_hash}</span>
            </div>
            <div className="table-wrap">
              <table className="feeding-import-table">
                <thead><tr><th>Worksheet / row</th><th>Classification</th><th>Source and reviewed values</th><th>Status / review</th><th>Actions</th></tr></thead>
                <tbody>{visibleRows.map((row) => {
                  const editing = editingRowId === row.id;
                  const isNonDataRow = row.row_kind === 'heading_or_summary';
                  return (
                    <tr key={row.id} className={`import-row-${row.status}`}>
                      <td>{row.sheet_name}<small>Row {row.source_row}</small></td>
                      <td>{row.row_kind.replaceAll('_', ' ')}{isNonEating(row) && <small>Not an active payer</small>}</td>
                      <td>
                        <details open={editing}>
                          <summary>{Object.entries(row.review_values || {}).slice(0, 5).map(([column, value]) => `${column}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' · ') || 'No cell values'}</summary>
                          {editing ? (
                            <div className="feeding-import-cells">
                              {Object.keys(row.review_values || {}).map((column) => (
                                <label key={column}>{column}
                                  <input
                                    value={String(draftValues[column] ?? '')}
                                    onChange={(event) => setDraftValues((values) => ({ ...values, [column]: event.target.value }))}
                                  />
                                  {row.original_values?.[column] !== row.review_values?.[column] && <small>Original: {String(row.original_values?.[column] ?? '')}</small>}
                                </label>
                              ))}
                            </div>
                          ) : (
                            <div className="feeding-import-cells">
                              {Object.entries(row.review_values || {}).map(([column, value]) => (
                                <label key={column}>{column}<input readOnly value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')} /></label>
                              ))}
                            </div>
                          )}
                        </details>
                        {(row.issues || []).map((issue) => <p className="import-issue" key={issue}>{issue}</p>)}
                        {row.exclusion_reason && <p className="import-issue">Exclusion reason: {row.exclusion_reason}</p>}
                      </td>
                      <td>{statusLabel(row.status)}{row.reviewed_at && <small>Reviewed {new Date(row.reviewed_at).toLocaleString()}</small>}</td>
                      <td>
                        {currentImport.status === 'preview' && !['duplicate', 'imported', 'skipped'].includes(row.status) && (
                          <div className="feeding-import-row-actions">
                            {editing ? (
                              <>
                                <button type="button" onClick={() => saveCorrection(row)} disabled={busyRowId === row.id}>Save corrections</button>
                                <button type="button" className="secondary-button" onClick={() => setEditingRowId(null)}>Cancel</button>
                              </>
                            ) : !isNonDataRow && <button type="button" className="secondary-button" onClick={() => { setEditingRowId(row.id); setDraftValues({ ...row.review_values }); }}>Correct row</button>}
                            <input aria-label={`Reason to exclude row ${row.source_row}`} placeholder="Reason to exclude" value={editingRowId === row.id ? exclusionReason : ''} onChange={(event) => setExclusionReason(event.target.value)} />
                            <button type="button" className="secondary-button" onClick={() => excludeRow(row)} disabled={busyRowId === row.id}>Exclude row</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className="pagination-controls">
              <button type="button" className="secondary-button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>Previous</button>
              <span>Page {page + 1} of {totalPages}</span>
              <button type="button" className="secondary-button" onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))} disabled={page + 1 >= totalPages}>Next</button>
            </div>
            <section className="data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h2>Review activity</h2></div></div>
              {!currentImport.audit?.length ? <p className="empty-state">No review activity has been recorded.</p> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Time</th><th>Action</th><th>Source row</th><th>Actor</th><th>Recorded detail</th></tr></thead>
                    <tbody>{currentImport.audit.map((entry, index) => (
                      <tr key={`${entry.action}-${entry.row_id || 'import'}-${entry.created_at}-${index}`}>
                        <td>{new Date(entry.created_at).toLocaleString()}</td>
                        <td>{statusLabel(entry.action)}</td>
                        <td>{entry.sheet_name ? `${entry.sheet_name} · row ${entry.source_row}` : 'Import'}</td>
                        <td>{entry.actor_name || entry.actor_id || '—'}</td>
                        <td><details><summary>View audit data</summary><pre>{JSON.stringify({ old: entry.old_data, new: entry.new_data }, null, 2)}</pre></details></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}
      </div>
    </div>
  );
}

export default FeedingImportCenter;
