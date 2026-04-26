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
export { applyFold } from './metadata-event.js';

export type {
  MetadataEvent,
  MetadataStore,
  EventFilter,
} from './metadata-event.js';

// Metadata filters (--where, --has-key, --missing-key)
// @implements {DD014.§3.DC.56}
export {
  parseMetadataFilters,
  matchesMetadataFilters,
  applyMetadataFilters,
  parseAndApplyMetadataFilters,
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
export {
  parseConfidenceAnnotation,
  formatConfidenceAnnotation,
  insertConfidenceAnnotation,
  validateReviewerLevel,
  mapReviewerArg,
  auditConfidence,
} from './confidence.js';

export type {
  ConfidenceLevel,
  ReviewerIcon,
  ConfidenceAnnotation,
  ConfidenceAuditResult,
} from './confidence.js';
