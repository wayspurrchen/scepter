/**
 * Markdown-body scanner adapter for the rewriter engine.
 *
 * Emits a `ReferenceSpan` for every braced reference and every
 * braceless reference that the SCEpter claim parser would recognize
 * in markdown prose. Byte offsets are computed against the raw file
 * content so the substituter can rewrite only the note-ID portion.
 *
 * Reference forms covered (per {DD020.§2.DC.03}):
 *
 *   - Note-level braced: `{R005}`
 *   - Claim-level fully qualified: `{R005.§1.AC.03}`
 *   - Claim-level without section: `{R005.OQ.01}`
 *   - Compact-multi: `{R005.§1.AC.01,.AC.03,.AC.05}`
 *   - Range: `{R005.§1.AC.01-05}`, `{R005.§1.AC.01-AC.05}`
 *   - Cross-project alias: `{vendor-lib/R005.§1.AC.03}` (parsed; the
 *     predicate decides to skip)
 *   - Braceless note-ID-led: `R005.§1.AC.03` (matched only when
 *     `knownShortcodes` includes the shortcode)
 *
 * Decoration transparency per {DD020.§2.DC.06}: the scanner inherits
 * the parser's behavior on code spans and code fences — it does NOT
 * actively strip decorations. Surrounding decoration is preserved
 * verbatim by the substituter because the `byteRange` is exact.
 *
 * @implements {DD020.§2.DC.03} markdown-body scanner emits spans for every recognized reference form
 * @implements {DD020.§2.DC.06} decoration-transparency: scanner does not modify surrounding text
 * @implements {DD020.§2.DC.18} scanner runs against any markdown file the orchestrator hands it (incl. project docs)
 */

import {
  parseClaimAddress,
  type ClaimAddress,
} from '../../parsers/claim/claim-parser';
import type { ReferenceSpan, ScannerAdapter } from '../rewriter';

/**
 * Optional context for the scanner.
 *
 * `knownShortcodes` enables braceless note-ID matching (e.g., `R005`,
 * `S012`). When unset, only references inside braces and qualified
 * claim references (with sections or claim prefixes) are recognized
 * as note-ID-bearing.
 */
export interface MarkdownScannerOptions {
  knownShortcodes?: Set<string>;
}

/**
 * Build a scanner adapter closure with the given options.
 *
 * Returned signature matches `ScannerAdapter` so the closure can be
 * dropped into `planRewrite`'s scanner list.
 */
export function createMarkdownBodyScanner(
  options: MarkdownScannerOptions = {},
): ScannerAdapter {
  return (filePath, content) => scanMarkdownBody(filePath, content, options);
}

/**
 * Scan a markdown body for references.
 *
 * Pure function: no filesystem I/O, no parser state mutation.
 */
