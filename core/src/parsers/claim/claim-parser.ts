/**
 * Claim-level reference parser for SCEpter.
 *
 * Parses hierarchical claim addresses of the form:
 *   NOTE_ID . section_path . CLAIM_PREFIX.number : metadata
 *
 * Supports both braced ({REQ004.3.AC.01}) and braceless references.
 * The § symbol is optional emphasis and does not affect parsing.
 *
 * Range expansion: `AC.01-06` or `AC.01-AC.06` expands into individual
 * references AC.01, AC.02, AC.03, AC.04, AC.05, AC.06. Works with any
 * prefix/qualifier: `R004.§1.AC.01-06`, `{§1.AC.01-AC.06}`, etc.
 *
 * @implements {R004.§1.AC.01} Section ID extraction from headings
 * @implements {R004.§1.AC.03} Fully qualified, partial, and bare claim resolution
 * @implements {R004.§1.AC.06} Forbidden form PREFIX+digits without dot rejected (FORBIDDEN_CLAIM_RE)
 * @implements {R004.§2.AC.01} Bare note IDs recognized when shortcode matches config (buildBracelessPatterns)
 * @implements {R004.§2.AC.02} Braced references always work (bracedRe in parseClaimReferences)
 * @implements {R004.§2.AC.03} § is optional emphasis, parsing identical with/without (normalizeSectionSymbol)
 * @implements {R004.§2.AC.04} Colon-suffix metadata parsing
 * @implements {R004.§2.AC.05} Config flag controls braceless matching (bracelessEnabled in ClaimParseOptions)
 * @implements {R004.§8.AC.03} Metadata parsed from colon-suffix (parseMetadataSuffix)
 */

import { isValidNoteId, parseNoteId } from '../note/shared-note-utils';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ClaimAddress {
  noteId?: string;
  sectionPath?: number[];
  claimPrefix?: string;
  claimNumber?: number;
  claimSubLetter?: string;
  metadata?: string[];
  raw: string;
}

export interface ClaimParseOptions {
  knownShortcodes?: Set<string>;
  bracelessEnabled?: boolean;
  currentDocumentId?: string;
  currentSection?: number[];
}

export interface ClaimReference {
  address: ClaimAddress;
  line: number;
  column: number;
  braced: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pattern for a note ID: 1-5 uppercase letters followed by 3-5 digits */
const NOTE_ID_RE = /^[A-Z]{1,5}\d{3,5}$/;

/**
 * Forbidden form: uppercase letters immediately followed by digits with no dot.
 * This catches things like AC01, SEC03 etc. that should be AC.01, SEC.03.
 * We only flag this when the segment has both letters and digits and no dot.
 */
const FORBIDDEN_CLAIM_RE = /^§?([A-Z]+)(\d{2,3}[a-z]?)$/;

/**
 * Valid claim segment: letter prefix DOT number, optional sub-letter.
 * e.g. AC.01, SEC.03, CORE.12, AC.01a
 */
const CLAIM_SEGMENT_RE = /^§?([A-Z]+)$/;
const CLAIM_NUMBER_RE = /^(\d{2,3})([a-z])?$/;

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Strip the optional § prefix from a segment for canonical comparison.
 */
export function normalizeSectionSymbol(segment: string): string {
  if (segment.startsWith('§')) {
    return segment.slice(1);
  }
  return segment;
}

/**
 * Split a metadata suffix from a reference string.
 *
 * The first colon separates the claim path from metadata. Subsequent
 * colons separate metadata items from each other.
 *
 * Input:  "REQ004.3.AC.01:4:closed"
 * Output: { id: "REQ004.3.AC.01", metadata: ["4", "closed"] }
 *
 * Key-value items use `=` within the item (not a separator):
 * Input:  "AC.01:superseded=R004.§2.AC.07"
 * Output: { id: "AC.01", metadata: ["superseded=R004.§2.AC.07"] }
 *
 * @implements {R005.§2.AC.01} Lifecycle tags parsed from metadata suffix
 * @implements {R005.§2.AC.04a} Colon-separated metadata items (supersedes comma separator)
 * @implements {R005.§2.AC.04b} Relaxed validation regex for key-value metadata
 */
export function parseMetadataSuffix(raw: string): { id: string; metadata: string[] } {
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) {
    return { id: raw, metadata: [] };
  }
  const id = raw.slice(0, colonIdx);
  const metaStr = raw.slice(colonIdx + 1);
  const metadata = metaStr
    .split(':')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^[A-Za-z0-9=_.§-]+$/.test(s));
  return { id, metadata };
}

