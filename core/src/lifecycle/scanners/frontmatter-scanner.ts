/**
 * Frontmatter scanner adapter for the rewriter engine.
 *
 * Emits `ReferenceSpan` records for note-ID-shaped entries in YAML
 * frontmatter:
 *
 *   - **List entries** (`frontmatter-list` surface): scalar values
 *     inside lists for fields like `derives:`, `supersedes:`,
 *     `superseded_by:`, etc. Both bare-ID (`R005`) and claim-level
 *     (`R005.§1.AC.03`) forms are emitted.
 *
 *   - **id field** (`frontmatter-id` surface): the `id:` scalar of
 *     the rewrite target's own note, used by the rename operation to
 *     update the note's self-identifier. This surface is emitted
 *     ONLY when the file under scan is the rewrite target — callers
 *     pass `expectedNoteId` to enable it.
 *
 * The scanner is intentionally text-based: it does NOT roundtrip the
 * YAML through a parser. Roundtripping `js-yaml`'s parse-and-dump on
 * arbitrary frontmatter risks reordering keys, quoting transformations,
 * and comment loss. The substituter only rewrites the note-ID byte
 * range, so the original YAML formatting is preserved verbatim.
 *
 * @implements {DD020.§2.DC.11} frontmatter-list spans for scalar list entries (bare-ID and claim-level)
 * @implements {DD020.§2.DC.12} frontmatter-id span only for the renamed note's own file
 */

import type { ReferenceSpan, ScannerAdapter } from '../rewriter';
import { buildSpanFromCandidate } from './markdown-body-scanner';

export interface FrontmatterScannerOptions {
  /**
   * The note ID this file is expected to belong to. Required to emit
   * `frontmatter-id` spans — the scanner refuses to emit `frontmatter-id`
   * for any file whose own `id:` does not match this expected value.
   *
   * Pass `undefined` (or omit) when the scanner runs across all
   * project files except the rewrite target — only `frontmatter-list`
   * spans are emitted.
   */
  expectedNoteId?: string;

  /**
   * Names of frontmatter fields to treat as list/scalar reference
   * carriers. Defaults to a conservative set covering the SCEpter
   * lifecycle vocabulary.
   */
  listFields?: Set<string>;
}

const DEFAULT_LIST_FIELDS = new Set<string>([
  'derives',
  'supersedes',
  'superseded_by',
  'supersededBy',
  'implements',
  'depends_on',
  'dependsOn',
  'addresses',
  'see',
  'related',
]);

/**
 * Build a frontmatter scanner closure.
 */
export function createFrontmatterScanner(
  options: FrontmatterScannerOptions = {},
): ScannerAdapter {
  return (filePath, content) => scanFrontmatter(filePath, content, options);
}

/**
 * Scan a file's YAML frontmatter for note-ID references.
 */
