---
created: 2026-05-22
status: draft
tags: [lint, audit, references, project-wide, source-scan]
confidence: 🤖2 2026-05-22
---

# DD022 - Project-Wide Reference Audit Lint Surface

**Requirement:** {R016}
**Consumes:** {DD021} (the unified resolver realized in `core/src/claims/reference-resolver.ts`)
**Created:** 2026-05-22

## §1 Problem Statement

{R016} extends `scepter claims lint` with five new flags — `--all`, `--code`, `--target`, `--codes`, `--refs-only`, plus `--json` — and an opt-out for treating archived and soft-deleted notes as valid resolution targets. The flags realize a project-wide audit surface that ranges {DD021}'s per-reference resolver outcomes over the whole project (notes plus, opt-in, source code) and emits the {R004.§4.AC.07} error-code taxonomy as a project-level finding stream.

The existing lint surface is per-note: `scepter claims lint <id>` runs the structural and reference-resolution checks on one note's claims and inbound resolved-archive edges. Source-code reference annotations (`@implements {R042}`, `@validates {R042.§1.AC.03}`, `derives=R042.§1.AC.01` in comments) are NOT scanned by lint today. After a rename or delete that the {R015} rewriter did not see (manual edits, archived notes left cited), the author has no single command that surfaces every remaining citation across notes AND code.

This DD specifies the module decomposition that:

1. Extends `lint-command.ts` with a project-wide mode (`--all`) that ranges the existing per-note engine across every note in the project's discovery paths.
2. Reuses the existing `SourceCodeScanner` infrastructure under an opt-in `--code` flag to add source-code annotations to the same finding stream.
3. Introduces a citation-incidence aggregator that consumes the {DD021} resolver outcomes carried on `ClaimCrossReference.resolverOutcome` and the source-scanner's `SourceReference[]` and groups them by target ID under each error code for human output, OR flattens them into the JSON `incidences` array per {R016.§5.AC.02}.
4. Adds filter layers (`--target`, `--codes`, `--refs-only`) that apply at the aggregator boundary, after resolution and before rendering.
5. Adds lifecycle opt-outs (`--include-archived-as-valid`, `--include-soft-deleted-as-valid`) that suppress findings against archived or soft-deleted notes.

The DD does not introduce a new resolver, new error codes, or new resolution semantics. It is a consumer of {DD021}'s outcomes and {R004.§4.AC.07}'s taxonomy.

### Provisional Open-Question Answers

{R016} defers four open questions to the downstream specification. The DD provisionally answers OQ.01–.03 inline so the module decomposition can be specified concretely; OQ.04 stays as Frontier work. Each provisional answer is recorded in §7 with a "PROVISIONAL — pending spec" tag so the user can override.

- **OQ.01 — Flag names**: `--all`, `--code`, `--target`, `--codes`, `--refs-only`, `--json`, `--include-archived-as-valid`, `--include-soft-deleted-as-valid` — names as written in R016. Provisional.
- **OQ.02 — `--code` and `--target` on per-note form**: `--code` is accepted on the per-note form for the narrow "this note's source citations" case (scans source code for references targeting `<id>`'s claims, using the same scanner pass as `--all --code`). `--target` is REJECTED on the per-note form with a clear error message — combining a per-note scope with a project-wide reverse-lookup filter is incoherent. `--codes` and `--refs-only` ARE accepted on the per-note form (they filter the existing per-note error stream).
- **OQ.03 — Soft-delete vs archive code distinction**: Use a single new code `reference-to-soft-deleted` distinct from `reference-to-archived`. The lifecycle semantics differ (un-archive vs restore-from-deleted) and collapsing them loses the information the author needs to choose the right remediation. This is the only NEW error code this DD authorizes; it extends the {R004.§4.AC.07} taxonomy. It DOES NOT widen the {DD021} `ResolverFailureCode` union directly — instead, it is synthesized by the same consumer-side synthesis pattern that produces `reference-to-archived` today (see {DD021.§10.DC.06} and the existing `collectInlineRefArchiveSynthesis` helper in `lint-command.ts:210`).
- **OQ.04 — Performance and caching**: Deferred to Frontier. See §8 for the naive complexity analysis and the indexes that already amortize most of the cost; this DD does not introduce a new caching surface.

## §2 Epistemic Review of Bound Claims

Applying the binding analysis from {DD021.§2} to R016's ACs.

### HIGH BINDING

- **{R016.§2.AC.02}** — Targets MAY be absent. This is the load-bearing decision: the canonical cleanup workflow ("I just deleted R042; what still cites it?") requires that `--target` accept IDs that do not resolve. The filter is textual matching against the supplied tokens, not a target-existence check. Every consumer that thinks about `--target` filtering must respect this; misapplied it converts the cleanup surface into an error-on-input surface. Realized by §3 (`MatchesTargetFilter` operates against the citation's parsed target token, not against an index lookup).

- **{R016.§4.AC.05}** — Tombstoned references preserved verbatim. The marker recognition contract from {R015.§5.AC.01} and {DD020.§5.DC.01} is unchanged. The audit sweep MUST NOT flag a tombstoned token under any combination of flags. Realized by §3 (the aggregator's `IncidenceCollector` checks `isDeletionMarker` before emitting; deletion-marker citations are silently dropped, same behavior as the per-note linter today).

- **{R016.§6.AC.01}** — Resolution flows through {DD021}'s resolver. The sweep MUST NOT reinvent resolution rules. Realized by §3: the aggregator reads `ClaimCrossReference.resolverOutcome` populated by `ClaimIndex.build()` for note citations, and routes source-code citations through `resolveReference()` directly via a new helper.

### MEDIUM BINDING

- **{R016.§1.AC.01–.02}** — Sweep modes (`--all` and `--all --code`). The sweep's overall shape (range the per-note resolver over every note; opt into source-code scan) is medium-binding: it constrains the module decomposition but does not constrain the resolver or taxonomy.

- **{R016.§2.AC.01, .AC.03, .AC.04}** — `--target` filter mechanics. Parsing the target list, distinguishing note-level from claim-level targets, combining with `--code` / `--codes` / `--refs-only`. Realized by a `TargetFilter` predicate at the aggregator layer.

- **{R016.§5.AC.01, .AC.02, .AC.03, .AC.04}** — Output format. Human-readable grouping by target ID under each code; JSON `incidences` array with `scanned` counts. Realized by two formatters (human + JSON) consuming the same aggregated `IncidenceRecord[]`.

- **{R016.§3.AC.01, .AC.02, .AC.03}** — `--refs-only` and `--codes` filters. Applied at the aggregator layer; mostly independent of the resolver and source-scan integration.

### LOW BINDING

- **{R016.§1.AC.03}** — Per-note form behavior unchanged. This is a constraint, not an addition — the DD's job is to verify that the new code paths route around the existing per-note path and do not silently widen its scope.

- **{R016.§4.AC.01–.04}** — Default lifecycle-state behavior and opt-outs. Two opt-out flags suppress two distinct synthesized codes. The mechanics are additive layers on top of the resolver's existing archive-aware behavior ({DD021.§10.DC.05}, {DD021.§10.DC.06}).

- **{R016.§6.AC.02}** — Distinct from `claims dependents`. This is a documentation/scoping claim, not a system assertion — the DD honors it by documenting in §3 why `dependents-command.ts` (already existing per {DD021.§3}) and the new aggregator are separate consumers.

### Modal status distribution

R016's claims are dominated by Behavior (what the sweep emits for each input combination) and Integration (how the sweep wires to {DD021}'s resolver and the source-scanner). There are two Constraint claims ({R016.§1.AC.03} per-note form unchanged; {R016.§4.AC.05} tombstones preserved) and one Invariant ({R016.§6.AC.01} resolution through {DD021}). No Existence claims at the audit-surface layer; the modules being added are CLI plumbing, not user-visible new abstractions.

## §3 Module Inventory

Work is concentrated in `core/src/cli/commands/claims/lint-command.ts` (extended) plus three new modules under `core/src/claims/audit/` for the aggregator, source-code scan integration, and finding formatters. No changes to the resolver itself.

### File: `core/src/cli/commands/claims/lint-command.ts` (MODIFIED)

The existing `lintCommand` is extended with new flags and a branch on `--all`. The per-note path is preserved verbatim; the new path delegates to the aggregator.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R016.§1.AC.01} | `lintCommand` gains `.option('--all', '...')` | Activates project-wide sweep when present |
| {R016.§1.AC.02} | `lintCommand` gains `.option('--code', '...')` | Activates source-code scan; requires `--all` per OQ.02 (or per-note form for the narrow scoped case) |
| {R016.§2.AC.01} | `lintCommand` gains `.option('--target <ids>', '...')` | Comma-separated list parsing; per-note form rejects with explicit error per OQ.02 |
| {R016.§3.AC.01} | `lintCommand` gains `.option('--refs-only', '...')` | Suppresses non-reference findings |
| {R016.§3.AC.02} | `lintCommand` gains `.option('--codes <codes>', '...')` | Comma-separated; unknown codes error out per AC.02 |
| {R016.§4.AC.03} | `lintCommand` gains `.option('--include-archived-as-valid', '...')` | Suppresses `reference-to-archived` findings |
| {R016.§4.AC.04} | `lintCommand` gains `.option('--include-soft-deleted-as-valid', '...')` | Suppresses `reference-to-soft-deleted` findings per OQ.03 |
| {R016.§5.AC.02} | `lintCommand` gains `.option('--json', '...')` | NOTE: the existing per-note form already has `--json` (line 28). The new code path routes to the aggregator's JSON formatter; the existing per-note JSON output remains unchanged |
| {R016.§1.AC.01–.03} | New branch: `if (options.all) { ... } else { /* existing per-note path */ }` | Branches on `--all` flag presence |
| {R016.§1.AC.03} | Per-note form rejects `--target` with an explicit error | `lintCommand.action()` validates flag combinations before dispatch |

The action handler factors into two code paths:

```typescript
.action(async (noteId: string | undefined, options) => {
  if (options.all) {
    // New project-wide path (delegates to runProjectWideAudit)
    return runProjectWideAudit(options);
  }
  if (options.target) {
    throw new Error('--target requires --all (project-wide reverse lookup is incoherent on a per-note scope)');
  }
  // Existing per-note path — unchanged except for accepting --code, --codes, --refs-only
  // ... existing body ...
});
```

Note: Commander's `.argument('<noteId>', ...)` (line 26) must be relaxed to `.argument('[noteId]', ...)` so that `--all` may be invoked without a positional argument. The action handler validates that exactly one of `noteId` or `--all` is supplied.

### File: `core/src/claims/audit/run-audit.ts` (NEW)

The orchestrator for the project-wide sweep. Reads the claim index (which already contains every note's resolved citations via {DD021}'s `ClaimCrossReference.resolverOutcome`), optionally adds source-code citations under `--code`, applies filters, and dispatches to a formatter.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R016.§1.AC.01} | `runProjectWideAudit(options): Promise<void>` | Top-level entry; orchestrates index load → source-scan → aggregate → filter → format |
| {R016.§5.AC.02} | `interface AuditScanned { notes: number; sourceFiles: number; references: number }` | Counts surfaced in both human and JSON output |
| {R016.§5.AC.04} | Human formatter surfaces `scanned` counts | Header or footer; specification-layer per AC.04 |
| {R016.§6.AC.01} | Resolution outcomes read from `ClaimCrossReference.resolverOutcome` | No new resolution calls for note citations |

