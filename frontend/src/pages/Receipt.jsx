import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getStudents } from '../api/students';
import { getFeesByStudent } from '../api/fees';
import { getSettings } from '../api/settings';

function Receipt() {
  const { studentId, feeId } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [fee, setFee] = useState(null);
  const [school, setSchool] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cashierSig, setCashierSig] = useState(null);

  const currencyCode = localStorage.getItem('sms_currency') || 'GHS';
  const formatMoney = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: currencyCode });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [studentsRes, feesRes, settingsRes] = await Promise.all([
          getStudents(),
          getFeesByStudent(studentId),
          getSettings().catch(() => ({ data: {} })) // Fallback if viewed by parent
        ]);
        
        const foundStudent = studentsRes.data.find(s => String(s.id) === studentId);
        const foundFee = feesRes.data.find(f => String(f.id) === feeId);
        
        if (!foundFee) throw new Error('Fee record not found.');
        
        setStudent(foundStudent);
        setFee(foundFee);
        setSchool(settingsRes.data);
        setLoading(false);
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Failed to load receipt data.');
        setLoading(false);
      }
    };
    fetchData();
  }, [studentId, feeId]);

  const handleSigUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setCashierSig(reader.result);
      reader.readAsDataURL(file);
    }
  };

  if (loading) return <div className="page"><p>Loading Official Receipt...</p></div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!student || !fee) return <p>Receipt data not found.</p>;

  return (
    <div className="page" style={{ padding: '2rem', background: '#f1f5f9', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      
      {/* MAGIC PRINT CSS: Forces colors, hides sidebars, targets only the receipt container */}
      <style>{`
        @media print {
          @page { size: A5 landscape; margin: 0; }
          body * { visibility: hidden; }
          .print-section, .print-section * { visibility: visible; }
          .print-section {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0 !important;
            padding: 15mm !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
          }
          .no-print { display: none !important; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
      `}</style>

      <div className="no-print" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <button className="btn-secondary" onClick={() => navigate(-1)} style={{ background: 'white', color: '#0f172a' }}>← Back to Fees</button>
        <button className="btn-secondary" onClick={() => { alert("To save as a PDF, simply change the 'Destination' to 'Save as PDF' in the print window!"); window.print(); }} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'white', color: '#0f172a' }}>
          📥 Download PDF
        </button>
        <button className="btn-primary" onClick={() => window.print()} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>🖨️ Print Official Receipt</button>
      </div>

      <div className="print-section" style={{ background: 'white', width: '100%', maxWidth: '850px', padding: '3rem', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', color: '#0f172a', position: 'relative' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '3px solid #1e293b', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
          {school.logo_url ? (
            <img src={school.logo_url} alt="School Logo" style={{ width: '120px', height: '120px', objectFit: 'contain', marginRight: '1rem' }} />
          ) : (
            <div style={{ width: '120px', height: '120px', marginRight: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
              <span style={{ fontSize: '2rem' }}>🏫</span>
            </div>
          )}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem', textTransform: 'uppercase', letterSpacing: '2px', color: '#1e3a8a' }}>{school.name || 'THE MCCARTHY HILL SCHOOL'}</h1>
            <p style={{ margin: '0 0 0.25rem 0', color: '#475569', fontWeight: '600', fontSize: '1.1rem' }}>{school.address || '123 Education Lane, Learning City'}</p>
            <p style={{ margin: '0 0 0.5rem 0', color: '#475569' }}>Tel: {school.phone || '+1 234 567 8900'}</p>
            <h2 style={{ marginTop: '1rem', background: '#1e293b', color: 'white', display: 'inline-block', padding: '0.5rem 1.5rem', borderRadius: '999px', fontSize: '1.1rem', letterSpacing: '1px' }}>OFFICIAL PAYMENT RECEIPT</h2>
          </div>
          <div style={{ width: '120px', marginLeft: '1rem' }}>
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>Receipt No.</p>
              <strong style={{ fontSize: '1.2rem', color: '#0f172a' }}>#{String(fee.id).padStart(6, '0')}</strong>
            </div>
          </div>
        </div>

        {/* Receipt Details Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem', marginBottom: '3rem', fontSize: '1.1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ borderBottom: '1px dashed #cbd5e1', paddingBottom: '0.5rem' }}><strong style={{ color: '#64748b' }}>Date:</strong> <span style={{ float: 'right' }}>{new Date(fee.created_at || new Date()).toLocaleDateString()}</span></div>
            <div style={{ borderBottom: '1px dashed #cbd5e1', paddingBottom: '0.5rem' }}><strong style={{ color: '#64748b' }}>Received From:</strong> <span style={{ float: 'right', fontWeight: 'bold' }}>{student.name}</span></div>
            <div style={{ borderBottom: '1px dashed #cbd5e1', paddingBottom: '0.5rem' }}><strong style={{ color: '#64748b' }}>Student ID:</strong> <span style={{ float: 'right' }}>{student.student_id}</span></div>
            <div style={{ borderBottom: '1px dashed #cbd5e1', paddingBottom: '0.5rem' }}><strong style={{ color: '#64748b' }}>Class:</strong> <span style={{ float: 'right' }}>{student.class_name || 'N/A'}</span></div>
          </div>
          
          <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong style={{ color: '#64748b' }}>Description:</strong> <span>{fee.description || 'School Fees'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #cbd5e1' }}><strong style={{ color: '#64748b' }}>Amount Due:</strong> <span>{formatMoney(fee.amount_due)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', background: '#ecfdf5', padding: '1rem', borderRadius: '8px', border: '1px solid #a7f3d0' }}><strong style={{ color: '#065f46' }}>Amount Paid:</strong> <span style={{ fontWeight: 'bold', color: '#059669', fontSize: '1.25rem' }}>{formatMoney(fee.amount_paid)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem' }}><strong style={{ color: '#64748b' }}>Outstanding Balance:</strong> <span style={{ fontWeight: 'bold', color: Number(fee.balance) > 0 ? '#ef4444' : '#10b981' }}>{formatMoney(fee.balance)}</span></div>
          </div>
        </div>

        {/* Signature Area */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3rem', paddingTop: '2rem' }}>
          <div style={{ textAlign: 'center', width: '250px' }}>
            <label style={{ display: 'block', cursor: 'pointer', minHeight: '60px' }}>
              {cashierSig ? (
                <img src={cashierSig} alt="Cashier Signature" style={{ height: '60px', objectFit: 'contain', marginBottom: '0.5rem' }} />
              ) : (
                <div className="no-print" style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic', border: '1px dashed #cbd5e1', borderRadius: '4px', marginBottom: '0.5rem' }}>Click to upload signature</div>
              )}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleSigUpload} />
            </label>
            <div style={{ borderTop: '2px solid #0f172a', paddingTop: '0.5rem', fontWeight: 'bold', color: '#0f172a' }}>Cashier / Admin Signature</div>
          </div>
          <div style={{ textAlign: 'center', width: '250px' }}>
            <div style={{ height: '60px' }}></div>
            <div style={{ borderTop: '2px solid #0f172a', paddingTop: '0.5rem', fontWeight: 'bold', color: '#0f172a' }}>Official School Stamp</div>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic' }}>
          Powered by The McCarthy Hill School
        </div>
        
      </div>
    </div>
  );
}

export default Receipt;
