---
created: 2026-04-02T02:22:49.577Z
tags: [cli, architecture, unification, ux]
status: draft
---

# DD006 - CLI Unification - Implementation Blueprint

**Architecture:** {A001}
**Created:** 2026-04-01

## §1 Epistemic Review of {A001}

### Binding Analysis

**HIGH BINDING** (must implement first; everything else depends on these):

- **A001.§2.AC.01 (Flatten to Top Level)** — Every command registration in `core/src/cli/index.ts` changes. Both the `contextCommand` group (`commands/context/index.ts`) and the `claimsCommand` group (`commands/claims/index.ts`) are dissolved. Every command import path changes at the CLI entry point. Every test that exercises CLI routing is affected. This is the most invasive single change: it touches the wiring of every command in the system. {A001.§2.AC.01}, {A001.§4.AC.01}, {A001.§4.AC.04} are all MUST-level and constrain the CLI entry point.

- **A001.§2.AC.02 (Backward-Compatible Aliases)** — Depends on §2.AC.01 completing first. The alias mechanism must intercept `scepter ctx <cmd>` and `scepter claims <cmd>` and dispatch to the correct top-level command. The implementation technique (hidden Commander commands with `.passthrough()`, or argv rewriting) determines whether this is a simple registration change or a structural addition. {A001.§2.AC.02}, {A001.§4.AC.03} constrain the backward compatibility layer.

**MEDIUM BINDING** (constrained by the flatten, but have independent design freedom):

- **A001.§2.AC.04 (Unified Search)** — Depends on flattening so that a single `search` command exists at top level. The detection algorithm (claim address vs. note ID vs. text) is a contained piece of logic that only touches `search.ts` and the two existing handler modules (`search-handler.ts` and `claims/search-command.ts`). {A001.§2.AC.04}, {A001.§4.AC.06} define the unification behavior.

- **A001.§2.AC.05 (Unified Trace)** — Depends on flattening so that `trace` is at top level. The xref-sources absorption requires reading `SourceReferenceIndex` data from within `trace-command.ts`, which already has access to `ProjectManager.sourceScanner`. The code path change is contained to trace output extension. {A001.§2.AC.05}, {A001.§4.AC.07} define the unification behavior.

**LOW BINDING** (deletions and cleanup):

- **A001.§2.AC.03 (Remove argv hack)** — Purely subtractive. Lines 48-70 of `index.ts` are deleted after flattening makes them unnecessary.

- **A001.§2.AC.06 (Kill list)** — File deletions. `scaffold-command.ts`, `xref-sources.ts`, `xref-sources-handler.ts`, and the `claims search` command registration are removed. Depends on flattening and unification being complete first.

- **A001.§2.AC.07 (Automatic index)** — The `ensureIndex()` helper already exists and is used by every claim command. The change is to remove the `index` command from CLI registration while keeping the programmatic API. Low risk; mostly registration cleanup.

### Modal Status Distribution

| Category | MUST | SHOULD | MAY |
|----------|------|--------|-----|
| §1 Problem Statement (observations) | 4 (AC.01-AC.04) | 0 | 0 |
| §2 Decisions | 6 (AC.01-AC.06) + 1 MUST/MAY hybrid (AC.07) | 0 | 1 (AC.07 --reindex flag) |
| §4 Implementation Strategy | 10 (AC.01-AC.10) | 0 | 0 |
| §5 Risk Assessment | 4 (AC.01-AC.04) | 0 | 0 |

§1 claims are problem observations, not implementation targets. §5 claims are risk mitigations that constrain how the §2/§4 claims are implemented. The §2 and §4 claims are the primary implementation drivers.

### Inherence Observations

**Inherent to the problem (load-bearing, non-negotiable):**

- Commander.js command registration is declarative: you call `program.addCommand(cmd)` for each command. Flattening means changing WHERE commands are added, not HOW. The command handler code does not change.
- Backward compatibility requires interception of old-style prefixed commands (`ctx`, `claims`). This is inherent to any rename/restructure that wants to preserve existing invocations.
- The citation bisection ({A001.§1.AC.01}) is a data flow problem: `addSourceReferences()` in `claim-index.ts` filters out bare note references at line 529 (`if (!ref.claimPath) continue`). Fixing this requires either (a) changing `addSourceReferences()` to also index bare refs, or (b) having the trace command query the `SourceReferenceIndex` directly for bare refs. Option (b) is cleaner because bare note-level references are conceptually different from claim-level cross-references.

**Contingent (our design choice):**

- Using Commander's `.addCommand()` with `.command()` hidden aliases rather than argv rewriting for backward compatibility. We choose Commander-native mechanisms over argv hacks, since the architecture note explicitly calls for removing the existing argv hack.
- The unified search detection order (claim address first, bare note ID second, text search third). The order matters because of false-positive risk: a search term that happens to match claim address syntax should probably be treated as a claim address. The `--mode` override flag handles edge cases.
- Whether the `index` command is deleted or just hidden. We choose hidden (moved to internal) so that debugging workflows (`scepter claims index --tree`) remain available during development.

### Scope Assessment

All 25 A001 claims must be addressed by this design. §1 claims (AC.01-AC.04) are problem statements that motivate the design but do not themselves require implementation actions; they are resolved by the §2/§4 implementation claims. §5 claims (AC.01-AC.04) are risk mitigations that constrain the implementation approach.

## §2 Specification Scope

### Covered in this design

| Section | ACs | Area |
|---------|-----|------|
| §1 | AC.01-AC.04 | Problem observations (resolved by §2/§4 implementations) |
| §2 | AC.01-AC.07 | Architectural decisions |
| §4 | AC.01-AC.10 | Implementation strategy |
| §5 | AC.01-AC.04 | Risk mitigations |

All 25 ACs covered. No deferrals.

### Deferred

None. All ACs are addressed in this design.

## Current State

The following files and types form the IS-state baseline that this design transforms.

### CLI Entry Point

- **`core/src/cli/index.ts`** — Root Commander program. Imports and registers `contextCommand`, `claimsCommand`, `typesCommand`, `confidenceCommand`, `initCommand`, `scaffoldCommand`, and `createConfigCommand()`. Lines 48-70 implement the argv-splicing hack that detects context subcommand names at top level and injects `ctx` into `process.argv`. The `preAction` hook propagates `--project-dir` to all subcommands.

### Context Command Group

- **`core/src/cli/commands/context/index.ts`** — Creates `contextCommand` as `new Command('context').alias('ctx')`. Registers 12 subcommands: `show`, `list`, `create`, `search`, `gather`, `archive`, `delete`, `restore`, `purge`, `convert`, `xref-sources`, `ingest`.

- **`core/src/cli/commands/context/search.ts`** — The note-content `search` command. Takes a query string, options for title-only, regex, context lines, case sensitivity, type/tag/status filters, format, and archive/delete inclusion. Calls `searchNotes()` from `search-handler.ts`.

