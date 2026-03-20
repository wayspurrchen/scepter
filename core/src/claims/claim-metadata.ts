/**
 * Claim metadata interpreter for SCEpter.
 *
 * Takes raw metadata strings from the parser layer and interprets
 * them into structured importance, lifecycle, and tag data.
 *
 * The parser layer (parseMetadataSuffix) produces raw string arrays.
 * This module interprets those strings semantically.
 *
 * @implements {R005.§1.AC.01} Bare digit 1-5 recognized as importance level
 * @implements {R005.§1.AC.05} Digits outside 1-5 treated as freeform tags
 * @implements {R005.§2.AC.01} Lifecycle tags parsed: closed, deferred, removed, superseded
 * @implements {R005.§2.AC.07} Multiple lifecycle tags use first; lint catches separately
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Recognized lifecycle state types for claims.
 * @implements {R005.§2.AC.01}
 */
export type LifecycleType = 'closed' | 'deferred' | 'removed' | 'superseded';

/**
 * Lifecycle state of a claim.
 * `target` is only present when type is 'superseded', pointing to the
 * fully qualified claim ID that replaces this one.
 * @implements {R005.§2.AC.01}
 */
export interface LifecycleState {
  type: LifecycleType;
  target?: string;
}

/**
 * Structured interpretation of raw metadata strings.
 * @implements {R005.§1.AC.01} importance from bare digit 1-5
 * @implements {R005.§2.AC.01} lifecycle from recognized tags
 * @implements {R006.§1.AC.01} derivedFrom from derives=TARGET metadata
 */
export interface ParsedMetadata {
  importance?: number;
  lifecycle?: LifecycleState;
  tags: string[];
  derivedFrom: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The fixed vocabulary of recognized lifecycle tags.
 * @implements {R005.§2.AC.01}
 */
export const LIFECYCLE_TAGS: readonly string[] = [
  'closed',
  'deferred',
  'removed',
  'superseded',
] as const;

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Check whether a metadata string is a recognized lifecycle tag.
 *
 * Returns true for exact matches to the four lifecycle keywords,
 * or for the `superseded=TARGET` pattern.
 *
 * @implements {R005.§2.AC.01}
 */
export function isLifecycleTag(tag: string): boolean {
  if (LIFECYCLE_TAGS.includes(tag)) {
    return true;
  }
  if (tag.startsWith('superseded=') && tag.length > 'superseded='.length) {
    return true;
  }
  return false;
}

/**
 * Check whether a metadata string is a derivation tag.
 *
 * Returns true if the tag starts with `derives=` and has a non-empty target.
 * Derivation is a relationship, not a lifecycle state — it records
 * which source claim a derived claim was decomposed from.
 *
 * @implements {R006.§1.AC.01} derives=TARGET recognition
 */
export function isDerivationTag(tag: string): boolean {
  if (tag.startsWith('derives=') && tag.length > 'derives='.length) {
    return true;
  }
  return false;
}

/**
 * Interpret raw metadata strings into structured importance, lifecycle,
 * and tag data.
 *
 * Interpretation rules:
 * 1. A bare digit 1-5 sets importance (first wins if multiple)
 * 2. An exact lifecycle keyword or `superseded=TARGET` sets lifecycle (first wins)
 * 3. Digits outside 1-5 become freeform tags
 * 4. Everything else becomes a freeform tag
 *
 * If multiple lifecycle tags are present, only the first is used. The linter
 * validates this as an error separately (R005.§2.AC.07).
 *
 * @implements {R005.§1.AC.01} Bare digit 1-5 as importance
 * @implements {R005.§1.AC.05} Digits outside 1-5 as freeform tags
 * @implements {R005.§2.AC.01} Lifecycle tag extraction
 * @implements {R005.§2.AC.07} Multiple lifecycle tags: use first
 * @implements {R006.§1.AC.01} derives=TARGET extraction to derivedFrom[]
 * @implements {R006.§1.AC.02} Multiple derives= entries independently collected
 * @implements {R006.§1.AC.04} Derivation coexists with lifecycle (separate concern)
 */
export function parseClaimMetadata(rawMetadata: string[]): ParsedMetadata {
  let importance: number | undefined;
  let lifecycle: LifecycleState | undefined;
  const tags: string[] = [];
  const derivedFrom: string[] = [];

  for (const item of rawMetadata) {
    // Rule 1: bare digit 1-5 → importance (first wins)
    if (/^\d$/.test(item)) {
      const digit = parseInt(item, 10);
      if (digit >= 1 && digit <= 5) {
        if (importance === undefined) {
          importance = digit;
        }
        continue;
      }
      // Rule 3: digits outside 1-5 → freeform tag
      tags.push(item);
      continue;
    }

    // @implements {R006.§1.AC.01} Derivation check BEFORE lifecycle
    // derives= is a relationship, not a lifecycle state, and must not
    // interfere with lifecycle processing
    if (isDerivationTag(item)) {
      const target = item.slice('derives='.length);
      derivedFrom.push(target);
      continue;
    }

    // Rule 2: lifecycle tag detection (first wins)
    if (isLifecycleTag(item)) {
      if (lifecycle === undefined) {
        if (item.startsWith('superseded=')) {
          const target = item.slice('superseded='.length);
          lifecycle = { type: 'superseded', target };
        } else {
          lifecycle = { type: item as LifecycleType };
        }
      }
      // Multiple lifecycle tags: skip subsequent ones (lint catches this)
      continue;
    }

    // Rule 4: everything else → freeform tag
    tags.push(item);
  }

  const result: ParsedMetadata = { tags, derivedFrom };
  if (importance !== undefined) result.importance = importance;
  if (lifecycle !== undefined) result.lifecycle = lifecycle;
  return result;
}
