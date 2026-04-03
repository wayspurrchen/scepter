---
created: 2026-04-02T17:30:16.899Z
tags: [library, api, barrel-exports, build, packaging, tsup]
status: draft
---

# DD011 - Library API Surface - Barrel Exports and Build Configuration

**Architecture:** {A003}
**Date:** 2026-04-02
**Scope:** Implementation blueprint for Phases 1-2 of {A003}: creating barrel exports (`core/src/index.ts`, `core/src/types/index.ts`), updating the tsup build configuration for dual entry points, configuring `package.json` for library consumption, and verifying importability. Phase 3 (VS Code extension migration) is a separate DD per {A003.§5.AC.05}.

---

## Current State

The SCEpter core library has clean internal architecture but zero library consumability. The build produces only the CLI entry point. The specific gaps per {A003.§2.AC.02}:

| Gap | Current state |
|-----|--------------|
| `core/src/index.ts` | Does not exist |
| `core/src/types/index.ts` | File exists, is empty (0 lines) |
| `tsup.config.ts` entry | Single entry: `['src/cli/index.ts']` |
| `package.json` exports | No `exports`, `main`, `module`, or `types` fields |

One subsystem already has a proper barrel: `core/src/claims/index.ts` re-exports 30+ symbols from six modules. Per {A003.§2.AC.03}, this barrel is the model for the top-level export structure.

Other subsystems with existing barrels: `core/src/statuses/index.ts`, `core/src/parsers/note/index.ts`, `core/src/parsers/claim/index.ts`, `core/src/storage/index.ts`, `core/src/storage/filesystem/index.ts`. These already aggregate their subsystem's public surface and can be re-exported from the top-level barrel.

---

## Module Inventory

### Files Created

| File | Purpose |
|------|---------|
| `core/src/index.ts` | Top-level library barrel export |

### Files Modified

| File | Change |
|------|--------|
| `core/src/types/index.ts` | Populate with re-exports from all type files |
| `core/tsup.config.ts` | Add library entry point alongside CLI |
| `package.json` (root) | Add `exports`, `main`, `module`, `types` fields |

### Files Unchanged

All existing source files. This DD creates no new behavior -- it only creates export surfaces and build configuration atop existing code.

---

## `core/src/types/index.ts` Specification

### Types Barrel

§DC.01:derives=A003.§3.AC.02 The `core/src/types/index.ts` barrel MUST re-export all public types and interfaces from the five type modules.

The file is currently empty. After this change it contains only re-exports, no original definitions.

#### From `config.ts`

| Symbol | Kind |
|--------|------|
| `StatusMapping` | interface |
| `AllowedStatusesConfig` | interface |
| `NoteTypeConfig` | interface |
| `NotesConfig` | interface |
| `ContextConfig` | interface |
| `TaskConfig` | interface |
| `PathsConfig` | interface |
| `ProjectConfig` | interface |
| `TemplateConfig` | interface |
| `SourceCodeIntegrationConfig` | interface |
| `SCEpterConfig` | interface |
| `ClaimConfig` | interface |
| `defaultConfig` | const |

`TASK_VIRTUAL_TYPE_CONFIG` is excluded -- it is an internal implementation detail used only by the note system, not a consumer-facing type.

#### From `note.ts`

| Symbol | Kind |
|--------|------|
| `FileLocation` | interface |
| `Note` | interface |
| `NoteMetadata` | interface |
| `BaseNote` | interface |
| `NoteExtensions` | interface |
| `ExtendedNote` | interface |
| `NoteQuery` | interface |
| `NoteQueryResult` | interface |

#### From `reference.ts`

| Symbol | Kind |
|--------|------|
| `Reference` | interface |
| `SourceReference` | interface |
| `SourceReferenceType` | type alias |
| `Language` | type alias |
| `ReferenceGraph` | interface |
| `ReferenceCounts` | interface |
| `ClaimAddress` | interface |
| `ClaimLevelReference` | interface |

#### From `context.ts`

| Symbol | Kind |
|--------|------|
| `ContextHints` | interface |
| `DiscoveryMetadata` | interface |
| `GatheredNote` | interface |

#### From `task.ts`

| Symbol | Kind |
|--------|------|
| `Task` | interface |
| `GatheredNote` as `TaskGatheredNote` | interface |
| `TaskConfig` as `TaskTypeConfig` | interface |
| `TaskStatus` | enum |
| `TaskOutput` | interface |
| `TaskResult` | interface |
| `ContextRule` | interface |
| `VisibilityLevel` | enum |
| `Yield` | interface |
| `YieldReason` | enum |

