---
created: 2026-03-11
tags: [claims,derivation,traceability]
status: draft
---

# R006 - Claim Derivation Tracing

## Overview

{R004} established claim-level addressability — claims are parseable, indexable, and traceable across projections. {R005} added metadata semantics (importance, lifecycle) and verification events. But the system has no understanding of how claims RELATE to each other through derivation.

When a high-binding acceptance criterion (e.g., `R005.§1.AC.01`) is decomposed into module-scoped design claims (`DC.01`, `DC.02`, `DC.03`), the derivation relationship is expressed via `derives=TARGET` metadata on the derived claims. The syntax already works — {R005.§2.AC.04b} allows key-value metadata items with `=`. But `parseClaimMetadata()` treats `derives=TARGET` as a freeform tag with no semantic understanding. The system cannot answer:

| Scenario | Current Behavior | Correct Behavior |
|----------|-----------------|------------------|
| "Which DCs derive from this AC?" | Manual grep for `derives=R005.§1.AC.01` | `scepter claims trace R005 --show-derived` shows derivation tree |
| "Is this AC fully covered by its derived claims?" | No way to check | Gap detection understands that derived claims covering an AC close its gap |
| "Does this `derives=TARGET` point to a real claim?" | No validation | Lint validates derivation targets exist in the index |
| "Show me the full derivation chain from requirement to code" | Not possible | Trace walks derivation links to show req → design → implementation |

