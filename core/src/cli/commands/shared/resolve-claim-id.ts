/**
 * Normalize-then-resolve wrapper for user-typed claim addresses.
 *
 * Post-{DD021.§10.DC.10} migration: this file is a thin wrapper around the
 * shared resolver at `core/src/claims/reference-resolver.ts`. The ad-hoc
 * suffix-matching logic that previously lived here is REMOVED — equivalent
 * behavior is provided by the resolver's section-less rule ({DD021.§10.DC.03}).
 * The section-only branch (e.g., `show DD007.1` -> all claims in §1 of DD007)
 * is PRESERVED at this layer per the (β) interpretation of DC.10 disposed by
 * team-lead 2026-05-21: DC.10's "equivalent behavior is provided by §10.DC.03"
 * is factually wrong for section-only inputs because DC.03 is single-outcome
 * by construction (cannot return many-entries). The section-only branch IS
 * conceptually a browse feature, not a claim-resolution operation, and lives
 * naturally at this wrapper layer.
 *
 * Normalization (`$` → `§`, `§` stripping, zero-padding) is preserved verbatim
 * per {DD008.§1.DC.01} / {DD008.§1.DC.02}.
 *
 * @implements {DD008.§1.DC.01} normalization preserved verbatim
 * @implements {DD008.§1.DC.02} zero-padding preserved verbatim
 * @implements {DD021.§10.DC.10} normalize-then-resolve with section-only preserved per (β)
 */

import chalk from 'chalk';
import type { ClaimIndexData, ClaimIndexEntry } from '../../../claims/index.js';
import { parseNoteId } from '../../../parsers/note/shared-note-utils.js';
import { resolveReference } from '../../../claims/reference-resolver.js';

export interface ResolveResult {
  matches: ClaimIndexEntry[];
  normalized: string;
}

/**
 * Normalize and resolve a user-provided string to zero or more claim index entries.
 *
 * Steps (post-{DD021.§10.DC.10}):
 *
 * 1. Normalize (`$` → `§`, `§` stripping, zero-padding) per {DD008.§1.DC.01-.02}.
 * 2. Section-only short-circuit: if input is `NOTEID.SECTION` (e.g., `DD007.1`),
 *    return all claims under that section. This is a BROWSE query, not a claim
 *    resolution — preserved at the wrapper layer per the (β) interpretation of
 *    {DD021.§10.DC.10}.
 * 3. Delegate to `resolveReference()` for single-claim resolution. Map outcomes:
 *    - `resolved` → `{ matches: [outcome.entry], normalized }`
 *    - `ambiguous` → `{ matches: [...candidate entries], normalized }`
 *    - `unresolved` → `{ matches: [], normalized }`
 *
 * @implements {DD021.§10.DC.10} normalize-then-resolve wrapper per (β) disposition
 * @implements {DD008.§1.DC.01}
 * @implements {DD008.§1.DC.02}
 */
