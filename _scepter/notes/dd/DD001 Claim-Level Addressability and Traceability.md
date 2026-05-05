---
created: 2026-03-10
tags: [claims, traceability, parser, cli]
status: draft
---

# DD001 - Claim-Level Addressability and Traceability

**Spec:** {R004}
**Spec consolidation:** {S002} — cross-tab Specification covering the reference grammar, definition shapes, metadata permutations, and consumer behaviors that this design wires into modules. When this design names a parser, index, linter, or CLI behavior, the authoritative behavioral contract is in {S002}; this document specifies module decomposition and integration sequence only.
**Created:** 2026-03-09
**Updated:** 2026-03-13

## §1 Epistemic Review of {R004}

### Binding Analysis

**HIGH BINDING** (must design first; everything else depends on these):

- **R004.§1 (Claim Syntax and Addressing)** — The claim reference grammar is the atomic unit everything else parses, stores, queries, and displays. If this is wrong, every downstream module is wrong. The six ACs here are all MUST-level and constrain the parser, the index, the linter, and the CLI.
- **R004.§3 (Claim Definition via Section Headings)** — The heading-to-tree-structure mapping is the second load-bearing decision. It defines what constitutes a claim in a document. §4's index consumes this tree; §5's traceability matrix queries it; §6's CLI operates on it.
- **R004.§4 (Claim Index)** — The central mechanism. The index is the computed artifact that the trace, gaps, stale, and lint commands all query. Its data model determines what queries are possible.

**MEDIUM BINDING** (constrained by the above, but have design freedom):

- **R004.§2 (Reference Matching and Configuration)** — Extends the existing parser. Constrained by §1's grammar but adds braceless matching, `§` normalization, and metadata parsing. The configuration flag is a new field in `SCEpterConfig`.
- **R004.§6 (CLI Tooling)** — Consumes the index and the parser. The specific commands (`scaffold`, `lint`, `fix`) are shaped by §1-§4 but have latitude in UX.
- **R004.§5 (Traceability Matrix)** — Consumes the index and reference graph. The trace/gaps/stale commands are the user-facing payoff, but their logic is a function of the index shape.

**LOW BINDING** (layers on top, largely independent):

- **R004.§8 (Priority and Metadata on Claims)** — The colon-suffix metadata is parsed by §2 and stored in the index by §4. The filtering/sorting in §5 commands is additive.
- **R004.§7 (Stability and Verification Markers)** — Mostly orthogonal to the claim system. The verification event store (OQ.02) and stability annotations are separate features that integrate with the index at the query layer.

### Modal Status Distribution

| Category | MUST | SHOULD | MAY |
|----------|------|--------|-----|
| §1 Claim Syntax | 6 (AC.01-AC.06) | 0 | 0 |
| §2 Reference Matching | 5 (AC.01-AC.05) | 0 | 0 |
| §3 Claim Definition | 3 (AC.01-AC.03) | 0 | 1 (AC.04 - "MUST NOT require", defensive) |
| §4 Claim Index | 5 (AC.01-AC.05) | 0 | 0 |
| §5 Traceability | 2 (AC.01-AC.02) | 0 | 0 |
| §6 CLI Tooling | 3 (AC.01, AC.02, AC.04) | 0 | 0 |
| §7 Stability | 4 (AC.01-AC.04) | 0 | 0 |
| §8 Priority/Metadata | 3 (AC.01-AC.03) | 0 | 0 |

32 active ACs, all MUST-level. 3 removed (§5.AC.03, §5.AC.04, §6.AC.03). §4.AC.04-05 added for section-only ref filtering. No optionality — only phasing.

### Inherence Observations

**Inherent to the problem (load-bearing, non-negotiable):**

- The dot-separated path grammar (`NOTE.§N.PREFIX.NN`) — this is the identity system. Changing it breaks all references.
- The heading-based tree structure — this is how claims are defined. It cannot be swapped for frontmatter-per-claim without violating the design principle.
- The computed index — the "compute, don't maintain" principle means the index IS derived, not stored. This shapes how it integrates.

**Contingent (our design choice, could be different):**

- The claim index data structure (in-memory Map vs SQLite vs JSON file) — we choose in-memory with optional JSON cache.
- The parser implementation strategy (extend existing regex vs new parser module) — we choose a new dedicated parser module that composes with the existing one.
- The CLI command names (`scepter lint` vs `scepter validate`) — R004 specifies names; we follow them.
- Where verification events live (OQ.02) — R004's default assumption (JSON file) is reasonable; we adopt it.

### Open Question Resolutions

**OQ.01 — AC Numbering Scope:** R004's default assumption is correct: per-document uniqueness is RECOMMENDED but per-section uniqueness is tolerated. (Refined 2026-04-30 per {R004.§1.AC.04}: the linter does not pre-flag definition-time ambiguity. Bare-suffix collisions across sections (`§1.AC.01` and `§2.AC.01` in the same note) are normal and not reported. Ambiguity is surfaced only when an actual bare reference fails to resolve to a single qualified ID.)

**OQ.02 — Verification Event Storage:** R004's default assumption is adopted: `_scepter/verification.json` stores verification events as a lightweight derived data store. The index rebuilds claim structure from documents; verification dates persist separately because they are not inferable from document content. This is the one exception to "compute, don't maintain" — it stores human judgments, not document structure.

**OQ.03 — Observatory Integration Scope:** R004's default assumption is adopted: CLI-first. Observatory integration is deferred. The index data structure should be JSON-serializable for future consumption, but no UI work is in scope for this design.

## §2 Specification Scope

The behavioral contract that the modules below conform to is consolidated in {S002}: {S002.§1} for reference shapes, {S002.§2} for definition shapes, {S002.§3} for per-consumer behavior. The table below maps which R004 ACs this design realizes.

### Covered in this design

| Section | ACs | Area |
|---------|-----|------|
| §1 | AC.01-AC.06 | Claim syntax, addressing, parser |
| §2 | AC.01-AC.05 | Reference matching, configuration |
| §3 | AC.01-AC.04 | Claim definition from headings |
| §4 | AC.01-AC.05 | Claim index construction |
| §5 | AC.01-AC.02 | Traceability matrix, gap detection |
| §6 | AC.01, AC.02, AC.04 | CLI scaffold, lint commands |
| §8 | AC.01-AC.03 | Priority/metadata parsing and filtering |

### Deferred

| Section | ACs | Reason |
|---------|-----|--------|
| §5 | AC.03, AC.04 | Removed. AC.03 (staleness) deferred — depends on §7 verification infrastructure. AC.04 (relationship inference) removed — too opinionated. |
| §6 | AC.03 | Removed. Headings without IDs are allowed — they simply aren't addressable. |
| §7 | AC.04 | AC.04 superseded by {R005.§3.AC.04}. AC.01-AC.03 now designed in §10 below. |

### Open questions resolved

- OQ.01: Per-document uniqueness recommended, per-section tolerated, ambiguity warned.
- OQ.02: Lightweight JSON store (`_scepter/verification.json`). CLI-callable for LLMs to use on key claims or when directed. Not first-class; deferred until §7 is designed.
- OQ.03: CLI-first; Observatory deferred.

## Current State

The following files and types form the IS-state baseline that this design builds on.

### Parser Layer