- **`core/src/cli/commands/context/search-handler.ts`** — `searchNotes()` function. Builds a regex from the query, queries `noteManager.getNotes()` with search patterns, processes matches with line-level context, optionally searches source files. `formatSearchResults()` renders output in list, detailed, or JSON format.

- **`core/src/cli/commands/context/xref-sources.ts`** — `xrefSourcesCommand`. Takes targets (note IDs, globs, or file paths), options for verbose, JSON, direction, group-by, and common filters. Calls `xrefSources()` handler.

- **`core/src/cli/commands/context/xref-sources-handler.ts`** — Main handler for cross-reference audit. `classifyTarget()` distinguishes note IDs from file paths. `resolveNotes()` and `resolveFiles()` resolve inputs. Builds `XrefEntry[]` from `SourceCodeScanner` data, enriches with note metadata, computes orphan summary. `formatXrefResults()` renders in flat, grouped-by-note, or grouped-by-file format.

### Claims Command Group

- **`core/src/cli/commands/claims/index.ts`** — Creates `claimsCommand` as `new Command('claims')`. Registers 9 subcommands: `index`, `trace`, `gaps`, `lint`, `scaffold`, `verify`, `stale`, `search`, `thread`.

- **`core/src/cli/commands/claims/search-command.ts`** — `scepter claims search`. Builds claim index, then calls `searchClaims()` with text query, metadata filters (types, note, importance, lifecycle), derivation filters, and format options. Implements {R007.§5.AC.01-05}.

- **`core/src/cli/commands/claims/trace-command.ts`** — `scepter claims trace`. Handles three modes: multi-claim/range input, single-claim trace, and note-level traceability matrix. Supports `--importance`, `--sort`, `--width`, `--full`, `--no-excerpts`, `--show-derived`, `--json`. Implements {R004.§6.AC.04}, {R005} and {R006} claim traceability display, and {DD005} multi-claim references.

- **`core/src/cli/commands/claims/scaffold-command.ts`** — `scepter claims scaffold`. Generates placeholder heading structure in a note. No consumers in documentation or codebase beyond its own registration.

- **`core/src/cli/commands/claims/ensure-index.ts`** — `ensureIndex(projectManager)`. Reads all notes, calls `ClaimIndex.build()`, then calls `addSourceReferences()` with scanner data if available. Returns `ClaimIndexData`. Used by every claim-dependent command.

- **`core/src/cli/commands/claims/index-command.ts`** — `scepter claims index`. Builds index and displays statistics, optionally with `--tree` for per-note claim trees.

### Key Data Flow: Citation Bisection

The citation bisection ({A001.§1.AC.01}) originates from `addSourceReferences()` in `claim-index.ts` (line 529):

```
for (const ref of refs) {
  if (!ref.claimPath) continue;  // <-- bare {D001} refs are skipped
  ...
}
```

A source file containing `@implements {R005.§3.AC.01}` creates a `SourceReference` with `claimPath: '.§3.AC.01'` and gets indexed as a claim cross-reference. But a source file containing just `{D001}` (bare note mention) creates a `SourceReference` with `claimPath: undefined` and is skipped. This bare reference is only visible through `xref-sources`, which queries `SourceCodeScanner.getReferencesToNote()` directly.

## §3 Module Inventory

### MODIFY: `core/src/cli/index.ts` — Flatten Command Registration

§DC.01:derives=A001.§2.AC.01 Remove `contextCommand` and `claimsCommand` group imports. Import each command individually from its source module.

§DC.02:derives=A001.§2.AC.01 Register all former context subcommands directly on `program`: `showCommand`, `listCommand`, `createCommand`, `searchCommand` (unified), `gatherCommand`, `archiveCommand`, `deleteCommand`, `restoreCommand`, `purgeCommand`, `convertCommand`, `ingestCommand`.

§DC.03:derives=A001.§2.AC.01 Register all former claims subcommands directly on `program`: `traceCommand`, `gapsCommand`, `lintCommand`, `verifyCommand`, `staleCommand`, `threadCommand`.

§DC.04:derives=A001.§2.AC.03 Delete lines 48-70 (the argv-splicing hack). With commands at top level, the `contextSubNames` detection and `process.argv.splice()` injection are dead code.

§DC.05:derives=A001.§2.AC.02 Register hidden `context` command (alias `ctx`) that uses Commander's `.passThroughOptions()` and `.allowUnknownOption()` to capture remaining args and dispatch to the matching top-level command programmatically. Implementation: the `context` hidden command's action parses its remaining arguments, finds the matching top-level command by name, and calls `program.parse(['node', 'scepter', ...remainingArgs])`. Alternatively, uses a simpler approach: register `context` as a hidden command with `.argument('<subcommand>')` and `.argument('[args...]')` that calls `program.parseAsync(['node', 'scepter', subcommand, ...args], { from: 'user' })`.

§DC.06:derives=A001.§2.AC.02 Register hidden `claims` command that forwards in the same manner as `context`. This handles `scepter claims trace R005` forwarding to `scepter trace R005`.

§DC.07:derives=A001.§2.AC.02 Register hidden `notes` alias that forwards identically to `context`, per the architecture note's specification that `notes` is also aliased.

§DC.08:derives=A001.§5.AC.01 Each hidden alias command SHOULD emit a deprecation notice to stderr: `"Note: 'scepter ctx <cmd>' is deprecated. Use 'scepter <cmd>' directly."` The notice is conditional on a `SCEPTER_DEPRECATION_WARNINGS` environment variable (default: enabled) so CI pipelines can suppress it.

§DC.09:derives=A001.§5.AC.02 Use Commander's `.addHelpText('after', ...)` on the root program to inject section headers into `--help` output. Group commands into four visual sections matching {A001.§3}: "Note CRUD", "Connection Understanding", "Quality and Hygiene", "Configuration". Implementation: override `program.configureHelp()` to use a custom `formatHelp()` that sorts commands into predefined groups by command name.

§DC.10:derives=A001.§2.AC.06 Remove `scaffoldCommand` import and registration from `index.ts`.

§DC.11:derives=A001.§2.AC.06 Remove `indexCommand` from CLI registration (the underlying `ClaimIndex.build()` and `ensureIndex()` remain available programmatically).

§DC.12:derives=A001.§2.AC.07 The existing `ensureIndex()` helper in `ensure-index.ts` already provides lazy initialization. No structural change is needed; claim-dependent commands already call `ensureIndex()` at the top of their action handlers. The only change is removing the explicit `index` command from registration.

