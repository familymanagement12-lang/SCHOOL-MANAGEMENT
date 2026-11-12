import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFeesByStudent, recordFee } from '../api/fees';
import { getStudents } from '../api/students';
import { getClasses } from '../api/classes';
import api from '../api/api';

const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    return null;
  }
};

function Fees() {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [fees, setFees] = useState([]);
  const [formData, setFormData] = useState({
    amount_paid: '',
    due_date: new Date().toISOString().split('T')[0],
    description: '',
  });
  const [showStructureModal, setShowStructureModal] = useState(false);
  const [structureData, setStructureData] = useState({
    academic_year: '2026/2027',
    term: 'First Term',
    class_ids: [],
    items: [{ fee_name: 'Tuition Fee', amount: '' }, { fee_name: 'PTA Fee', amount: '' }]
  });
  const [isBilling, setIsBilling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = getCurrentUser();

  useEffect(() => {
    fetchSetupData();
  }, []);

  useEffect(() => {
    if (selectedStudent) {
      fetchFees(selectedStudent);
    } else {
      setFees([]);
    }
  }, [selectedStudent]);

  const fetchSetupData = async () => {
    try {
      const [studentsRes, classesRes] = await Promise.all([
        getStudents(),
        getClasses()
      ]);
      setStudents(studentsRes.data);
      setClasses(classesRes.data);
      setSelectedStudent(studentsRes.data[0]?.id ? String(studentsRes.data[0].id) : '');
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load data');
      setLoading(false);
    }
  };

  const fetchFees = async (studentId) => {
    try {
      const response = await getFeesByStudent(studentId);
      setFees(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load fees');
    }
  };

  const selectedStudentRecord = students.find((student) => String(student.id) === selectedStudent);

  const totals = useMemo(() => fees.reduce((sum, fee) => ({
    due: sum.due + Number(fee.amount_due || 0),
    paid: sum.paid + Number(fee.amount_paid || 0),
    balance: sum.balance + Number(fee.balance || 0),
  }), { due: 0, paid: 0, balance: 0 }), [fees]);

  const currencyCode = localStorage.getItem('sms_currency') || 'USD';
  const formatMoney = (value) => Number(value || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: currencyCode,
  });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    try {
      await recordFee({
        student_id: selectedStudent,
        amount_due: 0,
        amount_paid: formData.amount_paid || 0,
        due_date: formData.due_date,
        description: formData.description,
      });
      setFormData({ amount_paid: '', due_date: new Date().toISOString().split('T')[0], description: '' });
      await fetchFees(selectedStudent);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record fee');
    }
  };

  const handleGenerateStructure = async (event) => {
    event.preventDefault();
    setError('');
    setIsBilling(true);

    if (structureData.class_ids.length === 0) {
      setError('Please select at least one class to apply this structure to.');
      setIsBilling(false);
      return;
    }

    try {
      // Use direct API call to the new structure endpoint
      const res = await api.post('/fee-structures', structureData);
      
      setShowStructureModal(false);
      setStructureData({ academic_year: '2026/2027', term: 'First Term', class_ids: [], items: [{ fee_name: 'Tuition Fee', amount: '' }] });
      
      if (selectedStudent) await fetchFees(selectedStudent);
      alert(res.data.message);
    } catch (err) {
      console.error('Fee Structure Upload Error:', err.response || err);
      setError(err.response?.data?.message || 'Failed to generate fee structure. Ensure server.js is updated and SQL is imported.');
    } finally {
      setIsBilling(false);
    }
  };

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero fees-hero">
          <div>
            <p className="eyebrow">Fees</p>
            <h1>Payments Desk</h1>
            <p>Record billing, payments, balances, and due dates for each student.</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <select value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)}>
              <option value="">Choose student</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.student_id} - {student.name}
                </option>
              ))}
            </select>
            {['admin', 'accountant'].includes(user?.role) && (
              <button className="btn-secondary" onClick={() => setShowStructureModal(true)} style={{ whiteSpace: 'nowrap', backgroundColor: 'white', color: '#0f172a' }}>
                ➕ Create Fee Structure
              </button>
            )}
          </div>
        </section>

        <section className="module-stats">
          <div className="mini-stat"><span>Amount Due</span><strong>{formatMoney(totals.due)}</strong></div>
          <div className="mini-stat"><span>Paid</span><strong>{formatMoney(totals.paid)}</strong></div>
          <div className="mini-stat"><span>Balance</span><strong>{formatMoney(totals.balance)}</strong></div>
        </section>

        <section className="split-layout">
          <form className="data-panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">New Payment</p>
                <h2>{selectedStudentRecord?.name || 'Select a student'}</h2>
              </div>
            </div>

            {error && <div className="error">{error}</div>}

            {selectedStudent && (
              <div style={{ marginBottom: '0.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Outstanding Balance</span>
                <div style={{ fontSize: '1.5rem', fontWeight: '800', color: totals.balance > 0 ? '#ef4444' : '#10b981', marginTop: '0.25rem' }}>
                  {formatMoney(totals.balance)}
                </div>
              </div>
            )}

            <label>Amount Paid (Receipt)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.amount_paid}
              onChange={(event) => setFormData({ ...formData, amount_paid: event.target.value })}
              placeholder="e.g. 200"
            />

            <label>Reason / Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(event) => setFormData({ ...formData, description: event.target.value })}
              placeholder="e.g. Partial Term 1 Payment"
            />

            <label>Payment Date</label>
            <input
              type="date"
              value={formData.due_date}
              readOnly
              style={{ opacity: 0.7, cursor: 'not-allowed' }}
            />

            <button type="submit" className="btn-primary" disabled={!selectedStudent}>Record Payment</button>
          </form>

          <section className="data-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">History</p>
                <h2>Fee Records</h2>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Due</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Due Date</th>
                    <th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.map((fee) => (
                    <tr key={fee.id}>
                      <td>{fee.description || '-'}</td>
                      <td>{formatMoney(fee.amount_due)}</td>
                      <td>{formatMoney(fee.amount_paid)}</td>
                      <td><span className={Number(fee.balance) > 0 ? 'balance-due' : 'balance-clear'}>{formatMoney(fee.balance)}</span></td>
                      <td>{fee.due_date || '-'}</td>
                      <td>
                        {Number(fee.amount_paid) > 0 && <Link to={`/receipt/${selectedStudent}/${fee.id}`} className="btn-small btn-secondary" style={{ textDecoration: 'none', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>🖨️ Print</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fees.length === 0 && <p className="empty-state">No fee records for this student yet.</p>}
          </section>
        </section>
      </div>

      {showStructureModal && (
        <div className="modal-overlay" onClick={() => setShowStructureModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h2>Create Fee Structure</h2>
              <button className="btn-close" onClick={() => setShowStructureModal(false)}>x</button>
            </div>
            <form onSubmit={handleGenerateStructure}>
              
              {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                <div>
                  <label>Academic Year</label>
                  <select value={structureData.academic_year} onChange={(e) => setStructureData({...structureData, academic_year: e.target.value})}>
                    <option value="2025/2026">2025/2026</option>
                    <option value="2026/2027">2026/2027</option>
                    <option value="2027/2028">2027/2028</option>
                  </select>
                </div>
                <div>
                  <label>Term / Semester</label>
                  <select value={structureData.term} onChange={(e) => setStructureData({...structureData, term: e.target.value})}>
                    <option value="First Term">First Term</option>
                    <option value="Second Term">Second Term</option>
                    <option value="Third Term">Third Term</option>
                  </select>
                </div>
              </div>

              <label>Classes to apply this structure to:</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', maxHeight: '150px', overflowY: 'auto' }}>
                {classes.map(cls => (
                  <label key={cls.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontWeight: 'normal', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      style={{ width: 'auto', margin: 0 }}
                      checked={structureData.class_ids.includes(cls.id)}
                      onChange={(e) => {
                        const updated = e.target.checked 
                          ? [...structureData.class_ids, cls.id]
                          : structureData.class_ids.filter(id => id !== cls.id);
                        setStructureData({...structureData, class_ids: updated});
                      }}
                    />
                    {cls.name}
                  </label>
                ))}
              </div>

              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
                <span style={{ fontSize: '1.1rem', color: '#0f172a' }}>Fee Items</span>
                <button 
                  type="button" 
                  className="btn-small btn-secondary" 
                  onClick={() => setStructureData({...structureData, items: [...structureData.items, {fee_name: '', amount: ''}]})}
                  style={{ background: 'white' }}
                >
                  + Add Fee Item
                </button>
              </label>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {structureData.items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <input type="text" placeholder="e.g. ICT Fee" value={item.fee_name} onChange={(e) => {
                      const newItems = [...structureData.items];
                      newItems[idx].fee_name = e.target.value;
                      setStructureData({...structureData, items: newItems});
                    }} required style={{ flex: 2, margin: 0 }} />
                    
                    <input type="number" min="0" step="0.01" placeholder="Amount" value={item.amount} onChange={(e) => {
                      const newItems = [...structureData.items];
                      newItems[idx].amount = e.target.value;
                      setStructureData({...structureData, items: newItems});
                    }} required style={{ flex: 1, margin: 0 }} />
                    
                    <button type="button" onClick={() => {
                      if (structureData.items.length > 1) {
                        setStructureData({...structureData, items: structureData.items.filter((_, i) => i !== idx)});
                      }
                    }} style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', fontSize: '1.2rem', cursor: 'pointer', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>&times;</button>
                  </div>
                ))}
              </div>

              <div style={{ background: '#ecfdf5', padding: '1.25rem', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', border: '1px solid #10b981' }}>
                <span style={{ fontWeight: 'bold', color: '#065f46', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Amount:</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '900', color: '#059669' }}>
                  {formatMoney(structureData.items.reduce((sum, item) => sum + Number(item.amount || 0), 0))}
                </span>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowStructureModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isBilling}>
                  {isBilling ? 'Applying...' : 'Save & Apply Structure'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Fees;
