---
created: 2026-03-18
modified: 2026-03-18
tags: [claims, cli, dx]
status: draft
---

# Detailed Design: Claims Gaps Command Redesign

<!-- created: 2026-03-18 -->

## Specification Scope

This DD redesigns the `scepter claims gaps` command to produce useful output by reusing the trace matrix data and filtering to rows with partial coverage, rather than reporting every claim missing from every projection type.

## Current State

### Current `gaps` Command Behavior

The gaps command (`gaps-command.ts`) works as follows:

1. Calls `ensureIndex()` to build `ClaimIndexData`
2. Reads `claims.projectionTypes` from `scepter.config.json` — an array of note type names (e.g., `["Requirement", "DetailedDesign", "Spec"]`)
3. Calls `findGaps(data, allNoteTypes, filterOptions, derivativesLookup)` from `traceability.ts`
4. `findGaps()` iterates every claim in the index; for each claim, it checks which note types from `projectionTypes` reference it. If any note types from the configured list are missing, it reports a gap.
5. The result is a `GapReport[]` with `presentIn` and `missingFrom` arrays, formatted by `formatGapReport()`.

**The core problem**: `projectionTypes` is a flat list of all note types that "could" reference a claim. With 17+ note types, every claim that isn't referenced by every type generates a gap entry. A requirement AC.01 shows "Missing from: Capability, Component, Decision, Domain, Exploration, Feature, Historical, Idea, Pattern, Policy, Principle, Question, Task, UseCase, Worklog" — which is combinatorial noise, not actionable signal.

**The secondary problem**: `projectionTypes` is not configured at all in this project (`_scepter/scepter.config.json` has no `claims` section), so the command currently produces only a warning and exits.

### Current `trace` Command Behavior

The trace command (`trace-command.ts`) works as follows:

1. Calls `ensureIndex()` to build `ClaimIndexData`
2. Calls `buildTraceabilityMatrix(noteId, data)` from `traceability.ts`
3. `buildTraceabilityMatrix()` finds all claims defined in the note, then finds all cross-references pointing TO each claim. It groups references by the note type of the referring note.
4. The result is a `TraceabilityMatrix` with rows per claim and dynamically discovered `projectionTypes` — only types that actually reference claims appear as columns.
5. Formatted by `formatTraceabilityMatrix()` as a table: claim ID, title, then one column per projection type showing note IDs or `-`.

**Key insight**: The trace command already produces exactly the data the redesigned gaps command needs. It discovers projection types organically from actual references rather than from a configured list. A claim row where some columns have data and some show `-` is precisely "a partially traced claim."

### Files Involved

| File | Role | Path (relative to core/src/) |
|------|------|-----|
| `claims/traceability.ts` | `findGaps()` and `buildTraceabilityMatrix()` | Core logic |
| `cli/commands/claims/gaps-command.ts` | CLI entry point for `gaps` | Command definition |
| `cli/commands/claims/trace-command.ts` | CLI entry point for `trace` | Reference for pattern |
| `cli/formatters/claim-formatter.ts` | `formatGapReport()` and `formatTraceabilityMatrix()` | Output formatting |

## Design Claims

### Algorithm — Trace-based Gap Detection

§DC.01 The redesigned `gaps` command MUST build a traceability matrix for each note that defines claims, then filter rows to those with partial coverage.

A row has "partial coverage" when: (a) at least one projection column has one or more references (non-empty), AND (b) at least one projection column is empty (`-`). This excludes two categories: claims with zero coverage across all projection types (no note references them at all beyond their own note type), and claims with full coverage (every discovered projection type has at least one reference).

§DC.02 The `gaps` command MUST aggregate trace matrices across all claim-defining notes in the project, not just a single note.

The trace command operates on a single note at a time (`scepter claims trace R004`). The gaps command scans the entire project for incomplete coverage. The redesigned gaps command iterates all notes that define claims (i.e., notes with entries in `ClaimIndexData.entries`) and builds a matrix for each.

§DC.03 The `gaps` command MUST use dynamically discovered projection types from actual cross-references, not the configured `projectionTypes` array.

