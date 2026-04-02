---
created: 2026-04-02T02:13:38.651Z
tags: [cli, architecture, ux]
status: draft
---

# A001 - CLI Unification - Flatten Command Hierarchy

**Date:** 2026-04-01
**Status:** Draft
**Scope:** Flatten the CLI command hierarchy, unify bifurcated citation surfaces, and reduce the command set to intent-based top-level commands.

---

## §1 Problem Statement

SCEpter's CLI command surface reflects implementation history rather than user intent. Two subsystems (notes and claims) were built sequentially and surfaced as separate command groups (`context`/`claims`), producing overlapping commands, a bisected citation model, and a confusing experience for both humans and LLM agents.

### §1.AC.01 The citation model is bisected across two independent systems.

The `addSourceReferences()` method in `claim-index.ts` (line 529) executes `if (!ref.claimPath) continue`, meaning a source file that references a note by bare ID (`{D001}`) without a claim path is invisible to the claims system. Conversely, claim-level annotations (`@implements {R005.§3.AC.01}`) are invisible to `xref-sources`. A user or agent asking "what's connected to R005?" must run both `xref-sources` AND `claims trace` to get the full picture, with no indication that they need to do so.

### §1.AC.02 Overlapping commands create ambiguity for LLM agents.

An agent that needs to understand a note's connections faces four commands with overlapping scope:
- `scepter show R005` -- note content + references
- `scepter xref-sources R005` -- source file cross-references
- `scepter claims trace R005` -- claim-level traceability
- `scepter claims thread R005` -- relationship tree

No single command provides the complete answer.

### §1.AC.03 Duplicate command names with different semantics exist across groups.

`search` exists in both `context` and `claims` groups. `scepter ctx search "auth"` searches note content; `scepter claims search "auth"` searches claim text and metadata. Users must know which subsystem their query targets before they can choose a command.

### §1.AC.04 The argv-splicing hack masks the real problem.

Lines 48-70 of `core/src/cli/index.ts` silently inject `ctx` into argv when a context subcommand name is used at top level, making commands like `scepter create` work but not appear in `--help` output. This is a workaround for the fact that these commands should never have been nested.

---

## §2 Decisions

### Flatten to Top Level

§2.AC.01 All `context` and `claims` subcommands MUST be registered directly on the root Commander program.

The `contextCommand` and `claimsCommand` group objects are removed. Every command becomes top-level. The `types` and `confidence` subgroups remain because they manage distinct entity types (note type definitions and file-level confidence annotations) where the grouping reflects a real conceptual boundary.

§2.AC.02 Hidden aliases for `ctx`, `context`, and `notes` MUST be maintained for backward compatibility.

Existing scripts, agent prompts, and documentation that use `scepter ctx create` or `scepter claims trace` MUST continue to work. These aliases forward to the top-level commands but do not appear in `--help`.

§2.AC.03 The argv-splicing hack in `index.ts` (lines 48-70) MUST be removed.

With all commands at top level, the hack that injects `ctx` into the argument vector is unnecessary. Removing it eliminates a source of confusion where commands work but are invisible in help output.

### Unify Search

§2.AC.04 A single `search` command MUST handle both note content search and claim lookup.

Detection uses `parseClaimAddress()` from `claim-parser.ts`. If the input parses as a claim address (e.g., `R005.§3.AC.01`), the command shows claim detail with traceability information. If the input parses as a bare note ID (e.g., `R005`), it shows the note and its claims. Otherwise, it performs full-text note content search. The `claims search` command is absorbed.

### Unify Trace

§2.AC.05 The `trace` command MUST show both claim-level traceability and note-level source references in a single output.

The existing traceability matrix (claim rows, projection columns) is extended with a "Source References" section that lists bare note-level references from source files -- the information currently available only through `xref-sources`. This eliminates the citation bisection from the user's perspective. The `xref-sources` command is absorbed.

### Kill List

§2.AC.06 The following commands and groups MUST be removed:

| Removed | Reason |
|---------|--------|
| `claims scaffold` | Never used. No consumers in codebase or documentation. |
| `xref-sources` | Absorbed into unified `trace` ({A001.§2.AC.05}). |
| `claims search` | Absorbed into unified `search` ({A001.§2.AC.04}). |
| `context` command group | Flattened ({A001.§2.AC.01}). |
| `claims` command group | Flattened ({A001.§2.AC.01}). |

### Make Index Automatic

§2.AC.07 The claim index build step MUST be lazy-initialized on first claim-dependent command invocation.

The `index` command is removed as a user-facing command. Claim-dependent commands (`trace`, `gaps`, `lint`, `verify`, `stale`, `thread`, `search`) trigger index construction automatically if not already built. A `--reindex` flag MAY be added to force a rebuild for debugging purposes.

---

## §3 Target Command Set

### Note CRUD

| Command | Description | Origin |
|---------|-------------|--------|
| `create` | Create a new note | `ctx create` |
| `show` | Show notes by ID (supports globs) or analyze source files | `ctx show` |
| `list` | List and filter notes | `ctx list` |
| `search` | Unified search: notes by content, claims by address | `ctx search` + `claims search` |
| `delete` | Delete notes | `ctx delete` |
| `archive` | Archive notes | `ctx archive` |
| `restore` | Restore archived/deleted notes | `ctx restore` |
| `purge` | Permanently delete from `_deleted` | `ctx purge` |
| `convert` | Convert between file/folder formats | `ctx convert` |
| `ingest` | Import files as notes | `ctx ingest` |

### Connection Understanding

| Command | Description | Origin |
|---------|-------------|--------|
| `trace` | Unified traceability: claim matrix + note-level source refs | `claims trace` + `xref-sources` |
| `thread` | Relationship tree for a claim or note | `claims thread` |
| `gather` | Gather related context for a note | `ctx gather` |
| `gaps` | Report claims with partial coverage | `claims gaps` |

### Quality and Hygiene

| Command | Description | Origin |
|---------|-------------|--------|
| `lint` | Validate claim structure in a note | `claims lint` |
| `verify` | Record verification event for a claim/note | `claims verify` |
| `stale` | Report stale claims based on source changes | `claims stale` |

### Configuration (unchanged)

| Command | Description |
|---------|-------------|
| `types` (subgroup) | Manage note types: add, list, rename, delete |
| `confidence` (subgroup) | File-level confidence: audit, mark |
| `config` | Display configuration |
| `init` | Initialize project |

Total: approximately 20 top-level commands. Comparable to git's porcelain set (21 commands).

---

## §4 Implementation Strategy

### Phase 1: Flatten Context Commands

§4.AC.01 Register all context subcommands directly on `program` in `core/src/cli/index.ts`.

Remove the `contextCommand` group. Each command (`create`, `show`, `list`, `search`, `gather`, `archive`, `delete`, `restore`, `purge`, `convert`, `ingest`) is imported and added to the root program individually.

§4.AC.02 Remove the argv-splicing hack (lines 48-70 of `index.ts`).

With commands registered at top level, the injection logic is dead code.

§4.AC.03 Keep `ctx` and `context` as hidden aliases that forward to individual commands.

Implementation: register a hidden `context` (alias `ctx`) command with `.passthrough()` that delegates to the matching top-level command. Alternatively, Commander's `.alias()` on individual commands if it supports group-level aliasing.

### Phase 2: Flatten Claims Commands

§4.AC.04 Register claims subcommands directly on `program`.

Remove the `claimsCommand` group. Each command (`trace`, `gaps`, `lint`, `verify`, `stale`, `thread`) is registered at top level. `index` becomes internal-only. `scaffold` and `search` are removed per the kill list.

§4.AC.05 Delete the `scaffold` command entirely.

File: `core/src/cli/commands/claims/scaffold-command.ts`. No consumers exist.

### Phase 3: Unify Search

§4.AC.06 Merge `claims search` functionality into the top-level `search` command.

