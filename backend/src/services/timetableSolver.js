const timeToMinutes = (value) => {
  const [hours, minutes] = String(value || '').slice(0, 5).split(':').map(Number);
  return (hours * 60) + minutes;
};

const overlaps = (left, right) => (
  left.day_of_week === right.day_of_week
  && timeToMinutes(left.start_time) < timeToMinutes(right.end_time)
  && timeToMinutes(left.end_time) > timeToMinutes(right.start_time)
);

const conflictsWith = (candidate, lesson, scheduled, workloadLimits) => {
  const overlapConflict = scheduled.some((other) => (
    overlaps(candidate, other)
    && (
      String(candidate.class_id) === String(other.class_id)
      || (candidate.teacher_id && String(candidate.teacher_id) === String(other.teacher_id))
      || (candidate.room_id && String(candidate.room_id) === String(other.room_id))
    )
  ));
  if (overlapConflict) return true;
  const limit = workloadLimits[String(candidate.teacher_id)];
  if (!limit) return false;
  const used = scheduled
    .filter((item) => String(item.teacher_id) === String(candidate.teacher_id))
    .reduce((sum, item) => sum + Number(item.period_count || 1), 0);
  return used + Number(lesson.period_count || 1) > Number(limit);
};

const candidatePenalty = (candidate, lesson, scheduled) => {
  let score = 0;
  const subjectSlots = scheduled.filter((item) => (
    String(item.class_id) === String(lesson.class_id)
    && String(item.subject_id) === String(lesson.subject_id)
    && item.day_of_week === candidate.day_of_week
  ));
  score += subjectSlots.length * 8;

  if (lesson.teacher_id) {
    const teacherSlots = scheduled
      .filter((item) => String(item.teacher_id) === String(lesson.teacher_id) && item.day_of_week === candidate.day_of_week)
      .sort((left, right) => timeToMinutes(left.start_time) - timeToMinutes(right.start_time));
    const start = timeToMinutes(candidate.start_time);
    const end = timeToMinutes(candidate.end_time);
    const before = teacherSlots.filter((item) => timeToMinutes(item.end_time) <= start).at(-1);
    const after = teacherSlots.find((item) => timeToMinutes(item.start_time) >= end);
    if (before && after && timeToMinutes(after.start_time) > timeToMinutes(before.end_time)) score += 5;
    const adjacent = [...teacherSlots, candidate].sort((left, right) => timeToMinutes(left.start_time) - timeToMinutes(right.start_time));
    let runLength = 1;
    for (let index = 1; index < adjacent.length; index += 1) {
      if (timeToMinutes(adjacent[index - 1].end_time) === timeToMinutes(adjacent[index].start_time)) runLength += 1;
      else runLength = 1;
      if (runLength > 3) score += 3;
    }
  }
  return score;
};

function solveTimetable({ lessons, fixedLessons = [], workloadLimits = {}, maxNodes = 100000 }) {
  const scheduled = fixedLessons.map((lesson) => ({ ...lesson }));
  const ordered = lessons
    .map((lesson, index) => ({ ...lesson, _index: index, candidates: lesson.candidates || [] }))
    .sort((left, right) => (
      left.candidates.length - right.candidates.length
      || Number(right.period_count || 1) - Number(left.period_count || 1)
      || String(left.class_id).localeCompare(String(right.class_id))
    ));
  const placements = new Map();
  let bestPlacements = new Map();
  let visited = 0;
  let deepest = 0;

  const search = (position) => {
    if (position >= ordered.length) return true;
    if (visited >= maxNodes) return false;
    const lesson = ordered[position];
    const legalCandidates = lesson.candidates
      .map((candidate) => ({ ...lesson, ...candidate }))
      .filter((candidate) => !conflictsWith(candidate, lesson, scheduled, workloadLimits))
      .sort((left, right) => candidatePenalty(left, lesson, scheduled) - candidatePenalty(right, lesson, scheduled));
    deepest = Math.max(deepest, position);

    for (const candidate of legalCandidates) {
      visited += 1;
      const placement = {
        ...lesson,
        ...candidate,
        period_count: Number(lesson.period_count || 1),
      };
      scheduled.push(placement);
      placements.set(lesson._index, placement);
      if (placements.size > bestPlacements.size) bestPlacements = new Map(placements);
      if (search(position + 1)) return true;
      scheduled.pop();
      placements.delete(lesson._index);
      if (visited >= maxNodes) break;
    }
    return false;
  };

  const solved = search(0);
  const finalPlacements = solved ? placements : bestPlacements;
  const result = lessons.map((lesson, index) => finalPlacements.get(index) || null);
  const missing = lessons.filter((lesson, index) => !result[index]).map((lesson) => ({
    class_id: lesson.class_id,
    subject_id: lesson.subject_id,
    teacher_id: lesson.teacher_id,
    period_count: lesson.period_count || 1,
    reason: lesson.candidates?.length
      ? (visited >= maxNodes ? 'Search limit reached before a complete conflict-free timetable was found.' : 'No conflict-free combination remains for this lesson.')
      : (lesson.reason || 'No legal period is available for this lesson.'),
  }));

  return { solved, placements: result, unscheduled: missing, visited_nodes: visited, deepest_position: deepest };
}

module.exports = { solveTimetable, overlaps, timeToMinutes };