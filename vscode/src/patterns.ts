/**
 * Claim reference pattern matching for the VSCode extension.
 *
 * @implements {DD012.§DC.13} Core parsers as single source of truth for reference detection
 * @implements {DD012.§DC.14} findAllMatches/matchAtPosition as thin wrappers over core parsers
 *
 * Uses parseClaimReferences from the core library instead of duplicating regex patterns.
 * parseNoteMentions provides a second pass for modifier-bearing braced note references
 * ({D001+ text}, {D001#tag}, {D001: context}) which parseClaimReferences does not handle.
 */

import {
  DELETION_MARKER_RE,
  parseClaimReferences,
  parseDeletionMarker,
  parseNoteMentions,
  type ClaimReference,
  type ClaimAddressParsed,
} from 'scepter';

export interface ClaimMatch {
  raw: string;
  start: number;
  end: number;
  normalizedId: string;
  kind: 'claim' | 'note' | 'bare-claim' | 'section';
  /**
   * Cross-project alias prefix when the underlying claim address
   * begins with `<alias>/`. Downstream providers (hover, definition,
   * decoration, diagnostics) branch on this to route to the peer
   * resolver instead of the local index.
   *
   * @implements {R011.§4.AC.01} alias prefix preserved on ClaimMatch
   */
  aliasPrefix?: string;
  /**
   * When the source token expanded to multiple claims (range syntax
   * like `{AC.01-06}`), the normalized FQIDs for ALL expanded members
   * in source order. `normalizedId` equals `rangeMembers[0]` for
   * compatibility with single-claim consumers; range-aware consumers
   * (hover, preview tooltip) iterate `rangeMembers` to render each
   * claim in the bundle.
   *
   * @implements {R012.§5.AC.01} single match per range token; rangeMembers carries every expanded FQID
   */
  rangeMembers?: string[];
  /**
   * True when the underlying claim address has no explicit note id
   * prefix (e.g. `§5.AC.04`, `2.AC.02`, `AC.04`, `§3`). Self-scoped
   * refs MUST resolve within the current document only — index
   * consumers must not fall back to global suffix search, since that
   * would incorrectly target claims in unrelated notes that happen to
   * share the same section/claim id. False for explicit refs
   * (`R044.§5.AC.04`) and cross-project refs (`vendor-lib/R005.§1.AC.01`).
   */
  selfScoped: boolean;
}

/**
 * Deletion-marker match in a single line of text.
 *
 * Markers (per R015 §2.AC.01 / DD020 §1) take the form
 * `_deleted_<NOTE_ID>_at_<TIMESTAMP>` and are parser-invisible —
 * `parseClaimReferences` does NOT recognize them because the marker's
 * leading underscore fails the note-ID validator. The editor surfaces
 * scan for them separately so hover, definition, decoration, and
 * diagnostic providers can present the tombstoned-reference lifecycle
 * state rather than treating it as a broken reference.
 *
 * The match's `originalId` and `timestamp` are recovered from the marker
 * via `parseDeletionMarker`. The `tail` field captures any address suffix
 * after the marker token (e.g. `.§1.AC.03` in
 * `_deleted_R005_at_20260519.§1.AC.03`), so consumers that want the
 * full original-claim address can reconstruct it as
 * `${originalId}${tail}`.
 *
 * @implements {R015.§11.AC.01} extension recognizes deletion markers
 * @implements {R015.§11.AC.02} extension surfaces deletion provenance
 * @implements {DD020.§6.DC.01} marker recognition for diagnostic short-circuit
 * @implements {DD020.§6.DC.02} marker recognition for hover provenance
 * @implements {DD020.§6.DC.04} marker recognition for decoration styling
 */
export interface DeletionMarkerMatch {
  /** The matched marker token in source order (including any address tail). */
  raw: string;
  /** 0-based column offset of the marker's first character. */
  start: number;
  /** 0-based column offset one past the marker's last character (inclusive of tail). */
  end: number;
  /** The original note ID recovered from the marker (capture group 1). */
  originalId: string;
  /** The compact-numeric deletion timestamp recovered from the marker (capture group 2). */
  timestamp: string;
  /** The address suffix after the marker token, if any (e.g. `.§1.AC.03`). Empty string when absent. */
  tail: string;
}

