---
created: 2026-03-17
tags: [claims, search, cli]
status: implemented
---

# DD004 - Claim Index Search

**Spec:** {R007}
**Created:** 2026-03-16

## §1 Epistemic Review of {R007}

### Binding Analysis

**MEDIUM BINDING** (most of the infrastructure exists; this feature layers on top):

- **R007.§1 (Query Matching)** — Operates on the existing `ClaimIndexEntry` fields (`fullyQualified`, `claimId`, `heading`). The regex normalization pattern already exists in `search-handler.ts`. No new parser or index infrastructure is needed. The search logic is a pure function: index entries in, matched entries out. Binding is medium because the search function is consumed by both the CLI command and tests, but touches no upstream infrastructure. {R007.§1.AC.01} through {R007.§1.AC.06} are all MUST-level.

- **R007.§2 (Filtering)** — Filters operate on existing `ClaimIndexEntry` fields: `noteType`, `noteId`, `importance`, `lifecycle`. All data is already present in index entries. The `--types` filter requires note type resolution, which exists via `NoteTypeResolver.resolveTypeIdentifier()`. Binding is low: filter functions are composable predicates over existing data. {R007.§2.AC.01} through {R007.§2.AC.06} are all MUST-level.

- **R007.§3 (Derivation Graph Queries)** — Depends on `ClaimIndex.getDerivedFrom()` and `ClaimIndex.getDerivatives()` from {R006}. These methods already exist and return `string[]`. The search command wraps them as filter predicates. Binding is low: the derivation graph is a precomputed data structure that the search reads but does not modify. {R007.§3.AC.01} through {R007.§3.AC.05} are all MUST-level.

- **R007.§4 (Output Formats)** — Three output tiers (list, detailed, JSON) follow established patterns from both `claim-formatter.ts` and `search-handler.ts`. The formatting functions are terminal: they consume search results and produce strings. Binding is low. {R007.§4.AC.01} through {R007.§4.AC.05} are all MUST-level.

- **R007.§5 (CLI Interface)** — Registration under the existing `claims` command group, following the `BaseCommand.execute()` + `ensureIndex()` pattern used by `trace-command.ts` and `gaps-command.ts`. Binding is low: one new file, one import added to `claims/index.ts`. {R007.§5.AC.01} through {R007.§5.AC.05} are all MUST-level.

**Summary:** This feature has uniformly medium-to-low binding. The claim index infrastructure, derivation graph, metadata fields, regex normalization, and CLI command patterns all exist. No AC requires decomposition into derived claims: every AC maps to 1-3 files within 1-2 modules. The design can pass through R007's ACs directly.

### Modal Status Distribution

| Category | MUST | SHOULD | MAY |
|----------|------|--------|-----|
| §1 Query Matching | 6 | 0 | 0 |
| §2 Filtering | 6 | 0 | 0 |
| §3 Derivation Graph Queries | 5 | 0 | 0 |
| §4 Output Formats | 5 | 0 | 0 |
| §5 CLI Interface | 5 | 0 | 0 |

27 MUST-level ACs, 0 SHOULD, 0 MAY. No optionality in the requirement. Every AC drives design decisions.

### Inherence Observations

**Inherent to the problem (load-bearing, non-negotiable):**

- Search operates on the computed claim index, not raw files. This is inherent: the index IS the search corpus. The `ClaimIndexEntry` shape determines what fields are searchable and filterable.
- Filters compose conjunctively (AND). This is inherent to the query model: text query AND type filter AND importance filter all narrow the same result set.
- Derivation queries use the precomputed bidirectional graph from {R006}. The `getDerivedFrom()` / `getDerivatives()` methods are the only correct access points.
- The regex normalization pattern (`\|` to `|`) is inherent to CLI consistency: the same normalization exists in `search-handler.ts` and must be reused, not reimplemented.

**Contingent (our design choice):**

