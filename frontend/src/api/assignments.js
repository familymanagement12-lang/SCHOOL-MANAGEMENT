import api from './api';

export const getAssignmentMeta = (termId) => api.get('/assignments/meta', { params: termId ? { term_id: termId } : {} });
export const getAssignments = (termId) => api.get('/assignments', { params: termId ? { term_id: termId } : {} });
export const createAssignment = (data) => api.post('/assignments', data);
export const updateAssignment = (id, data) => api.put(`/assignments/${id}`, data);
export const publishAssignment = (id) => api.post(`/assignments/${id}/publish`);
export const getAssignmentSubmissions = (id) => api.get(`/assignments/${id}/submissions`);
export const markAssignmentSubmission = (assignmentId, submissionId, data) => (
  api.put(`/assignments/${assignmentId}/submissions/${submissionId}/mark`, data)
);
export const uploadAssignmentFiles = (assignmentId, files) => {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append('files', file));
  return api.post(`/assignments/${assignmentId}/attachments`, formData);
};
export const getStudentAssignments = () => api.get('/student-portal/assignments');
export const getStudentAssignment = (id) => api.get(`/student-portal/assignments/${id}`);
export const saveStudentAssignmentDraft = (id, answer) => api.put(`/student-portal/assignments/${id}/draft`, { answer });
export const uploadStudentAssignmentFiles = (id, files) => {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append('files', file));
  return api.post(`/student-portal/assignments/${id}/files`, formData);
};
export const submitStudentAssignment = (id, answer) => api.post(`/student-portal/assignments/${id}/submit`, { answer });
export const downloadAssignmentFile = (url) => api.get(url, { responseType: 'blob' });
