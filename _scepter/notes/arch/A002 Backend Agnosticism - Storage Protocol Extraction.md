---
created: 2026-04-02T05:09:03.009Z
tags: [architecture, storage, backend, abstraction]
status: draft
---

# A002 - Backend Agnosticism - Storage Protocol Extraction

**Date:** 2026-04-02
**Status:** Draft
**Scope:** Extract a StorageBackend protocol from SCEpter's filesystem-coupled subsystems so that CLI commands, domain logic, and the claims system work identically against filesystem, SQLite, REST, or any future backend.

---

## §1 Current State and Core Insight

SCEpter's domain logic is already 70-80% backend-agnostic. The reference graph, claim index, context gatherer, status validator, traceability engine, and all claim command handlers operate on in-memory data structures with zero filesystem coupling. Filesystem I/O is concentrated in approximately five files at well-defined storage boundaries.

This is not an accident of implementation -- it reflects the system's two-phase architecture: **load everything into memory at startup**, then **query and mutate in-memory structures**. The protocol extraction formalizes this boundary rather than inventing a new one.

### §1.AC.01:5 Filesystem coupling MUST be confined to storage adapter implementations.

All filesystem I/O (reads, writes, directory scanning, file watching) MUST pass through a storage interface. No domain logic, command handler, or formatter may import `fs`, `fs-extra`, `glob`, or `chokidar` directly. The storage interfaces are the only boundary where backend-specific code is permitted.

### §1.AC.02 The following subsystems MUST remain unchanged by the extraction.

These subsystems are already backend-agnostic and MUST NOT acquire storage dependencies:

| Subsystem | File |
|-----------|------|
| `ReferenceManager` | `references/reference-manager.ts` |
| `ClaimIndex` | `claims/claim-index.ts` |
| `ClaimMetadata` | `claims/claim-metadata.ts` |
| `ClaimSearch` | `claims/claim-search.ts` |
| `ClaimThread` | `claims/claim-thread.ts` |
| `Traceability` | `claims/traceability.ts` |
| `ContextGatherer` | `context/context-gatherer.ts` |
| `StatusValidator` | `statuses/status-validator.ts` |
| `NoteTypeResolver` | `notes/note-type-resolver.ts` |

Note: `claims/verification-store.ts` is filesystem-coupled (JSON file I/O) and is addressed by {A002.§2.AC.04}. `claims/staleness.ts` uses `fs.stat()` on source files and has the same intentional filesystem coupling as `SourceCodeScanner` ({A002.§4.AC.02}) — it inspects source file metadata, not notes. `claims/confidence.ts` uses `fs-extra` and `glob` for scanning source files and belongs in the same category.

### §1.AC.03 The existing `IdGeneratorStorage` interface in `note-id-generator.ts` is the reference pattern.

The extraction MUST follow the same narrow-interface approach already demonstrated by `NoteIdGenerator`: a storage interface with `load()` and `save()` methods that the subsystem uses without knowledge of the backend. Each storage-touching subsystem SHOULD define or consume an analogous interface.

---

## §2 StorageBackend Protocol

The protocol is a set of TypeScript interfaces that any backend (filesystem, SQLite, REST client) MUST implement. Operations are coarse-grained (note-level, config-level), not fine-grained (file-level). The interfaces are designed so that the filesystem adapter wraps existing code without rewriting it.

### §2.AC.01:5 A `NoteStorage` interface MUST define note CRUD, bulk loading, and attachment operations.

The interface covers:
- Single-note CRUD: `getNote`, `createNote`, `updateNote`, `deleteNote` (with archive/soft-delete/permanent modes), `restoreNote`
- Bulk operations for initialization: `getAllNotes`, `getAllReferences`
- Attachment support for folder-based notes: `getAttachments`, `getAttachmentContent`, `putAttachment`
- Optional change notification: `watch?(callback: (event: StorageEvent) => void): Unsubscribe`

The query API (`getNotes(query: NoteQuery)`) MAY be included here or remain as in-memory filtering on the consumer side. See {A002.§5.OQ.01}.

### §2.AC.02 A `ConfigStorage` interface MUST define configuration loading and saving.

Two methods: `load(): Promise<SCEpterConfig | null>` and `save(config: SCEpterConfig): Promise<void>`. The filesystem adapter reads from the existing `scepter.config.json` paths. Alternative backends map to their native config storage.

