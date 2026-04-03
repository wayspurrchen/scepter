---
created: 2026-04-02T16:04:23.439Z
tags: [architecture, api, library, vscode, packaging]
status: draft
---

# A003 - Library API Surface - Core as Importable Package

**Date:** 2026-04-02
**Status:** Draft
**Scope:** Define and expose the SCEpter core library as an importable TypeScript package so that consumers (VS Code extension, web UI, future integrations) can use the domain logic directly instead of shelling out to the CLI.

---

## §1 Problem Statement

The SCEpter core library has clean internal architecture -- `ProjectManager` is a well-structured composition root, subsystems have focused responsibilities, parsers are pure functions, and the claims subsystem has a proper barrel export (`core/src/claims/index.ts`). But none of this is consumable as a library. The build only produces the CLI entry point. There are no package exports. External consumers have no option other than subprocess invocation.

### §1.AC.01:5 The core library MUST be importable as a TypeScript/JavaScript package, not only executable as a CLI.

The `tsup.config.ts` entry point is `['src/cli/index.ts']` -- only the CLI. No `core/src/index.ts` barrel export exists. The `core/src/types/index.ts` file is empty. The root `package.json` has no `exports`, `main`, or `types` fields. There is no mechanism for another TypeScript project to `import { ProjectManager } from '@scepter/core'` or equivalent.

### §1.AC.02:4 The VS Code extension MUST NOT shell out to the CLI for operations that the core library can serve directly.

The VS Code extension (`vscode/src/claim-index.ts:279-287`) uses `execFile('scepter', ['claims', 'index', '--json', ...])` to build its claim index, parsing stdout JSON. This subprocess pattern causes:

- **Startup latency:** Each refresh spawns a new process, loads Node.js, parses config, discovers notes, and builds the full index from scratch.
- **No incremental updates:** Every refresh is a full rebuild via CLI. There is no way to add a single note's claims incrementally.
- **No streaming:** The extension cannot observe changes in real-time. It polls via a 2-second debounced file watcher that triggers a full CLI re-invocation.
- **Fragile error handling:** CLI failures produce stderr strings that the extension must parse heuristically. The `ready` promise resolves even on failure (`claim-index.ts:367`), leaving providers operating on an empty index.

### §1.AC.03:4 Type duplication between core and consumers MUST be eliminated.

The VS Code extension (`vscode/src/claim-index.ts:9-57`) manually re-declares `ClaimIndexEntry`, `ClaimCrossReference`, `ClaimIndexData`, `TraceResult`, and `NoteInfo` -- types that already exist in `core/src/claims/claim-index.ts` and `core/src/types/`. Changes to core types silently drift from the extension's copies. The comment at line 9 acknowledges this: "Types mirroring core/src/claims/claim-index.ts."

### §1.AC.04 Pattern duplication between core and consumers MUST be eliminated.

The extension's `patterns.ts` reimplements claim reference detection with six independent regex patterns and overlap-prevention logic. The core library has `claim-parser.ts` and `note-parser.ts` performing the same work with different implementations. As documented in the VS Code extension audit (`docs/202604021030 VS Code Extension Audit.md`, Issue 7), the extension's patterns diverge from core in bare note ID validation, range reference support, and comma-separated reference handling.

Additionally, `markdown-plugin.ts` duplicates the patterns from `patterns.ts` within the same extension, creating a second level of duplication (audit Issue 4).

### §1.AC.05 Config detection logic MUST NOT be duplicated in consumers.

The extension's `findScepterProject()` (`extension.ts:100-116`) only checks `_scepter/scepter.config.json`. The core `ConfigManager` checks two paths in priority order, starting with root-level `scepter.config.json`. The VS Code extension's `package.json` activation event (`workspaceContains:_scepter/scepter.config.json`) has the same limitation. A root-config project is invisible to the extension. This divergence exists because the extension has no access to `ConfigManager` and must reinvent the detection logic.

---

## §2 Current Internal State Assessment

The internal architecture is largely ready for library exposure. This section inventories what exists, what is missing, and what requires changes.

### §2.AC.01 The following subsystems are ready for direct exposure with no or minimal changes.

