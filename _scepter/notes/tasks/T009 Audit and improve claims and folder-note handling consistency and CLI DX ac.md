---
created: 2026-06-23T01:33:01.587Z
tags:
  - dx
  - claims
  - folder-notes
  - audit
  - consistency
confidence: 🤖2 2026-06-23
---

# T009 - Audit and improve claims and folder-note handling consistency and CLI DX across the project

**Created:** 2026-06-23
**Type:** Umbrella audit / scoping task (not finished work — research scoping)
**Related:** {R008}, {S002}, {DD010}, {A002}, {R015}, {DD020}, {R016}, {DD022}, {DD021}, {DD015}, {DD006}, {A001}, {T007}, {T008}

## Problem / Motivation

SCEpter has grown two cross-cutting concepts — **claims** and **folder notes** — that every surface (note discovery/loading, claim aggregation/indexing, `show`/`gather`/`list`/`search`, the lifecycle rewriter, the formatters, and the VS Code extension) must honor. Both concepts were introduced incrementally, with each requirement ({R008} folder-note aggregation, {R004}/{R005}/{R011}/{R012} claim grammar consolidated into {S002}, {R015}/{R016} lifecycle and audit) touching the surfaces it needed and leaving the others to "catch up later." The result is a system where a folder note is folder-aware on some paths (claim index, lint, lifecycle move) and silently flat on others (`show`, `gather` by default, full-text `search`); and where the CLI's developer experience has drifted into three competing conventions for the same idea (JSON output) and a project-root resolution that behaves differently per command.

This is the **umbrella** task for project-wide consistency of (a) claims handling and (b) folder-note handling, plus a broader **DX-consistency scoping pass** over the CLI. It is the parent under which specific instances live. Two such instances already exist as separate tasks — {T007} (project-root resolution by walking up from cwd) and {T008} (folder-note-aware rendering in `show`/`gather`). This task's job is to find the OTHER instances like them and prioritize the whole set. It does NOT duplicate or supersede {T007}/{T008}; it references them as in-scope-but-separate concrete instances.

The motivation to do this now: the unified resolver ({DD021}) and project-wide lint audit ({R016}/{DD022}) have just landed, which means the *claim* side finally has a single resolution primitive — the right moment to audit whether every consumer actually routes through it, and to extend the same "one primitive, all consumers conform" discipline to folder notes and to CLI ergonomics before the next wave of features re-forks the surfaces.

## Current State (research findings)

### Folder-note handling

The folder-note data model is solid and lives in `core/src/notes/folder-utils.ts` (`detectFolderNote`, `scanFolderContents`/`scanFolderContentsSync`, `getFolderFileMetadata`). A folder note is a directory whose name begins with the note ID, containing a main `<ID>.md` plus companion `.md` files and asset files. {R008} defines the aggregation contract; {S002.§9} is the consolidated rule set (companion sub-files are NOT independently referenceable per {S002.§9.AC.04}).

The gestalt problem is that **"a folder note's content" exists in two incompatible representations, and different consumers read different ones.** There is the aggregated form — main file plus alphabetized, frontmatter-stripped companion `.md` bodies, produced by `NoteFileManager.getAggregatedContents()` (`core/src/notes/note-file-manager.ts:192`) and its sync mirror `getAggregatedContentsSync` (`:241`). And there is the flat form — the main file body only, produced by `getFileContents()` (`core/src/notes/note-file-manager.ts:158`) and carried on the in-memory `Note.content` field (populated from the main file at `note-file-manager.ts:224`/`:266`). Folder-awareness is, in practice, "did this consumer remember to call `getAggregatedContents` instead of reading `getFileContents`/`Note.content`?"