This is the fundamental behavioral change. Instead of checking claims against a configured list of all possible types, the command discovers which types actually reference claims and only considers those. This eliminates the combinatorial noise.

§DC.04 The `gaps` command SHOULD retain `projectionTypes` config support as an optional filter, not a requirement.

If `claims.projectionTypes` is configured, the command uses it to restrict which projection columns are considered — useful for focusing on specific projections. If not configured, the command works with all dynamically discovered types. The current hard requirement on `projectionTypes` (warning + early exit) MUST be removed.

### Output Format

§DC.05 The redesigned `gaps` command MUST output a trace-matrix-style table, not the current list-of-gaps format.

The output format should match `formatTraceabilityMatrix()`: claim ID, title, and one column per projection type, with coverage indicators or `-`. This reuses the existing formatter rather than the separate `formatGapReport()`.

§DC.06 The `gaps` command MUST annotate uncovered projection columns distinctly from the `-` in trace output, to visually mark them as gaps.

In trace output, `-` simply means "no reference from this type." In gaps output, `-` is the signal — it's the missing coverage. The gaps formatter SHOULD use a visual marker (e.g., red dash, `[gap]`, or similar) to distinguish "this is the gap you need to close" from "this type doesn't reference this claim."

### CLI Interface

§DC.07 The `gaps` command MUST support `--note <noteId>` to scope gap analysis to a single note's claims.

Already exists in the current implementation. Preserved as-is.

§DC.08 The `gaps` command MUST support `--importance <level>` to filter by minimum importance.

Already exists. Preserved as-is.

§DC.09 The `gaps` command MUST support `--projection <type>` to filter to specific projection types.

New flag. When provided, only the named projection type(s) appear as columns. Multiple values can be comma-separated. This is more targeted than `projectionTypes` config — it filters within a single invocation.

§DC.10 The `gaps` command SHOULD support `--include-zero` to also show claims with no coverage at all (zero references from any projection type).

By default, claims with zero coverage are excluded (they aren't "partially traced" — they're completely untraced). This flag includes them for completeness. These rows would show `-` in every projection column.

§DC.11 The `gaps` command MUST support existing lifecycle filters (`--include-deferred`, `--include-closed`).

Already exists. Preserved as-is.

§DC.12 The `gaps` command MUST support `--json` for machine-readable output.

Already exists. The JSON output SHOULD include the same trace-matrix-style data (rows with projection maps) rather than the old `presentIn`/`missingFrom` arrays.

§DC.13 The `gaps` command MUST support `--sort <field>` for sorting, including `importance`.

Already exists. Preserved as-is.

§DC.14 The `gaps` command MUST support `--show-derived` for derivation tree expansion.

Already exists. Preserved as-is.

### Verified Claims

§DC.18 The `gaps` command MUST incorporate verification state from `scepter claims verify` events. A claim with a verify event but no `@implements` annotation is a confirmed constraint/invariant — it is NOT the same kind of gap as a completely untraced claim.

Specifically:
- If a claim has a verification event, it SHOULD be treated as having coverage in the "Verified" column (or equivalent). It is not an open gap.
- The trace matrix already shows verification dates. The gaps command MUST respect this: a row where the only empty columns are Source (no `@implements`) but a verification date exists is NOT partial coverage — the claim was confirmed through a non-annotation mechanism (code review, design review, integration test).
- `--include-verified-gaps` MAY be added as a flag to surface claims that have verification events but lack `@implements`, for projects that want annotation coverage even on constraint claims.

### Claim-Scoped Trace

§DC.19 The `trace` command MUST accept specific claim references in addition to note IDs. The claim reference parser MUST be applied to the input, supporting fully qualified claims (`ARCH017.§4.AC.18`), ranges (`ARCH017.§4.AC.17-20`), and multiple comma-separated claims.

When claim references are passed, the trace matrix is filtered to only those rows. The projection columns and formatting remain identical. This is a filter on existing trace output, not a new data path.

```
scepter claims trace ARCH017.§4.AC.18                    # single claim
scepter claims trace ARCH017.§4.AC.17-20                 # range
scepter claims trace ARCH017.§4.AC.18,ARCH017.§6.AC.31   # multiple
```

