import api from './api';

export const getParentCurriculumSelections = () => api.get('/curriculum-selections/parent');
export const submitParentCurriculumSelection = (studentId, data) => (
  api.post(`/curriculum-selections/parent/children/${studentId}`, data)
);
export const requestParentCurriculumChange = (studentId, data) => (
  api.post(`/curriculum-selections/parent/children/${studentId}/change`, data)
);
export const getAdminCurriculumSelections = (academicYear) => api.get('/curriculum-selections/admin', {
  params: academicYear ? { academic_year: academicYear } : {},
});
export const saveAdminCurriculumSelectionPeriod = (data) => (
  api.put('/curriculum-selections/admin/period', data)
);
export const decideAdminCurriculumSelection = (selectionId, data) => (
  api.post(`/curriculum-selections/admin/${selectionId}/decision`, data)
);
export const assignAdminCurriculumClass = (selectionId, classId) => (
  api.post(`/curriculum-selections/admin/${selectionId}/assign`, { class_id: classId })
);