### §2.AC.03 A `TemplateStorage` interface MUST define template retrieval.

Two methods: `getTemplate(noteType: string): Promise<string | null>` and `listTemplates(): Promise<string[]>`. The filesystem adapter reads from `_scepter/templates/types/`.

### §2.AC.04 A `VerificationStorage` interface MUST define verification event persistence.

Two methods: `load(): Promise<VerificationStore>` and `save(store: VerificationStore): Promise<void>`. The filesystem adapter reads and writes `_scepter/verification.json`.

### §2.AC.05 An `IdCounterStorage` interface MUST define ID counter persistence.

Two methods: `load(): Promise<Record<string, number>>` and `save(counters: Record<string, number>): Promise<void>`. This formalizes the existing `IdGeneratorStorage` interface ({A002.§1.AC.03}) with a consistent naming convention.

### §2.AC.06 All storage interfaces MUST use `Promise`-based async signatures.

Even the filesystem adapter, where operations could be synchronous, MUST use async signatures. This ensures interface compatibility with inherently async backends (REST, database connections) without requiring adapter gymnastics.

---

## §3 Extraction Strategy

The extraction uses the adapter pattern: existing filesystem code is wrapped behind the new interfaces, not rewritten. This preserves current behavior while enabling alternative implementations.

### Phase 1: Define Interfaces

§3.AC.01 A new `core/src/storage/` module MUST be created containing the interface definitions.

Files: `storage-backend.ts` (the five interfaces from {A002.§2}), `storage-types.ts` (supporting types: `StorageEvent`, `Attachment`, `Unsubscribe`). No behavioral changes in this phase -- types only.

### Phase 2: Wrap Existing Code

§3.AC.02 A `FilesystemNoteStorage` class MUST implement `NoteStorage` by delegating to existing `NoteFileManager` and `UnifiedDiscovery`.

This is adapter-pattern wrapping. The existing classes remain intact; `FilesystemNoteStorage` composes them and translates between the storage interface and their current APIs.

§3.AC.03 Filesystem adapters MUST be created for `ConfigStorage`, `TemplateStorage`, `VerificationStorage`, and `IdCounterStorage`.

Each adapter wraps the existing subsystem's file I/O code. `ConfigManager`, `VerificationStore`, and `NoteTypeTemplateManager` delegate to their respective storage adapters rather than performing I/O directly.

### Phase 3: Thread Through ProjectManager

§3.AC.04:4 `ProjectManager` MUST accept storage interfaces at construction time and wire them into subsystems.

`ProjectManager` is the composition root. It currently constructs `NoteFileManager`, `ConfigManager`, etc. directly. After extraction, it receives `NoteStorage`, `ConfigStorage`, etc. as constructor parameters (or a composite `StorageBackend` object) and passes them to the subsystems that need them. A factory function (e.g., `createFilesystemProject(dir)`) constructs the filesystem-specific wiring.

Note: `ProjectManager` itself currently performs direct filesystem operations (directory creation via `fs.mkdir`, access checks via `fs.access`, directory reads via `fs.readdir`). These initialization operations MUST be moved into the factory function or a backend-specific bootstrap step, not into the generic `ProjectManager`. After extraction, `ProjectManager` MUST contain zero filesystem imports.

Similarly, `NoteManager` currently bypasses `NoteFileManager` for some operations (direct `fs.pathExists`, `fs.readdir`, `fs.readFile` calls). These MUST be routed through `NoteFileManager` (which is then wrapped by `FilesystemNoteStorage`) during Phase 2, so that `NoteManager` depends only on the storage interface.

### Phase 4: Fix Leaky Handlers

§3.AC.05 CLI handlers that bypass the storage protocol MUST be refactored.

Handlers with direct filesystem access that circumvents the manager layer:

| Handler | Severity | Issue | Fix |
|---------|----------|-------|-----|
| `ingest-handler.ts` | High | Reimplements note creation with raw `fs` calls | Rewrite to use `noteManager.createNote()` |
| `gather-handler.ts` | Medium | Reads folder note attachments via `fs` directly | Use `NoteStorage.getAttachments()` |
| `create-handler.ts` | Medium | Reads template files bypassing template manager | Use `TemplateStorage.getTemplate()` |
| `show-handler.ts` | Low | `fs.pathExists()` for user paths, `fs.writeFile()` for export | Path check is UI concern (acceptable); export needs `NoteStorage` or stays as display-layer I/O |
| `search-handler.ts` | Low | `glob` + `fs.readFile()` for source code search | Intentional — same category as `SourceCodeScanner` ({A002.§4.AC.02}) |
| `confidence/mark-command.ts` | Medium | Reads/writes source files via `fs-extra` | Same intentional coupling as `SourceCodeScanner` for source file annotation |
| `claim-formatter.ts` | Low | `fs.readFile()` for source file content display | Intentional — reading source files for display, not note storage |