/**
 * Find every deletion marker in a line of text.
 *
 * Scans `lineText` for `DELETION_MARKER_RE` and returns each match as a
 * `DeletionMarkerMatch`. The address suffix after the marker (claim
 * address tail like `.§1.AC.03`) is included in `tail` and `end` so
 * downstream providers can range over the entire tombstoned reference
 * rather than only the marker token.
 *
 * The function is non-overlapping: markers cannot be nested.
 *
 * @implements {DD020.§1.DC.04} sole consumer-side use of DELETION_MARKER_RE in the extension
 */
export function findDeletionMarkers(lineText: string): DeletionMarkerMatch[] {
  const matches: DeletionMarkerMatch[] = [];
  // Use a global flag locally so we can iterate every match without
  // mutating the shared canonical regex's lastIndex state.
  const re = new RegExp(DELETION_MARKER_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineText)) !== null) {
    const start = m.index;
    const markerEnd = start + m[0].length;
    // Capture the trailing claim-address suffix (e.g. ".§1.AC.03") that
    // follows the marker without whitespace. The tail is bounded by the
    // first whitespace, brace, comma, or closing bracket character.
    let tailEnd = markerEnd;
    while (tailEnd < lineText.length) {
      const ch = lineText[tailEnd];
      if (ch === ' ' || ch === '\t' || ch === '}' || ch === ',' || ch === ']' || ch === ')' || ch === '"' || ch === "'" || ch === '`') {
        break;
      }
      tailEnd++;
    }
    const tail = lineText.slice(markerEnd, tailEnd);
    matches.push({
      raw: lineText.slice(start, tailEnd),
      start,
      end: tailEnd,
      originalId: m[1],
      timestamp: m[2],
      tail,
    });
  }
  return matches;
}

/**
 * Return the deletion marker at a given character position, or null.
 *
 * Used by hover and go-to-definition providers to detect when the cursor
 * is over a tombstoned reference.
 *
 * @implements {DD020.§6.DC.02} hover detects tombstoned references at cursor position
 * @implements {DD020.§6.DC.03} definition provider detects tombstoned references at cursor position
 */
export function deletionMarkerAtPosition(
  lineText: string,
  charOffset: number,
): DeletionMarkerMatch | null {
  for (const m of findDeletionMarkers(lineText)) {
    if (charOffset >= m.start && charOffset <= m.end) {
      return m;
    }
  }
  return null;
}

/**
 * Re-export `parseDeletionMarker` for the VS Code surface so providers
 * can recover provenance from raw tokens without taking an indirect
 * import path through scepter.
 */
export { parseDeletionMarker };

// --- Normalization ---

/**
 * Compute the normalized fully-qualified id from a parsed address.
 *
 * Reads `address` fields (noteId, sectionPath, claimPrefix, claimNumber,
 * claimSubLetter) directly rather than re-parsing `address.raw` — this
 * is what lets adjacent-section binding take effect downstream. For
 * `E032 §5.2`, the parser sets `noteId='E032'` on the section ref's
 * address while leaving raw as `'§5.2'`; deriving from raw alone would
 * lose the binding.
 *
 * Alias prefix is intentionally NOT included — consumers carry it on
 * the parent ClaimMatch and route cross-project lookups separately.
 *
 * @implements {R012.§6.AC.05} downstream consumers derive FQID from address fields, not raw
 */
function buildNormalizedId(addr: ClaimAddressParsed): string {
  const parts: string[] = [];
  if (addr.noteId) parts.push(addr.noteId);
  if (addr.sectionPath && addr.sectionPath.length > 0) {
    parts.push(addr.sectionPath.join('.'));
  }
  if (addr.claimPrefix && addr.claimNumber !== undefined) {
    const num = String(addr.claimNumber).padStart(2, '0');
    const sub = addr.claimSubLetter ?? '';
    parts.push(`${addr.claimPrefix}.${num}${sub}`);
  }
  return parts.join('.');
}

// --- Matching functions ---

/**
 * Find ALL SCEpter references in a line of text.
 *
 * @param isMarkdown  Enables braceless matching (bare claims, bare notes, section refs).
 * @param knownShortcodes  Set of valid note type shortcodes for bare note ID filtering.
 */
