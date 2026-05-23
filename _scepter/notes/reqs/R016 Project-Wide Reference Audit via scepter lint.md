---
created: 2026-05-23T04:46:38.118Z
status: draft
tags:
  - lint
  - references
  - audit
  - cleanup
  - cli
confidence: 🤖2 2026-05-23
---

# R016 - Project-Wide Reference Audit via scepter lint

**Created:** 2026-05-22
**Related:** {R004.§4.AC.07}, {R004.§4.AC.08}, {R015.§1.AC.04a-c}, {R006.§5.AC.05}, {DD021}

## Overview

`scepter claims lint <id>` today resolves the reference taxonomy authored at {R004.§4.AC.07} on a single note at a time. There is no project-wide sweep, and the lint surface does not scan source-code reference annotations — `@implements {R042}`, `@validates {R042.§1.AC.03}`, `derives=R042.§1.AC.01` in comments — for the same error codes. After a rename or delete (whether via the {R015} rewriter or a manual edit outside the CLI), the author has no single command that surfaces every remaining citation of the affected note across notes AND code.

This requirement extends `scepter lint` with a project-wide audit mode and a reverse-lookup filter targeted at cleanup workflows. The forward-direction question — "which references in the project no longer resolve, anywhere?" — is the audit complement to {DD021}'s resolver direction, which answers "how does this single reference resolve?". Both serve the same root concern (making reference state legible to authors) at different layers: the resolver per-reference, the audit per-project.

**Core Principle:** Audit, not rewrite. This requirement defines a read-only surface — it discovers and reports dangling references and lets the author decide what to do about them. It does NOT define automatic rewriting; that is {R015}'s territory and operates on the IDEAL path (lifecycle-command-initiated rewrites). This requirement covers the AUDIT path: catching what slipped through, what was deleted manually, what was renamed by hand, what was archived deliberately and is still cited.

## Problem Statement

| Scenario | Current Behavior | Correct Behavior |
|----------|-----------------|------------------|
| Author just deleted R042 manually (outside the CLI rewriter) and wants to find every remaining citation across the project | No single command. Must run `scepter claims lint <id>` per note (hundreds of notes), and `scepter claims lint` does not scan source code at all. | One command: `scepter lint --all --target R042 --refs-only` surfaces every note and source file that still cites R042, grouped by site, using {R004.§4.AC.07}'s `reference-to-unknown-note` code. |
| Author wants the complete project-wide health view of unresolved citations | No single command. Must iterate over every note. Source-code annotations are not scanned by lint at all. | `scepter lint --all --code` sweeps every note AND every configured source folder for {R004.§4.AC.07} reference-resolution failures. |
| Author wants machine-readable output for jq pipelines (e.g., to feed a script that opens each citing file in an editor) | Per-note lint output is human-formatted prose; no JSON form. | `scepter lint --all --json` emits a flat `incidences` array with site information per citation, plus `scanned` counts (notes, source files, references). |
| Author wants to audit only reference-resolution errors, not the full lint suite (sequence gaps, malformed IDs, structural issues) | No filter exists. The full lint output mixes reference-resolution incidences with unrelated structural findings. | `scepter lint --all --refs-only` suppresses non-reference findings, surfacing only {R004.§4.AC.07} family error codes. |
| Author wants to find citations to a SET of just-deleted notes, including notes that no longer exist | No mechanism. The per-note `lint <id>` form requires the note to exist. | `scepter lint --all --target R042,R057,R102` accepts a comma-separated list of note IDs (and claim FQIDs); the targets MAY be IDs of notes that no longer exist — that's the cleanup workflow. |
| Author wants to know whether archived notes are still cited by active work, so they can decide whether to un-archive or rewrite | Inbound references to archived notes still resolve (per {R015.§1.AC.04a}). Lint emits `reference-to-archived` per {R004.§4.AC.07} per-note, but there is no project-wide tally. | Default project-wide sweep flags `reference-to-archived` as a finding. The `--include-archived-as-valid` (or equivalent) opt-out suppresses this when the author wants archived-as-live semantics. |