**Name collision:** `task.ts` exports `GatheredNote` and `TaskConfig` which collide with `context.ts`'s `GatheredNote` and `config.ts`'s `TaskConfig`. The types barrel MUST rename the `task.ts` versions on re-export:

```typescript
// From task.ts — rename to avoid collisions
export {
  TaskStatus,
  TaskOutput,
  TaskResult,
  ContextRule,
  VisibilityLevel,
  Yield,
  YieldReason,
} from './task.js';

export type {
  Task,
  GatheredNote as TaskGatheredNote,
  TaskConfig as TaskTypeConfig,
} from './task.js';
```

§DC.02:derives=A003.§3.AC.02 The types barrel MUST handle name collisions between type modules via explicit rename on re-export.

### Exact File Content

```typescript
// core/src/types/index.ts
// Types barrel — re-exports all public types for library consumers.

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
```

---

## `core/src/index.ts` Specification

### Top-Level Barrel

§DC.03:derives=A003.§3.AC.01 The top-level `core/src/index.ts` MUST export the public API surface organized by subsystem.

§DC.04:derives=A003.§3.AC.06 The barrel MUST only export symbols that are part of the public API per the boundary table in {A003.§3.AC.06}.

§DC.05:derives=A003.§3.AC.05 The barrel MUST NOT import from `core/src/cli/`, `core/src/llm/`, or `core/src/chat/` — these are CLI-specific or have external service dependencies.

The barrel re-exports from existing subsystem barrels where they exist, and directly from source files otherwise.

### Export Inventory by Subsystem

#### Project (from `project/project-manager.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ProjectManager` | class | Primary entry point for library consumers |
| `ProjectManagerDependencies` | interface | Constructor parameter type |
| `ProjectStatistics` | interface | Return type of `getStatistics()` |

#### Storage Protocol (from `storage/index.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `NoteStorage` | interface | Storage protocol for notes |
| `ConfigStorage` | interface | Storage protocol for config |
| `TemplateStorage` | interface | Storage protocol for templates |
| `VerificationStorage` | interface | Storage protocol for verification events |
| `IdCounterStorage` | interface | Storage protocol for ID generation |
| `StorageEvent` | interface | Change notification type |
| `Attachment` | interface | Folder-note asset metadata |
| `AttachmentContent` | interface | Attachment with data |
| `Unsubscribe` | type alias | Watch cleanup handle |
| `DeleteMode` | type alias | Archive/soft-delete/permanent |
| `StorageStatistics` | interface | Backend-agnostic project stats |

These are already implemented per {A002} / {DD010} and are re-exported from `storage/index.ts`.

#### Storage Filesystem Adapters (from `storage/filesystem/index.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `createFilesystemProject` | function | Factory for filesystem-backed ProjectManager |
| `bootstrapFilesystemDirs` | function | Directory setup utility |
| `findProjectRoot` | function | Project root detection |
| `FilesystemNoteStorage` | class | Concrete filesystem NoteStorage |
| `FilesystemConfigStorage` | class | Concrete filesystem ConfigStorage |
| `FilesystemTemplateStorage` | class | Concrete filesystem TemplateStorage |
| `FilesystemVerificationStorage` | class | Concrete filesystem VerificationStorage |
| `FilesystemIdCounterStorage` | class | Concrete filesystem IdCounterStorage |

Consumers use `createFilesystemProject()` to get a fully-wired `ProjectManager`. The individual adapter classes are exported for advanced use cases (testing, custom wiring).

#### Notes (from `notes/note-manager.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `NoteManager` | class | Note CRUD and querying |
| `CreateNoteParams` | interface | Parameter type for `createNote()` |
| `NoteStatistics` | interface | Return type of `getStatistics()` |

#### Notes — Type Resolution (from `notes/note-type-resolver.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `NoteTypeResolver` | class | Shortcode-to-type resolution |

#### Templates (from `templates/note-type-template-manager.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `NoteTypeTemplateManager` | class | Template rendering for note creation |

#### Config (from `config/config-manager.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ConfigManager` | class | Config loading, validation, mutation |

#### References (from `references/reference-manager.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ReferenceManager` | class | Bidirectional reference graph |

