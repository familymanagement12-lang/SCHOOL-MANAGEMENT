import api from './api';

export const getSubjects = () => api.get('/subjects');
export const createSubject = (data) => api.post('/subjects', data);
export const updateSubject = (id, data) => api.put(`/subjects/${id}`, data);
export const deleteSubject = (id) => api.delete(`/subjects/${id}`);
export const getSubjectClassAssignments = () => api.get('/subjects/class-assignments');
export const upsertSubjectClassAssignment = (data) => api.post('/subjects/class-assignments', data);
export const getSubjectSchedulingPreferences = () => api.get('/subjects/scheduling-preferences');
export const upsertSubjectSchedulingPreference = (data) => api.post('/subjects/scheduling-preferences', data);