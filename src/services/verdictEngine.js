/**
 * Haqiqah AI — Verdict Engine
 * 
 * Computes the final Truth Meter score and label by combining
 * AI analysis, fact-check evidence, and manipulation signals.
 */

/**
 * Truth Meter level definitions with visual properties.
 */
const TRUTH_METER_LEVELS = {
  VERIFIED_TRUE: {
    label: 'Verified True',
    color: '#10B981',    // Emerald green
    bgColor: '#064E3B',
    icon: '✅',
    level: 5,
    description: 'This content has been verified as factually accurate.',
  },
  LIKELY_TRUE: {
    label: 'Likely True',
    color: '#34D399',    // Light green
    bgColor: '#065F46',
    icon: '🟢',
    level: 4,
    description: 'This content appears largely accurate with minor caveats.',
  },
  UNVERIFIED: {
    label: 'Unverified',
    color: '#F59E0B',    // Amber
    bgColor: '#78350F',
    icon: '🟡',
    level: 3,
    description: 'This content could not be verified. Exercise caution.',
  },
  LIKELY_FALSE: {
    label: 'Likely False',
    color: '#F97316',    // Orange
    bgColor: '#7C2D12',
    icon: '🟠',
    level: 2,
    description: 'This content contains claims that contradict available evidence.',
  },
  HIGH_RISK_FITNAH: {
    label: 'High Risk of Fitnah',
    color: '#EF4444',    // Red
    bgColor: '#7F1D1D',
    icon: '🔴',
    level: 1,
    description: 'This content shows strong indicators of misinformation or slander.',
  },
};

/**
 * Compute the final Truth Meter result from AI verdict and fact-check data.
 * 
 * @param {Object} aiVerdict - Output from groqService.synthesizeVerdict()
 * @param {Object} claimAnalysis - Output from groqService.extractClaims()
 * @param {Array} factCheckResults - Output from factCheckService.checkClaims()
 * @returns {Object} Complete Truth Meter result
 */
function computeVerdict(aiVerdict, claimAnalysis, factCheckResults) {
  // Get the AI's verdict (primary signal)
  const verdictKey = normalizeVerdictKey(aiVerdict.verdict);
  const confidenceScore = clampScore(aiVerdict.confidenceScore);

  // Compute supplementary scores
  const factCheckCoverage = computeFactCheckCoverage(factCheckResults, claimAnalysis);
  const manipulationPenalty = computeManipulationPenalty(claimAnalysis);

  // Adjust confidence score with fact-check coverage and manipulation penalty
  let adjustedScore = confidenceScore;

  // If fact-check API was used but found no matches, cap at 59
  // In AI-only mode (no fact-check API), trust the AI's score fully
  const factCheckWasUsed = factCheckResults && factCheckResults.length > 0;
  if (factCheckWasUsed && factCheckCoverage.matchRate === 0 && adjustedScore > 59) {
    adjustedScore = Math.min(adjustedScore, 59);
  }

  // Apply manipulation penalty
  adjustedScore = Math.max(0, adjustedScore - manipulationPenalty);

  // Fitnah override: any fitnah indicator caps score at 30
  const hasFitnah = claimAnalysis.fitnahIndicators && claimAnalysis.fitnahIndicators.length > 0;
  if (hasFitnah && adjustedScore > 30) {
    adjustedScore = Math.min(adjustedScore, 30);
  }

  // Determine final verdict from adjusted score
  const finalVerdictKey = scoreToVerdict(adjustedScore);
  const truthMeter = TRUTH_METER_LEVELS[finalVerdictKey];

  return {
    verdict: finalVerdictKey,
    confidenceScore: adjustedScore,
    truthMeter: {
      label: truthMeter.label,
      color: truthMeter.color,
      bgColor: truthMeter.bgColor,
      icon: truthMeter.icon,
      level: truthMeter.level,
      description: truthMeter.description,
    },
    claims: buildClaimsSummary(aiVerdict, factCheckResults),
    analysis: {
      manipulationTactics: claimAnalysis.manipulationTactics || [],
      fitnahIndicators: claimAnalysis.fitnahIndicators || [],
      overallTone: claimAnalysis.overallTone || 'unknown',
      summary: aiVerdict.summary || '',
      recommendation: aiVerdict.recommendation || '',
      detailedAnalysis: aiVerdict.detailedAnalysis || {},
    },
    sources: extractSources(aiVerdict),
    scoring: {
      aiRawScore: confidenceScore,
      adjustedScore,
      factCheckCoverage: factCheckCoverage.matchRate,
      manipulationPenalty,
      fitnahOverrideApplied: hasFitnah && confidenceScore > 30,
    },
  };
}

