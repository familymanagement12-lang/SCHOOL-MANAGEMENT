const pool = require('../config/db');
const { PATHWAY_CHOICES, canonicalClassName } = require('../services/curriculumPolicy');
const {
  isValidPathway,
  isValidPathwayStage,
  isInitialSelectionEligible,
  matchesApprovedDestination,
} = require('../services/curriculumSelectionPolicy');

const pathway = (value) => String(value || '').toUpperCase();

const audit = (client, { schoolId, parentUserId, studentId, actorId, action, details }) => client.query(
  `INSERT INTO parent_portal_audit_log
     (school_id, parent_user_id, student_id, actor_id, action, details)
   VALUES ($1, $2, $3, $4, $5, $6::JSONB)`,
  [schoolId, parentUserId, studentId, actorId, action, JSON.stringify(details || {})]
);

const notifyGuardians = async (client, { schoolId, studentId, academicYear, eventKey, title, message }) => {
  const guardians = await client.query(
    `SELECT DISTINCT u.id
     FROM student_parent sp
     JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
     JOIN users u ON u.id = p.user_id AND u.school_id = p.school_id
     WHERE sp.school_id = $1 AND sp.student_id = $2
       AND u.role = 'parent' AND u.is_active = TRUE`,
    [schoolId, studentId]
  );
  for (const guardian of guardians.rows) {
    const logged = await client.query(
      `INSERT INTO curriculum_selection_notification_log
         (school_id, user_id, student_id, academic_year, event_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id, user_id, student_id, academic_year, event_key) DO NOTHING
       RETURNING id`,
      [schoolId, guardian.id, studentId, academicYear, eventKey]
    );
    if (logged.rowCount) {
      await client.query(
        `INSERT INTO notifications (school_id, user_id, title, message)
         VALUES ($1, $2, $3, $4)`,
        [schoolId, guardian.id, title, message]
      );
    }
  }
};

