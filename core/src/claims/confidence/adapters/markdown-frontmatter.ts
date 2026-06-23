/**
 * Markdown frontmatter confidence adapter.
 *
 * Implements the ConfidenceAdapter interface for `.md` files using
 * gray-matter for YAML parse/stringify. Three insert cases per S003.§4:
 *   (1) No frontmatter — create a leading frontmatter block
 *   (2) Frontmatter without confidence key — add the key
 *   (3) Frontmatter with confidence key — replace the value
 *
 * Per Edge case 2 asymmetry, parse swallows malformed YAML errors but
 * insert propagates them.
 *
 * @see {DD016.§6} markdown-frontmatter adapter
 */

import matter from 'gray-matter';
import { stringifyFrontmatter } from '../../../notes/yaml-frontmatter.js';
import type { ConfidenceAdapter } from '../adapter.js';
import type {
  ConfidenceAnnotation,
  ConfidencePayload,
  ConfidenceLevel,
  ReviewerIcon,
  ConfidenceParseOptions,
} from '../types.js';

const VALID_LEVELS: readonly ConfidenceLevel[] = [1, 2, 3, 4, 5] as const;

/**
 * Anchored payload regex for YAML scalar values. Distinct from c-family's
 * CONFIDENCE_REGEX because the YAML scalar carries no `//` or `*` carrier.
 *
 * Matches: `<emoji>?<level>` optionally followed by ` <date>` (no internal
 * whitespace in the date capture, per S003.§4.AC.02 anchored grammar). The
 * leading emoji group is OPTIONAL ({R017}): a bare digit matches with
 * group 1 undefined, so the reviewer falls through to the resolved
 * `options.defaultReviewer`. Capture order is unchanged: 1=emoji, 2=digit,
 * 3=optional trailing date.
 *
 * @implements {DD016.§10.DC.52} emoji-optional grammar
 */
const FRONTMATTER_PAYLOAD_REGEX = /^(🤖|👤)?(\d)(?:\s+(\S+))?$/;

/**
 * @implements {S003.§4.AC.01} matches .md only (case-insensitive)
 * @implements {DD016.§6.DC.30}
 */
function matches(filePath: string): boolean {
  return /\.md$/i.test(filePath);
}

/**
 * Parse a confidence annotation from markdown frontmatter. Returns null
 * when no recognized annotation is present. Suppresses gray-matter
 * errors per the parse-vs-insert asymmetry (S003 Edge case 2).
 *
 * The leading emoji is OPTIONAL ({R017}): when present, `m[1]` is the
 * reviewer regardless of policy; when absent, the reviewer falls through
 * to `options.defaultReviewer`. A null resolved reviewer (emoji absent AND
 * no default) returns null, today's outcome for an unrecognized scalar.
 *
 * Under the active policy, a hand-typed bare `confidence: 4` arrives as a
 * YAML *number* from gray-matter, not a string; an in-range integer is
 * coerced to its digit-string form before the string-scalar guard so the
 * emoji-optional grammar can attribute it to `options.defaultReviewer`.
 *
 * @implements {S003.§4.AC.02}
 * @implements {S003.§4.AC.03}
 * @implements {S003.§6.AC.01} emoji-optional bare-digit defaulting
 * @implements {S003.§6.AC.02} explicit emoji unchanged
 * @implements {S003.§6.AC.08} YAML-integer coercion under active policy
 * @implements {S003.§1.AC.04} returns null on absent annotation
 * @implements {DD016.§6.DC.31}
 * @implements {DD016.§6.DC.32}
 * @implements {DD016.§10.DC.52} reviewer resolution under the policy
 * @implements {DD016.§10.DC.53} YAML-number coercion ahead of the guard
 * @implements {DD016.§10.DC.54} no validation.ts import; no range check
 * @implements {R017.AC.01} bare digit reads as human under active policy
 */