- Separating search logic (`claim-search.ts`) from the CLI command (`search-command.ts`). This is a testability choice: pure functions are easier to unit test than CLI commands.
- Default result limit of 50. R007 specifies this, but the number itself is contingent.
- Truncation length of 60 characters for headings in list format. Specified by R007 but arbitrary.
- Adding search result formatting to the existing `claim-formatter.ts` vs. a new file. We choose to extend the existing formatter for consistency with the other claims formatters.

## §2 Specification Scope

### Covered in this design

| Section | ACs | Area |
|---------|-----|------|
| §1 | AC.01-AC.06 | Text query matching against index entries |
| §2 | AC.01-AC.06 | Metadata and note-level filtering |
| §3 | AC.01-AC.05 | Derivation graph query options |
| §4 | AC.01-AC.05 | Output format tiers (list, detailed, JSON) |
| §5 | AC.01-AC.05 | CLI registration and command structure |

All 27 ACs covered. No deferrals.

### Deferred

None. All ACs are addressed in this design.

## Current State

The following files and types form the IS-state baseline that this design builds on. This is the state AFTER {DD001}, {DD002}, and {DD003} have been implemented.

### Claim Index

- **`core/src/claims/claim-index.ts`** — `ClaimIndex` class with `build()` method returning `ClaimIndexData`. `ClaimIndexEntry` stores all fields needed for search: `fullyQualified`, `claimId`, `heading`, `noteId`, `noteType`, `noteFilePath`, `sectionPath`, `importance`, `lifecycle`, `derivedFrom`, `parsedTags`. Query methods: `getClaim()`, `getClaimsForNote()`, `getDerivedFrom()`, `getDerivatives()`, `getData()`. The `derivativesMap` (private) stores reverse derivation lookups.

- **`core/src/claims/claim-metadata.ts`** — `LifecycleState` type with `type: LifecycleType` and optional `target`. `LifecycleType = 'closed' | 'deferred' | 'removed' | 'superseded'`. Used by filter logic.

### CLI Infrastructure

- **`core/src/cli/commands/claims/ensure-index.ts`** — `ensureIndex(projectManager)` builds the full index from all notes plus source references. Returns `ClaimIndexData`. Used by every claims command.

- **`core/src/cli/commands/base-command.ts`** — `BaseCommand.execute(options, handler)` pattern: sets up `ProjectManager`, initializes, calls handler with `CommandContext`, cleans up. All existing claims commands use this pattern.

- **`core/src/cli/commands/claims/index.ts`** — `claimsCommand` (Commander) with subcommands: `index`, `trace`, `gaps`, `lint`, `scaffold`, `verify`, `stale`. New `search` subcommand will be registered here.

### Existing Search Pattern

- **`core/src/cli/commands/context/search-handler.ts`** — Note-level search with regex normalization: `query.replace(/\\\|/g, '|')` for shell-escaped alternation. Uses `new RegExp(normalized, flags)` for regex mode, `query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` for literal escaping. Output format options: `list`, `detailed`, `json`. This is the prior art for the claim search command's regex handling and output format pattern.

### Claim Formatting

- **`core/src/cli/formatters/claim-formatter.ts`** — Existing formatters: `formatTraceabilityMatrix()`, `formatClaimTrace()`, `formatGapReport()`, `formatLintResults()`, `formatClaimTree()`, `formatIndexSummary()`, `formatStalenessReport()`. Helper functions: `extractTitle()` (strips ID pattern from heading), `truncateString()` (with ellipsis), `padRight()`. Importance highlighting convention: `chalk.red.bold()` for importance >= 4. These helpers will be reused by the new search result formatter.

### Note Type Resolution

- **`core/src/notes/note-type-resolver.ts`** — `resolveTypeIdentifier(identifier)` resolves full names and shortcodes (e.g., `'R'` to `'Requirement'`, `'DD'` to `'DetailedDesign'`). Available via `projectManager.noteTypeResolver` or through `ConfigManager`.

