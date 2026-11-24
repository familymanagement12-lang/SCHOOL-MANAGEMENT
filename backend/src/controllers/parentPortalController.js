const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { canonicalClassName } = require('../services/curriculumPolicy');
const regexpDigits = (value) => value.replace(/[^0-9]/g, '');

const parentStudent = async (schoolId, parentUserId, studentId) => pool.query(
  `SELECT s.id, s.name, LPAD(s.id::TEXT, 6, '0') AS admission_number,
          s.class_id, s.curriculum, c.name AS class_name, c.year_level,
          sc.academic_year, sc.current_term, sc.currency
   FROM students s
   JOIN student_parent sp ON sp.student_id = s.id AND sp.school_id = s.school_id
   JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
   JOIN users pu ON pu.id = p.user_id AND pu.school_id = p.school_id
     AND pu.role = 'parent' AND pu.is_active = TRUE
   LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
   JOIN schools sc ON sc.id = s.school_id
   WHERE s.school_id = $1 AND p.user_id = $2 AND s.id = $3
   LIMIT 1`,
  [schoolId, parentUserId, studentId]
);

const requireChild = async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    res.status(400).json({ message: 'Choose a valid child.' });
    return null;
  }
  const result = await parentStudent(req.user.school_id, req.user.id, studentId);
  if (!result.rowCount) {
    res.status(404).json({ message: 'Child not found in your linked accounts.' });
    return null;
  }
  await pool.query(
    `INSERT INTO parent_portal_audit_log
       (school_id, parent_user_id, student_id, actor_id, action, details)
     VALUES ($1, $2, $3, $2, 'CHILD_RECORD_VIEWED', $4::JSONB)`,
    [req.user.school_id, req.user.id, studentId, JSON.stringify({ resource: req.path })]
  );
  return result.rows[0];
};

const requireActiveParent = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT 1 FROM users
       WHERE id = $1 AND school_id = $2 AND role = 'parent' AND is_active = TRUE`,
      [req.user.id, req.user.school_id]
    );
    if (!result.rowCount) return res.status(403).json({ message: 'This parent account is inactive.' });
    next();
  } catch (error) {
    next(error);
  }
};

const audit = (client, { schoolId, parentUserId, studentId = null, actorId, action, details = {} }) => (
  client.query(
    `INSERT INTO parent_portal_audit_log
       (school_id, parent_user_id, student_id, actor_id, action, details)
     VALUES ($1, $2, $3, $4, $5, $6::JSONB)`,
    [schoolId, parentUserId, studentId, actorId, action, JSON.stringify(details)]
  )
);

const getChildren = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT s.id, s.name, LPAD(s.id::TEXT, 6, '0') AS admission_number,
              s.class_id, s.curriculum, c.name AS class_name, c.year_level,
              sc.academic_year, sc.current_term, sc.currency, sp.relationship
       FROM student_parent sp
       JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
       JOIN users pu ON pu.id = p.user_id AND pu.school_id = p.school_id
         AND pu.role = 'parent' AND pu.is_active = TRUE
       JOIN students s ON s.id = sp.student_id AND s.school_id = sp.school_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       JOIN schools sc ON sc.id = s.school_id
       WHERE sp.school_id = $1 AND p.user_id = $2
       ORDER BY s.name, s.id`,
      [req.user.school_id, req.user.id]
    );
    res.json(result.rows.map((child) => ({
      ...child,
      class_name: canonicalClassName(child.class_name, child.year_level, child.curriculum),
    })));
  } catch (error) {
    next(error);
  }
};

