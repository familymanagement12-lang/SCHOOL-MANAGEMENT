import { useEffect, useMemo, useState } from 'react';
import { createClass, getClasses, updateClass, deleteClass } from '../api/classes';
import { getStudents } from '../api/students';
import { getUsers } from '../api/users';
import { classStageLabel, curriculumLabel } from '../curriculumDisplay';

const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    return null;
  }
};

function Classes() {
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const emptyForm = {
    name: '', description: '', class_teacher_id: '', teaching_model: '',
    education_stage: 'UNASSIGNED', programme: '', year_level: '', curriculum: 'UNASSIGNED',
    change_reason: '',
  };
  const [formData, setFormData] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const user = getCurrentUser();

  useEffect(() => {
    fetchPageData();
  }, []);

  const fetchPageData = async () => {
    try {
      const [classesResponse, studentsResponse, usersResponse] = await Promise.all([
        getClasses(),
        getStudents(),
        getUsers().catch(() => ({ data: [] })) // Fallback if user lacks access
      ]);

      setClasses(classesResponse.data);
      setStudents(studentsResponse.data);
      setTeachers(usersResponse.data.filter(u => u.role === 'teacher'));
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load classes');
      setLoading(false);
    }
  };

  const classRows = useMemo(() => classes.map((classItem) => {
    const count = students.filter((student) => student.class_id === classItem.id).length;
    const teacher = teachers.find(t => t.id === classItem.teacher_id);
    return { ...classItem, studentCount: count, teacherName: teacher?.name };
  }), [classes, students, teachers]);
  const stageCounts = useMemo(() => ({
    EARLY_YEARS: classes.filter((item) => item.education_stage === 'EARLY_YEARS').length,
    PRIMARY: classes.filter((item) => item.education_stage === 'PRIMARY').length,
    JHS: classes.filter((item) => item.education_stage === 'JHS').length,
    OTHER: classes.filter((item) => item.education_stage === 'OTHER').length,
  }), [classes]);
  const pendingClassification = classRows.filter((item) => item.education_stage === 'UNASSIGNED');
  const pendingCurriculum = classRows.filter((item) => !item.curriculum || item.curriculum === 'UNASSIGNED');
  const classesNeedingAttention = classRows.filter((item) => (
    item.education_stage === 'UNASSIGNED'
    || !item.curriculum
    || item.curriculum === 'UNASSIGNED'
    || (item.education_stage !== 'UNASSIGNED' && !item.teaching_model)
    || (item.education_stage === 'PRIMARY' && !item.class_teacher_id)
  ));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    try {
      if (editingId) await updateClass(editingId, formData);
      else await createClass(formData);
      setMessage(editingId ? 'Class updated.' : 'Class created.');
      setFormData(emptyForm);
      setEditingId(null);
      await fetchPageData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create class');
    }
  };

  const startEdit = (classItem) => {
    setEditingId(classItem.id);
    setFormData({
      name: classItem.name,
      description: classItem.description || '',
      class_teacher_id: String(classItem.class_teacher_id || classItem.teacher_id || ''),
      teaching_model: classItem.teaching_model || '',
      education_stage: classItem.education_stage || 'UNASSIGNED',
      programme: classItem.programme || '',
      year_level: classItem.year_level ? String(classItem.year_level) : '',
      curriculum: classItem.curriculum || 'UNASSIGNED',
      change_reason: '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData(emptyForm);
  };

  const handleDelete = async (id) => {
    const changeReason = window.prompt('Why is this class being deleted? (At least 5 characters)');
    if (changeReason === null || changeReason.trim().length < 5) return;
    if (!window.confirm('Are you sure you want to delete this class? Students inside will become Unassigned.')) return;

    try {
      await deleteClass(id, changeReason.trim());
      await fetchPageData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete class');
    }
  };

  const stageLabel = (stage) => ({
    EARLY_YEARS: 'Early Years',
    PRIMARY: 'Primary',
    JHS: 'JHS',
    OTHER: 'Other programme',
    UNASSIGNED: 'Pending classification',
  }[stage] || 'Pending classification');
  const allowedCurricula = ['COMMON', 'GES', 'PEARSON', 'UNASSIGNED'];
  const primaryClass = formData.education_stage === 'PRIMARY';

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero class-hero">
          <div>
            <p className="eyebrow">Class Management</p>
            <h1>Classes</h1>
            <p>Create teaching groups, watch enrollment, and keep student assignment structured.</p>
          </div>
          <div className="hero-badge">
            <span>{classes.length}</span>
            <strong>active classes</strong>
          </div>
        </section>

        <section className="stats-grid" aria-label="Class configuration summary">
          <article className="stat-card overview-stat stat-sky">
            <div className="stat-topline"><span>Total Classes</span></div>
            <strong>{classes.length}</strong><p>Existing school classes</p>
          </article>
          {[
            ['Early Years', stageCounts.EARLY_YEARS],
            ['Primary', stageCounts.PRIMARY],
            ['JHS', stageCounts.JHS],
            ['Other programmes', stageCounts.OTHER],
          ].map(([label, count]) => (
            <article className="stat-card overview-stat stat-emerald" key={label}>
              <div className="stat-topline"><span>{label}</span></div>
              <strong>{count}</strong><p>Explicitly classified</p>
            </article>
          ))}
          <article className="stat-card overview-stat stat-amber">
            <div className="stat-topline"><span>Awaiting classification</span></div>
            <strong>{pendingClassification.length}</strong><p>Must be confirmed individually</p>
          </article>
          <article className="stat-card overview-stat stat-violet">
            <div className="stat-topline"><span>Awaiting curriculum</span></div>
            <strong>{pendingCurriculum.length}</strong><p>No subject allocation or timetable yet</p>
          </article>
        </section>

        {user?.role === 'admin' && (
          <section className="data-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Configuration review</p><h2>Classes needing attention</h2></div>
              <span>{classesNeedingAttention.length} class(es)</span>
            </div>
            {classesNeedingAttention.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Class</th><th>Outstanding setup</th><th>Action</th></tr></thead>
                  <tbody>
                    {classesNeedingAttention.map((item) => {
                      const missing = [];
                      if (item.education_stage === 'UNASSIGNED') missing.push('education section');
                      if (!item.curriculum || item.curriculum === 'UNASSIGNED') missing.push('curriculum');
                      if (!item.teaching_model) missing.push('teaching model');
                      if (item.education_stage === 'PRIMARY' && !item.class_teacher_id) missing.push('class teacher');
                      return (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td>{missing.join(', ')}</td>
                          <td><button className="btn-small btn-edit" onClick={() => startEdit(item)}>Review class</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="empty-state">All classes have an explicit section, curriculum, and required teaching setup.</p>}
            <p>Each class is reviewed separately. No bulk defaults are applied to unresolved classes.</p>
          </section>
        )}

        <section className="split-layout">
          {user?.role === 'admin' && (
            <form className="data-panel form-panel" onSubmit={handleSubmit}>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">New Class</p>
                  <h2>Add a class</h2>
                </div>
              </div>

              {error && <div className="error">{error}</div>}
              {message && <div className="teacher-badge" role="status">{message}</div>}

              <label>Class Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                placeholder="Enter the school's existing class name"
                required
              />

              <label>Education section *</label>
              <select
                value={formData.education_stage}
                onChange={(event) => setFormData({ ...formData, education_stage: event.target.value })}
              >
                <option value="UNASSIGNED">Pending administrator classification</option>
                <option value="EARLY_YEARS">Early Years</option>
                <option value="PRIMARY">Primary</option>
                <option value="JHS">JHS</option>
                <option value="OTHER">Other school programme</option>
              </select>
              <p>Do not classify by name or number alone. Leave uncertain classes pending until confirmed.</p>

              {formData.education_stage === 'OTHER' && <>
                <label>Programme name *</label>
                <input
                  type="text"
                  value={formData.programme}
                  onChange={(event) => setFormData({ ...formData, programme: event.target.value })}
                  placeholder="Name the school programme"
                  required
                />
              </>}

              <label>Numeric level (when applicable)</label>
              <input
                type="number"
                min="1"
                max="11"
                value={formData.year_level}
                onChange={(event) => setFormData({ ...formData, year_level: event.target.value })}
                disabled={formData.education_stage === 'UNASSIGNED'}
                required={['PRIMARY', 'JHS'].includes(formData.education_stage)}
              />

              <label>Curriculum / pathway</label>
              <select
                value={formData.curriculum}
                onChange={(event) => setFormData({ ...formData, curriculum: event.target.value })}
              >
                {allowedCurricula.map((curriculum) => (
                  <option key={curriculum} value={curriculum}>
                    {curriculum === 'UNASSIGNED' ? 'Unassigned' : curriculumLabel(curriculum)}
                  </option>
                ))}
              </select>

              <label>Teaching model{formData.education_stage !== 'UNASSIGNED' ? ' *' : ''}</label>
              <select
                value={formData.teaching_model}
                onChange={(event) => setFormData({ ...formData, teaching_model: event.target.value })}
                required={formData.education_stage !== 'UNASSIGNED'}
              >
                <option value="">Select a teaching model</option>
                <option value="class_teacher">Class-teacher based</option>
                <option value="subject_teacher">Subject-teacher based</option>
              </select>

              <label>Class Teacher{primaryClass ? ' *' : ' (optional)'}</label>
              <select
                value={formData.class_teacher_id}
                onChange={(event) => setFormData({ ...formData, class_teacher_id: event.target.value })}
                required={primaryClass}
              >
                <option value="">Not assigned yet</option>
                {teachers.map(teacher => (
                  <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                ))}
              </select>
              <p>Every Primary class retains a class teacher, including classes that also use subject teachers.</p>
              <label>{editingId ? 'Reason for configuration change' : 'Reason for creating this class'} *</label>
              <textarea
                value={formData.change_reason}
                onChange={(event) => setFormData({ ...formData, change_reason: event.target.value })}
                placeholder={editingId
                  ? 'Required when changing class configuration, name, or description'
                  : 'Required to record why this class is being added'}
                rows="2"
                required
              />

              <label>Description</label>
              <textarea
                value={formData.description}
                onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                placeholder="Optional class notes"
                rows="4"
              />

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn-primary">{editingId ? 'Save Class' : 'Create Class'}</button>
                {editingId && <button type="button" className="btn-secondary" onClick={cancelEdit}>Cancel</button>}
              </div>
            </form>
          )}

          <section className="class-grid">
            {classRows.map((classItem, index) => (
              <article className="class-card" key={classItem.id}>
                <div className="class-avatar">{String(index + 1).padStart(2, '0')}</div>
                <div>
                  <h3>{classItem.name}</h3>
                  <p>{classItem.description || 'No description added yet.'}</p>
                  <p className="teacher-badge">Class teacher: {classItem.teacherName || 'Not assigned'}</p>
                  <p className="teacher-badge">
                    Section: {stageLabel(classItem.education_stage)}
                    {classItem.year_level ? ` · ${classStageLabel(classItem.year_level, classItem.curriculum, classItem.education_stage) || `Level ${classItem.year_level}`}` : ''}
                    {classItem.programme ? ` · ${classItem.programme}` : ''}
                  </p>
                  <p className="teacher-badge">
                    Curriculum: {classItem.curriculum && classItem.curriculum !== 'UNASSIGNED' ? curriculumLabel(classItem.curriculum) : 'Unassigned'}
                    {' · Teaching model: '}{classItem.teaching_model || 'Unassigned'}
                  </p>
                </div>
                <div className="class-count">
                  <strong>{classItem.studentCount}</strong>
                  <span>students</span>
                </div>
                {user?.role === 'admin' && (
                  <div className="card-actions" style={{ marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                    <button className="btn-small btn-edit" onClick={() => startEdit(classItem)}>Edit class</button>
                    <button className="btn-small btn-delete" onClick={() => handleDelete(classItem.id)}>Delete</button>
                  </div>
                )}
              </article>
            ))}
            {classRows.length === 0 && <p className="empty-state">No classes yet. Create your first class to begin.</p>}
          </section>
        </section>
      </div>
    </div>
  );
}

export default Classes;