#### Source Code Scanning (from `scanners/source-code-scanner.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `SourceCodeScanner` | class | Scans source files for note references |
| `ScanResult` | interface | Scan operation result |

#### Context Gathering (from `context/context-gatherer.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ContextGatherer` | class | Reference-following context collection |
| `GatherOptions` | interface | Parameter type for `gatherContext()` |
| `GatheredContext` | interface | Return type of `gatherContext()` |
| `ContextStats` | interface | Gathering statistics |

#### Statuses (from `statuses/index.ts`)

| Symbol | Kind | Notes |
|--------|------|-------|
| `StatusValidator` | class | Status validation per note type |
| `StatusValidationResult` | interface | Validation result type |

#### Claims (from `claims/index.ts`)

The entire claims barrel is re-exported. This is the largest subsystem export surface:

| Symbol | Kind | Source module |
|--------|------|-------------|
| `ClaimIndex` | class | `claim-index.ts` |
| `NoteWithContent` | type | `claim-index.ts` |
| `ClaimIndexEntry` | type | `claim-index.ts` |
| `ClaimCrossReference` | type | `claim-index.ts` |
| `ClaimIndexData` | type | `claim-index.ts` |
| `buildTraceabilityMatrix` | function | `traceability.ts` |
| `findGaps` | function | `traceability.ts` |
| `findPartialCoverageGaps` | function | `traceability.ts` |
| `ProjectionPresence` | type | `traceability.ts` |
| `TraceabilityRow` | type | `traceability.ts` |
| `TraceabilityMatrix` | type | `traceability.ts` |
| `GapReport` | type | `traceability.ts` |
| `GapFilterOptions` | type | `traceability.ts` |
| `DerivationStatus` | type | `traceability.ts` |
| `PartialCoverageOptions` | type | `traceability.ts` |
| `parseClaimMetadata` | function | `claim-metadata.ts` |
| `isLifecycleTag` | function | `claim-metadata.ts` |
| `isDerivationTag` | function | `claim-metadata.ts` |
| `LIFECYCLE_TAGS` | const | `claim-metadata.ts` |
| `LifecycleType` | type | `claim-metadata.ts` |
| `LifecycleState` | type | `claim-metadata.ts` |
| `ParsedMetadata` | type | `claim-metadata.ts` |
| `loadVerificationStore` | function | `verification-store.ts` |
| `saveVerificationStore` | function | `verification-store.ts` |
| `addVerificationEvent` | function | `verification-store.ts` |
| `getLatestVerification` | function | `verification-store.ts` |
| `removeLatestVerification` | function | `verification-store.ts` |
| `removeAllVerifications` | function | `verification-store.ts` |
| `VerificationEvent` | type | `verification-store.ts` |
| `VerificationStore` | type | `verification-store.ts` |
| `computeStaleness` | function | `staleness.ts` |
| `StalenessEntry` | type | `staleness.ts` |
| `StalenessOptions` | type | `staleness.ts` |
| `searchClaims` | function | `claim-search.ts` |
| `buildSearchPattern` | function | `claim-search.ts` |
| `matchesQuery` | function | `claim-search.ts` |
| `ClaimSearchOptions` | type | `claim-search.ts` |
| `ClaimSearchResult` | type | `claim-search.ts` |
| `buildClaimThread` | function | `claim-thread.ts` |
| `buildClaimThreadsForNote` | function | `claim-thread.ts` |
| `ClaimThreadRelationship` | type | `claim-thread.ts` |
| `ClaimThreadNode` | type | `claim-thread.ts` |
| `ClaimThreadOptions` | type | `claim-thread.ts` |
| `parseConfidenceAnnotation` | function | `confidence.ts` |
| `formatConfidenceAnnotation` | function | `confidence.ts` |
| `insertConfidenceAnnotation` | function | `confidence.ts` |
| `validateReviewerLevel` | function | `confidence.ts` |
| `mapReviewerArg` | function | `confidence.ts` |
| `auditConfidence` | function | `confidence.ts` |
| `ConfidenceLevel` | type | `confidence.ts` |
| `ReviewerIcon` | type | `confidence.ts` |
| `ConfidenceAnnotation` | type | `confidence.ts` |
| `ConfidenceAuditResult` | type | `confidence.ts` |

#### Parsers — Claim (from `parsers/claim/index.ts`)

