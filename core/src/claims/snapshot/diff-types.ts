/**
 * Diff-engine type declarations for the snapshot subsystem.
 *
 * Pure type module — no runtime logic.  The diff engine
 * (`diff-engine.ts`) and the formatter (`snapshot-formatter.ts`) both
 * import from here so the per-finding shape is declared exactly once.
 *
 * @implements {DD018.§3.DC.36} SnapshotSide interface
 * @implements {DD018.§3.DC.39} DiffReport with per-category arrays + summary
 * @implements {DD018.§3.DC.40} LostClaimFinding shape
 * @implements {DD018.§3.DC.41} NewClaimFinding shape
 * @implements {DD018.§3.DC.42} BodyChangedFinding shape
 * @implements {DD018.§3.DC.43} HeadingMetadataFinding shape
 * @implements {DD018.§3.DC.44} SourceRefDriftFinding shape
 * @implements {DD018.§3.DC.45} NoteRefDriftFinding shape
 * @implements {DD018.§3.DC.46} RegressionFinding shape
 * @implements {DD018.§3.DC.52} TombstoneContext interface
 */

import type { ClaimIndexEntry } from '../claim-index.js';
import type {
  SnapshotClaimEntry,
  SnapshotLifecycle,
  SnapshotMetadata,
  SnapshotNoteEntry,
  SnapshotSourceRef,
} from './snapshot-types.js';

/**
 * Uniform diff-engine view of a snapshot side.
 *
 * Both the on-disk snapshot path (`loadSnapshotSide`) and the in-memory
 * live-capture path (`liveSide`) produce values of this shape so the
 * diff core operates on a single type regardless of whether the operand
 * came from disk or from the live claim index.
 *
 * `kind: 'live'` sides have `metadata: null` because they were captured
 * in-memory without serializing.  `kind: 'snapshot'` carries the
 * metadata block from the file.
 *
 * The `claims` and `notes` Maps are keyed by FQID and noteId
 * respectively for O(1) lookup during the per-claim drift pass.
 *
 * @implements {DD018.§3.DC.36}
 */
export interface SnapshotSide {
  kind: 'snapshot' | 'live';
  claims: Map<string, SnapshotClaimEntry>;
  notes: Map<string, SnapshotNoteEntry>;
  metadata: SnapshotMetadata | null;
}

/**
 * Lost-claim finding — present in baseline but absent from candidate.
 *
 * `isRegression` is set during stage 4 by the regression gate when the
 * claim is not tombstoned in the candidate-side live index.  The
 * formatter uses this flag to render the regression marker per
 * {R014.§6.AC.05}.
 *
 * @implements {DD018.§3.DC.40}
 */
export interface LostClaimFinding {
  fqid: string;
  baselineHeading: string;
  baselineLifecycle: SnapshotLifecycle | null;
  isRegression: boolean;
}

/**
 * New-claim finding — present in candidate but absent from baseline.
 *
 * @implements {DD018.§3.DC.41}
 */
export interface NewClaimFinding {
  fqid: string;
  candidateHeading: string;
  candidateLifecycle: SnapshotLifecycle | null;
}

/**
 * Body-content drift on a shared FQID — bodyHash differs between sides.
 *
 * Records hashes only — the actual diff content is out of scope for
 * the snapshot subsystem (the user opens the file to see what changed).
 *
 * @implements {DD018.§3.DC.42}
 */
export interface BodyChangedFinding {
  fqid: string;
  baselineBodyHash: string;
  candidateBodyHash: string;
}

/**
 * One field-level change in a heading-or-metadata finding.
 *
 * Per §DC.43 the four covered fields are `heading`, `lifecycle`,
 * `importance`, and `derivedFrom`.  Multiple fields on the same claim
 * produce ONE finding with multiple `changes` entries, not multiple
 * findings.
 */
export interface HeadingMetadataFieldChange {
  field: 'heading' | 'lifecycle' | 'importance' | 'derivedFrom';
  baseline: unknown;
  candidate: unknown;
}

/**
 * Heading-or-metadata drift on a shared FQID — at least one of
 * heading/lifecycle/importance/derivedFrom differs.
 *
 * @implements {DD018.§3.DC.43}
 */
export interface HeadingMetadataFinding {
  fqid: string;
  changes: HeadingMetadataFieldChange[];
}