const getParentSelections = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.id AS student_id, s.name, LPAD(s.id::TEXT, 6, '0') AS admission_number,
              s.class_id, s.curriculum, c.name AS class_name, c.year_level,
              c.education_stage AS class_education_stage,
              sc.academic_year,
              p.opens_at, p.deadline, p.enabled AS period_enabled,
              current_selection.id AS selection_id,
              current_selection.request_type, current_selection.selected_curriculum,
              current_selection.status, current_selection.reason,
              current_selection.rejection_reason, current_selection.submitted_at,
              current_selection.assigned_class_id,
              assigned_class.name AS assigned_class_name,
              assigned_class.year_level AS assigned_year_level,
              assigned_class.curriculum AS assigned_curriculum,
              assigned_class.education_stage AS assigned_education_stage
       FROM student_parent sp
       JOIN parents parent ON parent.id = sp.parent_id AND parent.school_id = sp.school_id
       JOIN users pu ON pu.id = parent.user_id AND pu.school_id = parent.school_id
         AND pu.role = 'parent' AND pu.is_active = TRUE
       JOIN students s ON s.id = sp.student_id AND s.school_id = sp.school_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       JOIN schools sc ON sc.id = s.school_id
       LEFT JOIN curriculum_selection_periods p
         ON p.school_id = sc.id AND p.academic_year = sc.academic_year
       LEFT JOIN LATERAL (
         SELECT selection.*
         FROM curriculum_pathway_selections selection
         WHERE selection.school_id = s.school_id
           AND selection.student_id = s.id
           AND selection.academic_year = sc.academic_year
         ORDER BY selection.submitted_at DESC, selection.id DESC
         LIMIT 1
       ) current_selection ON TRUE
       LEFT JOIN classes assigned_class
         ON assigned_class.id = current_selection.assigned_class_id
        AND assigned_class.school_id = s.school_id
       WHERE sp.school_id = $1 AND parent.user_id = $2
       ORDER BY s.name, s.id`,
      [req.user.school_id, req.user.id]
    );
    const children = result.rows.map((row) => ({
      ...row,
      class_name: canonicalClassName(row.class_name, row.year_level, row.curriculum, row.class_education_stage),
      assigned_class_name: row.assigned_class_name
        ? canonicalClassName(
          row.assigned_class_name,
          row.assigned_year_level,
          row.assigned_curriculum,
          row.assigned_education_stage
        )
        : null,
    }));
    await pool.query(
      `INSERT INTO parent_portal_audit_log
         (school_id, parent_user_id, actor_id, action, details)
       VALUES ($1, $2, $2, 'CURRICULUM_SELECTIONS_VIEWED', $3::JSONB)`,
      [req.user.school_id, req.user.id, JSON.stringify({ academic_year: children[0]?.academic_year || null })]
    );
    res.json({
      pathways: PATHWAY_CHOICES,
      academic_year: children[0]?.academic_year || null,
      selection_period: children[0]?.opens_at ? {
        opens_at: children[0].opens_at,
        deadline: children[0].deadline,
        enabled: children[0].period_enabled,
      } : null,
      children,
    });
  } catch (error) {
    next(error);
  }
};

const submitSelection = async (req, res, next) => {
  const studentId = Number(req.params.studentId);
  const selectedCurriculum = pathway(req.body.curriculum);
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!Number.isSafeInteger(studentId) || studentId <= 0 || !isValidPathway(selectedCurriculum)) {
    return res.status(400).json({ message: 'Choose a linked child and select GES or Pearson.' });
  }
  if (reason.length > 1000) return res.status(400).json({ message: 'Reason must be 1,000 characters or fewer.' });

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const childResult = await client.query(
      `SELECT s.id, s.name, s.class_id, s.curriculum, c.year_level,
              c.curriculum AS class_curriculum, c.education_stage AS class_education_stage,
              sc.academic_year,
              EXISTS (
                SELECT 1 FROM curriculum_selection_periods period
                WHERE period.school_id = s.school_id
                  AND period.academic_year = sc.academic_year
                  AND period.enabled = TRUE
                  AND NOW() BETWEEN period.opens_at AND period.deadline
              ) AS period_open
       FROM students s
       JOIN student_parent sp ON sp.student_id = s.id AND sp.school_id = s.school_id
       JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       JOIN schools sc ON sc.id = s.school_id
       WHERE s.school_id = $1 AND p.user_id = $2 AND s.id = $3
       FOR UPDATE OF s`,
      [req.user.school_id, req.user.id, studentId]
    );
    if (!childResult.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Child not found in your linked accounts.' });
    }
    const child = childResult.rows[0];
    if (!child.period_open) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'Curriculum selections are not currently open for this academic year.' });
    }
    if (!isInitialSelectionEligible(child) || child.curriculum !== 'COMMON') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'Initial pathway selection is only available to students assigned to Year 6 in the Common curriculum.' });
    }

    const inserted = await client.query(
      `INSERT INTO curriculum_pathway_selections
         (school_id, student_id, student_name_snapshot, admission_number_snapshot,
          parent_user_id, academic_year, request_type, selected_curriculum,
          previous_curriculum, reason)
       VALUES ($1, $2, $3, LPAD($2::TEXT, 6, '0'), $4, $5,
               'initial_selection', $6, 'COMMON', $7)
       RETURNING id, status, submitted_at`,
      [req.user.school_id, studentId, child.name, req.user.id, child.academic_year, selectedCurriculum, reason || null]
    );
    await audit(client, {
      schoolId: req.user.school_id,
      parentUserId: req.user.id,
      studentId,
      actorId: req.user.id,
      action: 'CURRICULUM_SELECTION_SUBMITTED',
      details: { selection_id: inserted.rows[0].id, curriculum: selectedCurriculum, academic_year: child.academic_year },
    });
    await notifyGuardians(client, {
      schoolId: req.user.school_id,
      studentId,
      academicYear: child.academic_year,
      eventKey: `selection-submitted:${inserted.rows[0].id}`,
      title: 'Curriculum selection submitted',
      message: `${child.name}'s ${selectedCurriculum === 'GES' ? 'GES' : 'Pearson'} pathway selection for ${child.academic_year} is awaiting school approval.`,
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ message: 'A pathway selection is already active for this child and academic year.' });
    }
    next(error);
  } finally {
    client?.release();
  }
};