§DC.20 When claim references span multiple notes, the trace command MUST merge projection columns across notes. If `AC.18` is from ARCH017 and `DC.19b` is from DD001, both rows appear in the same matrix with a unified column set.

### Claim Thread View

§DC.21 A new `scepter claims thread <claimRef>` command MUST produce a tree view showing all relationships for a given claim, following reference chains up to a configurable depth.

The thread view is the claim-centric equivalent of `scepter ctx gather` — instead of gathering notes around a note, it gathers projections around a claim. For a given claim it shows:

- **Derives from** (upward): what source claim this was derived from (`derives=`)
- **Derived into** (downward): what claims derive from this one
- **Implemented by** (source): files with `@implements` annotations
- **Validated by** (tests): files with `@validates` annotations
- **Referenced by** (notes): notes that mention the claim via `{CLAIM_ID}`
- **Verified** (events): verification events from `scepter claims verify`

```
scepter claims thread ARCH017.§4.AC.18
scepter claims thread ARCH017.§4.AC.18 --depth 2
scepter claims thread DD001.DC.19b --depth 1
scepter claims thread ARCH017                             # all claims in note
```

§DC.22 The default depth MUST be 1 (direct relationships only). `--depth N` follows chains: at depth 2, a claim's derived DCs also show their implementations. At depth 0, only the claim's own metadata is shown.

§DC.25 The `thread` command MUST accept a bare note ID (e.g., `ARCH017`) in addition to specific claim references. When a note ID is passed, the command produces threads for all claims defined in that note — each claim's tree rendered in sequence. Combined with `--depth`, this gives a full view of how a note's claims propagate across the knowledge graph. This is the deep complement to `trace` (which shows the same claims in a flat matrix).

§DC.23 The thread output format MUST be a tree structure with indentation showing relationship direction:

```
ARCH017.§4.AC.18: "The primary registration path is convention-based auto-wiring..."
  ├─ derives-into: DD001.DC.19b "Auto-wire discovery (during bind())"
  │   ├─ @implements: src/schema/blob/migration-registry.ts:89
  │   ├─ @implements: src/runtime.ts:521
  │   └─ @validates: migration-registry.test.ts:TC.77,TC.78,TC.79,TC.130
  ├─ @implements: src/schema/blob/migration-registry.ts:5
  ├─ @validates: migration-registry.test.ts:TC.77
  ├─ referenced-by: S024 (§9.1)
  └─ verified: 2026-03-18 (agent, code-review)
```

§DC.24 The `thread` command MUST support `--json` for machine-readable output. The JSON structure MUST be a tree of nodes with `claim`, `relationship`, `file`, `line`, and `children` fields.

### Edge Cases

§DC.15 Claims with no cross-references at all (only defined in their own note) MUST be excluded from gaps output by default.

These claims have no projection coverage anywhere — they appear in no trace matrix columns. They aren't "partially traced" — they are untraced. Including them would reintroduce noise. The `--include-zero` flag (§DC.10) provides access when needed.

§DC.16 Claims with full coverage (all discovered projection types have references) MUST be excluded from gaps output.

These claims are fully traced. No gap to report.

§DC.17 Single-projection claims (referenced by exactly one non-source note type) MUST be included in gaps output only when `projectionTypes` config or `--projection` flag indicates additional expected projections.

A claim referenced by only one type technically has partial coverage if the project expects more projections. Without config or flags, a single-projection claim cannot be determined to have a gap — there is no second column to be empty. With config, the configured types provide the expected columns.

## Module Inventory

### File: `core/src/claims/traceability.ts`

| Change | What | Notes |
|--------|------|-------|
| ADD | `findPartialCoverageGaps(index, options?)` | New function. Builds trace matrices for all claim-defining notes, aggregates rows, filters to partial coverage. Returns `TraceabilityMatrix` with only gap rows. |
| KEEP | `buildTraceabilityMatrix()` | Unchanged. Reused internally by the new function. |
| KEEP | `findGaps()` | Keep for backward compatibility but mark as deprecated. |

