---
created: 2026-03-11
tags: [claims, metadata, verification, lifecycle]
---

# DD002 - Claim Metadata, Verification, and Lifecycle

**Spec:** {R005}
**Created:** 2026-03-11

## §1 Epistemic Review of {R005}

### Binding Analysis

**HIGH BINDING** (must design first):

- **R005.§1 (Inline Importance) + R005.§2 (Lifecycle Tags)** — Both depend on modifying `parseMetadataSuffix()`, the single entry point for all metadata parsing. Currently it uses commas as inter-item separator and filters to `[A-Za-z0-9]+` only. R005.§2.AC.04a supersedes {R004.§2.AC.04} to use colons as the universal separator. The parser change is load-bearing: every downstream consumer depends on its output shape.

- **R005.§5 (Command Surface Integration)** — Depends on all of §1-§4. The command surface is where users interact with the new metadata.

**MEDIUM BINDING** (constrained by above):

- **R005.§3 (Verification Events)** — New independent module. Consumed by §4 (staleness) and §5 (command surface). No parser changes needed.

- **R005.§4 (Staleness Detection)** — Depends on §3's verification store and the existing traceability matrix. Pure computation.

### Inherence Observations

**Inherent to the problem:**

- Importance is a single digit, not a keyword — inherent to the "minimal syntax" design principle. A digit in the suffix is the lightest possible annotation.
- Lifecycle tags change how the traceability system treats a claim — inherent that they belong inline. The document IS different when a claim is `:closed`.
- Verification events are external judgments — inherent that they belong in a sidecar. The claim itself didn't change; someone's opinion about it did.

**Contingent (our design choice):**

- Using colons as the universal separator for metadata items — supersedes {R004.§2.AC.04} which used commas. So `AC.01:4:closed`. Key-value items use `=` (e.g., `superseded=TARGET`).
- Verification store as JSON file — simplest option.
- The specific lifecycle vocabulary (closed, deferred, removed, superseded) — could be different words.

### Open Question Resolutions

**OQ.01 — Verification Store Format:** Adopted: keyed map `{ "R004.1.AC.03": [{ date, actor, method }] }`. Easier to query by claim ID, human-readable. Latest event is array tail.

**OQ.02 — Lifecycle Tag Extensibility:** Adopted: fixed vocabulary. The parser recognizes exactly four lifecycle tags. Everything else is a freeform tag.

**OQ.03 — Verification Scope:** Adopted: support both single claim and whole note. `scepter claims verify R004.§1.AC.03` verifies one claim. `scepter claims verify R004` verifies all claims in the note.

### Parser Change: Colon-Separated Metadata

The current `parseMetadataSuffix()` at `claim-parser.ts:96-108` uses commas to split metadata items per {R004.§2.AC.04}. R005.§2.AC.04a supersedes this: colons are now the universal separator.

The change to `parseMetadataSuffix()`:
1. First colon separates claim path from metadata (unchanged)
2. Subsequent colons separate metadata items from each other (was: commas)
3. Each item is validated against a relaxed regex allowing `=`, `.`, `§`, `-` for key-value metadata like `superseded=R004.§2.AC.07`
4. `=` within an item is NOT a separator — it binds key to value

Example: `AC.01:4:closed` → `{ id: "AC.01", metadata: ["4", "closed"] }`
Example: `AC.01:superseded=R004.§2.AC.07` → `{ id: "AC.01", metadata: ["superseded=R004.§2.AC.07"] }`

## §2 Specification Scope

### Covered in this design

| Section | ACs | Area |
|---------|-----|------|
| §1 | AC.01-AC.05 | Inline importance parsing, filtering, sorting, display |
| §2 | AC.01-AC.08 | Lifecycle tag parsing, gap filtering, linter validation |
| §3 | AC.01-AC.07 | Verification store, CLI verify command |
| §4 | AC.01-AC.05 | Staleness computation, CLI stale command |
| §5 | AC.01-AC.04 | Index summary, lint integration, JSON output |

All 29 ACs covered. No deferrals.

## Current State

### Parser Layer

