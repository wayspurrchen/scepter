/**
 * Generalized claim metadata event log.
 *
 * Replaces the legacy VerificationEvent/VerificationStore with a key/value
 * event log that admits arbitrary metadata per claim. Each event names an op
 * (`add`, `set`, `unset`, `retract`) over a `(claimId, key)` tuple. The fold
 * rule (applyFold) projects the chronologically-ordered event sequence for a
 * single claim into the current key → values[] state.
 *
 * The "verified" semantic of the legacy verify CLI maps onto this store as
 * `key="verified"`, `value="true"` add events; the legacy `--remove` semantic
 * maps onto an `unset` event.
 *
 * @implements {A004.§2.AC.01} MetadataEvent interface (eight fields)
 * @implements {A004.§1.AC.02} Closed op vocabulary (add/set/unset/retract)
 * @implements {A004.§1.AC.03} Fold rule producing Record<key, string[]>
 * @implements {DD014.§3.DC.01} MetadataEvent has exactly the eight named fields
 * @implements {DD014.§3.DC.02} `id` is a 24-char cuid2, ordering by array position
 * @implements {DD014.§3.DC.03} `claimId` is a fully qualified claim ID string
 * @implements {DD014.§3.DC.04} `key` matches /^[a-z][a-z0-9._-]*$/ (validated upstream)
 * @implements {DD014.§3.DC.05} `value` empty iff op is `unset`
 * @implements {DD014.§3.DC.06} `op` is one of `add` | `set` | `unset` | `retract`
 * @implements {DD014.§3.DC.07} `actor` carries `author:<notepath>` prefix discipline
 * @implements {DD014.§3.DC.08} `MetadataStore` is `Record<claimId, MetadataEvent[]>`
 * @implements {DD014.§3.DC.09} `EventFilter` shape
 * @implements {DD014.§3.DC.09a} `applyFold` is the canonical fold rule
 */

/**
 * A single event in the metadata log for one claim.
 *
 * The event is the wire format, the storage format, and the in-memory format —
 * no separate "row" or "record" type. Every reader, writer, migration, and
 * ingest path operates on this exact shape.
 */
export interface MetadataEvent {
  /**
   * 24-character cuid2 string generated at append time.
   * Not time-sortable; ordering is by event-array position.
   */
  id: string;

  /** Fully qualified claim ID, e.g., `R009.§1.AC.01` or `R009.1.AC.01`. */
  claimId: string;

  /** Key matching `/^[a-z][a-z0-9._-]*$/`. Validation is the caller's job. */
  key: string;

  /** Value string. Empty iff `op === "unset"`. */
  value: string;

  /** Closed vocabulary of op kinds. */
  op: 'add' | 'set' | 'unset' | 'retract';

  /**
   * Free-form actor identifier. Implicit author events use `author:<notepath>`;
   * CLI events use the OS username (no prefix).
   */
  actor: string;

  /**
   * ISO 8601 datetime string (e.g., `2026-04-25T15:30:42.123Z`).
   * Date-only `YYYY-MM-DD` input is normalized to start-of-day UTC by callers.
   */
  date: string;

  /** Optional free-form note attached to the event. */
  note?: string;
}

/**
 * The metadata store: claimId → chronologically-ordered events for that claim.
 *
 * @implements {DD014.§3.DC.08}
 */
export type MetadataStore = Record<string, MetadataEvent[]>;

/**
 * Query filter for events. Phase-1 implementations support at minimum
 * `claimId` and `key`; the others are accepted but may be ignored until
 * Phase-2 wires them through the storage adapter.
 *
 * @implements {DD014.§3.DC.09}
 * @implements {A004.§2.AC.02}
 */
export interface EventFilter {
  claimId?: string;
  key?: string;
  actor?: string;
  op?: MetadataEvent['op'];
  /** ISO 8601 inclusive lower bound on `date`. */
  since?: string;
  /** ISO 8601 inclusive upper bound on `date`. */
  until?: string;
}

/**
 * Pure fold over a chronologically-ordered event array for a single claim.
 *
 * | Op       | Effect on values[] for that key                                        |
 * |----------|------------------------------------------------------------------------|
 * | add      | Append value if not present (idempotent at the view level)             |
 * | set      | Clear values[], then append value (atomic replace)                     |
 * | unset    | Clear values[] (event's value field is "")                             |
 * | retract  | Remove value from values[] if present; no-op if absent                 |
 *
 * Keys with empty `values[]` after the fold are excluded from the result.
 * The fold is deterministic: the same event sequence produces the same state.
 *
 * @implements {DD014.§3.DC.08} Fold rule for the four ops
 * @implements {DD014.§3.DC.09a} Canonical pure-function fold
 * @implements {A004.§1.AC.03}
 */
export function applyFold(events: MetadataEvent[]): Record<string, string[]> {
  const state: Record<string, string[]> = {};
  for (const event of events) {
    const { key, value, op } = event;
    switch (op) {
      case 'add': {
        const current = state[key] ?? [];
        if (!current.includes(value)) {
          current.push(value);
        }
        state[key] = current;
        break;
      }
      case 'set': {
        state[key] = [value];
        break;
      }
      case 'unset': {
        state[key] = [];
        break;
      }
      case 'retract': {
        const current = state[key] ?? [];
        const idx = current.indexOf(value);
        if (idx >= 0) {
          current.splice(idx, 1);
        }
        state[key] = current;
        break;
      }
    }
  }
  // Remove keys whose values[] is empty after the fold.
  const result: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(state)) {
    if (values.length > 0) {
      result[key] = values;
    }
  }
  return result;
}
