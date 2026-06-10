/**
 * Haqiqah AI — Rate Limiter Middleware
 * 
 * Protects the API from abuse, brute-force attacks, and DDoS.
 * Configurable via environment variables.
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * API Rate Limiter
 * Applied to all /api/ routes.
 */
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,  // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,    // Disable `X-RateLimit-*` headers

  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many verification requests. Please wait before trying again.',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
    },
  },

  // Use the client's real IP behind a proxy
  keyGenerator: (req) => {
    return req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  },

  // Skip rate limiting for health checks
  skip: (req) => req.path === '/health',
});

/**
 * Stricter limiter for the verify endpoint specifically.
 * 20 requests per 15 minutes — verification is expensive.
 */
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    error: {
      code: 'VERIFY_RATE_LIMIT_EXCEEDED',
      message: 'Verification rate limit reached. Each verification calls multiple AI models. Please wait before retrying.',
      retryAfter: 900,
    },
  },
});

module.exports = { apiLimiter, verifyLimiter };