## §3 Module Inventory

### NEW: `core/src/claims/claim-search.ts`

Pure search/filter logic, decoupled from CLI concerns. All functions take index data and options, return filtered results.

| Spec | Type/Function | Notes |
|------|--------------|-------|
| {R007.§1.AC.01}, {R007.§1.AC.02}, {R007.§1.AC.03}, {R007.§1.AC.04} | `searchClaims(data: ClaimIndexData, options: ClaimSearchOptions): ClaimSearchResult` | Main entry point. Builds RegExp from query, iterates entries, applies text match + filters |
| {R007.§1.AC.01}, {R007.§1.AC.02} | `matchesQuery(entry: ClaimIndexEntry, pattern: RegExp, idOnly: boolean): boolean` | Per-entry text matching against fullyQualified, claimId, and/or heading |
| {R007.§1.AC.03}, {R007.§1.AC.04} | `buildSearchPattern(query: string, options: { regex?: boolean }): RegExp` | Regex construction with `\|` normalization or literal escaping. Case-insensitive by default. |
| {R007.§1.AC.05}, {R007.§1.AC.06} | Validation in `searchClaims()` | Empty query + no filters = error. Empty query + filters = filter-only mode. |
| {R007.§2.AC.01} | `matchesTypeFilter(entry: ClaimIndexEntry, types: string[]): boolean` | Checks `entry.noteType` against resolved type names |
| {R007.§2.AC.02} | `matchesNoteFilter(entry: ClaimIndexEntry, noteId: string): boolean` | Checks `entry.noteId === noteId` |
| {R007.§2.AC.03} | `matchesImportanceFilter(entry: ClaimIndexEntry, minImportance: number): boolean` | Checks `entry.importance !== undefined && entry.importance >= minImportance` |
| {R007.§2.AC.04} | `matchesLifecycleFilter(entry: ClaimIndexEntry, lifecycle: string): boolean` | Checks `entry.lifecycle?.type === lifecycle` |
| {R007.§2.AC.05} | Conjunctive composition in `searchClaims()` | All active filters AND together |
| {R007.§2.AC.06} | `ClaimSearchOptions.limit` field, default 50 | Applied after all filtering |
| {R007.§3.AC.01} | `matchesDerivedFromFilter(entry: ClaimIndexEntry, sourceClaimId: string): boolean` | Checks `entry.derivedFrom.includes(sourceClaimId)` |
| {R007.§3.AC.02} | `getDerivativesOfClaim(data: ClaimIndexData, claimIndex: ClaimIndex, targetClaimId: string): ClaimIndexEntry[]` | Uses `claimIndex.getDerivatives()` to find derivative entries |
| {R007.§3.AC.03} | `matchesHasDerivation(entry: ClaimIndexEntry): boolean` | Checks `entry.derivedFrom.length > 0` |
| {R007.§3.AC.04} | Composition in `searchClaims()` | Derivation filters AND with text query and other filters |
| {R007.§3.AC.05} | Validation in `searchClaims()` | Unresolvable `--derives-from` / `--derivatives-of` targets produce error |
| All | `interface ClaimSearchOptions` | `query`, `regex`, `idOnly`, `types`, `note`, `importance`, `lifecycle`, `derivesFrom`, `derivativesOf`, `hasDerivation`, `limit`, `format` |
| All | `interface ClaimSearchResult` | `matches: ClaimIndexEntry[]`, `total: number`, `truncated: boolean`, `error?: string` |

### NEW: `core/src/cli/commands/claims/search-command.ts`

CLI command wiring. Follows `trace-command.ts` / `gaps-command.ts` pattern.