§DC.13:derives=A001.§4.AC.10 Add a `--reindex` flag to `ensureIndex()`. When the flag is present, `ensureIndex()` forces `ClaimIndex.build()` even if a cached result exists. Thread this flag through all claim-dependent commands (`trace`, `gaps`, `lint`, `verify`, `stale`, `thread`, `search`). Implementation: add `reindex?: boolean` to the options interface on each command, and pass it to `ensureIndex()`. In `ensureIndex()`, check a module-level `cachedData` variable; if it exists and `reindex` is not true, return the cached result.

### MODIFY: `core/src/cli/commands/context/search.ts` — Unified Search

§DC.14:derives=A001.§2.AC.04 Rewrite the `search` command to implement the unified detection algorithm. The command accepts a positional `<query>` argument and a new `--mode <auto|note|claim>` option (default: `auto`).

§DC.15:derives=A001.§2.AC.04 Implement the detection algorithm in `auto` mode:

1. Call `parseClaimAddress(query)` from `parsers/claim/claim-parser.ts`.
2. If it returns a non-null result with a `claimPrefix` field: treat as claim address. Call `ensureIndex()` and look up the claim in the index. If found, display claim detail with traceability (reuse `formatClaimTrace()` from `claim-formatter.ts`). If not found, fall through to text search with a hint.
3. If the query matches the bare note ID pattern `/^[A-Z]{1,5}\d{3,5}$/`: treat as note ID. Show the note with its claim summary (reuse `show` command logic or delegate to `showCommand`).
4. Otherwise: perform full-text note content search (existing `searchNotes()` behavior).

§DC.16:derives=A001.§5.AC.03 When the detection algorithm identifies the query as a claim address in `auto` mode, include a hint in the output: `"Detected as claim address. Use --mode note for text search."` This covers the false-positive scenario described in {A001.§5.AC.03}.

§DC.17:derives=A001.§2.AC.04 Absorb `claims search` metadata filter options into the unified search command. When `--mode claim` is explicitly set, or when `auto` mode detects a claim address, the following options become active: `--types`, `--note`, `--importance`, `--lifecycle`, `--derives-from`, `--derivatives-of`, `--has-derivation`, `--id-only`, `--regex` (for claim text matching). These are forwarded to `searchClaims()` from `claims/claim-search.ts`.

§DC.18:derives=A001.§2.AC.04 When `--mode note` is explicitly set, the query is always treated as text search regardless of whether it looks like a claim address. This is the escape hatch for searching literal claim address text in note content.

### MODIFY: `core/src/cli/commands/claims/trace-command.ts` — Unified Trace

§DC.19:derives=A001.§2.AC.05 After the existing traceability matrix output (note-level trace mode), query `SourceCodeScanner` for all `SourceReference` objects targeting the given note ID where `claimPath` is undefined or empty. These are the bare note-level references invisible to the claim index.

§DC.20:derives=A001.§2.AC.05 Format bare note-level source references as a new section after the claim matrix: "Source References (note-level)". Display as a table: file path (relative to project root), line number, reference type (`@implements`, `@depends-on`, `@see`, `mentions`), and optional context snippet. Sort by file path then line number.

§DC.21:derives=A001.§5.AC.04 When the number of bare note-level references exceeds a threshold (10), display only a summary count and file list by default. Show full detail only when `--verbose` is passed. When the count is at or below the threshold, show full detail regardless of `--verbose`.

§DC.22:derives=A001.§2.AC.05 In JSON output mode, include the bare note-level references in a `sourceReferences` field alongside the existing `rows` and `projectionTypes` fields. Each entry includes `filePath`, `line`, `referenceType`, and `context`.

§DC.23:derives=A001.§2.AC.05 In single-claim trace mode, the note-level source reference section is not shown (it is a note-level concept, not a claim-level concept). Single-claim trace continues to show only claim-level cross-references.

### DELETE: Files Removed

§DC.24:derives=A001.§2.AC.06 Delete `core/src/cli/commands/claims/scaffold-command.ts`. No consumers exist in the codebase, documentation, or skill prompts.

§DC.25:derives=A001.§2.AC.06 Delete `core/src/cli/commands/context/xref-sources.ts`. Functionality absorbed into unified trace ({DC.19}-{DC.22}).

§DC.26:derives=A001.§2.AC.06 Delete `core/src/cli/commands/context/xref-sources-handler.ts`. The `xrefSources()`, `formatXrefResults()`, `classifyTarget()`, and `writeXrefOutput()` functions are no longer needed. The subset of functionality needed by the unified trace (querying bare note-level refs) is simpler and implemented directly in `trace-command.ts`.

§DC.27:derives=A001.§2.AC.06 Remove `searchCommand` export and registration from `core/src/cli/commands/claims/index.ts` (the claims group file, which itself is being dissolved). The `search-command.ts` file in the claims directory is retained as the implementation backing the unified search's claim mode, but it is no longer registered as a standalone command.

### MODIFY: `core/src/cli/commands/context/index.ts` — Dissolve

§DC.28:derives=A001.§2.AC.01 This file is either deleted entirely or retained as a re-export barrel for individual commands. If deleted, all imports in `index.ts` change to import directly from each command file. If retained as a barrel, it exports individual commands without creating a `contextCommand` group. Decision: delete the file. Each command is imported directly from its own module in `core/src/cli/index.ts`. This is cleaner and eliminates the group object entirely.

### MODIFY: `core/src/cli/commands/claims/index.ts` — Dissolve

§DC.29:derives=A001.§2.AC.01 Same treatment as the context group. Delete the file. Each claims command is imported directly from its own module. The `claimsCommand` group object is eliminated.

## §4 Unified Search Detection Algorithm

The core of {A001.§2.AC.04} is the detection algorithm that determines how to interpret a search query. The algorithm runs in `auto` mode (the default); explicit `--mode note` or `--mode claim` bypasses it.

### Algorithm Pseudocode

```
function detectSearchMode(query: string): 'claim-address' | 'bare-note-id' | 'text-search'
  // Step 1: Try claim address parsing
  addr = parseClaimAddress(query)
  if addr !== null AND addr.claimPrefix is defined:
    return 'claim-address'

  // Step 2: Try bare note ID pattern
  if query matches /^[A-Z]{1,5}\d{3,5}$/i:
    return 'bare-note-id'

  // Step 3: Fallback to text search
  return 'text-search'
```

### Detection Examples

| Query | Step 1 result | Step 2 result | Mode |
|-------|--------------|---------------|------|
| `R005.§1.AC.01` | `{noteId:"R005", sectionPath:[1], claimPrefix:"AC", claimNumber:1}` | n/a | claim-address |
| `R005.1.AC.01` | `{noteId:"R005", sectionPath:[1], claimPrefix:"AC", claimNumber:1}` | n/a | claim-address |
| `AC.01` | `{claimPrefix:"AC", claimNumber:1}` | n/a | claim-address |
| `R005` | null (no claim prefix) | matches `/^[A-Z]{1,5}\d{3,5}$/` | bare-note-id |
| `DD003` | null | matches pattern | bare-note-id |
| `auth` | null | no match | text-search |
| `authentication flow` | null | no match | text-search |
| `derives=R005` | null | no match | text-search |

