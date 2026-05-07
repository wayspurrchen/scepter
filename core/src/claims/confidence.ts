/**
 * Confidence markers for SCEpter.
 *
 * File-level confidence annotations that classify each source file's
 * review status. Numeric levels 1-5 with emoji prefix (🤖 AI, 👤 Human).
 *
 * Convention: no space between emoji and number.
 *
 * @implements {R004.§7.AC.01} Confidence audit: discovery, parsing, aggregation
 * @implements {R004.§7.AC.02} Confidence marking: format, insert, validate
 * @implements {R004.§7.AC.03} Auto-insert config support
 */

import type {
  ConfidenceLevel,
  ReviewerIcon,
  ConfidenceAnnotation,
} from './confidence/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  ConfidenceLevel,
  ReviewerIcon,
  ConfidencePayload,
  ConfidenceAnnotation,
} from './confidence/types.js';

// ConfidenceAuditResult and auditConfidence live at ./confidence/audit.ts.
// @see {DD016.§9} audit transitional home pending S004's DD relocation
export type { ConfidenceAuditResult } from './confidence/audit.js';
export { auditConfidence } from './confidence/audit.js';

// ---------------------------------------------------------------------------
// Validation re-exports
// ---------------------------------------------------------------------------

// Reviewer/level validation lives at ./confidence/validation.ts.
// @see {DD016.§7} validation module
export { validateReviewerLevel, mapReviewerArg } from './confidence/validation.js';

// ---------------------------------------------------------------------------
// Legacy-compat wrappers (parse/format/insert)
// ---------------------------------------------------------------------------
//
// Pre-package callers (mark-command, audit-command, the legacy test file)
// import these names. They delegate to the C-family adapter. Slated for
// removal when {S004}'s DD routes all consumers through getAdapter().

import { cFamilyAdapter, insertAnnotationString } from './confidence/adapters/c-family.js';

/**
 * Legacy-compat: parses C-family @confidence annotations.
 *
 * @deprecated Use `cFamilyAdapter.parse()` or `getAdapter(filePath).parse()`.
 *   Removed when {S004}'s DD routes mark-command through getAdapter.
 */
export function parseConfidenceAnnotation(
  content: string,
  filePath: string,
): ConfidenceAnnotation | null {
  return cFamilyAdapter.parse(content, filePath);
}

/**
 * Legacy-compat: formats a C-family @confidence annotation string.
 *
 * @deprecated Use `cFamilyAdapter.format()` or `getAdapter(filePath).format()`.
 *   Removed when {S004}'s DD routes mark-command through getAdapter.
 */
export function formatConfidenceAnnotation(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
  date: string,
): string {
  return cFamilyAdapter.format(reviewer, level, date);
}

/**
 * Legacy-compat: inserts a pre-formatted annotation string into file content.
 * Bridges the legacy two-step (format then insertString) call shape used by
 * mark-command. Delegates to the package-private insertAnnotationString
 * which carries the legacy after-JSDoc-closer behavior in this Hat 1 step;
 * Hat 2 step 7 rewrites with the corrective three-branch logic.
 *
 * @deprecated Use `cFamilyAdapter.insert(content, payload)` directly.
 *   Removed when {S004}'s DD routes mark-command through getAdapter.
 */
export function insertConfidenceAnnotation(
  content: string,
  annotation: string,
): string {
  return insertAnnotationString(content, annotation);
}