**Folder-aware surfaces (call `getAggregatedContents`):**
- Claim index loading — `ensure-index.ts:83` populates `NoteWithContent.content` via `getAggregatedContents`, so `ClaimIndex.build()` at `claim-index.ts:400`/`:679` sees companion claims even though it reads `note.content`. The aggregation happens in the *loader*, not the `Note` object. ({R008.§2.AC.01})
- Lint — `lint-command.ts:130` reads `getAggregatedContents(targetNoteId)`. ({R008.§2.AC.02})
- Gather's cross-project-stub scan — `gather-handler.ts:379`.
- Snapshot writer / diff — `snapshot-writer.ts:138`, `diff-command.ts:200` (`getAggregatedContentsSync`).
- Peer-project resolver — `peer-project-resolver.ts:196`.
- VS Code claim-body resolver (async path) — `claim-body-resolver.ts:466`/`:477` route through `getAggregatedContentsSync`/`getAggregatedContents`.

**Folder-blind or silently-flat surfaces:**
- **`scepter search` full-text** — `search-handler.ts:140` reads `noteFileManager.getFileContents(note.id)` (main file ONLY). Full-text search silently misses content authored in companion files of a folder note, while *claim* search (which goes through the aggregated index) sees it. Same query, two coverage levels, no indication. (Candidate instance, NOT yet a separate task.)
- **`scepter show`** — `show-handler.ts` has NO folder-note branch at all (no `isFolder`/`folderPath`/`getAttachments`/aggregation references). It renders the main file as a flat note; companion files are invisible and unlabeled. This is exactly {T008}'s premise for `show`.
- **`scepter gather` (default)** — by default renders only the main note `content`; companion `.md` files surface only under the opt-in `--include-folder-contents` flag (`gather.ts:37`), and then via a SEPARATE traversal (`analyzeFolderContents` → `getAttachments`, `gather-handler.ts:536`) that treats companion `.md` files as generic "text attachments," not as aggregated note body. This is {T008}'s premise for `gather`.
- **VS Code preview sync path** — `claim-body-resolver.ts:277` (`getNoteLinesSync`) documents that the sync path reads only the primary note file; "Misalignment for folder-note companion-defined claims is an accepted compromise" (`:272-275`).
- **VS Code decoration badges** — `decoration-provider.ts:315-319` documents that for folder-form notes `entry.line` is the line in the *aggregated* stream and `entry.noteFilePath` points at the parent root file, so "neither maps cleanly back to a companion sub-file"; it works around this by re-walking the open doc (`:330`). The aggregated-line-vs-source-file mismatch is a structural seam, handled per-consumer.

**Two independent folder-note traversals exist.** Claim aggregation walks the folder via `getAggregatedContents` → `scanFolderContents` (concatenating `.md` bodies). Attachment enumeration walks it via `NoteStorage.getAttachments()` ({A002.§2.AC.01}, {DD010}) → `getFolderFileMetadata` → `scanFolderContents` (`filesystem-note-storage.ts:251`), returning ALL files including `.md` companions as `Attachment` metadata. {T008} correctly proposes reusing `getAttachments()` as the sub-file index for `show`/`gather`, but the audit should note these are two parallel folder scans with different filtering and no shared "what is this folder note made of" primitive.

**Folder-aware lifecycle is the well-handled surface.** Archive / soft-delete / hard-delete / rename ({R015}, {DD020}) move the whole folder unit atomically: `relocateNoteUnit` (`note-file-manager.ts`) detects folder form and dispatches to `relocateFolderUnit`; the lifecycle `filesystem-path-scanner.ts` emits folder-rename/removal plans that carry companions as a unit ({DD020.§2.DC.16}, {DD020.§2.DC.17}, {DD020.§3.DC.13-14}). This is the model the rendering/search surfaces should aspire to.

### Claims handling