- **`core/src/parsers/note/note-parser.ts`** — `parseNoteMentions()` function extracts braced `{NOTE_ID}` mentions from content. Uses regex `/\{([A-Z]{1,5}\d{3,5})(?!\d)([$+><*]+)?(?:#([^:}\n]+))?/g`. Returns `NoteMention[]` with `id`, `line`, `contentExtension`, `tagExtensions`, `inclusionModifiers`. Currently only parses note-level references — no section or claim awareness.
- **`core/src/parsers/note/shared-note-utils.ts`** — `ParsedNoteId` interface (`shortcode`, `number`), `parseNoteId()`, `isValidNoteId()`, `formatNoteId()`. The `parseNoteId` regex: `/^([A-Z]{1,5})(\d{3,5})$/`. These utilities are note-level only.

### Note Management

- **`core/src/notes/note-manager.ts`** — `NoteManager` class. Maintains `noteIndex` (Map<string, Note>), `typeIndex`, `tagIndex`, `fileIndex`, `idCounters`. `getNotes()` accepts `NoteQuery`. Delegates file I/O to `NoteFileManager`. Uses `UnifiedDiscovery` for filesystem scanning.
- **`core/src/notes/note-file-manager.ts`** — `NoteFileManager` class. Handles physical file creation, updating, archiving, deletion. Uses `noteIndex` (Map<string, string>) for noteId-to-filePath mapping. `getFileContents()` reads raw file content.

### Reference System

- **`core/src/references/reference-manager.ts`** — `ReferenceManager` class. In-memory `ReferenceGraph` with `outgoing` and `incoming` Maps. `Reference` interface: `{ fromId, toId, line?, context?, modifier?, sourceType?, tags? }`. Currently operates at note-level granularity only.
- **`core/src/references/source-reference-index.ts`** — `SourceReferenceIndex` class. Bidirectional index: `fileToNotes` (Map<string, Set<string>>) and `noteToFiles` (Map<string, Set<string>>). Detailed references keyed by `"file:line"`. Note-level only.

### Source Code Scanner

- **`core/src/scanners/source-code-scanner.ts`** — `SourceCodeScanner` class. Discovers source files from config, calls `parseNoteMentions()` with language-specific comment patterns, populates `SourceReferenceIndex`. The `mentionToReference()` method converts `NoteMention` to `SourceReference`.

### Discovery

- **`core/src/discovery/unified-discovery.ts`** — `UnifiedDiscovery` class. Single recursive glob under `_scepter/`. Extracts note IDs from filenames via `/^([A-Z]{1,5}\d{3,5})(?:\s|\.md|$)/`. Resolves type from shortcode map.

### Configuration

- **`core/src/types/config.ts`** — `SCEpterConfig` interface. Has `noteTypes`, `sourceCodeIntegration`, `paths`, etc. No claim-related configuration fields exist yet.
- **`core/src/config/config-manager.ts`** — `ConfigManager` class. Loads/saves `scepter.config.json`. Emits `config:changed`.

### Type System

- **`core/src/types/note.ts`** — `Note` interface: `{ id, type, title, content, tags, created, modified?, filePath?, metadata?, ... }`. No claim-level fields.
- **`core/src/types/reference.ts`** — `Reference` interface: `{ fromId, toId, line?, context?, modifier?, sourceType?, tags? }`. `fromId`/`toId` are note-level strings.

### CLI Layer

- **`core/src/cli/index.ts`** — Commander.js program. Commands organized as `scepter context <subcommand>` with auto-promotion of `ctx` prefix.
- **`core/src/cli/commands/base-command.ts`** — `BaseCommand.setup()` creates `CommandContext` with `ProjectManager`. `BaseCommand.execute()` provides setup+cleanup lifecycle.
- **`core/src/cli/commands/context/index.ts`** — Registers all context subcommands. New claim commands will be registered here or as a new top-level command group.

### Key Architectural Constraints

1. Everything is in-memory at runtime; persistence is markdown files + JSON config.
2. The parser (`parseNoteMentions`) is the single entry point for extracting references from text.
3. `ReferenceManager` and `SourceReferenceIndex` are note-level; they don't understand sub-note granularity.
4. `ProjectManager` is the composition root; all new modules must wire through it.

## §3 Module Inventory

### NEW: `core/src/parsers/claim/claim-parser.ts`

- ADD: `interface ClaimAddress` — Parsed claim reference with fields: `noteId?: string`, `sectionPath?: number[]`, `claimPrefix?: string`, `claimNumber?: number`, `metadata?: string[]`, `raw: string`
Spec: R004.§1.AC.01, R004.§1.AC.02, R004.§1.AC.03

- ADD: `interface ClaimParseOptions` — Options for claim parsing: `knownShortcodes?: Set<string>`, `bracelessEnabled?: boolean`, `currentDocumentId?: string`, `currentSection?: number[]`
  Spec: R004.§2.AC.01, R004.§2.AC.05

- ADD: `function parseClaimAddress(raw: string, options?: ClaimParseOptions): ClaimAddress | null` — Parses a single claim reference string into its components. Handles all forms from R004's Valid Reference Forms table.
  Spec: R004.§1.AC.03, R004.§1.AC.06, R004.§2.AC.03

- ADD: `function parseClaimReferences(content: string, options?: ClaimParseOptions): ClaimReference[]` — Scans document content for all claim references (braced and braceless). Returns array of `ClaimReference` with location info.
  Spec: R004.§1.AC.03, R004.§2.AC.01, R004.§2.AC.02

- ADD: `interface ClaimReference` — `{ address: ClaimAddress, line: number, column: number, braced: boolean }`
  Spec: R004.§2.AC.01, R004.§2.AC.02

- ADD: `function normalizeSectionSymbol(segment: string): string` — Strips `§` prefix from segment for canonical comparison.
  Spec: R004.§2.AC.03

- ADD: `function parseMetadataSuffix(raw: string): { id: string, metadata: string[] }` — Splits `:P0,security` from the reference path.
  Spec: R004.§2.AC.04, R004.§8.AC.03

### NEW: `core/src/parsers/claim/claim-tree.ts`

- ADD: `interface ClaimNode` — Tree node: `{ type: 'section' | 'claim', id: string, sectionNumber?: number, claimPrefix?: string, claimNumber?: number, heading: string, headingLevel: number, line: number, endLine: number, children: ClaimNode[], metadata?: string[] }`
  Spec: R004.§3.AC.01, R004.§3.AC.02, R004.§3.AC.03

- ADD: `function buildClaimTree(content: string): ClaimNode[]` — Parses markdown content into a tree of sections and claims based on heading hierarchy. Returns root-level nodes.
  Spec: R004.§3.AC.01, R004.§3.AC.02, R004.§3.AC.03

- ADD: `interface ClaimTreeResult` — `{ roots: ClaimNode[], claims: Map<string, ClaimNode>, sections: Map<number, ClaimNode>, errors: ClaimTreeError[] }`
  Spec: R004.§3.AC.03, R004.§4.AC.03

- ADD: `interface ClaimTreeError` — `{ type: 'duplicate' | 'non-monotonic' | 'ambiguous' | 'forbidden-form' | 'unresolved-reference' | 'multiple-lifecycle' | 'invalid-supersession-target' | 'reference-to-removed' | 'unresolvable-derivation-target', claimId: string, line: number, message: string, conflictingLines?: number[] }`
  Spec: R004.§1.AC.04, R004.§1.AC.05, R004.§1.AC.06, R004.§4.AC.03
  (Refined 2026-04-30: `duplicate` and `ambiguous` are retained in the union but are no longer emitted by any code path — same-note repeats are silently deduped by the parser and bare-id ambiguity is not flagged at definition time. The active parser-level variants are `forbidden-form` and `non-monotonic`.)

