/**
 * Haqiqah AI — Verify Content Route
 * 
 * POST /api/v1/verify-content
 * 
 * Orchestrates the full verification pipeline:
 * Input → Scrape (if URL) → Claim Extraction → Fact Check → Verdict Synthesis → Response
 */

const express = require('express');
const router = express.Router();
const { verifyLimiter } = require('../middleware/rateLimiter');
const { verifyContentRules, handleValidationErrors } = require('../middleware/validateInput');
const { AppError } = require('../middleware/errorHandler');
const groqService = require('../services/groqService');
const factCheckService = require('../services/factCheckService');
const { scrapeUrl } = require('../services/scraperService');
const { computeVerdict } = require('../services/verdictEngine');

/**
 * POST /api/v1/verify-content
 * 
 * Accepts either a text string or URL for verification.
 * Returns a Truth Meter verdict with claims analysis and sources.
 * 
 * Request Body:
 *   - text {string} - Direct text content to verify
 *   - url {string} - URL to scrape and verify
 *   - source {string} - Origin: 'extension' | 'wix' | 'api' | 'manual'
 * 
 * Response:
 *   - success {boolean}
 *   - data {Object} - Truth Meter results
 *   - data.verdict {string}
 *   - data.confidenceScore {number}
 *   - data.truthMeter {Object}
 *   - data.claims {Array}
 *   - data.analysis {Object}
 *   - data.sources {Array}
 *   - data.metadata {Object}
 */
router.post(
  '/verify-content',
  verifyLimiter,
  verifyContentRules,
  handleValidationErrors,
  async (req, res, next) => {
    const startTime = Date.now();
    const requestId = generateRequestId();

    try {
      const { text, url, source = 'api' } = req.body;

      console.log(`\n${'═'.repeat(60)}`);
      console.log(`[REQUEST ${requestId}] New verification request`);
      console.log(`  Source: ${source} | Text: ${text ? 'yes' : 'no'} | URL: ${url || 'none'}`);
      console.log(`${'═'.repeat(60)}`);

      // ─── Step 1: Get content to analyze ───────────────────
      let contentToAnalyze = text || '';
      let scrapedMetadata = null;

      if (url) {
        console.log(`[${requestId}] Step 1: Scraping URL...`);
        const scraped = await scrapeUrl(url);
        scrapedMetadata = {
          url: scraped.url,
          title: scraped.title,
          author: scraped.author,
          publishDate: scraped.publishDate,
          wordCount: scraped.wordCount,
        };

        // Combine URL content with any additional text
        contentToAnalyze = [
          scraped.title ? `Title: ${scraped.title}` : '',
          scraped.description ? `Description: ${scraped.description}` : '',
          scraped.text,
          text ? `\nAdditional context provided by user:\n${text}` : '',
        ].filter(Boolean).join('\n\n');
      }

      if (!contentToAnalyze || contentToAnalyze.trim().length < 10) {
        throw new AppError(
          'Insufficient content to analyze. Please provide more text or a different URL.',
          400,
          'INSUFFICIENT_CONTENT'
        );
      }

      // ─── Step 2: Extract claims via Groq (fast model) ────
      console.log(`[${requestId}] Step 2: Extracting claims...`);
      const claimAnalysis = await groqService.extractClaims(contentToAnalyze);

      if (!claimAnalysis.claims || claimAnalysis.claims.length === 0) {
        // No factual claims found — return early with UNVERIFIED
        console.log(`[${requestId}] No verifiable claims found. Returning early.`);
        return res.status(200).json({
          success: true,
          data: {
            verdict: 'UNVERIFIED',
            confidenceScore: 50,
            truthMeter: {
              label: 'Unverified',
              color: '#F59E0B',
              bgColor: '#78350F',
              icon: '🟡',
              level: 3,
              description: 'No verifiable factual claims were found in this content.',
            },
            claims: [],
            analysis: {
              manipulationTactics: claimAnalysis.manipulationTactics || [],
              fitnahIndicators: claimAnalysis.fitnahIndicators || [],
              overallTone: claimAnalysis.overallTone || 'unknown',
              summary: 'This content does not contain verifiable factual claims. It may be opinion, commentary, or general discussion.',
              recommendation: 'No factual claims to verify. Use your own judgment.',
            },
            sources: [],
            metadata: {
              requestId,
              processedAt: new Date().toISOString(),
              processingTimeMs: Date.now() - startTime,
              modelsUsed: [claimAnalysis._meta?.model],
              contentSource: url ? 'url' : 'text',
              scrapedMetadata,
            },
          },
        });
      }

      // ─── Step 3: Cross-reference with Fact Check API (if enabled) ──
      const config = require('../config');
      let factCheckResults = [];

      if (config.factCheck.enabled) {
        console.log(`[${requestId}] Step 3: Checking ${claimAnalysis.claims.length} claims against fact-check databases...`);
        factCheckResults = await factCheckService.checkClaims(claimAnalysis.claims);
      } else {
        console.log(`[${requestId}] Step 3: Skipped (Google Fact Check API not configured — AI-only mode)`);
      }

      // ─── Step 4: Synthesize verdict via Groq (powerful model)
      console.log(`[${requestId}] Step 4: Synthesizing verdict...`);
      const aiVerdict = await groqService.synthesizeVerdict(claimAnalysis, factCheckResults);

      // ─── Step 5: Compute final Truth Meter score ──────────
      console.log(`[${requestId}] Step 5: Computing final verdict...`);
      const finalResult = computeVerdict(aiVerdict, claimAnalysis, factCheckResults);

      const totalTime = Date.now() - startTime;

      console.log(`[${requestId}] ✅ Verification complete in ${totalTime}ms`);
      console.log(`  Verdict: ${finalResult.verdict} | Score: ${finalResult.confidenceScore}`);
      console.log(`  Claims analyzed: ${claimAnalysis.claims.length} | Fact-check matches: ${factCheckResults.reduce((s, r) => s + r.matchCount, 0)}`);

      // ─── Step 6: Return response ──────────────────────────
      return res.status(200).json({
        success: true,
        data: {
          ...finalResult,
          metadata: {
            requestId,
            processedAt: new Date().toISOString(),
            processingTimeMs: totalTime,
            modelsUsed: [
              claimAnalysis._meta?.model,
              aiVerdict._meta?.model,
            ].filter(Boolean),
            totalTokensUsed:
              (claimAnalysis._meta?.tokensUsed || 0) +
              (aiVerdict._meta?.tokensUsed || 0),
            contentSource: url ? 'url' : 'text',
            claimsExtracted: claimAnalysis.claims.length,
            factCheckQueriesMade: factCheckResults.length,
            scrapedMetadata,
          },
        },
      });
    } catch (error) {
      console.error(`[${requestId}] ❌ Verification failed: ${error.message}`);
      next(error);
    }
  }
);

/**
 * GET /api/v1/verify-content/health
 * Quick health check for the verify endpoint specifically.
 */
router.get('/verify-content/health', (req, res) => {
  res.status(200).json({
    success: true,
    endpoint: '/api/v1/verify-content',
    status: 'operational',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Generate a short request ID for logging.
 */
function generateRequestId() {
  return `HQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

module.exports = router;
