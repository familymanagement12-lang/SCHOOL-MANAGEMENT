const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const getUsers = async (req, res, next) => {
  const { school_id } = req.user;

  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.subjects
       FROM users u WHERE u.school_id = $1 ORDER BY u.created_at DESC`,
      [school_id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, email, role, subjects, is_active } = req.body;

  if (!name || !email || !role) {
    return res.status(400).json({ message: 'Name, email, and role are required.' });
  }
  if (!['admin', 'teacher', 'librarian', 'inventory', 'store', 'storekeeper', 'accountant'].includes(role)) {
    return res.status(400).json({ message: 'Invalid user role.' });
  }

  try {
    // 1. Auto-generate an 8-character secure password
    const generatedPassword = crypto.randomBytes(4).toString('hex');
    
    // 2. Hash it securely for the database
    const hashedPassword = await bcrypt.hash(generatedPassword, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await client.query(
        'INSERT INTO users (school_id, name, email, password, role, subjects, is_active, verification_token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, email, role, subjects, is_active, created_at',
        [school_id, name, email, hashedPassword, role, subjects || [], is_active !== false, verificationToken]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Automatically add teachers and admins to the HR/Payroll Employees table
    if (role === 'teacher' || role === 'admin') {
      await pool.query(
        'INSERT INTO employees (school_id, full_name, role, email, is_active) VALUES ($1, $2, $3, $4, $5)',
        [school_id, name, role, email, is_active !== false]
      );
    }

    // 3. Send Verification Email via Resend
    try {
      if (!resend) throw new Error('RESEND_API_KEY is not configured');
      await resend.emails.send({
        from: 'The McCarthy Hill School <onboarding@resend.dev>',
        to: email,
        subject: 'Verify your School Account',
        html: `
          <h2>Welcome to The McCarthy Hill School, ${name}!</h2>
          <p>Your account has been created successfully.</p>
          <p>Temporary Password: <strong>${generatedPassword}</strong></p>
          <p>Please click the link below to verify your email and activate your account:</p>
          <a href="http://localhost:5000/api/users/verify?token=${verificationToken}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:5px;">Verify Email</a>
        `
      });
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr);
    }

    res.status(201).json({ ...result.rows[0], generatedPassword });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Email already exists' });
    }
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  const { id, school_id } = req.user;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = $1, must_change_password = FALSE WHERE id = $2 AND school_id = $3',
      [hashedPassword, id, school_id]
    );

    const result = await pool.query('SELECT id, name, email, role, must_change_password FROM users WHERE id = $1', [id]);
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

const resetUserPassword = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;

  try {
    const userRes = await pool.query('SELECT id, email, name FROM users WHERE id = $1 AND school_id = $2', [id, school_id]);
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const { email, name } = userRes.rows[0];
    const generatedPassword = crypto.randomBytes(4).toString('hex');
    const hashedPassword = await bcrypt.hash(generatedPassword, 10);

    await pool.query(
      'UPDATE users SET password = $1, must_change_password = TRUE WHERE id = $2',
      [hashedPassword, id]
    );

    console.log(`\n=========================================`);
    console.log(`📧 EMAIL SENT TO: ${email}`);
    console.log(`Subject: Password Reset`);
    console.log(`Body: Hello ${name}, your password has been reset by the administrator.\nLogin URL: http://localhost:3000/login\nEmail: ${email}\nNew Temporary Password: ${generatedPassword}\n\nPlease log in and change your password immediately.`);
    console.log(`=========================================\n`);

    res.json({ message: 'Password reset successfully', generatedPassword, email });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  const { school_id } = req.user;
  const { id } = req.params;
  const { name, email, role, is_active, subjects } = req.body;
  if (role && !['admin', 'teacher', 'librarian', 'inventory', 'store', 'storekeeper', 'accountant'].includes(role)) return res.status(400).json({ message: 'Invalid user role.' });

  try {
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await client.query(
        `UPDATE users
         SET name = COALESCE($1, name),
             email = COALESCE($2, email),
             role = COALESCE($3, role),
             is_active = COALESCE($4, is_active),
             subjects = COALESCE($5, subjects)
         WHERE id = $6 AND school_id = $7
         RETURNING id, name, email, role, is_active, subjects, created_at`,
        [name, email, role, is_active, subjects, id, school_id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Email already exists' });
    }
    next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid token.');

  try {
    const result = await pool.query(
      'UPDATE users SET email_verified = TRUE, verification_token = NULL WHERE verification_token = $1 RETURNING id',
      [token]
    );
    
    if (result.rows.length === 0) return res.status(400).send('Invalid or expired verification link.');
    res.send('<div style="font-family:sans-serif;text-align:center;padding:50px;"><h1>✅ Email Verified Successfully!</h1><p>Your account is now active.</p><a href="http://localhost:3000/login" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:5px;margin-top:20px;">Go to Login</a></div>');
  } catch (err) {
    next(err);
  }
};

const deleteUser = async (req, res, next) => {
  const { school_id, id: currentUserId } = req.user;
  const { id } = req.params;

  if (String(currentUserId) === String(id)) {
    return res.status(400).json({ message: 'You cannot delete your own active account.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 AND school_id = $2 RETURNING id',
      [id, school_id]
    );
    
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found.' });
    
    res.json({ message: 'User deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getUsers, createUser, changePassword, resetUserPassword, updateUser, verifyEmail, deleteUser };