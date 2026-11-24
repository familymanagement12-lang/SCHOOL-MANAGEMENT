import { useEffect, useMemo, useState } from 'react';
import {
  assignAdminCurriculumClass,
  decideAdminCurriculumSelection,
  getAdminCurriculumSelections,
  saveAdminCurriculumSelectionPeriod,
} from '../api/curriculumSelections';
import { classStageLabel } from '../curriculumDisplay';

const dateTimeInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const displayDate = (value) => value ? new Date(value).toLocaleString() : '—';

function CurriculumSelectionsAdmin() {
  const [data, setData] = useState({ selections: [], classes: [], period: null });
  const [periodForm, setPeriodForm] = useState({
    academic_year: '',
    opens_at: '',
    deadline: '',
    reminder_interval_days: '7',
    enabled: true,
  });
  const [classChoices, setClassChoices] = useState({});
  const [rejectionReasons, setRejectionReasons] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getAdminCurriculumSelections();
      const nextData = response.data;
      setData(nextData);
      setPeriodForm({
        academic_year: nextData.period?.academic_year || nextData.default_academic_year || '',
        opens_at: dateTimeInput(nextData.period?.opens_at),
        deadline: dateTimeInput(nextData.period?.deadline),
        reminder_interval_days: String(nextData.period?.reminder_interval_days || 7),
        enabled: nextData.period?.enabled !== false,
      });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load curriculum requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const savePeriod = async (event) => {
    event.preventDefault();
    setSavingPeriod(true);
    setError('');
    setMessage('');
    try {
      await saveAdminCurriculumSelectionPeriod({
        ...periodForm,
        opens_at: new Date(periodForm.opens_at).toISOString(),
        deadline: new Date(periodForm.deadline).toISOString(),
        reminder_interval_days: Number(periodForm.reminder_interval_days),
      });
      setMessage('Selection period saved.');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save the selection period.');
    } finally {
      setSavingPeriod(false);
    }
  };

  const review = async (selection, decision) => {
    const rejectionReason = (rejectionReasons[selection.id] || '').trim();
    if (decision === 'reject' && !rejectionReason) {
      setError('Enter a reason before rejecting a curriculum request.');
      return;
    }
    setBusyId(selection.id);
    setError('');
    setMessage('');
    try {
      await decideAdminCurriculumSelection(selection.id, {
        decision,
        rejection_reason: decision === 'reject' ? rejectionReason : undefined,
      });
      setMessage(decision === 'approve' ? 'Curriculum request approved; class assignment is still required.' : 'Curriculum request rejected and the reason sent to the family.');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to review this request.');
    } finally {
      setBusyId(null);
    }
  };

  const assignClass = async (selection) => {
    const classId = classChoices[selection.id];
    if (!classId) {
      setError('Select a matching destination class before assigning.');
      return;
    }
    setBusyId(selection.id);
    setError('');
    setMessage('');
    try {
      const response = await assignAdminCurriculumClass(selection.id, Number(classId));
      setMessage(`${selection.student_name_snapshot} is now assigned to ${response.data.class_name}.`);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to assign this class.');
    } finally {
      setBusyId(null);
    }
  };

  const sortedSelections = useMemo(() => data.selections, [data.selections]);

  if (loading) return <div className="page"><p>Loading curriculum requests…</p></div>;

  return <div className="page module-page parent-admin-page curriculum-admin-page">
    <div className="module-shell">
      <section className="module-hero">
        <div>
          <p className="eyebrow">Academic administration</p>
          <h1>Curriculum selections</h1>
          <p>Review parent pathway requests, then separately assign an eligible class. No student is moved by the selection or approval alone.</p>
        </div>
        <div className="hero-badge"><span>{data.selections.filter((item) => item.status === 'pending_approval').length}</span><strong>awaiting review</strong></div>
      </section>

      {error && <div className="parent-error" role="alert">{error}</div>}
      {message && <div className="parent-success" role="status">{message}</div>}

      <form className="data-panel curriculum-period-form" onSubmit={savePeriod}>
        <div className="panel-heading"><div><p className="eyebrow">Parent choices</p><h2>Selection period</h2></div></div>
        <div className="parent-admin-fields">
          <label>Academic year
            <input required maxLength={32} value={periodForm.academic_year}
              onChange={(event) => setPeriodForm({ ...periodForm, academic_year: event.target.value })} />
          </label>
          <label>Opens
            <input required type="datetime-local" value={periodForm.opens_at}
              onChange={(event) => setPeriodForm({ ...periodForm, opens_at: event.target.value })} />
          </label>
          <label>Deadline
            <input required type="datetime-local" value={periodForm.deadline}
              onChange={(event) => setPeriodForm({ ...periodForm, deadline: event.target.value })} />
          </label>
          <label>Reminder interval (days)
            <input required type="number" min="1" max="30" value={periodForm.reminder_interval_days}
              onChange={(event) => setPeriodForm({ ...periodForm, reminder_interval_days: event.target.value })} />
          </label>
        </div>
        <label className="parent-checkbox"><input type="checkbox" checked={periodForm.enabled}
          onChange={(event) => setPeriodForm({ ...periodForm, enabled: event.target.checked })} />
          <span>Allow parents to submit during this period</span></label>
        <p className="parent-note">Parents receive in-app reminders only. Email and SMS reminders are not configured by this workflow.</p>
        <button className="btn-primary" type="submit" disabled={savingPeriod}>{savingPeriod ? 'Saving…' : 'Save selection period'}</button>
      </form>

      <section className="curriculum-admin-requests">
        <div className="panel-heading"><div><p className="eyebrow">Decision queue</p><h2>Parent requests · {data.academic_year || 'No academic year set'}</h2></div></div>
        {sortedSelections.length ? sortedSelections.map((selection) => {
          const targetYear = selection.request_type === 'initial_selection'
            ? 7 : Number(selection.current_year_level);
          const matchingClasses = data.classes.filter((classItem) => (
            classItem.curriculum === selection.selected_curriculum
            && Number(classItem.year_level) === targetYear
          ));
          return <article className="data-panel curriculum-admin-request" key={selection.id}>
            <div className="curriculum-request-heading">
              <div><h3>{selection.student_name_snapshot}</h3>
                <p>ID {selection.admission_number_snapshot || '—'} · {selection.parent_name || 'Parent account unavailable'}</p>
                <p>{selection.request_type === 'initial_selection' ? 'Year 6 pathway selection' : 'Pathway change request'} · submitted {displayDate(selection.submitted_at)}</p>
              </div>
              <span className={`parent-request-status ${selection.status}`}>{selection.status.replace(/_/g, ' ')}</span>
            </div>
            <div className="curriculum-request-details">
              <div><span>Requested pathway</span><strong>{selection.selected_curriculum === 'GES' ? 'GES · JHS 1–3' : 'Pearson · Year 7–11'}</strong></div>
              {selection.request_type === 'change_request' && <div><span>Current pathway</span><strong>{selection.previous_curriculum} · {selection.current_class_name || 'class unavailable'}</strong></div>}
              <div><span>Current assignment</span><strong>{selection.current_class_name || 'Unassigned'}{selection.current_year_level ? ` · ${classStageLabel(selection.current_year_level, selection.current_curriculum)}` : ''}</strong></div>
              <div><span>Parent note</span><strong>{selection.reason || 'No note provided'}</strong></div>
              {selection.rejection_reason && <div><span>Decision reason</span><strong>{selection.rejection_reason}</strong></div>}
            </div>

            {selection.status === 'pending_approval' && <div className="curriculum-review-controls">
              <label>Reason if declining
                <textarea rows={2} maxLength={1000} value={rejectionReasons[selection.id] || ''}
                  onChange={(event) => setRejectionReasons({ ...rejectionReasons, [selection.id]: event.target.value })} />
              </label>
              <div><button className="btn-primary" type="button" disabled={busyId === selection.id}
                onClick={() => review(selection, 'approve')}>Approve request</button>
                <button className="btn-secondary" type="button" disabled={busyId === selection.id || !(rejectionReasons[selection.id] || '').trim()}
                  onClick={() => review(selection, 'reject')}>Reject with reason</button></div>
            </div>}

            {selection.status === 'approved_pending_class' && <div className="curriculum-review-controls">
              <label>Destination class · {selection.selected_curriculum} {classStageLabel(targetYear, selection.selected_curriculum)}
                <select value={classChoices[selection.id] || ''} onChange={(event) => setClassChoices({ ...classChoices, [selection.id]: event.target.value })}>
                  <option value="">Select a matching class</option>
                  {matchingClasses.map((classItem) => <option value={classItem.id} key={classItem.id}>{classItem.name}</option>)}
                </select>
              </label>
              {!matchingClasses.length && <p className="parent-error">Create a matching pathway class at the required stage before assignment.</p>}
              <button className="btn-primary" type="button" disabled={busyId === selection.id || !matchingClasses.length}
                onClick={() => assignClass(selection)}>Assign class</button>
            </div>}
            {selection.assigned_at && <p className="curriculum-assigned-date">Class assigned {displayDate(selection.assigned_at)}</p>}
          </article>;
        }) : <div className="data-panel empty-state">No curriculum requests are recorded for this academic year.</div>}
      </section>
    </div>
  </div>;
}

export default CurriculumSelectionsAdmin;