### Phase 5: Build Alternative Backends

§3.AC.06 Alternative backend implementations are separate, independent work items outside the scope of the protocol extraction.

Each backend (SQLite, REST client, REST server) implements the same interfaces. Estimated effort: 3-5 days per backend. The extraction phases (1-4) are prerequisite and independently valuable -- they improve testability and separation of concerns even without alternative backends.

---

## §4 Architecture After Extraction

### §4.AC.01 Everything above the storage interface boundary MUST be identical regardless of backend.

The target architecture has a clear separation:

```
CLI Commands / Formatters
    |
    v
ProjectManager (composition root)
    |
    +-- NoteManager        (in-memory index, queries, CRUD orchestration)
    +-- ReferenceManager   (in-memory graph -- unchanged)
    +-- ClaimIndex          (in-memory -- unchanged)
    +-- ContextGatherer    (traversal -- unchanged)
    +-- StatusValidator    (validation -- unchanged)
    |
    v
StorageBackend (interface boundary)
    |
    +-- FilesystemNoteStorage   (current behavior, wrapped)
    +-- SqliteNoteStorage       (future)
    +-- RestNoteStorage         (future)
```

Commands, formatters, algorithms, and parsers are above the line. Storage implementations are below. No code above the line varies by backend.

### §4.AC.02:4 `SourceCodeScanner` MUST remain filesystem-coupled by design.

The source code scanner reads actual source files in the working tree. This is inherently filesystem-bound and intentionally so. For non-filesystem backends, the scanner continues to run against the local working tree and feeds `SourceReference[]` into whichever storage backend manages notes.

A future "source integration provider" abstraction (where IDE plugins, CI pipelines, or LSP servers push references) is a valid long-term evolution but is NOT required for the initial extraction. The scanner's filesystem coupling does not violate {A002.§1.AC.01} because it operates on source code, not notes.

---

## §5 Open Design Decisions

### §5.OQ.01 Should `NoteStorage` support query-level operations or only bulk loading?

The current architecture loads all notes into memory and filters with in-memory `NoteQuery` logic. This works for filesystem and SQLite (where startup is fast), but a REST backend may need server-side filtering. Options:

1. **Bulk load only.** `getAllNotes()` returns everything; filtering stays in-memory. Simple, preserves current behavior, but scales poorly for large remote stores.
2. **Query passthrough.** `NoteStorage.getNotes(query: NoteQuery)` pushes filtering to the backend. More complex, but necessary for REST backends with large note counts.
3. **Hybrid.** Bulk load for small backends, query passthrough for large ones. Most flexible but most complex.

Decision deferred until the first non-filesystem backend is built. The interface SHOULD include `getNotes(query)` from the start even if the filesystem adapter implements it as "load all, filter in memory."

### §5.OQ.04 Should `getAllNotes()` return full content or support lazy loading?

The current filesystem backend loads all note content during initialization (notes are small, reads are fast). For REST backends with high latency, fetching full content for every note at startup may be prohibitive. Options:

1. **Always return full content.** Simple, matches current behavior. All in-memory filtering and claim indexing works without additional fetches.
2. **Return metadata only, lazy-load content.** `getAllNotes()` returns ID, type, title, tags, dates. Content fetched on demand via `getNote(id)`. Faster startup for remote backends but requires refactoring consumers that assume content is present (especially `ClaimIndex.build()` which parses markdown content).
3. **Backend decides.** The interface returns `Note` objects; backends choose whether to populate `content` eagerly or lazily. A `content?: string` field signals whether content was loaded.

This is orthogonal to {A002.§5.OQ.01} (query pushdown is about WHERE filtering happens; lazy loading is about WHETHER content is fetched during initialization). Both decisions affect REST backend viability but can be resolved independently.

### §5.OQ.02 How do folder-based notes map to non-filesystem backends?

