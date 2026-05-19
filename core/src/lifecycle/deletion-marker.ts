/**
 * Deletion marker — canonical source for the tombstoned-reference format
 * produced by the hard-delete operation under R015.
 *
 * Marker shape per {R015.§2.AC.01}: `_deleted_<ORIGINAL_NOTE_ID>_at_<TIMESTAMP>`.
 * Timestamp is `YYYYMMDD` under date-precision, compact numeric datetime
 * (`YYYYMMDDHHMM` or finer) under datetime-precision. No separators.
 *
 * Parser-invisibility per {R015.§2.AC.02}: the leading `_` ensures the
 * marker fails the note-ID validator `/^[A-Z]{1,5}\d{3,5}$/`, so it cannot
 * be mistaken for a live note ID at the parser stage.
 *
 * Per {R015.§7.AC.02} and {DD020.§1.DC.04}, this module is the SINGLE
 * canonical source for marker construction and recognition. No other
 * source file in the project may construct or recognize the marker by
 * ad-hoc regex — every consumer (rewriter, linter, trace, gaps, reference
 * manager, show handler, VS Code providers) MUST import from this module.
 *
 * @implements {R015.§2.AC.01} marker format
 * @implements {R015.§2.AC.02} parser-invisibility property
 * @implements {R015.§2.AC.04} marker recognition regex
 * @implements {R015.§2.AC.05} sole producer of rewriter-emitted lifecycle markers
 * @implements {R015.§7.AC.02} single canonical source
 * @implements {DD020.§1.DC.04} no other source file constructs or recognizes the marker
 * @implements {DD020.§1.DC.06} sole producer of rewriter-emitted lifecycle markers
 */

import type { SCEpterConfig } from '../types/config';

/**
 * Canonical recognition regex for deletion markers.
 *
 * Capture group 1: original note ID (the value that was being retired).
 * Capture group 2: timestamp (8 or more digits — accommodates `YYYYMMDD`
 * and the compact datetime forms `YYYYMMDDHHMM`/finer per {R015.§2.AC.04}).
 *
 * @implements {DD020.§1.DC.03} regex matches `_deleted_(NOTE_ID)_at_(TIMESTAMP)`
 */
export const DELETION_MARKER_RE = /_deleted_([A-Z]{1,5}\d{3,5})_at_(\d{8,})/;

/**
 * Anchored form of the marker regex for whole-token tests.
 *
 * The unanchored `DELETION_MARKER_RE` is the public-facing recognition
 * pattern used for sub-string matches (e.g., inside a longer reference
 * like `_deleted_R005_at_20260519.§1.AC.03`). The anchored form is used
 * by `isDeletionMarker` and `parseDeletionMarker` which receive bare
 * tokens.
 */
const DELETION_MARKER_ANCHORED_RE = /^_deleted_([A-Z]{1,5}\d{3,5})_at_(\d{8,})$/;

/**
 * The project's timestamp precision setting.
 *
 * Sourced from {DD020.§1.DC.05}: the *setting* is shared with the rewrite-log
 * filename timestamp (per {R015.§6.AC.08}). The marker module owns its own
 * compact-numeric formatter rather than reusing the existing
 * `NoteFileManager#formatTimestamp`, which produces `YYYY-MM-DD` (hyphenated)
 * under date-precision and ISO 8601 (with `T:Z` separators) under
 * datetime-precision — neither of which is the compact form required by
 * {R015.§2.AC.01}.
 */
export type TimestampPrecision = NonNullable<SCEpterConfig['timestampPrecision']>;

/**
 * Format a `Date` as a compact-numeric marker timestamp.
 *
 * - `'date'` precision: `YYYYMMDD` (8 digits)
 * - `'datetime'` precision: `YYYYMMDDHHMM` (12 digits)
 *
 * The choice of minute-precision under `'datetime'` matches the example
 * given in {R015.§2.AC.01} (`_deleted_R005_at_202605191430`) and is the
 * minimum permitted by {R015.§2.AC.04}'s `\d{8,}` floor.
 *
 * UTC is used so the marker is stable across runtime timezone changes.
 *
 * @implements {DD020.§1.DC.05} marker timestamp consumes `timestampPrecision`
 */
export function formatMarkerTimestamp(
  date: Date,
  precision: TimestampPrecision,
): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  const base = `${yyyy}${mm}${dd}`;
  if (precision === 'datetime') {
    const hh = date.getUTCHours().toString().padStart(2, '0');
    const min = date.getUTCMinutes().toString().padStart(2, '0');
    return `${base}${hh}${min}`;
  }
  return base;
}

/**
 * Construct a deletion marker for a given original note ID and run date.
 *
 * The same marker token is intended to be reused for every span rewritten
 * within a single hard-delete run, per {DD020.§4.DC.03}. Callers compute
 * the marker once at the start of the run and pass it to every span
 * substitution.
 *
 * @implements {DD020.§1.DC.01} construct marker from original ID + date + precision
 */
export function formatDeletionMarker(
  originalId: string,
  date: Date,
  precision: TimestampPrecision,
): string {
  return `_deleted_${originalId}_at_${formatMarkerTimestamp(date, precision)}`;
}

/**
 * Predicate: does this bare token match the deletion-marker shape?
 *
 * Returns `false` for any token that satisfies the live note-ID
 * validator `/^[A-Z]{1,5}\d{3,5}$/` — the marker's leading underscore
 * guarantees this disjointness.
 *
 * @implements {DD020.§1.DC.02} predicate disjoint from note-ID validator
 */
export function isDeletionMarker(token: string): boolean {
  return DELETION_MARKER_ANCHORED_RE.test(token);
}

/**
 * Recover the original note ID and timestamp from a deletion-marker token.
 *
 * Returns `null` if the token does not match the marker shape. The function
 * is the symmetric inverse of `formatDeletionMarker` and is the
 * provenance-display surface consumed by `scepter ctx show <marker>` and
 * the VS Code hover provider per {R015.§11.AC.02}.
 *
 * @implements {DD020.§1.DC.07} symmetric inverse of formatDeletionMarker
 */
export function parseDeletionMarker(
  token: string,
): { originalId: string; timestamp: string } | null {
  const match = DELETION_MARKER_ANCHORED_RE.exec(token);
  if (!match) {
    return null;
  }
  return { originalId: match[1], timestamp: match[2] };
}