| Subsystem | File | Exposure readiness | Notes |
|-----------|------|--------------------|-------|
| `ProjectManager` | `project/project-manager.ts` | Ready | Clean composition root, already accepts deps via `ProjectManagerDependencies` |
| `NoteManager` | `notes/note-manager.ts` | Ready | Full CRUD + query API |
| `ReferenceManager` | `references/reference-manager.ts` | Ready | Pure in-memory graph, no I/O |
| `ClaimIndex` | `claims/claim-index.ts` | Ready | Barrel export already exists (`claims/index.ts`) |
| `ContextGatherer` | `context/context-gatherer.ts` | Ready | Pure traversal logic |
| `ConfigManager` | `config/config-manager.ts` | Ready | Config loading and validation |
| `StatusValidator` | `statuses/status-validator.ts` | Ready | Pure validation |
| `NoteTypeResolver` | `notes/note-type-resolver.ts` | Ready | Pure resolution |
| `SourceCodeScanner` | `scanners/source-code-scanner.ts` | Ready | Self-contained scanning |
| Claim parser | `parsers/claim/claim-parser.ts` | Ready | Pure functions |
| Note parser | `parsers/claim/claim-tree.ts` | Ready | Pure functions |
| Traceability | `claims/traceability.ts` | Ready | Pure computation |
| Claim search | `claims/claim-search.ts` | Ready | Pure filtering |
| Claim metadata | `claims/claim-metadata.ts` | Ready | Pure interpretation |

### §2.AC.02 The following infrastructure is missing and MUST be created.

| Missing piece | What it is | Why it's needed |
|---------------|-----------|-----------------|
| `core/src/index.ts` | Top-level barrel export | Entry point for library consumers |
| `core/src/types/index.ts` content | Type re-exports | The file exists but is empty |
| Dual entry point in `tsup.config.ts` | CLI + library build | Separate entry for library consumers |
| `package.json` `exports` field | Conditional exports | Enables `import { ProjectManager } from 'scepter'` |
| `package.json` `main` + `types` fields | Default entry | Basic package resolution |

### §2.AC.03 The claims barrel export (`claims/index.ts`) SHOULD be the model for other subsystem exports.

The claims subsystem already has a clean barrel that re-exports types and functions from all six internal modules. Other subsystems (notes, references, config, parsers) need equivalent barrels, or the top-level `core/src/index.ts` must selectively re-export their public surfaces.

---

## §3 Proposed Solution

### Barrel Exports

§3.AC.01:4 A top-level `core/src/index.ts` MUST export the public API surface of the library.

The barrel groups exports by subsystem. Not everything internal is exposed -- only the types, classes, and functions that external consumers need. The API surface should include:

- **Classes:** `ProjectManager`, `NoteManager`, `ReferenceManager`, `ClaimIndex`, `ConfigManager`, `ContextGatherer`, `SourceCodeScanner`, `StatusValidator`, `NoteTypeResolver`
- **Functions:** Claim parsing (`parseClaimAddress`, `parseClaimMetadata`), traceability (`buildTraceabilityMatrix`, `findGaps`), claim search, claim threading
- **Types:** All types from `core/src/types/` (Note, NoteQuery, Reference, SourceReference, ClaimAddress, SCEpterConfig, NoteTypeConfig, ContextHints, etc.)
- **Interfaces:** `ProjectManagerDependencies`, storage-related interfaces when {A002} is implemented

§3.AC.02 The `core/src/types/index.ts` barrel MUST re-export all public types.

The file currently exists but is empty. It must re-export from `config.ts`, `note.ts`, `reference.ts`, `context.ts`, and `task.ts`. Consumers should be able to `import type { Note, NoteQuery, SCEpterConfig } from 'scepter/types'` or from the top-level barrel.

### Dual Entry Point Build

§3.AC.03:4 The `tsup.config.ts` MUST produce both a CLI entry point and a library entry point.

The current config builds only `src/cli/index.ts`. After the change:

```typescript
export default defineConfig({
  entry: {
    cli: 'src/cli/index.ts',
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  // ...existing options
});
```

This produces `dist/cli.js` (CLI), `dist/index.js` (library), and `dist/index.d.ts` (types). The CLI entry point continues to work as before. The library entry point is new.