The root cause: `scepter lint` is per-note by design, and the source-code projection has never been a lint scan target. The {R004.§4.AC.07} error-code taxonomy is in place and the {DD021} unified resolver materializes it per reference — but no consumer ranges over the whole project on the author's behalf.

## Design Principles

**Audit, not rewrite.** This requirement extends an existing read-only surface. No reference is modified by these flags. Rewriting on lifecycle moves is {R015}'s job; this requirement's job is to catch the cases the rewriter does not see (manual deletes, off-CLI renames, archive decisions left unfollowed-through).

**Extend, do not parallel.** The lint command already emits the {R004.§4.AC.07} taxonomy per-note; the project-wide sweep is the same emissions ranged over the project, plus a source-code scan added under an opt-in flag. A new `scepter refs check` command group or a `scepter dependents` split would fragment the cleanup workflow and duplicate the resolver's consumer surface. The lint surface is the right home.

**Targets MAY be absent.** The reverse-lookup filter (`--target`) accepts IDs that no longer exist in the project. That is the canonical cleanup workflow — "I just deleted R042; what still cites it?" Resolving the target against the live index is NOT a precondition; the filter matches citations textually against the supplied IDs and FQIDs.

**Per-note form is preserved.** `scepter lint <id>` continues to behave exactly as today. The new flags activate project-wide behavior only under `--all` (or under `--code` / `--target` when explicitly opted into source-code scanning or reverse-lookup filtering on the per-note form, if natural). The per-note form MUST NOT silently expand its scope.

## Requirements

### §1 Project-Wide Sweep and Source-Code Scanning

The system MUST extend `scepter claims lint` (also addressable as `scepter lint` per the top-level alias) with a project-wide sweep mode and an opt-in source-code scan, both reporting the same {R004.§4.AC.07} error-code taxonomy the existing per-note form emits.

§1.AC.01:5 `scepter lint --all` MUST scan every note in the project's configured discovery paths and emit reference-resolution incidences using the same error-code taxonomy as per-note lint (per {R004.§4.AC.07}). The default scope is note-only — source-code annotations are NOT scanned unless the author opts in per §1.AC.02. The sweep MUST also emit non-reference lint findings (sequence gaps, malformed claim IDs, structural issues) that the per-note form emits today, unless the author suppresses them per §3.AC.01.

§1.AC.02:5 `scepter lint --all --code` MUST additionally scan source-code reference annotations under the project's configured source folders for the same error codes. Annotation contexts in scope: `@implements`, `@depends-on`, `@addresses`, `@validates`, `@see`, and plain `{ID}` references in source-code comments. The set of source folders and file extensions is the project's existing source-scanning configuration; this requirement does NOT introduce a separate configuration surface.

§1.AC.03 The per-note form `scepter lint <id>` MUST remain behaviorally unchanged. The new flags (`--all`, `--code`, `--target`, `--codes`, `--refs-only`, `--json`) activate the project-wide behaviors. The exact rule for whether `--code` / `--target` are accepted on the per-note form is specification-layer; what is asserted here is that the per-note form MUST NOT silently expand its scope by default.

### §2 Reverse-Lookup Filter (Targets MAY Be Absent)

The system MUST support filtering the sweep output by a set of citation targets, where the targets MAY be IDs of notes that no longer exist in the project.

§2.AC.01:5 `scepter lint --all --target <ids>` MUST accept a comma-separated list of note IDs and claim fully qualified IDs (e.g., `R042`, `R042.§1.AC.03`, `R042,R057,R102.§3.AC.01`). The flag filters the sweep output to incidences citing one of the supplied targets and suppresses all others. Both note-level citations and claim-level citations of the supplied targets MUST be reported — a `--target R042` filter MUST surface `{R042}`, `{R042.§1.AC.03}`, `@implements {R042}`, and `@implements {R042.§1.AC.03}` alike.

