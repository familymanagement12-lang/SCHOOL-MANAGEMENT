import { useEffect, useMemo, useState } from 'react';
import { getAttendanceByClass, getStaffAttendance, recordAttendance, recordStaffAttendance } from '../api/attendance';
import { getClasses } from '../api/classes';
import { getStudents } from '../api/students';

const getToday = () => new Date().toISOString().split('T')[0];

const ATTENDANCE_STATUSES = [
  { id: 'present', label: 'Present', color: '#32805b', mark: 'P' },
  { id: 'absent', label: 'Absent', color: '#b94d42', mark: 'A' },
  { id: 'late', label: 'Late', color: '#ae7a22', mark: 'L' },
  { id: 'excused', label: 'Excused', color: '#4776a5', mark: 'E' },
];

const getStatusTheme = (statusId) => ATTENDANCE_STATUSES.find((status) => status.id === statusId)
  || { color: '#64748b', mark: '?', label: 'Unknown' };

function Attendance() {
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [formData, setFormData] = useState({ student_id: '', date: getToday(), status: 'present' });
  const [view, setView] = useState('students');
  const [staffDate, setStaffDate] = useState(getToday());
  const [staffRecords, setStaffRecords] = useState([]);
  const [savingStaff, setSavingStaff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  })();

  useEffect(() => {
    fetchSetupData();
  }, []);

  useEffect(() => {
    if (selectedClass) fetchAttendance(selectedClass);
    else setRecords([]);
  }, [selectedClass]);

  useEffect(() => {
    if (view === 'staff' && user?.role === 'admin') fetchStaffAttendance(staffDate);
  }, [view, staffDate]);

  const fetchSetupData = async () => {
    try {
      const [classesResponse, studentsResponse] = await Promise.all([getClasses(), getStudents()]);
      setClasses(classesResponse.data);
      setStudents(studentsResponse.data);
      setSelectedClass(classesResponse.data[0]?.id ? String(classesResponse.data[0].id) : '');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load attendance data');
    } finally {
      setLoading(false);
    }
  };

  const fetchAttendance = async (classId) => {
    try {
      const response = await getAttendanceByClass(classId);
      setRecords(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load attendance records');
    }
  };

  const fetchStaffAttendance = async (date) => {
    setError('');
    try {
      const response = await getStaffAttendance(date);
      setStaffRecords(response.data.map((record) => ({ ...record, status: record.status || '', reason: record.reason || '' })));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load staff attendance');
    }
  };

  const classStudents = useMemo(
    () => students.filter((student) => String(student.class_id || '') === selectedClass),
    [students, selectedClass]
  );
  const selectedClassName = classes.find((classItem) => String(classItem.id) === selectedClass)?.name;

  const statusTotals = records.reduce((totals, record) => {
    totals[record.status] = (totals[record.status] || 0) + 1;
    return totals;
  }, ATTENDANCE_STATUSES.reduce((acc, status) => ({ ...acc, [status.id]: 0 }), {}));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    try {
      await recordAttendance(formData);
      await fetchAttendance(selectedClass);
      setFormData({ student_id: '', date: formData.date, status: 'present' });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record attendance');
    }
  };

  const handleStaffSubmit = async (event) => {
    event.preventDefault();
    setError('');
    const recordsToSave = staffRecords.filter((record) => record.status).map((record) => ({
      employee_id: record.employee_id,
      status: record.status,
      reason: record.reason,
    }));
    if (!recordsToSave.length) {
      setError('Choose an attendance status for at least one staff member.');
      return;
    }
    if (recordsToSave.some((record) => record.status === 'absent' && !record.reason.trim())) {
      setError('Enter a reason for each staff member marked absent.');
      return;
    }
    setSavingStaff(true);
    try {
      await recordStaffAttendance({ date: staffDate, records: recordsToSave });
      await fetchStaffAttendance(staffDate);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save staff attendance');
    } finally {
      setSavingStaff(false);
    }
  };

  if (loading) return <div className="page"><p>Loading attendance...</p></div>;

  return (
    <div className="page module-page attendance-page">
      <div className="module-shell">
        <section className="module-hero attendance-hero">
          <div>
            <p className="eyebrow">Daily register</p>
            <h1>Attendance</h1>
            <p>Record and review student attendance{user?.role === 'admin' ? ' and staff attendance' : ''}.</p>
          </div>
        </section>

        {user?.role === 'admin' && <div className="inventory-actions" role="tablist" aria-label="Attendance type">
          <button type="button" className={view === 'students' ? 'btn-primary' : 'btn-secondary'} role="tab" aria-selected={view === 'students'} onClick={() => setView('students')}>Student attendance</button>
          <button type="button" className={view === 'staff' ? 'btn-primary' : 'btn-secondary'} role="tab" aria-selected={view === 'staff'} onClick={() => setView('staff')}>Staff attendance</button>
        </div>}

        {view === 'staff' && user?.role === 'admin' ? (
          <section className="data-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Daily staff register</p><h2>Staff attendance and absence reasons</h2></div>
              <label htmlFor="staff-attendance-date">Attendance date<input id="staff-attendance-date" type="date" value={staffDate} onChange={(event) => setStaffDate(event.target.value)} /></label>
            </div>
            {error && <div className="error attendance-alert" role="alert">{error}</div>}
            <form onSubmit={handleStaffSubmit}>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Staff member</th><th>Position</th><th>Status</th><th>Reason for absence</th></tr></thead>
                  <tbody>{staffRecords.map((record) => <tr key={record.employee_id}>
                    <td>{record.full_name}</td>
                    <td>{record.staff_role}</td>
                    <td><select aria-label={`Attendance status for ${record.full_name}`} value={record.status} onChange={(event) => setStaffRecords((previous) => previous.map((entry) => entry.employee_id === record.employee_id ? { ...entry, status: event.target.value, reason: event.target.value === 'absent' ? entry.reason : '' } : entry))}>
                      <option value="">Not marked</option>{ATTENDANCE_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
                    </select></td>
                    <td><input aria-label={`Absence reason for ${record.full_name}`} value={record.reason} onChange={(event) => setStaffRecords((previous) => previous.map((entry) => entry.employee_id === record.employee_id ? { ...entry, reason: event.target.value } : entry))} placeholder={record.status === 'absent' ? 'Required for absent staff' : 'Optional note'} required={record.status === 'absent'} maxLength={500} /></td>
                  </tr>)}</tbody>
                </table>
              </div>
              {!staffRecords.length && <div className="empty-state">No staff members are available for this date.</div>}
              <button className="btn-primary attendance-submit" type="submit" disabled={!staffRecords.length || savingStaff}>{savingStaff ? 'Saving…' : 'Save staff attendance'}</button>
            </form>
          </section>
        ) : <>
        <section className="data-panel attendance-class-panel">
          <div className="attendance-class-heading">
            <label htmlFor="attendance-class">Selected class</label>
            <strong aria-live="polite">{selectedClassName || (classes.length ? 'Choose a class' : 'No classes available')}</strong>
          </div>
          <select id="attendance-class" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)} disabled={!classes.length}>
            <option value="">{classes.length ? 'Choose a class' : 'No classes available'}</option>
            {classes.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
          </select>
          <span className="attendance-class-note">{classes.length ? 'Change class' : 'No classes are assigned to this account.'}</span>
        </section>

        {error && <div className="error attendance-alert" role="alert">{error}</div>}

        <section className="module-stats attendance-stats" aria-label="Attendance totals">
          {ATTENDANCE_STATUSES.map((status) => (
            <article className="mini-stat attendance-stat" key={status.id} style={{ '--attendance-color': status.color }}>
              <span>{status.label}</span>
              <strong>{statusTotals[status.id]}</strong>
            </article>
          ))}
        </section>

        <section className="split-layout attendance-layout">
          <form className="data-panel form-panel attendance-form" onSubmit={handleSubmit}>
            <div className="panel-heading">
              <div><p className="eyebrow">Daily register</p><h2>Mark attendance</h2></div>
            </div>

            <label htmlFor="attendance-student">Student</label>
            <select
              id="attendance-student"
              value={formData.student_id}
              onChange={(event) => setFormData({ ...formData, student_id: event.target.value })}
              required
              disabled={!selectedClass}
            >
              <option value="">Select student</option>
              {classStudents.map((student) => (
                <option key={student.id} value={student.id}>{student.student_id} · {student.name}</option>
              ))}
            </select>

            <label htmlFor="attendance-date">Date</label>
            <input id="attendance-date" type="date" value={formData.date} readOnly required />

            <fieldset className="attendance-status-field">
              <legend>Status</legend>
              <div className="attendance-status-options">
                {ATTENDANCE_STATUSES.map((status) => (
                  <button
                    key={status.id}
                    type="button"
                    className={formData.status === status.id ? 'selected' : ''}
                    style={{ '--attendance-color': status.color }}
                    aria-pressed={formData.status === status.id}
                    onClick={() => setFormData({ ...formData, status: status.id })}
                  >
                    <span aria-hidden="true">{status.mark}</span>{status.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <button className="btn-primary attendance-submit" type="submit" disabled={!selectedClass || !classStudents.length}>
              Save attendance
            </button>
          </form>

          <section className="data-panel attendance-records">
            <div className="panel-heading">
              <div><p className="eyebrow">Class register</p><h2>Recent records</h2></div>
              <span className="attendance-record-count">{records.length} records</span>
            </div>

            {records.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Student</th><th>Date</th><th>Status</th></tr></thead>
                  <tbody>
                    {records.map((record) => {
                      const theme = getStatusTheme(record.status);
                      return (
                        <tr key={record.id}>
                          <td>{record.student_name}</td>
                          <td>{record.date}</td>
                          <td>
                            <span className="attendance-status-badge" style={{ '--attendance-color': theme.color }}>
                              <span aria-hidden="true">{theme.mark}</span>{theme.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state attendance-empty">No attendance records for this class yet.</div>
            )}
          </section>
        </section>
        </>}
      </div>
    </div>
  );
}

export default Attendance;
