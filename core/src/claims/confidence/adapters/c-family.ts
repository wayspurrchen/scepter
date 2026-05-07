/**
 * C-family confidence adapter.
 *
 * Implements the ConfidenceAdapter interface for `.ts`/`.tsx`/`.js`/`.jsx`/`.css`
 * files. Insert follows the S003.§3.AC.05 three-branch priority order:
 *   (a) JSDoc-internal placement BEFORE the closing JSDoc marker when a
 *       top-level JSDoc block is present in the first 20 lines;
 *   (b) line-comment-stack — append after a contiguous leading `//` block;
 *   (c) bare-file fallback — insert at line 0.
 *
 * Replace-in-place preserves the matched line's carrier per detectCarrier.
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
 * Format a payload as the C-family annotation string. When date is
 * defined, includes the trailing space and date; when undefined, emits
 * the bare `// @confidence <reviewer><level>` form per the
 * `claims.confidence.includeDate=false` path.
 *
 * @implements {DD016.§5.DC.22} dated and no-date branches
 * @implements {S003.§3.AC.03} format string contract (dated AND no-date)
 * @implements {R013.§1.AC.06} no-date format branch (source projection)
 * @implements {R004.§7.AC.02} format string convention
 */
function format(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
  date?: string,
): string {
  if (date === undefined) {
    return `// @confidence ${reviewer}${level}`;
  }
  return `// @confidence ${reviewer}${level} ${date}`;
}

type Carrier = 'jsdoc' | 'line-comment';

const JSDOC_CLOSER = '*' + '/';

/**
 * Determine the carrier (line-comment or JSDoc-internal) of a line that
 * matches CONFIDENCE_REGEX. Used to preserve carrier on replace-in-place
 * and to inform branch selection.
 *
 * @implements {DD016.§5.DC.28} carrier detection rule
 * @implements {S003.§3.AC.04} carrier preservation on replace
 */
function detectCarrier(line: string): Carrier {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//')) return 'line-comment';
  return 'jsdoc';
}

/**
 * Render a payload as the bare `<reviewer><level>(\s<date>)?` string,
 * suitable for embedding inside a JSDoc body line (after a leading
 * asterisk-indent and the `@confidence ` tag) or in any context where
 * the line-comment carrier is supplied separately.
 */
function payloadString(payload: ConfidencePayload): string {
  if (payload.date === undefined) {
    return `${payload.reviewer}${payload.level}`;
  }
  return `${payload.reviewer}${payload.level} ${payload.date}`;
}

/**
 * Insert or replace a confidence annotation in C-family file content.
 * Replace-in-place when found; otherwise §3.AC.05 priority order:
 *   (a) JSDoc-internal — ` * @confidence ...` before the closing marker
 *   (b) Line-comment-stack — append `// @confidence ...` after stack
 *   (c) Bare-file — `// @confidence ...` at line 0
 *
 * @implements {DD016.§5.DC.23,.DC.24,.DC.25,.DC.26,.DC.27}
 * @implements {S003.§3.AC.04,.AC.05}
 * @implements {S003.§1.AC.06,.AC.07}
 * @implements {R004.§7.AC.02}
 */
function insert(content: string, payload: ConfidencePayload): string {
  if (content === '') {
    return format(payload.reviewer, payload.level, payload.date);
  }

  const lines = content.split('\n');
  const scanLimit = Math.min(lines.length, SCAN_LIMIT);

  // Step 4: scan for existing annotation
  let existingIdx = -1;
  for (let i = 0; i < scanLimit; i++) {
    if (CONFIDENCE_REGEX.test(lines[i])) {
      existingIdx = i;
      break;
    }
  }

  // Step 5: replace in-place when found, preserving carrier
  if (existingIdx >= 0) {
    const carrier = detectCarrier(lines[existingIdx]);
    if (carrier === 'jsdoc') {
      // Read the leading-asterisk indent from the matched line itself.
      // The regex guarantees a `*` somewhere on the matched line; capture
      // the leading whitespace + `*` + ` ` portion.
      const indentMatch = lines[existingIdx].match(/^(\s*\*\s*)/);
      const indent = indentMatch ? indentMatch[1] : ' * ';
      lines[existingIdx] = `${indent}@confidence ${payloadString(payload)}`;
    } else {
      lines[existingIdx] = format(payload.reviewer, payload.level, payload.date);
    }
    return lines.join('\n');
  }

  // Step 6a: JSDoc carrier (preferred)
  let openIdx = -1;
  for (let i = 0; i < scanLimit; i++) {
    if (lines[i].includes('/**')) {
      openIdx = i;
      break;
    }
  }
  if (openIdx >= 0) {
    let closeIdx = -1;
    for (let j = openIdx + 1; j < scanLimit; j++) {
      if (lines[j].includes(JSDOC_CLOSER)) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx >= 0) {
      const above = lines[closeIdx - 1] ?? '';
      const indentMatch = above.match(/^(\s*\*\s*)/);
      const indent = indentMatch ? indentMatch[1] : ' * ';
      const newLine = `${indent}@confidence ${payloadString(payload)}`;
      lines.splice(closeIdx, 0, newLine);
      return lines.join('\n');
    }
  }

  // Step 6b: line-comment-stack carrier
  if (lines[0]?.trimStart().startsWith('//')) {
    let stackEnd = 0;
    while (
      stackEnd + 1 < lines.length &&
      lines[stackEnd + 1].trimStart().startsWith('//')
    ) {
      stackEnd++;
    }
    const newLine = format(payload.reviewer, payload.level, payload.date);
    lines.splice(stackEnd + 1, 0, newLine);
    return lines.join('\n');
  }

  // Step 6c: bare-file fallback
  const newLine = format(payload.reviewer, payload.level, payload.date);
  lines.splice(0, 0, newLine);
  return lines.join('\n');
}

/**
 * Legacy-compat helper. Inserts a pre-formatted annotation string by
 * re-parsing it into a payload and dispatching to insert(). Retained
 * for the barrel's legacy insertConfidenceAnnotation wrapper used by
 * mark-command. mark-command picks up the corrective insert behavior
 * via this dispatch.
 *
 * @deprecated Use cFamilyAdapter.insert(content, payload) directly via
 *   getAdapter(filePath). Removed when {S004}'s DD routes mark-command
 *   through the adapter interface.
 */
export function insertAnnotationString(
  content: string,
  annotation: string,
): string {
  // Parse the annotation back into a payload. Robust against any
  // well-formed CONFIDENCE_REGEX-matching string (the only kind
  // mark-command produces via formatConfidenceAnnotation).
  const inline = parse(annotation, '<inline>');
  if (inline === null) {
    // Defensive fallback: malformed annotation; insert verbatim at line 0.
    // mark-command never produces malformed strings, but this preserves
    // a reasonable behavior for any external caller.
    return content === '' ? annotation : `${annotation}\n${content}`;
  }
  return insert(content, {
    reviewer: inline.reviewer,
    level: inline.level,
    date: inline.date,
  });
}

export const cFamilyAdapter: ConfidenceAdapter = {
  id: 'c-family-comments',
  matches,
  parse,
  format,
  insert,
};
