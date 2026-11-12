require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schoolName = process.env.DEMO_SCHOOL_NAME || 'McCarthy Hill School';
const academicYear = process.env.DEMO_ACADEMIC_YEAR || '2026/2027';
const termName = process.env.DEMO_TERM || 'Term 1';

const classTemplates = [
  { name: 'Primary 1A', year_level: 1 },
  { name: 'Primary 1B', year_level: 1 },
  { name: 'Primary 2A', year_level: 2 },
  { name: 'Primary 2B', year_level: 2 },
  { name: 'Primary 3A', year_level: 3 },
  { name: 'Primary 3B', year_level: 3 },
  { name: 'Primary 4A', year_level: 4 },
  { name: 'Primary 5A', year_level: 5 },
  { name: 'Primary 6A', year_level: 6 },
  { name: 'JHS 1A', year_level: 7 }
];

const subjectList = [
  'Mathematics',
  'English',
  'Science',
  'Social Studies',
  'ICT',
  'Creative Arts',
  'Religious and Moral Education',
  'Ghanaian Language',
  'Physical Education',
  'French',
  'Home Economics'
];

const firstNames = [
  'Ama', 'Kojo', 'Efua', 'Kwame', 'Akua', 'Yaw', 'Mabel', 'Daniel', 'Abena', 'Naa',
  'Esi', 'Kofi', 'Adjoa', 'Paa', 'Nana', 'Seth', 'Afi', 'George', 'Grace', 'Michael',
  'Sarah', 'Nathan', 'Ella', 'Isaac', 'Ruth', 'David', 'Rebecca', 'Joseph', 'Mercy', 'Samuel'
];

const lastNames = [
  'Owusu', 'Boateng', 'Danso', 'Mensah', 'Adu', 'Johnson', 'Addai', 'Sarpong', 'Tetteh', 'Appiah',
  'Nkrumah', 'Kwakye', 'Asare', 'Fosu', 'Ofori', 'Annan', 'Amoah', 'Arthur', 'Baah', 'Bediako'
];

const allergiesOptions = ['', 'Peanuts', 'Milk', 'Shellfish', 'Pollen', 'Eggs'];
const disabilityOptions = ['', 'Asthma', 'Low vision', 'Hearing support', 'Wheelchair support', 'Learning support'];