- ADD: `function validateClaimTree(tree: ClaimTreeResult): ClaimTreeError[]` — Checks for non-monotonic numbering and forbidden forms within a single document.
  Spec: R004.§1.AC.05, R004.§1.AC.06
  (Refined 2026-04-30: original spec listed duplicate/ambiguity checks; both removed in favor of silent dedup and reference-time ambiguity per refined R004 ACs.)

### NEW: `core/src/parsers/claim/index.ts`

- ADD: Re-exports from `claim-parser.ts` and `claim-tree.ts`

### NEW: `core/src/claims/claim-index.ts`

- ADD: `interface ClaimIndexEntry` — `{ noteId: string, claimId: string, fullyQualified: string, sectionPath: number[], claimPrefix: string, claimNumber: number, heading: string, line: number, endLine: number, metadata: string[], noteType: string, noteFilePath: string }`
  Spec: R004.§4.AC.01, R004.§4.AC.02

- ADD: `interface ClaimCrossReference` — `{ fromClaim: string, toClaim: string, fromNoteId: string, toNoteId: string, line: number, filePath: string }`
  Spec: R004.§4.AC.01

- ADD: `interface ClaimIndexData` — `{ entries: Map<string, ClaimIndexEntry>, trees: Map<string, ClaimNode[]>, crossRefs: ClaimCrossReference[], errors: ClaimTreeError[] }`
  Spec: R004.§4.AC.01, R004.§4.AC.02, R004.§4.AC.03

- ADD: `class ClaimIndex` — Constructs and queries the claim index. Methods:
  - `build(notes: NoteWithContent[], sourceRefs: SourceReference[]): ClaimIndexData` — Scan all notes and source references, build trees and cross-references.
  - `getClaimsForNote(noteId: string): ClaimIndexEntry[]`
  - `getClaim(fullyQualified: string): ClaimIndexEntry | null`
  - `getCrossRefsFrom(claimId: string): ClaimCrossReference[]`
  - `getCrossRefsTo(claimId: string): ClaimCrossReference[]`
  - `getErrors(): ClaimTreeError[]`
  Spec: R004.§4.AC.01, R004.§4.AC.02, R004.§4.AC.03

- ADD: `interface NoteWithContent` — `{ id: string, type: string, filePath: string, content: string }` — Minimal note representation for index building.
  Spec: R004.§4.AC.01

### NEW: `core/src/claims/traceability.ts`

- ADD: `interface ProjectionPresence` — `{ noteId: string, noteType: string, claimId?: string, line?: number }` — Records where a claim appears in a projection.
  Spec: R004.§5.AC.01

- ADD: `interface TraceabilityRow` — `{ claimId: string, claimPrefix: string, claimNumber: number, heading: string, sectionPath: number[], metadata: string[], projections: Map<string, ProjectionPresence[]> }`
  Spec: R004.§5.AC.01, R004.§5.AC.02

- ADD: `interface TraceabilityMatrix` — `{ sourceNoteId: string, rows: TraceabilityRow[], projectionTypes: string[] }`
  Spec: R004.§5.AC.01

- ADD: `interface GapReport` — `{ claimId: string, presentIn: string[], missingFrom: string[], metadata: string[] }`
  Spec: R004.§5.AC.02

- ADD: `function buildTraceabilityMatrix(noteId: string, index: ClaimIndexData): TraceabilityMatrix`
  Spec: R004.§5.AC.01

- ADD: `function findGaps(index: ClaimIndexData): GapReport[]` — Detects claims present in upstream projections but absent from downstream. Gap detection is claim-presence based — it checks whether a claim ID appears in other documents, without prescribing relationship types.
  Spec: R004.§5.AC.02

### NEW: `core/src/claims/index.ts`

- ADD: Re-exports from `claim-index.ts`, `traceability.ts`

### MODIFY: `core/src/types/config.ts`

- ADD: `interface ClaimConfig` — `{ bracelessMatching?: boolean, priorityLevels?: string[] }`
  Spec: R004.§2.AC.05, R004.§8.AC.01

- MODIFY: `interface SCEpterConfig` — Add field `claims?: ClaimConfig`
  Spec: R004.§2.AC.05

### MODIFY: `core/src/types/reference.ts`

- ADD: `interface ClaimReference extends Reference` — `{ claimAddress?: ClaimAddress }` — Extends `Reference` to optionally carry parsed claim-level address info when the reference target is sub-note.
  Spec: R004.§1.AC.03

### MODIFY: `core/src/project/project-manager.ts`

- ADD: Import `ClaimIndex` from `../claims/claim-index`
- ADD: Property `claimIndex?: ClaimIndex`
- MODIFY: `initialize()` — After noteManager initialization, construct `ClaimIndex` if claims config is present (or always — claims are convention-based).
  Spec: R004.§4.AC.01

### NEW: `core/src/cli/commands/claims/index.ts`

- ADD: `claimsCommand` — Commander `Command` grouping claim-related subcommands: `index`, `trace`, `gaps`, `lint`, `scaffold`
  Spec: R004.§4.AC.01, R004.§5.AC.01-02, R004.§6.AC.01, R004.§6.AC.02, R004.§6.AC.04

### NEW: `core/src/cli/commands/claims/index-cmd.ts`

- ADD: `indexCommand` — `scepter claims index` — Builds claim index, reports statistics.
  Spec: R004.§4.AC.01

### NEW: `core/src/cli/commands/claims/index-handler.ts`

- ADD: `async function handleIndexCommand(options, context): Promise<void>`
  Spec: R004.§4.AC.01, R004.§4.AC.02, R004.§4.AC.03

### NEW: `core/src/cli/commands/claims/trace-cmd.ts`

- ADD: `traceCommand` — `scepter claims trace <noteId>` — Displays traceability matrix.
  Spec: R004.§5.AC.01

### NEW: `core/src/cli/commands/claims/trace-handler.ts`

- ADD: `async function handleTraceCommand(noteId, options, context): Promise<void>`
  Spec: R004.§5.AC.01, R004.§8.AC.01

### NEW: `core/src/cli/commands/claims/gaps-cmd.ts`

- ADD: `gapsCommand` — `scepter claims gaps` — Reports missing downstream projections.
  Spec: R004.§5.AC.02

### NEW: `core/src/cli/commands/claims/gaps-handler.ts`

- ADD: `async function handleGapsCommand(options, context): Promise<void>`
  Spec: R004.§5.AC.02, R004.§8.AC.01

### NEW: `core/src/cli/commands/claims/lint-cmd.ts`

- ADD: `lintCommand` — `scepter claims lint <noteId>` — Validates claim structure.
Spec: R004.§6.AC.02

### NEW: `core/src/cli/commands/claims/lint-handler.ts`

- ADD: `async function handleLintCommand(noteId, options, context): Promise<void>`
Spec: R004.§6.AC.02

### NEW: `core/src/cli/commands/claims/scaffold-cmd.ts`

- ADD: `scaffoldCommand` — `scepter claims scaffold spec <noteId> --sections N` — Creates skeleton document.
Spec: R004.§6.AC.01

### NEW: `core/src/cli/commands/claims/scaffold-handler.ts`

- ADD: `async function handleScaffoldCommand(noteId, options, context): Promise<void>`
Spec: R004.§6.AC.01, R004.§6.AC.04

### NEW: `core/src/cli/formatters/claim-formatter.ts`

- ADD: `function formatTraceabilityMatrix(matrix: TraceabilityMatrix): string`
Spec: R004.§5.AC.01

- ADD: `function formatGapReport(gaps: GapReport[], options?: { priorityFilter?: string[] }): string`
Spec: R004.§5.AC.02, R004.§8.AC.01

- ADD: `function formatLintResults(errors: ClaimTreeError[]): string`
Spec: R004.§6.AC.02

