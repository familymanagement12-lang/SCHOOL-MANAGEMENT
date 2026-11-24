const crypto = require('crypto');

const normalizeNamePart = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const generateBaseUsername = (name) => {
  const parts = normalizeNamePart(name).split(' ').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}.${parts[parts.length - 1]}`;
};

const makeUniqueUsername = async (pool, schoolId, name, excludeUserId = null) => {
  const base = generateBaseUsername(name);
  if (!base) return '';
  let candidate = base;
  let suffix = 2;
  while (candidate) {
    const result = await pool.query(
      `SELECT id FROM users
       WHERE username=$1 AND ($2::integer IS NULL OR id<>$2)
       LIMIT 1`,
      [candidate, excludeUserId]
    );
    if (!result.rows.length) return candidate;
    candidate = `${base}${suffix}`;
    suffix++;
  }
};

const validDob = (dob) => {
  if (!dob) return null;
  const date = dob instanceof Date ? dob : new Date(`${String(dob).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
};

const generateTemporaryPassword = (dob) => {
  const dobPassword = validDob(dob);
  if (dobPassword) return { temporaryPassword: dobPassword, source: 'dob' };
  return { temporaryPassword: crypto.randomBytes(9).toString('base64url'), source: 'random' };
};

module.exports = {
  generateBaseUsername,
  makeUniqueUsername,
  validDob,
  generateTemporaryPassword,
};
