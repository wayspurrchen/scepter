/**
 * Suffix-grammar ingest reconciliation.
 *
 * Translates the inline metadata tokens authors write on claim headings (the
 * R005-era `:5:closed:reviewer=alice:derives=R001.§1.AC.01` shorthand) into
 * `MetadataEvent`s with `actor="author:<notepath>"`. The reconciliation is
 * incremental: only delta events between the author's current declarations
 * and the existing `author:` events in the store are produced.
 *
 * CLI-written events (no `author:` prefix) are NEVER touched by this path —
 * they live independently of author intent. This is what allows author edits
 * and CLI writes to coexist on the same key.
 *
 * @implements {A004.§3.AC.01} Author ingest produces events with author:<notepath> actor
 * @implements {A004.§3.AC.02} Lossless normalization of bare-token shorthand
 * @implements {A004.§3.AC.03} Incremental, one event per token added or retracted
 * @implements {A004.§3.AC.04} Unchanged tokens emit nothing (re-ingest is no-op)
 * @implements {DD014.§3.DC.38} reconcileNoteEvents returns toAppend/toRetract deltas
 * @implements {DD014.§3.DC.39} Bare-token shorthand normalization table
 * @implements {DD014.§3.DC.40} Generated events use op=add, actor=author:<notepath>
 * @implements {DD014.§3.DC.41} Incremental reconciliation, per-token granularity
 * @implements {DD014.§3.DC.42} Idempotent re-ingest of unchanged tokens
 * @implements {DD014.§3.DC.43} CLI-written events untouched by reconciliation
 */

import { createId } from '@paralleldrive/cuid2';
import type { MetadataEvent, MetadataStore } from './metadata-event.js';
import { applyFold } from './metadata-event.js';
import { isLifecycleTag, isDerivationTag } from './claim-metadata.js';

/**
 * The minimal projection of a claim entry required by the ingest path.
 * Mirrors the shape used by `ClaimIndexEntry` (see `claim-index.ts`) but
 * narrowed to the fields the reconciler actually reads.
 */
export interface IngestClaimEntry {
  /** Fully qualified claim ID (e.g., `R009.§1.AC.01` or `R009.1.AC.01`). */
  fullyQualified: string;
  /** Raw suffix tokens parsed from the claim heading or paragraph. */
  metadata: string[];
}

export interface ReconcileResult {
  toAppend: MetadataEvent[];
  toRetract: MetadataEvent[];
}

/**
 * Translate a single suffix token into one or more `(key, value)` pairs.
 * Pure function over the §DC.39 normalization table.
 *
 * @implements {DD014.§3.DC.39}
 */
export function tokenToKeyValues(token: string): Array<{ key: string; value: string }> {
  // Bare digit 1-5 → importance
  if (/^[1-5]$/.test(token)) {
    return [{ key: 'importance', value: token }];
  }
  // derives=TARGET
  if (isDerivationTag(token)) {
    return [{ key: 'derives', value: token.slice('derives='.length) }];
  }
  // superseded=TARGET → TWO events (lifecycle + supersededBy)
  if (token.startsWith('superseded=') && token.length > 'superseded='.length) {
    return [
      { key: 'lifecycle', value: 'superseded' },
      { key: 'supersededBy', value: token.slice('superseded='.length) },
    ];
  }
  // bare lifecycle keyword (closed/deferred/removed)
  if (isLifecycleTag(token)) {
    return [{ key: 'lifecycle', value: token }];
  }
  // KEY=VALUE general form
  const eq = token.indexOf('=');
  if (eq > 0) {
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    return [{ key, value }];
  }
  // Freeform (digit-less, no `=`) → tag=<token>
  return [{ key: 'tag', value: token }];
}

/**
 * Build the `actor` string used by ingest-emitted events.
 *
 * @implements {DD014.§3.DC.40}
 */
export function authorActor(notePath: string): string {
  return `author:${notePath}`;
}

/**
 * Reconcile a note's current claim declarations against the existing
 * `author:` events in the metadata store.
 *
 * For each `(claimId, key, value)` triple the author currently declares:
 *   - If the key/value already exists in the folded state for that claim and
 *     the author is the source, emit nothing.
 *   - Otherwise, emit an `add` event.
 *
 * For each `(claimId, key, value)` event already in the store with this
 * note's `author:<notepath>` actor:
 *   - If the corresponding token is no longer in the author's declarations,
 *     emit a `retract` event.
 *
 * @implements {DD014.§3.DC.38}
 * @implements {DD014.§3.DC.41}
 * @implements {DD014.§3.DC.42}
 * @implements {DD014.§3.DC.43}
 *
 * @param notePath - Project-root-relative path of the note file (used to
 *   build the `author:` actor and to discriminate this note's events from
 *   other notes' events).
 * @param entries - Current claim declarations (one entry per claim with its
 *   raw suffix tokens).
 * @param store - The current metadata store (read-only; the caller commits
 *   the returned events).
 * @param eventDate - ISO 8601 datetime to stamp emitted events. The DD's
 *   §DC.40 prescribes the note file mtime; the caller resolves and supplies
 *   it (the ingest module is filesystem-agnostic by design).
 */
