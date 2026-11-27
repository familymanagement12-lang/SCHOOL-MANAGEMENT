const pool = require('../config/db');
const EDUCATION_STAGES = Object.freeze(['EARLY_YEARS', 'PRIMARY', 'JHS', 'OTHER']);

const normalizedTextArray = (value) => {
  if (!Array.isArray(value)) return null;
  if (value.some((item) => !Number.isInteger(Number(item)) || Number(item) < 1 || Number(item) > 11)) {
    return false;
  }
  const levels = [...new Set(value.map(Number))];
  return levels.length ? levels : null;
};

const normalizedStageArray = (value) => {
  if (!Array.isArray(value)) return null;
  if (value.some((item) => !EDUCATION_STAGES.includes(item))) return false;
  const stages = [...new Set(value)];
  return stages;
};

const getSubjects = async (req, res, next) => {
  const { school_id } = req.user;
  const curriculum = req.query.curriculum ? String(req.query.curriculum).toUpperCase() : null;
  if (curriculum && !['COMMON', 'GES', 'PEARSON'].includes(curriculum)) {
    return res.status(400).json({ message: 'Select Common, GES, or Pearson curriculum.' });
  }
  try {
    const result = await pool.query(
      `SELECT s.*,
              COALESCE(array_agg(cs.curriculum ORDER BY cs.curriculum)
                       FILTER (WHERE cs.curriculum IS NOT NULL), '{}') AS curricula
       FROM subjects s
       LEFT JOIN curriculum_subjects cs ON cs.subject_id = s.id AND cs.school_id = s.school_id
       WHERE s.school_id = $1
         AND ($2::text IS NULL OR EXISTS (
           SELECT 1 FROM curriculum_subjects filtered
           WHERE filtered.school_id = s.school_id AND filtered.subject_id = s.id
             AND filtered.curriculum = $2
         ))
       GROUP BY s.id ORDER BY s.name`,
      [school_id, curriculum]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createSubject = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, code, is_compulsory = true, lesson_duration_minutes = null,
    applicable_year_levels = null, applicable_education_stages = null,
    scheduling_preferences = {} } = req.body;
  const curricula = req.body.curricula;

  if (!name) return res.status(400).json({ message: 'Subject name is required.' });
  if (!Array.isArray(curricula) || curricula.length === 0
      || curricula.some((curriculum) => !['COMMON', 'GES', 'PEARSON'].includes(curriculum))
      || new Set(curricula).size !== curricula.length) {
    return res.status(400).json({ message: 'Select one or more valid curricula for the subject.' });
  }
  if (typeof is_compulsory !== 'boolean') return res.status(400).json({ message: 'Compulsory status must be true or false.' });
  if (lesson_duration_minutes !== null && (!Number.isInteger(Number(lesson_duration_minutes)) || Number(lesson_duration_minutes) < 15 || Number(lesson_duration_minutes) > 240)) {
    return res.status(400).json({ message: 'Lesson duration must be between 15 and 240 minutes.' });
  }
  const yearLevels = normalizedTextArray(applicable_year_levels);
  if (yearLevels === false) return res.status(400).json({ message: 'Applicable year levels must be between 1 and 11.' });
  const educationStages = normalizedStageArray(applicable_education_stages);
  if (educationStages === false) return res.status(400).json({ message: 'Select valid applicable education stages.' });
  if (!educationStages?.length) {
    return res.status(400).json({ message: 'Select at least one applicable education section.' });
  }
  if (applicable_year_levels !== null && !Array.isArray(applicable_year_levels)) {
    return res.status(400).json({ message: 'Applicable year levels must be an array.' });
  }
  if (scheduling_preferences !== null && typeof scheduling_preferences !== 'object') {
    return res.status(400).json({ message: 'Scheduling preferences must be an object.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO subjects
         (school_id, name, code, is_active, is_archived, is_compulsory,
          lesson_duration_minutes, applicable_year_levels, applicable_education_stages,
          scheduling_preferences)
       VALUES ($1,$2,$3,TRUE,FALSE,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
      [school_id, name.trim(), code?.trim() || null, is_compulsory,
       lesson_duration_minutes === null ? null : Number(lesson_duration_minutes),
       yearLevels, educationStages, JSON.stringify(scheduling_preferences || {})]
    );
    for (const curriculum of curricula) {
      await client.query(
        'INSERT INTO curriculum_subjects (school_id, curriculum, subject_id) VALUES ($1, $2, $3)',
        [school_id, curriculum, result.rows[0].id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ ...result.rows[0], curricula });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ message: 'Subject already exists in your school.' });
    next(error);
  } finally {
    if (client) client.release();
  }
};

const updateSubject = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, code, curricula, is_active, is_archived, is_compulsory,
    lesson_duration_minutes, applicable_year_levels, applicable_education_stages,
    scheduling_preferences } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Subject name is required.' });
  if (!Array.isArray(curricula) || curricula.length === 0
      || curricula.some((curriculum) => !['COMMON', 'GES', 'PEARSON'].includes(curriculum))
      || new Set(curricula).size !== curricula.length) {
    return res.status(400).json({ message: 'Select one or more valid curricula for the subject.' });
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') return res.status(400).json({ message: 'Active status must be true or false.' });
  if (is_archived !== undefined && typeof is_archived !== 'boolean') return res.status(400).json({ message: 'Archive status must be true or false.' });
  if (is_compulsory !== undefined && typeof is_compulsory !== 'boolean') return res.status(400).json({ message: 'Compulsory status must be true or false.' });
  if (lesson_duration_minutes !== undefined && lesson_duration_minutes !== null
      && (!Number.isInteger(Number(lesson_duration_minutes)) || Number(lesson_duration_minutes) < 15 || Number(lesson_duration_minutes) > 240)) {
    return res.status(400).json({ message: 'Lesson duration must be between 15 and 240 minutes.' });
  }
  const yearLevels = applicable_year_levels === undefined ? undefined : normalizedTextArray(applicable_year_levels);
  if (yearLevels === false) return res.status(400).json({ message: 'Applicable year levels must be between 1 and 11.' });
  if (applicable_year_levels !== undefined && !Array.isArray(applicable_year_levels)) {
    return res.status(400).json({ message: 'Applicable year levels must be an array.' });
  }
  const educationStages = applicable_education_stages === undefined
    ? undefined : normalizedStageArray(applicable_education_stages);
  if (educationStages === false) return res.status(400).json({ message: 'Select valid applicable education stages.' });
  if (applicable_education_stages !== undefined && !Array.isArray(applicable_education_stages)) {
    return res.status(400).json({ message: 'Applicable education stages must be an array.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const subjectResult = await client.query(
      `SELECT applicable_education_stages, applicable_year_levels
       FROM subjects WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [req.params.id, school_id]
    );
    if (!subjectResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Subject not found.' });
    }
    const effectiveEducationStages = educationStages === undefined
      ? subjectResult.rows[0].applicable_education_stages
      : educationStages;
    const effectiveYearLevels = yearLevels === undefined
      ? subjectResult.rows[0].applicable_year_levels
      : yearLevels;
    if (!Array.isArray(effectiveEducationStages) || !effectiveEducationStages.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Set the subject’s applicable education sections before using it in class assignments or timetable requirements.',
      });
    }
    const incompatibleUsage = await client.query(
      `SELECT 1
       FROM subject_class_assignments a
       JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
       WHERE a.school_id = $1 AND a.subject_id = $2
         AND (
           NOT (a.curriculum = ANY($3::TEXT[]))
           OR NOT (c.education_stage = ANY($4::TEXT[]))
           OR ($5::INTEGER[] IS NOT NULL AND (
             c.year_level IS NULL OR NOT (c.year_level = ANY($5::INTEGER[]))
           ))
         )
       UNION ALL
       SELECT 1
       FROM subject_weekly_requirements r
       JOIN classes c ON c.id = r.class_id AND c.school_id = r.school_id
       WHERE r.school_id = $1 AND r.subject_id = $2
         AND (
           NOT (c.curriculum = ANY($3::TEXT[]))
           OR NOT (c.education_stage = ANY($4::TEXT[]))
           OR ($5::INTEGER[] IS NOT NULL AND (
             c.year_level IS NULL OR NOT (c.year_level = ANY($5::INTEGER[]))
           ))
         )
       LIMIT 1`,
      [school_id, req.params.id, curricula, effectiveEducationStages, effectiveYearLevels]
    );
    if (incompatibleUsage.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'This change would make an existing class assignment or weekly timetable requirement incompatible. Resolve those assignments first; no subject settings were changed.',
      });
    }
    const result = await client.query(
      `UPDATE subjects SET
         name=$1, code=$2,
         is_active=COALESCE($3,is_active),
         is_archived=COALESCE($4,is_archived),
         is_compulsory=COALESCE($5,is_compulsory),
         lesson_duration_minutes=CASE WHEN $11 THEN $6 ELSE lesson_duration_minutes END,
         applicable_year_levels=CASE WHEN $12 THEN $7 ELSE applicable_year_levels END,
         scheduling_preferences=CASE WHEN $13 THEN $8::jsonb ELSE scheduling_preferences END,
         applicable_education_stages=CASE WHEN $14 THEN $15 ELSE applicable_education_stages END
       WHERE id=$9 AND school_id=$10 RETURNING *`,
      [name.trim(), code?.trim() || null, is_active, is_archived, is_compulsory,
       lesson_duration_minutes === undefined ? undefined : (lesson_duration_minutes === null ? null : Number(lesson_duration_minutes)),
       yearLevels, scheduling_preferences === undefined ? null : JSON.stringify(scheduling_preferences),
       req.params.id, school_id,
       lesson_duration_minutes !== undefined,
       applicable_year_levels !== undefined,
       scheduling_preferences !== undefined,
       applicable_education_stages !== undefined,
       educationStages]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Subject not found.' });
    }
    await client.query('DELETE FROM curriculum_subjects WHERE school_id = $1 AND subject_id = $2', [school_id, req.params.id]);
    for (const curriculum of curricula) {
      await client.query(
        'INSERT INTO curriculum_subjects (school_id, curriculum, subject_id) VALUES ($1, $2, $3)',
        [school_id, curriculum, req.params.id]
      );
    }
    await client.query('COMMIT');
    res.json({ ...result.rows[0], curricula });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ message: 'Subject name or code already exists in your school.' });
    next(error);
  } finally {
    if (client) client.release();
  }
};

const deleteSubject = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE subjects SET is_active=FALSE, is_archived=TRUE
       WHERE id=$1 AND school_id=$2
       RETURNING *`,
      [id, school_id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Subject not found.' });
    res.json({ ...result.rows[0], message: 'Subject archived. Historical timetable records were preserved.' });
  } catch (error) {
    next(error);
  }
};

const upsertSubjectClassAssignment = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const { class_id, subject_id, curriculum, is_compulsory = true, lesson_duration_minutes = null } = req.body;
  if (!class_id || !subject_id || !['COMMON', 'GES', 'PEARSON'].includes(curriculum)) {
    return res.status(400).json({ message: 'Select a class, subject, and valid curriculum.' });
  }
  if (typeof is_compulsory !== 'boolean') return res.status(400).json({ message: 'Compulsory status must be true or false.' });
  try {
    const valid = await pool.query(
      `SELECT c.id FROM classes c
       JOIN curriculum_subjects cs ON cs.school_id=c.school_id AND cs.curriculum=$3 AND cs.subject_id=$2
       JOIN subjects s ON s.id=$2 AND s.school_id=$1 AND s.is_active=TRUE
       WHERE c.id=$4 AND c.school_id=$1 AND c.curriculum=$3
         AND c.education_stage <> 'UNASSIGNED'
         AND s.applicable_education_stages IS NOT NULL
         AND c.education_stage = ANY(s.applicable_education_stages)
         AND (s.applicable_year_levels IS NULL OR (
           c.year_level IS NOT NULL AND c.year_level = ANY(s.applicable_year_levels)
         ))`,
      [school_id, subject_id, curriculum, class_id]
    );
    if (!valid.rows.length) {
      const classRecord = await pool.query(
        'SELECT education_stage, curriculum FROM classes WHERE id=$1 AND school_id=$2',
        [class_id, school_id]
      );
      if (classRecord.rows[0]?.education_stage === 'UNASSIGNED'
          || classRecord.rows[0]?.curriculum === 'UNASSIGNED') {
        return res.status(409).json({ message: 'Assign this class an education section and curriculum before assigning subjects.' });
      }
      return res.status(400).json({ message: 'The subject is not valid for this class curriculum or applicable level.' });
    }
    const result = await pool.query(
      `INSERT INTO subject_class_assignments
         (school_id,class_id,subject_id,curriculum,is_compulsory,lesson_duration_minutes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (school_id,class_id,subject_id)
       DO UPDATE SET curriculum=EXCLUDED.curriculum,
                     is_compulsory=EXCLUDED.is_compulsory,
                     lesson_duration_minutes=EXCLUDED.lesson_duration_minutes,
                     updated_at=NOW()
       RETURNING *`,
      [school_id, class_id, subject_id, curriculum,
       is_compulsory, lesson_duration_minutes === null ? null : Number(lesson_duration_minutes), actorId]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getSubjectClassAssignments = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    const result = await pool.query(
      `SELECT a.*, c.name AS class_name, c.year_level, c.curriculum AS class_curriculum,
              c.education_stage, c.programme,
              s.name AS subject_name, s.code AS subject_code
       FROM subject_class_assignments a
       JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
       JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
       WHERE a.school_id=$1
       ORDER BY c.year_level, c.name, s.name`,
      [school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const upsertSubjectSchedulingPreference = async (req, res, next) => {
  const { school_id, id: actorId } = req.user;
  const { subject_id, class_id = null, preferred_day_of_week = null,
    preferred_period_slot = null, avoid_period_slot = null,
    preference_rank = 1, reason = null } = req.body;
  if (!subject_id) return res.status(400).json({ message: 'Select a subject.' });
  if (!preferred_day_of_week && preferred_period_slot === null && avoid_period_slot === null) {
    return res.status(400).json({ message: 'Choose a preferred day or period, or a period to avoid.' });
  }
  if (preferred_day_of_week && !['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].includes(preferred_day_of_week)) {
    return res.status(400).json({ message: 'Select a valid preferred day.' });
  }
  for (const [label, value] of [['preferred period', preferred_period_slot], ['period to avoid', avoid_period_slot]]) {
    if (value !== null && (!Number.isInteger(Number(value)) || Number(value) < 1)) {
      return res.status(400).json({ message: `${label} must be a positive period number.` });
    }
  }
  if (!Number.isInteger(Number(preference_rank)) || Number(preference_rank) < 1 || Number(preference_rank) > 10) {
    return res.status(400).json({ message: 'Preference rank must be between 1 and 10.' });
  }
  try {
    const subject = await pool.query('SELECT id FROM subjects WHERE id=$1 AND school_id=$2', [subject_id, school_id]);
    if (!subject.rows.length) return res.status(404).json({ message: 'Subject not found.' });
    if (class_id) {
      const validClass = await pool.query('SELECT id FROM classes WHERE id=$1 AND school_id=$2', [class_id, school_id]);
      if (!validClass.rows.length) return res.status(400).json({ message: 'Select a valid class.' });
    }
    const normalizedPreferredPeriod = preferred_period_slot === null ? null : Number(preferred_period_slot);
    const normalizedAvoidPeriod = avoid_period_slot === null ? null : Number(avoid_period_slot);
    const inserted = await pool.query(
      `INSERT INTO subject_scheduling_preferences
         (school_id,subject_id,class_id,preferred_day_of_week,preferred_period_slot,
          avoid_period_slot,preference_rank,reason,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [school_id, subject_id, class_id, preferred_day_of_week,
       normalizedPreferredPeriod, normalizedAvoidPeriod, Number(preference_rank), reason, actorId]
    );
    if (inserted.rows.length) return res.status(201).json(inserted.rows[0]);
    const updated = await pool.query(
      `UPDATE subject_scheduling_preferences
       SET preference_rank=$7, reason=$8, created_by=$9
       WHERE school_id=$1 AND subject_id=$2
         AND class_id IS NOT DISTINCT FROM $3
         AND preferred_day_of_week IS NOT DISTINCT FROM $4
         AND preferred_period_slot IS NOT DISTINCT FROM $5
         AND avoid_period_slot IS NOT DISTINCT FROM $6
       RETURNING *`,
      [school_id, subject_id, class_id, preferred_day_of_week,
       normalizedPreferredPeriod, normalizedAvoidPeriod, Number(preference_rank), reason, actorId]
    );
    res.status(200).json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
};

const getSubjectSchedulingPreferences = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    const result = await pool.query(
      `SELECT p.*, s.name AS subject_name, c.name AS class_name
       FROM subject_scheduling_preferences p
       JOIN subjects s ON s.id=p.subject_id AND s.school_id=p.school_id
       LEFT JOIN classes c ON c.id=p.class_id AND c.school_id=p.school_id
       WHERE p.school_id=$1
       ORDER BY s.name, c.name NULLS FIRST, p.preference_rank`,
      [school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  upsertSubjectClassAssignment,
  getSubjectClassAssignments,
  upsertSubjectSchedulingPreference,
  getSubjectSchedulingPreferences,
};