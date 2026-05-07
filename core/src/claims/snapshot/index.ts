/**
 * Snapshot subsystem barrel.
 *
 * Exports types, constants, the canonical body normalizer, the
 * writer, the store (with typed errors), the tombstone detector,
 * the diff engine, and the formatter (list/show/diff surfaces).
 *
 * Re-exported at the package surface from `core/src/claims/index.ts`
 * per {DD018.§3.DC.77}.
 */

export {
  SCHEMA_VERSION,
  BODY_HASH_ALGORITHM,
  BODY_HASH_ENCODING,
  normalizeBodyForHash,
} from './snapshot-types.js';

export type {
  Snapshot,
  SnapshotMetadata,
  SnapshotClaimEntry,
  SnapshotLifecycle,
  SnapshotSourceRef,
  SnapshotNoteEntry,
  SnapshotData,
} from './snapshot-types.js';

export { captureSnapshot } from './snapshot-writer.js';
export type { CaptureContext } from './snapshot-writer.js';

export {
  SNAPSHOT_DIR_RELATIVE,
  snapshotPath,
  defaultSnapshotName,
  ensureSnapshotDir,
  writeSnapshot,
  listSnapshots,
  removeSnapshot,
  readSnapshot,
  SnapshotExistsError,
  SnapshotNotFoundError,
  SnapshotSchemaError,
} from './snapshot-store.js';
export type { SnapshotListRow } from './snapshot-store.js';

export {
  CONTENT_TOMBSTONE_RE,
  isLifecycleTombstone,
  isContentTombstone,
  isTombstoned,
} from './tombstone-detector.js';
export type { TombstoneCheckContext } from './tombstone-detector.js';

// Phase 2 — diff engine + formatter.
export { computeDiff, loadSnapshotSide, liveSide } from './diff-engine.js';
export type { ComputeDiffContext } from './diff-engine.js';
export type {
  SnapshotSide,
  DiffReport,
  DiffSummary,
  LostClaimFinding,
  NewClaimFinding,
  BodyChangedFinding,
  HeadingMetadataFinding,
  HeadingMetadataFieldChange,
  SourceRefDriftFinding,
  NoteRefDriftFinding,
  RegressionFinding,
  TombstoneContext,
} from './diff-types.js';

export {
  formatSnapshotList,
  formatSnapshotShow,
  formatDiffHeader,
  formatDiffSections,
  formatRegressionSuggestions,
  formatDiffJson,
} from './snapshot-formatter.js';
