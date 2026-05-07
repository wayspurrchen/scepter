/**
 * Reviewer/level validation for confidence annotations.
 *
 * Verbatim move from core/src/claims/confidence.ts. The rule is enforced
 * at the command layer (mark / apply); adapters MUST NOT import from this
 * file per DC.04.
 *
 * @see {DD016.§7} validation module
 */

import type { ConfidenceLevel, ReviewerIcon } from './types.js';

const REVIEWER_LEVEL_RANGES: Record<ReviewerIcon, readonly ConfidenceLevel[]> = {
  '🤖': [1, 2, 3],
  '👤': [3, 4, 5],
};

/**
 * Validate that a level is within the allowed range for a reviewer icon.
 * AI (🤖) can assign levels 1-3, Human (👤) can assign levels 3-5.
 *
 * @implements {S003.§5.AC.03}
 * @implements {DD016.§7.DC.41}
 * @implements {DD016.§7.DC.42}
 */
export function validateReviewerLevel(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
): { valid: boolean; message?: string } {
  const allowed = REVIEWER_LEVEL_RANGES[reviewer];
  if (!allowed.includes(level)) {
    const range = `${allowed[0]}-${allowed[allowed.length - 1]}`;
    const label = reviewer === '🤖' ? 'AI (🤖)' : 'Human (👤)';
    return {
      valid: false,
      message: `${label} can only assign levels ${range}, got ${level}`,
    };
  }
  return { valid: true };
}

/**
 * Map CLI positional argument to reviewer icon.
 *
 * @implements {S003.§5.AC.03}
 * @implements {DD016.§7.DC.41}
 */
export function mapReviewerArg(arg: string): ReviewerIcon | null {
  switch (arg.toLowerCase()) {
    case 'ai':
      return '🤖';
    case 'human':
      return '👤';
    default:
      return null;
  }
}