| Spec | Type/Function | Notes |
|------|--------------|-------|
| {R007.§5.AC.01} | `searchCommand = new Command('search')` | Positional `<query>` argument, all filter/format options as flags |
| {R007.§5.AC.02} | `ensureIndex()` call in action handler | Same pattern as trace/gaps |
| {R007.§5.AC.03} | No additional file I/O after index build | Enforced by design: `searchClaims()` is pure in-memory |
| {R007.§5.AC.04} | Error handling in action handler | Validates option values before calling search logic |
| {R007.§5.AC.05} | Commander `.description()` and option descriptions | Includes usage examples in help text |
| {R007.§2.AC.01} | `--types <types...>` option | Uses `NoteTypeResolver.resolveTypeIdentifier()` for resolution |
| {R007.§2.AC.02} | `--note <noteId>` option | String option |
| {R007.§2.AC.03} | `--importance <n>` option | `parseInt` parser |
| {R007.§2.AC.04} | `--lifecycle <state>` option | String option, validated against known lifecycle types |
| {R007.§2.AC.06} | `--limit <n>` option | `parseInt` parser, default 50 |
| {R007.§1.AC.02} | `--id-only` flag | Boolean flag |
| {R007.§1.AC.03} | `--regex` flag | Boolean flag |
| {R007.§3.AC.01} | `--derives-from <claimId>` option | String option |
| {R007.§3.AC.02} | `--derivatives-of <claimId>` option | String option |
| {R007.§3.AC.03} | `--has-derivation` flag | Boolean flag |
| {R007.§4.AC.01}-{R007.§4.AC.03} | `--format <format>` option | Choices: `list`, `detailed`, `json`. Default: `list` |

### MODIFY: `core/src/cli/formatters/claim-formatter.ts`

Add search result formatting functions.

| Spec | Type/Function | Notes |
|------|--------------|-------|
| {R007.§4.AC.01} | `formatClaimSearchList(results: ClaimSearchResult): string` | One line per claim: FQID, note type, truncated heading (60 chars) |
| {R007.§4.AC.02} | `formatClaimSearchDetailed(results: ClaimSearchResult): string` | Full details per claim: FQID, type, heading, importance, lifecycle, derivation, file path |
| {R007.§4.AC.03} | `formatClaimSearchJson(results: ClaimSearchResult): string` | JSON array with specified fields |
| {R007.§4.AC.04} | Result count line in all formatters | "N claims found" / "N claims found (showing first M)" |
| {R007.§4.AC.05} | Importance highlighting | Reuses existing `chalk.red.bold()` convention for importance >= 4 |

### MODIFY: `core/src/cli/commands/claims/index.ts`

Register the search subcommand.

| Spec | Type/Function | Notes |
|------|--------------|-------|
| {R007.§5.AC.01} | `import { searchCommand }` + `claimsCommand.addCommand(searchCommand)` | One import, one registration call |

### MODIFY: `core/src/claims/index.ts`

Re-export search types and functions.

| Spec | Type/Function | Notes |
|------|--------------|-------|
| All | `export { searchClaims } from './claim-search.js'` | Plus `ClaimSearchOptions`, `ClaimSearchResult` type exports |

## §4 Wiring Map

### Import Graph

```
search-command.ts
  -> base-command.ts          (BaseCommand.execute)
  -> ensure-index.ts          (ensureIndex)
  -> claim-search.ts          (searchClaims, ClaimSearchOptions)
  -> claim-formatter.ts       (formatClaimSearch*)
  -> note-type-resolver.ts    (resolveTypeIdentifier, via ConfigManager)
  -> claim-index.ts           (ClaimIndex, via ProjectManager)

claim-search.ts
  -> claim-index.ts           (ClaimIndexData, ClaimIndexEntry, ClaimIndex)
  -> claim-metadata.ts        (LifecycleType — for validation)

claim-formatter.ts (additions)
  -> claim-index.ts           (ClaimIndexEntry — already imported)
  -> claim-search.ts          (ClaimSearchResult)
```

### Call Chain: `scepter claims search "AC.01" --types Requirement --importance 4`

