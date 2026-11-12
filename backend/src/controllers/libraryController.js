const pool = require('../config/db');

const listBooks = async (req, res, next) => {
  try {
    const { school_id } = req.user;
    const q = String(req.query.q || '').trim();
    const result = await pool.query(`SELECT b.*, (SELECT COUNT(*)::int FROM library_loans l WHERE l.book_id=b.id AND l.status='borrowed') AS borrowed_copies FROM library_books b WHERE b.school_id=$1 AND ($2='' OR b.title ILIKE '%'||$2||'%' OR b.author ILIKE '%'||$2||'%' OR b.book_code ILIKE '%'||$2||'%' OR COALESCE(b.isbn,'') ILIKE '%'||$2||'%' OR b.category ILIKE '%'||$2||'%') ORDER BY b.title`, [school_id, q]);
    res.json(result.rows);
  } catch (e) { next(e); }
};
const dashboard = async (req, res, next) => {
  try {
    const { school_id } = req.user;
    const result = await pool.query(`SELECT (SELECT COUNT(*)::int FROM library_books WHERE school_id=$1) AS titles, (SELECT COALESCE(SUM(total_copies),0)::int FROM library_books WHERE school_id=$1) AS total_copies, (SELECT COALESCE(SUM(available_copies),0)::int FROM library_books WHERE school_id=$1) AS available_copies, (SELECT COUNT(*)::int FROM library_loans WHERE school_id=$1 AND status='borrowed') AS borrowed, (SELECT COUNT(*)::int FROM library_loans WHERE school_id=$1 AND status='borrowed' AND due_date<CURRENT_DATE) AS overdue`, [school_id]);
    res.json(result.rows[0]);
  } catch (e) { next(e); }
};
const createBook = async (req, res, next) => {
  const { title, author, isbn, book_code, category, publisher, shelf_location, total_copies } = req.body;
  const copies = Number(total_copies ?? 1);
  if (!title?.trim() || !author?.trim() || !book_code?.trim() || !/^[A-Za-z0-9 .$/+%-]{1,40}$/.test(book_code.trim()) || !Number.isInteger(copies) || copies < 1) return res.status(400).json({message:'Title, author, a unique Code 39-compatible book code (letters, numbers, spaces, . $ / + % -; max 40 characters), and at least one copy are required.'});
  const normalizedCode = book_code.trim().toUpperCase();
  try {
    const r = await pool.query(`INSERT INTO library_books (school_id,title,author,isbn,book_code,category,publisher,shelf_location,total_copies,available_copies) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`, [req.user.school_id,title.trim(),author.trim(),isbn||null,normalizedCode,category||'General',publisher||null,shelf_location||null,copies]);
    res.status(201).json(r.rows[0]);
  } catch (e) { if(e.code==='23505') return res.status(409).json({message:'That book/barcode code is already in use.'}); next(e); }
};
const lookupIsbn = async (req, res) => {
  const isbn = String(req.params.isbn || '').replace(/[^0-9X]/gi, '').toUpperCase();
  if (!/^(?:\d{9}[\dX]|\d{13})$/.test(isbn)) {
    return res.status(400).json({ message: 'Scan a valid 10- or 13-character ISBN.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('isbn', isbn);
    url.searchParams.set('fields', 'title,author_name,publisher,isbn,subject');
    url.searchParams.set('limit', '1');
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'McCarthyHillSchoolLibrary/1.0' },
    });
    if (!response.ok) {
      return res.status(502).json({ message: 'The book details service is unavailable. Enter the book details manually.' });
    }

    const result = await response.json();
    const record = result.docs?.[0];
    if (!record) {
      return res.status(404).json({ message: 'No book details were found for this ISBN. Enter the book details manually.' });
    }

    res.json({
      title: String(record.title || '').slice(0, 180),
      author: (Array.isArray(record.author_name) ? record.author_name.join(', ') : '').slice(0, 140),
      isbn: (Array.isArray(record.isbn) ? record.isbn.find((value) => String(value).replace(/[^0-9X]/gi, '').toUpperCase() === isbn) : '') || isbn,
      publisher: Array.isArray(record.publisher) ? record.publisher[0] || '' : '',
      category: Array.isArray(record.subject) ? record.subject[0] || 'General' : 'General',
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ message: 'ISBN lookup timed out. Enter the book details manually.' });
    }
    return res.status(502).json({ message: 'Could not retrieve book details. Enter them manually and try again.' });
  } finally {
    clearTimeout(timeout);
  }
};
const updateBook = async (req,res,next) => {
 const {title,author,isbn,book_code,category,publisher,shelf_location,total_copies}=req.body; const copies=Number(total_copies);
 if(!title?.trim()||!author?.trim()||!book_code?.trim()||!/^[A-Za-z0-9 .$/+%-]{1,40}$/.test(book_code.trim())||!Number.isInteger(copies)||copies<1) return res.status(400).json({message:'Provide title, author, a Code 39-compatible book code and a valid copy count.'});
 try { const r=await pool.query(`UPDATE library_books b SET title=$1,author=$2,isbn=$3,book_code=$4,category=$5,publisher=$6,shelf_location=$7,total_copies=$8,available_copies=b.available_copies+($8-b.total_copies) WHERE b.id=$9 AND b.school_id=$10 AND b.available_copies+($8-b.total_copies)>=0 RETURNING b.*`,[title.trim(),author.trim(),isbn||null,book_code.trim().toUpperCase(),category||'General',publisher||null,shelf_location||null,copies,req.params.id,req.user.school_id]); if(!r.rows.length) return res.status(400).json({message:'Book not found, or copy count cannot be lower than copies currently borrowed.'}); res.json(r.rows[0]); } catch(e){if(e.code==='23505')return res.status(409).json({message:'That book/barcode code is already in use.'});next(e);}
};
const listLoans = async (req,res,next) => { try { const r=await pool.query(`SELECT l.*,b.title,b.book_code,COALESCE(s.name,e.full_name) AS borrower_name,CASE WHEN l.student_id IS NOT NULL THEN 'student' ELSE 'staff' END AS borrower_type,c.name AS class_name FROM library_loans l JOIN library_books b ON b.id=l.book_id LEFT JOIN students s ON s.id=l.student_id LEFT JOIN classes c ON c.id=s.class_id LEFT JOIN employees e ON e.id=l.employee_id WHERE l.school_id=$1 AND ($2='all' OR l.status=$2) ORDER BY l.issued_at DESC LIMIT 500`,[req.user.school_id,req.query.status||'all']); res.json(r.rows); } catch(e){next(e);} };
const scanLoans = async (req, res, next) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!/^[A-Za-z0-9 .$/+%-]{1,40}$/.test(code)) {
    return res.status(400).json({ message: 'Scan a valid book barcode.' });
  }
  try {
    const result = await pool.query(
      `SELECT l.*, b.title, b.book_code,
              COALESCE(s.name, e.full_name) AS borrower_name,
              CASE WHEN l.student_id IS NOT NULL THEN 'student' ELSE 'staff' END AS borrower_type,
              c.name AS class_name
       FROM library_loans l
       JOIN library_books b ON b.id = l.book_id
       LEFT JOIN students s ON s.id = l.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN employees e ON e.id = l.employee_id
       WHERE l.school_id = $1 AND l.status = 'borrowed'
         AND (
           UPPER(b.book_code) = $2
           OR regexp_replace(UPPER(COALESCE(b.isbn, '')), '[^A-Z0-9]', '', 'g') =
              regexp_replace($2, '[^A-Z0-9]', '', 'g')
         )
       ORDER BY l.issued_at DESC`,
      [req.user.school_id, code]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};
const myLoans = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT l.*, b.title, b.book_code, e.full_name AS borrower_name,
              'staff' AS borrower_type, NULL AS class_name
       FROM library_loans l
       JOIN library_books b ON b.id = l.book_id
       JOIN employees e ON e.id = l.employee_id
       WHERE l.school_id = $1 AND LOWER(e.email) = LOWER($2)
       ORDER BY l.issued_at DESC
       LIMIT 200`,
      [req.user.school_id, req.user.email]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};
const borrowers = async (req,res,next) => { try { const [students,staff]=await Promise.all([pool.query(`SELECT s.id,s.name,LPAD(s.id::text,6,'0') AS borrower_code,c.name AS class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.school_id=$1 ORDER BY s.name`,[req.user.school_id]),pool.query(`SELECT id,full_name AS name,COALESCE(email,phone,'') AS borrower_code,role FROM employees WHERE school_id=$1 AND is_active=TRUE ORDER BY full_name`,[req.user.school_id])]); res.json({students:students.rows,staff:staff.rows}); } catch(e){next(e);} };
const issueLoan = async (req,res,next) => {
 const {book_id,borrower_type,borrower_id,due_date}=req.body;
 if(!book_id||!borrower_id||!due_date||!['student','staff'].includes(borrower_type)||Number.isNaN(Date.parse(due_date))) return res.status(400).json({message:'Book, borrower type, borrower and due date are required.'});
 const client=await pool.connect();
 try { await client.query('BEGIN'); const book=await client.query('SELECT id,available_copies FROM library_books WHERE id=$1 AND school_id=$2 FOR UPDATE',[book_id,req.user.school_id]); if(!book.rows.length){await client.query('ROLLBACK');return res.status(404).json({message:'Book not found.'});} if(book.rows[0].available_copies<1){await client.query('ROLLBACK');return res.status(409).json({message:'No available copies of this book.'});}
 let studentId=null,employeeId=null; if(borrower_type==='student'){const x=await client.query('SELECT id FROM students WHERE id=$1 AND school_id=$2',[borrower_id,req.user.school_id]);if(!x.rows.length){await client.query('ROLLBACK');return res.status(400).json({message:'Select a valid student.'});}studentId=borrower_id;}else{const x=await client.query('SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND is_active=TRUE',[borrower_id,req.user.school_id]);if(!x.rows.length){await client.query('ROLLBACK');return res.status(400).json({message:'Select a valid staff member.'});}employeeId=borrower_id;}
 const loan=await client.query(`INSERT INTO library_loans(school_id,book_id,student_id,employee_id,issued_by,due_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.user.school_id,book_id,studentId,employeeId,req.user.id,due_date]); await client.query('UPDATE library_books SET available_copies=available_copies-1 WHERE id=$1',[book_id]); await client.query('COMMIT');res.status(201).json(loan.rows[0]);
 } catch(e){await client.query('ROLLBACK');next(e);} finally{client.release();}
};
const returnLoan = async (req,res,next) => { const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE library_loans SET status='returned',returned_at=NOW() WHERE id=$1 AND school_id=$2 AND status='borrowed' RETURNING book_id`,[req.params.id,req.user.school_id]);if(!r.rows.length){await client.query('ROLLBACK');return res.status(404).json({message:'Active loan not found or already returned.'});}await client.query('UPDATE library_books SET available_copies=LEAST(total_copies,available_copies+1) WHERE id=$1',[r.rows[0].book_id]);await client.query('COMMIT');res.json({message:'Book returned successfully.'});}catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}};
module.exports={listBooks,dashboard,createBook,lookupIsbn,updateBook,listLoans,scanLoans,myLoans,borrowers,issueLoan,returnLoan};
