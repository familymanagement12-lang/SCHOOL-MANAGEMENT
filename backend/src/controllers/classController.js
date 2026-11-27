const pool = require('../config/db');
const {
  classConfigurationChanged,
  classSubjectConfigurationChanged,
  normalizeClassConfiguration,
} = require('../services/classConfiguration');
const { normalizeClassTeacherAssignment } = require('../services/classTeacherAssignment');
const {
  canonicalClassName,
} = require('../services/curriculumPolicy');

const classAuditSnapshot = (classRecord) => ({
  name: classRecord.name,
  description: classRecord.description || null,
  year_level: classRecord.year_level ?? null,
  curriculum: classRecord.curriculum || 'UNASSIGNED',
  teaching_model: classRecord.teaching_model || null,
  education_stage: classRecord.education_stage || 'UNASSIGNED',
  programme: classRecord.programme || null,
  class_teacher_id: classRecord.class_teacher_id ?? classRecord.teacher_id ?? null,
});

const insertClassAudit = (client, {
  schoolId, classId, actorId, action, reason, previousConfiguration, newConfiguration,
}) => client.query(
  `INSERT INTO class_configuration_audit
     (school_id, class_id, class_id_snapshot, changed_by, action, reason,
      previous_configuration, new_configuration)
   VALUES ($1, $2, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
  [
    schoolId, classId, actorId, action, reason,
    JSON.stringify(previousConfiguration), JSON.stringify(newConfiguration),
  ]
);

const getClasses = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;

  try {
    let query = `SELECT id, name, description, teacher_id, class_teacher_id,
                        year_level, teaching_model, curriculum, education_stage, programme
                 FROM classes WHERE school_id = $1 ORDER BY year_level NULLS LAST, name`;
    let values = [school_id];

    // Teachers should ONLY see their assigned classes
    if (role === 'teacher') {
      query = `SELECT id, name, description, teacher_id, class_teacher_id,
              year_level, teaching_model, curriculum, education_stage, programme
           FROM classes WHERE school_id = $1 AND class_teacher_id = $2
           ORDER BY year_level NULLS LAST, name`;
      values = [school_id, userId];
    }

    const result = await pool.query(query, values);
    res.json(result.rows.map((row) => ({
      ...row,
      name: canonicalClassName(row.name, row.year_level, row.curriculum, row.education_stage),
    })));
  } catch (error) {
    next(error);
  }
};

const createClass = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const {
    name, description, class_teacher_id, teacher_id, year_level, teaching_model,
    curriculum, education_stage, programme, change_reason,
  } = req.body;
  let classTeacherAssignment;
  let classConfiguration;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Class name is required.' });
  }
  const reason = typeof change_reason === 'string' ? change_reason.trim() : '';
  if (reason.length < 5) {
    return res.status(400).json({ message: 'Provide a reason of at least five characters when creating a class.' });
  }
  try { classTeacherAssignment = normalizeClassTeacherAssignment(class_teacher_id !== undefined ? class_teacher_id : teacher_id); } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  try {
    classConfiguration = normalizeClassConfiguration({
      year_level, teaching_model, curriculum, education_stage, programme,
      class_teacher_id: classTeacherAssignment.teacherId,
    }, { isNew: true });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const className = canonicalClassName(
    name, classConfiguration.yearLevel, classConfiguration.classCurriculum, classConfiguration.educationStage
  );

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    if (classTeacherAssignment.teacherId !== null) {
      const teacher = await client.query(
        `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active = TRUE`,
        [classTeacherAssignment.teacherId, school_id]
      );
      if (!teacher.rows.length) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(400).json({ message: 'Select an active teacher from this school as the class teacher.' });
      }
    }

    const result = await client.query(
      `INSERT INTO classes
         (school_id, name, description, teacher_id, class_teacher_id, year_level,
          teaching_model, curriculum, education_stage, programme)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)
       RETURNING id, school_id, name, description, teacher_id, class_teacher_id,
                 year_level, teaching_model, curriculum, education_stage, programme`,
      [
        school_id, className, description || null, classTeacherAssignment.teacherId,
        classConfiguration.yearLevel, classConfiguration.teachingModel,
        classConfiguration.classCurriculum, classConfiguration.educationStage,
        classConfiguration.programme,
      ]
    );
    await insertClassAudit(client, {
      schoolId: school_id,
      classId: result.rows[0].id,
      actorId,
      action: 'CREATED',
      reason,
      previousConfiguration: {},
      newConfiguration: classAuditSnapshot(result.rows[0]),
    });
    await client.query('COMMIT');
    transactionOpen = false;

    res.status(201).json({
      ...result.rows[0],
      name: canonicalClassName(
        result.rows[0].name,
        result.rows[0].year_level,
        result.rows[0].curriculum,
        result.rows[0].education_stage
      ),
    });
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Class already exists for this school.' });
    }
    next(error);
  } finally {
    client?.release();
  }
};

const updateClass = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const {
    name, description, class_teacher_id, teacher_id, year_level, teaching_model,
    curriculum, education_stage, programme, change_reason,
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Class name is required.' });
  }
  let classTeacherAssignment;
  try { classTeacherAssignment = normalizeClassTeacherAssignment(class_teacher_id !== undefined ? class_teacher_id : teacher_id); } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const currentClass = await client.query(
      `SELECT id, name, description, year_level, curriculum, teaching_model, education_stage,
              programme, class_teacher_id, teacher_id
       FROM classes WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [req.params.id, school_id]
    );
    if (!currentClass.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Class not found.' });
    }

    let classConfiguration;
    try {
      classConfiguration = normalizeClassConfiguration({
        year_level: year_level === undefined ? currentClass.rows[0].year_level : year_level,
        curriculum: curriculum === undefined ? currentClass.rows[0].curriculum : curriculum,
        teaching_model: teaching_model === undefined ? currentClass.rows[0].teaching_model : teaching_model,
        education_stage: education_stage === undefined ? currentClass.rows[0].education_stage : education_stage,
        programme: programme === undefined ? currentClass.rows[0].programme : programme,
        class_teacher_id: classTeacherAssignment.provided
          ? classTeacherAssignment.teacherId
          : currentClass.rows[0].class_teacher_id,
      }, { existing: currentClass.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ message: error.message });
    }
    const className = canonicalClassName(
      name, classConfiguration.yearLevel, classConfiguration.classCurriculum, classConfiguration.educationStage
    );
    const classDescription = description === undefined
      ? currentClass.rows[0].description || null
      : description || null;
    const configurationChanged = classConfigurationChanged(currentClass.rows[0], {
      ...classConfiguration,
      name: className,
      description: classDescription,
      classTeacherId: classTeacherAssignment.provided
        ? classTeacherAssignment.teacherId
        : currentClass.rows[0].class_teacher_id ?? currentClass.rows[0].teacher_id ?? null,
    });
    const subjectConfigurationChanged = classSubjectConfigurationChanged(
      currentClass.rows[0], classConfiguration
    );
    const normalizedChangeReason = typeof change_reason === 'string' ? change_reason.trim() : '';
    if (configurationChanged && normalizedChangeReason.length < 5) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({
        message: 'Provide a reason of at least five characters when changing a class name, description, section, curriculum, level, teaching model, programme, or class teacher.',
      });
    }

    if (classTeacherAssignment.teacherId !== null) {
      const teacher = await client.query(
        `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active = TRUE`,
        [classTeacherAssignment.teacherId, school_id]
      );
      if (!teacher.rows.length) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(400).json({ message: 'Select an active teacher from this school as the class teacher.' });
      }
    }

    if (subjectConfigurationChanged) {
      const incompatibleSubject = await client.query(
        `SELECT s.name
         FROM (
           SELECT subject_id FROM subject_class_assignments
           WHERE school_id = $1 AND class_id = $2
           UNION
           SELECT subject_id FROM subject_weekly_requirements
           WHERE school_id = $1 AND class_id = $2
         ) configured
         JOIN subjects s ON s.id = configured.subject_id AND s.school_id = $1
         WHERE $3 = 'UNASSIGNED'
            OR $4 = 'UNASSIGNED'
            OR s.applicable_education_stages IS NULL
            OR NOT ($3 = ANY(s.applicable_education_stages))
            OR (s.applicable_year_levels IS NOT NULL AND (
              $5::INTEGER IS NULL OR NOT ($5 = ANY(s.applicable_year_levels))
            ))
            OR NOT EXISTS (
              SELECT 1 FROM curriculum_subjects cs
              WHERE cs.school_id = $1 AND cs.subject_id = s.id
                AND cs.curriculum = $4
            )
         LIMIT 1`,
        [
          school_id, req.params.id, classConfiguration.educationStage,
          classConfiguration.classCurriculum, classConfiguration.yearLevel,
        ]
      );
      if (incompatibleSubject.rowCount) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(409).json({
          message: `This class change would invalidate the existing ${incompatibleSubject.rows[0].name} assignment or timetable requirement. Resolve the subject configuration first; no class settings were changed.`,
        });
      }
    }

    const result = await client.query(
      `UPDATE classes SET name = $1, description = $2,
                          teacher_id = CASE WHEN $3 THEN $4 ELSE teacher_id END,
                          class_teacher_id = CASE WHEN $3 THEN $4 ELSE class_teacher_id END,
                          year_level = $5,
                          teaching_model = $6,
                          curriculum = $7,
                          education_stage = $8,
                          programme = $9
      WHERE id = $10 AND school_id = $11
       RETURNING id, school_id, name, description, teacher_id, class_teacher_id,
                 year_level, teaching_model, curriculum, education_stage, programme`,
      [
        className, classDescription, classTeacherAssignment.provided, classTeacherAssignment.teacherId,
        classConfiguration.yearLevel, classConfiguration.teachingModel,
        classConfiguration.classCurriculum, classConfiguration.educationStage,
        classConfiguration.programme, req.params.id, school_id,
      ]
    );
    if (configurationChanged) {
      await insertClassAudit(client, {
        schoolId: school_id,
        classId: req.params.id,
        actorId,
        action: 'UPDATED',
        reason: normalizedChangeReason,
        previousConfiguration: classAuditSnapshot(currentClass.rows[0]),
        newConfiguration: classAuditSnapshot(result.rows[0]),
      });
    }
    await client.query('COMMIT');
    transactionOpen = false;
    res.json(result.rows[0]);
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ message: 'Class already exists for this school.' });
    next(error);
  } finally {
    client?.release();
  }
};

const deleteClass = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const { id } = req.params;
  const reason = typeof req.body?.change_reason === 'string' ? req.body.change_reason.trim() : '';
  if (reason.length < 5) {
    return res.status(400).json({ message: 'Provide a reason of at least five characters when deleting a class.' });
  }

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const currentClass = await client.query(
      `SELECT id, name, description, year_level, curriculum, teaching_model,
              education_stage, programme, class_teacher_id, teacher_id
       FROM classes WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [id, school_id]
    );
    if (!currentClass.rowCount) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message: 'Class not found.' });
    }

    await insertClassAudit(client, {
      schoolId: school_id,
      classId: id,
      actorId,
      action: 'DELETED',
      reason,
      previousConfiguration: classAuditSnapshot(currentClass.rows[0]),
      newConfiguration: {},
    });
    await client.query('DELETE FROM classes WHERE id = $1 AND school_id = $2', [id, school_id]);
    await client.query('COMMIT');
    transactionOpen = false;
    res.json({ message: 'Class deleted successfully.' });
  } catch (error) {
    if (client && transactionOpen) await client.query('ROLLBACK');
    next(error);
  } finally {
    client?.release();
  }
};

module.exports = { getClasses, createClass, updateClass, deleteClass };