```
CLI (Commander) parses arguments
  -> searchCommand.action(query, options)
    -> BaseCommand.execute(setupOptions, handler)
      -> handler(context):
        1. options.types resolved via configManager.getConfig().noteTypes
        2. ensureIndex(context.projectManager)  -> ClaimIndexData
        3. searchClaims(data, claimIndex, searchOptions)  -> ClaimSearchResult
        4. formatClaimSearchList(result)  -> string
        5. console.log(output)
```

### Call Chain: `scepter claims search --derives-from R005.§1.AC.01`

```
CLI parses arguments (empty query via "", derivesFrom option set)
  -> searchCommand.action(query, options)
    -> BaseCommand.execute(setupOptions, handler)
      -> handler(context):
        1. ensureIndex(context.projectManager)  -> ClaimIndexData
        2. Normalize derivesFrom: strip §, resolve via index entries
        3. searchClaims(data, claimIndex, { query: "", derivesFrom: resolvedId })
           -> iterates entries, matches entry.derivedFrom.includes(resolvedId)
        4. formatClaimSearchList(result)  -> string
        5. console.log(output)
```

### Provider Relationships

- `ProjectManager` provides `claimIndex` (ClaimIndex instance) and `configManager` (for type resolution).
- `ensureIndex()` drives `claimIndex.build()` and returns `ClaimIndexData`.
- `searchClaims()` receives both `ClaimIndexData` (for entry iteration) and `ClaimIndex` (for `getDerivatives()` method access in `--derivatives-of` mode).
- Type resolution for `--types` uses the config's `noteTypes` keys, not `NoteTypeResolver` directly, because the filter compares against `ClaimIndexEntry.noteType` which stores the full type name.

## §5 Data Flow

### Flow 1: Text Query with Regex

```
1. User invokes: scepter claims search "AC\.0[1-3]" --regex
2. Commander parses: query = "AC\.0[1-3]", options.regex = true
3. searchCommand.action() called
4. BaseCommand.execute() initializes ProjectManager, NoteManager
5. ensureIndex() builds ClaimIndexData (entries Map, trees, crossRefs, errors)
6. searchClaims() called with { query: "AC\\.0[1-3]", regex: true }
   a. buildSearchPattern(): no \| normalization needed, creates RegExp("AC\\.0[1-3]", "i")
   b. Iterates data.entries.values()
   c. For each entry: pattern.test(entry.fullyQualified) || pattern.test(entry.heading)
   d. All matching entries collected into results array
   e. results.length capped at limit (50 default)
   f. Returns { matches, total: uncapped count, truncated: total > limit }
7. formatClaimSearchList() formats one line per match
8. Result count line appended: "27 claims found"
9. console.log(output)
```

### Flow 2: Filter-Only Mode

```
1. User invokes: scepter claims search "" --types Requirement --importance 4
2. Commander parses: query = "", options.types = ["Requirement"], options.importance = 4
3. searchCommand.action() called
4. Type resolution: "Requirement" matched against config noteTypes (already canonical)
5. ensureIndex() builds index
6. searchClaims() called with { query: "", types: ["Requirement"], importance: 4 }
   a. Empty query + filters present -> filter-only mode (no text matching)
   b. Iterates data.entries.values()
   c. For each entry: matchesTypeFilter(entry, ["Requirement"]) -> entry.noteType === "Requirement"
   d. AND matchesImportanceFilter(entry, 4) -> entry.importance >= 4
   e. Matching entries collected, capped at limit
7. Format and output
```

### Flow 3: Derivation Graph Query

```
1. User invokes: scepter claims search --derives-from R005.§1.AC.01
2. Commander parses: query = "" (implicit), options.derivesFrom = "R005.§1.AC.01"
3. searchCommand.action() called
4. ensureIndex() builds index
5. Normalize derivesFrom: "R005.§1.AC.01" -> strip § -> "R005.1.AC.01"
6. Validate: data.entries.has("R005.1.AC.01") -> true (or error if not found)
7. searchClaims() called with { query: "", derivesFrom: "R005.1.AC.01" }
   a. Iterates data.entries.values()
   b. For each entry: entry.derivedFrom.includes("R005.1.AC.01")
   c. Matching entries collected
8. Format and output
```

