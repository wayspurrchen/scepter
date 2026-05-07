/**
 * Diff engine for the snapshot subsystem.  Pure transformation —
 * loads both sides into the uniform `SnapshotSide` shape, computes
 * set differences and content drift across the six categories, and
 * evaluates the regression gate.  Output formatting lives in
 * `snapshot-formatter.ts`; this module produces only structured data.
 *
 * The engine is intentionally decoupled from filesystem I/O: all
 * body-content access flows through `tombstoneCtx.bodyResolver`,
 * which the caller wires up.  This keeps the engine testable with
 * synthetic inputs and enforces the {R014.§8.AC.03} no-body-bytes
 * invariant (see §DC.54a).
 *
 * @implements {DD018.§3.DC.37} loadSnapshotSide — wrap readSnapshot, index into Maps
 * @implements {DD018.§3.DC.38} liveSide — captureSnapshot in-memory and index into Maps
 * @implements {DD018.§3.DC.47} computeDiff entry point with four-stage pipeline
 * @implements {DD018.§3.DC.48} stage 2 set difference: lostClaims + newClaims
 * @implements {DD018.§3.DC.49} stage 3 content drift across heading/metadata + source/note refs
 * @implements {DD018.§3.DC.50} stage 4 untombstoned-loss regression
 * @implements {DD018.§3.DC.51} stage 4 dangling-source-coverage regression
 * @implements {DD018.§3.DC.51a} derivedFrom set-minus shrinkage detection
 * @implements {DD018.§3.DC.51b} derived-from-shrinkage regression with tombstone exemption
 * @implements {DD018.§3.DC.53} snapshot-vs-snapshot lifecycle-tag fallback
 * @implements {DD018.§3.DC.54} body-access boundary: no direct getAggregatedContents calls
 * @implements {DD018.§3.DC.54a} (with diff-command.ts §DC.75) composite enforcement of R014.§8.AC.03 — no body-content disk reads in diff
 */

import { captureSnapshot } from './snapshot-writer.js';
import type { CaptureContext } from './snapshot-writer.js';
import { readSnapshot } from './snapshot-store.js';
import { isTombstoned } from './tombstone-detector.js';
import type { Snapshot, SnapshotClaimEntry, SnapshotSourceRef } from './snapshot-types.js';
import type {
  BodyChangedFinding,
  DiffReport,
  HeadingMetadataFieldChange,
  HeadingMetadataFinding,
  LostClaimFinding,
  NewClaimFinding,
  NoteRefDriftFinding,
  RegressionFinding,
  SnapshotSide,
  SourceRefDriftFinding,
  TombstoneContext,
} from './diff-types.js';

// ---------------------------------------------------------------------------
// Loading sides
// ---------------------------------------------------------------------------

/**
 * Read a snapshot file from disk and index its claims and notes into
 * the `SnapshotSide` Maps for O(1) FQID lookup during diff.
 *
 * Schema-version validation lives in `readSnapshot` — this loader
 * does not duplicate it.  A `SnapshotSchemaError` from the underlying
 * read propagates verbatim.
 *
 * @implements {DD018.§3.DC.37}
 */
export async function loadSnapshotSide(filePath: string): Promise<SnapshotSide> {
  const snapshot: Snapshot = await readSnapshot(filePath);
  return indexSnapshotAsSide(snapshot, 'snapshot');
}

/**
 * Capture the live claim index in-memory (no file write) and index
 * the result into the `SnapshotSide` Maps.  The caller is responsible
 * for ensuring the claim index is populated (typically via
 * `ensureIndex`) before invoking this.
 *
 * @implements {DD018.§3.DC.38}
 */
export async function liveSide(ctx: CaptureContext): Promise<SnapshotSide> {
  const snapshot = await captureSnapshot(ctx);
  return indexSnapshotAsSide(snapshot, 'live');
}

/**
 * Translate a `Snapshot` value (from disk or in-memory capture) into
 * the `SnapshotSide` Map shapes.  `kind: 'live'` sides drop the
 * metadata block per §DC.36.
 */
