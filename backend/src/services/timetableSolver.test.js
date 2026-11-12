const test = require('node:test');
const assert = require('node:assert/strict');
const { solveTimetable } = require('./timetableSolver');
const { calculateAvailableClassCapacity } = require('../controllers/timetableController');

const slot = (start, end, period_id) => ({
  day_of_week: 'Monday', start_time: start, end_time: end, period_id,
});

test('backtracks to avoid teacher and class conflicts', () => {
  const lessons = [
    { class_id: 1, subject_id: 1, teacher_id: 10, candidates: [slot('08:00', '08:40', 1), slot('08:40', '09:20', 2)] },
    { class_id: 2, subject_id: 2, teacher_id: 10, candidates: [slot('08:00', '08:40', 1)] },
  ];
  const result = solveTimetable({ lessons });
  assert.equal(result.solved, true);
  assert.equal(result.placements[0].period_id, 2);
  assert.equal(result.placements[1].period_id, 1);
});

test('a double period reserves its full continuous interval', () => {
  const lessons = [
    { class_id: 1, subject_id: 1, teacher_id: 10, period_count: 2, candidates: [slot('08:00', '09:20', 1)] },
    { class_id: 2, subject_id: 2, teacher_id: 10, candidates: [slot('08:40', '09:20', 2)] },
  ];
  const result = solveTimetable({ lessons });
  assert.equal(result.solved, false);
  assert.equal(result.unscheduled.length, 1);
});

test('room reservations prevent simultaneous room use', () => {
  const lessons = [
    { class_id: 1, subject_id: 1, teacher_id: 10, candidates: [{ ...slot('08:00', '08:40', 1), room_id: 7 }] },
    { class_id: 2, subject_id: 2, teacher_id: 11, candidates: [{ ...slot('08:00', '08:40', 1), room_id: 7 }] },
  ];
  const result = solveTimetable({ lessons });
  assert.equal(result.solved, false);
  assert.equal(result.unscheduled.length, 1);
});

test('existing lessons are fixed obstacles', () => {
  const result = solveTimetable({
    fixedLessons: [{ class_id: 1, subject_id: 9, teacher_id: 10, day_of_week: 'Monday', start_time: '08:00', end_time: '08:40' }],
    lessons: [{ class_id: 2, subject_id: 1, teacher_id: 10, candidates: [slot('08:00', '08:40', 1)] }],
  });
  assert.equal(result.solved, false);
  assert.match(result.unscheduled[0].reason, /conflict-free/);
});

test('week capacity counts all available slots across the selected days', () => {
  const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const slots = [
    { day_of_week: 'Monday', start_time: '08:00', end_time: '08:40' },
    { day_of_week: 'Monday', start_time: '08:40', end_time: '09:20' },
    { day_of_week: 'Tuesday', start_time: '08:00', end_time: '08:40' },
    { day_of_week: 'Tuesday', start_time: '08:40', end_time: '09:20' },
    { day_of_week: 'Wednesday', start_time: '08:00', end_time: '08:40' },
    { day_of_week: 'Wednesday', start_time: '08:40', end_time: '09:20' },
    { day_of_week: 'Thursday', start_time: '08:00', end_time: '08:40' },
    { day_of_week: 'Thursday', start_time: '08:40', end_time: '09:20' },
    { day_of_week: 'Friday', start_time: '08:00', end_time: '08:40' },
    { day_of_week: 'Friday', start_time: '08:40', end_time: '09:20' },
  ];

  assert.equal(calculateAvailableClassCapacity(validDays, slots), 10);
});