- ADD: `function formatClaimTree(nodes: ClaimNode[], depth?: number): string`
Spec: R004.§4.AC.01

### MODIFY: `core/src/cli/index.ts`

- ADD: Import `claimsCommand` from `./commands/claims/index.js`
- MODIFY: Register `claimsCommand` on program. Add auto-promotion for `claims` subcommands.
Spec: R004.§6.AC.01, R004.§6.AC.02, R004.§6.AC.04 (§6.AC.03 removed — see §9)

## §4 Wiring Map

```
ConfigManager
  └─ claims?: ClaimConfig  ← NEW config section
       └─ bracelessMatching: boolean
       └─ priorityLevels: string[]

ProjectManager
  ├─ noteManager: NoteManager  (existing)
  ├─ referenceManager: ReferenceManager  (existing)
  ├─ sourceScanner: SourceCodeScanner  (existing)
  └─ claimIndex: ClaimIndex  ← NEW
       ├─ consumes: NoteManager.getNotes() → NoteWithContent[]
       ├─ consumes: NoteFileManager.getFileContents() → raw markdown
       ├─ uses: buildClaimTree() from claim-tree.ts
       ├─ uses: parseClaimReferences() from claim-parser.ts
       └─ produces: ClaimIndexData
            ├─ entries: Map<string, ClaimIndexEntry>
            ├─ trees: Map<string, ClaimNode[]>
            ├─ crossRefs: ClaimCrossReference[]
            └─ errors: ClaimTreeError[]

CLI (Commander.js)
  └─ claims/
       ├─ index-handler → ClaimIndex.build()
       ├─ trace-handler → buildTraceabilityMatrix() ← ClaimIndexData
       ├─ gaps-handler  → findGaps() ← ClaimIndexData
       ├─ lint-handler  → validateClaimTree() ← ClaimIndex.getClaimsForNote()
       └─ scaffold-handler → template generation → NoteFileManager.createNoteFile()
```

### Import Chain for Claim Index Build

```
ClaimIndex.build()
  → NoteManager.getNotes({})           // Get all note metadata
  → NoteFileManager.getFileContents()  // Get raw markdown per note
  → buildClaimTree(content)            // Parse heading tree
  → parseClaimReferences(content)      // Find inline references
  → SourceCodeScanner references       // Source code claim references
  → Assemble ClaimIndexData
```

### Import Chain for CLI Commands

```
claims/index-handler.ts
  → BaseCommand.setup()
  → context.projectManager.claimIndex.build()
  → formatClaimTree()
  → console.log()

claims/trace-handler.ts
  → BaseCommand.setup()
  → context.projectManager.claimIndex (must be built)
  → buildTraceabilityMatrix(noteId, indexData)
  → formatTraceabilityMatrix()
  → console.log()
```

## §5 Data Flow

### Flow 1: Claim Index Build

1. **Entry:** `scepter claims index` or `ProjectManager.initialize()` (lazy)
2. **Collection:** `ClaimIndex.build()` retrieves all notes via `NoteManager.getNotes({})`, then reads raw content via `NoteFileManager.getFileContents(noteId)` for each note
3. **Tree Construction:** For each note, `buildClaimTree(content)` parses markdown headings into a tree of `ClaimNode` objects. Section headings (those starting with `§`) become interior nodes; claim headings become leaves. Bare-number headings (date headings, numbered lists) are ignored.
4. **Reference Extraction:** `parseClaimReferences(content, { knownShortcodes, currentDocumentId })` scans for claim-level references within each document
5. **Cross-Reference Assembly:** Each extracted reference is resolved to a `ClaimCrossReference` linking source claim to target claim
6. **Validation:** `validateClaimTree()` checks for non-monotonic numbering and forbidden forms. (Same-note ID repeats are deduped during tree construction in step 3, not reported as errors here.)
7. **Delivery:** `ClaimIndexData` is stored on `ClaimIndex` instance, queryable by all downstream consumers

### Flow 2: Traceability Query

1. **Entry:** `scepter claims trace REQ004`
2. **Lookup:** `ClaimIndex.getClaimsForNote("REQ004")` returns all claims in that document
3. **Matrix Build:** For each claim, `getCrossRefsTo(claimId)` finds all downstream references. References are grouped by target note type to form projections.
4. **Delivery:** `TraceabilityMatrix` rendered via `formatTraceabilityMatrix()`

### Flow 3: Lint

1. **Entry:** `scepter claims lint R004`
2. **Read:** Raw markdown content loaded for the note
3. **Parse:** `buildClaimTree(content)` + `validateClaimTree()` produce `ClaimTreeError[]`
4. **Report:** Errors formatted via `formatLintResults()`

### Flow 4: Scaffold

1. **Entry:** `scepter claims scaffold spec S013 --sections 5`
2. **Generate:** Create markdown skeleton with `## §1` through `## §5` headings, each containing placeholder `### AC.01 [Description]` entries
3. **Write:** `NoteFileManager.createNoteFile()` or direct file write
4. **Index:** Subsequent `scepter claims index` will pick up the new document

## §6 Integration Sequence

### Phase 1: Parser Foundation

**Files:**
- `core/src/parsers/claim/claim-parser.ts` (NEW)
- `core/src/parsers/claim/claim-tree.ts` (NEW)
- `core/src/parsers/claim/index.ts` (NEW)

**Changes:**
- Implement `ClaimAddress`, `ClaimParseOptions`, `ClaimReference` interfaces
- Implement `parseClaimAddress()` — the core grammar parser for claim reference strings
- Implement `normalizeSectionSymbol()`, `parseMetadataSuffix()`
- Implement `parseClaimReferences()` — document-level scanner using the address parser
- Implement `ClaimNode`, `ClaimTreeResult`, `ClaimTreeError` interfaces
- Implement `buildClaimTree()` — markdown heading parser that builds the claim tree
- Implement `validateClaimTree()` — structural validation

**Verify:** Parser unit tests pass. `buildClaimTree()` correctly parses R004 itself and produces the expected tree. `parseClaimAddress("R004.§3.AC.01:P0")` returns correct components. Forbidden form `AC01` is rejected. `§` normalization produces identical results.

**Spec:** R004.§1.AC.01, R004.§1.AC.02, R004.§1.AC.03, R004.§1.AC.04, R004.§1.AC.05, R004.§1.AC.06, R004.§2.AC.03, R004.§2.AC.04, R004.§3.AC.01, R004.§3.AC.02, R004.§3.AC.03, R004.§3.AC.04

### Phase 2: Configuration and Types

**Files:**
- `core/src/types/config.ts` (MODIFY)
- `core/src/types/reference.ts` (MODIFY)
- `core/src/config/config-validator.ts` (MODIFY — add schema for ClaimConfig)

**Changes:**
- Add `ClaimConfig` interface to config types
- Add `claims?: ClaimConfig` field to `SCEpterConfig`
- Add `ClaimReference` extension to reference types
- Update Zod schema in config-validator to accept `claims` section
- Default `bracelessMatching` to `true`

**Verify:** `pnpm tsc` passes. Existing tests pass unchanged (the new field is optional). Config loading round-trips with `claims` section present.

**Spec:** R004.§2.AC.05, R004.§8.AC.01 (§5.AC.04 removed — see §9)

### Phase 3: Claim Index

**Files:**
- `core/src/claims/claim-index.ts` (NEW)
- `core/src/claims/index.ts` (NEW)
- `core/src/project/project-manager.ts` (MODIFY)