export function findAllMatches(
  lineText: string,
  isMarkdown = false,
  knownShortcodes?: Set<string>,
): ClaimMatch[] {
  // First pass: claim references via core parser
  const refs = parseClaimReferences(lineText, {
    knownShortcodes,
    bracelessEnabled: isMarkdown,
  });

  // Group by column to merge range expansions.
  // {R004.§1.AC.01-06} produces 6 refs at the same column — we want one span.
  // @implements {R012.§5.AC.02} range match returned as single span (decoration providers see one match, not N adjacent)
  // @implements {R012.§5.AC.05} works for braced AND braceless ranges (bracelessEnabled=isMarkdown)
  const grouped = new Map<number, ClaimReference[]>();
  for (const ref of refs) {
    const key = ref.column;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ref);
  }

  const matches: ClaimMatch[] = [];
  const covered = new Set<number>();

  // Process refs into matches. The core parser may split an annotation like
  // "§DC.01:derives=R053.§2.AC.05" into multiple refs:
  //   1. "§DC.01:derives" (claim with metadata)
  //   2. "R053.§2.AC.05" (the derivation target after =)
  //   3. "2.AC.05" (false sub-match within #2)
  //
  // We want: §DC.01 as link → :derives= as plain text → R053.§2.AC.05 as link
  // And #3 suppressed because it's within #2's span.

  // Collect all refs with their positions
  const allRefs: Array<{
    ref: ClaimReference;
    addr: (typeof refs)[0]['address'];
    /** Sibling refs at the same column from a range expansion. Length 1
     *  for non-range refs; >1 means {AC.01-06} or similar. */
    group: ClaimReference[];
    start: number;
    claimEnd: number;   // end of just the claim ID part (before metadata)
    fullEnd: number;    // end including metadata suffix
  }> = [];

  for (const [, group] of grouped) {
    const ref = group[0];
    const addr = ref.address;
    const start = ref.column - 1; // 0-based

    if (ref.braced) {
      const braceEnd = lineText.indexOf('}', start) + 1;
      const end = braceEnd > 0 ? braceEnd : start + addr.raw.length + 2;
      allRefs.push({ ref, addr, group, start, claimEnd: end, fullEnd: end });
    } else {
      // claimEnd: just the claim ID (before any : metadata)
      const colonIdx = addr.raw.indexOf(':');
      const claimPart = colonIdx >= 0 ? addr.raw.slice(0, colonIdx) : addr.raw;
      const claimEnd = start + claimPart.length;

      // fullEnd: scan past metadata suffixes (:tag, :key=value) to find the full extent
      let fullEnd = start + addr.raw.length;
      // If the raw already includes metadata (like "§DC.01:derives"), check for =value after
      if (fullEnd < lineText.length && lineText[fullEnd] === '=') {
        fullEnd++; // skip =
        // The value after = is another ref that the core parser will handle separately
        // Just cover the = sign so it renders as plain text
      }

      allRefs.push({ ref, addr, group, start, claimEnd, fullEnd });
    }
  }

  // Sort by start position
  allRefs.sort((a, b) => a.start - b.start);

  // Suppress refs that are fully contained within another ref's full extent.
  // But DON'T suppress refs that start right after an = sign (those are derivation targets).
  for (let i = 0; i < allRefs.length; i++) {
    const outer = allRefs[i];
    for (let j = i + 1; j < allRefs.length; j++) {
      const inner = allRefs[j];
      if (inner.start >= outer.fullEnd) break; // past outer's range

      // Check if inner starts right after = (it's a derivation target, keep it)
      const charBefore = inner.start > 0 ? lineText[inner.start - 1] : '';
      if (charBefore === '=') continue; // keep — it's a target

      // It's a true sub-match (like 2.AC.05 within R053.§2.AC.05), suppress
      inner.start = -1; // mark as suppressed
    }
  }

  for (const rg of allRefs) {
    if (rg.start < 0) continue; // suppressed

    // Check overlap with already-covered positions
    let overlap = false;
    for (let i = rg.start; i < rg.claimEnd; i++) {
      if (covered.has(i)) { overlap = true; break; }
    }
    if (overlap) continue;

    const { addr, start, claimEnd, fullEnd } = rg;

    // Kind classification.
    // Order matters: a section path with a note id is a section reference,
    // not a note reference, even though noteId is set. Without this branch,
    // {R005.§1} would resolve as note "R005.1" (not in index) and render as
    // unknown despite the section being well-defined.
    let kind: ClaimMatch['kind'];
    if (addr.claimPrefix && (addr.noteId || addr.sectionPath?.length)) {
      kind = 'claim';
    } else if (addr.claimPrefix) {
      kind = 'bare-claim';
    } else if (addr.sectionPath?.length) {
      kind = 'section';
    } else if (addr.noteId) {
      kind = 'note';
    } else {
      kind = 'claim';
    }

    const rangeMembers = rg.group.length > 1
      ? rg.group.map((r) => buildNormalizedId(r.address))
      : undefined;

    matches.push({
      raw: lineText.slice(start, claimEnd),
      start,
      end: claimEnd,
      normalizedId: buildNormalizedId(addr),
      kind,
      selfScoped: !addr.noteId && !addr.aliasPrefix,
      ...(addr.aliasPrefix ? { aliasPrefix: addr.aliasPrefix } : {}),
      ...(rangeMembers ? { rangeMembers } : {}),
    });

    // Cover the claim span AND the metadata suffix (so :derives= renders as plain text)
    for (let i = start; i < fullEnd; i++) covered.add(i);
  }

  // Second pass: note references with modifiers that parseClaimReferences misses.
  // parseClaimAddress rejects {D001+ text}, {D001#tag}, {D001: context}, {R001>}
  // because +, #, :, > are not valid claim address segments.
  // parseNoteMentions handles these braced note references.
  const noteMentions = parseNoteMentions(lineText, {});
  for (const mention of noteMentions) {
    const searchStr = '{' + mention.id;
    const idx = lineText.indexOf(searchStr);
    if (idx < 0) continue;

    // Find the closing brace
    let braceEnd = idx + mention.id.length + 1;
    while (braceEnd < lineText.length && lineText[braceEnd] !== '}') braceEnd++;
    if (braceEnd < lineText.length) braceEnd++;

    // Check overlap with positions already covered by parseClaimReferences
    let overlap = false;
    for (let i = idx; i < braceEnd; i++) {
      if (covered.has(i)) { overlap = true; break; }
    }
    if (overlap) continue;

    for (let i = idx; i < braceEnd; i++) covered.add(i);

    matches.push({
      raw: lineText.slice(idx, braceEnd),
      start: idx,
      end: braceEnd,
      normalizedId: mention.id,
      kind: 'note',
      selfScoped: false,
    });
  }

  return matches;
}

