const isValidPathway = (curriculum) => ['GES', 'PEARSON'].includes(
  String(curriculum || '').toUpperCase(),
);

const isValidPathwayStage = (yearLevel, curriculum) => {
  const year = Number(yearLevel);
  const path = String(curriculum || '').toUpperCase();
  return path === 'GES'
    ? Number.isInteger(year) && year >= 7 && year <= 9
    : path === 'PEARSON' && Number.isInteger(year) && year >= 7 && year <= 11;
};

const isInitialSelectionEligible = (student) => Number(student?.year_level) === 6
  && student?.curriculum === 'COMMON'
  && student?.class_curriculum === 'COMMON'
  && Boolean(student?.class_id);

const matchesApprovedDestination = (selection, student, targetClass) => {
  if (!selection || !student || !targetClass) return false;
  const yearLevel = selection.request_type === 'initial_selection'
    ? 7 : Number(student.year_level);
  return isValidPathwayStage(yearLevel, selection.selected_curriculum)
    && Number(targetClass.year_level) === yearLevel
    && String(targetClass.curriculum || '').toUpperCase() === selection.selected_curriculum;
};

module.exports = {
  isValidPathway,
  isValidPathwayStage,
  isInitialSelectionEligible,
  matchesApprovedDestination,
};
