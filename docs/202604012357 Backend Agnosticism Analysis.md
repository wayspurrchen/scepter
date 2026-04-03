# Backend Agnosticism Analysis

**Date:** 2026-04-01
**Question:** How difficult would it be to make SCEpter's backend agnostic — so CLI commands work against filesystem, SQLite, or a REST API — and what protocol or intermediary representation would enable this?

---

## Executive Summary

SCEpter is **surprisingly well-positioned** for backend agnosticism. Roughly 70-80% of the codebase is already pure domain logic operating on in-memory data structures with zero filesystem coupling. Filesystem I/O is concentrated in a small number of "storage boundary" classes. The extraction requires focused refactoring of ~5 files, not an architectural rewrite.

**Difficulty rating: Medium.** The hard part isn't the volume of code — it's designing the storage protocol correctly so it doesn't leak assumptions from any single backend.

---

## Current Coupling Map

### Already Backend-Agnostic (Zero Filesystem I/O)

| Subsystem | File | What It Does |
|-----------|------|-------------|
| `ReferenceManager` | `references/reference-manager.ts` | Bidirectional graph traversal |
| `ClaimIndex` | `claims/claim-index.ts` | Builds from `Note[]`, pure parsing |
| `ContextGatherer` | `context/context-gatherer.ts` | Follows references via abstractions |
| `StatusValidator` | `statuses/status-validator.ts` | Pure validation logic |
| `NoteTypeResolver` | `notes/note-type-resolver.ts` | Shortcode-to-type mapping |
| `NoteIdGenerator` | `notes/note-id-generator.ts` | **Already has `IdGeneratorStorage` interface** |
| Traceability, Staleness, Search, Thread | `claims/*.ts` | Pure computation on indexed data |
| All claim command handlers | `cli/commands/claims/*.ts` | Use only `ProjectManager` APIs |

These represent the **core intellectual value** of SCEpter — the graph, claims, traceability, and context algorithms. They'd work unchanged with any backend.

### Filesystem-Coupled (Requires Abstraction)

| Subsystem | File | Coupling Type | Severity |
|-----------|------|--------------|----------|
| `NoteFileManager` | `notes/note-file-manager.ts` | `fs-extra`, `chokidar`, `glob`, `gray-matter` | **HIGH** — primary storage layer |
| `UnifiedDiscovery` | `discovery/unified-discovery.ts` | `glob`, `fs`, `chokidar`, folder detection | **HIGH** — note finding |
| `SourceCodeScanner` | `scanners/source-code-scanner.ts` | `glob`, `fs`, `chokidar`, mtime caching | **HIGH** — but intentionally filesystem-bound |
| `ConfigManager` | `config/config-manager.ts` | JSON file read | **LOW** — single load point |
| `VerificationStore` | `claims/verification-store.ts` | JSON file read/write | **LOW** — already well-abstracted |
| `NoteTypeTemplateManager` | `templates/note-type-template-manager.ts` | `.md` file reads, directory watching | **LOW** — small surface |

### CLI Handlers: Leakage Audit

| Handler | Clean? | Issues |
|---------|--------|--------|
| All claims commands (trace, gaps, verify, stale, lint, thread) | 100% | None — model pattern |
| `show-handler.ts` | ~95% | Minor path formatting for display |
| `search-handler.ts` | ~90% | Source code search is intentionally filesystem |
| `create-handler.ts` | ~80% | Template file reading bypasses template manager |
| `gather-handler.ts` | ~60% | Directly reads folder note attachments via `fs` |
| `ingest-handler.ts` | ~20% | Reimplements note creation with raw `fs` calls |

---

## Proposed Protocol: `StorageBackend`

The intermediary representation is a set of interfaces that any backend (filesystem, SQLite, REST) must implement. The key insight is that SCEpter already operates in two phases: **load everything into memory at startup**, then **query/mutate in-memory structures**. The protocol formalizes that boundary.

### Core Interfaces

