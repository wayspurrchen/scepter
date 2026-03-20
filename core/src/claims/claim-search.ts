/**
 * Claim search and filtering for SCEpter.
 *
 * Pure functions that operate on the computed ClaimIndexData.
 * No file I/O after index build — all operations are in-memory.
 *
 * @implements {R007.§1.AC.01} Text query matches fullyQualified + heading
 * @implements {R007.§1.AC.02} --id-only restricts to fullyQualified + claimId
 * @implements {R007.§1.AC.03} Regex mode with \| normalization
 * @implements {R007.§1.AC.04} Literal mode with case-insensitive matching
 * @implements {R007.§1.AC.05} Empty query valid with filters
 * @implements {R007.§1.AC.06} Empty query without filters produces error
 * @implements {R007.§2.AC.01} --types filter by note type
 * @implements {R007.§2.AC.02} --note filter by note ID
 * @implements {R007.§2.AC.03} --importance filter (>= threshold)
 * @implements {R007.§2.AC.04} --lifecycle filter by state
 * @implements {R007.§2.AC.05} Conjunctive composition (AND)
 * @implements {R007.§2.AC.06} --limit with default 50
 * @implements {R007.§3.AC.01} --derives-from filter
 * @implements {R007.§3.AC.02} --derivatives-of via getDerivatives()
 * @implements {R007.§3.AC.03} --has-derivation filter
 * @implements {R007.§3.AC.04} Derivation filters compose with text + other filters
 * @implements {R007.§3.AC.05} Unresolvable derivation target produces error
 * @implements {R007.§5.AC.03} No file I/O after index build
 */

import type { ClaimIndexData, ClaimIndexEntry } from './claim-index.js';
import type { ClaimIndex } from './claim-index.js';
import type { LifecycleType } from './claim-metadata.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ClaimSearchOptions {
  query?: string;
  regex?: boolean;
  idOnly?: boolean;
  types?: string[];
  note?: string;
  importance?: number;
  lifecycle?: string;
  derivesFrom?: string;
  derivativesOf?: string;
  hasDerivation?: boolean;
  limit?: number;
  format?: 'list' | 'detailed' | 'json';
}