### Flow 4: Derivatives-Of Query

```
1. User invokes: scepter claims search --derivatives-of R005.§1.AC.01
2. Commander parses: query = "" (implicit), options.derivativesOf = "R005.§1.AC.01"
3. searchCommand.action() called
4. ensureIndex() builds index
5. Normalize: "R005.§1.AC.01" -> "R005.1.AC.01"
6. Validate existence in index
7. searchClaims() called with { query: "", derivativesOf: "R005.1.AC.01" }
   a. claimIndex.getDerivatives("R005.1.AC.01") -> ["DD003.1.DC.01", "DD003.1.DC.02", ...]
   b. For each derivative FQID: data.entries.get(fqid) -> ClaimIndexEntry
   c. These entries become the candidate set, then text query + other filters applied
8. Format and output
```

### Flow 5: Error — Empty Query, No Filters

```
1. User invokes: scepter claims search ""
2. Commander parses: query = "", no options
3. searchClaims() validates: empty query + no filters
4. Returns { matches: [], total: 0, truncated: false, error: "..." }
5. searchCommand.action() prints error message and exits
```

## §6 Integration Sequence

### Phase 1: Core Search Logic

**Files:** `core/src/claims/claim-search.ts` (NEW), `core/src/claims/index.ts` (MODIFY)

**Changes:**
- Create `ClaimSearchOptions` and `ClaimSearchResult` interfaces
- Implement `buildSearchPattern()` with regex normalization
- Implement `matchesQuery()` for text matching
- Implement all filter predicate functions
- Implement `searchClaims()` composing predicates
- Add exports to `core/src/claims/index.ts`

**Acceptance gate:** Unit tests pass: text matching (literal and regex), filter predicates (type, note, importance, lifecycle, derivation), empty-query validation, limit truncation. TypeScript compiles.

**Spec:** {R007.§1.AC.01}-{R007.§1.AC.06}, {R007.§2.AC.01}-{R007.§2.AC.06}, {R007.§3.AC.01}-{R007.§3.AC.05}

### Phase 2: CLI Command

**Files:** `core/src/cli/commands/claims/search-command.ts` (NEW), `core/src/cli/commands/claims/index.ts` (MODIFY)

**Depends on:** Phase 1

**Changes:**
- Create Commander command with all options
- Wire to `BaseCommand.execute()` + `ensureIndex()` pattern
- Resolve `--types` values via config noteTypes
- Normalize `--derives-from` / `--derivatives-of` claim IDs (strip §)
- Validate option values (importance range, lifecycle values, note existence)
- Register command in `claims/index.ts`

**Acceptance gate:** `scepter claims search --help` shows all options with descriptions. `scepter claims search "AC.01"` returns results from the index. `scepter claims search "" --types Requirement` returns filtered results. Invalid options produce specific error messages. TypeScript compiles.

**Spec:** {R007.§5.AC.01}-{R007.§5.AC.05}, {R007.§2.AC.01} (type resolution wiring), {R007.§2.AC.02} (note validation wiring), {R007.§5.AC.04} (error messages)

### Phase 3: Output Formatting

**Files:** `core/src/cli/formatters/claim-formatter.ts` (MODIFY)

**Depends on:** Phase 1 (needs `ClaimSearchResult` type)

**Changes:**
- Add `formatClaimSearchList()` — one line per claim, 60-char truncation
- Add `formatClaimSearchDetailed()` — full claim details
- Add `formatClaimSearchJson()` — JSON array with specified fields
- All formatters include result count + truncation notice
- Importance >= 4 highlighting in list and detailed formats

**Acceptance gate:** Each formatter produces correctly structured output. List format shows truncated headings. Detailed format shows all metadata fields. JSON format validates against specified schema. Importance highlighting visible for importance >= 4 claims.