```typescript
/**
 * Primary storage protocol. Every backend implements this.
 * Operations are coarse-grained (note-level), not fine-grained (file-level).
 */
interface NoteStorage {
  // CRUD
  getNote(id: string): Promise<Note | null>;
  getNotes(query: NoteQuery): Promise<NoteQueryResult>;
  createNote(note: Note): Promise<void>;
  updateNote(note: Note): Promise<void>;
  deleteNote(id: string, mode: 'archive' | 'soft-delete' | 'permanent'): Promise<void>;
  restoreNote(id: string): Promise<void>;

  // Bulk operations (for initialization)
  getAllNotes(): Promise<Note[]>;
  getAllReferences(): Promise<Reference[]>;

  // Attachments (folder-based notes)
  getAttachments(noteId: string): Promise<Attachment[]>;
  getAttachmentContent(noteId: string, name: string): Promise<Buffer>;
  putAttachment(noteId: string, name: string, content: Buffer): Promise<void>;

  // Change notification (optional — filesystem uses chokidar, DB uses polling/triggers)
  watch?(callback: (event: StorageEvent) => void): Unsubscribe;
}

interface ConfigStorage {
  load(): Promise<SCEpterConfig | null>;
  save(config: SCEpterConfig): Promise<void>;
}

interface TemplateStorage {
  getTemplate(noteType: string): Promise<string | null>;
  listTemplates(): Promise<string[]>;
}

interface VerificationStorage {
  load(): Promise<VerificationStore>;
  save(store: VerificationStore): Promise<void>;
}

interface IdCounterStorage {
  load(): Promise<Record<string, number>>;
  save(counters: Record<string, number>): Promise<void>;
}

// Already exists as IdGeneratorStorage — rename for consistency
```

### What Each Backend Provides

| Capability | Filesystem | SQLite | REST API |
|-----------|-----------|--------|----------|
| `NoteStorage` | `NoteFileManager` + `UnifiedDiscovery` (current code, wrapped) | `notes` table with FTS5 | HTTP client to remote |
| `ConfigStorage` | JSON file read | `config` table or JSON file | GET/PUT `/config` |
| `TemplateStorage` | `.md` files in directory | `templates` table | GET `/templates/:type` |
| `VerificationStorage` | `verification.json` | `verifications` table | GET/POST `/verifications` |
| `IdCounterStorage` | Derive from max ID scan | `SELECT MAX(seq)` | Server-managed |
| `watch()` | `chokidar` | `sqlite3_update_hook` or polling | WebSocket / SSE |

### Source Code Scanner: Special Case

`SourceCodeScanner` is **intentionally filesystem-coupled** — it reads actual source files in the working tree. For a SQLite or REST backend, there are two options:

1. **Keep it filesystem-local.** The scanner always runs against the local working tree, feeding `SourceReference[]` into whichever backend manages notes. This is the pragmatic choice.
2. **Make it a separate integration.** The scanner becomes a "source integration provider" that pushes references into the storage backend. IDE plugins, CI pipelines, or LSP servers could be alternative providers.

Option 1 is simpler and preserves the current architecture. Option 2 is the right long-term design but isn't required for initial extraction.

---

## Extraction Strategy

### Phase 1: Define Interfaces (~1 day)

Create `core/src/storage/` with:
- `storage-backend.ts` — the interfaces above
- `storage-types.ts` — `StorageEvent`, `Attachment`, `Unsubscribe`

No behavioral changes. Just types.

### Phase 2: Wrap Existing Code (~2-3 days)

Create `FilesystemNoteStorage` that wraps the existing `NoteFileManager` + `UnifiedDiscovery` behind `NoteStorage`. This is **adapter pattern**, not rewrite:

```typescript
class FilesystemNoteStorage implements NoteStorage {
  constructor(
    private fileManager: NoteFileManager,
    private discovery: UnifiedDiscovery,
    private configManager: ConfigManager,
  ) {}

  async getNote(id: string): Promise<Note | null> {
    // Delegate to existing fileManager.findNoteFile() + parse
  }

  async createNote(note: Note): Promise<void> {
    // Delegate to existing fileManager.createNoteFile()
  }
  // ...
}
```

Similarly wrap `ConfigManager`, `VerificationStore`, `NoteTypeTemplateManager`.

### Phase 3: Thread Through ProjectManager (~1-2 days)

`ProjectManager` becomes the composition root that accepts a `StorageBackend` (or its constituent interfaces) and wires them into the subsystems:

