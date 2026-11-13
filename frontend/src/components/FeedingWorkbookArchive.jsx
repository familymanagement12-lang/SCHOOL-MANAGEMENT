import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { downloadFeedingWorkbook, getFeedingWorkbooks } from '../api/feeding';

function FeedingWorkbookArchive() {
  const [workbooks, setWorkbooks] = useState([]);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    let active = true;
    getFeedingWorkbooks()
      .then((response) => active && setWorkbooks(response.data))
      .catch((err) => active && setError(err.response?.data?.message || 'Unable to load archived workbooks.'));
    return () => { active = false; };
  }, []);

  const download = async (workbook) => {
    setError('');
    setDownloadingId(workbook.id);
    try {
      await downloadFeedingWorkbook(workbook.id, workbook.file_name);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to download the archived workbook.');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="feeding-workbook-archive">
      <h3>Historical workbook archive</h3>
      <p className="muted-copy">Original workbooks are preserved here and are not posted to the Fees/Main Income &amp; Expenditure ledger.</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {workbooks.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Workbook</th><th>Sheets</th><th>Non-empty rows</th><th>Imported</th><th>Download</th></tr></thead>
            <tbody>{workbooks.map((workbook) => (
              <tr key={workbook.id}>
                <td>{workbook.file_name}</td>
                <td>{workbook.sheet_summary.length}</td>
                <td>{workbook.sheet_summary.reduce((total, sheet) => total + sheet.nonEmptyRows, 0)}</td>
                <td>{new Date(workbook.imported_at).toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => download(workbook)}
                    disabled={downloadingId === workbook.id}
                  >
                    <Download size={15} aria-hidden="true" />
                    {downloadingId === workbook.id ? 'Downloading…' : 'Download original'}
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!workbooks.length && !error && <p className="muted-copy">No historical workbooks have been imported.</p>}
    </div>
  );
}

export default FeedingWorkbookArchive;
