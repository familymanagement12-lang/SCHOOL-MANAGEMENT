const pool = require('../config/db');
const {
  parseWorkbook,
  validateReviewValues,
  workbookModules,
} = require('../services/feedingWorkbookReview');

const fail = (status, message) => Object.assign(new Error(message), { status });
const cleanOptional = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

async function getImport(client, schoolId, importId) {
  const result = await client.query(
    `SELECT id, module, file_name, source_hash, academic_year, term, status,
            summary, imported_by, confirmed_by, created_at, confirmed_at
     FROM feeding_workbook_imports
     WHERE school_id = $1 AND id = $2`,
    [schoolId, importId]
  );
  return result.rows[0] || null;
}

async function getImportRows(client, schoolId, importId) {
  const result = await client.query(
    `SELECT id, sheet_name, source_row, row_kind, original_values, review_values,
            issues, matching_student_ids, status, exclusion_reason, reviewed_by, reviewed_at, imported_at
     FROM feeding_workbook_import_rows
     WHERE school_id = $1 AND import_id = $2
     ORDER BY sheet_name, source_row
     LIMIT 6000`,
    [schoolId, importId]
  );
  return result.rows;
}

async function summarize(client, schoolId, importId) {
  const result = await client.query(
    `SELECT COUNT(*)::INTEGER AS total,
            COUNT(*) FILTER (WHERE status = 'ready')::INTEGER AS valid,
            COUNT(*) FILTER (WHERE status = 'incomplete')::INTEGER AS incomplete,
            COUNT(*) FILTER (WHERE status = 'duplicate')::INTEGER AS duplicates,
            COUNT(*) FILTER (WHERE status = 'rejected')::INTEGER AS rejected,
            COUNT(*) FILTER (WHERE status IN ('excluded', 'skipped'))::INTEGER AS skipped,
            COUNT(*) FILTER (WHERE status = 'imported')::INTEGER AS imported,
            COUNT(*) FILTER (WHERE reviewed_at IS NOT NULL AND original_values <> review_values)::INTEGER AS corrected
     FROM feeding_workbook_import_rows
     WHERE school_id = $1 AND import_id = $2`,
    [schoolId, importId]
  );
  return result.rows[0];
}

