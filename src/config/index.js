/**
 * Haqiqah AI — Centralized Configuration
 * 
 * All environment variables are validated and exported from here.
 * Throws on startup if required variables are missing.
 */

const dotenv = require('dotenv');
const path = require('path');

// Load .env from the backend root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Validates that a required environment variable exists.
 * @param {string} key - Environment variable name
 * @param {string} [fallback] - Optional fallback value
 * @returns {string} The environment variable value
 */
function requireEnv(key, fallback) {
  const value = process.env[key] || fallback;
  if (!value) {
    throw new Error(
      `[CONFIG ERROR] Missing required environment variable: ${key}\n` +
      `Please set it in your .env file. See .env.example for reference.`
    );
  }
  return value;
}

const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Groq AI
  groq: {
    apiKey: requireEnv('GROQ_API_KEY'),
    claimExtractionModel: 'llama-3.1-8b-instant',
    verdictSynthesisModel: 'llama-3.3-70b-versatile',
    visionModel: 'llama-3.2-11b-vision-preview',
    maxTokensClaim: 2048,
    maxTokensVerdict: 4096,
    temperature: 0.1, // Low temperature for factual accuracy
  },

  // Google Fact Check Tools API (OPTIONAL — system works without it)
  factCheck: {
    apiKey: process.env.GOOGLE_FACTCHECK_API_KEY || null,
    enabled: !!(process.env.GOOGLE_FACTCHECK_API_KEY && process.env.GOOGLE_FACTCHECK_API_KEY !== 'your_google_api_key_here'),
    baseUrl: 'https://factchecktools.googleapis.com/v1alpha1',
    maxResultsPerClaim: 5,
    languageCode: 'en',
  },

  // CORS
  cors: {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,https://iamatto01.github.io')
      .split(',')
      .map(origin => origin.trim()),
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30', 10),
  },

  // Scraper
  scraper: {
    timeoutMs: parseInt(process.env.SCRAPER_TIMEOUT_MS || '10000', 10),
    maxContentLength: parseInt(process.env.SCRAPER_MAX_CONTENT_LENGTH || '500000', 10),
    userAgent: 'Haqiqah AIAI/1.0 (Content Verification Bot)',
  },
};

module.exports = config;