```typescript
class ProjectManager {
  constructor(
    private storage: NoteStorage,
    private configStorage: ConfigStorage,
    // ... other storage interfaces
  ) {}

  async initialize() {
    const config = await this.configStorage.load();
    const notes = await this.storage.getAllNotes();
    // Build in-memory indexes from loaded data
    this.referenceManager.buildFrom(notes);
    // ...
  }
}
```

### Phase 4: Fix Leaky Handlers (~1 day)

- `ingest-handler.ts`: Rewrite to use `noteManager.createNote()` instead of raw `fs.writeFile()`
- `gather-handler.ts`: Use `NoteStorage.getAttachments()` instead of direct `fs.readFile()`
- `create-handler.ts`: Use `TemplateStorage.getTemplate()` instead of `fs.readFile()`

### Phase 5: Build Alternative Backends (per backend)

- **SQLite:** ~3-5 days. Schema design, FTS5 for text search, migration tooling.
- **REST client:** ~2-3 days. HTTP client implementing `NoteStorage`, auth, error handling.
- **REST server:** ~3-5 days. Express/Hono server wrapping `NoteStorage` with HTTP endpoints.

---

## Architecture After Extraction

```
CLI Commands
    |
    v
ProjectManager (composition root)
    |
    +-- NoteManager (in-memory index, queries, CRUD orchestration)
    +-- ReferenceManager (in-memory graph — unchanged)
    +-- ClaimIndex (in-memory — unchanged)
    +-- ContextGatherer (traversal — unchanged)
    +-- StatusValidator (validation — unchanged)
    |
    v
StorageBackend (interface boundary)
    |
    +-- FilesystemNoteStorage  (current behavior, wrapped)
    +-- SqliteNoteStorage      (new)
    +-- RestNoteStorage        (new)
```

The key property: **everything above the `StorageBackend` line is identical regardless of backend.** Commands, formatters, algorithms, parsers — all unchanged.

---

## Risk Assessment

### Low Risk
- **Interface extraction** — the coupling boundaries are already clear
- **Filesystem adapter** — wrapping existing code, not rewriting it
- **Claims subsystem** — already 100% backend-agnostic

### Medium Risk
- **Initialization performance** — filesystem loads everything lazily via glob; SQLite would need a different loading strategy (perhaps lazy queries instead of bulk load)
- **Watch semantics** — `chokidar` provides granular file events; SQLite/REST backends would need different change-detection mechanisms
- **NoteQuery translation** — the in-memory `NoteQuery` filtering is done in JS; SQLite would want SQL-native queries for performance

### Requires Design Decisions
- **Should `NoteStorage.getAllNotes()` return content?** For filesystem, it's cheap (already in memory). For REST, you'd want to support lazy content loading.
- **How do folder-based notes map to non-filesystem backends?** The `isFolder` / `additionalFiles` concept is filesystem-native. SQLite/REST might represent this as a note with attachments.
- **Should the reference graph be persisted or rebuilt?** Currently rebuilt every startup from note content. SQLite could persist it as a separate table for faster startup.

---

## Existing Precedent in Codebase

`NoteIdGenerator` already implements the pattern at `core/src/notes/note-id-generator.ts:9-12`:

```typescript
export interface IdGeneratorStorage {
  load(): Promise<Record<string, number>>;
  save(counters: Record<string, number>): Promise<void>;
}
```

This is exactly the right approach — a narrow storage interface that the generator uses without knowing the backend. Every other storage-touching subsystem should follow this pattern.

---

## Bottom Line

| Dimension | Assessment |
|-----------|-----------|
| **Feasibility** | High — architecture already supports it |
| **Effort for interface extraction** | ~5 days focused work |
| **Effort per additional backend** | ~3-5 days each |
| **Risk of breaking existing behavior** | Low — adapter pattern preserves current code |
| **Biggest single refactor** | `NoteFileManager` → `FilesystemNoteStorage` adapter |
| **Already done for free** | ReferenceManager, ClaimIndex, ContextGatherer, all claims commands |

The system was designed (perhaps accidentally) with most of the hard parts already backend-agnostic. The remaining work is wrapping the filesystem layer behind interfaces and fixing a handful of leaky handlers.