const previewWorkbookImport = async (req, res, next) => {
  const upload = req.file;
  if (!upload) return res.status(400).json({ message: 'Select an .xlsx workbook to preview.' });
  const fileName = upload.originalname;
  const expectedModule = workbookModules.get(fileName);
  const module = String(req.body.module || '').trim();
  const academicYear = cleanOptional(req.body.academic_year);
  const term = cleanOptional(req.body.term);
  if (!expectedModule || module !== expectedModule) {
    return res.status(400).json({ message: 'The selected module must match one of the four supported source workbooks.' });
  }
  if (academicYear && !/^\d{4}(?:[-_/]\d{4})?$/.test(academicYear)) {
    return res.status(400).json({ message: 'Enter an academic year such as 2026-2027.' });
  }
  if (term && !/^term\s*[1-3]$/i.test(term)) {
    return res.status(400).json({ message: 'Select Term 1, Term 2, or Term 3.' });
  }

  let client;
  try {
    const parsed = await parseWorkbook(upload.buffer, fileName);
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`feeding-workbook-import:${req.user.school_id}:${module}:${parsed.sourceHash}`]
    );
    const previous = await client.query(
      `SELECT id, status
       FROM feeding_workbook_imports
       WHERE school_id = $1 AND source_hash = $2 AND module = $3
       FOR UPDATE`,
      [req.user.school_id, parsed.sourceHash, module]
    );
    if (previous.rows.length) {
      const current = await getImport(client, req.user.school_id, previous.rows[0].id);
      const rows = await getImportRows(client, req.user.school_id, current.id);
      await client.query('COMMIT');
      return res.status(200).json({
        ...current,
        rows,
        counts: current.summary,
        alreadyPreviewed: true,
        alreadyConfirmed: current.status === 'confirmed',
      });
    }

    const students = await client.query(
      `SELECT s.id, s.name, c.name AS class_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
       WHERE s.school_id = $1`,
      [req.user.school_id]
    );
    const created = await client.query(
      `INSERT INTO feeding_workbook_imports (
         school_id, module, file_name, source_hash, file_data, academic_year, term, imported_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        req.user.school_id, module, fileName, parsed.sourceHash, upload.buffer,
        academicYear, term, req.user.id,
      ]
    );
    const importId = created.rows[0].id;
    for (const row of parsed.rows) {
      let status = row.status;
      const issues = [...row.issues];
      let matchingStudentIds = [];
      if (row.rowKind === 'lunch_student' && !row.isNonEating) {
        const normalize = (value) => String(value || '').trim().toLocaleLowerCase();
        const exactMatches = students.rows.filter((student) => (
          normalize(student.name) === normalize(row.studentName)
          && normalize(student.class_name) === normalize(row.className)
        ));
        matchingStudentIds = exactMatches.map((student) => student.id);
        if (matchingStudentIds.length > 1) issues.push('More than one current student matches this name and class; review the match before linking.');
      }
      await client.query(
        `INSERT INTO feeding_workbook_import_rows (
           school_id, import_id, import_key, sheet_name, source_row, row_kind,
           original_values, review_values, issues, matching_student_ids, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, $8::JSONB, $9::JSONB, $10::INTEGER[], $11)
         ON CONFLICT (school_id, import_key) DO NOTHING`,
        [
          req.user.school_id, importId, row.importKey, row.sheetName, row.sourceRow,
          row.rowKind, JSON.stringify(row.originalValues), JSON.stringify(row.reviewValues),
          JSON.stringify(issues), matchingStudentIds, status,
        ]
      );
    }
    const counts = await summarize(client, req.user.school_id, importId);
    await client.query(
      `UPDATE feeding_workbook_imports SET summary = $3::JSONB WHERE school_id = $1 AND id = $2`,
      [req.user.school_id, importId, JSON.stringify(counts)]
    );
    await client.query(
      `INSERT INTO feeding_workbook_import_audit (school_id, import_id, action, new_data, actor_id)
       VALUES ($1, $2, 'previewed', $3::JSONB, $4)`,
      [req.user.school_id, importId, JSON.stringify(counts), req.user.id]
    );
    const imported = await getImport(client, req.user.school_id, importId);
    const rows = await getImportRows(client, req.user.school_id, importId);
    await client.query('COMMIT');
    return res.status(201).json({ ...imported, rows, counts });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    client?.release();
  }
};

const listWorkbookImports = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT i.id, i.module, i.file_name, i.source_hash, i.academic_year, i.term,
              i.status, i.summary, i.created_at, i.confirmed_at,
              u.name AS previewed_by_name, c.name AS confirmed_by_name
       FROM feeding_workbook_imports i
       LEFT JOIN users u ON u.id = i.imported_by
       LEFT JOIN users c ON c.id = i.confirmed_by
       WHERE i.school_id = $1
       ORDER BY i.created_at DESC, i.id DESC
       LIMIT 100`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const downloadWorkbookImport = async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ message: 'Import not found.' });
  try {
    const result = await pool.query(
      `SELECT file_name, file_data
       FROM feeding_workbook_imports
       WHERE school_id = $1 AND id = $2`,
      [req.user.school_id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Import not found.' });
    const { file_name: fileName, file_data: fileData } = result.rows[0];
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': fileData.length,
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(fileData);
  } catch (error) {
    return next(error);
  }
};

const getHistoricalWorkbookRows = async (req, res, next) => {
  const module = String(req.params.module || '');
  const modulePermissions = {
    lunch: ['feeding.students.read', 'feeding.payments.read', 'feeding.reports.read'],
    purchases: ['feeding.purchases.read', 'tuckshop.purchases.read', 'feeding.reports.read', 'tuckshop.reports.read'],
    market: ['feeding.market.read', 'feeding.market.manage'],
    marketing: ['feeding.marketing.read', 'feeding.marketing.manage', 'feeding.reports.read'],
  };
  if (!modulePermissions[module]) return res.status(404).json({ message: 'Workbook module not found.' });
  try {
    if (req.user.role !== 'admin') {
      const permissions = await pool.query(
        `SELECT permission FROM user_permissions
         WHERE school_id = $1 AND user_id = $2 AND permission = ANY($3::TEXT[])
         LIMIT 1`,
        [req.user.school_id, req.user.id, modulePermissions[module]]
      );
      if (!permissions.rows.length) return res.status(403).json({ message: 'You do not have permission to view this workbook section.' });
    }
    const result = await pool.query(
      `SELECT i.id AS import_id, i.file_name, i.academic_year, i.term,
              r.id, r.sheet_name, r.source_row, r.row_kind, r.original_values,
              r.review_values, r.issues, r.matching_student_ids, r.imported_at
       FROM feeding_workbook_imports i
       JOIN feeding_workbook_import_rows r
         ON r.school_id = i.school_id AND r.import_id = i.id
       WHERE i.school_id = $1 AND i.module = $2 AND i.status = 'confirmed'
         AND r.status = 'imported'
       ORDER BY i.created_at DESC, r.sheet_name, r.source_row
       LIMIT 6000`,
      [req.user.school_id, module]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const getWorkbookImport = async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ message: 'Import not found.' });
  let client;
  try {
    client = await pool.connect();
    const record = await getImport(client, req.user.school_id, req.params.id);
    if (!record) return res.status(404).json({ message: 'Import not found.' });
    const rows = await getImportRows(client, req.user.school_id, record.id);
    const audit = await client.query(
      `SELECT a.action, a.row_id, r.sheet_name, r.source_row,
              a.old_data, a.new_data, a.actor_id, u.name AS actor_name, a.created_at
       FROM feeding_workbook_import_audit a
       LEFT JOIN feeding_workbook_import_rows r
         ON r.school_id = a.school_id AND r.import_id = a.import_id AND r.id = a.row_id
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.school_id = $1 AND a.import_id = $2
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1000`,
      [req.user.school_id, record.id]
    );
    res.json({
      ...record,
      rows,
      audit: audit.rows,
      counts: await summarize(client, req.user.school_id, record.id),
    });
  } catch (error) {
    next(error);
  } finally {
    client?.release();
  }
};

const reviewWorkbookImportRow = async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id) || !/^\d+$/.test(req.params.rowId)) {
    return res.status(404).json({ message: 'Import row not found.' });
  }
  const { review_values: reviewValues, exclude, exclusion_reason: exclusionReason } = req.body;
  if (exclude !== true && (reviewValues === undefined || !reviewValues || typeof reviewValues !== 'object' || Array.isArray(reviewValues))) {
    return res.status(400).json({ message: 'Provide corrected cell values or exclude the row with a reason.' });
  }
  if (exclude === true && !String(exclusionReason || '').trim()) {
    return res.status(400).json({ message: 'Provide a reason for excluding this source row.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const headerResult = await client.query(
      `SELECT id, module, status FROM feeding_workbook_imports
       WHERE school_id = $1 AND id = $2 FOR UPDATE`,
      [req.user.school_id, req.params.id]
    );
    if (!headerResult.rows.length) throw fail(404, 'Import not found.');
    if (headerResult.rows[0].status !== 'preview') throw fail(409, 'A confirmed import cannot be changed.');
    const rowResult = await client.query(
      `SELECT * FROM feeding_workbook_import_rows
       WHERE school_id = $1 AND import_id = $2 AND id = $3 FOR UPDATE`,
      [req.user.school_id, req.params.id, req.params.rowId]
    );
    if (!rowResult.rows.length) throw fail(404, 'Import row not found.');
    const row = rowResult.rows[0];
    if (['duplicate', 'imported'].includes(row.status)) throw fail(409, 'This row has already been imported or was identified as a duplicate.');
    const nextValues = exclude ? row.review_values : reviewValues;
    const issues = exclude ? [] : validateReviewValues(
      headerResult.rows[0].module, row.row_kind, nextValues, row.original_values
    );
    const status = exclude
      ? 'excluded'
      : row.row_kind === 'heading_or_summary'
        ? 'rejected'
        : issues.length ? 'incomplete' : 'ready';
    const updated = await client.query(
      `UPDATE feeding_workbook_import_rows
       SET review_values = $4::JSONB, issues = $5::JSONB, status = $6,
           exclusion_reason = $7, reviewed_by = $8, reviewed_at = NOW()
       WHERE school_id = $1 AND import_id = $2 AND id = $3
       RETURNING id, sheet_name, source_row, row_kind, original_values, review_values,
                 issues, matching_student_ids, status, exclusion_reason, reviewed_by, reviewed_at, imported_at`,
      [
        req.user.school_id, req.params.id, req.params.rowId,
        JSON.stringify(nextValues), JSON.stringify(issues), status,
        exclude ? String(exclusionReason).trim().slice(0, 500) : null, req.user.id,
      ]
    );
    await client.query(
      `INSERT INTO feeding_workbook_import_audit (
         school_id, import_id, row_id, action, old_data, new_data, actor_id
       ) VALUES ($1, $2, $3, $4, $5::JSONB, $6::JSONB, $7)`,
      [
        req.user.school_id, req.params.id, req.params.rowId, exclude ? 'excluded' : 'corrected',
        JSON.stringify({ review_values: row.review_values, status: row.status }),
        JSON.stringify({ review_values: nextValues, status, issues, exclusion_reason: exclude ? exclusionReason : null }),
        req.user.id,
      ]
    );
    const counts = await summarize(client, req.user.school_id, req.params.id);
    await client.query(
      `UPDATE feeding_workbook_imports SET summary = $3::JSONB WHERE school_id = $1 AND id = $2`,
      [req.user.school_id, req.params.id, JSON.stringify(counts)]
    );
    const audit = await client.query(
      `SELECT a.action, a.row_id, r.sheet_name, r.source_row,
              a.old_data, a.new_data, a.actor_id, u.name AS actor_name, a.created_at
       FROM feeding_workbook_import_audit a
       LEFT JOIN feeding_workbook_import_rows r
         ON r.school_id = a.school_id AND r.import_id = a.import_id AND r.id = a.row_id
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.school_id = $1 AND a.import_id = $2
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1000`,
      [req.user.school_id, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ row: updated.rows[0], counts, audit: audit.rows });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    if (error.status) return res.status(error.status).json({ message: error.message });
    next(error);
  } finally {
    client?.release();
  }
};

