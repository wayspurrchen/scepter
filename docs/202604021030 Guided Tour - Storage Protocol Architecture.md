# Guided Tour: Storage Protocol Architecture

This tour walks through the target architecture for SCEpter's backend-agnostic storage protocol. It covers what the new system looks like, how the pieces connect, and where the boundary sits between domain logic and storage.

**Source documents:** {A002}, {DD010}

---

## The Domain Types (What Doesn't Change)

The core domain types are already backend-agnostic. These are the data that flows through the system regardless of storage:

```typescript
// core/src/types/note.ts
interface Note {
  id: string;          // 'R001', 'ARCH042'
  type: string;        // 'Requirement', 'Architecture'
  title: string;
  content: string;
  tags: string[];
  created: Date;
  modified?: Date;
  contextHints?: ContextHints;
  references?: { outgoing: Reference[]; incoming: Reference[] };
  metadata?: NoteMetadata;
}

// core/src/types/note.ts
interface NoteQuery {
  ids?: string[];
  types?: string[];
  tags?: string[];
  searchPatterns?: string[];
  createdAfter?: Date;
  // ... 15+ filter fields
}
```

`Note` is the universal currency. Every subsystem consumes and produces `Note` objects. `NoteQuery` is the universal query language — stateless, idempotent, no storage assumptions.

`Reference`, `ClaimAddress`, `ContextHints`, `GatheredNote` — all pure domain types. None import filesystem modules.

---

## The Storage Interfaces (The New Boundary)

Five interfaces define the contract between domain logic and any backend:

```
┌─────────────────────────────────────────────────────┐
│                 Storage Protocol                     │
│                                                     │
│  NoteStorage          ConfigStorage                 │
│  ├─ getNote(id)       ├─ load()                     │
│  ├─ getNotes(query)   └─ save(config)               │
│  ├─ createNote(note)                                │
│  ├─ updateNote(note)  TemplateStorage               │
│  ├─ deleteNote(id)    ├─ getTemplate(type)          │
│  ├─ restoreNote(id)   └─ listTemplates()            │
│  ├─ getAllNotes()                                    │
│  ├─ getAllReferences() VerificationStorage           │
│  ├─ renameNotesOfType()├─ load()                    │
│  ├─ archiveNotesOfType()└─ save(store)              │
│  ├─ getStatistics()                                 │
│  ├─ getAttachments()  IdCounterStorage              │
│  ├─ getAttachmentContent()├─ load()                 │
│  ├─ putAttachment()   └─ save(counters)             │
│  └─ watch?()                                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

`NoteStorage` is the big one — note CRUD, bulk loading, type management, attachments, and optional change notification. The others are narrow: two methods each.

The pattern already exists in the codebase. `NoteIdGenerator` at `core/src/notes/note-id-generator.ts:9-12`:

```typescript
export interface IdGeneratorStorage {
  load(): Promise<Record<string, number>>;
  save(counters: Record<string, number>): Promise<void>;
}
```

Every storage interface follows this shape: async load/save, opaque to the consumer, backend decides how persistence works. `IdCounterStorage` is literally a rename of this for naming consistency.

Supporting types:

```typescript
// core/src/storage/storage-types.ts (NEW)
type StorageEvent = {
  type: 'created' | 'modified' | 'deleted' | 'moved';
  noteId: string;
  path?: string;           // optional — only filesystem provides this
};

