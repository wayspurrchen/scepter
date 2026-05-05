---
created: 2026-03-10
modified: 2026-03-11
tags: [claims, verification, cli, importance, lifecycle, staleness]
status: draft
---

# R005 - Claim Metadata, Verification, and Lifecycle

## Overview

{R004} established claim-level addressability — individual claims within documents are parseable, indexable, and traceable across projections. But claims are static: once written, they have no lifecycle, no importance signal, and no mechanism to record that a human or agent has verified them. This means gap reports produce noise (resolved gaps keep reappearing), all claims appear equally important, and there is no way to detect when an implementation has drifted from its upstream claim.

This requirement defines three extensions to the claim system: inline claim annotations (importance and lifecycle tags), a verification event store (sidecar metadata recording when claims were verified), and staleness detection (computed from verification dates and file modification times). Together these answer: "which claims matter most, which gaps are actually resolved, and which implementations are current?"

**Core Principle:** Claim metadata splits into two categories by where it belongs. Properties that change what a claim IS (importance, lifecycle state) belong inline in the document because they are part of the claim's identity. Properties that record the project's relationship to the claim (verification events, staleness) belong in a sidecar store because they are external judgments that should not clutter source documents.

**Spec coverage:** The metadata-suffix grammar (importance, lifecycle, derives, freeform tags, key=value tokens) and the linter rules that enforce lifecycle-vocabulary errors are consolidated in {S002.§4} (Metadata Suffix Behavior) and {S002.§3.4} (Linter consumer contract, including lifecycle-error reporting). S002 is the authoritative cross-tab spec for every reference and definition shape; this requirement's metadata semantics map onto its grammar surface.

## Problem Statement

| Scenario | Current Behavior | Correct Behavior |
|----------|-----------------|------------------|
| "Which claims are most important?" | All claims appear equal — no ordering, no emphasis | `scepter claims trace R004 --importance 4` shows only high-importance claims |
| "We resolved this gap last week" | Gap reappears on next `scepter claims gaps` run | Claim tagged `:closed` is excluded from gap reports |
| "We changed our mind about AC.03" | Must manually edit to `[Removed]`, no pointer to replacement | Tag `:superseded=R004.§2.AC.07` retires the claim and points to its successor |
| "Has anyone reviewed this since the code changed?" | No tracking | `scepter claims stale R004` shows claims whose implementations changed after last verification |
| "I just verified this AC against the code" | No mechanism to record | `scepter claims verify R004.§1.AC.03` records date and actor in verification store |

## Design Principles

**Inline for identity, sidecar for judgment.** A claim being `:closed` changes what the claim IS to the traceability system — it should be visible in the document. A claim being "verified on Tuesday by the developer" is a judgment about the claim — it belongs in the verification store, not in the document.

**Minimal syntax, maximal signal.** Importance is a single digit (`:4`). Lifecycle is a single word (`:closed`). No verbose property declarations, no YAML blocks per claim. Colons separate the claim path from metadata items, and separate metadata items from each other.

**Closed vocabulary for lifecycle, open for everything else.** The system recognizes a small fixed set of lifecycle tags and importance digits. Everything else in the metadata suffix is treated as freeform tags, as today.

**Colons as universal separator.** Metadata items are colon-separated (not comma-separated). The first colon separates the claim path from metadata; subsequent colons separate metadata items from each other. This supersedes {R004.§2.AC.04} which used comma separation. Key-value metadata items use `=` to bind key to value (e.g., `superseded=TARGET`).

## Requirements

### §1 Inline Importance

Importance is now implemented as the `importance` key in the generalized event store per {R009.§4.AC.02}; {R009.§7.AC.08} preserves the vocabulary defined in this section. This section is the authoritative source for *what* importance means; R009 is the authoritative source for *how* it is stored and queried.

Grammar specified in {S002.§4.AC.04}; this section asserts importance-related requirements.

The system MUST recognize single digits 1 through 5 in the claim metadata suffix as importance levels (5 most, 1 least) on an ordinal scale. Importance is OPTIONAL — claims without it have no importance signal (not "importance 0").

**AC.01** The parser MUST recognize bare digits 1-5 in the metadata suffix position as importance levels (e.g., `AC.01:4` → importance 4).

