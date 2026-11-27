const pool = require('../config/db');
const assignmentStorage = require('../services/assignmentStorage');
const { MAX_FILES_PER_UPLOAD } = assignmentStorage;
const { validateAssignmentInput, canSubmit } = require('../services/assignmentPolicy');

const isPositiveId = (value) => /^\d+$/.test(String(value))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const schoolLocalDateTimeSql = (parameter) => `(${parameter}::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'Africa/Accra')`;

const audit = (client, schoolId, assignmentId, actorId, action, details = {}) => client.query(
  `INSERT INTO assignment_audit_log (school_id, assignment_id, actor_id, action, details)
   VALUES ($1,$2,$3,$4,$5::JSONB)`,
  [schoolId, assignmentId, actorId, action, JSON.stringify(details)]
);

const getAssignmentForUser = async (db, schoolId, assignmentId, user) => {
  if (!isPositiveId(assignmentId)) return null;
  const result = await db.query(
    `SELECT a.*, c.name AS class_name, s.name AS subject_name, u.name AS teacher_name
     FROM learning_assignments a
     JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
     JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
     JOIN users u ON u.id=a.teacher_id AND u.school_id=a.school_id
     WHERE a.school_id=$1 AND a.id=$2
       AND ($3::TEXT='admin' OR a.teacher_id=$4 OR EXISTS (
         SELECT 1 FROM teacher_subject_assignments tsa
         WHERE tsa.school_id=a.school_id AND tsa.term_id=a.term_id
           AND tsa.class_id=a.class_id AND tsa.subject_id=a.subject_id
           AND tsa.teacher_id=$4
       ) OR EXISTS (
         SELECT 1 FROM timetable_class_teacher_assignments tca
         JOIN subject_weekly_requirements r
           ON r.school_id=tca.school_id AND r.term_id=tca.term_id
            AND r.class_id=tca.class_id AND r.subject_id=a.subject_id
         WHERE tca.school_id=a.school_id AND tca.term_id=a.term_id
           AND tca.class_id=a.class_id AND tca.teacher_id=$4
       ))`,
    [schoolId, assignmentId, user.role, user.id]
  );
  return result.rows[0] || null;
};

