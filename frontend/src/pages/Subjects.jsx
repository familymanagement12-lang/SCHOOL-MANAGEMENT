import { useEffect, useState } from 'react';
import { BookOpen, ListFilter } from 'lucide-react';
import {
  getSubjects, createSubject, updateSubject, deleteSubject,
  getSubjectClassAssignments, upsertSubjectClassAssignment,
  getSubjectSchedulingPreferences, upsertSubjectSchedulingPreference,
} from '../api/subjects';
import { getClasses } from '../api/classes';

function Subjects() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    name: '', code: '', curricula: [], is_active: true,
    is_archived: false, is_compulsory: true, lesson_duration_minutes: '',
    applicable_education_stages: [], applicable_year_levels: [], scheduling_preferences: {},
  });
  const educationStages = [
    ['EARLY_YEARS', 'Early Years'],
    ['PRIMARY', 'Primary'],
    ['JHS', 'JHS'],
    ['OTHER', 'Other programmes'],
  ];
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [assignmentForm, setAssignmentForm] = useState({
    class_id: '', subject_id: '', curriculum: '', is_compulsory: true,
    lesson_duration_minutes: '',
  });
  const [preferences, setPreferences] = useState([]);
  const [preferenceForm, setPreferenceForm] = useState({
    subject_id: '', class_id: '', preferred_day_of_week: '',
    preferred_period_slot: '', avoid_period_slot: '', preference_rank: 1,
    reason: '',
  });
  const [savingPreference, setSavingPreference] = useState(false);

  useEffect(() => {
    fetchSubjects();
  }, []);

  const fetchSubjects = async () => {
    try {
      const [subjectsRes, classesRes, assignmentsRes, preferencesRes] = await Promise.all([
        getSubjects(),
        getClasses().catch(() => ({ data: [] })),
        getSubjectClassAssignments().catch(() => ({ data: [] })),
        getSubjectSchedulingPreferences().catch(() => ({ data: [] })),
      ]);
      setSubjects(subjectsRes.data);
      setClasses(classesRes.data);
      setAssignments(assignmentsRes.data);
      setPreferences(preferencesRes.data);
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load subjects');
      setLoading(false);
    }
  };

  const filteredSubjects = subjects.filter((subject) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return true;
    return subject.name.toLowerCase().includes(query) || (subject.code || '').toLowerCase().includes(query);
  });
  const awaitingConfiguration = subjects.filter((subject) => !(subject.curricula || []).length).length;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const payload = {
        ...formData,
        lesson_duration_minutes: formData.lesson_duration_minutes ? Number(formData.lesson_duration_minutes) : null,
        applicable_education_stages: formData.applicable_education_stages,
        applicable_year_levels: formData.applicable_year_levels,
      };
      if (editingId) await updateSubject(editingId, payload);
      else await createSubject(payload);
      setFormData({ name: '', code: '', curricula: [], is_active: true, is_archived: false, is_compulsory: true, lesson_duration_minutes: '', applicable_education_stages: [], applicable_year_levels: [], scheduling_preferences: {} });
      setEditingId(null);
      await fetchSubjects();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create subject');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (subject) => {
    setEditingId(subject.id);
    setFormData({
      name: subject.name,
      code: subject.code || '',
      curricula: subject.curricula || [],
      is_active: subject.is_active !== false,
      is_archived: subject.is_archived === true,
      is_compulsory: subject.is_compulsory !== false,
      lesson_duration_minutes: subject.lesson_duration_minutes || '',
      applicable_education_stages: subject.applicable_education_stages || [],
      applicable_year_levels: subject.applicable_year_levels || [],
      scheduling_preferences: subject.scheduling_preferences || {},
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData({ name: '', code: '', curricula: [], is_active: true, is_archived: false, is_compulsory: true, lesson_duration_minutes: '', applicable_education_stages: [], applicable_year_levels: [], scheduling_preferences: {} });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this subject?')) return;
    setDeletingId(id);
    setError('');
    try {
      await deleteSubject(id);
      await fetchSubjects();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete subject');
    } finally {
      setDeletingId(null);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (error) setError('');
    setFormData({ ...formData, [name]: value });
  };

  const saveClassAssignment = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await upsertSubjectClassAssignment({
        ...assignmentForm,
        lesson_duration_minutes: assignmentForm.lesson_duration_minutes
          ? Number(assignmentForm.lesson_duration_minutes)
          : null,
      });
      await fetchSubjects();
      setAssignmentForm({ class_id: '', subject_id: '', curriculum: '', is_compulsory: true, lesson_duration_minutes: '' });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to assign subject to class.');
    }
  };

  const saveSchedulingPreference = async (event) => {
    event.preventDefault();
    setSavingPreference(true);
    setError('');
    try {
      await upsertSubjectSchedulingPreference({
        subject_id: Number(preferenceForm.subject_id),
        class_id: preferenceForm.class_id ? Number(preferenceForm.class_id) : null,
        preferred_day_of_week: preferenceForm.preferred_day_of_week || null,
        preferred_period_slot: preferenceForm.preferred_period_slot ? Number(preferenceForm.preferred_period_slot) : null,
        avoid_period_slot: preferenceForm.avoid_period_slot ? Number(preferenceForm.avoid_period_slot) : null,
        preference_rank: Number(preferenceForm.preference_rank),
        reason: preferenceForm.reason.trim() || null,
      });
      await fetchSubjects();
      setPreferenceForm({
        subject_id: '', class_id: '', preferred_day_of_week: '',
        preferred_period_slot: '', avoid_period_slot: '', preference_rank: 1,
        reason: '',
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save scheduling preference.');
    } finally {
      setSavingPreference(false);
    }
  };

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero class-hero">
          <div>
            <p className="eyebrow" style={{ color: '#dbeafe', fontWeight: '600' }}>Curriculum</p>
            <h1 style={{ color: '#ffffff', fontSize: '2.5rem', marginTop: '0.25rem', marginBottom: '0.5rem' }}>Subjects</h1>
            <p style={{ color: '#f5f3ff', fontSize: '1.1rem', opacity: 0.9 }}>Manage the subjects taught at your school and keep the academic structure consistent.</p>
          </div>
        </section>

        <section className="stats-grid" aria-label="Subject summary">
          <article className="stat-card overview-stat stat-sky">
            <div className="stat-topline"><span>Total Subjects</span><BookOpen size={16} /></div>
            <strong>{subjects.length}</strong>
            <p>Subjects currently in the curriculum</p>
          </article>

          <article className="stat-card overview-stat stat-emerald">
            <div className="stat-topline"><span>Search</span><ListFilter size={16} /></div>
            <strong>{filteredSubjects.length}</strong>
            <p>Visible in the current directory</p>
          </article>
        </section>

        <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-heading">
              <div><p className="eyebrow">{editingId ? 'Edit Subject' : 'New Subject'}</p><h2>{editingId ? 'Update Subject' : 'Add a Subject'}</h2></div>
            </div>
            {error && <div className="error">{error}</div>}
            <label>Subject Name *</label>
            <input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="e.g. Mathematics" required />
            <label>Subject Code</label>
            <input type="text" name="code" value={formData.code} onChange={handleInputChange} placeholder="e.g. MATH" />
            <label>Curriculum pathways *</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              {['COMMON', 'GES', 'PEARSON'].map((curriculum) => (
                <label key={curriculum} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="checkbox"
                    checked={formData.curricula.includes(curriculum)}
                    onChange={(event) => {
                      const curricula = event.target.checked
                        ? [...formData.curricula, curriculum]
                        : formData.curricula.filter((item) => item !== curriculum);
                      setFormData({ ...formData, curricula });
                    }}
                  />
                  {curriculum === 'PEARSON' ? 'Pearson' : curriculum}
                </label>
              ))}
            </div>
            <label>Applicable education sections *</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              {educationStages.map(([stage, label]) => (
                <label key={stage} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="checkbox"
                    checked={formData.applicable_education_stages.includes(stage)}
                    onChange={(event) => {
                      const stages = event.target.checked
                        ? [...formData.applicable_education_stages, stage]
                        : formData.applicable_education_stages.filter((item) => item !== stage);
                      setFormData({ ...formData, applicable_education_stages: stages });
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label>Lesson duration (minutes)</label>
                <input type="number" min="15" max="240" value={formData.lesson_duration_minutes} onChange={(event) => setFormData({ ...formData, lesson_duration_minutes: event.target.value })} placeholder="e.g. 40" />
              </div>
              <div>
                <label>Applicable year levels</label>
                <input type="text" value={(formData.applicable_year_levels || []).join(',')} onChange={(event) => {
                  const values = event.target.value.trim() ? event.target.value.split(',').map((value) => value.trim()) : [];
                  setFormData({
                    ...formData,
                    applicable_year_levels: values.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 11),
                  });
                }} placeholder="e.g. 4,5,6" />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={formData.is_compulsory} onChange={(event) => setFormData({ ...formData, is_compulsory: event.target.checked })} />
              Compulsory subject
            </label>
            {editingId && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={formData.is_active} onChange={(event) => setFormData({ ...formData, is_active: event.target.checked })} />
                  Active
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={formData.is_archived} onChange={(event) => setFormData({ ...formData, is_archived: event.target.checked, is_active: event.target.checked ? false : formData.is_active })} />
                  Archived
                </label>
              </div>
            )}
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : editingId ? 'Save Changes' : 'Add Subject'}
            </button>
            {editingId && <button type="button" className="btn-secondary" onClick={cancelEdit}>Cancel</button>}
          </form>

          <section className="data-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Directory</p><h2>Available Subjects</h2></div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search subjects by name or code"
              />
            </div>

            <div className="table-wrap">
              <table>
                <thead><tr><th>Code</th><th>Name</th><th>Curricula</th><th>Sections</th><th>Levels</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredSubjects.map(sub => (
                    <tr key={sub.id}>
                      <td><strong>{sub.code || '-'}</strong></td>
                      <td>{sub.name}</td>
                      <td>{(sub.curricula || []).map((curriculum) => curriculum === 'PEARSON' ? 'Pearson' : curriculum).join(', ') || '-'}</td>
                      <td>{(sub.applicable_education_stages || []).map((stage) => educationStages.find(([value]) => value === stage)?.[1] || stage).join(', ') || 'Needs review'}</td>
                      <td>{(sub.applicable_year_levels || []).join(', ') || 'All configured levels'}</td>
                      <td>{sub.is_archived ? 'Archived' : sub.is_active === false ? 'Inactive' : 'Active'} · {sub.is_compulsory === false ? 'Optional' : 'Compulsory'}</td>
                      <td>
                        <button className="btn-small btn-edit" onClick={() => handleEdit(sub)}>Edit</button>
                        <button className="btn-small btn-delete" onClick={() => handleDelete(sub.id)} disabled={deletingId === sub.id}>{deletingId === sub.id ? 'Deleting...' : 'Delete'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredSubjects.length === 0 && <p className="empty-state">No subjects match your current search.</p>}
          </section>
        </section>

        <section className="split-layout">
            <form className="data-panel form-panel" onSubmit={saveClassAssignment}>
              <div className="panel-heading"><div><p className="eyebrow">Explicit mapping</p><h2>Assign Subject to Class</h2></div></div>
              <label>Class *</label>
              <select value={assignmentForm.class_id} onChange={(event) => {
                const selectedClass = classes.find((item) => String(item.id) === event.target.value);
                setAssignmentForm({
                  ...assignmentForm,
                  class_id: event.target.value,
                  curriculum: selectedClass?.curriculum && selectedClass.curriculum !== 'UNASSIGNED'
                    ? selectedClass.curriculum : '',
                });
              }} required>
                <option value="">Select class</option>
                {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <label>Subject *</label>
              <select value={assignmentForm.subject_id} onChange={(event) => setAssignmentForm({ ...assignmentForm, subject_id: event.target.value })} required>
                <option value="">Select subject</option>
                {subjects.filter((item) => item.is_active !== false && item.is_archived !== true).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <label>Curriculum *</label>
              <select value={assignmentForm.curriculum} onChange={(event) => setAssignmentForm({ ...assignmentForm, curriculum: event.target.value })} required>
                <option value="">Select curriculum</option>
                <option value="COMMON">Common Primary</option>
                <option value="GES">GES / JHS</option>
                <option value="PEARSON">Pearson</option>
              </select>
              <label>Lesson duration (optional)</label>
              <input type="number" min="15" max="240" value={assignmentForm.lesson_duration_minutes} onChange={(event) => setAssignmentForm({ ...assignmentForm, lesson_duration_minutes: event.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={assignmentForm.is_compulsory} onChange={(event) => setAssignmentForm({ ...assignmentForm, is_compulsory: event.target.checked })} />
                Compulsory in this class
              </label>
              <button type="submit" className="btn-primary">Save class assignment</button>
            </form>

            <section className="data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Class structure</p><h2>Assigned Subjects</h2></div></div>
              <div className="table-wrap"><table><thead><tr><th>Class</th><th>Subject</th><th>Curriculum</th><th>Requirement</th><th>Duration</th></tr></thead>
                <tbody>{assignments.map((item) => <tr key={item.id}>
                  <td>{item.class_name}</td><td>{item.subject_name}</td>
                  <td>{item.curriculum === 'PEARSON' ? 'Pearson' : item.curriculum === 'GES' ? 'GES / JHS' : 'Common Primary'}</td>
                  <td>{item.is_compulsory ? 'Compulsory' : 'Optional'}</td>
                  <td>{item.lesson_duration_minutes ? `${item.lesson_duration_minutes} min` : '-'}</td>
                </tr>)}</tbody>
              </table></div>
              {!assignments.length && <p className="empty-state">No explicit class-subject assignments are configured yet.</p>}
            </section>
        </section>

        <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={saveSchedulingPreference}>
            <div className="panel-heading">
              <div><p className="eyebrow">Timetable solver</p><h2>Scheduling Preferences</h2></div>
            </div>
            <label>Subject *</label>
            <select value={preferenceForm.subject_id} onChange={(event) => setPreferenceForm({ ...preferenceForm, subject_id: event.target.value })} required>
              <option value="">Select subject</option>
              {subjects.filter((item) => item.is_active !== false && item.is_archived !== true).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <label>Class (optional)</label>
            <select value={preferenceForm.class_id} onChange={(event) => setPreferenceForm({ ...preferenceForm, class_id: event.target.value })}>
              <option value="">Applies to all classes</option>
              {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <label>Preferred day</label>
            <select value={preferenceForm.preferred_day_of_week} onChange={(event) => setPreferenceForm({ ...preferenceForm, preferred_day_of_week: event.target.value })}>
              <option value="">No preferred day</option>
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label>Preferred period</label>
                <input type="number" min="1" value={preferenceForm.preferred_period_slot} onChange={(event) => setPreferenceForm({ ...preferenceForm, preferred_period_slot: event.target.value })} placeholder="e.g. 2" />
              </div>
              <div>
                <label>Avoid period</label>
                <input type="number" min="1" value={preferenceForm.avoid_period_slot} onChange={(event) => setPreferenceForm({ ...preferenceForm, avoid_period_slot: event.target.value })} placeholder="e.g. 6" />
              </div>
            </div>
            <label>Preference rank (1–10)</label>
            <input type="number" min="1" max="10" value={preferenceForm.preference_rank} onChange={(event) => setPreferenceForm({ ...preferenceForm, preference_rank: event.target.value })} required />
            <label>Reason (optional)</label>
            <input type="text" value={preferenceForm.reason} onChange={(event) => setPreferenceForm({ ...preferenceForm, reason: event.target.value })} placeholder="e.g. Practical/assessment period" />
            <button type="submit" className="btn-primary" disabled={savingPreference}>
              {savingPreference ? 'Saving...' : 'Save scheduling preference'}
            </button>
          </form>

          <section className="data-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Solver guidance</p><h2>Configured Preferences</h2></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Subject</th><th>Class</th><th>Preferred</th><th>Avoid</th><th>Rank</th></tr></thead>
                <tbody>
                  {preferences.map((item) => (
                    <tr key={item.id}>
                      <td>{item.subject_name}</td>
                      <td>{item.class_name || 'All classes'}</td>
                      <td>{[item.preferred_day_of_week, item.preferred_period_slot ? `Period ${item.preferred_period_slot}` : null].filter(Boolean).join(' · ') || '-'}</td>
                      <td>{item.avoid_period_slot ? `Period ${item.avoid_period_slot}` : '-'}</td>
                      <td>{item.preference_rank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!preferences.length && <p className="empty-state">No scheduling preferences have been configured yet.</p>}
          </section>
        </section>
      </div>
    </div>
  );
}
export default Subjects;