function indexSnapshotAsSide(snapshot: Snapshot, kind: 'snapshot' | 'live'): SnapshotSide {
  const claims = new Map<string, SnapshotClaimEntry>();
  for (const claim of snapshot.claims) {
    claims.set(claim.fqid, claim);
  }
  const notes = new Map<string, Snapshot['notes'][number]>();
  for (const note of snapshot.notes) {
    notes.set(note.noteId, note);
  }
  return {
    kind,
    claims,
    notes,
    metadata: kind === 'live' ? null : snapshot.metadata,
  };
}

// ---------------------------------------------------------------------------
// computeDiff
// ---------------------------------------------------------------------------

export interface ComputeDiffContext {
  baseline: SnapshotSide;
  candidate: SnapshotSide;
  /**
   * When `null`, the regression-gate stage is skipped entirely and
   * `regressions` is empty.  Synthetic test fixtures pass `null` to
   * isolate stages 2-3 from stage 4.
   */
  tombstoneCtx: TombstoneContext | null;
}

/**
 * Compute a structured `DiffReport` from a baseline + candidate pair.
 *
 * Performs four stages in order:
 *   1. (Implicit) Both sides already loaded as `SnapshotSide`.
 *   2. Set difference → `lostClaims`, `newClaims`.
 *   3. Shared-FQID content drift → `bodyChanged`,
 *      `headingOrMetadataChanged`, `sourceRefDrift`,
 *      `incomingNoteRefDrift`.
 *   4. Regression gate → `regressions` plus
 *      `LostClaimFinding.isRegression` flags.  Skipped when
 *      `tombstoneCtx` is null.
 *
 * `LostClaimFinding.isRegression` is computed on every diff path that
 * supplies a `tombstoneCtx`; the `--regressions` flag controls only
 * exit-code interpretation and suggestion-line emission, not whether
 * the flag is set per §DC.47.
 *
 * @implements {DD018.§3.DC.47}
 */