§2.AC.02:5 The targets supplied to `--target` MAY be IDs of notes that do not currently resolve in the local project's claim index. This is load-bearing: the canonical cleanup workflow is "I just deleted R042; show me what still cites it." The filter MUST NOT reject or warn on unresolvable targets — they are the most common case.

§2.AC.03:4 Claim-level targets (e.g., `R042.§1.AC.03`) MUST filter to citations of that specific claim. Citations of the containing note that do NOT mention the specific claim (e.g., a bare `{R042}` when the filter is `R042.§1.AC.03`) MUST NOT be reported under a claim-level target. Conversely, a note-level target (e.g., `R042`) MUST match every citation of R042 regardless of claim path — both `{R042}` and `{R042.§1.AC.03}` are reported.

§2.AC.04 The `--target` flag MUST be combinable with `--code`, `--codes`, `--refs-only`, and `--json`. The intersection semantics are: an incidence is reported if and only if it (a) cites one of the supplied targets, (b) matches the error-code filter if `--codes` is supplied, and (c) survives the `--refs-only` suppression if active. The scope (notes only vs. notes + code) is controlled by `--code` independently.

### §3 Error-Code Filtering and Refs-Only Mode

The system MUST support filtering the sweep output by error code and a convenience mode that suppresses non-reference findings.

§3.AC.01:5 `scepter lint --all --refs-only` MUST suppress lint findings that are NOT in the {R004.§4.AC.07} reference-resolution error-code family. Sequence gaps, malformed claim IDs that are not reference-resolution failures, and other claim-structural issues MUST NOT appear in the output. The reference-resolution family minimally includes: `reference-to-unknown-note`, `reference-to-undefined-claim`, `reference-to-archived`, `malformed-claim-reference`, `derivation-target-bare-note-id`. The exact list is the one {R004.§4.AC.07} and {DD021} define; this requirement defers to them for membership.

§3.AC.02:4 `scepter lint --all --codes <code1,code2,...>` MUST filter the output to incidences whose error code is in the supplied comma-separated list. The flag accepts the canonical error-code strings (e.g., `reference-to-unknown-note`, `reference-to-archived`). Unknown codes MUST produce an error explaining which codes are recognized.

§3.AC.03 `--refs-only` and `--codes` MUST be combinable. When both are supplied, `--codes` further narrows the reference-family set selected by `--refs-only`. Supplying a non-reference code under `--refs-only` (e.g., `--refs-only --codes sequence-gap`) MUST produce no output, since `--refs-only` first suppresses non-reference findings.

### §4 Default Lifecycle-State Behavior

The system MUST flag references to archived and soft-deleted notes by default in the audit sweep, with an opt-out for treating those notes as valid resolution targets.

§4.AC.01:5 In the project-wide sweep, the default behavior MUST flag `reference-to-archived` incidences as findings (per {R004.§4.AC.07}). The lifecycle table at {R015.§1.AC.04a} preserves resolution of inbound references to archived notes, but for cleanup workflows the author typically WANTS to know which archived notes are still cited so they can decide whether to un-archive or rewrite the citations. The default is "surface"; the opt-out per §4.AC.03 suppresses.

§4.AC.02:5 In the project-wide sweep, the default behavior MUST flag references to soft-deleted notes as findings (under the same `reference-to-archived` code or an analogous code; the exact code selection is specification-layer, but the finding MUST surface in the default output). The soft-delete behavior at {R015.§1.AC.01} preserves resolution of inbound references for recoverability, but the cleanup workflow treats them as candidates for rewriting.

§4.AC.03:4 The system MUST support an opt-out flag (the exact name is specification-layer; `--include-archived-as-valid` or `--skip-archived` are candidates) that suppresses the archived-reference findings. When the flag is supplied, references to archived notes MUST be treated as live resolutions and produce no finding, restoring the "archived notes are still valid reference targets" semantics from {R015.§1.AC.04a}.