export function scanMarkdownBody(
  filePath: string,
  content: string,
  options: MarkdownScannerOptions = {},
): ReferenceSpan[] {
  const spans: ReferenceSpan[] = [];

  // ---- 1. Braced references --------------------------------------------
  //
  // Pattern: `{<inner>}` where <inner> may include alias prefix,
  // note ID, section path, claim suffix, range, compact-multi, and
  // metadata. We deliberately allow any non-`}` non-newline chars
  // inside; structural validation happens in `parseClaimAddress`.
  const bracedRe = /\{([^}\n]+)\}/g;
  let bracedMatch: RegExpExecArray | null;
  while ((bracedMatch = bracedRe.exec(content)) !== null) {
    const inner = bracedMatch[1];
    const innerStart = bracedMatch.index + 1; // after the `{`
    const innerEnd = innerStart + inner.length; // before the `}`

    // For braced refs we trim leading/trailing whitespace; the
    // substituter still slices the trimmed range when computing
    // `noteIdRange`.
    const trimmedStartOffset = inner.length - inner.trimStart().length;
    const trimmedRefStart = innerStart + trimmedStartOffset;
    const trimmedInner = inner.trim();

    const span = buildSpanFromCandidate(
      filePath,
      content,
      trimmedInner,
      trimmedRefStart,
      'markdown-body',
    );
    if (span) {
      spans.push(span);
    }
  }

  // ---- 2. Braceless references (note-ID-led) ---------------------------
  //
  // Only matched when `knownShortcodes` is set. We focus on the most
  // common braceless form: `<NOTE_ID>.<rest>` (note ID immediately
  // followed by a dot path). Bare note-ID-only braceless mentions are
  // also supported when the shortcode is known.
  //
  // We intentionally avoid the §-prefixed and bare-claim-path
  // braceless patterns the upstream parser supports — those have
  // `noteId: undefined` and are rewriter no-ops anyway.
  if (options.knownShortcodes && options.knownShortcodes.size > 0) {
    // Pattern: NOTE_ID followed by a `.` and more path content.
    // Negative lookbehind/lookahead mirrors the parser's word-boundary
    // discipline. Excluding `{` from the lookbehind ensures we don't
    // double-count refs already matched by the braced loop.
    const bracelessRe =
      /(?<![A-Za-z0-9{])([A-Z]{1,5}\d{3,5})(\.\S+?)(?=[\s,;)\]}>]|$)/g;
    let bracelessMatch: RegExpExecArray | null;
    while ((bracelessMatch = bracelessRe.exec(content)) !== null) {
      const noteIdToken = bracelessMatch[1];
      const candidate = noteIdToken + bracelessMatch[2];
      const candidateStart = bracelessMatch.index;

      // Filter by shortcode — drop matches whose shortcode is not in
      // the known set.
      const sc = noteIdToken.match(/^([A-Z]+)/)?.[1];
      if (!sc || !options.knownShortcodes.has(sc)) {
        continue;
      }

      // Defensive: skip if the candidate is inside braces (the braced
      // loop already handled it). We probe two chars back for `{`.
      if (isInsideBraces(content, candidateStart)) {
        continue;
      }

      const span = buildSpanFromCandidate(
        filePath,
        content,
        candidate,
        candidateStart,
        'markdown-body',
      );
      if (span) {
        spans.push(span);
      }
    }

    // Pattern: bare NOTE_ID with no trailing path. Only matched if
    // the shortcode is known. Excluded from braced and braceless-with-path.
    const bareIdRe = /(?<![A-Za-z0-9.{])([A-Z]{1,5}\d{3,5})(?![A-Za-z0-9.}])/g;
    let bareMatch: RegExpExecArray | null;
    while ((bareMatch = bareIdRe.exec(content)) !== null) {
      const noteId = bareMatch[1];
      const noteIdStart = bareMatch.index;

      // Filter: shortcode known?
      const sc = noteId.match(/^([A-Z]{1,5})/)?.[1];
      if (!sc || !options.knownShortcodes.has(sc)) {
        continue;
      }

      // Skip if inside braces.
      if (isInsideBraces(content, noteIdStart)) {
        continue;
      }

      const span = buildSpanFromCandidate(
        filePath,
        content,
        noteId,
        noteIdStart,
        'markdown-body',
      );
      if (span) {
        spans.push(span);
      }
    }
  }

  // Deterministic ordering by start offset.
  spans.sort((a, b) => a.byteRange[0] - b.byteRange[0]);

  return spans;
}

/**
 * Construct a `ReferenceSpan` from a candidate reference text plus its
 * byte position. Returns `null` when no note-ID portion can be
 * identified (within-doc bare-section refs are not rewritten, so the
 * scanner does not emit a span for them — the predicate would noop
 * them anyway, and skipping them here keeps the plan smaller).
 *
 * When `parseClaimAddress` returns a structured address, that address
 * is used. When `parseClaimAddress` returns null but the candidate
 * leads with a recognizable note ID (e.g., compact-multi
 * `R005.§1.AC.01,.AC.03,.AC.05` which the parser does not split into
 * a single address), the function constructs a minimal `ClaimAddress`
 * with `noteId` and any alias prefix, so the rewriter can still
 * substitute the note-ID portion of the reference.
 *
 * Exported for reuse by other markdown-shaped scanners
 * (claim-metadata, frontmatter list entries).
 */
