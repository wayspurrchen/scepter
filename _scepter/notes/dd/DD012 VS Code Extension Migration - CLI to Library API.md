---
created: 2026-04-02T18:03:04.146Z
tags: [vscode, library, migration, api, claims]
status: draft
---

# DD012 - VS Code Extension Migration - CLI to Library API

**Architecture:** {A003}
**Prerequisite DD:** {DD011} (Phases 1-2: Barrel exports and build configuration -- implemented)
**Audit:** `docs/202604021030 VS Code Extension Audit.md`
**Date:** 2026-04-02
**Scope:** Implementation blueprint for Phase 3 of {A003}: migrating the VS Code extension from CLI subprocess invocation to direct library API usage. Covers types, config detection, claim indexing, pattern matching, and file watching -- five incremental migration steps per {A003.§5.AC.05}. Each step is independently mergeable.
**Downstream consumers:** {R011.§4} (VS Code Extension Behavior — alias-prefixed reference handling) and {DD015} (Phases 9–12) build on the post-DD012 library surface — `parseClaimReferences`/`parseNoteMentions` in `vscode/src/patterns.ts` and the `ClaimIndexCache` shape are the contract those phases extend.

---

## Current State

The VS Code extension (`scepter-claims` v0.0.1) communicates with the core library exclusively through `execFile('scepter', ...)` subprocess invocation. This causes the problems documented in {A003.§1.AC.02}: startup latency on every refresh, no incremental updates, no streaming, and fragile error handling. The extension also duplicates types ({A003.§1.AC.03}), regex patterns ({A003.§1.AC.04}), and config detection ({A003.§1.AC.05}) from the core library.

With {DD011} implemented, the core library is now importable as a package. The barrel export (`core/src/index.ts`) provides `ProjectManager`, `ClaimIndex`, `ConfigManager`, `createFilesystemProject`, `findProjectRoot`, parser functions, and all domain types. The extension can now replace its subprocess calls and duplicated code with direct imports.

### Extension Files Affected

| File | Current responsibility | Migration impact |
|------|----------------------|-----------------|
| `vscode/src/claim-index.ts` | Types (lines 9-57), subprocess invocation, index cache, file watcher | Major rewrite: types deleted, subprocess replaced, watcher rewritten |
| `vscode/src/extension.ts` | `findScepterProject()`, activation, provider registration | Config detection replaced |
| `vscode/src/patterns.ts` | Six regex patterns, `findAllMatches()`, `matchAtPosition()` | Regex replaced with core parser calls; wrapper functions retained |
| `vscode/src/markdown-plugin.ts` | Duplicated regex patterns for markdown preview | Imports from rewritten `patterns.ts` (fixes audit Issue 4) |
| `vscode/src/hover-provider.ts` | Hover tooltips | Minor: benefits from richer data available via library |
| `vscode/src/definition-provider.ts` | Go-to-definition | Minor: benefits from richer data |
| `vscode/src/decoration-provider.ts` | Reference underlines | Minor: benefits from `isKnown()` using config-aware shortcodes |
| `vscode/src/trace-provider.ts` | Trace command via subprocess | Subprocess call replaced with direct `buildTraceabilityMatrix()` |
| `vscode/package.json` | Activation events, dependencies | Activation events updated, dependency added |
| `vscode/tsconfig.json` | TypeScript compilation | Path mapping or project reference added |

---

## Module Inventory

### Files Modified

| File | Change |
|------|--------|
| `vscode/src/claim-index.ts` | Remove duplicated types, replace subprocess with direct API, rewrite file watcher |
| `vscode/src/extension.ts` | Replace `findScepterProject()` with `findProjectRoot()` from library |
| `vscode/src/patterns.ts` | Replace regex patterns with core parser functions; keep `findAllMatches()` / `matchAtPosition()` wrappers |
| `vscode/src/markdown-plugin.ts` | Import `findAllMatches` from `patterns.ts` instead of duplicating regexes |
| `vscode/src/trace-provider.ts` | Replace subprocess `trace()` call with direct `buildTraceabilityMatrix()` |
| `vscode/src/hover-provider.ts` | Replace sync `readClaimContext()` with async version |
| `vscode/package.json` | Add activation event for root config, add core library dependency |
| `vscode/tsconfig.json` | Add path mapping for core library imports |

### Files Deleted

None. All existing files are modified in place.

### Files Created

None. No new files are needed.

---

## Build and Dependency Configuration