### Edge Case: Partial Matches

The `parseClaimAddress()` function returns null when the input lacks a claim prefix (e.g., `R005.§1` parses as a section reference, not a claim address, because `claimPrefix` is undefined). This means section references fall through to text search, which is the correct behavior -- users searching for `R005.§1` are looking for that text in notes.

### Claim Address Not Found in Index

When the detection algorithm identifies the query as a claim address, but the claim does not exist in the index:
1. Report "Claim not found: {query}" with fuzzy suggestions (reuse existing fuzzy match logic from `trace-command.ts`).
2. Do NOT fall through to text search automatically. The user explicitly typed what looks like a claim address; silently doing text search would be confusing.
3. Include a hint: "Use --mode note to search note content instead."

## §5 Trace Unification: Code Path Changes

### Current Data Flow (Before)

```
scepter claims trace R005:
  ensureIndex() -> ClaimIndex.build() + addSourceReferences()
  buildTraceabilityMatrix("R005", data) -> matrix with claim rows
  formatTraceabilityMatrix(matrix, ...) -> output

scepter xref-sources R005:
  sourceScanner.getReferencesToNote("R005") -> SourceReference[]
  xrefSources() classifies, resolves, enriches, formats
```

Two separate commands. Two separate code paths. A user asking "what references R005?" gets half the answer from each.

### Target Data Flow (After)

```
scepter trace R005:
  ensureIndex() -> ClaimIndex.build() + addSourceReferences()
  buildTraceabilityMatrix("R005", data) -> matrix with claim rows
  formatTraceabilityMatrix(matrix, ...) -> claim matrix output

  // NEW: bare note-level source references
  sourceScanner = context.projectManager.sourceScanner
  if sourceScanner is available:
    allRefs = sourceScanner.getReferencesToNote(noteId)
    bareRefs = allRefs.filter(ref => !ref.claimPath)
    if bareRefs.length > 0:
      formatNoteSourceReferences(bareRefs, projectPath, options)
      -> appended to output
```

### Specific Code Changes in `trace-command.ts`

In the note-level trace branch (after line 372 in the current code, after `formatTraceabilityMatrix()` is called and printed):

1. Check if `context.projectManager.sourceScanner` is available and ready.
2. Call `sourceScanner.getReferencesToNote(id)` to get all source references to the note.
3. Filter to references where `ref.claimPath` is undefined or empty — these are the bare note-level references that `addSourceReferences()` skips.
4. If any bare references exist, format and append a "Source References (note-level)" section.
5. Apply the verbose/summary threshold from {DC.21}.

### Data Available from SourceReference

Each `SourceReference` (from `types/reference.ts`) provides:
- `filePath: string` — absolute path to the source file
- `line?: number` — line number
- `referenceType: SourceReferenceType` — `'implements'`, `'depends-on'`, `'addresses'`, `'validates'`, `'blocked-by'`, `'see'`, or `'mentions'`
- `context?: string` — surrounding code context
- `toId: string` — the note ID being referenced
- `claimPath?: string` — the claim-level suffix (undefined for bare refs)

For bare refs, `claimPath` is undefined. The `referenceType` is typically `'mentions'` (for `{D001}` in a comment) but could be `'implements'` or others if the annotation targets the note without a claim path (e.g., `@implements {D001}` without a claim suffix).

### Formatting the Note-Level Section

```
Source References (note-level): 3 references across 2 files

  core/src/cli/index.ts:42        @implements
  core/src/cli/index.ts:43        @implements
  core/src/claims/claim-index.ts:8  mentions
```

When `--verbose` is passed or count <= 10: show full detail with context snippets.
When count > 10 and not verbose: show summary with file list only.

```
Source References (note-level): 47 references across 12 files
  (use --verbose to see full detail)

  Files: core/src/cli/index.ts (5), core/src/claims/claim-index.ts (3), ...
```

### JSON Output Extension

In the existing JSON serialization for note-level trace (around line 345-358 in the current code), add:

```typescript
const serializable = {
  ...matrix,
  rows: matrix.rows.map(/* existing */),
  // NEW
  sourceReferences: bareRefs.map(ref => ({
    filePath: path.relative(context.projectPath, ref.filePath),
    line: ref.line ?? 0,
    referenceType: ref.referenceType,
    context: ref.context,
  })),
};
```

## §6 Backward-Compatible Alias Mechanism

### Approach: Hidden Commander Commands

