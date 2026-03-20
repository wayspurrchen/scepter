---
created: 2026-03-11
tags: [claims, derivation, traceability]
status: draft
---

# DD003 - Claim Derivation Tracing

**Spec:** {R006}
**Created:** 2026-03-11

## §1 Epistemic Review of {R006}

### Binding Analysis

**HIGH BINDING** (must design first; everything else depends on these):

- **R006.§1 (Derivation Metadata Recognition)** — The metadata parser is the single entry point for all claim metadata interpretation. `parseClaimMetadata()` must recognize `derives=TARGET` as a semantic keyword alongside the existing `superseded=TARGET`. This change is load-bearing: every downstream consumer (index, trace, gaps, lint) depends on the metadata parser's output shape. The `ParsedMetadata` interface gains a new field, and every site that constructs or reads `ParsedMetadata` is affected. {R006.§1.AC.01}, {R006.§1.AC.02}, {R006.§1.AC.03}, {R006.§1.AC.04} are all MUST-level and constrain the parser, the index, and the linter.

- **R006.§2 (Index Support for Derivation Relationships)** — The claim index is the central computed artifact. Adding `derivedFrom` to `ClaimIndexEntry` and bidirectional graph traversal methods (`getDerivedFrom()`, `getDerivatives()`) to `ClaimIndex` determines what queries are possible downstream. The trace, gaps, and lint commands all depend on this index shape. {R006.§2.AC.01} through {R006.§2.AC.04} are all MUST-level.

**MEDIUM BINDING** (constrained by above, but have design freedom):

- **R006.§3 (Derivation-Aware Gap Detection)** — Depends on §2's derivation graph. The gap closure logic is the primary payoff of this feature: a source AC's gap is closed when its derivatives collectively provide Source coverage. The specific algorithm has latitude but is constrained by the index shape. {R006.§3.AC.01}, {R006.§3.AC.02}, {R006.§3.AC.03} define the gap behavior.

- **R006.§4 (Derivation Display in Trace)** — Depends on §2's derivation graph. Display choices have latitude, but the `--show-derived` flag and the `<-SOURCE` indicator are specified. {R006.§4.AC.01}, {R006.§4.AC.02}, {R006.§4.AC.03} define trace behavior.

**LOW BINDING** (layers on top):

- **R006.§5 (Lint Validation)** — Consumes the derivation graph from §2 but is otherwise independent. Lint rules are additive: validate targets exist, warn on deep chains, warn on partial coverage. {R006.§5.AC.01}, {R006.§5.AC.02}, {R006.§5.AC.03}.

### Modal Status Distribution

| Category | MUST | SHOULD | MAY |
|----------|------|--------|-----|
| §1 Derivation Metadata Recognition | 3 (AC.01, AC.03, AC.04) | 0 | 1 (AC.02 — multiple derives) |
| §2 Index Support | 4 (AC.01-AC.04) | 0 | 0 |
| §3 Gap Detection | 3 (AC.01-AC.03) | 0 | 0 |
| §4 Trace Display | 3 (AC.01-AC.03) | 0 | 0 |
| §5 Lint Validation | 3 (AC.01-AC.03) | 0 | 0 |

16 MUST-level ACs, 1 MAY-level AC. No optionality aside from {R006.§1.AC.02} (multiple derivation sources), which is included in this design.

### Inherence Observations

**Inherent to the problem (load-bearing, non-negotiable):**

- `derives=TARGET` uses the existing `key=value` metadata mechanism from {R005.§2.AC.04b}. No new syntax is required. This is inherent: derivation is a relationship expressed in metadata, not a new parsing construct.
- Derivation is explicit, not inferred. The system does not guess derivation from naming patterns. This is inherent to the design principle of auditable traceability.
- Bidirectional indexing is inherent: you must be able to ask both "what does X derive from?" and "what derives from X?" without rescanning documents.

**Contingent (our design choice):**

- Storing `derivedFrom` as `string[]` on `ClaimIndexEntry` (vs. a separate adjacency list). We choose inline storage for simplicity and query locality.
- Building a `Map<string, string[]>` for the reverse direction (`derivatives`) vs. computing it on demand. We choose a precomputed map for O(1) lookup.
- Chain depth limit of 2 hops as a warning threshold. The number is R006's recommendation; the enforcement level (warning, not error) is our choice.
- Gap closure semantics: "all derivatives must have Source coverage" to close a source gap. This is specified by R006 and is the correct semantic.

### Open Question Resolutions

**Edge case: Circular derivation.** R006 specifies the linter must detect and report circular derivation chains as an error, and the index builder must handle cycles without infinite loops. Resolution: the index builder uses a visited set during graph walks; the linter runs a separate cycle detection pass.

**Edge case: Derivation target is removed.** R006 specifies a linter warning. Resolution: handled alongside the existing `reference-to-removed` pattern from {R005.§2.AC.05}.

**Edge case: Derivation and supersession.** R006 specifies `derives` and `superseded` are mutually exclusive on the same claim. Resolution: the linter flags this as an error; `parseClaimMetadata()` stores whichever appears first.

## §2 Specification Scope

### Covered in this design

| Section | ACs | Area |
|---------|-----|------|
| §1 | AC.01-AC.04 | Derivation metadata recognition in parser |
| §2 | AC.01-AC.04 | Index support for derivation relationships |
| §3 | AC.01-AC.03 | Derivation-aware gap detection |
| §4 | AC.01-AC.03 | Derivation display in trace |
| §5 | AC.01-AC.03 | Lint validation for derivation |

All 17 ACs covered. No deferrals.

### Deferred

None. All ACs are addressed in this design.

## Current State

The following files and types form the IS-state baseline that this design builds on. This is the state AFTER {DD001} and {DD002} have been implemented.

### Metadata Parser