The claim grammar and its consumer behaviors are the most deliberately-consolidated surface in the project: {S002} is the cross-tab Specification that ranges every reference/definition shape against every consumer (parser, tree builder, index, linter, trace, gaps, staleness, CLI surfaces, VS Code surfaces, source scanner). The major recent convergence is {DD021}'s unified `reference-resolver.ts` — it replaced two divergent per-consumer resolvers (`claim-index.ts:resolveClaimAddress` for the index, `cli/commands/shared/resolve-claim-id.ts:resolveClaimInput` for `show`/`trace`) that "implemented different rules, returned different types, and produced different outcomes on the same input" ({DD021.§1}). That fork was the exact failure shape this umbrella task is meant to prevent recurring: lint and trace disagreeing on whether a section-less reference resolves ({DD021} audit Class 2). The taxonomy now has discrete error codes ({R004.§4.AC.07}: `reference-to-unknown-note`, `reference-to-undefined-claim`, `reference-to-archived`, `malformed-claim-reference`, `derivation-target-bare-note-id`) and {R016}/{DD022} added a project-wide audit sweep (`lint --all [--code] [--target] [--codes] [--refs-only] [--json]`) that ranges those outcomes over every note and (opt-in) every source file.

So the claim side is in good shape relative to folder notes — the consistency work here is **verification, not greenfield**: confirm every consumer actually routes through the new resolver rather than reaching into the index directly, and surface the remaining known seams.

Known seams and divergences to verify in the audit:
- **Source-reference citation half** — `addSourceReferences()` in `claim-index.ts` historically dropped bare note-level refs (`if (!ref.claimPath) continue`, the {A001.§1.AC.01} bisection). {A001}/{DD006} unified the `trace` *output* to show both claim-level and note-level source refs, but the audit should confirm the index-level dedup of "what is connected to R005" is genuinely single-pass now and not still two code paths joined at the formatter.
- **Aggregation seam in the resolver consumers** — because the claim index aggregates at the loader (`ensure-index.ts:83`) rather than on the `Note` object, any NEW claim consumer that constructs its own `NoteWithContent` from `Note.content` (rather than `getAggregatedContents`) will silently lose companion claims. This is the claims-side instance of the same two-representations problem as folder notes. The audit should establish a single rule: "claim-bearing content is always aggregated content."
- **VS Code aggregated-line vs. source-file mapping** — `decoration-provider.ts:315-319` and `claim-body-resolver.ts:272-277` both carry documented compromises where the aggregated line index doesn't map back to a companion sub-file. {DD021}'s `ClaimIndexEntry` shape is the place a `sourceFile`/`sourceLine` (companion-resolved) field could close this, but that is a design decision (OQ below), not a confirmed gap.

### CLI DX (scoping pass)

The CLI is the surface with the most visible inconsistency, and it is the area where this task is explicitly *scoping* rather than fixing. The dominant pattern is **three competing conventions for machine-readable output**, plus per-command drift in project-root resolution and flag shapes.

**JSON / format convention fork (highest-incidence DX inconsistency):**
- Most commands use a boolean `--json` flag: `show.ts:16`, `list.ts:11`, `trace-command.ts:190`, `gaps-command.ts:44`, `thread-command.ts:44`, `lint-command.ts:32`, `stale-command.ts:26`, `dependents-command.ts:42`, `index-command.ts:14`, `restore/archive/purge/convert/rename/delete` (all `--json`), `meta/log-command.ts:32`, `meta/get-command.ts:36`, `snapshot/diff-command.ts:59`.
- A second set uses `--format <format>` with `json` as a value: `common-filters.ts:144` (`-f, --format <format>` table|tree|list|json, inherited by `list`), `search.ts:73` (list|detailed|json), `claims/search-command.ts:46` (list|detailed|json), `confidence/audit-command.ts:49` (table|json).
- `config.ts:12-13` uses yet a third shape: separate `--json` AND `--yaml` boolean flags.
- **`list` carries BOTH** `--json` (`list.ts:11`) and the inherited `-f/--format ...json` (`common-filters.ts:144`); `formatPaginationInfo` keys off `options.format` (`list.ts:45`). Two ways to ask for JSON on one command.
- **`gather` has NEITHER** — no `--json`, no `--format` (`gather.ts` options are markdown-only: `--include-tree`, `--include-content`, `--include-folder-contents`). Yet `gather-handler.ts` builds a fully-structured `GatherResult` object (`:348-360`) that is discarded to a formatted string. A clear `--format json` parity gap.