Sketch:

```typescript
export interface AuditOptions {
  code: boolean;
  target?: string[];        // raw target tokens (note IDs or claim FQIDs)
  codes?: string[];         // error-code filter
  refsOnly: boolean;
  includeArchivedAsValid: boolean;
  includeSoftDeletedAsValid: boolean;
  json: boolean;
}

export interface AuditScanned {
  notes: number;
  sourceFiles: number;
  references: number;
}

export async function runProjectWideAudit(
  projectManager: ProjectManager,
  options: AuditOptions,
): Promise<void>;
```

### File: `core/src/claims/audit/incidence-collector.ts` (NEW)

Walks the claim index's note-citation edges, the per-note structural error list, and (when `--code` is active) the source-scanner's `SourceReference[]`, producing a uniform `IncidenceRecord[]`. This is the module that unifies note-site and source-file-site findings into one shape.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R016.§5.AC.02} | `type IncidenceRecord` discriminated union | Two variants: `note-site` and `source-site` |
| {R016.§1.AC.01} | `collectNoteIncidences(data: ClaimIndexData): IncidenceRecord[]` | Walks `crossRefs` filtering on `resolverOutcome.kind === 'unresolved'` plus structural errors |
| {R016.§1.AC.02} | `collectSourceIncidences(refs: SourceReference[], data: ClaimIndexData): IncidenceRecord[]` | Resolves each source ref through `resolveReference()`; emits `unresolved` outcomes |
| {R016.§4.AC.01, .AC.02} | Synthesizes `reference-to-archived` and `reference-to-soft-deleted` from resolved-but-lifecycle-flagged edges | Mirrors the (c) consumer-synthesis pattern in `lint-command.ts:collectInlineRefArchiveSynthesis` |
| {R016.§4.AC.05} | Tombstoned tokens (`_deleted_<ID>_at_<TS>`) MUST be silently dropped | Per {R015.§5.AC.01} and {DD020.§5.DC.01}; check via `isDeletionMarker` before emitting |
| {R016.§2.AC.04} | Cross-project citations excluded from this aggregator | Per R016 Edge Cases; {R011.§3.AC.04} preserved |

Type sketch:

```typescript
export type IncidenceCode =
  | ResolverFailureCode               // from reference-resolver.ts
  | 'reference-to-soft-deleted';      // NEW per OQ.03

export type IncidenceSite =
  | {
      kind: 'note-site';
      noteId: string;                 // citing note's ID
      claimId?: string;               // citing claim FQID (undefined for prose-level citation)
      section?: string;               // section path of the citing claim
      line: number;
      sourceSnippet: string;          // excerpt around the citation
      filePath: string;               // absolute path of the citing note's file (folder-form companion file when applicable)
    }
  | {
      kind: 'source-site';
      filePath: string;               // absolute path of the source file
      relativePath: string;           // relative to project root (for display + JSON stability)
      line: number;
      annotationType: SourceReferenceType; // @implements, @validates, @see, depends-on, addresses, blocked-by, mentions
      sourceSnippet: string;          // excerpt around the annotation
    };

export interface IncidenceRecord {
  code: IncidenceCode;
  /** The raw target token cited (e.g., 'R042', 'R042.§1.AC.03', 'vendor-lib/R005.§1.AC.01'). */
  targetRaw: string;
  /** The note ID portion of the target (after stripping alias prefix), for grouping. May be undefined for malformed targets. */
  targetNoteId?: string;
  /** Resolution detail from the resolver — e.g., the canonical FQID for archived/soft-deleted resolutions, candidate list for ambiguous. */
  resolverDetail?: string;
  site: IncidenceSite;
  /** Whether the resolver returned `entry.archived === true` or `entry.softDeleted === true` (when those signals exist). */
  lifecycleFlag?: 'archived' | 'soft-deleted';
}
```

The `note-site` and `source-site` discriminator on `IncidenceSite` is what {R016.§5.AC.03} pins as a stable JSON contract.

### File: `core/src/claims/audit/audit-filters.ts` (NEW)

Pure predicates that filter `IncidenceRecord[]` per the active flag combinations. Each filter is a function from `(records, options) => records` so they compose with map/filter chains; the order applied is fixed (refs-only, then codes, then target, then lifecycle opt-outs) so the conjunction semantics per {R016.§2.AC.04} are deterministic.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R016.§3.AC.01} | `applyRefsOnlyFilter(records): IncidenceRecord[]` | Drops records whose `code` is NOT in the reference-family set defined by {R004.§4.AC.07} + soft-deleted |
| {R016.§3.AC.02} | `applyCodesFilter(records, codes): IncidenceRecord[]` | Drops records whose `code` is not in the supplied list; throws on unknown codes per AC.02 |
| {R016.§2.AC.01, .AC.03} | `applyTargetFilter(records, targets): IncidenceRecord[]` | Note-level target matches every record with that `targetNoteId`; claim-level target matches only records whose `targetRaw` (normalized) equals the claim FQID |
| {R016.§4.AC.03} | `applyArchivedOptOut(records): IncidenceRecord[]` | Drops records with `code: 'reference-to-archived'` when `--include-archived-as-valid` is set |
| {R016.§4.AC.04} | `applySoftDeletedOptOut(records): IncidenceRecord[]` | Drops records with `code: 'reference-to-soft-deleted'` when `--include-soft-deleted-as-valid` is set |
| {R016.§2.AC.02} | `applyTargetFilter` does NOT validate target existence | Textual matching only; load-bearing per the cleanup workflow |

The `REFERENCE_FAMILY_CODES` set (consumed by `applyRefsOnlyFilter`) is the canonical list defined by {R004.§4.AC.07} plus the new `reference-to-soft-deleted` code. The set is exported as a const so the codes filter can validate input against it.

```typescript
export const REFERENCE_FAMILY_CODES = new Set<IncidenceCode>([
  'reference-to-unknown-note',
  'reference-to-undefined-claim',
  'reference-to-archived',
  'reference-to-soft-deleted',    // NEW per OQ.03
  'malformed-claim-reference',
  'derivation-target-bare-note-id',
  'derivation-target-cross-project',
  'derivation-target-removed',
  'derivation-target-superseded',
  'derivation-target-ambiguous',
]);
```

### File: `core/src/claims/audit/audit-formatters.ts` (NEW)

Two formatters: human-readable (groups by target under each code, per {R016.§5.AC.01}) and JSON (flat `incidences` array plus `scanned` block, per {R016.§5.AC.02}).

| Requirement | Type/Function | Notes |
|---|---|---|
| {R016.§5.AC.01} | `formatAuditHuman(records, scanned): string` | Groups by error code; under each code, groups by `targetNoteId`; lists sites per target |
| {R016.§5.AC.02} | `formatAuditJson(records, scanned): string` | Flat `incidences: IncidenceRecord[]`; `scanned: AuditScanned` |
| {R016.§5.AC.03} | The `IncidenceRecord` shape IS the stable JSON contract | TypeScript types compile to the JSON shape; field renames are breaking changes |
| {R016.§5.AC.04} | Human formatter renders `scanned` counts (header or footer) | Provisionally: footer block after all findings |

