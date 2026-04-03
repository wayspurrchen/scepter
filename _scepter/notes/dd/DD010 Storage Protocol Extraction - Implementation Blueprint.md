---
created: 2026-04-02T05:22:26.241Z
tags: [storage, backend, abstraction, protocol, refactor]
status: draft
---

# DD010 - Storage Protocol Extraction - Implementation Blueprint

**Architecture:** {A002}
**Date:** 2026-04-02
**Scope:** Implementation blueprint for Phases 1-4 of the StorageBackend protocol extraction — defining interfaces, wrapping existing filesystem code, threading through ProjectManager, and fixing leaky handlers. Alternative backends (Phase 5) are out of scope per {A002.§3.AC.06}.

---

## Current State

The filesystem I/O in SCEpter is concentrated in six subsystems. Each has a well-defined storage boundary that the extraction wraps:

| Subsystem | File | Primary I/O |
|-----------|------|------------|
| `NoteFileManager` | `notes/note-file-manager.ts` | `fs-extra`, `chokidar`, `glob`, `gray-matter` — note CRUD, indexing, watching |
| `UnifiedDiscovery` | `discovery/unified-discovery.ts` | `glob`, `fs`, `chokidar` — note finding by ID prefix |
| `ConfigManager` | `config/config-manager.ts` | `fs/promises` — JSON config read/write at two paths |
| `NoteTypeTemplateManager` | `templates/note-type-template-manager.ts` | `fs/promises`, `chokidar` — template directory reads, file watching |
| `VerificationStore` | `claims/verification-store.ts` | `fs/promises` — JSON read/write of `verification.json` |
| `NoteIdGenerator` | `notes/note-id-generator.ts` | Already has `IdGeneratorStorage` interface ({A002.§1.AC.03}) |

Leaky handlers with direct filesystem access:

| Handler | File | Coupling |
|---------|------|----------|
| `ingest-handler.ts` | `cli/commands/context/ingest-handler.ts` | `fs-extra`: `readFile`, `writeFile`, `unlink`, `stat`, `readdir`, `ensureDir` |
| `gather-handler.ts` | `cli/commands/context/gather-handler.ts` | `fs/promises`: `stat`, `readFile` for folder note attachments |
| `create-handler.ts` | `cli/commands/context/create-handler.ts` | `fs-extra`: `pathExists`, `readFile` for template resolution |

`ProjectManager` itself performs direct filesystem operations during initialization: `fs.access`, `fs.mkdir`, `fs.readdir`, `fs.stat`, `fs.writeFile` for directory creation, access checks, and `.gitkeep` management.

`NoteManager` bypasses `NoteFileManager` in five places: `fs.pathExists` in `findNoteFile`, `fs.readFile` in `getNoteById` fallback, `fs.unlink` in `changeNoteType`, and two `fs.readFile` calls in file watcher event handlers (`handleFileCreated` line 1582, `handleFileModified` line 1724).

---

## Module Inventory

### Phase 1: Interface Definitions

#### `core/src/storage/storage-types.ts` (NEW)

§DC.01:derives=A002.§3.AC.01 Supporting types for storage interfaces MUST be defined in `storage-types.ts`.

| Type | Definition | Notes |
|------|-----------|-------|
| `StorageEvent` | `{ type: 'created' \| 'modified' \| 'deleted' \| 'moved'; noteId: string; path?: string }` | Backend-agnostic change notification |
| `Attachment` | `{ name: string; size: number; mimeType?: string }` | Metadata for folder-note assets |
| `AttachmentContent` | `{ name: string; content: Buffer; mimeType?: string }` | Attachment with data |
| `Unsubscribe` | `() => void` | Cleanup handle for watch subscriptions |
| `DeleteMode` | `'archive' \| 'soft-delete' \| 'permanent'` | Mirrors existing NoteFileManager semantics |
| `StorageStatistics` | `{ noteCount: number; typeBreakdown: Record<string, number>; lastModified?: Date; totalSize?: number }` | Backend-agnostic project statistics |

#### `core/src/storage/storage-backend.ts` (NEW)

§DC.02:derives=A002.§2.AC.01 `NoteStorage` interface MUST define note CRUD, bulk loading, and attachment operations.

```typescript
interface NoteStorage {
  // Single-note CRUD
  getNote(id: string): Promise<Note | null>;
  createNote(note: Note): Promise<void>;
  updateNote(note: Note): Promise<void>;
  deleteNote(id: string, mode: DeleteMode): Promise<void>;
  restoreNote(id: string): Promise<void>;

  // Query
  getNotes(query: NoteQuery): Promise<NoteQueryResult>;

  // Bulk operations for initialization
  getAllNotes(): Promise<Note[]>;
  getAllReferences(): Promise<Reference[]>;

  // Type management (admin operations)
  renameNotesOfType(oldType: string, newType: string, newShortcode: string): Promise<void>;
  archiveNotesOfType(type: string): Promise<void>;
  getStatistics(): Promise<StorageStatistics>;

  // Attachments (folder-based notes)
  getAttachments(noteId: string): Promise<Attachment[]>;
  getAttachmentContent(noteId: string, name: string): Promise<Buffer>;
  putAttachment(noteId: string, name: string, content: Buffer): Promise<void>;

  // Change notification (optional)
  watch?(callback: (event: StorageEvent) => void): Unsubscribe;
}
```

The `getNotes(query)` method is included per {A002.§5.OQ.01}'s recommendation. The filesystem adapter implements it as `getAllNotes()` + in-memory filter; future backends may push filtering to the storage layer.

Type management methods (`renameNotesOfType`, `archiveNotesOfType`, `getStatistics`) are included because `ProjectManager.renameType()`, `deleteType()`, `listNoteTypes()`, and `getStatistics()` currently contain substantial filesystem logic that must go through the storage protocol. These are note operations — renaming all notes of a type, archiving notes, querying storage-level statistics — and belong on `NoteStorage` rather than a separate interface.

Note: `getFilePath` is NOT on the `NoteStorage` interface. It is a filesystem-specific concern available only on the concrete `FilesystemNoteStorage` class. Consumers that need file paths for display should access the `Note.filePath` property (already present on Note objects) or cast to the concrete type.

§DC.03:derives=A002.§2.AC.02 `ConfigStorage` interface MUST define configuration loading and saving.

```typescript
interface ConfigStorage {
  load(): Promise<SCEpterConfig | null>;
  save(config: SCEpterConfig): Promise<void>;
}
```

§DC.04:derives=A002.§2.AC.03 `TemplateStorage` interface MUST define template retrieval.

```typescript
interface TemplateStorage {
  getTemplate(noteType: string): Promise<string | null>;
  listTemplates(): Promise<string[]>;
}
```

§DC.05:derives=A002.§2.AC.04 `VerificationStorage` interface MUST define verification event persistence.

