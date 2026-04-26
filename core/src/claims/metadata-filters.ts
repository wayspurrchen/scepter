/**
 * Generalized metadata filters: --where KEY=VALUE, --has-key KEY,
 * --missing-key KEY.
 *
 * Composes with the existing --importance/--lifecycle/--note filters via AND
 * semantics. Each filter consults the claim's folded metadata state via
 * `metadataStorage.fold(claimId)`.
 *
 * @implements {R009.§5.AC.01} --where filter on claim metadata
 * @implements {R009.§5.AC.02} --has-key filter
 * @implements {R009.§5.AC.03} --missing-key filter
 * @implements {R009.§5.AC.06} Filters compose with existing flags (AND)
 * @implements {DD014.§3.DC.55} CLI flag definitions and KEY validation
 * @implements {DD014.§3.DC.56} applyMetadataFilters utility, AND semantics
 */

import type { MetadataStorage } from '../storage/storage-backend.js';

const KEY_PATTERN = /^[a-z][a-z0-9._-]*$/;

/**
 * Parsed metadata-filter options. Each list is independently AND'd against
 * the claim's folded state.
 */
export interface MetadataFilterOptions {
  /** Each entry is `KEY=VALUE` — claim must have VALUE in folded[KEY]. */
  where?: string[];
  /** Each entry is a KEY — claim must have at least one value for KEY. */
  hasKey?: string[];
  /** Each entry is a KEY — claim must NOT have any value for KEY. */
  missingKey?: string[];
}

export interface ParsedWhereClause {
  key: string;
  value: string;
}

export type FilterParseResult =
  | { ok: true; where: ParsedWhereClause[]; hasKey: string[]; missingKey: string[] }
  | { ok: false; error: string };

/**
 * Parse and validate the raw CLI option arrays. Returns either the parsed
 * filter clauses or a user-facing error message naming the offender.
 *
 * KEYs must match `/^[a-z][a-z0-9._-]*$/`. `--where` entries must be
 * `KEY=VALUE` with non-empty VALUE.
 *
 * @implements {DD014.§3.DC.55}
 */
export function parseMetadataFilters(
  options: MetadataFilterOptions,
): FilterParseResult {
  const where: ParsedWhereClause[] = [];
  for (const raw of options.where ?? []) {
    const eq = raw.indexOf('=');
    if (eq <= 0) {
      return { ok: false, error: `Invalid --where pair: "${raw}". Expected KEY=VALUE.` };
    }
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    if (!KEY_PATTERN.test(key)) {
      return {
        ok: false,
        error: `Invalid --where KEY: "${key}". Keys must match /^[a-z][a-z0-9._-]*$/.`,
      };
    }
    if (value.length === 0) {
      return {
        ok: false,
        error: `Empty --where VALUE for KEY "${key}". Use --missing-key ${key} to filter for absence.`,
      };
    }
    where.push({ key, value });
  }

  for (const key of options.hasKey ?? []) {
    if (!KEY_PATTERN.test(key)) {
      return {
        ok: false,
        error: `Invalid --has-key KEY: "${key}". Keys must match /^[a-z][a-z0-9._-]*$/.`,
      };
    }
  }
  for (const key of options.missingKey ?? []) {
    if (!KEY_PATTERN.test(key)) {
      return {
        ok: false,
        error: `Invalid --missing-key KEY: "${key}". Keys must match /^[a-z][a-z0-9._-]*$/.`,
      };
    }
  }

  return {
    ok: true,
    where,
    hasKey: [...(options.hasKey ?? [])],
    missingKey: [...(options.missingKey ?? [])],
  };
}

/**
 * Predicate: does the folded metadata state satisfy ALL parsed filters?
 *
 * - `where`: every (key, value) clause requires `folded[key]` to include VALUE.
 * - `hasKey`: every key requires `folded[key]` to be a non-empty array.
 * - `missingKey`: every key requires `folded[key]` to be undefined or empty.
 *
 * Empty filter sets pass trivially.
 *
 * @implements {DD014.§3.DC.56} AND semantics
 */
export function matchesMetadataFilters(
  folded: Record<string, string[]>,
  filters: { where: ParsedWhereClause[]; hasKey: string[]; missingKey: string[] },
): boolean {
  for (const { key, value } of filters.where) {
    const values = folded[key];
    if (!values || !values.includes(value)) return false;
  }
  for (const key of filters.hasKey) {
    const values = folded[key];
    if (!values || values.length === 0) return false;
  }
  for (const key of filters.missingKey) {
    const values = folded[key];
    if (values && values.length > 0) return false;
  }
  return true;
}

/**
 * Generic filter helper: given an array of items that each carry a claimId,
 * and a metadata storage, return only the items whose claim's folded state
 * passes the filters.
 *
 * The function is generic over the item shape — callers pass an extractor
 * for the claimId. This lets `trace` filter `TraceabilityRow[]`, `gaps`
 * filter the same shape, and `search` filter `ClaimIndexEntry[]` without a
 * shape collision.
 *
 * @implements {DD014.§3.DC.56}
 */
export async function applyMetadataFilters<T>(
  items: T[],
  getClaimId: (item: T) => string,
  metadataStorage: MetadataStorage,
  filters: { where: ParsedWhereClause[]; hasKey: string[]; missingKey: string[] },
): Promise<T[]> {
  // Fast path: no filters configured.
  if (
    filters.where.length === 0 &&
    filters.hasKey.length === 0 &&
    filters.missingKey.length === 0
  ) {
    return items;
  }
  const result: T[] = [];
  for (const item of items) {
    const folded = await metadataStorage.fold(getClaimId(item));
    if (matchesMetadataFilters(folded, filters)) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Convenience: parse + apply in one call. Throws an error with the parse
 * message if validation fails. Callers that want to surface the error to
 * the user with a non-zero exit should call `parseMetadataFilters` and
 * `applyMetadataFilters` separately.
 */
export async function parseAndApplyMetadataFilters<T>(
  items: T[],
  getClaimId: (item: T) => string,
  metadataStorage: MetadataStorage,
  options: MetadataFilterOptions,
): Promise<T[]> {
  const parsed = parseMetadataFilters(options);
  if (!parsed.ok) throw new Error(parsed.error);
  return applyMetadataFilters(items, getClaimId, metadataStorage, parsed);
}

/**
 * Commander-compatible collector for repeatable string options. Pass as the
 * second argument to `.option('--where <pair>', '...', collectStrings, [])`.
 */
export function collectStrings(value: string, previous: string[]): string[] {
  return [...previous, value];
}
