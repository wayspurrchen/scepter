/**
 * Type definitions for the confidence subsystem.
 *
 * @see {DD016.§2} type-definition module
 */

/**
 * Numeric confidence level 1-5.
 * @implements {S003.§1.AC.02}
 */
export type ConfidenceLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Reviewer icon: AI-generated or human-reviewed.
 * @implements {S003.§1.AC.02}
 */
export type ReviewerIcon = '🤖' | '👤';

/**
 * Canonical in-memory representation of a confidence annotation.
 * Decoupled from any string format. Adapter `parse()` produces this
 * (wrapped in ConfidenceAnnotation); adapter `insert()` consumes it.
 *
 * @implements {S003.§1.AC.02}
 * @implements {S003.§5.AC.01}
 * @implements {DD016.§2.DC.08}
 */
export interface ConfidencePayload {
  reviewer: ReviewerIcon;
  level: ConfidenceLevel;
  /**
   * ISO YYYY-MM-DD. Optional for parse paths reading legacy or hand-edited
   * annotations and for insert paths where claims.confidence.includeDate
   * is false (per R013.§1.AC.06).
   */
  date?: string;
}

/**
 * Parsed confidence annotation including location metadata. Returned by
 * adapter.parse(). Extends ConfidencePayload with line/filePath.
 *
 * @implements {S003.§1.AC.01}
 * @implements {DD016.§2.DC.09}
 */
export interface ConfidenceAnnotation extends ConfidencePayload {
  line: number;
  filePath: string;
}