**Changes:**
- Implement `ClaimIndex` class with `build()`, `getClaimsForNote()`, `getClaim()`, `getCrossRefsFrom()`, `getCrossRefsTo()`, `getErrors()`
- Implement `ClaimIndexEntry`, `ClaimCrossReference`, `ClaimIndexData` interfaces
- Implement `NoteWithContent` interface
- Add `claimIndex` property to `ProjectManager`
- Wire `ClaimIndex` construction in `ProjectManager.initialize()` — lazy build on first access or explicit via CLI

**Verify:** `ClaimIndex.build()` against the actual `_scepter/` notes in this project produces a valid index. Cross-references between R004 and DD001 are correctly detected. Duplicate/error detection works.

**Spec:** R004.§4.AC.01, R004.§4.AC.02, R004.§4.AC.03

### Phase 4: Traceability and Analysis

**Files:**
- `core/src/claims/traceability.ts` (NEW)

**Changes:**
- Implement `buildTraceabilityMatrix()`, `findGaps()`
- Implement `TraceabilityRow`, `TraceabilityMatrix`, `GapReport`, `ProjectionPresence` interfaces
- Gap detection is claim-presence based: check whether a claim ID appears in other documents, grouped by note type

**Verify:** `buildTraceabilityMatrix("R004")` produces correct matrix with claims present in R004, cross-referenced to DD001. `findGaps()` reports claims with no downstream references.

**Spec:** R004.§5.AC.01, R004.§5.AC.02, R004.§8.AC.01, R004.§8.AC.02

### Phase 5: CLI Commands

**Files:**
- `core/src/cli/commands/claims/index.ts` (NEW)
- `core/src/cli/commands/claims/index-cmd.ts` (NEW)
- `core/src/cli/commands/claims/index-handler.ts` (NEW)
- `core/src/cli/commands/claims/trace-cmd.ts` (NEW)
- `core/src/cli/commands/claims/trace-handler.ts` (NEW)
- `core/src/cli/commands/claims/gaps-cmd.ts` (NEW)
- `core/src/cli/commands/claims/gaps-handler.ts` (NEW)
- `core/src/cli/commands/claims/lint-cmd.ts` (NEW)
- `core/src/cli/commands/claims/lint-handler.ts` (NEW)
- `core/src/cli/commands/claims/scaffold-cmd.ts` (NEW)
- `core/src/cli/commands/claims/scaffold-handler.ts` (NEW)
- `core/src/cli/formatters/claim-formatter.ts` (NEW)
- `core/src/cli/index.ts` (MODIFY)

**Changes:**
- Implement command definitions for: `index`, `trace`, `gaps`, `lint`, `scaffold`
- Implement handler functions following `BaseCommand.execute()` pattern
- Implement formatters for terminal output
- Register `claimsCommand` in CLI index
- Add auto-promotion for `claims` subcommands (so `scepter trace R004` works like `scepter claims trace R004`)

**Verify:** All CLI commands execute without error. `scepter claims index` builds and reports. `scepter claims lint R004` reports expected validation results. `scepter claims trace R004` produces formatted matrix output.

**Spec:** R004.§4.AC.01, R004.§5.AC.01, R004.§5.AC.02, R004.§6.AC.01, R004.§6.AC.02, R004.§6.AC.04, R004.§8.AC.01, R004.§8.AC.02, R004.§8.AC.03

### Phase 6: Braceless Reference Integration

**Files:**
- `core/src/parsers/note/note-parser.ts` (MODIFY)
- `core/src/parsers/claim/claim-parser.ts` (MODIFY — braceless scanning)
- `core/src/scanners/source-code-scanner.ts` (MODIFY — claim-aware scanning)

**Changes:**
- Extend `parseNoteMentions()` to optionally invoke `parseClaimReferences()` for claim-level awareness in braced references
- Add braceless reference scanning mode to `parseClaimReferences()` that validates against known shortcodes from config
- Extend `SourceCodeScanner.mentionToReference()` to populate `ClaimReference.claimAddress` when the context contains claim-level references
- Add config check for `bracelessMatching` flag

**Verify:** Braced references continue to work identically. Braceless `REQ004.§3.AC.01` is detected in markdown content. Source code `// @implements {R004.§1.AC.03}` is parsed with claim address. False positives are filtered by shortcode validation.

**Spec:** R004.§2.AC.01, R004.§2.AC.02, R004.§2.AC.05

## §7 Traceability Matrix

| Spec ID | Design Realization | Files | Phase |
|---------|--------------------|-------|-------|
| R004.§1.AC.01 | `buildClaimTree()` extracts section IDs from markdown headings starting with `§` (required prefix) | `claim-tree.ts` | 1 |
| R004.§1.AC.02 | `buildClaimTree()` extracts claim IDs from letter-prefix-dot-number headings | `claim-tree.ts` | 1 |
| R004.§1.AC.03 | `parseClaimAddress()` resolves fully qualified, partial, and bare claims | `claim-parser.ts` | 1 |
| R004.§1.AC.04 | Reference-time ambiguity detection only; no definition-time check | `claim-index.ts` resolution path | 1 |
| R004.§1.AC.05 | `validateClaimTree()` checks monotonic numbering | `claim-tree.ts` | 1 |
| R004.§1.AC.06 | `parseClaimAddress()` rejects forbidden `PREFIX + digits` form | `claim-parser.ts` | 1 |
| R004.§2.AC.01 | `parseClaimReferences()` with braceless mode + shortcode validation | `claim-parser.ts`, `note-parser.ts` | 6 |
| R004.§2.AC.02 | Existing `parseNoteMentions()` continues unchanged for braced refs | `note-parser.ts` | 6 |
| R004.§2.AC.03 | `normalizeSectionSymbol()` strips `§` for canonical comparison | `claim-parser.ts` | 1 |
| R004.§2.AC.04 | `parseMetadataSuffix()` extracts colon-separated metadata | `claim-parser.ts` | 1 |
| R004.§2.AC.05 | `ClaimConfig.bracelessMatching` field in `SCEpterConfig` | `config.ts` | 2 |
| R004.§3.AC.01 | `ClaimNode` with `type: 'section'` from heading parser | `claim-tree.ts` | 1 |
| R004.§3.AC.02 | `ClaimNode` with `type: 'claim'` from heading parser | `claim-tree.ts` | 1 |
| R004.§3.AC.03 | `buildClaimTree()` returns hierarchical `ClaimNode[]` tree | `claim-tree.ts` | 1 |
| R004.§3.AC.04 | No structured format required — parser operates on standard headings only | `claim-tree.ts` | 1 |
| R004.§4.AC.01 | `ClaimIndex.build()` scans all notes and source code | `claim-index.ts` | 3 |
| R004.§4.AC.02 | `ClaimIndexData` is fully derivable from document content | `claim-index.ts` | 3 |
| R004.§4.AC.03 | `ClaimIndex.getErrors()` reports non-monotonic and broken refs; same-note ID repeats are silently deduped during tree construction (no error) | `claim-index.ts`, `claim-tree.ts` | 3 |
| R004.§4.AC.04 | Phase 2 cross-ref scanner skips references with no `claimPrefix` (section-only refs) | `claim-index.ts` | 3 |
| R004.§4.AC.05 | `resolveClaimAddress()` fuzzy matching requires `[A-Z]+\.\d{2,3}` pattern in raw string | `claim-index.ts` | 3 |
| R004.§5.AC.01 | `scepter claims trace` + `buildTraceabilityMatrix()` | `trace-handler.ts`, `traceability.ts` | 4, 5 |
| R004.§5.AC.02 | `scepter claims gaps` + `findGaps()` | `gaps-handler.ts`, `traceability.ts` | 4, 5 |
| R004.§6.AC.01 | `scepter claims scaffold spec <id> --sections N` | `scaffold-handler.ts` | 5 |
| R004.§6.AC.02 | `scepter claims lint <id>` with comprehensive error detection | `lint-handler.ts` | 5 |
| R004.§6.AC.04 | Scaffold creates initial structure; direct editing supported | `scaffold-handler.ts` | 5 |
| R004.§8.AC.01 | `--priority` filter on `trace` and `gaps` commands | `trace-handler.ts`, `gaps-handler.ts` | 5 |
| R004.§8.AC.02 | High-priority claims surfaced more prominently in trace/gaps output | `claim-formatter.ts` | 5 |
| R004.§8.AC.03 | `parseMetadataSuffix()` handles arbitrary comma-separated tags | `claim-parser.ts` | 1 |

