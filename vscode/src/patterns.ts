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
  parseClaimReferences,
  parseNoteMentions,
  type ClaimReference,
} from 'scepter';

export interface ClaimMatch {
  raw: string;
  start: number;
  end: number;
  normalizedId: string;
  kind: 'claim' | 'note' | 'bare-claim' | 'section';
}

// --- Normalization ---

function normalize(id: string): string {
  return id.replace(/§/g, '');
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
      allRefs.push({ ref, addr, start, claimEnd: end, fullEnd: end });
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

      allRefs.push({ ref, addr, start, claimEnd, fullEnd });
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

    const rawId = addr.raw.split(':')[0]; // strip metadata suffix for ID
    matches.push({
      raw: lineText.slice(start, claimEnd),
      start,
      end: claimEnd,
      normalizedId: normalize(rawId),
      kind,
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