```
ADD function findPartialCoverageGaps(
  index: ClaimIndexData,
  options?: PartialCoverageOptions
): TraceabilityMatrix

ADD interface PartialCoverageOptions {
  noteId?: string;               // scope to single note
  projectionFilter?: string[];   // restrict columns to these types
  includeZeroCoverage?: boolean; // include claims with no coverage at all
  excludeClosed?: boolean;       // default true
  excludeDeferred?: boolean;     // default true
  derivativesLookup?: (claimId: string) => string[];
}
```

### File: `core/src/cli/commands/claims/gaps-command.ts`

| Change | What | Notes |
|--------|------|-------|
| MODIFY | Command options | Add `--projection`, `--include-zero`; remove hard requirement on `projectionTypes` config |
| MODIFY | Action handler | Call `findPartialCoverageGaps()` instead of `findGaps()`; use `formatTraceabilityMatrix()` instead of `formatGapReport()` |

### File: `core/src/cli/formatters/claim-formatter.ts`

| Change | What | Notes |
|--------|------|-------|
| ADD | Gap-specific formatting in `formatTraceabilityMatrix()` | Add option to highlight empty cells as gaps (red dash or marker) when rendering a gap-filtered matrix |
| KEEP | `formatGapReport()` | Keep for backward compatibility |

Add to `TraceDisplayOptions`:

```
ADD field gapMode?: boolean;  // when true, highlight empty projection cells as gaps
```

## Wiring Map

### Call Chain: `scepter claims gaps`

```
gaps-command.ts (CLI entry)
  → ensureIndex(projectManager)
    → returns ClaimIndexData
  → read config for optional projectionTypes
  → findPartialCoverageGaps(indexData, options)
    → for each claim-defining note in index:
        → buildTraceabilityMatrix(noteId, indexData)
    → merge all rows, deduplicate projection types
    → filter: exclude rows where all columns are empty (unless --include-zero)
    → filter: exclude rows where all columns have data (full coverage)
    → apply lifecycle filtering (closed, deferred, removed, superseded)
    → apply --importance filter
    → apply --projection filter on columns
    → return TraceabilityMatrix (filtered)
  → formatTraceabilityMatrix(matrix, { gapMode: true, ...displayOpts })
    → stdout
```

### Import Changes

```
gaps-command.ts:
  REMOVE import { findGaps } from '../../../claims/index.js'
  ADD    import { findPartialCoverageGaps } from '../../../claims/index.js'
  ADD    import { formatTraceabilityMatrix } from '../../formatters/claim-formatter.js'
  REMOVE import { formatGapReport } from '../../formatters/claim-formatter.js'
```

## Data Flow

### Gap Detection Flow

1. CLI parses options (`--note`, `--importance`, `--projection`, `--include-zero`, etc.)
2. `ensureIndex()` builds or refreshes the claim index
3. `findPartialCoverageGaps()` receives the index and options
4. For each unique note ID in `index.entries`:
   a. Call `buildTraceabilityMatrix(noteId, index)` — this discovers projection types organically
   b. Collect rows and projection types
5. Build a unified projection type set across all notes
6. For each row, evaluate coverage against the unified projection types:
   - If `--projection` is set, restrict columns to those types
   - If `projectionTypes` config exists and `--projection` is not set, restrict to configured types
   - Otherwise, use all discovered types
7. Apply coverage filter:
   - Count non-empty columns per row
   - Exclude if all columns empty (unless `--include-zero`)
   - Exclude if all columns filled
   - Keep if at least one empty and at least one filled
8. Apply lifecycle, importance, and sort filters
9. Return filtered `TraceabilityMatrix`
10. Format with `formatTraceabilityMatrix()` in gap mode
11. Output to stdout

## Integration Sequence

### Step 1: Add `findPartialCoverageGaps()` to traceability.ts

**Files**: `core/src/claims/traceability.ts`
**Changes**: Add `PartialCoverageOptions` interface and `findPartialCoverageGaps()` function. This function calls `buildTraceabilityMatrix()` per note, merges results, filters to partial coverage.
**Verify**: Unit test: given an index with claims that have 0, partial, and full coverage, the function returns only partial-coverage rows.

### Step 2: Add gap mode to trace formatter