## §8 Testing Strategy

| Test Level | Scope | Requirements Covered |
|-----------|-------|---------------------|
| Unit | `parseClaimAddress()` — all valid reference forms from R004 table, invalid forms, edge cases | §1.AC.01-AC.06, §2.AC.03, §2.AC.04 |
| Unit | `buildClaimTree()` — heading hierarchy, section/claim distinction, content boundaries | §3.AC.01-AC.04 |
| Unit | `validateClaimTree()` — monotonic check, forbidden forms (line-leading, 2+ letter prefix); same-note repeats silently deduped; no definition-time ambiguity | §1.AC.05, §1.AC.06, §4.AC.03 |
| Unit | `parseClaimReferences()` — braced and braceless reference extraction from markdown | §2.AC.01, §2.AC.02, §2.AC.05 |
| Unit | `parseMetadataSuffix()` — colon metadata extraction and stripping | §2.AC.04, §8.AC.03 |
| Unit | `normalizeSectionSymbol()` — `§` stripping produces identical canonical forms | §2.AC.03 |
| Integration | `ClaimIndex.build()` — end-to-end index construction from real notes in `_scepter/` | §4.AC.01, §4.AC.02, §4.AC.03 |
| Integration | `ClaimIndex.build()` — section-only refs (§10, §3.1) produce zero cross-refs | §4.AC.04, §4.AC.05 |
| Integration | `buildTraceabilityMatrix()` — matrix construction with cross-references | §5.AC.01 |
| Integration | `findGaps()` — gap detection via claim presence across documents | §5.AC.02 |
| CLI | `scepter claims index` — runs without error, produces output | §4.AC.01 |
| CLI | `scepter claims lint R004` — detects known issues in real document | §6.AC.02 |
| CLI | `scepter claims trace R004` — produces matrix output | §5.AC.01 |
| CLI | `scepter claims gaps` — reports gaps across project | §5.AC.02 |
| CLI | `scepter claims scaffold spec S013 --sections 5` — creates valid skeleton | §6.AC.01 |
| Regression | Existing `parseNoteMentions()` tests still pass after Phase 6 modifications | §2.AC.02 |
| Regression | Existing reference system tests still pass (note-level references unchanged) | All |
| Self-hosting | R004 itself is parseable by the claim system and produces a valid index with 30 ACs | §1-§4 |

## §9 Observations

### Scope gaps in R004

1. **No mention of index caching/persistence.** R004 says "compute, don't maintain" but doesn't address whether the claim index should be cached between CLI invocations. For large projects, rebuilding from scratch on every `scepter claims trace` invocation will be slow. The design should support an optional JSON cache at `_scepter/claim-index.json` that is invalidated when any note file changes. This is an implicit requirement that R004 doesn't address.

2. **No specification of `scepter claims` vs top-level commands.** R004 uses `scepter trace`, `scepter lint`, `scepter gaps` etc. as top-level commands, but the existing CLI uses `scepter context <subcommand>` grouping. This design uses `scepter claims <subcommand>` for organizational consistency, with auto-promotion so both `scepter trace R004` and `scepter claims trace R004` work. This is a design decision not explicitly covered by R004.

3. **Scope resolution ambiguity handling.** R004.§1.AC.04 says the parser "MUST reject ambiguous short-form references." But during index building (not linting), encountering an ambiguous reference in a document body should produce a warning, not a hard failure. The linter rejects; the index builder collects. This distinction is implicit in R004.

4. **Source code claim references.** R004 discusses source code scanning but doesn't specify whether source code references like `// @implements {R004.§1.AC.03}` should be parsed at the claim level or only at the note level. This design extends the source scanner to parse claim addresses inside braced references, which is a natural extension but not explicitly required.

5. **`scepter show` integration.** R004 mentions `scepter show S012.§3` in the problem statement but doesn't include it as a formal AC. The existing `show-handler.ts` would need modification to support section-level display. This is noted but not designed here — it can be a follow-on after Phase 3.

6. **Verification system.** Lightweight claim verification captured as separate requirement {R005}. Not designed here — will integrate with this index infrastructure when designed.

### Changes from initial design — 2026-03-09

- **Removed R004.§5.AC.03** (staleness detection) — depends on verification infrastructure not yet designed
- **Removed R004.§5.AC.04** (relationship type inference) — too opinionated; gap detection works on claim presence without prescribing how projections relate
- **Removed R004.§6.AC.03** (`scepter fix`) — headings without IDs are allowed, not errors to repair
- **Removed** `verification-store.ts`, `findStale()`, `StaleReport`, `RelationshipRule` from module inventory
- **Removed** `stale` and `fix` CLI commands
- **Verification events** captured as {R005} for future lightweight CLI integration

## §10 Confidence Markers ({R004.§7})

**Added:** 2026-03-11
**Source:** {R004.§7} — File-level confidence annotations for human review status
**Complements:** {R005.§3} — Claim-level verification events (finer granularity)

### §10.1 Problem Context

AI-assisted development generates code faster than humans can verify it. The claim-level verification system ({R005.§3}) tracks whether individual *claims* have been verified, but there is no mechanism to answer the simpler question: "Has anyone looked at this file at all?"

Confidence markers are coarse file-level annotations that classify each source file's review status. They complement claim-level verification by providing a fast audit surface: before drilling into claim traceability, a team can see which files are entirely unreviewed.

### §10.2 Confidence Levels

[Updated — 2026-03-13: Numeric levels 1-5 replace named levels. Emoji prefix is a CLI positional parameter, not inferred. No space between emoji and number.]

| Level | Name | Meaning |
|-------|------|---------|
| 1 | Experimental | Exploring, expect major changes |
| 2 | Draft | Basic shape, likely significant changes |
| 3 | Developing | Core settled, details may change |
| 4 | Settled | Confident, only minor tweaks expected |
| 5 | Stable | API contract, breaking changes require major version |

**Review icons:**
- 🤖 — AI-generated or AI-modified (can assign levels 1-3)
- 👤 — Human reviewed or human-modified (can assign levels 3-5)

**Default assumption:** Everything is `🤖2` (AI draft) unless marked otherwise.

### §10.3 Annotation Format

```
// @confidence <emoji><level> <YYYY-MM-DD>
```

No space between the emoji and the numeric level.

Examples:
```typescript
// @confidence 🤖2 2026-03-11
// @confidence 👤4 2026-03-11
// @confidence 🤖3 2026-03-10
```

**Placement:** The annotation MUST appear within the first 20 lines of the file, typically as a standalone comment or inside the file-level JSDoc block. The parser scans only the file header to avoid performance issues on large files.

**Grammar:** The parser recognizes:
- `@confidence` — required keyword
- `<emoji>` — one of 🤖, 👤 (the reviewer icon)
- `<level>` — integer 1-5 (no space after emoji)
- `<YYYY-MM-DD>` — required ISO date

