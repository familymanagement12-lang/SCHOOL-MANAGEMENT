export function classStageLabel(yearLevel, curriculum, educationStage = 'UNASSIGNED') {
  const year = Number(yearLevel);
  const path = String(curriculum || '').toUpperCase();
  const stage = String(educationStage || 'UNASSIGNED').toUpperCase();
  if (stage === 'JHS' && path === 'GES' && year >= 7 && year <= 9) return `JHS ${year - 6}`;
  if (stage === 'PRIMARY' && path === 'COMMON' && year >= 1 && year <= 6) return `Year ${year}`;
  return '';
}

export function curriculumLabel(curriculum) {
  if (curriculum === 'PEARSON') return 'Pearson';
  if (curriculum === 'COMMON') return 'Common';
  if (curriculum === 'GES') return 'GES';
  return 'Unassigned';
}
