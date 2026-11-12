import api from './api';

export const recordAttendance = (data) => api.post('/attendance', data);
export const getAttendanceByClass = (classId) => api.get(`/attendance/${classId}`);
export const getAttendanceByStudent = (studentId) => api.get(`/attendance/student/${studentId}`);
export const getStaffAttendance = (date) => api.get('/attendance/staff', { params: { date } });
export const recordStaffAttendance = (data) => api.post('/attendance/staff/bulk', data);
