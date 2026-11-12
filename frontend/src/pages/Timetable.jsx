import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Copy, Download, Lock, Pencil, Plus, Printer, RefreshCw, Save, Trash2, Unlock } from 'lucide-react';
import {
  copyPreviousTerm, createTimetableEntry, createTimetableVersion, deleteTimetableEntry,
  generateTimetable, getTimetable, getTimetableMeta, getTimetableValidation,
  getTimetableVersions, publishTimetable, setTimetableEntryLock, updateTimetableEntry,
  upsertClassTeacher, upsertTimetableAssignment, upsertTimetablePeriod,
  upsertTimetableRequirement, upsertTimetableRoom, upsertTimetableAvailability,
  upsertWorkloadLimit, updateTimetableSettings,
} from '../api/timetable';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const emptyLesson = { class_id: '', subject_id: '', teacher_id: '', room_id: '', day_of_week: 'Monday', period_id: '', period_count: 1, start_time: '08:00', end_time: '08:40' };
const emptyRequirement = { class_id: '', subject_id: '', lessons_per_week: 1, double_periods_per_week: 0, room_required: false };
const emptyAvailability = { type: 'teacher', teacher_id: '', class_id: '', room_id: '', day_of_week: 'Monday', start_time: '08:00', end_time: '08:40', is_available: false, reason: '' };