/**
 * Source-ref drift on a shared FQID — incoming source-ref set
 * difference is non-empty.  Two source-refs are equal iff `filePath`,
 * `line`, and `refKind` all match; line-only differences produce one
 * lost + one gained, not a "moved" finding.
 *
 * @implements {DD018.§3.DC.44}
 */
export interface SourceRefDriftFinding {
  fqid: string;
  lost: SnapshotSourceRef[];
  gained: SnapshotSourceRef[];
}

/**
 * Incoming-note-ref drift on a shared FQID — the set of incoming
 * note-ref FQIDs differs between sides.  Each `lost`/`gained` entry
 * is the FQID of an incoming note-ref present on one side and absent
 * on the other.
 *
 * @implements {DD018.§3.DC.45}
 */
export interface NoteRefDriftFinding {
  fqid: string;
  lost: string[];
  gained: string[];
}

/**
 * Regression-gate finding — surfaced as a separate array distinct from
 * the per-category drift findings.  The gate's exit-code path consumes
 * the count from this array; the formatter consumes the per-finding
 * details to render the suggestion lines (§DC.61, §DC.61a).
 *
 * `kind` distinguishes the three regression shapes the DD names:
 *   - `dangling-source-coverage` — claim still exists but lost all
 *     incoming source refs and isn't tombstoned;
 *   - `untombstoned-loss` — claim disappeared and isn't tombstoned;
 *   - `derived-from-shrinkage` — claim's `derivedFrom` set strictly
 *     shrunk and isn't tombstoned.
 *
 * `lostDerivationTargets` is populated only for the
 * `derived-from-shrinkage` kind per §DC.51b; undefined for the other
 * two kinds.
 *
 * @implements {DD018.§3.DC.46}
 */
export interface RegressionFinding {
  kind: 'dangling-source-coverage' | 'untombstoned-loss' | 'derived-from-shrinkage';
  fqid: string;
  baselineSourceRefCount: number;
  suggestedTombstoneTag: string;
  locationHint: { filePath: string; line: number } | null;
  lostDerivationTargets?: string[];
}

/**
 * Per-category counts denormalized from the array lengths.
 *
 * Exists so the formatter can render the summary header (§DC.57)
 * without re-counting; also surfaced verbatim in the `--json` output
 * per §DC.62.
 */
export interface DiffSummary {
  lost: number;
  new: number;
  bodyChanged: number;
  headingOrMetadataChanged: number;
  sourceRefDrift: number;
  incomingNoteRefDrift: number;
  regressions: number;
}

/**
 * Top-level diff-report value returned by `computeDiff`.
 *
 * `summary` mirrors the array lengths and exists as a denormalization
 * for the formatter and JSON output.
 *
 * @implements {DD018.§3.DC.39}
 */
export interface DiffReport {
  lostClaims: LostClaimFinding[];
  newClaims: NewClaimFinding[];
  bodyChanged: BodyChangedFinding[];
  headingOrMetadataChanged: HeadingMetadataFinding[];
  sourceRefDrift: SourceRefDriftFinding[];
  incomingNoteRefDrift: NoteRefDriftFinding[];
  regressions: RegressionFinding[];
  summary: DiffSummary;
}

/**
 * Per-diff-run tombstone-detection context shared across the
 * regression-gate stages (§DC.50, §DC.51, §DC.51b).
 *
 * `liveEntries` is the live `ClaimIndex` snapshot keyed by FQID; it
 * MAY be empty in snapshot-vs-snapshot mode where the live index
 * isn't queried (per §DC.53 the gate falls back to lifecycle-tag-only
 * checks in that mode).
 *
 * `bodyResolver` is wired by the diff caller using
 * `noteFileManager.getAggregatedContents` plus the
 * `entry.line+1..endLine` slice — the same logic as the writer's
 * §DC.16 minus the hashing step.
 *
 * `cache` is the per-diff-run shared cache so a single FQID's
 * tombstone state is computed at most once per diff run regardless
 * of which gate evaluates it.
 *
 * @implements {DD018.§3.DC.52}
 */
export interface TombstoneContext {
  liveEntries: Map<string, ClaimIndexEntry>;
  bodyResolver: (entry: ClaimIndexEntry) => string;
  cache: Map<string, boolean>;
}