§4.AC.04 The system MUST support an analogous opt-out flag for soft-deleted notes. The two flags MAY be unified into one (e.g., `--include-inactive-as-valid`) or kept distinct; the exact CLI shape is specification-layer. What is asserted here is that the author MUST be able to suppress the archived-or-soft-deleted findings independently of the unknown-note and undefined-claim findings.

§4.AC.05 Tombstoned references (the `_deleted_<ID>_at_<TS>` markers from {R015.§2.AC.01}) MUST NOT be flagged as findings under any combination of flags in this requirement. Tombstones are a recognized lifecycle state per {R015.§5.AC.01}, not a reference-resolution failure, and that behavior is preserved verbatim — this requirement does NOT alter the tombstone-recognition contract.

### §5 Output Format

The system MUST support human-readable output (the default) and machine-readable JSON output for the project-wide sweep.

§5.AC.01:5 The default human-readable output MUST group incidences by target note ID under each error code. For each error code in the output, the author sees a section listing each cited target and the sites that cite it. The visual treatment (headings, indentation, color) is specification-layer; what is asserted here is that the author can scan "the citations to R042 are these N sites" as one block, not as N independently formatted lines scattered across the output.

§5.AC.02:5 `scepter lint --all --json` MUST emit a machine-readable JSON document. The document MUST include:
- A `scanned` object with counts: notes scanned, source files scanned (zero unless `--code` was supplied), references encountered.
- A flat `incidences` array. Each incidence MUST carry: the error code, the target ID being cited, the site information (note ID and section and line and source snippet for note incidences; source file path and line number and annotation type and source snippet for source-code incidences), and any flags-relevant context (e.g., whether the target resolved to an archived note).

§5.AC.03 The JSON output MUST be a stable, scriptable contract. Field names, nesting structure, and the discriminator between note-site and source-file-site incidences MUST be specified in the downstream specification document. Once stabilized, breaking changes to the JSON shape MUST go through the usual specification-revision process.

§5.AC.04 The human-readable output MUST also surface the `scanned` counts somewhere (header, footer, or summary block — exact placement is specification-layer) so the author can confirm the sweep reached the expected scope.

### §6 Relationship to Other Surfaces

The audit sweep consumes the {DD021} resolver and its outcomes but introduces no new resolution semantics. The reverse-lookup filter is adjacent to {R006.§5.AC.05}'s `claims dependents` ergonomic but distinct in direction and binding.

§6.AC.01:4 Reference resolution under the sweep MUST go through the {DD021} unified resolver per {R004.§4.AC.08}. The sweep MUST NOT reinvent resolution rules; it MUST consume the resolver's outcomes and emit the same error codes lint emits per-note today.

§6.AC.02:4 The reverse-lookup filter (`--target`) is distinct from `scepter claims dependents <claim>` ({R006.§5.AC.05}): `dependents` lists derivation graph edges and inline citations against a LIVE target claim; this requirement's `--target` filter surfaces resolution incidences against potentially-absent targets, including unresolved-reference findings, across the project-wide audit sweep. They MAY share implementation primitives (a textual citation index) but they ARE distinct surfaces; this requirement does NOT subsume {R006.§5.AC.05}, and {R006.§5.AC.05} does not subsume this one.

## Edge Cases

### Empty Project or Zero Findings

**Detection:** `scepter lint --all` (or with any filter) finds no incidences after a complete sweep.
**Behavior:** The command MUST exit with success and surface the `scanned` counts (per §5.AC.04). In `--json` mode the `incidences` array is empty but the `scanned` object is populated. A zero-finding outcome is a successful audit result, not an error.

### Target Filter Matches Zero Citations

**Detection:** `--target R042` is supplied, but no note or source file cites R042 anywhere.
**Behavior:** Same as empty-findings — success exit, `scanned` counts surfaced, `incidences` empty. The fact that the target itself does not exist in the index is irrelevant per §2.AC.02; the filter is a citation filter, not a target-existence check.