const getDashboard = async (req, res, next) => {
  try {
    const children = await pool.query(
      `SELECT DISTINCT s.id, s.name, LPAD(s.id::TEXT, 6, '0') AS admission_number,
              s.class_id, s.curriculum, c.name AS class_name, c.year_level,
              sc.academic_year, sc.current_term, sc.currency,
              COALESCE(fees.outstanding, 0)::NUMERIC(12,2) AS fees_outstanding,
              COALESCE(feeding.due, 0)::NUMERIC(12,2) AS feeding_due,
              COALESCE(feeding.paid, 0)::NUMERIC(12,2) AS feeding_paid,
              COALESCE(attendance.total, 0)::INTEGER AS attendance_total,
              COALESCE(attendance.present, 0)::INTEGER AS attendance_present,
              COALESCE(results.latest_score, 0)::NUMERIC(5,2) AS latest_score,
              results.latest_term
       FROM student_parent sp
       JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
       JOIN users pu ON pu.id = p.user_id AND pu.school_id = p.school_id
         AND pu.role = 'parent' AND pu.is_active = TRUE
       JOIN students s ON s.id = sp.student_id AND s.school_id = sp.school_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       JOIN schools sc ON sc.id = s.school_id
       LEFT JOIN LATERAL (
         SELECT GREATEST(SUM(f.balance), 0) AS outstanding FROM fees f
         WHERE f.school_id = s.school_id AND f.student_id = s.id
       ) fees ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(o.amount_due), 0) AS due,
                COALESCE(SUM(GREATEST(COALESCE(a.paid, 0) - COALESCE(r.reversed, 0), 0)), 0) AS paid
         FROM feeding_obligations o
         LEFT JOIN LATERAL (
           SELECT SUM(pa.amount) AS paid FROM school_payment_allocations pa
           WHERE pa.school_id = o.school_id AND pa.obligation_id = o.id
         ) a ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(ra.amount) AS reversed
           FROM school_payment_refund_allocations ra
           JOIN school_payment_allocations pa
             ON pa.id = ra.payment_allocation_id AND pa.school_id = ra.school_id
           WHERE pa.school_id = o.school_id AND pa.obligation_id = o.id
             AND ra.component = 'feeding'
         ) r ON TRUE
         WHERE o.school_id = s.school_id AND o.student_id = s.id
       ) feeding ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE a.status <> 'excused') AS total,
                COUNT(*) FILTER (WHERE a.status IN ('present', 'late')) AS present
         FROM attendance a
         WHERE a.school_id = s.school_id AND a.student_id = s.id
       ) attendance ON TRUE
       LEFT JOIN LATERAL (
         SELECT r.score AS latest_score, r.term AS latest_term
         FROM results r
         WHERE r.school_id = s.school_id AND r.student_id = s.id AND r.is_published = TRUE
         ORDER BY r.published_at DESC NULLS LAST, r.created_at DESC, r.id DESC
         LIMIT 1
       ) results ON TRUE
       WHERE sp.school_id = $1 AND p.user_id = $2
       ORDER BY s.name, s.id`,
      [req.user.school_id, req.user.id]
    );
    const notices = await pool.query(
      `SELECT a.id, a.title, a.message, a.created_at, c.name AS class_name,
              c.year_level, c.curriculum AS class_curriculum
       FROM announcements a
       LEFT JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
       WHERE a.school_id = $1
         AND (a.audience = 'everyone' OR EXISTS (
           SELECT 1 FROM student_parent sp
           JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
           JOIN students s ON s.id = sp.student_id AND s.school_id = sp.school_id
           WHERE sp.school_id = a.school_id AND p.user_id = $2 AND s.class_id = a.class_id
         ))
       ORDER BY a.created_at DESC LIMIT 5`,
      [req.user.school_id, req.user.id]
    );
    const payments = await pool.query(
      `SELECT r.id, r.receipt_number, r.payment_date::TEXT, r.payment_method,
              r.amount_total, r.school_fee_amount, r.feeding_amount,
              s.name AS student_name
       FROM school_payment_receipts r
       JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
       WHERE r.school_id = $1 AND EXISTS (
         SELECT 1 FROM student_parent sp
         JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
         WHERE sp.school_id = r.school_id AND sp.student_id = r.student_id AND p.user_id = $2
       )
       ORDER BY r.payment_date DESC, r.id DESC LIMIT 5`,
      [req.user.school_id, req.user.id]
    );
    await pool.query(
      `INSERT INTO parent_portal_audit_log (school_id, parent_user_id, actor_id, action)
       VALUES ($1, $2, $2, 'DASHBOARD_VIEWED')`,
      [req.user.school_id, req.user.id]
    );
    res.json({
      children: children.rows.map((child) => ({
        ...child,
        class_name: canonicalClassName(child.class_name, child.year_level, child.curriculum),
      })),
      announcements: notices.rows.map((notice) => ({
        ...notice,
        class_name: canonicalClassName(notice.class_name, notice.year_level, notice.class_curriculum),
      })),
      recent_payments: payments.rows,
    });
  } catch (error) {
    next(error);
  }
};

