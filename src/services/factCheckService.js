/**
 * Haqiqah AI — Google Fact Check Service
 * 
 * Queries the Google Fact Check Tools API (v1alpha1) to cross-reference
 * extracted claims against a global database of fact-checked content.
 */

const axios = require('axios');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');

/**
 * Axios instance configured for the Google Fact Check API.
 */
const factCheckClient = axios.create({
  baseURL: config.factCheck.baseUrl,
  timeout: 8000,
  params: {
    key: config.factCheck.apiKey,
  },
});

/**
 * Search for fact-check results for a single claim.
 * 
 * @param {string} query - The search query (optimized claim text)
 * @param {string} [languageCode] - Language code (default: 'en')
 * @returns {Promise<Object>} Fact-check results for this claim
 */
async function searchClaim(query, languageCode = config.factCheck.languageCode) {
  try {
    const response = await factCheckClient.get('/claims:search', {
      params: {
        query: query,
        languageCode: languageCode,
        pageSize: config.factCheck.maxResultsPerClaim,
      },
    });

    const claims = response.data.claims || [];

    return {
      query,
      matchCount: claims.length,
      matches: claims.map(formatClaimResult),
    };
  } catch (error) {
    // Handle specific API errors gracefully
    if (error.response) {
      const status = error.response.status;

      if (status === 429) {
        console.warn(`[FACTCHECK] Rate limit hit for query: "${query}"`);
        return { query, matchCount: 0, matches: [], error: 'rate_limited' };
      }

      if (status === 403) {
        console.error('[FACTCHECK] Invalid or missing API key');
        throw new AppError(
          'Fact-check service authentication failed. Check your Google API key.',
          503,
          'FACTCHECK_AUTH_ERROR'
        );
      }
    }

    // Network or timeout errors — degrade gracefully
    console.warn(`[FACTCHECK] Error searching claim: "${query}" — ${error.message}`);
    return {
      query,
      matchCount: 0,
      matches: [],
      error: 'search_failed',
    };
  }
}

/**
 * Search for fact-check results for multiple claims.
 * Runs searches in parallel with a concurrency limit.
 * 
 * @param {Array<Object>} claims - Array of extracted claims with searchQuery property
 * @returns {Promise<Array<Object>>} Array of fact-check results
 */
async function checkClaims(claims) {
  if (!claims || claims.length === 0) {
    return [];
  }

  // Limit to first 10 claims to avoid API abuse
  const claimsToCheck = claims.slice(0, 10);

  console.log(`[FACTCHECK] Checking ${claimsToCheck.length} claims against Google Fact Check API...`);

  // Run searches with controlled concurrency (3 at a time)
  const results = [];
  const batchSize = 3;

  for (let i = 0; i < claimsToCheck.length; i += batchSize) {
    const batch = claimsToCheck.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (claim) => {
        const result = await searchClaim(claim.searchQuery || claim.text);
        return {
          claimId: claim.id,
          ...result,
        };
      })
    );
    results.push(...batchResults);

    // Small delay between batches to respect rate limits
    if (i + batchSize < claimsToCheck.length) {
      await sleep(200);
    }
  }

  const totalMatches = results.reduce((sum, r) => sum + r.matchCount, 0);
  console.log(`[FACTCHECK] Completed. Total fact-check matches found: ${totalMatches}`);

  return results;
}

/**
 * Format a raw claim result from the API into a clean structure.
 * 
 * @param {Object} claim - Raw claim object from Google API
 * @returns {Object} Formatted claim result
 */
function formatClaimResult(claim) {
  return {
    text: claim.text || '',
    claimant: claim.claimant || 'Unknown',
    claimDate: claim.claimDate || null,
    claimReview: (claim.claimReview || []).map(review => ({
      publisher: {
        name: review.publisher?.name || 'Unknown',
        site: review.publisher?.site || '',
      },
      url: review.url || '',
      title: review.title || '',
      textualRating: review.textualRating || 'No rating',
      languageCode: review.languageCode || 'en',
    })),
  };
}

/**
 * Simple sleep utility for rate limit management.
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  searchClaim,
  checkClaims,
};