### File: `core/src/claims/reference-resolver.ts` (NOT MODIFIED)

The resolver itself is unchanged. The new aggregator reads `ClaimCrossReference.resolverOutcome` already populated by `ClaimIndex.build()` (per {DD021.§10.DC.08}) and calls `resolveReference()` only for source-code citations that the existing `ClaimIndex.addSourceReferences()` does not currently route through the resolver. See §6 for the source-scan integration detail.

### File: `core/src/claims/claim-index.ts` (NOT MODIFIED for the audit surface itself)

The existing `addSourceReferences()` method (line 886) currently DROPS source references whose `claimPath` does not resolve to an entry — `if (!targetEntry) continue;` at line 899 silently discards them. For the per-note lint, this is not a regression (lint never scanned source code). For `--all --code`, the audit needs to surface these failures. Rather than modifying `addSourceReferences()` (which would change behavior for trace and gaps as a side effect), the new `collectSourceIncidences()` runs an INDEPENDENT pass over the source-scanner's `getAllReferences()` and routes each through `resolveReference()`, collecting the `unresolved` and `ambiguous` outcomes. This isolation preserves the trace/gaps contract.

### File: `core/src/scanners/source-code-scanner.ts` (NOT MODIFIED)

The existing scanner already discovers every source file matching the project's configured folders + extensions, parses comments for note mentions, and exposes `getAllReferences(): SourceReference[]` on the index. The audit consumes this surface as-is. The scanner is initialized by the existing `ProjectManager` startup path (`project-manager.ts:241-253`); the audit assumes `projectManager.sourceScanner?.isReady() === true` when `--code` is supplied. If the scanner is disabled in config (`sourceCodeIntegration.enabled === false`), `--code` MUST error with a clear message; the DD does not require enabling it implicitly.

### File: `core/src/claims/index.ts` (MODIFIED)

