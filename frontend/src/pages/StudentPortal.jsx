import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import {
  BookOpen, CalendarDays, ClipboardCheck, FileText, GraduationCap, LayoutDashboard,
  LogOut, Megaphone, Bell, UserRound, LibraryBig, KeyRound, Menu, X,
} from 'lucide-react';
import api from '../api/api';
import { getNotifications, markAllNotificationsAsRead, markNotificationAsRead } from '../api/notifications';
import { changePassword } from '../api/users';

const navigation = [
  { to: '/student', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/student/profile', label: 'My Profile', icon: UserRound },
  { to: '/student/subjects', label: 'My Subjects', icon: BookOpen },
  { to: '/student/timetable', label: 'My Timetable', icon: CalendarDays },
  { to: '/student/assignments', label: 'Assignments', icon: FileText },
  { to: '/student/materials', label: 'Learning Materials', icon: LibraryBig },
  { to: '/student/results', label: 'Examination Results', icon: GraduationCap },
  { to: '/student/attendance', label: 'Attendance', icon: ClipboardCheck },
  { to: '/student/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/student/notifications', label: 'Notifications', icon: Bell },
  { to: '/student/account', label: 'Account Settings', icon: KeyRound },
];

const useResource = (path, initialValue = []) => {
  const [data, setData] = useState(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api.get(path).then((response) => {
      if (active) setData(response.data);
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || 'Unable to load this information.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [path]);
  return { data, loading, error };
};

const PageFrame = ({ eyebrow = 'Student Portal', title, description, children }) => (
  <div className="page module-page">
    <div className="module-shell">
      <section className="module-hero">
        <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p>{description}</p>}</div>
      </section>
      {children}
    </div>
  </div>
);

const StateMessage = ({ loading, error, children }) => {
  if (loading) return <p className="data-panel" role="status">Loading your information…</p>;
  if (error) return <div className="error" role="alert">{error}</div>;
  return children;
};

const Card = ({ label, value, note }) => (
  <article className="stat-card overview-stat stat-sky">
    <div className="stat-topline"><span>{label}</span></div>
    <strong>{value}</strong>
    {note && <p>{note}</p>}
  </article>
);

export function StudentPortalLayout() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const [mobileOpen, setMobileOpen] = useState(false);
  if (user?.role !== 'student') return <Navigate to="/" replace />;
  const logout = () => {
    localStorage.removeItem('sms_token');
    localStorage.removeItem('user');
    navigate('/login');
  };
  return (
    <div className="workspace-shell">
      <aside className={`app-sidebar${mobileOpen ? ' is-open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/mccarthy-hill-school.svg" alt="" />
          <div className="sidebar-brand-copy"><strong>McCarthy Hill</strong><span>Student Portal</span></div>
          <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <div className="sidebar-profile">
          <div className="sidebar-avatar">{user?.name?.slice(0, 1)?.toUpperCase() || 'S'}</div>
          <div className="sidebar-profile-copy"><strong>{user?.name || 'Student'}</strong><span>Student</span></div>
        </div>
        <nav className="sidebar-nav" aria-label="Student navigation">
          <div className="sidebar-section"><p>My School</p>
            {navigation.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} onClick={() => setMobileOpen(false)}>
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
        <button className="sidebar-link" onClick={logout} style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer' }}>
          <LogOut size={18} /><span>Log out</span>
        </button>
      </aside>
      <div className="workspace-content">
        <header className="workspace-header">
          <div className="workspace-heading">
            <button className="icon-button mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
            <div><span className="workspace-kicker">Student Portal</span><strong>Welcome, {user?.name || 'Student'}</strong></div>
          </div>
          <button className="btn-secondary" onClick={logout}><LogOut size={16} /> Log out</button>
        </header>
        <main><Outlet /></main>
      </div>
    </div>
  );
}

export function StudentDashboard() {
  const { data, loading, error } = useResource('/student-portal/dashboard', null);
  if (loading || error) return <PageFrame title="Dashboard"><StateMessage loading={loading} error={error} /></PageFrame>;
  const profile = data.profile;
  return (
    <PageFrame title={`Welcome, ${profile.name}`} description="Your personal school overview.">
      <section className="stats-grid">
        <Card label="Student ID" value={profile.student_id} note="Admission number" />
        <Card label="Class" value={profile.class_name || 'Not assigned'} note={profile.year_level ? `Year ${profile.year_level}` : ''} />
        <Card label="Curriculum" value={profile.curriculum === 'PEARSON' ? 'Pearson' : profile.curriculum || 'Unassigned'} note="Your assigned pathway" />
        <Card label="Attendance" value={`${data.attendance_percentage}%`} note="Present and late records" />
      </section>
      <section className="split-layout">
        <div className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">Academic year</p><h2>{profile.academic_year || 'Not set'} · {profile.current_term || 'No current term'}</h2></div></div>
          <p>Published timetable entries this term: <strong>{data.timetable_entries}</strong></p>
          <Link className="btn-secondary" to="/student/timetable">View my timetable</Link>
        </div>
        <div className="data-panel">
          <div className="panel-heading"><div><p className="eyebrow">Next steps</p><h2>School updates</h2></div></div>
          <p>Upcoming examinations and assignments will appear here when those school modules are configured.</p>
          <p className="teacher-badge">These sections are not yet available in the school system.</p>
        </div>
      </section>
      <section className="split-layout">
        <div className="data-panel"><div className="panel-heading"><h2>Recent results</h2></div>
          {data.recent_results.length ? data.recent_results.map((item) => <p key={`${item.subject}-${item.term}-${item.created_at}`}><strong>{item.subject}</strong> · {item.term}: {item.score}/100</p>) : <p className="empty-state">No results have been published to your portal.</p>}
        </div>
        <div className="data-panel"><div className="panel-heading"><h2>Recent announcements</h2></div>
          {data.recent_announcements.length ? data.recent_announcements.map((item) => <p key={item.id}><strong>{item.title}</strong><br />{item.message}</p>) : <p className="empty-state">No announcements for your class yet.</p>}
          <Link to="/student/announcements">All announcements</Link>
        </div>
      </section>
    </PageFrame>
  );
}

export function StudentProfile() {
  const { data, loading, error } = useResource('/student-portal/profile', null);
  return <PageFrame title="My Profile" description="Your official school information is view-only.">
    <StateMessage loading={loading} error={error}>{data && <section className="data-panel">
      <div className="sidebar-avatar" style={{ width: 64, height: 64, fontSize: 28 }}>{data.name?.slice(0, 1)?.toUpperCase()}</div>
      <div className="table-wrap"><table><tbody>
        <tr><th>Full name</th><td>{data.name}</td></tr><tr><th>Student ID</th><td>{data.student_id}</td></tr>
        <tr><th>Date of birth</th><td>{data.dob || 'Not recorded'}</td></tr><tr><th>Class / year</th><td>{data.class_name || 'Not assigned'}{data.year_level ? ` · Year ${data.year_level}` : ''}</td></tr>
        <tr><th>Curriculum</th><td>{data.curriculum === 'PEARSON' ? 'Pearson' : data.curriculum || 'Unassigned'}</td></tr>
        <tr><th>Parent / guardians</th><td>{data.guardians?.length ? data.guardians.map((guardian) => `${guardian.name}${guardian.relationship ? ` (${guardian.relationship})` : ''}${guardian.phone ? ` · ${guardian.phone}` : ''}`).join('; ') : 'Not recorded'}</td></tr>
      </tbody></table></div>
      <p>For corrections to official details, contact the school administrator.</p>
    </section>}</StateMessage>
  </PageFrame>;
}

export function StudentSubjects() {
  const { data, loading, error } = useResource('/student-portal/subjects');
  return <PageFrame title="My Subjects" description="Subjects are selected from your class curriculum only.">
    <StateMessage loading={loading} error={error}>{data.length ? <div className="class-grid">{data.map((subject) => <article className="class-card" key={subject.id}>
      <div><p className="eyebrow">{subject.curriculum === 'PEARSON' ? 'Pearson' : subject.curriculum}</p><h2>{subject.name}</h2><p>{subject.code || ''}</p>
        <p>Teachers: {subject.teachers?.length ? subject.teachers.map((teacher) => teacher.name).join(', ') : 'Not assigned for the current term'}</p>
      </div>
    </article>)}</div> : <p className="data-panel empty-state">No subjects are mapped to your class curriculum yet.</p>}</StateMessage>
  </PageFrame>;
}

export function StudentTimetable() {
  const { data, loading, error } = useResource('/student-portal/timetable');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return <PageFrame title="My Timetable" description="Published lessons for your class and current term.">
    <StateMessage loading={loading} error={error}>{data.length ? days.map((day) => {
      const entries = data.filter((entry) => entry.day_of_week === day);
      if (!entries.length) return null;
      return <section className="data-panel" key={day}><div className="panel-heading"><h2>{day}</h2></div>
        <div className="table-wrap"><table><thead><tr><th>Time</th><th>Subject</th><th>Teacher</th><th>Room</th></tr></thead><tbody>
          {entries.map((entry) => <tr key={entry.id}><td>{String(entry.start_time).slice(0, 5)}–{String(entry.end_time).slice(0, 5)}</td><td>{entry.is_break ? entry.period_name || 'Break' : entry.subject}</td><td>{entry.teacher || '—'}</td><td>{entry.room || '—'}</td></tr>)}
        </tbody></table></div>
      </section>;
    }) : <p className="data-panel empty-state">No published timetable is available for your class and current term.</p>}</StateMessage>
  </PageFrame>;
}

export function StudentResults() {
  const { data, loading, error } = useResource('/student-portal/results');
  return <PageFrame title="Examination Results" description="Only results published by authorized staff are shown.">
    <StateMessage loading={loading} error={error}>{data.length ? <>
      <style>{`@media print { .app-sidebar, .workspace-header, .student-print-button { display: none !important; } .workspace-content { margin: 0 !important; } .page { padding: 0 !important; } }`}</style>
      <button className="btn-secondary student-print-button" onClick={() => window.print()} style={{ marginBottom: '1rem' }}>Print results / Save as PDF</button>
      <div className="data-panel table-wrap"><table><thead><tr><th>Term</th><th>Subject</th><th>Class score / 50</th><th>Exam / 50</th><th>Total / 100</th><th>Class assessments</th></tr></thead><tbody>
      {data.map((result) => <tr key={result.id}><td>{result.term}</td><td>{result.subject}</td><td>{result.class_score}</td><td>{result.exam_score}</td><td><strong>{result.score}</strong></td><td>{result.class_assessments.map((mark) => `${mark.title}: ${mark.score ?? '—'}/${mark.max_score}`).join('; ') || '—'}</td></tr>)}
      </tbody></table></div>
    </> : <p className="data-panel empty-state">No results have been published to your portal.</p>}</StateMessage>
  </PageFrame>;
}

export function StudentAttendance() {
  const { data, loading, error } = useResource('/student-portal/attendance', { records: [], totals: {}, attendance_percentage: 0 });
  return <PageFrame title="My Attendance" description="Your attendance records are view-only.">
    <StateMessage loading={loading} error={error}><section className="stats-grid"><Card label="Attendance" value={`${data.attendance_percentage}%`} note="Present and late / recorded days" />
      {['present', 'late', 'absent', 'excused'].map((status) => <Card key={status} label={status[0].toUpperCase() + status.slice(1)} value={data.totals[status] || 0} />)}
    </section><div className="data-panel table-wrap"><table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>
      {data.records.map((row) => <tr key={row.id}><td>{new Date(row.date).toLocaleDateString()}</td><td>{row.status}</td></tr>)}
    </tbody></table>{!data.records.length && <p className="empty-state">No attendance records are available.</p>}</div></StateMessage>
  </PageFrame>;
}

export function StudentAnnouncements() {
  const { data, loading, error } = useResource('/student-portal/announcements');
  return <PageFrame title="Announcements" description="School-wide and class-specific messages.">
    <StateMessage loading={loading} error={error}>{data.length ? data.map((item) => <article className="data-panel" key={item.id}>
      <div className="panel-heading"><div><p className="eyebrow">{new Date(item.created_at).toLocaleString()}</p><h2>{item.title}</h2></div></div><p>{item.message}</p><small>{item.sender_name || 'School'}</small>
    </article>) : <p className="data-panel empty-state">No announcements are available.</p>}</StateMessage>
  </PageFrame>;
}

export function StudentNotifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = () => getNotifications().then((response) => setItems(response.data)).catch((requestError) => setError(requestError.response?.data?.message || 'Unable to load notifications.')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  const markRead = async (id) => {
    try { await markNotificationAsRead(id); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || 'Unable to update notification.'); }
  };
  const markAllRead = async () => {
    try { await markAllNotificationsAsRead(); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || 'Unable to update notifications.'); }
  };
  return <PageFrame title="Notifications" description="Personal notifications addressed to your account.">
    <StateMessage loading={loading} error={error}><div className="data-panel">
      <button className="btn-secondary" onClick={markAllRead}>Mark all as read</button>
      {items.length ? items.map((item) => <article key={item.id} style={{ borderBottom: '1px solid #e2e8f0', padding: '1rem 0' }}>
        <strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()}</small>
        {!item.is_read && <button className="btn-small btn-edit" onClick={() => markRead(item.id)}>Mark as read</button>}
      </article>) : <p className="empty-state">You have no notifications.</p>}
    </div></StateMessage>
  </PageFrame>;
}

export function StudentUnavailableModule({ title }) {
  return <PageFrame title={title}><section className="data-panel">
    <p>This feature is not available yet because the school system does not currently have a connected teacher assignment/resource module.</p>
    <p>No sample or placeholder records are displayed.</p>
  </section></PageFrame>;
}

export function StudentAccountSettings() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError(''); setMessage('');
    if (newPassword.length < 8) { setError('Use a password with at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('The passwords do not match.'); return; }
    setSaving(true);
    try {
      await changePassword({ newPassword });
      setNewPassword(''); setConfirmPassword('');
      setMessage('Password updated successfully.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to change password.');
    } finally { setSaving(false); }
  };
  return <PageFrame title="Account Settings" description="Keep your portal password private.">
    <form className="data-panel form-panel" onSubmit={submit}>
      {error && <div className="error" role="alert">{error}</div>}
      {message && <div role="status" className="teacher-badge">{message}</div>}
      <label htmlFor="student-new-password">New password</label><input id="student-new-password" type="password" autoComplete="new-password" minLength="8" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
      <label htmlFor="student-confirm-password">Confirm new password</label><input id="student-confirm-password" type="password" autoComplete="new-password" minLength="8" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
      <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Change password'}</button>
    </form>
  </PageFrame>;
}