function parse(
  content: string,
  filePath: string,
  options?: ConfidenceParseOptions,
): ConfidenceAnnotation | null {
  if (content === '') return null;

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    // Edge case 2: malformed frontmatter — parse swallows the error.
    return null;
  }

  let value: unknown = parsed.data?.confidence;

  // §10 coercion (active policy only): a hand-typed bare `confidence: 4`
  // is a YAML number, not a string. Coerce an in-range integer to its
  // digit string so the emoji-optional grammar (DC.52) can attribute it
  // to options.defaultReviewer. Inactive policy leaves numbers untouched
  // → today's `typeof value !== 'string'` → null.
  if (
    options?.defaultReviewer != null &&
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  ) {
    value = String(value); // 4 → '4'
  }

  if (typeof value !== 'string') return null;

  const m = value.match(FRONTMATTER_PAYLOAD_REGEX);
  if (!m) return null;

  const level = parseInt(m[2], 10);
  if (!VALID_LEVELS.includes(level as ConfidenceLevel)) return null;

  const emoji = m[1] as ReviewerIcon | undefined;
  const reviewer = emoji ?? options?.defaultReviewer ?? null;
  if (reviewer === null) {
    // Emoji absent AND no defaultReviewer → not an annotation.
    return null;
  }
  const date = m[3];

  return {
    reviewer,
    level: level as ConfidenceLevel,
    date,
    line: locateConfidenceKeyLine(content),
    filePath,
  };
}

/**
 * Find the 1-indexed line number of the `confidence:` key within the
 * leading frontmatter block. Returns 0 if not located.
 *
 * Hand-written linear scan over the leading frontmatter block (between
 * the first and second `---` markers). Does NOT use gray-matter's AST.
 * Sufficient for the project's flat frontmatter convention; nested-key
 * handling would justify revisiting per DD016 Decision 3.
 *
 * @implements {S003.§4.AC.03} 1-indexed line of confidence key
 * @implements {DD016.§6.DC.33}
 */
function locateConfidenceKeyLine(content: string): number {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return 0;

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '---') return 0; // closed frontmatter without finding key
    // Per DC.33: top-level keys only — match against the original line,
    // not the trimmed line, so nested keys (e.g. `  confidence:`) don't false-match.
    if (/^confidence\s*:/.test(lines[i])) return i + 1;
  }
  return 0;
}

/**
 * Render a payload as the bare YAML scalar value. No surrounding quotes,
 * no `confidence:` prefix, no leading or trailing whitespace. YAML
 * quoting is gray-matter's responsibility on stringify.
 *
 * @implements {S003.§4.AC.04} bare payload value, dated and no-date
 * @implements {R013.§1.AC.06} no-date format branch (markdown projection)
 * @implements {DD016.§6.DC.34}
 */
function format(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
  date?: string,
): string {
  if (date === undefined) {
    return `${reviewer}${level}`;
  }
  return `${reviewer}${level} ${date}`;
}

/**
 * Insert or replace a confidence annotation in markdown frontmatter.
 * Three cases per S003.§4:
 *   (1) No frontmatter — create a leading frontmatter block
 *   (2) Frontmatter without confidence key — add the key
 *   (3) Frontmatter with confidence key — replace the value
 *
 * Per Edge case 2 asymmetry: parse swallows malformed YAML; insert
 * propagates the gray-matter error.
 *
 * @implements {S003.§4.AC.05}
 * @implements {S003.§4.AC.06}
 * @implements {S003.§4.AC.07}
 * @implements {S003.§4.AC.08}
 * @implements {S003.§1.AC.05}
 * @implements {S003.§1.AC.06}
 * @implements {S003.§1.AC.07}
 * @implements {DD016.§6.DC.35}
 * @implements {DD016.§6.DC.36}
 * @implements {DD016.§6.DC.37}
 * @implements {DD016.§6.DC.38}
 * @implements {DD016.§6.DC.39}
 */
function insert(content: string, payload: ConfidencePayload): string {
  const valueString = format(payload.reviewer, payload.level, payload.date);

  // Edge case 2 asymmetry: insert propagates gray-matter parse errors.
  // (parse() swallows them, returning null; insert() does not.)
  const parsed = matter(content);

  // Discriminator per DC.39: gray-matter populates parsed.data === {} for
  // BOTH "no frontmatter" and "empty frontmatter (---\n---\n)". The
  // raw-content regex /^---\r?\n/ is the prescribed discriminator.
  const hadFrontmatter = /^---\r?\n/.test(content);

  parsed.data.confidence = valueString;

  if (!hadFrontmatter) {
    // Case (1): create a leading frontmatter block.
    return stringifyFrontmatter(parsed.content, parsed.data);
  }
  // Cases (2) and (3): re-stringify the existing frontmatter with the new key.
  return stringifyFrontmatter(parsed.content, parsed.data);
}

export const markdownFrontmatterAdapter: ConfidenceAdapter = {
  id: 'markdown-frontmatter',
  matches,
  parse,
  format,
  insert,
};
