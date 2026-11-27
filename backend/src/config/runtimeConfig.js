const isHttpsOrigin = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value.replace(/\/$/,'');
  } catch { return false; }
};

function validateRuntimeConfig(env = process.env) {
  if (!env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required. The API never uses migration or owner credentials.');
  let databaseUrl;
  try { databaseUrl = new URL(env.APP_DATABASE_URL); } catch { throw new Error('APP_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:','postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('APP_DATABASE_URL must use PostgreSQL.');
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters.');
  }
  if (env.NODE_ENV === 'production') {
    const origins = String(env.CORS_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean);
    if (!origins.length || origins.some((origin) => !isHttpsOrigin(origin))) {
      throw new Error('Production CORS_ORIGIN must contain only explicit HTTPS origins.');
    }
    if (!env.FRONTEND_URL || !isHttpsOrigin(env.FRONTEND_URL)) {
      throw new Error('Production FRONTEND_URL must be an explicit HTTPS origin.');
    }
    if (!env.LEARNING_FILES_BUCKET?.trim()) {
      throw new Error('Production LEARNING_FILES_BUCKET is required for private assignment and Learning Materials files.');
    }
    if (!env.AWS_REGION?.trim()) throw new Error('Production AWS_REGION is required for private learning-file storage.');
    if (env.LEARNING_FILES_ENDPOINT && !isHttpsOrigin(env.LEARNING_FILES_ENDPOINT)) {
      throw new Error('Production LEARNING_FILES_ENDPOINT must use HTTPS.');
    }
  }
  return true;
}

module.exports = { validateRuntimeConfig, isHttpsOrigin };
