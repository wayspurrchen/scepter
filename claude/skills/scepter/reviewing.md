# SCEpter Review Guide

**Read this companion file when reviewing a claim stack for completeness or coherence.** This covers the analytical operations that happen BEFORE implementation (is the stack ready?) and AFTER changes (did anything break?).

Ensure you have loaded `@scepter` (the main skill) first — it contains the non-negotiable rules, CLI reference, and core concepts. Also read `claims-v2.md` for claim syntax and derivation.

**For deeper conceptual grounding** on claim properties (binding, inherence) and projections, optionally load `@epi vocabulary.md` §2 and §4.

## When to Use This Guide

- Before implementation: "Is this requirement/DD stack ready for coding?"
- After writing a DD: "Did I cover all affected projections?"
- After a requirement change: "Do all downstream projections still cohere?"
- When assessing an AC set: "Are interaction permutations specified?"
- When deciding whether to decompose: "Is this AC high-binding?"

## The Four Review Types

Review is not one operation — it has four subtypes, each checking different things.

| Type | Question | When |
|------|----------|------|
| **Completeness** | Does this claim set cover the problem space? | Before implementation |
| **Conformance** | Does this derived artifact match its source? | After derivation (see conformance.md) |
| **Impact** | What downstream behaviors depend on what I changed? | After any structural change (see implementing.md) |
| **Coherence** | Do parallel projections of the same claims agree? | Periodically, or after propagation |

This file covers **completeness** and **coherence**. For conformance, read `conformance.md`. For impact, read `implementing.md` §Impact Analysis.

## Completeness Review

### Step 1: Identify Projections

Given a requirement note, enumerate every projection where the feature should be visible. A "projection" is any artifact type where the claims manifest — not just Source code.

```
Requirement (e.g., R005)
  → DetailedDesign (DD)    — module-level blueprint
  → Source                 — implementation code with @implements
  → Tests                  — unit/integration/e2e tests
  → CLI                    — commands, flags, output formatting
  → UI                     — routes, components, loader data
  → Documentation          — user-facing docs, skill files
```

**Run `scepter claims trace NOTEID`** to see which projections currently have coverage. A `-` in any column is a potential gap. But also check for MISSING columns — if the feature has a UI surface but there's no UI projection column, the entire projection is absent.

**The DD002 failure:** DD002 (claim metadata) covered Source and CLI but not UI. The claims dashboard at `/dashboard/claims` existed and needed updating but was never mentioned. No tool caught this because the UI projection wasn't in the trace matrix at all.

### Step 2: Check AC Interaction Coverage

For ACs that can combine, enumerate key interaction scenarios. Focus on ACs from the same requirement that share metadata dimensions.

**Pattern:** Take each pair of independently-variable features and ask "what happens when both apply?"

```
importance × lifecycle:
  - importance=5 + closed → valid? shown in gaps with --include-closed?
  - importance=5 + removed → valid? importance on a retired claim?
  - importance + superseded=TARGET → does importance transfer?

lifecycle × verification:
  - closed + verified → meaningful?
  - removed + verify attempt → should reject?
  - deferred + stale → can a deferred claim be stale?
```

Not every permutation needs an AC — but surprising or ambiguous combinations SHOULD be specified. If the answer is "that combination is valid and behaves as you'd expect from each feature independently," no AC is needed. If the answer is "actually, that combination has special behavior" or "that combination is invalid," it needs an AC.

### Step 3: Check Error Boundary Coverage

For each new capability introduced by the ACs:
- What inputs are invalid? Are they specified?
- What happens at boundary values? (importance=0? importance=6?)
- What error messages exist? Are they consistent with existing error formats?
- What happens when the feature interacts with malformed data?

### Step 4: Check Cross-Requirement Interactions

If the feature depends on or extends claims from other requirements:
- Do syntax definitions in the older requirement accommodate the new metadata?
- Are there implicit assumptions that are now violated?
- Has the older requirement been updated (or marked with supersession) if needed?

