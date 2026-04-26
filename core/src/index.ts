// core/src/index.ts
// SCEpter core library — public API surface.
// This barrel exports domain classes, types, and functions for library consumers.
// CLI-specific modules (cli/, llm/, chat/) are excluded.
// @implements {DD011.§DC.03} Top-level barrel organized by subsystem
// @implements {DD011.§DC.04} Only public API symbols exported
// @implements {DD011.§DC.05} No imports from cli/, llm/, or chat/
// @implements {DD011.§DC.06} Internal modules explicitly excluded
// @implements {DD014.§3.DC.54b} Legacy verification-store re-exports removed; metadata symbols added

// --- Project ---
export {
  ProjectManager,
  type ProjectManagerDependencies,
  type ProjectStatistics,
} from './project/project-manager.js';

// --- Storage Protocol ---
export type {
  NoteStorage,
  ConfigStorage,
  TemplateStorage,
  MetadataStorage,
  IdCounterStorage,
  StorageEvent,
  Attachment,
  AttachmentContent,
  Unsubscribe,
  DeleteMode,
  StorageStatistics,
} from './storage/index.js';

// --- Storage: Filesystem Adapters ---
export {
  createFilesystemProject,
  bootstrapFilesystemDirs,
  findProjectRoot,
  FilesystemNoteStorage,
  FilesystemConfigStorage,
  FilesystemTemplateStorage,
  FilesystemMetadataStorage,
  FilesystemIdCounterStorage,
} from './storage/filesystem/index.js';

// --- Notes ---
export {
  NoteManager,
  type CreateNoteParams,
  type NoteStatistics,
} from './notes/note-manager.js';

export { NoteTypeResolver } from './notes/note-type-resolver.js';

// --- Templates ---
export { NoteTypeTemplateManager } from './templates/note-type-template-manager.js';

// --- Config ---
export { ConfigManager } from './config/config-manager.js';

// --- References ---
export { ReferenceManager } from './references/reference-manager.js';

// --- Source Code Scanning ---
export {
  SourceCodeScanner,
  type ScanResult,
} from './scanners/source-code-scanner.js';

// --- Context Gathering ---
export {
  ContextGatherer,
  type GatherOptions,
  type GatheredContext,
  type ContextStats,
} from './context/context-gatherer.js';

// --- Statuses ---
export {
  StatusValidator,
  type StatusValidationResult,
} from './statuses/index.js';

// --- Claims (full subsystem barrel) ---
export {
  // Classes
  ClaimIndex,
  // Traceability
  buildTraceabilityMatrix,
  findGaps,
  findPartialCoverageGaps,
  // Metadata
  parseClaimMetadata,
  isLifecycleTag,
  isDerivationTag,
  LIFECYCLE_TAGS,
  // Metadata event log (DD014)
  applyFold,
  // Staleness
  computeStaleness,
  // Search
  searchClaims,
  buildSearchPattern,
  matchesQuery,
  // Thread
  buildClaimThread,
  buildClaimThreadsForNote,
  // Confidence
  parseConfidenceAnnotation,
  formatConfidenceAnnotation,
  insertConfidenceAnnotation,
  validateReviewerLevel,
  mapReviewerArg,
  auditConfidence,
} from './claims/index.js';

export type {
  // Claim index types
  NoteWithContent,
  ClaimIndexEntry,
  ClaimCrossReference,
  ClaimIndexData,
  // Traceability types
  ProjectionPresence,
  TraceabilityRow,
  TraceabilityMatrix,
  GapReport,
  GapFilterOptions,
  DerivationStatus,
  PartialCoverageOptions,
  // Metadata types
  LifecycleType,
  LifecycleState,
  ParsedMetadata,
  // Metadata event log types (DD014)
  MetadataEvent,
  MetadataStore,
  EventFilter,
  // Staleness types
  StalenessEntry,
  StalenessOptions,
  // Search types
  ClaimSearchOptions,
  ClaimSearchResult,
  // Thread types
  ClaimThreadRelationship,
  ClaimThreadNode,
  ClaimThreadOptions,
  // Confidence types
  ConfidenceLevel,
  ReviewerIcon,
  ConfidenceAnnotation,
  ConfidenceAuditResult,
} from './claims/index.js';

// --- Parsers: Claim ---
export {
  parseClaimAddress,
  parseClaimReferences,
  parseRangeSuffix,
  expandClaimRange,
  normalizeSectionSymbol,
  parseMetadataSuffix,
  buildClaimTree,
  validateClaimTree,
} from './parsers/claim/index.js';

export type {
  ClaimAddress as ClaimAddressParsed,
  ClaimParseOptions,
  ClaimReference,
  ClaimNode,
  ClaimTreeResult,
  ClaimTreeError,
} from './parsers/claim/index.js';

// --- Parsers: Note ---
export {
  parseNoteMentions,
  parseNoteId,
  isValidNoteId,
  isValidShortcodeFormat,
  formatNoteId,
} from './parsers/note/index.js';

export type {
  NoteMention,
  ParseOptions,
  CommentPatterns,
  ParsedNoteId,
} from './parsers/note/index.js';

// --- Types (all domain types) ---
export type {
  // Config
  StatusMapping,
  AllowedStatusesConfig,
  NoteTypeConfig,
  NotesConfig,
  ContextConfig,
  TaskConfig,
  PathsConfig,
  ProjectConfig,
  TemplateConfig,
  SourceCodeIntegrationConfig,
  SCEpterConfig,
  ClaimConfig,
  // Note
  FileLocation,
  Note,
  NoteMetadata,
  BaseNote,
  NoteExtensions,
  ExtendedNote,
  NoteQuery,
  NoteQueryResult,
  // Reference
  Reference,
  SourceReference,
  SourceReferenceType,
  Language,
  ReferenceGraph,
  ReferenceCounts,
  ClaimAddress,
  ClaimLevelReference,
  // Context
  ContextHints,
  DiscoveryMetadata,
  GatheredNote,
  // Task (renamed to avoid collisions)
  Task,
  TaskGatheredNote,
  TaskTypeConfig,
  TaskOutput,
  TaskResult,
  ContextRule,
  Yield,
} from './types/index.js';

export {
  defaultConfig,
  TaskStatus,
  VisibilityLevel,
  YieldReason,
} from './types/index.js';