- **`core/src/parsers/claim/claim-parser.ts`** — `parseMetadataSuffix()` at L96-108 produces `{ id: string, metadata: string[] }`. Filter regex: `/^[A-Za-z0-9]+$/`. `ClaimAddress.metadata` is `string[]`. `parseClaimAddress()` calls `parseMetadataSuffix()` as first step.
- **`core/src/parsers/claim/claim-tree.ts`** — `ClaimNode.metadata` is `string[]`. `ClaimTreeError.type` has four values: `duplicate`, `non-monotonic`, `ambiguous`, `forbidden-form`.
- **`core/src/parsers/claim/index.ts`** — Re-exports from both parser modules.

### Index Layer

- **`core/src/claims/claim-index.ts`** — `ClaimIndexEntry.metadata` is `string[]`. `build()` copies metadata from `ClaimNode` to entry at L259. No interpretation of metadata values. `ClaimIndexData` has `entries`, `trees`, `noteTypes`, `crossRefs`, `errors`.
- **`core/src/claims/traceability.ts`** — `TraceabilityRow.metadata` is `string[]`. `GapReport.metadata` is `string[]`. `findGaps()` takes `(index, allNoteTypes)` — no filter options.
- **`core/src/claims/index.ts`** — Re-exports from `claim-index.ts` and `traceability.ts`.

### CLI Commands

- **`trace-command.ts`** — `--priority` filter does case-insensitive string match on metadata. No numeric handling.
- **`gaps-command.ts`** — `--priority` filter passed to formatter as string. No lifecycle filtering. Uses `claims.projectionTypes` config if available.
- **`lint-command.ts`** — Validates tree structure only (duplicates, monotonicity, forbidden forms, cross-ref errors). No lifecycle validation.
- **`index-command.ts`** — Reports summary counts. No metadata breakdown.
- **`index.ts`** — Registers 5 subcommands: index, trace, gaps, lint, scaffold.
- **`ensure-index.ts`** — Builds index from all notes + source refs via `projectManager.claimIndex.build()`.

### Formatters

- **`claim-formatter.ts`** — `formatTraceabilityMatrix()` checks `/(high|critical)/i` on metadata for red highlight (L124-126). `formatGapReport()` filters by priority string (L318-322). No lifecycle or importance awareness.

### Config

- **`core/src/types/config.ts`** — `ClaimConfig.priorityLevels` is `string[]` (default: `['P0', 'P1', 'P2', 'P3']`). Never consumed by any command.
- **`core/src/config/config-validator.ts`** — Zod schema accepts `claims.priorityLevels`.

### Project Manager

- **`core/src/project/project-manager.ts`** — `claimIndex: ClaimIndex` at L98, instantiated at L147, built on-demand via CLI.

## §3 Module Inventory

### MODIFY: `core/src/parsers/claim/claim-parser.ts`

- MODIFY `parseMetadataSuffix()` L96-108 — change inter-item separator from comma to colon. First colon separates claim path from metadata (unchanged). Subsequent colons split metadata items. Relax item validation regex from `/^[A-Za-z0-9]+$/` to `/^[A-Za-z0-9=_.§-]+$/` to accept `=`, dot, underscore, section symbol, and hyphen within items (for key-value metadata like `superseded=TARGET`).
  Spec: R005.§2.AC.01, R005.§2.AC.04a, R005.§2.AC.04b

### NEW: `core/src/claims/claim-metadata.ts`

- ADD `type LifecycleType = 'closed' | 'deferred' | 'removed' | 'superseded'`
  Spec: R005.§2.AC.01

- ADD `interface LifecycleState` — `{ type: LifecycleType, target?: string }`. `target` only present when type is `superseded`.
  Spec: R005.§2.AC.01

- ADD `interface ParsedMetadata` — `{ importance?: number, lifecycle?: LifecycleState, tags: string[] }`
  Spec: R005.§1.AC.01, R005.§2.AC.01

- ADD `const LIFECYCLE_TAGS: readonly string[]` — `['closed', 'deferred', 'removed', 'superseded']`
  Spec: R005.§2.AC.01