type Attachment = { name: string; size: number; mimeType?: string };
type DeleteMode = 'archive' | 'soft-delete' | 'permanent';
type StorageStatistics = {
  noteCount: number;
  typeBreakdown: Record<string, number>;
  lastModified?: Date;
  totalSize?: number;
};
type Unsubscribe = () => void;
```

All methods on all interfaces return `Promise`. Even the filesystem adapter, where reads could be sync. This is non-negotiable — REST and database backends are inherently async, and the interface must accommodate them without adapter gymnastics (DD010 DC.07).

---

## The Filesystem Adapter Layer (Wrapping What Exists)

The existing filesystem code doesn't get rewritten. It gets wrapped:

```
┌──────────────────────────────────────────────────────────────┐
│                    Filesystem Adapters                        │
│                                                              │
│  FilesystemNoteStorage                                       │
│  ├── wraps NoteFileManager (CRUD, index, watching)           │
│  ├── wraps UnifiedDiscovery (note finding, parsing)          │
│  ├── uses NoteTypeResolver (ID prefix → type)                │
│  └── uses gray-matter (frontmatter parsing)                  │
│                                                              │
│  FilesystemConfigStorage                                     │
│  └── wraps ConfigManager.loadConfigFromFilesystem/saveConfig │
│                                                              │
│  FilesystemTemplateStorage                                   │
│  └── wraps NoteTypeTemplateManager file I/O                  │
│                                                              │
│  FilesystemVerificationStorage                               │
│  └── wraps loadVerificationStore/saveVerificationStore        │
│                                                              │
│  FilesystemIdCounterStorage                                  │
│  └── derives counters from NoteStorage.getAllNotes()          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The key detail in `FilesystemNoteStorage`: `getAllNotes()` delegates to `UnifiedDiscovery.discoverAll()`, not `NoteFileManager.buildIndex()`. `NoteFileManager.buildIndex()` only builds a `noteId → filePath` map. `UnifiedDiscovery` does the actual work — glob scanning, frontmatter extraction via `gray-matter`, type resolution. `getNote(id)` similarly needs the full parsing pipeline: find file → read content → parse frontmatter → resolve type.

`FilesystemVerificationStorage` is the thinnest adapter. The current code:

```typescript
// core/src/claims/verification-store.ts (current)
export async function loadVerificationStore(dataDir: string): Promise<VerificationStore> {
  const filePath = path.join(dataDir, 'verification.json');
  // ... read JSON, normalize legacy format
}
export async function saveVerificationStore(dataDir: string, store: VerificationStore): Promise<void> {
  // ... write JSON
}
```

The adapter captures `dataDir` at construction time:

```typescript
class FilesystemVerificationStorage implements VerificationStorage {
  constructor(private dataDir: string) {}
  load()  { return loadVerificationStore(this.dataDir); }
  save(s) { return saveVerificationStore(this.dataDir, s); }
}
```

That's it. Two lines of delegation.

---

## The Composition Root (How It Gets Wired)

Currently, `BaseCommand.setup()` constructs `ProjectManager` directly:

```typescript
// core/src/cli/commands/base-command.ts (current, line 27)
const projectManager = new ProjectManager(projectPath);
await projectManager.configManager.loadConfigFromFilesystem();
await projectManager.initialize();
```

And `ProjectManager` constructs everything internally, importing `fs`, `fs-extra`, `glob`, and `chokidar` at the top of the file.

After the extraction, a factory function handles the filesystem-specific wiring:

```typescript
// core/src/storage/filesystem/create-filesystem-project.ts (NEW)
async function createFilesystemProject(projectPath: string): Promise<ProjectManager> {
  // 1. Bootstrap: create directories, check permissions
  await bootstrapFilesystemDirs(projectPath);

  // 2. Load config
  const configStorage = new FilesystemConfigStorage(projectPath);
  const config = await configStorage.load();
  const configManager = new ConfigManager();
  configManager.validateAndLoad(config);

  // 3. Build filesystem adapters
  const noteFileManager = new NoteFileManager(projectPath, configManager);
  const discovery = new UnifiedDiscovery(projectPath, configManager);
  const noteTypeResolver = new NoteTypeResolver(config);
  const noteStorage = new FilesystemNoteStorage(
    noteFileManager, discovery, configManager, noteTypeResolver
  );
  const templateStorage = new FilesystemTemplateStorage(projectPath, configManager);
  const verificationStorage = new FilesystemVerificationStorage(dataDir);
  const idCounterStorage = new FilesystemIdCounterStorage(noteStorage);

  // 4. Construct ProjectManager — no fs imports in ProjectManager itself
  return new ProjectManager(projectPath, {
    configManager, noteStorage, configStorage,
    templateStorage, verificationStorage, idCounterStorage,
  });
}
```

`BaseCommand.setup()` becomes:

```typescript
const projectManager = await createFilesystemProject(projectPath);
await projectManager.initialize();
```

**This is the single line where the backend choice is made.** A SQLite backend calls `createSqliteProject()`. A REST client calls `createRestProject()`. Everything above `ProjectManager` is identical.

Here's the full dependency diagram after extraction:

```
                         ┌──────────────┐
                         │  CLI Parser   │
                         │ (Commander)   │
                         └──────┬───────┘
                                │
                    ┌───────────▼───────────┐
                    │   BaseCommand.setup() │
                    │                       │
                    │ calls ONE of:         │
                    │ • createFilesystemProject()
                    │ • createSqliteProject()   (future)
                    │ • createRestProject()     (future)
                    └───────────┬───────────┘
                                │
              ┌─────────────────▼─────────────────┐
              │        ProjectManager              │
              │   (composition root — NO fs imports)│
              │                                     │
              │  ┌─────────────┐ ┌───────────────┐ │
              │  │ NoteManager │ │ ReferenceManager│ │
              │  │ (NO fs)     │ │ (pure graph)  │ │
              │  └──────┬──────┘ └───────────────┘ │
              │         │                           │
              │  ┌──────┴──────┐ ┌───────────────┐ │
              │  │ ClaimIndex  │ │ContextGatherer│ │
              │  │ (pure parse)│ │ (pure traversal)│ │
              │  └─────────────┘ └───────────────┘ │
              │                                     │
              │  ┌───────────────────────────────┐ │
              │  │ SourceCodeScanner             │ │
              │  │ (intentionally fs-coupled)    │ │
              │  └───────────────────────────────┘ │
              └─────────────────┬─────────────────┘
                                │
           ═════════════════════╪══════════════════
            Storage Protocol    │  (interface boundary)
           ═════════════════════╪══════════════════
                                │
              ┌─────────────────▼─────────────────┐
              │       Storage Implementations      │
              │                                     │
              │  Filesystem:                        │
              │  ┌────────────────────────────────┐ │
              │  │ FilesystemNoteStorage          │ │
              │  │  └─ NoteFileManager            │ │
              │  │  └─ UnifiedDiscovery           │ │
              │  │  └─ NoteTypeResolver           │ │
              │  ├────────────────────────────────┤ │
              │  │ FilesystemConfigStorage        │ │
              │  ├────────────────────────────────┤ │
              │  │ FilesystemTemplateStorage      │ │
              │  ├────────────────────────────────┤ │
              │  │ FilesystemVerificationStorage  │ │
              │  ├────────────────────────────────┤ │
              │  │ FilesystemIdCounterStorage     │ │
              │  └────────────────────────────────┘ │
              │                                     │
              │  SQLite (future):                   │
              │  ┌────────────────────────────────┐ │
              │  │ SqliteNoteStorage              │ │
              │  │ SqliteConfigStorage            │ │
              │  │ ...                            │ │
              │  └────────────────────────────────┘ │
              │                                     │
              └─────────────────────────────────────┘
```

---

## Command Flow: Before and After

### Creating a note

**Before** (filesystem assumptions everywhere):

```
scepter ctx create Requirement "Auth system"
  → BaseCommand.setup()
    → new ProjectManager(path)          ← constructs NoteFileManager internally
    → configManager.loadConfigFromFilesystem()  ← fs read
    → projectManager.initialize()       ← fs.mkdir, fs.readdir, glob
  → create-handler.ts
    → fs.readFile(templatePath)         ← handler reads template directly
    → noteManager.createNote()
      → noteFileManager.createNoteFile()  ← fs.writeFile
```

**After** (storage protocol):

```
scepter ctx create Requirement "Auth system"
  → BaseCommand.setup()
    → createFilesystemProject(path)     ← all fs wiring here
    → projectManager.initialize()       ← NO fs calls
  → create-handler.ts
    → templateStorage.getTemplate(type) ← goes through interface
    → noteManager.createNote()
      → noteStorage.createNote(note)    ← goes through interface
        → noteFileManager.createNoteFile()  ← fs calls behind adapter
```

### Verifying a claim

**Before** (every handler computes `dataDir`):