export function resolveClaimInput(input: string, data: ClaimIndexData): ResolveResult {
  // Normalization (preserved verbatim).
  let normalized = input.replace(/\$/g, '§');
  normalized = normalized.replace(/§/g, '');
  normalized = zeroPad(normalized, data);
  normalized = stripSectionZeroPadding(normalized);

  // Section-only short-circuit. If input is NOTEID.SECTION (e.g., DD007.1 or
  // DD007.3.1), return all claims under that section. This is a browse query,
  // NOT a claim resolution, so it does not flow through resolveReference().
  // Per the (β) interpretation of DC.10: DC.03 cannot model section-browse's
  // many-entries return; this branch stays at the wrapper layer.
  const sectionMatch = isSectionReference(normalized);
  if (sectionMatch) {
    const { noteId, sectionPath } = sectionMatch;
    const prefix = noteId + '.' + sectionPath + '.';
    const matches: ClaimIndexEntry[] = [];
    for (const [key, entry] of data.entries) {
      if (key.startsWith(prefix)) {
        matches.push(entry);
      }
    }
    if (matches.length > 0) {
      matches.sort((a, b) => a.fullyQualified.localeCompare(b.fullyQualified));
      return { matches, normalized };
    }
    // Section-only with no matches falls through to resolver (degenerate case;
    // resolver will return `unresolved` and we map to empty matches).
  }

  // Delegate single-claim resolution to the shared resolver per DC.10 + DC.03.
  // includeArchived: true per §4 per-consumer defaults — user-facing lookup
  // MUST see archived (the user typed the ID; they get the entry).
  // @implements {DD021.§10.DC.08} resolution flows through shared resolver
  const outcome = resolveReference(normalized, data, {
    currentNoteId: undefined,
    derivesPosition: false,
    includeArchived: true,
  });

  if (outcome.kind === 'resolved') {
    return { matches: [outcome.entry], normalized };
  }
  if (outcome.kind === 'ambiguous') {
    // Map candidate FQIDs to ClaimIndexEntry[] for the consumer (show command,
    // dependents command, etc.) to render. The candidates already include
    // entries that pass the includeArchived filter (resolver applies it
    // internally during the section-less enumeration).
    const matches: ClaimIndexEntry[] = [];
    for (const fqid of outcome.candidates) {
      const entry = data.entries.get(fqid);
      if (entry) matches.push(entry);
    }
    matches.sort((a, b) => a.fullyQualified.localeCompare(b.fullyQualified));
    return { matches, normalized };
  }

  // unresolved: empty matches. The consumer (resolveSingleClaim below) renders
  // a "Claim not found" diagnostic with suggestions.
  return { matches: [], normalized };
}

/**
 * Resolve a user-typed claim ID to a single index entry, printing a
 * uniform user-facing diagnostic on no-match or ambiguous-match.
 *
 * - Single match → returns the entry.
 * - Zero matches → prints "Claim not found" with up-to-5 suffix-fuzzy
 *   suggestions, returns null.
 * - Multiple matches (e.g., section reference like `R009.1`) → prints
 *   "Ambiguous" with the candidate list, returns null.
 *
 * Use this in commands that operate on a specific claim. Commands that
 * accept section references (and want to act on every claim under a
 * section) should call `resolveClaimInput` directly and handle the
 * full match array themselves.
 *
 * @implements {DD008.§1.DC.04} Single-match path
 * @implements {DD008.§1.DC.05} Ambiguous-match disambiguation
 * @implements {DD008.§1.DC.06} Zero-match fuzzy suggestions
 */
export function resolveSingleClaim(
  input: string,
  data: ClaimIndexData,
): ClaimIndexEntry | null {
  const result = resolveClaimInput(input, data);

  if (result.matches.length === 1) {
    return result.matches[0];
  }

  if (result.matches.length > 1) {
    console.log(
      chalk.yellow(
        `Ambiguous claim address "${input}" matches ${result.matches.length} claims:`,
      ),
    );
    console.log('');
    for (const entry of result.matches.slice(0, 10)) {
      const heading = entry.heading.replace(/\*\*/g, '').trim();
      console.log(
        `  ${chalk.cyan(entry.fullyQualified)}  ${heading}  ${chalk.gray(`L${entry.line}`)}`,
      );
    }
    if (result.matches.length > 10) {
      console.log(`  ... and ${result.matches.length - 10} more`);
    }
    console.log('');
    console.log(
      chalk.gray(
        'Specify the section number to disambiguate (e.g., ' +
          result.matches[0].fullyQualified +
          ')',
      ),
    );
    return null;
  }

  console.log(chalk.red(`Claim not found: ${input}`));
  const normalized = result.normalized;
  const dotParts = normalized.split('.');
  if (dotParts.length >= 2) {
    const suffix = '.' + dotParts.slice(1).join('.');
    const candidates = [...data.entries.keys()].filter((k) => k.endsWith(suffix));
    if (candidates.length > 0) {
      console.log('');
      console.log('Did you mean:');
      for (const c of candidates.slice(0, 5)) {
        console.log(`  ${c}`);
      }
    }
  }
  return null;
}

/**
 * Zero-pad note ID shortcode digits and claim numbers.
 *
 * Note ID shortcodes: pad to the width found in existing entries.
 * Claim numbers: always pad to 2 digits.
 *
 * Examples:
 *   DD7.1.DC.1  -> DD007.1.DC.01
 *   DD7.DC.1    -> DD007.DC.01
 *   R4.1.AC.3   -> R004.1.AC.03
 *
 * @implements {DD008.§1.DC.02}
 */