```typescript
interface VerificationStorage {
  load(): Promise<VerificationStore>;
  save(store: VerificationStore): Promise<void>;
}
```

§DC.06:derives=A002.§2.AC.05 `IdCounterStorage` interface MUST formalize the existing `IdGeneratorStorage` pattern.

```typescript
interface IdCounterStorage {
  load(): Promise<Record<string, number>>;
  save(counters: Record<string, number>): Promise<void>;
}
```

This is a rename of the existing `IdGeneratorStorage` in `note-id-generator.ts` for naming consistency. The existing interface already matches this signature exactly. The old name SHOULD be kept as a type alias for backwards compatibility:

```typescript
// In note-id-generator.ts
export type IdGeneratorStorage = IdCounterStorage;
```

§DC.07:derives=A002.§2.AC.06 All storage interface methods MUST use `Promise`-based async signatures.

Even where the filesystem adapter wraps synchronous operations, the interface uses `Promise` returns. This is non-negotiable for REST and database backends where every operation is inherently async.

#### `core/src/storage/index.ts` (NEW)

§DC.08:derives=A002.§3.AC.01 Barrel file MUST re-export all interfaces and types from the storage module.

Re-exports: `NoteStorage`, `ConfigStorage`, `TemplateStorage`, `VerificationStorage`, `IdCounterStorage`, `StorageEvent`, `Attachment`, `AttachmentContent`, `Unsubscribe`, `DeleteMode`.

### Phase 2: Filesystem Adapters

#### `core/src/storage/filesystem/filesystem-note-storage.ts` (NEW)

§DC.09:derives=A002.§3.AC.02 `FilesystemNoteStorage` MUST implement `NoteStorage` by delegating to `NoteFileManager`, `UnifiedDiscovery`, and supporting parsers.

**Constructor dependencies:**

```typescript
class FilesystemNoteStorage implements NoteStorage {
  constructor(
    private noteFileManager: NoteFileManager,
    private unifiedDiscovery: UnifiedDiscovery,
    private configManager: ConfigManager,
    private noteTypeResolver: NoteTypeResolver,
  ) {}

  // Filesystem-specific (NOT on the NoteStorage interface)
  getFilePath(noteId: string): string | undefined {
    return this.noteFileManager.getFilePath(noteId);
  }
}
```

`UnifiedDiscovery` is required because it performs the actual note discovery and parsing pipeline (glob scanning, frontmatter extraction via `gray-matter`, type resolution). `NoteFileManager.buildIndex()` only builds a `noteId -> filePath` map; it does not parse notes into `Note` objects. `NoteTypeResolver` is required for `getNote()` to determine note type from the ID prefix during parsing.

**Method-by-method delegation map:**

| `NoteStorage` method | Delegates to | Notes |
|---------------------|-------------|-------|
| `getNote(id)` | `NoteFileManager.findNoteFile(id)` -> `NoteFileManager.getFileContents(id)` -> parse with `gray-matter` + `NoteTypeResolver` | Returns parsed `Note` with frontmatter, type, content. The parsing pipeline mirrors `UnifiedDiscovery.parseNoteFile()`. |
| `getNotes(query)` | `getAllNotes()` then in-memory filter using `NoteQuery` matching logic | Filesystem adapter does not push queries to storage. Future backends may implement native query pushdown. |
| `createNote(note)` | `NoteFileManager.createNoteFile(note)` | Direct delegation |
| `updateNote(note)` | `NoteFileManager.updateNoteFile(note)` | Direct delegation |
| `deleteNote(id, 'archive')` | `NoteFileManager.archiveNoteFile(id)` | Mode dispatch |
| `deleteNote(id, 'soft-delete')` | `NoteFileManager.deleteNoteFile(id)` | Mode dispatch |
| `deleteNote(id, 'permanent')` | `NoteFileManager.purgeNoteFile(id)` | Mode dispatch |
| `restoreNote(id)` | `NoteFileManager.restoreNoteFile(id)` | Direct delegation |
| `getAllNotes()` | `UnifiedDiscovery.discoverAll()` | Returns fully parsed `Note[]` with frontmatter, content, type. This is the actual discovery pipeline — NOT `NoteFileManager.buildIndex()` which only builds a path map. |
| `getAllReferences()` | Parse references from all loaded notes via `parseNoteMentions` | Uses existing reference parsing from `NoteManager` |
| `renameNotesOfType(old, new, sc)` | Iterates notes of type, calls `NoteFileManager` rename + content rewrite | Extracts logic from `ProjectManager.renameType()` |
| `archiveNotesOfType(type)` | Iterates notes of type, calls `NoteFileManager.archiveNoteFile()` for each | Extracts logic from `ProjectManager.deleteType()` |
| `getStatistics()` | Scans note directories for counts, sizes, last-modified | Extracts logic from `ProjectManager.getStatistics()`, `getLastModifiedInDirectory()`, `getDirectorySize()` |
| `getAttachments(noteId)` | `scanFolderContents(folderPath)` + stat each | Wraps `folder-utils.ts` |
| `getAttachmentContent(noteId, name)` | `fs.readFile(path.join(folderPath, name))` | Wraps filesystem read |
| `putAttachment(noteId, name, content)` | `fs.writeFile(path.join(folderPath, name), content)` | Wraps filesystem write |
| `watch(callback)` | `NoteFileManager.startWatching()` + event translation | Translates file events to `StorageEvent` |

#### `core/src/storage/filesystem/filesystem-config-storage.ts` (NEW)

§DC.10:derives=A002.§3.AC.03 `FilesystemConfigStorage` MUST implement `ConfigStorage` by wrapping `ConfigManager` I/O methods.

Method mapping:

| `ConfigStorage` method | Wraps | Notes |
|-----------------------|-------|-------|
| `load()` | `ConfigManager.loadConfigFromFilesystem()` | Existing two-path search logic |
| `save(config)` | `ConfigManager.saveConfig()` | Existing atomic write with backup |

Constructor:
```typescript
class FilesystemConfigStorage implements ConfigStorage {
  constructor(private projectPath: string) {}
}
```

The adapter extracts the filesystem I/O from `ConfigManager.loadConfigFromFilesystem()` and `ConfigManager.saveConfig()`. After extraction, `ConfigManager` receives its config via `setConfig()` — it no longer reads from disk itself. The load path becomes: `FilesystemConfigStorage.load()` -> `ConfigManager.setConfig(result)`.

#### `core/src/storage/filesystem/filesystem-template-storage.ts` (NEW)

§DC.11:derives=A002.§3.AC.03 `FilesystemTemplateStorage` MUST implement `TemplateStorage` by wrapping `NoteTypeTemplateManager` I/O.

Method mapping:

| `TemplateStorage` method | Wraps | Notes |
|-------------------------|-------|-------|
| `getTemplate(noteType)` | Directory read + file read from `_scepter/templates/types/` | Existing `loadTemplates()` logic |
| `listTemplates()` | `fs.readdir()` of template directory | Existing directory scan |

Constructor:
```typescript
class FilesystemTemplateStorage implements TemplateStorage {
  constructor(
    private projectPath: string,
    private configManager: ConfigManager,
  ) {}
}
```

After extraction, `NoteTypeTemplateManager` receives template content via the `TemplateStorage` interface instead of reading files directly.

#### `core/src/storage/filesystem/filesystem-verification-storage.ts` (NEW)

§DC.12:derives=A002.§3.AC.03 `FilesystemVerificationStorage` MUST implement `VerificationStorage` by wrapping existing `loadVerificationStore` / `saveVerificationStore` functions.

Method mapping:

| `VerificationStorage` method | Wraps | Notes |
|-----------------------------|-------|-------|
| `load()` | `loadVerificationStore(dataDir)` from `verification-store.ts` | Existing JSON read with legacy normalization |
| `save(store)` | `saveVerificationStore(dataDir, store)` from `verification-store.ts` | Existing JSON write |

Constructor:
```typescript
class FilesystemVerificationStorage implements VerificationStorage {
  constructor(private dataDir: string) {}
}
```

The existing `loadVerificationStore` and `saveVerificationStore` functions already have the right shape. The adapter is a thin wrapper that captures the `dataDir` at construction time instead of passing it to every call.

#### `core/src/storage/filesystem/filesystem-id-counter-storage.ts` (NEW)

§DC.13:derives=A002.§3.AC.03 `FilesystemIdCounterStorage` MUST implement `IdCounterStorage` using the existing scan-based approach.

The current `NoteIdGenerator` derives counters from existing note IDs via `setExistingIds()` rather than persisting counters to disk. The filesystem adapter follows this pattern:

```typescript
class FilesystemIdCounterStorage implements IdCounterStorage {
  constructor(private noteStorage: NoteStorage) {}

  async load(): Promise<Record<string, number>> {
    // Scan all notes and derive max ID per shortcode
    const notes = await this.noteStorage.getAllNotes();
    // ... existing setExistingIds logic
  }

  async save(counters: Record<string, number>): Promise<void> {
    // No-op for filesystem — counters are derived from filenames
  }
}
```

#### `core/src/storage/filesystem/index.ts` (NEW)

§DC.14:derives=A002.§3.AC.01 Barrel file MUST re-export all filesystem adapter classes.

Re-exports: `FilesystemNoteStorage`, `FilesystemConfigStorage`, `FilesystemTemplateStorage`, `FilesystemVerificationStorage`, `FilesystemIdCounterStorage`.

### Phase 3: ProjectManager Wiring

#### `core/src/storage/filesystem/create-filesystem-project.ts` (NEW)

§DC.15:derives=A002.§3.AC.04 A `createFilesystemProject()` factory function MUST construct filesystem-specific wiring and return a `ProjectManager`.

```typescript
async function createFilesystemProject(
  projectPath: string,
  options?: { llmFunction?: SimpleLLMFunction }
): Promise<ProjectManager> {
  // 1. Bootstrap filesystem: ensure directories exist, check access
  //    (This is the code currently in ProjectManager.initialize())
  await bootstrapFilesystemDirs(projectPath);

  // 2. Create filesystem storage adapters
  const configManager = new ConfigManager(projectPath);
  const configStorage = new FilesystemConfigStorage(projectPath);
  const config = await configStorage.load();
  if (!config) throw new Error('No configuration file found.');
  configManager.validateAndLoad(config);

  const noteFileManager = new NoteFileManager(projectPath, configManager);
  const noteStorage = new FilesystemNoteStorage(noteFileManager, configManager);
  const templateStorage = new FilesystemTemplateStorage(projectPath, configManager);
  const verificationStorage = new FilesystemVerificationStorage(
    path.join(projectPath, config.paths?.dataDir || '_scepter')
  );
  const idCounterStorage = new FilesystemIdCounterStorage(noteStorage);

  // 3. Construct ProjectManager with storage interfaces
  return new ProjectManager(projectPath, {
    configManager,
    noteStorage,
    configStorage,
    templateStorage,
    verificationStorage,
    idCounterStorage,
    llmFunction: options?.llmFunction,
  });
}
```

§DC.16:derives=A002.§3.AC.04 A `bootstrapFilesystemDirs()` function MUST extract directory creation from `ProjectManager.initialize()`.

This function moves the following logic out of `ProjectManager`:
- `fs.access(projectPath)` — access check
- `fs.mkdir(projectPath, { recursive: true })` — directory creation
- `createBaseDirectories(config)` — `_scepter`, notes root, optional dirs
- `createNoteTypeDirectories(config)` — per-type folders with `.gitkeep`
- `ensureGitkeep()` — empty directory placeholder

After extraction, `ProjectManager.initialize()` contains zero `fs` imports.

#### `core/src/project/project-manager.ts` (MODIFY)

§DC.17:derives=A002.§3.AC.04 `ProjectManager` constructor MUST accept storage interfaces instead of constructing filesystem classes directly.

Current constructor signature:
```typescript
constructor(
  public projectPath: string,
  deps: ProjectManagerDependencies = {},
)
```

New constructor signature:
```typescript
constructor(
  public projectPath: string,
  deps: ProjectManagerDependencies = {},
)
```

The `ProjectManagerDependencies` interface expands to include:
```typescript
interface ProjectManagerDependencies {
  configManager?: ConfigManager;
  noteManager?: NoteManager;
  referenceManager?: ReferenceManager;
  noteFileManager?: NoteFileManager;      // DEPRECATED — kept for backwards compat
  noteStorage?: NoteStorage;              // NEW
  configStorage?: ConfigStorage;          // NEW
  templateStorage?: TemplateStorage;      // NEW
  verificationStorage?: VerificationStorage; // NEW
  idCounterStorage?: IdCounterStorage;    // NEW
  noteTypeResolver?: NoteTypeResolver;
  noteTypeTemplateManager?: NoteTypeTemplateManager;
  contextGatherer?: ContextGatherer;
  taskDispatcher?: TaskDispatcher;
  sourceScanner?: SourceCodeScanner;
  llmFunction?: SimpleLLMFunction;
}
```

§DC.18:derives=A002.§3.AC.04 `ProjectManager.initialize()` MUST NOT perform direct filesystem operations after extraction.