### Step 5: Assess Binding for Decomposition

For each AC, assess whether it needs decomposition into derived claims:

**Low binding (pass through):** AC maps to 1-3 files in a single module. One `@implements` annotation covers it. Most ACs.

**High binding (decompose):** AC maps to 4+ files across different modules or layers. A single `@implements` is too coarse — if one of those files has a bug, you can't tell which aspect of the AC failed. Create derived claims with `derives=TARGET` in the DD. See `claims-v2.md` §Derivation and Binding Assessment.

## Coherence Review

Coherence review checks that parallel projections express the same understanding. When they disagree, at least one is stale.

### Across Projections

| Check | Method |
|-------|--------|
| Requirement ↔ DD | Does the DD's traceability matrix cover every AC? Does the DD introduce anything not in the requirements? |
| DD ↔ Source | Does the code follow the DD's module inventory? Are there files not in the DD? |
| Source ↔ Tests | Do tests verify the behavior the code claims to implement? |
| Spec ↔ CLI output | Does the CLI produce output consistent with the spec's data model? |
| Any ↔ UI | If the feature has a UI surface, does it reflect the current data model? |

### After Propagation

When a claim changes at any projection, all other projections expressing that claim become potentially stale. Check:

1. **Run `scepter claims stale`** — detects file-level staleness after verification events
2. **Manually check non-Source projections** — staleness detection currently only covers Source files. DD, UI, and documentation staleness requires manual review.
3. **Re-run `scepter claims trace`** — verify the coverage matrix still looks correct after changes

## CLI Checklist

Run these commands as part of any review:

```bash
# Coverage matrix — are all projections represented?
scepter claims trace NOTEID

# Gaps — are there claims missing from downstream projections?
scepter claims gaps --note NOTEID

# Structural lint — are claims well-formed? Lifecycle valid?
scepter claims lint NOTEID

# Staleness — have implementations changed since verification?
scepter claims stale --note NOTEID

# Discovery — find related claims across the project you might not know about
scepter claims search "DOMAIN_KEYWORD"
scepter claims search "ERROR_KEYWORD"
```

Interpret results for completeness (not just conformance):
- `trace` showing `-` is a coverage gap — but also check for missing projection columns entirely
- `gaps` finding nothing doesn't mean completeness — it means downstream projections have the claim IDs, not that they're correctly implemented
- `lint` passing means structure is valid — not that the claim set is sufficient
- `stale` flags changed files — but doesn't flag unchanged files that SHOULD have changed (that's a coherence problem)
- `search` results may reveal claims in other notes that overlap with or constrain the feature you're reviewing — cross-requirement interactions are a common miss

### Using Search for Discovery

Claim prefixes act as natural component tags: `CASCADE`, `DIFF`, `APPLY`, `LOCK`, `STAGE`, etc. Use search to find related claims across the entire project, not just within the notes you've gathered:

```bash
# Find all claims about error handling across all notes
scepter claims search "error|fail|reject|throw"

# Find all claims about a specific subsystem by prefix
scepter claims search "CASCADE"

# Find claims in a specific note type
scepter claims search "migration" --types Requirement

# Find claims scoped to a note
scepter claims search "lock" --note S020
```

This is especially valuable during Step 4 (Cross-Requirement Interactions) — search for the domain terms of the feature you're reviewing to discover claims in other notes that might interact with it.

## Common Misses

| Miss | Why it happens | How to catch it |
|------|---------------|-----------------|
| Missing UI projection | DD author thinks in backend terms | Step 1: enumerate ALL projections including UI/CLI/docs |
| Unspecified interaction | ACs written independently, combinations not considered | Step 2: cross AC features pairwise |
| Assumed error handling | "The system will reject invalid input" but no AC specifies how | Step 3: enumerate invalid inputs explicitly |
| Stale cross-requirement | New feature extends old requirement but old requirement not updated | Step 4: check upstream requirements |
| Coarse traceability | High-binding AC traced as one unit, bug location unclear | Step 5: assess binding, decompose if needed |