| Symbol | Kind | Source module |
|--------|------|-------------|
| `parseClaimAddress` | function | `claim-parser.ts` |
| `parseClaimReferences` | function | `claim-parser.ts` |
| `parseRangeSuffix` | function | `claim-parser.ts` |
| `expandClaimRange` | function | `claim-parser.ts` |
| `normalizeSectionSymbol` | function | `claim-parser.ts` |
| `parseMetadataSuffix` | function | `claim-parser.ts` |
| `ClaimAddress` as `ClaimAddressParsed` | type | `claim-parser.ts` |
| `ClaimParseOptions` | type | `claim-parser.ts` |
| `ClaimReference` | type | `claim-parser.ts` |
| `buildClaimTree` | function | `claim-tree.ts` |
| `validateClaimTree` | function | `claim-tree.ts` |
| `ClaimNode` | type | `claim-tree.ts` |
| `ClaimTreeResult` | type | `claim-tree.ts` |
| `ClaimTreeError` | type | `claim-tree.ts` |

**Name collision:** The `ClaimAddress` interface in `parsers/claim/claim-parser.ts` has a different shape than the `ClaimAddress` in `types/reference.ts` (the parser's version has additional fields like `claimSubLetter`). The top-level barrel MUST rename the parser's version to `ClaimAddressParsed` to avoid ambiguity. The `types/reference.ts` version remains as the canonical `ClaimAddress` since it is the domain type. Alternatively, the top-level barrel could namespace these via `export * as claimParser from './parsers/claim/index.js'` but that breaks the flat import pattern. The rename is preferred.

#### Parsers — Note (from `parsers/note/index.ts`)

| Symbol | Kind | Source module |
|--------|------|-------------|
| `parseNoteMentions` | function | `note-parser.ts` |
| `NoteMention` | type | `note-parser.ts` |
| `ParseOptions` | type | `note-parser.ts` |
| `CommentPatterns` | type | `note-parser.ts` |
| `parseNoteId` | function | `shared-note-utils.ts` |
| `isValidNoteId` | function | `shared-note-utils.ts` |
| `isValidShortcodeFormat` | function | `shared-note-utils.ts` |
| `formatNoteId` | function | `shared-note-utils.ts` |
| `ParsedNoteId` | type | `shared-note-utils.ts` |

Functions `parseTags`, `extractModifier`, `generateNotePath`, and `mergeTags` from `shared-note-utils.ts` are internal utilities -- they are used by the parsers and note system but are not part of the consumer-facing API.

#### Types (from `types/index.ts`)

All symbols from `types/index.ts` are re-exported. See the `core/src/types/index.ts` section above for the full list.

### Explicitly Excluded from the Barrel

§DC.06:derives=A003.§3.AC.06 The following modules are internal and MUST NOT appear in the top-level barrel.

| Module | Reason |
|--------|--------|
| `cli/*` | CLI-specific: Commander.js, chalk, formatters, handlers |
| `llm/*` | External service dependencies (Claude SDK, OpenAI), excluded per {A003.§9} |
| `chat/*` | External service dependencies, unstable API |
| `tasks/task-dispatcher.ts` | Depends on LLM subsystem |
| `notes/note-file-manager.ts` | Internal implementation detail, accessed via NoteManager |
| `notes/note-id-generator.ts` | Internal implementation detail, accessed via NoteManager |
| `discovery/unified-discovery.ts` | Internal implementation detail, accessed via NoteManager |
| `references/source-reference-index.ts` | Internal, accessed via ReferenceManager |
| `config/config-validator.ts` | Internal, used by ConfigManager |
| `migration/*` | Internal migration utilities |
| `test-utils/*` | Test infrastructure |
| `services/*` | Internal shared services |

### Exact File Content

```typescript
// core/src/index.ts
// SCEpter core library — public API surface.
// This barrel exports domain classes, types, and functions for library consumers.
// CLI-specific modules (cli/, llm/, chat/) are excluded.

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
  VerificationStorage,
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
  FilesystemVerificationStorage,
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
  // Verification
  loadVerificationStore,
  saveVerificationStore,
  addVerificationEvent,
  getLatestVerification,
  removeLatestVerification,
  removeAllVerifications,
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
  // Verification types
  VerificationEvent,
  VerificationStore,
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
```

---

## `tsup.config.ts` Changes

### Dual Entry Point Build

§DC.07:derives=A003.§3.AC.03 The tsup config MUST produce both CLI and library entry points with declaration files.

#### Current

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  target: 'node18',
  outDir: './dist',
  esbuildOptions(options) {
    options.platform = 'node';
  },
});
```

#### Proposed

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli/index.ts',
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  target: 'node18',
  outDir: './dist',
  esbuildOptions(options) {
    options.platform = 'node';
  },
});
```