- **`core/src/claims/claim-metadata.ts`** — `parseClaimMetadata(rawMetadata: string[]): ParsedMetadata` interprets raw metadata strings from the parser layer. Currently handles: bare digits 1-5 as importance, lifecycle tags (`closed`, `deferred`, `removed`, `superseded=TARGET`), and freeform tags. `ParsedMetadata` has fields `importance?: number`, `lifecycle?: LifecycleState`, `tags: string[]`. The function `isLifecycleTag()` checks for the four lifecycle keywords and `superseded=*` pattern. **There is no recognition of `derives=*` as a semantic keyword** — it would currently be pushed into `tags[]` as a freeform string.

### Claim Index

- **`core/src/claims/claim-index.ts`** — `ClaimIndex` class with `build()` method. `ClaimIndexEntry` stores: `noteId`, `claimId`, `fullyQualified`, `sectionPath`, `claimPrefix`, `claimNumber`, `heading`, `line`, `endLine`, `metadata` (raw), `importance`, `lifecycle`, `parsedTags`, `noteType`, `noteFilePath`. **No `derivedFrom` field exists.** The index has no concept of derivation relationships. Methods: `getClaimsForNote()`, `getClaim()`, `getCrossRefsFrom()`, `getCrossRefsTo()`, `getErrors()`, `addSourceReferences()`, `getData()`.

- **`core/src/claims/claim-index.ts`** — `ClaimIndexData` contains `entries: Map<string, ClaimIndexEntry>`, `trees: Map<string, ClaimNode[]>`, `noteTypes: Map<string, string>`, `crossRefs: ClaimCrossReference[]`, `errors: ClaimTreeError[]`. **No derivation-specific data structures exist.**

### Traceability

- **`core/src/claims/traceability.ts`** — `buildTraceabilityMatrix()` produces a `TraceabilityMatrix` with rows for claims and columns for projection types. Two modes: incoming (for claim-defining notes) and outgoing (for referencing notes). `findGaps()` checks which note types reference each claim; claims referenced in some types but not others are gaps. **No derivation awareness** — gap detection is purely presence-based with no understanding that derived claims can close a source claim's gap.

### CLI Commands

- **`core/src/cli/commands/claims/trace-command.ts`** — `scepter claims trace <id>`. Supports `--importance`, `--sort`, `--width`, `--full`, `--no-excerpts`, `--json`. **No `--show-derived` flag.** No derivation display.

- **`core/src/cli/commands/claims/gaps-command.ts`** — `scepter claims gaps`. Supports `--importance`, `--include-deferred`, `--include-closed`, `--sort`, `--note`, `--json`. **No `--show-derived` flag.** No derivation-aware gap closure.

- **`core/src/cli/commands/claims/lint-command.ts`** — `scepter claims lint <noteId>`. Validates tree structure, lifecycle tags (multiple lifecycle, invalid supersession target, reference to removed). **No derivation validation** (target existence, chain depth, partial coverage).

### Formatters

- **`core/src/cli/formatters/claim-formatter.ts`** — `formatTraceabilityMatrix()`, `formatClaimTrace()`, `formatGapReport()`, `formatLintResults()`, `formatClaimTree()`, `formatIndexSummary()`, `formatStalenessReport()`. **No derivation-specific display logic** — no `<-SOURCE` indicator, no derivation tree expansion, no partial derivation coverage in gap reports.

### Key Architectural Constraint

`parseClaimMetadata()` already handles `superseded=TARGET` via `isLifecycleTag()`. The `derives=TARGET` pattern is structurally identical — a `key=value` item in the metadata suffix. But `derives` is NOT a lifecycle tag. It is a relationship, not a state. It must be handled as a separate concern in `parseClaimMetadata()`, producing a new field on `ParsedMetadata` rather than being stored in `lifecycle`.

## §3 Module Inventory

### MODIFY: `core/src/claims/claim-metadata.ts`

- ADD field to `ParsedMetadata`: `derivedFrom: string[]` — resolved claim paths from `derives=TARGET` metadata entries. Empty array when no derivation.
  Spec: {R006.§1.AC.01}, {R006.§1.AC.02}

- MODIFY `parseClaimMetadata()` — add recognition of `derives=TARGET` items in the raw metadata loop. For each item starting with `derives=`, extract the target string after `=` and push to the `derivedFrom` array. This runs BEFORE the lifecycle tag check (since `derives=*` is not a lifecycle tag). Multiple `derives=` items are independently collected per {R006.§1.AC.02}.
  Spec: {R006.§1.AC.01}, {R006.§1.AC.02}, {R006.§1.AC.04}

- ADD `function isDerivationTag(tag: string): boolean` — returns true if tag starts with `derives=` and has a non-empty target. Used by `parseClaimMetadata()` and re-exported for use in lint validation.
  Spec: {R006.§1.AC.01}

### MODIFY: `core/src/claims/claim-index.ts`

- ADD field to `ClaimIndexEntry`: `derivedFrom: string[]` — resolved fully qualified claim paths from `derives=TARGET` metadata. Populated during `build()` from `ParsedMetadata.derivedFrom`. Empty array when no derivation.
  Spec: {R006.§2.AC.01}

- ADD private field to `ClaimIndex`: `derivativesMap: Map<string, string[]>` — reverse index mapping source claim FQIDs to arrays of derived claim FQIDs. Built during `build()` after all entries are populated.
  Spec: {R006.§2.AC.04}

- MODIFY `build()` — after Phase 1 (tree extraction and entry creation), add Phase 1.5: Derivation Resolution.
  1. For each `ClaimIndexEntry` with non-empty `parsedMetadata.derivedFrom`:
     a. For each target in `derivedFrom`, resolve via `resolveClaimAddress()` against the index entries (the target may be partially qualified).
     b. Store resolved FQIDs in `entry.derivedFrom`.
     c. Populate `derivativesMap`: for each resolved target, append the current entry's FQID to the map.
  2. Unresolvable targets: push error to `data.errors` with type `'unresolvable-derivation-target'` (linter also catches this, but the index builder records it for completeness).
  Spec: {R006.§2.AC.01}, {R006.§2.AC.04}