**Core Principle:** Derivation is the mechanism by which coarse requirements become fine-grained implementation targets. Without explicit derivation tracking, the link between a requirement AC and its implementation is either too coarse (one AC maps to 10 files) or invisible (design claims exist but aren't connected to their source). Derivation tracing closes this gap.

**R009 integration:** The `derives=TARGET` token is also emitted as an implicit `derives=TARGET` event per {R009.§4.AC.04}, making it queryable through the generalized metadata surface (e.g., `scepter claims meta list --where derives=R005.§1.AC.01`). Derivation semantics — gap closure, bidirectional index, trace expansion — remain governed by this requirement.

## Design Principles

**`derives=TARGET` is the only derivation syntax.** It uses the existing key-value metadata mechanism from {R005.§2.AC.04b}. No new syntax is needed — only semantic recognition of the `derives` key.

**Derivation is explicit, not inferred.** The system does not guess that DC.01 derives from AC.01 based on naming. Derivation must be declared via `derives=TARGET`. This prevents false positives and makes the derivation graph auditable.

**Derived claims inherit gap-closure responsibility.** When DC.01, DC.02, DC.03 all declare `derives=R005.§1.AC.01`, and all three have Source coverage, the source AC's gap is considered closed — the derived claims collectively cover it. This is the key payoff: gap detection becomes derivation-aware.

**Derivation depth is bounded.** The system supports derivation chains (AC → DC → implementation) but does not support unbounded chains. Chains deeper than 2 hops SHOULD be flagged by the linter as a warning — they indicate the decomposition may be too granular.

## Requirements

### §1 Derivation Metadata Recognition

The metadata parser MUST recognize `derives=TARGET` as a semantic keyword in claim metadata, where TARGET is a claim path (fully qualified or resolvable within scope). This extends {R005.§2.AC.04b} which established key-value metadata syntax.

§1.AC.01 `parseClaimMetadata()` MUST recognize items starting with `derives=` and extract the target claim path as a distinct property, separate from freeform tags.

§1.AC.02 A claim MAY have multiple `derives=TARGET` entries to indicate derivation from more than one source claim. Each MUST be extracted independently.

§1.AC.03 The derivation target MUST be parsed as a claim address using the existing `parseClaimAddress()` function, supporting all valid reference forms.

§1.AC.04 Derivation metadata MUST NOT conflict with lifecycle metadata — a claim can simultaneously be derived and have a lifecycle state (e.g., `DC.01:derives=R005.§1.AC.01:closed`).

§1.AC.05:4 A `derives=TARGET` value MUST be a claim-level address — note-id + section + claim-prefix + claim-number — and MUST NOT be a bare note ID (`derives=R005`, `derives=ARCH028`). The derivation graph operates at claim granularity: a derived claim points at a specific source claim, not at a whole note. Bare-note-id `derives=` values MUST produce a distinct linter error code (`derivation-target-bare-note-id`) separate from the `unresolvable-derivation-target` code emitted when a claim-shaped address fails to resolve in the index, so the author-facing diagnostic distinguishes "you gave me a note ID, but I need a claim ID" from "I could not find the claim you cited." The two failure modes have different remediations and the conflated message has been observed in audited consumer projects to silently produce missing trace-derivation lines. The rejection stance reflects an authoring discipline ("a subclaim can point to the top of a claim, but it is not encouraged") rather than a permanent grammar invariant; reconsideration is permitted via a future requirement that would relax this rule alongside introducing a `note-level` derivation projection. Until then, the rule stands. (Audit source: peer-project audit catalog Class 1.)

### §2 Index Support for Derivation Relationships

The claim index MUST track derivation relationships as a queryable graph, alongside the existing cross-reference graph.

§2.AC.01 `ClaimIndexEntry` MUST include a `derivedFrom` field containing the resolved claim paths from `derives=TARGET` metadata.

§2.AC.02 `ClaimIndex` MUST provide `getDerivedFrom(claimId): string[]` — returns the source claims that a derived claim declares derivation from.

§2.AC.03 `ClaimIndex` MUST provide `getDerivatives(claimId): string[]` — returns all claims that declare `derives=TARGET` pointing to the given claim.

§2.AC.04 Derivation relationships MUST be indexed bidirectionally — queryable from both source and derived claim.

### §3 Derivation-Aware Gap Detection

Gap detection MUST understand derivation relationships. When a source claim has derived claims that collectively provide downstream coverage, the source claim's gap is considered closed.

§3.AC.01 `findGaps()` MUST check whether a claim's gap is covered by its derivatives: if all claims declaring `derives=SOURCE_CLAIM` have Source projection coverage, the source claim MUST NOT appear as a gap.

§3.AC.02 `findGaps()` MUST report partial derivation coverage: if some but not all derived claims have Source coverage, the source claim MUST appear as a gap with a note indicating which derived claims are missing coverage.

§3.AC.03 `scepter claims gaps` MUST support `--show-derived` to expand gap reports to show the derivation tree for each gap, making it clear which derived claims are covered and which are not.

### §4 Derivation Display in Trace

The traceability matrix MUST show derivation relationships.

§4.AC.01 `scepter claims trace` MUST display derivation links for claims that have them — showing which source claim a derived claim comes from.

§4.AC.02 `scepter claims trace --show-derived` MUST expand the trace to include derived claims inline under their source claim, showing the full derivation tree.

§4.AC.03 In the default trace view (without `--show-derived`), derived claims appearing in a note MUST show a `←SOURCE` indicator to identify their derivation source.

§4.AC.04:4 When a claim carries a `derives=TARGET` value that fails to resolve in the index (bare-note-id per §1.AC.05, undefined claim per §1.AC.03, missing note, or any other resolver failure), the trace command MUST surface the failure explicitly rather than silently omitting the derivation slot. The user-facing rendering is specification-layer; what is asserted here is that the trace consumer MUST NOT present a malformed-derives claim as if it had no upstream — the audit observed that a bare `derives=ARCH028` produces no `Derived from:` line at all, indistinguishable from a claim that has no `derives=` metadata. Trace and lint MUST agree on which `derives=` values resolve; if lint emits an error for a target, trace MUST present the same target as unresolved (e.g., `Derived from: <UNRESOLVED — see lint>` or equivalent), and conversely if trace renders a derivation link, lint MUST NOT emit an error for that target. (Audit source: peer-project audit catalog Class 1 cross-cutting observation.)

### §5 Lint Validation for Derivation

The linter MUST validate derivation metadata.

§5.AC.01 The linter MUST validate that each `derives=TARGET` resolves to an existing claim in the index. Unresolvable targets MUST be reported as errors.

§5.AC.02 The linter MUST warn on derivation chains deeper than 2 hops (e.g., A derives B, B derives C, C derives D — D is 3 hops from A).

§5.AC.03 The linter MUST warn when a source claim has derivatives but some derivatives are missing Source projection coverage (partial derivation coverage).

§5.AC.04:5 The linter and the trace command MUST share a single normative resolver for `derives=TARGET` values. A `derives=` value that resolves successfully in one consumer MUST resolve successfully in the other, and conversely a `derives=` value that fails to resolve in one MUST fail in the other. Failure-mode distinctions (bare-note-id per §1.AC.05, unresolvable-claim-shape per §1.AC.03, cross-project-derives per {R011.§2.AC.03}, derivation-from-removed per {R005.§2.AC.05}, derivation-from-superseded) MUST be produced by the resolver as discrete outcomes that each consumer renders in its own surface — the resolver, not the consumer, owns the failure-mode taxonomy. The audit observed that lint emitted `unresolvable-derivation-target` while trace silently omitted the derivation line, producing conflicting signals to authors who could not tell whether the bare-note-id form was supported or rejected. (Audit source: peer-project audit catalog cross-cutting observation.)

§5.AC.05:4 A CLI command MUST exist for listing the dependents of a given claim — every claim that declares `derives=TARGET` pointing at the queried claim, plus every inline reference and `superseded=TARGET` that targets the queried claim. The command surface is specification-layer (proposed name: `scepter claims dependents <claim>`); what is asserted here is that the ergonomic exists. The motivating use case from the audit: when an author tags a parent claim `:removed` or `:superseded=...`, the system today requires a post-hoc lint pass to surface the orphaned children; a direct dependents-listing command lets the author inspect impact before tagging. (Audit source: peer-project audit catalog Classes 9 and 10.)

## Edge Cases

### Circular Derivation

**Detection:** Claim A derives from B, B derives from A.
**Behavior:** The linter detects and reports circular derivation chains as an error. The index builder MUST handle cycles without infinite loops.

### Derivation Target is Removed

**Detection:** `DC.01:derives=R004.§5.AC.03` where AC.03 is tagged `:removed`.
**Behavior:** The linter flags this as a warning: "derived from a removed claim." The derived claim may need to be removed or re-derived from the replacement.

### Derivation and Supersession

**Detection:** Source claim A is superseded by B (`A:superseded=B`). DC.01 derives from A.
**Behavior:** The linter flags this: "derived from a superseded claim; consider re-deriving from TARGET." Not an error — the derived claim may still be valid if B didn't change the relevant aspect.

### Multiple Derivation Sources

**Detection:** `DC.01:derives=R004.§1.AC.01:derives=R004.§1.AC.02` — a claim derived from two sources.
**Behavior:** Both derivation relationships are tracked. The claim contributes to gap closure for both source claims.

### Self-Derivation

**Detection:** `AC.01:derives=AC.01` or equivalent after scope resolution.
**Behavior:** The linter flags as an error. A claim cannot derive from itself.

## Non-Goals

- **Automatic derivation inference** — The system does not guess derivation from naming patterns, file proximity, or content similarity. Derivation is always explicit via `derives=TARGET`.
- **Derivation strength or confidence** — All derivation relationships are treated equally. There is no "partial derivation" or "weak derivation" concept.
- **Derivation versioning** — The system tracks current derivation relationships, not historical ones. If a derived claim's target changes, the old relationship is simply replaced.
- **Inverse derivation (`derived-by=`)** — Derivation is always expressed on the derived claim pointing to its source, never on the source pointing to its derivatives. The index computes the inverse direction.
- **Cross-project derivation** — Derivation targets must resolve within the current project's claim index. Cross-project claim references are out of scope.

## Acceptance Criteria Summary

| Category | Count | Notes |
|----------|-------|-------|
| §1 Derivation Metadata Recognition | 5 | §1.AC.05 added 2026-05-20: bare-note-id `derives=` rejection (audit Class 1) |
| §2 Index Support | 4 | |
| §3 Derivation-Aware Gap Detection | 3 | |
| §4 Derivation Display in Trace | 4 | §4.AC.04 added 2026-05-20: trace surfaces unresolved derives explicitly (audit Class 1 cross-cutting) |
| §5 Lint Validation | 5 | §5.AC.04 added 2026-05-20: lint/trace shared resolver. §5.AC.05 added 2026-05-20: `claims dependents` ergonomic (audit Classes 9, 10) |
| **Total** | **21** | |

## References

- {R004} — Claim-Level Addressability and Traceability System (parent requirement)
- {R005} — Claim Metadata, Verification, and Lifecycle (metadata syntax this builds on)
- {R005.§2.AC.04b} — Key-value metadata syntax (`=` binding) that `derives=TARGET` uses
- {R009} — Claim Metadata Key-Value Store — `derives=` tokens become implicit events per {R009.§4.AC.04}; queryable via the generalized surface, derivation semantics still governed by this requirement.
- {DD001} — Detailed design for {R004} (integration context)
- {DD002} — Detailed design for {R005} (metadata parser integration context)
- {DD021} — Unified Reference Resolver and Failure-Mode Taxonomy (realizes §1.AC.05 bare-note-id rejection, §4.AC.04 trace surfaces unresolved derives, §5.AC.04 shared resolver between lint/trace, §5.AC.05 `claims dependents` command; added 2026-05-20)
- {R016} — Project-Wide Reference Audit via `scepter lint` (adjacent surface to §5.AC.05's `claims dependents` — both are reverse-lookup surfaces over the citation graph but distinct in direction and binding per {R016.§6.AC.02}: `dependents` lists derivation-graph edges against a LIVE target claim; R016's `--target` filter surfaces resolution incidences against potentially-absent targets across the audit sweep. Neither subsumes the other; added 2026-05-22)