Re-exports for the new audit module (so consumers can import from `@scepter` or the project's barrel). Additive only.

```typescript
export {
  runProjectWideAudit,
  type AuditOptions,
  type AuditScanned,
  type IncidenceRecord,
  type IncidenceCode,
  type IncidenceSite,
  REFERENCE_FAMILY_CODES,
} from './audit/run-audit.js';
```

### File: `core/src/claims/audit/__tests__/incidence-collector.test.ts` (NEW)

Unit tests for `collectNoteIncidences` and `collectSourceIncidences`. The minimal regression-test inventory covers: (a) note citation with `unresolved` resolverOutcome surfaces; (b) source citation with `unresolved` resolveReference outcome surfaces; (c) tombstoned token in either site is silently dropped; (d) cross-project citation is excluded; (e) resolved-but-archived citation produces `reference-to-archived` synthesis; (f) resolved-but-soft-deleted citation produces `reference-to-soft-deleted` synthesis.

### File: `core/src/claims/audit/__tests__/audit-filters.test.ts` (NEW)

Unit tests for the filter predicates. Covers: (a) `--target R042` matches every `targetNoteId === 'R042'` record regardless of claim suffix; (b) `--target R042.§1.AC.03` matches only `targetRaw === 'R042.§1.AC.03'`; (c) `--target` accepts non-existing IDs (per {R016.§2.AC.02}); (d) `--refs-only --codes sequence-gap` produces zero output per {R016.§3.AC.03}; (e) opt-out flags suppress the corresponding synthesized codes; (f) filter conjunction order is deterministic.

### File: `core/src/cli/commands/claims/__tests__/lint-audit.test.ts` (NEW)

Integration tests for the full `scepter lint --all` CLI path. Covers: (a) empty-project zero-finding success exit per R016 Edge Cases; (b) `--target` matching zero citations per Edge Cases; (c) JSON output shape stability; (d) per-note + `--target` rejection per OQ.02; (e) `--code` without scanner enabled produces a clear error.

## §4 Wiring Map

### Import graph

```
lint-command.ts
  ├── (existing) ensure-index.ts        → ClaimIndexData
  ├── (existing) validateLifecycleTags  [internal]
  ├── (existing) validateDerivationLinks [internal]
  ├── (existing) collectInlineRefArchiveSynthesis [internal]
  ├── (existing) validateAliasReferences [internal]
  ├── (existing) collectTombstonedTargetAudit [internal]
  └── (NEW) audit/run-audit.ts
            ├── audit/incidence-collector.ts
            │     ├── claims/reference-resolver.ts (existing — resolveReference)
            │     ├── lifecycle/deletion-marker.ts (existing — isDeletionMarker)
            │     └── scanners/source-code-scanner.ts (existing — getAllReferences)
            ├── audit/audit-filters.ts
            └── audit/audit-formatters.ts
```

### Call chain — project-wide audit

```
CLI invocation: scepter lint --all [--code] [--target R042] [...]
  → lintCommand.action(undefined, options)
    → runProjectWideAudit(projectManager, options)
      → ensureIndex(projectManager)                          (existing helper)
        → returns ClaimIndexData with crossRefs populated
          (each crossRef carries resolverOutcome per DD021.§10.DC.08)
      → collectNoteIncidences(data)
        → walks data.crossRefs for unresolved outcomes
        → walks data.errors for structural findings
        → synthesizes reference-to-archived from resolved+archived edges
        → synthesizes reference-to-soft-deleted from resolved+soft-deleted edges
        → drops tombstoned tokens via isDeletionMarker
        → returns IncidenceRecord[]
      → if (options.code):
          collectSourceIncidences(projectManager.sourceScanner, data)
            → scanner.getIndex().getAllReferences() returns SourceReference[]
            → for each ref, build a ClaimAddress and call resolveReference(addr, data, opts)
            → emit IncidenceRecord for unresolved/ambiguous outcomes
            → synthesize archived/soft-deleted for resolved+lifecycle-flagged
            → returns IncidenceRecord[]
        → concatenate with note incidences
      → applyRefsOnlyFilter (if --refs-only)
      → applyCodesFilter (if --codes)
      → applyTargetFilter (if --target)
      → applyArchivedOptOut (if --include-archived-as-valid)
      → applySoftDeletedOptOut (if --include-soft-deleted-as-valid)
      → buildScanned({ notes, sourceFiles, references })
      → if (options.json):
          console.log(formatAuditJson(filteredRecords, scanned))
        else:
          console.log(formatAuditHuman(filteredRecords, scanned))
```

### Call chain — per-note audit (UNCHANGED)

```
CLI invocation: scepter lint <noteId> [--code] [--codes ...] [--refs-only]
  → lintCommand.action(noteId, options)
    → if (options.target) throw "—target requires --all"
    → existing path:
        → noteManager.getAggregatedContents(noteId)
        → buildClaimTree(content) → validateClaimTree → treeErrors
        → ensureIndex → indexData
        → indexData.errors filtered by noteId → indexErrors
        → validateLifecycleTags → lifecycleErrors
        → validateDerivationLinks → derivationErrors
        → collectInlineRefArchiveSynthesis → inlineArchiveErrors
        → validateAliasReferences → aliasReferenceErrors
        → collectTombstonedTargetAudit (if --include-tombstoned-derives)
        → merge + dedup → allErrors
    → (NEW filter layer for per-note form):
        if (options.refsOnly) drop non-reference codes from allErrors
        if (options.codes) drop codes not in the supplied list
    → if (options.code):
        scanner.getReferencesToNote(noteId) → SourceReference[]
        for each ref: route through resolveReference and emit findings
        merge into allErrors via the IncidenceRecord-to-ClaimTreeError shim
    → formatLintResults(allErrors) → console output
```

The per-note path's NEW behavior is additive (the `--refs-only` and `--codes` filters apply to the existing `allErrors` list; the optional `--code` source-scan adds source-site findings to the same list). The existing per-note JSON output shape is unchanged unless `--code` is set, in which case the JSON gains a `sourceIncidences` field.

### Data flow

```
Markdown notes  ────►  noteManager.getNotes({ includeArchived: true })
                              │
                              ▼
                       ClaimIndex.build(notesWithContent)
                              │
                              ▼
                       ClaimIndexData
                       ├── entries:      Map<fqid, ClaimIndexEntry>
                       ├── crossRefs:    ClaimCrossReference[]
                       │     (each carries resolverOutcome per DD021)
                       ├── crossProjectRefs: ClaimCrossProjectReference[]
                       └── errors:       ClaimTreeError[]
                              │
                              ▼
                       collectNoteIncidences(data)
                              │
                              ▼ IncidenceRecord[]
                              │
                              ├── (if --code)
                              │     scanner.getAllReferences()
                              │            │
                              │            ▼
                              │     collectSourceIncidences(refs, data)
                              │            │
                              │            ▼ IncidenceRecord[]
                              │            │
                              └──── concat ─┘
                              │
                              ▼
                       apply filters in fixed order
                              │
                              ▼ filtered IncidenceRecord[]
                              │
                              ├── formatAuditHuman → stdout
                              └── formatAuditJson  → stdout
```

## §5 Data and Interaction Flow

### Flow 1: Author runs `scepter lint --all --target R042 --refs-only --json`

The canonical cleanup workflow: "I just deleted R042; what still cites it?"

1. CLI parses flags. `noteId` is undefined; `options.all === true`, `options.target === ['R042']`, `options.refsOnly === true`, `options.json === true`. The `--target` validation passes (no per-note + `--target` conflict).
2. `lintCommand.action` dispatches to `runProjectWideAudit(projectManager, options)`.
3. `ensureIndex` returns the cached `ClaimIndexData`. Every `ClaimCrossReference` carries a `resolverOutcome`. Citations to R042 (which the author just hard-deleted, but not via the {R015} rewriter) appear as `unresolved` outcomes with code `reference-to-unknown-note` because R042 is absent from the index.
4. `collectNoteIncidences(data)` walks `data.crossRefs`. For every `ref.resolverOutcome?.kind === 'unresolved'`, it emits an `IncidenceRecord` with `code: ref.resolverOutcome.code`, `targetRaw: ref.toClaim`, `targetNoteId: <parsed from toClaim>`, and a `note-site` site.
5. `options.code` is false; the source-scan branch is skipped.
6. Filters applied in order:
   - `applyRefsOnlyFilter`: keeps records whose code is in `REFERENCE_FAMILY_CODES`. Non-reference findings (sequence gaps, malformed-claim-ID structural errors that are NOT reference-resolution failures) are dropped.
   - `applyCodesFilter`: not active.
   - `applyTargetFilter`: keeps records whose `targetNoteId === 'R042'`. The filter operates on the parsed target token, NOT on an index lookup; the fact that R042 is absent from the index is irrelevant.
   - `applyArchivedOptOut` and `applySoftDeletedOptOut`: not active.
7. `buildScanned`: counts notes scanned (every note in the index), source files scanned (0 because `--code` was not set), references encountered (sum of all `crossRefs` plus structural errors).
8. `formatAuditJson(records, scanned)` emits:
   ```json
   {
     "scanned": { "notes": 247, "sourceFiles": 0, "references": 8412 },
     "incidences": [
       {
         "code": "reference-to-unknown-note",
         "targetRaw": "R042.§1.AC.03",
         "targetNoteId": "R042",
         "site": { "kind": "note-site", "noteId": "DD007", "claimId": "DD007.§3.DC.05", "section": "3", "line": 142, "sourceSnippet": "...", "filePath": "..." }
       },
       ...
     ]
   }
   ```
9. The author pipes this into `jq` to extract `site.filePath` values and feed them to an editor.

### Flow 2: Author runs `scepter lint --all --code` (full project sweep)

1. CLI dispatches to `runProjectWideAudit(projectManager, { code: true, ... })`.
2. `ensureIndex` populates `ClaimIndexData`.
3. `collectNoteIncidences(data)` produces note-site incidences as in Flow 1.
4. `collectSourceIncidences(scanner, data)` runs:
   - `scanner.getIndex().getAllReferences()` returns every `SourceReference` the scanner has parsed (all `.ts`, `.tsx`, `.js`, `.jsx`, `.css` files under `core/src`, `vscode/src`, `vscode/media`).
   - For each `SourceReference`, parse `ref.toId` + `ref.claimPath` into a `ClaimAddress` and call `resolveReference(addr, data, { includeArchived: true })`. The `includeArchived: true` matches the (c) consumer-synthesis pattern from {DD021.§10.DC.06}.
   - For `unresolved` outcomes, emit an `IncidenceRecord` with `code: outcome.code`, `targetRaw: ref.toId + (ref.claimPath ?? '')`, and a `source-site` site populated from `ref.filePath`, `ref.line`, `ref.referenceType`, and `ref.context`.
   - For `resolved` outcomes with `entry.archived === true`, synthesize `reference-to-archived`.
   - For `resolved` outcomes with `entry.softDeleted === true` (if/when this signal exists; see §8 Frontier), synthesize `reference-to-soft-deleted`.
   - Tombstoned tokens (`ref.toId` matches `_deleted_<ID>_at_<TS>`) are dropped silently via `isDeletionMarker`.
   - Cross-project annotations (`@implements {vendor-lib/R005.§1.AC.01}`) are skipped — the `SourceReference.toId` is the raw note-portion text; cross-project annotations parse as `ClaimAddress.aliasPrefix !== undefined`, in which case the collector skips them per {R011.§3.AC.03} and R016 Edge Cases.
5. Note and source incidences are concatenated.
6. Filters applied (none active here, so all records pass).
7. `formatAuditHuman(records, scanned)` groups records first by `code`, then within each code by `targetNoteId`:

   (Illustrative — fictive note IDs Rxxx, Dxxx, etc. stand in for actual project IDs.)

   ```
   reference-to-unknown-note
     Rxxx (cited by 5 sites)
       _scepter/notes/dd/Dxxx ....md:142   — section 3, claim Dxxx (DC-something)
       _scepter/notes/dd/Dyyy ....md:88    — section 1, claim Dyyy (DC-something)
       core/src/cli/commands/foo.ts:34     — @implements
       core/src/cli/commands/bar.ts:12     — @see
       ...

     DEFxxx (cited by 2 sites)
       ...

   reference-to-archived
     Ryyy (cited by 3 sites)
       ...

   --
   Scanned: 247 notes, 1342 source files, 8412 references.
   ```

### Flow 3: `scepter lint R012 --code` (per-note source-code scan)

Per OQ.02, the per-note + `--code` form is accepted as a narrow scoped query.

1. CLI dispatches to the per-note path with `noteId === 'R012'` and `options.code === true`.
2. The per-note path runs the existing per-note checks (tree, lifecycle, derivation, alias, archive-synthesis), producing `allErrors`.
3. The new branch: `scanner.getReferencesToNote('R012')` returns every `SourceReference` whose `toId === 'R012'`. Each is routed through `resolveReference()` and converted to `IncidenceRecord` (source-site).
4. The per-note formatter is reused; the source-site incidences are appended under their respective error codes. In JSON mode, the JSON output gains a `sourceIncidences` field alongside the existing `errors` field.
5. The per-note + `--target` combination would error out earlier (see Flow 4).

### Flow 4: `scepter lint R012 --target R042` (rejected)

1. CLI parses flags. `noteId === 'R012'`, `options.target === ['R042']`, `options.all` is undefined.
2. `lintCommand.action` validates: `options.target && !options.all` → throw `Error("--target requires --all (project-wide reverse lookup is incoherent on a per-note scope)")`.
3. Exit code 1; no further processing.

### Flow 5: `scepter lint --all --target R042 --include-archived-as-valid`

The author has archived R042 deliberately and wants to see what cites it AND treat archived as valid (so `reference-to-archived` is suppressed but `reference-to-unknown-note` is not).

1. As Flow 1, but `--include-archived-as-valid` is set.
2. `applyTargetFilter` keeps records whose `targetNoteId === 'R042'`.
3. `applyArchivedOptOut` drops records with `code === 'reference-to-archived'`. Records with `code === 'reference-to-unknown-note'` (if R042 also has zombie citations from before it was archived) are NOT dropped.
4. Output shows only the non-archived findings; the archived findings are suppressed per the opt-out.

### Flow 6: Zero-finding sweep

1. `scepter lint --all` runs against a clean project.
2. `collectNoteIncidences` returns `[]`. `collectSourceIncidences` is not called (no `--code`).
3. Filters pass through the empty array.
4. `formatAuditHuman` (or JSON) emits the `scanned` block with the populated counts and an empty findings body. Exit code 0.

## §6 Integration Sequence

The implementation order prioritizes the data shape (IncidenceRecord) and the aggregator (`collectNoteIncidences`) before the source-scan integration, so that the project-wide note sweep is verifiable before source-code scanning is added.

| Step | Files touched | Verification |
|---|---|---|
| 1. Define `IncidenceRecord`, `IncidenceCode`, `IncidenceSite`, `AuditScanned`, `AuditOptions` types | `audit/run-audit.ts` (types only), `audit/incidence-collector.ts` (types only) | Types compile; no consumers yet |
| 2. Implement `collectNoteIncidences(data): IncidenceRecord[]` reading `data.crossRefs` and `data.errors`, synthesizing `reference-to-archived` from resolved+archived edges | `audit/incidence-collector.ts` | Unit tests: a project with N unresolved citations produces N records with correct site info; tombstoned tokens dropped; cross-project excluded |
| 3. Implement filters: `applyRefsOnlyFilter`, `applyCodesFilter`, `applyTargetFilter`, `applyArchivedOptOut` | `audit/audit-filters.ts` | Unit tests: each filter in isolation; conjunction tests; `--codes sequence-gap --refs-only` produces empty |
| 4. Implement `formatAuditHuman` and `formatAuditJson` | `audit/audit-formatters.ts` | Snapshot tests against fixture incidence sets; JSON shape locked |
| 5. Implement `runProjectWideAudit` orchestrator | `audit/run-audit.ts` | Integration test: full pipeline from `ClaimIndexData` to formatted output for a fixture project |
| 6. Wire CLI: add flags, relax `noteId` to optional, add the `--all` branch | `lint-command.ts` | CLI test: `scepter lint --all` against a fixture produces expected output; per-note form unchanged for fixtures that today produce clean output |
| 7. Implement `collectSourceIncidences(scanner, data): IncidenceRecord[]` | `audit/incidence-collector.ts` | Unit tests: source refs route through resolveReference; unresolved outcomes surface as source-site incidences |
| 8. Wire `--code` into the orchestrator and the per-note path | `audit/run-audit.ts`, `lint-command.ts` | Integration test: `--all --code` finds annotations to deleted notes; per-note `--code` scans source for refs to the named note |
| 9. Implement `--include-soft-deleted-as-valid` and the soft-delete synthesis (paired with the lifecycle-state plumbing in §8 Frontier) | `audit/incidence-collector.ts`, `audit/audit-filters.ts` | Unit tests: soft-deleted citations surface as `reference-to-soft-deleted` by default; opt-out suppresses |
| 10. Update `claims/index.ts` barrel re-exports | `claims/index.ts` | Imports from `@scepter` work for downstream consumers |
| 11. Update agent skill file `claude/skills/scepter/claims.md` documenting the new flags and incidence-record contract | `claude/skills/scepter/claims.md` | Documentation reflects {R016} ACs |

Each step is independently verifiable. Steps 1–6 deliver `--all` without source-code scanning; Step 7–8 add the `--code` integration; Steps 9–10 add the soft-delete distinction and barrel exports. Step 11 closes the documentation projection.

## §7 Resolved Open Questions

These are R016's OQs with the DD's provisional answers. All four are marked PROVISIONAL — the user is expected to ratify or override.

### OQ.01 — Flag names (PROVISIONAL)

**Disposition:** Use the names as written in {R016}: `--all`, `--code`, `--target`, `--codes`, `--refs-only`, `--json`, `--include-archived-as-valid`, `--include-soft-deleted-as-valid`. These are the names the user signed off on in conversation.

**Implementation note:** The names are consistent with existing CLI flag conventions (kebab-case, descriptive, opt-in suffix `-as-valid` for lifecycle treatment). No collisions with existing `lint` flags (`--reindex`, `--json`, `--include-tombstoned-derives`).

### OQ.02 — `--code` and `--target` on the per-note form (PROVISIONAL)

**Disposition:** `--code` is ACCEPTED on the per-note form for the narrow "this note's source citations" use case. `--target` is REJECTED on the per-note form with an explicit error message. `--codes` and `--refs-only` are accepted on the per-note form.

**Rationale:** `scepter lint R012 --code` answers a coherent question ("what source-code annotations target R012?"). `scepter lint R012 --target R042` is incoherent — a per-note lint cannot see cross-note citations of an external target. The clean stance is to allow `--code` but reject `--target` with a clear error pointing to `--all`.

### OQ.03 — Soft-delete vs archive code distinction (PROVISIONAL)

**Disposition:** Use a single new code `reference-to-soft-deleted` distinct from `reference-to-archived`. The two have different lifecycle semantics (un-archive vs restore-from-deleted) and the discrete codes let lint surface the right remediation per failure.

**Implementation note:** The new code is NOT added to the resolver's `ResolverFailureCode` union directly — it is synthesized by the consumer (this DD's `collectNoteIncidences` / `collectSourceIncidences`) the same way `reference-to-archived` is synthesized today by `lint-command.ts:collectInlineRefArchiveSynthesis` (per {DD021.§10.DC.06}). The resolver returns `resolved` with an entry whose lifecycle flag is set; the consumer's synthesis logic produces the discrete code.