- ADD method `getDerivedFrom(claimId: string): string[]` — returns `entry.derivedFrom` for the given fully qualified claim ID. Returns empty array if claim not found or has no derivation.
  Spec: {R006.§2.AC.02}

- ADD method `getDerivatives(claimId: string): string[]` — returns `derivativesMap.get(claimId) ?? []`. This is the reverse direction: all claims that declare `derives=TARGET` pointing to the given claim.
  Spec: {R006.§2.AC.03}

### MODIFY: `core/src/claims/traceability.ts`

- ADD field to `TraceabilityRow`: `derivedFrom: string[]` — source claim FQIDs this claim derives from. Copied from `ClaimIndexEntry.derivedFrom`.
  Spec: {R006.§4.AC.01}

- ADD field to `GapReport`: `derivationStatus?: { totalDerivatives: number, coveredDerivatives: number, uncoveredDerivatives: string[] }` — when a gap's claim has derivatives, this field describes their coverage status.
  Spec: {R006.§3.AC.02}

- MODIFY `findGaps()` — after the existing gap detection loop, add derivation-aware gap closure:
  1. For each candidate gap (claim that would normally appear as a gap):
     a. Look up derivatives via `index` (using the new derivativesMap on the data object or a helper passed in).
     b. If the claim has derivatives:
        - Count how many derivatives have Source projection coverage (cross-refs from `source:*` noteIds).
        - If ALL derivatives have Source coverage: remove the claim from the gap list (gap is closed by derivation). Per {R006.§3.AC.01}.
        - If SOME but not all have coverage: keep the claim as a gap but annotate with `derivationStatus` showing which derivatives are covered and which are missing. Per {R006.§3.AC.02}.
     c. If no derivatives, standard gap detection applies (unchanged behavior).
  Spec: {R006.§3.AC.01}, {R006.§3.AC.02}

- ADD parameter to `findGaps()` signature: `derivativesLookup?: (claimId: string) => string[]` — a function that returns derivatives for a given claim FQID. This is injected from the `ClaimIndex.getDerivatives()` method, keeping `traceability.ts` free of direct `ClaimIndex` coupling.
  Spec: {R006.§3.AC.01}

### MODIFY: `core/src/cli/commands/claims/trace-command.ts`

- ADD option `--show-derived` to the trace command.
  Spec: {R006.§4.AC.02}

- MODIFY note-level trace: pass `--show-derived` flag and `ClaimIndex.getDerivatives` function to the formatter.
  Spec: {R006.§4.AC.02}

- MODIFY single-claim trace: when the traced claim has derivation metadata, display the derivation source. When `--show-derived` is active and the traced claim has derivatives, list them inline.
  Spec: {R006.§4.AC.01}, {R006.§4.AC.02}

- MODIFY JSON output: include `derivedFrom` field per row, and when `--show-derived` is active, include `derivatives` array.
  Spec: {R006.§4.AC.01}

### MODIFY: `core/src/cli/commands/claims/gaps-command.ts`

- ADD option `--show-derived` to the gaps command.
  Spec: {R006.§3.AC.03}

- MODIFY: pass `ClaimIndex.getDerivatives` lookup to `findGaps()`.
  Spec: {R006.§3.AC.01}

- MODIFY: when `--show-derived` is active, expand gap reports to show the derivation tree per gap (which derivatives are covered, which are not).
  Spec: {R006.§3.AC.03}

### MODIFY: `core/src/cli/commands/claims/lint-command.ts`

- ADD derivation validation after index build, in addition to existing lifecycle validation:
  1. **Unresolvable derivation target:** For each claim with `derives=TARGET`, validate that TARGET resolves to an existing claim in the index. Unresolvable → error type `'invalid-derivation-target'`. Per {R006.§5.AC.01}.
  2. **Deep derivation chains:** Walk the derivation graph from each derived claim. If a chain exceeds 2 hops (A derives B, B derives C, C derives D — D is 3 hops from A), warn with type `'deep-derivation-chain'`. Use visited set to prevent infinite loops on cycles. Per {R006.§5.AC.02}.
  3. **Partial derivation coverage:** For each source claim that has derivatives, check if all derivatives have Source coverage. If some but not all do, warn with type `'partial-derivation-coverage'`. Per {R006.§5.AC.03}.
  4. **Circular derivation:** While walking chains in (2), detect cycles. Report as error type `'circular-derivation'`. Per R006 edge case specification.
  5. **Self-derivation:** If a claim's `derives=TARGET` resolves to itself, error type `'self-derivation'`. Per R006 edge case specification.
  6. **Derives + superseded conflict:** If a claim has both `derives=` and `superseded=` metadata, error type `'derives-superseded-conflict'`. Per R006 non-goals (mutually exclusive).
  7. **Derivation from removed claim:** If a claim's `derives=TARGET` points to a claim tagged `:removed`, warn type `'derivation-from-removed'`. Per R006 edge case specification.
  8. **Derivation from superseded claim:** If a claim's `derives=TARGET` points to a claim tagged `:superseded`, warn type `'derivation-from-superseded'`. Per R006 edge case specification.
  Spec: {R006.§5.AC.01}, {R006.§5.AC.02}, {R006.§5.AC.03}

### MODIFY: `core/src/cli/formatters/claim-formatter.ts`

- MODIFY `formatTraceabilityMatrix()` — when `showDerived` option is active:
  1. For each row that has derivatives, insert sub-rows indented under the source claim showing each derived claim and its coverage.
  2. Source claims with full derivation coverage get a `[derived:OK]` marker.
  3. Source claims with partial derivation coverage get a `[derived:partial N/M]` marker.
  Spec: {R006.§4.AC.02}

