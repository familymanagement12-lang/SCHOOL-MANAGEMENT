const pool = require('../config/db');

const ALLOWED_ROLES = new Set(['admin', 'teacher', 'librarian', 'inventory', 'store', 'storekeeper']);
const INTENTS = [
  ['staff_attendance', /\bstaff\b.*\b(?:attendance|attended|absent)\b|\battendance\b.*\bstaff\b|\bemployees?\b.*\b(?:attendance|absent)\b|\battendance\b.*\bemployees?\b/i],
  ['library_circulation', /borrow|loan|overdue|circulation/i],
  ['library_search', /book|library|reading list|catalog|catalogue/i],
  ['announcements', /\bannouncements?\b|\bschool notices?\b/i],
  ['inventory_issuance', /issued items|items (?:were )?issued|stock issued|inventory issuance|supplies issued/i],
  ['assignments', /assignments?|homework submissions?|submitted work|student submissions?/i],
  ['staff', /staff list|employees?|staff records|staff numbers|staff members/i],
  ['attendance', /attendance|absen|present today|late today/i],
  ['academic', /result|exam|score|grade|performance|academic|subject average|support/i],
  ['fees', /fee|balance|outstanding|collection/i],
  ['finance', /income|expenditure|expense|transaction|financial/i],
  ['timetable', /timetable|schedule|period|lesson gap|scheduling/i],
  ['inventory', /inventory|stock|supplies|quantity/i],
  ['enrollment', /student|enrol|enroll|class distribution/i],
];

const SENSITIVE_RECORDS = /\ballerg(?:y|ies)\b|\bmedical records?\b|\bhealth records?\b|\bdiagnos(?:is|es)\b|\bdisabilit(?:y|ies)\b/i;
const classifyQuestion = (question) => SENSITIVE_RECORDS.test(question)
  ? 'unsupported_school_data'
  : INTENTS.find(([, pattern]) => pattern.test(question))?.[0]
    || (/student|pupil|teacher|library|attendance|enrol|enroll|class|fee|balance|payment|stock|inventory|timetable|result|exam|grade|staff|employee|announcement|assignment|submission/i.test(question)
      ? 'unsupported_school_data'
      : 'general');

function allowedIntent(role, intent) {
  const normalizedRole = ['store', 'storekeeper'].includes(role) ? 'inventory' : role;
  if (normalizedRole === 'admin') return intent !== 'unsupported_school_data';
  if (intent === 'general') return true;
  if (normalizedRole === 'teacher') return ['attendance', 'academic', 'timetable', 'library_search', 'enrollment', 'announcements', 'assignments'].includes(intent);
  if (normalizedRole === 'librarian') return ['library_search', 'library_circulation'].includes(intent);
  if (normalizedRole === 'inventory') return ['inventory', 'inventory_issuance'].includes(intent);
  return false;
}

async function getScope(user) {
  const role = ['store', 'storekeeper'].includes(user.role) ? 'inventory' : user.role;
  if (role === 'admin') return { classIds: null, studentIds: null };
  if (role === 'teacher') {
    await pool.query(`CREATE TABLE IF NOT EXISTS teacher_subject_assignments (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (school_id, teacher_id, subject_id, class_id)
    )`);
    const result = await pool.query(
      `SELECT c.id FROM classes c WHERE c.school_id = $1 AND
         (c.class_teacher_id = $2 OR EXISTS (
           SELECT 1 FROM teacher_subject_assignments tsa
           WHERE tsa.school_id = c.school_id AND tsa.class_id = c.id AND tsa.teacher_id = $2
         )) ORDER BY c.id`,
      [user.school_id, user.id]
    );
    return { classIds: result.rows.map((row) => Number(row.id)), studentIds: null };
  }
  if (role === 'librarian' || role === 'inventory') {
    return { classIds: [], studentIds: [] };
  }
  return { classIds: [], studentIds: [] };
}

