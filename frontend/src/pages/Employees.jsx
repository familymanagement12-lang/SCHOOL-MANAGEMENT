import { useEffect, useState, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { getEmployees, createEmployee, updateEmployee, deactivateEmployee, bulkUpsertEmployees } from '../api/employees';

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
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState({ type: '', text: '' });
  const [formData, setFormData] = useState({
    full_name: '', role: '', phone: '', email: '',
    basic_salary: 0, allowance: 0, deductions: 0,
    bank_name: '', bank_account: '', is_active: true,
    staff_id: '', pension_member_id: '', ssnit_number: '', date_of_birth: '',
    ghana_card: '', employment_type: '', termination_date: ''
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
      full_name: emp.full_name || '', role: !emp.role ? '' : (knownRole ? emp.role : '__custom__'), phone: emp.phone || '', email: emp.email || '',
      basic_salary: emp.basic_salary, allowance: emp.allowance, deductions: emp.deductions,
      bank_name: emp.bank_name || '', bank_account: emp.bank_account || '', is_active: emp.is_active,
      staff_id: emp.staff_id || '', pension_member_id: emp.pension_member_id || '',
      ssnit_number: emp.ssnit_number || '', date_of_birth: emp.date_of_birth ? String(emp.date_of_birth).slice(0, 10) : '',
      ghana_card: emp.ghana_card || '', employment_type: emp.employment_type || '',
      termination_date: emp.termination_date ? String(emp.termination_date).slice(0, 10) : ''
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setCustomRole('');
    setFormData({ full_name: '', role: '', phone: '', email: '', basic_salary: 0, allowance: 0, deductions: 0, bank_name: '', bank_account: '', is_active: true, staff_id: '', pension_member_id: '', ssnit_number: '', date_of_birth: '', ghana_card: '', employment_type: '', termination_date: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const role = formData.role === '__custom__' ? customRole.trim() : formData.role;
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

  const extractCell = (cell) => {
    if (!cell?.value) return '';
    if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
    if (typeof cell.value === 'object') {
      if (cell.value.richText) return cell.value.richText.map((part) => part.text).join('').trim();
      if (cell.value.text) return String(cell.value.text).trim();
      if (typeof cell.value.result !== 'undefined') return String(cell.value.result).trim();
    }
    if (typeof cell.value === 'number' && !Number.isNaN(cell.value)) {
      return String(cell.value);
    }
    return String(cell.value).trim();
  };

  const downloadStaffTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Staff Upload');
    sheet.columns = [
      { header: 'Staff ID', key: 'staff_id', width: 18 },
      { header: 'Employee Name', key: 'employee_name', width: 28 },
      { header: 'Pension Fund Member ID', key: 'pension_member_id', width: 24 },
      { header: 'SSNIT Number', key: 'ssnit_number', width: 20 },
      { header: 'Date of Birth', key: 'date_of_birth', width: 18 },
      { header: 'Phone Number', key: 'phone', width: 18 },
      { header: 'Ghana Card', key: 'ghana_card', width: 22 },
      { header: 'Employment Status', key: 'employment_type', width: 28 },
      { header: 'Termination Date', key: 'termination_date', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    sheet.getRow(1).alignment = { horizontal: 'center' };
    sheet.addRow(['', '', '', '', '', '', '', '', '']);
    sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    sheet.addRow(['Example', 'Jane Doe', 'PENSION-001', 'C1234567890', '20/05/1990', '0240000000', 'GHA-000000000-1', 'Full Time', '']);
    sheet.getRow(3).font = { italic: true, color: { argb: 'FF64748B' } };
    for (let row = 2; row <= 1001; row++) {
      sheet.getRow(row).getCell(5).numFmt = '@';
      sheet.getRow(row).getCell(9).numFmt = '@';
    }
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), 'mccarthy_hill_staff_bulk_upload_template.xlsx');
  };

  const handleBulkUpload = async (event) => {
    event.preventDefault();
    setBulkMessage({ type: '', text: '' });
    if (!bulkFile) {
      setBulkMessage({ type: 'error', text: 'Select an Excel .xlsx file first.' });
      return;
    }
    setBulkLoading(true);
    try {
      const buffer = await bulkFile.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('The workbook has no worksheet.');
      const headers = {};
      sheet.getRow(1).eachCell((cell, column) => {
        headers[extractCell(cell).toLowerCase()] = column;
      });
      const findColumn = (...names) => names.map((name) => headers[name.toLowerCase()]).find(Boolean);
      const staffIdColumn = findColumn('Staff ID');
      const nameColumn = findColumn('Employee Name');
      if (!nameColumn) {
        throw new Error('Required column is missing: Employee Name. Staff ID is optional.');
      }
      const staff = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const staffId = staffIdColumn ? extractCell(row.getCell(staffIdColumn)) : '';
        const employeeName = extractCell(row.getCell(nameColumn));
        const employee = {
          staff_id: staffId,
          full_name: employeeName,
          pension_member_id: extractCell(row.getCell(findColumn('Pension Fund Member ID') || 3)),
          ssnit_number: extractCell(row.getCell(findColumn('SSNIT Number') || 4)),
          date_of_birth: extractCell(row.getCell(findColumn('Date of Birth') || 5)),
          phone: extractCell(row.getCell(findColumn('Phone Number') || 6)),
          ghana_card: extractCell(row.getCell(findColumn('Ghana Card') || 7)),
          employment_type: extractCell(row.getCell(findColumn('Employment Status') || 8)),
          termination_date: extractCell(row.getCell(findColumn('Termination Date') || 9)),
        };
        if (Object.values(employee).every((value) => !value)) return;
        staff.push(employee);
      });
      if (!staff.length) throw new Error('No staff rows found in the workbook.');
      const response = await bulkUpsertEmployees(staff);
      setBulkMessage({ type: 'success', text: response.data.message });
      setBulkFile(null);
      await fetchEmployees();
    } catch (err) {
      setBulkMessage({ type: 'error', text: err.response?.data?.message || err.message || 'Bulk staff upload failed.' });
    } finally {
      setBulkLoading(false);
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
          <button type="button" className="btn-secondary" onClick={() => { setBulkMessage({ type: '', text: '' }); setShowBulkModal(true); }} style={{ background: '#ffffff', color: '#1e3a8a', border: 'none', whiteSpace: 'nowrap' }}>
            Bulk Upload Staff
          </button>
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
            
            <label>Full Name</label><input type="text" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} />
            <label htmlFor="staff-role">Staff Role / Job Title</label>
            <select id="staff-role" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
              <option value="">Fill in later</option>
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
              />
            )}
            <small>Job title for the staff record and payroll; it does not grant system access.</small>

            <h3 style={{ margin: '1rem 0 0', fontSize: '1.1rem', color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>Employment Identity</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div><label>Staff ID</label><input type="text" value={formData.staff_id} onChange={e => setFormData({ ...formData, staff_id: e.target.value })} /></div>
              <div><label>Pension Fund Member ID</label><input type="text" value={formData.pension_member_id} onChange={e => setFormData({ ...formData, pension_member_id: e.target.value })} /></div>
              <div><label>SSNIT Number</label><input type="text" value={formData.ssnit_number} onChange={e => setFormData({ ...formData, ssnit_number: e.target.value })} /></div>
              <div><label>Date of Birth</label><input type="date" value={formData.date_of_birth} onChange={e => setFormData({ ...formData, date_of_birth: e.target.value })} /></div>
              <div><label>Ghana Card</label><input type="text" value={formData.ghana_card} onChange={e => setFormData({ ...formData, ghana_card: e.target.value })} /></div>
              <div><label>Employment Status</label><input type="text" value={formData.employment_type} onChange={e => setFormData({ ...formData, employment_type: e.target.value })} placeholder="Enter status as provided" /></div>
              <div><label>Termination Date</label><input type="date" value={formData.termination_date} onChange={e => setFormData({ ...formData, termination_date: e.target.value })} /></div>
            </div>
            
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
                <thead><tr><th>Employee</th><th>Official IDs</th><th>Net Salary</th><th>Bank Info</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id} style={{ opacity: emp.is_active ? 1 : 0.6 }}>
                      <td><strong>{emp.full_name}</strong><div style={{ fontSize: '0.8rem', color: '#64748b' }}>{emp.role}</div><small>{String(emp.employment_type || '').replaceAll('_', ' ')}</small></td>
                      <td><span style={{ fontSize: '0.78rem', lineHeight: 1.5 }}>
                        Staff: {emp.staff_id || '-'}<br />
                        SSNIT: {emp.ssnit_number || '-'}<br />
                        Ghana Card: {emp.ghana_card || '-'}
                      </span></td>
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

      {showBulkModal && (
        <div className="modal-overlay" onClick={() => setShowBulkModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: '680px' }}>
            <div className="modal-header">
              <div><p className="eyebrow">Excel Bulk Import</p><h2>Upload Staff Registry</h2></div>
              <button type="button" className="btn-close" onClick={() => setShowBulkModal(false)}>x</button>
            </div>
            {bulkMessage.text && (
              <div className={bulkMessage.type === 'error' ? 'error' : 'success'} style={{ marginBottom: '1rem' }}>
                {bulkMessage.text}
              </div>
            )}
            <p style={{ color: '#64748b', lineHeight: 1.6 }}>
              All staff fields are optional and can be completed later. Employment Status imports exactly as entered in the spreadsheet. Rows with an existing Staff ID update that employee; rows without one create a new staff record. Completely blank spreadsheet rows are ignored.
            </p>
            <form onSubmit={handleBulkUpload}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', margin: '1rem 0' }}>
                <label style={{ margin: 0 }}>Excel (.xlsx) *</label>
                <button type="button" className="btn-secondary" onClick={downloadStaffTemplate}>Download Template</button>
              </div>
              <input type="file" accept=".xlsx" onChange={(event) => setBulkFile(event.target.files?.[0] || null)} required />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowBulkModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={bulkLoading}>{bulkLoading ? 'Uploading...' : 'Upload & Update Staff'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
export default Employees;
