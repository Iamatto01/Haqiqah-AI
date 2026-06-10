/**
 * Haqiqah AI — Input Validation Middleware
 * 
 * Validates and sanitizes all incoming verification requests.
 * Uses express-validator for schema enforcement.
 */

const { body, validationResult } = require('express-validator');

/**
 * Maximum allowed content length for text input.
 */
const MAX_TEXT_LENGTH = 10000;

/**
 * URL pattern validation regex.
 */
const URL_REGEX = /^https?:\/\/.+/i;

/**
 * Validation rules for the /verify-content endpoint.
 */
const verifyContentRules = [
  // At least one of text or url must be provided
  body('text')
    .optional()
    .isString()
    .withMessage('Text must be a string')
    .trim()
    .isLength({ min: 10, max: MAX_TEXT_LENGTH })
    .withMessage(`Text must be between 10 and ${MAX_TEXT_LENGTH} characters`)
    .escape(), // Sanitize HTML entities

  body('url')
    .optional()
    .isString()
    .withMessage('URL must be a string')
    .trim()
    .matches(URL_REGEX)
    .withMessage('URL must be a valid HTTP or HTTPS URL')
    .isLength({ max: 2048 })
    .withMessage('URL must not exceed 2048 characters'),

  body('source')
    .optional()
    .isString()
    .isIn(['extension', 'wix', 'api', 'manual'])
    .withMessage('Source must be one of: extension, wix, api, manual'),

  // Custom validator: ensure at least one of text or url is provided
  body().custom((value, { req }) => {
    if (!req.body.text && !req.body.url) {
      throw new Error('Either "text" or "url" must be provided');
    }
    return true;
  }),
];

/**
 * Middleware that checks validation results and returns errors if any.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg,
      value: err.value,
    }));

    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input. Please check the errors below.',
        details: formattedErrors,
      },
    });
  }

  next();
}

module.exports = {
  verifyContentRules,
  handleValidationErrors,
  MAX_TEXT_LENGTH,
};