- ADD `function parseClaimMetadata(rawMetadata: string[]): ParsedMetadata` — interprets raw metadata strings. Logic:
  1. For each item, check if it's a bare digit 1-5 → set `importance`
  2. Check if it matches a lifecycle tag (exact match or `superseded=TARGET` pattern) → set `lifecycle`
  3. Everything else → push to `tags[]`
  4. If multiple lifecycle tags found, use the first and add a warning (lint catches this at validation time)
  Spec: R005.§1.AC.01, R005.§1.AC.05, R005.§2.AC.01, R005.§2.AC.07

- ADD `function isLifecycleTag(tag: string): boolean` — returns true if tag is recognized lifecycle keyword or `superseded=*` pattern.
  Spec: R005.§2.AC.01

### MODIFY: `core/src/claims/claim-index.ts`

- ADD import of `parseClaimMetadata`, `ParsedMetadata`, `LifecycleState` from `./claim-metadata.js`
  Spec: R005.§1.AC.01

- ADD fields to `ClaimIndexEntry` (L40-53): `importance?: number`, `lifecycle?: LifecycleState`, `parsedTags: string[]`
  Spec: R005.§1.AC.01, R005.§2.AC.01

- MODIFY `build()` L249-260 — after creating each `ClaimIndexEntry`, call `parseClaimMetadata(node.metadata ?? [])` and populate `importance`, `lifecycle`, `parsedTags`.
  Spec: R005.§1.AC.01, R005.§2.AC.01

### MODIFY: `core/src/claims/traceability.ts`

- ADD fields to `TraceabilityRow` (L26-34): `importance?: number`, `lifecycle?: LifecycleState`
  Spec: R005.§1.AC.02, R005.§2.AC.02

- ADD fields to `GapReport` (L43-48): `importance?: number`, `lifecycle?: LifecycleState`
  Spec: R005.§2.AC.02

- MODIFY `buildIncomingMatrix()` L137-146 — copy `importance` and `lifecycle` from `ClaimIndexEntry` to `TraceabilityRow`.
  Spec: R005.§1.AC.02

- ADD `interface GapFilterOptions` — `{ excludeClosed?: boolean, excludeDeferred?: boolean }`

- MODIFY `findGaps()` signature — add `options?: GapFilterOptions` parameter. Default: `{ excludeClosed: true, excludeDeferred: true }`. Skip claims whose `lifecycle.type` matches excluded states.
  Spec: R005.§2.AC.02, R005.§2.AC.03, R005.§2.AC.04

### NEW: `core/src/claims/verification-store.ts`

- ADD `interface VerificationEvent` — `{ claimId: string, date: string, actor: string, method?: string }`
  Spec: R005.§3.AC.02

- ADD `type VerificationStore = Record<string, VerificationEvent[]>`
  Spec: R005.§3.AC.01

- ADD `async function loadVerificationStore(dataDir: string): Promise<VerificationStore>` — reads `verification.json` from dataDir, returns `{}` if file doesn't exist.
  Spec: R005.§3.AC.01

- ADD `async function saveVerificationStore(dataDir: string, store: VerificationStore): Promise<void>` — writes JSON with 2-space indent.
  Spec: R005.§3.AC.01

- ADD `function addVerificationEvent(store: VerificationStore, event: VerificationEvent): void` — appends to array under `event.claimId` key. Creates array if absent.
  Spec: R005.§3.AC.06

- ADD `function getLatestVerification(store: VerificationStore, claimId: string): VerificationEvent | null` — returns last element of claim's array, or null.
  Spec: R005.§3.AC.07

### NEW: `core/src/claims/staleness.ts`

- ADD `interface StalenessEntry` — `{ claimId: string, status: 'stale' | 'unverified' | 'current', importance?: number, lastVerified?: string, lastModified?: string, implementingFiles: string[] }`
  Spec: R005.§4.AC.01, R005.§4.AC.02

- ADD `interface StalenessOptions` — `{ minImportance?: number, noteId?: string }`
  Spec: R005.§4.AC.03

- ADD `async function computeStaleness(index: ClaimIndexData, store: VerificationStore, options?: StalenessOptions): Promise<StalenessEntry[]>` — for each claim with Source cross-references: extract implementing file paths, stat for mtime, compare against latest verification date. Claims without Source projection excluded. Returns sorted by staleness (stale first, then unverified, then current).
  Spec: R005.§4.AC.01, R005.§4.AC.02, R005.§4.AC.04, R005.§4.AC.05

