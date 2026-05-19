// Claim index
export { ClaimIndex } from './claim-index.js';

export type {
  NoteWithContent,
  ClaimIndexEntry,
  ClaimCrossReference,
  ClaimIndexData,
} from './claim-index.js';

// Traceability
export {
  buildTraceabilityMatrix,
  findGaps,
  findPartialCoverageGaps,
} from './traceability.js';

export type {
  ProjectionPresence,
  TraceabilityRow,
  TraceabilityMatrix,
  BuildMatrixOptions,
  GapReport,
  GapFilterOptions,
  DerivationStatus,
  PartialCoverageOptions,
} from './traceability.js';

// Claim metadata interpreter
// @implements {R006.§1.AC.01} isDerivationTag re-exported for use in lint validation
export {
  parseClaimMetadata,
  isLifecycleTag,
  isDerivationTag,
  LIFECYCLE_TAGS,
} from './claim-metadata.js';

export type {
  LifecycleType,
  LifecycleState,
  ParsedMetadata,
} from './claim-metadata.js';

// Metadata event log (replaces the legacy verification store; see DD014)
// @implements {DD014.§3.DC.13} Legacy verification-store re-exports removed; metadata types exported
// @implements {DD019.§3.DC.15} metadata-ingest barrel re-exports removed (module deleted under DD019)
export { applyFold } from './metadata-event.js';

export type {
  MetadataEvent,
  MetadataStore,
  EventFilter,
} from './metadata-event.js';

// Metadata filters (--where, --has-key, --missing-key)
// @implements {DD014.§3.DC.56}
// @implements {DD019.§3.DC.13} mergeMarkdownIntoFold exported for callers/tests
export {
  parseMetadataFilters,
  matchesMetadataFilters,
  applyMetadataFilters,
  parseAndApplyMetadataFilters,
  mergeMarkdownIntoFold,
  collectStrings,
} from './metadata-filters.js';

export type {
  MetadataFilterOptions,
  ParsedWhereClause,
  FilterParseResult,
} from './metadata-filters.js';

// Staleness detection
export { computeStaleness } from './staleness.js';

export type {
  StalenessEntry,
  StalenessOptions,
} from './staleness.js';

// Claim search
export { searchClaims, buildSearchPattern, matchesQuery } from './claim-search.js';

export type {
  ClaimSearchOptions,
  ClaimSearchResult,
} from './claim-search.js';

// Claim thread
export { buildClaimThread, buildClaimThreadsForNote } from './claim-thread.js';

export type {
  ClaimThreadRelationship,
  ClaimThreadNode,
  ClaimThreadOptions,
} from './claim-thread.js';

// Confidence markers
// @see {DD016.§1.DC.06} barrel re-export contract — these names are
//   preserved as legacy-compat wrappers around the new adapter registry
export {
  parseConfidenceAnnotation,
  formatConfidenceAnnotation,
  insertConfidenceAnnotation,
  validateReviewerLevel,
  mapReviewerArg,
  auditConfidence,
} from './confidence/index.js';

export type {
  ConfidenceLevel,
  ReviewerIcon,
  ConfidenceAnnotation,
  ConfidenceAuditResult,
} from './confidence/index.js';

// Snapshot subsystem (capture, store, diff, formatters)
// @implements {DD018.§3.DC.77} Re-export the snapshot subsystem at the
//   package surface so non-CLI consumers (UI, VS Code, scripted callers)
//   bind to the same types and primitives the CLI uses.
export {
  SCHEMA_VERSION,
  BODY_HASH_ALGORITHM,
  BODY_HASH_ENCODING,
  normalizeBodyForHash,
  captureSnapshot,
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
  CONTENT_TOMBSTONE_RE,
  isLifecycleTombstone,
  isContentTombstone,
  isTombstoned,
  computeDiff,
  loadSnapshotSide,
  liveSide,
  formatSnapshotList,
  formatSnapshotShow,
  formatDiffHeader,
  formatDiffSections,
  formatRegressionSuggestions,
  formatDiffJson,
} from './snapshot/index.js';

export type {
  Snapshot,
  SnapshotMetadata,
  SnapshotClaimEntry,
  SnapshotLifecycle,
  SnapshotSourceRef,
  SnapshotNoteEntry,
  SnapshotData,
  CaptureContext,
  SnapshotListRow,
  TombstoneCheckContext,
  ComputeDiffContext,
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
} from './snapshot/index.js';