### Package Dependency

§DC.01:derives=A003.§5.AC.04 The VS Code extension MUST depend on the core library as a workspace-relative path dependency.

The extension and core library are in the same monorepo. The `vscode/package.json` adds:

```json
{
  "dependencies": {
    "scepter-core": "file:../core"
  }
}
```

This creates a symlink from `vscode/node_modules/scepter-core` to `../core`. TypeScript resolves types through the symlink. The VS Code extension host resolves runtime imports the same way.

The name `scepter-core` matches the `name` field in `core/package.json`. If that field differs, the dependency name must match it.

### TypeScript Configuration

§DC.02:derives=A003.§5.AC.04 The extension's `tsconfig.json` MUST resolve imports from the core library barrel.

The current `vscode/tsconfig.json` uses `module: "commonjs"` and `target: "ES2020"`. Add a `paths` mapping so that `import { ... } from 'scepter-core'` resolves to the core library source:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "lib": ["ES2020"],
    "outDir": "out",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "paths": {
      "scepter-core": ["../core/src/index.ts"],
      "scepter-core/*": ["../core/src/*"]
    },
    "baseUrl": "."
  },
  "include": ["src"],
  "exclude": ["node_modules", "out"]
}
```

The `paths` mapping allows TypeScript to resolve types at dev time. At runtime, Node.js resolves `scepter-core` via the `file:../core` dependency in `package.json`.

### Extension Bundling

§DC.03:derives=A003.§7.AC.03 The extension's `tsc`-based build MUST work with the core library's Node.js dependencies.

The current extension uses plain `tsc` compilation (no bundler). The core library's dependencies (`gray-matter`, `chokidar`, `glob`, `zod`, `fs-extra`, `handlebars`) are Node.js-compatible and available in the VS Code extension host. Since the extension targets desktop VS Code (not web), Node.js APIs are available.

The `file:../core` dependency means the core library's `node_modules` are resolved from the core directory. The extension MUST run `npm install` (or equivalent) in its own directory so that the symlink is created and the core's transitive dependencies are available.

If bundling becomes necessary for distribution (vsix packaging), `esbuild` with `external: ['vscode']` is the recommended path. This is a future concern documented under Open Questions and does not block the migration.

---

## Step 1: Types Migration

### Scope

Replace duplicated type interfaces in `vscode/src/claim-index.ts` lines 9-57 with imports from the core library. Zero-risk change: only type-level imports, no runtime behavior change.

### Types Replaced

§DC.04:derives=A003.§1.AC.03 Duplicated type interfaces in `vscode/src/claim-index.ts` MUST be replaced with imports from the core library.

| Extension type (deleted) | Core library type (imported) | Import path |
|-------------------------|---------------------------|-------------|
| `ClaimIndexEntry` (lines 11-29) | `ClaimIndexEntry` | `scepter-core` |
| `ClaimCrossReference` (lines 31-39) | `ClaimCrossReference` | `scepter-core` |
| `ClaimIndexData` (lines 41-46) | `ClaimIndexData` | `scepter-core` |

The extension's `TraceResult` (lines 48-57) and `NoteInfo` (lines 59-66) have no direct core equivalents. They are retained as extension-local types. `TraceResult` is removed in Step 3 when the trace method is rewritten. `NoteInfo` is retained for the extension's hover and decoration providers.

### Type Differences

The core's `ClaimIndexData` uses `Map` types (`entries: Map<string, ClaimIndexEntry>`, `noteTypes: Map<string, string>`, `trees: Map<string, ClaimNode[]>`). The extension's version uses `Record<string, ...>` (which is what the JSON serialization produces). After the migration to direct API usage (Step 3), the extension receives `Map` objects directly, so the types align.

During the interim between Step 1 and Step 3, the extension still receives JSON from the CLI. The `ClaimIndexData` type from core uses `Map`, but the JSON deserialization produces plain objects. The extension's `refresh()` method already converts the JSON to a `Map` at line 296: `this.entries = new Map(Object.entries(data.entries))`. This continues to work. The type mismatch (`Record` from JSON vs `Map` from type) is handled by the existing conversion code.

### Import Statement

After Step 1, the top of `vscode/src/claim-index.ts` becomes:

```typescript
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

