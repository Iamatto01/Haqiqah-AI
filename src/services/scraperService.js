/**
 * Haqiqah AI — URL Scraper Service
 * 
 * Extracts readable text content from URLs for verification.
 * Uses axios for HTTP requests and cheerio for HTML parsing.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');

/**
 * Scrape readable content from a URL.
 * 
 * @param {string} url - The URL to scrape
 * @returns {Promise<Object>} Extracted content with title, text, and metadata
 */
async function scrapeUrl(url) {
  try {
    console.log(`[SCRAPER] Fetching content from: ${url}`);
    const startTime = Date.now();

    const response = await axios.get(url, {
      timeout: config.scraper.timeoutMs,
      maxContentLength: config.scraper.maxContentLength,
      headers: {
        'User-Agent': config.scraper.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      // Follow redirects (up to 5)
      maxRedirects: 5,
      // Only accept successful responses
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // Verify we got HTML content
    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      throw new AppError(
        'The URL does not point to an HTML page. Only web pages can be analyzed.',
        400,
        'INVALID_CONTENT_TYPE'
      );
    }

    const $ = cheerio.load(response.data);
    const extracted = extractContent($, url);

    const elapsed = Date.now() - startTime;
    console.log(`[SCRAPER] Extracted ${extracted.text.length} chars in ${elapsed}ms from: ${url}`);

    return extracted;
  } catch (error) {
    if (error instanceof AppError) throw error;

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new AppError(
        'The URL took too long to respond. Please try again or paste the text directly.',
        408,
        'SCRAPE_TIMEOUT'
      );
    }

    if (error.response) {
      const status = error.response.status;
      if (status === 404) {
        throw new AppError('The URL returned a 404 Not Found error.', 404, 'URL_NOT_FOUND');
      }
      if (status === 403) {
        throw new AppError('Access to this URL is forbidden.', 403, 'URL_FORBIDDEN');
      }
      throw new AppError(
        `The URL returned an error (HTTP ${status}).`,
        502,
        'URL_ERROR'
      );
    }

    throw new AppError(
      `Failed to fetch URL: ${error.message}`,
      502,
      'SCRAPE_FAILED'
    );
  }
}

/**
 * Extract readable content from parsed HTML.
 * Prioritizes article content, then falls back to body text.
 * 
 * @param {Object} $ - Cheerio instance
 * @param {string} url - Original URL for metadata
 * @returns {Object} Extracted content
 */
function extractContent($, url) {
  // Remove non-content elements
  $('script, style, nav, footer, header, aside, iframe, noscript, svg, form').remove();
  $('[role="navigation"], [role="banner"], [role="complementary"]').remove();
  $('.sidebar, .nav, .footer, .header, .menu, .ad, .advertisement, .social-share').remove();
  $('[class*="cookie"], [class*="popup"], [class*="modal"], [class*="banner"]').remove();

  // Extract metadata
  const title = $('title').first().text().trim()
    || $('meta[property="og:title"]').attr('content')
    || $('h1').first().text().trim()
    || '';

  const description = $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content')
    || '';

  const author = $('meta[name="author"]').attr('content')
    || $('[rel="author"]').first().text().trim()
    || $('[class*="author"]').first().text().trim()
    || '';

  const publishDate = $('meta[property="article:published_time"]').attr('content')
    || $('time[datetime]').first().attr('datetime')
    || '';

  // Extract main content — try article-specific selectors first
  let mainText = '';

  const articleSelectors = [
    'article',
    '[role="main"]',
    '.article-body',
    '.post-content',
    '.entry-content',
    '.story-body',
    '.article-content',
    '#article-body',
    'main',
  ];

  for (const selector of articleSelectors) {
    const element = $(selector).first();
    if (element.length > 0) {
      mainText = element.text();
      break;
    }
  }

  // Fallback: extract from body
  if (!mainText || mainText.trim().length < 100) {
    mainText = $('body').text();
  }

  // Clean up the text
  mainText = cleanText(mainText);

  // Truncate if too long (Groq context limit)
  const maxLength = 8000;
  if (mainText.length > maxLength) {
    mainText = mainText.substring(0, maxLength) + '\n[Content truncated for analysis]';
  }

  return {
    url,
    title: cleanText(title),
    description: cleanText(description),
    author,
    publishDate,
    text: mainText,
    wordCount: mainText.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Clean extracted text by removing extra whitespace and artifacts.
 * 
 * @param {string} text - Raw text to clean
 * @returns {string} Cleaned text
 */
function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')           // Collapse whitespace
    .replace(/\n{3,}/g, '\n\n')     // Max 2 consecutive newlines
    .replace(/\t/g, ' ')             // Replace tabs
    .replace(/\u00A0/g, ' ')         // Replace non-breaking spaces
    .replace(/[^\S\n]+/g, ' ')       // Collapse horizontal whitespace
    .trim();
}

module.exports = {
  scrapeUrl,
};