### MODIFY: `core/src/claims/index.ts`

- ADD re-exports from `claim-metadata.ts`, `verification-store.ts`, `staleness.ts`

### NEW: `core/src/cli/commands/claims/verify-command.ts`

- ADD `verifyCommand` — `scepter claims verify <id>` with `--actor NAME`, `--method METHOD`.
  - If `id` contains dots (claim-level), verify single claim
  - If `id` is plain note ID, build index, get all claims for that note, verify each
  - Load verification store, append event(s), save store
  - Reject verification of claims with `:removed` lifecycle tag
  - Default actor: current OS username via `os.userInfo().username` or `"cli"`
  Spec: R005.§3.AC.03, R005.§3.AC.04, R005.§3.AC.05, R005.§3.AC.06

### NEW: `core/src/cli/commands/claims/stale-command.ts`

- ADD `staleCommand` — `scepter claims stale` with `--importance N`, `--note NOTEID`, `--json`.
  - Builds index via `ensureIndex()`
  - Loads verification store
  - Calls `computeStaleness(index, store, options)`
  - Formats output via `formatStalenessReport()`
  Spec: R005.§4.AC.01, R005.§4.AC.02, R005.§4.AC.03

### MODIFY: `core/src/cli/commands/claims/index.ts`

- ADD import and registration of `verifyCommand` and `staleCommand`
  Spec: R005.§3.AC.03, R005.§4.AC.01

### MODIFY: `core/src/cli/commands/claims/trace-command.ts`

- MODIFY `--priority` option → rename to `--importance` with numeric value. Filter rows where `row.importance !== undefined && row.importance >= N`.
  Spec: R005.§1.AC.02

- ADD `--sort importance` option. When present, sort rows by importance descending (unannotated claims last).
  Spec: R005.§1.AC.04

- MODIFY JSON output (L89-97) to include `importance`, `lifecycle`, and latest verification event per row.
  Spec: R005.§5.AC.03

### MODIFY: `core/src/cli/commands/claims/gaps-command.ts`

- MODIFY `--priority` option → rename to `--importance` with numeric value.
  Spec: R005.§1.AC.02

- ADD `--include-deferred` flag.
  Spec: R005.§2.AC.03

- ADD `--include-closed` flag.
  Spec: R005.§2.AC.04

- MODIFY L31 — pass `GapFilterOptions` to `findGaps()` based on flags.
  Spec: R005.§2.AC.02

- MODIFY JSON output to include `importance`, `lifecycle`.
  Spec: R005.§5.AC.04

### MODIFY: `core/src/cli/commands/claims/lint-command.ts`

- ADD lifecycle tag validation after index build:
  - Multiple lifecycle tags on same claim → error type `'multiple-lifecycle'`
  - `:superseded=TARGET` where TARGET doesn't resolve in index → error type `'invalid-supersession-target'`
  - Claim tagged `:removed` that has incoming cross-references → warning type `'reference-to-removed'`
  Spec: R005.§2.AC.05, R005.§2.AC.06, R005.§2.AC.07, R005.§5.AC.02

### MODIFY: `core/src/cli/commands/claims/index-command.ts`

- ADD to summary output (after L37): count of claims by importance level (1-5), count by lifecycle state, count of verified vs unverified claims (requires loading verification store).
  Spec: R005.§5.AC.01

### MODIFY: `core/src/cli/formatters/claim-formatter.ts`

- MODIFY `formatTraceabilityMatrix()` L124-126 — replace `/(high|critical)/i` check with `row.importance !== undefined && row.importance >= 4` for red highlight. Add lifecycle display: dimmed text for `:closed`, `[removed]` / `[superseded→TARGET]` markers.
  Spec: R005.§1.AC.03, R005.§2.AC.08

- MODIFY `formatGapReport()` L318-322 — replace string-based priority filter with numeric importance filter.
  Spec: R005.§1.AC.03

- ADD `formatStalenessReport(entries: StalenessEntry[]): string` — table showing stale/unverified claims with file paths, verification dates, and file modification times.
  Spec: R005.§4.AC.01, R005.§4.AC.02