### Package Configuration

§3.AC.04 The `package.json` MUST define an `exports` map with separate entry points for the library and CLI.

```json
{
  "exports": {
    ".": {
      "import": "./core/dist/index.mjs",
      "require": "./core/dist/index.cjs",
      "types": "./core/dist/index.d.ts"
    },
    "./types": {
      "import": "./core/dist/types/index.mjs",
      "require": "./core/dist/types/index.cjs",
      "types": "./core/dist/types/index.d.ts"
    }
  },
  "main": "./core/dist/index.cjs",
  "module": "./core/dist/index.mjs",
  "types": "./core/dist/index.d.ts",
  "bin": {
    "scepter": "./scepter"
  }
}
```

The `bin` field is unchanged -- the `./scepter` shell script remains the CLI entry point for global/local installs.

§3.AC.05 The library entry point MUST NOT import Commander.js, chalk, or other CLI-specific dependencies.

The library barrel imports domain classes and types only. CLI formatting, argument parsing, and terminal output are confined to `core/src/cli/` and excluded from the library surface. This keeps the library lightweight and prevents dependency contamination in consumer bundles.

### Public API Boundary

§3.AC.06:4 The library MUST distinguish between public API and internal implementation.

Not every class and function is public API. The boundary:

| Public API | Internal (not exported from barrel) |
|-----------|-------------------------------------|
| `ProjectManager` | `BaseCommand`, command handlers |
| `NoteManager` | `NoteFileManager` (implementation detail) |
| `ReferenceManager` | `NoteIdGenerator` (implementation detail) |
| `ClaimIndex` | `SourceReferenceIndex` (accessed via `ReferenceManager`) |
| `ConfigManager` | `ConfigValidator` (used internally by `ConfigManager`) |
| `ContextGatherer` | `UnifiedDiscovery` (used internally by `NoteManager`) |
| `SourceCodeScanner` | Formatters (CLI concern) |
| `StatusValidator` | CLI scanner utilities |
| `NoteTypeResolver` | |
| `NoteTypeTemplateManager` | |
| Parser functions | |
| Traceability functions | |
| Claim search/thread functions | |

Consumers interact with `ProjectManager` as the primary entry point, which wires subsystems together. Individual subsystem classes are also exported for advanced use cases (e.g., building a `ClaimIndex` without full project initialization).

---

## §4 Consumer Patterns

### §4.AC.01 The VS Code extension MUST use the library API for claim indexing, note lookup, and reference resolution.

Instead of the current pattern:

```typescript
// Current: subprocess invocation
const { stdout } = await execFileAsync('scepter', ['claims', 'index', '--json', ...]);
const data = JSON.parse(stdout);
```

The extension would use:

```typescript
// Proposed: direct library import
import { ProjectManager } from 'scepter';

const pm = new ProjectManager(projectDir);
await pm.initialize();

// Build claim index directly
const claimIndex = pm.claimIndex;
await claimIndex.build(pm.noteManager, pm.sourceScanner);

// Query notes directly
const notes = await pm.noteManager.getAllNotes();

// Trace claims directly
const matrix = buildTraceabilityMatrix(claimIndex, projectionTypes);
```

This eliminates the subprocess overhead, the JSON serialization/deserialization, the duplicated types, and the fragile error handling.

### §4.AC.02 The VS Code extension MUST use the library's config detection instead of reimplementing it.

```typescript
// Current: hardcoded single path
const configPath = path.join(folder.uri.fsPath, '_scepter', 'scepter.config.json');

// Proposed: use ConfigManager which knows all valid paths
import { ConfigManager } from 'scepter';
const cm = new ConfigManager(folder.uri.fsPath);
const config = await cm.loadConfigFromFilesystem();
if (config) { /* project found */ }
```

### §4.AC.03 The VS Code extension MUST use the library's parser functions instead of maintaining independent regex patterns.

The extension's `patterns.ts` (170 lines) and `markdown-plugin.ts` (duplicated patterns) would be replaced by imports from the core's claim and note parsers. The core's `parseClaimAddress()`, `buildBracelessPatterns()`, and note reference parsing would serve as the single source of truth for reference detection.