**Spec:** {R007.§4.AC.01}-{R007.§4.AC.05}

## §7 Traceability Matrix

| Spec ID | Design Realization | Files | Phase |
|---------|--------------------|-------|-------|
| {R007.§1.AC.01} | `matchesQuery()` tests against `fullyQualified` and `heading` | `claim-search.ts` | 1 |
| {R007.§1.AC.02} | `matchesQuery()` with `idOnly` flag tests `fullyQualified` and `claimId` only | `claim-search.ts` | 1 |
| {R007.§1.AC.03} | `buildSearchPattern()` with `\|` to `|` normalization | `claim-search.ts` | 1 |
| {R007.§1.AC.04} | `buildSearchPattern()` literal mode with case-insensitive flag | `claim-search.ts` | 1 |
| {R007.§1.AC.05} | `searchClaims()` validation: empty query + filters = valid | `claim-search.ts` | 1 |
| {R007.§1.AC.06} | `searchClaims()` validation: empty query + no filters = error | `claim-search.ts` | 1 |
| {R007.§2.AC.01} | `matchesTypeFilter()` + type resolution in CLI | `claim-search.ts`, `search-command.ts` | 1, 2 |
| {R007.§2.AC.02} | `matchesNoteFilter()` + note validation in CLI | `claim-search.ts`, `search-command.ts` | 1, 2 |
| {R007.§2.AC.03} | `matchesImportanceFilter()` checks `>= n`, excludes undefined | `claim-search.ts` | 1 |
| {R007.§2.AC.04} | `matchesLifecycleFilter()` checks `lifecycle?.type === state` | `claim-search.ts` | 1 |
| {R007.§2.AC.05} | Conjunctive composition in `searchClaims()` loop | `claim-search.ts` | 1 |
| {R007.§2.AC.06} | `ClaimSearchOptions.limit` with default 50, truncation flag | `claim-search.ts` | 1 |
| {R007.§3.AC.01} | `matchesDerivedFromFilter()` checks `entry.derivedFrom.includes(id)` | `claim-search.ts` | 1 |
| {R007.§3.AC.02} | `getDerivativesOfClaim()` via `claimIndex.getDerivatives()` | `claim-search.ts` | 1 |
| {R007.§3.AC.03} | `matchesHasDerivation()` checks `entry.derivedFrom.length > 0` | `claim-search.ts` | 1 |
| {R007.§3.AC.04} | Derivation filters composed with text query and other filters | `claim-search.ts` | 1 |
| {R007.§3.AC.05} | Validation: unresolvable derivation target = error | `claim-search.ts` | 1 |
| {R007.§4.AC.01} | `formatClaimSearchList()` — FQID, type, 60-char heading | `claim-formatter.ts` | 3 |
| {R007.§4.AC.02} | `formatClaimSearchDetailed()` — full details per claim | `claim-formatter.ts` | 3 |
| {R007.§4.AC.03} | `formatClaimSearchJson()` — JSON array with specified fields | `claim-formatter.ts` | 3 |
| {R007.§4.AC.04} | Result count + truncation notice in all formatters | `claim-formatter.ts` | 3 |
| {R007.§4.AC.05} | `chalk.red.bold()` for importance >= 4 in list/detailed | `claim-formatter.ts` | 3 |
| {R007.§5.AC.01} | `searchCommand = new Command('search')` with positional query | `search-command.ts` | 2 |
| {R007.§5.AC.02} | `ensureIndex()` call in action handler | `search-command.ts` | 2 |
| {R007.§5.AC.03} | No file I/O after index build (enforced by pure function design) | `claim-search.ts` | 1 |
| {R007.§5.AC.04} | Specific error messages for invalid values | `search-command.ts` | 2 |
| {R007.§5.AC.05} | Commander `.description()` and option help text | `search-command.ts` | 2 |

All 27 ACs mapped. No gaps.