- ADD verification date display in `formatTraceabilityMatrix()` — when verification data provided, show last-verified date in a column or annotation.
  Spec: R005.§3.AC.07

### MODIFY: `core/src/parsers/claim/claim-tree.ts`

- ADD new error types to `ClaimTreeError.type` union: `'multiple-lifecycle'`, `'invalid-supersession-target'`, `'reference-to-removed'`
  Spec: R005.§2.AC.05, R005.§2.AC.06, R005.§2.AC.07

### MODIFY: `core/src/types/config.ts`

- REMOVE `priorityLevels` from `ClaimConfig` interface (L195). Importance is fixed 1-5.
  Observation: deviation from {R004.§8}.

### MODIFY: `core/src/config/config-validator.ts`

- REMOVE `priorityLevels` from Zod schema for `ClaimConfig`.

## §4 Wiring Map

```
parseMetadataSuffix() ──── relaxed filter ──→ raw string[]
                                                  │
                                                  ▼
ClaimIndex.build()                        parseClaimMetadata()
  ├─ reads: ClaimNode.metadata ──────────→ ParsedMetadata
  │                                        ├─ importance?: number
  │                                        ├─ lifecycle?: LifecycleState
  │                                        └─ tags: string[]
  └─ populates: ClaimIndexEntry
       ├─ metadata: string[]         (raw, unchanged)
       ├─ importance?: number        (NEW)
       ├─ lifecycle?: LifecycleState (NEW)
       └─ parsedTags: string[]       (NEW)

Traceability layer:
  buildTraceabilityMatrix()
    └─ copies importance/lifecycle from ClaimIndexEntry → TraceabilityRow

  findGaps(index, allNoteTypes, filterOptions?)
    ├─ excludes claims where lifecycle.type === 'closed' (default)
    ├─ excludes claims where lifecycle.type === 'deferred' (default)
    └─ copies importance/lifecycle to GapReport

Verification store (independent of index):
  _scepter/verification.json
    └─ { "R004.1.AC.03": [{ date, actor, method }] }

  verify-command.ts
    └─ loads store → adds event → saves store

Staleness:
  computeStaleness(indexData, verificationStore)
    ├─ for each claim with Source cross-refs:
    │    ├─ get file paths from crossRefs where fromNoteId starts with "source:"
    │    ├─ stat files for mtime
    │    └─ compare mtime vs latest verification date
    └─ produces StalenessEntry[]

CLI:
  claims/index.ts
    ├─ indexCommand    (MODIFY: metadata counts)
    ├─ traceCommand    (MODIFY: --importance, --sort, lifecycle display)
    ├─ gapsCommand     (MODIFY: --importance, --include-deferred, --include-closed)
    ├─ lintCommand     (MODIFY: lifecycle validation)
    ├─ scaffoldCommand (unchanged)
    ├─ verifyCommand   (NEW)
    └─ staleCommand    (NEW)
```

## §5 Data Flow

### Flow 1: Importance + Lifecycle Parsing

1. User writes `§1.AC.03:4:closed` in a document
2. `buildClaimTree()` calls `parseMetadataSuffix("§1.AC.03:4:closed")`
3. `parseMetadataSuffix()` splits at first `:` → id, then splits remaining on `:` → `{ id: "§1.AC.03", metadata: ["4", "closed"] }`
4. `ClaimNode` stores `metadata: ["4", "closed"]`
5. `ClaimIndex.build()` creates `ClaimIndexEntry`, calls `parseClaimMetadata(["4", "closed"])`
6. `parseClaimMetadata()` recognizes `"4"` as importance 4, `"closed"` as lifecycle
7. `ClaimIndexEntry` has `importance: 4`, `lifecycle: { type: 'closed' }`, `parsedTags: []`

### Flow 2: Supersession

1. User writes `§1.AC.04:superseded=R004.§2.AC.07`
2. `parseMetadataSuffix()` → `{ id: "§1.AC.04", metadata: ["superseded=R004.§2.AC.07"] }`
3. `parseClaimMetadata()` sees item starts with `"superseded="` → splits on `=` → `lifecycle: { type: 'superseded', target: 'R004.§2.AC.07' }`
4. Lint validates that `R004.2.AC.07` (§-normalized) exists in the index

