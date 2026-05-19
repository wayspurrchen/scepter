---
created: 2026-05-19T05:52:09.596Z
tags:
  - refactor
  - references
  - delete
  - rename
  - lifecycle
confidence: 🤖2 2026-05-19
---

# DD020 - Reference Rewriting on Delete and Rename - Implementation Blueprint

**Source:** {R015} — Note Reference Rewriting on Delete and Rename (67 ACs across §1–§11, 4 OQs)

## Overview

R015 introduces a new opt-in hard-delete mode of `scepter delete` (which rewrites inbound references to a deletion marker) and a new `rename` primitive (which rewrites inbound references to the target ID). It preserves three existing behaviors as no-ops for reference rewriting: `archive` (unchanged), the default soft-delete mode of `scepter delete` (preserved), and within-document bare-section refs. The binding insight of the implementation is that **the rewriter is a mechanical translation over parser-recognized spans, and the deletion marker is a shared seam every reference consumer must branch on**. Those two observations partition the work cleanly into two non-overlapping layers:

1. **Production layer** — a rewriter engine that enumerates every reference span the existing parsers see (markdown body, source-code annotation contexts and comments, YAML frontmatter lists and `id` fields, claim-metadata `:derives=`/`:superseded=` TARGETs, self-prefix definitions, filesystem paths) and applies a per-operation action (substitute the note-ID portion with the deletion marker, with the rename target, or no-op for archive, soft-delete, and within-doc bare-section refs).
2. **Consumption layer** — the linter, trace command, gaps command, reference graph index, `scepter ctx show`, and VS Code diagnostic/hover/definition surfaces all need to recognize the deletion marker as a known lifecycle state and branch on it, otherwise tombstoned references degrade to broken-reference errors and the loud-signal-for-followup property is lost.

A small **marker module** owns the canonical deletion-marker format definition (§7.AC.02) — the regex, the construction function, the recognition predicate, and the timestamp helper — and is consumed by both layers. The marker module is the load-bearing primitive; every other module depends on it.

The current implementation's `delete` (`noteFileManager.deleteNoteFile` at `core/src/notes/note-file-manager.ts:472`) is a soft-delete that relocates the file to a `_deleted/` subfolder and updates note tags — it does **not** rewrite inbound reference call sites in other files (`referenceManager.updateReferencesForDeletion` exists at `core/src/notes/note-manager.ts:792` but the call site at line 797 logs "would update" rather than performing the rewrite). R015 preserves this soft-delete as the default `scepter delete` behavior and adds an opt-in hard-delete mode behind a flag (the flag name is spec-layer per R015 §9.AC.09). The hard-delete mode is greenfield — it removes the note unit from discovery, invokes the rewriter, and writes a rewrite-log entry. Soft-delete continues to use the existing `_deleted/` graveyard, `restore`, `purge`, and `#deleted` tag subsystem. Rename is greenfield — there is no existing rename primitive.

## Specification Scope

This DD covers the implementation realization of every R015 AC. Decomposition strategy:

- R015.§1.AC.01 and R015.§1.AC.02 are flagged high-binding (≥5 distinct behaviors per the reviewer pass). They are decomposed into separate DCs per behavior under §4 below.
- R015.§3 (16 ACs across reference-form surfaces) is realized through the scanner-adapter cluster in §2 below; one DC per surface keeps each scanner adapter scoped to one concern.
- R015.§5 (consumer behavior) decomposes by consumer module under §5 below.
- R015.§6 (atomicity) decomposes into staging-area mechanics, dirty-tree guard, rewrite-log structure, in-memory index refresh, and dry-run preview — DCs under §3 below.
- R015.§9 (CLI surface) ACs are deliberately under-specified in R015 (flag names are spec-layer). DCs here describe the command surface shape without committing to flag strings.
- R015.§10 and R015.§11 are documentation-projection and editor-projection respectively; DCs target the affected files and behaviors.

Every R015 AC is realized by at least one DC. The cross-reference is captured per-DC via `derives=R015.§N.AC.NN` metadata.

## Primitive Preconditions

| Primitive | Source Citation | Status |
|---|---|---|
| `NOTE_ID_RE` (`/^[A-Z]{1,5}\d{3,5}$/`) | `core/src/parsers/claim/claim-parser.ts:71` | PRESENT |
| `ALIAS_PREFIX_RE` (cross-project alias detection) | `core/src/parsers/claim/claim-parser.ts:84` | PRESENT |
| `ClaimAddress` interface (`noteId`, `sectionPath`, `claimPrefix`, `claimNumber`, `claimSubLetter`, `metadata`, `raw`, `aliasPrefix`) | `core/src/parsers/claim/claim-parser.ts:31` | PRESENT |
| `parseClaimAddress(raw, options)` | `core/src/parsers/claim/claim-parser.ts:160` | PRESENT |
| `parseClaimReferences(content, options)` (sweeps a document for braced/braceless refs) | `core/src/parsers/claim/claim-parser.ts:431` | PRESENT |
| `parseMetadataSuffix(raw)` (splits `id:meta1:meta2` and recognizes `key=value` items) | `core/src/parsers/claim/claim-parser.ts:133` | PRESENT |
| `isValidNoteId(id)` (note-ID validator) | `core/src/parsers/note/shared-note-utils.ts:68` | PRESENT |
| `parseNoteId(id)` | `core/src/parsers/note/shared-note-utils.ts:25` | PRESENT |
| `ClaimIndex` (note + claim index orchestrator with `build()`, `getClaimsForNote()`, `getClaim()`) | `core/src/claims/claim-index.ts:252` | PRESENT |
| `ClaimIndexData` (entries map + crossRefs) | `core/src/claims/claim-index.ts:109` | PRESENT |
| `ReferenceManager` (bidirectional graph) | `core/src/references/reference-manager.ts:8` | PRESENT |
| `updateReferencesForDeletion` (existing log-only path called by soft-delete) | `core/src/notes/note-manager.ts:792` | PRESENT (active for soft-delete; not invoked by hard-delete) |
| `SourceCodeScanner` (sweeps `core/src`, `vscode/src`, `vscode/media`; recognizes `@implements`, `@validates`, `@addresses`, `@depends-on`, `@see`) | `core/src/scanners/source-code-scanner.ts:39`; annotation patterns at lines 356–361 | PRESENT |
| `SourceReferenceIndex` | `core/src/references/source-reference-index.ts:1` | PRESENT |
| `NoteFileManager` (`deleteNoteFile`, `archiveNoteFile`, `noteIndex: Map<noteId, filePath>`, `fileToNoteId`) | `core/src/notes/note-file-manager.ts:16,18,455,472` | PRESENT |
| `NoteManager.deleteNote` (existing soft-delete wrapper) | `core/src/notes/note-manager.ts:780` | PRESENT (preserved as soft-delete default; flag-branched to dispatch to the new hard-delete pipeline per R015.§1.AC.01) |
| `stringifyFrontmatter` (Unicode-preserving frontmatter writer) | `core/src/notes/yaml-frontmatter.ts:22` | PRESENT |
| `timestampPrecision` config field (`'date'` | `'datetime'`) | `core/src/types/config.ts:194`; default at `core/src/config/default-scepter-config.ts:42` | PRESENT |
| `formatTimestamp(date, config)` (consumes `timestampPrecision`) | `core/src/notes/note-file-manager.ts:34` | PRESENT |
| `archiveCommand` (CLI) | `core/src/cli/commands/context/archive.ts:5` | PRESENT (R015 §1.AC.04 preserves unchanged) |
| `deleteCommand` + `DeleteHandler` (CLI) | `core/src/cli/commands/context/delete.ts`, `delete-handler.ts` | PRESENT (default soft-delete preserved; gains hard-delete flag branching per R015.§1.AC.01, §9.AC.09) |
| `validateLifecycleTags` (linter) | `core/src/cli/commands/claims/lint-command.ts:151` | PRESENT |
| `validateDerivationLinks` (linter) | `core/src/cli/commands/claims/lint-command.ts:223` | PRESENT |
| `validateAliasReferences` (cross-project linter) | `core/src/cli/commands/claims/lint-command.ts:381` | PRESENT |
| `buildTraceabilityMatrix`, `findGaps` | `core/src/claims/traceability.ts:106,412` | PRESENT |
| `traceCommand` | `core/src/cli/commands/claims/trace-command.ts:179` | PRESENT |
| `gapsCommand` | `core/src/cli/commands/claims/gaps-command.ts:32` | PRESENT |
| `DiagnosticsProvider`, `unresolved-reference` diagnostic severity | `vscode/src/diagnostics-provider.ts:37,40` | PRESENT |
| `ClaimHoverProvider` | `vscode/src/hover-provider.ts:63` | PRESENT |
| `DefinitionProvider` | `vscode/src/definition-provider.ts` | PRESENT |
| `DecorationProvider` | `vscode/src/decoration-provider.ts` | PRESENT |
| `claude/skills/scepter/claims.md` (agent-facing canonical claim doc) | `claude/skills/scepter/claims.md` | PRESENT |
| `claude/skills/scepter/SKILL.md` (agent-facing entry point) | `claude/skills/scepter/SKILL.md` | PRESENT |
| Rename primitive (no `renameNote` or `renameNoteFile`) | — | ABSENT — authorized by {R015.§1.AC.02}. This DD is the design that creates it. |
| Rewrite-engine primitive | — | ABSENT — authorized by {R015.§1.AC.01}. This DD is the design that creates it. |
| Tombstone-marker module | — | ABSENT — authorized by {R015.§2.AC.01}, {R015.§7.AC.02}. This DD is the design that creates it. |
| Rewrite-log writer | — | ABSENT — authorized by {R015.§6.AC.03}. This DD is the design that creates it. |
| Staging-directory atomicity layer | — | ABSENT — authorized by {R015.§6.AC.01}. This DD is the design that creates it. |
| Dirty-tree git guard | — | ABSENT — authorized by {R015.§6.AC.02}. This DD is the design that creates it. |
| Test-name-embed scanner | — | ABSENT — authorized by {R015.§3.AC.08}. Implementation surface depends on {R015.OQ.01}; see §10 below. |

All absent primitives are authored by this DD (or, for the test-name scanner, scoped to OQ resolution before authoring). No prerequisite DD is required.

## Current State

The reference-rewriting picture in the codebase today:

- `NoteFileManager.deleteNoteFile` (`core/src/notes/note-file-manager.ts:472`) implements a soft-delete: read file, append `status: deleted` and `deleted_at` to frontmatter, move file to a sibling `_deleted/` directory, update `noteIndex`/`fileToNoteId` maps, emit a `file:deleted` event with `requiresReferenceUpdate: true`.
- `NoteManager.deleteNote` (`core/src/notes/note-manager.ts:780`) wraps `deleteNoteFile`, then calls `referenceManager.updateReferencesForDeletion(noteId)`. The latter computes a count but does NOT mutate other files; the call site at line 797 logs `"Would update N references"`. After this returns, every `{R005.§1.AC.03}` and `@implements {R005}` in other files is still pointed at a now-soft-deleted note.
- `NoteFileManager.archiveNoteFile` (`core/src/notes/note-file-manager.ts:455`) does the parallel soft-relocation to a `_archive/` sibling directory.
- There is no rename primitive. No code path renames a note's file/folder, updates the frontmatter `id`, rewrites self-prefixes, or updates inbound references.
- Reference-scanning surfaces (markdown body via `parseClaimReferences`, source code via `SourceCodeScanner`) are read-only: they extract references for indexing, never write them.
- Consumer behavior on tombstoned references does not exist today because tombstoned references do not exist. The linter, trace command, gaps command, reference-graph index, and VS Code diagnostic/hover/definition all treat any unresolvable note-ID-shaped token as an unresolved-reference error.
- Skill files at `claude/skills/scepter/claims.md` and `claude/skills/scepter/SKILL.md` document `:closed`, `:deferred`, `:removed`, `:superseded=` but do NOT document a deletion-marker form.
- The Common Mistakes table in `claude/skills/scepter/claims.md` lists 18 entries and has no row for "treating tombstoned references as broken-reference lint errors."

R015 preserves the existing soft-delete + tag-the-references model as the default mode of `scepter delete` and adds an opt-in hard-delete mode (per R015 §1.AC.01, §9.AC.09) that removes the note unit from discovery and rewrites every inbound reference to a deletion marker. The existing `restore`, `purge`, and `#deleted` tag subsystem continues to serve soft-delete unchanged. The `_deleted/` graveyard remains exclusively for soft-delete; hard-delete removes the file outright per §3.DC.15.

## Module Inventory

The modules new and modified by this design, grouped by layer.

### A. Marker module (new)

**File:** `core/src/lifecycle/deletion-marker.ts`

- ADD `DELETION_MARKER_RE` regex constant (`/_deleted_([A-Z]{1,5}\d{3,5})_at_(\d{8,})/`) — the single canonical source for marker recognition.
- ADD `formatDeletionMarker(originalId, date, timestampPrecision)` — constructs the marker.
- ADD `isDeletionMarker(token)` — predicate consumed by every layer.
- ADD `parseDeletionMarker(token): { originalId, timestamp } | null` — recovers original ID + timestamp for provenance display.
- Module-level invariant: NO other source file constructs or recognizes the marker by ad-hoc regex (enforced by code review).

### B. Rewriter engine and scanner adapters (new)

**File:** `core/src/lifecycle/rewriter.ts`

- ADD `interface ReferenceSpan { filePath, byteRange, surface, kind, originalText, parsedAddress }` where `surface` is one of `markdown-body` / `source-comment` / `source-annotation` / `source-string-literal` / `frontmatter-list` / `frontmatter-id` / `claim-metadata-derives` / `claim-metadata-superseded` / `self-prefix-heading` / `self-prefix-paragraph` / `filesystem-path`.
- ADD `interface RewriteAction { kind: 'substitute' | 'noop' | 'audit-only' | 'warn-and-skip', replacement?, reason? }`.
- ADD `deleteRewritePredicate`, `renameRewritePredicate`, `archiveRewritePredicate` — dispatch tables mapping `(operation, span) → RewriteAction`.
- ADD `class Rewriter` with `plan(operation): RewritePlan` and `apply(plan): RewriteResult` (two-phase: `plan` reads files and produces a plan; `apply` commits via the atomicity layer; dry-run is `plan` only).
- ADD `isAliasPrefixed(span)` helper — inspects `span.parsedAddress.aliasPrefix`; alias-prefixed spans resolve to `warn-and-skip` regardless of operation.

**File:** `core/src/lifecycle/scanners/markdown-body-scanner.ts`

- ADD `scanMarkdownBody(filePath, content): ReferenceSpan[]` — wraps `parseClaimReferences`. Inherits parser decoration-transparency for code spans/fences and other markdown emphasis. Preserves inline trailing metadata.

**File:** `core/src/lifecycle/scanners/source-code-scanner-adapter.ts`

- ADD `scanSourceCode(filePath, content): ReferenceSpan[]` — emits spans for `@implements` / `@validates` / `@addresses` / `@depends-on` / `@see` annotation contexts and bare braced refs in comments. Builds on `SourceCodeScanner` annotation patterns.

**File:** `core/src/lifecycle/scanners/test-name-scanner.ts`

- ADD `scanTestNameEmbeds(filePath, content): ReferenceSpan[]` — scans `test('...')`/`it('...')`/`describe('...')` call-site string literals for claim-address-shaped tokens via a relaxed match. Surface: `source-string-literal`. Action: always `audit-only`. Implementation precision depends on {R015.OQ.01}.

**File:** `core/src/lifecycle/scanners/frontmatter-scanner.ts`

- ADD `scanFrontmatter(filePath, content): ReferenceSpan[]` — walks YAML frontmatter. Emits `frontmatter-list` for scalar list field entries (`derives:`, `supersedes:`, etc.) and `frontmatter-id` for the `id` field.

**File:** `core/src/lifecycle/scanners/claim-metadata-scanner.ts`

- ADD `scanClaimMetadata(filePath, content): ReferenceSpan[]` — walks claim definitions; emits `claim-metadata-derives` / `claim-metadata-superseded` spans for the TARGET of `:derives=TARGET` / `:superseded=TARGET` suffixes. Uses `parseMetadataSuffix` + `parseClaimAddress`.

**File:** `core/src/lifecycle/scanners/self-prefix-scanner.ts`

- ADD `scanSelfPrefixes(filePath, content, expectedNoteId): ReferenceSpan[]` — finds self-prefixed claim heading and bold-paragraph definitions whose self-prefix matches `expectedNoteId`. Only active for the target of a rename operation.

**File:** `core/src/lifecycle/scanners/filesystem-path-scanner.ts`

- ADD `scanFilesystemEntry(noteId): FilesystemRenamePlan` — resolves the note's file or folder path from `NoteFileManager.noteIndex`. For folder-form notes, plans folder rename + inner main-file rename with companion files moving as a unit. Per {R008}.

### C. Atomicity layer (new)

**File:** `core/src/lifecycle/atomicity/staging.ts`

- ADD `class StagingArea` with `prepare(plan): void`, `commit(): void`, `rollback(): void`. Writes planned post-states into `_scepter/_lifecycle-staging/<run-id>/`; atomic POSIX rename on commit; recursive unlink on rollback. Interrupted runs are detected by stale staging directories; a subsequent invocation refuses to start until the operator clears them.

**File:** `core/src/lifecycle/atomicity/dirty-tree-guard.ts`

- ADD `checkWorkingTreeClean(projectPath, allowOverride): DirtyTreeStatus` returning `'clean'` / `'dirty'` / `'not-a-git-repo'`. Refuses to run when dirty and override not set. `'not-a-git-repo'` proceeds without guard.

**File:** `core/src/lifecycle/atomicity/rewrite-log.ts`

- ADD `interface RewriteLogEntry { runId, operation, target, renameTarget?, timestamp, files: Array<{path, spans: Array<{byteRange, beforeText, afterText, surface}>}>, warnings, auditList }`.
- ADD `writeRewriteLogEntry(projectPath, entry)` — persists to `_scepter/lifecycle-log/<timestamp>-<run-id>.json`. Log root follows the `_scepter/` discipline established by {DD019}.
- ADD `readRewriteLogEntry(runId): RewriteLogEntry` — replay-sufficient surface for a future undo command.
- Log filename's timestamp portion consumes `timestampPrecision` via `formatTimestamp`.

**File:** `core/src/lifecycle/atomicity/dry-run-formatter.ts`

- ADD `formatDryRun(plan): string` — emits per-file per-span before/after manifest, cross-project skipped-reference warnings, test-name-embed audit list. Output is a superset of the rewrite-log entry shape.

**File:** `core/src/notes/note-manager.ts` (modified)

- ADD `refreshAfterRewrite(plan): Promise<void>` — re-reads every file in the plan and rebuilds the affected portions of the claim index and reference graph. Implementation may rebuild incrementally or holistically; observable post-condition is post-operation consistency.

### D. Lifecycle command surface

`scepter delete` retains its current soft-delete default and gains an opt-in hard-delete mode behind a flag (flag name spec-layer per R015.§9.AC.09). The preserved soft-delete subsystem (`restore`, `purge`, `#deleted` tag-update bidirectional updates) is unchanged in semantics; the only modification to existing soft-delete and archive code paths is the folder-unit atomicity bug-fix per §3.DC.14, Phase 4a. The new hard-delete and rename command paths add greenfield code under the flag and the new command, respectively.

**File:** `core/src/cli/commands/context/delete.ts` + `delete-handler.ts` (modified)

- MODIFY to add flag branching for the new hard-delete mode. Default behavior is unchanged: invoke the existing soft-delete code path (relocate to `_deleted/`, append `#deleted` tag, retain inbound references). Under the hard-delete flag: invoke the rewriter, remove the note unit from discovery, write a rewrite-log entry. Accepts note ID as positional argument (preserved). Gains dry-run flag and dirty-tree override flag (names spec-layer).

**File:** `core/src/cli/commands/context/rename.ts` + `rename-handler.ts` (new)

- ADD `renameCommand = new Command('rename').argument('<sourceId>').argument('<targetId>')`. Handler validates target via `isValidNoteId`, rejects collision with live notes, rejects source-equals-target.

**File:** `core/src/cli/commands/context/archive.ts` (preserved with respect to reference rewriting)

- No reference-rewriting flag added; no rewriter invocation. The command's outward behavior is unchanged. Its underlying file operations now invoke the folder-unit-aware atomicity primitive per §3.DC.14 (Phase 4a refactor), so folder-form archive becomes correct.

**File:** `core/src/cli/commands/context/restore.ts` + `restore-handler.ts` (preserved)

- Unchanged. Continues to restore soft-deleted notes from `_deleted/`. NOT invoked by hard-delete; hard-delete has no restore path.

**File:** `core/src/cli/commands/context/purge.ts` + `purge-handler.ts` (preserved)

- Unchanged. Continues to permanently purge soft-deleted notes from `_deleted/`. NOT invoked by hard-delete; hard-delete bypasses the graveyard entirely.

**File:** `core/src/references/reference-manager.ts` (preserved for soft-delete; modified for tombstoning, see section E)