export function computeDiff(ctx: ComputeDiffContext): DiffReport {
  const { baseline, candidate, tombstoneCtx } = ctx;

  // Stage 2: set difference.
  const lostClaims: LostClaimFinding[] = [];
  const newClaims: NewClaimFinding[] = [];

  for (const [fqid, entry] of baseline.claims) {
    if (!candidate.claims.has(fqid)) {
      lostClaims.push({
        fqid,
        baselineHeading: entry.heading,
        baselineLifecycle: entry.lifecycle,
        // Default false; stage 4 may flip it.
        isRegression: false,
      });
    }
  }

  for (const [fqid, entry] of candidate.claims) {
    if (!baseline.claims.has(fqid)) {
      newClaims.push({
        fqid,
        candidateHeading: entry.heading,
        candidateLifecycle: entry.lifecycle,
      });
    }
  }

  // Determinism: stable ordering of findings by FQID.  Map iteration
  // is insertion-order in JS but the snapshot's claims array is sorted
  // by fqid (§DC.10), so this should already be FQID-ascending; sort
  // defensively in case a future caller indexes from an unsorted
  // source.
  lostClaims.sort((a, b) => compareFqid(a.fqid, b.fqid));
  newClaims.sort((a, b) => compareFqid(a.fqid, b.fqid));

  // Stage 3: shared-FQID drift.
  const bodyChanged: BodyChangedFinding[] = [];
  const headingOrMetadataChanged: HeadingMetadataFinding[] = [];
  const sourceRefDrift: SourceRefDriftFinding[] = [];
  const incomingNoteRefDrift: NoteRefDriftFinding[] = [];

  // Track per-claim derivedFrom shrinkage for the §DC.51b regression
  // pass below.  Computed inside the heading/metadata loop so we
  // walk the shared set once.
  const lostDerivationsByFqid = new Map<string, string[]>();

  for (const [fqid, baselineClaim] of baseline.claims) {
    const candidateClaim = candidate.claims.get(fqid);
    if (!candidateClaim) continue; // Lost — handled in stage 2.

    // Body hash drift.
    if (baselineClaim.bodyHash !== candidateClaim.bodyHash) {
      bodyChanged.push({
        fqid,
        baselineBodyHash: baselineClaim.bodyHash,
        candidateBodyHash: candidateClaim.bodyHash,
      });
    }

    // Heading/metadata drift — collect every differing field into a
    // single finding per claim.
    const changes: HeadingMetadataFieldChange[] = [];

    if (baselineClaim.heading !== candidateClaim.heading) {
      changes.push({
        field: 'heading',
        baseline: baselineClaim.heading,
        candidate: candidateClaim.heading,
      });
    }

    if (!lifecycleEqual(baselineClaim.lifecycle, candidateClaim.lifecycle)) {
      changes.push({
        field: 'lifecycle',
        baseline: baselineClaim.lifecycle,
        candidate: candidateClaim.lifecycle,
      });
    }

    if (baselineClaim.importance !== candidateClaim.importance) {
      changes.push({
        field: 'importance',
        baseline: baselineClaim.importance,
        candidate: candidateClaim.importance,
      });
    }

    if (!setEqual(baselineClaim.derivedFrom, candidateClaim.derivedFrom)) {
      changes.push({
        field: 'derivedFrom',
        baseline: [...baselineClaim.derivedFrom].sort(),
        candidate: [...candidateClaim.derivedFrom].sort(),
      });
    }

    if (changes.length > 0) {
      headingOrMetadataChanged.push({ fqid, changes });
    }

    // §DC.51a — set-minus baseline `\` candidate for derivedFrom.
    // Growth (candidate \ baseline) is NOT a regression input, only
    // shrinkage.
    const lostDerivations = setMinus(baselineClaim.derivedFrom, candidateClaim.derivedFrom);
    if (lostDerivations.length > 0) {
      lostDerivationsByFqid.set(fqid, lostDerivations);
    }

    // Source-ref drift: equality on (filePath, line, refKind) per §DC.44.
    const srcDrift = computeSourceRefDrift(baselineClaim.incomingSourceRefs, candidateClaim.incomingSourceRefs);
    if (srcDrift.lost.length > 0 || srcDrift.gained.length > 0) {
      sourceRefDrift.push({ fqid, ...srcDrift });
    }

    // Incoming note-ref drift: simple FQID set diff per §DC.45.
    const noteDrift = computeNoteRefDrift(baselineClaim.incomingNoteRefs, candidateClaim.incomingNoteRefs);
    if (noteDrift.lost.length > 0 || noteDrift.gained.length > 0) {
      incomingNoteRefDrift.push({ fqid, ...noteDrift });
    }
  }

  bodyChanged.sort((a, b) => compareFqid(a.fqid, b.fqid));
  headingOrMetadataChanged.sort((a, b) => compareFqid(a.fqid, b.fqid));
  sourceRefDrift.sort((a, b) => compareFqid(a.fqid, b.fqid));
  incomingNoteRefDrift.sort((a, b) => compareFqid(a.fqid, b.fqid));

  // Stage 4: regression gate.
  const regressions: RegressionFinding[] = [];

  if (tombstoneCtx !== null) {
    // (a) untombstoned-loss for each lost claim.
    for (const lost of lostClaims) {
      const tombstoned = tombstoneStatusForFqid(lost.fqid, candidate, tombstoneCtx);
      if (!tombstoned) {
        lost.isRegression = true;
        regressions.push({
          kind: 'untombstoned-loss',
          fqid: lost.fqid,
          baselineSourceRefCount: 0,
          suggestedTombstoneTag: ':removed',
          locationHint: locationHintFor(lost.fqid, tombstoneCtx),
        });
      }
    }

    // (b) dangling-source-coverage for shared-FQID claims that lost
    //     all source refs in the candidate AND aren't tombstoned.
    for (const [fqid, baselineClaim] of baseline.claims) {
      const candidateClaim = candidate.claims.get(fqid);
      if (!candidateClaim) continue; // Lost case handled above.
      const baselineCount = baselineClaim.incomingSourceRefs.length;
      const candidateCount = candidateClaim.incomingSourceRefs.length;
      if (baselineCount > 0 && candidateCount === 0) {
        const tombstoned = tombstoneStatusForFqid(fqid, candidate, tombstoneCtx);
        if (!tombstoned) {
          regressions.push({
            kind: 'dangling-source-coverage',
            fqid,
            baselineSourceRefCount: baselineCount,
            suggestedTombstoneTag: ':removed',
            locationHint: locationHintFor(fqid, tombstoneCtx),
          });
        }
      }
    }

    // (c) derived-from-shrinkage for shared-FQID claims with non-empty
    //     lostDerivationTargets AND not tombstoned.
    for (const [fqid, lostTargets] of lostDerivationsByFqid) {
      const tombstoned = tombstoneStatusForFqid(fqid, candidate, tombstoneCtx);
      if (!tombstoned) {
        const baselineClaim = baseline.claims.get(fqid);
        regressions.push({
          kind: 'derived-from-shrinkage',
          fqid,
          baselineSourceRefCount: baselineClaim?.incomingSourceRefs.length ?? 0,
          suggestedTombstoneTag: ':removed',
          locationHint: locationHintFor(fqid, tombstoneCtx),
          lostDerivationTargets: lostTargets,
        });
      }
    }
  }

  // Determinism: order regressions by (kind, fqid) so the report is
  // byte-stable for snapshot-style tests.  The DD doesn't pin an
  // explicit order, so the engine picks one and documents it.
  regressions.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return compareFqid(a.fqid, b.fqid);
  });

  const summary = {
    lost: lostClaims.length,
    new: newClaims.length,
    bodyChanged: bodyChanged.length,
    headingOrMetadataChanged: headingOrMetadataChanged.length,
    sourceRefDrift: sourceRefDrift.length,
    incomingNoteRefDrift: incomingNoteRefDrift.length,
    regressions: regressions.length,
  };

  return {
    lostClaims,
    newClaims,
    bodyChanged,
    headingOrMetadataChanged,
    sourceRefDrift,
    incomingNoteRefDrift,
    regressions,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Tombstone-status resolution
// ---------------------------------------------------------------------------

/**
 * Resolve tombstone status for an FQID during the regression-gate
 * stage.
 *
 * Two paths:
 *   1. When the live index has an entry for the FQID, delegate to
 *      `isTombstoned` (lifecycle-tag check, falling through to the
 *      content-tombstone heuristic via the bodyResolver).  This is
 *      the candidate-is-live path.
 *   2. When the live index has no entry (snapshot-vs-snapshot mode
 *      or claim is gone from live), fall back to the candidate-side
 *      `SnapshotClaimEntry.lifecycle` field for a lifecycle-tag-only
 *      check per §DC.53.  The content-tombstone heuristic is
 *      unavailable in this fallback because snapshots don't store
 *      body text.
 *
 * The cache lives on the `tombstoneCtx` and is shared across all
 * gate paths in this diff run, so any FQID's tombstone state is
 * computed at most once per run regardless of which gate evaluated
 * it first.
 *
 * @implements {DD018.§3.DC.50}
 * @implements {DD018.§3.DC.51}
 * @implements {DD018.§3.DC.51b}
 * @implements {DD018.§3.DC.53}
 */
function tombstoneStatusForFqid(
  fqid: string,
  candidate: SnapshotSide,
  tombstoneCtx: TombstoneContext,
): boolean {
  // Cache shortcut.
  if (tombstoneCtx.cache.has(fqid)) {
    return tombstoneCtx.cache.get(fqid)!;
  }

  const liveEntry = tombstoneCtx.liveEntries.get(fqid);
  if (liveEntry !== undefined) {
    // Live-side path: full lifecycle + body-content check via
    // isTombstoned (which itself caches into the same Map).
    return isTombstoned({
      fqid,
      entry: liveEntry,
      bodyResolver: tombstoneCtx.bodyResolver,
      cache: tombstoneCtx.cache,
    });
  }

  // §DC.53 fallback: snapshot-vs-snapshot or claim-gone-from-live.
  // Lifecycle-tag-only check via the candidate-side
  // `SnapshotClaimEntry.lifecycle` field.  The on-disk
  // `SnapshotLifecycle.type` is `string`; we check directly for the
  // two tombstone vocabulary values rather than going through
  // `isLifecycleTombstone` to avoid a synthetic object construction
  // and the matching `as` cast that pretends to fix a type mismatch.
  const candidateClaim = candidate.claims.get(fqid);
  let result = false;
  if (candidateClaim?.lifecycle) {
    const type = candidateClaim.lifecycle.type;
    result = type === 'removed' || type === 'superseded';
  }
  tombstoneCtx.cache.set(fqid, result);
  return result;
}

/**
 * Resolve a `locationHint` for a regression finding from the
 * tombstone context's live-index entry.  Returns null when the live
 * index doesn't have the FQID (snapshot-vs-snapshot mode or
 * claim-gone-from-live).
 *
 * Per §DC.46, the `locationHint` is "populated from the live-index
 * `ClaimIndexEntry` when the claim still exists at definition time,
 * and `null` when not."
 */
function locationHintFor(
  fqid: string,
  tombstoneCtx: TombstoneContext,
): { filePath: string; line: number } | null {
  const entry = tombstoneCtx.liveEntries.get(fqid);
  if (!entry) return null;
  return { filePath: entry.noteFilePath, line: entry.line };
}

// ---------------------------------------------------------------------------
// Set / drift helpers
// ---------------------------------------------------------------------------

/**
 * Order-insensitive equality on FQID arrays.
 */
function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  for (const x of b) {
    if (!aSet.has(x)) return false;
  }
  return true;
}