const teacherCanTeach = async (db, { schoolId, teacherId, classId, subjectId, termId }) => {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM users u WHERE u.id=$2 AND u.school_id=$1
         AND u.role='teacher' AND u.is_active=TRUE
         AND (
           EXISTS (
             SELECT 1 FROM teacher_subject_assignments tsa
             WHERE tsa.school_id=$1 AND tsa.term_id=$5 AND tsa.teacher_id=u.id
               AND tsa.class_id=$3 AND tsa.subject_id=$4
           )
           OR EXISTS (
             SELECT 1 FROM timetable_class_teacher_assignments tca
             JOIN subject_weekly_requirements r
               ON r.school_id=tca.school_id AND r.term_id=tca.term_id
                AND r.class_id=tca.class_id AND r.subject_id=$4
             WHERE tca.school_id=$1 AND tca.term_id=$5
               AND tca.class_id=$3 AND tca.teacher_id=u.id
           )
         )
     ) AS allowed`,
    [schoolId, teacherId, classId, subjectId, termId]
  );
  return result.rows[0]?.allowed === true;
};

const getAssignmentTerm = async (db, schoolId, termId) => {
  const result = await db.query(
    `SELECT id, academic_year, term FROM timetable_terms WHERE school_id=$1 AND id=$2`,
    [schoolId, termId]
  );
  return result.rows[0] || null;
};

const replaceDraftRecipients = async (db, { schoolId, assignmentId, classId, studentIds }) => {
  const students = await db.query(
    `SELECT id FROM students WHERE school_id=$1 AND class_id=$2
     AND ($3::INTEGER[] IS NULL OR id=ANY($3::INTEGER[]))
     ORDER BY id`,
    [schoolId, classId, studentIds]
  );
  if (studentIds && students.rowCount !== studentIds.length) {
    return { error: { status: 400, message: 'Every selected student must belong to this class.' } };
  }
  await db.query('DELETE FROM assignment_recipients WHERE school_id=$1 AND assignment_id=$2', [schoolId, assignmentId]);
  for (const student of students.rows) {
    await db.query(
      `INSERT INTO assignment_recipients (school_id, assignment_id, class_id, student_id)
       VALUES ($1,$2,$3,$4)`,
      [schoolId, assignmentId, classId, student.id]
    );
  }
  return { count: students.rowCount };
};

const getMeta = async (req, res, next) => {
  const { school_id: schoolId, id: userId, role } = req.user;
  if (req.query.term_id && !isPositiveId(req.query.term_id)) {
    return res.status(400).json({ message: 'Choose a valid academic term.' });
  }
  try {
    const terms = await pool.query(
      `SELECT tt.id, tt.academic_year, tt.term,
              (tt.academic_year=sc.academic_year AND tt.term=sc.current_term) AS is_current
       FROM timetable_terms tt JOIN schools sc ON sc.id=tt.school_id
       WHERE tt.school_id=$1
       ORDER BY tt.academic_year DESC, tt.term`,
      [schoolId]
    );
    const termId = req.query.term_id || terms.rows.find((item) => item.is_current)?.id || terms.rows[0]?.id;
    if (!termId) return res.json({
      terms: terms.rows, selected_term_id: null, classes: [], assignments: [], students: [], teachers: [],
    });
    if (!terms.rows.some((item) => String(item.id) === String(termId))) {
      return res.status(400).json({ message: 'The selected term does not belong to this school.' });
    }
    const pairs = await pool.query(
      `SELECT DISTINCT c.id AS class_id, c.name AS class_name, c.year_level,
              c.curriculum, s.id AS subject_id, s.name AS subject_name,
              COALESCE(tsa.teacher_id, tca.teacher_id) AS assigned_teacher_id
       FROM subject_weekly_requirements r
       JOIN classes c ON c.id=r.class_id AND c.school_id=r.school_id
       JOIN subjects s ON s.id=r.subject_id AND s.school_id=r.school_id
       LEFT JOIN teacher_subject_assignments tsa
         ON tsa.school_id=r.school_id AND tsa.term_id=r.term_id
          AND tsa.class_id=r.class_id AND tsa.subject_id=r.subject_id
          AND ($3::TEXT='admin' OR tsa.teacher_id=$4)
       LEFT JOIN timetable_class_teacher_assignments tca
         ON tca.school_id=r.school_id AND tca.term_id=r.term_id AND tca.class_id=r.class_id
          AND ($3::TEXT='admin' OR tca.teacher_id=$4)
       WHERE r.school_id=$1 AND r.term_id=$2
         AND ($3::TEXT='admin' OR tsa.teacher_id=$4 OR tca.teacher_id=$4)
       ORDER BY c.name, s.name`,
      [schoolId, termId, role, userId]
    );
    const students = await pool.query(
      `SELECT s.id, s.class_id, s.name, LPAD(s.id::TEXT,6,'0') AS student_id
       FROM students s JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id
       WHERE s.school_id=$1 AND c.id IN (
         SELECT DISTINCT r.class_id FROM subject_weekly_requirements r
         LEFT JOIN teacher_subject_assignments tsa ON tsa.school_id=r.school_id
           AND tsa.term_id=r.term_id AND tsa.class_id=r.class_id AND tsa.subject_id=r.subject_id
         LEFT JOIN timetable_class_teacher_assignments tca ON tca.school_id=r.school_id
           AND tca.term_id=r.term_id AND tca.class_id=r.class_id
         WHERE r.school_id=$1 AND r.term_id=$2
           AND ($3::TEXT='admin' OR tsa.teacher_id=$4 OR tca.teacher_id=$4)
       )
       ORDER BY c.name, s.name`,
      [schoolId, termId, role, userId]
    );
    const teachers = await pool.query(
      `SELECT DISTINCT u.id,u.name,tsa.class_id,tsa.subject_id
       FROM teacher_subject_assignments tsa
       JOIN users u ON u.id=tsa.teacher_id AND u.school_id=tsa.school_id
         AND u.role='teacher' AND u.is_active=TRUE
       WHERE tsa.school_id=$1 AND tsa.term_id=$2
         AND ($3::TEXT='admin' OR u.id=$4)
       UNION
       SELECT DISTINCT u.id,u.name,tca.class_id,r.subject_id
       FROM timetable_class_teacher_assignments tca
       JOIN subject_weekly_requirements r ON r.school_id=tca.school_id
         AND r.term_id=tca.term_id AND r.class_id=tca.class_id
       JOIN users u ON u.id=tca.teacher_id AND u.school_id=tca.school_id
         AND u.role='teacher' AND u.is_active=TRUE
       WHERE tca.school_id=$1 AND tca.term_id=$2
         AND ($3::TEXT='admin' OR u.id=$4)
       ORDER BY name`,
      [schoolId, termId, role, userId]
    );
    res.json({
      terms: terms.rows,
      selected_term_id: Number(termId),
      assignments: pairs.rows,
      classes: [...new Map(pairs.rows.map((item) => [item.class_id, {
        id: item.class_id, name: item.class_name, year_level: item.year_level, curriculum: item.curriculum,
      }])).values()],
      students: students.rows,
      teachers: teachers.rows,
    });
  } catch (error) {
    next(error);
  }
};

const listAssignments = async (req, res, next) => {
  if (req.query.term_id && !isPositiveId(req.query.term_id)) {
    return res.status(400).json({ message: 'Choose a valid academic term.' });
  }
  try {
    const result = await pool.query(
      `SELECT a.id, a.title, a.category, a.status, a.due_at, a.issue_at, a.total_marks,
              a.submission_method, a.academic_year, a.term, a.class_id, c.name AS class_name,
              a.teacher_id, s.name AS subject_name, u.name AS teacher_name,
              COUNT(DISTINCT r.id)::INTEGER AS assigned_count,
              COUNT(DISTINCT sub.id) FILTER (WHERE sub.status IN
                ('SUBMITTED','SUBMITTED_LATE','AWAITING_MARKING','MARKED','RETURNED'))::INTEGER AS submitted_count,
              COUNT(DISTINCT sub.id) FILTER (WHERE sub.status IN
                ('AWAITING_MARKING','SUBMITTED','SUBMITTED_LATE'))::INTEGER AS awaiting_marking_count,
              COALESCE(array_agg(DISTINCT r.student_id) FILTER (WHERE r.student_id IS NOT NULL), '{}')
                AS recipient_student_ids
       FROM learning_assignments a
       JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
       JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
       JOIN users u ON u.id=a.teacher_id AND u.school_id=a.school_id
       LEFT JOIN assignment_recipients r ON r.school_id=a.school_id AND r.assignment_id=a.id
       LEFT JOIN assignment_submissions sub ON sub.school_id=r.school_id AND sub.assignment_id=r.assignment_id AND sub.student_id=r.student_id
       WHERE a.school_id=$1 AND ($4::BIGINT IS NULL OR a.term_id=$4) AND (
         $2::TEXT='admin' OR a.teacher_id=$3 OR EXISTS (
           SELECT 1 FROM teacher_subject_assignments tsa
           WHERE tsa.school_id=a.school_id AND tsa.term_id=a.term_id AND tsa.class_id=a.class_id
             AND tsa.subject_id=a.subject_id AND tsa.teacher_id=$3
         ) OR EXISTS (
           SELECT 1 FROM timetable_class_teacher_assignments tca
           JOIN subject_weekly_requirements r
             ON r.school_id=tca.school_id AND r.term_id=tca.term_id
              AND r.class_id=tca.class_id AND r.subject_id=a.subject_id
           WHERE tca.school_id=a.school_id AND tca.term_id=a.term_id
             AND tca.class_id=a.class_id AND tca.teacher_id=$3
         )
       )
       GROUP BY a.id, c.name, s.name, u.name
       ORDER BY a.created_at DESC, a.id DESC`,
      [req.user.school_id, req.user.role, req.user.id, req.query.term_id || null]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createAssignment = async (req, res, next) => {
  const { school_id: schoolId, id: actorId, role } = req.user;
  const parsed = validateAssignmentInput(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const classId = Number(req.body.class_id), subjectId = Number(req.body.subject_id), termId = Number(req.body.term_id);
  const teacherId = role === 'teacher' ? actorId : Number(req.body.teacher_id);
  if (![classId, subjectId, termId, teacherId].every(isPositiveId)) {
    return res.status(400).json({ message: 'Select a configured term, class, subject, and assigned teacher.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const term = await getAssignmentTerm(client, schoolId, termId);
    if (!term) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Choose a configured academic year and term.' });
    }
    if (!await teacherCanTeach(client, { schoolId, teacherId, classId, subjectId, termId })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'You are not assigned to teach this subject in this class for the selected term.' });
    }
    const input = parsed.value;
    const inserted = await client.query(
      `INSERT INTO learning_assignments
       (school_id,teacher_id,class_id,subject_id,academic_year,term,term_id,title,instructions,category,
        issue_at,due_at,total_marks,submission_method,allow_late,allow_resubmission)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         CASE WHEN $11::TIMESTAMP IS NULL THEN NULL ELSE ${schoolLocalDateTimeSql('$11')} END,
         ${schoolLocalDateTimeSql('$12')},$13,$14,$15,$16)
       RETURNING id`,
      [schoolId, teacherId, classId, subjectId, term.academic_year, term.term, termId,
        input.title, input.instructions, input.category, input.issue_at, input.due_at,
        input.total_marks, input.submission_method, input.allow_late, input.allow_resubmission]
    );
    const assignmentId = inserted.rows[0].id;
    const recipientResult = await replaceDraftRecipients(client, {
      schoolId, assignmentId, classId, studentIds: input.selected_student_ids,
    });
    if (recipientResult.error) {
      await client.query('ROLLBACK');
      return res.status(recipientResult.error.status).json({ message: recipientResult.error.message });
    }
    await audit(client, schoolId, assignmentId, actorId, 'CREATED', { recipient_count: recipientResult.count });
    await client.query('COMMIT');
    res.status(201).json({ id: assignmentId, status: 'DRAFT', recipient_count: recipientResult.count });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const updateAssignment = async (req, res, next) => {
  const { school_id: schoolId, id: actorId, role } = req.user;
  const parsed = validateAssignmentInput(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const classId = Number(req.body.class_id), subjectId = Number(req.body.subject_id), termId = Number(req.body.term_id);
  const teacherId = role === 'teacher' ? actorId : Number(req.body.teacher_id);
  if (![classId, subjectId, termId, teacherId].every(isPositiveId)) {
    return res.status(400).json({ message: 'Select a configured term, class, subject, and assigned teacher.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id,status FROM learning_assignments WHERE school_id=$1 AND id=$2 FOR UPDATE`,
      [schoolId, req.params.id]
    );
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Assignment not found.' });
    }
    if (existing.rows[0].status !== 'DRAFT') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Published assignments cannot be edited in this version. Close this one and create a copy to preserve submitted work.' });
    }
    if (role !== 'admin' && !await getAssignmentForUser(client, schoolId, req.params.id, req.user)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'You are not authorized to edit this assignment.' });
    }
    const term = await getAssignmentTerm(client, schoolId, termId);
    if (!term || !await teacherCanTeach(client, { schoolId, teacherId, classId, subjectId, termId })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'The selected teacher, class, subject, or term is not a valid teaching allocation.' });
    }
    const input = parsed.value;
    await client.query(
      `UPDATE learning_assignments SET teacher_id=$3,class_id=$4,subject_id=$5,
       academic_year=$6,term=$7,term_id=$8,title=$9,instructions=$10,category=$11,
       issue_at=CASE WHEN $12::TIMESTAMP IS NULL THEN NULL ELSE ${schoolLocalDateTimeSql('$12')} END,
       due_at=${schoolLocalDateTimeSql('$13')},total_marks=$14,submission_method=$15,
       allow_late=$16,allow_resubmission=$17,updated_at=NOW()
       WHERE school_id=$1 AND id=$2`,
      [schoolId, req.params.id, teacherId, classId, subjectId, term.academic_year, term.term, termId,
        input.title, input.instructions, input.category, input.issue_at, input.due_at,
        input.total_marks, input.submission_method, input.allow_late, input.allow_resubmission]
    );
    const recipientResult = await replaceDraftRecipients(client, {
      schoolId, assignmentId: req.params.id, classId, studentIds: input.selected_student_ids,
    });
    if (recipientResult.error) {
      await client.query('ROLLBACK');
      return res.status(recipientResult.error.status).json({ message: recipientResult.error.message });
    }
    await audit(client, schoolId, req.params.id, actorId, 'UPDATED', { recipient_count: recipientResult.count });
    await client.query('COMMIT');
    res.json({ id: Number(req.params.id), status: 'DRAFT', recipient_count: recipientResult.count });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const publishAssignment = async (req, res, next) => {
  const { school_id: schoolId, id: actorId } = req.user;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getAssignmentForUser(client, schoolId, req.params.id, req.user);
    if (!assignment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Assignment not found or you are not authorized to publish it.' });
    }
    const locked = await client.query(
      `SELECT status, issue_at, (issue_at>NOW()) AS issue_is_future
       FROM learning_assignments WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [assignment.id, schoolId]
    );
    if (locked.rows[0].status !== 'DRAFT') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Only a draft assignment can be published.' });
    }
    if (locked.rows[0].issue_is_future) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'The issue date is in the future. Set it to now or earlier before publishing.' });
    }
    const recipients = await client.query(
      `SELECT id,student_id FROM assignment_recipients
       WHERE school_id=$1 AND assignment_id=$2 ORDER BY student_id`,
      [schoolId, assignment.id]
    );
    if (!recipients.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This class has no selected students. Add at least one recipient before publishing.' });
    }
    await client.query(
      `INSERT INTO assignment_submissions (school_id, assignment_id, recipient_id, student_id)
       SELECT school_id, assignment_id, id, student_id FROM assignment_recipients
       WHERE school_id=$1 AND assignment_id=$2
       ON CONFLICT (school_id, assignment_id, student_id) DO NOTHING`,
      [schoolId, assignment.id]
    );
    await client.query(
      `UPDATE learning_assignments SET status='PUBLISHED', published_at=NOW(),
       issue_at=COALESCE(issue_at,NOW()), updated_at=NOW() WHERE school_id=$1 AND id=$2`,
      [schoolId, assignment.id]
    );
    await client.query(
      `INSERT INTO notifications (school_id,user_id,title,message)
       SELECT $1,u.id,'New assignment',$2 FROM assignment_recipients r
       JOIN students s ON s.id=r.student_id AND s.school_id=r.school_id
       JOIN users u ON u.id=s.user_id AND u.school_id=s.school_id
       WHERE r.school_id=$1 AND r.assignment_id=$3`,
      [schoolId, `${assignment.title} is available in your Assignment Centre.`, assignment.id]
    );
    await audit(client, schoolId, assignment.id, actorId, 'PUBLISHED', { recipient_count: recipients.rowCount });
    await client.query('COMMIT');
    res.json({ message: 'Assignment published.', recipient_count: recipients.rowCount });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const getSubmissions = async (req, res, next) => {
  try {
    const assignment = await getAssignmentForUser(pool, req.user.school_id, req.params.id, req.user);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found or you are not authorized to view it.' });
    const result = await pool.query(
      `SELECT sub.id AS submission_id, sub.status, sub.draft_answer, sub.submitted_at,
              sub.latest_version, st.id AS student_id, LPAD(st.id::TEXT,6,'0') AS student_number,
              st.name AS student_name, v.id AS version_id, v.answer AS submitted_answer,
              v.is_late, v.submitted_at AS version_submitted_at,
              mark.score, mark.feedback, mark.private_notes, mark.status AS mark_status,
              COALESCE((SELECT json_agg(json_build_object(
                'id',f.id,'original_name',f.original_name,'content_type',f.content_type,'file_size',f.file_size
              )) FROM assignment_submission_files f
                WHERE f.school_id=sub.school_id AND f.submission_id=sub.id AND f.version_id=v.id),
                '[]'::json) AS files
       FROM assignment_submissions sub
       JOIN students st ON st.id=sub.student_id AND st.school_id=sub.school_id
       LEFT JOIN assignment_submission_versions v
         ON v.school_id=sub.school_id AND v.submission_id=sub.id AND v.version_number=sub.latest_version
       LEFT JOIN LATERAL (
         SELECT m.score,m.feedback,pn.private_notes,m.status FROM assignment_marks m
         LEFT JOIN assignment_mark_private_notes pn ON pn.school_id=m.school_id AND pn.mark_id=m.id
         WHERE m.school_id=sub.school_id AND m.submission_id=sub.id
         ORDER BY m.revision DESC LIMIT 1
       ) mark ON TRUE
       WHERE sub.school_id=$1 AND sub.assignment_id=$2
       ORDER BY st.name, st.id`,
      [req.user.school_id, assignment.id]
    );
    res.json({ assignment, submissions: result.rows });
  } catch (error) {
    next(error);
  }
};

const markSubmission = async (req, res, next) => {
  const { school_id: schoolId, id: actorId } = req.user;
  const { score, feedback = '', private_notes = '', release = false, request_resubmission = false } = req.body;
  const scoreProvided = (typeof score === 'number')
    || (typeof score === 'string' && score.trim() !== '');
  if (!isPositiveId(req.params.id) || !isPositiveId(req.params.submissionId)
    || !scoreProvided
    || !Number.isFinite(Number(score)) || Number(score) < 0
    || typeof feedback !== 'string' || typeof private_notes !== 'string'
    || typeof release !== 'boolean' || typeof request_resubmission !== 'boolean'
    || (release && request_resubmission)) {
    return res.status(400).json({ message: 'Enter a valid mark and choose either return or resubmission request.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getAssignmentForUser(client, schoolId, req.params.id, req.user);
    if (!assignment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Assignment not found or you are not authorized to mark it.' });
    }
    if (request_resubmission && !assignment.allow_resubmission) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Resubmissions are not enabled for this assignment.' });
    }
    const submission = await client.query(
      `SELECT * FROM assignment_submissions WHERE school_id=$1 AND assignment_id=$2 AND id=$3 FOR UPDATE`,
      [schoolId, assignment.id, req.params.submissionId]
    );
    if (!submission.rowCount || submission.rows[0].latest_version < 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This student has no submitted version to mark.' });
    }
    if (Number(score) > Number(assignment.total_marks)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Mark cannot exceed ${assignment.total_marks}.` });
    }
    const versionResult = await client.query(
      `SELECT id FROM assignment_submission_versions
       WHERE school_id=$1 AND submission_id=$2 AND version_number=$3`,
      [schoolId, submission.rows[0].id, submission.rows[0].latest_version]
    );
    const revisionResult = await client.query(
      `SELECT COALESCE(MAX(revision),0)+1 AS next_revision FROM assignment_marks WHERE school_id=$1 AND submission_id=$2`,
      [schoolId, submission.rows[0].id]
    );
    const markStatus = request_resubmission ? 'RESUBMISSION_REQUESTED' : release ? 'RELEASED' : 'DRAFT';
    const insertedMark = await client.query(
      `INSERT INTO assignment_marks
       (school_id,assignment_id,submission_id,version_id,revision,marked_by,score,feedback,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [schoolId, assignment.id, submission.rows[0].id, versionResult.rows[0].id,
        revisionResult.rows[0].next_revision, actorId, Number(score), feedback.trim(), markStatus]
    );
    if (private_notes.trim()) {
      await client.query(
        `INSERT INTO assignment_mark_private_notes (school_id,mark_id,private_notes)
         VALUES ($1,$2,$3)`, [schoolId,insertedMark.rows[0].id,private_notes.trim()]
      );
    }
    if (request_resubmission) {
      await client.query(
        `UPDATE assignment_submissions SET status='RESUBMISSION_REQUESTED',updated_at=NOW()
         WHERE school_id=$1 AND id=$2`,
        [schoolId, submission.rows[0].id]
      );
    } else if (release) {
      await client.query(
        `UPDATE assignment_submissions SET status='RETURNED',updated_at=NOW()
         WHERE school_id=$1 AND id=$2`,
        [schoolId, submission.rows[0].id]
      );
    } else {
      await client.query(
        `UPDATE assignment_submissions SET status='AWAITING_MARKING',updated_at=NOW()
         WHERE school_id=$1 AND id=$2`,
        [schoolId, submission.rows[0].id]
      );
    }
    if (release || request_resubmission) {
      await client.query(
        `INSERT INTO notifications (school_id,user_id,title,message)
         SELECT s.school_id,s.user_id,$3,$4 FROM students s
         WHERE s.id=$1 AND s.school_id=$2 AND s.user_id IS NOT NULL`,
        [submission.rows[0].student_id, schoolId,
          request_resubmission ? 'Assignment resubmission requested' : 'Assignment feedback released',
          request_resubmission ? `Your teacher has requested changes to ${assignment.title}.`
            : `Your marked work for ${assignment.title} is ready to view.`]
      );
    }
    await audit(client, schoolId, assignment.id, actorId,
      request_resubmission ? 'RESUBMISSION_REQUESTED' : release ? 'FEEDBACK_RELEASED' : 'MARKED',
      { submission_id: submission.rows[0].id, score: Number(score), release, request_resubmission });
    await client.query('COMMIT');
    res.json({ message: release ? 'Marks and feedback released.' : request_resubmission ? 'Resubmission requested.' : 'Marking draft saved.' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const getStudentAssignments = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.title, a.instructions, a.category, a.academic_year, a.term,
              a.issue_at, a.due_at, a.total_marks, a.submission_method,
              a.allow_late, a.allow_resubmission, c.name AS class_name,
              s.name AS subject_name, u.name AS teacher_name, sub.id AS submission_id,
              sub.status, sub.draft_answer, sub.submitted_at, sub.latest_version,
              CASE WHEN sub.status IN ('ASSIGNED','VIEWED','DRAFT') AND a.due_at<NOW()
                THEN 'OVERDUE' ELSE sub.status END AS display_status,
              mark.score, mark.feedback, mark.status AS mark_status
       FROM students st
       JOIN assignment_recipients r ON r.school_id=st.school_id AND r.student_id=st.id
       JOIN learning_assignments a ON a.school_id=r.school_id AND a.id=r.assignment_id
       JOIN assignment_submissions sub ON sub.school_id=r.school_id AND sub.assignment_id=r.assignment_id
         AND sub.student_id=r.student_id
       JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
       JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
       JOIN users u ON u.id=a.teacher_id AND u.school_id=a.school_id
       LEFT JOIN LATERAL (
         SELECT m.score,m.feedback,m.status FROM assignment_marks m
         WHERE m.school_id=sub.school_id AND m.submission_id=sub.id AND m.status='RELEASED'
         ORDER BY m.revision DESC LIMIT 1
       ) mark ON TRUE
       WHERE st.school_id=$1 AND st.user_id=$2 AND a.status='PUBLISHED'
         AND COALESCE(a.issue_at,a.published_at)<=NOW()
       ORDER BY a.due_at,a.id`,
      [req.user.school_id, req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getStudentAssignment = async (req, res, next) => {
  if (!isPositiveId(req.params.id)) return res.status(400).json({ message: 'Choose a valid assignment.' });
  try {
    const result = await pool.query(
      `SELECT a.*, c.name AS class_name, s.name AS subject_name, u.name AS teacher_name,
              sub.id AS submission_id, sub.status, sub.draft_answer, sub.latest_version, sub.submitted_at,
              mark.score, mark.feedback, mark.status AS mark_status
       FROM students st
       JOIN assignment_recipients r ON r.school_id=st.school_id AND r.student_id=st.id
       JOIN learning_assignments a ON a.school_id=r.school_id AND a.id=r.assignment_id
       JOIN assignment_submissions sub ON sub.school_id=r.school_id AND sub.assignment_id=r.assignment_id AND sub.student_id=r.student_id
       JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
       JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
       JOIN users u ON u.id=a.teacher_id AND u.school_id=a.school_id
       LEFT JOIN LATERAL (
         SELECT m.score,m.feedback,m.status FROM assignment_marks m
         WHERE m.school_id=sub.school_id AND m.submission_id=sub.id AND m.status='RELEASED'
         ORDER BY m.revision DESC LIMIT 1
       ) mark ON TRUE
       WHERE st.school_id=$1 AND st.user_id=$2 AND a.id=$3 AND a.status='PUBLISHED'
         AND COALESCE(a.issue_at,a.published_at)<=NOW()`,
      [req.user.school_id, req.user.id, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Assignment not found for this student.' });
    await pool.query(
      `UPDATE assignment_submissions SET viewed_at=COALESCE(viewed_at,NOW()),
       status=CASE WHEN status='ASSIGNED' THEN 'VIEWED' ELSE status END
       WHERE school_id=$1 AND id=$2`,
      [req.user.school_id, result.rows[0].submission_id]
    );
    const files = await pool.query(
      `SELECT id,original_name,content_type,file_size FROM assignment_attachments
       WHERE school_id=$1 AND assignment_id=$2 ORDER BY created_at,id`,
      [req.user.school_id, req.params.id]
    );
    const versions = await pool.query(
      `SELECT v.id,v.version_number,v.answer,v.submitted_at,v.is_late,
        COALESCE(json_agg(json_build_object('id',f.id,'original_name',f.original_name,'content_type',f.content_type,'file_size',f.file_size))
          FILTER (WHERE f.id IS NOT NULL),'[]'::json) AS files
       FROM assignment_submission_versions v LEFT JOIN assignment_submission_files f
         ON f.school_id=v.school_id AND f.version_id=v.id
       JOIN assignment_submissions sub ON sub.school_id=v.school_id AND sub.id=v.submission_id
       JOIN students st ON st.school_id=sub.school_id AND st.id=sub.student_id
       WHERE v.school_id=$1 AND st.user_id=$2 AND sub.assignment_id=$3
       GROUP BY v.id ORDER BY v.version_number DESC`,
      [req.user.school_id, req.user.id, req.params.id]
    );
    res.json({ ...result.rows[0], attachments: files.rows, versions: versions.rows });
  } catch (error) {
    next(error);
  }
};

const saveStudentDraft = async (req, res, next) => {
  if (!isPositiveId(req.params.id)) return res.status(400).json({ message: 'Choose a valid assignment.' });
  const answer = req.body.answer;
  if (typeof answer !== 'string' || answer.length > 100000) {
    return res.status(400).json({ message: 'Answer must be text of 100,000 characters or fewer.' });
  }
  try {
    const result = await pool.query(
      `UPDATE assignment_submissions sub SET draft_answer=$1,
         status=CASE WHEN sub.status IN ('ASSIGNED','VIEWED') THEN 'DRAFT' ELSE sub.status END,
         updated_at=NOW()
       FROM students st, learning_assignments a
       WHERE sub.school_id=$2 AND sub.assignment_id=$3 AND sub.student_id=st.id AND st.school_id=sub.school_id
         AND st.user_id=$4 AND a.school_id=sub.school_id AND a.id=sub.assignment_id
         AND a.status='PUBLISHED' AND sub.status NOT IN ('SUBMITTED','SUBMITTED_LATE','AWAITING_MARKING','MARKED','EXCUSED')
         AND COALESCE(a.issue_at,a.published_at)<=NOW()
         AND (a.due_at>=NOW() OR a.allow_late=TRUE)
         AND (sub.status<>'RETURNED' OR a.allow_resubmission=TRUE)
         AND (sub.status<>'RESUBMISSION_REQUESTED' OR a.allow_resubmission=TRUE)
       RETURNING sub.id,sub.status`,
      [answer, req.user.school_id, req.params.id, req.user.id]
    );
    if (!result.rowCount) return res.status(409).json({ message: 'This assignment is not open for draft edits. Check its status or ask your teacher about resubmission.' });
    await audit(pool, req.user.school_id, req.params.id, req.user.id, 'SUBMISSION_SAVED');
    res.json({ message: 'Draft saved.', status: result.rows[0].status });
  } catch (error) {
    next(error);
  }
};

const uploadAssignmentFiles = async (req, res, next, isSubmission = false) => {
  const { school_id: schoolId, id: actorId, role } = req.user;
  const assignmentId = Number(req.params.id);
  const uploaded = [];
  if (!isPositiveId(assignmentId)) return res.status(400).json({ message: 'Choose a valid assignment.' });
  if (!req.files?.length) return res.status(400).json({ message: 'Choose at least one file to upload.' });
  if (req.files.length > MAX_FILES_PER_UPLOAD) return res.status(400).json({ message: `Upload no more than ${MAX_FILES_PER_UPLOAD} files at a time.` });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isSubmission) {
      const found = await client.query(
        `SELECT a.id,a.submission_method,a.allow_late,a.due_at,a.issue_at,a.published_at,a.status,
                NOW() AS database_now,sub.id AS submission_id,sub.status AS submission_status
         FROM students st JOIN assignment_submissions sub ON sub.school_id=st.school_id AND sub.student_id=st.id
         JOIN learning_assignments a ON a.school_id=sub.school_id AND a.id=sub.assignment_id
         WHERE st.school_id=$1 AND st.user_id=$2 AND a.id=$3 FOR UPDATE OF sub`,
        [schoolId, actorId, assignmentId]
      );
      if (!found.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Assignment not found for this student.' });
      }
      const assignment = found.rows[0];
      if (assignment.status !== 'PUBLISHED' || !['file','both'].includes(assignment.submission_method)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'This assignment does not currently accept file uploads.' });
      }
      if ((assignment.issue_at || assignment.published_at) > assignment.database_now) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'This assignment is not open for submissions yet.' });
      }
      if (!canSubmit({
        dueAt: assignment.due_at, allowLate: assignment.allow_late, now: new Date(assignment.database_now),
      })) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'The deadline has passed and late submissions are not enabled.' });
      }
      if (['SUBMITTED','SUBMITTED_LATE','AWAITING_MARKING','MARKED','EXCUSED'].includes(assignment.submission_status)
        || (assignment.submission_status === 'RETURNED' && !assignment.allow_resubmission)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'This submission is locked. Ask your teacher if you need to resubmit.' });
      }
      const current = await client.query(
        `SELECT COUNT(*)::INTEGER AS n FROM assignment_submission_files
         WHERE school_id=$1 AND submission_id=$2 AND version_id IS NULL`,
        [schoolId, assignment.submission_id]
      );
      if (Number(current.rows[0].n) + req.files.length > MAX_FILES_PER_UPLOAD) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `A submission may contain up to ${MAX_FILES_PER_UPLOAD} files.` });
      }
      for (const file of req.files) {
        const stored = await assignmentStorage.putPrivateFile({ schoolId, assignmentId, kind: `submissions/${assignment.submission_id}`, file });
        uploaded.push(stored.storage_key);
        const saved = await client.query(
          `INSERT INTO assignment_submission_files
           (school_id,assignment_id,submission_id,storage_key,original_name,content_type,file_size)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id,original_name,content_type,file_size`,
          [schoolId, assignmentId, assignment.submission_id, stored.storage_key,
            stored.original_name, stored.content_type, stored.file_size]
        );
        uploaded[uploaded.length - 1] = { key: stored.storage_key, id: saved.rows[0].id };
      }
      await client.query('COMMIT');
      return res.status(201).json({ files: uploaded.map((file) => file.id) });
    }
    const assignment = await getAssignmentForUser(client, schoolId, assignmentId, req.user);
    if (!assignment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Assignment not found or you are not authorized to upload materials.' });
    }
    if (assignment.status !== 'DRAFT') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Reference files can only be changed while an assignment is a draft.' });
    }
    for (const file of req.files) {
      const stored = await assignmentStorage.putPrivateFile({ schoolId, assignmentId, kind: 'reference', file });
      uploaded.push(stored.storage_key);
      await client.query(
        `INSERT INTO assignment_attachments
         (school_id,assignment_id,storage_key,original_name,content_type,file_size,uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [schoolId, assignmentId, stored.storage_key, stored.original_name, stored.content_type, stored.file_size, actorId]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ message: 'Reference materials uploaded.' });
  } catch (error) {
    await client.query('ROLLBACK');
    const cleanup = await Promise.allSettled(
      uploaded.map((file) => assignmentStorage.deletePrivateFile(typeof file === 'string' ? file : file.key))
    );
    cleanup.filter((result) => result.status === 'rejected').forEach((result) => {
      console.error('Failed to remove an orphaned assignment file after database rollback:', result.reason);
    });
    next(error);
  } finally {
    client.release();
  }
};

const submitStudentAssignment = async (req, res, next) => {
  const { school_id: schoolId, id: studentUserId } = req.user;
  if (!isPositiveId(req.params.id)) return res.status(400).json({ message: 'Choose a valid assignment.' });
  if (typeof req.body.answer !== 'undefined'
    && (typeof req.body.answer !== 'string' || req.body.answer.length > 100000)) {
    return res.status(400).json({ message: 'Answer must be text of 100,000 characters or fewer.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT a.*,NOW() AS database_now,sub.id AS submission_id,sub.status AS submission_status,
              sub.latest_version,sub.draft_answer,
              (SELECT COUNT(*)::INTEGER FROM assignment_submission_files f
               WHERE f.school_id=sub.school_id AND f.submission_id=sub.id AND f.version_id IS NULL) AS draft_file_count
       FROM students st
       JOIN assignment_submissions sub ON sub.school_id=st.school_id AND sub.student_id=st.id
       JOIN learning_assignments a ON a.school_id=sub.school_id AND a.id=sub.assignment_id
       WHERE st.school_id=$1 AND st.user_id=$2 AND a.id=$3 FOR UPDATE OF sub`,
      [schoolId, studentUserId, req.params.id]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Assignment not found for this student.' });
    }
    const assignment = result.rows[0];
    if (assignment.status !== 'PUBLISHED'
      || (assignment.issue_at || assignment.published_at) > assignment.database_now) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This assignment is not open for submissions.' });
    }
    if (!canSubmit({
      dueAt: assignment.due_at, allowLate: assignment.allow_late, now: new Date(assignment.database_now),
    })) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'The deadline has passed and late submissions are not enabled.' });
    }
    if (assignment.latest_version > 0 && !assignment.allow_resubmission) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'A submission has already been received and resubmission is not enabled.' });
    }
    const answer = typeof req.body.answer === 'string' ? req.body.answer.trim() : assignment.draft_answer.trim();
    if (['online','both'].includes(assignment.submission_method) && !answer) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Enter an answer before submitting this assignment.' });
    }
    if (['file','both'].includes(assignment.submission_method) && Number(assignment.draft_file_count) < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Upload at least one file before submitting this assignment.' });
    }
    const versionNumber = Number(assignment.latest_version) + 1;
    const submittedAt = await client.query(
      `SELECT NOW() AS submitted_at, (NOW()>$1::TIMESTAMPTZ) AS is_late`,
      [assignment.due_at]
    );
    const inserted = await client.query(
      `INSERT INTO assignment_submission_versions
       (school_id,submission_id,version_number,answer,submitted_at,is_late)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,version_number,submitted_at,is_late`,
      [schoolId, assignment.submission_id, versionNumber, answer, submittedAt.rows[0].submitted_at, submittedAt.rows[0].is_late]
    );
    await client.query(
      `UPDATE assignment_submission_files SET version_id=$1
       WHERE school_id=$2 AND submission_id=$3 AND version_id IS NULL`,
      [inserted.rows[0].id, schoolId, assignment.submission_id]
    );
    const status = submittedAt.rows[0].is_late ? 'SUBMITTED_LATE' : 'AWAITING_MARKING';
    await client.query(
      `UPDATE assignment_submissions SET draft_answer='',latest_version=$1,submitted_at=$2,status=$3,updated_at=NOW()
       WHERE school_id=$4 AND id=$5`,
      [versionNumber, submittedAt.rows[0].submitted_at, status, schoolId, assignment.submission_id]
    );
    await client.query(
      `INSERT INTO notifications (school_id,user_id,title,message)
       VALUES ($1,$2,'Assignment submitted',$3)`,
      [schoolId, assignment.teacher_id, `A student submitted ${assignment.title}${submittedAt.rows[0].is_late ? ' late' : ''}.`]
    );
    await audit(client, schoolId, assignment.id, studentUserId,
      versionNumber > 1 ? 'RESUBMITTED' : 'SUBMITTED', { submission_id: assignment.submission_id, version: versionNumber, is_late: submittedAt.rows[0].is_late });
    await client.query('COMMIT');
    res.status(201).json({ message: 'Assignment submitted successfully.', status, version: versionNumber, is_late: submittedAt.rows[0].is_late });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const downloadAssignmentFile = async (req, res, next) => {
  if (!isPositiveId(req.params.id) || !isPositiveId(req.params.fileId)) {
    return res.status(400).json({ message: 'Choose a valid assignment file.' });
  }
  try {
    let file;
    if (req.params.fileType === 'submission') {
      if (req.user.role === 'student') {
        const result = await pool.query(
          `SELECT f.* FROM assignment_submission_files f
           JOIN assignment_submissions sub ON sub.school_id=f.school_id AND sub.id=f.submission_id
           JOIN students st ON st.school_id=sub.school_id AND st.id=sub.student_id
           JOIN learning_assignments a ON a.school_id=f.school_id AND a.id=f.assignment_id
             AND a.status='PUBLISHED'
           WHERE f.school_id=$1 AND f.assignment_id=$2 AND f.id=$3 AND st.user_id=$4
             AND COALESCE(a.issue_at,a.published_at)<=NOW()`,
          [req.user.school_id, req.params.id, req.params.fileId, req.user.id]
        );
        file = result.rows[0];
      } else {
        const assignment = await getAssignmentForUser(pool, req.user.school_id, req.params.id, req.user);
        if (assignment) {
          const result = await pool.query(
            `SELECT * FROM assignment_submission_files
             WHERE school_id=$1 AND assignment_id=$2 AND id=$3`,
            [req.user.school_id, assignment.id, req.params.fileId]
          );
          file = result.rows[0];
        }
      }
    } else if (req.user.role === 'student') {
      const result = await pool.query(
        `SELECT f.* FROM assignment_attachments f
         JOIN assignment_recipients r ON r.school_id=f.school_id AND r.assignment_id=f.assignment_id
         JOIN students st ON st.school_id=r.school_id AND st.id=r.student_id
         JOIN learning_assignments a ON a.school_id=f.school_id AND a.id=f.assignment_id AND a.status='PUBLISHED'
         WHERE f.school_id=$1 AND f.assignment_id=$2 AND f.id=$3 AND st.user_id=$4
           AND COALESCE(a.issue_at,a.published_at)<=NOW()`,
        [req.user.school_id, req.params.id, req.params.fileId, req.user.id]
      );
      file = result.rows[0];
    } else {
      const assignment = await getAssignmentForUser(pool, req.user.school_id, req.params.id, req.user);
      if (assignment) {
        const result = await pool.query(
          `SELECT * FROM assignment_attachments WHERE school_id=$1 AND assignment_id=$2 AND id=$3`,
          [req.user.school_id, assignment.id, req.params.fileId]
        );
        file = result.rows[0];
      }
    }
    if (!file) return res.status(404).json({ message: 'File not found or you are not authorized to access it.' });
    const object = await assignmentStorage.getPrivateFile(file.storage_key);
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Content-Length', file.file_size);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    object.Body.on('error', next);
    object.Body.pipe(res);
  } catch (error) {
    next(error);
  }
};