async function collectVerifiedFacts(user, intent, question) {
  const { school_id: schoolId } = user;
  const schoolResult = await pool.query('SELECT name, academic_year, current_term, currency FROM schools WHERE id = $1', [schoolId]);
  const school = schoolResult.rows[0] || {};
  const scope = await getScope(user);
  const classFilter = scope.classIds ? 'AND c.id = ANY($2::INTEGER[])' : '';
  let data;
  let source;

  if (intent === 'enrollment') {
    if (scope.studentIds) {
      data = { note: 'Only the signed-in student or linked child is in scope.', students: scope.studentIds.length };
      source = 'Authorized student account records';
    } else {
      const values = scope.classIds ? [schoolId, scope.classIds] : [schoolId];
      const result = await pool.query(
        `SELECT c.name AS class, COUNT(s.id)::INTEGER AS students
         FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.school_id = c.school_id
         WHERE c.school_id = $1 ${classFilter} GROUP BY c.id, c.name ORDER BY c.name`, values
      );
      data = result.rows;
      source = 'Class register enrollment counts';
    }
  } else if (intent === 'attendance') {
    if (scope.studentIds) {
      const values = [schoolId, scope.studentIds];
      const result = await pool.query(
        `SELECT a.date::TEXT AS date, a.status, COUNT(*)::INTEGER AS records
         FROM attendance a JOIN students s ON s.id = a.student_id AND s.school_id = a.school_id
         WHERE a.school_id = $1 AND s.id = ANY($2::INTEGER[])
         GROUP BY a.date, a.status ORDER BY a.date DESC LIMIT 30`, values
      );
      data = result.rows;
      source = 'Attendance records for the signed-in account';
    } else {
      const values = scope.classIds ? [schoolId, scope.classIds] : [schoolId];
      const result = await pool.query(
        `SELECT c.name AS class, dates.day::DATE::TEXT AS date,
                COUNT(DISTINCT s.id)::INTEGER AS enrolled,
                COUNT(DISTINCT a.student_id)::INTEGER AS attendance_records,
                COUNT(a.id) FILTER (WHERE a.status = 'present')::INTEGER AS present,
                COUNT(a.id) FILTER (WHERE a.status = 'absent')::INTEGER AS absent,
                COUNT(a.id) FILTER (WHERE a.status = 'late')::INTEGER AS late,
                COUNT(a.id) FILTER (WHERE a.status = 'excused')::INTEGER AS excused
         FROM classes c
         LEFT JOIN students s ON s.class_id = c.id AND s.school_id = c.school_id
         CROSS JOIN generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS dates(day)
         LEFT JOIN attendance a ON a.student_id = s.id AND a.school_id = c.school_id AND a.date = dates.day::DATE
         WHERE c.school_id = $1 ${scope.classIds ? 'AND c.id = ANY($2::INTEGER[])' : ''}
         GROUP BY c.id, c.name, dates.day ORDER BY dates.day DESC, c.name`, values
      );
      data = result.rows;
      source = 'Class register and attendance completion by class for the last 7 days';
    }
  } else if (intent === 'academic') {
    const term = school.current_term;
    if (scope.studentIds) {
      const values = [schoolId, scope.studentIds, term || null];
      const result = await pool.query(
        `SELECT r.term, r.subject, ROUND(AVG(r.score), 2)::FLOAT AS average_score, COUNT(*)::INTEGER AS assessments
         FROM results r JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
         WHERE r.school_id = $1 AND s.id = ANY($2::INTEGER[]) AND ($3::TEXT IS NULL OR r.term = $3)
         GROUP BY r.term, r.subject ORDER BY r.term, r.subject`, values
      );
      data = result.rows;
      source = `Authorized academic results${term ? ` for ${term}` : ''}`;
    } else {
      const values = scope.classIds ? [schoolId, term || null, scope.classIds] : [schoolId, term || null];
      const result = await pool.query(
        `SELECT r.term, c.name AS class, r.subject, ROUND(AVG(r.score), 2)::FLOAT AS average_score, COUNT(*)::INTEGER AS assessments
         FROM results r JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
         LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
         WHERE r.school_id = $1 AND ($2::TEXT IS NULL OR r.term = $2) ${scope.classIds ? 'AND c.id = ANY($3::INTEGER[])' : ''}
         GROUP BY r.term, c.id, c.name, r.subject ORDER BY r.term, c.name, average_score ASC`, values
      );
      data = result.rows;
      source = `Calculated class and subject averages${term ? ` for ${term}` : ' across recorded terms'}`;
    }
  } else if (intent === 'fees') {
    if (user.role !== 'admin') return { unavailable: 'Fee and balance information is restricted to administrators.' };
    const result = await pool.query(
      `SELECT COALESCE(fs.academic_year, s.academic_year) AS academic_year,
              COALESCE(fs.term, 'Unassigned') AS term,
              COUNT(DISTINCT f.student_id)::INTEGER AS students,
              COALESCE(SUM(f.amount_due), 0)::NUMERIC(12,2)::FLOAT AS amount_due,
              COALESCE(SUM(f.amount_paid), 0)::NUMERIC(12,2)::FLOAT AS amount_paid,
              COALESCE(SUM(f.balance), 0)::NUMERIC(12,2)::FLOAT AS balance
       FROM fees f JOIN students st ON st.id = f.student_id AND st.school_id = f.school_id
       LEFT JOIN fee_structures fs ON fs.id = (SELECT fa.fee_structure_id FROM student_fee_accounts fa
         WHERE fa.school_id = f.school_id AND fa.student_id = f.student_id ORDER BY fa.created_at DESC LIMIT 1)
       JOIN schools s ON s.id = f.school_id
       WHERE f.school_id = $1 GROUP BY fs.academic_year, fs.term, s.academic_year ORDER BY academic_year, term`, [schoolId]
    );
    data = result.rows;
    source = 'Recorded fee accounts and balances';
  } else if (intent === 'finance') {
    if (user.role !== 'admin') return { unavailable: 'Income and expenditure records are restricted to administrators.' };
    const result = await pool.query(
      `SELECT type, category, COUNT(*)::INTEGER AS transactions,
              COALESCE(SUM(amount), 0)::NUMERIC(12,2)::FLOAT AS amount,
              MIN(date)::TEXT AS first_recorded, MAX(date)::TEXT AS last_recorded
       FROM transactions WHERE school_id = $1 GROUP BY type, category ORDER BY type, category`, [schoolId]
    );
    data = result.rows;
    source = 'Recorded income and expenditure transactions (all recorded dates)';
  } else if (intent === 'library_search') {
    const phrase = question.match(/(?:about|on|for|related to|like)\s+(.+)$/i)?.[1]?.replace(/[?.!]+$/, '').trim();
    const term = phrase?.slice(0, 80) || '';
    const result = await pool.query(
      `SELECT title, author, category, total_copies, available_copies,
              CASE WHEN available_copies > 0 THEN 'available' ELSE 'currently unavailable' END AS availability
       FROM library_books WHERE school_id = $1 AND ($2::TEXT = '' OR title ILIKE '%' || $2 || '%'
         OR author ILIKE '%' || $2 || '%' OR category ILIKE '%' || $2 || '%')
       ORDER BY available_copies DESC, title LIMIT 12`, [schoolId, term]
    );
    data = result.rows;
    source = `Library catalogue${term ? ` search for “${term}”` : ''}; availability checked against current copy counts`;
  } else if (intent === 'library_circulation') {
    if (!['admin', 'librarian'].includes(user.role)) return { unavailable: 'Borrowing and overdue summaries are restricted to administrators and library staff.' };
    const result = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'borrowed')::INTEGER AS borrowed,
              COUNT(*) FILTER (WHERE status = 'borrowed' AND due_date < CURRENT_DATE)::INTEGER AS overdue,
              COUNT(*) FILTER (WHERE status = 'returned' AND returned_at >= CURRENT_DATE - INTERVAL '30 days')::INTEGER AS returned_last_30_days
       FROM library_loans WHERE school_id = $1`, [schoolId]
    );
    data = result.rows[0];
    source = 'Library loan and return register';
  } else if (intent === 'inventory') {
    const role = ['store', 'storekeeper'].includes(user.role) ? 'inventory' : user.role;
    if (!['admin', 'inventory'].includes(role)) return { unavailable: 'Inventory records are restricted to administrators and inventory staff.' };
    const result = await pool.query(
      `SELECT category, COUNT(*)::INTEGER AS item_types, COALESCE(SUM(quantity), 0)::INTEGER AS total_units
       FROM inventory WHERE school_id = $1 GROUP BY category ORDER BY category`, [schoolId]
    );
    data = result.rows;
    source = 'Recorded inventory quantities by category';
  } else if (intent === 'inventory_issuance') {
    const role = ['store', 'storekeeper'].includes(user.role) ? 'inventory' : user.role;
    if (!['admin', 'inventory'].includes(role)) {
      return { unavailable: 'Issued inventory records are restricted to administrators and store staff.' };
    }
    const result = await pool.query(
      `SELECT i.item_name, SUM(ii.quantity)::INTEGER AS units_issued,
              COUNT(DISTINCT x.id)::INTEGER AS issuances
       FROM inventory_issuance_items ii
       JOIN inventory_issuances x ON x.id = ii.issuance_id AND x.school_id = ii.school_id
       JOIN inventory i ON i.id = ii.inventory_id AND i.school_id = ii.school_id
       WHERE ii.school_id = $1 AND x.issued_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY i.id, i.item_name ORDER BY units_issued DESC, i.item_name LIMIT 20`,
      [schoolId]
    );
    data = result.rows;
    source = 'Inventory issues from the last 30 days';
  } else if (intent === 'staff') {
    if (user.role !== 'admin') return { unavailable: 'Staff information is restricted to administrators.' };
    const result = await pool.query(
      `SELECT role, COUNT(*)::INTEGER AS staff,
              COUNT(*) FILTER (WHERE is_active)::INTEGER AS active,
              COUNT(*) FILTER (WHERE NOT is_active)::INTEGER AS inactive
       FROM employees WHERE school_id = $1 GROUP BY role ORDER BY role`,
      [schoolId]
    );
    data = result.rows;
    source = 'Staff register totals by role';
  } else if (intent === 'staff_attendance') {
    if (user.role !== 'admin') return { unavailable: 'Staff attendance is restricted to administrators.' };
    const result = await pool.query(
      `SELECT attendance_date::TEXT AS date, status, COUNT(*)::INTEGER AS records
       FROM staff_attendance
       WHERE school_id = $1 AND attendance_date >= CURRENT_DATE - INTERVAL '29 days'
       GROUP BY attendance_date, status ORDER BY attendance_date DESC, status`,
      [schoolId]
    );
    data = result.rows;
    source = 'Staff attendance records from the last 30 days';
  } else if (intent === 'announcements') {
    if (!['admin', 'teacher'].includes(user.role)) {
      return { unavailable: 'School announcements are not available to this account.' };
    }
    const classIds = scope.classIds || [];
    const result = await pool.query(
      `SELECT a.title, a.message, c.name AS class
       FROM announcements a LEFT JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
       WHERE a.school_id = $1
         AND ($3::BOOLEAN OR a.audience = 'everyone' OR a.class_id = ANY($2::INTEGER[]))
       ORDER BY a.created_at DESC LIMIT 10`,
      [schoolId, classIds, user.role === 'admin']
    );
    data = result.rows;
    source = 'School announcements you are allowed to view';
  } else if (intent === 'timetable') {
    if (user.role === 'parent' || user.role === 'student') {
      const result = await pool.query(
        `SELECT DISTINCT c.id FROM students s JOIN classes c ON c.id = s.class_id
         WHERE s.school_id = $1 AND s.id = ANY($2::INTEGER[])`, [schoolId, scope.studentIds]
      );
      scope.classIds = result.rows.map((row) => Number(row.id));
    }
    const values = scope.classIds ? [schoolId, scope.classIds] : [schoolId];
    const result = await pool.query(
      `SELECT c.name AS class, t.day_of_week, COUNT(*)::INTEGER AS lesson_entries,
              COALESCE(SUM(t.period_count), COUNT(*))::INTEGER AS periods
       FROM timetables t JOIN classes c ON c.id = t.class_id AND c.school_id = t.school_id
       WHERE t.school_id = $1 ${scope.classIds ? 'AND c.id = ANY($2::INTEGER[])' : ''}
       GROUP BY c.name, t.day_of_week ORDER BY c.name, t.day_of_week`, values
    );
    data = result.rows;
    source = `Timetable entries${school.current_term ? ` for ${school.academic_year || 'current year'}, ${school.current_term}` : ''}`;
  } else if (intent === 'assignments') {
    data = [];
    source = 'Assignment records are not configured';
  } else {
    data = { available_topics: ['lesson plans', 'quizzes', 'revision questions', 'study guidance'] };
    source = 'No school record query needed';
  }

  return {
    school: { name: school.name, academic_year: school.academic_year, current_term: school.current_term, currency: school.currency },
    data,
    source,
    notAvailable: intent === 'assignments',
  };
}

function fallbackAnswer(intent, facts) {
  if (facts.unavailable) return 'Sorry, you cannot view that information with this account.';
  if (facts.notAvailable) return 'Assignment and submission records are not available in the school records yet.';
  if (intent === 'general') return 'I can help explain a topic or prepare a lesson, quiz, revision questions, or study guide.';
  const rows = Array.isArray(facts.data) ? facts.data : facts.data ? [facts.data] : [];
  if (!rows.length) return 'I couldn’t find any matching information. Try asking in a different way.';

  const money = (amount) => new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: facts.school?.currency || 'GHS',
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
  const bullets = (items) => items.map((item) => `- ${item}`).join('\n');

  if (intent === 'enrollment') {
    const total = rows.reduce((sum, row) => sum + Number(row.students || 0), 0);
    return `There are ${total} students across ${rows.length} ${rows.length === 1 ? 'class' : 'classes'}.\n${bullets(rows.map((row) => `${row.class}: ${row.students} ${Number(row.students) === 1 ? 'student' : 'students'}`))}`;
  }
  if (intent === 'attendance') {
    const totals = rows.reduce((sum, row) => {
      const status = String(row.status || '').toLowerCase();
      return {
        present: sum.present + Number(row.present || (status === 'present' ? row.records : 0) || 0),
        absent: sum.absent + Number(row.absent || (status === 'absent' ? row.records : 0) || 0),
        late: sum.late + Number(row.late || (status === 'late' ? row.records : 0) || 0),
        excused: sum.excused + Number(row.excused || (status === 'excused' ? row.records : 0) || 0),
        enrolled: sum.enrolled + Number(row.enrolled || 0),
      };
    }, { present: 0, absent: 0, late: 0, excused: 0, enrolled: 0 });
    const records = rows.reduce((sum, row) => sum + Number(row.records || row.attendance_records || 0), 0);
    if (rows[0].date && rows[0].status) {
      return `For the records I found: ${totals.present} present, ${totals.absent} absent, ${totals.late} late, and ${totals.excused} excused across ${records} attendance records.`;
    }
    return `Over the last 7 days, there were ${totals.present} present, ${totals.absent} absent, ${totals.late} late, and ${totals.excused} excused marks across ${totals.enrolled} student-days.`;
  }
  if (intent === 'academic') {
    return `Here are the average results I found:\n${bullets(rows.slice(0, 8).map((row) => `${row.class ? `${row.class}, ` : ''}${row.subject}${row.term ? ` (${row.term})` : ''}: ${row.average_score}`))}`;
  }
  if (intent === 'fees') {
    const totals = rows.reduce((sum, row) => ({
      due: sum.due + Number(row.amount_due || 0),
      paid: sum.paid + Number(row.amount_paid || 0),
      balance: sum.balance + Number(row.balance || 0),
    }), { due: 0, paid: 0, balance: 0 });
    return `School fees: ${money(totals.due)} billed, ${money(totals.paid)} paid, and ${money(totals.balance)} still owed.`;
  }
  if (intent === 'finance') {
    return `Here is the money recorded:\n${bullets(rows.slice(0, 10).map((row) => `${row.category || 'Other'} — ${money(row.amount)} (${row.type === 'income' ? 'income' : 'expenses'})`))}`;
  }
  if (intent === 'library_search') {
    return `Here are some matching books:\n${bullets(rows.slice(0, 10).map((row) => `${row.title} by ${row.author} — ${row.available_copies} available`))}`;
  }
  if (intent === 'library_circulation') {
    const row = rows[0];
    return `There are ${row.borrowed} books currently borrowed, ${row.overdue} overdue, and ${row.returned_last_30_days} returned in the past 30 days.`;
  }
  if (intent === 'inventory') {
    const total = rows.reduce((sum, row) => sum + Number(row.total_units || 0), 0);
    return `The school has ${total} items in stock.\n${bullets(rows.map((row) => `${row.category}: ${row.total_units} items`))}`;
  }
  if (intent === 'inventory_issuance') {
    return `Here are the supplies issued in the last 30 days:\n${bullets(rows.slice(0, 10).map((row) => `${row.item_name}: ${row.units_issued} issued in ${row.issuances} ${Number(row.issuances) === 1 ? 'issue' : 'issues'}`))}`;
  }
  if (intent === 'staff') {
    const total = rows.reduce((sum, row) => sum + Number(row.staff || 0), 0);
    return `The staff register has ${total} staff members.\n${bullets(rows.map((row) => `${row.role}: ${row.staff} (${row.active} active, ${row.inactive} inactive)`))}`;
  }
  if (intent === 'staff_attendance') {
    const totals = rows.reduce((sum, row) => {
      const status = String(row.status || '').toLowerCase();
      if (Object.hasOwn(sum, status)) sum[status] += Number(row.records || 0);
      return sum;
    }, { present: 0, absent: 0, late: 0, excused: 0 });
    const total = Object.values(totals).reduce((sum, count) => sum + count, 0);
    return `In the last 30 days, staff were marked ${totals.present} times present, ${totals.absent} absent, ${totals.late} late, and ${totals.excused} excused (${total} attendance records).`;
  }
  if (intent === 'announcements') {
    return `Here are the latest announcements:\n${bullets(rows.slice(0, 8).map((row) => `${row.title}${row.class ? ` (${row.class})` : ''}: ${row.message}`))}`;
  }
  if (intent === 'timetable') {
    return `Here are the scheduled lessons:\n${bullets(rows.slice(0, 10).map((row) => `${row.class}, ${row.day_of_week}: ${row.lesson_entries} lessons`))}`;
  }
  return 'I found some information, but I’m not sure how best to explain it. Try asking a more specific question.';
}


module.exports = { ALLOWED_ROLES, classifyQuestion, allowedIntent, collectVerifiedFacts, fallbackAnswer };