- The `#deleted` tag bidirectional update subsystem (`updateReferencesForDeletion` and the `#deleted` tag-update logic at `core/src/references/reference-manager.ts:238–380`) remains active for the soft-delete code path. No semantic change to that surface in this DD.

**File:** `core/src/notes/note-manager.ts` (modified)

- MODIFY `deleteNote` (the wrapper at `core/src/notes/note-manager.ts:780`) to add flag branching: under default soft-delete, dispatch to the existing soft-delete logic (preserved); under the hard-delete flag, dispatch to the new rewriter pipeline.
- ADD `refreshAfterRewrite(plan)` per section C (post-rewrite in-memory consistency).

**File:** `core/src/notes/note-file-manager.ts` (modified)

- MODIFY `archiveNoteFile` and `deleteNoteFile` (the soft-delete path at line 472) to invoke the new folder-unit-aware atomicity primitive (Phase 4a refactor per §3.DC.14). The control flow of soft-delete is preserved (relocate to `_deleted/`, append `#deleted` tag); only the file/folder operation primitive changes so that companion files of folder-form notes move with the folder.
- ADD `removeNoteEntry(noteId)` — hard-unlink per §3.DC.15. Used exclusively by the new hard-delete code path; the soft-delete path continues to use the modified `deleteNoteFile`.
- ADD `renameNoteEntry(sourceId, targetId)` — file-based: rename `<source> Title.md` → `<target> Title.md`. Folder-based: rename folder + inner main file; companion files move with the folder.

### E. Consumer-recognition modules

**File:** `core/src/cli/commands/claims/lint-command.ts` (modified)

- MODIFY `validateDerivationLinks` to short-circuit when the `:derives=TARGET` note-ID portion is a deletion marker. Tombstoned targets are valid lifecycle state.
- MODIFY `validateLifecycleTags` similarly for `:superseded=TARGET`.
- ADD audit-mode pass collecting tombstoned-target entries when a new lint flag (name spec-layer) is set.

**File:** `core/src/cli/commands/claims/trace-command.ts` + `core/src/claims/traceability.ts` (modified)

- MODIFY `buildTraceabilityMatrix` to filter out tombstoned references by default.
- ADD parallel-column population pass surfaced when a new trace flag (name spec-layer) is set.

**File:** `core/src/cli/commands/claims/gaps-command.ts` + `core/src/claims/traceability.ts` (modified)

- MODIFY `findGaps` to exclude tombstoned references from generic gap analysis.
- ADD `GapReport.kind: 'orphan-derives'` value; population pass walks claims with `:derives=` whose TARGET is tombstoned.

**File:** `core/src/references/reference-manager.ts` (modified)

- MODIFY graph-edge representation to distinguish tombstoned edges from live edges (e.g., an `isTombstoned: boolean` flag). Tombstoned edge target is a synthetic deleted-note entity carrying the parsed original ID and timestamp.

**File:** `core/src/cli/commands/context/show.ts` + `show-handler.ts` (modified)

- ADD handler branch: input matches `DELETION_MARKER_RE` → resolve via `readRewriteLogEntry` → format as provenance summary (original ID, deletion date, file modification record). Whether the original note body is shown is {R015.OQ.02}.

### F. VS Code editor surface

**File:** `vscode/src/diagnostics-provider.ts` (modified)

- MODIFY the diagnostic-producing path that feeds `DiagnosticsProvider` to short-circuit when the parsed note-ID portion of a reference matches `isDeletionMarker`. The `unresolved-reference` diagnostic MUST NOT fire on tombstoned references.

**File:** `vscode/src/hover-provider.ts` (modified)

- MODIFY `ClaimHoverProvider.provideHover` to detect tombstoned references via `isDeletionMarker` and produce hover content presenting the deletion event (original note ID, deletion timestamp). Optionally surfaces the rewrite-log entry as provenance.

**File:** `vscode/src/definition-provider.ts` (modified)

- MODIFY the provider to short-circuit on tombstoned references. Behavior is a recognized no-op or jump to the rewrite-log entry; exact form is spec-layer.

**File:** `vscode/src/decoration-provider.ts` (modified)

- ADD a decoration type for ranges matching `DELETION_MARKER_RE`. Visual specifics (color, italic, opacity) are spec-layer.

### G. Agent-facing documentation

**File:** `claude/skills/scepter/claims.md` (modified)

- ADD a section teaching the tombstone lifecycle state: marker format per R015 §2.AC.01, parser-invisibility property per R015 §2.AC.02, the distinction "tombstone is a recognized lifecycle state, not a broken reference." Placement: alongside the existing "Lifecycle Tags" section.
- ADD a Common Mistakes row: "treating tombstoned references as broken-reference lint errors" → "tombstoned references are a recognized lifecycle state, not a lint violation."
- ADD authoring-discipline content distinguishing when delete, archive, and rename are the correct lifecycle move.

**File:** `claude/skills/scepter/SKILL.md` (modified)

- ADD content distinguishing the tombstoned-state lifecycle (note-ID-level, externally applied to inbound references) from claim-level lifecycle tags (`:removed`, `:superseded=` from {R005}).
- Reviewer/producer documentation surfaces (`reviewing.md`, `conformance.md`) reflect the same distinction.

## Wiring Map

### Import graph

```
deletion-marker.ts (A)
  ▲  imported by every layer below
  │
  ├─ rewriter.ts (B1)
  │    ▲  imported by every scanner adapter:
  │    │
  │    ├─ scanners/markdown-body-scanner.ts (B2)
  │    ├─ scanners/source-code-scanner-adapter.ts (B2)
  │    ├─ scanners/test-name-scanner.ts (B2; OQ.01-gated)
  │    ├─ scanners/frontmatter-scanner.ts (B2)
  │    ├─ scanners/claim-metadata-scanner.ts (B2)
  │    ├─ scanners/self-prefix-scanner.ts (B2)
  │    └─ scanners/filesystem-path-scanner.ts (B2)
  │
  ├─ atomicity/staging.ts (C1)
  ├─ atomicity/dirty-tree-guard.ts (C2)
  ├─ atomicity/rewrite-log.ts (C3)
  ├─ atomicity/dry-run-formatter.ts (C5)
  │
  ├─ cli/commands/context/delete-handler.ts (D1)
  ├─ cli/commands/context/rename-handler.ts (D2)
  │     │ both depend on rewriter + atomicity + scanners
  │
  ├─ cli/commands/claims/lint-command.ts (E1)
  ├─ cli/commands/claims/trace-command.ts (E2)
  ├─ cli/commands/claims/gaps-command.ts (E3)
  ├─ references/reference-manager.ts (E4)
  ├─ cli/commands/context/show-handler.ts (E5)
  │
  ├─ vscode/src/diagnostics-provider.ts (F1)
  ├─ vscode/src/hover-provider.ts (F2)
  ├─ vscode/src/definition-provider.ts (F3)
  └─ vscode/src/decoration-provider.ts (F4)
```

The marker module is the single load-bearing primitive. Every other module imports it; no other module constructs or recognizes the marker by ad-hoc regex.

### Call chain — delete (live run)

```
CLI: scepter delete R005
  → deleteHandler (D1)
    → checkWorkingTreeClean (C2)
    → noteManager.resolveNote(R005)
    → rewriter.plan('delete', R005) (B1)
        for each scanner adapter (B2): emit ReferenceSpan[]
        for each span: deleteRewritePredicate(span) → RewriteAction
      assemble RewritePlan { files, removal, warnings, auditList }
    → stagingArea.prepare(plan) (C1)
    → stagingArea.commit() (C1)
    → noteManager.refreshAfterRewrite(plan)
    → rewriteLog.writeEntry(entry) (C3)
    → CLI prints summary + audit list + warnings
```

### Call chain — rename (live run)

```
CLI: scepter rename R005 R042
  → renameHandler (D2)
    → checkWorkingTreeClean (C2)
    → validate targetId; reject collision; reject source==target
    → rewriter.plan('rename', { source: R005, target: R042 }) (B1)
        scanners emit spans across whole project
        for the renamed note's own file: also frontmatter-id, self-prefix spans
        filesystem-path-scanner emits FilesystemRenamePlan
    → stagingArea.prepare → commit
    → noteManager.refreshAfterRewrite
    → rewriteLog.writeEntry
    → CLI prints summary
```

### Call chain — dry-run

Identical through `rewriter.plan(...)`. Routes to `dryRunFormatter.format(plan)` instead of staging-area commit. No filesystem mutation.

### Call chain — consumer branching (linter example)

```
scepter claims lint R007 (R007 has :derives=_deleted_R005_at_20260519.§1.AC.03)
  → buildTraceabilityMatrix(indexData)
      for each crossRef: if isDeletionMarker(ref.toNoteId) → skip
  → validateDerivationLinks(R007, indexData, claimIndex)
      for each entry with :derives=TARGET:
        if isDeletionMarker(parseClaimAddress(TARGET).noteId or raw token) → skip invalid-derivation-target
        if --tombstoned-targets flag → surface as audit category
        else → existing live-target validation
```

## Data and Interaction Flow

### Flow: delete invocation, end-to-end

1. User runs `scepter delete R005`.
2. Pre-flight guards: dirty-tree check; note-resolves check.
3. Plan construction: enumerate every file under note discovery paths + source-code-integration directories + project-markdown files outside discovery paths (per R015 §3.AC.16). Run relevant scanner adapter(s) per file. For each span, call `deleteRewritePredicate(span)`:
   - `markdown-body` referring to R005 → substitute marker.
   - `source-annotation` / `source-comment` referring to R005 → substitute marker.
   - `source-string-literal` containing R005 → audit-only.
   - `frontmatter-list` / `frontmatter-id` referring to R005 in OTHER notes → substitute marker. R005's own frontmatter is moot (file removed).
   - `claim-metadata-derives` / `claim-metadata-superseded` referring to R005 → substitute marker.
   - `self-prefix-*` in R005's own file → moot (file removed).
   - Within-document bare-section refs → noop.
   - Cross-project alias refs → warn-and-skip.
   - Add R005's filesystem entry to the plan as removal.
4. Staging: write post-state files into staging directory. Originals untouched.
5. Commit: atomic POSIX rename of staged files into target paths; unlink R005's file/folder.
6. Index refresh: re-read touched files; rebuild claim index entries and reference-graph edges.
7. Log persistence: write `_scepter/lifecycle-log/<timestamp>-<run-id>.json` containing per-file/per-span before/after, warnings, audit list.
8. Output: count of files modified, cross-project warnings, test-name audit list with file:line, log file path.

### Flow: rename invocation, end-to-end

