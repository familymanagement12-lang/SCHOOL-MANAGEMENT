const { CURRICULA, curriculumForYearLevel } = require('./curriculumPolicy');

const normalizeClassConfiguration = ({ year_level, teaching_model, curriculum }, { isNew = false } = {}) => {
  let yearLevel = null;
  if (year_level !== undefined && year_level !== null && year_level !== '') {
    yearLevel = Number(year_level);
    if (!Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 11) {
      throw new Error('Year level must be between 1 and 11.');
    }
  }

  let classCurriculum = null;
  if (yearLevel !== null) {
    classCurriculum = curriculumForYearLevel(yearLevel, curriculum);
  } else if (curriculum !== undefined && curriculum !== null && curriculum !== '') {
    const requestedCurriculum = String(curriculum).toUpperCase();
    if (![...CURRICULA, 'UNASSIGNED'].includes(requestedCurriculum)) {
      throw new Error('Select Common, GES, Pearson, or leave curriculum unassigned.');
    }
    classCurriculum = requestedCurriculum;
  } else if (isNew) {
    classCurriculum = 'UNASSIGNED';
  }

  const teachingModel = teaching_model || (isNew ? 'class_teacher' : null);
  if (teachingModel && !['class_teacher', 'subject_teacher'].includes(teachingModel)) {
    throw new Error('Teaching model must be class_teacher or subject_teacher.');
  }

  return { yearLevel, teachingModel, classCurriculum };
};

module.exports = { normalizeClassConfiguration };