Removals from `initialize()`:
- `fs.access(this.projectPath)` — moved to `bootstrapFilesystemDirs`
- `fs.mkdir(this.projectPath)` — moved to `bootstrapFilesystemDirs`
- `fs.readdir(this.projectPath)` — moved to `bootstrapFilesystemDirs`
- `this.createBaseDirectories(config)` — moved to `bootstrapFilesystemDirs`
- `this.createNoteTypeDirectories(config)` — moved to `bootstrapFilesystemDirs`
- All `fs.*` imports at the top of `project-manager.ts`

Retained in `initialize()`:
- Config loading via `configStorage.load()` (if not already loaded by factory)
- StatusValidator creation
- NoteTypeResolver initialization
- NoteManager initialization (which delegates to NoteStorage internally)
- SourceCodeScanner initialization (intentionally filesystem-coupled per {A002.§4.AC.02})

§DC.19:derives=A002.§1.AC.01 After extraction, `ProjectManager` MUST contain zero `fs`, `fs-extra`, `fs/promises`, `glob`, or `chokidar` imports.

The `import * as fs from 'fs/promises'` and `import * as fsExtra from 'fs-extra'` at the top of `project-manager.ts` MUST be removed. All filesystem operations that currently live in `ProjectManager` methods (`createBaseDirectories`, `createNoteTypeDirectories`, `createProjectMetadata`, `ensureGitkeep`, `checkDirectory`, `checkOptionalDirectory`, `checkOrphanedFolders`, `getLastModifiedInDirectory`, `getDirectorySize`, `findProjectRoot`) MUST be either:
- Moved to `bootstrapFilesystemDirs` (initialization operations), or
- Moved to a `FilesystemProjectUtils` module (validation, statistics), or
- Left as static utility functions outside the class body

The `findProjectRoot()` static method is a special case — it searches for configuration files by walking up the directory tree. This is inherently filesystem-bound and is used before any ProjectManager instance exists. It SHOULD remain as a standalone function in the filesystem module, not on ProjectManager.

### Phase 4: Handler Refactors

#### `core/src/cli/commands/context/ingest-handler.ts` (MODIFY)

§DC.20:derives=A002.§3.AC.05 `ingest-handler.ts` MUST be rewritten to use `noteManager.createNote()` instead of raw filesystem calls.

Current direct filesystem calls to remove:
- `fs.readFile(sourcePath, 'utf-8')` — reading source file content
- `fs.writeFile(destPath, newContent, 'utf-8')` — writing ingested note
- `fs.unlink(sourcePath)` — removing original file after move
- `fs.stat(resolved)` — checking if source is file or directory
- `fs.readdir(resolved)` — listing directory contents
- `fs.ensureDir(targetDir)` — creating target directory

