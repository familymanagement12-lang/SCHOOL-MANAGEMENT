import { useEffect, useState } from 'react';
import { getUsers, registerUser, resetUserPassword, updateUser, deleteUser } from '../api/users';
import { getClasses } from '../api/classes';
import { getSubjects } from '../api/subjects';

const operationalPermissions = [
  ['feeding.access', 'Access lunch register'],
  ['feeding.students.read', 'Search students'],
  ['feeding.rates.read', 'View class feeding rates'],
  ['feeding.rates.manage', 'Manage class feeding rates'],
  ['feeding.payments.read', 'View feeding payments'],
  ['feeding.payments.create', 'Record feeding payments'],
  ['feeding.register.read', 'View daily feeding register'],
  ['feeding.register.manage', 'Manage daily feeding register'],
  ['feeding.calendar.manage', 'Manage school feeding calendar'],
  ['feeding.purchases.read', 'View feeding purchases'],
  ['feeding.purchases.create', 'Record feeding purchases'],
  ['feeding.purchases.approve', 'Approve feeding purchases'],
  ['feeding.advances.manage', 'Issue and reconcile shopping advances'],
  ['feeding.reports.read', 'View feeding reports'],
  ['feeding.market.read', 'View market stock register'],
  ['feeding.market.manage', 'Manage market stock register'],
  ['feeding.marketing.read', 'View feeding and marketing reports'],
  ['feeding.marketing.manage', 'Manage feeding and marketing records'],
  ['feeding.import.review', 'Review historical workbook imports'],
  ['feeding.import.confirm', 'Confirm historical workbook imports'],
  ['feeding.export', 'Export operational reports'],
  ['feeding.settings.manage', 'Manage feeding settings'],
  ['tuckshop.access', 'Access tuckshop'],
  ['tuckshop.products.read', 'View tuckshop products'],
  ['tuckshop.products.manage', 'Manage tuckshop products'],
  ['tuckshop.sales.read', 'View tuckshop sales'],
  ['tuckshop.sales.create', 'Record tuckshop sales'],
  ['tuckshop.stock.read', 'View tuckshop stock'],
  ['tuckshop.stock.manage', 'Manage tuckshop stock'],
  ['tuckshop.purchases.read', 'View tuckshop purchases'],
  ['tuckshop.purchases.create', 'Record tuckshop purchases'],
  ['tuckshop.purchases.approve', 'Approve tuckshop purchases'],
  ['tuckshop.sales.reconcile', 'Reconcile tuckshop sales'],
  ['tuckshop.reports.read', 'View tuckshop reports'],
  ['tuckshop.settings.manage', 'Manage tuckshop settings'],
];

// Helper to extract initials for user avatars
const getInitials = (name) => {
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
};
const getRoleLabel = (role) => ({ admin: 'Administrator', librarian: 'Librarian', inventory: 'Inventory', store: 'Inventory', storekeeper: 'Storekeeper', teacher: 'Teacher', accountant: 'Accountant', feeding_tuckshop_officer: 'Feeding & Tuckshop Officer' }[role] || role);

