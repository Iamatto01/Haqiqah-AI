/**
 * Haqiqah AI — Global Error Handler Middleware
 * 
 * Catches all errors and returns safe, structured JSON responses.
 * Never leaks stack traces in production.
 */

const config = require('../config');

/**
 * Custom application error class with HTTP status codes.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 Not Found handler — catches unmatched routes.
 */
function notFoundHandler(req, res, next) {
  const error = new AppError(
    `Route not found: ${req.method} ${req.originalUrl}`,
    404,
    'ROUTE_NOT_FOUND'
  );
  next(error);
}

/**
 * Global error handler middleware.
 * Must have 4 parameters for Express to recognize it as an error handler.
 */
function errorHandler(err, req, res, _next) {
  // Default values
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred';

  // Handle specific error types
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON in request body';
  }

  if (err.message && err.message.includes('CORS')) {
    statusCode = 403;
    code = 'CORS_ERROR';
    message = 'Cross-origin request not allowed from this origin';
  }

  // Log error (full details in development, minimal in production)
  if (config.isProduction) {
    if (statusCode >= 500) {
      console.error(`[ERROR] ${code}: ${message}`, {
        path: req.path,
        method: req.method,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });
    }
  } else {
    console.error(`[ERROR] ${statusCode} ${code}: ${message}`);
    if (err.stack) {
      console.error(err.stack);
    }
  }

  // Send response
  const response = {
    success: false,
    error: {
      code,
      message,
    },
  };

  // Include stack trace only in development
  if (!config.isProduction && err.stack) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = { AppError, errorHandler, notFoundHandler };