import type {
  ClaimIndexEntry,
  ClaimCrossReference,
  ClaimIndexData,
} from 'scepter-core';
```

The `export` keywords on the deleted interfaces are replaced by re-exports for consumers within the extension:

```typescript
export type { ClaimIndexEntry, ClaimCrossReference, ClaimIndexData } from 'scepter-core';
```

The `TraceResult` and `NoteInfo` interfaces remain as local definitions with `export`.

---

## Step 2: Config Detection Migration

### Scope

Replace `findScepterProject()` in `extension.ts` lines 100-116 with `findProjectRoot()` from the core library. Also update `package.json` activation events. Fixes audit Issue 3 (root-config detection).

### Config Detection Replacement

§DC.05:derives=A003.§1.AC.05 The extension's `findScepterProject()` MUST be replaced with the library's `findProjectRoot()`.

The core library exports `findProjectRoot(startPath: string): Promise<string | null>` from `core/src/storage/filesystem/create-filesystem-project.ts` (re-exported via `core/src/index.ts`). This function checks:
1. `scepter.config.js` at current path
2. `_scepter/scepter.config.json` at current path
3. Legacy `scepter.config.json` at current path
4. Walks up parent directories repeating the checks

The extension's current `findScepterProject()` only checks `_scepter/scepter.config.json` and does not walk up. The replacement is:

```typescript
import { findProjectRoot } from 'scepter-core';

async function findScepterProject(): Promise<string | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return null;

  for (const folder of workspaceFolders) {
    const root = await findProjectRoot(folder.uri.fsPath);
    if (root) return root;
  }

  return null;
}
```

Note that `findProjectRoot` is async. The call site in `activate()` at line 24 must be updated accordingly. Since `activate()` already returns a non-void type (the markdown-it plugin object), it can be made `async`. VS Code's activation API supports async activate functions.

### Activation Event Update

§DC.06:derives=A003.§5.AC.06 The extension's `package.json` activation events MUST include both config file locations.

The current activation event is:
```json
"activationEvents": [
  "workspaceContains:_scepter/scepter.config.json"
]
```

Updated to:
```json
"activationEvents": [
  "workspaceContains:_scepter/scepter.config.json",
  "workspaceContains:scepter.config.json",
  "workspaceContains:scepter.config.js"
]
```

This ensures the extension activates for projects using root-level config, which the core library's `ConfigManager` supports as the primary config location.

---

## Step 3: Claim Index Migration

### Scope

Replace the `execFile('scepter', ['claims', 'index', '--json', ...])` pattern in `claim-index.ts` with direct `ProjectManager` / `ClaimIndex` usage. This is the highest-impact change: eliminates subprocess overhead, enables incremental updates, fixes the `noteTypes` gap (audit Issue 2), and provides proper error handling. Also replaces the `trace()` subprocess call with direct `buildTraceabilityMatrix()`.

### ProjectManager Instantiation

§DC.07:derives=A003.§4.AC.01 The extension MUST instantiate a `ProjectManager` via `createFilesystemProject()` and hold it for the extension's lifetime.

The `ClaimIndexCache` constructor currently accepts `(projectDir, outputChannel)`. After migration, it also receives a `ProjectManager`:

```typescript
import {
  createFilesystemProject,
  type ProjectManager,
  type ClaimIndexData,
  type ClaimIndexEntry,
  type ClaimCrossReference,
  type NoteWithContent,
} from 'scepter-core';

export class ClaimIndexCache {
  private projectManager: ProjectManager | null = null;
  // ... existing fields ...