**What changes:**
- `entry` changes from an array (`['src/cli/index.ts']`) to a named map (`{ cli: '...', index: '...' }`)
- This produces `dist/cli.cjs`, `dist/cli.mjs`, `dist/cli.d.ts` (CLI) and `dist/index.cjs`, `dist/index.mjs`, `dist/index.d.ts` (library)
- The `./scepter` shell script references `core/src/cli/index.ts` via tsx for development and does not use the built output, so it is unaffected

**Output files after build:**

| File | Purpose |
|------|---------|
| `core/dist/cli.cjs` | CLI entry point (CommonJS) |
| `core/dist/cli.mjs` | CLI entry point (ESM) |
| `core/dist/cli.d.ts` | CLI type declarations |
| `core/dist/cli.d.mts` | CLI type declarations (ESM) |
| `core/dist/index.cjs` | Library entry point (CommonJS) |
| `core/dist/index.mjs` | Library entry point (ESM) |
| `core/dist/index.d.ts` | Library type declarations |
| `core/dist/index.d.mts` | Library type declarations (ESM) |

§DC.08:derives=A003.§3.AC.03 The `dts: true` setting MUST remain enabled to generate `.d.ts` files for the library entry point.

tsup generates declaration files from all entry points when `dts: true`. No additional configuration is needed.

---

## `package.json` Changes

### Package Export Map

§DC.09:derives=A003.§3.AC.04 The root `package.json` MUST define an `exports` map, `main`, `module`, and `types` fields for library consumption.

#### Current Fields (relevant subset)

```json
{
  "name": "scepter",
  "version": "0.1.0",
  "private": true,
  "bin": {
    "scepter": "./scepter"
  },
  "scripts": { ... },
  "dependencies": { ... },
  "devDependencies": { ... }
}
```

#### Fields to Add

```json
{
  "main": "./core/dist/index.cjs",
  "module": "./core/dist/index.mjs",
  "types": "./core/dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./core/dist/index.d.mts",
        "default": "./core/dist/index.mjs"
      },
      "require": {
        "types": "./core/dist/index.d.ts",
        "default": "./core/dist/index.cjs"
      }
    },
    "./types": {
      "import": {
        "types": "./core/dist/index.d.mts",
        "default": "./core/dist/index.mjs"
      },
      "require": {
        "types": "./core/dist/index.d.ts",
        "default": "./core/dist/index.cjs"
      }
    }
  }
}
```

**Design decisions:**

1. **`exports` uses nested conditions** with `types` listed first per TypeScript's `moduleResolution: "bundler"` and `"node16"` resolution algorithm. The `types` condition must precede `default` so TypeScript finds declarations.

2. **`./types` subpath maps to the same entry point as `.`** because all types are re-exported through `core/src/index.ts`. There is no separate types-only build output. The subpath exists so consumers can write `import type { Note } from 'scepter/types'` if they prefer an explicit types-only import path. Both resolve to the same bundle.

3. **`main` and `module` are kept for legacy resolution.** Older tools (pre-exports-map) use `main` for CommonJS and `module` for ESM. Modern bundlers and Node.js 16+ use `exports`.

4. **`bin` is unchanged.** The `./scepter` shell script continues to serve as the CLI entry point.

