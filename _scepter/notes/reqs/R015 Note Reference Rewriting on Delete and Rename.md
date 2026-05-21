---
created: 2026-05-19T04:58:26.317Z
tags:
  - refactor
  - references
  - delete
  - rename
  - lifecycle
confidence: 🤖2 2026-05-19
---

# R015 - Note Reference Rewriting on Delete and Rename

## Overview

SCEpter today has lifecycle commands for notes — `archive` moves a note to `_archive/`, `delete` removes it — but neither command does anything about the *references* that other notes and source files hold to the affected note. After a delete, every `{R005}`, every `@implements {R005.§1.AC.03}`, every `derives=R005.§1.AC.01` in the project becomes a silent dangling pointer. The lint and trace surfaces flag broken references after the fact, but the burden of fixing them falls entirely on the user, who must grep the project, decide on a substitution, and edit each call site by hand. Renaming a note (changing its ID from `R005` to `R042` while preserving content) is not even a primitive today — there is no `scepter rename` command.

This requirement defines reference rewriting for two lifecycle operations: **delete** (the note is retired, references become a parser-invisible "deletion marker" pointing at the retired ID) and **rename** (the note's ID changes, references are updated to the new ID). It also defines the relationship of those operations to **archive**, which deliberately does NOT rewrite references because an archived note remains a valid reference target. A coupled concern surfaced during scope work: the current `archive` (and likely `delete`) command paths operate on a single root `.md` file and leave companion files of folder-form notes behind — this requirement's atomicity layer binds the file-unit guarantee across all lifecycle operations so that defect is fixed alongside the new operations.

**Core Principle:** Reference rewriting is a mechanical translation, not an editorial decision. The tool finds every form the parser would recognize as a reference to the affected note, replaces the note-ID portion according to the operation, and leaves the surrounding text alone. A delete produces a loud, easy-to-spot marker that signals "this used to refer to something that's now gone"; a rename produces a clean new reference indistinguishable from one written that way originally. The user retains all editorial authority: rewriting can be inspected with `--dry-run`, is atomic per command, refuses to run against a dirty working tree, and writes a structured log sufficient for reversal.

## Problem Statement

| Scenario | Current Behavior | Correct Behavior |
|----------|-----------------|------------------|
| `scepter delete R005` against a note with 30 inbound references | Note file is removed; every `{R005.§1.AC.NN}` in other notes and `@implements {R005}` in source code becomes a silent dangling pointer; `scepter claims lint` flags them as errors after the fact | The 30 inbound references are rewritten to a deletion marker that the parser cannot mistake for a live note ID, the rewrite is atomic across all touched files, and the log is sufficient for reversal |
| Renaming `R005` to `R042` (e.g., because the note moved to a different conceptual cluster) | Not supported. The user manually edits the file path, the frontmatter `id`, the in-note self-prefixes (`### R005.LOCK.03`), and every inbound `{R005.§1.AC.NN}` by hand | `scepter rename R005 R042` performs all of the above in one atomic operation with a dry-run and rollback log |
| Reclaiming a deleted ID by renaming a different note into its slot (delete `R005`, then rename `R007` → `R005`) | The user would have to manually disambiguate any stale `{R005}` references that should still point at the OLD R005 from new references that point at the NEW occupant of the R005 slot | The deletion marker form for the original R005 (`_deleted_R005_at_<date>`) is unambiguously not the same token as the live `R005`, so old references stay correctly tombstoned and new references to the post-rename R005 resolve normally |
| Archiving a note that other notes reference | Note moves to `_archive/`; references continue to resolve correctly because the archived note still has a parseable ID and the discovery paths cover archive locations | (No change required — this scenario is correctly handled today and this requirement preserves that behavior) |
| `scepter archive` against a folder-form note (root `.md` plus companion files) | Only the root `.md` file is relocated to `_archive/`; companion files stay in the original folder, leaving a partial-folder shell behind and breaking the note unit | The entire folder unit (root file AND all companions) relocates atomically to the archive location |
| The user wants to know what would change before they pull the trigger | No mechanism — they must read the rewriter's source or run it and inspect the result | Every mutating operation supports `--dry-run` and prints a change manifest |

## Design Principles

**Mechanical translation, not editorial judgment.** The rewriter operates on the same reference forms the parser already recognizes. It does not invent new semantics, does not heuristically guess at intent, and does not silently fix structurally invalid pre-existing references. Reference forms the parser drops today (e.g., hyphenated `{ARCH007-04}`, non-canonical `S005.SEC6.2`) are out of scope; the rewriter inherits the parser's view of the world.

**Delete produces loudness; rename produces silence.** A deleted reference must be visually obvious to a human scanning the document. A renamed reference must look like it was written that way originally. The deletion marker is deliberately ugly because ugliness is the signal — a reader scanning `_deleted_R005_at_20260518.§1.AC.03` should know at a glance that something used to be here and is now gone, and that they should investigate if it matters. The rename output, conversely, must read as natural prose; a reader should not be able to tell from the result that the rename happened.

**Archive does not invalidate references.** Archive is a relocation, not a retirement. The archived note remains a valid reference target — its claims still resolve, its file is still discoverable through the archive path, and `scepter ctx show` still produces meaningful output. Therefore archive MUST NOT trigger reference rewriting. This is a deliberate design choice: archive is the lifecycle move for notes the user wants to preserve and may revisit; delete is the lifecycle move for notes the user wants retired.

**Atomicity over partial progress.** A rewrite either fully succeeds across every touched file or fully rolls back with no on-disk evidence it was attempted. There is no "half-done" intermediate state. This protects against editor inconsistency (some files saved, others not) and against an interrupted run leaving the project in a state where some references point at the new ID and some still point at the old one.

**The local project's authority stops at its own boundary.** Cross-project alias references (`{vendor-lib/R005.§1.AC.01}`) are skipped under every operation, even when the rewriter is acting against a target that happens to share a peer-cited ID. The local project lacks authority to mutate peer projects, and there is no federation contract that would inform a peer that one of its references has been retired by an upstream rewrite. This is consistent with R011's authority boundary: the local project cannot mutate peer-project state, the same rationale that makes cross-project `superseded=` permanently rejected ({R011.§2.AC.04}).

## Requirements

### §1 Operations and Scope

The rewriter is invoked from lifecycle commands acting against notes. Four operations have defined behavior under this requirement: archive (relocate, no rewriting), soft-delete (the existing default behavior of `scepter delete`, no rewriting), hard-delete (new opt-in mode of `scepter delete`, rewrites inbound references to a deletion marker), and rename (changes a note's ID, rewrites inbound references to the target ID). Archive and soft-delete are explicitly preserved as no-ops for reference rewriting; hard-delete and rename are the new rewriting operations.

§1.AC.01:5 The `scepter delete` command MUST support two modes: a default **soft-delete** mode (which preserves the current behavior — relocating the note unit to a `_deleted/` location, tagging it `#deleted`, and leaving inbound references intact) and an opt-in **hard-delete** mode (invoked via a flag; the exact flag name is specification-layer) which removes the note unit from discovery AND rewrites every inbound reference to the deletion-marker form defined in §2. Under either mode, the note's ID MUST NOT be subsequently reused by `scepter create`, consistent with the existing monotonicity rule. Under hard-delete specifically, the ID slot MAY be reclaimed by a subsequent `rename` operation per §1.AC.05; under soft-delete the ID slot remains held until the soft-deleted note is purged.

§1.AC.02:5 The system MUST support a `rename` operation that, when invoked against a note with a target ID, changes the note's ID from the original to the target. The note's file or folder path MUST be renamed accordingly, the frontmatter `id` field (if present) MUST be updated, self-prefixed claim definitions inside the note (see §3.AC.12) MUST be rewritten, and every inbound reference to the original ID MUST be updated to the target ID.

§1.AC.03 The target ID of a rename MUST be a valid SCEpter note ID per the existing note-ID grammar (`[A-Z]{1,5}\d{3,5}`) and MUST NOT be the ID of any live note in the local project at the time of the rename. The target ID MAY be an ID previously held by a deleted note — see §1.AC.05.

§1.AC.04 The `archive` operation MUST relocate the note unit — the file for single-file notes; the folder and ALL companion files for folder-form notes — to the archive location without rewriting any inbound references. Archived notes remain valid reference targets, and `scepter claims lint` MUST NOT flag a reference to an archived note as broken.

§1.AC.04a:4 The claim index MUST keep archived notes in-index for resolution purposes — their claims MUST be addressable, references to them MUST resolve, and `scepter trace` MUST be able to render a row for an archived-note claim — but archived notes MUST NOT count toward projection coverage in `scepter gaps` (an archived note's `@implements` annotations and inline citations are inert). The audit observed a peer project where an archived note (R057 in the peer's namespace) was pulled out of the active claim index, producing 164 `unresolved-reference` errors across active notes that legitimately cited the archived note for context. The remediation is to keep the note resolvable but mark it as not contributing to coverage. (Audit source: peer-project audit catalog Class 5.)

§1.AC.04b:4 When a reference target is an archived note (per §1.AC.04a), the resolver MUST produce a discrete error code (`reference-to-archived`, per {R004.§4.AC.07}) — distinct from `reference-to-unknown-note` (the note never existed) and from `reference-to-undefined-claim` (the note exists but the cited claim is undefined). The discrete code is what allows lint to downgrade severity (an archived-but-cited reference is a soft signal, not a hard error) and what allows the VS Code extension to render the diagnostic with a different style. (Audit source: peer-project audit catalog Class 5 — the conflated `unresolved-reference` code blocked authors from distinguishing the archived case from the missing-note case.)

§1.AC.04c:3 The `archive` command MUST warn the user when invoked against a note that has N > 0 inbound references, surfacing the count and at minimum the IDs of the citing notes. The warning is informational — archive proceeds without rewrite per §1.AC.04 — but it makes the lifecycle decision explicit: the author sees the inbound-reference footprint before archiving, and can elect to convert to hard-delete instead if leaving the references in place would mislead future readers. (Audit source: peer-project audit catalog Class 5 — the lifecycle-hygiene burden currently falls on the author after the fact; surfacing it at archive time prevents that.)

§1.AC.05 The compound case "delete X, then rename Y → X to reclaim the slot" MUST be supported as a sequence of the two primitives without an additional command. The deletion-marker form for the original X (per §2) is by construction not confusable with the new occupant of the X slot, so pre-existing references that pointed at the original X remain tombstoned while new references to the post-rename X resolve as live.

§1.AC.06 Each operation MUST be exposed as a CLI command that accepts the note ID as a positional argument.

### §2 Deletion-Marker Format

When the delete operation rewrites an inbound reference, it replaces the note-ID portion of the reference with a deletion marker. The marker format is fixed: it is the only rewriter-produced lifecycle marker in this requirement, and its parser-invisibility is the load-bearing property that allows tombstoned references to coexist with live references after an ID is reclaimed.

§2.AC.01:5 The deletion marker MUST take the form `_deleted_<ORIGINAL_NOTE_ID>_at_<TIMESTAMP>`, where `<ORIGINAL_NOTE_ID>` is the note ID being retired (e.g., `R005`) and `<TIMESTAMP>` is the date or datetime of the delete operation rendered per the project's `timestampPrecision` config setting. Minimally `YYYYMMDD` under date-precision; the compact numeric datetime (e.g., `YYYYMMDDHHMM` or finer) under datetime-precision. No separators between components. Example under date-precision: `_deleted_R005_at_20260519`. Example under minute-precision: `_deleted_R005_at_202605191430`.

§2.AC.02:5 The marker MUST fail the existing note-ID validator (`[A-Z]{1,5}\d{3,5}`). The leading underscore guarantees this — the regex rejects the token at position 0. The marker MUST also not match any prefix of a valid note ID under any anchoring the parser uses, so that occurrences of the embedded original ID inside the marker do not produce spurious live-reference matches at word boundaries.

§2.AC.03:5 The marker MUST replace ONLY the note-ID portion of a reference. The trailing claim path (section, claim prefix, claim number, range, compact-multi, sub-letter) MUST be preserved verbatim and appended after the marker. Worked examples:

| Original reference | Rewritten reference |
|---|---|
| `{R005}` | `{_deleted_R005_at_20260519}` |
| `{R005.§1.AC.03}` | `{_deleted_R005_at_20260519.§1.AC.03}` |
| `{R005.§1.AC.01-05}` | `{_deleted_R005_at_20260519.§1.AC.01-05}` |
| `{R005.§1.AC.01,.AC.03,.AC.05}` | `{_deleted_R005_at_20260519.§1.AC.01,.AC.03,.AC.05}` |
| `:derives=R005.§1.AC.03` | `:derives=_deleted_R005_at_20260519.§1.AC.03` |
| `derives: [R005.§1.AC.03]` | `derives: [_deleted_R005_at_20260519.§1.AC.03]` |

§2.AC.04 The marker MUST be recognizable from a single regular expression `_deleted_([A-Z]{1,5}\d{3,5})_at_(\d{8,})` such that the captured original ID and timestamp are recoverable. The trailing digit count is open-ended (8 or more) so the regex accommodates `YYYYMMDD` date-precision and the compact numeric datetime forms (`YYYYMMDDHHMM` and finer) per §2.AC.01.

§2.AC.05 The marker form defined here is the ONLY form the rewriter produces for the delete operation. Rename produces a clean target ID with no marker decoration; archive produces nothing. No additional marker prefixes are defined by this requirement, and additions to the lifecycle vocabulary (e.g., a future "consolidate" operation that redirects references to a surviving note) MUST be expressed inside the marker shape rather than introducing parallel prefix conventions.

### §3 Reference Forms That MUST Be Covered

The rewriter MUST handle every reference form the existing SCEpter parsers recognize. This section enumerates the form taxonomy and the per-form rewrite action under each operation. The taxonomy is grouped by the surface the form appears on: markdown prose (A), source code (B), frontmatter (C), claim metadata (D), self-references (E), file and folder paths (F), and documentation outside `_scepter/notes/` (G).

#### Markdown body forms

§3.AC.01:4 The rewriter MUST cover note-level braced references in prose (`{R005}`), claim-level fully qualified references (`{R005.§1.AC.03}`), claim-level references without section (`{R005.OQ.01}`), compact-multi references (`{R005.§1.AC.01,.AC.03,.AC.05}`), range references (`{R005.§1.AC.01-05}`, `{R005.§1.AC.01-AC.05}`), and braceless mentions where the project configuration enables them (`R005.§1.AC.03`).

§3.AC.02 Within-document claim references that do not include a note ID (`{§1.AC.03}`, `{AC.03}`) MUST be no-ops under both delete and rename. They resolve via the current-document ID — under delete the containing document is being removed, so the references disappear with their file; under rename the containing document's ID changes, but the bare form continues to resolve correctly without textual modification.

§3.AC.03 A reference with trailing inline metadata (e.g., `{R005.§1.AC.03} [inherent]`) MUST have its reference portion rewritten according to the operation; the trailing inline metadata MUST be preserved verbatim. Under delete, the resulting `{_deleted_R005_at_<date>.§1.AC.03} [inherent]` may read awkwardly to a human reader; that is consistent with the loud-signal-for-human-followup intent of the marker format.

§3.AC.04 References inside markdown code-fenced blocks (```` ```{R005}``` ````) and inside inline-code spans (`` `{R005}` ``) MUST be rewritten when the underlying parser would recognize them. The rewriter inherits the parser's decoration-transparency.

§3.AC.05:5 Cross-project alias references (`{vendor-lib/R005.§1.AC.01}`) MUST NEVER be rewritten by any operation, including when the local target of the operation happens to share an ID with the peer-cited reference. The local project lacks authority over peer-project state, and there is no federation contract that would inform a peer of an upstream rewrite. Encountering such a reference during a rewrite MUST produce a warning naming the file, the reference, and the reason it was skipped.

#### Source code forms

§3.AC.06:4 The rewriter MUST cover claim references appearing inside source-code annotation contexts: `@implements`, `@validates`, `@addresses`, `@depends-on`, and `@see` annotations that contain a braced reference to the affected note.

§3.AC.07 The rewriter MUST cover bare braced references that appear inside source-code comments without an annotation prefix (e.g., `// see {R005}`).

§3.AC.08 References inside source-file string literals — most notably test names of the form `it('S002.§1.AC.01: …', …)` — MUST be detected by the rewriter and surfaced to the user for review, but MUST NOT be auto-rewritten under either operation. The audit-and-review policy for these embeds is defined in OQ.01.

#### Frontmatter forms

§3.AC.09 The rewriter MUST cover note-ID references appearing in frontmatter scalar list fields commonly used for derivation, supersession, and similar lifecycle linkage (e.g., `derives: [R005, S038]`, `supersedes: [R057]`, `superseded_by: R042`). Both the bare-ID form and the claim-level form (`derives: [R005.§1.AC.03]`) MUST be covered.

§3.AC.10 The frontmatter `id` field (`id: R005`) MUST be rewritten ONLY under a rename of the containing note, and MUST be rewritten to the target ID of the rename. Under delete the containing note is removed, so the field disappears with the file. Other notes' frontmatter `id` fields MUST NOT be affected by any operation.

#### Claim metadata forms

§3.AC.11:4 The rewriter MUST cover the `:derives=TARGET` metadata suffix on claim definitions and the `:superseded=TARGET` metadata suffix on claim definitions. Both forms place a fully qualified claim reference in the TARGET position; the note-ID portion of TARGET MUST be rewritten per the operation, with the trailing claim path preserved.

#### Self-reference forms

§3.AC.12 Self-prefixed claim heading definitions inside the affected note (generic shape: `### <NOTE_ID>.LOCK.03 …`) and self-prefixed bold-paragraph claim definitions (generic shape: `**<NOTE_ID>.§3.LOCK.03**: …`) MUST be rewritten ONLY under a rename of the containing note, and MUST be rewritten to use the target ID as the new self-prefix. Failing to rewrite these would leave the renamed note with a self-prefix that mismatches its new ID, which the existing parser flags as a `mismatched-self-prefix` error.

§3.AC.13 Under delete, self-prefixed forms inside the deleted note disappear with the file and require no rewrite action.

#### File and folder path forms

§3.AC.14:5 Under rename, the rewriter MUST rename the note's filesystem entry. For file-based notes (`_scepter/notes/requirements/R005 Title.md`), the file MUST be renamed to use the target ID in its filename. For folder-based notes (`_scepter/notes/requirements/R005 Title/R005.md` plus companion files), the folder MUST be renamed to use the target ID in its name, the inner main file MUST be renamed to use the target ID, and the companion files MUST move with the folder as a unit without individual rename.

§3.AC.15 Under delete, the note's filesystem entry MUST be removed. For folder-based notes the entire folder MUST be removed including all companion files. The exact removal mechanism (filesystem unlink versus relocation to a `_deleted/` graveyard) is specification-layer and not asserted here, but if a graveyard is used the rewriter MUST still treat the note as deleted for reference-rewriting purposes.

#### Documentation forms

§3.AC.16 Any markdown-body reference form covered by §3.AC.01–§3.AC.05 that appears in project markdown files outside the configured note discovery paths (e.g., `docs/`, `README.md`, project-level architectural overviews) MUST be rewritten under the same rules. The rewriter MUST NOT restrict itself to the note discovery paths.

### §4 Per-Operation Behavior Summary

The behavior under each operation is the union of the per-form rules in §3, with operation-specific adjustments stated below for clarity. This section is normative: where it conflicts with a §3 form rule the §3 rule wins on form-specific details, but the operation-level invariants stated here MUST hold across all forms.

§4.AC.01 Under **delete**, every form covered by §3 (excluding §3.AC.02 within-doc forms, §3.AC.05 cross-project forms, §3.AC.08 test-name embeds, and §3.AC.13 in-note self-prefixes) MUST have its note-ID portion replaced with the deletion marker defined in §2. The order of file mutations within a single delete invocation is unspecified; what matters is that the operation is atomic per §6.

§4.AC.02 Under **rename**, every form covered by §3 (excluding §3.AC.02 within-doc forms and §3.AC.05 cross-project forms) MUST have its note-ID portion replaced with the rename target. In-note self-prefixes (§3.AC.12) and the frontmatter `id` field (§3.AC.10) of the renamed note MUST also be updated.

§4.AC.03 Under **archive**, no reference rewrite action MUST be taken. The archive command MUST behave as it does today — relocate the note file to the archive location.

### §5 Consumer Behavior for Tombstoned References

The deletion marker is a recognized lifecycle state in the reference grammar, not a broken reference. Every downstream consumer that resolves references — linter, gap report, trace matrix, reference graph index, `scepter ctx show` — MUST recognize tombstoned references explicitly and branch on their tombstoned status.

§5.AC.01:4 The linter MUST NOT report a tombstoned target on `:derives=` or `:superseded=` as a broken-reference error. A `:derives=_deleted_R005_at_20260518.§1.AC.03` is a valid lifecycle state, not a lint violation.

§5.AC.02 The linter MUST support an opt-in flag (the exact flag name is specification-layer) that lists every claim with a tombstoned `:derives=` or `:superseded=` target as a dedicated audit category, so the user can review and decide whether to re-derive against a surviving claim. Without the flag the linter MUST silently accept these targets.

§5.AC.03:4 `scepter claims trace` MUST exclude tombstoned references from the per-claim coverage matrix by default. The matrix asserts coverage relationships between live claims; a tombstoned reference is not a live coverage relationship.

§5.AC.04 `scepter claims trace` MUST support an opt-in flag that surfaces tombstoned references as a separate deleted-origin column for audit purposes. The flag name is specification-layer.

§5.AC.05:4 `scepter claims gaps` MUST exclude tombstoned references from gap analysis by default. A claim whose `:derives=` target is tombstoned MUST be surfaced as a distinct **orphan-derives** category (the deriving claim has lost its anchor and warrants user review), not as a generic gap.

§5.AC.06 The reference-graph index MUST record tombstoned edges in a form that distinguishes them from live edges. A tombstoned edge's target is a synthetic deleted-note entity, not a live note, and consumers querying the graph MUST be able to tell the two apart.

§5.AC.07 `scepter ctx show <marker>` (e.g., `scepter ctx show _deleted_R005_at_20260518`) SHOULD return the rewrite-log entry corresponding to that deletion as the authoritative provenance source, including the original ID, the deletion date, and at minimum the file modification timestamps of the rewrite. Whether the original note body is preserved as part of this provenance is OQ.02.

### §6 Safety and Atomicity

The rewriter mutates many files in a single operation and must offer safety guarantees commensurate with that blast radius. The guarantees in this section are non-negotiable — they are the discipline that distinguishes a rewriter from "a `sed` script with extra steps."

Concurrent rewriter invocations (e.g., two terminals running `delete` simultaneously) are out of scope for v1. The system assumes a single-actor model; cross-operation interleaving is not specified.

The atomicity guarantee in this section applies to every lifecycle operation that mutates the working tree (archive, both delete modes, rename), including the folder-unit atomicity property of §6.AC.09. The rewrite-log, dry-run, dirty-tree guard, and undo-replay properties apply specifically to operations that REWRITE references — i.e., the new hard-delete mode and the new rename operation. Soft-delete and archive use the atomicity primitive but do not produce rewrite-log entries (they don't rewrite references).

§6.AC.01:5 Each mutating operation invocation MUST be atomic across all touched files: either every change in the operation is applied and the operation reports success, or NO change is applied and the operation reports failure. Partial application is forbidden. The implementation mechanism is specification-layer; what is asserted here is the observable behavior.

§6.AC.02:5 Each mutating operation MUST refuse to run when the git working tree contains uncommitted changes, unless an explicit override flag is passed. This prevents mixing rewrite output with unrelated in-progress work, which would make rollback ambiguous. Projects not under git version control MUST also be supported; the dirty-tree guard MAY be relaxed or bypassed automatically in that case.

§6.AC.03:5 Each successful mutating run MUST write a structured rewrite-log entry under the project's SCEpter state directory (the path convention follows the existing `_scepter/` discipline established by {DD019} and surrounding architecture). The log entry MUST record, per touched file, the file path, the span of each modified region, the before-text of the span, and the after-text of the span.

§6.AC.04 The rewrite log MUST be sufficient to replay the operation in reverse — i.e., a future `--undo` command can read the log and restore the pre-operation state of every touched file. This requirement does NOT mandate the `--undo` command itself; it mandates that the log is sufficient for an undo to be implemented.

§6.AC.05:4 Each mutating operation MUST support a `--dry-run` flag (or equivalent) that prints the change manifest — the same per-file/per-span before/after the log would have recorded — WITHOUT modifying any file on disk. Dry-run output MUST be sufficient for a user to assess the operation before committing to it.

§6.AC.06 After a successful rewrite, in-memory caches and indexes (the claim index, the reference graph index, the bidirectional reference store) MUST reflect the post-operation state by the time the operation returns. Stale in-memory state after a mutating operation is a silent-bug class and MUST NOT occur.

§6.AC.07 The dry-run output MUST cover not only the in-place text rewrites but also the test-name-embed audit list (per §3.AC.08) and the cross-project skipped-reference warnings (per §3.AC.05), so a user inspecting a dry-run has the complete change manifest plus the complete human-review queue.

§6.AC.08 The rewrite-log filename's timestamp portion MUST follow the project's `timestampPrecision` config setting — the same setting that drives the deletion-marker timestamp per §2.AC.01. Date-precision projects produce date-stamped log filenames; datetime-precision projects produce datetime-stamped log filenames. The marker timestamp and the log filename timestamp are governed by one setting, not two.

§6.AC.09:5 The atomicity guarantee defined in this section MUST apply to the full note unit for every lifecycle operation (archive, delete, rename). For folder-form notes, the unit is the folder AND all companion files. No lifecycle operation MAY relocate, remove, or rename a partial folder — the root `.md` file and all companion files MUST be acted on as a single atomic unit. Existing `archive` and `delete` command paths that do not satisfy this guarantee MUST be brought into compliance as part of the implementing work.

### §7 Architectural Extensibility

The rewriter's binding scope in this requirement is note-ID-level. The user has identified claim-level rewriting (retiring an individual AC under a surviving note) as a probable future extension. This section captures the requirement-layer commitments that protect that extension from forcing a structural rewrite of the v1 rewriter.

§7.AC.01:4 The system MUST be designed such that extending reference matching from note-ID-level to claim-level addressing requires changing only the matching predicate. Adding claim-level rewriting MUST NOT require modifying the marker grammar (§2), the consumer-side recognition logic in lint, trace, gaps, or reference-graph behavior on tombstoned references (§5), or the cross-project safety surface (§8).

§7.AC.02:4 The deletion-marker format MUST be defined in exactly one canonical source. Every component that produces or recognizes the marker MUST consume that source, so the format can evolve without divergent reimplementations.

### §8 Cross-Project Safety

The local project's rewriting authority stops at its own boundary. This section restates and refines the behavior already required by §3.AC.05 for the case where the rewriter encounters cross-project references during a run.

§8.AC.01:5 Under every operation, alias-prefixed references MUST be detected and skipped by the rewriter. This applies even when the local rewrite target's ID happens to match the cited peer ID — the local project does not have authority to mutate peer-project citations (per the authority boundary established at {R011.§2.AC.03,.AC.04}).

§8.AC.02 When the rewriter encounters a cross-project reference during a run, it MUST emit a warning naming the file, the reference, and the operation. The warning MUST appear in both live runs and dry-run output (per §6.AC.07).

§8.AC.03 When a rename is invoked against a note that peer projects cite via alias, the rewriter SHOULD emit a "downstream peer references may break" warning surfaced to the user, because the local project cannot reach into peer projects to update their references. The warning MUST identify (at least) the original ID, the target ID, and the recommendation that the user notify the maintainers of any peer projects that may cite the renamed note.

### §9 CLI Surface

The rewriter's lifecycle operations introduce or interact with several CLI surfaces. This section enumerates the surfaces that MUST exist; the exact command names, flag strings, and output formatting are specification-layer concerns.

§9.AC.01 A CLI command MUST exist for the `delete` operation, accepting the note ID as a positional argument.

§9.AC.02 A CLI command MUST exist for the `rename` operation, accepting the original note ID and the target note ID as positional arguments.

§9.AC.03 The existing `archive` command MUST be preserved with no reference-rewriting flag added. Archive remains a relocation that does not mutate inbound references (per §1.AC.04 and §4.AC.03).

§9.AC.04 Every mutating operation (delete, rename) MUST support a dry-run mode that prints the change manifest without modifying any file on disk (per §6.AC.05). The flag name is specification-layer.

§9.AC.05 Every mutating operation MUST support an override flag that permits the operation to run against a dirty git working tree (per §6.AC.02). The flag name is specification-layer.

§9.AC.06 The trace consumer MUST expose a flag that toggles inclusion of tombstoned addresses in the trace matrix (per §5.AC.04). The flag name is specification-layer.

§9.AC.07 The lint consumer MUST expose a flag that toggles inclusion of tombstoned-target audit listings (per §5.AC.02). The flag name is specification-layer.

§9.AC.08 The rewrite log MUST support a replay-in-reverse (undo) invocation surface. The form (a `--undo` flag on the original commands, a separate `undo` subcommand, or another shape) is specification-layer. This does not mandate that v1 ship an undo implementation; it mandates that the log surface is designed to admit one (per §6.AC.04).

§9.AC.09 The `scepter delete` command MUST expose a flag that toggles between soft-delete (default) and hard-delete (opt-in). The flag name is specification-layer.

### §10 Agent-Facing Documentation Updates

The Claude Code skills, agent instructions, and CLI documentation read by AI agents MUST be updated so that an agent learns the tombstone lifecycle state, its format, its parser-invisibility property, and the distinction between note-ID-level deletion (this requirement's tombstone) and claim-level lifecycle (`:removed`, `:superseded=` from R005). The goal is that an agent encountering a tombstoned reference correctly recognizes it as a lifecycle state rather than a broken reference, and conversely understands when delete vs. archive vs. rename is the right lifecycle move.

§10.AC.01 The canonical claim-reference documentation (`claude/skills/scepter/claims.md` or the project equivalent) MUST teach the tombstone lifecycle state: what `_deleted_<ID>_at_<timestamp>` means, that it is NOT a broken reference, the marker format per §2, and the parser-invisibility property per §2.AC.02.

§10.AC.02 The Common Mistakes table (or equivalent reference) in `claims.md` MUST include the failure mode "treating tombstoned references as broken-reference lint errors" with the correction "tombstoned references are a recognized lifecycle state, not a lint violation."

§10.AC.03 The skill file's authoring-discipline section MUST teach when soft-delete, hard-delete, archive, and rename are the correct lifecycle moves, surfacing the design principles from this requirement (archive preserves; soft-delete reversibly retires while leaving inbound references intact; hard-delete irreversibly retires with loud inbound tombstoning; rename relocates silently). The teaching MUST make the soft-delete-vs-hard-delete distinction explicit so agents do not conflate the two modes of `scepter delete`.

§10.AC.04 Agent-facing references (CLI help text, the skill SKILL.md, any reviewer/producer documentation) MUST distinguish the tombstoned-state lifecycle (note-ID-level, externally applied to inbound references) from claim-level lifecycle tags (`:removed`, `:superseded=` from {R005}) so authors do not conflate the two surfaces.

### §11 VS Code Extension Behavior

The VS Code extension's reference-resolution surface MUST recognize tombstoned references as a known lifecycle state rather than treating them as unresolved or broken. The extension's existing surfaces (diagnostics, hover, definition-jump, syntax styling) MUST be updated accordingly.

§11.AC.01 The extension's unresolved-reference diagnostic MUST NOT fire on tombstoned references. A tombstoned reference is a recognized lifecycle state, not an unresolved address.

§11.AC.02 Hover on a tombstoned reference MUST present the deletion event — at minimum the original note ID and the deletion timestamp — rather than "reference not found." The hover SHOULD also surface the rewrite-log entry as provenance (per §5.AC.07) when available.

§11.AC.03 Go-to-definition on a tombstoned reference MUST behave as a recognized no-op or jump to the rewrite-log entry (the exact form is specification-layer). It MUST NOT fail as if the reference were broken.

§11.AC.04 Syntax styling (decoration, color, or other visual treatment) MAY differentiate tombstoned references from live references. The requirement asserts that a styling distinction exists at the reference level; the specific visual form is specification-layer.

## Edge Cases

### Reference Inside a Code Fence in Prose

**Detection:** A markdown body file contains a fenced or inline code span around a reference, e.g., ``` ``` ```{R005}``` ``` ``` or `` `{R005}` ``.
**Behavior:** Per §3.AC.04, the rewriter rewrites the reference inside the code decoration, matching the parser's existing decoration-transparency. The decoration itself is preserved.

### Reference Inside a Strikethrough or Other Markdown Emphasis

**Detection:** A markdown body file contains a reference wrapped in markdown emphasis decoration that the parser is known to see through (e.g., `~~{R005}~~`).
**Behavior:** Behave as for code spans — the rewriter rewrites the reference, the decoration is preserved. (See OQ.04 for confirmation.)

### Reference in a Test-Name String Literal

**Detection:** A source-code file contains a test invocation whose name string embeds a claim address (e.g., `it('S002.§1.AC.01: eq matches identical values', () => { ... })`).
**Behavior:** Per §3.AC.08, the rewriter detects the embed and records it in the audit list output. No automatic rewrite is performed. The audit list is surfaced both in `--dry-run` output (per §6.AC.07) and in live-run output, so the user (or a follow-up agent) can decide what to do with each occurrence. See OQ.01 for the open question on the precise scanning surface for this case.

### Reference in a Cross-Project Alias-Prefixed Form

**Detection:** A note or source file contains a reference of the form `{<alias>/<note-id>...}` (per {R011}).
**Behavior:** Per §3.AC.05 and §8.AC.01, the rewriter MUST NOT rewrite the reference under any operation. A warning naming the file, the reference, and the skip reason MUST be emitted (per §8.AC.02).

### Parser-Invalid Reference Form in Project Source

**Detection:** A file contains a non-canonical claim-shaped string the existing parser does not recognize (e.g., hyphenated `{ARCH007-04}`, non-standard `S005.SEC6.2`).
**Behavior:** Out of scope for the rewriter. Per the "mechanical translation, not editorial judgment" principle, the rewriter inherits the parser's view of the world. Projects with residue of pre-canonical reference forms are expected to clean those forms up before invoking the rewriter against affected notes. The rewriter MUST NOT heuristically guess at the intended reference shape.

### Compound Case: Swap Rename via Delete-Then-Rename

**Detection:** The user invokes `delete R005` followed by `rename R007 R005` (or equivalent reclaim sequence).
**Behavior:** Per §1.AC.05, both operations are run as their own primitives in sequence. After the first operation, every former reference to R005 reads `_deleted_R005_at_<date>...` (per §2). After the second operation, the note formerly known as R007 reads as R005, and any new prose references to `{R005}` resolve to the post-rename occupant. The deletion-marker form for the original R005 is by §2.AC.02 not confusable with the new R005, so no cross-contamination occurs.

### Working-Tree Dirty at Operation Start

**Detection:** Git reports uncommitted changes at the time of operation invocation.
**Behavior:** Per §6.AC.02, the operation refuses to run unless an explicit override flag is passed. The error message MUST identify that the working tree is dirty and SHOULD list the affected files (or refer to `git status`).

### Operation Interrupted Mid-Run (Process Killed, Disk Full, Permission Error)

**Detection:** A signal or filesystem error occurs after some files have been staged but before the operation has committed.
**Behavior:** Per §6.AC.01, the operation is atomic. The implementation MUST leave no on-disk evidence of the in-flight operation — no partially rewritten files, no orphaned staging directory in a state that the next invocation would mistake for a valid stage. The exact mechanism is specification-layer.

### Rename Target Equals Source

**Detection:** The user invokes `rename R005 R005` (the target ID is identical to the source ID).
**Behavior:** The operation MUST be detected and rejected with a clear error message before any mutation. No-op semantics are not silently accepted — the user receives an explicit error so the (likely-mistyped) command is surfaced rather than swallowed.

### Delete Against an Already-Archived Note

**Detection:** The user invokes `delete <ID>` where the note has previously been archived (currently lives in the archive location).
**Behavior:** The operation MUST behave consistently with delete-against-live: the inbound-reference rewrite still occurs, and the archived file is removed entirely. The archive's preservation guarantee applies until a subsequent delete; it does not extend through delete.

## Non-Goals

- **Claim-level rewriting** — Retiring an individual claim under a surviving note (e.g., "delete just `R005.§1.AC.03`, leave R005 itself live") is out of scope for v1. The rewriter architecture MUST accommodate the extension (§7.AC.01), but no claim-level operation is in this requirement's binding scope. A follow-up requirement will define the claim-level operation surface.

- **A `consolidate` operation that merges two notes into one** — A future operation that redirects references from a retired note to a surviving live target (rather than to a deletion marker) is conceptually adjacent but is not specified here. Per §7.AC.03, if such an operation is added, it MUST express its lifecycle state inside the existing marker shape.

- **Automatic rewriting of test-name string literals** — Per §3.AC.08 and OQ.01, embeds in test names are detected and surfaced for human review but not auto-rewritten. Auto-rewriting test names risks silently changing test identifiers in CI logs, snapshot files, and external test reports, and the user has chosen to keep this an explicit human-judgment step.

- **Rewriting of parser-invalid pre-existing forms** — Hyphenated note IDs, non-canonical claim shapes, and other forms the parser silently drops today are not rewritten. Consuming projects clean these up before invoking the rewriter.

- **Cross-project rewriting** — Per §8 and {R011}, the local rewriter NEVER mutates peer-project references. Cross-project federation of lifecycle operations would require an opt-in federation contract on the peer's side, and is out of scope here.

- **`--undo` as a binding command** — The rewrite log is required to be sufficient for undo (§6.AC.04), but the `--undo` command itself is not asserted as a binding requirement here. A follow-up may add the command surface.

- **Versioned marker formats** — The marker format defined in §2 is a single, fixed shape. A future evolution of the format (e.g., adding a sub-millisecond timestamp or a process ID) MUST happen by changing the canonical source (per §7.AC.02), not by introducing format variants behind feature flags.

- **Restoration of deleted notes** — Once a note is deleted, the rewrite log is the authoritative provenance source (per §5.AC.07). Whether the original note body is preserved alongside the log for restoration purposes is OQ.02; absent a resolution there, restoration is out of scope.

## Open Questions

### OQ.01 Test-name-string-literal scanning surface and audit policy

**Question:** The rewriter detects claim addresses embedded in test-name string literals (e.g., `it('S002.§1.AC.01: …', …)`) and reports them for human review rather than auto-rewriting (per §3.AC.08). What exactly is the scanning surface — only `it(...)` and `test(...)` call sites, or any string literal in source code? And in what form does the audit reach the user — a list inside `--dry-run` output, a separate report file, an interactive prompt?

**User direction (verbatim, originating session):** "capture all of them we can and then have an agent look over them and assess them." The implication for v1: the rewriter scans test-call-site string literals for ID-bearing tokens, captures candidates, and routes to user/agent review rather than auto-rewriting.

**Resolution path:** Downstream specification or DD. Default assumption: the scanner inspects all string literals in source files configured under `sourceCodeIntegration`, recognizes embeds via a relaxed match (the same claim-address grammar without the brace requirement), and surfaces the audit list in both `--dry-run` and live-run output. An agent or human reviews and acts on the list as a separate, explicit step.

### OQ.02 Original-note-body preservation for tombstoned IDs

**Question:** When a note is deleted, the rewrite log records before/after spans of every touched file but does NOT necessarily preserve the deleted note's own body. Should it? `scepter ctx show _deleted_R005_at_<date>` is required to return the rewrite-log entry as provenance (§5.AC.07), but full restoration of the deleted note's content depends on whether the body was snapshotted at delete time.

**Tradeoff:** Preserving the body inflates the rewrite log significantly and turns it into a partial backup mechanism, blurring the line between "audit log" and "version control." Not preserving it means the user relies on git history for restoration, which is reasonable but couples deletion safety to git-discipline.

**Resolution path:** Downstream design. Default assumption: do NOT preserve the body in the rewrite log; rely on git for restoration. The user's downstream cleanup arc context suggests git is reliably available in target environments.

### OQ.03 `scepter ctx show <marker>` semantics

**Question:** What exactly does `scepter ctx show _deleted_R005_at_20260518` print? The provenance summary (per §5.AC.07) at minimum. Should it also list every file that historically referenced the original R005 (recoverable from the rewrite log)? Should it offer a "show me what would have been linked from the rewrite log" output?

**Resolution path:** Downstream design. Default assumption: minimum-viable output is the rewrite-log entry summary; richer output is a follow-up enhancement.

### OQ.04 Markdown decoration coverage

**Question:** §3.AC.04 and the Edge Cases section assert decoration-transparency for code spans, code fences, and strikethrough. Are there other markdown decorations the parser sees through that the rewriter must therefore handle (e.g., emphasis, link-text, footnote bodies, definition-list terms)? The behavior is "whatever the parser sees, the rewriter rewrites" — but a closed enumeration would help reviewers verify completeness.

**Resolution path:** Confirm by enumerating the parser's decoration-transparency surface (probably already documented in {S002}). If gaps exist, file follow-up.

## Acceptance Criteria Summary

| Section | Count | Notes |
|---------|-------|-------|
| §1 Operations and Scope | 9 | §1.AC.04a–c added 2026-05-20: archived notes stay in index, `reference-to-archived` discrete error code, archive command warns on inbound refs (audit Class 5) |
| §2 Deletion-Marker Format | 5 | |
| §3 Reference Forms That MUST Be Covered | 16 | |
| §4 Per-Operation Behavior Summary | 3 | |
| §5 Consumer Behavior for Tombstoned References | 7 | |
| §6 Safety and Atomicity | 9 | |
| §7 Architectural Extensibility | 2 | |
| §8 Cross-Project Safety | 3 | |
| §9 CLI Surface | 9 | |
| §10 Agent-Facing Documentation Updates | 4 | |
| §11 VS Code Extension Behavior | 4 | |
| **Total** | **71** | 3 added 2026-05-20 (§1.AC.04a–c) for audit Class 5 |

## References

- {R004} — Claim-Level Addressability and Traceability System (the reference grammar this requirement's rewriter operates against; every form §3 enumerates is canonicalized upstream of R004)
- {R005} — Claim Metadata, Verification, and Lifecycle (the existing lifecycle vocabulary `:closed`, `:deferred`, `:removed`, `:superseded=TARGET`; this requirement adds the deletion-marker lifecycle state as an externally-applied tombstone rather than a claim-author-applied tag)
- {R008} — Folder Note Claim Aggregation (the folder-note shape §3.AC.14 must honor; companion files move with the folder, the inner main file renames with the folder)
- {R011} — Cross-Project Note and Claim References via Path Aliases (the alias-prefix grammar §3.AC.05 and §8 protect; the citation-not-federation invariant motivates the rewriter's hands-off behavior for peer references)
- {S002} — Claim Reference Grammar — Forms, Permutations, and Consumer Behavior (the authoritative cross-tab spec for every reference and definition shape; the form taxonomy in §3 of this requirement maps onto S002's canonical surface)
- {DD019} — Meta Store Overlay Model and verification.json Rename (the path convention §6.AC.03 inherits — SCEpter project state lives under `_scepter/`, including the rewrite log directory)
- {DD020} — Reference Rewriting on Delete and Rename - Implementation Blueprint (primary detailed design realizing the §1–§9 rewriter behavior)
- {DD021} — Unified Reference Resolver and Failure-Mode Taxonomy (consumes the §1.AC.04a–c archive-lifecycle behavior — archived notes stay in-index for resolution, distinct `reference-to-archived` error code; AC.04a is realized by {DD021.§10.DC.05} (resolver `includeArchived` option), {DD021.§10.DC.16} (`ensureIndex` loads archived notes), and {DD021.§10.DC.17} (`ClaimIndexEntry.archived` field); AC.04b is realized by {DD021.§10.DC.06} (`reference-to-archived` failure code); added 2026-05-20)
- {T004} — Remove stubbed deleted reference-update subsystem (followup cleanup surfaced during the R015/DD020 implementation cycle; scheduled removal of the existing `#deleted` reference-update path that builds in-memory maps without persisting; runs independently after this requirement lands)

## Status

- 2026-05-18/19: Originated from a downstream cleanup arc in a consuming project where retiring substantively-referenced notes by hand became untenable.
- 2026-05-19: Authored and revised. Covers operations and scope (§1), deletion-marker format (§2), per-form taxonomy of references the rewriter MUST cover (§3), per-operation behavior summary (§4), consumer behavior for tombstoned references (§5), safety and atomicity (§6), architectural extensibility for the future claim-level extension (§7), cross-project safety (§8), CLI surface (§9), agent-facing documentation updates (§10), and VS Code extension behavior (§11). The exact scanning surface for test-name embeds, original-note-body preservation, `scepter ctx show <marker>` semantics, and full enumeration of decoration-transparency are deferred to Open Questions for downstream resolution.
- 2026-05-19 — scope addition: §1.AC.04 and §6.AC.09 added to bind folder-form atomicity across all lifecycle operations, addressing a known defect in the current `archive` (and likely `delete`) command paths.
- 2026-05-19 — scope correction: `scepter delete` retains its current soft-delete default; the rewriting semantic this requirement defines is opt-in behind a flag (§1.AC.01, §9.AC.09). Soft-delete's existing infrastructure (`restore`, `purge`, `#deleted` tag subsystem) is preserved.
- 2026-05-19 — Implementation cycle complete — DD020 phases 1-5 landed; reviewer findings closed; see DD020 status section for the implementation log.