function Users() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const isAdmin = user?.role === 'admin';
  const [users, setUsers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [availableSubjects, setAvailableSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'teacher',
    is_active: true,
    subjects: '',
    permissions: [],
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const [usersRes, classesRes, subjectsRes] = await Promise.all([
        getUsers(),
        getClasses().catch(() => ({ data: [] })),
        getSubjects().catch(() => ({ data: [] }))
      ]);
      setUsers(usersRes.data);
      setClasses(classesRes.data);
      setAvailableSubjects(subjectsRes.data);
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load users');
      setLoading(false);
    }
  };

  const handleOpenModal = (user = null) => {
    if (!isAdmin) {
      setError('Only administrators can manage accounts.');
      return;
    }

    if (user) {
      setEditingId(user.id);
      setFormData({
        name: user.name,
        email: user.email,
        role: user.role,
        is_active: user.is_active !== false,
        subjects: user.subjects ? user.subjects.join(', ') : '',
        permissions: user.permissions || [],
      });
    } else {
      setEditingId(null);
      setFormData({ name: '', email: '', role: 'teacher', is_active: true, subjects: '', permissions: [] });
    }
    setShowModal(true);
  };

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData((previous) => ({
      ...previous,
      [name]: name === 'permissions'
        ? checked
          ? [...new Set([...(previous.permissions || []), value])]
          : (previous.permissions || []).filter((permission) => permission !== value)
        : type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubjectToggle = (subjectName) => {
    setFormData(prev => {
      const subjectsArray = prev.subjects ? prev.subjects.split(',').map(s => s.trim()).filter(s => s) : [];
      if (subjectsArray.includes(subjectName)) {
        return { ...prev, subjects: subjectsArray.filter(s => s !== subjectName).join(', ') };
      } else {
        return { ...prev, subjects: [...subjectsArray, subjectName].join(', ') };
      }
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!isAdmin) {
      setError('Only administrators can manage accounts.');
      return;
    }

    const payload = {
      ...formData,
      subjects: formData.subjects.split(',').map(s => s.trim()).filter(s => s),
    };

    try {
      if (editingId) {
        await updateUser(editingId, payload);
        await fetchUsers();
        setShowModal(false);
        setFormData({ name: '', email: '', role: 'teacher', is_active: true, subjects: '', permissions: [] });
      } else {
        const response = await registerUser(payload);
        await fetchUsers();
        setShowModal(false);
        setCredentialsModal({
          email: payload.email,
          password: response.data.generatedPassword
        });
        setFormData({ name: '', email: '', role: 'teacher', is_active: true, subjects: '', permissions: [] });
      }
    } catch (err) {
      setError(err.response?.data?.message || `Failed to ${editingId ? 'update' : 'create'} user`);
    }
  };

  const handleResetPassword = async (userId) => {
    if (!isAdmin) {
      setError('Only administrators can reset user passwords.');
      return;
    }

    if (!window.confirm("Are you sure you want to reset this user's password?")) return;
    
    try {
      const response = await resetUserPassword(userId);
      setCredentialsModal({
        email: response.data.email,
        password: response.data.generatedPassword
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password');
    }
  };

  const handleDelete = async (userId) => {
    if (!isAdmin) {
      setError('Only administrators can delete users.');
      return;
    }

    if (!window.confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;
    
    try {
      await deleteUser(userId);
      await fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete user');
    }
  };

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero" style={{
          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
          color: '#ffffff',
          borderRadius: '16px',
          border: 'none',
          boxShadow: '0 10px 25px -5px rgba(139, 92, 246, 0.25)'
        }}>
          <div>
            <p className="eyebrow" style={{ color: '#dbeafe', fontWeight: '600' }}>System Management</p>
            <h1 style={{ color: '#ffffff', fontSize: '2.5rem', marginTop: '0.25rem', marginBottom: '0.5rem' }}>Users & Roles</h1>
            <p style={{ color: '#f5f3ff', fontSize: '1.1rem', opacity: 0.9 }}>Manage school accounts and staff roles.</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => handleOpenModal()} style={{ backgroundColor: '#ffffff', color: '#6d28d9', border: 'none', fontWeight: 'bold' }}>
              Add User
            </button>
          )}
        </section>

        <section className="data-panel">
          {error && <div className="error">{error}</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ color: '#64748b', fontWeight: '600' }}>User</th>
                  <th style={{ color: '#64748b', fontWeight: '600' }}>Email Account</th>
                  <th style={{ color: '#64748b', fontWeight: '600' }}>System Role</th>
                  <th style={{ color: '#64748b', fontWeight: '600' }}>Classes</th>
                  <th style={{ color: '#64748b', fontWeight: '600' }}>Subjects</th>
                  <th style={{ color: '#64748b', fontWeight: '600' }}>Status</th>
                  <th style={{ color: '#64748b', fontWeight: '600' }}>Date Added</th>
                  <th style={{ color: '#64748b', fontWeight: '600' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#f1f5f9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.875rem' }}>
                          {getInitials(user.name)}
                        </div>
                        <span style={{ fontWeight: '600', color: '#0f172a' }}>{user.name}</span>
                      </div>
                    </td>
                    <td style={{ color: '#475569' }}>{user.email}</td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        backgroundColor: user.role === 'admin' ? '#fce7f3' : user.role === 'teacher' ? '#dcfce3' : user.role === 'librarian' ? '#ede9fe' : user.role === 'inventory' ? '#dbeafe' : '#f3e8ff',
                        color: user.role === 'admin' ? '#9d174d' : user.role === 'teacher' ? '#166534' : user.role === 'librarian' ? '#6d28d9' : user.role === 'inventory' ? '#1e40af' : '#6b21a8',
                        textTransform: 'capitalize'
                      }}>
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td style={{ color: '#475569', fontSize: '0.875rem' }}>
                      {user.role === 'teacher' ? classes.filter(c => c.teacher_id === user.id).map(c => c.name).join(', ') || 'None' : '-'}
                    </td>
                    <td style={{ color: '#475569', fontSize: '0.875rem' }}>
                      {user.role === 'teacher' ? (user.subjects?.length > 0 ? user.subjects.join(', ') : 'None') : '-'}
                    </td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        backgroundColor: user.is_active !== false ? '#dcfce3' : '#fee2e2',
                        color: user.is_active !== false ? '#166534' : '#991b1b',
                      }}>
                        {user.is_active !== false ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td style={{ color: '#64748b', fontSize: '0.875rem' }}>
                      {new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {isAdmin && (
                        <>
                          <button className="btn-small btn-secondary" title="Edit User" onClick={() => handleOpenModal(user)} style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1' }}>
                            ✏️ Edit
                          </button>
                          <button className="btn-small btn-secondary" title="Reset Password" onClick={() => handleResetPassword(user.id)} style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1' }}>
                            🔑 Reset
                          </button>
                          <button className="btn-small btn-delete" title="Delete User" onClick={() => handleDelete(user.id)} style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            🗑️ Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {users.length === 0 && <p className="empty-state">No users found.</p>}
        </section>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit User' : 'Add New User'}</h2>
              <button className="btn-close" onClick={() => setShowModal(false)}>x</button>
            </div>
            <form onSubmit={handleSubmit}>
              <label>Full Name *</label>
              <input type="text" name="name" value={formData.name} onChange={handleInputChange} required />

              <label>Email Address *</label>
              <input type="email" name="email" value={formData.email} onChange={handleInputChange} required />

              <label>Role *</label>
              <select name="role" value={formData.role} onChange={handleInputChange} required>
                <option value="admin">Administrator</option>
                <option value="teacher">Teacher</option>
                <option value="accountant">Accountant</option>
                <option value="librarian">Librarian</option>
                <option value="inventory">Inventory</option>
                <option value="storekeeper">Storekeeper</option>
                <option value="feeding_tuckshop_officer">Feeding &amp; Tuckshop Officer</option>
              </select>

              {formData.role === 'teacher' && (
                <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                  <label>Assigned Subjects</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    {availableSubjects.map(sub => (
                      <label key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontWeight: 'normal', cursor: 'pointer' }}>
                        <input type="checkbox" checked={(formData.subjects || '').split(',').map(s=>s.trim()).includes(sub.name)} onChange={() => handleSubjectToggle(sub.name)} style={{ width: 'auto', margin: 0 }} />
                        {sub.name}
                      </label>
                    ))}
                    {availableSubjects.length === 0 && <span style={{ color: '#64748b', fontSize: '0.875rem' }}>No subjects created yet.</span>}
                  </div>
                </div>
              )}

              <fieldset style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <legend>Operational permissions</legend>
                <p className="muted-copy">Permissions are granted individually. The Feeding &amp; Tuckshop Officer role does not automatically grant access to every operational area.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.5rem' }}>
                  {operationalPermissions.map(([permission, label]) => (
                    <label key={permission} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                      <input
                        type="checkbox"
                        name="permissions"
                        value={permission}
                        checked={(formData.permissions || []).includes(permission)}
                        onChange={handleInputChange}
                        style={{ width: 'auto', margin: 0 }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {editingId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', marginBottom: '1rem' }}>
                  <input type="checkbox" name="is_active" id="is_active" checked={formData.is_active} onChange={handleInputChange} style={{ width: 'auto', margin: 0 }} />
                  <label htmlFor="is_active" style={{ margin: 0 }}>Active Account</label>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">{editingId ? 'Save Changes' : 'Create Account'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {credentialsModal && (
        <div className="modal-overlay" onClick={() => setCredentialsModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
            <h2 style={{ color: '#0f172a', marginBottom: '0.5rem' }}>Account Created Successfully</h2>
            <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>An email has been sent to the user. You can also securely copy their temporary credentials below.</p>
            
            <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'left', marginBottom: '1.5rem' }}>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#64748b' }}>Email Address:</p>
              <div style={{ fontWeight: '600', color: '#0f172a', marginBottom: '1rem', background: '#ffffff', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>{credentialsModal.email}</div>
              
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#64748b' }}>Auto-Generated Password:</p>
              <div style={{ fontWeight: '600', color: '#0f172a', background: '#ffffff', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1', letterSpacing: '1px' }}>{credentialsModal.password}</div>
            </div>

            <button className="btn-primary" onClick={() => setCredentialsModal(null)} style={{ width: '100%' }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Users;