  constructor(
    readonly projectDir: string,
    private outputChannel: vscode.OutputChannel,
  ) {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  async initialize(): Promise<void> {
    try {
      this.projectManager = await createFilesystemProject(this.projectDir);
      await this.projectManager.initialize();
      await this.refresh();
      this.setupFileWatcher();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[ClaimIndex] Initialization failed: ${message}`);
      vscode.window.showWarningMessage(
        `SCEpter: Failed to initialize project. ${message}`
      );
      this.resolveReady();
    }
  }
```

`createFilesystemProject()` handles config loading, storage adapter wiring, and returns a fully-constructed `ProjectManager`. The `initialize()` call loads notes, sets up the type resolver, and optionally starts source code scanning.

### Claim Index Build

§DC.08:derives=A003.§4.AC.01 The claim index MUST be built by reading notes through `NoteManager` and calling `ClaimIndex.build()` directly.

The current `refresh()` method spawns a subprocess. The replacement builds the index in-process, mirroring the logic in `core/src/cli/commands/claims/ensure-index.ts`:

```typescript
async refresh(): Promise<void> {
  if (!this.projectManager) {
    this.outputChannel.appendLine('[ClaimIndex] ProjectManager not initialized');
    this.resolveReady();
    return;
  }

  try {
    this.outputChannel.appendLine(
      `[ClaimIndex] Refreshing index from ${this.projectDir}...`
    );

    const noteManager = this.projectManager.noteManager;
    const result = await noteManager.getNotes({});
    const notes = result.notes;

    // Read content for each note
    const notesWithContent: NoteWithContent[] = await Promise.all(
      notes.map(async (note) => ({
        id: note.id,
        type: note.type,
        filePath: note.filePath || '',
        content:
          (await noteManager.noteFileManager.getFileContents(note.id)) || '',
      })),
    );

    // Build the claim index
    const data = this.projectManager.claimIndex.build(notesWithContent);

    // Incorporate source code references if available
    const scanner = this.projectManager.sourceScanner;
    if (scanner?.isReady()) {
      const allRefs = scanner.getIndex().getAllReferences();
      this.projectManager.claimIndex.addSourceReferences(allRefs);
    }

    // Populate extension-side caches from ClaimIndexData
    this.entries = data.entries;  // Now a Map directly, no conversion needed
    this.crossRefs = data.crossRefs;
    this.rebuildSuffixIndex();
    this.rebuildNoteMap(data);

    this.outputChannel.appendLine(
      `[ClaimIndex] Loaded ${this.entries.size} claims across ${this.noteMap.size} notes`
    );

    this.resolveReady();
    this._onDidRefresh.fire();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.outputChannel.appendLine(`[ClaimIndex] Refresh failed: ${message}`);
    vscode.window.showWarningMessage(`SCEpter: Refresh failed — ${message}`);
    this.resolveReady();
  }
}
```

### Note Map Construction (noteTypes Fix)

§DC.09:derives=A003.§4.AC.01 The note map MUST be built from `ClaimIndexData.noteTypes`, which includes ALL scanned notes regardless of claim count.

The current extension's `noteMap` is incomplete because the CLI's JSON output omits `noteTypes` (audit Issue 2). With direct API access, `data.noteTypes` is a `Map<string, string>` populated by `ClaimIndex.build()` at line 263: `this.data.noteTypes.set(note.id, note.type)` for every scanned note.

```typescript
private rebuildNoteMap(data: ClaimIndexData): void {
  this.noteMap = new Map();

  // First: populate from noteTypes (ALL notes, even those with zero claims)
  for (const [noteId, noteType] of data.noteTypes) {
    const note = this.projectManager!.noteManager.getNote(noteId);
    const filePath = note?.filePath || '';
    this.noteMap.set(noteId, {
      noteId,
      noteType,
      noteFilePath: filePath,
      noteTitle: filePath ? extractNoteTitle(filePath) : noteId,
      claimCount: 0,
    });
  }

  // Second: update with claim counts and fill in any missing file paths
  for (const entry of this.entries.values()) {
    let info = this.noteMap.get(entry.noteId);
    if (!info) {
      info = {
        noteId: entry.noteId,
        noteType: entry.noteType,
        noteFilePath: entry.noteFilePath,
        noteTitle: extractNoteTitle(entry.noteFilePath),
        claimCount: 0,
      };
      this.noteMap.set(entry.noteId, info);
    }
    if (!info.noteFilePath && entry.noteFilePath) {
      info.noteFilePath = entry.noteFilePath;
      info.noteTitle = extractNoteTitle(entry.noteFilePath);
    }
    info.claimCount++;
  }
}
```

This fixes audit Issue 2: notes with zero claims (Task notes, Architecture notes) now appear in the note map with their correct type and file path.

### Suffix Index Rebuild

The suffix index build logic is extracted to a private method for reuse:

```typescript
private rebuildSuffixIndex(): void {
  this.suffixIndex = new Map();
  for (const [fqid, entry] of this.entries) {
    const bareId = `${entry.claimPrefix}.${String(entry.claimNumber).padStart(2, '0')}${entry.claimSubLetter ?? ''}`;
    const existing = this.suffixIndex.get(bareId) ?? [];
    existing.push(fqid);
    this.suffixIndex.set(bareId, existing);

    if (entry.claimId !== bareId) {
      const byClaimId = this.suffixIndex.get(entry.claimId) ?? [];
      byClaimId.push(fqid);
      this.suffixIndex.set(entry.claimId, byClaimId);
    }
  }
}
```

### Trace Method Replacement

§DC.10:derives=A003.§4.AC.01 The `trace()` method MUST use the library's `buildTraceabilityMatrix()` instead of subprocess invocation.

The current `trace()` method in `claim-index.ts` lines 371-392 spawns `scepter claims trace <claimId> --json`. Replace with:

```typescript
import { buildTraceabilityMatrix, type TraceabilityMatrix } from 'scepter-core';

async trace(claimId: string): Promise<TraceResult | null> {
  if (!this.projectManager) return null;

  try {
    const entry = this.entries.get(claimId);
    if (!entry) return null;

    const config = this.projectManager.configManager.getConfig();
    const projectionTypes = config.claims?.projectionTypes ?? [
      'Requirement', 'Specification', 'DetailedDesign', 'TestPlan',
    ];

    const matrix = buildTraceabilityMatrix(
      this.projectManager.claimIndex.getData(),
      projectionTypes,
    );

    const row = matrix.rows.find(r => r.claimId === claimId);
    const incoming = this.incomingRefs(claimId);
    const derivatives = this.findDerivatives(claimId);

    return {
      entry,
      incoming,
      derivatives: derivatives.map(d => d.fullyQualified),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.outputChannel.appendLine(`[ClaimIndex] Trace failed: ${message}`);
    return null;
  }
}
```

The `TraceResult` type is simplified since verification data is now available directly from the verification store rather than parsed from CLI JSON. The `verification` field can be populated by calling `getLatestVerification()` from the claims subsystem.

### Async readClaimContext Fix

§DC.11:derives=A003.§1.AC.02 The `readClaimContext()` method MUST use async file reads instead of `fs.readFileSync`.

The current implementation at `claim-index.ts:253-267` uses synchronous `fs.readFileSync`, blocking the extension host thread. Replace with:

```typescript
async readClaimContext(
  entry: ClaimIndexEntry,
  contextLinesBefore = 1,
  maxLines = 15,
): Promise<string | null> {
  try {
    const absPath = this.resolveFilePath(entry.noteFilePath);
    const content = await fs.promises.readFile(absPath, 'utf-8');
    const lines = content.split('\n');

    const startLine = Math.max(0, entry.line - 1 - contextLinesBefore);
    const endLine = Math.min(
      lines.length,
      (entry.endLine || entry.line) + maxLines - (entry.endLine - entry.line),
    );
    const contextLines = lines.slice(startLine, endLine);

    return contextLines.join('\n');
  } catch {
    return null;
  }
}
```

Callers (hover-provider.ts line 109) must `await` the result. The `ClaimHoverProvider.provideHover()` method is already `async`, so this is a straightforward change.

### extractNoteTitle path.isAbsolute Fix

§DC.12:derives=A003.§1.AC.02 The `path.isAbsolute` no-op at `claim-index.ts:93` MUST be fixed during migration.

Current code:
```typescript
const absPath = path.isAbsolute(filePath) ? filePath : filePath;
```

Fixed:
```typescript
const absPath = path.isAbsolute(filePath)
  ? filePath
  : path.join(this.projectDir, filePath);
```

Since `extractNoteTitle` is a module-level function (not a class method), it needs access to the project directory. After migration, `extractNoteTitle` either receives the project directory as a parameter or uses `ClaimIndexCache.resolveFilePath()` before being called.

### Removed Dependencies

After Step 3, the following imports are removed from `claim-index.ts`:

- `child_process` (`execFile`) -- no more subprocess invocation
- `util` (`promisify`) -- no more `execFileAsync`

The `scepter.scepterPath` configuration setting in `vscode/package.json` (lines 38-42) becomes unused and can be deprecated (not removed, for backwards compatibility).

---

## Step 4: Patterns Migration

### Scope

Replace the six regex patterns in `vscode/src/patterns.ts` with the core library's parser functions. This fixes range reference support, bare note shortcode validation, and eliminates the `markdown-plugin.ts` duplication (audit Issues 4, 7). The extension's `findAllMatches()` and `matchAtPosition()` functions are higher-level wrappers that the core does not provide directly, so they are retained as thin wrappers around core functions.

### Core Parser Functions Available

§DC.13:derives=A003.§1.AC.04 The extension's pattern matching MUST use the core library's `parseClaimReferences()` and `parseNoteMentions()` as the single source of truth for reference detection.

The core library exports:

| Function | Module | Purpose |
|----------|--------|---------|
| `parseClaimReferences(content, options)` | `parsers/claim/claim-parser.ts` | Finds all claim references (braced and braceless) in text |
| `parseClaimAddress(raw, options)` | `parsers/claim/claim-parser.ts` | Parses a single claim address string |
| `parseRangeSuffix(raw)` | `parsers/claim/claim-parser.ts` | Detects range suffix like `-06` in `AC.01-06` |
| `expandClaimRange(raw)` | `parsers/claim/claim-parser.ts` | Expands range into individual addresses |
| `parseNoteMentions(content, options)` | `parsers/note/note-parser.ts` | Finds all note references with modifiers, tags, content |
| `parseNoteId(id)` | `parsers/note/shared-note-utils.ts` | Validates and parses a note ID |
| `isValidNoteId(id)` | `parsers/note/shared-note-utils.ts` | Quick validation check |

### Pattern Replacement Strategy

The extension's `findAllMatches()` serves a different purpose than core's parsers: it returns character-level positions within a single line for VS Code range construction. Core's `parseClaimReferences()` returns line/column positions across an entire document. The extension needs per-line, per-character matching for hover, decoration, and go-to-definition.

§DC.14:derives=A003.§4.AC.03 The extension MUST retain `findAllMatches()` and `matchAtPosition()` as thin wrappers, but implement them using core parser functions instead of independent regex patterns.

The rewritten `patterns.ts` structure:

```typescript
import {
  parseClaimReferences,
  parseNoteMentions,
  parseNoteId,
  isValidNoteId,
  type ClaimReference,
  type ClaimParseOptions,
  type NoteMention,
} from 'scepter-core';

export interface ClaimMatch {
  raw: string;
  start: number;
  end: number;
  normalizedId: string;
  kind: 'claim' | 'note' | 'bare-claim' | 'section';
}

/**
 * Known shortcodes from the project config.
 * Set during initialization when the claim index loads config.
 */
let knownShortcodes: Set<string> | undefined;

export function setKnownShortcodes(shortcodes: Set<string>): void {
  knownShortcodes = shortcodes;
}

export function findAllMatches(
  lineText: string,
  isMarkdown = false,
): ClaimMatch[] {
  const matches: ClaimMatch[] = [];
  const covered = new Set<number>();

  // Use core's parseClaimReferences for claim-level matches
  const claimRefs = parseClaimReferences(lineText, {
    bracelessEnabled: isMarkdown,
    knownShortcodes,
  });

  for (const ref of claimRefs) {
    const col = ref.column - 1; // core uses 1-based columns
    const raw = ref.address.raw;
    const end = col + raw.length + (ref.braced ? 2 : 0); // +2 for braces
    const start = ref.braced ? col - 1 : col; // braced includes the {

    let overlap = false;
    for (let i = start; i < end; i++) {
      if (covered.has(i)) { overlap = true; break; }
    }
    if (overlap) continue;
    for (let i = start; i < end; i++) covered.add(i);

    const normalizedId = raw.replace(/§/g, '').split(':')[0].split(',')[0];

    // Determine kind based on claim structure
    const addr = ref.address;
    let kind: ClaimMatch['kind'];
    if (addr.noteId && addr.claimPrefix) {
      kind = 'claim';
    } else if (addr.noteId && !addr.claimPrefix && !addr.sectionPath) {
      kind = 'note';
    } else if (addr.sectionPath && !addr.claimPrefix && !addr.noteId) {
      kind = 'section';
    } else if (addr.claimPrefix && !addr.noteId) {
      kind = 'bare-claim';
    } else {
      kind = 'claim';
    }

    matches.push({
      raw: ref.braced ? `{${raw}}` : raw,
      start,
      end,
      normalizedId,
      kind,
    });
  }

  // Use core's parseNoteMentions for brace-wrapped note references
  // that parseClaimReferences might not catch (e.g., {D001+ text})
  const noteMentions = parseNoteMentions(lineText, {});
  for (const mention of noteMentions) {
    // Find the mention's position in the line
    const idx = lineText.indexOf(`{${mention.id}`, 0);
    if (idx < 0) continue;

    // Find the closing brace
    let braceEnd = idx + mention.id.length + 1;
    while (braceEnd < lineText.length && lineText[braceEnd] !== '}') braceEnd++;
    if (braceEnd < lineText.length) braceEnd++; // include the }

    let overlap = false;
    for (let i = idx; i < braceEnd; i++) {
      if (covered.has(i)) { overlap = true; break; }
    }
    if (overlap) continue;
    for (let i = idx; i < braceEnd; i++) covered.add(i);

    matches.push({
      raw: lineText.slice(idx, braceEnd),
      start: idx,
      end: braceEnd,
      normalizedId: mention.id,
      kind: 'note',
    });
  }

  return matches;
}

export function matchAtPosition(
  lineText: string,
  charOffset: number,
): ClaimMatch | null {
  const matches = findAllMatches(lineText, true);
  for (const match of matches) {
    if (charOffset >= match.start && charOffset <= match.end) {
      return match;
    }
  }
  return null;
}

export function noteIdFromPath(filePath: string): string | null {
  const basename = filePath.split('/').pop() ?? '';
  const match = basename.match(/^([A-Z]{1,5}\d{3,5})\b/);
  return match ? match[1] : null;
}
```

### What This Fixes

1. **Range references** (audit Issue 7.3): Core's `parseClaimReferences` calls `expandClaimRange()` internally. `{R004.§1.AC.01-06}` now expands to six individual matches.

2. **Bare note shortcode validation** (audit Issue 7.2): Core's parser validates bare note IDs against `knownShortcodes`. Strings like `HTTP200` are no longer falsely highlighted. The extension passes `knownShortcodes` derived from the project config.

3. **markdown-plugin.ts duplication** (audit Issue 4): After this migration, `markdown-plugin.ts` imports `findAllMatches` from `patterns.ts` instead of maintaining duplicate regexes:

```typescript
// markdown-plugin.ts — after migration
import { ClaimIndexCache } from './claim-index';
import { findAllMatches, type ClaimMatch } from './patterns';
```

The `highlightWithData` function is rewritten to use `findAllMatches()`, eliminating the duplicated `scan()` function and all inline regex constants.

### knownShortcodes Initialization

The `knownShortcodes` set is populated during `ClaimIndexCache.initialize()` from the loaded config:

```typescript
// In ClaimIndexCache.initialize(), after ProjectManager is created:
import { setKnownShortcodes } from './patterns';
import { parseNoteId } from 'scepter-core';

const config = this.projectManager.configManager.getConfig();
const shortcodes = new Set<string>();
for (const [_, typeConfig] of Object.entries(config.noteTypes)) {
  shortcodes.add(typeConfig.shortcode);
}
setKnownShortcodes(shortcodes);
```

---

## Step 5: File Watching Migration

### Scope

Replace the hardcoded `_scepter/**/*.md` file watcher with config-driven discovery paths from `ConfigManager`. Fixes audit Issue 1 (notes outside `_scepter/` invisible to watcher).

### Config-Driven Watcher

§DC.15:derives=A003.§4.AC.04 The extension's file watcher MUST use discovery paths from the loaded config instead of the hardcoded `_scepter/**/*.md` glob.

The current watcher at `claim-index.ts:401-406` uses a single hardcoded pattern. The replacement reads `discoveryPaths` from config:

```typescript
private setupFileWatcher(): void {
  if (!this.projectManager) return;

  const config = this.projectManager.configManager.getConfig();
  const discoveryPaths = config.discoveryPaths || ['_scepter'];

  // Create a watcher for each discovery path
  this.fileWatchers = [];
  for (const discoveryPath of discoveryPaths) {
    const pattern = new vscode.RelativePattern(
      this.projectDir,
      `${discoveryPath}/**/*.md`,
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    watcher.onDidChange(this.debouncedRefresh);
    watcher.onDidCreate(this.debouncedRefresh);
    watcher.onDidDelete(this.debouncedRefresh);

    this.fileWatchers.push(watcher);
  }

  // Also watch the config file itself for discovery path changes
  const configPattern = new vscode.RelativePattern(
    this.projectDir,
    '{scepter.config.json,scepter.config.js,_scepter/scepter.config.json}',
  );
  const configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);
  configWatcher.onDidChange(() => {
    // Re-initialize watchers when config changes
    this.disposeWatchers();
    this.setupFileWatcher();
    this.debouncedRefresh();
  });
  this.fileWatchers.push(configWatcher);
}

private debouncedRefresh = (() => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => this.refresh(), 2000);
  };
})();
```

### Watcher Disposal

The `fileWatcher` field changes from singular to plural:

```typescript
private fileWatchers: vscode.FileSystemWatcher[] = [];

private disposeWatchers(): void {
  for (const watcher of this.fileWatchers) {
    watcher.dispose();
  }
  this.fileWatchers = [];
}

dispose(): void {
  this.disposeWatchers();
  if (this.refreshDebounceTimer) {
    clearTimeout(this.refreshDebounceTimer);
  }
  this._onDidRefresh.dispose();
  // Clean up ProjectManager resources
  this.projectManager?.removeAllListeners();
}
```

### Source File Watching

§DC.16:derives=A003.§4.AC.04 The extension SHOULD also watch source code directories when source code integration is enabled.

If `config.sourceCodeIntegration?.enabled` is true, the extension should also watch source directories for changes to `@implements` annotations:

```typescript
if (config.sourceCodeIntegration?.enabled) {
  const srcFolders = config.sourceCodeIntegration.folders || [];
  const srcExtensions = config.sourceCodeIntegration.extensions || ['.ts', '.js'];
  for (const folder of srcFolders) {
    const extGlob = srcExtensions.map(e => `*${e}`).join(',');
    const pattern = new vscode.RelativePattern(
      this.projectDir,
      `${folder}/**/{${extGlob}}`,
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(this.debouncedRefresh);
    watcher.onDidCreate(this.debouncedRefresh);
    watcher.onDidDelete(this.debouncedRefresh);
    this.fileWatchers.push(watcher);
  }
}
```

---

## Projection Coverage

| Projection | Status | Notes |
|-----------|--------|-------|
| Source | Covered by DCs | Code changes described in each step |
| Tests | Not started | Extension has zero tests currently (audit observation). Test plan is a separate artifact. |
| CLI | N/A | This DD is about the VS Code extension, not the CLI |
| UI (Extension) | Covered by DCs | The extension IS the UI; all behavioral changes are specified |
| Documentation | Not started | Extension README update when migration is complete |

---

## Open Questions

1. **vsix bundling.** The `file:../core` dependency works for development but not for distributing a `.vsix` package. A bundler (esbuild or webpack) will be needed to inline the core library into the extension bundle. This is a distribution concern, not a migration blocker.

2. **Incremental index updates.** The current design rebuilds the full claim index on every file change (after debounce). The core library's `ClaimIndex.build()` rebuilds from scratch. A future enhancement could add an `updateNote(noteId)` method to `ClaimIndex` that rebuilds only the affected note's entries. This is a performance optimization, not a migration requirement.

3. **Extension host memory.** Holding a `ProjectManager` in the extension host means the note index, reference graph, and claim index all reside in memory for the extension's lifetime. For typical projects (hundreds of notes, thousands of claims), this is negligible. For very large projects, memory profiling may be needed.

4. **Concurrent refresh.** If two file changes arrive within the debounce window but after a refresh has started, the second refresh should wait for the first to complete. The current one-shot `ready` promise does not handle this. Consider adding a `refreshInProgress` lock.

---

## Verification Plan

### Per-Step Verification

**Step 1 (Types):**
- TypeScript compilation succeeds with imported types
- All extension functionality unchanged (hover, go-to-def, decorations work identically)
- No runtime behavior change (still uses subprocess for data)

**Step 2 (Config):**
- Extension activates for a project with root-level `scepter.config.json`
- Extension activates for a project with `_scepter/scepter.config.json`
- Extension does not activate for a non-SCEpter project

**Step 3 (Claim Index):**
- Index builds successfully without subprocess
- All notes appear in `noteMap` (including zero-claim notes)
- Hover shows correct information for claims and notes
- Go-to-definition navigates to correct file and line
- Decorations render for resolved and unresolved references
- Trace command produces correct output
- Refresh after file edit updates the index correctly
- Error handling: graceful degradation when config is invalid or project directory is inaccessible

**Step 4 (Patterns):**
- Range references `{R004.§1.AC.01-06}` produce six individual hover targets
- Bare note IDs only match known shortcodes (no false positives for `HTTP200`)
- markdown-plugin no longer has duplicated regex patterns
- All existing pattern matching continues to work (braced claims, braced notes, bare FQIDs, section-prefixed, bare claims, section refs)

**Step 5 (File Watching):**
- Changes to notes in non-default discovery paths trigger refresh
- Config file changes re-initialize watchers
- Source file changes trigger refresh when source integration is enabled

### Integration Verification

- Full extension activation/deactivation cycle with no errors
- Memory usage remains stable after repeated refresh cycles
- Extension works in multi-root workspace with multiple SCEpter projects