1. User runs `scepter rename R005 R042`.
2. Pre-flight: dirty-tree, target valid + non-colliding, source ≠ target.
3. Plan construction: same scanner enumeration as delete. `renameRewritePredicate(span)`:
   - All non-excluded surfaces referring to R005 → substitute target `R042` preserving trailing claim path.
   - `frontmatter-id` on R005's own file → substitute target.
   - `self-prefix-heading` / `self-prefix-paragraph` on R005's own file → substitute target preserving trailing claim path.
   - `source-string-literal` → audit-only.
   - Within-document bare-section refs → noop (resolve transparently through document's new ID).
   - Cross-project alias refs → warn-and-skip + additional "downstream peer references may break" warning naming source + target IDs.
   - `filesystem-path-scanner` emits the rename plan: file `R005 Title.md` → `R042 Title.md`, OR folder `R005 Title/` → `R042 Title/` with inner main file `R005.md` → `R042.md`, companion files moving with the folder.
4. Staging, commit, index refresh, log persistence, output: same as delete (log entry's `operation: 'rename'`, `renameTarget: 'R042'`).

### Flow: consumer encounters a tombstoned reference (trace example)

1. User runs `scepter claims trace R007` after R005 has been deleted. R007's `:derives=` has been rewritten to `:derives=_deleted_R005_at_20260519.§1.AC.03`.
2. Index build: `parseClaimAddress` is asked to parse `_deleted_R005_at_20260519.§1.AC.03`. The existing `NOTE_ID_RE` (`/^[A-Z]{1,5}\d{3,5}$/`) does NOT match `_deleted_R005_at_20260519` (it starts with `_`). The parser binds `noteId: undefined`. Consumer-side logic reads the raw TARGET token via `parseMetadataSuffix` and applies `isDeletionMarker` to the token directly. This preserves R015 §2.AC.02's parser-invisibility invariant.
3. Matrix build: `buildTraceabilityMatrix` filters tombstoned edges out by default; with the spec-chosen flag, surfaces them in a deleted-origin column.
4. Render: live derivation graph minus the tombstoned edge, OR the tombstoned edge in a deleted-origin column.

### Flow: cross-project reference encountered during rewrite

1. A scanner emits a span where `span.parsedAddress.aliasPrefix !== undefined`.
2. Both `deleteRewritePredicate` and `renameRewritePredicate` route alias-prefixed spans to `warn-and-skip` unconditionally.
3. Warning carries `span.filePath`, original text, operation name; accumulates into the plan's `warnings` array.
4. Live runs print warnings after the operation summary and persist them in the rewrite-log entry. Dry-run includes warnings in the formatted preview.
5. Rename-specific: per source-cited alias, emit an additional "downstream peer references may break" warning naming source + target.

---

## §1 Marker Module Design Claims

This cluster covers the canonical source of truth for the deletion-marker format — its construction function, its recognition predicate, its regex, and its parse/inverse helper. The marker module is the single load-bearing primitive every other layer imports; no other module constructs or recognizes the marker by ad-hoc regex. R015.§7.AC.02 binds this single-source-of-truth invariant.

Source ACs: {R015.§2.AC.01}, {R015.§2.AC.02}, {R015.§2.AC.04}, {R015.§2.AC.05}, {R015.§7.AC.02}, {R015.§6.AC.08}.

§1.DC.01:derives=R015.§2.AC.01 The marker module MUST expose a `formatDeletionMarker(originalId, date, timestampPrecision)` function that returns a string of the form `_deleted_<ORIGINAL_NOTE_ID>_at_<TIMESTAMP>` where `<TIMESTAMP>` is `YYYYMMDD` under date-precision and the compact numeric form (`YYYYMMDDHHMM` or finer) under datetime-precision.

§1.DC.02:derives=R015.§2.AC.02 The marker module MUST expose an `isDeletionMarker(token)` predicate. The predicate MUST return false for every token that satisfies the existing note-ID validator `[A-Z]{1,5}\d{3,5}`, ensuring the marker is parser-invisible at the note-ID stage.

§1.DC.03:derives=R015.§2.AC.04 The marker module MUST expose a `DELETION_MARKER_RE` regex matching `_deleted_([A-Z]{1,5}\d{3,5})_at_(\d{8,})` such that the original ID is recoverable from capture group 1 and the timestamp is recoverable from capture group 2.

§1.DC.04:derives=R015.§7.AC.02 The marker module MUST be the only source file in the project that constructs or recognizes the marker. Every consumer (rewriter, linter, trace, gaps, reference manager, show handler, VS Code providers) MUST import `formatDeletionMarker`, `isDeletionMarker`, `parseDeletionMarker`, or `DELETION_MARKER_RE` from this module and MUST NOT inline a duplicate regex or string template.

§1.DC.05:derives=R015.§6.AC.08 The marker module's timestamp helper MUST consume the project's `timestampPrecision` config setting via the existing `formatTimestamp` utility (or an equivalent pass-through), so that the marker timestamp and the rewrite-log filename timestamp are governed by one setting, not two.

§1.DC.06:derives=R015.§2.AC.05 The marker module MUST be the only producer of any rewriter-emitted lifecycle marker. No additional prefix conventions (`_archived_`, `_consolidated_`, etc.) are exported by this module in v1; future lifecycle vocabulary extensions MUST be expressed inside the existing marker shape rather than adding parallel prefixes.

§1.DC.07:derives=R015.§2.AC.04 The marker module MUST expose a `parseDeletionMarker(token): { originalId, timestamp } | null` function that, given a token, returns the recovered original note ID and timestamp when the token matches `DELETION_MARKER_RE`, and returns `null` otherwise. The function is the symmetric inverse of `formatDeletionMarker` for provenance display by consumers (notably `scepter ctx show` and the VS Code hover provider).

## §2 Rewriter Engine and Scanner-Adapter Design Claims

This cluster covers the rewriter engine architecture (span-substitution pipeline; plan/apply two-phase; per-operation predicate dispatch) and the seven scanner adapters (markdown body, source code, test-name embed, frontmatter, claim metadata, self-prefix, filesystem path) that emit the spans the engine acts on. One DC per scanner surface keeps each adapter scoped to one concern, and the predicate dispatch table is the single extension point for future operations or claim-level rewriting per R015.§7.AC.01.

Source ACs: {R015.§3.AC.01}–{R015.§3.AC.07}, {R015.§3.AC.09}–{R015.§3.AC.16}, {R015.§4.AC.01}–{R015.§4.AC.03}, {R015.§7.AC.01}, {R015.§8.AC.01}–{R015.§8.AC.02}.

§2.DC.01:derives=R015.§7.AC.01 The rewriter engine MUST be structured as a span-substitution pipeline with three pluggable layers: scanner adapters (emit `ReferenceSpan`), a per-operation predicate (`deleteRewritePredicate` / `renameRewritePredicate` / `archiveRewritePredicate`), and a substituter (applies `RewriteAction` to the source text). Extending matching from note-ID-level to claim-level requires changing only the predicate, not the scanner or substituter.

§2.DC.02:derives=R015.§4.AC.01 Under the `delete` operation, the rewriter MUST invoke every scanner adapter listed in §2.DC.03–§2.DC.09 against every file under the union of note-discovery paths, source-code-integration directories, and project-markdown paths outside note-discovery (per R015 §3.AC.16). For every emitted span whose `parsedAddress.noteId` matches the delete target and whose surface is not in the §3.AC excluded set, the predicate MUST return `substitute(formatDeletionMarker(target, runDate, precision))`.

§2.DC.03:derives=R015.§3.AC.01 The markdown-body scanner adapter MUST emit `ReferenceSpan` records for every reference form `parseClaimReferences` recognizes: note-level braced (`{R005}`), claim-level fully qualified (`{R005.§1.AC.03}`), claim-level without section (`{R005.OQ.01}`), compact-multi (`{R005.§1.AC.01,.AC.03,.AC.05}`), range (`{R005.§1.AC.01-05}`, `{R005.§1.AC.01-AC.05}`), and braceless mentions where project configuration enables them.

§2.DC.04:derives=R015.§3.AC.02 The rewriter predicate MUST return `noop` for spans whose `parsedAddress.noteId` is undefined (within-document bare-section refs like `{§1.AC.03}` and `{AC.03}`) under both delete and rename.

§2.DC.05:derives=R015.§3.AC.03 The substituter MUST replace only the byte range corresponding to the note-ID portion of a span. Trailing inline metadata (e.g., ` [inherent]` following the closing brace) MUST be preserved verbatim in the surrounding text.

§2.DC.05a:derives=R015.§2.AC.03 The substituter MUST replace only the note-ID portion of every reference form covered by the worked-examples table in R015 §2.AC.03 (note-level braced, claim-level fully qualified, range, compact-multi, `:derives=TARGET`, and YAML scalar-list forms). The trailing claim path (section, claim prefix, claim number, range, compact-multi, sub-letter) MUST be preserved verbatim and appended after the marker. The substituter MUST NOT re-normalize, re-order, or canonicalize the trailing claim path.

§2.DC.06:derives=R015.§3.AC.04 The markdown-body scanner MUST inherit the existing parser's decoration-transparency for code spans, code fences, and other markdown emphasis. The substituter MUST preserve the surrounding decoration verbatim.

§2.DC.07:derives=R015.§3.AC.05 The rewriter engine MUST classify any span whose `parsedAddress.aliasPrefix` is defined as cross-project regardless of the local rewrite target, and MUST route it to a `warn-and-skip` `RewriteAction` carrying `reason: 'cross-project-alias'`, the file path, and the original text.

§2.DC.08:derives=R015.§3.AC.06 The source-code scanner adapter MUST emit `ReferenceSpan` records for braced claim references appearing inside `@implements`, `@validates`, `@addresses`, `@depends-on`, and `@see` annotation contexts.

§2.DC.09:derives=R015.§3.AC.07 The source-code scanner adapter MUST emit `ReferenceSpan` records for bare braced references appearing in source-code comments without an annotation prefix.

§2.DC.10:derives=R015.§3.AC.08 The test-name scanner adapter MUST emit `ReferenceSpan` records with `surface: 'source-string-literal'` for claim-address-shaped tokens it finds in test/it/describe call-site string literals. The rewriter predicate MUST return `audit-only` for every such span under both delete and rename. Test-name spans MUST NOT produce substitutions.

§2.DC.11:derives=R015.§3.AC.09 The frontmatter scanner adapter MUST emit `ReferenceSpan` records with `surface: 'frontmatter-list'` for note-ID-shaped entries in scalar list fields (e.g., `derives:`, `supersedes:`, `superseded_by:`), covering both bare-ID and claim-level forms.

§2.DC.12:derives=R015.§3.AC.10 The frontmatter scanner adapter MUST emit a `ReferenceSpan` with `surface: 'frontmatter-id'` only for the `id` field of the rewrite target's own note. Under rename the predicate substitutes to target ID; under delete the field is moot because the file is removed; the scanner MUST NOT emit `frontmatter-id` spans for any other note's `id` field.

§2.DC.13:derives=R015.§3.AC.11 The claim-metadata scanner adapter MUST emit `ReferenceSpan` records with `surface: 'claim-metadata-derives'` for every `:derives=TARGET` suffix and `surface: 'claim-metadata-superseded'` for every `:superseded=TARGET` suffix whose parsed TARGET note-ID matches the rewrite target. The substituter MUST replace only the note-ID portion of TARGET, preserving the trailing claim path.

§2.DC.14:derives=R015.§3.AC.12 The self-prefix scanner adapter MUST emit `ReferenceSpan` records for self-prefixed claim heading definitions (`### <NOTE_ID>.LOCK.03`) and self-prefixed bold-paragraph claim definitions (`**<NOTE_ID>.§3.LOCK.03**:`) only for the renamed note's own file. Under rename the predicate substitutes to target ID preserving trailing claim path; the scanner MUST NOT emit self-prefix spans for any other file.

§2.DC.15:derives=R015.§3.AC.13 Under delete, the self-prefix scanner adapter MUST NOT emit any spans for the deleted note's own file. The file is removed, and self-prefix forms disappear with it.

§2.DC.16:derives=R015.§3.AC.14 The filesystem-path scanner MUST resolve the rename target's filesystem entry via `NoteFileManager.noteIndex` and emit a `FilesystemRenamePlan` that renames the file (for file-based notes) or renames the folder + inner main file (for folder-based notes per {R008}). Companion files MUST move with the folder as a unit without individual rename.

§2.DC.17:derives=R015.§3.AC.15 The filesystem-path scanner MUST emit a `FilesystemRemovalPlan` under hard-delete that removes the file (for file-based notes) or the entire folder including all companion files (for folder-based notes). `NoteFileManager.removeNoteEntry` realizes the hard-unlink disposition per §3.DC.15.

§2.DC.18:derives=R015.§3.AC.16 The rewriter engine MUST scan project-markdown files outside the configured note-discovery paths (e.g., `docs/`, `README.md`, project-level architectural overviews) using the markdown-body scanner adapter. The engine MUST NOT restrict scanning to note-discovery paths. The discovery sweep (realized in `core/src/lifecycle/operations/file-discovery.ts`) MUST include archived notes (`_archive/`) because archived notes are preserved as valid reference targets per {R015.§1.AC.04}: references inside an archived note that cite a hard-deleted note become broken refs if not rewritten. The sweep MUST exclude soft-deleted notes (`_deleted/`) because soft-deleted notes are transient (the user may `purge` them) and keeping references inside them coherent is not worth the cost.

§2.DC.19:derives=R015.§4.AC.02 Under the `rename` operation, the rewriter MUST invoke every scanner adapter and apply `renameRewritePredicate` which returns `substitute(targetId)` for every non-excluded surface, `noop` for within-document bare-section refs and for cross-project alias refs, and additionally substitutes the renamed note's own `frontmatter-id` and `self-prefix-*` spans to the target ID.

§2.DC.20:derives=R015.§4.AC.03 Under the `archive` operation, the rewriter engine MUST NOT be invoked. The archive command path in `core/src/cli/commands/context/archive.ts` MUST remain unchanged with respect to reference rewriting.

§2.DC.21:derives=R015.§8.AC.02 When the rewriter encounters one or more cross-project spans during a run, it MUST accumulate per-span warnings naming the file path, the original text, and the operation name, and MUST surface them in both live-run output and dry-run output.

## §3 Atomicity Layer Design Claims

This cluster covers the safety guarantees that distinguish the rewriter from "a `sed` script with extra steps": the staging-area two-phase commit, the dirty-tree guard, the structured rewrite log (sufficient for replay-in-reverse), the dry-run preview, and the post-rewrite in-memory refresh. §3.DC.11–§3.DC.14 decompose the folder-unit atomicity invariant (R015.§6.AC.09) across the lifecycle operations; §3.DC.14 captures the existing-path bug-fix that Phase 4a sequences ahead of the new commands. §3.DC.15 captures the hard-delete file disposition (hard-unlink; the `_deleted/` graveyard is reserved exclusively for soft-delete).

Source ACs: {R015.§6.AC.01}–{R015.§6.AC.09}, {R015.§3.AC.15}, {R015.§9.AC.05}.

§3.DC.01:derives=R015.§6.AC.01 The rewriter MUST be two-phase: a `plan(operation)` phase that reads files and produces a `RewritePlan`, and an `apply(plan)` phase that commits via the staging area. The plan phase MUST NOT mutate any file. The apply phase MUST either commit every change in the plan or roll back every change; partial application is forbidden.

§3.DC.02:derives=R015.§6.AC.01 The staging area MUST write planned post-states into a staging directory under `_scepter/_lifecycle-staging/<run-id>/`. The commit step MUST use atomic POSIX rename to move staged files into their target paths. An interrupted run MUST leave no partially-rewritten target files; the next invocation MUST detect a stale staging directory and refuse to proceed until the operator clears it.

§3.DC.03:derives=R015.§6.AC.02 The dirty-tree guard MUST probe `git status --porcelain` against the project root and return `'clean'` / `'dirty'` / `'not-a-git-repo'`. The rewriter MUST refuse to run when status is `'dirty'` and the override flag is unset. Status `'not-a-git-repo'` MUST proceed without the guard.

§3.DC.04:derives=R015.§9.AC.05 The delete and rename commands MUST accept an override flag (name spec-layer) that propagates to `checkWorkingTreeClean` to permit operation against a dirty working tree.

§3.DC.05:derives=R015.§6.AC.03 Each successful mutating run MUST write a structured `RewriteLogEntry` to `_scepter/lifecycle-log/<timestamp>-<run-id>.json`. The entry MUST record, per touched file, the file path and a list of modified-region descriptors, each with byte range, before-text, after-text, and surface kind.

§3.DC.06:derives=R015.§6.AC.04 The `RewriteLogEntry` schema MUST be sufficient to compute an inverse plan that, when applied, restores the pre-operation state of every touched file. A future undo command surface is admitted by the schema; this DC does not author the command.

§3.DC.07:derives=R015.§6.AC.05 The delete and rename commands MUST accept a dry-run flag (name spec-layer) that runs only the `plan(operation)` phase and routes the resulting plan to `formatDryRun(plan)` instead of `stagingArea.prepare/.commit`. Dry-run MUST NOT mutate any file on disk.

§3.DC.08:derives=R015.§6.AC.06 After a successful apply, the rewriter MUST invoke `noteManager.refreshAfterRewrite(plan)` which re-reads every file in the plan and rebuilds the affected portions of the claim index, the reference graph, and the bidirectional reference store. The post-condition MUST be that subsequent CLI invocations (`trace`, `gaps`, `lint`, `show`) observe the post-operation state without manual re-indexing.

§3.DC.09:derives=R015.§6.AC.07 The dry-run formatter MUST emit a manifest that includes per-file/per-span before/after, the cross-project skipped-reference warnings (per §2.DC.21), and the test-name-embed audit list (per §2.DC.10) in a single rendering. The formatted output MUST be a superset of the rewrite-log entry schema.

§3.DC.10:derives=R015.§6.AC.08 The rewrite-log filename's timestamp portion MUST consume `timestampPrecision` via the existing `formatTimestamp` utility. Date-precision projects produce date-stamped log filenames; datetime-precision projects produce datetime-stamped log filenames. The setting is shared with the marker timestamp per §1.DC.05.

R015 §6.AC.09 (folder-unit atomicity, importance 5) is the high-binding invariant binding the folder-form atomicity guarantee across every lifecycle operation that mutates the working tree. It is decomposed below into four DCs: the invariant, the unit definition, the staging-and-commit primitive, and the existing-path bug-fix sequencing.

§3.DC.11:derives=R015.§6.AC.09 The atomicity guarantee defined in §3.DC.01 MUST apply to the full note unit for every lifecycle operation that mutates filesystem entries: archive, both delete modes (soft-delete and hard-delete), and rename. Either every file in the unit is acted on together, or none is. No lifecycle operation may produce a partial-folder result.

§3.DC.12:derives=R015.§6.AC.09 The note unit for atomicity purposes MUST be defined per {R008}: for file-based notes, the unit is the single `.md` file; for folder-based notes, the unit is the folder AND every companion file inside it (the root `.md` file plus every companion markdown file aggregated by the folder-note parser).

§3.DC.13:derives=R015.§6.AC.09 The staging-and-commit primitive realized in `core/src/lifecycle/atomicity/staging.ts` (per §3.DC.02) MUST expose three folder-unit-aware operations consumed by the lifecycle command paths: `NoteFileManager.removeNoteEntry` (used by hard-delete), `NoteFileManager.renameNoteEntry` (used by rename), and the folder-unit-aware path beneath `NoteFileManager.archiveNoteFile` and the soft-delete path beneath `NoteFileManager.deleteNoteFile` (used by archive and soft-delete respectively). Each MUST act on the folder unit defined in §3.DC.12 as a single staged-and-committed transaction.

§3.DC.14:derives=R015.§6.AC.09 The existing `NoteFileManager.archiveNoteFile` and `NoteFileManager.deleteNoteFile` (soft-delete) code paths — which today operate on the root `.md` file only and leave folder-form companion files behind — MUST be brought into compliance with §3.DC.11–§3.DC.13. The refactor is behavior-preserving with respect to the soft-delete and archive observable semantics (companion files now move with the folder; nothing else changes). The refactor MUST sequence before the new hard-delete and rename command code paths per Phase 4a (see §9 Integration Sequence).

§3.DC.15:derives=R015.§3.AC.15 The hard-delete operation MUST remove the note unit from the filesystem outright (the file for file-based notes; the folder and every companion file for folder-based notes). Hard-delete MUST NOT relocate the note to `_deleted/`. The `_deleted/` graveyard location is reserved exclusively for the soft-delete code path and its `restore`/`purge` lifecycle; hard-delete bypasses that subsystem entirely. `NoteFileManager.removeNoteEntry` MUST realize this disposition.

## §4 Lifecycle Command Surface Design Claims

This cluster covers the `delete` and `rename` CLI command surfaces and the file-manager primitives they invoke. `scepter delete` carries TWO code paths under this DD: the preserved default soft-delete path (relocate to `_deleted/`, append `#deleted` tag, keep inbound references intact — passed through unchanged from the existing implementation, modulo the Phase 4a folder-atomicity refactor) and the new opt-in hard-delete path behind a flag (remove the note unit outright per §3.DC.15, invoke the rewriter, persist a rewrite-log entry). The DCs below describe the hard-delete code path and the new `rename` command; the soft-delete pass-through is captured in §4.DC.00.

Source ACs: {R015.§1.AC.01}–{R015.§1.AC.06}, {R015.§9.AC.01}–{R015.§9.AC.04}, {R015.§9.AC.08}, {R015.§9.AC.09}.

R015.§1.AC.01 (two-mode delete) and R015.§1.AC.02 (rename) are flagged high-binding by the reviewer pass. R015.§1.AC.01's hard-delete portion decomposes into §4.DC.01–§4.DC.05; its soft-delete portion is captured in §4.DC.00; R015.§1.AC.02 yields §4.DC.06–§4.DC.10.

§4.DC.00:derives=R015.§1.AC.01 The `delete` command's default behavior (soft-delete) MUST be preserved unchanged from the existing implementation: the note unit relocates to `_deleted/`, the `#deleted` tag is appended, and inbound references remain intact. The existing `restore`/`purge`/`#deleted`-tag subsystem (`core/src/references/reference-manager.ts:238–380` and the surrounding `restore-handler` / `purge-handler` code paths) continues to serve this mode unchanged. The only modification to the soft-delete code path is the Phase 4a folder-atomicity refactor per §3.DC.14, which is behavior-preserving.

§4.DC.01:derives=R015.§1.AC.01 Under the hard-delete mode (opt-in via the flag per R015.§9.AC.09), the `delete` command MUST invoke `NoteFileManager.removeNoteEntry(noteId)` (or the staging-staged equivalent) such that the note's file (or folder for folder-form notes) is removed from its discovery location after a successful commit. Hard-delete bypasses the `_deleted/` graveyard per §3.DC.15.

§4.DC.02:derives=R015.§1.AC.01 Under the hard-delete mode, the `delete` command MUST invoke `rewriter.plan('delete', noteId)` and `rewriter.apply(plan)` such that every inbound reference matching the §2 scanner-and-predicate dispatch is rewritten to the marker form produced by §1.DC.01. Soft-delete MUST NOT invoke the rewriter.

§4.DC.03:derives=R015.§1.AC.01 The marker token substituted for every inbound reference during a single hard-delete invocation MUST be the same token — `formatDeletionMarker(target, runDate, precision)` computed once at the start of the run and reused for every span — so that all rewritten references in the project carry the same timestamp.

§4.DC.04:derives=R015.§1.AC.01 Under the hard-delete mode, the file removal and the inbound rewrite MUST be staged together and committed together. A failure during inbound rewrite MUST roll back the file removal; a failure during file removal MUST roll back the inbound rewrite. (Realized via §3.DC.01 staging two-phase.)

§4.DC.05:derives=R015.§1.AC.01 After a successful `delete` invocation under EITHER mode, the note's ID MUST NOT be reused by any subsequent `scepter create` invocation. The existing monotonicity rule in `NoteIdGenerator` MUST continue to hold; no code path is added that recycles a deleted ID. Under hard-delete the ID slot MAY be reclaimed by a subsequent `rename` per §4.DC.13; under soft-delete the ID slot remains held until a subsequent `purge`.

§4.DC.06:derives=R015.§1.AC.02 The `rename` command MUST invoke `NoteFileManager.renameNoteEntry(sourceId, targetId)` (or the staging-staged equivalent). For file-based notes, the file is renamed in place; for folder-based notes per {R008}, the folder is renamed and the inner main file is renamed, with companion files moving with the folder.

§4.DC.07:derives=R015.§1.AC.02 The `rename` command MUST update the renamed note's frontmatter `id` field to the target ID. The frontmatter scanner MUST emit a `frontmatter-id` span for the renamed note's file; the predicate substitutes to target.

§4.DC.08:derives=R015.§1.AC.02 The `rename` command MUST rewrite self-prefixed claim definitions (heading-form `### <SOURCE>.LOCK.03` and bold-paragraph-form `**<SOURCE>.§3.LOCK.03**:`) inside the renamed note to use the target ID, preserving the trailing claim path verbatim. (Realized via §2.DC.14 self-prefix scanner.)

§4.DC.09:derives=R015.§1.AC.02 The `rename` command MUST rewrite every inbound reference matching the §2 scanner-and-predicate dispatch from source ID to target ID. Trailing claim paths and metadata MUST be preserved verbatim.

§4.DC.10:derives=R015.§1.AC.02 All five behaviors above (filesystem rename, frontmatter `id` update, self-prefix rewrite, inbound rewrite, atomicity coordination) MUST be staged together and committed together. A failure in any one MUST roll back the others. (Realized via §3.DC.01 staging two-phase.)

§4.DC.11:derives=R015.§1.AC.03 The `rename` handler MUST validate the target ID via `isValidNoteId` and reject the operation when validation fails. The handler MUST also reject the operation when the target ID is the ID of any live note in the local project at the time of invocation. The target MAY be the ID previously held by a deleted note.

§4.DC.12:derives=R015.§1.AC.04 The `archive` command path in `core/src/cli/commands/context/archive.ts` MUST remain unchanged. No rewriter invocation, no reference-rewriting flag, no dirty-tree guard tied to reference rewriting is added.

§4.DC.13:derives=R015.§1.AC.05 The compound case "delete X, then rename Y → X" MUST be supported as a sequence of two primitive invocations with no additional command. The deletion marker form `_deleted_X_at_<timestamp>` produced by the first invocation is by §1.DC.02 not confusable with the live ID `X` re-occupied by the second invocation.

§4.DC.14:derives=R015.§1.AC.06 Each of the `delete` and `rename` commands MUST be exposed as a CLI command (subcommand of the top-level `scepter` binary) accepting the affected note ID(s) as positional argument(s).

§4.DC.15:derives=R015.§9.AC.01 A `delete` CLI command MUST exist accepting the note ID as a positional argument. Command name preserved from the existing `scepter delete`; default behavior preserved per §4.DC.00; hard-delete code path added behind the flag per §4.DC.01–§4.DC.05.

§4.DC.16:derives=R015.§9.AC.02 A `rename` CLI command MUST be added accepting the source note ID and the target note ID as positional arguments.

§4.DC.17:derives=R015.§9.AC.03 The existing `archive` CLI command MUST be preserved unchanged with no reference-rewriting flag added. (Reaffirms §4.DC.12 at the CLI-surface layer.)

§4.DC.18:derives=R015.§9.AC.04 Both `delete` and `rename` MUST accept a dry-run flag (name spec-layer) that routes through §3.DC.07 to print the manifest without mutating files.

§4.DC.19:derives=R015.§9.AC.08 The rewrite-log surface authored by §3.DC.05 and §3.DC.06 MUST be designed to admit a replay-in-reverse (undo) invocation. The exact form — `--undo` flag on `delete`/`rename`, a separate `undo` subcommand, or other shape — is spec-layer. This DC does not mandate that v1 ship an undo implementation.

§4.DC.20:derives=R015.§1.AC.02 The `rename` handler MUST reject the operation when the source ID equals the target ID. The rejection MUST emit a clear error message before any mutation begins. (Captures the Edge Case stated in R015 prose.)

§4.DC.21:derives=R015.§9.AC.09 The `scepter delete` CLI command MUST expose a flag that toggles between soft-delete (default) and hard-delete (opt-in). The flag name is spec-layer. The flag's default state MUST select the preserved soft-delete code path per §4.DC.00; the flag's opt-in state MUST select the hard-delete code path per §4.DC.01–§4.DC.05.

## §5 Consumer-Recognition Design Claims

This cluster covers the consumption-layer modules that resolve references — linter, trace command, gaps command, reference-graph index, `scepter ctx show` — and the branches they MUST add to recognize tombstoned references as a known lifecycle state rather than degrading them to broken-reference errors. The default rendering excludes tombstoned references from coverage matrices and gap reports; opt-in flags surface them in dedicated audit columns and `orphan-derives` categories.

Source ACs: {R015.§5.AC.01}–{R015.§5.AC.07}, {R015.§9.AC.06}, {R015.§9.AC.07}.

§5.DC.01:derives=R015.§5.AC.01 `validateDerivationLinks` and `validateLifecycleTags` in `core/src/cli/commands/claims/lint-command.ts` MUST short-circuit the `invalid-derivation-target` and `invalid-supersession-target` checks when the parsed TARGET note-ID portion satisfies `isDeletionMarker`. Tombstoned targets MUST NOT be reported as broken-reference errors.

§5.DC.02:derives=R015.§5.AC.02 The linter MUST support an opt-in flag (name spec-layer) that surfaces a `tombstoned-target-audit` category enumerating every claim whose `:derives=` or `:superseded=` TARGET is tombstoned. Without the flag, the audit MUST be silent.

§5.DC.03:derives=R015.§9.AC.07 The lint CLI surface MUST expose the flag that toggles the tombstoned-target audit listing. Flag name is spec-layer.

§5.DC.04:derives=R015.§5.AC.03 `buildTraceabilityMatrix` in `core/src/claims/traceability.ts` MUST filter out trace-matrix entries whose source or target claim address resolves through a tombstoned note-ID (via `isDeletionMarker` on the raw token). The default matrix MUST contain only live coverage relationships.

§5.DC.05:derives=R015.§5.AC.04 The trace command MUST support an opt-in flag (name spec-layer) that surfaces tombstoned references as a separate deleted-origin column in the trace output. The column header and rendering format are spec-layer.

§5.DC.06:derives=R015.§9.AC.06 The trace CLI surface MUST expose the flag that toggles the tombstoned-references column. Flag name is spec-layer.

§5.DC.07:derives=R015.§5.AC.05 `findGaps` MUST exclude tombstoned references from generic gap analysis by default. A claim whose `:derives=` TARGET is tombstoned MUST be surfaced as a distinct `orphan-derives` category (the deriving claim has lost its anchor), not as a generic gap.

§5.DC.08:derives=R015.§5.AC.06 The reference-graph index in `core/src/references/reference-manager.ts` MUST record tombstoned edges in a form that distinguishes them from live edges (e.g., an `isTombstoned: boolean` flag on the edge record). A tombstoned edge's target MUST resolve as a synthetic deleted-note entity carrying the parsed original ID and timestamp recovered via `parseDeletionMarker`.

§5.DC.09:derives=R015.§5.AC.07 `scepter ctx show` MUST detect when its argument satisfies `isDeletionMarker` and resolve it to the corresponding rewrite-log entry rather than treating it as an unknown note ID. The output SHOULD include the original ID, the deletion timestamp, and the file modification record from the log. Whether the original note body is preserved alongside the log is {R015.OQ.02}; absent resolution, the minimum-viable output is the rewrite-log summary.

## §6 VS Code Editor-Surface Design Claims

This cluster covers the VS Code extension's reference-resolution surfaces (diagnostics, hover, definition-jump, decoration) and the per-provider branches that MUST recognize tombstoned references as a known lifecycle state. The extension's existing unresolved-reference machinery would degrade tombstoned references to error diagnostics without these branches; the goal is that an editor user encountering a tombstoned reference sees deletion provenance rather than a broken-reference squiggle.

Source ACs: {R015.§11.AC.01}–{R015.§11.AC.04}.

§6.DC.01:derives=R015.§11.AC.01 The diagnostic-producing code path that feeds `DiagnosticsProvider` in `vscode/src/diagnostics-provider.ts` MUST short-circuit the `unresolved-reference` diagnostic (severity Warning per line 37) when the parsed note-ID portion of a reference satisfies `isDeletionMarker`. Tombstoned references MUST NOT raise unresolved-reference diagnostics.

§6.DC.02:derives=R015.§11.AC.02 `ClaimHoverProvider.provideHover` in `vscode/src/hover-provider.ts` MUST detect tombstoned references via `isDeletionMarker` and produce hover content presenting the deletion event at minimum (original note ID + deletion timestamp parsed via `parseDeletionMarker`). The hover SHOULD additionally surface the rewrite-log entry as provenance when the entry is available.

§6.DC.03:derives=R015.§11.AC.03 The definition-resolution path in `vscode/src/definition-provider.ts` MUST detect tombstoned references and either return a recognized no-op (with operator-visible status) or jump to the rewrite-log entry. The exact form is spec-layer. The provider MUST NOT fail as if the reference were broken.

§6.DC.04:derives=R015.§11.AC.04 `vscode/src/decoration-provider.ts` MUST register a decoration type that applies to ranges matching `DELETION_MARKER_RE` so a styling distinction between tombstoned and live references is available. The specific visual treatment (color, italic, opacity, badge) is spec-layer.

## §7 Cross-Project Safety Design Claims

This cluster covers the rewriter's hands-off behavior at the local project's authority boundary. Cross-project alias-prefixed references (per R011's alias-prefix grammar) MUST be detected and skipped under every operation, even when the local rewrite target's ID matches the cited peer ID, and warnings MUST surface so the user can manually notify peer maintainers if appropriate.

Source ACs: {R015.§8.AC.01}–{R015.§8.AC.03}.

§7.DC.01:derives=R015.§8.AC.01 The rewriter engine MUST detect cross-project alias-prefixed spans via `span.parsedAddress.aliasPrefix !== undefined` and MUST classify them as `warn-and-skip` regardless of operation, regardless of whether the local rewrite target's ID happens to match the cited peer ID. (Realized via §2.DC.07.)

§7.DC.02:derives=R015.§8.AC.02 When the rewriter encounters a cross-project reference during a run, the engine MUST emit a warning carrying the file path, the original reference text, and the operation name. The warning MUST appear in both live-run output and dry-run output. (Realized via §2.DC.21 and §3.DC.09.)

§7.DC.03:derives=R015.§8.AC.03 When a `rename` is invoked against a note that peer projects cite via alias, the rewriter SHOULD emit an additional "downstream peer references may break" warning naming the source ID, the target ID, and the recommendation that the user notify the maintainers of any peer projects that may cite the renamed note. The warning surface is the same as §7.DC.02.

## §8 Agent-Facing Documentation Design Claims

This cluster covers the documentation surfaces an AI agent reads when learning the lifecycle vocabulary — the canonical `claims.md`, the entry-point `SKILL.md`, and the reviewer/producer companion files. The new content teaches the tombstone lifecycle state (format, parser-invisibility property, recognized-not-broken framing), adds a Common Mistakes row, and distinguishes the four lifecycle moves (soft-delete, hard-delete, archive, rename) so agents do not conflate them.

Source ACs: {R015.§10.AC.01}–{R015.§10.AC.04}.

§8.DC.01:derives=R015.§10.AC.01 `claude/skills/scepter/claims.md` MUST gain a section teaching the tombstone lifecycle state: the marker format per R015 §2.AC.01, the parser-invisibility property per R015 §2.AC.02, and the principle "a tombstoned reference is a recognized lifecycle state, not a broken reference." Placement is alongside the existing "Lifecycle Tags" section.

§8.DC.02:derives=R015.§10.AC.02 The Common Mistakes table in `claude/skills/scepter/claims.md` MUST gain a row: failure-mode "treating tombstoned references as broken-reference lint errors" → correction "tombstoned references are a recognized lifecycle state, not a lint violation."

§8.DC.03:derives=R015.§10.AC.03 `claude/skills/scepter/claims.md` (or another skill-companion file consulted at authoring time) MUST gain authoring-discipline content distinguishing when delete, archive, and rename are the correct lifecycle move, surfacing the principles from R015's Design Principles section (archive preserves a referenceable note; delete retires with loud tombstoning; rename relocates silently).

§8.DC.04:derives=R015.§10.AC.04 `claude/skills/scepter/SKILL.md` and the reviewer/producer documentation surfaces (`reviewing.md`, `conformance.md`) MUST teach the distinction between the tombstoned-state lifecycle (note-ID-level, externally applied to inbound references) and claim-level lifecycle tags (`:removed`, `:superseded=` from {R005}) so authors do not conflate the two surfaces. The CLI help text for the commands whose surfaces change under this requirement MUST be updated accordingly: `scepter delete` (gains the soft-vs-hard mode flag per R015 §9.AC.09 and the dry-run / dirty-tree override flags per R015 §9.AC.04–§9.AC.05), `scepter rename` (new command per R015 §9.AC.02), `scepter claims trace` (gains the tombstoned-references flag per R015 §9.AC.06), `scepter claims gaps` (surfaces the `orphan-derives` category per §5.DC.07), and `scepter claims lint` (gains the tombstoned-target audit flag per R015 §9.AC.07).

## §9 Integration Sequence

The sequencing respects the "refactor before features" discipline from `implementing.md`: anything that changes existing types or extends existing modules sequences before new commands. Each phase has a verifiable acceptance gate.

### Phase 1: Marker module + parser-side recognition support

Files:

- ADD `core/src/lifecycle/deletion-marker.ts` (module A)
- MODIFY `core/src/parsers/claim/claim-parser.ts` if Phase-1's load-bearing decision (§10.OQ.01 below) goes the route of teaching the parser a `tombstoneToken` field; otherwise no parser change is needed.

Acceptance gate: `formatDeletionMarker('R005', new Date('2026-05-19'), 'date')` returns `_deleted_R005_at_20260519`. `isDeletionMarker('_deleted_R005_at_20260519')` returns true. `parseDeletionMarker('_deleted_R005_at_20260519')` returns `{ originalId: 'R005', timestamp: '20260519' }`. The marker does NOT match `NOTE_ID_RE`. Unit tests cover both date and datetime precision.

Covers: §1.DC.01–§1.DC.06.

### Phase 2: Consumer recognition (linter, trace, gaps, reference graph, ctx show)

Files:

- MODIFY `core/src/cli/commands/claims/lint-command.ts` (E1)
- MODIFY `core/src/cli/commands/claims/trace-command.ts` + `core/src/claims/traceability.ts` (E2)
- MODIFY `core/src/cli/commands/claims/gaps-command.ts` + `core/src/claims/traceability.ts` (E3)
- MODIFY `core/src/references/reference-manager.ts` (E4)
- MODIFY `core/src/cli/commands/context/show.ts` + `show-handler.ts` (E5)

Acceptance gate: Hand-craft a fixture project containing a note with `:derives=_deleted_R005_at_20260519.§1.AC.03`. `scepter claims lint <note>` does NOT emit `invalid-derivation-target`. With the spec-chosen audit flag, the lint surfaces a `tombstoned-target-audit` entry. `scepter claims trace <note>` omits the tombstoned edge; with the spec-chosen flag it shows the deleted-origin column. `scepter claims gaps` surfaces the deriving claim under `orphan-derives`. `scepter ctx show _deleted_R005_at_20260519` returns the (initially stub) rewrite-log entry path.

Covers: §5.DC.01–§5.DC.09.

Why before the rewriter: Phase 2 validates that the system tolerates tombstoned references end-to-end before the rewriter actually emits them. Hand-crafted fixture markers exercise every consumer; bugs surface in isolation. The rewriter (Phase 3+) then produces those markers under known-good consumer conditions.

### Phase 3: Rewriter engine, scanner adapters, atomicity layer

Files:

- ADD `core/src/lifecycle/rewriter.ts` (B1)
- ADD `core/src/lifecycle/scanners/markdown-body-scanner.ts`, `source-code-scanner-adapter.ts`, `frontmatter-scanner.ts`, `claim-metadata-scanner.ts`, `self-prefix-scanner.ts`, `filesystem-path-scanner.ts` (B2)
- ADD `core/src/lifecycle/atomicity/staging.ts`, `dirty-tree-guard.ts`, `rewrite-log.ts`, `dry-run-formatter.ts` (C1–C5)
- MODIFY `core/src/notes/note-manager.ts` to add `refreshAfterRewrite(plan)` (C4)

Deferred to Phase 6: `test-name-scanner.ts` — pending {R015.OQ.01}.

Acceptance gate: Unit tests on each scanner adapter against synthetic fixtures (one per `surface` value). Unit tests on `rewriter.plan` against multi-file fixtures verifying the predicate dispatch table (delete substitutes; rename substitutes; archive predicate trivially no-ops; alias refs warn-and-skip; bare-section refs no-op). Unit tests on `stagingArea` verifying atomic commit and rollback. Unit tests on `dryRunFormatter` verifying output is a superset of the rewrite-log entry shape.

Covers: §2.DC.01–§2.DC.21, §3.DC.01–§3.DC.10, §7.DC.01–§7.DC.02.

### Phase 4a: Existing-path folder-atomicity bug-fix

Sequencing rationale: per `implementing.md`'s "refactor before features" discipline, behavior-preserving changes to existing infrastructure sequence before feature additions. The new hard-delete and rename command paths depend on the atomicity primitive being correct on the existing soft-delete and archive paths first, so the refactor lands and is verified in isolation before new command surface stacks on top of it.

Files:

- MODIFY `core/src/notes/note-file-manager.ts` — refactor `archiveNoteFile` and the soft-delete code path in `deleteNoteFile` to use the new folder-unit-aware atomicity primitive (per §3.DC.13–§3.DC.14). Behavior-preserving with respect to observable semantics; the only change is that companion files of folder-form notes now move with the folder rather than being left behind.

Acceptance gate: existing `scepter archive` and `scepter delete` (soft-delete default) commands operate atomically on folder-form notes. New test coverage for folder-form archive and soft-delete demonstrates the partial-folder defect is fixed. Existing single-file-form behavior is unchanged. Soft-delete continues to invoke the `restore`/`purge`/`#deleted` tag subsystem unchanged.

Covers: §3.DC.11–§3.DC.14 (existing-path portion).

### Phase 4b: New command code paths

Files:

- MODIFY `core/src/cli/commands/context/delete.ts` + `delete-handler.ts` (D1) — add flag branching for the new hard-delete mode (default remains soft-delete, preserved). Hard-delete invokes the rewriter; soft-delete continues to invoke the existing code path now refactored in Phase 4a.
- MODIFY `core/src/notes/note-manager.ts` (`deleteNote` wrapper) — add flag branching to dispatch between the preserved soft-delete logic and the new hard-delete rewriter pipeline.
- ADD `core/src/cli/commands/context/rename.ts` + `rename-handler.ts` (D2)
- MODIFY `core/src/notes/note-file-manager.ts` — add `removeNoteEntry` (hard-unlink per §3.DC.15) and `renameNoteEntry` aligned with the staging-area workflow

Sequencing: depends on Phase 4a. The atomicity primitive used by the new methods must already be in place and verified by the existing-path tests.

Acceptance gate: Integration tests on a temp fixture project. (a) `scepter delete R005 --dry-run` (whatever flag name) under the hard-delete flag prints manifest, does not mutate disk. (b) `scepter delete R005` with the hard-delete flag against dirty git tree refuses without override. (c) `scepter delete R005` with the hard-delete flag against clean tree applies the rewrite, removes the note's file, persists the log. (d) Post-hard-delete: `scepter claims lint` is clean (no broken-reference errors), `scepter claims trace` shows absence of R005 in the live matrix. (e) `scepter delete R005` WITHOUT the hard-delete flag continues to soft-delete: note relocates to `_deleted/`, inbound references intact, restore/purge subsystem unchanged. (f) `scepter rename R005 R042` against clean tree renames file, frontmatter `id`, self-prefixes, inbound refs; post-rename, `scepter ctx show R042` works and `scepter ctx show R005` reports absence. (g) Compound case: `delete --hard R005`, then `rename R007 R005` — old refs are tombstoned, new refs to R005 resolve to the post-rename note. (h) `rename R005 R005` is rejected. (i) `rename R005 <ID-of-live-note>` is rejected.

Covers: §3.DC.15, §4.DC.01–§4.DC.20, §7.DC.03.

### Phase 5: VS Code editor surface + agent-facing documentation

Files:

- MODIFY `vscode/src/diagnostics-provider.ts` (F1)
- MODIFY `vscode/src/hover-provider.ts` (F2)
- MODIFY `vscode/src/definition-provider.ts` (F3)
- MODIFY `vscode/src/decoration-provider.ts` (F4)
- MODIFY `claude/skills/scepter/claims.md` (G1)
- MODIFY `claude/skills/scepter/SKILL.md` (G2)

Acceptance gate: VS Code: hover on a tombstoned reference shows the deletion provenance; diagnostic does not flag it as unresolved; go-to-definition behaves per the spec-chosen form; decoration distinguishes the reference visually. Documentation: agents reading `claims.md` learn the marker form, the parser-invisibility property, the Common Mistakes entry, and the delete-vs-archive-vs-rename discipline. The lifecycle distinction (note-level tombstone vs. claim-level `:removed`/`:superseded=`) is teachable from `SKILL.md` or its routing tree.

Covers: §6.DC.01–§6.DC.04, §8.DC.01–§8.DC.04.

### Phase 6: Test-name-embed scanner (OQ.01-dependent)

Files:

- ADD `core/src/lifecycle/scanners/test-name-scanner.ts` (B2)
- MODIFY rewriter dispatch to wire the new scanner

Acceptance gate: After {R015.OQ.01} resolution determines the scanning surface (only `test`/`it`/`describe` call sites vs. all string literals) and the audit-delivery form (inline in dry-run vs. separate report). Unit tests against synthetic fixtures.

Covers: §2.DC.10 (test-name scanner authoring), and the §6.AC.07 audit-list-in-dry-run inclusion at the surface level (the framing DC §3.DC.09 covers the formatter; this phase wires the scanner that feeds it).

## §10 Open Questions

§10.OQ.01 — Tombstone-token handling in the claim parser. Phase 1 contains a load-bearing decision: when the parser encounters `_deleted_R005_at_20260519.§1.AC.03` as a `:derives=TARGET`, should it (a) bind the address with `noteId: undefined` and a new `tombstoneToken` field on `ClaimAddress`, or (b) leave the parser entirely tombstone-unaware and require consumers to inspect the raw metadata text via `parseMetadataSuffix` + `isDeletionMarker`? Option (a) is more ergonomic for consumers but adds a field to the canonical `ClaimAddress` interface that every reader has to know about. Option (b) keeps `ClaimAddress` clean but requires every consumer to do double-parse work. The DCs in §5 are authored against option (b) because it preserves R015 §2.AC.02's parser-invisibility invariant most strictly. **Resolution path (2026-05-19): deferred to the specification or implementation phase.** This DD's §5 DCs continue to assume the consumer-double-parse path; the OQ remains on record to flag that this is a structural-design choice the spec or implementing agent may revisit.

§10.OQ.02 — CLI flag names (deferred to spec). R015 deliberately leaves all flag names spec-layer. This DD names the surfaces (dry-run flag on delete and rename, dirty-tree override flag on delete and rename, tombstoned-trace flag, tombstoned-lint-audit flag) without committing to flag strings. The downstream specification artifact is the authoring surface for `--dry-run` vs `-n`, `--force` vs `--allow-dirty`, etc.

§10.OQ.03 — Atomicity-staging directory shape. §3.DC.02 asserts a staging directory under `_scepter/_lifecycle-staging/<run-id>/` and an atomic `fs.rename` commit. POSIX `rename` is atomic within a filesystem, but cross-filesystem renames degrade to copy-then-unlink. Whether the staging directory MUST be on the same filesystem as the project root, and how the rewriter handles cross-filesystem project layouts, is implementation-stage work. The §6.AC.01 invariant survives either path; the mechanism is open.

§10.OQ.04:closed — Soft-delete graveyard vs. hard unlink. Resolved 2026-05-19: hard-delete unlinks outright; `_deleted/` is reserved exclusively for soft-delete. Resolution realized as §3.DC.15. R015.§3.AC.15 remains spec-layer-open at the requirement layer, but this DD commits to the hard-unlink disposition.

§10.OQ.05 — In-memory refresh granularity. §3.DC.08 mandates post-rewrite in-memory consistency but does not specify whether the claim index, reference graph, and bidirectional reference store are rebuilt incrementally (per touched file) or holistically (full re-index). The observable post-condition is identical; the implementation-stage choice is performance vs. simplicity.

## §11 Out of Scope (Deferred Within DD Scope)

Every R015 AC is addressed by at least one DC above. No R015 ACs are out of scope at the DD layer.

Items R015 itself marks Non-Goal (claim-level rewriting, `consolidate` operation, automatic test-name rewriting, parser-invalid form rewriting, cross-project rewriting, `--undo` as binding, versioned marker formats, deleted-note-body preservation) are out of scope of R015 and therefore out of scope of this DD; no DC coverage is required for them.

{R015.OQ.01} (test-name scanning surface) is the source of Phase 6's dependency; the resolution of OQ.01 belongs to a downstream spec or the implementing agent's checkpoint with the user. {R015.OQ.02} (original-note-body preservation) is referenced by §5.DC.09's "absent resolution" qualifier. {R015.OQ.03} (`ctx show <marker>` semantics) is the source of §5.DC.09's "minimum-viable" qualifier — §5.DC.09 commits the DD to surfacing the rewrite-log summary at minimum, leaving richer output (e.g., listing every file that historically referenced the original ID) for downstream resolution. {R015.OQ.04} (markdown decoration coverage) is delegated to §2.DC.06's reliance on the parser's decoration-transparency surface; closing the enumeration of decorations the parser sees through is downstream-spec work and does not change any DC authored here.

## Status

- 2026-05-19 — DD authored. Decomposes R015 across the marker module, rewriter engine and scanner adapters, atomicity layer, lifecycle command surface, consumer-recognition modules, VS Code editor surface, agent-facing documentation, and cross-project safety. Every R015 AC is realized by at least one DC. Phase ordering: Marker module → Consumer recognition (with hand-crafted fixtures) → Rewriter engine + scanner adapters + atomicity → Delete and rename commands → VS Code + documentation → Test-name-embed scanner (OQ.01-gated).
- 2026-05-19 — Cleanup pass: §1.AC.01 reframed to two delete modes in R015; §4 lifecycle command surface preamble added clarifying the two delete code paths (soft-delete preserved, hard-delete new); Module Inventory section D updated to enumerate the preserved soft-delete subsystem (`restore`, `purge`, `#deleted` tag updates) alongside the modified hard-delete and shared atomicity primitives. Phase 4 split into Phase 4a (existing-path folder-atomicity bug-fix, behavior-preserving) and Phase 4b (new command code paths). §3.DC.15 added asserting hard-delete file disposition is hard-unlink (the `_deleted/` graveyard is reserved exclusively for soft-delete); §10.OQ.04 closed against this resolution. §10.OQ.01 marked as deferred to spec or implementation phase; the DD's consumer-double-parse posture in §5 is the operating assumption pending revisit. Per-section preambles added to §1–§3 and §5–§8 to summarize what each cluster covers. §8.DC.04 already enumerated the affected CLI help-text surfaces; no change.
- 2026-05-19 — Reviewer-followup pass: closed §5.DC.02-§5.DC.08 (consumer recognition — lint tombstoned-target-audit category + flag, trace tombstoned-references filter + column flag, findGaps orphan-derives, ReferenceManager tombstoned edges), §7.DC.03 (peer rename warning), aligned Module Inventory line numbers (`archiveNoteFile`/`deleteNoteFile`/`ClaimHoverProvider`), added missing tests (compound swap delete-then-rename, folder-form hard-delete, rename-handler validation gates), documented `_archive` inclusion in discovery scope (§2.DC.18 expanded).
- 2026-05-19 — Followup cleanup surfaced: {T004} captures removal of the stubbed `#deleted` reference-update subsystem in `reference-manager.ts` and `note-manager.ts:797`. The stub is out of scope of this DD (this DD's hard-delete path uses the new rewriter directly; the legacy stub services only soft-delete and writes nothing). T004 runs independently after this implementation lands.