Folder-based notes (`R001 Title/index.md` with additional assets) are a filesystem-native concept. SQLite and REST backends need a mapping. The `Attachment` abstraction in {A002.§2.AC.01} is the proposed approach: a note can have named attachments (images, data files) that are stored as blobs or linked resources. The index file becomes the note content; additional files become attachments.

This mapping needs validation against actual folder-based note usage patterns before implementation.

### §5.OQ.03 Should the reference graph be persisted or rebuilt at startup?

Currently the reference graph is rebuilt every startup by parsing all note content. This is fast for filesystem (notes are small, parsing is cheap) but could be slow for REST backends with high latency. Options:

1. **Always rebuild.** Simple, consistent, no cache invalidation. Current behavior.
2. **Persist as a separate storage artifact.** Faster startup, but requires invalidation when notes change.
3. **Backend-specific optimization.** SQLite stores references as a table; REST server maintains the graph server-side.

Decision deferred. The initial extraction SHOULD NOT change the rebuild-at-startup behavior. Alternative backends can optimize independently.

---

## §6 Risk Assessment

### §6.AC.01 The adapter-pattern extraction has low risk of breaking existing behavior.

The filesystem adapter wraps existing code without modifying it. The risk is limited to wiring errors at the adapter boundary, which are caught by type checking and existing tests. No algorithms, parsers, or domain logic change.

### §6.AC.02 Watch semantics differ across backends and need careful interface design.

`chokidar` provides granular file-level events (create, modify, delete) with path information. SQLite would use `sqlite3_update_hook` or polling. REST would use WebSocket or SSE. The `watch()` method on `NoteStorage` is intentionally optional (`watch?`) to accommodate backends where change notification is expensive or unavailable.

### §6.AC.03 NoteQuery translation is a medium-risk concern for non-filesystem backends.

In-memory filtering in JavaScript is the current approach. A SQLite backend would want SQL-native queries (especially with FTS5 for text search) for performance. The `getNotes(query: NoteQuery)` interface must be designed so that backends can implement efficient native queries without the interface leaking SQL or filesystem assumptions.

### §6.AC.04 Initialization performance may vary significantly across backends.

The filesystem backend loads lazily via glob. SQLite could load eagerly with a single query. REST backends face latency on each request. The initialization path in `ProjectManager` MUST be async and MUST NOT assume that loading is instant.

---

## §7 Effort Estimate

| Phase | Work | Estimated Effort |
|-------|------|-----------------|
| Phase 1: Define interfaces | Types only, no behavior | ~1 day |
| Phase 2: Wrap existing code | Adapter classes for 5 subsystems | ~2-3 days |
| Phase 3: Thread through ProjectManager | Composition root refactor | ~1-2 days |
| Phase 4: Fix leaky handlers | 3 handler refactors | ~1 day |
| Phase 5: Per alternative backend | SQLite, REST client, REST server | ~3-5 days each |

Phases 1-4 total approximately 5-7 days of focused work. Each phase is independently mergeable and provides incremental value (better testability, clearer boundaries).

---

## §8 Scope Boundaries

### In Scope
- Storage interface definitions (`NoteStorage`, `ConfigStorage`, `TemplateStorage`, `VerificationStorage`, `IdCounterStorage`)
- Filesystem adapter implementations wrapping existing code
- `ProjectManager` composition root refactor to accept storage interfaces
- Handler refactors to eliminate direct filesystem access
- Supporting types (`StorageEvent`, `Attachment`, `Unsubscribe`)

### Out of Scope
- SQLite backend implementation (separate work item after extraction)
- REST backend implementation (separate work item after extraction)
- REST server implementation (separate work item after extraction)
- Source code scanner abstraction (intentionally filesystem-coupled, see {A002.§4.AC.02})
- Changes to the claims system's backend-agnostic modules (see {A002.§1.AC.02})
- UI or VS Code extension storage concerns (separate architecture)
- Migration tooling between backends
- Chat/session storage (`ChatSessionStore` in `core/src/chat/types.ts` already defines a `save/load/list/delete` interface implemented by `FileChatSessionStore` — this is a sixth storage concern that follows the same pattern but is part of the chat subsystem, not the core note system; it can adopt the `StorageBackend` pattern independently)
- Project initialization for non-filesystem backends (`init.ts` and `scaffold.ts` create directory structures; for SQLite/REST backends, initialization is a fundamentally different operation — schema creation, server registration — and requires its own design, not adaptation of the filesystem init flow)