### §4.AC.04 Consumers that need file watching SHOULD use `ProjectManager.initialize({ startWatchers: true })` or subsystem-level watchers.

The extension currently maintains its own `vscode.FileSystemWatcher` with a hardcoded `_scepter/**/*.md` glob. The core's `NoteManager` and `SourceCodeScanner` already have chokidar-based watchers that respect discovery paths. VS Code consumers may still prefer VS Code's native file watchers for integration with the editor lifecycle, but the discovery paths and patterns should come from the library's config rather than being hardcoded.

---

## §5 Migration Path

The migration is incremental. Each phase is independently mergeable and provides value.

### Phase 1: Create Barrel Exports and Build Configuration

§5.AC.01 Create `core/src/index.ts` and populate `core/src/types/index.ts`.

This is a types-and-exports-only change. No behavior changes. No existing code is modified -- new files are created and existing modules get re-exported. The claims barrel (`claims/index.ts`) is the template.

§5.AC.02 Update `tsup.config.ts` to produce dual entry points.

Add `src/index.ts` as a second entry point. The CLI entry point is unchanged. Verify that `dts: true` generates `.d.ts` files for the library entry.

§5.AC.03 Update `package.json` with `exports`, `main`, `module`, and `types` fields.

The `bin` field stays. The `exports` field enables subpath imports. Verify that `tsc` resolution and bundler resolution both find the correct entry points.

### Phase 2: Verify Importability

§5.AC.04 The library MUST be importable from the VS Code extension's build without circular dependencies or missing types.

Create a minimal test in the VS Code extension that imports `ProjectManager` and a few types from the library. Verify that TypeScript compiles, that the VS Code extension bundler (tsc) resolves types correctly, and that no CLI-specific dependencies leak into the import graph.

### Phase 3: Migrate VS Code Extension Incrementally

§5.AC.05 The VS Code extension SHOULD migrate one subsystem at a time, starting with types.

Recommended migration order:

1. **Types first.** Replace the duplicated `ClaimIndexEntry`, `ClaimCrossReference`, `ClaimIndexData` interfaces with imports from the library. This is zero-risk -- only type-level imports, no runtime changes.

2. **Config detection second.** Replace `findScepterProject()` with `ConfigManager` usage. This fixes the root-config detection bug (audit Issue 3) as a side effect.

3. **Claim index third.** Replace `execFile('scepter', ['claims', 'index', ...])` with direct `ClaimIndex.build()`. This is the highest-impact change: eliminates subprocess overhead, fixes the `noteTypes` gap (audit Issue 2), enables incremental updates, and provides proper error handling.

4. **Patterns fourth.** Replace `patterns.ts` regex patterns with imports from core parsers. This fixes range reference support, bare note validation, and eliminates the markdown-plugin duplication (audit Issues 4, 7).

5. **File watching last.** Replace the hardcoded `_scepter/**/*.md` watcher with config-aware watchers. This fixes the discovery path bug (audit Issue 1).

Each step can be validated independently and rolled back without affecting other steps.

### Phase 4: Address Extension-Specific Concerns

§5.AC.06 The VS Code extension's `package.json` activation event MUST be updated to match the library's config detection paths.

Currently `"workspaceContains:_scepter/scepter.config.json"` -- this should also activate on `"workspaceContains:scepter.config.json"` for root-config projects. This is an extension-side change that does not depend on the library API but should be done as part of the migration.

---

## §6 Relationship to {A002} (Backend Agnosticism)

The library API surface ({A003}) and the storage protocol extraction ({A002}) are complementary but independent work streams.

### §6.AC.01 The library API surface MUST NOT depend on or wait for the storage protocol extraction.

{A002} proposes extracting storage interfaces (`NoteStorage`, `ConfigStorage`, etc.) from filesystem-coupled code. {A003} proposes exposing the existing classes as importable packages. These can proceed in either order:

- If {A003} ships first, the library exposes `ProjectManager`, `NoteManager`, etc. with their current filesystem-coupled implementations. When {A002} later extracts storage interfaces, the library's public API does not change -- consumers still use `ProjectManager` -- but the construction changes (factory functions, dependency injection).
- If {A002} ships first, the storage interfaces exist but are only consumed internally (by the CLI). {A003} then exposes both the domain classes and the storage interfaces as public API.

