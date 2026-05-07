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
import type { ClaimIndexEntry } from './claim-index.js';

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
 * Overlay a `ClaimIndexEntry`'s markdown-projected metadata onto an
 * event-derived fold to produce the merged read view used by metadata
 * filters. Pure function; the caller supplies both inputs.
 *
 * The merge rule: start with the event-log fold, then for each known field
 * on `entry` (`importance`, `lifecycle`, `derivedFrom`, `parsedTags`)
 * append the markdown values to the corresponding key's value array if
 * not already present. `parsedTags` may carry both freeform tokens
 * (recorded under `tag`) and `KEY=VALUE` pairs (split and routed to their
 * key). `lifecycle = { type: 'superseded', target }` decomposes into TWO
 * keys — `lifecycle: ['superseded']` and `supersededBy: [target]` —
 * matching the normalization table in {A004.§3.AC.02}.
 *
 * Keys with empty merged values are not present in the result.
 *
 * @implements {DD019.§3.DC.11} Markdown overlay onto event-derived fold
 * @implements {DD019.§3.DC.12} Existing filter semantics preserved post-merge
 * @implements {DD019.§3.DC.13} Pure (entry, folded) -> merged Record
 * @implements {DD019.§3.DC.14} superseded decomposes into lifecycle + supersededBy
 */
export function mergeMarkdownIntoFold(
  entry: ClaimIndexEntry | undefined,
  folded: Record<string, string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(folded)) {
    merged[key] = [...values];
  }
  if (!entry) return merged;

  const append = (key: string, value: string): void => {
    const existing = merged[key];
    if (existing === undefined) {
      merged[key] = [value];
      return;
    }
    if (!existing.includes(value)) existing.push(value);
  };

  // importance — bare digit 1-5 in markdown
  if (entry.importance !== undefined) {
    append('importance', String(entry.importance));
  }

  // lifecycle — closed/deferred/removed/superseded[=TARGET]
  if (entry.lifecycle !== undefined) {
    append('lifecycle', entry.lifecycle.type);
    if (entry.lifecycle.type === 'superseded' && entry.lifecycle.target) {
      append('supersededBy', entry.lifecycle.target);
    }
  }

  // derives=TARGET tokens
  for (const target of entry.derivedFrom) {
    append('derives', target);
  }

  // parsedTags carries both freeform tokens and KEY=VALUE pairs.
  // Bare tokens go under `tag`; KEY=VALUE tokens are split and routed to their key.
  for (const tag of entry.parsedTags) {
    const eq = tag.indexOf('=');
    if (eq > 0) {
      const k = tag.slice(0, eq);
      const v = tag.slice(eq + 1);
      append(k, v);
    } else {
      append('tag', tag);
    }
  }

  return merged;
}

/**
 * Generic filter helper: given an array of items that each carry a claimId,
 * and a metadata storage, return only the items whose claim's merged
 * (markdown overlay + event fold) state passes the filters.
 *
 * The function is generic over the item shape — callers pass an extractor
 * for the claimId. This lets `trace` filter `TraceabilityRow[]`, `gaps`
 * filter the same shape, and `search` filter `ClaimIndexEntry[]` without a
 * shape collision.
 *
 * The `getEntry` callback resolves the `ClaimIndexEntry` for each item so
 * the merge can overlay author-declared markdown tokens onto the
 * event-log fold. Callers pass `claimIndex.getClaim.bind(claimIndex)` (or
 * an equivalent lookup function); see DD019.§4 for the wiring rationale.
 *
 * @implements {DD014.§3.DC.56}
 * @implements {DD019.§3.DC.11} Overlay merge applied at filter time
 * @implements {DD019.§3.DC.13} Caller resolves entry; merge stays pure
 */
export async function applyMetadataFilters<T>(
  items: T[],
  getClaimId: (item: T) => string,
  metadataStorage: MetadataStorage,
  filters: { where: ParsedWhereClause[]; hasKey: string[]; missingKey: string[] },
  getEntry?: (claimId: string) => ClaimIndexEntry | null | undefined,
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
    const claimId = getClaimId(item);
    const folded = await metadataStorage.fold(claimId);
    const entry = getEntry ? getEntry(claimId) ?? undefined : undefined;
    const merged = mergeMarkdownIntoFold(entry, folded);
    if (matchesMetadataFilters(merged, filters)) {
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
  getEntry?: (claimId: string) => ClaimIndexEntry | null | undefined,
): Promise<T[]> {
  const parsed = parseMetadataFilters(options);
  if (!parsed.ok) throw new Error(parsed.error);
  return applyMetadataFilters(items, getClaimId, metadataStorage, parsed, getEntry);
}

/**
 * Commander-compatible collector for repeatable string options. Pass as the
 * second argument to `.option('--where <pair>', '...', collectStrings, [])`.
 */
export function collectStrings(value: string, previous: string[]): string[] {
  return [...previous, value];
}
