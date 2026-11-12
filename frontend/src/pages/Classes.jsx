import { useEffect, useMemo, useState } from 'react';
import { createClass, getClasses, updateClass, deleteClass } from '../api/classes';
import { getStudents } from '../api/students';
import { getUsers } from '../api/users';

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
  const emptyForm = { name: '', description: '', class_teacher_id: '', teaching_model: 'class_teacher' };
  const [formData, setFormData] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    try {
      if (editingId) await updateClass(editingId, formData);
      else await createClass(formData);
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
      teaching_model: classItem.teaching_model || 'class_teacher',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData(emptyForm);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this class? Students inside will become Unassigned.')) {
      return;
    }

    try {
      await deleteClass(id);
      await fetchPageData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete class');
    }
  };

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

              <label>Class Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                placeholder="Example: Kindergarten A or Blue Class"
                required
              />

              <label>Class Teacher *</label>
              <select
                value={formData.class_teacher_id}
                onChange={(event) => setFormData({ ...formData, class_teacher_id: event.target.value })}
                required
              >
                <option value="">Select responsible teacher</option>
                {teachers.map(teacher => (
                  <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                ))}
              </select>

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
                  {classItem.curriculum && classItem.curriculum !== 'UNASSIGNED' && <p className="teacher-badge">Curriculum: {classItem.curriculum}</p>}
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