/**
 * Parse a single claim reference string into its components.
 *
 * Returns null if the string is not a valid claim reference.
 */
export function parseClaimAddress(raw: string, options?: ClaimParseOptions): ClaimAddress | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const trimmed = raw.trim();

  // Split off metadata suffix first
  const { id: refPart, metadata } = parseMetadataSuffix(trimmed);

  if (refPart.length === 0) {
    return null;
  }

  // Split into dot-separated segments, but we need to be careful:
  // A claim like AC.01 has a dot WITHIN it. The strategy is to split on dots
  // and then recombine letter-prefix + number segments into claim IDs.
  const rawSegments = refPart.split('.');

  if (rawSegments.length === 0 || rawSegments.some((s) => s.length === 0)) {
    return null;
  }

  // Check each segment for the forbidden form (letters immediately followed by digits, no dot)
  for (const seg of rawSegments) {
    const norm = normalizeSectionSymbol(seg);
    if (FORBIDDEN_CLAIM_RE.test(norm)) {
      // Exclude valid note IDs (e.g., REQ004) — those are not forbidden forms
      if (!NOTE_ID_RE.test(norm)) {
        return null;
      }
    }
  }

  // Now classify and consume segments left-to-right
  let noteId: string | undefined;
  let sectionPath: number[] | undefined;
  let claimPrefix: string | undefined;
  let claimNumber: number | undefined;
  let claimSubLetter: string | undefined;

  let idx = 0;

  // Try to parse the first segment as a note ID
  const firstNorm = normalizeSectionSymbol(rawSegments[0]);
  if (NOTE_ID_RE.test(firstNorm)) {
    noteId = firstNorm;
    idx = 1;
  }

  // Now consume remaining segments as sections or claim
  while (idx < rawSegments.length) {
    const seg = rawSegments[idx];
    const norm = normalizeSectionSymbol(seg);

    // Is this a purely numeric segment? → section
    if (/^\d+$/.test(norm)) {
      if (!sectionPath) {
        sectionPath = [];
      }
      sectionPath.push(parseInt(norm, 10));
      idx++;
      continue;
    }

    // Is this an uppercase letter segment that could be a claim prefix?
    if (CLAIM_SEGMENT_RE.test(norm)) {
      // Next segment should be the claim number
      if (idx + 1 < rawSegments.length) {
        const nextNorm = normalizeSectionSymbol(rawSegments[idx + 1]);
        const numMatch = nextNorm.match(CLAIM_NUMBER_RE);
        if (numMatch) {
          claimPrefix = norm;
          claimNumber = parseInt(numMatch[1], 10);
          claimSubLetter = numMatch[2] || undefined;
          idx += 2;
          // Claim should be the last component (before metadata)
          break;
        }
      }
      // If no valid number follows, this isn't a valid reference
      return null;
    }

    // Unrecognized segment
    return null;
  }

  // Must have at least one meaningful component
  if (noteId === undefined && sectionPath === undefined && claimPrefix === undefined) {
    return null;
  }

  const address: ClaimAddress = { raw: trimmed };
  if (noteId !== undefined) address.noteId = noteId;
  if (sectionPath !== undefined) address.sectionPath = sectionPath;
  if (claimPrefix !== undefined) address.claimPrefix = claimPrefix;
  if (claimNumber !== undefined) address.claimNumber = claimNumber;
  if (claimSubLetter !== undefined) address.claimSubLetter = claimSubLetter;
  if (metadata.length > 0) address.metadata = metadata;

  return address;
}