- MODIFY `formatTraceabilityMatrix()` — in default mode (without `--show-derived`):
  1. For rows where `derivedFrom` is non-empty, append a `<-SOURCE_FQID` indicator after the claim ID to identify the derivation source.
  Spec: {R006.§4.AC.03}

- MODIFY `formatClaimTrace()` — for single-claim trace:
  1. If the claim has `derivedFrom`, show "Derived from: SOURCE_FQID(s)" line after the heading.
  2. If `--show-derived` is active and the claim has derivatives, show a "Derivatives:" section listing each derivative with its coverage status.
  Spec: {R006.§4.AC.01}, {R006.§4.AC.02}

- MODIFY `formatGapReport()` — when `derivationStatus` is present on a gap:
  1. Show "Derivation coverage: N/M derivatives covered" line.
  2. List uncovered derivatives.
  3. When `--show-derived` is active, show full derivation tree.
  Spec: {R006.§3.AC.02}, {R006.§3.AC.03}

- ADD to `formatLintResults()` / `formatErrorType()` — new error type formatting:
  - `'invalid-derivation-target'` → red `[INVALID-DERIVATION]`
  - `'deep-derivation-chain'` → yellow `[DEEP-CHAIN]`
  - `'partial-derivation-coverage'` → yellow `[PARTIAL-DERIVATION]`
  - `'circular-derivation'` → red `[CIRCULAR-DERIVATION]`
  - `'self-derivation'` → red `[SELF-DERIVATION]`
  - `'derives-superseded-conflict'` → red `[DERIVES-SUPERSEDED]`
  - `'derivation-from-removed'` → yellow `[DERIVES-FROM-REMOVED]`
  - `'derivation-from-superseded'` → yellow `[DERIVES-FROM-SUPERSEDED]`
  Spec: {R006.§5.AC.01}, {R006.§5.AC.02}, {R006.§5.AC.03}

### MODIFY: `core/src/claims/index.ts`

- ADD re-export of `isDerivationTag` from `./claim-metadata.js`
  Spec: {R006.§1.AC.01}

### MODIFY: `core/src/cli/commands/claims/ensure-index.ts`

No changes required. The existing `ensureIndex()` function calls `ClaimIndex.build()` which will now populate derivation data automatically during build. The derivativesMap is constructed inside `build()`. Downstream consumers (trace, gaps, lint) access derivation data through `ClaimIndex` methods.

## §4 Wiring Map

```
parseClaimMetadata() ── NEW: derives= recognition ──> ParsedMetadata
                                                        ├─ importance?: number      (existing)
                                                        ├─ lifecycle?: LifecycleState (existing)
                                                        ├─ tags: string[]           (existing)
                                                        └─ derivedFrom: string[]    (NEW)

ClaimIndex.build()
  ├─ Phase 1:   Tree extraction + entry creation     (existing)
  ├─ Phase 1.5: Derivation resolution                (NEW)
  │   ├─ reads: ParsedMetadata.derivedFrom
  │   ├─ resolves: targets via resolveClaimAddress()
  │   ├─ populates: ClaimIndexEntry.derivedFrom      (NEW)
  │   └─ populates: ClaimIndex.derivativesMap        (NEW)
  ├─ Phase 2:   Cross-reference scanning             (existing)
  └─ produces: ClaimIndexData
       ├─ entries: Map<string, ClaimIndexEntry>
       │    └─ each entry now has derivedFrom: string[]
       ├─ trees, noteTypes, crossRefs, errors         (existing)
       └─ (derivativesMap is on ClaimIndex instance, not ClaimIndexData)

ClaimIndex query methods:
  ├─ getDerivedFrom(claimId): string[]               (NEW)
  ├─ getDerivatives(claimId): string[]               (NEW)
  ├─ getClaimsForNote(), getClaim(), etc.            (existing)

Traceability layer:
  findGaps(index, allNoteTypes, filterOpts?, derivativesLookup?)
    ├─ standard gap detection                         (existing)
    ├─ derivation-aware gap closure                   (NEW)
    │   ├─ calls derivativesLookup(claimId) for each gap candidate
    │   ├─ checks Source coverage on each derivative
    │   └─ closes gap if ALL derivatives covered
    └─ annotates partial coverage on GapReport        (NEW)

CLI:
  trace-command.ts
    ├─ --show-derived flag                            (NEW)
    ├─ derivedFrom display per claim                  (NEW)
    └─ derivative tree expansion                      (NEW)

  gaps-command.ts
    ├─ --show-derived flag                            (NEW)
    ├─ passes derivativesLookup to findGaps()         (NEW)
    └─ derivation status in gap display               (NEW)

  lint-command.ts
    ├─ validateDerivationLinks()                      (NEW)
    │   ├─ invalid-derivation-target
    │   ├─ deep-derivation-chain
    │   ├─ partial-derivation-coverage
    │   ├─ circular-derivation
    │   ├─ self-derivation
    │   ├─ derives-superseded-conflict
    │   ├─ derivation-from-removed
    │   └─ derivation-from-superseded
    └─ existing lifecycle validation                  (unchanged)
```

### Import Chain for Derivation Build

```
ClaimIndex.build()
  → parseClaimMetadata(node.metadata)     // returns ParsedMetadata with derivedFrom[]
  → resolveClaimAddress(target, entries)  // resolve each derivedFrom target
  → populate entry.derivedFrom            // store resolved FQIDs
  → populate this.derivativesMap          // build reverse index
```

### Import Chain for Derivation-Aware Gap Detection

```
gaps-command.ts
  → ensureIndex(projectManager)           // build index (derivation included)
  → findGaps(data, noteTypes, filterOpts, claimIndex.getDerivatives.bind(claimIndex))
  → for each gap candidate:
       → derivativesLookup(claimId)       // get derived claims
       → check Source coverage per derivative via crossRefs
       → close or annotate
  → formatGapReport(gaps, { showDerived })
```

