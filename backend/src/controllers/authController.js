const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const crypto = require('crypto');
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const createToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      school_id: user.school_id,
      session_version: user.session_version ?? 1,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '8h',
    }
  );
};


const login = async (req, res, next) => {
  const { email, identifier, password } = req.body;
  const loginIdentifier = identifier || email;

  if (!loginIdentifier || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const userResult = await pool.query(`
      SELECT u.id, u.email, u.password, u.role, u.school_id, u.name,
             u.username, u.must_change_password, u.email_verified, u.is_active,
             u.session_version
      FROM users u
      WHERE lower(u.email) = lower($1)
         OR (u.username IS NOT NULL AND lower(u.username) = lower($1))
         OR (u.role = 'student' AND EXISTS (
           SELECT 1 FROM students s
           WHERE s.user_id = u.id AND s.school_id = u.school_id
             AND LPAD(s.id::text, 6, '0') = LPAD($1, 6, '0')
             AND $1 ~ '^[0-9]{1,6}$'
         ))
         OR (u.role = 'parent' AND EXISTS (
           SELECT 1 FROM parents p
           WHERE p.user_id = u.id AND p.school_id = u.school_id
             AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g')
                 = regexp_replace($1, '[^0-9]', '', 'g')
             AND regexp_replace($1, '[^0-9]', '', 'g') <> ''
             AND (SELECT COUNT(DISTINCT p2.user_id) FROM parents p2
                  WHERE p2.school_id = u.school_id
                    AND regexp_replace(COALESCE(p2.phone, ''), '[^0-9]', '', 'g')
                        = regexp_replace($1, '[^0-9]', '', 'g')) = 1
         ))
      LIMIT 1
    `, [String(loginIdentifier).trim()]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }
    if (user.is_active === false) {
      return res.status(403).json({ message: 'This account is inactive. Contact the school administrator.' });
    }

    // 🚧 TEMPORARILY DISABLED FOR TESTING
    // if (!user.email_verified && user.role !== 'student') {
    //   return res.status(403).json({ message: 'Please check your email and click the verification link to log in.' });
    // }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    await pool.query(
      'UPDATE users SET last_login_at=NOW(), session_version=session_version WHERE id=$1 AND school_id=$2',
      [user.id, user.school_id]
    );

    const token = createToken(user);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role, school_id: user.school_id, name: user.name, must_change_password: user.must_change_password } });
  } catch (error) {
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email address is required.' });
  }

  try {
    // Added 'password' to the SELECT query to use it as a salt for the token
    const userResult = await pool.query('SELECT id, name, email, password FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      
      // Create a one-time-use token using the user's CURRENT password hash as the secret.
      // If the password changes, the token instantly becomes invalid!
      const secret = process.env.JWT_SECRET + user.password;
      const resetToken = jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '15m' });
      
      const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?id=${user.id}&token=${resetToken}`;

      try {
        if (!resend) throw new Error('RESEND_API_KEY is not configured');
        await resend.emails.send({
          from: 'The McCarthy Hill School <onboarding@resend.dev>',
          to: user.email,
          subject: 'Password Reset Instructions',
          html: `<h2>Hello ${user.name},</h2><p>We received a request to reset your password.</p><p>Click the secure button below to set a new password. This link will safely expire in 15 minutes.</p><br/><a href="${resetLink}" style="display:inline-block;padding:12px 24px;background:#1e3a8a;color:white;text-decoration:none;border-radius:6px;font-weight:bold;">Reset Password</a><p style="margin-top:20px;font-size:0.9rem;color:#64748b;">If you didn't request this, you can safely ignore this email.</p>`
        });
      } catch (emailErr) {
        console.error('Failed to send reset email:', emailErr);
      }
    }

    res.json({ message: 'If an account exists with that email, a password reset link has been sent.' });
  } catch (error) {
    next(error);
  }
};

const resetPasswordWithToken = async (req, res, next) => {
  const { id, token, newPassword } = req.body;

  if (!id || !token || !newPassword) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
  }

  try {
    const userResult = await pool.query('SELECT id, password FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) return res.status(400).json({ message: 'Invalid or expired reset link.' });

    const user = userResult.rows[0];
    const secret = process.env.JWT_SECRET + user.password;

    try {
      // Verify the token signature. If it passes, it means it hasn't expired and the password hasn't changed!
      jwt.verify(token, secret);
    } catch (err) {
      return res.status(400).json({ message: 'Invalid or expired reset link.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1, must_change_password = FALSE WHERE id = $2', [hashedPassword, id]);

    res.json({ message: 'Password reset successful! You can now log in.' });
  } catch (error) {
    next(error);
  }
};

module.exports = { login, forgotPassword, resetPasswordWithToken };
