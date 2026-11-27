import { useEffect, useState } from 'react';
import { Download, FileText, RefreshCw, Upload } from 'lucide-react';
import {
  downloadAssignmentFile, getStudentAssignment, getStudentAssignments,
  saveStudentAssignmentDraft, submitStudentAssignment, uploadStudentAssignmentFiles,
} from '../api/assignments';

const dateTime = (value) => value
  ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra' }).format(new Date(value))
  : '—';

const formatBytes = (value) => `${Math.max(1, Math.round(Number(value) / 1024))} KB`;

function StudentAssignments() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [answer, setAnswer] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = async (assignmentId = selected?.id) => {
    const response = await getStudentAssignments();
    setItems(response.data);
    if (assignmentId) {
      const detail = await getStudentAssignment(assignmentId);
      setSelected(detail.data);
      setAnswer(detail.data.draft_answer || '');
    }
  };

  useEffect(() => {
    let active = true;
    getStudentAssignments().then((response) => {
      if (active) setItems(response.data);
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || 'Unable to load your assignments.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const open = async (item) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await getStudentAssignment(item.id);
      setSelected(response.data);
      setAnswer(response.data.draft_answer || '');
      setFiles([]);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to open this assignment.');
    } finally { setBusy(false); }
  };

  const saveDraft = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await saveStudentAssignmentDraft(selected.id, answer);
      setMessage(response.data.message);
      await refresh(selected.id);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save your draft.');
    } finally { setBusy(false); }
  };

  const uploadFiles = async () => {
    if (!selected || !files.length) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await uploadStudentAssignmentFiles(selected.id, files);
      setFiles([]);
      setMessage('Files uploaded. Submit the assignment when your work is ready.');
      await refresh(selected.id);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to upload files.');
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!selected || !window.confirm('Submit this assignment now? You may not be able to edit it afterward.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await submitStudentAssignment(selected.id, answer);
      setMessage(`${response.data.message}${response.data.is_late ? ' This submission is recorded as late.' : ''}`);
      setFiles([]);
      await refresh(selected.id);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to submit this assignment.');
    } finally { setBusy(false); }
  };

  const download = async (path, filename) => {
    setBusy(true); setError('');
    try {
      const response = await downloadAssignmentFile(path);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url; link.download = filename; link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to download this file.');
    } finally { setBusy(false); }
  };

  const editableStatuses = ['ASSIGNED', 'VIEWED', 'DRAFT', 'RETURNED', 'RESUBMISSION_REQUESTED'];
  const canEdit = selected && editableStatuses.includes(selected.status)
    && (selected.status !== 'RETURNED' && selected.status !== 'RESUBMISSION_REQUESTED' || selected.allow_resubmission);
  const pastDue = selected && new Date(selected.due_at) < new Date();
  const lockedByDeadline = pastDue && !selected?.allow_late;

  if (loading) return <div className="page module-page"><div className="module-shell"><p className="data-panel">Loading your assignments…</p></div></div>;
  return <div className="page module-page"><div className="module-shell">
    <section className="module-hero"><div><p className="eyebrow">Student Portal</p><h1>Assignments</h1><p>Review class work, save drafts, submit work, and view feedback returned by your teacher.</p></div></section>
    {error && <div className="error" role="alert">{error}</div>}
    {message && <div className="success" role="status">{message}</div>}
    <section className="data-panel">
      <div className="panel-heading"><div><p className="eyebrow">Your class work</p><h2>Assignments and homework</h2></div>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => refresh().catch((requestError) => setError(requestError.response?.data?.message || 'Unable to refresh assignments.'))}><RefreshCw size={14} /> Refresh</button>
      </div>
      {!items.length ? <p className="empty-state">No published assignments are available for you.</p> : <div className="table-wrap">
        <table><thead><tr><th>Assignment</th><th>Term</th><th>Due</th><th>Status</th><th>Mark</th><th></th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}>
            <td><strong>{item.title}</strong><br />{item.class_name} · {item.subject_name} · {item.category}</td>
            <td>{item.academic_year} · {item.term}</td><td>{dateTime(item.due_at)}</td><td>{item.display_status || item.status}</td>
            <td>{item.mark_status === 'RELEASED' && item.score != null ? `${item.score} / ${item.total_marks}` : '—'}</td>
            <td><button type="button" className="btn-small btn-edit" disabled={busy} onClick={() => open(item)}><FileText size={13} /> View</button></td>
          </tr>)}
        </tbody></table>
      </div>}
    </section>

    {selected && <section className="data-panel">
      <div className="panel-heading"><div><p className="eyebrow">{selected.academic_year} · {selected.term} · {selected.class_name}</p><h2>{selected.title}</h2></div>
        <button className="btn-secondary" type="button" onClick={() => setSelected(null)}>Close</button>
      </div>
      <p><strong>{selected.subject_name}</strong> · {selected.category} · Teacher: {selected.teacher_name}</p>
      <p>Issued: {dateTime(selected.issue_at)} · Due: {dateTime(selected.due_at)} · Total: {selected.total_marks} marks</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{selected.instructions}</p>
      {!!selected.attachments?.length && <div><h3>Teacher reference files</h3>{selected.attachments.map((file) => <p key={file.id}>
        <button className="parent-text-button" type="button" disabled={busy} onClick={() => download(`/student-portal/assignments/${selected.id}/attachments/${file.id}`, file.original_name)}><Download size={14} /> {file.original_name} · {formatBytes(file.file_size)}</button>
      </p>)}</div>}

      {canEdit && <>
        {selected.submission_method !== 'file' && <label>Your answer<textarea rows="8" maxLength="100000" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Write your answer here…" /></label>}
        {selected.submission_method !== 'online' && <>
          <label>Attach your work (PDF, DOC, DOCX, JPG or PNG; up to 10 MB per file)<input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => setFiles(Array.from(event.target.files || []))} /></label>
          {!!files.length && <button className="btn-secondary" type="button" disabled={busy} onClick={uploadFiles}><Upload size={14} /> Upload {files.length} file(s)</button>}
        </>}
        <div className="modal-actions"><button className="btn-secondary" type="button" disabled={busy} onClick={saveDraft}>Save draft</button>
          <button className="btn-primary" type="button" disabled={busy || lockedByDeadline} onClick={submit}>Submit assignment</button></div>
        {lockedByDeadline && <p className="error">The deadline has passed and late submissions are not enabled. Contact your teacher if you need help.</p>}
      </>}
      {!canEdit && <p className="teacher-badge">This submission is currently locked. Check the status or contact your teacher.</p>}
      {selected.mark_status === 'RELEASED' && <div className="data-panel"><h3>Returned feedback</h3><p><strong>Mark: {selected.score} / {selected.total_marks}</strong></p><p style={{ whiteSpace: 'pre-wrap' }}>{selected.feedback || 'No written feedback.'}</p></div>}
      {!!selected.versions?.length && <div className="data-panel"><h3>Submission history</h3>{selected.versions.map((version) => <article key={version.id}>
        <strong>Version {version.version_number}</strong> · {dateTime(version.submitted_at)}{version.is_late ? ' · Late' : ''}
        {version.answer && <p style={{ whiteSpace: 'pre-wrap' }}>{version.answer}</p>}
        {version.files?.map((file) => <p key={file.id}><button className="parent-text-button" type="button" disabled={busy} onClick={() => download(`/student-portal/assignments/${selected.id}/submission-files/${file.id}`, file.original_name)}><Download size={14} /> {file.original_name}</button></p>)}
      </article>)}</div>}
    </section>}
  </div></div>;
}

export default StudentAssignments;