### Flow 3: Gap Filtering with Lifecycle

1. `scepter claims gaps` runs
2. `ensureIndex()` builds index, populating importance/lifecycle on all entries
3. `findGaps()` called with default `{ excludeClosed: true, excludeDeferred: true }`
4. For each claim: if `entry.lifecycle?.type === 'closed'` or `'deferred'`, skip
5. Remaining gaps reported — only open, actionable claims

### Flow 4: Verification Event Recording

1. Agent runs `scepter claims verify R004.§1.AC.03 --actor "agent" --method "code review"`
2. Command loads `_scepter/verification.json`
3. Builds event: `{ claimId: "R004.1.AC.03", date: "<ISO 8601>", actor: "agent", method: "code review" }`
4. `addVerificationEvent()` appends to array under `"R004.1.AC.03"` key
5. `saveVerificationStore()` writes JSON back
6. Console reports success

### Flow 5: Staleness Detection

1. `scepter claims stale R004 --importance 4` runs
2. Builds index, loads verification store
3. `computeStaleness()` iterates claims in R004 with `importance >= 4`
4. For each claim: finds Source cross-references → extracts file paths → stats for mtime
5. Compares mtime against latest verification date:
   - No Source refs → skip (R005.§4.AC.05)
   - No verification events → status: `unverified`
   - mtime > verification → status: `stale`
   - mtime <= verification → status: `current`
6. `formatStalenessReport()` displays results

## §6 Integration Sequence

### Phase 1: Metadata Parser and Interpreter

**Files:** `claim-parser.ts` (MODIFY), `claim-metadata.ts` (NEW), `claims/index.ts` (MODIFY)
**Changes:** Relax `parseMetadataSuffix()` regex. Implement `ParsedMetadata`, `LifecycleState`, `parseClaimMetadata()`, `isLifecycleTag()`.
**Verify:** Unit tests: `parseClaimMetadata(["4", "closed"])` → `{ importance: 4, lifecycle: { type: 'closed' }, tags: [] }`. `parseClaimMetadata(["superseded=R004.§2.AC.07"])` → correct lifecycle with target. `parseClaimMetadata(["6"])` → `{ tags: ["6"] }` (out of range). Existing `parseMetadataSuffix` tests pass.
**Spec:** R005.§1.AC.01, R005.§1.AC.05, R005.§2.AC.01, R005.§2.AC.07

### Phase 2: Index Integration

**Files:** `claim-index.ts` (MODIFY), `traceability.ts` (MODIFY)
**Changes:** Add importance/lifecycle/parsedTags to `ClaimIndexEntry`. Populate in `build()`. Add to `TraceabilityRow` and `GapReport`. Add `GapFilterOptions` to `findGaps()`, default exclude closed/deferred.
**Verify:** `pnpm tsc` passes. Existing behavior unchanged for claims without metadata. `findGaps()` on project with `:closed` claims excludes them.
**Spec:** R005.§1.AC.02, R005.§2.AC.02, R005.§2.AC.03, R005.§2.AC.04

### Phase 3: CLI Command Updates

**Files:** `trace-command.ts`, `gaps-command.ts`, `lint-command.ts`, `index-command.ts`, `claim-formatter.ts`, `claim-tree.ts` (all MODIFY)
**Changes:** Rename `--priority` to `--importance` (numeric). Add `--sort importance`, `--include-deferred`, `--include-closed`. Add lifecycle lint validation (three new error types). Add metadata breakdown to index summary. Replace hardcoded `/(high|critical)/i` with `importance >= 4`.
**Verify:** `scepter claims trace R004 --importance 4` filters correctly. `scepter claims gaps --include-deferred` shows deferred. `scepter claims lint` catches lifecycle errors. Trace shows lifecycle states visually.
**Spec:** R005.§1.AC.02-04, R005.§2.AC.03-08, R005.§5.AC.01-04

### Phase 4: Verification Store and Command

