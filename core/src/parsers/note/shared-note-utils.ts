/**
 * Shared utilities for NOTE_SPEC parsing
 */

// Note: NoteType is now a string to support multi-character shortcodes
// This is no longer an enum but any valid shortcode string

export interface ParsedNoteId {
  shortcode: string; // Can be single or multi-character (e.g., 'R', 'ARCH', 'US')
  number: string;
}

export interface ModifierInfo {
  id: string;
  modifier?: '+' | '.';
  forceInclude: boolean;
  contextOnly: boolean;
}

/**
 * Parse a note ID into its components
 * @param id - Note ID like "D001", "R042", "ARCH001", "US12345", etc.
 * @returns Parsed components or null if invalid
 */
export function parseNoteId(id: string): ParsedNoteId | null {
  // Match 1-5 letter shortcode followed by 3-5 digits
  const match = id.match(/^([A-Z]{1,5})(\d{3,5})$/);
  if (!match) {
    return null;
  }

  return {
    shortcode: match[1],
    number: match[2],
  };
}

/**
 * Parse comma-separated tags
 * @param tagsStr - Comma-separated tags string
 * @returns Array of tag strings
 */
export function parseTags(tagsStr?: string): string[] {
  if (!tagsStr || !tagsStr.trim()) {
    return [];
  }

  return tagsStr
    .split(',')
    .map((cat) => cat.trim())
    .filter((cat) => cat.length > 0);
}

/**
 * Check if a shortcode format is valid
 * @param shortcode - Shortcode string (1-5 uppercase letters)
 * @returns True if valid shortcode format
 */
export function isValidShortcodeFormat(shortcode: string): boolean {
  return /^[A-Z]{1,5}$/.test(shortcode);
}

/**
 * Check if a note ID is valid
 * @param id - Note ID to validate
 * @returns True if valid note ID format
 */
export function isValidNoteId(id: string): boolean {
  return parseNoteId(id) !== null;
}

/**
 * Extract modifier from note reference
 * @param ref - Note reference like "D001", "D001+", "ARCH001.", etc.
 * @returns Modifier information
 */
export function extractModifier(ref: string): ModifierInfo {
  const forceIncludeMatch = ref.match(/^([A-Z]{1,5}\d{3,5})\+$/);
  if (forceIncludeMatch) {
    return {
      id: forceIncludeMatch[1],
      modifier: '+',
      forceInclude: true,
      contextOnly: false,
    };
  }

  const contextOnlyMatch = ref.match(/^([A-Z]{1,5}\d{3,5})\.$/);
  if (contextOnlyMatch) {
    return {
      id: contextOnlyMatch[1],
      modifier: '.',
      forceInclude: false,
      contextOnly: true,
    };
  }

  return {
    id: ref,
    modifier: undefined,
    forceInclude: false,
    contextOnly: false,
  };
}

/**
 * Format a note ID from components
 * @param shortcode - Shortcode (e.g., 'R', 'ARCH', 'US')
 * @param number - Note number (string or number)
 * @param digits - Number of digits to pad to (default: 3 for single-char, 5 for multi-char)
 * @returns Formatted note ID like "D001" or "ARCH00001"
 */
export function formatNoteId(shortcode: string, number: string | number, digits?: number): string {
  const num = typeof number === 'string' ? parseInt(number, 10) : number;
  const padLength = digits || (shortcode.length > 1 ? 5 : 3);
  const maxNum = Math.pow(10, padLength) - 1;
  const capped = Math.min(num, maxNum);
  return `${shortcode}${capped.toString().padStart(padLength, '0')}`;
}

/**
 * Generate the file path for a note
 * @param id - Note ID
 * @param typeMapping - Mapping of shortcodes to folder names
 * @returns File path or null if invalid ID
 */
export function generateNotePath(id: string, typeMapping: Record<string, string>): string | null {
  const parsed = parseNoteId(id);
  if (!parsed) {
    return null;
  }

  const folder = typeMapping[parsed.shortcode];
  if (!folder) {
    return null;
  }

  return `${folder}/${id}.md`;
}

/**
 * Merge two tag arrays, removing duplicates
 * @param cats1 - First tag array
 * @param cats2 - Second tag array
 * @returns Merged array with unique tags
 */
export function mergeTags(cats1: string[], cats2: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const cat of [...cats1, ...cats2]) {
    if (!seen.has(cat)) {
      seen.add(cat);
      result.push(cat);
    }
  }

  return result;
}