export function reconcileNoteEvents(
  notePath: string,
  entries: IngestClaimEntry[],
  store: MetadataStore,
  eventDate: string,
): ReconcileResult {
  const actor = authorActor(notePath);
  const toAppend: MetadataEvent[] = [];
  const toRetract: MetadataEvent[] = [];

  // Index this note's existing author events by (claimId, key, value).
  // We need to know what is currently in the folded state from this author,
  // and what the author had previously declared so we can retract removed ones.
  const declaredByClaim = new Map<string, Set<string>>();
  for (const entry of entries) {
    const triples = new Set<string>();
    for (const token of entry.metadata) {
      for (const kv of tokenToKeyValues(token)) {
        triples.add(`${kv.key}=${kv.value}`);
      }
    }
    declaredByClaim.set(entry.fullyQualified, triples);
  }

  // Walk each claim the author currently mentions and emit add events for
  // missing tokens.
  for (const entry of entries) {
    const claimEvents = store[entry.fullyQualified] ?? [];
    const folded = applyFold(claimEvents);

    // Only consider this note's author events when deciding whether the
    // value is already authored — values from other notes or the CLI are
    // independent and must not suppress an add for this author.
    const authorContributedValues = new Map<string, Set<string>>();
    for (const event of claimEvents) {
      if (event.actor !== actor) continue;
      // Walk the event log for this author and reconstruct the (key, value)
      // set the author currently has on record. `add` adds, `retract`
      // removes; `set`/`unset` are CLI ops and don't appear with the
      // `author:` prefix per the discipline.
      const set = authorContributedValues.get(event.key) ?? new Set<string>();
      if (event.op === 'add') set.add(event.value);
      else if (event.op === 'retract') set.delete(event.value);
      authorContributedValues.set(event.key, set);
    }

    const declared = declaredByClaim.get(entry.fullyQualified)!;
    for (const triple of declared) {
      const eq = triple.indexOf('=');
      const key = triple.slice(0, eq);
      const value = triple.slice(eq + 1);
      const folded_values = folded[key] ?? [];
      const author_values = authorContributedValues.get(key) ?? new Set<string>();
      // Emit only if THIS author is not already on record for this value.
      // If a CLI event (different actor) contributed the same value, we
      // still emit so retract on author edit can correctly distinguish.
      if (!author_values.has(value)) {
        toAppend.push({
          id: createId(),
          claimId: entry.fullyQualified,
          key,
          value,
          op: 'add',
          actor,
          date: eventDate,
          note: 'inline',
        });
      } else if (!folded_values.includes(value)) {
        // Author is on record but the value was retracted later by some
        // other event; emit add to re-establish.
        toAppend.push({
          id: createId(),
          claimId: entry.fullyQualified,
          key,
          value,
          op: 'add',
          actor,
          date: eventDate,
          note: 'inline',
        });
      }
    }

    // For each `(key, value)` this author had previously contributed but is
    // no longer declaring, emit a retract.
    for (const [key, values] of authorContributedValues.entries()) {
      for (const value of values) {
        if (!declared.has(`${key}=${value}`)) {
          toRetract.push({
            id: createId(),
            claimId: entry.fullyQualified,
            key,
            value,
            op: 'retract',
            actor,
            date: eventDate,
            note: 'inline',
          });
        }
      }
    }
  }

  return { toAppend, toRetract };
}

/**
 * Inverse of `tokenToKeyValues`: given a folded state, produce a
 * `ParsedMetadata`-style projection (importance, lifecycle, tags, derivedFrom)
 * for use in tests that verify the lossless invariant against
 * `parseClaimMetadata`.
 *
 * Not a public API of the ingest module — exported solely for the lossless
 * test in `claim-metadata.lossless.test.ts`.
 */
export function reconstructFromFold(folded: Record<string, string[]>): {
  importance?: number;
  lifecycle?: { type: string; target?: string };
  tags: string[];
  derivedFrom: string[];
} {
  const tags: string[] = [];
  const derivedFrom: string[] = [];
  let importance: number | undefined;
  let lifecycle: { type: string; target?: string } | undefined;

  const importanceValues = folded['importance'] ?? [];
  if (importanceValues.length > 0) {
    importance = parseInt(importanceValues[0], 10);
  }

  const lifecycleValues = folded['lifecycle'] ?? [];
  if (lifecycleValues.length > 0) {
    const type = lifecycleValues[0];
    if (type === 'superseded') {
      const target = (folded['supersededBy'] ?? [])[0];
      lifecycle = target !== undefined ? { type, target } : { type };
    } else {
      lifecycle = { type };
    }
  }

  const derivesValues = folded['derives'] ?? [];
  for (const value of derivesValues) {
    derivedFrom.push(value);
  }

  const tagValues = folded['tag'] ?? [];
  for (const value of tagValues) {
    tags.push(value);
  }

  const result: ReturnType<typeof reconstructFromFold> = { tags, derivedFrom };
  if (importance !== undefined) result.importance = importance;
  if (lifecycle !== undefined) result.lifecycle = lifecycle;
  return result;
}