function Timetable() {
  const user = useMemo(() => JSON.parse(localStorage.getItem('user') || 'null'), []);
  const isAdmin = user?.role === 'admin';
  const [versions, setVersions] = useState([]);
  const [years, setYears] = useState([]);
  const [terms, setTerms] = useState(['Term 1', 'Term 2', 'Term 3']);
  const [year, setYear] = useState('');
  const [term, setTerm] = useState('');
  const [version, setVersion] = useState(null);
  const [meta, setMeta] = useState(null);
  const [entries, setEntries] = useState([]);
  const [validation, setValidation] = useState(null);
  const [lesson, setLesson] = useState(emptyLesson);
  const [editingId, setEditingId] = useState(null);
  const [selectedClasses, setSelectedClasses] = useState([]);
  const [replaceClasses, setReplaceClasses] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  const [conflictSuggestions, setConflictSuggestions] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [setupTab, setSetupTab] = useState('requirements');
  const [requirement, setRequirement] = useState(emptyRequirement);
  const [assignment, setAssignment] = useState({ class_id: '', subject_id: '', teacher_id: '' });
  const [classTeacher, setClassTeacher] = useState({ class_id: '', teacher_id: '' });
  const [period, setPeriod] = useState({ name: '', day_of_week: '', start_time: '08:00', end_time: '08:40', is_break: false, sort_order: 1 });
  const [availability, setAvailability] = useState(emptyAvailability);
  const [room, setRoom] = useState({ name: '', capacity: '', location: '' });
  const [workload, setWorkload] = useState({ teacher_id: '', max_periods_per_week: 30 });
  const [termSettings, setTermSettings] = useState({ subject_teaching_starts_from: '' });

  const showError = (err) => setError(err.response?.data?.message || err.message || 'The timetable request could not be completed.');
  const loadVersion = useCallback(async (selected) => {
    if (!selected) {
      setVersion(null); setMeta(null); setEntries([]); setValidation(null);
      return;
    }
    setBusy(true); setError('');
    try {
      const params = { version_id: selected.id, academic_year: selected.academic_year, term: selected.term };
      const [metaResponse, timetableResponse] = await Promise.all([
        isAdmin ? getTimetableMeta({ version_id: selected.id }) : Promise.resolve({ data: null }),
        getTimetable(params),
      ]);
      setVersion(selected);
      setMeta(metaResponse.data);
      setEntries(timetableResponse.data || []);
      setTermSettings({ subject_teaching_starts_from: metaResponse.data?.settings?.subject_teaching_starts_from || 'Class 4' });
      setLesson(emptyLesson);
      setEditingId(null);
      setValidation(null);
      if (isAdmin && selected.status === 'DRAFT') {
        const report = await getTimetableValidation({ version_id: selected.id });
        setValidation(report.data);
      }
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  }, [isAdmin]);

  const refreshVersion = useCallback(async () => {
    const response = await getTimetableVersions();
    const data = response.data;
    const allVersions = data.versions || [];
    setVersions(allVersions);
    setYears(data.academic_years || []);
    setTerms(data.terms?.length ? data.terms : ['Term 1', 'Term 2', 'Term 3']);
    const defaultYear = year || data.school?.academic_year || data.academic_years?.[0] || '';
    const defaultTerm = term || data.school?.current_term || 'Term 1';
    setYear(defaultYear); setTerm(defaultTerm);
    const matching = allVersions.filter((item) => item.academic_year === defaultYear && item.term === defaultTerm);
    const selected = matching.find((item) => item.status === 'DRAFT') || matching.find((item) => item.status === 'PUBLISHED') || null;
    if (selected) await loadVersion(selected);
    else await loadVersion(null);
  }, [year, term, loadVersion]);

  useEffect(() => { refreshVersion().catch(showError); }, []); // Load the school's configured year and term once.

  const chooseTerm = async (nextYear, nextTerm) => {
    setYear(nextYear); setTerm(nextTerm); setError(''); setMessage('');
    const matching = versions.filter((item) => item.academic_year === nextYear && item.term === nextTerm);
    const selected = matching.find((item) => item.status === 'DRAFT') || matching.find((item) => item.status === 'PUBLISHED') || null;
    await loadVersion(selected);
  };

  const createDraft = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const created = await createTimetableVersion({ academic_year: year, term });
      setVersions((items) => [...items, created.data]);
      await loadVersion(created.data);
      setMessage(`A separate ${year}, ${term} draft is ready. Existing published terms are unchanged.`);
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  };

  const activeClass = meta?.classes?.find((item) => String(item.id) === String(lesson.class_id));
  const termTeachers = meta?.class_teacher_assignments || [];
  const currentClassTeacher = termTeachers.find((item) => String(item.class_id) === String(lesson.class_id));
  const availableTeachers = meta?.assignments?.filter((item) => String(item.class_id) === String(lesson.class_id) && String(item.subject_id) === String(lesson.subject_id)) || [];
  const effectiveTeachers = activeClass && Number(activeClass.year_level) <= 3 && activeClass.teaching_model === 'class_teacher' && currentClassTeacher
    ? [{ teacher_id: currentClassTeacher.teacher_id, teacher_name: currentClassTeacher.teacher_name }, ...availableTeachers]
    : availableTeachers;

  const saveLesson = async (event) => {
    event.preventDefault();
    if (!version || version.status !== 'DRAFT') return;
    setBusy(true); setError(''); setMessage(''); setConflictSuggestions([]);
    const payload = { ...lesson, version_id: version.id, expected_revision: version.revision };
    try {
      if (editingId) await updateTimetableEntry(editingId, payload);
      else await createTimetableEntry(payload);
      setMessage(editingId ? 'Lesson updated in this term draft.' : 'Lesson added to this term draft.');
      await reloadActive();
    } catch (err) {
      showError(err);
      setConflictSuggestions(err.response?.data?.suggestions || []);
    } finally { setBusy(false); }
  };

  const reloadActive = async () => {
    const response = await getTimetableVersions();
    setVersions(response.data.versions || []);
    const next = response.data.versions?.find((item) => item.id === version?.id);
    if (next) await loadVersion(next);
  };

  const editLesson = (entry) => {
    setEditingId(entry.id);
    setLesson({ class_id: String(entry.class_id || ''), subject_id: String(entry.subject_id || ''), teacher_id: String(entry.teacher_id || ''),
      room_id: String(entry.room_id || ''), day_of_week: entry.day_of_week, period_id: String(entry.period_id || ''),
      period_count: Number(entry.period_count || 1), start_time: String(entry.start_time).slice(0, 5), end_time: String(entry.end_time).slice(0, 5) });
    setError(''); setMessage('');
  };

  const removeLesson = async (entry) => {
    setBusy(true); setError('');
    try {
      await deleteTimetableEntry(entry.id, { expected_revision: version.revision });
      setMessage('Lesson removed from this draft.'); await reloadActive();
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  };

  const toggleLessonLock = async (entry) => {
    setBusy(true); setError('');
    try {
      await setTimetableEntryLock(entry.id, { expected_revision: version.revision, is_locked: !entry.is_locked });
      setMessage(entry.is_locked ? 'Lesson unlocked for editing and regeneration.' : 'Lesson approved and locked in this draft.');
      await reloadActive();
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  };

  const generate = async () => {
    if (!version || version.status !== 'DRAFT') return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await generateTimetable({ version_id: version.id, expected_revision: version.revision,
        class_ids: selectedClasses.length ? selectedClasses.map(Number) : null, overwrite_draft: replaceClasses });
      setMessage(`${result.data.summary?.scheduled || 0} periods scheduled for ${year}, ${term}.`);
      await reloadActive();
    } catch (err) { showError(err); setConflictSuggestions(err.response?.data?.suggestions || []); }
    finally { setBusy(false); }
  };

  const validate = async () => {
    if (!version) return;
    setBusy(true); setError('');
    try {
      const response = await getTimetableValidation({ version_id: version.id });
      setValidation(response.data);
      setMessage(response.data.is_valid ? `${year}, ${term} passes the publication checks.` : 'Review the term-specific validation issues before publishing.');
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    if (!version) return;
    setBusy(true); setError('');
    try {
      const result = await publishTimetable({ version_id: version.id, expected_revision: version.revision });
      setMessage(`${year}, ${term} is now published. Earlier terms remain archived and unchanged.`);
      await refreshVersion();
    } catch (err) { showError(err); if (err.response?.data?.validation) setValidation(err.response.data.validation); }
    finally { setBusy(false); }
  };

  const copySchedule = async () => {
    if (!version || !copySourceId) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await copyPreviousTerm(version.id, { source_version_id: Number(copySourceId), expected_revision: version.revision });
      setMessage(`${result.data.lessons_copied} lessons copied into a separate ${year}, ${term} draft. Nothing was published.`);
      await reloadActive();
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  };

  const saveConfiguration = async (event, action) => {
    event.preventDefault();
    if (!version) return;
    setBusy(true); setError(''); setMessage('');
    const data = { version_id: version.id };
    try {
      if (action === 'requirement') await upsertTimetableRequirement({ ...requirement, ...data });
      if (action === 'assignment') await upsertTimetableAssignment({ ...assignment, ...data });
      if (action === 'classTeacher') await upsertClassTeacher({ ...classTeacher, ...data });
      if (action === 'period') await upsertTimetablePeriod({ ...period, day_of_week: period.day_of_week || null, ...data });
      if (action === 'availability') await upsertTimetableAvailability({ ...availability,
        teacher_id: availability.type === 'teacher' ? availability.teacher_id : null,
        class_id: availability.type === 'class' ? availability.class_id : null,
        room_id: availability.type === 'room' ? availability.room_id : null, ...data });
      if (action === 'room') await upsertTimetableRoom(room);
      if (action === 'workload') await upsertWorkloadLimit({ ...workload, ...data });
      if (action === 'settings') await updateTimetableSettings({ ...termSettings, ...data });
      setMessage(`The ${action === 'settings' ? 'term setting' : action} was saved for ${year}, ${term} only.`);
      await reloadActive();
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  };

  const exportCsv = () => {
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [['Academic year', 'Term', 'Day', 'Start', 'End', 'Class', 'Subject', 'Teacher', 'Room', 'Status'],
      ...entries.map((entry) => [year, term, entry.day_of_week, String(entry.start_time).slice(0, 5), String(entry.end_time).slice(0, 5), entry.class_name, entry.subject, entry.teacher_name, entry.room_name, version?.status])];
    const blob = new Blob([rows.map((row) => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `timetable-${year}-${term.replaceAll(' ', '-')}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  const dayList = entries.some((entry) => entry.day_of_week === 'Saturday') ? DAYS : DAYS.slice(0, 5);
  const matchingVersions = versions.filter((item) => item.academic_year === year && item.term === term);
  const isDraft = isAdmin && version?.status === 'DRAFT';
  const groupedEntries = useMemo(() => Object.fromEntries(dayList.map((day) => [day, entries.filter((entry) => entry.day_of_week === day)
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))])), [entries, dayList.join('|')]);

  return (
    <div className="page module-page timetable-page">
      <div className="module-shell timetable-shell">
        <section className="module-hero timetable-hero">
          <div><p className="eyebrow">Weekly recurring schedule · term-managed</p><h1>Timetable</h1>
            <p>Choose an academic year and term. Each term has its own configuration, draft, and published history.</p></div>
          <span className="timetable-icon"><CalendarDays size={20} /></span>
        </section>

        <section className="data-panel timetable-term-bar" aria-label="Select academic year and term">
          <div className="term-picker-title"><strong>Selected timetable</strong><span>All edits, validation, exports, and publishing apply to this term.</span></div>
          <label>Academic year<input list="timetable-academic-years" value={year} onChange={(event) => {
            const nextYear = event.target.value;
            setYear(nextYear);
            const selected = versions.filter((item) => item.academic_year === nextYear && item.term === term)
              .find((item) => item.status === 'DRAFT') || versions.filter((item) => item.academic_year === nextYear && item.term === term)
                .find((item) => item.status === 'PUBLISHED') || null;
            loadVersion(selected);
          }} placeholder="e.g. 2026/2027" />
            <datalist id="timetable-academic-years">{years.map((item) => <option key={item} value={item} />)}</datalist>
          </label>
          <label>Term<select value={term} onChange={(event) => chooseTerm(year, event.target.value)}>
            {terms.map((item) => <option key={item} value={item}>{item}</option>)}
          </select></label>
          <div className={`timetable-version-state state-${(version?.status || 'uncreated').toLowerCase()}`}>
            <span>{version?.status || 'Not created'}</span>{version && <small>Revision {version.revision}</small>}
          </div>
          {isAdmin && !matchingVersions.some((item) => item.status === 'DRAFT') && <button className="btn-primary" onClick={createDraft} disabled={busy || !year || !term}>
            <Plus size={15} /> {matchingVersions.some((item) => item.status === 'PUBLISHED') ? 'Create replacement draft' : 'Create term draft'}
          </button>}
        </section>

        <div className="timetable-selected-label"><strong>{year || 'Academic year not set'} · {term || 'Select a term'}</strong>
          <span>{version ? `Version ${version.revision} · ${version.status}` : 'No timetable has been created for this term yet.'}</span></div>
        {message && <div className="timetable-message success" role="status">{message}</div>}
        {error && <div className="timetable-message error" role="alert">{error}</div>}

        {isAdmin && !version && year && term && <section className="data-panel timetable-empty-term">
          <h2>{year}, {term} has no timetable yet</h2><p>Create a term-specific draft, configure its periods and weekly lesson requirements, then generate the recurring weekly schedule.</p>
          <button className="btn-primary" type="button" onClick={createDraft} disabled={busy}><Plus size={15} /> Create draft for this term</button>
        </section>}

        {isAdmin && version && matchingVersions.some((item) => item.status === 'PUBLISHED') && isDraft && <section className="data-panel timetable-copy-panel">
          <div><strong>Start from another term</strong><small>Copying makes an independent draft; it never publishes or changes the source term.</small></div>
          <select value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)} aria-label="Term to copy from">
            <option value="">Choose a published timetable</option>
            {versions.filter((item) => item.status === 'PUBLISHED' && item.term_id !== version.term_id).map((item) => <option key={item.id} value={item.id}>{item.academic_year} · {item.term} · Rev {item.revision}</option>)}
          </select>
          <button className="btn-secondary" type="button" onClick={copySchedule} disabled={busy || !copySourceId}><Copy size={14} /> Copy into this draft</button>
        </section>}

        {isAdmin && isDraft && <section className="data-panel timetable-actions-panel">
          <div className="timetable-panel-heading"><div><p className="eyebrow">Draft workflow</p><h2>{year} · {term}</h2></div>
            <div className="timetable-action-buttons">
              <button className="btn-secondary" type="button" onClick={() => setShowSetup((value) => !value)}>{showSetup ? 'Hide term setup' : 'Term setup'}</button>
              <button className="btn-secondary" type="button" onClick={validate} disabled={busy}><Check size={14} /> Validate</button>
              <button className="btn-secondary" type="button" onClick={exportCsv} disabled={!entries.length}><Download size={14} /> Export CSV</button>
              <button className="btn-secondary" type="button" onClick={() => window.print()}><Printer size={14} /> Print</button>
              <button className="btn-primary" type="button" onClick={publish} disabled={busy || !validation?.is_valid}><Check size={14} /> Publish this term</button>
            </div>
          </div>
          <div className="timetable-generate-row">
            <label>Regenerate classes (leave empty for whole school)<select multiple value={selectedClasses} onChange={(event) => setSelectedClasses([...event.target.selectedOptions].map((option) => option.value))}>
              {(meta?.classes || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label className="timetable-checkbox"><input type="checkbox" checked={replaceClasses} onChange={(event) => setReplaceClasses(event.target.checked)} /> Replace generated lessons in selected scope</label>
            <button className="btn-primary" type="button" onClick={generate} disabled={busy || !meta?.requirements?.length}><RefreshCw size={14} /> Generate draft</button>
          </div>
          {validation && <div className={`timetable-validation ${validation.is_valid ? 'valid' : 'invalid'}`}>
            <strong>{validation.is_valid ? 'Ready to publish' : 'Publication checks need attention'}</strong>
            <span>{validation.total_lessons} lesson blocks checked · {validation.weekly_requirements?.filter((item) => item.missing_lessons || item.extra_lessons).length || 0} weekly requirement gaps · {validation.conflicts?.length || 0} conflicts</span>
            {!!validation.conflicts?.length && <ul>{validation.conflicts.map((item, index) => <li key={`${item.type}-${index}`}>{item.message}</li>)}</ul>}
            {!!validation.weekly_requirements?.length && <div className="timetable-requirement-status">{validation.weekly_requirements.map((item) => <span key={item.id} className={item.missing_lessons || item.extra_lessons || item.missing_teacher_assignment ? 'needs-attention' : ''}>{item.class_name} · {item.subject_name}: {item.generated_periods}/{item.lessons_per_week} periods{item.missing_teacher_assignment ? ' · teacher missing' : ''}</span>)}</div>}
          </div>}
        </section>}

        {isAdmin && showSetup && isDraft && meta && <section className="data-panel timetable-setup-panel">
          <div className="timetable-panel-heading"><div><p className="eyebrow">Configuration applies to this draft term</p><h2>Term-specific settings</h2></div></div>
          <div className="timetable-setup-tabs">{[['requirements', 'Weekly requirements'], ['teachers', 'Teacher assignments'], ['periods', 'Periods'], ['availability', 'Availability'], ['resources', 'Rooms & workload'], ['settings', 'Term rules']].map(([key, label]) => <button className={setupTab === key ? 'selected' : ''} key={key} type="button" onClick={() => setSetupTab(key)}>{label}</button>)}</div>
          {setupTab === 'requirements' && <form className="timetable-config-form" onSubmit={(event) => saveConfiguration(event, 'requirement')}>
            <label>Class<select required value={requirement.class_id} onChange={(event) => setRequirement({ ...requirement, class_id: event.target.value })}><option value="">Select class</option>{meta.classes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>Subject<select required value={requirement.subject_id} onChange={(event) => setRequirement({ ...requirement, subject_id: event.target.value })}><option value="">Select subject</option>{meta.subjects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>Periods per week<input type="number" min="0" required value={requirement.lessons_per_week} onChange={(event) => setRequirement({ ...requirement, lessons_per_week: Number(event.target.value) })} /></label>
            <label>Double lessons<input type="number" min="0" value={requirement.double_periods_per_week} onChange={(event) => setRequirement({ ...requirement, double_periods_per_week: Number(event.target.value) })} /></label>
            <label className="timetable-checkbox"><input type="checkbox" checked={requirement.room_required} onChange={(event) => setRequirement({ ...requirement, room_required: event.target.checked })} /> Room required</label>
            <button className="btn-primary" disabled={busy}><Save size={14} /> Save requirement</button>
            <div className="timetable-config-list">{meta.requirements.map((item) => <span key={item.id}>{item.class_name} · {item.subject_name}: {item.lessons_per_week} periods/week</span>)}</div>
          </form>}
          {setupTab === 'teachers' && <div className="timetable-config-stack">
            <form className="timetable-config-form" onSubmit={(event) => saveConfiguration(event, 'classTeacher')}>
              <label>Class teacher assignment class<select required value={classTeacher.class_id} onChange={(event) => setClassTeacher({ ...classTeacher, class_id: event.target.value })}><option value="">Select class</option>{meta.classes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <label>Class teacher<select required value={classTeacher.teacher_id} onChange={(event) => setClassTeacher({ ...classTeacher, teacher_id: event.target.value })}><option value="">Select teacher</option>{meta.teachers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <button className="btn-primary" disabled={busy}><Save size={14} /> Save class teacher</button>
            </form>
            <form className="timetable-config-form" onSubmit={(event) => saveConfiguration(event, 'assignment')}>
              <label>Class<select required value={assignment.class_id} onChange={(event) => setAssignment({ ...assignment, class_id: event.target.value })}><option value="">Select class</option>{meta.classes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <label>Subject<select required value={assignment.subject_id} onChange={(event) => setAssignment({ ...assignment, subject_id: event.target.value })}><option value="">Select subject</option>{meta.subjects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <label>Specialist teacher<select required value={assignment.teacher_id} onChange={(event) => setAssignment({ ...assignment, teacher_id: event.target.value })}><option value="">Select teacher</option>{meta.teachers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <button className="btn-primary" disabled={busy}><Save size={14} /> Save subject teacher</button>
            </form>
            <div className="timetable-config-list">{meta.class_teacher_assignments.map((item) => <span key={`ct-${item.id}`}>{item.class_name} class teacher: {item.teacher_name}</span>)}{meta.assignments.map((item) => <span key={`as-${item.id}`}>{item.class_name} · {item.subject_name}: {item.teacher_name}</span>)}</div>
          </div>}
          {setupTab === 'periods' && <form className="timetable-config-form" onSubmit={(event) => saveConfiguration(event, 'period')}>
            <label>Period name<input required value={period.name} onChange={(event) => setPeriod({ ...period, name: event.target.value })} placeholder="Period 1 or Break" /></label>
            <label>Day<select value={period.day_of_week} onChange={(event) => setPeriod({ ...period, day_of_week: event.target.value })}><option value="">Every configured day</option>{DAYS.map((day) => <option key={day}>{day}</option>)}</select></label>
            <label>Start<input type="time" required value={period.start_time} onChange={(event) => setPeriod({ ...period, start_time: event.target.value })} /></label>
            <label>End<input type="time" required value={period.end_time} onChange={(event) => setPeriod({ ...period, end_time: event.target.value })} /></label>
            <label>Sort order<input type="number" min="0" value={period.sort_order} onChange={(event) => setPeriod({ ...period, sort_order: Number(event.target.value) })} /></label>
            <label className="timetable-checkbox"><input type="checkbox" checked={period.is_break} onChange={(event) => setPeriod({ ...period, is_break: event.target.checked })} /> Break / non-teaching</label>
            <button className="btn-primary" disabled={busy}><Save size={14} /> Add period</button>
            <div className="timetable-config-list">{meta.periods.map((item) => <span key={item.id}>{item.day_of_week || 'All days'} · {item.name} · {String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}{item.is_break ? ' · Break' : ''}</span>)}</div>
          </form>}
          {setupTab === 'availability' && <form className="timetable-config-form" onSubmit={(event) => saveConfiguration(event, 'availability')}>
            <label>Resource<select value={availability.type} onChange={(event) => setAvailability({ ...emptyAvailability, type: event.target.value })}><option value="teacher">Teacher</option><option value="class">Class</option><option value="room">Room</option></select></label>
            <label>{availability.type === 'teacher' ? 'Teacher' : availability.type === 'class' ? 'Class' : 'Room'}<select required value={availability[`${availability.type}_id`]} onChange={(event) => setAvailability({ ...availability, [`${availability.type}_id`]: event.target.value })}><option value="">Select {availability.type}</option>{(availability.type === 'teacher' ? meta.teachers : availability.type === 'class' ? meta.classes : meta.rooms).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>Day<select value={availability.day_of_week} onChange={(event) => setAvailability({ ...availability, day_of_week: event.target.value })}>{DAYS.map((day) => <option key={day}>{day}</option>)}</select></label>
            <label>From<input type="time" required value={availability.start_time} onChange={(event) => setAvailability({ ...availability, start_time: event.target.value })} /></label>
            <label>To<input type="time" required value={availability.end_time} onChange={(event) => setAvailability({ ...availability, end_time: event.target.value })} /></label>
            <label>Availability<select value={String(availability.is_available)} onChange={(event) => setAvailability({ ...availability, is_available: event.target.value === 'true' })}><option value="false">Unavailable</option><option value="true">Available</option></select></label>
            <label>Reason<input value={availability.reason} onChange={(event) => setAvailability({ ...availability, reason: event.target.value })} /></label>
            <button className="btn-primary" disabled={busy}><Save size={14} /> Save availability</button>
            <div className="timetable-config-list">{meta.availability.map((item) => <span key={`${item.type}-${item.id}`}>{item.type} · {item.day_of_week} · {String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)} · {item.is_available ? 'Available' : 'Unavailable'}</span>)}</div>
          </form>}
          {setupTab === 'resources' && <div className="timetable-config-stack">
            <form className="timetable-config-form" onSubmit={(event) => saveConfiguration(event, 'room')}>
              <label>Room name<input required value={room.name} onChange={(event) => setRoom({ ...room, name: event.target.value })} /></label><label>Capacity<input type="number" min="1" value={room.capacity} onChange={(event) => setRoom({ ...room, capacity: event.target.value })} /></label><label>Location<input value={room.location} onChange={(event) => setRoom({ ...room, location: event.target.value })} /></label><button className="btn-primary" disabled={busy}><Plus size={14} /> Add room</button>
            </form>
            <form className="timetable-config-form" onSubmit={(event) => saveConfiguration(event, 'workload')}>
              <label>Teacher<select required value={workload.teacher_id} onChange={(event) => setWorkload({ ...workload, teacher_id: event.target.value })}><option value="">Select teacher</option>{meta.teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Maximum periods/week<input type="number" min="1" required value={workload.max_periods_per_week} onChange={(event) => setWorkload({ ...workload, max_periods_per_week: Number(event.target.value) })} /></label><button className="btn-primary" disabled={busy}><Save size={14} /> Save workload</button>
            </form>
            <div className="timetable-config-list">{meta.rooms.map((item) => <span key={item.id}>{item.name}{item.capacity ? ` · ${item.capacity} seats` : ''}</span>)}{meta.workload_limits.map((item) => <span key={`wl-${item.id}`}>{item.teacher_name}: max {item.max_periods_per_week} periods/week</span>)}</div>
          </div>}
          {setupTab === 'settings' && <form className="timetable-config-form" onSubmit={(event) => saveConfiguration(event, 'settings')}>
            <label>Subject-teaching starts from<input value={termSettings.subject_teaching_starts_from} onChange={(event) => setTermSettings({ ...termSettings, subject_teaching_starts_from: event.target.value })} placeholder="Class 4" /></label><button className="btn-primary" disabled={busy}><Save size={14} /> Save term rule</button>
          </form>}
        </section>}

        {isAdmin && isDraft && meta && <section className="data-panel timetable-editor-panel">
          <div className="timetable-panel-heading"><div><p className="eyebrow">Draft lesson editor</p><h2>{editingId ? 'Edit lesson' : 'Add a lesson'}</h2></div>
            {editingId && <button className="btn-secondary" type="button" onClick={() => { setLesson(emptyLesson); setEditingId(null); }}>Cancel edit</button>}
          </div>
          <form className="timetable-lesson-form" onSubmit={saveLesson}>
            <label>Class<select required value={lesson.class_id} onChange={(event) => setLesson({ ...lesson, class_id: event.target.value, subject_id: '', teacher_id: '' })}><option value="">Select class</option>{meta.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Subject<select required value={lesson.subject_id} onChange={(event) => setLesson({ ...lesson, subject_id: event.target.value, teacher_id: '' })}><option value="">Select subject</option>{meta.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Teacher<select required value={lesson.teacher_id} onChange={(event) => setLesson({ ...lesson, teacher_id: event.target.value })}><option value="">Select assigned teacher</option>{effectiveTeachers.map((item) => <option key={`${item.teacher_id}-${item.id || 'class'}`} value={item.teacher_id}>{item.teacher_name}</option>)}</select></label>
            <label>Room<select value={lesson.room_id} onChange={(event) => setLesson({ ...lesson, room_id: event.target.value })}><option value="">No room</option>{meta.rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Day<select value={lesson.day_of_week} onChange={(event) => setLesson({ ...lesson, day_of_week: event.target.value })}>{DAYS.map((day) => <option key={day}>{day}</option>)}</select></label>
            <label>Period<select value={lesson.period_id} onChange={(event) => { const selected = meta.periods.find((item) => String(item.id) === event.target.value); setLesson({ ...lesson, period_id: event.target.value, day_of_week: selected?.day_of_week || lesson.day_of_week, start_time: selected ? String(selected.start_time).slice(0, 5) : lesson.start_time, end_time: selected ? String(selected.end_time).slice(0, 5) : lesson.end_time }); }}><option value="">Custom time</option>{meta.periods.filter((item) => !item.is_break).map((item) => <option key={item.id} value={item.id}>{item.name} · {String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}{item.day_of_week ? ` · ${item.day_of_week}` : ''}</option>)}</select></label>
            {!lesson.period_id && <><label>Start<input type="time" required value={lesson.start_time} onChange={(event) => setLesson({ ...lesson, start_time: event.target.value })} /></label><label>End<input type="time" required value={lesson.end_time} onChange={(event) => setLesson({ ...lesson, end_time: event.target.value })} /></label></>}
            <label>Length<select value={lesson.period_count} onChange={(event) => setLesson({ ...lesson, period_count: Number(event.target.value) })}><option value="1">Single period</option><option value="2">Double period</option></select></label>
            <button className="btn-primary" disabled={busy}><Save size={14} /> {editingId ? 'Save lesson' : 'Add to draft'}</button>
          </form>
          {!!conflictSuggestions.length && <div className="timetable-suggestions"><strong>Conflict-free alternative periods</strong>{conflictSuggestions.map((item, index) => <button type="button" key={`${item.day_of_week}-${item.start_time}-${index}`} onClick={() => setLesson({ ...lesson, ...item, period_id: item.period_id || '' })}>{item.day_of_week} · {String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}</button>)}</div>}
        </section>}

        {version && <section className="data-panel timetable-board-panel">
          <div className="timetable-panel-heading"><div><p className="eyebrow">Weekly recurring schedule</p><h2>{year} · {term} · {version.status}</h2></div>
            <div className="timetable-action-buttons"><button className="btn-secondary" type="button" onClick={exportCsv} disabled={!entries.length}><Download size={14} /> Export CSV</button><button className="btn-secondary" type="button" onClick={() => window.print()}><Printer size={14} /> Print</button></div>
          </div>
          {busy && <p className="timetable-loading">Loading term timetable...</p>}
          {!entries.length && !busy ? <div className="timetable-empty-board"><CalendarDays size={23} /><strong>No lessons in this term version</strong><span>Generate a school schedule or add lessons to the selected term draft.</span></div> : <div className="timetable-week-grid" style={{ '--day-count': dayList.length }}>
            {dayList.map((day) => <div className="timetable-day-column" key={day}><h3>{day}</h3>{groupedEntries[day].length ? groupedEntries[day].map((entry) => <article className="timetable-lesson-card" key={entry.id}>
              <div className="lesson-card-top"><span>{String(entry.start_time).slice(0, 5)}–{String(entry.end_time).slice(0, 5)}</span>{entry.is_locked && <Lock size={12} aria-label="Approved and locked" />}</div>
              <strong>{entry.subject}</strong><span>{entry.class_name}</span><small>{entry.teacher_name || 'Teacher not assigned'}{entry.room_name ? ` · ${entry.room_name}` : ''}</small>
              {isAdmin && isDraft && <div className="lesson-card-actions"><button type="button" title="Edit lesson" onClick={() => editLesson(entry)} disabled={entry.is_locked}><Pencil size={13} /></button><button type="button" title={entry.is_locked ? 'Unlock approved lesson' : 'Lock approved lesson'} onClick={() => toggleLessonLock(entry)}>{entry.is_locked ? <Unlock size={13} /> : <Lock size={13} />}</button><button type="button" title="Delete lesson" onClick={() => removeLesson(entry)} disabled={entry.is_locked}><Trash2 size={13} /></button></div>}
            </article>) : <div className="timetable-free-day">No lessons</div>}</div>)}
          </div>}
        </section>}

        {!!versions.length && <section className="data-panel timetable-history-panel"><div className="timetable-panel-heading"><div><p className="eyebrow">Preserved term versions</p><h2>Timetable history</h2></div></div>
          <div className="timetable-history-list">{versions.map((item) => <button key={item.id} type="button" className={version?.id === item.id ? 'selected' : ''} onClick={() => { setYear(item.academic_year); setTerm(item.term); loadVersion(item); }}>
            <span>{item.academic_year} · {item.term}</span><small>Revision {item.revision} · {item.status}{item.published_at ? ` · Published ${new Date(item.published_at).toLocaleDateString()}` : ''}</small>
          </button>)}</div>
        </section>}
        {!isAdmin && version && <div className="timetable-read-only-note">Published timetable · {version.academic_year} · {version.term}</div>}
      </div>
    </div>
  );
}

export default Timetable;