function zeroPad(normalized: string, data: ClaimIndexData): string {
  const parts = normalized.split('.');
  if (parts.length === 0) return normalized;

  // Pad the note ID (first segment if it matches shortcode+digits pattern)
  const noteIdMatch = parts[0].match(/^([A-Z]{1,5})(\d+)$/);
  if (noteIdMatch) {
    const shortcode = noteIdMatch[1];
    const num = String(parseInt(noteIdMatch[2], 10));
    const targetWidth = findShortcodeWidth(shortcode, data);
    parts[0] = shortcode + num.padStart(targetWidth, '0');
  }

  // Pad claim number (last segment if it's pure digits, preceded by uppercase prefix)
  // The pattern is: [..., PREFIX, NN] where PREFIX is uppercase letters and NN is digits
  if (parts.length >= 2) {
    const lastIdx = parts.length - 1;
    const secondLastIdx = lastIdx - 1;
    const lastPart = parts[lastIdx];
    const secondLastPart = parts[secondLastIdx];

    // Check if this is a claim number (digits, possibly with trailing letter)
    const claimNumMatch = lastPart.match(/^(\d+)([a-z])?$/);
    const prefixMatch = secondLastPart.match(/^([A-Z]+)$/);

    if (claimNumMatch && prefixMatch) {
      const num = String(parseInt(claimNumMatch[1], 10));
      const subLetter = claimNumMatch[2] || '';
      parts[lastIdx] = num.padStart(2, '0') + subLetter;
    }
  }

  return parts.join('.');
}

/**
 * Find the digit width used for a given shortcode in existing entries.
 * Scans entries to find the shortest existing ID with that prefix to determine width.
 * Returns 3 as minimum default (most common case: R001, DD001, etc.)
 */
function findShortcodeWidth(shortcode: string, data: ClaimIndexData): number {
  let minWidth = 3; // Default minimum

  for (const key of data.entries.keys()) {
    const parsed = parseNoteId(key.split('.')[0]);
    if (parsed && parsed.shortcode === shortcode) {
      minWidth = Math.max(minWidth, parsed.number.length);
      break; // All entries for a shortcode use the same width
    }
  }

  return minWidth;
}

/**
 * Strip leading zeros from section path segments only.
 * Section paths in the index are unpadded: "1", "3", not "01", "03".
 * Claim numbers (digits after the uppercase prefix) are NOT stripped.
 * E.g., "DD007.01.DC.02" -> "DD007.1.DC.02"
 */
function stripSectionZeroPadding(normalized: string): string {
  const parts = normalized.split('.');
  if (parts.length < 2) return normalized;

  // Find where the claim prefix starts (first uppercase-only part after the note ID).
  // Everything before it that is pure digits is a section path segment.
  let claimPrefixIdx = -1;
  for (let i = 1; i < parts.length; i++) {
    if (/^[A-Z]+$/.test(parts[i])) {
      claimPrefixIdx = i;
      break;
    }
  }

  // Only strip leading zeros from section path segments (between note ID and claim prefix)
  const end = claimPrefixIdx > 0 ? claimPrefixIdx : parts.length;
  for (let i = 1; i < end; i++) {
    if (/^\d+$/.test(parts[i]) && parts[i].length > 1) {
      parts[i] = String(parseInt(parts[i], 10));
    }
  }
  return parts.join('.');
}

/**
 * Detect if the normalized input is a section reference (NOTEID.SECTION).
 * E.g., "DD007.1" or "DD007.3.1"
 * Returns the components if it is, null otherwise.
 */
function isSectionReference(normalized: string): { noteId: string; sectionPath: string } | null {
  const parts = normalized.split('.');
  if (parts.length < 2) return null;

  // First part must be a note ID
  if (!/^[A-Z]{1,5}\d{3,5}$/.test(parts[0])) return null;

  // All remaining parts must be numeric (section path segments)
  const rest = parts.slice(1);
  if (rest.every(p => /^\d+$/.test(p))) {
    return { noteId: parts[0], sectionPath: rest.join('.') };
  }
  return null;
}