/**
 * Parse a range suffix from a claim reference string.
 *
 * Detects patterns like:
 *   "AC.01-06"        → { baseRef: "AC.01", endNumber: 6 }
 *   "AC.01-AC.06"     → { baseRef: "AC.01", endNumber: 6 }
 *   "R004.§1.AC.01-06" → { baseRef: "R004.§1.AC.01", endNumber: 6 }
 *
 * Returns null if the string does not contain a range suffix.
 */
export function parseRangeSuffix(
  raw: string,
): { baseRef: string; endNumber: number } | null {
  // Strip metadata first — ranges come before metadata
  const { id: refPart } = parseMetadataSuffix(raw);

  // Match compact form: PREFIX.NN-MM (e.g., AC.01-06)
  // Match explicit form: PREFIX.NN-PREFIX.MM (e.g., AC.01-AC.06)
  // Also with optional leading path: R004.§1.AC.01-06, §1.AC.01-AC.06
  // The claim number portion is \d{2,3} (2-3 digits).
  //
  // We use two patterns: one for bare claims (no leading path) and one for qualified claims.
  // Bare:      ^(([A-Z]+)\.(\d{2,3}))-(?:(?:\2)\.)?(\d{2,3})$
  // Qualified: ^((.+)\.([A-Z]+)\.(\d{2,3}))-(?:(?:\3)\.)?(\d{2,3})$
  const bareRangeRe = /^(([A-Z]+)\.(\d{2,3}))-(?:(?:\2)\.)?(\d{2,3})$/;
  const bareMatch = refPart.match(bareRangeRe);
  if (bareMatch) {
    return { baseRef: bareMatch[1], endNumber: parseInt(bareMatch[4], 10) };
  }

  const qualifiedRangeRe = /^((.+)\.([A-Z]+)\.(\d{2,3}))-(?:(?:\3)\.)?(\d{2,3})$/;
  const qualifiedMatch = refPart.match(qualifiedRangeRe);
  if (qualifiedMatch) {
    return { baseRef: qualifiedMatch[1], endNumber: parseInt(qualifiedMatch[5], 10) };
  }

  return null;
}

/**
 * Expand a claim address into a range of addresses from its claimNumber to endNumber.
 *
 * Given a base address like { claimPrefix: "AC", claimNumber: 1, ... } and endNumber 6,
 * produces addresses for AC.01, AC.02, AC.03, AC.04, AC.05, AC.06.
 *
 * Returns the array of expanded addresses, or an empty array if the range is invalid
 * (start >= end, or the base address has no claim prefix/number).
 */
export function expandClaimRange(
  baseAddress: ClaimAddress,
  endNumber: number,
): ClaimAddress[] {
  if (
    baseAddress.claimPrefix === undefined ||
    baseAddress.claimNumber === undefined
  ) {
    return [];
  }

  const startNumber = baseAddress.claimNumber;
  if (startNumber >= endNumber) {
    return [];
  }

  // Determine zero-padding width from the original raw reference string.
  // Extract the numeric portion after the last PREFIX. from the raw string to
  // preserve the original formatting (e.g., "001" means pad to 3 digits).
  const claimNumMatch = baseAddress.raw.match(/\.(\d{2,3})[a-z]?$/);
  const originalNumStr = claimNumMatch ? claimNumMatch[1] : String(startNumber).padStart(2, '0');
  const padWidth = Math.max(originalNumStr.length, String(endNumber).length);

  const results: ClaimAddress[] = [];
  for (let n = startNumber; n <= endNumber; n++) {
    const paddedNum = String(n).padStart(padWidth, '0');

    // Reconstruct the raw string for this claim in the range
    const rawParts: string[] = [];
    if (baseAddress.noteId) rawParts.push(baseAddress.noteId);
    if (baseAddress.sectionPath) {
      rawParts.push(...baseAddress.sectionPath.map(String));
    }
    rawParts.push(`${baseAddress.claimPrefix}.${paddedNum}`);
    const raw = rawParts.join('.');

    const addr: ClaimAddress = { raw };
    if (baseAddress.noteId !== undefined) addr.noteId = baseAddress.noteId;
    if (baseAddress.sectionPath !== undefined) addr.sectionPath = [...baseAddress.sectionPath];
    addr.claimPrefix = baseAddress.claimPrefix;
    addr.claimNumber = n;
    // Sub-letters are not supported in ranges — omitted intentionally
    if (baseAddress.metadata !== undefined) addr.metadata = [...baseAddress.metadata];

    results.push(addr);
  }

  return results;
}

