const pool = require('../config/db');

const createFeeStructure = async (req, res, next) => {
  const { school_id, id: user_id } = req.user;
  const { academic_year, term, class_ids, items } = req.body;

  if (typeof academic_year !== 'string' || !academic_year.trim()
      || typeof term !== 'string' || !term.trim()
      || !Array.isArray(class_ids) || !class_ids.length
      || class_ids.length > 100 || !Array.isArray(items) || !items.length || items.length > 100) {
    return res.status(400).json({ message: 'Missing required fields or classes.' });
  }

  const classIds = class_ids.map(Number);
  if (classIds.some((id) => !Number.isSafeInteger(id) || id < 1)
      || new Set(classIds).size !== classIds.length) {
    return res.status(400).json({ message: 'Choose valid classes without duplicates.' });
  }
  const normalizedItems = items.map((item) => ({
    fee_name: item && typeof item.fee_name === 'string' ? item.fee_name.trim() : '',
    amount: item && item.amount !== undefined && item.amount !== null && item.amount !== ''
      ? Number(item.amount) : Number.NaN,
  }));
  if (normalizedItems.some((item) => !item.fee_name || item.fee_name.length > 120
      || !Number.isFinite(item.amount) || item.amount < 0 || item.amount > 99999999.99)) {
    return res.status(400).json({ message: 'Each fee item needs a name and a valid non-negative amount.' });
  }
  const totalAmount = Math.round(normalizedItems.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  if (!Number.isFinite(totalAmount) || totalAmount > 99999999.99) {
    return res.status(400).json({ message: 'The total fee amount is too large.' });
  }
  const studentOverrides = req.body.student_overrides ?? [];
  if (!Array.isArray(studentOverrides) || studentOverrides.length > 2000) {
    return res.status(400).json({ message: 'Student fee adjustments must be a list of up to 2,000 students.' });
  }
  const normalizedOverrides = studentOverrides.map((entry) => ({
    studentId: entry && typeof entry === 'object' ? Number(entry.student_id) : Number.NaN,
    amountDue: entry && typeof entry === 'object' && entry.amount_due !== undefined
      && entry.amount_due !== null && entry.amount_due !== ''
      ? Number(entry.amount_due) : Number.NaN,
    reason: entry && typeof entry.reason === 'string' ? entry.reason.trim() : '',
  }));
  if (normalizedOverrides.some((entry) => !Number.isSafeInteger(entry.studentId) || entry.studentId < 1
      || !Number.isFinite(entry.amountDue) || entry.amountDue < 0 || entry.amountDue > 99999999.99
      || !entry.reason || entry.reason.length > 500)
      || new Set(normalizedOverrides.map((entry) => entry.studentId)).size !== normalizedOverrides.length) {
    return res.status(400).json({ message: 'Each student adjustment needs a unique student, valid amount, and reason.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    let createdStructures = 0;
    let assignedStudents = 0;
    const classResult = await client.query(
      'SELECT id FROM classes WHERE school_id=$1 AND id=ANY($2::integer[])',
      [school_id, classIds]
    );
    if (classResult.rowCount !== classIds.length) {
      const error = new Error('One or more selected classes do not belong to your school.');
      error.status = 400;
      throw error;
    }
    const studentsResult = await client.query(
      `SELECT id, class_id FROM students
       WHERE school_id=$1 AND class_id=ANY($2::integer[])`,
      [school_id, classIds]
    );
    const studentsById = new Map(studentsResult.rows.map((student) => [student.id, student]));
    if (normalizedOverrides.some((entry) => !studentsById.has(entry.studentId))) {
      const error = new Error('Fee adjustments can only be made for students in the selected classes.');
      error.status = 400;
      throw error;
    }
    const overridesByStudent = new Map(normalizedOverrides.map((entry) => [entry.studentId, entry]));

    for (const class_id of classIds) {
      const structureRes = await client.query(
        `INSERT INTO fee_structures (school_id, academic_year, term, class_id, total_amount, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [school_id, academic_year.trim(), term.trim(), class_id, totalAmount, user_id]
      );
      const fee_structure_id = structureRes.rows[0].id;
      createdStructures++;

      for (const item of normalizedItems) {
        await client.query(
          `INSERT INTO fee_structure_items (school_id, fee_structure_id, fee_name, amount)
           VALUES ($1, $2, $3, $4)`,
          [school_id, fee_structure_id, item.fee_name, item.amount]
        );
      }

      const classStudents = studentsResult.rows.filter((student) => student.class_id === class_id);
      for (const student of classStudents) {
        const override = overridesByStudent.get(student.id);
        const hasOverride = Boolean(override && Math.round(override.amountDue * 100) !== Math.round(totalAmount * 100));
        await client.query(
          `INSERT INTO fees
             (school_id, student_id, fee_structure_id, amount_due, amount_paid,
              description, is_fee_override, fee_override_reason)
           VALUES ($1, $2, $3, $4, 0, $5, $6, $7)`,
          [school_id, student.id, fee_structure_id, hasOverride ? override.amountDue : totalAmount,
            `${term.trim()} Fees (${academic_year.trim()})`, hasOverride, hasOverride ? override.reason : null]
        );
        assignedStudents++;
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `Created ${createdStructures} fee structures and billed ${assignedStudents} students.`,
      structures_created: createdStructures,
      students_billed: assignedStudents,
      student_overrides: normalizedOverrides.filter((entry) => Math.round(entry.amountDue * 100) !== Math.round(totalAmount * 100)).length,
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === '23505') return res.status(409).json({ message: 'A student has already been billed for this fee structure.' });
    next(error);
  } finally {
    client?.release();
  }
};

module.exports = { createFeeStructure };