## §5 Data Flow

### Flow 1: Derivation Metadata Parsing

1. **Entry:** User writes `### DC.01:derives=R005.§1.AC.01 — parser extracts importance` in a DD document.
2. `buildClaimTree()` calls `parseMetadataSuffix("DC.01:derives=R005.§1.AC.01")` which produces `{ id: "DC.01", metadata: ["derives=R005.§1.AC.01"] }`.
3. `ClaimNode` stores `metadata: ["derives=R005.§1.AC.01"]`.
4. `ClaimIndex.build()` creates `ClaimIndexEntry`, calls `parseClaimMetadata(["derives=R005.§1.AC.01"])`.
5. `parseClaimMetadata()` recognizes `derives=` prefix → extracts target `"R005.§1.AC.01"` → `derivedFrom: ["R005.§1.AC.01"]`.
6. `ClaimIndexEntry` has `derivedFrom: ["R005.1.AC.01"]` (after § normalization during resolution).

### Flow 2: Multiple Derivation Sources

1. **Entry:** `### DC.01:derives=R005.§1.AC.01:derives=R005.§1.AC.02` in a document.
2. `parseMetadataSuffix()` → `{ id: "DC.01", metadata: ["derives=R005.§1.AC.01", "derives=R005.§1.AC.02"] }`.
3. `parseClaimMetadata()` collects both targets → `derivedFrom: ["R005.§1.AC.01", "R005.§1.AC.02"]`.
4. In the derivativesMap, `R005.1.AC.01` and `R005.1.AC.02` both get `DD_ID.X.DC.01` appended.

### Flow 3: Derivation-Aware Gap Closure

1. **Setup:** R005.§1.AC.01 is a requirement AC. DD003.§1.DC.01, DD003.§1.DC.02, DD003.§1.DC.03 all declare `derives=R005.§1.AC.01`. All three DCs have Source projection coverage (source files contain `@implements {DD003.§1.DC.01}` etc.).
2. `scepter claims gaps` runs. `findGaps()` iterates claims.
3. R005.§1.AC.01 is a candidate gap — it has no direct Source coverage.
4. `derivativesLookup("R005.1.AC.01")` returns `["DD003.1.DC.01", "DD003.1.DC.02", "DD003.1.DC.03"]`.
5. For each derivative, check if Source cross-refs exist: all 3 have `source:*` refs → all covered.
6. Gap is closed. R005.§1.AC.01 does NOT appear in the gap report. Per {R006.§3.AC.01}.

### Flow 4: Partial Derivation Coverage

1. **Setup:** Same as Flow 3, but DD003.§1.DC.03 has NO Source coverage.
2. `derivativesLookup("R005.1.AC.01")` returns 3 derivatives.
3. Check Source coverage: DC.01 and DC.02 have it, DC.03 does not.
4. Gap is NOT closed. R005.§1.AC.01 appears with `derivationStatus: { totalDerivatives: 3, coveredDerivatives: 2, uncoveredDerivatives: ["DD003.1.DC.03"] }`.
5. Gap report shows: "2/3 derivatives covered. Missing: DD003.§1.DC.03". Per {R006.§3.AC.02}.

### Flow 5: Trace with Derivation Display

1. `scepter claims trace R005 --show-derived` runs.
2. `buildTraceabilityMatrix("R005", data)` produces rows for each R005 claim.
3. For row R005.§1.AC.01, formatter checks `getDerivatives("R005.1.AC.01")` → returns 3 derivatives.
4. Formatter inserts sub-rows under AC.01 showing DC.01, DC.02, DC.03 with their respective coverage.
5. AC.01's row shows `[derived:OK]` or `[derived:partial 2/3]` depending on coverage.
6. Per {R006.§4.AC.02}.

### Flow 6: Default Trace (Derived Claim Shows Source)

1. `scepter claims trace DD003` runs (no `--show-derived`).
2. Row for DD003.§1.DC.01 has `derivedFrom: ["R005.1.AC.01"]`.
3. Formatter appends `<-R005.§1.AC.01` indicator after the claim ID.
4. Per {R006.§4.AC.03}.

### Flow 7: Lint Derivation Validation

1. `scepter claims lint DD003` runs.
2. Index is built. `validateDerivationLinks("DD003", indexData, claimIndex)` runs.
3. For each DD003 claim with `derives=TARGET`:
   a. Resolve TARGET in index. If not found → error `'invalid-derivation-target'`.
   b. Walk chain: DC.01 derives R005.§1.AC.01. Check if R005.§1.AC.01 itself derives from something. If chain > 2 hops → warn `'deep-derivation-chain'`.
   c. Check if TARGET is `:removed` → warn `'derivation-from-removed'`.
   d. Check if TARGET is `:superseded` → warn `'derivation-from-superseded'`.
4. Check all source claims that have DD003 derivatives: if some derivatives lack Source coverage → warn `'partial-derivation-coverage'`.

## §6 Integration Sequence

### Phase 1: Metadata Parser Extension

**Files:**
- `core/src/claims/claim-metadata.ts` (MODIFY)
- `core/src/claims/index.ts` (MODIFY)

**Changes:**
- Add `derivedFrom: string[]` field to `ParsedMetadata` interface.
- Add `isDerivationTag(tag: string): boolean` function.
- Modify `parseClaimMetadata()` to recognize `derives=TARGET` items before the lifecycle check. For each match, extract target and push to `derivedFrom[]`. The item does NOT get pushed to `tags[]` or affect `lifecycle`.
- Add re-export of `isDerivationTag` from `claims/index.ts`.

