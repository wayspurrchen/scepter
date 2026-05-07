/**
 * Tombstone-detector for the snapshot subsystem.
 *
 * Implements the §7 tombstone-equivalence rules consumed by the diff
 * regression-gate (Phase 2/3).  A claim is tombstoned when EITHER (a)
 * its lifecycle field is `removed` or `superseded` per
 * {R014.§7.AC.01}-{R014.§7.AC.02}, OR (b) its body content matches the
 * `CONTENT_TOMBSTONE_RE` pattern after trimming per
 * {R014.§7.AC.03}.
 *
 * @implements {DD018.§3.DC.32} CONTENT_TOMBSTONE_RE — canonical authority
 * @implements {DD018.§3.DC.33} isLifecycleTombstone
 * @implements {DD018.§3.DC.34} isContentTombstone
 * @implements {DD018.§3.DC.35} isTombstoned with per-call cache
 */

import type { LifecycleState } from '../claim-metadata.js';
import type { ClaimIndexEntry } from '../claim-index.js';

/**
 * Canonical regex for body-content tombstones.  Both the detector and
 * any debug helper MUST reference this constant; no module is permitted
 * to inline the literal regex independently.
 *
 * Examples that match: `Removed`, `removed.`, `REMOVED`, `Superseded`,
 * `superseded.`, `Superseded.`.
 *
 * Examples that do NOT match: `Removed: see X`,
 * `This was removed in v2`, the empty string.
 *
 * @implements {DD018.§3.DC.32}
 */
export const CONTENT_TOMBSTONE_RE = /^(removed|superseded)\.?$/i;

/**
 * Returns true when the lifecycle's `type` is exactly `removed` or
 * `superseded`.
 *
 * Per {R014.§7.AC.02} the presence or absence of the supersession
 * `target` is irrelevant — an unresolved target still tombstones.
 *
 * `null`/`undefined` lifecycle returns false; lifecycles with other
 * types (`closed`, `deferred`) return false.
 *
 * @implements {DD018.§3.DC.33}
 */
export function isLifecycleTombstone(
  lifecycle: LifecycleState | undefined | null,
): boolean {
  if (!lifecycle) return false;
  return lifecycle.type === 'removed' || lifecycle.type === 'superseded';
}

/**
 * Returns true when the body matches the content-tombstone pattern
 * after trimming.
 *
 * Empty bodies (`body.trim() === ''`) return false — empty bodies are
 * NOT tombstones.
 *
 * @implements {DD018.§3.DC.34}
 */
export function isContentTombstone(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === '') return false;
  return CONTENT_TOMBSTONE_RE.test(trimmed);
}

/**
 * Per-diff-run tombstone-detection context.
 *
 * `entry` is the live-index `ClaimIndexEntry` for the FQID under check,
 * or `undefined` when the claim doesn't exist in the live index (gone).
 *
 * `bodyResolver` is wired by the diff caller using
 * `noteFileManager.getAggregatedContents` plus the `entry.line+1` /
 * `entry.endLine` slice — the same logic the writer uses minus the
 * hashing step.  The detector calls `bodyResolver` only after the
 * cheaper lifecycle-tag check has not already settled the answer.
 *
 * `cache` is the per-diff-run shared cache (a `Map<string, boolean>`
 * keyed by FQID).  Phase 2/3 callers pass a single Map across all
 * gate evaluations so a given FQID's tombstone state is computed at
 * most once per diff run.
 *
 * The cache MUST NOT be a module-level singleton — that would
 * cross-contaminate diff runs.
 */
export interface TombstoneCheckContext {
  fqid: string;
  entry: ClaimIndexEntry | undefined;
  bodyResolver: (entry: ClaimIndexEntry) => string;
  cache: Map<string, boolean>;
}

/**
 * Returns true when the claim is tombstoned per the §7 rules.
 *
 * Order of evaluation (cheapest first):
 *   1. Cache hit → return cached value.
 *   2. `entry === undefined` → return false (the claim doesn't exist
 *      in the live index — there's nothing to tombstone).
 *   3. Lifecycle tag check (`isLifecycleTombstone`) — if true, cache
 *      and return true.
 *   4. Body fallback: resolve body via `bodyResolver`, evaluate
 *      `isContentTombstone`, cache, return.
 *
 * The cache write happens for every code path that returns from a
 * non-cached lookup (steps 2, 3, 4) so subsequent checks for the same
 * FQID resolve in O(1).
 *
 * @implements {DD018.§3.DC.35}
 */
export function isTombstoned(ctx: TombstoneCheckContext): boolean {
  if (ctx.cache.has(ctx.fqid)) {
    return ctx.cache.get(ctx.fqid)!;
  }

  if (ctx.entry === undefined) {
    ctx.cache.set(ctx.fqid, false);
    return false;
  }

  if (isLifecycleTombstone(ctx.entry.lifecycle)) {
    ctx.cache.set(ctx.fqid, true);
    return true;
  }

  const body = ctx.bodyResolver(ctx.entry);
  const result = isContentTombstone(body);
  ctx.cache.set(ctx.fqid, result);
  return result;
}