**Prerequisite:** The `ClaimIndexEntry.softDeleted: boolean` field MUST exist (mirroring `entry.archived: boolean` from {DD021.§10.DC.17}), populated from the source note's tag set (`note.tags.includes('deleted')`). See §8 Frontier for status; this is a precondition for the soft-delete synthesis path to function.

### OQ.04 — Performance and caching (DEFERRED to Frontier)

**Disposition:** Naive complexity analysis follows; no caching surface is introduced by this DD. See §8 Frontier.

## §8 Frontier and Out-of-Scope Items

The DD scopes the audit surface mechanically and surfaces the following items as Frontier work.

<!-- historical (2026-05-23): this Frontier subsection is preserved verbatim as authoring history. The "Status: ABSENT" line is no longer current — see §12 row `ClaimIndexEntry.softDeleted` for the realized state (PRESENT at `core/src/claims/claim-index.ts:197`, populated at `:476`). DC.07's `:deferred` marker has been lifted; see {DD022.§10.2.DC.07}. -->

### Soft-deleted lifecycle field on `ClaimIndexEntry`

The DD's OQ.03 disposition requires that `ClaimIndexEntry` carry a `softDeleted: boolean` field (parallel to `archived: boolean` from {DD021.§10.DC.17}). Without this field, `collectNoteIncidences` cannot synthesize `reference-to-soft-deleted` for resolved-but-soft-deleted edges; soft-deleted citations would either resolve silently as live (wrong) or fall back to `reference-to-unknown-note` (also wrong).

**Status:** ABSENT in current `ClaimIndexEntry` declaration at `core/src/claims/claim-index.ts:163-184`. The `archived` field exists; no `softDeleted` parallel.

**Disposition:** Realize as a precondition for Step 9 of the integration sequence. The change is additive: extend `ClaimIndexEntry`, populate from `note.tags.includes('deleted')` in `ClaimIndex.build()`, and pass through in `ensureIndex`'s `noteManager.getNotes` call (the existing `includeArchived: true` already loads archived notes; a parallel `includeDeleted` may be needed depending on `note-manager.ts:1318-1320` filter behavior). Either a prerequisite DD or an explicit deferral note covers this work; this DD does not author it inline.

**Suggested approach:** A small prerequisite DD (or a §10 amendment to {DD021}) that mirrors DC.17 for soft-delete. Alternatively, in-scope for this DD's Step 9 if the user prefers to bundle. The DD's preference is the prerequisite path so the soft-delete plumbing is reviewable independently.

### Performance and caching (OQ.04 in R016)

Naive complexity of `--all --code`:

- `--all` walks every note's `crossRefs` once (O(N_refs)) plus every structural error (O(N_errors)). The `ClaimIndex.build()` already produces these in linear time relative to the corpus; the audit is O(N_refs + N_errors) on top.
- `--code` adds O(N_source_refs) for source-scan walking. Each source ref calls `resolveReference()` which is O(log N_entries) for the exact-match probe plus O(N_sections) for section-less candidates — bounded by the entries in the cited note.
- `--target` filtering is O(N_records). With M targets, parsing target tokens is O(M); matching is O(N_records × M) in the worst case (could be optimized to O(N_records) with a hash set, but M is typically small).

The naive worst case is O(notes × refs_per_note + source_files × refs_per_file). For SCEpter's own corpus (~247 notes, ~1342 source files, ~8412 references) this is well under a second on a modern machine.

**Caching surface:** `ensureIndex` already caches `ClaimIndexData` at the module level for a single CLI invocation (`ensure-index.ts:16`). The source-code scanner caches per-file by mtime (`source-code-scanner.ts:43, 138`). No additional caching is introduced by this DD.

**Frontier:** If large-project performance becomes a concern, options include (a) memoizing `resolveReference` outcomes per `(rawTarget, includeArchived)` key during a single audit run, (b) introducing a reverse-index from target-noteId to citing-sites in `ClaimIndexData`, (c) parallelizing source-scan resolution across worker threads. None are required by R016 or this DD; all are deferred work surfaces.

### VS Code surface

The VS Code extension's diagnostics provider currently consumes per-note `lint` output (per {DD015}, {DD021.§3} VS Code diagnostic provider notes). The project-wide audit's findings could be surfaced in a workspace-wide problems view; this is a future projection not addressed by R016 or this DD.

**Frontier:** A future requirement may pull `--all --json` output into the VS Code diagnostics surface as a workspace diagnostic source.

### Concurrency / incremental audit

{R016} non-goals explicitly exclude incremental "what changed since last audit" or watch-mode forms. The DD honors this — no incremental surface.

### Projection coverage

The DD addresses three projections:

- **Source** (implementation code): Steps 1–10 in §6 (all new modules and lint-command modification).
- **Tests**: Steps 2, 3, 5, 6, 8 each ship with unit/integration tests (`audit/__tests__/incidence-collector.test.ts`, `audit/__tests__/audit-filters.test.ts`, `audit-formatters.test.ts`, `lint-audit.test.ts`).
- **CLI**: New flags on `lintCommand`. Existing per-note flags preserved.
- **Documentation**: Step 11 (`claude/skills/scepter/claims.md`).
- **UI**: No UI projection in this DD (no React/VS Code surfaces); see Frontier above.

## §9 Requirements Coverage

