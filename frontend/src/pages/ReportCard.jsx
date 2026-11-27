import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getReportCard } from '../api/results';
import { getSettings } from '../api/settings';

const getOrdinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const getGrade = (score) => {
  if (score >= 80) return { grade: 'A', remark: 'Excellent' };
  if (score >= 70) return { grade: 'B', remark: 'Very Good' };
  if (score >= 60) return { grade: 'C', remark: 'Good' };
  if (score >= 50) return { grade: 'D', remark: 'Credit' };
  if (score >= 40) return { grade: 'E', remark: 'Pass' };
  return { grade: 'F', remark: 'Fail' };
};

function ReportCard() {
  const { studentId } = useParams();
  const [searchParams] = useSearchParams();
  const [term, setTerm] = useState(searchParams.get('term') || 'Term 1');
  const [report, setReport] = useState(null);
  const [school, setSchool] = useState({});
  const [loading, setLoading] = useState(true);
  const [teacherSig, setTeacherSig] = useState(null);
  const [headmasterSig, setHeadmasterSig] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [reportRes, schoolRes] = await Promise.all([
          getReportCard(studentId, term),
          getSettings().catch(() => ({ data: { name: 'Excellence Academy', motto: 'Knowledge is Power' } }))
        ]);
        setReport(reportRes.data);
        setSchool(schoolRes.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [studentId, term]);

  if (loading) return <div className="page"><p>Loading Official Report...</p></div>;
  if (!report) return <div className="page"><p className="error">Failed to load report card.</p></div>;

  const handleSigUpload = (e, setter) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setter(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const requiresSubjectTeacherRemarks =
    report?.student &&
    String(report.student.class_teaching_model || '').toLowerCase() === 'subject_teacher' &&
    Number(report.student.class_year_level || 0) >= 5;

  const currentAvg = Number(report.classStats.term_average);
  let previousAvg = null;
  let improvement = null;

  if (report.trends && report.trends.length > 1) {
    const currentIdx = report.trends.findIndex(t => t.term === term);
    if (currentIdx > 0) {
      previousAvg = Number(report.trends[currentIdx - 1].term_average);
      improvement = (currentAvg - previousAvg).toFixed(2);
    }
  }

  return (
    <div className="page" style={{ padding: '2rem', background: '#f1f5f9', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="no-print" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <select value={term} onChange={(e) => setTerm(e.target.value)} style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
          <option value="Term 1">Term 1</option>
          <option value="Term 2">Term 2</option>
          <option value="Term 3">Term 3</option>
        </select>
        <button className="btn-secondary" onClick={() => { alert("To save as a PDF, simply change the 'Destination' to 'Save as PDF' in the print window!"); window.print(); }} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'white', color: '#0f172a' }}>
          📥 Download PDF
        </button>
        <button className="btn-primary" onClick={() => window.print()} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>🖨️ Print Official Report</button>
      </div>

      <div className="print-section" style={{ background: 'white', width: '100%', maxWidth: '850px', padding: '3rem', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', color: '#0f172a', position: 'relative' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '3px solid #1e293b', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
          {school.logo_url ? (
            <img src={school.logo_url} alt="School Logo" style={{ width: '120px', height: '120px', objectFit: 'contain', marginRight: '1rem' }} />
          ) : (
            <div style={{ width: '120px', height: '120px', marginRight: '1rem' }}></div>
          )}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem', textTransform: 'uppercase', letterSpacing: '2px' }}>{school.name}</h1>
            <p style={{ margin: 0, fontSize: '1.1rem', fontStyle: 'italic', color: '#475569' }}>{school.motto || 'Excellence in Education'}</p>
            <h2 style={{ marginTop: '1.5rem', background: '#1e293b', color: 'white', display: 'inline-block', padding: '0.5rem 1.5rem', borderRadius: '999px', fontSize: '1.1rem' }}>TERMINAL REPORT - {term.toUpperCase()}</h2>
          </div>
          <div style={{ width: '120px', marginLeft: '1rem' }}></div>
        </div>

        {/* Student Profile Block */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', background: '#f8fafc', padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <div><strong style={{ color: '#64748b' }}>Student Name:</strong> {report.student.name}</div>
          <div><strong style={{ color: '#64748b' }}>Student ID:</strong> {report.student.student_id}</div>
          <div><strong style={{ color: '#64748b' }}>Class:</strong> {report.student.class_name}</div>
          <div><strong style={{ color: '#64748b' }}>Academic Year:</strong> {report.student.historical_context_missing ? 'Historical year not recorded' : report.student.academic_year || school.academic_year || 'Not set'}</div>
          {report.student.historical_context_missing && <div style={{ gridColumn: '1 / -1', color: '#9a3412' }}>
            Historical class and academic-year details were not recorded for this result.
          </div>}
        </div>

        {/* Grades Table */}
        {requiresSubjectTeacherRemarks && (
          <div style={{ marginBottom: '1rem', padding: '0.9rem 1rem', borderRadius: '8px', background: '#fff7ed', border: '1px solid #fdba74', color: '#9a4d00', fontSize: '0.9rem', fontWeight: '600' }}>
            Subject-based class: each subject teacher must write a remark for this report card.
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2.5rem', fontSize: '0.95rem' }}>
          <thead>
            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Subject</th>
              <th style={{ padding: '0.75rem', textAlign: 'center' }}>Class (50)</th>
              <th style={{ padding: '0.75rem', textAlign: 'center' }}>Exam (50)</th>
              <th style={{ padding: '0.75rem', textAlign: 'center' }}>Total (100)</th>
              <th style={{ padding: '0.75rem', textAlign: 'center' }}>Grade</th>
              <th style={{ padding: '0.75rem', textAlign: 'center' }}>Rank</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Remarks</th>
              {requiresSubjectTeacherRemarks && (
                <th style={{ padding: '0.75rem', textAlign: 'left', minWidth: '220px' }}>Subject Teacher's Remark</th>
              )}
            </tr>
          </thead>
          <tbody>
            {report.results.length === 0 && (
              <tr>
                <td colSpan={requiresSubjectTeacherRemarks ? 8 : 7} style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontStyle: 'italic' }}>
                  No results recorded for {term}.
                </td>
              </tr>
            )}
            {report.results.map((r, i) => {
              const g = getGrade(r.score);
              return (
                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.75rem', fontWeight: '600' }}>{r.subject}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>{r.class_score}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>{r.exam_score}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 'bold' }}>{r.score}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 'bold', color: r.score >= 50 ? '#059669' : '#dc2626' }}>{g.grade}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>{getOrdinal(r.subject_rank)} <span style={{fontSize: '0.75rem', color: '#94a3b8'}}>/ {r.total_students}</span></td>
                  <td style={{ padding: '0.75rem', fontStyle: 'italic', color: '#475569' }}>{g.remark}</td>
                  {requiresSubjectTeacherRemarks && (
                    <td style={{ padding: '0.5rem', verticalAlign: 'top' }}>
                      <div
                        contentEditable="true"
                        suppressContentEditableWarning={true}
                        data-placeholder={`Write ${r.subject} remark...`}
                        style={{
                          width: '100%',
                          minHeight: '52px',
                          padding: '0.6rem 0.7rem',
                          border: '1px solid #fbbf24',
                          borderRadius: '6px',
                          background: '#fffbeb',
                          color: '#0f172a',
                          outline: 'none',
                          lineHeight: '1.5'
                        }}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Analytics Block */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '2rem', marginBottom: '3rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.5rem', background: '#f8fafc' }}>
              <h3 style={{ margin: '0 0 1rem 0', color: '#334155', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem' }}>Analytics & Attendance</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}><span>Class Position:</span> <strong>{getOrdinal(report.classStats.class_rank)} out of {report.classStats.total_in_class}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}><span>Term Average:</span> <strong>{currentAvg.toFixed(2)}%</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed #cbd5e1' }}><span>Days Present:</span> <strong>{report.attendance.present}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Days Absent/Late:</span> <strong style={{ color: report.attendance.absent > 0 ? '#dc2626' : 'inherit' }}>{Number(report.attendance.absent) + Number(report.attendance.late)}</strong></div>
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.5rem', background: '#eff6ff' }}>
              <strong style={{ color: '#1e3a8a', display: 'block', marginBottom: '0.5rem' }}>Promoted To / Next Class:</strong>
              <div 
                contentEditable="true" 
                suppressContentEditableWarning={true}
                className="editable-field"
                data-placeholder="Click to type next class..." 
                style={{ width: '100%', borderBottom: '2px dotted #94a3b8', outline: 'none', fontSize: '1.1rem', color: '#0f172a', marginTop: '0.5rem', padding: '0.5rem 0', fontWeight: 'bold', minHeight: '35px' }} 
              ></div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <strong style={{ color: '#0f172a', marginBottom: '0.5rem', display: 'block' }}>Class Teacher's Remarks:</strong>
              <div 
                contentEditable="true" 
                suppressContentEditableWarning={true}
                className="editable-field"
                data-placeholder="Click to type remarks..." 
                style={{ width: '100%', flex: 1, borderBottom: '1px dashed #cbd5e1', outline: 'none', fontSize: '1rem', color: '#0f172a', marginTop: '0.5rem', lineHeight: '1.8', minHeight: '60px' }} 
              ></div>
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <strong style={{ color: '#0f172a', marginBottom: '0.5rem', display: 'block' }}>Headmaster's Remarks:</strong>
              <div 
                contentEditable="true" 
                suppressContentEditableWarning={true}
                className="editable-field"
                data-placeholder="Click to type remarks..." 
                style={{ width: '100%', flex: 1, borderBottom: '1px dashed #cbd5e1', outline: 'none', fontSize: '1rem', color: '#0f172a', marginTop: '0.5rem', lineHeight: '1.8', minHeight: '60px' }} 
              ></div>
            </div>
          </div>
        </div>

        {/* Signatures */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '2rem' }}>
          <div style={{ textAlign: 'center', width: '250px' }}>
            <label style={{ display: 'block', cursor: 'pointer', minHeight: '60px' }}>
              {teacherSig ? (
                <img src={teacherSig} alt="Teacher Signature" style={{ height: '60px', objectFit: 'contain', marginBottom: '0.5rem' }} />
              ) : (
                <div className="no-print" style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic', border: '1px dashed #cbd5e1', borderRadius: '4px', marginBottom: '0.5rem' }}>Click to upload signature</div>
              )}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleSigUpload(e, setTeacherSig)} />
            </label>
            <div style={{ borderTop: '2px solid #0f172a', paddingTop: '0.5rem', fontWeight: 'bold', color: '#0f172a' }}>Teacher's Signature</div>
          </div>
          <div style={{ textAlign: 'center', width: '250px' }}>
            <label style={{ display: 'block', cursor: 'pointer', minHeight: '60px' }}>
              {headmasterSig ? (
                <img src={headmasterSig} alt="Headmaster Signature" style={{ height: '60px', objectFit: 'contain', marginBottom: '0.5rem' }} />
              ) : (
                <div className="no-print" style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic', border: '1px dashed #cbd5e1', borderRadius: '4px', marginBottom: '0.5rem' }}>Click to upload signature</div>
              )}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleSigUpload(e, setHeadmasterSig)} />
            </label>
            <div style={{ borderTop: '2px solid #0f172a', paddingTop: '0.5rem', fontWeight: 'bold', color: '#0f172a' }}>Headmaster's Signature</div>
          </div>
        </div>
      </div>
    </div>
  );
}
export default ReportCard;