### §10.4 Module Inventory

#### NEW: `core/src/claims/confidence.ts`

- ADD: `type ConfidenceLevel = 1 | 2 | 3 | 4 | 5`
  Spec: {R004.§7.AC.01}, {R004.§7.AC.02}

- ADD: `type ReviewerIcon = '🤖' | '👤'`
  Spec: {R004.§7.AC.02}

- ADD: `interface ConfidenceAnnotation` — `{ level: ConfidenceLevel, reviewer: ReviewerIcon, date: string, line: number, filePath: string }`
  Spec: {R004.§7.AC.01}, {R004.§7.AC.02}

- ADD: `interface ConfidenceAuditResult` — `{ total: number, annotated: number, unannotated: number, byLevel: Record<ConfidenceLevel, number>, files: ConfidenceAnnotation[] }`
  Spec: {R004.§7.AC.01}

- ADD: `function parseConfidenceAnnotation(content: string, filePath: string): ConfidenceAnnotation | null` — Scans the first 20 lines of a file for `@confidence` annotation. Returns parsed annotation or null if absent.
  Spec: {R004.§7.AC.01}, {R004.§7.AC.02}

- ADD: `function formatConfidenceAnnotation(reviewer: ReviewerIcon, level: ConfidenceLevel, date: string): string` — Produces a comment string like `// @confidence 👤4 2026-03-11`. No space between emoji and number.
  Spec: {R004.§7.AC.02}

- ADD: `function insertConfidenceAnnotation(content: string, annotation: string): string` — Inserts or replaces a `@confidence` line in the file header. If an existing annotation is found, it is replaced in-place. If no annotation exists, it is inserted after the file-level JSDoc block (or as the first line if no JSDoc exists).
  Spec: {R004.§7.AC.02}, {R004.§7.AC.03}

- ADD: `async function auditConfidence(projectPath: string, config: SourceCodeIntegrationConfig): Promise<ConfidenceAuditResult>` — Discovers all source files per config, parses each for confidence annotations, and returns aggregate statistics.
  Spec: {R004.§7.AC.01}

#### NEW: `core/src/cli/commands/confidence/index.ts`

- ADD: `confidenceCommand` — Commander `Command` grouping confidence subcommands: `audit`, `mark`
  Spec: {R004.§7.AC.01}, {R004.§7.AC.02}

#### NEW: `core/src/cli/commands/confidence/audit-command.ts`

- ADD: `auditCommand` — `scepter confidence audit [--format json|table]`
  Spec: {R004.§7.AC.01}

  The command discovers all source files from `sourceCodeIntegration` config, parses each for `@confidence` annotations, and displays:
  - Summary: total files, annotated count, unannotated count
  - Breakdown by level: 1-5 counts and percentages
  - Optional `--unannotated` flag to list only files without annotations
  - Optional `--level <N>` flag to list only files at a specific confidence level

#### NEW: `core/src/cli/commands/confidence/mark-command.ts`

- ADD: `markCommand` — `scepter confidence mark <file> <ai|human> <level>`
  Spec: {R004.§7.AC.02}

  The command:
  1. Reads the file content
  2. Maps positional `ai` → 🤖, `human` → 👤; validates level is 1-5 and within the reviewer's allowed range (🤖: 1-3, 👤: 3-5)
  3. Calls `formatConfidenceAnnotation(reviewer, level, date)` to produce e.g. `// @confidence 👤4 2026-03-11`
  4. Calls `insertConfidenceAnnotation()` to add or update the annotation
  5. Writes the modified file back
  6. Reports success with the annotation that was written

#### NEW: `core/src/cli/formatters/confidence-formatter.ts`

- ADD: `function formatConfidenceAudit(result: ConfidenceAuditResult, options?: { format?: 'table' | 'json' }): string`
  Spec: {R004.§7.AC.01}

  Renders the audit result as a terminal table with columns: Level, Count, Percentage. Includes a summary header with total/annotated/unannotated counts.

#### MODIFY: `core/src/types/config.ts`

- MODIFY: `interface ClaimConfig` — Add field `confidence?: { autoInsert?: boolean }`
  Spec: {R004.§7.AC.03}

  The `autoInsert` flag (default: `true`) controls whether `scepter create` and any file-creation operations auto-insert `// @confidence 🤖2 <YYYY-MM-DD>` at the top of newly created source files.

#### MODIFY: `core/src/config/config-validator.ts`

- MODIFY: `SCEpterConfigBaseSchema.claims` — Add optional `confidence` object schema:
  ```
  confidence: z.object({
    autoInsert: z.boolean().optional().default(true),
  }).optional()
  ```
  Spec: {R004.§7.AC.03}

#### MODIFY: `core/src/cli/commands/claims/index.ts`

- No change. Confidence is a separate command group (`scepter confidence`), not nested under `scepter claims`. Rationale: confidence operates at the file level, not the claim level. Grouping it under `claims` would be misleading.

#### MODIFY: `core/src/cli/index.ts`

- ADD: Import `confidenceCommand` from `./commands/confidence/index.js`
- ADD: Register `confidenceCommand` on program
  Spec: {R004.§7.AC.01}, {R004.§7.AC.02}

#### MODIFY: `core/src/scanners/source-code-scanner.ts`

- MODIFY: `scanFile()` — After reading file content, call `parseConfidenceAnnotation(content, filePath)` and store the result on the `SourceReference` (or emit as a separate data channel). This allows the confidence audit to piggyback on the existing scan infrastructure rather than re-reading files.

  Note: This is an optimization. The initial implementation MAY use the standalone `auditConfidence()` function that scans files independently. Integration with `SourceCodeScanner` is a Phase 2 concern.

### §10.5 Wiring Map

```
ConfigManager
  └─ claims?: ClaimConfig
       └─ confidence?: { autoInsert?: boolean }  ← NEW config section

SourceCodeScanner (existing)
  └─ scanFile()
       └─ parseConfidenceAnnotation()  ← NEW, optional integration
            └─ returns ConfidenceAnnotation | null

CLI (Commander.js)
  └─ confidence/                       ← NEW top-level command group
       ├─ audit-command
       │    └─ auditConfidence()       ← scans files, aggregates stats
       │         └─ parseConfidenceAnnotation() per file
       │         └─ formatConfidenceAudit()
       └─ mark-command
            └─ formatConfidenceAnnotation()
            └─ insertConfidenceAnnotation()
            └─ fs.writeFile()
```

### §10.6 Data Flow

#### Flow 1: Confidence Audit

1. **Entry:** `scepter confidence audit`
2. **Discovery:** `auditConfidence()` uses `SourceCodeIntegrationConfig` to discover all source files (same glob patterns as `SourceCodeScanner.discoverSourceFiles()`)
3. **Parse:** For each file, read the first 20 lines and call `parseConfidenceAnnotation(content, filePath)`
4. **Aggregate:** Count files by level, compute percentages, collect unannotated file list
5. **Delivery:** `ConfidenceAuditResult` rendered via `formatConfidenceAudit()`

#### Flow 2: Confidence Mark

1. **Entry:** `scepter confidence mark src/auth/service.ts human 4`
2. **Read:** Read file content
3. **Map:** `human` → 👤, validate level 4 is in range 3-5 for 👤
4. **Format:** `formatConfidenceAnnotation('👤', 4, '2026-03-11')` produces `// @confidence 👤4 2026-03-11`
5. **Insert:** `insertConfidenceAnnotation(content, annotation)` replaces existing `@confidence` line or inserts at file header
6. **Write:** Write modified content back to file
7. **Report:** Print confirmation with the written annotation