export function scanFrontmatter(
  filePath: string,
  content: string,
  options: FrontmatterScannerOptions = {},
): ReferenceSpan[] {
  const fmRange = locateFrontmatterRange(content);
  if (!fmRange) {
    return [];
  }
  const [fmStart, fmEnd] = fmRange;
  const listFields = options.listFields ?? DEFAULT_LIST_FIELDS;
  const spans: ReferenceSpan[] = [];

  // Walk line by line. We track:
  //   - current top-level scalar field (for `id:` extraction)
  //   - current list-field key (for `frontmatter-list` spans), valid
  //     until the next non-list-item line.
  let cursor = fmStart;
  let activeListField: string | null = null;

  while (cursor < fmEnd) {
    const nlIdx = content.indexOf('\n', cursor);
    const lineEnd = nlIdx === -1 || nlIdx >= fmEnd ? fmEnd : nlIdx;
    const line = content.slice(cursor, lineEnd);

    // Skip empty lines and comments — but keep activeListField alive
    // through blank lines is incorrect; YAML lists end at indentation
    // changes. We close the list on any non-list-item, non-blank line.
    const trimmedLine = line.trim();

    // List-item line: `  - <value>`
    const listItemMatch = line.match(/^(\s*)-\s+(.+?)\s*$/);
    if (listItemMatch && activeListField) {
      const indent = listItemMatch[1].length;
      const value = listItemMatch[2];
      // Strip optional surrounding quotes (single or double).
      const { unquoted, offsetWithinValue } = stripQuotes(value);

      // The `- ` consumes `indent + 2` chars. Find the position of
      // `value` within the line, then add offset for quote stripping.
      const dashIdx = line.indexOf('-', indent);
      const valueStartInLine =
        dashIdx + 1 + (line.slice(dashIdx + 1).length - line.slice(dashIdx + 1).trimStart().length);
      const valueStart = cursor + valueStartInLine + offsetWithinValue;

      const span = buildSpanFromCandidate(
        filePath,
        content,
        unquoted,
        valueStart,
        'frontmatter-list',
      );
      if (span) {
        spans.push(span);
      }

      cursor = lineEnd === fmEnd ? fmEnd : lineEnd + 1;
      continue;
    }

    // Non-blank, non-list-item line: close any active list.
    if (trimmedLine !== '' && !trimmedLine.startsWith('#')) {
      activeListField = null;
    }

    // Top-level field line: `<key>: <value?>`
    // Only top-level fields (no leading whitespace) are considered.
    const fieldMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (fieldMatch) {
      const key = fieldMatch[1];
      const rest = fieldMatch[2];

      // `id:` field — emit `frontmatter-id` span when expectedNoteId is
      // provided AND the value matches.
      if (
        key === 'id' &&
        options.expectedNoteId !== undefined &&
        rest.length > 0
      ) {
        const { unquoted, offsetWithinValue } = stripQuotes(rest);
        // Locate value position in the line.
        const colonIdx = line.indexOf(':');
        const afterColon = line.slice(colonIdx + 1);
        const valueOffsetInLine =
          colonIdx + 1 + (afterColon.length - afterColon.trimStart().length);
        const valueStart = cursor + valueOffsetInLine + offsetWithinValue;

        if (unquoted === options.expectedNoteId) {
          const span = buildSpanFromCandidate(
            filePath,
            content,
            unquoted,
            valueStart,
            'frontmatter-id',
          );
          if (span) {
            spans.push(span);
          }
        }
      }

      // If this field is a recognized list-field and has no inline
      // value (or inline value is empty/`[]`), open the list state.
      if (listFields.has(key)) {
        if (rest === '' || rest === '[]') {
          activeListField = key;
        } else {
          // Inline list/array form: `derives: [R005.§1.AC.03, R007]`.
          // Match note-ID-shaped tokens inside the brackets.
          const inlineList = rest.match(/^\[(.*)\]$/);
          if (inlineList) {
            const inner = inlineList[1];
            const innerStart =
              cursor + (line.indexOf('[') + 1);
            const itemRe = /[^,\s\[\]]+/g;
            let itemMatch: RegExpExecArray | null;
            while ((itemMatch = itemRe.exec(inner)) !== null) {
              const itemRaw = itemMatch[0];
              const { unquoted, offsetWithinValue } = stripQuotes(itemRaw);
              const itemStart = innerStart + itemMatch.index + offsetWithinValue;

              const span = buildSpanFromCandidate(
                filePath,
                content,
                unquoted,
                itemStart,
                'frontmatter-list',
              );
              if (span) {
                spans.push(span);
              }
            }
          }
        }
      }
    }

    cursor = lineEnd === fmEnd ? fmEnd : lineEnd + 1;
  }

  spans.sort((a, b) => a.byteRange[0] - b.byteRange[0]);
  return spans;
}

/**
 * Locate the byte range of the YAML frontmatter block, or `null` if
 * no frontmatter is present.
 *
 * Frontmatter is the leading `---\n...\n---` block. Returns the range
 * EXCLUDING the surrounding `---` lines.
 */
function locateFrontmatterRange(content: string): [number, number] | null {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return null;
  }
  const openLineEnd = content.indexOf('\n');
  if (openLineEnd === -1) return null;
  const bodyStart = openLineEnd + 1;

  // Find the closing `\n---\n` (or `\n---\r\n`, or `\n---` at EOF).
  const closeMarkerRe = /\n---(?:\r?\n|$)/;
  const match = closeMarkerRe.exec(content.slice(bodyStart));
  if (!match) {
    return null;
  }
  const closeAt = bodyStart + match.index; // position of the `\n` before `---`
  return [bodyStart, closeAt + 1]; // +1 to include trailing newline of last data line
}

/**
 * Strip optional surrounding single or double quotes. Returns the
 * unquoted text plus the byte offset of the unquoted text relative
 * to the original value.
 *
 * `'R005'` → `{ unquoted: 'R005', offsetWithinValue: 1 }`
 * `"R005"` → `{ unquoted: 'R005', offsetWithinValue: 1 }`
 * `R005`   → `{ unquoted: 'R005', offsetWithinValue: 0 }`
 */
function stripQuotes(value: string): {
  unquoted: string;
  offsetWithinValue: number;
} {
  if (
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2) ||
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
  ) {
    return { unquoted: value.slice(1, -1), offsetWithinValue: 1 };
  }
  return { unquoted: value, offsetWithinValue: 0 };
}
