import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getClasses } from '../api/classes';
import {
  getStudents, getStudentById, createStudent, updateStudent, deleteStudent,
  setStudentAccountStatus, resetStudentAccountPassword,
} from '../api/students';
import BulkStudentUploader from '../components/BulkStudentUploader';

const emptyForm = {
  name: '',
  class_id: '',
  dob: '',
  allergies: '',
  disability: '',
};

const isCurrentUserAdmin = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')?.role === 'admin';
  } catch {
    return false;
  }
};

function Students() {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [formData, setFormData] = useState(emptyForm);
  const isAdmin = isCurrentUserAdmin();

  useEffect(() => {
    fetchPageData();
  }, []);

  const fetchPageData = async () => {
    try {
      const [studentsResponse, classesResponse] = await Promise.all([
        getStudents(),
        getClasses(),
      ]);

      setStudents(studentsResponse.data);
      setClasses(classesResponse.data);
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load students and classes');
      setLoading(false);
    }
  };

  const filteredStudents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return students.filter((student) => {
      const matchesSearch = !query
        || student.name.toLowerCase().includes(query)
        || student.student_id?.includes(query)
          || student.username?.toLowerCase().includes(query)
        || student.class_name?.toLowerCase().includes(query);
      const matchesClass = !classFilter || String(student.class_id || '') === classFilter;
        const matchesAccount = !accountFilter
          || (accountFilter === 'active' && student.account_user_id && student.account_active)
          || (accountFilter === 'inactive' && student.account_user_id && !student.account_active)
          || (accountFilter === 'missing' && !student.account_user_id)
          || (accountFilter === 'change' && student.must_change_password);

        return matchesSearch && matchesClass && matchesAccount;
    });
  }, [students, searchTerm, classFilter, accountFilter]);

  const assignedStudents = students.filter((student) => student.class_id).length;
  const unassignedStudents = students.length - assignedStudents;

  const handleOpenModal = async (student = null) => {
    if (student) {
      try {
        const response = await getStudentById(student.id);
        const detail = response.data;
        setEditingId(detail.id);
        setFormData({
          name: detail.name,
          class_id: detail.class_id || '',
          dob: detail.dob || '',
          allergies: detail.allergies || '',
          disability: detail.disability || '',
        });
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load student details.');
        return;
      }
    } else {
      setEditingId(null);
      setFormData(emptyForm);
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingId(null);
    setFormData(emptyForm);
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    try {
      if (editingId) {
        await updateStudent(editingId, formData);
      } else {
        const res = await createStudent(formData);
        if (res.data.studentPassword) {
          setCredentialsModal({
            id: res.data.student_id,
            name: res.data.name,
            username: res.data.username,
            password: res.data.studentPassword,
          });
        }
      }
      await fetchPageData();
      handleCloseModal();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save student');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this student?')) {
      return;
    }

    try {
      await deleteStudent(id);
      await fetchPageData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete student');
    }
  };

  const handleAccountStatus = async (student) => {
    const is_active = !student.account_active;
    try {
      await setStudentAccountStatus(student.id, is_active);
      await fetchPageData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update student account.');
    }
  };

  const handlePasswordReset = async (student) => {
    if (!window.confirm(`Reset the portal password for ${student.name}?`)) return;
    try {
      const { data } = await resetStudentAccountPassword(student.id);
      setCredentialsModal({
        id: data.student_id,
        name: data.name,
        username: data.username,
        password: data.temporary_password,
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset student password.');
    }
  };

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero student-hero">
          <div>
            <p className="eyebrow">Student Registry</p>
            <h1>Students</h1>
            <p>Keep every learner organized with systematic IDs, class assignment, and clean records.</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn-secondary" onClick={() => setShowBulkModal(true)} style={{ backgroundColor: 'white', color: '#0f172a' }}>Bulk Upload</button>
            <button className="btn-primary" onClick={() => handleOpenModal()}>Add Student</button>
          </div>
        </section>

        <section className="module-stats">
          <div className="mini-stat">
            <span>Total Students</span>
            <strong>{students.length}</strong>
          </div>
          <div className="mini-stat">
            <span>Assigned</span>
            <strong>{assignedStudents}</strong>
          </div>
          <div className="mini-stat">
            <span>Unassigned</span>
            <strong>{unassignedStudents}</strong>
          </div>
        </section>

        <section className="data-panel">
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search by name, ID, or class"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="">All classes</option>
              {classes.map((classItem) => (
                <option key={classItem.id} value={classItem.id}>{classItem.name}</option>
              ))}
            </select>
            <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="">All portal accounts</option>
              <option value="active">Active accounts</option>
              <option value="inactive">Inactive accounts</option>
              <option value="missing">Missing accounts</option>
              <option value="change">Must change password</option>
            </select>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Curriculum</th>
                  <th>Portal account</th>
                  <th>Username</th>
                  <th>First-login change</th>
                  <th>Last login</th>
                  <th>Allergies</th>
                  <th>Disability / Needs</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => (
                  <tr key={student.id}>
                    <td><span className="id-pill">{student.student_id}</span></td>
                    <td>
                      <strong>{student.name}</strong>
                    </td>
                    <td>{student.class_name || 'Unassigned'}</td>
                    <td>{student.curriculum === 'PEARSON' ? 'Pearson' : student.curriculum || 'Unassigned'}</td>
                    <td>{student.account_user_id ? (student.account_active ? 'Active' : 'Inactive') : 'Not linked'}</td>
                    <td><span style={{ fontWeight: 600, color: '#1e3a8a' }}>{student.username || '-'}</span></td>
                    <td>{student.must_change_password ? 'Required' : 'Complete'}</td>
                    <td>{student.last_login_at ? new Date(student.last_login_at).toLocaleString() : '-'}</td>
                    <td>{student.allergies ? student.allergies : 'None'}</td>
                    <td>{student.disability ? student.disability : 'None'}</td>
                    <td className="actions">
                      <button className="btn-small btn-edit" onClick={() => handleOpenModal(student)}>Edit</button>
                      {isAdmin && <Link className="btn-small btn-edit" to={`/feeding?student_id=${student.id}`}>Feeding account</Link>}
                      {isAdmin && student.account_user_id && (
                        <button className="btn-small btn-edit" onClick={() => handleAccountStatus(student)}>{student.account_active ? 'Deactivate portal' : 'Activate portal'}</button>
                      )}
                      {isAdmin && (
                        <button className="btn-small btn-edit" onClick={() => handlePasswordReset(student)}>{student.account_user_id ? 'Reset password' : 'Set up account'}</button>
                      )}
                      <button className="btn-small btn-delete" onClick={() => handleDelete(student.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredStudents.length === 0 && <p className="empty-state">No students match your current view.</p>}
        </section>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Student' : 'Add New Student'}</h2>
              <button className="btn-close" onClick={handleCloseModal}>x</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Student Information</h3>
                    <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748b' }}>Required fields marked *</span>
                  </div>
                </div>

                <div>
                  <label>Name *</label>
                  <input type="text" name="name" value={formData.name} onChange={handleInputChange} required placeholder="e.g. Ama Boateng" />
                </div>

                <div>
                  <label>Class</label>
                  <select name="class_id" value={formData.class_id} onChange={handleInputChange}>
                    <option value="">Unassigned</option>
                    {classes.map((classItem) => (
                      <option key={classItem.id} value={classItem.id}>{classItem.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label>Date of Birth</label>
                  <input type="date" name="dob" value={formData.dob} onChange={handleInputChange} />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label>Allergies</label>
                  <textarea name="allergies" value={formData.allergies} onChange={handleInputChange} rows={2} placeholder="e.g. Peanuts, penicillin" />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label>Disability / Special Needs</label>
                  <textarea name="disability" value={formData.disability} onChange={handleInputChange} rows={2} placeholder="e.g. Asthma, dyslexia, mobility support" />
                </div>

              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" className="btn-secondary" onClick={handleCloseModal}>Cancel</button>
                <button type="submit" className="btn-primary">{editingId ? 'Save Changes' : 'Add Student'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {credentialsModal && (
        <div className="modal-overlay" onClick={() => setCredentialsModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
            <h2 style={{ color: '#0f172a', marginBottom: '0.5rem' }}>Student Portal Credentials</h2>
            <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>Share these credentials privately. The student will be asked to change the temporary password after signing in.</p>
            
            <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'left', marginBottom: '1.5rem' }}>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#64748b' }}>Student ID:</p>
              <div style={{ fontWeight: '600', color: '#0f172a', marginBottom: '1rem', background: '#ffffff', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>{credentialsModal.id}</div>

              {credentialsModal.name && <><p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#64748b' }}>Student Name:</p><div style={{ fontWeight: '600', color: '#0f172a', marginBottom: '1rem', background: '#ffffff', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>{credentialsModal.name}</div></>}

              {credentialsModal.username && <><p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#64748b' }}>Username:</p><div style={{ fontWeight: '600', color: '#0f172a', marginBottom: '1rem', background: '#ffffff', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>{credentialsModal.username}</div></>}
              
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#64748b' }}>Temporary Password:</p>
              <div style={{ fontWeight: '600', color: '#0f172a', background: '#ffffff', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1', letterSpacing: '1px' }}>{credentialsModal.password}</div>
            </div>

            <button className="btn-primary" onClick={() => setCredentialsModal(null)} style={{ width: '100%' }}>Done</button>
          </div>
        </div>
      )}

      {showBulkModal && (
        <div className="modal-overlay" onClick={() => setShowBulkModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()} style={{ position: 'relative', maxWidth: '650px', padding: 0, overflow: 'hidden' }}>
            <button className="btn-close" onClick={() => setShowBulkModal(false)} style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', zIndex: 10 }}>x</button>
            
            <BulkStudentUploader 
              onSuccess={() => { 
                fetchPageData(); 
              }} 
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default Students;