Refactored approach: The ingest handler reads external files (not notes) and creates notes from them. The file-reading of source files is an I/O concern at the CLI boundary, not a storage concern. The refactored handler:
1. Reads source files using a `readSourceFile(path): Promise<string>` helper (this remains filesystem-bound — it reads arbitrary user files, not managed notes)
2. Calls `noteManager.createNote()` with the parsed content
3. Removes the original file only if `--move` is specified (this also remains filesystem-bound — it's a user file operation)

The key change: note creation MUST go through `noteManager.createNote()`, not raw `fs.writeFile()`. The current handler reimplements note creation logic (frontmatter merging, filename generation, directory management) that already exists in `NoteFileManager.createNoteFile()`.

**Observation:** Reading and deleting user-provided source files (the inputs to ingest) is inherently a CLI/filesystem concern. Only the note *creation* half of ingest needs to go through the storage protocol. The source file I/O is acceptable at the CLI layer per {A002.§4.AC.02}'s principle — it operates on user files, not managed notes.

#### `core/src/cli/commands/context/gather-handler.ts` (MODIFY)

§DC.21:derives=A002.§3.AC.05 `gather-handler.ts` MUST use `NoteStorage.getAttachments()` and `NoteStorage.getAttachmentContent()` instead of direct `fs` calls.

Current direct filesystem calls in `analyzeFolderContents()`:
- `fs.stat(fullPath)` — getting attachment file size and type
- `fs.readFile(fullPath, 'utf-8')` — reading text attachment content

Refactored approach: `analyzeFolderContents()` receives a `NoteStorage` instance and calls:
- `noteStorage.getAttachments(noteId)` — returns `Attachment[]` with name, size, mimeType
- `noteStorage.getAttachmentContent(noteId, name)` — returns `Buffer` for text file content

The `fs/promises` import in `gather-handler.ts` also covers `fs.stat` for source code reference file size (line 211). This is the same intentional filesystem coupling as `SourceCodeScanner` — reading source files for display. It MAY remain or be handled by a display-layer utility.

#### `core/src/cli/commands/context/create-handler.ts` (MODIFY)

§DC.22:derives=A002.§3.AC.05 `create-handler.ts` MUST use `TemplateStorage.getTemplate()` instead of direct filesystem template resolution.

Current direct filesystem calls in `resolveTemplate()`:
- `fs.pathExists(globalTemplatePath)` — checking if template file exists
- `fs.readFile(templatePath, 'utf-8')` — reading template content (line 102)

Refactored approach: The `resolveTemplate()` function is replaced by a call to `templateStorage.getTemplate(type)` obtained from `ProjectManager`. The handler accesses it via `projectManager.templateStorage` or a convenience method.

**Observation:** `create-handler.ts` also uses `fs` for the editor feature (`fs.writeFile(tmpFile, ...)`, `fs.readFile(tmpFile, ...)`, `fs.unlink(tmpFile)`). These are temporary file operations for the editor workflow, not storage operations. They are acceptable at the CLI layer.

#### Lower-severity handlers (NO CHANGE REQUIRED)

§DC.23:derives=A002.§3.AC.05 The following handlers have filesystem coupling that is intentional and NOT part of the storage protocol.

| Handler | Filesystem Usage | Rationale | A002 Severity | Resolution |
|---------|-----------------|-----------|---------------|------------|
| `show-handler.ts` | `fs.pathExists` for user paths, `fs.writeFile` for export | UI/display concern, not storage. The export-to-file feature writes to a user-specified path, which is inherently a CLI-layer operation. | Low | No change to fs usage. However, `show-handler.ts` also calls `loadVerificationStore(dataDir)` — this IS a storage concern and is addressed by DC.26. |
| `search-handler.ts` | `glob` + `fs.readFile` for source code search | Same as `SourceCodeScanner` — reads source files, not notes ({A002.§4.AC.02}). Source code is not managed by the storage protocol. | Low | No change. |
| `confidence/mark-command.ts` | Reads/writes source files via `fs-extra` | Source file annotation, not note storage. Operates on the same source files as `SourceCodeScanner`. A002 rated this "Medium" severity; we reclassify to intentional because the coupling is to source files (per {A002.§4.AC.02}'s principle), not to note storage. | Medium -> Intentional | No change. Deliberate reclassification: source file operations are outside the storage protocol boundary. |
| `claim-formatter.ts` | `fs.readFile` for source file content display | Reads source files to show claim context in trace output. Same intentional coupling category as `SourceCodeScanner`. | (not in A002) | No change. DD010 elaboration — discovered during codebase inspection. |

### Phase 2.5: NoteManager Cleanup

#### `core/src/notes/note-manager.ts` (MODIFY)

§DC.24:derives=A002.§3.AC.04 `NoteManager` MUST NOT bypass `NoteFileManager` for filesystem operations.

Five direct filesystem calls MUST be routed through `NoteFileManager`:

| Current call | Location | Route through |
|-------------|----------|---------------|
| `fs.pathExists(cached)` | `findNoteFile()` line 629 | `NoteFileManager.ensureNoteFile(noteId)` or inline `try { await stat(cached) }` within NoteFileManager |
| `fs.readFile(filepath, 'utf-8')` | `getNoteById()` fallback, line 978 | `NoteFileManager.getFileContents(noteId)` (already exists) |
| `fs.unlink(oldPath)` | `changeNoteType()` line 916 | `NoteFileManager.deleteNoteFile()` or a new `NoteFileManager.removeFile(path)` method |
| `fs.readFile(event.filePath, 'utf-8')` | `handleFileCreated()` watcher callback, line 1582 | `NoteFileManager.getFileContents(noteId)` — requires translating `filePath` to `noteId` via `NoteFileManager.fileToNoteId` map |
| `fs.readFile(event.filePath, 'utf-8')` | `handleFileModified()` watcher callback, line 1724 | `NoteFileManager.getFileContents(noteId)` — same filePath-to-noteId translation |

The two watcher event handler calls (lines 1582, 1724) are superseded by the `NoteStorage.watch()` event model from DC.09, which provides `StorageEvent` objects with `noteId` rather than raw file paths. After extraction, NoteManager receives `StorageEvent` notifications and retrieves content via `NoteStorage.getNote()`, not by reading files directly.

§DC.25:derives=A002.§1.AC.01 After extraction, `NoteManager` MUST contain zero `fs`, `fs-extra`, `fs/promises`, `glob`, or `chokidar` imports.

The `import fs from 'fs-extra'` at line 7 of `note-manager.ts` MUST be removed. All five filesystem calls listed in DC.24 must be eliminated first. This is the NoteManager counterpart to DC.19 (which covers ProjectManager).

§DC.26:derives=A002.§3.AC.04 All verification store consumers MUST be migrated from `loadVerificationStore(dataDir)` to `projectManager.verificationStorage`.

The following files compute a `dataDir` filesystem path and call `loadVerificationStore(dataDir)` directly. After extraction, they MUST use `projectManager.verificationStorage.load()` instead:

| File | Current call sites |
|------|-------------------|
| `claims/verify-command.ts` | Lines 77, 176, 194 (load and save) |
| `claims/stale-command.ts` | Line 44 |
| `claims/trace-command.ts` | Line 204 |
| `claims/gaps-command.ts` | Lines 111, 141 |
| `claims/thread-command.ts` | Line 58 |
| `claims/ensure-index.ts` | Line 33 |
| `context/show-handler.ts` | Line 191 |
| `context/search.ts` | Line 194 |

These are mechanical one-line changes: replace `loadVerificationStore(path.join(projectPath, config.paths?.dataDir || '_scepter'))` with `projectManager.verificationStorage.load()`. The `saveVerificationStore` calls in `verify-command.ts` become `projectManager.verificationStorage.save(store)`. This work is sequenced after Step 3.2 (when `ProjectManager` exposes `verificationStorage`).

§DC.27:derives=A002.§1.AC.01 `ProjectManager` type management methods MUST be extracted to use `NoteStorage` operations.

The following `ProjectManager` methods contain substantial filesystem logic that must route through the storage protocol:

| Method | Current filesystem operations | Extraction target |
|--------|------------------------------|-------------------|
| `renameType()` | `fs.access` (template check), `fs.rename` (note files + templates), `fs.readFile`/`fs.writeFile` (content rewrite) | `noteStorage.renameNotesOfType()` + `configStorage.save()` |
| `deleteType()` | `fsExtra.ensureDir` (archive dir), `fs.rename` (archiving notes), `fs.readFile`/`fs.writeFile` (content updates), `fs.readdir`/`fs.rmdir` (folder cleanup) | `noteStorage.archiveNotesOfType()` + `configStorage.save()` |
| `listNoteTypes()` | `fsExtra.pathExists` (template existence check) | Template check via `templateStorage.getTemplate()` |
| `getStatistics()` | `getLastModifiedInDirectory()`, `getDirectorySize()` — both filesystem-bound | `noteStorage.getStatistics()` |
| `validateStructure()` | `checkDirectory()`, `checkOptionalDirectory()` — filesystem stat calls | Move to `bootstrapFilesystemDirs()` or a filesystem validation utility |
| `findProjectRoot()` | Static method with `fs.access` calls | Move to standalone function in filesystem module |

After extraction, these methods either delegate to storage interfaces or are moved out of `ProjectManager` entirely. This is required to achieve DC.19 (zero fs imports in ProjectManager).

---

## Wiring Map

### Import Graph After Extraction

```
CLI Commands (create, ingest, gather, show, types/*, claims/*)
    |
    v
BaseCommand.setup()
    |  Creates ProjectManager via createFilesystemProject()
    v
ProjectManager (composition root) -- NO fs imports
    |
    +-- NoteManager -- NO fs imports
    |     +-- receives NoteStorage (via constructor)
    |     +-- NoteTypeResolver (pure, no I/O)
    |     +-- NoteTypeTemplateManager (receives TemplateStorage)
    |
    +-- ReferenceManager (pure, no I/O -- unchanged)
    +-- ClaimIndex (pure, no I/O -- unchanged)
    +-- ContextGatherer (pure traversal -- unchanged)
    +-- StatusValidator (pure validation -- unchanged)
    +-- SourceCodeScanner (intentionally filesystem-coupled)
    |
    v
Storage Interfaces (NoteStorage, ConfigStorage, TemplateStorage, ...)
    |
    v
Filesystem Adapters
    +-- FilesystemNoteStorage -> NoteFileManager -> fs-extra, glob, chokidar
    +-- FilesystemConfigStorage -> fs/promises (JSON read/write)
    +-- FilesystemTemplateStorage -> fs/promises (directory + file read)
    +-- FilesystemVerificationStorage -> fs/promises (JSON read/write)
    +-- FilesystemIdCounterStorage -> NoteStorage.getAllNotes()
```

### Call Chain: Note Creation After Extraction

```
CLI: scepter create Requirement "Auth system"
  -> BaseCommand.setup()
  -> createFilesystemProject(projectPath)
       -> bootstrapFilesystemDirs(projectPath)  [fs calls here]
       -> new FilesystemConfigStorage(projectPath).load()
       -> new NoteFileManager(projectPath, configManager)
       -> new FilesystemNoteStorage(noteFileManager, configManager)
       -> new ProjectManager(projectPath, { noteStorage, configStorage, ... })
  -> ProjectManager.initialize()  [NO fs calls]
       -> configStorage.load() [or already loaded]
       -> noteManager.initialize()
       -> noteStorage.getAllNotes()  [builds index]
  -> create-handler.ts
       -> templateStorage.getTemplate(type)  [NOT fs.readFile]
       -> noteManager.createNote(params)
            -> noteStorage.createNote(note)
                 -> noteFileManager.createNoteFile(note)  [fs calls here]
```

### Call Chain: Context Gathering After Extraction

```
CLI: scepter ctx gather R001 --include-folder-contents
  -> BaseCommand.setup() -> ProjectManager
  -> gather-handler.ts
       -> noteManager.getNotes({ ids: [noteId] })
       -> contextGatherer.gatherContext(hints, options)
       -> analyzeFolderContents(origin, noteStorage)
            -> noteStorage.getAttachments(noteId)  [NOT fs.stat]
            -> noteStorage.getAttachmentContent(noteId, name)  [NOT fs.readFile]
```

### BaseCommand Integration

`BaseCommand.setup()` currently constructs `ProjectManager` directly. After extraction, it calls `createFilesystemProject()`:

```typescript
// Before:
const projectManager = new ProjectManager(projectPath);
await projectManager.initialize();

// After:
const projectManager = await createFilesystemProject(projectPath);
await projectManager.initialize();
```

This is the single point where the backend choice is made. Switching to SQLite would mean calling `createSqliteProject()` instead.

---

## Data and Interaction Flow

### Initialization Flow

```
1. createFilesystemProject(projectPath) called
2. bootstrapFilesystemDirs: ensure _scepter/, notes dirs, type dirs exist
3. FilesystemConfigStorage.load(): reads scepter.config.json
4. ConfigManager.validateAndLoad(config): validates and caches
5. Construct all filesystem adapters (NoteStorage, TemplateStorage, etc.)
6. Construct ProjectManager with adapters injected
7. ProjectManager.initialize():
   a. StatusValidator created from config
   b. NoteTypeResolver initialized from config
   c. NoteTypeTemplateManager.initialize() -> calls templateStorage.listTemplates()
   d. NoteManager.initialize() -> calls noteStorage.getAllNotes()
   e. NoteFileManager.buildIndex() -> discovers files on disk
   f. SourceCodeScanner.initialize() -> scans source files (filesystem-coupled)
   g. ReferenceManager.setSourceIndex() -> integrates source references
```

### Verification Store Flow

```
1. CLI: scepter claims verify R004.§1.AC.01
2. verify-command.ts: needs verification store
3. projectManager.verificationStorage.load() -> returns VerificationStore
4. addVerificationEvent(store, event) -> pure in-memory operation
5. projectManager.verificationStorage.save(store) -> persists to backend
```

Currently, `verify-command.ts` calls `loadVerificationStore(dataDir)` with a filesystem path. After extraction, it calls the storage interface method, which the filesystem adapter routes to the same underlying function.

---

## Integration Sequence

### Phase 1: Define Interfaces (types only, no behavior changes)

#### Step 1.1: Create storage types file
**Files:** `core/src/storage/storage-types.ts`
**Changes:** ADD `StorageEvent`, `Attachment`, `AttachmentContent`, `Unsubscribe`, `DeleteMode` types
**Verify:** TypeScript compiles. No runtime changes.
**Claims:** {A002.§3.AC.01}, DC.01

#### Step 1.2: Create storage interfaces file
**Files:** `core/src/storage/storage-backend.ts`
**Changes:** ADD `NoteStorage`, `ConfigStorage`, `TemplateStorage`, `VerificationStorage`, `IdCounterStorage` interfaces
**Verify:** TypeScript compiles. Interfaces import types from step 1.1.
**Claims:** {A002.§2.AC.01}, {A002.§2.AC.02}, {A002.§2.AC.03}, {A002.§2.AC.04}, {A002.§2.AC.05}, {A002.§2.AC.06}, DC.02-DC.07

#### Step 1.3: Create barrel file
**Files:** `core/src/storage/index.ts`
**Changes:** ADD barrel re-exports
**Verify:** `import { NoteStorage, ConfigStorage } from '../storage'` resolves correctly.
**Claims:** DC.08

**Phase 1 acceptance gate:** All types compile. No runtime code. No tests break. Importable from any module.

### Phase 2: Wrap Existing Code

#### Step 2.1: FilesystemVerificationStorage
**Files:** `core/src/storage/filesystem/filesystem-verification-storage.ts`
**Changes:** ADD adapter class wrapping `loadVerificationStore` / `saveVerificationStore`
**Verify:** Adapter instantiable; `load()` returns same data as direct function call. Existing `verification.json` round-trips correctly.
**Claims:** {A002.§3.AC.03}, DC.12

Start here because it's the simplest adapter — two functions, no class dependencies, no state.

#### Step 2.2: FilesystemConfigStorage
**Files:** `core/src/storage/filesystem/filesystem-config-storage.ts`
**Changes:** ADD adapter class extracting I/O from `ConfigManager.loadConfigFromFilesystem()` and `ConfigManager.saveConfig()`
**Verify:** Config loads identically from both paths. Save produces identical JSON output.
**Claims:** {A002.§3.AC.03}, DC.10

#### Step 2.3: FilesystemTemplateStorage
**Files:** `core/src/storage/filesystem/filesystem-template-storage.ts`
**Changes:** ADD adapter class extracting I/O from `NoteTypeTemplateManager.loadTemplates()`
**Verify:** Templates load correctly. `listTemplates()` returns same set as current implementation.
**Claims:** {A002.§3.AC.03}, DC.11

#### Step 2.4: NoteManager cleanup (prerequisite for NoteStorage)
**Files:** `core/src/notes/note-manager.ts`
**Changes:** Route five direct `fs` calls through `NoteFileManager`:
- Replace `fs.pathExists(cached)` in `findNoteFile()` with `NoteFileManager.getFilePath()` check
- Replace `fs.readFile(filepath)` in `getNoteById()` with `NoteFileManager.getFileContents()`
- Replace `fs.unlink(oldPath)` in `changeNoteType()` with NoteFileManager method
- Replace `fs.readFile(event.filePath)` in `handleFileCreated()` (line 1582) with `NoteFileManager.getFileContents()` using filePath-to-noteId translation
- Replace `fs.readFile(event.filePath)` in `handleFileModified()` (line 1724) with `NoteFileManager.getFileContents()` using filePath-to-noteId translation
- Remove `import fs from 'fs-extra'`
**Verify:** All existing NoteManager tests pass. No behavioral change. `import fs from 'fs-extra'` is gone.
**Claims:** {A002.§1.AC.01}, {A002.§3.AC.04}, DC.24, DC.25

#### Step 2.5: FilesystemNoteStorage
**Files:** `core/src/storage/filesystem/filesystem-note-storage.ts`
**Changes:** ADD adapter class wrapping `NoteFileManager` + `UnifiedDiscovery`
**Verify:** All CRUD operations produce identical results to direct NoteFileManager calls. Attachment operations work for folder-based notes.
**Claims:** {A002.§3.AC.02}, DC.09

This is the largest adapter and depends on NoteManager cleanup (step 2.4).

#### Step 2.6: FilesystemIdCounterStorage
**Files:** `core/src/storage/filesystem/filesystem-id-counter-storage.ts`
**Changes:** ADD adapter class that derives counters from `NoteStorage.getAllNotes()`
**Verify:** ID generation produces same sequences as current implementation.
**Claims:** {A002.§3.AC.03}, DC.13

#### Step 2.7: Filesystem barrel file
**Files:** `core/src/storage/filesystem/index.ts`
**Changes:** ADD barrel re-exports for all adapter classes
**Verify:** All adapters importable from `../storage/filesystem`.
**Claims:** DC.14

**Phase 2 acceptance gate:** All adapters instantiable and produce identical results to current code. All existing tests pass. No behavioral changes.

### Phase 3: Thread Through ProjectManager

#### Step 3.1: Create factory function
**Files:** `core/src/storage/filesystem/create-filesystem-project.ts`
**Changes:** ADD `createFilesystemProject()` and `bootstrapFilesystemDirs()` functions
**Verify:** Factory produces a working `ProjectManager`. All CLI commands work when BaseCommand uses the factory.
**Claims:** {A002.§3.AC.04}, DC.15, DC.16

#### Step 3.2: Expand ProjectManagerDependencies
**Files:** `core/src/project/project-manager.ts`
**Changes:** MODIFY `ProjectManagerDependencies` to include storage interface slots. MODIFY constructor to accept and store them. Keep backwards compatibility — if `noteStorage` is not provided, fall back to constructing filesystem adapter internally (deprecated path).
**Verify:** Existing tests pass without modification (they use the old dependency injection).
**Claims:** {A002.§3.AC.04}, DC.17

#### Step 3.3: Extract filesystem operations from ProjectManager.initialize()
**Files:** `core/src/project/project-manager.ts`
**Changes:** REMOVE `createBaseDirectories()`, `createNoteTypeDirectories()`, `createProjectMetadata()`, `ensureGitkeep()` methods. MODIFY `initialize()` to use storage interfaces for config loading.
**Verify:** Initialization operations still work via `bootstrapFilesystemDirs()`. All CLI commands still work.
**Claims:** {A002.§3.AC.04}, DC.16, DC.18

#### Step 3.3.1: Extract type management methods from ProjectManager
**Files:** `core/src/project/project-manager.ts`
**Changes:** Refactor `renameType()` to delegate file operations to `noteStorage.renameNotesOfType()` and config save to `configStorage.save()`. Refactor `deleteType()` to delegate to `noteStorage.archiveNotesOfType()`. Refactor `listNoteTypes()` template check to use `templateStorage.getTemplate()`. Move `getStatistics()`, `getLastModifiedInDirectory()`, `getDirectorySize()` to `noteStorage.getStatistics()`. Move `validateStructure()` and `findProjectRoot()` to filesystem utility module.
**Verify:** `scepter types rename`, `scepter types delete`, `scepter types list` all work. `scepter config` shows correct statistics.
**Claims:** DC.19, DC.27

#### Step 3.3.2: Remove all filesystem imports from ProjectManager
**Files:** `core/src/project/project-manager.ts`
**Changes:** REMOVE `import * as fs from 'fs/promises'` and `import * as fsExtra from 'fs-extra'`. This step is only possible after Steps 3.3 and 3.3.1 have eliminated all direct filesystem calls.
**Verify:** `ProjectManager` has zero `fs` imports (grep verification). TypeScript compiles. All CLI commands still work.
**Claims:** {A002.§1.AC.01}, DC.19

#### Step 3.4.1: Migrate verification store consumers
**Files:** 8 files listed in DC.26
**Changes:** Replace `loadVerificationStore(dataDir)` with `projectManager.verificationStorage.load()` and `saveVerificationStore(dataDir, store)` with `projectManager.verificationStorage.save(store)` in all consumer files.
**Verify:** `scepter claims verify`, `scepter claims trace`, `scepter claims gaps`, `scepter claims stale`, `scepter claims thread`, `scepter ctx show`, `scepter ctx search` all produce identical output.
**Claims:** DC.26

#### Step 3.4: Update BaseCommand to use factory
**Files:** `core/src/cli/commands/base-command.ts`
**Changes:** MODIFY `setup()` to call `createFilesystemProject()` instead of `new ProjectManager()` + `initialize()`
**Verify:** All CLI commands work end-to-end.
**Claims:** {A002.§3.AC.04}

**Phase 3 acceptance gate:** `ProjectManager` contains zero filesystem imports (DC.19). All verification store consumers use the storage interface (DC.26). All type management operations route through `NoteStorage` (DC.27). All CLI commands work. `createFilesystemProject()` is the single entry point for filesystem backend.

### Phase 4: Fix Leaky Handlers

#### Step 4.1: Refactor create-handler template resolution
**Files:** `core/src/cli/commands/context/create-handler.ts`
**Changes:** MODIFY `resolveTemplate()` to use `templateStorage.getTemplate()` from ProjectManager. Remove `fs.pathExists` and `fs.readFile` for template files. Keep `fs` usage for editor temp files (acceptable CLI-layer I/O).
**Verify:** `scepter create` works with and without templates. Editor workflow still works.
**Claims:** {A002.§3.AC.05}, DC.22

#### Step 4.2: Refactor gather-handler folder analysis
**Files:** `core/src/cli/commands/context/gather-handler.ts`
**Changes:** MODIFY `analyzeFolderContents()` to use `NoteStorage.getAttachments()` and `NoteStorage.getAttachmentContent()`. Remove `fs/promises` import (or reduce to source-file stat only).
**Verify:** `scepter ctx gather --include-folder-contents` produces identical output.
**Claims:** {A002.§3.AC.05}, DC.21

#### Step 4.3: Refactor ingest-handler note creation
**Files:** `core/src/cli/commands/context/ingest-handler.ts`
**Changes:** MODIFY note creation to use `noteManager.createNote()` instead of raw `fs.writeFile`. Source file reading and deletion remain as CLI-layer I/O.
**Verify:** `scepter ingest` with `--move` and without produces identical results. Frontmatter merging works correctly.
**Claims:** {A002.§3.AC.05}, DC.20

**Phase 4 acceptance gate:** The three refactored handlers use storage interfaces for all note operations. Source file I/O at the CLI layer is acceptable. Full CLI test suite passes.

---

## Testing Strategy

| Test Level | Scope | Claims Covered |
|-----------|-------|---------------|
| Unit | Each adapter class in isolation: construct, call methods, verify delegation | DC.09-DC.14 |
| Unit | Storage interface contracts: verify all methods are async, return correct types | DC.07 |
| Unit | Type management operations via `NoteStorage`: rename, archive, statistics | DC.27 |
| Integration | `createFilesystemProject()` end-to-end: construct, initialize, perform CRUD | DC.15, DC.16 |
| Integration | Handler refactors: ingest, gather, create commands produce identical output | DC.20-DC.22 |
| Integration | Verification store consumer migration: all 8 files use storage interface | DC.26 |
| Regression | All existing test suites pass without modification | DC.24, DC.25, {A002.§6.AC.01} |
| Verification | `ProjectManager` has zero filesystem imports (static analysis / grep check) | DC.18, DC.19 |
| Verification | `NoteManager` has zero filesystem imports (static analysis / grep check) | DC.24, DC.25 |
| Verification | Unchanged subsystems ({A002.§1.AC.02}) have no new dependencies | {A002.§1.AC.02} |

---

## Observations

1. **`ConfigManager` dual role.** `ConfigManager` currently serves as both config validator/cache AND config I/O. The extraction splits these roles: `FilesystemConfigStorage` handles I/O, `ConfigManager` handles validation and in-memory caching. `ConfigManager.saveConfig()` and `ConfigManager.loadConfigFromFilesystem()` become thin wrappers around the storage adapter (or are deprecated in favor of direct storage calls). **Important:** `ConfigManager` also has mutation methods (`addNoteType()`, `removeNoteType()`, `updateNoteType()`) that internally call `saveConfig()`. After extraction, these mutation methods MUST route their save operations through `configStorage.save()` instead of the internal filesystem write. The calling pattern becomes: mutate in-memory config -> validate -> `configStorage.save(config)`.

2. **`NoteTypeTemplateManager` similar dual role.** The template manager currently handles both template I/O (directory reads) and template cache/serving. The extraction splits I/O to `FilesystemTemplateStorage`; the template manager becomes a cache that loads from the storage interface.

3. **`ProjectManager.findProjectRoot()` is pre-construction.** This static method searches for config files before any ProjectManager exists. It is inherently filesystem-bound and cannot use storage interfaces (there's no instance yet). It SHOULD be extracted to a standalone `findProjectRoot()` function in the filesystem module, not on ProjectManager. This is not blocking for the extraction but affects the final "zero fs imports" goal for ProjectManager.

4. **`ProjectManager` statistics methods.** `getStatistics()`, `getLastModifiedInDirectory()`, `getDirectorySize()` use filesystem calls for computing project statistics. These are filesystem-specific operations that should move to the factory module or a filesystem utilities module.

5. **Verification command handlers.** Eight files currently call `loadVerificationStore(dataDir)` with a computed filesystem path (see DC.26 for the complete list). After extraction, they access `projectManager.verificationStorage`. The `dataDir` parameter pattern is replaced by the storage interface. This is mechanical work (one-line changes per call site) but spans many files and must be sequenced after Step 3.2.

6. **The `NoteFileManager` remains.** The extraction does not remove `NoteFileManager` — it wraps it. `FilesystemNoteStorage` delegates to `NoteFileManager`, which continues to manage the filesystem-specific index (`noteIndex: Map<string, string>`), file watching, and rename detection. In a future cleanup, `NoteFileManager` could be folded into `FilesystemNoteStorage`, but this is not required for the extraction.

7. **Open question resolution for Phase 1-4.** {A002.§5.OQ.01} (query pushdown) — resolved: `getNotes(query: NoteQuery)` is included on the `NoteStorage` interface (DC.02). The filesystem adapter implements it as `getAllNotes()` + in-memory filter. {A002.§5.OQ.04} (lazy loading) — deferred; filesystem adapter returns full content. {A002.§5.OQ.02} (folder notes) — the `Attachment` abstraction handles this. {A002.§5.OQ.03} (reference graph) — deferred; rebuild-at-startup preserved.

---

## Claims Out of Scope

The following A002 claims are not addressed by this DD because they concern Phase 5 (alternative backends) or are informational:

- {A002.§3.AC.06} — Alternative backends are separate work items. This DD covers Phases 1-4 only.
- {A002.§4.AC.02} — SourceCodeScanner remains filesystem-coupled by design. No changes needed.
- {A002.§5.OQ.01} through {A002.§5.OQ.04} — Open questions resolved or deferred as noted in Observations.
- {A002.§6.AC.01} — Low risk assessment, informational. Acknowledged by the adapter-pattern approach throughout this DD.
- {A002.§6.AC.02} — Watch semantics across backends. Relevant only when building non-filesystem backends (Phase 5). The filesystem adapter's watch implementation (DC.09) uses existing `NoteFileManager` event translation.
- {A002.§6.AC.03} — NoteQuery translation risk. Relevant only for non-filesystem backends. The filesystem adapter implements query as in-memory filtering per {A002.§5.OQ.01} resolution.
- {A002.§6.AC.04} — Initialization performance. Addressed by the async interface signatures (DC.07) which accommodate backends with varying latency.
- {A002.§1.AC.02} — Unchanged subsystems. This is a constraint verified by testing, not a design artifact.
- {A002.§1.AC.03} — Existing pattern reference. Acknowledged by DC.06 (formalize IdGeneratorStorage as IdCounterStorage).
- {A002.§4.AC.01} — Post-extraction architecture invariant. Verified by DC.19, DC.25 (zero fs imports in ProjectManager and NoteManager) and the testing strategy.

**Files intentionally excluded from extraction:**

- `init.ts` — Project initialization is inherently filesystem-bound (creates directory structure). For non-filesystem backends, initialization is a fundamentally different operation (per {A002.§8}).
- `scaffold.ts` — Directory scaffolding from config. Same reasoning as `init.ts`. Bypasses both `BaseCommand` and `ProjectManager`, constructing `ConfigManager` directly.
- `config.ts` (CLI command) — Constructs `ProjectManager` directly at line 27, bypassing `BaseCommand`. SHOULD be updated to use `createFilesystemProject()` in a follow-up, but is not blocking for the extraction since it only reads config (no mutations).
- `migration/folder-migration.ts` — One-time migration utility using `NoteManager`, `NoteFileManager`, and `fs-extra` directly. Migration tooling is out of scope per {A002.§8}.