const submitChangeRequest = async (req, res, next) => {
  const studentId = Number(req.params.studentId);
  const selectedCurriculum = pathway(req.body.curriculum);
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!Number.isSafeInteger(studentId) || studentId <= 0 || !isValidPathway(selectedCurriculum)) {
    return res.status(400).json({ message: 'Choose a linked child and select GES or Pearson.' });
  }
  if (reason.length < 10 || reason.length > 1000) {
    return res.status(400).json({ message: 'Explain the pathway change in 10 to 1,000 characters.' });
  }

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const childResult = await client.query(
      `      SELECT s.id, s.name, s.class_id, s.curriculum, c.year_level,
             c.education_stage AS class_education_stage, sc.academic_year
       FROM students s
       JOIN student_parent sp ON sp.student_id = s.id AND sp.school_id = s.school_id
       JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       JOIN schools sc ON sc.id = s.school_id
       WHERE s.school_id = $1 AND p.user_id = $2 AND s.id = $3
       FOR UPDATE OF s`,
      [req.user.school_id, req.user.id, studentId]
    );
    if (!childResult.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Child not found in your linked accounts.' });
    }
    const child = childResult.rows[0];
    if (!['GES', 'PEARSON'].includes(child.curriculum)
        || child.curriculum === selectedCurriculum
        || !isValidPathwayStage(child.year_level, selectedCurriculum, child.class_education_stage)) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'A pathway change must be different from the current curriculum and available for the child’s current class level.' });
    }

    const inserted = await client.query(
      `INSERT INTO curriculum_pathway_selections
         (school_id, student_id, student_name_snapshot, admission_number_snapshot,
          parent_user_id, academic_year, request_type, selected_curriculum,
          previous_curriculum, reason)
       VALUES ($1, $2, $3, LPAD($2::TEXT, 6, '0'), $4, $5,
               'change_request', $6, $7, $8)
       RETURNING id, status, submitted_at`,
      [req.user.school_id, studentId, child.name, req.user.id, child.academic_year, selectedCurriculum, child.curriculum, reason]
    );
    await audit(client, {
      schoolId: req.user.school_id,
      parentUserId: req.user.id,
      studentId,
      actorId: req.user.id,
      action: 'CURRICULUM_CHANGE_REQUESTED',
      details: { selection_id: inserted.rows[0].id, from: child.curriculum, to: selectedCurriculum, reason },
    });
    await notifyGuardians(client, {
      schoolId: req.user.school_id,
      studentId,
      academicYear: child.academic_year,
      eventKey: `change-request-submitted:${inserted.rows[0].id}`,
      title: 'Curriculum change requested',
      message: `${child.name}'s request to change from ${child.curriculum} to ${selectedCurriculum} is awaiting school approval.`,
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ message: 'A curriculum change request is already awaiting a decision.' });
    }
    next(error);
  } finally {
    client?.release();
  }
};

