import api from './api';

export const getLearningMaterialMeta = (termId) => api.get('/learning-materials/meta', {
  params: termId ? { term_id: termId } : {},
});
export const getLearningMaterials = (termId) => api.get('/learning-materials', {
  params: termId ? { term_id: termId } : {},
});
export const createLearningMaterial = (data) => api.post('/learning-materials', data);
export const downloadLearningMaterial = (id,fileId) => api.get(
  `/learning-materials/${id}/files/${fileId}`, { responseType: 'blob' }
);
export const getStudentLearningMaterials = () => api.get('/student-portal/materials');
export const downloadStudentLearningMaterial = (id,fileId) => api.get(
  `/student-portal/materials/${id}/files/${fileId}`, { responseType: 'blob' }
);
