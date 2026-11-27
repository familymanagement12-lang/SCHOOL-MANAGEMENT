import { useEffect, useMemo, useState } from 'react';
import { Check, Download, FileText, Plus, RefreshCw } from 'lucide-react';
import {
  createAssignment, downloadAssignmentFile, getAssignmentMeta, getAssignments, getAssignmentSubmissions,
  markAssignmentSubmission, publishAssignment, updateAssignment, uploadAssignmentFiles,
} from '../api/assignments';

const localSchoolDateTime = (date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const defaultForm = () => ({
  term_id: '',
  class_id: '',
  subject_id: '',
  teacher_id: '',
  title: '',
  instructions: '',
  category: 'homework',
  issue_at: localSchoolDateTime(new Date()),
  due_at: localSchoolDateTime(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)),
  total_marks: '10',
  submission_method: 'online',
  allow_late: false,
  allow_resubmission: false,
});

const displayTime = (value) => value
  ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra' }).format(new Date(value))
  : '—';

function Assignments() {
  const [meta, setMeta] = useState({ terms: [], assignments: [], classes: [], students: [], teachers: [] });
  const [termId, setTermId] = useState('');
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [assignToSelected, setAssignToSelected] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [referenceFiles, setReferenceFiles] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [activeAssignment, setActiveAssignment] = useState(null);
  const [submissionRows, setSubmissionRows] = useState([]);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const isAdmin = user?.role === 'admin';

  const load = async (selectedTerm = termId) => {
    const metaResponse = await getAssignmentMeta(selectedTerm || undefined);
    const activeTerm = selectedTerm || metaResponse.data.selected_term_id;
    const listResponse = await getAssignments(activeTerm);
    setMeta(metaResponse.data);
    setTermId(String(activeTerm || ''));
    setItems(listResponse.data);
  };

  useEffect(() => {
    load('').catch((err) => setError(err.response?.data?.message || 'Unable to load assignment details.'))
      .finally(() => setLoading(false));
  }, []);

  const availablePairs = useMemo(() => meta.assignments.filter((item) => String(item.class_id) === form.class_id), [meta.assignments, form.class_id]);
  const availableSubjects = useMemo(() => [...new Map(availablePairs.map((item) => [item.subject_id, item])).values()], [availablePairs]);
  const availableTeachers = useMemo(() => meta.teachers.filter((item) => (
    String(item.class_id) === form.class_id && String(item.subject_id) === form.subject_id
  )), [meta.teachers, form.class_id, form.subject_id]);
  const classStudents = meta.students.filter((student) => String(student.class_id) === form.class_id);

  const chooseTerm = async (value) => {
    setTermId(value);
    setForm((current) => ({ ...current, term_id: value, class_id: '', subject_id: '', teacher_id: '' }));
    setError('');
    try {
      await load(value);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load this term.');
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...defaultForm(), term_id: termId });
    setSelectedStudents([]);
    setAssignToSelected(false);
    setReferenceFiles([]);
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    const payload = {
      ...form,
      class_id: Number(form.class_id),
      subject_id: Number(form.subject_id),
      term_id: Number(termId),
      teacher_id: isAdmin ? Number(form.teacher_id) : undefined,
      total_marks: Number(form.total_marks),
      selected_student_ids: assignToSelected ? selectedStudents.map(Number) : null,
    };
    try {
      const result = editingId ? await updateAssignment(editingId, payload) : await createAssignment(payload);
      const id = editingId || result.data.id;
      if (referenceFiles.length) {
        try {
          await uploadAssignmentFiles(id, referenceFiles);
        } catch (uploadError) {
          setEditingId(id);
          await load(termId);
          setError(`Draft saved, but its reference files could not be uploaded. ${uploadError.response?.data?.message || 'Try again after checking storage configuration.'}`);
          return;
        }
      }
      setMessage(editingId ? 'Assignment draft updated.' : 'Assignment saved as a draft.');
      resetForm();
      await load(termId);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save the assignment.');
    } finally { setBusy(false); }
  };

  const editDraft = (item) => {
    setEditingId(item.id);
    setForm({
      ...defaultForm(),
      term_id: String(meta.terms.find((term) => term.academic_year === item.academic_year && term.term === item.term)?.id || termId),
      class_id: String(item.class_id),
      subject_id: String(meta.assignments.find((pair) => String(pair.class_id) === String(item.class_id) && pair.subject_name === item.subject_name)?.subject_id || ''),
      teacher_id: String(item.teacher_id || ''),
      title: item.title,
      instructions: item.instructions || '',
      category: item.category,
      issue_at: item.issue_at ? localSchoolDateTime(new Date(item.issue_at)) : '',
      due_at: item.due_at ? localSchoolDateTime(new Date(item.due_at)) : '',
      total_marks: String(item.total_marks),
      submission_method: item.submission_method,
      allow_late: item.allow_late,
      allow_resubmission: item.allow_resubmission,
    });
    setAssignToSelected(true);
    setSelectedStudents((item.recipient_student_ids || []).map(String));
    setError('');
    setMessage('');
  };

  const publish = async (item) => {
    if (!window.confirm(`Publish "${item.title}" to its selected students?`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await publishAssignment(item.id);
      setMessage(`${response.data.recipient_count} student(s) can now see this assignment.`);
      await load(termId);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to publish assignment.');
    } finally { setBusy(false); }
  };

  const openSubmissions = async (item) => {
    setBusy(true); setError('');
    try {
      const response = await getAssignmentSubmissions(item.id);
      setActiveAssignment(response.data.assignment);
      setSubmissionRows(response.data.submissions);
      setMarks(Object.fromEntries(response.data.submissions.map((row) => [row.submission_id, {
        score: row.score ?? '', feedback: row.feedback || '', private_notes: row.private_notes || '',
      }])));
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load submissions.');
    } finally { setBusy(false); }
  };

  const saveMark = async (submissionId, action) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = marks[submissionId] || {};
      const response = await markAssignmentSubmission(activeAssignment.id, submissionId, {
        score: Number(data.score), feedback: data.feedback || '',
        private_notes: data.private_notes || '',
        release: action === 'release',
        request_resubmission: action === 'resubmit',
      });
      setMessage(response.data.message);
      await openSubmissions(activeAssignment);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save marking.');
    } finally { setBusy(false); }
  };

  const downloadSubmissionFile = async (assignmentId, file) => {
    setBusy(true); setError('');
    try {
      const response = await downloadAssignmentFile(`/assignments/${assignmentId}/submission-files/${file.id}`);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url; link.download = file.original_name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to download this submission file.');
    } finally { setBusy(false); }
  };

  if (loading) return <div className="page"><p>Loading assignments…</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero">
          <div><p className="eyebrow">Teaching and learning</p><h1>Assignments</h1><p>Create class work, follow submissions, and return marks privately.</p></div>
        </section>
        {error && <div className="error" role="alert">{error}</div>}
        {message && <div className="success" role="status">{message}</div>}

        <section className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">Term selection</p><h2>Teaching assignments</h2></div>
            <label>Academic term<select value={termId} onChange={(event) => chooseTerm(event.target.value)}>
              {meta.terms.map((term) => <option key={term.id} value={term.id}>{term.academic_year} · {term.term}</option>)}
            </select></label>
          </div>
          <div className="panel-heading"><div><p className="eyebrow">{editingId ? 'Edit draft' : 'New assignment'}</p><h2>{editingId ? 'Update assignment' : 'Create assignment'}</h2></div>
            {editingId && <button className="btn-secondary" type="button" onClick={resetForm}>Cancel edit</button>}
          </div>
          {!meta.assignments.length
            ? <p className="empty-state">No teaching allocations are configured for this term. Ask an administrator to configure class subjects and teacher allocations first.</p>
            : <form onSubmit={save} className="data-panel" style={{ display: 'grid', gap: '1rem' }}>
              <div className="class-grid">
                <label>Class<select required value={form.class_id} onChange={(event) => setForm({ ...form, class_id: event.target.value, subject_id: '', teacher_id: '' })}>
                  <option value="">Select a class</option>{meta.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
                <label>Subject<select required value={form.subject_id} onChange={(event) => setForm({ ...form, subject_id: event.target.value, teacher_id: '' })}>
                  <option value="">Select a subject</option>{availableSubjects.map((item) => <option key={item.subject_id} value={item.subject_id}>{item.subject_name}</option>)}
                </select></label>
                {isAdmin && <label>Assigned teacher<select required value={form.teacher_id} onChange={(event) => setForm({ ...form, teacher_id: event.target.value })}>
                  <option value="">Select an allocated teacher</option>{availableTeachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>}
                <label>Title<input maxLength="200" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
                <label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                  {['homework','classwork','project','research','practical','revision','test','other'].map((value) => <option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}
                </select></label>
                <label>Submission method<select value={form.submission_method} onChange={(event) => setForm({ ...form, submission_method: event.target.value })}>
                  <option value="online">Online answer</option><option value="file">File upload</option><option value="both">Answer and file</option>
                </select></label>
                <label>Issue date and time (Accra)<input type="datetime-local" value={form.issue_at} onChange={(event) => setForm({ ...form, issue_at: event.target.value })} /></label>
                <label>Due date and time (Accra)<input type="datetime-local" required value={form.due_at} onChange={(event) => setForm({ ...form, due_at: event.target.value })} /></label>
                <label>Total marks<input type="number" min="0.01" step="0.01" required value={form.total_marks} onChange={(event) => setForm({ ...form, total_marks: event.target.value })} /></label>
              </div>
              <label>Instructions<textarea required rows="5" value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label>
              <div className="class-grid">
                <label><input type="checkbox" checked={form.allow_late} onChange={(event) => setForm({ ...form, allow_late: event.target.checked })} /> Accept late submissions</label>
                <label><input type="checkbox" checked={form.allow_resubmission} onChange={(event) => setForm({ ...form, allow_resubmission: event.target.checked })} /> Allow resubmission</label>
              </div>
              <label><input type="checkbox" checked={assignToSelected} onChange={(event) => { setAssignToSelected(event.target.checked); setSelectedStudents([]); }} /> Assign to selected students only</label>
              {assignToSelected && <div className="class-grid" role="group" aria-label="Select assignment recipients">
                {classStudents.map((student) => <label key={student.id}><input type="checkbox" checked={selectedStudents.includes(String(student.id))} onChange={(event) => setSelectedStudents((current) => event.target.checked ? [...current, String(student.id)] : current.filter((id) => id !== String(student.id)))} /> {student.name} · {student.student_id}</label>)}
                {!classStudents.length && <span className="empty-state">No students are enrolled in this class.</span>}
              </div>}
              <label>Reference files (PDF, DOC, DOCX, JPG, PNG; up to 10 MB each)<input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => setReferenceFiles(Array.from(event.target.files || []))} /></label>
              <button className="btn-primary" type="submit" disabled={busy || (isAdmin && !form.teacher_id)}>
                {busy ? 'Saving…' : <><Plus size={15} /> Save draft</>}
              </button>
            </form>}
        </section>

        <section className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">Assignment list</p><h2>Drafts and published work</h2></div><button className="btn-secondary" onClick={() => load(termId).catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
          {!items.length ? <p className="empty-state">No assignments have been created for this term.</p> : <div className="table-wrap">
            <table><thead><tr><th>Assignment</th><th>Class / subject</th><th>Due</th><th>Status</th><th>Progress</th><th>Actions</th></tr></thead><tbody>
              {items.map((item) => <tr key={item.id}>
                <td><strong>{item.title}</strong><br />{item.category}</td>
                <td>{item.class_name} · {item.subject_name}</td>
                <td>{displayTime(item.due_at)}</td>
                <td>{item.status}</td>
                <td>{item.submitted_count}/{item.assigned_count} submitted · {item.awaiting_marking_count} awaiting marking</td>
                <td>{item.status === 'DRAFT' && <><button className="btn-small btn-edit" type="button" onClick={() => editDraft(item)}>Edit</button><button className="btn-small btn-primary" type="button" disabled={busy} onClick={() => publish(item)}><Check size={13} /> Publish</button></>}
                  {item.status !== 'DRAFT' && <button className="btn-small btn-edit" type="button" disabled={busy} onClick={() => openSubmissions(item)}><FileText size={13} /> Submissions</button>}</td>
              </tr>)}
            </tbody></table>
          </div>}
        </section>

        {activeAssignment && <section className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">{activeAssignment.class_name} · {activeAssignment.subject_name}</p><h2>{activeAssignment.title} — submissions</h2></div>
            <button type="button" className="btn-secondary" onClick={() => { setActiveAssignment(null); setSubmissionRows([]); }}>Close</button>
          </div>
          <p>{submissionRows.length} students assigned · {submissionRows.filter((row) => row.version_id).length} submitted</p>
          <div className="class-grid">{submissionRows.map((row) => {
            const value = marks[row.submission_id] || {};
            return <article className="data-panel" key={row.submission_id}>
              <strong>{row.student_name} · {row.student_number}</strong>
              <p>{row.status}{row.is_late ? ' · Late' : ''}{row.version_submitted_at ? ` · ${displayTime(row.version_submitted_at)}` : ''}</p>
              {row.version_id ? <>
                <p style={{ whiteSpace: 'pre-wrap' }}>{row.submitted_answer || 'File submission'}</p>
                {row.files.map((file) => <p key={file.id}><button className="parent-text-button" type="button" disabled={busy} onClick={() => downloadSubmissionFile(activeAssignment.id, file)}><Download size={14} /> {file.original_name}</button></p>)}
                <p>Maximum: {activeAssignment.total_marks}</p>
                <label>Mark<input type="number" min="0" max={activeAssignment.total_marks} step="0.01" value={value.score} onChange={(event) => setMarks({ ...marks, [row.submission_id]: { ...value, score: event.target.value } })} /></label>
                <label>Feedback<textarea rows="2" value={value.feedback} onChange={(event) => setMarks({ ...marks, [row.submission_id]: { ...value, feedback: event.target.value } })} /></label>
                <label>Private notes<textarea rows="2" value={value.private_notes} onChange={(event) => setMarks({ ...marks, [row.submission_id]: { ...value, private_notes: event.target.value } })} /></label>
                <div className="modal-actions">
                  <button className="btn-secondary" type="button" disabled={busy || value.score === ''} onClick={() => saveMark(row.submission_id, 'draft')}>Save marking draft</button>
                  <button className="btn-primary" type="button" disabled={busy || value.score === ''} onClick={() => saveMark(row.submission_id, 'release')}>Return marks</button>
                  {activeAssignment.allow_resubmission && <button className="btn-secondary" type="button" disabled={busy || value.score === ''} onClick={() => saveMark(row.submission_id, 'resubmit')}>Request resubmission</button>}
                </div>
              </> : <p className="empty-state">Not submitted yet.</p>}
            </article>;
          })}</div>
        </section>}
      </div>
    </div>
  );
}

export default Assignments;