5. **`private: true` stays.** The package is not published to npm yet. When it is published, this field will be removed. For now, the library is consumed via workspace references or local file paths (e.g., `"scepter": "file:../../"` in the VS Code extension's `package.json`).

6. **No `sideEffects` field yet.** See the Tree-shaking section below.

§DC.10:derives=A003.§3.AC.04 The `bin` field MUST remain unchanged — the CLI entry point is the `./scepter` shell script.

---

## Tree-Shaking Considerations

### Side Effects and Tree-Shaking

§DC.11:derives=A003.§3.AC.05 The barrel export MUST be structured to avoid pulling CLI dependencies into library consumers' bundles.

**Will the barrel cause bundlers to pull in everything?**

The barrel `core/src/index.ts` imports from domain modules only. It does not import from `cli/`, `llm/`, or `chat/`. So at the module graph level, CLI dependencies (Commander.js, chalk) are not reachable from the library entry point.

However, some domain classes extend `EventEmitter` and import `fs`, `fs-extra`, `chokidar`, `gray-matter`, etc. These are Node.js runtime dependencies that any consumer of the domain logic will need. This is expected -- the library is a Node.js library, not a browser library.

**Mitigation for tree-shaking:**

1. **Add `"sideEffects": false` to `package.json`.** This tells bundlers (webpack, rollup, esbuild) that modules in this package have no side effects at import time, enabling dead-code elimination. A consumer that only imports `ClaimIndex` and `buildTraceabilityMatrix` can shake out `NoteManager`, `SourceCodeScanner`, etc.

```json
{
  "sideEffects": false
}
```

2. **Verify no top-level side effects in barrel.** The barrel contains only `export` statements -- no function calls, no variable assignments, no `import` statements with side effects. This is correct by construction since the barrel is pure re-exports.

3. **Future consideration:** If consumers report bundle size issues, the library can be split into subpath exports (e.g., `scepter/claims`, `scepter/notes`, `scepter/parsers`) each with their own entry point in tsup. This is not needed for Phase 1 because the primary consumer (VS Code extension) runs in a Node.js host where bundle size is less critical.

---

## Verification Plan

### Importability Verification

§DC.12:derives=A003.§5.AC.04 The library MUST be verified importable after changes via a minimal TypeScript consumer test.

#### Step 1: Build

Run the build from the project root:

```bash
pnpm run build
```

Verify output files exist:

```bash
ls core/dist/index.cjs core/dist/index.mjs core/dist/index.d.ts
```

#### Step 2: TypeScript Compilation Check

Create a temporary file `core/src/__verify-imports.ts` (not committed) that exercises the import surface:

```typescript
// Verify library barrel imports compile
import {
  ProjectManager,
  NoteManager,
  ConfigManager,
  ReferenceManager,
  ClaimIndex,
  ContextGatherer,
  SourceCodeScanner,
  StatusValidator,
  NoteTypeResolver,
  NoteTypeTemplateManager,
  createFilesystemProject,
  findProjectRoot,
  // Functions
  buildTraceabilityMatrix,
  findGaps,
  parseClaimAddress,
  parseClaimMetadata,
  parseNoteMentions,
  searchClaims,
  buildClaimTree,
  // Types
  type Note,
  type NoteQuery,
  type SCEpterConfig,
  type Reference,
  type ClaimAddress,
  type ContextHints,
  type NoteStorage,
  type ConfigStorage,
} from './index.js';

// Verify runtime value access (not just types)
console.log(typeof ProjectManager);      // 'function'
console.log(typeof parseClaimAddress);   // 'function'
console.log(typeof buildTraceabilityMatrix); // 'function'
console.log(typeof createFilesystemProject); // 'function'
```

Run typecheck:

```bash
pnpm tsc --noEmit
```

#### Step 3: Runtime Import Check

```bash
pnpm tsx -e "const lib = require('./core/src/index.ts'); console.log(Object.keys(lib).length, 'exports'); console.log('ProjectManager:', typeof lib.ProjectManager);"
```

#### Step 4: Verify No CLI Dependencies in Library Graph

Check that the library entry point's dependency graph does not include Commander.js or chalk:

```bash
pnpm tsx -e "
  // Import the library barrel and verify no CLI modules loaded
  import('./core/src/index.ts').then(() => {
    const loaded = Object.keys(require.cache || {});
    const cliLeaks = loaded.filter(p => p.includes('commander') || p.includes('/chalk/'));
    if (cliLeaks.length > 0) {
      console.error('CLI dependencies leaked:', cliLeaks);
      process.exit(1);
    }
    console.log('No CLI dependencies in library import graph');
  });
"
```

§DC.13:derives=A003.§3.AC.05 The verification MUST confirm that Commander.js and chalk are not in the library entry point's import graph.

#### Step 5: Circular Dependency Check

After the build, verify no circular imports were introduced:

```bash
pnpm tsx -e "import('./core/src/index.ts').then(m => console.log('Library loaded successfully,', Object.keys(m).length, 'exports')).catch(e => { console.error('Import failed:', e.message); process.exit(1); })"
```

If the import resolves without hanging or throwing, there are no blocking circular dependencies.

---

## Claim Traceability Summary

### Claims Derived in This DD

| DD011 Claim | Derives from | Summary |
|-------------|-------------|---------|
| `DC.01` | {A003.§3.AC.02} | Types barrel content specification |
| `DC.02` | {A003.§3.AC.02} | Name collision handling in types barrel |
| `DC.03` | {A003.§3.AC.01} | Top-level barrel organization by subsystem |
| `DC.04` | {A003.§3.AC.06} | Public API boundary enforcement in barrel |
| `DC.05` | {A003.§3.AC.05} | CLI/LLM/chat exclusion from barrel |
| `DC.06` | {A003.§3.AC.06} | Explicit exclusion list for internal modules |
| `DC.07` | {A003.§3.AC.03} | Dual entry point tsup configuration |
| `DC.08` | {A003.§3.AC.03} | DTS generation requirement |
| `DC.09` | {A003.§3.AC.04} | Package.json exports map specification |
| `DC.10` | {A003.§3.AC.04} | CLI bin field preservation |
| `DC.11` | {A003.§3.AC.05} | Tree-shaking and sideEffects configuration |
| `DC.12` | {A003.§5.AC.04} | Importability verification procedure |
| `DC.13` | {A003.§3.AC.05} | CLI dependency leak detection |

### A003 Claims Covered (Phases 1-2)

| A003 Claim | Covered by | How |
|------------|-----------|-----|
| {A003.§1.AC.01} | DC.03, DC.07, DC.09 | Barrel + build + package.json make library importable |
| {A003.§2.AC.02} | DC.01, DC.03, DC.07, DC.09 | All missing infrastructure created |
| {A003.§2.AC.03} | DC.03 | Claims barrel used as model for structure |
| {A003.§3.AC.01} | DC.03 | Top-level barrel specified |
| {A003.§3.AC.02} | DC.01, DC.02 | Types barrel specified with collision handling |
| {A003.§3.AC.03} | DC.07, DC.08 | Dual entry point build specified |
| {A003.§3.AC.04} | DC.09, DC.10 | Package.json exports map specified |
| {A003.§3.AC.05} | DC.05, DC.11, DC.13 | CLI exclusion + tree-shaking + verification |
| {A003.§3.AC.06} | DC.04, DC.06 | Public/internal boundary specified with exclusion list |
| {A003.§5.AC.01} | DC.01, DC.03 | Barrel creation specified |
| {A003.§5.AC.02} | DC.07 | tsup update specified |
| {A003.§5.AC.03} | DC.09 | Package.json update specified |
| {A003.§5.AC.04} | DC.12 | Verification procedure specified |
| {A003.§6.AC.01} | DC.03 | Storage interfaces re-exported as-is, no dependency on A002 completion |
| {A003.§6.AC.02} | DC.03 | Storage types included in barrel exports |

### A003 Claims Out of Scope (Phase 3+)

These claims are about the VS Code extension migration and are deferred to a separate DD:

| A003 Claim | Reason |
|------------|--------|
| {A003.§1.AC.02} | VS Code extension migration (Phase 3) |
| {A003.§1.AC.03} | Type duplication elimination (Phase 3) |
| {A003.§1.AC.04} | Pattern duplication elimination (Phase 3) |
| {A003.§1.AC.05} | Config detection migration (Phase 3) |
| {A003.§2.AC.01} | Assessment only, no implementation action |
| {A003.§4.AC.01} | VS Code extension consumer pattern (Phase 3) |
| {A003.§4.AC.02} | VS Code config detection migration (Phase 3) |
| {A003.§4.AC.03} | VS Code parser migration (Phase 3) |
| {A003.§4.AC.04} | VS Code file watching (Phase 3) |
| {A003.§5.AC.05} | VS Code incremental migration (Phase 3) |
| {A003.§5.AC.06} | VS Code activation event (Phase 4) |
| {A003.§7.AC.01} | Risk assessment, no implementation action |
| {A003.§7.AC.02} | Risk assessment, no implementation action |
| {A003.§7.AC.03} | Risk assessment, no implementation action |

---

## Projection Coverage

| Projection | Status | Notes |
|------------|--------|-------|
| Source | To be implemented | `core/src/index.ts`, `core/src/types/index.ts`, `core/tsup.config.ts`, `package.json` |
| Tests | Not in this DD | Verification plan uses ad-hoc scripts; formal test is out of scope for Phase 1-2 |
| CLI | No change | CLI entry point unaffected |
| Docs | Not in this DD | API documentation is a Phase 3+ concern |
