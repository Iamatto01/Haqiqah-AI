/**
 * Haqiqah AI — Express Server Entry Point
 * 
 * Production-grade Express application with security middleware,
 * structured logging, and graceful error handling.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./src/config');
const { apiLimiter } = require('./src/middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');
const verifyRouter = require('./src/routes/verify');

// ─── Create Express App ─────────────────────────────────
const app = express();

// ─── Trust Proxy (for rate limiter behind reverse proxy) ─
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// ─── Security Headers ───────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: config.isProduction ? undefined : false,
}));

// ─── CORS Configuration ─────────────────────────────────
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);

    // Allow chrome-extension:// origins
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    if (config.cors.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error(`CORS policy: Origin ${origin} is not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  credentials: true,
  maxAge: 86400, // 24 hours preflight cache
}));

// ─── Body Parsing ────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Request Logging ─────────────────────────────────────
app.use(morgan(config.isProduction ? 'combined' : 'dev'));

// ─── Rate Limiting (API routes only) ─────────────────────
app.use('/api/', apiLimiter);

// ─── Health Check ────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'haqiqah',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ──────────────────────────────────────────
app.use('/api/v1', verifyRouter);

// ─── 404 Handler ─────────────────────────────────────────
app.use(notFoundHandler);

// ─── Global Error Handler ────────────────────────────────
app.use(errorHandler);

// ─── Start Server ────────────────────────────────────────
const server = app.listen(config.port, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║        🔍 Haqiqah AI Server v1.0         ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Port:     ${String(config.port).padEnd(28)}║`);
  console.log(`║  Env:      ${config.nodeEnv.padEnd(28)}║`);
  console.log(`║  Status:   Ready                        ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});

// ─── Graceful Shutdown ───────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n⚡ ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('✅ Server closed. Process exiting.');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('⚠️  Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection:', reason);
});

module.exports = app;
