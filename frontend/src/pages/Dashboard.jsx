import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboardSummary } from '../api/dashboard';
import { getStudents } from '../api/students';

function Dashboard() {
  const [summary, setSummary] = useState({
    totalStudents: 0,
    totalClasses: 0,
    totalFeesCollected: 0,
    attendanceToday: { present: 0, absent: 0, late: 0, excused: 0 },
    feeTrends: [],
    topClasses: [],
    topStudents: [],
    atRiskStudents: [],
    attendanceTrends: []
  });
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [summaryResponse, studentsResponse] = await Promise.all([
          getDashboardSummary(),
          getStudents()
        ]);

        setSummary(summaryResponse.data);
        setStudents(studentsResponse.data || []);
        setLoading(false);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load dashboard data');
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="page"><p>Loading...</p></div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;

  const totalAttendance = Object.values(summary.attendanceToday).reduce((a, b) => a + b, 0);
  const attendanceRate = totalAttendance ? Math.round((summary.attendanceToday.present / totalAttendance) * 100) : 0;
  const currencyCode = localStorage.getItem('sms_currency') || 'USD';
  const formatMoney = (val) => Number(val || 0).toLocaleString(undefined, { style: 'currency', currency: currencyCode });
  const todayStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const supportStudents = students.filter((student) => student.allergies || student.disability);

  const statCards = [
    { label: 'Students', value: summary.totalStudents, note: 'Active learners enrolled', accent: 'sky' },
    { label: 'Classes', value: summary.totalClasses, note: 'Teaching groups created', accent: 'emerald' },
    { label: 'Fees Collected', value: formatMoney(summary.totalFeesCollected), note: 'Recorded payments', accent: 'amber' },
    { label: 'Support Needs', value: supportStudents.length, note: 'Students with allergy or disability notes', accent: 'violet' },
    { label: 'Present Today', value: summary.attendanceToday.present, note: `${attendanceRate}% attendance rate`, accent: 'sky' }
  ];

  // For calculating relative CSS chart heights
  const maxFee = Math.max(...summary.feeTrends.map(f => Number(f.total)), 1);

  return (
    <div className="page dashboard-page">
      <div className="dashboard-shell">
        <section className="dashboard-hero overview-hero">
          <div>
            <p className="eyebrow">{todayStr}</p>
            <h1>Overview</h1>
            <p className="hero-copy">A clear view of school activity, attendance, fees, and student progress.</p>
          </div>
          <div className="hero-status">
            <span className="status-dot" aria-hidden="true"></span>
            <span>School summary</span>
          </div>
        </section>

        <section className="stats-grid" aria-label="School summary">
          {statCards.map(stat => (
            <article key={stat.label} className={`stat-card overview-stat stat-${stat.accent}`}>
              <div className="stat-topline">
                <span>{stat.label}</span>
                <span className="stat-mark"></span>
              </div>
              <strong>{stat.value}</strong>
              <p>{stat.note}</p>
            </article>
          ))}
        </section>

        <section className="dashboard-grid" style={{ marginTop: '0.5rem' }}>
          <article className="dashboard-panel dashboard-risk-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Teacher visibility</p>
                <h2>Student support needs</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {supportStudents.length > 0 ? supportStudents.map((student, idx) => (
                    <tr key={student.id || idx}>
                      <td><strong>{student.name}</strong></td>
                      <td>{student.class_name || student.class_id || 'Unassigned'}</td>
                      <td>
                        <span className="status-pill absent" style={{ whiteSpace: 'normal' }}>
                          {student.allergies ? `Allergies: ${student.allergies}` : ''}
                          {student.allergies && student.disability ? ' • ' : ''}
                          {student.disability ? `Disability: ${student.disability}` : ''}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="3"><p className="empty-state">No student support notes recorded.</p></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="dashboard-grid">
          {/* Fee Collection Trends Chart */}
          <article className="dashboard-panel">
            <div className="panel-heading"><div><p className="eyebrow">Analytics</p><h2>Fee Collections</h2></div></div>
            <div className="overview-chart">
              {summary.feeTrends.length > 0 ? summary.feeTrends.map((trend, idx) => {
                const heightPct = Math.round((Number(trend.total) / maxFee) * 100);
                return (
                  <div className="overview-chart-column" key={idx}>
                    <span className="overview-chart-value">{formatMoney(trend.total)}</span>
                    <div className="overview-chart-track"><div className="overview-chart-bar fee-chart-bar" style={{ '--bar-height': `${heightPct}%` }} title={formatMoney(trend.total)} /></div>
                    <span className="overview-chart-label">{trend.month}</span>
                  </div>
                );
              }) : <p className="empty-state">No fee data available yet.</p>}
            </div>
          </article>

          {/* Attendance Trends Chart */}
          <article className="dashboard-panel">
            <div className="panel-heading"><div><p className="eyebrow">Analytics</p><h2>Recent Attendance</h2></div></div>
            <div className="overview-chart">
              {summary.attendanceTrends.slice().reverse().map((trend, idx) => {
                const rate = trend.total > 0 ? Math.round((trend.present / trend.total) * 100) : 0;
                const barTone = rate >= 80 ? 'good' : rate >= 50 ? 'mid' : 'low';
                return (
                  <div className="overview-chart-column" key={idx}>
                    <span className="overview-chart-value">{rate}%</span>
                    <div className="overview-chart-track"><div className={`overview-chart-bar attendance-chart-bar tone-${barTone}`} style={{ '--bar-height': `${rate}%` }} /></div>
                    <span className="overview-chart-label">{new Date(trend.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </div>
                );
              })}
              {summary.attendanceTrends.length === 0 && <p className="empty-state">No attendance data available.</p>}
            </div>
          </article>

          {/* Top Classes */}
          <article className="dashboard-panel">
            <div className="panel-heading"><div><p className="eyebrow">Academics</p><h2>Top Classes</h2></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Class</th><th>Avg Score</th></tr></thead>
                <tbody>
                  {summary.topClasses.map((cls, idx) => (<tr key={idx}><td><strong>{cls.name}</strong></td><td><span className="status-pill present">{cls.avg_score}%</span></td></tr>))}
                </tbody>
              </table>
              {summary.topClasses.length === 0 && <p className="empty-state">No academic results recorded.</p>}
            </div>
          </article>

          {/* Top Students */}
          <article className="dashboard-panel">
            <div className="panel-heading"><div><p className="eyebrow">Academics</p><h2>Top Students</h2></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Student</th><th>Class</th><th>Avg Score</th></tr></thead>
                <tbody>
                  {summary.topStudents.map((st, idx) => (<tr key={idx}><td><strong>{st.name}</strong></td><td>{st.class_name}</td><td><span className="status-pill present">{st.avg_score}%</span></td></tr>))}
                </tbody>
              </table>
              {summary.topStudents.length === 0 && <p className="empty-state">No academic results recorded.</p>}
            </div>
          </article>

          {/* At-Risk Students */}
          <article className="dashboard-panel dashboard-risk-panel">
            <div className="panel-heading"><div><p className="eyebrow">Action required</p><h2>Students at risk (high absences)</h2></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Student</th><th>Class</th><th>Total Absences</th></tr></thead>
                <tbody>
                  {summary.atRiskStudents.map((st, idx) => (
                    <tr key={idx}><td><strong>{st.name}</strong></td><td>{st.class_name}</td><td><span className="status-pill absent">{st.absences} Absences</span></td></tr>
                  ))}
                </tbody>
              </table>
              {summary.atRiskStudents.length === 0 && <p className="empty-state">No students currently flagged at risk.</p>}
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
