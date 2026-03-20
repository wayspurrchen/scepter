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

### §5 Lint Validation for Derivation

The linter MUST validate derivation metadata.

§5.AC.01 The linter MUST validate that each `derives=TARGET` resolves to an existing claim in the index. Unresolvable targets MUST be reported as errors.

§5.AC.02 The linter MUST warn on derivation chains deeper than 2 hops (e.g., A derives B, B derives C, C derives D — D is 3 hops from A).

§5.AC.03 The linter MUST warn when a source claim has derivatives but some derivatives are missing Source projection coverage (partial derivation coverage).

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

| Category | Count |
|----------|-------|
| §1 Derivation Metadata Recognition | 4 |
| §2 Index Support | 4 |
| §3 Derivation-Aware Gap Detection | 3 |
| §4 Derivation Display in Trace | 3 |
| §5 Lint Validation | 3 |
| **Total** | **17** |

## References

- {R004} — Claim-Level Addressability and Traceability System (parent requirement)
- {R005} — Claim Metadata, Verification, and Lifecycle (metadata syntax this builds on)
- {R005.§2.AC.04b} — Key-value metadata syntax (`=` binding) that `derives=TARGET` uses
- {DD001} — Detailed design for {R004} (integration context)
- {DD002} — Detailed design for {R005} (metadata parser integration context)