export function buildSpanFromCandidate(
  filePath: string,
  content: string,
  candidate: string,
  candidateStart: number,
  surface: ReferenceSpan['surface'],
): ReferenceSpan | null {
  let address = parseClaimAddress(candidate);
  if (!address) {
    // Fallback: the parser does not split compact-multi forms
    // (`R005.§1.AC.01,.AC.03,.AC.05`) into a single address. We can
    // still emit a span if the candidate begins with a recognizable
    // note-ID token (with or without an alias prefix), since the
    // substituter only needs to rewrite the note-ID byte range.
    address = extractLeadingNoteIdAsAddress(candidate);
    if (!address) {
      return null;
    }
  }
  // Bare-section refs (no note ID, no alias prefix) cannot be
  // rewritten — drop. (Within-document references that resolve via
  // currentDocumentId; predicate would noop.)
  if (address.noteId === undefined && address.aliasPrefix === undefined) {
    return null;
  }

  const noteIdRange = locateNoteIdRange(candidate, candidateStart, address);
  if (!noteIdRange) {
    return null;
  }

  return {
    filePath,
    surface,
    byteRange: [candidateStart, candidateStart + candidate.length],
    noteIdRange,
    originalText: candidate,
    parsedAddress: address,
  };
}

/**
 * Last-resort note-ID extraction for reference forms the full
 * `parseClaimAddress` declines (most importantly compact-multi like
 * `R005.§1.AC.01,.AC.03,.AC.05`). Returns a minimal `ClaimAddress`
 * with `noteId` and `aliasPrefix` set (no further structure), or
 * `null` when no note-ID token can be identified at the candidate's
 * start.
 */
function extractLeadingNoteIdAsAddress(candidate: string): ClaimAddress | null {
  // Strip optional alias prefix.
  const aliasMatch = candidate.match(/^([a-z][a-z0-9-]*[a-z0-9])\/(.*)$/);
  let aliasPrefix: string | undefined;
  let remainder = candidate;
  if (aliasMatch) {
    aliasPrefix = aliasMatch[1];
    remainder = aliasMatch[2];
  }
  // Note ID must be the leading token (followed by `.` or end-of-string).
  const idMatch = remainder.match(/^([A-Z]{1,5}\d{3,5})(?:\.|$)/);
  if (!idMatch) {
    return null;
  }
  const result: ClaimAddress = {
    raw: candidate,
    noteId: idMatch[1],
  };
  if (aliasPrefix !== undefined) {
    result.aliasPrefix = aliasPrefix;
  }
  return result;
}

/**
 * Locate the byte range inside `candidate` that holds the note-ID
 * portion.
 *
 * For a candidate like `R005.§1.AC.03` starting at offset 100, the
 * note-ID range is `[100, 104]` (covers `R005`). For `vendor-lib/R005...`,
 * the range starts after the alias prefix and the `/`.
 *
 * For a candidate that is exactly a bare note ID (`R005`), the range
 * spans the whole candidate.
 *
 * Returns `null` when no note-ID portion can be located. (Alias-only,
 * bare-section, malformed.)
 */
export function locateNoteIdRange(
  candidate: string,
  candidateStart: number,
  address: ClaimAddress,
): [number, number] | null {
  if (address.noteId === undefined) {
    return null;
  }

  // Find the note ID in the candidate. For alias-prefixed refs, the
  // note ID appears after `<alias>/`. For unprefixed, it's at the
  // start.
  let searchOffset = 0;
  if (address.aliasPrefix !== undefined) {
    const aliasMarker = `${address.aliasPrefix}/`;
    const aliasIdx = candidate.indexOf(aliasMarker);
    if (aliasIdx === -1) {
      return null;
    }
    searchOffset = aliasIdx + aliasMarker.length;
  }

  // After the alias prefix (if any), the note ID should be the next
  // token. We anchor at the start because the parser stripped any
  // leading whitespace from the candidate.
  const remainingCandidate = candidate.slice(searchOffset);
  if (!remainingCandidate.startsWith(address.noteId)) {
    // Defensive: parser is the source of truth, but if for any
    // reason the canonicalized note ID doesn't match the substring,
    // give up rather than emit a wrong span.
    return null;
  }

  const noteIdStart = candidateStart + searchOffset;
  const noteIdEnd = noteIdStart + address.noteId.length;
  return [noteIdStart, noteIdEnd];
}

/**
 * Check whether `pos` falls inside `{...}` braces.
 *
 * A scan-left lookup counts unclosed `{` up to `pos`. Cheap because
 * call sites are O(spans).
 */
function isInsideBraces(content: string, pos: number): boolean {
  let depth = 0;
  for (let i = 0; i < pos; i++) {
    const ch = content[i];
    if (ch === '\n') {
      depth = 0; // braces don't span newlines in our scanner
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && depth > 0) depth--;
  }
  return depth > 0;
}
