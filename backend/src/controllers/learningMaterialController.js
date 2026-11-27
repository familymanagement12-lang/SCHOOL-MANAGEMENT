const pool = require('../config/db');
const assignmentStorage = require('../services/assignmentStorage');
const { MAX_FILES_PER_UPLOAD } = assignmentStorage;
const { teacherCanTeach } = require('./assignmentController');

const isPositiveId = (value) => /^\d+$/.test(String(value))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0;

const getMeta = async (req, res, next) => {
  const { school_id: schoolId, id: userId, role } = req.user;
  try {
    const terms = await pool.query(
      `SELECT tt.id,tt.academic_year,tt.term,
         (tt.academic_year=sc.academic_year AND tt.term=sc.current_term) AS is_current
       FROM timetable_terms tt JOIN schools sc ON sc.id=tt.school_id
       WHERE tt.school_id=$1 ORDER BY tt.academic_year DESC,tt.term`, [schoolId]
    );
    const termId = req.query.term_id || terms.rows.find((item) => item.is_current)?.id || terms.rows[0]?.id;
    if (!termId) return res.json({ terms: terms.rows, selected_term_id: null, classes: [], pairs: [] });
    if (!terms.rows.some((term) => String(term.id) === String(termId))) {
      return res.status(400).json({ message: 'The selected term does not belong to this school.' });
    }
    const pairs = await pool.query(
      `SELECT DISTINCT c.id AS class_id,c.name AS class_name,s.id AS subject_id,s.name AS subject_name,
          COALESCE(tsa.teacher_id,tca.teacher_id) AS teacher_id,u.name AS teacher_name
       FROM subject_weekly_requirements r
       JOIN classes c ON c.id=r.class_id AND c.school_id=r.school_id
       JOIN subjects s ON s.id=r.subject_id AND s.school_id=r.school_id
       LEFT JOIN teacher_subject_assignments tsa ON tsa.school_id=r.school_id AND tsa.term_id=r.term_id
         AND tsa.class_id=r.class_id AND tsa.subject_id=r.subject_id
         AND ($3::TEXT='admin' OR tsa.teacher_id=$4)
       LEFT JOIN timetable_class_teacher_assignments tca ON tca.school_id=r.school_id
         AND tca.term_id=r.term_id AND tca.class_id=r.class_id
         AND ($3::TEXT='admin' OR tca.teacher_id=$4)
       LEFT JOIN users u ON u.id=COALESCE(tsa.teacher_id,tca.teacher_id) AND u.school_id=r.school_id
         AND u.role='teacher' AND u.is_active=TRUE
       WHERE r.school_id=$1 AND r.term_id=$2
         AND ($3::TEXT='admin' OR tsa.teacher_id=$4 OR tca.teacher_id=$4)
       ORDER BY c.name,s.name`, [schoolId,termId,role,userId]
    );
    res.json({
      terms: terms.rows,
      selected_term_id: Number(termId),
      pairs: pairs.rows,
      classes: [...new Map(pairs.rows.map((pair) => [pair.class_id, { id: pair.class_id, name: pair.class_name }])).values()],
    });
  } catch (error) { next(error); }
};