async function ensureSchool() {
  const existing = await pool.query('SELECT * FROM schools WHERE name = $1 LIMIT 1', [schoolName]);

  if (existing.rows.length) {
    await pool.query(
      'UPDATE schools SET academic_year = $1, current_term = $2 WHERE id = $3',
      [academicYear, termName, existing.rows[0].id]
    );
    return existing.rows[0];
  }

  const created = await pool.query(
    `INSERT INTO schools (name, address, phone, currency, academic_year, current_term)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [schoolName, 'Demo Campus Road', '+233 200 000 000', 'GHS', academicYear, termName]
  );

  return created.rows[0];
}

async function ensureTerm(schoolId) {
  const termResult = await pool.query(
    `INSERT INTO timetable_terms (school_id, academic_year, term)
     VALUES ($1, $2, $3)
     ON CONFLICT (school_id, academic_year, term) DO NOTHING
     RETURNING id`,
    [schoolId, academicYear, termName]
  );

  if (termResult.rows[0]) {
    return termResult.rows[0].id;
  }

  const existing = await pool.query(
    'SELECT id FROM timetable_terms WHERE school_id = $1 AND academic_year = $2 AND term = $3 LIMIT 1',
    [schoolId, academicYear, termName]
  );

  return existing.rows[0]?.id;
}

async function upsertTeacher(schoolId, fullName, email) {
  const hash = await bcrypt.hash('Teacher@1234', 10);
  const existing = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);

  if (existing.rows[0]) {
    await pool.query(
      `UPDATE users
       SET school_id = $1,
           name = $2,
           role = 'teacher',
           password = $3,
           is_active = TRUE,
           email_verified = TRUE,
           must_change_password = FALSE
       WHERE id = $4`,
      [schoolId, fullName, hash, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }

  const inserted = await pool.query(
    `INSERT INTO users (school_id, name, email, password, role, must_change_password, is_active, email_verified)
     VALUES ($1, $2, $3, $4, 'teacher', FALSE, TRUE, TRUE)
     RETURNING id`,
    [schoolId, fullName, email, hash]
  );

  return inserted.rows[0].id;
}

async function upsertSubject(schoolId, subjectName) {
  const result = await pool.query(
    `INSERT INTO subjects (school_id, name, code)
     VALUES ($1, $2, $3)
     ON CONFLICT (school_id, name) DO UPDATE SET code = EXCLUDED.code
     RETURNING id`,
    [schoolId, subjectName, subjectName.slice(0, 6).toUpperCase().replace(/[^A-Z]/g, '') || 'SUBJ']
  );

  return result.rows[0].id;
}

async function upsertClass(schoolId, className, yearLevel, teacherId) {
  const result = await pool.query(
    `INSERT INTO classes (school_id, name, description, teacher_id, class_teacher_id, year_level, teaching_model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (school_id, name) DO UPDATE
       SET description = EXCLUDED.description,
           teacher_id = EXCLUDED.teacher_id,
           class_teacher_id = EXCLUDED.class_teacher_id,
           year_level = EXCLUDED.year_level,
           teaching_model = EXCLUDED.teaching_model
     RETURNING id`,
    [schoolId, className, `${className} demonstration class`, teacherId, teacherId, yearLevel, yearLevel <= 3 ? 'class_teacher' : 'subject_teacher']
  );

  return result.rows[0].id;
}

async function upsertClassTeacherAssignment(schoolId, termId, classId, teacherId) {
  await pool.query(
    `INSERT INTO timetable_class_teacher_assignments (school_id, term_id, class_id, teacher_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (school_id, term_id, class_id) DO UPDATE SET teacher_id = EXCLUDED.teacher_id`,
    [schoolId, termId, classId, teacherId]
  );
}

async function upsertTeacherSubjectAssignment(schoolId, termId, teacherId, subjectId, classId) {
  await pool.query(
    `INSERT INTO teacher_subject_assignments (school_id, term_id, teacher_id, subject_id, class_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (school_id, term_id, teacher_id, subject_id, class_id) DO NOTHING`,
    [schoolId, termId, teacherId, subjectId, classId]
  );
}

async function seedStudents(schoolId, classId, className, totalStudents) {
  for (let i = 1; i <= totalStudents; i += 1) {
    const firstName = firstNames[(i + classId) % firstNames.length];
    const lastName = lastNames[(i * 3 + classId) % lastNames.length];
    const studentName = `${firstName} ${lastName}`;
    const dob = new Date(2013 + (classId % 5), (i % 12), (i % 28) + 1).toISOString().slice(0, 10);
    const allergies = allergiesOptions[(i + classId) % allergiesOptions.length];
    const disability = disabilityOptions[(i * 2 + classId) % disabilityOptions.length];

    await pool.query(
      `INSERT INTO students (school_id, class_id, name, dob, allergies, disability)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [schoolId, classId, studentName, dob, allergies || null, disability || null]
    );
  }
}

(async () => {
  try {
    const school = await ensureSchool();
    const schoolId = school.id;
    const termId = await ensureTerm(schoolId);

    if (!termId) {
      throw new Error('A school term could not be prepared for the demo dataset.');
    }

    const classTeacherIds = {};
    const subjectTeacherIds = {};

    for (const classItem of classTemplates) {
      const teacherName = `${classItem.name} Teacher`;
      const teacherEmail = `${classItem.name.toLowerCase().replace(/\s+/g, '.')}.teacher@mcchill.demo`;
      const teacherId = await upsertTeacher(schoolId, teacherName, teacherEmail);
      classTeacherIds[classItem.name] = teacherId;

      const classId = await upsertClass(schoolId, classItem.name, classItem.year_level, teacherId);
      await upsertClassTeacherAssignment(schoolId, termId, classId, teacherId);
      await seedStudents(schoolId, classId, classItem.name, 50);
    }

    for (const subjectName of subjectList) {
      const subjectId = await upsertSubject(schoolId, subjectName);
      const teacherName = `${subjectName} Teacher`;
      const teacherEmail = `${subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.teacher@mcchill.demo`;
      const teacherId = await upsertTeacher(schoolId, teacherName, teacherEmail);
      subjectTeacherIds[subjectName] = teacherId;

      for (const classItem of classTemplates) {
        const classRecord = await pool.query('SELECT id FROM classes WHERE school_id = $1 AND name = $2 LIMIT 1', [schoolId, classItem.name]);
        if (!classRecord.rows[0]) continue;
        await upsertTeacherSubjectAssignment(schoolId, termId, teacherId, subjectId, classRecord.rows[0].id);
      }
    }

    console.log(`Demo school created for ${schoolName}.`);
    console.log(`School ID: ${schoolId}`);
    console.log(`Classes: ${classTemplates.length}`);
    console.log(`Students seeded: ${classTemplates.length * 50}`);
    console.log(`Subjects: ${subjectList.length}`);
    console.log(`Teachers: ${Object.keys(classTeacherIds).length + Object.keys(subjectTeacherIds).length}`);
    console.log('Default teacher password for all demo teachers: Teacher@1234');
    console.log('Open the app and log in with the administrator account to view the demo data.');
  } catch (error) {
    console.error('Demo seeding failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