| AC | Modules | Notes |
|---|---|---|
| {R016.§1.AC.01} | `lint-command.ts` (--all flag), `audit/run-audit.ts` (runProjectWideAudit), `audit/incidence-collector.ts` (collectNoteIncidences) | The sweep emits non-reference findings (sequence gaps etc.) unless `--refs-only` suppresses |
| {R016.§1.AC.02} | `lint-command.ts` (--code flag), `audit/incidence-collector.ts` (collectSourceIncidences) | Source folders + extensions read from existing config; no new config surface |
| {R016.§1.AC.03} | `lint-command.ts` (per-note path preserved verbatim) | Per-note + `--target` rejected; per-note + `--code` accepted per OQ.02 |
| {R016.§2.AC.01} | `lint-command.ts` (--target flag), `audit/audit-filters.ts` (applyTargetFilter) | Comma-separated parsing; note-level and claim-level matching |
| {R016.§2.AC.02} | `audit/audit-filters.ts` (applyTargetFilter does NOT validate existence) | HIGH-BINDING; load-bearing for cleanup workflow |
| {R016.§2.AC.03} | `audit/audit-filters.ts` (claim-level target filter logic) | Note-level target matches all claim-level citations; claim-level target matches only exact claim |
| {R016.§2.AC.04} | `audit/audit-filters.ts` (fixed filter order) | Conjunction semantics deterministic |
| {R016.§3.AC.01} | `audit/audit-filters.ts` (applyRefsOnlyFilter), `audit/incidence-collector.ts` (REFERENCE_FAMILY_CODES const) | The reference-family set is the canonical {R004.§4.AC.07} list plus `reference-to-soft-deleted` |
| {R016.§3.AC.02} | `audit/audit-filters.ts` (applyCodesFilter) | Unknown codes error out with the recognized-codes list |
| {R016.§3.AC.03} | `audit/audit-filters.ts` (filter composition) | `--refs-only --codes sequence-gap` → empty output |
| {R016.§4.AC.01} | `audit/incidence-collector.ts` (archive synthesis) | Default `reference-to-archived` finding emitted; opt-out per AC.03 |
| {R016.§4.AC.02} | `audit/incidence-collector.ts` (soft-delete synthesis) | New `reference-to-soft-deleted` code per OQ.03; requires `entry.softDeleted` per §8 Frontier |
| {R016.§4.AC.03} | `lint-command.ts` (--include-archived-as-valid), `audit/audit-filters.ts` (applyArchivedOptOut) | |
| {R016.§4.AC.04} | `lint-command.ts` (--include-soft-deleted-as-valid), `audit/audit-filters.ts` (applySoftDeletedOptOut) | |
| {R016.§4.AC.05} | `audit/incidence-collector.ts` (isDeletionMarker check before emit) | Tombstones preserved verbatim per {R015.§5.AC.01} |
| {R016.§5.AC.01} | `audit/audit-formatters.ts` (formatAuditHuman) | Groups by code → target → site |
| {R016.§5.AC.02} | `audit/audit-formatters.ts` (formatAuditJson), `audit/incidence-collector.ts` (IncidenceRecord shape) | JSON `scanned` + `incidences[]` |
| {R016.§5.AC.03} | `audit/incidence-collector.ts` (IncidenceRecord, IncidenceSite types) | TypeScript types ARE the JSON contract |
| {R016.§5.AC.04} | `audit/audit-formatters.ts` (formatAuditHuman includes scanned footer) | Provisional placement: footer block |
| {R016.§6.AC.01} | `audit/incidence-collector.ts` (reads ClaimCrossReference.resolverOutcome + calls resolveReference for source) | Single resolver path per {DD021.§10.DC.01} |
| {R016.§6.AC.02} | DD documentation only; no module change | `dependents-command.ts` from {DD021.§3} is preserved; the audit aggregator is a separate consumer |

Edge cases per R016 §"Edge Cases":

- **Empty project / zero findings**: `formatAuditHuman` and `formatAuditJson` emit the `scanned` block with the populated counts and empty `incidences`; exit 0.
- **Target filter matches zero**: Same as zero findings.
- **Cross-project citations**: `collectSourceIncidences` checks `parseClaimAddress(ref).aliasPrefix` and skips. `collectNoteIncidences` skips entries from `crossProjectRefs` (which is a separate field on `ClaimIndexData`).
- **Tombstoned reference encounter**: `isDeletionMarker` check before emit.
- **Folder-form notes**: The aggregator emits incidences with their actual file path (which is the folder-form companion file when applicable) but groups by the parent note ID. `data.crossRefs` already carries `filePath` per ref (populated by the index builder); the formatter uses that file path verbatim.

## §10 Detailed Design Claims

The DCs in this section are the implementation-binding assertions for the modules in §3. Each derives from an AC in {R016}; the `derives=TARGET` metadata is the load-bearing link.

### §10.1 Audit Orchestrator (`core/src/claims/audit/run-audit.ts`)

DC.01:5:derives=R016.§1.AC.01 The module MUST export a single `runProjectWideAudit(projectManager, options)` function that orchestrates the project-wide sweep. The function MUST: (a) call `ensureIndex(projectManager)` to load the resolved claim index; (b) call `collectNoteIncidences(data)`; (c) if `options.code === true`, call `collectSourceIncidences(scanner, data)` and concatenate; (d) apply filters in fixed order (refs-only, codes, target, archived opt-out, soft-deleted opt-out); (e) compute `AuditScanned` counts; (f) dispatch to `formatAuditHuman` or `formatAuditJson` based on `options.json`; (g) write to stdout. The function MUST NOT reinvent resolution rules or extend the error-code taxonomy beyond `reference-to-soft-deleted` per OQ.03.

DC.02:4:derives=R016.§5.AC.04 The `AuditScanned` interface MUST expose at minimum `notes`, `sourceFiles`, and `references` counts. The `notes` count is the number of notes in `ClaimIndexData.trees`. The `sourceFiles` count is the number of distinct source files scanned (0 when `--code` is not set). The `references` count is the total `crossRefs.length + crossProjectRefs.length + sourceReferences.length` for the scope active in this invocation.

### §10.2 Incidence Collector (`core/src/claims/audit/incidence-collector.ts`)

DC.03:5:derives=R016.§5.AC.02 The module MUST export an `IncidenceRecord` discriminated-union type with a `site: IncidenceSite` field whose variants are `note-site` and `source-site`. The `note-site` variant MUST carry `noteId`, `line`, `sourceSnippet`, and `filePath`; `claimId` and `section` are optional (undefined when the citation is at prose level, not inside a claim definition). The `source-site` variant MUST carry `filePath`, `relativePath`, `line`, `annotationType`, and `sourceSnippet`. The `kind` discriminator MUST be exactly the string `'note-site'` or `'source-site'`; no other values are permitted.

DC.04:5:derives=R016.§5.AC.03 The `IncidenceRecord` TypeScript type MUST be the canonical specification of the JSON serialization shape. Field renames, removals, or additions MUST be treated as breaking changes per {R016.§5.AC.03}'s "stable, scriptable contract" requirement. The JSON serializer MUST emit fields in deterministic order (TypeScript's interface declaration order, lexicographically sorted within an object) so consumers can rely on field ordering for diff and grep.

DC.05:5:derives=R016.§1.AC.01 `collectNoteIncidences(data: ClaimIndexData): IncidenceRecord[]` MUST walk `data.crossRefs` and emit one `IncidenceRecord` per edge whose `resolverOutcome?.kind === 'unresolved'` or `=== 'ambiguous'`. The record's `code` MUST be the `outcome.code` (for unresolved) or a synthesized `derivation-target-ambiguous` (for ambiguous in derives-position) or the umbrella `unresolved-reference` (for ambiguous in inline-ref position; specification-layer TBD which discrete code applies). The record's `site` MUST be a `note-site` with `noteId = ref.fromNoteId`, `claimId = ref.fromClaim`, `line = ref.line`, and `filePath = ref.filePath`. The `sourceSnippet` MUST be extracted from the note's file content at the cited line; the extraction logic mirrors the existing per-note lint snippet extraction. Cross-project references in `data.crossProjectRefs` MUST NOT be included.

DC.06:4:derives=R016.§4.AC.01 `collectNoteIncidences` MUST synthesize `reference-to-archived` incidences for every `ClaimCrossReference` whose `resolverOutcome.kind === 'resolved'` AND `resolverOutcome.entry.archived === true`. This mirrors the existing `collectInlineRefArchiveSynthesis` helper in `lint-command.ts:210` ({DD021.§10.DC.06} consumer-side synthesis pattern). The synthesized incidence's `code` is `'reference-to-archived'`; its `targetRaw` is `ref.toClaim`; its `lifecycleFlag` is `'archived'`.

DC.07:4:derives=R016.§4.AC.02 `collectNoteIncidences` MUST synthesize `reference-to-soft-deleted` incidences for every `ClaimCrossReference` whose `resolverOutcome.kind === 'resolved'` AND `resolverOutcome.entry.softDeleted === true`. The precondition `ClaimIndexEntry.softDeleted: boolean` is realized at `core/src/claims/claim-index.ts:197`, populated from `note.tags.includes('deleted')` in `ClaimIndex.build()`, mirroring the `archived` field plumbing per {DD021.§10.DC.17}.

DC.08:5:derives=R016.§4.AC.05 `collectNoteIncidences` and `collectSourceIncidences` MUST check `isDeletionMarker(token)` (from `core/src/lifecycle/deletion-marker.ts`) against the parsed target-note-ID portion of every citation BEFORE emitting an incidence. If the target is a tombstone marker, NO incidence is emitted. This preserves the {R015.§5.AC.01} contract verbatim. The check applies under EVERY combination of flags — `--target`, `--codes`, `--refs-only`, `--code`, `--all` — without exception.

DC.09:5:derives=R016.§1.AC.02 `collectSourceIncidences(scanner: SourceCodeScanner, data: ClaimIndexData): IncidenceRecord[]` MUST walk `scanner.getIndex().getAllReferences()` and route each `SourceReference` through `resolveReference()` from `core/src/claims/reference-resolver.ts`. The `ResolverOptions.includeArchived` MUST be `true` (matching the (c) consumer-synthesis pattern per {DD021.§10.DC.05}). For each `unresolved` outcome, emit an `IncidenceRecord` with `code = outcome.code` and a `source-site` site populated from `ref.filePath`, `ref.line`, `ref.referenceType`, and `ref.context`. For each `ambiguous` outcome, emit an incidence with the appropriate code (specification-layer per DC.05). For each `resolved` outcome with `entry.archived === true` or `entry.softDeleted === true`, synthesize the corresponding lifecycle-flag code per DC.06/DC.07.

