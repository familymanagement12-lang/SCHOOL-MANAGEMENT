const pool = require('../config/db');
const requestContext = require('../config/requestContext');

const REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000;

const sendReminder = async (reminder, eventKey) => {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const logged = await client.query(
      `INSERT INTO curriculum_selection_notification_log
         (school_id, user_id, student_id, academic_year, event_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id, user_id, student_id, academic_year, event_key) DO NOTHING
       RETURNING id`,
      [reminder.school_id, reminder.user_id, reminder.student_id, reminder.academic_year, eventKey]
    );
    if (logged.rowCount) {
      await client.query(
        `INSERT INTO notifications (school_id, user_id, title, message)
         VALUES ($1, $2, $3, $4)`,
        [
          reminder.school_id,
          reminder.user_id,
          'Curriculum selection reminder',
          `Please submit a GES or Pearson pathway selection for ${reminder.student_name} before ${new Date(reminder.deadline).toLocaleDateString()}.`,
        ]
      );
    }
    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const processSchoolPeriod = (period) => requestContext.run({
  school_id: period.school_id,
  id: 0,
  role: 'admin',
}, async () => {
  const reminders = await pool.query(
    `SELECT DISTINCT period.school_id, period.academic_year, period.deadline,
            s.id AS student_id, s.name AS student_name, u.id AS user_id
     FROM curriculum_selection_periods period
     JOIN students s ON s.school_id = period.school_id
     JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
     JOIN student_parent sp ON sp.student_id = s.id AND sp.school_id = s.school_id
     JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
     JOIN users u ON u.id = p.user_id AND u.school_id = p.school_id
       AND u.role = 'parent' AND u.is_active = TRUE
     WHERE period.id = $1 AND period.enabled = TRUE
       AND NOW() BETWEEN period.opens_at AND period.deadline
       AND s.curriculum = 'COMMON' AND c.year_level = 6 AND c.curriculum = 'COMMON'
       AND NOT EXISTS (
         SELECT 1 FROM curriculum_pathway_selections selection
         WHERE selection.school_id = s.school_id AND selection.student_id = s.id
           AND selection.academic_year = period.academic_year
           AND selection.status IN ('pending_approval', 'approved_pending_class', 'assigned')
       )
       AND NOT EXISTS (
         SELECT 1 FROM curriculum_selection_notification_log sent
         WHERE sent.school_id = period.school_id AND sent.user_id = u.id
           AND sent.student_id = s.id AND sent.academic_year = period.academic_year
           AND sent.event_key LIKE 'selection-reminder:%'
           AND sent.sent_at > NOW() - (period.reminder_interval_days * INTERVAL '1 day')
       )
     ORDER BY s.id, u.id`,
    [period.id]
  );
  const dayKey = new Date().toISOString().slice(0, 10);
  for (const reminder of reminders.rows) {
    await sendReminder(reminder, `selection-reminder:${dayKey}`);
  }
});

const runSelectionReminders = async () => {
  const periods = await pool.query(
    `SELECT id, school_id
     FROM curriculum_selection_periods
     WHERE enabled = TRUE AND NOW() BETWEEN opens_at AND deadline`
  );
  for (const period of periods.rows) {
    await processSchoolPeriod(period);
  }
};

const startCurriculumSelectionScheduler = () => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runSelectionReminders();
    } catch (error) {
      console.error('Curriculum selection reminder run failed:', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, REMINDER_INTERVAL_MS);
  timer.unref();
  run();
  return () => clearInterval(timer);
};

module.exports = { runSelectionReminders, startCurriculumSelectionScheduler };