## §8 Testing Strategy

| Test Level | Scope | Requirements Covered |
|-----------|-------|---------------------|
| Unit | `buildSearchPattern()` — regex construction and `\|` normalization | {R007.§1.AC.03}, {R007.§1.AC.04} |
| Unit | `matchesQuery()` — text matching against ID and heading fields | {R007.§1.AC.01}, {R007.§1.AC.02} |
| Unit | Filter predicates — each filter function independently | {R007.§2.AC.01}-{R007.§2.AC.04} |
| Unit | `searchClaims()` — conjunctive composition, limit, empty query validation | {R007.§1.AC.05}, {R007.§1.AC.06}, {R007.§2.AC.05}, {R007.§2.AC.06} |
| Unit | Derivation filters — `matchesDerivedFromFilter`, `matchesHasDerivation`, derivatives-of | {R007.§3.AC.01}-{R007.§3.AC.05} |
| Unit | Formatter functions — output structure, truncation, importance highlighting, JSON schema | {R007.§4.AC.01}-{R007.§4.AC.05} |
| Integration | CLI command end-to-end with test fixture notes | {R007.§5.AC.01}-{R007.§5.AC.05} |
| Integration | Error paths — invalid regex, unknown note ID, invalid importance, unresolvable derivation target | {R007.§1.AC.06}, {R007.§2.AC.02}, {R007.§3.AC.05}, {R007.§5.AC.04} |

Test file locations:
- `core/src/claims/__tests__/claim-search.test.ts` — Unit tests for `claim-search.ts`
- `core/src/cli/commands/claims/__tests__/search-command.test.ts` — Integration tests for CLI command (if integration tests exist for other claims commands; otherwise, manual verification via CLI)

## §9 Observations

### Observation 1: `--derivatives-of` changes candidate set semantics

Most filters narrow a single candidate set (all index entries). The `--derivatives-of` option is different: it first looks up the derivative FQIDs via `claimIndex.getDerivatives()`, then uses those as the candidate set. Text query and other filters then narrow within that derivative set. This means `--derivatives-of` and `--derives-from` have subtly different semantics:
- `--derives-from X` filters the global set to entries whose `derivedFrom` contains X.
- `--derivatives-of X` replaces the global set with the derivatives of X, then applies other filters.

The result is the same when no other filters are present, but they compose differently. The design implements `--derivatives-of` as a candidate-set replacement, consistent with R007.§3.AC.02's specification that it "returns claims that appear in the derivatives list."

### Observation 2: Type resolution strategy

The `--types` filter needs to compare user input against `ClaimIndexEntry.noteType`, which stores canonical type names like `"Requirement"`, `"DetailedDesign"`. Users may pass shortcodes like `"R"` or `"DD"`. The CLI layer resolves shortcodes to canonical names using the config's noteTypes before passing to `searchClaims()`. This means `claim-search.ts` always receives canonical type names, keeping the search logic config-agnostic.

### Observation 3: Claim ID normalization for `--derives-from` / `--derivatives-of`

R007 specifies that claim IDs in these options should be "resolved against the index." Users may provide IDs with `§` symbols (e.g., `R005.§1.AC.01`) but the index stores IDs without `§` (e.g., `R005.1.AC.01`). The CLI layer must strip `§` before looking up in the index. This follows the same normalization done in `trace-command.ts` (`id.replace(/§/g, '')`).

### Observation 4: No UI projection

This feature is CLI-only. There is no UI component, route, or visual surface. The projections are: Source (implementation code), Tests (unit/integration), CLI (the command itself), Documentation (skill file updates if needed). UI is explicitly out of scope.

### Observation 5: Spec does not specify sort order of results

R007 does not define a `--sort` option or specify the default sort order of search results. The natural iteration order of `Map.values()` follows insertion order (which is file scan order). This design does not add sorting beyond insertion order. If sorting is needed, it should be specified in a future requirement amendment.
