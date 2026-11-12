import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ShieldAlert, Users, AlertTriangle, ClipboardList, CalendarDays } from 'lucide-react';
import { getClasses } from '../api/classes';
import { getStudents } from '../api/students';
import { getTimetable } from '../api/timetable';

function TeacherDashboard() {
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAssignedClasses = async () => {
      try {
        const [classesResponse, studentsResponse, timetableResponse] = await Promise.all([
          getClasses(),
          getStudents(),
          getTimetable({ academic_year: '2026/2027', term: 'Term 1' }),
        ]);

        setClasses(classesResponse.data);
        setStudents(studentsResponse.data);
        setTimetable(Array.isArray(timetableResponse.data) ? timetableResponse.data : []);
        setLoading(false);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load your teaching overview');
        setLoading(false);
      }
    };

    fetchAssignedClasses();
  }, []);

  if (loading) return <div className="page"><p>Loading...</p></div>;

  const totalStudents = students.length;
  const classesWithMedicalNotes = classes.filter((cls) => {
    const classStudents = students.filter((student) => String(student.class_id) === String(cls.id));
    return classStudents.some((student) => student.allergies || student.disability);
  }).length;
  const studentsWithNeeds = students.filter((student) => student.allergies || student.disability).length;
  const teachingSessions = timetable.length;
  const timetableByDay = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].reduce((acc, day) => {
    acc[day] = (timetable || []).filter((entry) => (entry.day_of_week || entry.day)?.toLowerCase() === day.toLowerCase());
    return acc;
  }, {});

  return (
    <div className="page dashboard-page">
      <div className="dashboard-shell">
        <section className="dashboard-hero">
          <div>
            <p className="eyebrow">Teacher Portal</p>
            <h1>My Classes & Records</h1>
            <p className="hero-copy">Track your class activity, review student support needs, and keep up with your weekly timetable in a single view.</p>
            <Link to="/library" className="teacher-library-link"><BookOpen size={16} /> Browse the library</Link>
          </div>
        </section>

        <section className="stats-grid" aria-label="Teacher summary">
          <article className="stat-card overview-stat stat-sky">
            <div className="stat-topline"><span>Assigned Classes</span><Users size={16} /></div>
            <strong>{classes.length}</strong>
            <p>Active classes under your care</p>
          </article>

          <article className="stat-card overview-stat stat-emerald">
            <div className="stat-topline"><span>Students</span><ClipboardList size={16} /></div>
            <strong>{totalStudents}</strong>
            <p>Students currently in the system</p>
          </article>

          <article className="stat-card overview-stat stat-amber">
            <div className="stat-topline"><span>Support Needs</span><AlertTriangle size={16} /></div>
            <strong>{studentsWithNeeds}</strong>
            <p>Students with allergies or disability notes</p>
          </article>

          <article className="stat-card overview-stat stat-violet">
            <div className="stat-topline"><span>My Timetable</span><CalendarDays size={16} /></div>
            <strong>{teachingSessions}</strong>
            <p>Lessons scheduled across the week</p>
          </article>
        </section>

        <section className="dashboard-panel" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
          <div className="panel-heading" style={{ marginBottom: '1rem' }}>
            <div>
              <p className="eyebrow">Teaching overview</p>
              <h2>My Term Timetable</h2>
            </div>
            <span className="status-pill present">{teachingSessions} lessons</span>
          </div>

          {error && <p className="error">{error}</p>}

          {timetable.length > 0 ? (
            <div className="timetable-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              {Object.entries(timetableByDay).map(([day, entries]) => (
                <div key={day} style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '1rem',
                  minHeight: '180px'
                }}>
                  <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem', color: '#0f172a' }}>{day}</h3>
                  {entries.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {entries
                        .slice()
                        .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
                        .map((entry) => (
                          <div key={`${day}-${entry.id || entry.subject}-${entry.start_time}`} style={{
                            background: '#ffffff',
                            border: '1px solid #bae6fd',
                            borderRadius: '10px',
                            padding: '0.7rem 0.8rem'
                          }}>
                            <div style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: '700', marginBottom: '0.3rem' }}>
                              {entry.start_time || 'Time'} - {entry.end_time || 'End'}
                            </div>
                            <div style={{ fontWeight: '700', color: '#0f172a', marginBottom: '0.2rem' }}>{entry.subject_name || entry.subject || 'Subject'}</div>
                            <div style={{ fontSize: '0.82rem', color: '#475569' }}>{entry.class_name || entry.class_name_snapshot || 'Class'} </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>No lessons scheduled.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">Your timetable is not available yet for this term.</p>
          )}
        </section>

        <section className="dashboard-grid">
          <article className="dashboard-panel" style={{ padding: '2rem' }}>
            <div className="panel-heading" style={{ marginBottom: '1.5rem' }}>
              <div>
                <p className="eyebrow">Teaching overview</p>
                <h2>My Assigned Classes</h2>
              </div>
              <span className="status-pill present">{classesWithMedicalNotes} classes with notes</span>
            </div>
            {error && <p className="error">{error}</p>}
            
            {classes.length > 0 ? (
              <div className="class-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '1.5rem' }}>
                {classes.map(cls => {
                  const classStudents = students.filter((student) => String(student.class_id) === String(cls.id));
                  const medicalStudents = classStudents.filter((student) => student.allergies || student.disability);

                  return (
                    <div className="class-card" key={cls.id} style={{
                      background: '#ffffff',
                      borderRadius: '12px',
                      padding: '1.5rem',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      position: 'relative',
                      overflow: 'hidden'
                    }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '4px', backgroundColor: '#0ea5e9' }} />
                      <div style={{ paddingLeft: '0.5rem' }}>
                        <h3 style={{ fontSize: '1.25rem', color: '#0f172a', marginBottom: '0.5rem', fontWeight: '700' }}>🏫 {cls.name}</h3>
                        <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '1rem' }}>
                          {cls.description || 'No additional description provided.'}
                        </p>

                        <div style={{
                          marginBottom: '1rem',
                          padding: '0.85rem 0.9rem',
                          borderRadius: '10px',
                          background: medicalStudents.length ? '#fff7ed' : '#f8fafc',
                          border: medicalStudents.length ? '1px solid #fdba74' : '1px solid #e2e8f0',
                          boxShadow: medicalStudents.length ? 'inset 0 0 0 1px rgba(251, 146, 60, 0.05)' : 'none'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.6rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '700', color: '#7c2d12' }}>
                              <ShieldAlert size={15} /> Student support needs
                            </div>
                            {medicalStudents.length > 0 && (
                              <span style={{
                                background: '#f97316',
                                color: '#ffffff',
                                fontSize: '0.7rem',
                                fontWeight: '700',
                                padding: '0.25rem 0.55rem',
                                borderRadius: '999px',
                                letterSpacing: '0.02em'
                              }}>
                                {medicalStudents.length} alert{medicalStudents.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>

                          {medicalStudents.length ? (
                            <ul style={{ paddingLeft: '1.1rem', margin: 0, color: '#475569', fontSize: '0.85rem', lineHeight: 1.7 }}>
                              {medicalStudents.map((student) => (
                                <li key={student.id}>
                                  <strong>{student.name}</strong>
                                  {student.allergies && <> — Allergies: {student.allergies}</>}
                                  {student.disability && <> — Disability: {student.disability}</>}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div style={{ color: '#64748b', fontSize: '0.85rem' }}>No allergies or disability notes recorded for this class.</div>
                          )}
                        </div>
                      </div>

                      <div className="card-actions" style={{ display: 'flex', gap: '0.5rem', paddingLeft: '0.5rem' }}>
                        <Link to="/attendance" className="btn-small" style={{ flex: 1, textAlign: 'center', backgroundColor: '#f0f9ff', color: '#0284c7', border: '1px solid #bae6fd', fontWeight: '600', padding: '0.5rem', borderRadius: '6px', textDecoration: 'none' }}>Attendance</Link>
                        <Link to="/results" className="btn-small" style={{ flex: 1, textAlign: 'center', backgroundColor: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', fontWeight: '600', padding: '0.5rem', borderRadius: '6px', textDecoration: 'none' }}>Results</Link>
                        <Link to="/announcements" className="btn-small" style={{ flex: 1, textAlign: 'center', backgroundColor: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', fontWeight: '600', padding: '0.5rem', borderRadius: '6px', textDecoration: 'none' }}>Notify</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">You have no assigned classes yet.</p>
            )}
          </article>
        </section>
      </div>
    </div>
  );
}

export default TeacherDashboard;