const getAdminSelections = async (req, res, next) => {
  try {
    const academicYearResult = await pool.query(
      'SELECT academic_year FROM schools WHERE id = $1',
      [req.user.school_id]
    );
    if (!academicYearResult.rowCount) return res.status(404).json({ message: 'School not found.' });
    const academicYear = req.query.academic_year || academicYearResult.rows[0].academic_year;
    const [period, selections, classes] = await Promise.all([
      pool.query(
        `SELECT academic_year, opens_at, deadline, reminder_interval_days, enabled
         FROM curriculum_selection_periods
         WHERE school_id = $1 AND academic_year = $2`,
        [req.user.school_id, academicYear]
      ),
      pool.query(
        `SELECT selection.id, selection.student_id, selection.student_name_snapshot,
                selection.admission_number_snapshot, selection.parent_user_id,
                parent.name AS parent_name, selection.academic_year,
                selection.request_type, selection.selected_curriculum,
                selection.previous_curriculum, selection.reason, selection.status,
                selection.submitted_at, selection.reviewed_at,
                selection.rejection_reason, selection.assigned_class_id,
                selection.assigned_at, student.class_id AS current_class_id,
                student.curriculum AS current_curriculum, current_class.year_level AS current_year_level,
                current_class.education_stage AS current_education_stage,
                current_class.name AS current_class_name
         FROM curriculum_pathway_selections selection
         LEFT JOIN users parent ON parent.id = selection.parent_user_id
           AND parent.school_id = selection.school_id
         LEFT JOIN students student ON student.id = selection.student_id
           AND student.school_id = selection.school_id
         LEFT JOIN classes current_class ON current_class.id = student.class_id
           AND current_class.school_id = student.school_id
         WHERE selection.school_id = $1 AND selection.academic_year = $2
         ORDER BY CASE selection.status
                    WHEN 'pending_approval' THEN 0
                    WHEN 'approved_pending_class' THEN 1
                    WHEN 'rejected' THEN 2
                    ELSE 3
                  END, selection.submitted_at DESC
         LIMIT 300`,
        [req.user.school_id, academicYear]
      ),
      pool.query(
        `SELECT id, name, year_level, curriculum, education_stage
         FROM classes
         WHERE school_id = $1 AND education_stage IN ('JHS', 'OTHER') AND year_level BETWEEN 7 AND 11
           AND curriculum IN ('GES', 'PEARSON')
           AND (curriculum <> 'GES' OR education_stage = 'JHS')
         ORDER BY curriculum, year_level, name, id`,
        [req.user.school_id]
      ),
    ]);
    res.json({
      academic_year: academicYear,
      default_academic_year: academicYearResult.rows[0].academic_year,
      period: period.rows[0] || null,
      selections: selections.rows.map((selection) => ({
        ...selection,
        current_class_name: canonicalClassName(
          selection.current_class_name,
          selection.current_year_level,
          selection.current_curriculum,
          selection.current_education_stage,
        ),
      })),
      classes: classes.rows.map((classItem) => ({
        ...classItem,
        name: canonicalClassName(classItem.name, classItem.year_level, classItem.curriculum, classItem.education_stage),
      })),
    });
  } catch (error) {
    next(error);
  }
};