export interface ClaimSearchResult {
  matches: ClaimIndexEntry[];
  total: number;
  truncated: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Valid lifecycle types for validation
// ---------------------------------------------------------------------------

const VALID_LIFECYCLE_TYPES: readonly string[] = ['closed', 'deferred', 'removed', 'superseded'];

// ---------------------------------------------------------------------------
// Pattern construction
// ---------------------------------------------------------------------------

/**
 * Build a RegExp from the user's query string.
 *
 * @implements {R007.§1.AC.03} Regex mode: normalize \| to | for shell-escaped alternation
 * @implements {R007.§1.AC.04} Literal mode: escape special chars, case-insensitive
 */
export function buildSearchPattern(query: string, options: { regex?: boolean }): RegExp {
  if (options.regex) {
    // Normalize BRE-style \| to JS alternation |
    const normalized = query.replace(/\\\|/g, '|');
    return new RegExp(normalized, 'i');
  }

  // Literal mode: escape special regex characters
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

// ---------------------------------------------------------------------------
// Per-entry matchers
// ---------------------------------------------------------------------------

/**
 * Test whether a single entry matches the text query.
 *
 * @implements {R007.§1.AC.01} Default: match against fullyQualified + heading
 * @implements {R007.§1.AC.02} --id-only: match against fullyQualified + claimId only
 */
export function matchesQuery(
  entry: ClaimIndexEntry,
  pattern: RegExp,
  idOnly: boolean,
): boolean {
  if (idOnly) {
    return pattern.test(entry.fullyQualified) || pattern.test(entry.claimId);
  }
  return pattern.test(entry.fullyQualified) || pattern.test(entry.heading);
}

// ---------------------------------------------------------------------------
// Filter predicates
// ---------------------------------------------------------------------------

/**
 * @implements {R007.§2.AC.01} Filter by note type (canonical names)
 */
export function matchesTypeFilter(entry: ClaimIndexEntry, types: string[]): boolean {
  return types.includes(entry.noteType);
}

/**
 * @implements {R007.§2.AC.02} Filter by note ID
 */
export function matchesNoteFilter(entry: ClaimIndexEntry, noteId: string): boolean {
  return entry.noteId === noteId;
}

/**
 * @implements {R007.§2.AC.03} Filter by minimum importance. Excludes claims with no importance.
 */
export function matchesImportanceFilter(entry: ClaimIndexEntry, minImportance: number): boolean {
  return entry.importance !== undefined && entry.importance >= minImportance;
}

/**
 * @implements {R007.§2.AC.04} Filter by lifecycle state. Excludes claims with no lifecycle.
 */
export function matchesLifecycleFilter(entry: ClaimIndexEntry, lifecycle: string): boolean {
  return entry.lifecycle?.type === lifecycle;
}

/**
 * @implements {R007.§3.AC.01} Filter claims whose derivedFrom contains the specified claim ID.
 */
export function matchesDerivedFromFilter(entry: ClaimIndexEntry, sourceClaimId: string): boolean {
  return entry.derivedFrom.includes(sourceClaimId);
}

/**
 * @implements {R007.§3.AC.03} Filter claims that have non-empty derivedFrom.
 */
export function matchesHasDerivation(entry: ClaimIndexEntry): boolean {
  return entry.derivedFrom.length > 0;
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search the claim index with text queries and metadata filters.
 *
 * @implements {R007.§1.AC.05} Empty query valid with filters (filter-only mode)
 * @implements {R007.§1.AC.06} Empty query without filters produces error
 * @implements {R007.§2.AC.05} All filters compose conjunctively (AND)
 * @implements {R007.§2.AC.06} Default limit 50, truncation flag
 * @implements {R007.§3.AC.02} --derivatives-of replaces candidate set via getDerivatives()
 * @implements {R007.§3.AC.04} Derivation filters compose with text + other filters
 * @implements {R007.§3.AC.05} Unresolvable derivation target produces error
 */
export function searchClaims(
  data: ClaimIndexData,
  claimIndex: ClaimIndex,
  options: ClaimSearchOptions,
): ClaimSearchResult {
  const query = options.query ?? '';
  const limit = options.limit ?? 50;

  // Determine if any filter is active
  const hasFilters = !!(
    options.types ||
    options.note ||
    options.importance !== undefined ||
    options.lifecycle ||
    options.derivesFrom ||
    options.derivativesOf ||
    options.hasDerivation
  );

  // @implements {R007.§1.AC.06} Empty query + no filters = error
  if (query === '' && !hasFilters) {
    return {
      matches: [],
      total: 0,
      truncated: false,
      error: 'Please provide a search query or at least one filter option (--types, --note, --importance, --lifecycle, --derives-from, --derivatives-of, --has-derivation).',
    };
  }

  // Validate lifecycle value if provided
  if (options.lifecycle && !VALID_LIFECYCLE_TYPES.includes(options.lifecycle)) {
    return {
      matches: [],
      total: 0,
      truncated: false,
      error: `Invalid lifecycle state "${options.lifecycle}". Valid values: ${VALID_LIFECYCLE_TYPES.join(', ')}.`,
    };
  }

  // Validate importance range if provided
  if (options.importance !== undefined && (options.importance < 1 || options.importance > 5)) {
    return {
      matches: [],
      total: 0,
      truncated: false,
      error: `Invalid importance level "${options.importance}". Valid range: 1-5.`,
    };
  }

  // Validate note ID against the index if provided
  // @implements {R007.§2.AC.02} Unrecognized note ID produces error
  if (options.note) {
    const noteExists = [...data.entries.values()].some(e => e.noteId === options.note);
    if (!noteExists) {
      return {
        matches: [],
        total: 0,
        truncated: false,
        error: `Note "${options.note}" not found in the claim index. No claims exist for this note.`,
      };
    }
  }

  // @implements {R007.§3.AC.05} Validate --derives-from target
  if (options.derivesFrom) {
    const normalized = options.derivesFrom.replace(/§/g, '');
    if (!data.entries.has(normalized)) {
      return {
        matches: [],
        total: 0,
        truncated: false,
        error: `Claim "${options.derivesFrom}" not found in the index. Cannot filter by --derives-from.`,
      };
    }
  }

  // @implements {R007.§3.AC.05} Validate --derivatives-of target
  if (options.derivativesOf) {
    const normalized = options.derivativesOf.replace(/§/g, '');
    if (!data.entries.has(normalized)) {
      return {
        matches: [],
        total: 0,
        truncated: false,
        error: `Claim "${options.derivativesOf}" not found in the index. Cannot filter by --derivatives-of.`,
      };
    }
  }

  // Build text search pattern (only if query is non-empty)
  let pattern: RegExp | null = null;
  if (query !== '') {
    try {
      pattern = buildSearchPattern(query, { regex: options.regex });
    } catch (e) {
      return {
        matches: [],
        total: 0,
        truncated: false,
        error: `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // @implements {R007.§3.AC.02} --derivatives-of: use getDerivatives() to build candidate set
  let candidates: Iterable<ClaimIndexEntry>;
  if (options.derivativesOf) {
    const normalized = options.derivativesOf.replace(/§/g, '');
    const derivativeFqids = claimIndex.getDerivatives(normalized);
    candidates = derivativeFqids
      .map(fqid => data.entries.get(fqid))
      .filter((e): e is ClaimIndexEntry => e !== undefined);
  } else {
    candidates = data.entries.values();
  }

  // Apply all filters conjunctively
  const matches: ClaimIndexEntry[] = [];
  let total = 0;

  for (const entry of candidates) {
    // Text query filter
    if (pattern && !matchesQuery(entry, pattern, !!options.idOnly)) {
      continue;
    }

    // @implements {R007.§2.AC.01} Type filter
    if (options.types && !matchesTypeFilter(entry, options.types)) {
      continue;
    }

    // @implements {R007.§2.AC.02} Note filter
    if (options.note && !matchesNoteFilter(entry, options.note)) {
      continue;
    }

    // @implements {R007.§2.AC.03} Importance filter
    if (options.importance !== undefined && !matchesImportanceFilter(entry, options.importance)) {
      continue;
    }

    // @implements {R007.§2.AC.04} Lifecycle filter
    if (options.lifecycle && !matchesLifecycleFilter(entry, options.lifecycle)) {
      continue;
    }

    // @implements {R007.§3.AC.01} Derives-from filter
    if (options.derivesFrom) {
      const normalized = options.derivesFrom.replace(/§/g, '');
      if (!matchesDerivedFromFilter(entry, normalized)) {
        continue;
      }
    }

    // @implements {R007.§3.AC.03} Has-derivation filter
    if (options.hasDerivation && !matchesHasDerivation(entry)) {
      continue;
    }

    total++;

    // @implements {R007.§2.AC.06} Apply limit
    if (matches.length < limit) {
      matches.push(entry);
    }
  }

  return {
    matches,
    total,
    truncated: total > limit,
  };
}