/**
 * Return the match at a given character position.
 * Always checks all patterns (including markdown-only) for hover/goto.
 */
export function matchAtPosition(
  lineText: string,
  charOffset: number,
  knownShortcodes?: Set<string>,
): ClaimMatch | null {
  const matches = findAllMatches(lineText, true, knownShortcodes);
  for (const match of matches) {
    if (charOffset >= match.start && charOffset <= match.end) {
      return match;
    }
  }
  return null;
}

/**
 * Extract the note ID from a file path.
 * e.g. "DD001 ARCH017 Blob Migration.md" → "DD001"
 */
export function noteIdFromPath(filePath: string): string | null {
  const basename = filePath.split('/').pop() ?? '';
  const match = basename.match(/^([A-Z]{1,5}\d{3,5})\b/);
  return match ? match[1] : null;
}

/**
 * Parse a normalized claim ID (e.g. `R005.1.AC.01`) into address
 * components for `claimIndex.resolveCrossProject`. Single source of
 * truth — previously copy-pasted across hover-provider, definition-provider,
 * and extension.ts. Returns null when the string doesn't begin with a
 * recognizable note ID.
 */
export function parseNormalizedAddress(
  normalized: string,
): { noteId: string; sectionPath?: number[]; claimPrefix?: string; claimNumber?: number } | null {
  const parts = normalized.split('.');
  if (parts.length === 0) return null;
  if (!/^[A-Z]{1,5}\d{3,5}$/.test(parts[0])) return null;
  const noteId = parts[0];
  if (parts.length === 1) return { noteId };

  // Trailing claim portion is `<PREFIX>.<NN>` — find the last
  // all-uppercase-letters segment that's followed by a digits segment.
  const sectionParts: number[] = [];
  let i = 1;
  for (; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i])) {
      sectionParts.push(parseInt(parts[i], 10));
    } else {
      break;
    }
  }
  if (i < parts.length - 1 && /^[A-Z]+$/.test(parts[i]) && /^\d{2,3}[a-z]?$/.test(parts[i + 1])) {
    const claimNumMatch = parts[i + 1].match(/^(\d{2,3})([a-z])?$/)!;
    return {
      noteId,
      sectionPath: sectionParts.length > 0 ? sectionParts : undefined,
      claimPrefix: parts[i],
      claimNumber: parseInt(claimNumMatch[1], 10),
    };
  }
  return {
    noteId,
    sectionPath: sectionParts.length > 0 ? sectionParts : undefined,
  };
}
