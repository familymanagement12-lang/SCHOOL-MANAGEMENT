import api from './api';

export const getResultsByStudent = (studentId) => api.get(`/results/${studentId}`);
export const recordResult = (data) => api.post('/results', data);
export const setResultPublication = (data) => api.put('/results/publish', data);
export const getClassAssessments = (params) => api.get('/results/assessments', { params });
export const createClassAssessment = (data) => api.post('/results/assessments', data);
export const saveClassAssessmentScores = (assessmentId, scores) => api.put(`/results/assessments/${assessmentId}/scores`, { scores });

export const getReportCard = (studentId, term) => {
  return api.get(`/results/${studentId}/report?term=${term}`);
};