const saveSelectionPeriod = async (req, res, next) => {
  const academicYear = typeof req.body.academic_year === 'string' ? req.body.academic_year.trim() : '';
  const opensAt = new Date(req.body.opens_at);
  const deadline = new Date(req.body.deadline);
  const reminderInterval = Number(req.body.reminder_interval_days);
  const enabled = req.body.enabled !== false;
  if (!academicYear || academicYear.length > 32
      || Number.isNaN(opensAt.getTime()) || Number.isNaN(deadline.getTime())
      || deadline <= opensAt || !Number.isInteger(reminderInterval)
      || reminderInterval < 1 || reminderInterval > 30) {
    return res.status(400).json({ message: 'Provide a valid academic year, opening and deadline dates, and a reminder interval from 1 to 30 days.' });
  }

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const result = await client.query(
      `INSERT INTO curriculum_selection_periods
         (school_id, academic_year, opens_at, deadline, reminder_interval_days,
          enabled, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (school_id, academic_year)
       DO UPDATE SET opens_at = EXCLUDED.opens_at,
                     deadline = EXCLUDED.deadline,
                     reminder_interval_days = EXCLUDED.reminder_interval_days,
                     enabled = EXCLUDED.enabled,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW()
       RETURNING academic_year, opens_at, deadline, reminder_interval_days, enabled`,
      [req.user.school_id, academicYear, opensAt.toISOString(), deadline.toISOString(), reminderInterval, enabled, req.user.id]
    );
    await audit(client, {
      schoolId: req.user.school_id,
      parentUserId: null,
      studentId: null,
      actorId: req.user.id,
      action: 'CURRICULUM_SELECTION_PERIOD_UPDATED',
      details: {
        academic_year: academicYear,
        opens_at: opensAt.toISOString(),
        deadline: deadline.toISOString(),
        reminder_interval_days: reminderInterval,
        enabled,
      },
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.json(result.rows[0]);
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally {
    client?.release();
  }
};

const decideSelection = async (req, res, next) => {
  const selectionId = Number(req.params.selectionId);
  const decision = req.body.decision;
  const rejectionReason = typeof req.body.rejection_reason === 'string'
    ? req.body.rejection_reason.trim() : '';
  if (!Number.isSafeInteger(selectionId) || selectionId <= 0
      || !['approve', 'reject'].includes(decision)
      || (decision === 'reject' && (!rejectionReason || rejectionReason.length > 1000))) {
    return res.status(400).json({ message: 'Choose approve or reject; a rejection must include a reason of 1,000 characters or fewer.' });
  }

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const selectionResult = await client.query(
      `SELECT id, student_id, student_name_snapshot, parent_user_id,
              academic_year, request_type, selected_curriculum, status
       FROM curriculum_pathway_selections
       WHERE id = $1 AND school_id = $2
       FOR UPDATE`,
      [selectionId, req.user.school_id]
    );
    if (!selectionResult.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Curriculum request not found.' });
    }
    const selection = selectionResult.rows[0];
    if (selection.status !== 'pending_approval') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'Only requests awaiting approval can be reviewed.' });
    }
    const status = decision === 'approve' ? 'approved_pending_class' : 'rejected';
    await client.query(
      `UPDATE curriculum_pathway_selections
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(),
           rejection_reason = $3, updated_at = NOW()
       WHERE id = $4 AND school_id = $5`,
      [status, req.user.id, decision === 'reject' ? rejectionReason : null, selectionId, req.user.school_id]
    );
    await audit(client, {
      schoolId: req.user.school_id,
      parentUserId: selection.parent_user_id,
      studentId: selection.student_id,
      actorId: req.user.id,
      action: decision === 'approve' ? 'CURRICULUM_SELECTION_APPROVED' : 'CURRICULUM_SELECTION_REJECTED',
      details: { selection_id: selectionId, rejection_reason: decision === 'reject' ? rejectionReason : null },
    });
    const message = decision === 'approve'
      ? `${selection.student_name_snapshot}'s ${selection.selected_curriculum} pathway request was approved. The school will assign a matching class.`
      : `${selection.student_name_snapshot}'s ${selection.selected_curriculum} pathway request was not approved. Reason: ${rejectionReason}`;
    if (selection.student_id) {
      await notifyGuardians(client, {
        schoolId: req.user.school_id,
        studentId: selection.student_id,
        academicYear: selection.academic_year,
        eventKey: `selection-${decision}:${selectionId}`,
        title: decision === 'approve' ? 'Curriculum selection approved' : 'Curriculum selection declined',
        message,
      });
    }
    await client.query('COMMIT');
    transactionOpen = false;
    res.json({ id: selectionId, status, rejection_reason: decision === 'reject' ? rejectionReason : null });
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally {
    client?.release();
  }
};