**Verify:**
- `parseClaimMetadata(["derives=R005.§1.AC.01"])` → `{ derivedFrom: ["R005.§1.AC.01"], tags: [] }`
- `parseClaimMetadata(["4", "derives=R005.§1.AC.01", "closed"])` → `{ importance: 4, derivedFrom: ["R005.§1.AC.01"], lifecycle: { type: 'closed' }, tags: [] }`
- `parseClaimMetadata(["derives=R005.§1.AC.01", "derives=R005.§1.AC.02"])` → `{ derivedFrom: ["R005.§1.AC.01", "R005.§1.AC.02"], tags: [] }`
- `parseClaimMetadata(["superseded=X", "derives=Y"])` → both lifecycle and derivedFrom populated (coexistence)
- `isDerivationTag("derives=R005.§1.AC.01")` → `true`
- `isDerivationTag("derives=")` → `false` (empty target)
- `isDerivationTag("derived=X")` → `false` (wrong key)
- Existing tests pass unchanged.

**Spec:** {R006.§1.AC.01}, {R006.§1.AC.02}, {R006.§1.AC.03}, {R006.§1.AC.04}

### Phase 2: Index Derivation Support

**Files:**
- `core/src/claims/claim-index.ts` (MODIFY)

**Changes:**
- Add `derivedFrom: string[]` field to `ClaimIndexEntry` interface.
- Add private `derivativesMap: Map<string, string[]>` to `ClaimIndex`.
- Modify `build()` to populate `entry.derivedFrom` from `ParsedMetadata.derivedFrom` during entry creation.
- Add Phase 1.5 after all entries exist: resolve each `derivedFrom` target via `resolveClaimAddress()`, replace raw targets with resolved FQIDs, and build `derivativesMap`. Unresolvable targets → push error.
- Reset `derivativesMap` at start of `build()`.
- Add `getDerivedFrom(claimId: string): string[]` method.
- Add `getDerivatives(claimId: string): string[]` method.

**Verify:**
- Build index on a project with DD documents containing `derives=` claims. Verify `entry.derivedFrom` is populated with resolved FQIDs.
- `getDerivedFrom("DD003.1.DC.01")` returns `["R005.1.AC.01"]` (or equivalent).
- `getDerivatives("R005.1.AC.01")` returns `["DD003.1.DC.01", "DD003.1.DC.02", ...]`.
- Unresolvable target produces an error in `data.errors`.
- `pnpm tsc` passes. Existing behavior unchanged for claims without derivation.

**Spec:** {R006.§2.AC.01}, {R006.§2.AC.02}, {R006.§2.AC.03}, {R006.§2.AC.04}

### Phase 3: Derivation-Aware Gap Detection

**Files:**
- `core/src/claims/traceability.ts` (MODIFY)

**Changes:**
- Add `derivationStatus` field to `GapReport` interface.
- Add `derivativesLookup` parameter to `findGaps()`.
- After standard gap detection, for each gap candidate: if it has derivatives via the lookup, check Source coverage on each derivative. If all covered, remove from gaps. If partially covered, annotate `derivationStatus`.

**Verify:**
- Claim with all derivatives Source-covered → not in gap report.
- Claim with partial derivative coverage → in gap report with `derivationStatus` showing counts and uncovered list.
- Claim with no derivatives → standard gap behavior unchanged.
- `pnpm tsc` passes.

**Spec:** {R006.§3.AC.01}, {R006.§3.AC.02}

### Phase 4: Trace Display Updates

**Files:**
- `core/src/cli/commands/claims/trace-command.ts` (MODIFY)
- `core/src/cli/formatters/claim-formatter.ts` (MODIFY)
- `core/src/claims/traceability.ts` (MODIFY — add `derivedFrom` to `TraceabilityRow`)

**Changes:**
- Add `derivedFrom: string[]` to `TraceabilityRow`. Populate in `buildIncomingMatrix()` and `buildOutgoingMatrix()` from `ClaimIndexEntry.derivedFrom`.
- Add `--show-derived` option to trace command.
- Modify `formatTraceabilityMatrix()`:
  - Default mode: append `<-SOURCE` indicator to claim IDs that have `derivedFrom`.
  - `--show-derived` mode: after each source claim row, insert indented sub-rows for each derivative (fetched via `getDerivatives`), showing their projection coverage.
- Modify `formatClaimTrace()`:
  - Show "Derived from: X, Y" line when `derivedFrom` is populated.
  - When `--show-derived` and claim has derivatives, show "Derivatives:" section.

**Verify:**
- `scepter claims trace DD003` shows `<-R005.§1.AC.01` on derived claims.
- `scepter claims trace R005 --show-derived` shows derivative sub-rows under source ACs.
- Single-claim trace shows derivation source.
- JSON output includes `derivedFrom` field.

**Spec:** {R006.§4.AC.01}, {R006.§4.AC.02}, {R006.§4.AC.03}

### Phase 5: Gaps Display and CLI Updates

**Files:**
- `core/src/cli/commands/claims/gaps-command.ts` (MODIFY)
- `core/src/cli/formatters/claim-formatter.ts` (MODIFY)

**Changes:**
- Add `--show-derived` option to gaps command.
- Pass `claimIndex.getDerivatives.bind(claimIndex)` as `derivativesLookup` to `findGaps()`.
- Modify `formatGapReport()` to display `derivationStatus` when present: show "Derivation coverage: N/M" and list uncovered derivatives.
- When `--show-derived` is active, expand to show full derivation tree per gap.

**Verify:**
- `scepter claims gaps` with derivation-covered claims excludes them.
- `scepter claims gaps --show-derived` expands derivation trees on partial gaps.
- JSON output includes `derivationStatus`.

**Spec:** {R006.§3.AC.03}

### Phase 6: Lint Derivation Validation

**Files:**
- `core/src/cli/commands/claims/lint-command.ts` (MODIFY)
- `core/src/cli/formatters/claim-formatter.ts` (MODIFY)