const listStaffMaterials = async (req, res, next) => {
  if (req.query.term_id && !isPositiveId(req.query.term_id)) {
    return res.status(400).json({ message: 'Choose a valid academic term.' });
  }
  try {
    const result = await pool.query(
      `SELECT m.id,m.title,m.description,m.status,m.academic_year,m.term,m.term_id,
          m.class_id,c.name AS class_name,m.subject_id,s.name AS subject_name,
          m.teacher_id,u.name AS teacher_name,m.created_at,
          COALESCE(json_agg(json_build_object('id',f.id,'original_name',f.original_name,
             'content_type',f.content_type,'file_size',f.file_size)) FILTER (WHERE f.id IS NOT NULL),'[]'::json) AS files
       FROM learning_materials m
       JOIN classes c ON c.id=m.class_id AND c.school_id=m.school_id
       JOIN subjects s ON s.id=m.subject_id AND s.school_id=m.school_id
       JOIN users u ON u.id=m.teacher_id AND u.school_id=m.school_id
       LEFT JOIN learning_material_files f ON f.school_id=m.school_id AND f.material_id=m.id
       WHERE m.school_id=$1 AND ($2::BIGINT IS NULL OR m.term_id=$2)
         AND public.assignment_staff_scope(m.school_id,m.teacher_id,m.class_id,m.subject_id,m.term_id)
       GROUP BY m.id,c.name,s.name,u.name ORDER BY m.created_at DESC,m.id DESC`,
      [req.user.school_id,req.query.term_id || null]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
};

const createMaterial = async (req, res, next) => {
  const { school_id: schoolId, id: actorId, role } = req.user;
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const classId = Number(req.body.class_id), subjectId = Number(req.body.subject_id), termId = Number(req.body.term_id);
  const teacherId = role === 'teacher' ? actorId : Number(req.body.teacher_id);
  if (!title || title.length > 200 || description.length > 5000
      || ![classId,subjectId,termId,teacherId].every(isPositiveId)) {
    return res.status(400).json({ message: 'Enter a title and choose a configured term, class, subject, and teacher.' });
  }
  if (!req.files?.length || req.files.length > MAX_FILES_PER_UPLOAD) {
    return res.status(400).json({ message: `Attach between one and ${MAX_FILES_PER_UPLOAD} supported files.` });
  }
  const uploaded = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const term = await client.query(
      'SELECT academic_year,term FROM timetable_terms WHERE school_id=$1 AND id=$2', [schoolId,termId]
    );
    if (!term.rowCount || !await teacherCanTeach(client,{ schoolId,teacherId,classId,subjectId,termId })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'That teacher is not allocated to this class and subject for the selected term.' });
    }
    const inserted = await client.query(
      `INSERT INTO learning_materials
       (school_id,teacher_id,class_id,subject_id,academic_year,term,term_id,title,description,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PUBLISHED') RETURNING id`,
      [schoolId,teacherId,classId,subjectId,term.rows[0].academic_year,term.rows[0].term,termId,title,description]
    );
    const materialId = inserted.rows[0].id;
    for (const file of req.files) {
      const stored = await assignmentStorage.putPrivateFile({
        schoolId, assignmentId: materialId, resource: 'materials', kind: 'files', file,
      });
      uploaded.push(stored.storage_key);
      await client.query(
        `INSERT INTO learning_material_files
         (school_id,material_id,storage_key,original_name,content_type,file_size,uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [schoolId,materialId,stored.storage_key,stored.original_name,stored.content_type,stored.file_size,actorId]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ id: materialId, message: 'Learning material published.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const cleanup = await Promise.allSettled(uploaded.map((key) => assignmentStorage.deletePrivateFile(key)));
    cleanup.filter((item) => item.status === 'rejected').forEach((item) => {
      console.error('Failed to remove an orphaned learning material file:', item.reason);
    });
    next(error);
  } finally { client.release(); }
};

const listStudentMaterials = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.id,m.title,m.description,m.academic_year,m.term,m.created_at,
          c.name AS class_name,s.name AS subject_name,u.name AS teacher_name,
          json_agg(json_build_object('id',f.id,'original_name',f.original_name,
            'content_type',f.content_type,'file_size',f.file_size) ORDER BY f.id) AS files
       FROM students st JOIN learning_materials m ON m.school_id=st.school_id AND m.class_id=st.class_id
       JOIN learning_material_files f ON f.school_id=m.school_id AND f.material_id=m.id
       JOIN classes c ON c.id=m.class_id AND c.school_id=m.school_id
       JOIN subjects s ON s.id=m.subject_id AND s.school_id=m.school_id
       JOIN users u ON u.id=m.teacher_id AND u.school_id=m.school_id
       WHERE st.school_id=$1 AND st.user_id=$2 AND m.status='PUBLISHED'
       GROUP BY m.id,c.name,s.name,u.name ORDER BY m.created_at DESC,m.id DESC`,
      [req.user.school_id,req.user.id]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
};

const downloadMaterialFile = async (req, res, next) => {
  if (!isPositiveId(req.params.id) || !isPositiveId(req.params.fileId)) {
    return res.status(400).json({ message: 'Choose a valid learning material file.' });
  }
  try {
    let result;
    if (req.user.role === 'student') {
      result = await pool.query(
        `SELECT f.id,f.storage_key,f.original_name,f.content_type,f.file_size
         FROM learning_material_files f JOIN learning_materials m
           ON m.school_id=f.school_id AND m.id=f.material_id
         JOIN students st ON st.school_id=m.school_id AND st.class_id=m.class_id
         WHERE st.school_id=$1 AND st.user_id=$2 AND m.id=$3 AND f.id=$4 AND m.status='PUBLISHED'`,
        [req.user.school_id,req.user.id,req.params.id,req.params.fileId]
      );
    } else {
      result = await pool.query(
        `SELECT f.id,f.storage_key,f.original_name,f.content_type,f.file_size
         FROM learning_material_files f JOIN learning_materials m
           ON m.school_id=f.school_id AND m.id=f.material_id
         WHERE m.school_id=$1 AND m.id=$2 AND f.id=$3
           AND public.assignment_staff_scope(m.school_id,m.teacher_id,m.class_id,m.subject_id,m.term_id)`,
        [req.user.school_id,req.params.id,req.params.fileId]
      );
    }
    const file = result.rows[0];
    if (!file) return res.status(404).json({ message: 'File not found or you are not authorized to access it.' });
    const object = await assignmentStorage.getPrivateFile(file.storage_key);
    res.setHeader('Content-Type',file.content_type);
    res.setHeader('Content-Length',file.file_size);
    res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options','nosniff');
    object.Body.on('error',next);
    object.Body.pipe(res);
  } catch (error) { next(error); }
};

module.exports = { getMeta,listStaffMaterials,createMaterial,listStudentMaterials,downloadMaterialFile };