const getFees = async (req, res, next) => {
  try {
    const child = await requireChild(req, res);
    if (!child) return;
    const [invoices, payments] = await Promise.all([
      pool.query(
        `SELECT f.id, f.description, f.amount_due, f.amount_paid, f.balance,
                f.due_date::TEXT, f.created_at, f.is_fee_override,
                f.fee_override_reason, fs.academic_year, fs.term
         FROM fees f
         LEFT JOIN fee_structures fs
           ON fs.id = f.fee_structure_id AND fs.school_id = f.school_id
         WHERE f.school_id = $1 AND f.student_id = $2
         ORDER BY f.due_date NULLS LAST, f.created_at DESC, f.id DESC`,
        [req.user.school_id, child.id]
      ),
      pool.query(
        `SELECT r.id AS receipt_id, r.receipt_number, r.payment_date::TEXT,
                r.payment_method, r.reference,
                SUM(a.amount)::NUMERIC(10,2) AS gross_amount,
                COALESCE(SUM(refunds.amount), 0)::NUMERIC(10,2) AS refunded_amount,
                GREATEST(SUM(a.amount) - COALESCE(SUM(refunds.amount), 0), 0)::NUMERIC(10,2) AS amount
         FROM school_payment_receipts r
         JOIN school_payment_allocations a
           ON a.receipt_id = r.id AND a.school_id = r.school_id
         LEFT JOIN LATERAL (
           SELECT SUM(ra.amount) AS amount
           FROM school_payment_refund_allocations ra
           WHERE ra.school_id = a.school_id AND ra.payment_allocation_id = a.id
         ) refunds ON TRUE
         WHERE r.school_id = $1 AND r.student_id = $2 AND a.component = 'school_fee'
         GROUP BY r.id
         ORDER BY r.payment_date DESC, r.id DESC`,
        [req.user.school_id, child.id]
      ),
    ]);
    res.json({
      student: child,
      invoices: invoices.rows,
      payments: payments.rows,
      total_payable: invoices.rows.reduce((sum, row) => sum + Number(row.amount_due), 0),
      total_paid: invoices.rows.reduce((sum, row) => sum + Number(row.amount_paid), 0),
      balance: invoices.rows.reduce((sum, row) => sum + Number(row.balance), 0),
    });
  } catch (error) {
    next(error);
  }
};

const getFeeding = async (req, res, next) => {
  try {
    const child = await requireChild(req, res);
    if (!child) return;
    const [obligations, payments, credit] = await Promise.all([
      pool.query(
        `SELECT o.id, o.feeding_date::TEXT, o.academic_year, o.term, o.daily_rate,
                o.amount_due,
                GREATEST(COALESCE(a.paid, 0) - COALESCE(r.reversed, 0), 0)::NUMERIC(10,2) AS amount_paid,
                cd.is_served
         FROM feeding_obligations o
         LEFT JOIN LATERAL (
           SELECT SUM(pa.amount) AS paid FROM school_payment_allocations pa
           WHERE pa.school_id = o.school_id AND pa.obligation_id = o.id
         ) a ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(ra.amount) AS reversed
           FROM school_payment_refund_allocations ra
           JOIN school_payment_allocations pa
             ON pa.id = ra.payment_allocation_id AND pa.school_id = ra.school_id
           WHERE pa.school_id = o.school_id AND pa.obligation_id = o.id
             AND ra.component = 'feeding'
         ) r ON TRUE
         LEFT JOIN feeding_coverage_days cd
           ON cd.school_id = o.school_id AND cd.obligation_id = o.id
         WHERE o.school_id = $1 AND o.student_id = $2
         ORDER BY o.feeding_date DESC, o.id DESC`,
        [req.user.school_id, child.id]
      ),
      pool.query(
        `SELECT r.id, r.receipt_number, r.payment_date::TEXT, r.payment_method,
                r.reference, r.feeding_amount,
                COALESCE((
                  SELECT SUM(a.amount) FROM school_payment_allocations a
                  WHERE a.school_id = r.school_id AND a.receipt_id = r.id
                    AND a.component = 'feeding'
                ), 0)::NUMERIC(10,2) AS allocated_amount,
                COALESCE((
                  SELECT SUM(f.amount) FROM school_payment_refunds f
                  WHERE f.school_id = r.school_id AND f.receipt_id = r.id
                    AND f.component = 'feeding'
                ), 0)::NUMERIC(10,2) AS refunded_amount,
                COALESCE((
                  SELECT SUM(f.amount) FROM school_payment_refunds f
                  WHERE f.school_id = r.school_id AND f.receipt_id = r.id
                    AND f.component = 'feeding'
                ), 0)::NUMERIC(10,2) AS refunded_amount,
                r.feeding_academic_year AS academic_year, r.feeding_term AS term
         FROM school_payment_receipts r
         WHERE r.school_id = $1 AND r.student_id = $2 AND r.feeding_amount > 0
         ORDER BY r.payment_date DESC, r.id DESC`,
        [req.user.school_id, child.id]
      ),
      pool.query(
        `SELECT GREATEST(
           COALESCE(SUM(r.feeding_amount), 0)
           - COALESCE(SUM(refunds.refunded), 0)
           - COALESCE(SUM(allocations.allocated - allocations.reversed), 0), 0
         )::NUMERIC(10,2) AS balance
         FROM school_payment_receipts r
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(f.amount), 0) AS refunded
           FROM school_payment_refunds f
           WHERE f.school_id = r.school_id AND f.receipt_id = r.id AND f.component = 'feeding'
         ) refunds ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(a.amount), 0) AS allocated,
                  COALESCE(SUM(reversed.amount), 0) AS reversed
           FROM school_payment_allocations a
           LEFT JOIN LATERAL (
             SELECT SUM(ra.amount) AS amount
             FROM school_payment_refund_allocations ra
             WHERE ra.payment_allocation_id = a.id AND ra.school_id = a.school_id
           ) reversed ON TRUE
           WHERE a.school_id = r.school_id AND a.receipt_id = r.id AND a.component = 'feeding'
         ) allocations ON TRUE
         WHERE r.school_id = $1 AND r.student_id = $2`,
        [req.user.school_id, child.id]
      ),
    ]);
    const totalDue = obligations.rows.reduce((sum, row) => sum + Number(row.amount_due), 0);
    const totalPaid = obligations.rows.reduce((sum, row) => sum + Number(row.amount_paid), 0);
    res.json({
      student: child,
      obligations: obligations.rows,
      payments: payments.rows,
      total_due: totalDue,
      total_paid: totalPaid,
      balance: Math.max(0, totalDue - totalPaid),
      advance_credit: Number(credit.rows[0]?.balance || 0),
    });
  } catch (error) {
    next(error);
  }
};