The shared constraint is that `ProjectManager` is the composition root in both cases. {A002} changes what ProjectManager receives at construction time. {A003} changes whether ProjectManager is accessible outside the CLI. Neither blocks the other.

### §6.AC.02 When {A002} storage interfaces are implemented, they SHOULD be part of the library's public API surface.

Consumers that need custom storage backends (e.g., a web-hosted SCEpter that uses a database) would import both the domain classes and the storage interfaces from the library, then provide their own backend implementations to `ProjectManager`.

---

## §7 Risk Assessment

### §7.AC.01 The primary risk is API stability: exposing internal classes creates a public contract.

Once external consumers depend on `NoteManager.getAllNotes()` or `ClaimIndex.build()`, method signatures become harder to change. The mitigation is explicit: only classes and functions exported from the barrel are public API. Internal modules that are not re-exported can change freely.

Semver should be used once the library is published: breaking changes to the barrel's exports require a major version bump.

### §7.AC.02 Dependency weight is a secondary risk.

The core library depends on `commander`, `chalk`, `chokidar`, `gray-matter`, `handlebars`, `zod`, `glob`, `fs-extra`, and others. A library consumer pulls all of these transitively. {A003.§3.AC.05} mitigates this by ensuring the library barrel does not import CLI-specific modules, but runtime dependencies like `gray-matter` and `chokidar` are still included because they are used by domain subsystems.

Long-term, the library could split into `@scepter/core` (domain logic, parsers, types -- minimal deps) and `@scepter/fs` (filesystem adapters, watchers -- heavier deps). This split aligns naturally with {A002}'s storage protocol extraction but is not required for the initial release.

### §7.AC.03 The VS Code extension's bundling may conflict with the core library's Node.js dependencies.

The VS Code extension uses `tsc` (not a bundler) and the extension host provides Node.js APIs. The core library's `fs`, `path`, and `child_process` imports are compatible. However, if the extension migrates to a web extension (running in the browser), Node.js APIs would be unavailable. This is a future concern, not a current blocker -- the storage protocol from {A002} would address it by replacing filesystem calls with backend-agnostic interfaces.

---

## §8 Effort Estimate

| Phase | Work | Estimated Effort |
|-------|------|-----------------|
| Phase 1: Barrel exports + build config | New files, tsup/package.json changes | ~0.5 day |
| Phase 2: Verify importability | Minimal test, resolve issues | ~0.5 day |
| Phase 3: Migrate extension (types) | Replace duplicated interfaces | ~0.5 day |
| Phase 3: Migrate extension (config) | Replace findScepterProject | ~0.5 day |
| Phase 3: Migrate extension (claim index) | Replace execFile with direct API | ~1-2 days |
| Phase 3: Migrate extension (patterns) | Replace regex with core parsers | ~1 day |
| Phase 3: Migrate extension (watchers) | Replace hardcoded glob with config | ~0.5 day |
| Phase 4: Activation event fix | VS Code manifest change | ~0.25 day |

Total: approximately 4-6 days. Phases 1-2 (~1 day) are prerequisite. Phase 3 steps can be done incrementally over multiple sessions.

---

## §9 Scope Boundaries

### In Scope

- Top-level barrel export (`core/src/index.ts`)
- Types barrel export (`core/src/types/index.ts`)
- Dual entry point build via tsup
- Package.json `exports`, `main`, `module`, `types` fields
- Public API boundary definition
- VS Code extension migration path from CLI subprocess to library API
- Relationship to {A002} backend agnosticism

### Out of Scope

- Actual implementation of {A002} storage protocol interfaces (separate work, see {A002})
- Package publishing to npm (future decision)
- Web UI library consumption (separate consumer with different needs)
- Breaking the library into multiple packages (`@scepter/core`, `@scepter/fs`)
- Adding new subsystem functionality -- this note is about exposing what exists
- VS Code extension bugs unrelated to the CLI-subprocess pattern (see audit for full list)
- LLM and chat subsystem exposure (these have external service dependencies and different stability characteristics)