**AC.02** `scepter claims trace` and `scepter claims gaps` MUST support `--importance N` to filter output to claims at importance N or higher.

**AC.03** Claims with importance 4 or 5 MUST be visually distinguished in `scepter claims trace` and `scepter claims gaps` output.

**AC.04** `scepter claims trace` and `scepter claims gaps` MUST support `--sort importance` to order claims by importance (highest first), with unannotated claims appearing last.

**AC.05** Importance values outside the range 1-5 MUST be treated as freeform metadata tags, not as importance levels.

### §2 Lifecycle Tags

Lifecycle is now implemented as the `lifecycle` key in the generalized event store per {R009.§4.AC.03}; {R009.§7.AC.08} preserves the vocabulary, mutual-exclusion rule, and consumer conventions (linter validations, gap exclusions) defined in this section.

Grammar and error conditions specified in {S002.§4.AC.03} and {S002.§3.4.AC.04}.

The system MUST recognize a fixed vocabulary of lifecycle tags in the claim metadata suffix:

- `:closed` — gap resolved; `scepter claims gaps` MUST exclude.
- `:deferred` — intentionally postponed; excluded from gaps unless `--include-deferred`.
- `:removed` — retired; ID MUST NOT be reused; references flagged by linter.
- `:superseded=TARGET` — replaced by TARGET (fully qualified path); linter MUST validate TARGET exists.

Lifecycle tags are mutually exclusive — at most one per claim.

**AC.01** The parser MUST extract lifecycle tags from the metadata suffix and store them as a distinct property, separate from freeform metadata tags.

**AC.02** `scepter claims gaps` MUST exclude claims tagged `:closed` or `:deferred` from gap reports by default.

**AC.03** `scepter claims gaps` MUST support `--include-deferred` to include deferred claims in gap reports.

**AC.04** `scepter claims gaps` MUST support `--include-closed` to include closed claims in gap reports.

**AC.05** The linter MUST flag claims with `:removed` that are still referenced by other claims as a warning ("reference to removed claim").

**AC.04a** Colon-separated metadata grammar specified in {S002.§4.AC.01} and ingested as implicit events per {R009.§4.AC.01}. (Supersedes {R004.§2.AC.04} comma form.)

**AC.04b** Metadata charset specified in {S002.§4.AC.02}; key-value parsing in {R009.§4.AC.01}.

**AC.06** The linter MUST validate that the TARGET in `:superseded=TARGET` resolves to an existing claim in the index.

**AC.07** The linter MUST flag claims carrying more than one lifecycle tag as an error.

**AC.08** `scepter claims trace` MUST visually indicate lifecycle state for claims that have one (e.g., show `:closed` claims as dimmed or struck through in terminal output).

### §3 Verification Events

The verification event store is a specialization of the generalized event log per {R009.§7.AC.10}: same substrate, narrower consumer semantics. The `_scepter/verification.json` filename is preserved per {R009.§7.AC.03}; the `scepter claims verify` CLI surface is preserved per {R009.§7.AC.04–05}; the sidecar-not-inline boundary remains authoritative here.

The system MUST maintain a verification event store as a JSON file in the SCEpter data directory. Verification events record that a specific claim was reviewed or validated at a specific time, by a specific actor.

Verification events are external judgments — they MUST NOT be written into the claim's source document. The store is the one exception to "compute, don't maintain" because verification events are human/agent judgments that cannot be inferred from document content.

The verification store MUST survive index rebuilds. It is not part of the computed index — it is a persistent sidecar.

**AC.01:superseded=R009.§7.AC.03** The system MUST store verification events in `_scepter/verification.json` (or the configured data directory). [Path canonicalization is preserved as back-compat by R009.§7.AC.03; the JSON shape and survives-rebuild aspects generalize via the §3 section-header annotation.]

**AC.02:superseded=A004.§2.AC.01** Each verification event MUST record: fully qualified claim ID, date (ISO 8601), actor identifier (human name or agent ID), and optional method (e.g., "code review", "test run", "manual inspection"). [Generalized to `MetadataEvent` shape; legacy events migrate at load time. The required fields here are preserved as the back-compat subset.]

**AC.03** `scepter claims verify CLAIM_ID` MUST create a verification event for the specified claim with the current date.