The unified search command:
1. Calls `parseClaimAddress(input)` on the query string.
2. If it returns a valid address: perform claim lookup, display claim detail with traceability.
3. If the input matches a bare note ID pattern (`/^[A-Z]{1,5}\d{3,5}$/`): show the note and its claim summary.
4. Otherwise: perform full-text note content search (existing behavior).

Output format adapts based on result type: note results use note formatting, claim results use claim formatting.

### Phase 4: Unify Trace and xref-sources

§4.AC.07 Extend `trace` to query `SourceCodeScanner` for bare note-level references.

The trace handler already receives a `ProjectManager` with an initialized `SourceCodeScanner`. After building the claim traceability matrix, query the scanner's `SourceReferenceIndex` for references to the target note that have no `claimPath` (bare `{NOTEID}` mentions). Display these in a separate "Source References (note-level)" section below the claim matrix.

§4.AC.08 Remove the `xref-sources` command and its handler.

Files: `core/src/cli/commands/context/xref-sources.ts`, `core/src/cli/commands/context/xref-sources-handler.ts`. Functionality is subsumed by the extended `trace`.

### Phase 5: Make Index Automatic

§4.AC.09 Add lazy initialization to claim-dependent commands via the existing `ensureClaimIndex()` helper.

The `ensure-index.ts` module in `core/src/cli/commands/claims/` already performs index construction. Refactor it to cache the result on `ProjectManager` and trigger automatically. The explicit `index` command is removed from the CLI registration but the underlying `ClaimIndex.build()` remains available programmatically.

§4.AC.10 Optionally add a `--reindex` flag to claim-dependent commands for manual rebuild.

This flag forces a fresh index build even if a cached index exists. Useful for debugging stale index issues.

---

## §5 Risk Assessment

### §5.AC.01 Backward compatibility for existing scripts and agent prompts.

**Risk:** Agents and scripts using `scepter ctx create` or `scepter claims trace` will break without aliases.
**Mitigation:** Hidden command aliases forward old-style invocations to top-level commands ({A001.§2.AC.02}). The `claims` prefix is also aliased. Deprecation warnings MAY be emitted to stderr to encourage migration.

### §5.AC.02 Help output density at 20 top-level commands.

**Risk:** `scepter --help` becomes dense and harder to scan.
**Mitigation:** Use Commander's command group display feature to organize help output into sections (Note CRUD, Connection Understanding, Quality, Configuration) matching the categories in {A001.§3}.

### §5.AC.03 Search detection heuristic must be reliable.

**Risk:** A search query that happens to match a claim address pattern (e.g., someone searching for the literal text "R005.§1.AC.01") produces claim output when they wanted text search.
**Mitigation:** Add `--mode note|claim|auto` flag to `search` command. Default `auto` uses detection heuristic; explicit mode overrides. When in `auto` mode, if a claim address is detected, the output includes a hint: "Detected as claim address. Use --mode note for text search."

### §5.AC.04 Unified trace output could be noisy for notes with many bare source references.

**Risk:** A widely-referenced architecture note might have hundreds of bare `{A001}` mentions in source files, overwhelming the claim matrix in trace output.
**Mitigation:** The note-level source references section defaults to a summary count with file list, expanding to full detail only with `--verbose` or when the count is below a threshold (e.g., 10 references).

---

## §6 Scope Boundaries

### In Scope
- Flattening the `context` and `claims` command groups to top-level
- Unifying `search` across notes and claims
- Unifying `trace` with `xref-sources`
- Removing dead commands (`scaffold`, `xref-sources`, `claims search`)
- Making index construction automatic
- Backward-compatible aliases

### Out of Scope
- Changes to the `types` or `confidence` subgroups (these remain as-is)
- Changes to the underlying data model or claim index structure (only the CLI surface changes)
- Changes to formatter output beyond what is needed for unified trace/search
- UI or VS Code extension command mapping (separate concern)
- New features beyond the unification (e.g., new commands)