### Cross-Project Citations

**Detection:** The sweep encounters alias-prefixed references like `{vendor-lib/R005.§1.AC.01}` (per {R011}).
**Behavior:** Cross-project citations MUST NOT produce reference-resolution findings in this sweep. They are read-only display pointers per {R011} and the {DD021} resolver does not resolve them against the local index. Whether they are reported as a separate cross-project audit category is specification-layer; what is asserted here is that they MUST NOT appear under `reference-to-unknown-note` or any of the {R004.§4.AC.07} codes.

### Tombstoned Reference Encounter

**Detection:** The sweep encounters a `_deleted_<ID>_at_<TS>` token in a citation slot (per {R015.§2.AC.01}).
**Behavior:** No finding is emitted. Tombstones are a recognized lifecycle state per {R015.§5.AC.01}; this requirement preserves that contract (§4.AC.05). If the author wants to audit tombstoned references separately, that is {R015.§9.AC.07}'s `tombstoned-target-audit` flag territory, not this requirement.

### Folder-Form Notes

**Detection:** The sweep enters a folder-form note (a folder with a root `.md` plus companion files, per {R008}).
**Behavior:** Per {S002.§9}, claims and references in companion files are aggregated under the parent note's ID for parsing purposes. The sweep MUST treat each folder-form note as a single logical document (one note ID) and report incidences with their actual file path and line number (so the author can navigate to the citing site), but with the note ID for grouping per §5.AC.01.

## Non-Goals

- **Auto-rewrite of dangling references** — This requirement defines an audit (read-only) surface. Rewriting is {R015}'s territory and operates on lifecycle commands, not on lint output. If the author wants to act on a finding, they edit the citing site by hand or invoke a {R015} lifecycle command — this requirement does not introduce a fix-on-detection mode.
- **A new `scepter refs check` command or `scepter dependents` split** — The {R004.§4.AC.07} error codes already emit from `scepter lint` per-note. Extending lint with `--all` and `--code` reuses that surface rather than fragmenting cleanup workflows across parallel commands.
- **Extending `scepter claims gaps` to cover dangling references** — `gaps` is about projection coverage of EXISTING claims (claims that are present at one projection but absent from expected downstream projections). This requirement is the opposite direction: citations to entities that don't exist (or shouldn't be cited anymore). The two queries are distinct enough that conflating them in `gaps` would muddle both surfaces.
- **A new error-code taxonomy** — This requirement consumes the existing {R004.§4.AC.07} taxonomy. New error codes are out of scope; the sweep emits what the resolver produces.
- **New resolution semantics** — Per §6.AC.01, all resolution flows through the {DD021} resolver. The sweep is a consumer, not a re-implementor.
- **Concurrency / incremental audit** — A single invocation that scans the project. Incremental "what changed since last audit" or watch-mode forms are deferred.

## Open Questions

### OQ.01 Exact Flag Names

**Question:** The flag names (`--all`, `--code`, `--target`, `--codes`, `--refs-only`, `--json`, the archived-as-valid opt-out) are the shape the user signed off on in conversation. The specification document downstream of this requirement MAY refine them (e.g., `--include-archived` vs. `--skip-archived` for the opt-out; `--code` vs. `--source` for the source-scan flag).

**Impact:** Specification-layer; does not affect what this requirement asserts. The flags above are the working contract until the spec freezes them.

**Default assumption:** Use the names above; revisit at spec authoring.

### OQ.02 `--code` and `--target` on the Per-Note Form

**Question:** §1.AC.03 requires the per-note form `scepter lint <id>` to remain behaviorally unchanged at default. Does `scepter lint <id> --code` (scan source code for citations of `<id>`) or `scepter lint <id> --target <other-id>` make sense as a per-note operation?