**Project-root resolution inconsistency ({T007}, already a separate task):** the global `--project-dir` (`index.ts:62`) defaults to `process.cwd()` and the `preAction` hook (`index.ts:65-74`) only absolutizes it — it never calls `findProjectRoot` (`create-filesystem-project.ts:238`, which DOES walk up). Only `config.ts:19` walks up today. So every other command operates against the raw cwd and fails from a subdirectory. This is the canonical "one surface does it right, the rest silently don't" instance — already captured as {T007}.

**Error-message quality:** `BaseCommand.handleError` (`base-command.ts:73-75`) prints `Error: <message>` and `process.exit(1)` uniformly, but there is no machine-readable error envelope even when `--json` was requested (errors always print human prose to stderr). For agent consumers piping `--json`, an error breaks the contract silently. Candidate for the audit.

**Flag-naming drift (lower priority, needs full enumeration):** `--importance` is shared between `gaps`/`trace` (good); `--sort`/`--projection` appear on `gaps`/`trace` consistently. But short-flags are uneven (`show` has `-r/-d/-p`, `gather` has `-o/-v` but spells out `--depth`; `list` has no `-d`). Output redirection is `-o, --output` on `gather.ts:44` and `list` (`options.output`) but absent on `show`. A full short-flag/long-flag matrix is part of the scoping deliverable, not yet enumerated here.

## Inconsistencies / Gaps Found (evidence-backed)

1. **Two representations of "a note's content."** `getAggregatedContents` (folder-aware) vs. `getFileContents`/`Note.content` (flat). The choice is per-call-site and easy to get wrong. Evidence: `note-file-manager.ts:158` vs `:192`; aggregation lives in `ensure-index.ts:83`, not on the `Note` object.
2. **`scepter search` full-text is folder-blind.** `search-handler.ts:140` uses `getFileContents`; companion-file content is unsearchable while claim search sees it.
3. **`scepter show` has no folder-note branch.** `show-handler.ts` renders folder notes as flat single notes, unlabeled. ({T008})
4. **`scepter gather` default flattens folder notes;** companion `.md` files only appear under `--include-folder-contents`, and then as generic attachments via a *separate* traversal (`gather-handler.ts:536`). ({T008})
5. **Two parallel folder-scan traversals** with no shared "folder-note composition" primitive: `getAggregatedContents`→`scanFolderContents` vs `getAttachments`→`getFolderFileMetadata`→`scanFolderContents` (`filesystem-note-storage.ts:251`).
6. **VS Code aggregated-line↔companion-file mapping is unresolved** and worked around per-consumer. Evidence: `decoration-provider.ts:315-319`, `claim-body-resolver.ts:272-277`.
7. **Three JSON/format conventions** (`--json` boolean / `--format ...json` value / `--json`+`--yaml`), with `list` carrying both and `gather` carrying none. Evidence above.
8. **Project-root resolution differs per command;** only `config` walks up. ({T007}, `index.ts:62-74` vs `create-filesystem-project.ts:238`.)
9. **No JSON error envelope** even under `--json`. `base-command.ts:73-75`.
10. **NEW claim consumers risk re-forking the resolver / aggregation** if they construct `NoteWithContent` from `Note.content` or resolve against the index directly rather than via `reference-resolver.ts`. Verification item, not a confirmed defect.

## Candidate Work Items (prioritized)

**P0 — already captured as separate tasks (in-scope-but-separate; do NOT duplicate):**
- **{T007}** — Resolve project root by walking up from cwd on subdirectory invocation. (DX instance of "only one surface does it right.")
- **{T008}** — Folder-note-aware rendering in `show` and `gather` (label + sub-file index, reuse `getAttachments()`).