/**
 * Convert a confidence score to a verdict key.
 */
function scoreToVerdict(score) {
  if (score >= 80) return 'VERIFIED_TRUE';
  if (score >= 60) return 'LIKELY_TRUE';
  if (score >= 40) return 'UNVERIFIED';
  if (score >= 20) return 'LIKELY_FALSE';
  return 'HIGH_RISK_FITNAH';
}

/**
 * Normalize the AI's verdict string to a valid key.
 */
function normalizeVerdictKey(verdict) {
  if (!verdict) return 'UNVERIFIED';
  const key = verdict.toUpperCase().replace(/\s+/g, '_');
  return TRUTH_METER_LEVELS[key] ? key : 'UNVERIFIED';
}

/**
 * Clamp a score to the 0-100 range.
 */
function clampScore(score) {
  if (typeof score !== 'number' || isNaN(score)) return 50;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Compute how well claims are covered by fact-check results.
 */
function computeFactCheckCoverage(factCheckResults, claimAnalysis) {
  if (!factCheckResults || factCheckResults.length === 0) {
    return { matchRate: 0, totalMatches: 0, claimsChecked: 0 };
  }

  const claimsChecked = factCheckResults.length;
  const claimsWithMatches = factCheckResults.filter(r => r.matchCount > 0).length;
  const totalMatches = factCheckResults.reduce((sum, r) => sum + (r.matchCount || 0), 0);

  return {
    matchRate: claimsChecked > 0 ? claimsWithMatches / claimsChecked : 0,
    totalMatches,
    claimsChecked,
  };
}

/**
 * Compute a penalty score based on detected manipulation tactics.
 */
function computeManipulationPenalty(claimAnalysis) {
  const tactics = claimAnalysis.manipulationTactics || [];
  if (tactics.length === 0) return 0;

  // High-severity tactics
  const highSeverity = [
    'fabricated_statistics', 'conspiratorial_framing', 'incitement_to_hatred',
  ];

  // Medium-severity tactics
  const mediumSeverity = [
    'false_authority', 'unverified_attribution', 'out_of_context', 'misleading_headline',
  ];

  let penalty = 0;
  tactics.forEach(tactic => {
    if (highSeverity.includes(tactic)) {
      penalty += 15;
    } else if (mediumSeverity.includes(tactic)) {
      penalty += 8;
    } else {
      penalty += 4;
    }
  });

  // Cap penalty at 40
  return Math.min(penalty, 40);
}

/**
 * Build a unified claims summary from AI verdict and fact-check data.
 */
function buildClaimsSummary(aiVerdict, factCheckResults) {
  if (!aiVerdict.claimResults) return [];

  return aiVerdict.claimResults.map(claim => {
    // Find matching fact-check result
    const factCheck = factCheckResults?.find(r => r.claimId === claim.claimId);

    return {
      id: claim.claimId,
      text: claim.originalClaim,
      status: claim.status,
      evidence: claim.evidence,
      factCheckMatches: factCheck?.matchCount || 0,
      sources: claim.sources || [],
    };
  });
}

/**
 * Extract all unique sources from the AI verdict.
 */
function extractSources(aiVerdict) {
  const sources = [];
  const seen = new Set();

  if (aiVerdict.claimResults) {
    aiVerdict.claimResults.forEach(claim => {
      (claim.sources || []).forEach(source => {
        const key = source.url || source.publisher;
        if (!seen.has(key)) {
          seen.add(key);
          sources.push(source);
        }
      });
    });
  }

  return sources;
}

module.exports = {
  computeVerdict,
  TRUTH_METER_LEVELS,
};
