// core/src/types/index.ts
// Types barrel — re-exports all public types for library consumers.
// @implements {DD011.§DC.01} Types barrel re-exports all public types
// @implements {DD011.§DC.02} Name collisions handled via rename on re-export

// Config types
export type {
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
} from './config.js';

export { defaultConfig } from './config.js';

// Note types
export type {
  FileLocation,
  Note,
  NoteMetadata,
  BaseNote,
  NoteExtensions,
  ExtendedNote,
  NoteQuery,
  NoteQueryResult,
} from './note.js';

// Reference types
export type {
  Reference,
  SourceReference,
  SourceReferenceType,
  Language,
  ReferenceGraph,
  ReferenceCounts,
  ClaimAddress,
  ClaimLevelReference,
} from './reference.js';

// Context types
export type {
  ContextHints,
  DiscoveryMetadata,
  GatheredNote,
} from './context.js';

// Task types — renamed exports to avoid collisions with context/config types
export {
  TaskStatus,
  VisibilityLevel,
  YieldReason,
} from './task.js';

export type {
  Task,
  GatheredNote as TaskGatheredNote,
  TaskConfig as TaskTypeConfig,
  TaskOutput,
  TaskResult,
  ContextRule,
  Yield,
} from './task.js';