Commander.js supports hidden commands (commands that work but don't appear in `--help`). The alias mechanism registers three hidden commands: `context` (alias `ctx`), `claims`, and `notes`.

### Implementation Detail

Each hidden alias command:
1. Is registered with `.command('context').alias('ctx').hidden()`.
2. Uses `.allowUnknownOption()` and `.allowExcessArguments()` to accept any arguments.
3. Captures the subcommand name and remaining arguments.
4. Programmatically dispatches by calling `program.parseAsync()` with the subcommand promoted to top level.

```typescript
// Pseudocode for the backward-compat alias
const ctxAlias = program
  .command('context')
  .alias('ctx')
  .hidden()
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (options, command) => {
    const args = command.args;  // ['create', 'Decision', 'Title']
    if (args.length === 0) {
      console.error('Usage: scepter <command> [options]');
      process.exit(1);
    }
    // Emit deprecation notice
    if (process.env.SCEPTER_NO_DEPRECATION_WARNINGS !== '1') {
      process.stderr.write(
        `Note: 'scepter ctx ${args[0]}' is deprecated. Use 'scepter ${args[0]}' directly.\n`
      );
    }
    // Re-dispatch to the top-level command
    await program.parseAsync(
      ['node', 'scepter', ...args],
      { from: 'user' }
    );
  });
```

### Why Not argv Rewriting

The architecture note ({A001.§2.AC.03}) explicitly requires removing the argv-splicing hack. The alias mechanism must NOT rewrite `process.argv`. Commander's command dispatch is the correct mechanism: it keeps the routing visible in the command tree rather than hidden in pre-parse manipulation.

### `--project-dir` Propagation

The existing `preAction` hook propagates `--project-dir` from the root program to all subcommands. When the hidden alias re-dispatches via `parseAsync()`, the `--project-dir` option must be preserved. The alias command extracts `--project-dir` from its own options before forwarding remaining arguments. Alternatively, since `parseAsync()` re-parses from the root program, the hook fires again naturally on the forwarded parse.

Testing required: verify that `scepter --project-dir /foo ctx show R001` correctly propagates `/foo` through the alias dispatch to the top-level `show` command.

## §7 Help Output Grouping Strategy

### Problem

With approximately 20 top-level commands, `scepter --help` becomes a flat list that's harder to scan than the current grouped output. {A001.§5.AC.02} requires organizing help into sections.

### Solution: Custom Help Formatter

Commander.js allows overriding the help formatter via `program.configureHelp()`. The custom formatter groups commands into predefined categories:

```typescript
const COMMAND_GROUPS: Record<string, string[]> = {
  'Note CRUD': ['create', 'show', 'list', 'search', 'delete', 'archive', 'restore', 'purge', 'convert', 'ingest'],
  'Connection Understanding': ['trace', 'thread', 'gather', 'gaps'],
  'Quality and Hygiene': ['lint', 'verify', 'stale'],
  'Configuration': ['types', 'confidence', 'config', 'init'],
};
```

### Help Output Format

```
Usage: scepter [options] [command]

SCEpter: Software Composition Environment CLI

Options:
  --project-dir <path>  Project directory to run in (default: cwd)
  -V, --version         output the version number
  -h, --help            display help for command

Note CRUD:
  create              Create a new note
  show                Show notes by ID or analyze source files
  list                List and filter notes
  search              Search notes and claims
  delete              Delete notes
  archive             Archive notes
  restore             Restore archived/deleted notes
  purge               Permanently delete from _deleted
  convert             Convert between file/folder formats
  ingest              Import files as notes

Connection Understanding:
  trace               Traceability matrix with source references
  thread              Relationship tree for a claim or note
  gather              Gather related context for a note
  gaps                Report claims with partial coverage

Quality and Hygiene:
  lint                Validate claim structure in a note
  verify              Record verification event for a claim/note
  stale               Report stale claims based on source changes

Configuration:
  types               Manage note types
  confidence          File-level confidence annotations
  config              Display configuration
  init                Initialize project
```

### Implementation

Override `configureHelp()` on the root program:

```typescript
program.configureHelp({
  formatHelp(cmd, helper) {
    // Use Commander's default formatting for usage, description, options
    // Override only the commands section to inject group headers
    // Hidden commands (context, claims, notes) are excluded automatically
    // Scaffold and index commands are not registered, so they don't appear
  }
});
```

The `formatHelp` override:
1. Calls `helper.formatUsage()` and `helper.formatDescription()` as normal.
2. Collects visible commands from `cmd.commands.filter(c => !c._hidden)`.
3. Groups them by name lookup in `COMMAND_GROUPS`.
4. Renders each group with a section header.
5. Any ungrouped commands go into an "Other" section (safety net for future additions).

## §8 Integration Sequence

This section defines the implementation order. Each phase is independently testable and leaves the CLI in a working state. Tests must pass after each phase.

### Phase 1: Register Context Commands at Top Level (Additive)

**Files:**
- `core/src/cli/index.ts` (MODIFY)

**Changes:**
- Add direct imports for all context commands: `showCommand`, `listCommand`, `createCommand`, `searchCommand`, `gatherCommand`, `archiveCommand`, `deleteCommand`, `restoreCommand`, `purgeCommand`, `convertCommand`, `ingestCommand`.
- Register each on `program` with `program.addCommand(...)`.
- Keep the `contextCommand` group registration AND the argv-splicing hack in place. Both old and new paths work simultaneously.

**Verify:**
- `scepter show R001` works (via top-level registration).
- `scepter ctx show R001` works (via group registration, then via alias once Phase 3 completes).
- `scepter --help` shows both the group and the top-level commands (temporarily messy, cleaned up in Phase 3).
- All existing tests pass.

**Spec:** {A001.§4.AC.01}

### Phase 2: Register Claims Commands at Top Level (Additive)

**Files:**
- `core/src/cli/index.ts` (MODIFY)

**Changes:**
- Add direct imports for claims commands: `traceCommand`, `gapsCommand`, `lintCommand`, `verifyCommand`, `staleCommand`, `threadCommand`.
- Register each on `program`. Do NOT register `scaffoldCommand`, `indexCommand`, or claims `searchCommand` (they are being removed or absorbed).
- Keep the `claimsCommand` group registration in place temporarily.

**Verify:**
- `scepter trace R005` works (via top-level).
- `scepter claims trace R005` still works (via group).
- `scepter lint DD003` works.
- All existing tests pass.

**Spec:** {A001.§4.AC.04}

### Phase 3: Add Backward-Compatible Aliases and Remove Groups

**Files:**
- `core/src/cli/index.ts` (MODIFY)

**Changes:**
- Remove `contextCommand` import and registration.
- Remove `claimsCommand` import and registration.
- Delete lines 48-70 (argv-splicing hack).
- Register hidden `context`/`ctx` alias command.
- Register hidden `claims` alias command.
- Register hidden `notes` alias command.

**Verify:**
- `scepter create Decision "Test"` works (top-level).
- `scepter ctx create Decision "Test"` works (alias dispatch, deprecation notice emitted).
- `scepter claims trace R005` works (alias dispatch).
- `scepter --help` shows only top-level commands, no groups.
- The argv-splicing hack code is gone.
- All existing tests pass.

**Spec:** {A001.§2.AC.02}, {A001.§2.AC.03}, {A001.§4.AC.02}, {A001.§4.AC.03}

### Phase 4: Help Output Grouping

**Files:**
- `core/src/cli/index.ts` (MODIFY)

**Changes:**
- Add `COMMAND_GROUPS` constant.
- Override `program.configureHelp()` with custom `formatHelp`.

**Verify:**
- `scepter --help` shows grouped output with section headers.
- Hidden alias commands (`context`, `claims`, `notes`) do not appear in help.
- All existing tests pass.

**Spec:** {A001.§5.AC.02}

### Phase 5: Unified Search

**Files:**
- `core/src/cli/commands/context/search.ts` (MODIFY — major rewrite)
- `core/src/cli/commands/claims/search-command.ts` (retained as implementation, deregistered as standalone command)

**Changes:**
- Rewrite `search.ts` to implement the unified detection algorithm ({DC.14}-{DC.18}).
- Add `--mode <auto|note|claim>` option.
- Add claim metadata filter options (forwarded to `searchClaims()` when in claim mode).
- Import `parseClaimAddress` from claim parser and `ensureIndex`/`searchClaims` from claims modules.

**Verify:**
- `scepter search "auth"` performs text search (auto mode, text detection).
- `scepter search "R005.§1.AC.01"` shows claim detail (auto mode, claim detection).
- `scepter search "R005"` shows note and claim summary (auto mode, bare note detection).
- `scepter search --mode note "R005.§1.AC.01"` performs text search for that literal string.
- `scepter search --mode claim --types R --importance 3` performs filtered claim search.
- `scepter claims search "auth"` still works (alias dispatch to top-level search in claim mode).
- All existing tests pass.

**Spec:** {A001.§2.AC.04}, {A001.§4.AC.06}, {A001.§5.AC.03}

### Phase 6: Unified Trace

**Files:**
- `core/src/cli/commands/claims/trace-command.ts` (MODIFY)

**Changes:**
- In the note-level trace branch, after printing the claim matrix:
  - Query `sourceScanner.getReferencesToNote(id)`.
  - Filter to bare refs (`!ref.claimPath`).
  - Format and print the "Source References (note-level)" section.
  - Apply verbose/summary threshold.
- Extend JSON output with `sourceReferences` field.
- Add `--verbose` option to trace command (if not already present).

**Verify:**
- `scepter trace R005` shows the claim matrix PLUS a "Source References (note-level)" section if bare refs exist.
- `scepter trace R005 --json` includes `sourceReferences` array.
- `scepter trace R005 --verbose` shows full detail for note-level refs even when count > 10.
- Single-claim trace (`scepter trace R005.§1.AC.01`) does NOT show note-level section.
- Notes with no bare source refs show no extra section.
- All existing tests pass.

**Spec:** {A001.§2.AC.05}, {A001.§4.AC.07}, {A001.§5.AC.04}

### Phase 7: Delete Dead Code

**Files:**
- `core/src/cli/commands/claims/scaffold-command.ts` (DELETE)
- `core/src/cli/commands/context/xref-sources.ts` (DELETE)
- `core/src/cli/commands/context/xref-sources-handler.ts` (DELETE)
- `core/src/cli/commands/context/index.ts` (DELETE)
- `core/src/cli/commands/claims/index.ts` (DELETE)
- `core/src/cli/commands/claims/index-command.ts` (HIDE or DELETE)

**Changes:**
- Delete the files listed above.
- Verify no remaining imports reference the deleted files.
- Remove any test files that test the deleted commands in isolation (xref-sources tests, scaffold tests, if any).

**Verify:**
- `pnpm tsc` passes with no import errors.
- `scepter --help` shows clean grouped output.
- All remaining tests pass.
- `scepter scaffold` is not recognized (correct).
- `scepter xref-sources` is not recognized (correct).
- `scepter claims search` dispatches through alias to unified search.

**Spec:** {A001.§2.AC.06}, {A001.§4.AC.05}, {A001.§4.AC.08}

### Phase 8: Index Auto-Build and --reindex

**Files:**
- `core/src/cli/commands/claims/ensure-index.ts` (MODIFY)
- All claim-dependent command files (MODIFY — add `--reindex` option)

**Changes:**
- Add module-level caching to `ensureIndex()`: store the result of the first build and return it on subsequent calls within the same process.
- Add `reindex?: boolean` parameter. When true, bypass the cache.
- Add `--reindex` option to `trace`, `gaps`, `lint`, `verify`, `stale`, `thread`, `search`.

**Verify:**
- Claim commands work without explicit `scepter index` step.
- `scepter trace R005 --reindex` forces a fresh build.
- Multiple claim commands in sequence reuse the cached index.
- All existing tests pass.

**Spec:** {A001.§2.AC.07}, {A001.§4.AC.09}, {A001.§4.AC.10}

## §9 Wiring Map

```
BEFORE:
  index.ts
    ├── contextCommand (group)       commands/context/index.ts
    │     ├── show                    commands/context/show.ts
    │     ├── list                    commands/context/list.ts
    │     ├── create                  commands/context/create.ts
    │     ├── search                  commands/context/search.ts
    │     ├── gather                  commands/context/gather.ts
    │     ├── archive                 commands/context/archive.ts
    │     ├── delete                  commands/context/delete.ts
    │     ├── restore                 commands/context/restore.ts
    │     ├── purge                   commands/context/purge.ts
    │     ├── convert                 commands/context/convert.ts
    │     ├── xref-sources            commands/context/xref-sources.ts
    │     └── ingest                  commands/context/ingest.ts
    ├── claimsCommand (group)        commands/claims/index.ts
    │     ├── index                   commands/claims/index-command.ts
    │     ├── trace                   commands/claims/trace-command.ts
    │     ├── gaps                    commands/claims/gaps-command.ts
    │     ├── lint                    commands/claims/lint-command.ts
    │     ├── scaffold                commands/claims/scaffold-command.ts
    │     ├── verify                  commands/claims/verify-command.ts
    │     ├── stale                   commands/claims/stale-command.ts
    │     ├── search                  commands/claims/search-command.ts
    │     └── thread                  commands/claims/thread-command.ts
    ├── typesCommand (group)         commands/types/index.ts
    ├── confidenceCommand (group)    commands/confidence/index.ts
    ├── initCommand                  commands/init.ts
    ├── scaffoldCommand              commands/scaffold.ts
    └── configCommand                commands/config.ts

AFTER:
  index.ts
    ├── create                        commands/context/create.ts (direct)
    ├── show                          commands/context/show.ts (direct)
    ├── list                          commands/context/list.ts (direct)
    ├── search (unified)              commands/context/search.ts (rewritten)
    ├── gather                        commands/context/gather.ts (direct)
    ├── archive                       commands/context/archive.ts (direct)
    ├── delete                        commands/context/delete.ts (direct)
    ├── restore                       commands/context/restore.ts (direct)
    ├── purge                         commands/context/purge.ts (direct)
    ├── convert                       commands/context/convert.ts (direct)
    ├── ingest                        commands/context/ingest.ts (direct)
    ├── trace (unified)               commands/claims/trace-command.ts (extended)
    ├── gaps                          commands/claims/gaps-command.ts (direct)
    ├── lint                          commands/claims/lint-command.ts (direct)
    ├── verify                        commands/claims/verify-command.ts (direct)
    ├── stale                         commands/claims/stale-command.ts (direct)
    ├── thread                        commands/claims/thread-command.ts (direct)
    ├── typesCommand (group)          commands/types/index.ts (unchanged)
    ├── confidenceCommand (group)     commands/confidence/index.ts (unchanged)
    ├── initCommand                   commands/init.ts (unchanged)
    ├── configCommand                 commands/config.ts (unchanged)
    ├── context/ctx (hidden alias)    inline in index.ts
    ├── claims (hidden alias)         inline in index.ts
    └── notes (hidden alias)          inline in index.ts

DELETED:
    commands/context/index.ts         (group file)
    commands/context/xref-sources.ts  (absorbed into trace)
    commands/context/xref-sources-handler.ts
    commands/claims/index.ts          (group file)
    commands/claims/scaffold-command.ts
    commands/claims/index-command.ts   (hidden/removed)
    commands/scaffold.ts              (if this was the claims scaffold)
```

### Import Chain for Unified Search

```
index.ts
  → import { searchCommand } from './commands/context/search.ts'

search.ts (unified)
  → import { parseClaimAddress } from '../../parsers/claim/claim-parser.ts'
  → import { ensureIndex } from '../claims/ensure-index.ts'
  → import { searchClaims } from '../../../claims/claim-search.ts'
  → import { searchNotes, formatSearchResults } from './search-handler.ts'
  → import { formatClaimTrace } from '../../formatters/claim-formatter.ts'
  → import { formatSearchResults as formatClaimSearchResults } from '../../formatters/claim-formatter.ts'
```

### Import Chain for Unified Trace

```
trace-command.ts (extended)
  → import { SourceCodeScanner } from '../../../scanners/source-code-scanner.ts'  // via projectManager
  → existing imports unchanged
  → NEW: formatting function for bare note-level refs (inline or small helper)
```

## §10 Data Flow

### Flow 1: Unified Search — Claim Address Detection

1. User types `scepter search "R005.§1.AC.01"`.
2. `search.ts` action handler receives query `"R005.§1.AC.01"`, mode `auto`.
3. `detectSearchMode("R005.§1.AC.01")` calls `parseClaimAddress("R005.§1.AC.01")`.
4. Parser returns `{noteId:"R005", sectionPath:[1], claimPrefix:"AC", claimNumber:1}` — non-null with `claimPrefix` defined.
5. Detection returns `'claim-address'`.
6. Handler calls `ensureIndex(projectManager)` to build claim index.
7. Normalizes to `"R005.1.AC.01"` and looks up in `data.entries`.
8. If found: calls `formatClaimTrace(entry, incoming, noteTypes, ...)` and prints result.
9. Appends hint: "Detected as claim address. Use --mode note for text search."

### Flow 2: Unified Search — Bare Note ID Detection

1. User types `scepter search R005`.
2. `detectSearchMode("R005")` — `parseClaimAddress("R005")` returns null (no claim prefix).
3. `"R005"` matches `/^[A-Z]{1,5}\d{3,5}$/` — detection returns `'bare-note-id'`.
4. Handler calls `noteManager.getNoteById("R005")`.
5. If found: displays note summary with its claim list (via `ensureIndex()` and `getClaimsForNote()`).
6. If not found: "Note R005 not found."

### Flow 3: Unified Search — Text Search (default)

1. User types `scepter search "authentication flow"`.
2. `detectSearchMode(...)` — not a claim address, not a note ID pattern.
3. Returns `'text-search'`.
4. Handler calls existing `searchNotes("authentication flow", options)`.
5. Output formatted as before.

### Flow 4: Unified Trace — Bare Note-Level References

1. User types `scepter trace A001`.
2. `trace-command.ts` action handler: note-level trace branch.
3. Existing flow: `ensureIndex()`, `buildTraceabilityMatrix("A001", data)`, `formatTraceabilityMatrix()`.
4. Output: claim matrix printed to console.
5. NEW: `sourceScanner = context.projectManager.sourceScanner`.
6. `allRefs = sourceScanner.getReferencesToNote("A001")`.
7. `bareRefs = allRefs.filter(ref => !ref.claimPath)` — references like `{A001}` in source comments.
8. If `bareRefs.length > 0` and `bareRefs.length <= 10`: print full detail table.
9. If `bareRefs.length > 10` and not `--verbose`: print summary count + file list.
10. Output: "Source References (note-level): N references across M files" section appended.

### Flow 5: Backward-Compatible Alias Dispatch

1. User types `scepter ctx create Decision "Auth Flow"`.
2. Commander parses `ctx` as the hidden `context` command alias.
3. Hidden command action fires. `command.args` = `['create', 'Decision', 'Auth Flow']`.
4. Deprecation notice emitted to stderr: "Note: 'scepter ctx create' is deprecated. Use 'scepter create' directly."
5. `program.parseAsync(['node', 'scepter', 'create', 'Decision', 'Auth Flow'], { from: 'user' })`.
6. Commander re-parses and dispatches to the top-level `create` command.
7. `preAction` hook fires, propagates `--project-dir` as normal.

### Flow 6: Help Output

1. User types `scepter --help`.
2. Custom `formatHelp()` fires.
3. Collects visible (non-hidden) commands from `program.commands`.
4. Groups by `COMMAND_GROUPS` lookup.
5. Renders section headers and command descriptions in grouped order.
6. Hidden aliases (`context`, `claims`, `notes`) are excluded.

## §11 Testing Strategy

| Test Level | Scope | Claims Covered |
|-----------|-------|----------------|
| Unit | `detectSearchMode()` — claim address, bare note ID, text fallback patterns | {A001.§2.AC.04}, {A001.§5.AC.03} |
| Unit | Backward-compat alias argument extraction and re-dispatch | {A001.§2.AC.02}, {A001.§5.AC.01} |
| Unit | Help formatter grouping — commands sorted into correct sections | {A001.§5.AC.02} |
| Unit | Note-level source reference filtering — `!ref.claimPath` filter | {A001.§2.AC.05} |
| Unit | Summary/verbose threshold for bare refs (>10 = summary) | {A001.§5.AC.04} |
| Integration | `scepter search "R005.§1.AC.01"` dispatches to claim trace | {A001.§2.AC.04}, {A001.§4.AC.06} |
| Integration | `scepter search "auth"` dispatches to text search | {A001.§2.AC.04} |
| Integration | `scepter search --mode note "R005.§1.AC.01"` forces text search | {A001.§5.AC.03} |
| Integration | `scepter trace R005` includes note-level source refs section | {A001.§2.AC.05}, {A001.§4.AC.07} |
| Integration | `scepter trace R005 --json` includes `sourceReferences` field | {A001.§2.AC.05} |
| Integration | `scepter trace R005.§1.AC.01` does NOT include note-level section | {DC.23} |
| CLI | All former context commands work at top level without `ctx` prefix | {A001.§2.AC.01}, {A001.§4.AC.01} |
| CLI | All former claims commands work at top level without `claims` prefix | {A001.§2.AC.01}, {A001.§4.AC.04} |
| CLI | `scepter ctx create` works via alias with deprecation notice | {A001.§2.AC.02}, {A001.§5.AC.01} |
| CLI | `scepter claims trace` works via alias | {A001.§2.AC.02} |
| CLI | `scepter notes show` works via alias | {A001.§2.AC.02} |
| CLI | `scepter scaffold` is unrecognized | {A001.§2.AC.06}, {A001.§4.AC.05} |
| CLI | `scepter xref-sources` is unrecognized | {A001.§2.AC.06}, {A001.§4.AC.08} |
| CLI | `scepter --help` shows grouped output with section headers | {A001.§5.AC.02} |
| CLI | `scepter trace R005 --reindex` forces index rebuild | {A001.§4.AC.10} |
| Regression | Existing test suite passes after each integration phase | All |
| Regression | `pnpm tsc` passes after each phase | All |
| Self-hosting | All existing `@implements` annotations still resolve | {A001.§1.AC.01} resolution |

## §12 Traceability Matrix

| Arch ID | Design Realization | Files | Phase |
|---------|--------------------|-------|-------|
| {A001.§1.AC.01} | Resolved by unified trace ({DC.19}-{DC.22}): bare note-level refs now visible alongside claim matrix | `trace-command.ts` | 6 |
| {A001.§1.AC.02} | Resolved by flattening ({DC.01}-{DC.03}) and unified search ({DC.14}): single entry point per intent | `index.ts`, `search.ts` | 1-5 |
| {A001.§1.AC.03} | Resolved by unified search ({DC.14}): single `search` command handles both note and claim queries | `search.ts` | 5 |
| {A001.§1.AC.04} | Resolved by removing argv hack ({DC.04}): dead code deleted | `index.ts` | 3 |
| {A001.§2.AC.01} | {DC.01}-{DC.03}, {DC.28}, {DC.29}: all commands registered at top level, group files deleted | `index.ts` | 1-3, 7 |
| {A001.§2.AC.02} | {DC.05}-{DC.08}: hidden alias commands for `ctx`, `context`, `claims`, `notes` | `index.ts` | 3 |
| {A001.§2.AC.03} | {DC.04}: lines 48-70 deleted | `index.ts` | 3 |
| {A001.§2.AC.04} | {DC.14}-{DC.18}: unified search with detection algorithm and mode override | `search.ts` | 5 |
| {A001.§2.AC.05} | {DC.19}-{DC.23}: trace extended with bare note-level source refs section | `trace-command.ts` | 6 |
| {A001.§2.AC.06} | {DC.24}-{DC.27}, {DC.10}-{DC.11}: scaffold deleted, xref-sources deleted, claims search deregistered, index hidden | Multiple files | 7 |
| {A001.§2.AC.07} | {DC.12}: existing `ensureIndex()` already lazy; `index` command hidden | `ensure-index.ts` | 8 |
| {A001.§4.AC.01} | {DC.01}-{DC.03}: context commands registered on `program` | `index.ts` | 1 |
| {A001.§4.AC.02} | {DC.04}: argv hack deleted | `index.ts` | 3 |
| {A001.§4.AC.03} | {DC.05}-{DC.07}: hidden alias commands | `index.ts` | 3 |
| {A001.§4.AC.04} | {DC.03}: claims commands registered on `program` | `index.ts` | 2 |
| {A001.§4.AC.05} | {DC.24}: `scaffold-command.ts` deleted | `scaffold-command.ts` | 7 |
| {A001.§4.AC.06} | {DC.14}-{DC.18}: unified search implementation | `search.ts` | 5 |
| {A001.§4.AC.07} | {DC.19}-{DC.22}: trace queries `SourceCodeScanner` for bare refs | `trace-command.ts` | 6 |
| {A001.§4.AC.08} | {DC.25}-{DC.26}: xref-sources files deleted | `xref-sources.ts`, `xref-sources-handler.ts` | 7 |
| {A001.§4.AC.09} | {DC.12}: `ensureIndex()` already automatic; `index` command removed from registration | `ensure-index.ts`, `index.ts` | 8 |
| {A001.§4.AC.10} | {DC.13}: `--reindex` flag on all claim-dependent commands, caching in `ensureIndex()` | `ensure-index.ts`, all claim commands | 8 |
| {A001.§5.AC.01} | {DC.05}-{DC.08}: hidden aliases + deprecation notices | `index.ts` | 3 |
| {A001.§5.AC.02} | {DC.09}: custom help formatter with grouped sections | `index.ts` | 4 |
| {A001.§5.AC.03} | {DC.16}: hint in auto-detection output; `--mode` override flag | `search.ts` | 5 |
| {A001.§5.AC.04} | {DC.21}: verbose/summary threshold for note-level source refs | `trace-command.ts` | 6 |

## §13 Observations

### The Context/Claims Split Was a Build Artifact, Not a Design Choice

The two command groups reflect the order in which subsystems were built. Notes came first (`context`), claims came second (`claims`). This is an implementation history artifact, not a principled UX decision. The unified surface organizes by user intent (create, find, trace, validate) rather than by subsystem provenance. This is one of those changes that makes the system feel designed rather than accreted.

### `search-handler.ts` Remains Intact

The note-content search implementation in `search-handler.ts` is unchanged. The unified search command adds a detection layer above it, not a rewrite of it. When the detection algorithm selects text search mode, it delegates to the exact same `searchNotes()` function. This minimizes risk and keeps the well-tested text search path stable.

### `search-command.ts` (Claims) Becomes an Internal Module

The claims search implementation (`searchClaims()` function in `claim-search.ts`) and its command wrapper (`search-command.ts`) are retained. The command is no longer registered as a standalone CLI command, but the `searchClaims()` function is called from the unified search command when in claim mode. This avoids duplicating the claim search logic.

### xref-sources Functionality Is Not Fully Replicated

The unified trace replaces xref-sources for the primary use case: "what source files reference this note?" But xref-sources also supported file-to-note direction (`--direction source-to-note`), file path targets, and grouping options (`--group-by note|file`). These features are not replicated in the unified trace. If needed, a future `refs` command could provide advanced reference querying. For now, the `SourceReferenceIndex` API remains available programmatically.

### Commander.js Hidden Command Behavior

Commander's `.hidden()` method excludes a command from `--help` output but still allows it to be invoked. This is the intended mechanism for deprecated command paths. The `allowUnknownOption()` and `allowExcessArguments()` calls are necessary because the hidden command receives all the subcommand's arguments and options as unparsed strings.

### Potential Name Collision: `delete`

The `delete` command works at top level because Commander treats command names as case-sensitive identifiers. `delete` is a JavaScript reserved word, but Commander uses it as a string name for routing, not as a JavaScript identifier. The existing `deleteCommand` export from `commands/context/delete.ts` already handles this correctly.

### Index Caching Lifetime

The `--reindex` flag addresses a subtle issue: within a single CLI invocation, `ensureIndex()` may be called multiple times (e.g., unified search detects a claim address, builds the index, then the user runs trace in the same process). The cache avoids redundant builds. The cache is process-scoped (module-level variable), so it resets between CLI invocations naturally. No TTL or invalidation logic is needed.

## References

- {A001} — CLI Unification: Flatten Command Hierarchy (source architecture note)
- {R004} — Claim-Level Addressability and Traceability System (claims subsystem)
- {R005} — Claim Metadata, Verification, and Lifecycle (metadata handling)
- {R006} — Claim Derivation Tracing (derivation display in trace)
- {R007} — Claim Search (search subsystem being absorbed)
- {DD003} — Claim Derivation Tracing (prior DD, pattern reference)
- {DD005} — Claims Gaps Command Redesign (multi-claim trace references)

