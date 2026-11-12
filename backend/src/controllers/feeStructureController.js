const pool = require('../config/db');

const createFeeStructure = async (req, res, next) => {
  const { school_id, id: user_id } = req.user;
  const { academic_year, term, class_ids, items } = req.body;

  if (!academic_year || !term || !class_ids || !class_ids.length || !items || !items.length) {
    return res.status(400).json({ message: 'Missing required fields or classes.' });
  }

  const total_amount = items.reduce((sum, item) => sum + Number(item.amount), 0);

  try {
    await pool.query('BEGIN');

    let createdStructures = 0;
    let assignedStudents = 0;

    // Create a unique structure for each selected class
    for (const class_id of class_ids) {
      const structureRes = await pool.query(
        `INSERT INTO fee_structures (school_id, academic_year, term, class_id, total_amount, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [school_id, academic_year, term, class_id, total_amount, user_id]
      );
      const fee_structure_id = structureRes.rows[0].id;
      createdStructures++;

      // Insert sub-items (Tuition, PTA, etc)
      for (const item of items) {
        if (item.fee_name && item.amount) {
          await pool.query(
            `INSERT INTO fee_structure_items (fee_structure_id, fee_name, amount) VALUES ($1, $2, $3)`,
            [fee_structure_id, item.fee_name, item.amount]
          );
        }
      }

      // Find all students in this class and auto-assign the bill!
      const studentsRes = await pool.query(
        `SELECT id FROM students WHERE class_id = $1 AND school_id = $2`,
        [class_id, school_id]
      );

      for (const student of studentsRes.rows) {
        // Backwards compatibility: push the sum to the old 'fees' table so the existing UI still works perfectly
        await pool.query(
          `INSERT INTO fees (school_id, student_id, amount_due, amount_paid, description)
           VALUES ($1, $2, $3, 0, $4)`,
          [school_id, student.id, total_amount, `${term} Fees (${academic_year})`]
        );
        assignedStudents++;
      }
    }

    await pool.query('COMMIT');
    res.status(201).json({ message: `Successfully created ${createdStructures} fee structures and auto-billed ${assignedStudents} students.` });
  } catch (error) {
    await pool.query('ROLLBACK');
    next(error);
  }
};

module.exports = { createFeeStructure };