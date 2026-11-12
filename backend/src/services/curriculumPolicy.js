const CURRICULA = Object.freeze(['COMMON', 'GES', 'PEARSON']);

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

module.exports = { CURRICULA, curriculumForYearLevel };