**Files:** `verification-store.ts` (NEW), `claims/index.ts` (MODIFY), `verify-command.ts` (NEW), `commands/claims/index.ts` (MODIFY)
**Changes:** Implement store load/save/append/query. Implement verify command with `--actor`, `--method`. Reject verification of `:removed` claims. Support note-level verification.
**Verify:** `scepter claims verify R004.§1.AC.03 --actor dev` creates `_scepter/verification.json`. Subsequent calls append. `scepter claims verify R004` verifies all claims. Removed claim verification fails.
**Spec:** R005.§3.AC.01-06

### Phase 5: Staleness Detection

**Files:** `staleness.ts` (NEW), `claims/index.ts` (MODIFY), `stale-command.ts` (NEW), `commands/claims/index.ts` (MODIFY), `claim-formatter.ts` (MODIFY)
**Changes:** Implement `computeStaleness()`. Implement stale command with `--importance`, `--note`, `--json`. Implement `formatStalenessReport()`.
**Verify:** After verifying a claim then modifying its implementation file, `scepter claims stale` reports stale. No-source claims excluded. Unverified claims reported separately.
**Spec:** R005.§4.AC.01-05

### Phase 6: Verification Display in Trace

**Files:** `trace-command.ts` (MODIFY), `claim-formatter.ts` (MODIFY)
**Changes:** Load verification store in trace command. Pass latest verification per claim to formatter. Show verification date in trace output.
**Verify:** `scepter claims trace R004` shows last-verified dates. Claims without events show nothing.
**Spec:** R005.§3.AC.07

### Phase 7: Config Cleanup

**Files:** `config.ts` (MODIFY), `config-validator.ts` (MODIFY)
**Changes:** Remove `priorityLevels` from `ClaimConfig`. Remove from Zod schema.
**Verify:** `pnpm tsc` passes. Existing configs tolerated.
**Spec:** (cleanup — deviation from {R004.§8})

## §7 Traceability Matrix

| Spec ID | Design Realization | Files | Phase |
|---------|--------------------|-------|-------|
| R005.§1.AC.01 | `parseClaimMetadata()` recognizes digits 1-5 | `claim-metadata.ts` | 1 |
| R005.§1.AC.02 | `--importance N` filter on trace and gaps | `trace-command.ts`, `gaps-command.ts` | 3 |
| R005.§1.AC.03 | `importance >= 4` highlighting in formatters | `claim-formatter.ts` | 3 |
| R005.§1.AC.04 | `--sort importance` on trace | `trace-command.ts` | 3 |
| R005.§1.AC.05 | digits outside 1-5 treated as freeform tags | `claim-metadata.ts` | 1 |
| R005.§2.AC.01 | `parseClaimMetadata()` extracts lifecycle; `LifecycleState` type | `claim-metadata.ts` | 1 |
| R005.§2.AC.02 | `findGaps()` with `GapFilterOptions` excludes closed/deferred | `traceability.ts` | 2 |
| R005.§2.AC.03 | `--include-deferred` flag on gaps | `gaps-command.ts` | 3 |
| R005.§2.AC.04 | `--include-closed` flag on gaps | `gaps-command.ts` | 3 |
| R005.§2.AC.05 | lint: removed claims referenced → warning | `lint-command.ts` | 3 |
| R005.§2.AC.06 | lint: supersession target validation | `lint-command.ts` | 3 |
| R005.§2.AC.07 | lint: multiple lifecycle tags → error | `lint-command.ts`, `claim-metadata.ts` | 1, 3 |
| R005.§2.AC.08 | lifecycle state visual in trace | `claim-formatter.ts` | 3 |
| R005.§3.AC.01 | `verification.json` at `_scepter/` | `verification-store.ts` | 4 |
| R005.§3.AC.02 | `VerificationEvent` interface | `verification-store.ts` | 4 |
| R005.§3.AC.03 | `scepter claims verify CLAIM_ID` | `verify-command.ts` | 4 |
| R005.§3.AC.04 | `--actor NAME` on verify | `verify-command.ts` | 4 |
| R005.§3.AC.05 | `--method METHOD` on verify | `verify-command.ts` | 4 |
| R005.§3.AC.06 | append-only store | `verification-store.ts` | 4 |
| R005.§3.AC.07 | trace shows latest verification date | `trace-command.ts`, `claim-formatter.ts` | 6 |
| R005.§4.AC.01 | `computeStaleness()` reports stale claims | `staleness.ts`, `stale-command.ts` | 5 |
| R005.§4.AC.02 | separate stale vs unverified | `staleness.ts` | 5 |
| R005.§4.AC.03 | `--importance N` on stale | `stale-command.ts` | 5 |
| R005.§4.AC.04 | file mtime comparison | `staleness.ts` | 5 |
| R005.§4.AC.05 | no-Source claims excluded | `staleness.ts` | 5 |
| R005.§5.AC.01 | index summary with metadata counts | `index-command.ts` | 3 |
| R005.§5.AC.02 | lint validates lifecycle syntax | `lint-command.ts` | 3 |
| R005.§5.AC.03 | trace JSON includes importance, lifecycle, verification | `trace-command.ts` | 3, 6 |
| R005.§5.AC.04 | gaps JSON includes importance, lifecycle | `gaps-command.ts` | 3 |

