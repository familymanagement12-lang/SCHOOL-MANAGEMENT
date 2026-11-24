const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const loginRateLimit = (req, res, next) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const identifier = String(req.body?.identifier || req.body?.email || '').trim().toLowerCase();
  const key = `${ip}:${identifier}`;
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  if (current.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ message: 'Too many login attempts. Try again later.' });
  }

  current.count++;
  next();
};

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of attempts.entries()) {
    if (value.resetAt <= now) attempts.delete(key);
  }
}, WINDOW_MS).unref();

module.exports = loginRateLimit;