/**
 * Try to parse a string as a range reference and expand it into multiple ClaimAddresses.
 *
 * Returns null if the string is not a range, or an array of addresses if it is.
 */
function tryExpandRange(raw: string, options?: ClaimParseOptions): ClaimAddress[] | null {
  const rangeInfo = parseRangeSuffix(raw);
  if (!rangeInfo) {
    return null;
  }

  const baseAddress = parseClaimAddress(rangeInfo.baseRef, options);
  if (!baseAddress) {
    return null;
  }

  const expanded = expandClaimRange(baseAddress, rangeInfo.endNumber);
  return expanded.length > 0 ? expanded : null;
}

/**
 * Scan markdown content for all claim references (braced and braceless).
 *
 * Braced references: {REQ004.3.AC.01}, {§3.AC.01}, etc.
 * Braceless references: REQ004.3.AC.01, §3.AC.01, etc.
 *   - Braceless note-only IDs (e.g. `REQ004`) require knownShortcodes validation.
 *   - Braceless claim paths with dots are structurally distinctive and matched directly.
 *
 * Range references: AC.01-06, AC.01-AC.06, {R004.§1.AC.01-06}, etc.
 *   - Expanded into individual ClaimReference objects for each claim in the range.
 */
export function parseClaimReferences(
  content: string,
  options?: ClaimParseOptions,
): ClaimReference[] {
  const references: ClaimReference[] = [];
  const lines = content.split('\n');
  const knownShortcodes = options?.knownShortcodes;
  const bracelessEnabled = options?.bracelessEnabled ?? true;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // 1. Find braced references: {...}
    const bracedRe = /\{([^}\n]+)\}/g;
    let bracedMatch: RegExpExecArray | null;
    while ((bracedMatch = bracedRe.exec(line)) !== null) {
      const inner = bracedMatch[1].trim();

      // Try range expansion first
      const rangeAddresses = tryExpandRange(inner, options);
      if (rangeAddresses) {
        for (const addr of rangeAddresses) {
          references.push({
            address: addr,
            line: lineIdx + 1,
            column: bracedMatch.index + 1,
            braced: true,
          });
        }
        continue;
      }

      const address = parseClaimAddress(inner, options);
      if (address) {
        references.push({
          address,
          line: lineIdx + 1,
          column: bracedMatch.index + 1,
          braced: true,
        });
      }
    }

    // 2. Find braceless references (if enabled)
    if (bracelessEnabled) {
      // Match patterns that look like claim references.
      // We match:
      //   - Note ID followed by dot-path: REQ004.3.AC.01...
      //   - §-prefixed paths: §3.AC.01, §AC.01
      //   - Bare claim paths with dots: AC.01, 3.AC.01
      //   - Bare note IDs: REQ004 (only if knownShortcodes validates)
      const bracelessPatterns = buildBracelessPatterns(knownShortcodes);
      for (const pattern of bracelessPatterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          const raw = match[0];
          const col = match.index;

          // Skip if this match is inside a braced reference
          if (isInsideBraces(line, col, raw.length)) {
            continue;
          }

          // Skip if preceded by a backtick (code context)
          if (col > 0 && line[col - 1] === '`') {
            continue;
          }
          // Skip if followed by a backtick
          if (col + raw.length < line.length && line[col + raw.length] === '`') {
            continue;
          }

          // Try range expansion first
          const rangeAddresses = tryExpandRange(raw, options);
          if (rangeAddresses) {
            for (const addr of rangeAddresses) {
              // De-duplicate by raw + line (not column) since overlapping
              // braceless patterns can match the same range at different offsets
              const isDup = references.some(
                (r) => r.line === lineIdx + 1 && r.address.raw === addr.raw,
              );
              if (!isDup) {
                references.push({
                  address: addr,
                  line: lineIdx + 1,
                  column: col + 1,
                  braced: false,
                });
              }
            }
            continue;
          }

          const address = parseClaimAddress(raw, options);
          if (address) {
            // For bare note IDs (no section, no claim), require knownShortcodes
            if (
              address.noteId &&
              !address.sectionPath &&
              !address.claimPrefix &&
              knownShortcodes
            ) {
              const parsed = parseNoteId(address.noteId);
              if (!parsed || !knownShortcodes.has(parsed.shortcode)) {
                continue;
              }
            }

            // Avoid duplicate entries at the same location
            const isDuplicate = references.some(
              (r) => r.line === lineIdx + 1 && r.column === col + 1,
            );
            if (!isDuplicate) {
              references.push({
                address,
                line: lineIdx + 1,
                column: col + 1,
                braced: false,
              });
            }
          }
        }
      }
    }
  }

  return references;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if a position in a line falls inside curly braces.
 */
