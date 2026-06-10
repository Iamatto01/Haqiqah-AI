/**
 * Haqiqah AI — Groq Service
 * 
 * Two-stage AI pipeline using Groq's ultra-fast inference:
 * 1. Claim Extraction (llama-3.1-8b-instant) — Speed-optimized
 * 2. Verdict Synthesis (llama-3.3-70b-versatile) — Reasoning-optimized
 */

const Groq = require('groq-sdk');
const config = require('../config');
const { CLAIM_EXTRACTION_PROMPT } = require('../prompts/claimExtraction');
const { VERDICT_SYNTHESIS_PROMPT } = require('../prompts/verdictSynthesis');
const { AppError } = require('../middleware/errorHandler');

// Initialize Groq client
const groq = new Groq({
  apiKey: config.groq.apiKey,
});

/**
 * Stage 1: Extract factual claims from text content (and optional image).
 * Uses the fast 8B model for text, or the 11B vision model if an image is present.
 * 
 * @param {string} text - The content to analyze
 * @param {string} [imageBase64] - Optional base64 encoded image
 * @returns {Promise<Object>} Extracted claims and analysis
 */
async function extractClaims(text, imageBase64) {
  try {
    const startTime = Date.now();
    const modelToUse = imageBase64 ? config.groq.visionModel : config.groq.claimExtractionModel;
    
    let userMessageContent;
    if (imageBase64) {
      // Ensure correct formatting for base64
      const formattedImage = imageBase64.startsWith('data:image') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
      userMessageContent = [
        { type: "text", text: `Analyze the following content and image, and extract all factual claims. Ensure you consider both the image text and the provided text context:\n\n---\n${text || 'No text provided. Analyze the image.'}\n---` },
        { type: "image_url", image_url: { url: formattedImage } }
      ];
    } else {
      userMessageContent = `Analyze the following content and extract all factual claims:\n\n---\n${text}\n---`;
    }

    const completion = await groq.chat.completions.create({
      model: modelToUse,
      messages: [
        {
          role: 'system',
          content: CLAIM_EXTRACTION_PROMPT,
        },
        {
          role: 'user',
          content: userMessageContent,
        },
      ],
      temperature: config.groq.temperature,
      max_tokens: config.groq.maxTokensClaim,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new AppError('Groq returned an empty response for claim extraction', 502, 'AI_EMPTY_RESPONSE');
    }

    const parsed = safeParseJSON(responseText);
    const elapsed = Date.now() - startTime;

    console.log(`[GROQ] Claim extraction completed in ${elapsed}ms | Model: ${modelToUse} | Claims found: ${parsed.claims?.length || 0}`);

    return {
      ...parsed,
      _meta: {
        model: modelToUse,
        processingTimeMs: elapsed,
        tokensUsed: completion.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    // Handle Groq-specific errors
    if (error.status === 429) {
      throw new AppError(
        'AI service rate limit reached. Please try again in a moment.',
        429,
        'GROQ_RATE_LIMIT'
      );
    }

    if (error.status === 503 || error.status === 500) {
      throw new AppError(
        'AI service is temporarily unavailable. Please try again later.',
        503,
        'GROQ_UNAVAILABLE'
      );
    }

    throw new AppError(
      `Claim extraction failed: ${error.message}`,
      502,
      'CLAIM_EXTRACTION_FAILED'
    );
  }
}

/**
 * Stage 2: Synthesize a final verdict by cross-referencing claims with fact-check data.
 * Uses the powerful 70B model for deep reasoning.
 * 
 * @param {Object} claimAnalysis - Output from extractClaims()
 * @param {Array} factCheckResults - Results from fact check service
 * @returns {Promise<Object>} Final verdict and analysis
 */
async function synthesizeVerdict(claimAnalysis, factCheckResults) {
  try {
    const startTime = Date.now();

    // Build the context message for the verdict model
    const contextMessage = buildVerdictContext(claimAnalysis, factCheckResults);

    const completion = await groq.chat.completions.create({
      model: config.groq.verdictSynthesisModel,
      messages: [
        {
          role: 'system',
          content: VERDICT_SYNTHESIS_PROMPT,
        },
        {
          role: 'user',
          content: contextMessage,
        },
      ],
      temperature: config.groq.temperature,
      max_tokens: config.groq.maxTokensVerdict,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new AppError('Groq returned an empty response for verdict synthesis', 502, 'AI_EMPTY_RESPONSE');
    }

    const parsed = safeParseJSON(responseText);
    const elapsed = Date.now() - startTime;

    console.log(`[GROQ] Verdict synthesis completed in ${elapsed}ms | Model: ${config.groq.verdictSynthesisModel} | Verdict: ${parsed.verdict} | Score: ${parsed.confidenceScore}`);

    return {
      ...parsed,
      _meta: {
        model: config.groq.verdictSynthesisModel,
        processingTimeMs: elapsed,
        tokensUsed: completion.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    if (error.status === 429) {
      throw new AppError(
        'AI service rate limit reached. Please try again in a moment.',
        429,
        'GROQ_RATE_LIMIT'
      );
    }

    throw new AppError(
      `Verdict synthesis failed: ${error.message}`,
      502,
      'VERDICT_SYNTHESIS_FAILED'
    );
  }
}

/**
 * Builds the user message that provides all context to the verdict model.
 * 
 * @param {Object} claimAnalysis - Extracted claims and manipulation data
 * @param {Array} factCheckResults - Fact-check API results per claim
 * @returns {string} Formatted context string
 */
function buildVerdictContext(claimAnalysis, factCheckResults) {
  const sections = [];

  sections.push('## EXTRACTED CLAIMS');
  if (claimAnalysis.claims && claimAnalysis.claims.length > 0) {
    claimAnalysis.claims.forEach((claim, i) => {
      sections.push(`\n### Claim ${i + 1} (ID: ${claim.id})`);
      sections.push(`- **Text:** "${claim.text}"`);
      sections.push(`- **Type:** ${claim.type}`);
      sections.push(`- **Verifiable:** ${claim.verifiable}`);
    });
  } else {
    sections.push('No verifiable claims were extracted from the content.');
  }

  sections.push('\n## MANIPULATION ANALYSIS');
  sections.push(`- **Tactics Detected:** ${(claimAnalysis.manipulationTactics || []).join(', ') || 'None'}`);
  sections.push(`- **Fitnah Indicators:** ${(claimAnalysis.fitnahIndicators || []).join(', ') || 'None'}`);
  sections.push(`- **Overall Tone:** ${claimAnalysis.overallTone || 'Not assessed'}`);

  if (claimAnalysis.languageAnalysis) {
    sections.push(`- **Emotional Intensity:** ${claimAnalysis.languageAnalysis.emotionalIntensity}`);
    sections.push(`- **Objectivity Score:** ${claimAnalysis.languageAnalysis.objectivityScore}`);
  }

  sections.push('\n## FACT-CHECK RESULTS');
  if (factCheckResults && factCheckResults.length > 0) {
    factCheckResults.forEach((result, i) => {
      sections.push(`\n### Fact-Check for Claim ${result.claimId || i + 1}`);
      sections.push(`- **Search Query:** "${result.query}"`);

      if (result.matches && result.matches.length > 0) {
        result.matches.forEach((match, j) => {
          sections.push(`\n  **Match ${j + 1}:**`);
          sections.push(`  - Claim Reviewed: "${match.text}"`);
          sections.push(`  - Publisher: ${match.claimant || 'Unknown'}`);
          if (match.claimReview && match.claimReview.length > 0) {
            match.claimReview.forEach(review => {
              sections.push(`  - Reviewer: ${review.publisher?.name || 'Unknown'}`);
              sections.push(`  - Rating: ${review.textualRating || 'N/A'}`);
              sections.push(`  - URL: ${review.url || 'N/A'}`);
            });
          }
        });
      } else {
        sections.push('  No fact-check matches found for this claim.');
      }
    });
  } else {
    sections.push('No fact-check results were available for any claims.');
  }

  sections.push('\n## INSTRUCTION');
  sections.push('Based on ALL the above evidence, produce your final verdict JSON.');

  return sections.join('\n');
}

/**
 * Safely parse JSON from AI response, handling common formatting issues.
 * 
 * @param {string} text - Raw AI response text
 * @returns {Object} Parsed JSON object
 */
function safeParseJSON(text) {
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch (e) {
    // Try extracting JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (e2) {
        // Fall through
      }
    }

    // Try finding JSON object pattern
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (e3) {
        // Fall through
      }
    }

    throw new AppError(
      'Failed to parse AI response as JSON. The model returned an unexpected format.',
      502,
      'AI_PARSE_ERROR'
    );
  }
}

module.exports = {
  extractClaims,
  synthesizeVerdict,
};
