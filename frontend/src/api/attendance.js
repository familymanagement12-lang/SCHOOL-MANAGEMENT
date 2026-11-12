import api from './api';

export const recordAttendance = (data) => api.post('/attendance', data);
export const getAttendanceByClass = (classId) => api.get(`/attendance/${classId}`);
export const getAttendanceByStudent = (studentId) => api.get(`/attendance/student/${studentId}`);