**Impact:** The per-note + `--code` form is potentially useful for "show me every source-code citation of this one note." The per-note + `--target` form is conceptually orthogonal — `--target` is a project-wide reverse-lookup filter; combining it with a per-note scope is incoherent. The cleanest stance is: `--all` is required to opt into source-code scanning and `--target` filtering, with the per-note form unchanged. A more permissive stance would allow `--code` on the per-note form for the narrow "this note's source citations" case.

**Default assumption:** `--all` is required for `--code`, `--target`, `--codes`, `--refs-only`, and `--json` to activate. The per-note form accepts none of them. Specification MAY relax this; this requirement does not.

### OQ.03 Soft-Delete vs. Archive Code Distinction

**Question:** §4.AC.02 leaves open whether soft-deleted notes use the `reference-to-archived` code or a separate one. Are they actually distinguishable from the audit's perspective?

**Impact:** From the resolver's perspective, archived and soft-deleted notes are both "present in the index but lifecycle-flagged." The semantic distinction matters for which lifecycle move is appropriate (un-archive vs. restore-from-deleted), and that distinction would be useful to surface in the finding text. Whether the distinction warrants its own error code or is carried as a flag on a single code is specification-layer.

**Default assumption:** One unified code (`reference-to-archived` or a renamed `reference-to-inactive`) with a context field distinguishing archived vs. soft-deleted. Spec refines.

### OQ.04 Performance and Caching

**Question:** A project-wide sweep with `--code` may scan tens of thousands of source-code lines. Is there a caching surface, or does each invocation scan everything from scratch?

**Impact:** First-pass implementations may scan from scratch; large projects MAY notice. The claim index ({R004.§4}) already amortizes a similar scan across consumers; the source-scan integration MAY reuse it.

**Default assumption:** Reuse the existing claim-index and source-scan infrastructure. No new caching surface in this requirement.

## Acceptance Criteria Summary

| Cluster | Count |
|---------|-------|
| §1 Project-Wide Sweep and Source-Code Scanning | 3 |
| §2 Reverse-Lookup Filter | 4 |
| §3 Error-Code Filtering and Refs-Only Mode | 3 |
| §4 Default Lifecycle-State Behavior | 5 |
| §5 Output Format | 4 |
| §6 Relationship to Other Surfaces | 2 |
| **Total** | **21** |

## References

- {R004} — Claim-Level Addressability and Traceability System (parent: the lint surface this extends, the error-code taxonomy this consumes)
- {R004.§4.AC.07} — Unresolved-reference error-code taxonomy (the codes this sweep emits)
- {R004.§4.AC.08} — Shared resolver between lint and trace (the resolution path this sweep consumes)
- {R004.§4.AC.09} — Section-less reference resolution rule (governs how citations like `R042.AC.01` resolve under the sweep)
- {R006.§5.AC.05} — `scepter claims dependents <claim>` ergonomic (adjacent surface; not subsumed, not subsuming)
- {R008} — Folder Note Claim Aggregation (governs how folder-form notes are treated under the sweep)
- {R011} — Cross-Project Note and Claim References (governs cross-project citation handling under the sweep)
- {R015} — Note Reference Rewriting on Delete and Rename (the IDEAL path; this requirement is the AUDIT complement)
- {R015.§1.AC.04a-c} — Archive lifecycle: archived notes resolvable but lint-flaggable
- {R015.§2.AC.01} — Tombstone marker format (preserved verbatim by §4.AC.05)
- {R015.§5} — Consumer behavior for tombstoned references (preserved verbatim)
- {S002} — Cross-tab Specification for the reference grammar (constraints the sweep's resolution behavior MUST respect)
- {DD021} — Unified Reference Resolver and Failure-Mode Taxonomy (the resolver the sweep consumes per §6.AC.01)
- {DD022} — Project-Wide Reference Audit Lint Surface (the detailed design realizing this requirement; module decomposition for `lint --all`, `--code`, `--target`, `--codes`, `--refs-only`, `--include-archived-as-valid`, `--include-soft-deleted-as-valid`; covers all 21 ACs across the §10.1–§10.6 module decomposition; added 2026-05-23)