/**
 * Order-insensitive set-minus on FQID arrays: returns elements in `a`
 * that are NOT in `b`.  Output order is the input order from `a`.
 */
function setMinus(a: string[], b: string[]): string[] {
  const bSet = new Set(b);
  const out: string[] = [];
  for (const x of a) {
    if (!bSet.has(x)) out.push(x);
  }
  return out;
}

/**
 * Deep-equal on `SnapshotLifecycle` values.  null/null match;
 * mismatched null state means inequality; otherwise compare both
 * `type` and `supersedes`.
 */
function lifecycleEqual(
  a: SnapshotClaimEntry['lifecycle'],
  b: SnapshotClaimEntry['lifecycle'],
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.type === b.type && a.supersedes === b.supersedes;
}

/**
 * Source-ref drift on a per-claim basis.  Two source-refs are equal
 * iff `filePath`, `line`, and `refKind` all match per §DC.44.
 */
function computeSourceRefDrift(
  baseline: SnapshotSourceRef[],
  candidate: SnapshotSourceRef[],
): { lost: SnapshotSourceRef[]; gained: SnapshotSourceRef[] } {
  const baselineKeys = new Map<string, SnapshotSourceRef>();
  for (const r of baseline) {
    baselineKeys.set(srcRefKey(r), r);
  }
  const candidateKeys = new Map<string, SnapshotSourceRef>();
  for (const r of candidate) {
    candidateKeys.set(srcRefKey(r), r);
  }

  const lost: SnapshotSourceRef[] = [];
  for (const [key, r] of baselineKeys) {
    if (!candidateKeys.has(key)) lost.push(r);
  }
  const gained: SnapshotSourceRef[] = [];
  for (const [key, r] of candidateKeys) {
    if (!baselineKeys.has(key)) gained.push(r);
  }
  // Determinism: stable order on the diff per (filePath, line, refKind).
  lost.sort(compareSrcRef);
  gained.sort(compareSrcRef);
  return { lost, gained };
}

function srcRefKey(r: SnapshotSourceRef): string {
  return `${r.filePath}|${r.line}|${r.refKind}`;
}

function compareSrcRef(a: SnapshotSourceRef, b: SnapshotSourceRef): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.refKind !== b.refKind) return a.refKind < b.refKind ? -1 : 1;
  return 0;
}

/**
 * Note-ref drift on a per-claim basis.  Each entry is the FQID of an
 * incoming note-ref present on one side and absent on the other.
 */
function computeNoteRefDrift(
  baseline: string[],
  candidate: string[],
): { lost: string[]; gained: string[] } {
  const baselineSet = new Set(baseline);
  const candidateSet = new Set(candidate);

  const lost: string[] = [];
  for (const r of baselineSet) {
    if (!candidateSet.has(r)) lost.push(r);
  }
  const gained: string[] = [];
  for (const r of candidateSet) {
    if (!baselineSet.has(r)) gained.push(r);
  }
  lost.sort(compareFqid);
  gained.sort(compareFqid);
  return { lost, gained };
}

/**
 * String comparator for FQIDs.  Plain lexicographic — the §6 worked
 * example shows snapshots sorted as plain strings.
 */
function compareFqid(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
