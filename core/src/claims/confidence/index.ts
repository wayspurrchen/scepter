/**
 * Public surface of the confidence subsystem. Consumers import from here.
 *
 * @see {DD016.§1.DC.06} barrel re-export contract
 */

// Public adapter API
export type { ConfidenceAdapter } from './adapter.js';
export { getAdapter } from './registry.js';

// Public types
export type {
  ConfidenceLevel,
  ReviewerIcon,
  ConfidencePayload,
  ConfidenceAnnotation,
} from './types.js';

// Public validation helpers
export { validateReviewerLevel, mapReviewerArg } from './validation.js';

// Audit (transitional re-export pending {S004}'s relocation)
export { auditConfidence } from './audit.js';
export type { ConfidenceAuditResult } from './audit.js';

// ---------------------------------------------------------------------------
// Legacy-compat wrappers
// ---------------------------------------------------------------------------
//
// Preserved for pre-package import names. Slated for removal when
// {S004}'s DD finishes routing all consumers through getAdapter.

import { cFamilyAdapter, insertAnnotationString } from './adapters/c-family.js';
import type {
  ConfidenceAnnotation,
  ConfidenceLevel,
  ReviewerIcon,
} from './types.js';

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
 * Legacy-compat: inserts/replaces a pre-formatted annotation string in
 * file content. Bridges the legacy two-step (format then insertString)
 * call shape used by mark-command.
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
