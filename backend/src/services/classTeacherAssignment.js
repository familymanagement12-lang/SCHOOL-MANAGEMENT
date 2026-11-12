const normalizeClassTeacherAssignment = (value) => {
  if (value === undefined) return { provided: false, teacherId: null };
  if (value === null || value === '') return { provided: true, teacherId: null };

  const teacherId = Number(value);
  if (!Number.isInteger(teacherId) || teacherId <= 0) {
    throw new Error('Select an active teacher from this school or leave the class unassigned.');
  }

  return { provided: true, teacherId };
};

module.exports = { normalizeClassTeacherAssignment };