**Changes:**
- Add `validateDerivationLinks(noteId, indexData, claimIndex): ClaimTreeError[]` function.
- Implement checks:
  1. Invalid derivation target → `'invalid-derivation-target'` error
  2. Deep derivation chain (>2 hops) → `'deep-derivation-chain'` warning
  3. Partial derivation coverage → `'partial-derivation-coverage'` warning
  4. Circular derivation → `'circular-derivation'` error
  5. Self-derivation → `'self-derivation'` error
  6. Derives + superseded conflict → `'derives-superseded-conflict'` error
  7. Derivation from removed claim → `'derivation-from-removed'` warning
  8. Derivation from superseded claim → `'derivation-from-superseded'` warning
- Add new error types to `formatErrorType()` in claim-formatter.ts.

**Verify:**
- `scepter claims lint DD003` with valid derivation → no derivation errors.
- Claim with `derives=NONEXISTENT` → `[INVALID-DERIVATION]` error.
- Three-hop chain → `[DEEP-CHAIN]` warning.
- Circular chain → `[CIRCULAR-DERIVATION]` error.
- Self-derivation → `[SELF-DERIVATION]` error.
- `derives=X:superseded=Y` on same claim → `[DERIVES-SUPERSEDED]` error.
- Claim deriving from `:removed` → `[DERIVES-FROM-REMOVED]` warning.
- Partial coverage → `[PARTIAL-DERIVATION]` warning.

**Spec:** {R006.§5.AC.01}, {R006.§5.AC.02}, {R006.§5.AC.03}

## §7 Traceability Matrix

| Spec ID | Design Realization | Files | Phase |
|---------|--------------------|-------|-------|
| {R006.§1.AC.01} | `parseClaimMetadata()` recognizes `derives=TARGET`, extracts target to `derivedFrom[]`; `isDerivationTag()` | `claim-metadata.ts` | 1 |
| {R006.§1.AC.02} | Multiple `derives=TARGET` entries independently collected into `derivedFrom[]` | `claim-metadata.ts` | 1 |
| {R006.§1.AC.03} | Derivation target parsed via `parseClaimAddress()` (existing) for validation | `claim-metadata.ts`, `claim-index.ts` | 1, 2 |
| {R006.§1.AC.04} | Derivation metadata coexists with lifecycle — handled as separate concern, not via `isLifecycleTag()` | `claim-metadata.ts` | 1 |
| {R006.§2.AC.01} | `ClaimIndexEntry.derivedFrom: string[]` populated during `build()` | `claim-index.ts` | 2 |
| {R006.§2.AC.02} | `ClaimIndex.getDerivedFrom(claimId): string[]` returns source claims | `claim-index.ts` | 2 |
| {R006.§2.AC.03} | `ClaimIndex.getDerivatives(claimId): string[]` returns derived claims via `derivativesMap` | `claim-index.ts` | 2 |
| {R006.§2.AC.04} | `derivativesMap: Map<string, string[]>` built during `build()` Phase 1.5 | `claim-index.ts` | 2 |
| {R006.§3.AC.01} | `findGaps()` checks derivatives via lookup; closes gap when all derivatives have Source coverage | `traceability.ts` | 3 |
| {R006.§3.AC.02} | `findGaps()` annotates `GapReport.derivationStatus` for partial coverage | `traceability.ts` | 3 |
| {R006.§3.AC.03} | `--show-derived` flag on `scepter claims gaps`; formatter expands derivation tree | `gaps-command.ts`, `claim-formatter.ts` | 5 |
| {R006.§4.AC.01} | Trace displays derivation links; `derivedFrom` in `TraceabilityRow` and single-claim trace | `trace-command.ts`, `claim-formatter.ts`, `traceability.ts` | 4 |
| {R006.§4.AC.02} | `--show-derived` flag expands derivative sub-rows in trace matrix | `trace-command.ts`, `claim-formatter.ts` | 4 |
| {R006.§4.AC.03} | Default trace shows `<-SOURCE` indicator on derived claims | `claim-formatter.ts` | 4 |
| {R006.§5.AC.01} | Lint validates `derives=TARGET` resolves in index → `'invalid-derivation-target'` error | `lint-command.ts` | 6 |
| {R006.§5.AC.02} | Lint detects chains >2 hops → `'deep-derivation-chain'` warning; cycle detection via visited set | `lint-command.ts` | 6 |
| {R006.§5.AC.03} | Lint warns when source has derivatives but not all have Source coverage → `'partial-derivation-coverage'` | `lint-command.ts` | 6 |

## §8 Testing Strategy