DC.10:4:derives=R016.§1.AC.02 `collectSourceIncidences` MUST exclude cross-project annotations. A `SourceReference` whose parsed `toId` (or `claimPath`) begins with a kebab-case alias prefix (matching `CROSS_PROJECT_TARGET_RE` from `reference-resolver.ts:112`) MUST be skipped per {R011.§3.AC.03} and R016 Edge Cases. The exclusion is verified by parsing `ref.toId` with `parseClaimAddress` and checking `address.aliasPrefix !== undefined`.

### §10.3 Filters (`core/src/claims/audit/audit-filters.ts`)

DC.11:5:derives=R016.§2.AC.01 `applyTargetFilter(records, targets)` MUST accept a `targets: string[]` parameter parsed from the `--target` flag's comma-separated value. Each target token is one of: a note ID (e.g., `R042`), a claim FQID (e.g., `R042.§1.AC.03`), or a normalized variant (e.g., `R042.1.AC.03`). The filter MUST keep a record if its `targetRaw` (normalized — `§` stripped) matches a target token under one of two rules: (a) note-level target `R042` matches every record whose `targetNoteId === 'R042'` regardless of claim suffix; (b) claim-level target `R042.§1.AC.03` matches only records whose normalized `targetRaw === 'R042.1.AC.03'`. The filter MUST NOT validate target existence in the index — per {R016.§2.AC.02}, targets MAY be absent.

DC.12:5:derives=R016.§2.AC.02 `applyTargetFilter` MUST treat unresolvable targets as legal inputs. The filter MUST NOT reject the invocation, warn, or fall back. The textual match against incidence records is the entire semantic — the canonical cleanup workflow ("I just deleted R042; show me what cites it") requires that the deleted target's ID can be supplied even though it no longer resolves.

DC.13:4:derives=R016.§2.AC.03 For a claim-level target `R042.§1.AC.03`, `applyTargetFilter` MUST match a record whose `targetRaw` (normalized) is exactly `R042.1.AC.03`. A record whose `targetRaw === 'R042'` (a bare note-level citation) MUST NOT be matched under this filter. Conversely, for a note-level target `R042`, both `R042` records and `R042.§1.AC.03` records MUST match. The filter's matching is target-shape-aware via parsing `targetRaw` with the same grammar the resolver uses.

DC.14:4:derives=R016.§2.AC.04 The filter pipeline order in `runProjectWideAudit` MUST be (1) `applyRefsOnlyFilter` → (2) `applyCodesFilter` → (3) `applyTargetFilter` → (4) `applyArchivedOptOut` → (5) `applySoftDeletedOptOut`. The order produces the conjunction semantics R016.§2.AC.04 requires: a record passes iff it survives every active filter. The order is fixed (not configurable) so the conjunction is deterministic. Filters not activated by a flag are no-ops (identity function) — they MUST be applied unconditionally in the pipeline to keep the code path uniform.

DC.15:5:derives=R016.§3.AC.01 `applyRefsOnlyFilter(records)` MUST drop records whose `code` is not in the `REFERENCE_FAMILY_CODES` set. The set is exported as a const at module scope, equal to: `{ 'reference-to-unknown-note', 'reference-to-undefined-claim', 'reference-to-archived', 'reference-to-soft-deleted', 'malformed-claim-reference', 'derivation-target-bare-note-id', 'derivation-target-cross-project', 'derivation-target-removed', 'derivation-target-superseded', 'derivation-target-ambiguous' }`. The set is the canonical {R004.§4.AC.07} reference-family plus the new `reference-to-soft-deleted` per OQ.03.

DC.16:4:derives=R016.§3.AC.02 `applyCodesFilter(records, codes)` MUST drop records whose `code` is not in the supplied `codes` array. The function MUST validate every supplied code against the union of `REFERENCE_FAMILY_CODES` and the non-reference codes defined in `ClaimTreeError.type` (at `claim-tree.ts:81`). Unknown codes MUST throw an error whose message enumerates the recognized codes per {R016.§3.AC.02}.

DC.17:3:derives=R016.§4.AC.03 `applyArchivedOptOut(records)` MUST drop records whose `code === 'reference-to-archived'`. The function MUST be a no-op (identity) when `--include-archived-as-valid` is not set.

DC.18:3:derives=R016.§4.AC.04 `applySoftDeletedOptOut(records)` MUST drop records whose `code === 'reference-to-soft-deleted'`. The function MUST be a no-op (identity) when `--include-soft-deleted-as-valid` is not set.

### §10.4 Formatters (`core/src/claims/audit/audit-formatters.ts`)

DC.19:5:derives=R016.§5.AC.01 `formatAuditHuman(records, scanned)` MUST group records first by `code` (alphabetical within `REFERENCE_FAMILY_CODES`), then within each code by `targetNoteId` (alphabetical), then within each target by `site` (sorted by `filePath` then `line` for `note-site`; by `relativePath` then `line` for `source-site`). The output MUST visually distinguish error codes (e.g., heading), targets (e.g., subheading or indent), and sites (line entries). The exact visual treatment is specification-layer per {R016.§5.AC.01}; what is asserted here is the grouping hierarchy.

DC.20:5:derives=R016.§5.AC.02 `formatAuditJson(records, scanned)` MUST emit a JSON document with the top-level shape `{ scanned: AuditScanned, incidences: IncidenceRecord[] }`. The `incidences` array MUST be a flat list (not grouped); consumers do the grouping client-side via `jq` or equivalent. The serialization MUST be `JSON.stringify(document, null, 2)` for human-readable output (pretty-printed); a future `--json-compact` flag is deferred.

DC.21:4:derives=R016.§5.AC.04 `formatAuditHuman` MUST surface the `scanned` counts in a footer block after the findings body. The footer's exact format is specification-layer; the provisional shape is `--\nScanned: N notes, M source files, K references.`. For zero-finding cases (empty `incidences`), the footer is rendered immediately after a "No findings." line so the author sees confirmation that the sweep actually ran.

### §10.5 CLI Surface (`core/src/cli/commands/claims/lint-command.ts`)

DC.22:5:derives=R016.§1.AC.01 `lintCommand` MUST be extended with the following new options without breaking the existing per-note path: `--all`, `--code`, `--target <ids>`, `--codes <code-list>`, `--refs-only`, `--include-archived-as-valid`, `--include-soft-deleted-as-valid`. The existing `--json` flag's behavior is extended for the `--all` branch (routes to `formatAuditJson`) but unchanged for the per-note branch.

DC.23:5:derives=R016.§1.AC.03 The positional `<noteId>` argument MUST be relaxed to `[noteId]` (optional). The action handler MUST validate that exactly one of (a) `noteId` is supplied OR (b) `--all` is supplied, throwing an explicit error otherwise (`"Provide a note ID or --all"`). When both are supplied OR neither is supplied, the command MUST exit with a non-zero status before any index work begins.

DC.24:4:derives=R016.§1.AC.03 The per-note + `--target` combination MUST be rejected. The action handler MUST check `if (options.target && !options.all) throw new Error("--target requires --all (project-wide reverse lookup is incoherent on a per-note scope)")`. The check MUST fire before any other validation so the user sees the specific incompatibility, not a generic flag-required error.

DC.25:4:derives=R016.§1.AC.02 The per-note + `--code` combination MUST be accepted per OQ.02. The per-note action handler MUST call `scanner.getReferencesToNote(noteId)` and route each `SourceReference` through `resolveReference()` exactly as `collectSourceIncidences` does for the project-wide path. The resulting incidences MUST be merged into the per-note `allErrors` array under the IncidenceRecord-to-ClaimTreeError shim (specification-layer; the shim translates an `IncidenceRecord` whose `site.kind === 'source-site'` into a `ClaimTreeError` shape that the existing `formatLintResults` renderer accepts).

DC.26:4:derives=R016.§1.AC.02 When `--code` is supplied but `projectManager.sourceScanner?.isReady() === false` (source-code integration is disabled in `scepter.config.json`), the command MUST exit with a clear error: `"--code requires source-code integration to be enabled in scepter.config.json (sourceCodeIntegration.enabled = true)"`. The command MUST NOT silently degrade to a notes-only sweep.

### §10.6 Barrel Exports (`core/src/claims/index.ts`)

DC.27:3:derives=R016.§1.AC.01 The `core/src/claims/index.ts` barrel MUST re-export `runProjectWideAudit`, `AuditOptions`, `AuditScanned`, `IncidenceRecord`, `IncidenceCode`, `IncidenceSite`, and `REFERENCE_FAMILY_CODES` from `audit/run-audit.ts` (or directly from the sub-files where they are defined). The exports are additive; no existing exports are removed or renamed.

## §11 Acceptance Criteria Summary