#### Flow 3: Auto-Insert on File Creation (when `autoInsert: true`)

1. **Entry:** Any file creation operation (e.g., `scepter claims scaffold`, or future hooks)
2. **Check:** Read `config.claims.confidence.autoInsert`
3. **Insert:** If enabled, prepend `// @confidence 🤖2 <YYYY-MM-DD>` to the new file content before writing
4. **Note:** This is a hook point, not a standalone flow. The initial implementation adds the check to scaffold command output only. Broader integration with file-creation operations is deferred.

### §10.7 Integration Sequence

#### Phase 1: Core Parser and Types

**Files:**
- `core/src/claims/confidence.ts` (NEW)
- `core/src/types/config.ts` (MODIFY)
- `core/src/config/config-validator.ts` (MODIFY)

**Changes:**
- Implement `ConfidenceLevel` (1-5), `ReviewerIcon`, `ConfidenceAnnotation`, `ConfidenceAuditResult` types
- Implement `parseConfidenceAnnotation()` — regex-based parser for `@confidence` lines (emoji+number, no space)
- Implement `formatConfidenceAnnotation(reviewer, level, date)` — produces annotation strings like `🤖3 2026-03-11`
- Implement `insertConfidenceAnnotation()` — in-place file content modification
- Implement `auditConfidence()` — file discovery and aggregation
- Add `confidence?: { autoInsert?: boolean }` to `ClaimConfig`
- Add Zod schema for `confidence` in config validator

**Verify:**
- Unit tests for `parseConfidenceAnnotation()`: valid annotations at various line positions, missing annotations, malformed annotations, emoji+number parsing (no space)
- Unit tests for `formatConfidenceAnnotation()`: all reviewer/level/date combinations, verify no space between emoji and number
- Unit tests for `insertConfidenceAnnotation()`: insert into empty file, insert into file with existing JSDoc, replace existing annotation, insert when no annotation exists
- `pnpm tsc` passes with new config field

**Spec:** {R004.§7.AC.01}, {R004.§7.AC.02}, {R004.§7.AC.03}

#### Phase 2: CLI Commands

**Files:**
- `core/src/cli/commands/confidence/index.ts` (NEW)
- `core/src/cli/commands/confidence/audit-command.ts` (NEW)
- `core/src/cli/commands/confidence/mark-command.ts` (NEW)
- `core/src/cli/formatters/confidence-formatter.ts` (NEW)
- `core/src/cli/index.ts` (MODIFY)

**Changes:**
- Implement `confidenceCommand` with `audit` and `mark` subcommands
- Implement `auditCommand` following `BaseCommand.execute()` pattern
- Implement `markCommand` following `BaseCommand.execute()` pattern
- Implement `formatConfidenceAudit()` for terminal table output
- Register `confidenceCommand` in CLI index

**Verify:**
- `scepter confidence audit` runs against the project's `core/src/` and produces valid output
- `scepter confidence mark core/src/claims/confidence.ts human 4` writes `// @confidence 👤4 <date>` annotation
- `scepter confidence audit --format json` produces valid JSON
- `scepter confidence audit --unannotated` lists only files without annotations

**Spec:** {R004.§7.AC.01}, {R004.§7.AC.02}

#### Phase 3: Scanner Integration (Optional Optimization)

**Files:**
- `core/src/scanners/source-code-scanner.ts` (MODIFY)

**Changes:**
- In `scanFile()`, after reading content, call `parseConfidenceAnnotation()` and store the result
- Emit `confidence:found` event with the annotation data
- The audit command can optionally consume scanner results instead of re-reading files

**Verify:**
- Existing scanner tests pass unchanged
- Scanner emits confidence data for files with annotations
- Audit results are identical whether using standalone scan or scanner integration

**Spec:** Performance optimization, not directly required by any AC

### §10.8 Traceability Matrix

| Spec ID | Design Realization | Files | Phase |
|---------|--------------------|-------|-------|
| {R004.§7.AC.01} | `auditConfidence()` discovers files, `parseConfidenceAnnotation()` extracts levels, `formatConfidenceAudit()` renders summary with count/percentage per level | `confidence.ts`, `audit-command.ts`, `confidence-formatter.ts` | 1, 2 |
| {R004.§7.AC.02} | `markCommand` maps positional `ai`/`human` to emoji, validates level range, `formatConfidenceAnnotation(reviewer, level, date)` builds `<emoji><level> <date>` string, `insertConfidenceAnnotation()` writes it into file header | `confidence.ts`, `mark-command.ts` | 1, 2 |
| {R004.§7.AC.03} | `ClaimConfig.confidence.autoInsert` flag in config; Zod schema validates; scaffold command checks flag before writing files | `config.ts`, `config-validator.ts`, `confidence.ts` | 1 |

### §10.9 Testing Strategy

| Test Level | Scope | Requirements Covered |
|-----------|-------|---------------------|
| Unit | `parseConfidenceAnnotation()` — all valid forms, missing annotation, malformed, position beyond line 20 | {R004.§7.AC.01} |
| Unit | `formatConfidenceAnnotation()` — all reviewer/level/date permutations, verify no space between emoji and number | {R004.§7.AC.02} |
| Unit | `insertConfidenceAnnotation()` — empty file, existing JSDoc, replace existing, no annotation | {R004.§7.AC.02} |
| Unit | `auditConfidence()` — mock filesystem with mixed annotated/unannotated files | {R004.§7.AC.01} |
| Integration | Config validation accepts/rejects `confidence` schema variants | {R004.§7.AC.03} |
| CLI | `scepter confidence audit` — runs against real project, produces output | {R004.§7.AC.01} |
| CLI | `scepter confidence mark <file> human 4` — modifies file, writes `👤4 <date>` annotation, present on re-read | {R004.§7.AC.02} |
| CLI | `scepter confidence audit --format json` — valid JSON output | {R004.§7.AC.01} |
| Regression | Existing `SourceCodeScanner` tests pass after Phase 3 integration | All |

### §10.10 Design Decisions

1. **Separate command group, not under `claims`.** Confidence annotations operate at the file level, not the claim level. Placing them under `scepter confidence` rather than `scepter claims confidence` avoids conceptual confusion. The claims system tracks sub-note granularity; confidence is whole-file.

2. **Parse from source files, not maintain a registry.** Following R004's "compute, don't maintain" principle, confidence annotations live in the source files themselves. There is no `_scepter/confidence.json`. The audit command scans files each time. For performance, the scanner integration (Phase 3) allows piggybacking on existing file reads.

3. **Header-only scanning (first 20 lines).** Scanning entire files for a single annotation is wasteful. Restricting to the first 20 lines matches convention (file-level annotations belong at the top) and provides a hard performance bound.

4. **Numeric confidence levels adopted wholesale.** [Updated — 2026-03-13] Numeric levels 1-5 replace named levels (unreviewed/reviewed/modified). Emoji prefix (🤖/👤) is a positional CLI parameter, not inferred from the level. No space between emoji and number (`👤4`, not `👤 4`). AI can assign 1-3, human can assign 3-5 (level 3 is shared). This eliminates the `by:<actor>` surface entirely.

5. **Auto-insert defaults to enabled.** [Updated — 2026-03-13] The `autoInsert` flag defaults to `true`. In AI-assisted development, the common case is that new files are AI-generated and should be marked as such. Teams that don't want auto-insertion opt out via config.

6. **No interaction with claim-level verification.** Confidence markers and claim verification ({R005.§3}) are independent systems. A file can be `👤4` (human reviewed, settled) while individual claims within it remain unverified (nobody checked specific requirements). They answer different questions at different granularities.
