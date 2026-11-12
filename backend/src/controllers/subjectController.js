const pool = require('../config/db');

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
  const { name, code } = req.body;
  const curricula = req.body.curricula === undefined ? ['COMMON'] : req.body.curricula;

  if (!name) return res.status(400).json({ message: 'Subject name is required.' });
  if (!Array.isArray(curricula) || curricula.length === 0
      || curricula.some((curriculum) => !['COMMON', 'GES', 'PEARSON'].includes(curriculum))
      || new Set(curricula).size !== curricula.length) {
    return res.status(400).json({ message: 'Select one or more valid curricula for the subject.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(
      'INSERT INTO subjects (school_id, name, code) VALUES ($1, $2, $3) RETURNING *',
      [school_id, name, code || null]
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
  const { name, code, curricula } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Subject name is required.' });
  if (!Array.isArray(curricula) || curricula.length === 0
      || curricula.some((curriculum) => !['COMMON', 'GES', 'PEARSON'].includes(curriculum))
      || new Set(curricula).size !== curricula.length) {
    return res.status(400).json({ message: 'Select one or more valid curricula for the subject.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(
      'UPDATE subjects SET name = $1, code = $2 WHERE id = $3 AND school_id = $4 RETURNING *',
      [name.trim(), code || null, req.params.id, school_id]
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
    const result = await pool.query('DELETE FROM subjects WHERE id = $1 AND school_id = $2 RETURNING *', [id, school_id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Subject not found.' });
    res.json({ message: 'Subject deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSubjects, createSubject, updateSubject, deleteSubject };