| Section | DC count | Derives From |
|---------|----------|--------------|
| §10.1 Audit Orchestrator | 2 (DC.01–02) | {R016.§1.AC.01}, {R016.§5.AC.04} |
| §10.2 Incidence Collector | 8 (DC.03–10) | {R016.§5.AC.02–.AC.03}, {R016.§1.AC.01–.02}, {R016.§4.AC.01–.02}, {R016.§4.AC.05} |
| §10.3 Filters | 8 (DC.11–18) | {R016.§2.AC.01–.AC.04}, {R016.§3.AC.01–.AC.02}, {R016.§4.AC.03–.AC.04} |
| §10.4 Formatters | 3 (DC.19–21) | {R016.§5.AC.01–.AC.02}, {R016.§5.AC.04} |
| §10.5 CLI Surface | 5 (DC.22–26) | {R016.§1.AC.01–.AC.03} |
| §10.6 Barrel Exports | 1 (DC.27) | {R016.§1.AC.01} |
| **Total DCs** | **27** | |

## §12 Primitive Preconditions

| Primitive | Source Citation | Status |
|-----------|----------------|--------|
| `lintCommand` (Commander command) | `core/src/cli/commands/claims/lint-command.ts:24` | PRESENT |
| `ensureIndex` | `core/src/cli/commands/claims/ensure-index.ts:39` | PRESENT |
| `ClaimIndexData` interface | `core/src/claims/claim-index.ts:235` | PRESENT |
| `ClaimCrossReference.resolverOutcome` field | `core/src/claims/claim-index.ts:211` | PRESENT (per {DD021.§10.DC.08}) |
| `ClaimIndexEntry.archived` field | `core/src/claims/claim-index.ts:181` | PRESENT (per {DD021.§10.DC.17}) |
| `ClaimIndexEntry.softDeleted` field | `core/src/claims/claim-index.ts:197` | PRESENT (populated from `note.tags.includes('deleted')` at `claim-index.ts:476`) |
| `resolveReference` function | `core/src/claims/reference-resolver.ts:152` | PRESENT (per {DD021.§10.DC.01}) |
| `ResolverFailureCode` union | `core/src/claims/reference-resolver.ts:31` | PRESENT (per {DD021.§10.DC.02}) |
| `ResolverOutcome` union | `core/src/claims/reference-resolver.ts:72` | PRESENT (per {DD021.§10.DC.01}) |
| `SourceCodeScanner` class | `core/src/scanners/source-code-scanner.ts:39` | PRESENT |
| `SourceCodeScanner.getIndex().getAllReferences()` | `core/src/references/source-reference-index.ts:208` | PRESENT |
| `SourceReference` interface | `core/src/types/reference.ts:22` | PRESENT |
| `isDeletionMarker` function | `core/src/lifecycle/deletion-marker.ts` | PRESENT (per {DD020} per CLAUDE-loaded context) |
| `collectInlineRefArchiveSynthesis` helper | `core/src/cli/commands/claims/lint-command.ts:210` | PRESENT (the synthesis pattern this DD generalizes) |
| `CROSS_PROJECT_TARGET_RE` regex | `core/src/claims/reference-resolver.ts:112` | PRESENT |
| `parseClaimAddress` function | `core/src/parsers/claim/claim-parser.ts` | PRESENT (used throughout) |
| `formatLintResults` formatter | `core/src/cli/formatters/claim-formatter.ts:837` | PRESENT (reused for per-note `--code` shim) |
| `noteManager.getNotes({ includeArchived: true })` | `core/src/notes/note-manager.ts:1310` | PRESENT (used by `ensureIndex` per {DD021.§10.DC.16}) |

## §13 Testing Strategy

| Test Level | Scope | Requirements Covered |
|-----------|-------|---------------------|
| Unit | `collectNoteIncidences`, `collectSourceIncidences` | {R016.§1.AC.01–.AC.02}, {R016.§4.AC.01–.AC.02}, {R016.§4.AC.05}, {R016.§5.AC.02}, {R016.§6.AC.01} |
| Unit | Filter predicates (5 functions) | {R016.§2.AC.01–.AC.04}, {R016.§3.AC.01–.AC.03}, {R016.§4.AC.03–.AC.04} |
| Unit | Formatters (human + JSON) | {R016.§5.AC.01–.AC.04} |
| Integration | `scepter lint --all` against a fixture project | {R016.§1.AC.01}, {R016.§5.AC.01–.AC.04} |
| Integration | `scepter lint --all --code` against a fixture with @implements/@validates | {R016.§1.AC.02}, {R016.§6.AC.01} |
| Integration | `scepter lint --all --target R042 --refs-only --json` end-to-end | {R016.§2.AC.01–.AC.04}, {R016.§3.AC.01}, {R016.§5.AC.02} |
| Integration | Per-note + `--target` rejection | {R016.§1.AC.03} (via DC.24) |
| Integration | Per-note + `--code` acceptance | {R016.§1.AC.02} (via DC.25) |
| Integration | Tombstone preservation under every flag combination | {R016.§4.AC.05} |
| Integration | Empty project / zero-finding success | R016 Edge Cases |
| Integration | `--code` with scanner disabled → clear error | DC.26 |
| Property | Conjunction-order determinism (DC.14) | {R016.§2.AC.04} |

## §14 Non-Goals

- **A new `scepter refs check` command or `scepter dependents` split.** R016 non-goal preserved. The audit lives under `scepter lint --all`.
- **Auto-rewrite of dangling references.** R016 non-goal preserved. The audit is read-only; rewriting belongs to {R015}.
- **Extending `scepter claims gaps` to cover dangling references.** R016 non-goal preserved. Gap detection is for projection coverage of existing claims; the audit is for citations to absent or lifecycle-flagged entities.
- **A new error-code taxonomy.** The DD adds exactly one new code (`reference-to-soft-deleted` per OQ.03), synthesized by the consumer following the existing `reference-to-archived` pattern from {DD021.§10.DC.06}. No expansion of the `ResolverFailureCode` union.
- **New resolution semantics.** Per {R016.§6.AC.01}, resolution flows through {DD021}'s resolver. The DD adds a consumer, not a resolver branch.
- **Performance optimization / caching.** OQ.04 deferred to Frontier (§8). The naive complexity is acceptable for SCEpter's scale; large-project optimization is future work.
- **VS Code surface for project-wide findings.** Out of scope; Frontier item (§8).
- **Concurrency or incremental audit.** R016 non-goal preserved.
- **Test plan as a separate artifact.** Test scaffolding is enumerated in §13; the formal test plan is downstream work (a `TestPlan` note type).

## References

- {R016} — Project-Wide Reference Audit via `scepter lint` (the requirement this DD realizes)
- {R004.§4.AC.07} — Error-code taxonomy (consumed verbatim; not extended)
- {R004.§4.AC.08} — Lint/trace shared resolver invariant (the audit honors this via {DD021}'s `resolveReference`)
- {R004.§4.AC.09} — Section-less resolution rule (consumed via resolver)
- {R006.§5.AC.05} — `claims dependents` command (adjacent surface; not subsumed; see {R016.§6.AC.02})
- {R008} — Folder note claim aggregation (folder-form notes treated as single logical unit per {S002.§9})
- {R011} — Cross-project references (alias-prefixed citations excluded from audit per §10.DC.10)
- {R015.§1.AC.04a-c} — Archive lifecycle (the resolver-archive contract this audit consumes)
- {R015.§2.AC.01} — Tombstone marker format (preserved verbatim per §10.DC.08)
- {R015.§5.AC.01} — Tombstone consumer behavior (preserved verbatim per §10.DC.08)
- {R015.§9.AC.07} — `--include-tombstoned-derives` flag (existing per-note audit category, independent of this DD)
- {S002.§3} — Cross-tab specification for trace/gaps consumer behavior (the broader spec the resolver and consumers honor)
- {S002.§9} — Folder-note aggregation contract (consumed for folder-form file-path handling)
- {DD020.§5.DC.01} — Tombstone recognition contract
- {DD020.§5.DC.02} — Tombstoned-target audit category (related but distinct CLI surface)
- {DD021} — Unified Reference Resolver (the foundational design; this DD is a downstream consumer per {R016.§6.AC.01})
- {DD021.§10.DC.01} — `resolveReference` entry point (consumed by this DD's `collectSourceIncidences`)
- {DD021.§10.DC.05} — `includeArchived` flag semantics (consumed by §10.DC.09)
- {DD021.§10.DC.06} — Consumer-side synthesis pattern for `reference-to-archived` (the template this DD's soft-delete synthesis follows)
- {DD021.§10.DC.08} — `ClaimCrossReference.resolverOutcome` on every edge (the data structure this DD reads in `collectNoteIncidences`)
- {DD021.§10.DC.17} — `ClaimIndexEntry.archived` field (the precondition for `reference-to-archived`; the soft-delete analog is §8 Frontier)
- `core/src/cli/commands/claims/lint-command.ts` — the per-note lint command being extended
- `core/src/claims/reference-resolver.ts` — the resolver consumed by `collectSourceIncidences`
- `core/src/claims/claim-index.ts` — `ClaimIndexData` and `ClaimCrossReference` declarations
- `core/src/scanners/source-code-scanner.ts` — source-scan infrastructure consumed under `--code`
- `core/src/references/source-reference-index.ts` — `getAllReferences()` and `getReferencesToNote()` entry points
- `core/src/types/reference.ts` — `SourceReference` interface
- `core/src/lifecycle/deletion-marker.ts` — `isDeletionMarker` (per {DD020})