```
scepter claims verify R004.§1.AC.01
  → verify-command.ts
    → dataDir = path.join(projectPath, config.paths?.dataDir || '_scepter')
    → loadVerificationStore(dataDir)    ← fs.readFile(verification.json)
    → addVerificationEvent(store, ev)   ← pure in-memory
    → saveVerificationStore(dataDir, store)  ← fs.writeFile(verification.json)
```

**After** (single storage interface):

```
scepter claims verify R004.§1.AC.01
  → verify-command.ts
    → projectManager.verificationStorage.load()   ← goes through interface
    → addVerificationEvent(store, ev)              ← pure in-memory (unchanged)
    → projectManager.verificationStorage.save(store)  ← goes through interface
```

Eight files currently compute `dataDir` and call `loadVerificationStore()` directly. All eight get the same one-line change.

### Gathering context

No change. `ContextGatherer` already operates on pure abstractions:

```
scepter ctx gather R001 --depth 2
  → contextGatherer.gatherContext(hints, options)
    → noteManager.getNotes()              ← in-memory query
    → referenceManager.followReferences() ← in-memory graph traversal
    → deduplicate, sort                   ← pure computation
```

`ContextGatherer` imports `NoteManager` and `ReferenceManager`, neither of which import filesystem modules after the extraction. This subsystem is untouched.

---

## The Backend-Invariant Layer

Everything above the storage boundary is identical across backends. This is ~70-80% of the codebase:

```
┌─────────────────────────────────────────────────────────┐
│              Backend-Invariant Layer                      │
│                                                         │
│  Domain types     Note, NoteQuery, Reference,           │
│                   ClaimAddress, ContextHints             │
│                                                         │
│  Graph engine     ReferenceManager                      │
│                   (bidirectional graph, traversal)       │
│                                                         │
│  Claims engine    ClaimIndex, ClaimTree, Traceability,  │
│                   ClaimSearch, ClaimThread, Staleness    │
│                                                         │
│  Context engine   ContextGatherer                       │
│                   (reference traversal, deduplication)   │
│                                                         │
│  Validation       StatusValidator, NoteTypeResolver,    │
│                   ConfigValidator (Zod schemas)          │
│                                                         │
│  Parsers          ClaimParser, NoteParser,              │
│                   parseNoteMentions                      │
│                                                         │
│  Formatters       claim-formatter, note-formatter,      │
│                   gather-formatter, tree-formatter       │
│                                                         │
│  CLI commands     All command handlers (after refactor)  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

None of these import `fs`, `fs-extra`, `glob`, or `chokidar`. They receive `Note[]`, `Reference[]`, and `NoteQuery` objects. They produce formatted output. They don't know or care where the data came from.

---

## The SourceCodeScanner Exception

`SourceCodeScanner` remains filesystem-coupled by design. It reads actual source files in the working tree — `.ts`, `.py`, `.rs` files — looking for `@implements {R001}` annotations. This is inherently local:

```
SourceCodeScanner
  → glob('**/*.{ts,js,py,...}')     ← scans working tree
  → fs.readFile(each file)          ← reads source code
  → parseNoteMentions(content)      ← extracts {R001} references
  → SourceReferenceIndex            ← feeds into ReferenceManager