**Files**: `core/src/cli/formatters/claim-formatter.ts`
**Changes**: Add `gapMode` field to `TraceDisplayOptions`. When true, empty projection cells render with a visual gap marker (e.g., chalk.red('-') instead of chalk.gray('-')).
**Verify**: Visual inspection: gap-mode trace output highlights missing cells in red.

### Step 3: Rewire gaps-command.ts

**Files**: `core/src/cli/commands/claims/gaps-command.ts`
**Changes**:
- Add `--projection <types>` option
- Add `--include-zero` option
- Remove `projectionTypes` config requirement (no more early exit warning)
- Replace `findGaps()` call with `findPartialCoverageGaps()`
- Replace `formatGapReport()` call with `formatTraceabilityMatrix()` in gap mode
- Preserve existing filters: `--importance`, `--include-deferred`, `--include-closed`, `--sort`, `--show-derived`, `--json`, `--note`
**Verify**: `scepter claims gaps` produces a trace-matrix-style table showing only partially-covered claims. `scepter claims gaps --note R004` scopes to R004. Empty cells are visually marked as gaps.

### Step 4: Update JSON output

**Files**: `core/src/cli/commands/claims/gaps-command.ts`
**Changes**: JSON output emits the `TraceabilityMatrix` structure (rows with projection maps) instead of `GapReport[]` arrays.
**Verify**: `scepter claims gaps --json` outputs trace-matrix-style JSON with rows and projection data.

### Step 5: Export from claims/index.ts

**Files**: `core/src/claims/index.ts`
**Changes**: Export `findPartialCoverageGaps` and `PartialCoverageOptions` from the claims barrel.
**Verify**: Import works from gaps-command.ts.

## Testing Strategy

| Test Level | Scope | Claims Covered |
|-----------|-------|----------------|
| Unit | `findPartialCoverageGaps()` with mock index data | §DC.01, §DC.02, §DC.03, §DC.15, §DC.16, §DC.17 |
| Unit | `findPartialCoverageGaps()` with `projectionFilter` option | §DC.04, §DC.09 |
| Unit | `findPartialCoverageGaps()` with `includeZeroCoverage` option | §DC.10 |
| Unit | `findPartialCoverageGaps()` lifecycle filtering | §DC.11 |
| Unit | `formatTraceabilityMatrix()` with `gapMode: true` | §DC.05, §DC.06 |
| Unit | `findPartialCoverageGaps()` verified claim filtering | §DC.18 |
| Unit | Claim reference parser on trace input (single, range, multi) | §DC.19 |
| Unit | Cross-note trace matrix merge | §DC.20 |
| Unit | `buildClaimThread()` with mock index, depth 1 and 2 | §DC.21, §DC.22 |
| Unit | `formatClaimThread()` tree output | §DC.23 |
| Integration | Full CLI: `scepter claims gaps` on a project with mixed coverage | §DC.01-§DC.18 |
| Integration | `scepter claims trace ARCH017.§4.AC.18` returns single-row matrix | §DC.19 |
| Integration | `scepter claims thread ARCH017.§4.AC.18 --depth 2` returns tree | §DC.21-§DC.24 |

## Observations

1. **`findGaps()` deprecation**: The old `findGaps()` function should be kept but marked as deprecated. It may be used by other consumers (the claims system barrel exports it). A future cleanup task can remove it once all callers migrate.

2. **`formatGapReport()` deprecation**: Similarly, the old gap report formatter is kept but no longer called by the default gaps command. It remains available for any external consumers.

3. **`projectionTypes` config**: The current config key `claims.projectionTypes` shifts from "required for gaps to work" to "optional filter for gaps." This is a behavioral change — the command works without any config. The config docs may need updating.

4. **Source projection**: The trace matrix includes a "Source" projection type for source code references. The gaps command should include this column — a claim with DD and Spec coverage but no Source coverage is a real gap worth surfacing.

5. **Performance**: Building trace matrices for every claim-defining note iterates `crossRefs` once per note. For large projects this could be O(notes * crossRefs). If performance becomes an issue, a single-pass approach that groups crossRefs by target note could optimize this, but premature optimization is not warranted for a CLI diagnostic tool.