**AC.04** `scepter claims verify CLAIM_ID` MUST support `--actor NAME` to specify who performed the verification. If omitted, the system SHOULD use a reasonable default (e.g., the current OS username or "cli").

**AC.05** `scepter claims verify CLAIM_ID` MUST support `--method METHOD` to describe the verification approach.

**AC.06:superseded=A004.§1.AC.01** Multiple verification events for the same claim MUST be preserved — the store is append-only. The most recent event is the "current" verification state. [Append-only is elevated to architectural invariant in A004; the property is preserved verbatim, only its name changes.]

**AC.07** `scepter claims trace` MUST show the most recent verification date for each claim when verification data exists.

### §4 Staleness Detection

Staleness derives its input from the generalized event log filtered on the `verified` key per {R009.§7.AC.11}. The computation algorithm and ACs in this section are not superseded.

The system MUST compute staleness by comparing verification dates against modification times of files that implement or reference the claim. A claim is stale when its implementation has changed more recently than its last verification.

Staleness is computed, not maintained. It MUST be derivable from the verification store (§3), the claim index ({R004.§4}), and filesystem modification times.

A claim with no verification events is not "stale" — it is "unverified." The system MUST distinguish between unverified (never checked) and stale (checked, then implementation changed).

**AC.01** `scepter claims stale` MUST report claims whose implementing files have been modified after the most recent verification event for that claim.

**AC.02** `scepter claims stale` MUST report separately: stale claims (verified, then implementation changed) and unverified claims (have implementations but no verification events).

**AC.03** `scepter claims stale` MUST support `--importance N` to filter to claims at importance N or higher.

**AC.04** Staleness computation MUST use file modification time (mtime) of the source files listed in the traceability matrix's Source column for each claim.

**AC.05** Claims with no Source projection (no `@implements` annotations in code) MUST NOT appear in staleness reports — there is nothing to go stale.

### §5 Command Surface Integration

These integration ACs use the `importance`, `lifecycle`, and `verified` keys per {R009.§4.AC.02–03} and {R009.§7.AC.10}. Author-facing flags (`--importance`, `--include-closed`, etc.) continue per {R009.§5.AC.05}; their internal implementation moves to `--where KEY=VALUE` semantics.

The claim metadata system MUST integrate consistently across all existing claim commands. Importance, lifecycle state, and verification data MUST be surfaced wherever claim information is displayed.

**AC.01** `scepter claims index` summary MUST report: count of claims by importance level, count of claims by lifecycle state, count of verified vs unverified claims.

**AC.02** `scepter claims lint` MUST validate lifecycle tag syntax (recognized vocabulary, mutual exclusivity, supersession target resolution) as part of structural validation.

**AC.03** `scepter claims trace` with `--json` MUST include importance, lifecycle state, and latest verification event in the JSON output for each claim.

**AC.04** `scepter claims gaps` with `--json` MUST include importance, lifecycle state, and latest verification event in the JSON output for each gap.

## Edge Cases

### Importance and Lifecycle on Same Claim

Specified in {S002.§4.AC.03} — importance and lifecycle are independent metadata items; a claim MAY carry both.

### Supersession Chain

**Detection:** Claim A is `:superseded=B`, and claim B is `:superseded=C`.
**Behavior:** The linter SHOULD warn about supersession chains longer than one hop, as they indicate the claim identity has migrated twice. The system does not automatically follow chains — it reports the immediate target.

### Verification of Removed Claims

Specified in {R009.§7.AC.07} and {R009.§2.AC.09}; the rule (verification writes against `:removed` claims are rejected) was originally in this edge case and R009 explicitly takes ownership going forward.

### Stale Claim with No Current Verification

**Detection:** A claim has `@implements` annotations in source files, but no verification events exist in the store.
**Behavior:** The claim is "unverified," not "stale." Staleness requires a prior verification to compare against. Unverified claims are reported separately from stale claims.

### Multiple Source Files for One Claim

**Detection:** A claim has `@implements` annotations in three source files. One was modified after verification, two were not.
**Behavior:** The claim is stale. Any implementing file changing after verification makes the claim stale — the verification covered all implementations at the time.

### Deferred Claim Becomes Relevant