```

For non-filesystem backends, the scanner still runs against the local working tree and feeds `SourceReference[]` into whichever backend manages notes. The source code is always local even if notes are remote.

Several CLI handlers have the same intentional coupling — `search-handler.ts` searching source files, `confidence/mark-command.ts` annotating source files, `claim-formatter.ts` displaying source context. These read source code, not notes. They sit outside the storage protocol boundary.

---

## Module Layout After Extraction

```
core/src/
  storage/                              ← NEW module
    storage-types.ts                    ← StorageEvent, Attachment, DeleteMode, etc.
    storage-backend.ts                  ← NoteStorage, ConfigStorage, etc. interfaces
    index.ts                            ← barrel re-exports
    filesystem/                         ← filesystem adapter implementations
      filesystem-note-storage.ts
      filesystem-config-storage.ts
      filesystem-template-storage.ts
      filesystem-verification-storage.ts
      filesystem-id-counter-storage.ts
      create-filesystem-project.ts      ← factory function + bootstrapFilesystemDirs
      index.ts                          ← barrel re-exports

  project/
    project-manager.ts                  ← MODIFIED: accepts storage interfaces,
                                           zero fs imports

  notes/
    note-manager.ts                     ← MODIFIED: zero fs imports,
                                           delegates all I/O to NoteStorage
    note-file-manager.ts               ← UNCHANGED: still exists, wrapped by adapter
    note-id-generator.ts               ← UNCHANGED: IdGeneratorStorage already exists

  discovery/
    unified-discovery.ts               ← UNCHANGED: wrapped by FilesystemNoteStorage

  cli/commands/
    base-command.ts                    ← MODIFIED: calls createFilesystemProject()
    context/
      create-handler.ts               ← MODIFIED: uses TemplateStorage
      gather-handler.ts               ← MODIFIED: uses NoteStorage.getAttachments()
      ingest-handler.ts               ← MODIFIED: uses noteManager.createNote()
    claims/
      verify-command.ts               ← MODIFIED: uses verificationStorage
      trace-command.ts                ← MODIFIED: uses verificationStorage
      gaps-command.ts                 ← MODIFIED: uses verificationStorage
      stale-command.ts                ← MODIFIED: uses verificationStorage
      thread-command.ts               ← MODIFIED: uses verificationStorage
      ensure-index.ts                 ← MODIFIED: uses verificationStorage

  references/
    reference-manager.ts               ← UNCHANGED
  claims/
    claim-index.ts                     ← UNCHANGED
  context/
    context-gatherer.ts                ← UNCHANGED
  statuses/
    status-validator.ts                ← UNCHANGED
  parsers/                             ← UNCHANGED
  formatters/                          ← UNCHANGED
```

---

## What a SQLite Backend Would Look Like

Not in scope for the extraction, but useful for understanding why the protocol is shaped the way it is.

```typescript
class SqliteNoteStorage implements NoteStorage {
  constructor(private db: Database) {}

  async getNote(id: string): Promise<Note | null> {
    return this.db.get('SELECT * FROM notes WHERE id = ?', id);
  }

  async getNotes(query: NoteQuery): Promise<NoteQueryResult> {
    // Translate NoteQuery filters to SQL WHERE clauses
    // Use FTS5 for searchPatterns
    const sql = buildQuery(query);
    return this.db.all(sql);
  }

  async getAllNotes(): Promise<Note[]> {
    return this.db.all('SELECT * FROM notes');
  }

  async getAllReferences(): Promise<Reference[]> {
    return this.db.all('SELECT * FROM references');
    // References stored as a table, not parsed from content
  }

  async getStatistics(): Promise<StorageStatistics> {
    return this.db.get('SELECT COUNT(*) as noteCount, ... FROM notes');
  }

  // watch() uses sqlite3_update_hook or polling
}
```

The filesystem adapter loads everything into memory and filters in JS. The SQLite adapter pushes queries to SQL. The REST adapter pushes queries to the server. Same interface, different performance characteristics. The domain layer doesn't care.

---

## Summary of What Changes vs What Doesn't

| Changes | Doesn't Change |
|---------|---------------|
| `ProjectManager` constructor (accepts storage interfaces) | `ReferenceManager` (pure graph) |
| `BaseCommand.setup()` (calls factory) | `ClaimIndex` (pure parsing) |
| `NoteManager` (no more `fs` imports) | `ContextGatherer` (pure traversal) |
| 3 leaky handlers (create, gather, ingest) | `StatusValidator` (pure validation) |
| 8 verification store consumers (one-line each) | All parsers |
| New `core/src/storage/` module | All formatters |
| | `SourceCodeScanner` (intentionally fs) |
| | Domain types (`Note`, `NoteQuery`, etc.) |

The storage protocol is a formalization of a boundary that already exists in the code. The ~70-80% that's backend-agnostic was never designed to be — it just fell out naturally from the two-phase architecture (load into memory, then query in memory). The extraction makes this implicit boundary explicit and enforceable.