const confirmWorkbookImport = async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ message: 'Import not found.' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const record = await client.query(
      `SELECT id, status FROM feeding_workbook_imports
       WHERE school_id = $1 AND id = $2 FOR UPDATE`,
      [req.user.school_id, req.params.id]
    );
    if (!record.rows.length) throw fail(404, 'Import not found.');
    if (record.rows[0].status === 'confirmed') {
      const counts = await summarize(client, req.user.school_id, req.params.id);
      await client.query('COMMIT');
      return res.json({ message: 'This import was already confirmed; no records were added again.', counts });
    }
    const unresolved = await client.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM feeding_workbook_import_rows
       WHERE school_id = $1 AND import_id = $2 AND status = 'incomplete'`,
      [req.user.school_id, req.params.id]
    );
    if (unresolved.rows[0].count > 0) {
      throw fail(409, 'Correct or explicitly exclude every incomplete and rejected row before confirming this import.');
    }
    const ready = await client.query(
      `SELECT id, module, row_kind, original_values, review_values
       FROM feeding_workbook_import_rows
       WHERE school_id = $1 AND import_id = $2 AND status = 'ready'
       FOR UPDATE`,
      [req.user.school_id, req.params.id]
    );
    if (!ready.rows.length) throw fail(409, 'There are no valid rows ready to import. Correct or exclude the incomplete records first.');
    for (const row of ready.rows) {
      const issues = validateReviewValues(row.module, row.row_kind, row.review_values, row.original_values);
      if (issues.length) throw fail(409, `Import row ${row.id} still needs review: ${issues.join(' ')}`);
    }
    const imported = await client.query(
      `UPDATE feeding_workbook_import_rows
       SET status = 'imported', imported_at = NOW()
       WHERE school_id = $1 AND import_id = $2 AND status = 'ready'
       RETURNING id`,
      [req.user.school_id, req.params.id]
    );
    await client.query(
      `UPDATE feeding_workbook_import_rows
       SET status = 'skipped'
       WHERE school_id = $1 AND import_id = $2 AND status IN ('excluded', 'rejected')`,
      [req.user.school_id, req.params.id]
    );
    await client.query(
      `UPDATE feeding_workbook_imports
       SET status = 'confirmed', confirmed_by = $3, confirmed_at = NOW()
       WHERE school_id = $1 AND id = $2`,
      [req.user.school_id, req.params.id, req.user.id]
    );
    const counts = await summarize(client, req.user.school_id, req.params.id);
    await client.query(
      `UPDATE feeding_workbook_imports SET summary = $3::JSONB WHERE school_id = $1 AND id = $2`,
      [req.user.school_id, req.params.id, JSON.stringify(counts)]
    );
    await client.query(
      `INSERT INTO feeding_workbook_import_audit (school_id, import_id, action, new_data, actor_id)
       VALUES ($1, $2, 'confirmed', $3::JSONB, $4)`,
      [req.user.school_id, req.params.id, JSON.stringify(counts), req.user.id]
    );
    await client.query('COMMIT');
    res.json({ message: `${imported.rowCount} historical source rows were imported into the isolated workbook archive. No payments, inventory, or main finance transactions were created.`, counts });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    if (error.status) return res.status(error.status).json({ message: error.message });
    next(error);
  } finally {
    client?.release();
  }
};

module.exports = {
  confirmWorkbookImport,
  downloadWorkbookImport,
  getWorkbookImport,
  getHistoricalWorkbookRows,
  listWorkbookImports,
  previewWorkbookImport,
  reviewWorkbookImportRow,
};