**Detection:** A claim tagged `:deferred` needs to be un-deferred.
**Behavior:** Remove the `:deferred` tag from the metadata suffix. The claim reappears in gap reports on the next run. No CLI command is needed — the document is the source of truth for lifecycle state.

## Non-Goals

- **Configurable importance levels** — The 1-5 scale is fixed. Projects that need custom semantics can use freeform metadata tags for that purpose. Configurability adds complexity without proportional value.
- **Automatic importance inference** — The system does not guess which claims are important. Importance is a human/agent judgment annotated explicitly.
- **Freeform tag semantics** — Tags beyond the recognized lifecycle vocabulary and importance digits are opaque strings. The system stores and displays them but assigns no meaning. A future tag system MAY add semantics; this requirement does not.
- **File-level confidence/assurance annotations** — Per-file stability or review status is a separate concern from claim-level metadata. It operates on files, not claims, and requires different tooling (source code annotation, not markdown suffix). Deferred to a separate requirement.
- **Verification workflow enforcement** — The system records verification events but does not enforce verification cadence, require verification before releases, or block actions on unverified claims. It is informational, not prescriptive.
- **Supersession migration tooling** — When a claim is superseded, the system does not automatically update references to point to the replacement. It flags the supersession and suggests the target. Automated migration is out of scope.
- **Inline verification dates** — Verification events MUST NOT be written into claim documents. They belong exclusively in the sidecar store. This is a firm boundary, not a future consideration.

## Open Questions

### OQ.01 Verification Store Format

**Question:** Should the verification store be a flat JSON array of events, or a map keyed by claim ID with an array of events per claim?

**Impact:** Flat array is simpler to append to. Keyed map is faster to query for "latest verification of claim X." For the expected scale (hundreds of claims, not millions), the performance difference is negligible.

**Default assumption:** Keyed map (`{ "R004.§1.AC.03": [{ date, actor, method }, ...] }`). Easier to read as a human, faster for the common query pattern.

### OQ.02 Lifecycle Tag Extensibility

**Question:** Should the lifecycle vocabulary be fixed in the requirement or extensible via configuration?

**Impact:** Fixed vocabulary means every new lifecycle state requires a requirement change. Extensible means projects can add custom states, but the system needs to know which states mean "exclude from gaps" vs "flag as warning."

**Default assumption:** Fixed vocabulary for now (closed, deferred, removed, superseded). If a project needs a custom state, it's a freeform tag without system-level semantics. Promote to lifecycle tag via requirement update if the pattern recurs.

### OQ.03 Verification Scope

**Question:** Should `scepter claims verify` accept a note ID (verify all claims in the note) in addition to individual claim IDs?

**Impact:** Verifying an entire note at once is convenient after a thorough review. But it risks rubber-stamping — verifying claims you didn't actually check.

**Default assumption:** Support both. `scepter claims verify R004.§1.AC.03` for single claims, `scepter claims verify R004` for all claims in a note. The actor takes responsibility for the scope.

## Acceptance Criteria Summary

| Category | Count |
|----------|-------|
| §1 Inline Importance | 5 |
| §2 Lifecycle Tags | 10 |
| §3 Verification Events | 7 |
| §4 Staleness Detection | 5 |
| §5 Command Surface Integration | 4 |
| **Total** | **31** |

## References

- {R004} — Claim-Level Addressability and Traceability System (parent requirement)
- {R009} — Claim Metadata Key-Value Store — generalizes the metadata substrate this requirement defines; vocabularies (importance, lifecycle) remain in force; mechanism moves to the event log per {R009.§7.AC.08}, {R009.§7.AC.10}, {R009.§7.AC.11}.
- {S002.§4} — Metadata Suffix Behavior (the consolidated spec for metadata grammar this requirement contributes to)
- {S002.§3.4} — Linter consumer contract (lifecycle-tag and metadata-syntax error rules)
- {R004.§2.AC.04} — Colon-suffix metadata parsing (the syntax this requirement builds on)
- {R004.§5.AC.03} — Removed staleness AC (now addressed by §4 of this requirement)
- {R004.§7} — Stability and Verification Markers (deferred section; §7.AC.04 is addressed by §3 of this requirement)
- {R004.§8} — Priority and Metadata on Claims (§8.AC.01-AC.03 are extended by §1 and §5 of this requirement)
- {DD001} — Detailed Design for claims system (integration context)
