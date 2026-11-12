import { useEffect, useState } from 'react';
import { BookOpen, ListFilter } from 'lucide-react';
import { getSubjects, createSubject, updateSubject, deleteSubject } from '../api/subjects';

function Subjects() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({ name: '', code: '', curricula: ['COMMON'] });

  useEffect(() => {
    fetchSubjects();
  }, []);

  const fetchSubjects = async () => {
    try {
      const res = await getSubjects();
      setSubjects(res.data);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      if (editingId) await updateSubject(editingId, formData);
      else await createSubject(formData);
      setFormData({ name: '', code: '', curricula: ['COMMON'] });
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
    setFormData({ name: subject.name, code: subject.code || '', curricula: subject.curricula || ['COMMON'] });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData({ name: '', code: '', curricula: ['COMMON'] });
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
                <thead><tr><th>Code</th><th>Name</th><th>Curricula</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredSubjects.map(sub => (
                    <tr key={sub.id}>
                      <td><strong>{sub.code || '-'}</strong></td>
                      <td>{sub.name}</td>
                      <td>{(sub.curricula || []).map((curriculum) => curriculum === 'PEARSON' ? 'Pearson' : curriculum).join(', ') || '-'}</td>
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
      </div>
    </div>
  );
}
export default Subjects;