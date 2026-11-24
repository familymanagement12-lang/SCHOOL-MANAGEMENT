const CURRICULA = Object.freeze(['COMMON', 'GES', 'PEARSON']);
const PATHWAY_CHOICES = Object.freeze([
  Object.freeze({ curriculum: 'GES', label: 'GES - JHS 1 to JHS 3', firstYearLevel: 7, lastYearLevel: 9 }),
  Object.freeze({ curriculum: 'PEARSON', label: 'Pearson - Year 7 to Year 11', firstYearLevel: 7, lastYearLevel: 11 }),
]);

function curriculumForYearLevel(yearLevel, requestedCurriculum) {
  const year = Number(yearLevel);
  const requested = requestedCurriculum ? String(requestedCurriculum).toUpperCase() : null;

  if (!Number.isInteger(year) || year < 1 || year > 11) {
    throw new Error('Year level must be between 1 and 11.');
  }
  if (requested && !CURRICULA.includes(requested)) {
    throw new Error('Select Common, GES, or Pearson curriculum.');
  }
  if (year <= 6) {
    if (requested && requested !== 'COMMON') throw new Error('Years 1–6 use the common school curriculum.');
    return 'COMMON';
  }
  if (year <= 9) {
    if (!['GES', 'PEARSON'].includes(requested)) {
      throw new Error('Years 7–9 require either GES or Pearson curriculum.');
    }
    return requested;
  }
  if (requested === 'GES' || requested === 'COMMON') {
    throw new Error('Years 10–11 use Pearson curriculum only.');
  }
  return 'PEARSON';
}

function classStageLabel(yearLevel, curriculum) {
  const year = Number(yearLevel);
  const path = String(curriculum || '').toUpperCase();
  if (path === 'GES' && year >= 7 && year <= 9) return `JHS ${year - 6}`;
  if ((path === 'PEARSON' && year >= 7 && year <= 11)
      || (path === 'COMMON' && year >= 1 && year <= 6)) {
    return `Year ${year}`;
  }
  return null;
}

function canonicalClassName(name, yearLevel, curriculum) {
  const value = typeof name === 'string' ? name.trim() : '';
  const path = String(curriculum || '').toUpperCase();
  const stage = classStageLabel(yearLevel, path);
  if (!stage || !['GES', 'PEARSON'].includes(path)) return value;

  const section = value.replace(/^(?:JHS\s*[1-3]|Year\s*\d+)\s*(?:[-:]\s*)?/i, '').trim();
  return section ? `${stage} - ${section}` : stage;
}

function nextClassStages(yearLevel, curriculum) {
  const year = Number(yearLevel);
  const path = String(curriculum || '').toUpperCase();
  if (!Number.isInteger(year)) return [];
  if (path === 'COMMON' && year >= 1 && year < 6) {
    return [{ year_level: year + 1, curriculum: 'COMMON' }];
  }
  if (path === 'COMMON' && year === 6) {
    return PATHWAY_CHOICES.map(({ curriculum }) => ({ year_level: 7, curriculum }));
  }
  if (path === 'GES' && year >= 7 && year < 9) {
    return [{ year_level: year + 1, curriculum: 'GES' }];
  }
  if (path === 'PEARSON' && year >= 7 && year < 11) {
    return [{ year_level: year + 1, curriculum: 'PEARSON' }];
  }
  return [];
}

function isNextClassStage(source, target) {
  return nextClassStages(source.year_level, source.curriculum).some(
    (stage) => stage.year_level === Number(target.year_level)
      && stage.curriculum === String(target.curriculum || '').toUpperCase(),
  );
}

function pathwayProgression(curriculum) {
  const path = String(curriculum || '').toUpperCase();
  const choice = PATHWAY_CHOICES.find((item) => item.curriculum === path);
  if (!choice) return [];
  return [
    { year_level: 6, curriculum: 'COMMON', label: 'Year 6' },
    ...Array.from({ length: choice.lastYearLevel - choice.firstYearLevel + 1 }, (_value, index) => {
      const yearLevel = choice.firstYearLevel + index;
      return { year_level: yearLevel, curriculum: path, label: classStageLabel(yearLevel, path) };
    }),
  ];
}

module.exports = {
  CURRICULA,
  PATHWAY_CHOICES,
  curriculumForYearLevel,
  classStageLabel,
  canonicalClassName,
  nextClassStages,
  isNextClassStage,
  pathwayProgression,
};
