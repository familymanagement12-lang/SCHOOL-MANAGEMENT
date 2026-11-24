const pool = require('../config/db');

const validEmploymentStatuses = new Set(['active', 'inactive', 'terminated', 'on_leave']);
const validDate = (value) => !value || (
  /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
);
const cleanText = (value) => typeof value === 'string' ? value.trim() : '';
const normalizeEmploymentStatus = (value) => {
  const normalized = cleanText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'leave' || normalized === 'on_leave' || normalized === 'on leave') return 'on_leave';
  return validEmploymentStatuses.has(normalized) ? normalized : '';
};

const getEmployees = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    const result = await pool.query(
      'SELECT * FROM employees WHERE school_id = $1 ORDER BY is_active DESC, full_name ASC',
      [school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createEmployee = async (req, res, next) => {
  const { school_id } = req.user;
  const { full_name, role, phone, email, basic_salary, allowance, deductions, bank_name, bank_account,
    staff_id, pension_member_id, ssnit_number, date_of_birth, ghana_card, employment_status, termination_date } = req.body;
  const normalizedName = typeof full_name === 'string' ? full_name.trim() : '';
  const normalizedRole = typeof role === 'string' ? role.trim() : '';
  const normalizedStatus = normalizeEmploymentStatus(employment_status || 'active');

  if (!normalizedName || !normalizedRole) {
    return res.status(400).json({ message: 'Full name and role are required.' });
  }
  if (normalizedRole.length > 80) {
    return res.status(400).json({ message: 'Staff role must be 80 characters or fewer.' });
  }
  if (!normalizedStatus) return res.status(400).json({ message: 'Employment status must be active, inactive, terminated, or on leave.' });
  if (!validDate(date_of_birth) || !validDate(termination_date)) {
    return res.status(400).json({ message: 'Date of birth and termination date must use YYYY-MM-DD format.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO employees (
        school_id, full_name, role, phone, email, basic_salary, allowance, deductions, bank_name, bank_account,
        staff_id, pension_member_id, ssnit_number, date_of_birth, ghana_card, employment_status, termination_date, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [school_id, normalizedName, normalizedRole, phone, email, basic_salary || 0, allowance || 0, deductions || 0, bank_name, bank_account,
       cleanText(staff_id) || null, cleanText(pension_member_id) || null, cleanText(ssnit_number) || null,
       date_of_birth || null, cleanText(ghana_card) || null, normalizedStatus, termination_date || null,
       normalizedStatus === 'active']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const updateEmployee = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  const { full_name, role, phone, email, basic_salary, allowance, deductions, bank_name, bank_account, is_active,
    staff_id, pension_member_id, ssnit_number, date_of_birth, ghana_card, employment_status, termination_date } = req.body;
  const normalizedRole = role === undefined ? undefined : (typeof role === 'string' ? role.trim() : '');
  if (normalizedRole !== undefined && !normalizedRole) {
    return res.status(400).json({ message: 'Staff role is required.' });
  }
  if (normalizedRole && normalizedRole.length > 80) {
    return res.status(400).json({ message: 'Staff role must be 80 characters or fewer.' });
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return res.status(400).json({ message: 'Staff status must be active or inactive.' });
  }
  const normalizedStatus = employment_status === undefined ? undefined : normalizeEmploymentStatus(employment_status);
  if (employment_status !== undefined && !normalizedStatus) {
    return res.status(400).json({ message: 'Employment status must be active, inactive, terminated, or on leave.' });
  }
  if ((date_of_birth !== undefined && !validDate(date_of_birth))
    || (termination_date !== undefined && !validDate(termination_date))) {
    return res.status(400).json({ message: 'Date of birth and termination date must use YYYY-MM-DD format.' });
  }

  try {
    const derivedActive = normalizedStatus ? normalizedStatus === 'active' : is_active;
    const effectiveStatus = normalizedStatus || (is_active !== undefined ? (is_active ? 'active' : 'inactive') : undefined);
    const result = await pool.query(
      `UPDATE employees SET 
        full_name = COALESCE($1, full_name), role = COALESCE($2, role), phone = COALESCE($3, phone), email = COALESCE($4, email),
        basic_salary = COALESCE($5, basic_salary), allowance = COALESCE($6, allowance), deductions = COALESCE($7, deductions),
        bank_name = COALESCE($8, bank_name), bank_account = COALESCE($9, bank_account),
        is_active = COALESCE($10, is_active),
        staff_id = COALESCE($11, staff_id),
        pension_member_id = COALESCE($12, pension_member_id),
        ssnit_number = COALESCE($13, ssnit_number),
        date_of_birth = COALESCE($14::date, date_of_birth),
        ghana_card = COALESCE($15, ghana_card),
        employment_status = COALESCE($16, employment_status),
        termination_date = COALESCE($17::date, termination_date)
       WHERE id = $18 AND school_id = $19 RETURNING *`,
      [full_name, normalizedRole, phone, email, basic_salary, allowance, deductions, bank_name, bank_account, derivedActive,
       staff_id, pension_member_id, ssnit_number, date_of_birth, ghana_card, effectiveStatus,
       termination_date, id, school_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Employee not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const deactivateEmployee = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE employees
       SET is_active = FALSE,
           employment_status = 'inactive'
       WHERE id = $1 AND school_id = $2
       RETURNING id`,
      [id, school_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Employee not found.' });
    res.json({ message: 'Employee marked inactive. Their payroll and attendance history has been kept.' });
  } catch (error) { next(error); }
};

const bulkUpsertEmployees = async (req, res, next) => {
  const { school_id, id: actorId, role: actorRole } = req.user;
  const rows = req.body?.employees;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'Provide at least one staff member.' });
  }
  if (rows.length > 1000) {
    return res.status(400).json({ message: 'Bulk uploads are limited to 1000 staff records.' });
  }

  const normalizedRows = [];
  const seenStaffIds = new Set();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const staffId = cleanText(row.staff_id || row['Staff ID']);
    const fullName = cleanText(row.full_name || row.employee_name || row['Employee Name']);
    if (!staffId || !fullName) {
      return res.status(400).json({ message: `Row ${index + 2}: Staff ID and Employee Name are required.` });
    }
    if (seenStaffIds.has(staffId.toUpperCase())) {
      return res.status(400).json({ message: `Row ${index + 2}: Duplicate Staff ID "${staffId}".` });
    }
    seenStaffIds.add(staffId.toUpperCase());

    const status = normalizeEmploymentStatus(row.employment_status || row['Employment Status'] || 'active');
    const dateOfBirth = cleanText(row.date_of_birth || row['Date of Birth']);
    const terminationDate = cleanText(row.termination_date || row['Termination Date']);
    if (!status) {
      return res.status(400).json({ message: `Row ${index + 2}: Invalid employment status.` });
    }
    if (!validDate(dateOfBirth) || !validDate(terminationDate)) {
      return res.status(400).json({ message: `Row ${index + 2}: Dates must use YYYY-MM-DD format.` });
    }

    normalizedRows.push({
      staffId,
      fullName,
      pensionMemberId: cleanText(row.pension_member_id || row['Pension Fund Member ID']) || null,
      ssnitNumber: cleanText(row.ssnit_number || row['SSNIT Number']) || null,
      dateOfBirth: dateOfBirth || null,
      phone: cleanText(row.phone || row['Phone Number']) || null,
      ghanaCard: cleanText(row.ghana_card || row['Ghana Card']) || null,
      employmentStatus: status,
      terminationDate: terminationDate || null,
      isActive: status === 'active',
      role: cleanText(row.role || row['Staff Role']) || null,
      email: cleanText(row.email || row['Email']) || null,
    });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    let created = 0;
    let updated = 0;

    for (const row of normalizedRows) {
      const existing = await client.query(
        'SELECT * FROM employees WHERE school_id=$1 AND staff_id=$2',
        [school_id, row.staffId]
      );

      if (existing.rows.length) {
        const employee = existing.rows[0];
        await client.query(
          `UPDATE employees SET
             full_name=$1, phone=$2, pension_member_id=$3, ssnit_number=$4,
             date_of_birth=$5::date, ghana_card=$6, employment_status=$7,
             termination_date=$8::date, is_active=$9,
             role=COALESCE($10, role), email=COALESCE($11, email)
           WHERE id=$12 AND school_id=$13`,
          [row.fullName, row.phone, row.pensionMemberId, row.ssnitNumber, row.dateOfBirth,
           row.ghanaCard, row.employmentStatus, row.terminationDate, row.isActive,
           row.role, row.email, employee.id, school_id]
        );

        await client.query(
          `INSERT INTO finance_audit_log
             (school_id, actor_id, actor_role, table_name, record_id, action, old_data, new_data)
           VALUES ($1,$2,$3,'employees',$4,'UPDATE',$5,$6)`,
          [school_id, actorId, actorRole || 'admin', String(employee.id), employee, row]
        );
        updated++;
      } else {
        const inserted = await client.query(
          `INSERT INTO employees (
             school_id, staff_id, full_name, role, phone, email,
             pension_member_id, ssnit_number, date_of_birth, ghana_card,
             employment_status, termination_date, is_active
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [school_id, row.staffId, row.fullName, row.role || 'Staff', row.phone, row.email,
           row.pensionMemberId, row.ssnitNumber, row.dateOfBirth, row.ghanaCard,
           row.employmentStatus, row.terminationDate, row.isActive]
        );
        await client.query(
          `INSERT INTO finance_audit_log
             (school_id, actor_id, actor_role, table_name, record_id, action, new_data)
           VALUES ($1,$2,$3,'employees',$4,'INSERT',$5)`,
          [school_id, actorId, actorRole || 'admin', String(inserted.rows[0].id), inserted.rows[0]]
        );
        created++;
      }
    }

    await client.query('COMMIT');
    res.json({
      message: `Bulk staff upload completed: ${created} created, ${updated} updated.`,
      created,
      updated,
      processed: normalizedRows.length,
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ message: 'A Staff ID is already used in this school.' });
    }
    next(error);
  } finally {
    client?.release();
  }
};

module.exports = { getEmployees, createEmployee, updateEmployee, deactivateEmployee, bulkUpsertEmployees };