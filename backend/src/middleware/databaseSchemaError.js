const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', '42704', '42883']);

const isMissingDatabaseSchemaError = (error) => MISSING_SCHEMA_CODES.has(error?.code);

const createMissingDatabaseSchemaHandler = (message) => (error, req, res, next) => {
  if (!isMissingDatabaseSchemaError(error)) return next(error);
  return res.status(503).json({ message });
};

module.exports = {
  isMissingDatabaseSchemaError,
  createMissingDatabaseSchemaHandler,
};
