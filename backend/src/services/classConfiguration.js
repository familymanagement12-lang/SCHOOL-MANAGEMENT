const { CURRICULA, curriculumForYearLevel } = require('./curriculumPolicy');

const EDUCATION_STAGES = Object.freeze(['EARLY_YEARS', 'PRIMARY', 'JHS', 'OTHER', 'UNASSIGNED']);
const TEACHING_MODELS = Object.freeze(['class_teacher', 'subject_teacher']);

const classConfigurationChanged = (current, next) => {
  const previous = {
    name: current.name ?? null,
    description: current.description ?? null,
    educationStage: current.education_stage || 'UNASSIGNED',
    yearLevel: current.year_level === null || current.year_level === undefined
      ? null : Number(current.year_level),
    curriculum: current.curriculum || 'UNASSIGNED',
    teachingModel: current.teaching_model || null,
    programme: current.programme || null,
    classTeacherId: current.class_teacher_id ?? current.teacher_id ?? null,
  };
  const updated = {
    name: next.name ?? null,
    description: next.description ?? null,
    educationStage: next.educationStage,
    yearLevel: next.yearLevel,
    curriculum: next.classCurriculum,
    teachingModel: next.teachingModel,
    programme: next.programme,
    classTeacherId: next.classTeacherId,
  };
  return Object.keys(previous).some((key) => previous[key] !== updated[key]);
};

const classSubjectConfigurationChanged = (current, next) => (
  (current.education_stage || 'UNASSIGNED') !== next.educationStage
  || (current.curriculum || 'UNASSIGNED') !== next.classCurriculum
  || (current.year_level === null || current.year_level === undefined
    ? null : Number(current.year_level)) !== next.yearLevel
);

const normalizeClassConfiguration = ({
  year_level,
  teaching_model,
  curriculum,
  education_stage,
  programme,
  class_teacher_id,
}, { isNew = false, existing = null } = {}) => {
  let yearLevel = null;
  if (year_level !== undefined && year_level !== null && year_level !== '') {
    yearLevel = Number(year_level);
    if (!Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 11) {
      throw new Error('Year level must be between 1 and 11.');
    }
  }

  const educationStage = String(education_stage || existing?.education_stage || 'UNASSIGNED').toUpperCase();
  if (!EDUCATION_STAGES.includes(educationStage)) {
    throw new Error('Select Early Years, Primary, JHS, Other, or leave the education stage unassigned.');
  }

  const existingUnclassifiedLevel = !isNew
    && educationStage === 'UNASSIGNED'
    && existing?.education_stage === 'UNASSIGNED'
    && yearLevel !== null
    && Number(existing.year_level) === yearLevel;
  if (educationStage === 'UNASSIGNED' && yearLevel !== null && !existingUnclassifiedLevel) {
    throw new Error('Confirm the education stage before assigning a numeric year level.');
  }
  if (educationStage === 'PRIMARY' && (yearLevel === null || yearLevel < 1 || yearLevel > 6)) {
    throw new Error('Primary classes require a confirmed year level from 1 to 6.');
  }
  if (educationStage === 'JHS' && (yearLevel === null || yearLevel < 7 || yearLevel > 9)) {
    throw new Error('JHS classes require a confirmed level from 7 to 9.');
  }
  if (educationStage === 'EARLY_YEARS' && yearLevel !== null) {
    throw new Error('Early Years classes do not use a numeric year level.');
  }

  const classCurriculum = curriculumForYearLevel(
    yearLevel,
    curriculum === undefined ? existing?.curriculum : curriculum
  );
  const normalizedProgramme = typeof programme === 'string' ? programme.trim() : '';
  if (educationStage === 'OTHER' && !normalizedProgramme) {
    throw new Error('Enter the programme name for an Other school programme.');
  }

  const teachingModel = teaching_model === undefined ? (existing?.teaching_model || null) : (teaching_model || null);
  if (teachingModel && !TEACHING_MODELS.includes(teachingModel)) {
    throw new Error('Teaching model must be class_teacher or subject_teacher.');
  }
  if (educationStage !== 'UNASSIGNED' && !teachingModel) {
    throw new Error('Select a teaching model for the classified class.');
  }
  if (educationStage === 'PRIMARY' && yearLevel <= 3 && teachingModel !== 'class_teacher') {
    throw new Error('Primary years 1 to 3 use the class-teacher teaching model.');
  }
  if (educationStage === 'JHS' && teachingModel !== 'subject_teacher') {
    throw new Error('JHS classes use the subject-teacher teaching model.');
  }
  const hasClassTeacher = class_teacher_id === undefined
    ? Boolean(existing?.class_teacher_id || existing?.teacher_id)
    : Boolean(class_teacher_id);
  if (educationStage === 'PRIMARY' && !hasClassTeacher) {
    throw new Error('Assign a class teacher to every Primary class.');
  }

  return {
    yearLevel,
    teachingModel,
    classCurriculum,
    educationStage,
    programme: normalizedProgramme || null,
  };
};

module.exports = {
  EDUCATION_STAGES,
  classConfigurationChanged,
  classSubjectConfigurationChanged,
  normalizeClassConfiguration,
};
