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

// Verification store
export {
  loadVerificationStore,
  saveVerificationStore,
  addVerificationEvent,
  getLatestVerification,
} from './verification-store.js';

export type {
  VerificationEvent,
  VerificationStore,
} from './verification-store.js';

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