function isInsideBraces(line: string, startCol: number, length: number): boolean {
  // Look for an opening brace before startCol with no closing brace between
  let braceDepth = 0;
  for (let i = 0; i < startCol; i++) {
    if (line[i] === '{') braceDepth++;
    if (line[i] === '}') braceDepth--;
  }
  return braceDepth > 0;
}

/**
 * Build regex patterns for braceless reference matching.
 *
 * We use word-boundary-aware patterns to avoid matching inside other tokens.
 */
function buildBracelessPatterns(knownShortcodes?: Set<string>): RegExp[] {
  const patterns: RegExp[] = [];

  // Optional range suffix: -NN or -PREFIX.NN (compact and explicit forms)
  // e.g., AC.01-06 or AC.01-AC.06
  const rangeSuffix = '(?:-(?:[A-Z]+\\.)?\\d{2,3})?';

  // Pattern for §-prefixed references: §3.AC.01, §AC.01, §3
  // These are distinctive enough to match without note ID validation
  patterns.push(new RegExp(`(?<![A-Za-z0-9.{])§\\d+(?:\\.\\d+)*(?:\\.§?[A-Z]+\\.\\d{2,3}[a-z]?${rangeSuffix})?(?::[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)?(?![A-Za-z0-9}])`, 'g'));

  // Pattern for §PREFIX.NN: §AC.01
  patterns.push(new RegExp(`(?<![A-Za-z0-9.{])§[A-Z]+\\.\\d{2,3}[a-z]?${rangeSuffix}(?::[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)?(?![A-Za-z0-9}])`, 'g'));

  // Pattern for note ID + dot path: REQ004.3.AC.01, REQ004.3, REQ004.AC.01
  // The note ID followed by a dot is distinctive enough
  patterns.push(/(?<![A-Za-z0-9{])[A-Z]{1,5}\d{3,5}\.\S+?(?::[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)?(?=[\s,;)\]}>]|$)/g);

  // Pattern for numeric-prefix claim path: 3.AC.01
  patterns.push(new RegExp(`(?<![A-Za-z0-9.{])\\d+(?:\\.\\d+)*\\.[A-Z]+\\.\\d{2,3}[a-z]?${rangeSuffix}(?::[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)?(?![A-Za-z0-9}])`, 'g'));

  // Pattern for bare claim path: AC.01 (letter prefix dot number)
  patterns.push(new RegExp(`(?<![A-Za-z0-9§.{])[A-Z]+\\.\\d{2,3}[a-z]?${rangeSuffix}(?::[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)?(?![A-Za-z0-9.}])`, 'g'));

  // Pattern for bare note IDs (only if knownShortcodes is provided)
  if (knownShortcodes && knownShortcodes.size > 0) {
    patterns.push(/(?<![A-Za-z0-9.{])[A-Z]{1,5}\d{3,5}(?![A-Za-z0-9.}])/g);
  }

  return patterns;
}
