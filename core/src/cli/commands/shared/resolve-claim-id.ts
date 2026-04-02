/**
 * Fuzzy claim ID resolution for the show command.
 *
 * Normalizes user-provided shorthand claim addresses and resolves them
 * against the claim index. Handles:
 *   - $ -> section symbol replacement
 *   - Zero-padding for note ID shortcodes and claim numbers
 *   - Exact match first, then suffix matching for ambiguous inputs
 *
 * @implements {DD008.§1.DC.01} resolveClaimInput() normalization and resolution
 * @implements {DD008.§1.DC.02} Zero-padding rules for shortcodes and claim numbers
 */

import type { ClaimIndexData, ClaimIndexEntry } from '../../../claims/index.js';
import { parseNoteId } from '../../../parsers/note/shared-note-utils.js';

export interface ResolveResult {
  matches: ClaimIndexEntry[];
  normalized: string;
}

/**
 * Normalize and resolve a user-provided string to zero or more claim index entries.
 *
 * Normalization steps:
 * 1. Replace `$` with `§` (shell escape convenience)
 * 2. Strip `§` for index lookup (the index uses dotted form without `§`)
 * 3. Zero-pad shortcode digits and claim numbers
 * 4. Exact match in data.entries
 * 5. If no exact match and input has no section path: suffix match
 *
 * @implements {DD008.§1.DC.01}
 */
export function resolveClaimInput(input: string, data: ClaimIndexData): ResolveResult {
  // Step 1: Replace $ with §
  let normalized = input.replace(/\$/g, '§');

  // Step 2: Strip § for index lookup
  normalized = normalized.replace(/§/g, '');

  // Step 3: Zero-pad shortcode digits and claim numbers, strip section zero-padding
  normalized = zeroPad(normalized, data);
  normalized = stripSectionZeroPadding(normalized);

  // Step 4: Exact match
  const exactEntry = data.entries.get(normalized);
  if (exactEntry) {
    return { matches: [exactEntry], normalized };
  }

  // Step 5: Section-only resolution.
  // If input is NOTEID.SECTION (e.g., DD007.1), show all claims in that section.
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
  }

  // Step 6: Suffix matching when no section path is present.
  // If input has no section path (i.e., no numeric segment between noteId and claim prefix),
  // try all entries ending with the claim suffix.
  // E.g., "DD007.DC.01" should match "DD007.1.DC.01" and "DD007.2.DC.01"
  if (hasMissingSectionPath(normalized)) {
    const suffix = extractClaimSuffix(normalized);
    const notePrefix = extractNotePrefix(normalized);

    if (suffix && notePrefix) {
      const matches: ClaimIndexEntry[] = [];
      for (const [key, entry] of data.entries) {
        if (key.startsWith(notePrefix + '.') && key.endsWith('.' + suffix)) {
          matches.push(entry);
        }
      }
      if (matches.length > 0) {
        // Sort by fully qualified ID for deterministic output
        matches.sort((a, b) => a.fullyQualified.localeCompare(b.fullyQualified));
        return { matches, normalized };
      }
    }
  }

  // No matches
  return { matches: [], normalized };
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
 * Detect whether the normalized input is missing its section path.
 * This is the case when a note ID is followed directly by a claim prefix
 * with no numeric segment in between.
 *
 * E.g., "DD007.DC.01" has no section path (missing the "1" between DD007 and DC).
 * "DD007.1.DC.01" does have a section path.
 */
function hasMissingSectionPath(normalized: string): boolean {
  const parts = normalized.split('.');
  if (parts.length < 3) return false;

  // Check if first part is a note ID
  if (!/^[A-Z]{1,5}\d{3,5}$/.test(parts[0])) return false;

  // Check if second part is an uppercase claim prefix (not a number)
  if (/^[A-Z]+$/.test(parts[1])) return true;

  return false;
}

/**
 * Extract the claim suffix (e.g., "DC.01") from a normalized input
 * that has no section path.
 */
function extractClaimSuffix(normalized: string): string | null {
  const parts = normalized.split('.');
  if (parts.length < 3) return null;

  // First part is noteId, rest is claim suffix
  // e.g., "DD007.DC.01" -> "DC.01"
  if (!/^[A-Z]{1,5}\d{3,5}$/.test(parts[0])) return null;
  if (!/^[A-Z]+$/.test(parts[1])) return null;

  return parts.slice(1).join('.');
}

/**
 * Extract the note ID prefix from a normalized input.
 */
function extractNotePrefix(normalized: string): string | null {
  const parts = normalized.split('.');
  if (parts.length < 1) return null;

  if (/^[A-Z]{1,5}\d{3,5}$/.test(parts[0])) {
    return parts[0];
  }
  return null;
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