const getResults = async (req, res, next) => {
  try {
    const child = await requireChild(req, res);
    if (!child) return;
    const result = await pool.query(
      `SELECT id, subject, class_score, exam_score, score, term, published_at,
              academic_year_snapshot, class_name_snapshot, curriculum
       FROM results
       WHERE school_id = $1 AND student_id = $2 AND is_published = TRUE
       ORDER BY published_at DESC NULLS LAST, created_at DESC, subject`,
      [req.user.school_id, child.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getAttendance = async (req, res, next) => {
  try {
    const child = await requireChild(req, res);
    if (!child) return;
    const result = await pool.query(
      `SELECT id, date::TEXT, status FROM attendance
       WHERE school_id = $1 AND student_id = $2
       ORDER BY date DESC`,
      [req.user.school_id, child.id]
    );
    const totals = result.rows.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {});
    const considered = result.rows.length - (totals.excused || 0);
    res.json({
      records: result.rows,
      totals,
      attendance_percentage: considered
        ? Math.round((((totals.present || 0) + (totals.late || 0)) / considered) * 10000) / 100
        : 0,
    });
  } catch (error) {
    next(error);
  }
};

const getTimetable = async (req, res, next) => {
  try {
    const child = await requireChild(req, res);
    if (!child) return;
    const result = await pool.query(
      `SELECT t.id, t.day_of_week, t.start_time, t.end_time,
              COALESCE(t.subject_name_snapshot, s.name, t.subject) AS subject,
              COALESCE(t.teacher_name_snapshot, u.name) AS teacher,
              COALESCE(t.room_name_snapshot, r.name) AS room,
              t.academic_year, t.term, p.is_break, p.name AS period_name
       FROM timetables t
       JOIN timetable_versions v ON v.id = t.version_id AND v.school_id = t.school_id
         AND v.status = 'PUBLISHED'
       LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
       LEFT JOIN users u ON u.id = t.teacher_id AND u.school_id = t.school_id
       LEFT JOIN timetable_rooms r ON r.id = t.room_id AND r.school_id = t.school_id
       LEFT JOIN timetable_periods p ON p.id = t.period_id AND p.school_id = t.school_id
       WHERE t.school_id = $1 AND t.class_id = $2 AND t.status = 'PUBLISHED'
         AND t.academic_year = $3 AND t.term = $4
       ORDER BY CASE t.day_of_week WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2
         WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5
         WHEN 'Saturday' THEN 6 ELSE 7 END, t.start_time`,
      [req.user.school_id, child.class_id, child.academic_year, child.current_term]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getAnnouncements = async (req, res, next) => {
  try {
    const child = await requireChild(req, res);
    if (!child) return;
    const result = await pool.query(
      `SELECT a.id, a.title, a.message, a.created_at, u.name AS sender_name
       FROM announcements a
       LEFT JOIN users u ON u.id = a.sender_id AND u.school_id = a.school_id
       WHERE a.school_id = $1
         AND (a.audience = 'everyone' OR a.class_id = $2)
       ORDER BY a.created_at DESC LIMIT 100`,
      [req.user.school_id, child.class_id || 0]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getProfile = async (req, res, next) => {
  try {
    const [parent, preferences, children] = await Promise.all([
      pool.query(
        `SELECT u.id, u.name, u.email, u.is_active, p.phone
         FROM users u
         LEFT JOIN LATERAL (
           SELECT phone FROM parents WHERE user_id = u.id AND school_id = u.school_id
           ORDER BY id LIMIT 1
         ) p ON TRUE
         WHERE u.id = $1 AND u.school_id = $2 AND u.role = 'parent'`,
        [req.user.id, req.user.school_id]
      ),
      pool.query(
        `SELECT announcements, fee_reminders, feeding_reminders, emergency_notices
         FROM parent_notification_preferences WHERE user_id = $1 AND school_id = $2`,
        [req.user.id, req.user.school_id]
      ),
      pool.query(
        `SELECT s.id, s.name, LPAD(s.id::TEXT, 6, '0') AS admission_number,
                c.name AS class_name, c.year_level, c.curriculum, sp.relationship
         FROM student_parent sp
         JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
         JOIN students s ON s.id = sp.student_id AND s.school_id = sp.school_id
         LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
         WHERE sp.school_id = $1 AND p.user_id = $2
         ORDER BY s.name`,
        [req.user.school_id, req.user.id]
      ),
    ]);
    if (!parent.rowCount) return res.status(404).json({ message: 'Parent profile not found.' });
    res.json({
      ...parent.rows[0],
      children: children.rows.map((child) => ({
        ...child,
        class_name: canonicalClassName(child.class_name, child.year_level, child.curriculum),
      })),
      preferences: preferences.rows[0] || {
        announcements: true, fee_reminders: true, feeding_reminders: true, emergency_notices: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || phone.length > 40) {
    return res.status(400).json({ message: 'Provide a valid email address and phone number.' });
  }
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const emailConflict = await client.query(
      'SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1',
      [email, req.user.id]
    );
    if (emailConflict.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'That email address is already in use.' });
    }
    if (phone && regexpDigits(phone)) {
      const phoneConflict = await client.query(
        `SELECT 1 FROM parents p
         JOIN users u ON u.id = p.user_id AND u.school_id = p.school_id
         WHERE p.school_id = $1 AND p.user_id <> $2 AND u.role = 'parent'
           AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') = $3
         LIMIT 1`,
        [req.user.school_id, req.user.id, regexpDigits(phone)]
      );
      if (phoneConflict.rowCount) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(409).json({ message: 'That phone number is already registered to another parent.' });
      }
    }
    await client.query(
      `UPDATE users SET email = $1, email_verified = FALSE
       WHERE id = $2 AND school_id = $3 AND role = 'parent'`,
      [email, req.user.id, req.user.school_id]
    );
    await client.query(
      `UPDATE parents SET phone = $1
       WHERE school_id = $2 AND user_id = $3`,
      [phone || null, req.user.school_id, req.user.id]
    );
    await audit(client, {
      schoolId: req.user.school_id, parentUserId: req.user.id, actorId: req.user.id,
      action: 'CONTACT_DETAILS_UPDATED', details: { email_changed: true, phone_changed: true },
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.json({ message: 'Contact details updated. The school may contact you to verify changes.' });
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ message: 'That email address is already in use.' });
    next(error);
  } finally {
    client?.release();
  }
};

const updatePreferences = async (req, res, next) => {
  const keys = ['announcements', 'fee_reminders', 'feeding_reminders', 'emergency_notices'];
  if (keys.some((key) => typeof req.body[key] !== 'boolean')) {
    return res.status(400).json({ message: 'Provide a boolean value for each notification preference.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO parent_notification_preferences
         (school_id, user_id, announcements, fee_reminders, feeding_reminders, emergency_notices, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (school_id, user_id) DO UPDATE SET
         announcements = EXCLUDED.announcements,
         fee_reminders = EXCLUDED.fee_reminders,
         feeding_reminders = EXCLUDED.feeding_reminders,
         emergency_notices = EXCLUDED.emergency_notices,
         updated_at = NOW()
       RETURNING announcements, fee_reminders, feeding_reminders, emergency_notices`,
      [req.user.school_id, req.user.id, ...keys.map((key) => req.body[key])]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getReceipt = async (req, res, next) => {
  const receiptId = Number(req.params.receiptId);
  if (!Number.isSafeInteger(receiptId) || receiptId <= 0) {
    return res.status(400).json({ message: 'Choose a valid receipt.' });
  }
  try {
    const result = await pool.query(
      `SELECT r.id, r.receipt_number, r.student_id, s.name AS student_name,
              LPAD(s.id::TEXT, 6, '0') AS admission_number,
              c.name AS class_name, r.payment_date::TEXT, r.payment_method,
              r.reference, r.amount_total, r.school_fee_amount, r.feeding_amount,
              u.name AS received_by_name
       FROM school_payment_receipts r
       JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       LEFT JOIN users u ON u.id = r.received_by AND u.school_id = r.school_id
       WHERE r.school_id = $1 AND r.id = $2
         AND EXISTS (
           SELECT 1 FROM student_parent sp
           JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
           WHERE sp.school_id = r.school_id AND sp.student_id = r.student_id AND p.user_id = $3
         )`,
      [req.user.school_id, receiptId, req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Receipt not found for your linked children.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getEnquiries = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.student_id, s.name AS student_name, e.request_type,
              e.subject, e.message, e.status, e.school_response,
              e.created_at, e.updated_at, e.responded_at
       FROM parent_enquiries e
       LEFT JOIN students s ON s.id = e.student_id AND s.school_id = e.school_id
       WHERE e.school_id = $1 AND e.parent_user_id = $2
       ORDER BY e.created_at DESC`,
      [req.user.school_id, req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createEnquiry = async (req, res, next) => {
  const requestType = req.body.request_type;
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  const studentId = req.body.student_id === null || req.body.student_id === undefined || req.body.student_id === ''
    ? null : Number(req.body.student_id);
  if (!['enquiry', 'profile_correction'].includes(requestType)
      || !subject || subject.length > 120 || !message || message.length > 4000
      || (studentId !== null && (!Number.isSafeInteger(studentId) || studentId <= 0))
      || (requestType === 'profile_correction' && studentId === null)) {
    return res.status(400).json({ message: 'Provide a request type, subject, message, and linked child for profile corrections.' });
  }
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    if (studentId !== null) {
      const link = await parentStudent(req.user.school_id, req.user.id, studentId);
      if (!link.rowCount) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(404).json({ message: 'Child not found in your linked accounts.' });
      }
    }
    const result = await client.query(
      `INSERT INTO parent_enquiries
         (school_id, parent_user_id, student_id, request_type, subject, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, student_id, request_type, subject, message, status, created_at`,
      [req.user.school_id, req.user.id, studentId, requestType, subject, message]
    );
    await audit(client, {
      schoolId: req.user.school_id, parentUserId: req.user.id,
      studentId, actorId: req.user.id, action: 'PARENT_ENQUIRY_CREATED',
      details: { request_type: requestType, enquiry_id: result.rows[0].id },
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally {
    client?.release();
  }
};

const getAdminEnquiries = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.parent_user_id, u.name AS parent_name, u.email AS parent_email,
              p.phone, e.student_id, s.name AS student_name, e.request_type,
              e.subject, e.message, e.status, e.school_response, e.created_at,
              e.updated_at, e.responded_at, e.responded_by
       FROM parent_enquiries e
       JOIN users u ON u.id = e.parent_user_id AND u.school_id = e.school_id
       LEFT JOIN LATERAL (
         SELECT phone FROM parents WHERE user_id = u.id AND school_id = u.school_id
         ORDER BY id LIMIT 1
       ) p ON TRUE
       LEFT JOIN students s ON s.id = e.student_id AND s.school_id = e.school_id
       WHERE e.school_id = $1
       ORDER BY CASE e.status WHEN 'pending' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
                e.created_at DESC`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const updateAdminEnquiry = async (req, res, next) => {
  const enquiryId = Number(req.params.enquiryId);
  const status = req.body.status;
  const response = typeof req.body.school_response === 'string' ? req.body.school_response.trim() : '';
  if (!Number.isSafeInteger(enquiryId) || enquiryId <= 0
      || !['pending', 'in_review', 'responded', 'closed'].includes(status)
      || response.length > 4000 || (status === 'responded' && !response)) {
    return res.status(400).json({ message: 'Choose a valid request status and provide a response when replying.' });
  }
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const result = await client.query(
      `UPDATE parent_enquiries
       SET status = $1,
           school_response = CASE WHEN $2 <> '' THEN $2 ELSE school_response END,
           responded_by = CASE WHEN $1 = 'responded' THEN $3 ELSE responded_by END,
           responded_at = CASE WHEN $1 = 'responded' THEN NOW() ELSE responded_at END,
           updated_at = NOW()
       WHERE id = $4 AND school_id = $5
       RETURNING id, parent_user_id, student_id, subject, status, school_response`,
      [status, response, req.user.id, enquiryId, req.user.school_id]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Parent request not found.' });
    }
    const enquiry = result.rows[0];
    if (status === 'responded') {
      await client.query(
        `INSERT INTO notifications (school_id, user_id, title, message)
         VALUES ($1, $2, 'School replied to your request',
                 'A response to "' || $3 || '" is available in your Parent Portal.')`,
        [req.user.school_id, enquiry.parent_user_id, enquiry.subject]
      );
    }
    await audit(client, {
      schoolId: req.user.school_id, parentUserId: enquiry.parent_user_id,
      studentId: enquiry.student_id, actorId: req.user.id,
      action: 'PARENT_REQUEST_UPDATED', details: { enquiry_id: enquiryId, status },
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.json(enquiry);
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally {
    client?.release();
  }
};

const getAdminParents = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_active, u.created_at,
              p.phone,
              COALESCE(json_agg(DISTINCT jsonb_build_object(
                'id', s.id, 'name', s.name, 'admission_number', LPAD(s.id::TEXT, 6, '0'),
                'class_name', c.name, 'year_level', c.year_level,
                'curriculum', c.curriculum, 'relationship', sp.relationship
              )) FILTER (WHERE s.id IS NOT NULL), '[]'::JSON) AS children
       FROM users u
       LEFT JOIN parents p ON p.user_id = u.id AND p.school_id = u.school_id
       LEFT JOIN student_parent sp ON sp.parent_id = p.id AND sp.school_id = p.school_id
       LEFT JOIN students s ON s.id = sp.student_id AND s.school_id = sp.school_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       WHERE u.school_id = $1 AND u.role = 'parent'
       GROUP BY u.id, p.phone
       ORDER BY u.created_at DESC`,
      [req.user.school_id]
    );
    res.json(result.rows.map((parent) => ({
      ...parent,
      children: parent.children.map((child) => ({
        ...child,
        class_name: canonicalClassName(child.class_name, child.year_level, child.curriculum),
      })),
    })));
  } catch (error) {
    next(error);
  }
};

const createAdminParent = async (req, res, next) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const studentIds = Array.isArray(req.body.student_ids) ? [...new Set(req.body.student_ids.map(Number))] : [];
  const relationship = typeof req.body.relationship === 'string' && req.body.relationship.trim()
    ? req.body.relationship.trim().slice(0, 60) : 'Parent';
  if (!name || name.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || email.length > 254 || phone.length > 40
      || studentIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
      || studentIds.length > 20) {
    return res.status(400).json({ message: 'Provide a valid name, email, phone, and up to 20 child IDs.' });
  }
  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const emailConflict = await client.query(
      'SELECT 1 FROM users WHERE lower(email) = lower($1) LIMIT 1',
      [email]
    );
    if (emailConflict.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'That email address is already in use.' });
    }
    if (phone && regexpDigits(phone)) {
      const phoneConflict = await client.query(
        `SELECT 1 FROM parents p
         JOIN users u ON u.id = p.user_id AND u.school_id = p.school_id
         WHERE p.school_id = $1 AND u.role = 'parent'
           AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') = $2
         LIMIT 1`,
        [req.user.school_id, regexpDigits(phone)]
      );
      if (phoneConflict.rowCount) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(409).json({ message: 'That phone number is already registered to a parent account.' });
      }
    }
    if (studentIds.length) {
      const students = await client.query(
        'SELECT id FROM students WHERE school_id = $1 AND id = ANY($2::INTEGER[])',
        [req.user.school_id, studentIds]
      );
      if (students.rowCount !== studentIds.length) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(400).json({ message: 'One or more selected children are not in this school.' });
      }
    }
    const password = await bcrypt.hash(temporaryPassword, 10);
    const user = await client.query(
      `INSERT INTO users (school_id, name, email, password, role, is_active, must_change_password, email_verified)
       VALUES ($1, $2, $3, $4, 'parent', $5, TRUE, TRUE)
       RETURNING id, name, email, role, is_active, created_at`,
      [req.user.school_id, name, email, password, req.body.is_active !== false]
    );
    const parent = await client.query(
      `INSERT INTO parents (school_id, user_id, name, phone)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.school_id, user.rows[0].id, name, phone || null]
    );
    for (const studentId of studentIds) {
      await client.query(
        `INSERT INTO student_parent (school_id, student_id, parent_id, relationship)
         VALUES ($1, $2, $3, $4)`,
        [req.user.school_id, studentId, parent.rows[0].id, relationship]
      );
      await audit(client, {
        schoolId: req.user.school_id, parentUserId: user.rows[0].id,
        studentId, actorId: req.user.id, action: 'CHILD_LINKED',
        details: { relationship },
      });
    }
    await audit(client, {
      schoolId: req.user.school_id, parentUserId: user.rows[0].id, actorId: req.user.id,
      action: 'PARENT_ACCOUNT_CREATED', details: { is_active: req.body.is_active !== false },
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.status(201).json({ ...user.rows[0], phone: phone || null, temporary_password: temporaryPassword });
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ message: 'That email or parent-child link already exists.' });
    next(error);
  } finally {
    client?.release();
  }
};

const reissueParentAccess = async (req, res, next) => {
  const parentUserId = Number(req.params.userId);
  if (!Number.isSafeInteger(parentUserId) || parentUserId <= 0) {
    return res.status(400).json({ message: 'Choose a valid parent account.' });
  }
  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const user = await client.query(
      `UPDATE users
       SET password = $1, must_change_password = TRUE
       WHERE id = $2 AND school_id = $3 AND role = 'parent' AND is_active = TRUE
       RETURNING id, name, email`,
      [await bcrypt.hash(temporaryPassword, 10), parentUserId, req.user.school_id]
    );
    if (!user.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Active parent account not found. Activate it before reissuing access.' });
    }
    await audit(client, {
      schoolId: req.user.school_id, parentUserId, actorId: req.user.id,
      action: 'PARENT_ACCESS_REISSUED',
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.json({ ...user.rows[0], temporary_password: temporaryPassword });
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally {
    client?.release();
  }
};

const removeAdminParentLink = async (req, res, next) => {
  const parentUserId = Number(req.params.userId);
  const studentId = Number(req.params.studentId);
  if (!Number.isSafeInteger(parentUserId) || parentUserId <= 0
      || !Number.isSafeInteger(studentId) || studentId <= 0) {
    return res.status(400).json({ message: 'Choose a valid parent and child.' });
  }
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const result = await client.query(
      `DELETE FROM student_parent sp
       USING parents p, users u
       WHERE sp.parent_id = p.id AND sp.school_id = p.school_id
         AND p.user_id = u.id AND p.school_id = u.school_id
         AND sp.school_id = $1 AND p.user_id = $2 AND sp.student_id = $3
         AND u.role = 'parent'
       RETURNING sp.student_id`,
      [req.user.school_id, parentUserId, studentId]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Parent-child link not found.' });
    }
    await audit(client, {
      schoolId: req.user.school_id, parentUserId, studentId, actorId: req.user.id,
      action: 'CHILD_UNLINKED',
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.json({ message: 'Child link removed.' });
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally {
    client?.release();
  }
};

const manageAdminParent = async (req, res, next) => {
  const parentUserId = Number(req.params.userId);
  if (!Number.isSafeInteger(parentUserId) || parentUserId <= 0) {
    return res.status(400).json({ message: 'Choose a valid parent account.' });
  }
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const user = await client.query(
      `SELECT id, is_active FROM users
       WHERE id = $1 AND school_id = $2 AND role = 'parent' FOR UPDATE`,
      [parentUserId, req.user.school_id]
    );
    if (!user.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Parent account not found.' });
    }
    let response;
    if (req.method === 'PATCH') {
      if (typeof req.body.is_active !== 'boolean') {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(400).json({ message: 'Provide an active or suspended status.' });
      }
      await client.query(
        'UPDATE users SET is_active = $1 WHERE id = $2 AND school_id = $3',
        [req.body.is_active, parentUserId, req.user.school_id]
      );
      await audit(client, {
        schoolId: req.user.school_id, parentUserId, actorId: req.user.id,
        action: req.body.is_active ? 'PARENT_ACCOUNT_ACTIVATED' : 'PARENT_ACCOUNT_SUSPENDED',
      });
      response = { message: req.body.is_active ? 'Parent account activated.' : 'Parent account suspended.' };
    } else {
      const studentId = Number(req.body.student_id);
      if (!Number.isSafeInteger(studentId) || studentId <= 0) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(400).json({ message: 'Choose a valid child.' });
      }
      const relationship = typeof req.body.relationship === 'string' && req.body.relationship.trim()
        ? req.body.relationship.trim().slice(0, 60) : 'Parent';
      const student = await client.query(
        'SELECT id FROM students WHERE id = $1 AND school_id = $2',
        [studentId, req.user.school_id]
      );
      if (!student.rowCount) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(404).json({ message: 'Child not found in this school.' });
      }
      let parent = await client.query(
        `SELECT id FROM parents WHERE user_id = $1 AND school_id = $2 ORDER BY id LIMIT 1`,
        [parentUserId, req.user.school_id]
      );
      if (!parent.rowCount) {
        await client.query(
          `INSERT INTO parents (school_id, user_id, name)
           SELECT school_id, id, name FROM users WHERE id = $1 AND school_id = $2`,
          [parentUserId, req.user.school_id]
        );
        parent = await client.query(
          `SELECT id FROM parents WHERE user_id = $1 AND school_id = $2 ORDER BY id LIMIT 1`,
          [parentUserId, req.user.school_id]
        );
      }
      await client.query(
        `INSERT INTO student_parent (school_id, student_id, parent_id, relationship)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, parent_id) DO UPDATE SET relationship = EXCLUDED.relationship`,
        [req.user.school_id, studentId, parent.rows[0].id, relationship]
      );
      await audit(client, {
        schoolId: req.user.school_id, parentUserId, studentId, actorId: req.user.id,
        action: 'CHILD_LINKED', details: { relationship },
      });
      response = { message: 'Child linked to parent account.' };
    }
    await client.query('COMMIT');
    transactionOpen = false;
    res.json(response);
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ message: 'This child is already linked to the account.' });
    next(error);
  } finally {
    client?.release();
  }
};

module.exports = {
  getChildren, getDashboard, getFees, getFeeding, getResults, getAttendance,
  getTimetable, getAnnouncements, getProfile, updateProfile, updatePreferences,
  getReceipt, getAdminParents, createAdminParent, reissueParentAccess, manageAdminParent, removeAdminParentLink,
  requireActiveParent, getEnquiries, createEnquiry, getAdminEnquiries, updateAdminEnquiry,
};