const uploadStudentSubmissionFiles = (req, res, next) => uploadAssignmentFiles(req, res, next, true);

const getParentAssignments = async (req, res, next) => {
  const studentId = Number(req.params.studentId);
  if (!isPositiveId(studentId)) return res.status(400).json({ message: 'Choose a valid child.' });
  try {
    const linked = await pool.query(
      `SELECT 1 FROM student_parent sp
       JOIN parents p ON p.id=sp.parent_id AND p.school_id=sp.school_id
       WHERE sp.school_id=$1 AND p.user_id=$2 AND sp.student_id=$3`,
      [req.user.school_id, req.user.id, studentId]
    );
    if (!linked.rowCount) return res.status(404).json({ message: 'Child not found in your linked accounts.' });
    await pool.query(
      `INSERT INTO parent_portal_audit_log
       (school_id,parent_user_id,student_id,actor_id,action,details)
       VALUES ($1,$2,$3,$2,'CHILD_RECORD_VIEWED',$4::JSONB)`,
      [req.user.school_id, req.user.id, studentId, JSON.stringify({ resource: 'assignments' })]
    );
    const result = await pool.query(
      `SELECT a.id,a.title,a.category,a.academic_year,a.term,a.due_at,a.total_marks,
              a.submission_method,c.name AS class_name,s.name AS subject_name,
              sub.status,sub.submitted_at,mark.score,mark.feedback,mark.created_at AS marked_at
       FROM student_parent sp
       JOIN parents p ON p.id=sp.parent_id AND p.school_id=sp.school_id
       JOIN students st ON st.id=sp.student_id AND st.school_id=sp.school_id
       JOIN assignment_recipients r ON r.school_id=st.school_id AND r.student_id=st.id
       JOIN learning_assignments a ON a.school_id=r.school_id AND a.id=r.assignment_id AND a.status='PUBLISHED'
       JOIN assignment_submissions sub ON sub.school_id=r.school_id AND sub.assignment_id=r.assignment_id AND sub.student_id=r.student_id
       JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
       JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
       LEFT JOIN LATERAL (
         SELECT m.score,m.feedback,m.created_at FROM assignment_marks m
         WHERE m.school_id=sub.school_id AND m.submission_id=sub.id AND m.status='RELEASED'
         ORDER BY m.revision DESC LIMIT 1
       ) mark ON TRUE
       WHERE sp.school_id=$1 AND p.user_id=$2 AND st.id=$3
         AND COALESCE(a.issue_at,a.published_at)<=NOW()
       ORDER BY a.due_at DESC,a.id DESC`,
      [req.user.school_id, req.user.id, studentId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMeta,
  listAssignments,
  createAssignment,
  updateAssignment,
  publishAssignment,
  getSubmissions,
  markSubmission,
  getStudentAssignments,
  getStudentAssignment,
  saveStudentDraft,
  uploadAssignmentFiles,
  uploadStudentSubmissionFiles,
  submitStudentAssignment,
  downloadAssignmentFile,
  getParentAssignments,
  teacherCanTeach,
};