| Test Level | Scope | Requirements Covered |
|-----------|-------|---------------------|
| Unit | `parseClaimMetadata()` — `derives=TARGET` recognition, multiple derives, coexistence with importance/lifecycle, empty target rejection | {R006.§1.AC.01}, {R006.§1.AC.02}, {R006.§1.AC.04} |
| Unit | `isDerivationTag()` — recognized/unrecognized patterns, empty target, wrong key | {R006.§1.AC.01} |
| Unit | `ClaimIndex.build()` — derivation resolution, `derivativesMap` construction, unresolvable target error | {R006.§2.AC.01}, {R006.§2.AC.04} |
| Unit | `ClaimIndex.getDerivedFrom()` — returns correct source claims | {R006.§2.AC.02} |
| Unit | `ClaimIndex.getDerivatives()` — returns correct derived claims, empty for non-source | {R006.§2.AC.03} |
| Unit | `findGaps()` with derivativesLookup — full coverage closure, partial coverage annotation, no-derivative passthrough | {R006.§3.AC.01}, {R006.§3.AC.02} |
| Unit | `validateDerivationLinks()` — all 8 error/warning types individually | {R006.§5.AC.01}, {R006.§5.AC.02}, {R006.§5.AC.03} |
| Unit | Chain depth detection — 1 hop (ok), 2 hops (ok), 3 hops (warn) | {R006.§5.AC.02} |
| Unit | Circular derivation detection — A→B→A cycle, A→B→C→A cycle | {R006.§5.AC.02} |
| Unit | Self-derivation detection — `derives=SELF` | {R006.§5.AC.01} |
| Integration | `ClaimIndex.build()` against real notes with `derives=` claims → full round-trip | {R006.§2.AC.01}-{R006.§2.AC.04} |
| Integration | `findGaps()` on project with derivation coverage → correct gap closure | {R006.§3.AC.01}, {R006.§3.AC.02} |
| CLI | `scepter claims trace DD_ID` shows `<-SOURCE` on derived claims | {R006.§4.AC.03} |
| CLI | `scepter claims trace R_ID --show-derived` shows derivative sub-rows | {R006.§4.AC.02} |
| CLI | `scepter claims gaps` with derivation-covered claims → excluded | {R006.§3.AC.01} |
| CLI | `scepter claims gaps --show-derived` expands derivation trees | {R006.§3.AC.03} |
| CLI | `scepter claims lint DD_ID` with valid derivation → no derivation errors | {R006.§5.AC.01} |
| CLI | `scepter claims lint DD_ID` with `derives=NONEXISTENT` → error | {R006.§5.AC.01} |
| CLI | `scepter claims lint DD_ID` with deep chain → warning | {R006.§5.AC.02} |
| CLI | `scepter claims lint DD_ID` with partial coverage → warning | {R006.§5.AC.03} |
| Regression | Existing trace/gaps/lint unchanged for claims without derivation metadata | All |
| Regression | `parseClaimMetadata()` unchanged for all non-derives metadata | {R006.§1.AC.04} |
| Self-hosting | DD001 and DD002 parseable after changes; index build produces no new errors | All |

## §9 Observations

### Structural Symmetry with `superseded=TARGET`

`derives=TARGET` is structurally identical to `superseded=TARGET` in the metadata suffix: both are `key=value` items recognized by `parseClaimMetadata()`. But they serve fundamentally different purposes:

- `superseded=TARGET` is a LIFECYCLE state — it changes what the claim IS (it's no longer active; it's been replaced). It lives in `lifecycle`.
- `derives=TARGET` is a RELATIONSHIP — it says where the claim came from. It does NOT change the claim's active/inactive status. It lives in `derivedFrom`.

This distinction matters for `parseClaimMetadata()`: `derives=` must be checked BEFORE `isLifecycleTag()`, and must NOT interfere with lifecycle processing. A claim can be simultaneously derived AND have a lifecycle state: `DC.01:4:derives=R005.§1.AC.01:closed` is valid (importance 4, derived from AC.01, and closed).

### `derivativesMap` on `ClaimIndex` vs. `ClaimIndexData`

The reverse derivation index (`derivativesMap`) is stored on the `ClaimIndex` class instance, not in `ClaimIndexData`. This is a deliberate choice:

- `ClaimIndexData` is a data transfer object — it's what gets passed to `traceability.ts` and formatters. Adding mutable derived data structures to it couples the data shape to the index builder's implementation.
- The `ClaimIndex` class exposes `getDerivatives()` as a method. Consumers inject it as a function parameter (e.g., `derivativesLookup` on `findGaps()`) rather than depending on the data shape.
- This keeps `traceability.ts` testable without a full `ClaimIndex` instance — tests can pass a mock lookup function.

### `derivedFrom` Resolution Timing

Derivation targets are resolved during `build()` in Phase 1.5, after ALL entries have been created. This is critical: a derived claim in note DD003 may reference a source claim in note R005. If resolution happened during entry creation for DD003, the R005 entries might not exist yet (notes are processed in arbitrary order). By deferring to Phase 1.5, all entries are available for resolution.

### Gap Closure Semantics

The gap closure algorithm checks Source projection coverage specifically, not coverage in any arbitrary projection. This is correct: derivation exists to decompose coarse requirements into fine-grained implementation targets. The question is "has this requirement been implemented?" — which is answered by Source coverage, not by whether a specification mentions the derived claims.

However, the `findGaps()` function currently checks coverage across ALL note types, not just Source. The derivation-aware addition specifically looks for Source coverage on derivatives. This means a source AC could have a "gap" in a DetailedDesign projection even though its derivatives have Source coverage. This is by design: derivation covers the implementation gap, not the specification gap. If you want to know whether the AC was designed, check the DD directly.

### Impact on Existing Consumers

Adding `derivedFrom: string[]` to `ClaimIndexEntry` is an additive change. Existing consumers that don't read `derivedFrom` are unaffected. The `derivativesLookup` parameter on `findGaps()` is optional (defaults to `undefined`, meaning no derivation awareness), preserving backward compatibility.

The only behavioral change is in the formatter: derived claims will now show `<-SOURCE` in the default trace view. This is purely visual and does not affect programmatic consumers.

### Edge Case: Derivation Target is in a Different Note's Scope

When `DC.01:derives=AC.01` appears in a DD document, `AC.01` is a bare reference without a note ID. The derivation resolution in Phase 1.5 uses the existing `resolveClaimAddress()` function, which tries:
1. Exact match on fully qualified ID.
2. Prefix with current note ID → `DD003.AC.01` (probably wrong — the target is in R005).
3. Fuzzy suffix match → finds `R005.1.AC.01`.

This works for the common case but is ambiguous if multiple notes have an `AC.01`. Best practice is to use fully qualified targets: `DC.01:derives=R005.§1.AC.01`. The linter could warn on bare derivation targets as a future enhancement, but this is not in R006's scope.

## References

- {R006} — Claim Derivation Tracing (source requirement)
- {R004} — Claim-Level Addressability and Traceability System (parent requirement)
- {R005} — Claim Metadata, Verification, and Lifecycle (metadata syntax this builds on)
- {DD001} — Detailed design for {R004} (structure and convention reference)
- {DD002} — Detailed design for {R005} (metadata parser integration context)
