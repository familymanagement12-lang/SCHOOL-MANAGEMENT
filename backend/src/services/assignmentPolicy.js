const CATEGORIES = new Set([
  'homework', 'classwork', 'project', 'research', 'practical', 'revision', 'test', 'other',
]);
const SUBMISSION_METHODS = new Set(['online', 'file', 'both']);
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

const isValidSchoolDateTime = (value) => {
  if (typeof value !== 'string' || !LOCAL_DATE_TIME.test(value)) return false;
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, seconds = '0'] = time.split(':');
  const parsedHour = Number(hour), parsedMinute = Number(minute), parsedSecond = Number(seconds);
  const parsed = new Date(Date.UTC(year, month - 1, day, parsedHour, parsedMinute, parsedSecond));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    && parsedHour < 24 && parsedMinute < 60 && parsedSecond < 60;
};

const validateAssignmentInput = (input = {}) => {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : '';
  const category = String(input.category || '').toLowerCase();
  const submissionMethod = input.submission_method;
  const totalMarks = Number(input.total_marks);
  const selectedStudentIds = input.selected_student_ids;

  if (!title || title.length > 200) return { error: 'Enter an assignment title of up to 200 characters.' };
  if (!instructions) return { error: 'Assignment instructions are required.' };
  if (!CATEGORIES.has(category)) return { error: 'Choose a supported assignment category.' };
  if (!SUBMISSION_METHODS.has(submissionMethod)) return { error: 'Choose online answer, file upload, or both.' };
  if (!Number.isFinite(totalMarks) || totalMarks <= 0 || totalMarks > 100000) {
    return { error: 'Total marks must be greater than zero and no more than 100,000.' };
  }
  if (!isValidSchoolDateTime(input.due_at)) return { error: 'Enter a valid due date and time.' };
  if (input.issue_at && !isValidSchoolDateTime(input.issue_at)) return { error: 'Enter a valid issue date and time.' };
  if (selectedStudentIds !== undefined && selectedStudentIds !== null) {
    if (!Array.isArray(selectedStudentIds) || selectedStudentIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
      return { error: 'Choose valid students from the selected class.' };
    }
    if (new Set(selectedStudentIds.map(Number)).size !== selectedStudentIds.length) {
      return { error: 'A student cannot be selected more than once.' };
    }
  }
  if (typeof input.allow_late !== 'undefined' && typeof input.allow_late !== 'boolean') {
    return { error: 'Late submission setting must be true or false.' };
  }
  if (typeof input.allow_resubmission !== 'undefined' && typeof input.allow_resubmission !== 'boolean') {
    return { error: 'Resubmission setting must be true or false.' };
  }
  return {
    value: {
      title,
      instructions,
      category,
      submission_method: submissionMethod,
      total_marks: totalMarks,
      due_at: input.due_at,
      issue_at: input.issue_at || null,
      allow_late: input.allow_late === true,
      allow_resubmission: input.allow_resubmission === true,
      selected_student_ids: selectedStudentIds == null ? null : selectedStudentIds.map(Number),
    },
  };
};

const canSubmit = ({ dueAt, allowLate, now = new Date() }) => (
  new Date(dueAt).getTime() >= now.getTime() || allowLate === true
);

module.exports = {
  CATEGORIES,
  SUBMISSION_METHODS,
  isValidSchoolDateTime,
  validateAssignmentInput,
  canSubmit,
};
