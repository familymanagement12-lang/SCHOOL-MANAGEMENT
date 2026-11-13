import { useEffect, useState, useMemo } from 'react';
import { getEmployees, createEmployee, updateEmployee, deactivateEmployee } from '../api/employees';

const STAFF_ROLES = [
  'Teacher',
  'Headteacher / Principal',
  'Deputy Headteacher',
  'Teaching Assistant',
  'Administrator',
  'Secretary',
  'Accountant',
  'Bursar',
  'Librarian',
  'Inventory / Storekeeper',
  'IT Officer',
  'Nurse',
  'Counsellor',
  'Security Officer',
  'Cleaner',
  'Cook',
  'Driver',
  'Maintenance Staff',
];

function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [editingId, setEditingId] = useState(null);
  const [customRole, setCustomRole] = useState('');
  const [formData, setFormData] = useState({
    full_name: '', role: 'Teacher', phone: '', email: '',
    basic_salary: 0, allowance: 0, deductions: 0,
    bank_name: '', bank_account: '', is_active: true
  });

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const res = await getEmployees();
      setEmployees(res.data);
      setLoading(false);
    } catch (err) {
      setError('Failed to load employees.');
      setLoading(false);
    }
  };

  const currencyCode = localStorage.getItem('sms_currency') || 'USD';
  const formatMoney = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: currencyCode });

  const handleEdit = (emp) => {
    setEditingId(emp.id);
    const knownRole = STAFF_ROLES.includes(emp.role);
    setCustomRole(knownRole ? '' : emp.role);
    setFormData({
      full_name: emp.full_name, role: knownRole ? emp.role : '__custom__', phone: emp.phone || '', email: emp.email || '',
      basic_salary: emp.basic_salary, allowance: emp.allowance, deductions: emp.deductions,
      bank_name: emp.bank_name || '', bank_account: emp.bank_account || '', is_active: emp.is_active
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setCustomRole('');
    setFormData({ full_name: '', role: 'Teacher', phone: '', email: '', basic_salary: 0, allowance: 0, deductions: 0, bank_name: '', bank_account: '', is_active: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const role = formData.role === '__custom__' ? customRole.trim() : formData.role;
    if (!role) {
      setError('Select a staff role or enter a custom job title.');
      return;
    }
    try {
      if (editingId) {
        await updateEmployee(editingId, { ...formData, role });
      } else {
        await createEmployee({ ...formData, role });
      }
      handleCancel();
      await fetchEmployees();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save employee data.');
    }
  };

  const handleDelete = async (employee) => {
    if (!window.confirm(`Mark ${employee.full_name} as inactive? Their payroll and attendance history will be kept.`)) return;
    try {
      await deactivateEmployee(employee.id);
      await fetchEmployees();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to mark employee inactive.');
    }
  };

  const handleReactivate = async (employee) => {
    try {
      await updateEmployee(employee.id, { is_active: true });
      await fetchEmployees();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reactivate employee.');
    }
  };

  const stats = useMemo(() => {
    const active = employees.filter(e => e.is_active);
    const monthlyCost = active.reduce((sum, e) => sum + Number(e.basic_salary) + Number(e.allowance) - Number(e.deductions), 0);
    return { total: employees.length, active: active.length, monthlyCost };
  }, [employees]);

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero" style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #0284c7 100%)',
          color: '#ffffff',
          borderRadius: '16px',
          border: 'none',
          boxShadow: '0 10px 25px -5px rgba(79, 70, 229, 0.3)'
        }}>
          <div>
            <p className="eyebrow" style={{ color: '#dbeafe', fontWeight: '600' }}>Human Resources</p>
            <h1 style={{ color: '#ffffff', fontSize: '2.5rem', marginTop: '0.25rem', marginBottom: '0.5rem' }}>Staff Registry</h1>
            <p style={{ color: '#f5f3ff', fontSize: '1.1rem', opacity: 0.9 }}>Manage employee profiles, bank details, and salary structures.</p>
          </div>
        </section>

        <section className="module-stats">
          <div className="mini-stat"><span>Total Staff</span><strong style={{ color: '#3b82f6' }}>{stats.total}</strong></div>
          <div className="mini-stat"><span>Active Payroll</span><strong style={{ color: '#078fc4' }}>{stats.active}</strong></div>
          <div className="mini-stat"><span>Est. Monthly Cost</span><strong style={{ color: '#075e9a' }}>{formatMoney(stats.monthlyCost)}</strong></div>
        </section>

        <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-heading"><div><p className="eyebrow">{editingId ? 'Edit Profile' : 'New Profile'}</p><h2>{editingId ? 'Update Staff' : 'Add Staff'}</h2></div></div>
            {error && <div className="error">{error}</div>}
            
            <label>Full Name *</label><input type="text" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} required />
            <label htmlFor="staff-role">Staff Role / Job Title *</label>
            <select id="staff-role" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} required>
              {STAFF_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
              <option value="__custom__">Other (enter a job title)</option>
            </select>
            {formData.role === '__custom__' && (
              <input
                type="text"
                maxLength="80"
                value={customRole}
                onChange={e => setCustomRole(e.target.value)}
                placeholder="Enter staff job title"
                aria-label="Custom staff job title"
                required
              />
            )}
            <small>Job title for the staff record and payroll; it does not grant system access.</small>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div><label>Phone</label><input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} /></div>
              <div><label>Email</label><input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} /></div>
            </div>

            <h3 style={{ margin: '1rem 0 0', fontSize: '1.1rem', color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>Salary Structure</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
              <div><label>Basic</label><input type="number" min="0" step="0.01" value={formData.basic_salary} onChange={e => setFormData({...formData, basic_salary: e.target.value})} /></div>
              <div><label>Allowances</label><input type="number" min="0" step="0.01" value={formData.allowance} onChange={e => setFormData({...formData, allowance: e.target.value})} /></div>
              <div><label>Deductions</label><input type="number" min="0" step="0.01" value={formData.deductions} onChange={e => setFormData({...formData, deductions: e.target.value})} /></div>
            </div>

            <h3 style={{ margin: '1rem 0 0', fontSize: '1.1rem', color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>Bank Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div><label>Bank Name</label><input type="text" value={formData.bank_name} onChange={e => setFormData({...formData, bank_name: e.target.value})} /></div>
              <div><label>Account No.</label><input type="text" value={formData.bank_account} onChange={e => setFormData({...formData, bank_account: e.target.value})} /></div>
            </div>

            {editingId && <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginTop: '0.5rem' }}><input type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} style={{ width: 'auto' }} /> Employee is Active</label>}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }}>{editingId ? 'Save Changes' : 'Register Staff'}</button>
              {editingId && <button type="button" className="btn-secondary" onClick={handleCancel}>Cancel</button>}
            </div>
          </form>

          <section className="data-panel">
            <div className="panel-heading"><div><p className="eyebrow">Directory</p><h2>Employee Roster</h2></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Net Salary</th><th>Bank Info</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id} style={{ opacity: emp.is_active ? 1 : 0.6 }}>
                      <td><strong>{emp.full_name}</strong><div style={{ fontSize: '0.8rem', color: '#64748b' }}>{emp.role}</div></td>
                      <td><strong style={{ color: '#075e9a' }}>{formatMoney(Number(emp.basic_salary) + Number(emp.allowance) - Number(emp.deductions))}</strong></td>
                      <td><span style={{ fontSize: '0.85rem' }}>{emp.bank_name || '-'}<br/>{emp.bank_account || ''}</span></td>
                      <td><span className={`status-pill ${emp.is_active ? 'present' : 'absent'}`}>{emp.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          <button type="button" className="btn-small btn-edit" onClick={() => handleEdit(emp)}>Edit</button>
                          {emp.is_active
                            ? <button type="button" className="btn-small btn-delete" onClick={() => handleDelete(emp)}>Deactivate</button>
                            : <button type="button" className="btn-small btn-secondary" onClick={() => handleReactivate(emp)}>Reactivate</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}
export default Employees;