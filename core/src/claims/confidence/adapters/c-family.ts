/**
 * C-family confidence adapter (Hat 1 wrapper over legacy behavior).
 *
 * Wraps the legacy parse/format/insert functions behind the
 * ConfidenceAdapter interface. Insert behavior is UNCHANGED at this step
 * — still inserts AFTER the JSDoc closer; the corrective three-branch
 * logic per S003.§3.AC.05 lands in DD016 §5 (Hat 2 step 7).
 *
 * @see {DD016.§5} c-family adapter
 */

import type { ConfidenceAdapter } from '../adapter.js';
import type {
  ConfidenceAnnotation,
  ConfidencePayload,
  ConfidenceLevel,
  ReviewerIcon,
} from '../types.js';

const VALID_LEVELS: readonly ConfidenceLevel[] = [1, 2, 3, 4, 5] as const;

const C_FAMILY_EXTENSIONS: readonly string[] = [
  '.ts', '.tsx', '.js', '.jsx', '.css',
] as const;

/**
 * Regex matching @confidence annotations in both line comments and
 * doc blocks. Verbatim from the legacy implementation. Carrier prefix
 * is `//` or `*`.
 */
const CONFIDENCE_REGEX = /(?:\/\/|\*)\s*@confidence\s+(🤖|👤)(\d)(?:\s+(.+))?/;

const SCAN_LIMIT = 20;

/**
 * @implements {S003.§3.AC.01} matches by source-extension list
 * @implements {DD016.§5.DC.19}
 */
function matches(filePath: string): boolean {
  return C_FAMILY_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

/**
 * Parse a C-family @confidence annotation from file content.
 * Scans only the first 20 lines for performance.
 *
 * @implements {S003.§3.AC.02} regex over first 20 lines
 * @implements {S003.§3.AC.06} legacy parse byte-identical
 * @implements {DD016.§5.DC.20,.DC.21}
 * @implements {R004.§7.AC.01} parse confidence from file header
 * @implements {R004.§7.AC.02} recognize emoji+number format
 */
function parse(
  content: string,
  filePath: string,
): ConfidenceAnnotation | null {
  const lines = content.split('\n');
  const scanLimit = Math.min(lines.length, SCAN_LIMIT);

  for (let i = 0; i < scanLimit; i++) {
    const match = lines[i].match(CONFIDENCE_REGEX);
    if (match) {
      const reviewer = match[1] as ReviewerIcon;
      const level = parseInt(match[2], 10);

      if (!VALID_LEVELS.includes(level as ConfidenceLevel)) {
        continue;
      }

      return {
        level: level as ConfidenceLevel,
        reviewer,
        date: match[3]?.trim(),
        line: i + 1,
        filePath,
      };
    }
  }

  return null;
}

/**
 * Hat 1 implementation: dated path only. Hat 2 §7 adds the no-date branch.
 *
 * @see {S003.§3.AC.03} format string contract (full contract realized in §7)
 * @implements {R004.§7.AC.02} format string convention
 */
function format(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
  date?: string,
): string {
  // Hat 1: callers always supply date; Hat 2 §7 rewrites with the
  // no-date branch and lifts this non-null assertion.
  return `// @confidence ${reviewer}${level} ${date!}`;
}

/**
 * Hat 1 implementation: legacy after-JSDoc-closer insert position.
 * Hat 2 step 7 replaces with the three-branch JSDoc-internal logic per
 * DD016 §5.
 *
 * @see {S003.§3.AC.05} corrected three-branch insert (NOT yet implemented)
 * @implements {S003.§3.AC.04} replace-in-place when annotation found (legacy preserves this)
 * @implements {R004.§7.AC.02} insert/replace annotation
 */
function insert(content: string, payload: ConfidencePayload): string {
  const annotation = format(payload.reviewer, payload.level, payload.date);
  return insertAnnotationString(content, annotation);
}

/**
 * Legacy-compat helper. Inserts a pre-formatted annotation string per
 * the legacy after-JSDoc-closer behavior. Retained for the barrel's
 * legacy insertConfidenceAnnotation wrapper used by mark-command.
 *
 * @deprecated Use cFamilyAdapter.insert(content, payload) directly via
 *   getAdapter(filePath). Removed when {S004}'s DD routes mark-command
 *   through the adapter interface.
 */
export function insertAnnotationString(
  content: string,
  annotation: string,
): string {
  // Handle empty content
  if (content === '') {
    return annotation;
  }

  const lines = content.split('\n');

  // Check for existing annotation in first 20 lines
  const scanLimit = Math.min(lines.length, SCAN_LIMIT);
  for (let i = 0; i < scanLimit; i++) {
    if (CONFIDENCE_REGEX.test(lines[i])) {
      // Replace existing annotation in-place
      lines[i] = annotation;
      return lines.join('\n');
    }
  }

  // No existing annotation — find insertion point
  // Look for end of file-level JSDoc block (first `*/` in header)
  let insertIndex = 0;
  for (let i = 0; i < scanLimit; i++) {
    if (lines[i].includes('*/')) {
      insertIndex = i + 1;
      break;
    }
  }

  // Insert the annotation
  lines.splice(insertIndex, 0, annotation);
  return lines.join('\n');
}

export const cFamilyAdapter: ConfidenceAdapter = {
  id: 'c-family-comments',
  matches,
  parse,
  format,
  insert,
};
