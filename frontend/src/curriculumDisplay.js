export function classStageLabel(yearLevel, curriculum) {
  const year = Number(yearLevel);
  const path = String(curriculum || '').toUpperCase();
  if (path === 'GES' && year >= 7 && year <= 9) return `JHS ${year - 6}`;
  if ((path === 'PEARSON' && year >= 7 && year <= 11)
      || (path === 'COMMON' && year >= 1 && year <= 6)) {
    return `Year ${year}`;
  }
  return '';
}

export function curriculumLabel(curriculum) {
  if (curriculum === 'PEARSON') return 'Pearson';
  if (curriculum === 'COMMON') return 'Common';
  if (curriculum === 'GES') return 'GES';
  return 'Unassigned';
}
