const errorHandler = (err, req, res, next) => {
  console.error(err);
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    message: err.publicMessage || (statusCode >= 500
      ? 'The request could not be completed. Please try again later.'
      : (err.message || 'The request could not be completed.')),
  });
};

module.exports = { errorHandler };