const assignSelectionClass = async (req, res, next) => {
  const selectionId = Number(req.params.selectionId);
  const classId = Number(req.body.class_id);
  if (!Number.isSafeInteger(selectionId) || selectionId <= 0
      || !Number.isSafeInteger(classId) || classId <= 0) {
    return res.status(400).json({ message: 'Choose a valid curriculum request and destination class.' });
  }

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const selectionResult = await client.query(
      `SELECT selection.id, selection.student_id, selection.student_name_snapshot,
              selection.parent_user_id, selection.academic_year,
              selection.request_type, selection.selected_curriculum,
              selection.previous_curriculum, selection.status,
              student.class_id AS current_class_id, student.curriculum AS current_curriculum,
              current_class.year_level AS current_year_level,
              current_class.curriculum AS current_class_curriculum,
              current_class.education_stage AS current_education_stage
       FROM curriculum_pathway_selections selection
       JOIN students student ON student.id = selection.student_id
         AND student.school_id = selection.school_id
       LEFT JOIN classes current_class ON current_class.id = student.class_id
         AND current_class.school_id = student.school_id
       WHERE selection.id = $1 AND selection.school_id = $2
       FOR UPDATE OF selection, student`,
      [selectionId, req.user.school_id]
    );
    if (!selectionResult.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Curriculum request or linked student not found.' });
    }
    const selection = selectionResult.rows[0];
    if (selection.status !== 'approved_pending_class') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'The request must be approved before assigning a class.' });
    }
    const targetYear = selection.request_type === 'initial_selection'
      ? 7 : Number(selection.current_year_level);
    if (selection.request_type === 'initial_selection'
        && (Number(selection.current_year_level) !== 6
          || selection.current_curriculum !== 'COMMON'
          || selection.current_class_curriculum !== 'COMMON'
          || selection.current_education_stage !== 'PRIMARY')) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'The student is no longer assigned to the Year 6 Common class for this initial transition.' });
    }
    if (selection.request_type === 'change_request'
        && selection.current_curriculum !== selection.previous_curriculum) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'The student’s curriculum changed after this request was submitted. Review the request again before assigning a class.' });
    }
    if (!isValidPathwayStage(targetYear, selection.selected_curriculum)) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message: 'No matching class stage exists for this pathway request.' });
    }

    const targetResult = await client.query(
      `SELECT id, name, year_level, curriculum, education_stage
       FROM classes
       WHERE id = $1 AND school_id = $2
       FOR UPDATE`,
      [classId, req.user.school_id]
    );
    if (!targetResult.rowCount
        || !matchesApprovedDestination(selection, { year_level: selection.current_year_level }, targetResult.rows[0])) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ message: `Choose a ${selection.selected_curriculum === 'GES' ? 'GES' : 'Pearson'} class at the student’s current pathway stage.` });
    }

    await client.query(
      `SELECT set_config('app.class_change_reason', $1, TRUE)`,
      [`curriculum_${selection.request_type}`]
    );
    await client.query(
      `UPDATE students SET class_id = $1
       WHERE id = $2 AND school_id = $3`,
      [classId, selection.student_id, req.user.school_id]
    );
    await client.query(
      `UPDATE curriculum_pathway_selections
       SET status = 'assigned', assigned_class_id = $1, assigned_by = $2,
           assigned_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND school_id = $4`,
      [classId, req.user.id, selectionId, req.user.school_id]
    );
    await audit(client, {
      schoolId: req.user.school_id,
      parentUserId: selection.parent_user_id,
      studentId: selection.student_id,
      actorId: req.user.id,
      action: 'CURRICULUM_CLASS_ASSIGNED',
      details: {
        selection_id: selectionId,
        class_id: classId,
        curriculum: selection.selected_curriculum,
        year_level: targetYear,
      },
    });
    const className = canonicalClassName(
      targetResult.rows[0].name,
      targetYear,
      selection.selected_curriculum,
      targetResult.rows[0].education_stage
    );
    await notifyGuardians(client, {
      schoolId: req.user.school_id,
      studentId: selection.student_id,
      academicYear: selection.academic_year,
      eventKey: `class-assigned:${selectionId}`,
      title: 'Curriculum class assigned',
      message: `${selection.student_name_snapshot} has been assigned to ${className} for the ${selection.selected_curriculum} pathway.`,
    });
    await client.query('COMMIT');
    transactionOpen = false;
    res.json({ id: selectionId, status: 'assigned', class_id: classId, class_name: className });
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally {
    client?.release();
  }
};

module.exports = {
  getParentSelections,
  submitSelection,
  submitChangeRequest,
  getAdminSelections,
  saveSelectionPeriod,
  decideSelection,
  assignSelectionClass,
};