**P1 — high-value consistency fixes surfaced by this audit (candidates for new tasks):**
- Make `scepter search` full-text folder-aware (route through `getAggregatedContents`, or document a deliberate main-file-only scope). Companion to {T008}.
- Resolve the "two representations of content" by either (a) carrying aggregated content on a well-named accessor every consumer uses, or (b) a lint/convention that claim-and-content reads use `getAggregatedContents`. Cross-cuts folder-notes AND claims.
- Add `--format json` to `gather` (the structured `GatherResult` already exists) — JSON-parity instance.

**P2 — DX-convention unification (scoping output; likely one task or a small cluster):**
- Pick ONE machine-output convention across the CLI (`--format <fmt>` vs `--json`) and migrate the outliers; resolve `list`'s double-declaration; reconcile `config`'s `--json`/`--yaml`.
- Define a JSON error envelope honored under `--json`.
- Produce the full short-flag / long-flag / output-redirection matrix and normalize.

**P3 — verification passes (no code change expected unless a gap is confirmed):**
- Confirm every claim consumer routes through `reference-resolver.ts` ({DD021}) and that the {A001.§1.AC.01} citation bisection is single-pass at the index, not joined at the formatter.
- Confirm the two folder-scan traversals can share a primitive, or document why they are intentionally separate.

## Open Questions (genuine design decisions for the user)

- **OQ.01 — One content representation, or two with a rule?** Should the in-memory `Note` object carry aggregated content (making folder notes transparently aggregated everywhere), or should aggregation stay opt-in per consumer with a documented "claim/content reads use `getAggregatedContents`" rule? Carrying it on `Note` is the most consistent but changes the semantics of every `Note.content` read (and the `search`/`show`/formatter line-number math). Surface before implementing.
- **OQ.02 — CLI machine-output convention.** Standardize on `--format <fmt>` (extensible to yaml/csv) or on the `--json` boolean (simpler, already the majority)? This is a public-surface decision affecting agent prompts and scripts; warrants a Decision note once chosen.
- **OQ.03 — Folder-note `show`/`gather` index granularity** (carried from {T008.OQ.01}): filenames only, or filenames + extracted section/claim headers per sub-file? The latter couples the renderer to claim parsing.
- **OQ.04 — VS Code companion-file source mapping.** Should `ClaimIndexEntry` gain a companion-resolved `sourceFile`/`sourceLine` so decoration/hover/definition map a folder-note claim back to the sub-file it was authored in, retiring the per-consumer workarounds? Non-trivial index-shape change; design decision.
- **OQ.05 — Project-root resolution "nearest vs uppermost"** (carried from {T007.OQ.01}) and explicit-`--project-dir` semantics ({T007.OQ.02}). Listed here so the umbrella tracks them; owned by {T007}.

## Related Notes

- {R008} — Folder Note Claim Aggregation (the data model; `getAggregatedContents` contract).
- {S002} — Claim Reference Grammar consolidation; {S002.§9} is the folder-note rule set (companion sub-files not independently referenceable, {S002.§9.AC.04}).
- {DD010} — Storage Protocol Extraction; `gather-handler` attachment reads and the `Attachment` abstraction.
- {A002} — Backend Agnosticism; `NoteStorage.getAttachments()` ({A002.§2.AC.01}) as the folder-note enumeration surface.
- {R015} / {DD020} — Reference rewriting on delete/rename; the folder-unit-atomic lifecycle (the well-handled folder-note surface to emulate).
- {R016} / {DD022} — Project-wide reference audit via `scepter lint`; the claims-side audit precedent.
- {DD021} — Unified reference resolver and failure-mode taxonomy; the "one resolver, all consumers conform" pattern this umbrella generalizes.
- {DD015} — Cross-project resolution across core/VS Code/docs; adjacent multi-project prior art (motivates {T007.OQ.01}).
- {DD006} / {A001} — CLI Unification; the `show`/`gather`/`search`/`trace` surfaces and the citation-bisection unification this audit re-checks.
- {T007} — Project-root resolution (separate DX instance, in scope).
- {T008} — Folder-note-aware `show`/`gather` rendering (separate folder-note instance, in scope).