## §8 Testing Strategy

| Test Level | Scope | Requirements Covered |
|-----------|-------|---------------------|
| Unit | `parseClaimMetadata()` — importance, lifecycle, superseded, edge cases | §1.AC.01, §1.AC.05, §2.AC.01, §2.AC.07 |
| Unit | `parseMetadataSuffix()` — relaxed filter, superseded targets | §2.AC.01 |
| Unit | `isLifecycleTag()` — recognized/unrecognized strings | §2.AC.01 |
| Unit | `addVerificationEvent()`, `getLatestVerification()` — append, retrieval | §3.AC.02, §3.AC.06 |
| Unit | `computeStaleness()` — stale/unverified/current; no-source exclusion | §4.AC.01-05 |
| Integration | `ClaimIndex.build()` with importance/lifecycle → populated fields | §1.AC.01, §2.AC.01 |
| Integration | `findGaps()` with lifecycle filtering | §2.AC.02-04 |
| Integration | verification store round-trip with real file | §3.AC.01 |
| CLI | `scepter claims trace R004 --importance 4` | §1.AC.02 |
| CLI | `scepter claims trace R004 --sort importance` | §1.AC.04 |
| CLI | `scepter claims gaps --include-deferred` | §2.AC.03 |
| CLI | `scepter claims lint` with lifecycle errors | §2.AC.05-07 |
| CLI | `scepter claims verify R004.§1.AC.03` | §3.AC.03 |
| CLI | `scepter claims stale R004` | §4.AC.01-02 |
| Regression | existing trace/gaps/lint unchanged for claims without new metadata | All |

## §9 Observations

### Metadata Separator Convention

R005.§2.AC.04a supersedes {R004.§2.AC.04}: metadata items are now colon-separated (not comma-separated). R004 has been updated to mark §2.AC.04 as superseded. The syntax is `AC.01:4:closed` — colons throughout.

### `priorityLevels` Config Removal

{R004.§8} implied configurable priority levels. R005 makes importance a fixed 1-5 scale. Removing `ClaimConfig.priorityLevels` is a deviation from R004 but the field was never used.

### `--priority` Backward Compatibility

Renaming `--priority` to `--importance` is a breaking change. Consider keeping `--priority` as a deprecated alias during transition.

### Verification Store and Git

`_scepter/verification.json` could be gitignored (per-developer state) or committed (shared state). This is a project-level choice, not enforced by the system.

### Lint Error Type Expansion

`ClaimTreeError.type` union currently has 4 values. Phase 3 adds 3 more: `'multiple-lifecycle'`, `'invalid-supersession-target'`, `'reference-to-removed'`. The first two are errors; the last is a warning. The lint formatter should distinguish severity levels — this requires adding a `severity: 'error' | 'warning'` field to `ClaimTreeError` or handling it in the formatter based on type.

### `ensureIndex` Load Pattern for Verification Store

Phases 5 and 6 require both the index AND the verification store. The `ensureIndex()` helper currently only builds the claim index. Options: (a) extend `ensureIndex()` to also load the verification store and return both, (b) load the verification store independently in each command. Option (b) is simpler and avoids coupling the index builder to the verification store. Adopted: commands that need verification data load it independently.
