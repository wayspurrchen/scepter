---
created: 2026-05-05T16:00:38.497Z
tags: [confidence, audit, mark, apply, auto-insert, cli, detailed-design]
status: ready_for_review
---

# DD017 - Confidence command surface implementation

**Spec:** {S004}
**Consumed dependency:** {S003} (adapter registry, `getAdapter`, `ConfidencePayload`)
**Upstream requirement:** {R013}

## Context

This DD is the implementation blueprint for {S004}. {S004} consolidates four command surfaces — `audit` (multi-scope + `--paths`), `mark` (adapter-routed), `apply` (new bulk command), and the `createNote` auto-insert hook — plus the cross-cutting filter resolver they share. Adapter registry internals (`ConfidenceAdapter`, `getAdapter`, `ConfidencePayload`, the C-family and frontmatter adapters' bodies) are owned by {S003} and its DD ({DD016}); this DD consumes them as a settled boundary.

The dispatch boundary is sharp:

| Owned by this DD ({S004}) | Owned by {S003}/{DD016} |
|---|---|
| Filter resolver (`filters.ts`) | Adapter interface and `ConfidencePayload` |
| Multi-scope audit (`audit.ts`) | `getAdapter(filePath)` lookup |
| `audit-command.ts` flag wiring + per-scope/`--paths` formatter | Frontmatter adapter (`gray-matter` round-trip) |
| `mark-command.ts` refactor (routes through `getAdapter`) | C-family adapter (regex parse, JSDoc-internal insert) |
| `apply-command.ts` (new) | The `claims.confidence.includeDate` config slot |
| `NoteManager.createNote` auto-insert hook | The C-family adapter's source-file behavioral parity contract |
| Per-scope/`--paths`/apply formatter extensions | — |

This DD treats the {S003} contractual surface as the binding reference: `getAdapter(filePath): ConfidenceAdapter | null`, `adapter.parse(content, filePath)`, `adapter.format(reviewer, level, date?)`, `adapter.insert(content, payload)`, `payload: {reviewer, level, date?}`. {DD016} is now implemented and the import paths assumed below — `core/src/claims/confidence/registry.ts` and `core/src/claims/confidence/types.ts` — match its settled file layout.

The {R017} amendment (§8, added 2026-05-31) is the command-layer half of the implied-human read-time policy, concretizing {S004.§7}. {DD016}'s §10 owns the adapter-layer mechanism (the emoji-optional grammar, the OPTIONAL `parse` `options?: { defaultReviewer?: ReviewerIcon | null }` parameter per {S003.§1.AC.08}, and the frontmatter YAML-number coercion). This DD's §8 resolves the `claims.confidence.impliedHuman` flag to a `defaultReviewer` value, threads it into each read-path consumer's `parse` call (the audit walk, `apply --skip-annotated`, and auto-insert precedence), and adds the audit `byReviewer` per-reviewer tally plus its formatter rendering. The widened three-argument `parse` signature is the binding boundary this DD consumes from {DD016}'s §10.

## Specification Scope

In scope:
- {S004.§1.AC.01-06} — Filter semantics (resolver, scope tagging, contradiction detection).
- {S004.§2.AC.01-10} — `audit` extension to multi-scope, new flags (`--source-only`, `--notes-only`, `--paths`, `--unannotated`, `--level`), per-scope output, TTY-aware `--paths` breakdown, additive `bySource`/`byNotes` library shape.
- {S004.§3.AC.01-06} — `mark` refactor through `getAdapter`, null-adapter error path, command-layer validation, `includeDate`-honored date computation, source-file behavioral parity (consumed from {S003.§3.AC.06}).
- {S004.§4.AC.01-09} — `apply` command: arg parsing, filter validation, action classification, dry-run plan, failure isolation, summary output, zero-match vs. no-filters distinction.
- {S004.§5.AC.01-07} — Auto-insert hook in `NoteManager.createNote`, template-precedence, no-adapter silent no-op, throw-isolation, scope to creation path only.
- {S004.§6.AC.01} — Release-notes documentation requirement (carried forward; not implemented in code).
- {S004.§7.AC.02-10} ({R017}) — The command-layer half of the implied-human policy: flag resolution (`impliedHuman ?? true` → `defaultReviewer`), threading the resolved value into each read-path `parse` call (audit walk, `apply --skip-annotated`, auto-insert precedence), the audit `byReviewer` per-reviewer tally + its union/formatter rendering, and the write-side-unaffected reaffirmation. ({S004.§7.AC.01} — the config slot — is owned by {DD016}.§10.)

Out of scope (consumed from elsewhere or explicitly deferred):
- Adapter registry internals — {S003}/{DD016}.
- `ConfidencePayload`, `ConfidenceAnnotation`, `ConfidenceAdapter` type definitions — {S003}.
- Third-party adapter registration — {S003} non-goal.
- `--all` flag for `apply` — {S004} non-goal.
- `--no-downgrade` guard — {R013.OQ.02} default (permitted).
- Per-note-type `autoInsert` overrides — {S004} non-goal.
- Named confidence presets — {S004} non-goal.
- Source-file auto-insert at creation — {S004.§5.AC.07} non-goal.
- Removal command — {S003} non-goal.

## Primitive Preconditions

| Primitive | Source Citation | Status |
|---|---|---|
| `auditConfidence` (existing single-scope) | `core/src/claims/confidence.ts:267-304` | PRESENT — migration source for §3 |
| `discoverSourceFiles` (helper) | `core/src/claims/confidence.ts:236-258` | PRESENT — reused by source-scope branch in §3 |
| `parseConfidenceAnnotation` (legacy direct call) | `core/src/claims/confidence.ts:94-122` | PRESENT — supplanted by `adapter.parse` after §4 refactor; retained while {S003} adapter ships |
| `formatConfidenceAnnotation` | `core/src/claims/confidence.ts:134-140` | PRESENT — supplanted by `adapter.format` after §4 refactor |
| `insertConfidenceAnnotation` | `core/src/claims/confidence.ts:155-189` | PRESENT — supplanted by `adapter.insert` after §4 refactor |
| `validateReviewerLevel` | `core/src/claims/confidence.ts:199-213` | PRESENT — reused at command layer in §4, §5 |
| `mapReviewerArg` | `core/src/claims/confidence.ts:218-227` | PRESENT — reused at command layer in §4, §5 |
| `auditCommand` (Commander) | `core/src/cli/commands/confidence/audit-command.ts:16-94` | PRESENT — extension target for §3 |
| `markCommand` (Commander) | `core/src/cli/commands/confidence/mark-command.ts:23-96` | PRESENT — refactor target for §4 |
| `confidenceCommand` group | `core/src/cli/commands/confidence/index.ts:17-21` | PRESENT — registration target for §5's `applyCommand` |
| `formatConfidenceAudit` | `core/src/cli/formatters/confidence-formatter.ts:26-69` | PRESENT — extension target for §7 |
| `LEVEL_NAMES` (display labels) | `core/src/cli/formatters/confidence-formatter.ts:13-19` | PRESENT — reused in per-scope formatter |
| `NoteManager.createNote` | `core/src/notes/note-manager.ts:436-559` | PRESENT — auto-insert hook insertion point at line 520 (post-`createNoteFile`) / line 558 (pre-`return note`) |
| `NoteManager.noteFileManager` | `core/src/notes/note-manager.ts` (constructor, member) | PRESENT — used by hook for content read/write |
| `NoteFileManager.createNoteFile` | `core/src/notes/note-file-manager.ts:64` | PRESENT — caller before hook |
| `NoteManager.emit('warning', ...)` channel | `core/src/notes/note-manager.ts:484` (precedent) | PRESENT — used by §6 throw-isolation path |
| `BaseCommand.execute` / `BaseCommand.handleError` | `core/src/cli/commands/base-command.ts` | PRESENT — reused by `applyCommand` |
| `ConfigManager.getConfig` | `core/src/project/project-manager.ts:267,285,295,...` (precedent) | PRESENT — used by §3, §4, §5, §6 to read `claims.confidence.*` |
| `ProjectManager.noteManager.getNotes(query)` | `core/src/notes/note-manager.ts:1218` | PRESENT — used by `resolveFiles` for type/tag/id filtering |
| `Note.filePath` | `core/src/types/note.ts` (interface) | PRESENT — `resolveFiles` returns `notes`-scope candidates as `Note.filePath` |
| `glob` library | `core/package.json` dependency | PRESENT — used for `--glob` in `resolveFiles`, source discovery |
| `cli-table3` library | `core/package.json` dependency, used at `core/src/cli/formatters/table-formatter.ts:2` | PRESENT — used for §3's `--paths` table and §5's dry-run plan |
| `chalk` library | `core/package.json` dependency | PRESENT — used; suppressed under non-TTY by `--paths` |
| `getAdapter(filePath)` | `core/src/claims/confidence/registry.ts` (per {S003.§2}, {DD016.§1.DC.06}) | PRESENT — implemented in {DD016}; this DD consumes it as a settled boundary |
| `ConfidenceAdapter`, `ConfidencePayload`, `ConfidenceAnnotation` | `core/src/claims/confidence/{adapter,types}.ts` per {S003.§1} | PRESENT — implemented in {DD016} |
| `claims.confidence.includeDate` config flag | `core/src/types/config.ts` schema slot ({DD016.§8.DC.43}) and Zod validation ({DD016.§8.DC.44}) | PRESENT — this DD reads it via `config.claims?.confidence?.includeDate` and treats `undefined` as `true` (the default) per {R013.§1.AC.06} |
| `claims.confidence.autoInsert` config flag | `core/src/types/config.ts:237-240` | PRESENT — declared, currently unwired; this DD wires it |
| `ConfidenceAdapter.parse` 3-arg signature (`options?: { defaultReviewer? }`) | `core/src/claims/confidence/adapter.ts:40` ({DD016.§10.DC.50}) | PRESENT after {DD016}.§10 — §8 threads `{ defaultReviewer }` into this parameter |
| `claims.confidence.impliedHuman` config slot | `core/src/types/config.ts:239` ({DD016.§10.DC.55}) and Zod validation ({DD016.§10.DC.55}) | PRESENT after {DD016}.§10 — §8 reads it via `config.claims?.confidence?.impliedHuman ?? true` |
| `walkScope` (audit read path) | `core/src/claims/confidence/audit.ts:142` | PRESENT — `adapter.parse(content, display)` at `:158` is the read-path call §8 threads `defaultReviewer` into; `auditConfidence` (`:218`) holds config |
| `ScopedAuditResult` interface | `core/src/claims/confidence/audit.ts:42` | PRESENT — gains additive `byReviewer` field per §8 (DC.40) |
| `emptyScopedResult` | `core/src/claims/confidence/audit.ts:74` | PRESENT — zero-initializes the new `byReviewer` field per §8 (DC.40) |
| `unionScopes` | `core/src/claims/confidence/audit.ts:186` | PRESENT — sums the new `byReviewer` field across scopes per §8 (DC.40) |
| apply `--skip-annotated` parse call | `core/src/cli/commands/confidence/apply-command.ts:210` | PRESENT — `adapter.parse(content, file.filePath)`; §8 threads `defaultReviewer` (DC.44). The resolution point at `:159-161` already reads `includeDate`; `impliedHuman` resolves alongside |
| auto-insert precedence parse call | `core/src/notes/note-manager.ts:611` | PRESENT — `adapter.parse(content, notePath)` inside `maybeAutoInsertConfidence` (`:590`); §8 threads `defaultReviewer` (DC.45). Config already read at `:592` |
| `formatConfidenceAudit` / `renderScopeSection` | `core/src/cli/formatters/confidence-formatter.ts:49`, `:94` | PRESENT — extended to render the per-reviewer breakdown per §8 (DC.42) |
| VS Code reviewer bucketing | `vscode/src/views/confidence-tree-provider.ts:118` (`ann.reviewer === '👤'`) | PRESENT — consumes `auditResult.files`; bare-digit files land in the human bucket automatically once parse attributes them to `👤` (DC.43, no code change) |

**Halt-rule disposition:** All preconditions above are PRESENT in the codebase. The {R017} additions (§8) depend on {DD016}.§10's `parse` 3-arg signature and the `impliedHuman` config slot, both PRESENT after {DD016}.§10 lands; §8 must sequence after {DD016}.§10 per the Integration Sequence. The `impliedHuman` flag is read via `config.claims?.confidence?.impliedHuman` and treated as `true` when absent, per {R017.AC.09} / {S004.§7.AC.02}'s "default active" framing — mirroring the `includeDate ?? true` resolution already used in §4 and §6.

## Current State

The current confidence subsystem (`core/src/claims/confidence.ts`) exposes one source-only audit, one C-family-only mark, and one declared-but-unwired `claims.confidence.autoInsert` flag. The Commander tree has `audit` and `mark` registered; no `apply`. The formatter renders a single combined table. `NoteManager.createNote` writes the note file at line 520 and returns at line 558 with no hook between.

Source files this DD modifies (in addition to ones it creates):

| File | Current shape | Direction of change |
|---|---|---|
| `core/src/cli/commands/confidence/audit-command.ts` | Single `audit()` action with `--format`/`--unannotated`/`--level` | Add `--source-only`, `--notes-only`, `--paths`; route through new multi-scope `auditConfidence` |
| `core/src/cli/commands/confidence/mark-command.ts` | Direct call to `formatConfidenceAnnotation` + `insertConfidenceAnnotation` (C-family hardcoded) | Route through `getAdapter`; null-adapter error path; `includeDate`-honored date |
| `core/src/cli/commands/confidence/index.ts` | Registers `audit` + `mark` | Register new `apply` |
| `core/src/cli/formatters/confidence-formatter.ts` | Single combined output | Add per-scope sections, `--paths` breakdown (TTY-aware), apply summary, apply dry-run plan |
| `core/src/notes/note-manager.ts:436-559` | `createNote` writes file and returns | Insert auto-insert hook between line 520 and line 558 |
| `core/src/claims/confidence.ts:267-304` | `auditConfidence` walks source only | Migrated to `core/src/claims/confidence/audit.ts` and extended to multi-scope |

## Module Inventory

### `core/src/claims/confidence/filters.ts` (NEW)

| Requirement | Type/Function | Notes |
|---|---|---|
| {S004.§1.AC.01-06} | `interface FilterSpec` | `{ types?: string[]; tags?: string[]; ids?: string[]; glob?: string }` — input shape supplied by `apply` (and, in restricted form, by `audit`'s scope toggles) |
| {S004.§1.AC.06} | `interface ResolvedFile` | `{ filePath: string; scope: 'source' \| 'notes' }` — output tuple |
| {S004.§1.AC.01-06} | `async function resolveFiles(pm: ProjectManager, spec: FilterSpec): Promise<ResolvedFile[]>` | Single async function; returns the AND-across/OR-within resolution per §1.AC.02 |
| {S004.§1.AC.04} | `class FilterContradictionError extends Error` | Distinct error subclass so callers (apply) can map to a non-zero usage exit |

DC.01:derives=S004.§1.AC.01 The `FilterSpec` interface MUST expose `types?: string[]`, `tags?: string[]`, `ids?: string[]`, and `glob?: string` fields — exactly the four `apply`-facing categories. Audit-only scope toggles (`--source-only`, `--notes-only`) MUST NOT appear on `FilterSpec`; they are handled by the audit command's scope option (§3) before any resolver call.

DC.02:derives=S004.§1.AC.06 The `ResolvedFile` interface MUST tag each resolved file with `scope: 'source' | 'notes'`. Classification follows the rule: a file under `sourceCodeIntegration.folders` is `'source'`; a file under `discoveryPaths` is `'notes'`; if a file matches both roots, `'notes'` wins (notes win the overlap, consistent with the §1.AC.06 invariant).

DC.03:derives=S004.§1.AC.01 `resolveFiles(pm, spec)` MUST be the single entry point for filter resolution. It MUST NOT consult `getAdapter`; adapter dispatch is the caller's responsibility (audit and apply both call `getAdapter` per resolved file).

DC.04 The module MUST export `FilterSpec`, `ResolvedFile`, `resolveFiles`, and `FilterContradictionError`. No other exports; the resolver is intentionally a single-function module to keep its semantics easy to reason about.

### `core/src/claims/confidence/audit.ts` (NEW)

| Requirement | Type/Function | Notes |
|---|---|---|
| {S004.§2.AC.01-09} | `interface ScopedAuditResult` | Per-scope substructure: `{ total, annotated, unannotated, byLevel, files, unannotatedFiles }`. {R017} (§8, DC.40) adds an additive `byReviewer: Record<ReviewerIcon, number>` field |
| {S004.§2.AC.05,.AC.09} | `interface ConfidenceAuditResult` | Re-exported, additive: existing top-level fields + `bySource: ScopedAuditResult` + `byNotes: ScopedAuditResult` (the `byReviewer` field rides along on each `ScopedAuditResult`) |
| {S004.§2.AC.01-09}, {S004.§7.AC.04} | `async function auditConfidence(pm: ProjectManager, options: AuditOptions): Promise<ConfidenceAuditResult>` | Multi-scope walker; extended from `confidence.ts:267-304`. {R017} (§8, DC.41): resolves `impliedHuman` and threads `defaultReviewer` through `walkScope` into `adapter.parse` |
| {S004.§2.AC.03} | `interface AuditOptions` | `{ scope?: 'source' \| 'notes' \| 'both' }` — default `'both'` |
| {S004.§7.AC.05} | `walkScope(files, projectPath, pathDisplay, defaultReviewer)` | {R017} (§8, DC.40, DC.41): gains the `defaultReviewer` param; threads it into `adapter.parse`; increments `byReviewer`. `unionScopes`/`emptyScopedResult` sum/zero the new field |

DC.05:derives=S004.§2.AC.05 The `ConfidenceAuditResult` shape MUST gain `bySource: ScopedAuditResult` and `byNotes: ScopedAuditResult` substructures. Each substructure MUST carry the existing six fields (`total`, `annotated`, `unannotated`, `byLevel`, `files`, `unannotatedFiles`). This shape is additive; the top-level six fields MUST remain populated as the union across scopes (sums for counts, concatenation for arrays).

DC.06:derives=S004.§2.AC.09 The migrated `auditConfidence` MUST preserve every existing top-level field name and meaning so existing programmatic consumers (the audit command before {R013}, any external script) continue to function without change. Adding `bySource`/`byNotes` is purely additive.

DC.07:derives=S004.§2.AC.02 Note-scope discovery MUST walk `discoveryPaths` exclusively — implemented via `pm.noteManager.getNotes({})` followed by `Note.filePath` resolution to absolute paths, OR by glob over `discoveryPaths` for `.md` files. Source-scope discovery MUST walk `sourceCodeIntegration.folders` exclusively — implemented via the existing `discoverSourceFiles` helper, kept in place at `core/src/claims/confidence.ts` and imported here. The two configs MUST NOT be cross-consulted.

DC.08:derives=S004.§2.AC.04 Each discovered file in either scope MUST be processed by the adapter returned from `getAdapter(filePath)`. When `getAdapter` returns `null`, the file MUST be omitted from the audit (neither annotated nor unannotated counts include it). This is the {S003.§2.AC.05} no-adapter-outcome contract surfaced at the audit-caller layer.

DC.09:derives=S004.§2.AC.03 The `scope` option MUST drive which discovery paths run. `'source'` → only source discovery; `'notes'` → only note discovery; `'both'` (the default) → both. The result's `bySource`/`byNotes` are populated for whichever scopes ran; the unrun scope's substructure MUST be `{ total: 0, annotated: 0, unannotated: 0, byLevel: {1:0,2:0,3:0,4:0,5:0}, files: [], unannotatedFiles: [] }` (zero-valued, never `undefined`, so consumers don't need null guards).

DC.10 The legacy single-scope `auditConfidence(projectPath, sourceConfig)` signature in `confidence.ts:267-304` MUST be removed. Callers MUST migrate to the new `auditConfidence(pm, options)` signature. The only existing in-tree caller is `audit-command.ts`; the migration is mechanical and contained within this DD's integration sequence.

### `core/src/cli/commands/confidence/audit-command.ts` (MODIFIED)

| Requirement | Type/Function | Notes |
|---|---|---|
| {S004.§2.AC.01-10} | Commander argument tree | Existing `--format`, `--unannotated`, `--level` flags retained; new `--source-only`, `--notes-only`, `--paths` flags added |
| {S004.§2.AC.03} | mutual-exclusivity validator | Check `--source-only` XOR `--notes-only` before resolving scope |
| {S004.§2.AC.10} | `--paths` TTY detection | `process.stdout.isTTY` queried at command layer; result passed to formatter |

DC.11:derives=S004.§2.AC.03 The `audit` command MUST add `--source-only` and `--notes-only` boolean flags. Supplying both MUST raise a clear error and exit non-zero before any discovery runs. The resolved scope is `'source'`, `'notes'`, or `'both'` (default).

DC.12:derives=S004.§2.AC.10 The `audit` command MUST add a `--paths` boolean flag. When set, the command MUST query `process.stdout.isTTY` and pass `{ tty: <bool>, paths: true }` to the formatter alongside the audit result. The breakdown is emitted IN ADDITION TO the standard summary; the summary appears at the top, the breakdown is appended below.

DC.13:derives=S004.§2.AC.08 The existing `--unannotated` and `--level` flags MUST continue to work and MUST tag each listed file with its scope (`source` or `notes`) when both scopes are active. When a scope toggle is set, the scope tag is implicit and MAY be omitted.

DC.14 The command MUST call the new `auditConfidence(pm, { scope })` from `confidence/audit.ts` (not the legacy `confidence.ts` symbol, which is removed per DC.10). All option-driven filtering (`--unannotated`, `--level`, `--paths`) operates on the result, not on a re-walked filesystem.

### `core/src/cli/commands/confidence/mark-command.ts` (REFACTORED)

| Requirement | Type/Function | Notes |
|---|---|---|
| {S004.§3.AC.01-06} | Commander action body | Refactored to: validate args → `getAdapter(filePath)` → null-check → compute date per `includeDate` → read content → `adapter.insert` → write content |

DC.15:derives=S004.§3.AC.01 The mark command MUST resolve the adapter via `getAdapter(filePath)`. When the result is `null`, the command MUST exit with non-zero status and emit a clear error message containing (a) the file's path, (b) its extension, and (c) the supported adapter ids exposed by the registry (e.g., `markdown-frontmatter`, `c-family-comments`). It MUST NOT silently no-op or fall back to direct C-family logic.

DC.16:derives=S004.§3.AC.02 Reviewer mapping (`mapReviewerArg`) and reviewer/level validation (`validateReviewerLevel`) MUST run BEFORE the adapter call. If validation fails, the command MUST exit non-zero with the validation error and MUST NOT invoke `getAdapter`, `adapter.parse`, or `adapter.insert`.

DC.17:derives=S004.§3.AC.03 The date supplied to `adapter.insert(content, payload)` MUST be computed at the command layer per `claims.confidence.includeDate`: when `true` (or `undefined` → default `true`), the command MUST compute `new Date().toISOString().slice(0, 10)` (current local date in ISO `YYYY-MM-DD`); when `false`, the command MUST pass `date: undefined` in the payload, yielding the bare `<emoji><level>` payload form per {S003.§5.AC.02}. The same rule applies in `apply` (§5) and the auto-insert hook (§6).

DC.18 The command MUST own all I/O. After `adapter.insert(content, payload)` returns, the command MUST call `fs.writeFile(filePath, updated, 'utf-8')` exactly once. The adapter MUST NOT be passed a filesystem handle or asked to perform I/O — this is the {S003.§5.AC.04} side-effect-free invariant on the consumer side.

DC.19:derives=S004.§3.AC.05 Source-file behavior MUST remain byte-identical to the pre-{R013} mark implementation: identical annotation string, identical insertion point (after JSDoc end / at top), identical in-place replacement. This is delegated to {S003.§3.AC.06} via the C-family adapter; this DD's mark command is a pass-through that preserves the contract by routing all C-family I/O through `getAdapter` → C-family adapter.

### `core/src/cli/commands/confidence/apply-command.ts` (NEW)

| Requirement | Type/Function | Notes |
|---|---|---|
| {S004.§4.AC.01-09} | Commander command export `applyCommand` | Positional args `<reviewer> <level>` + filter flags + behavior modifiers |
| {S004.§4.AC.05} | `interface PlanRow` | `{ path, scope, current, proposed, action }` — used for both dry-run table and verbose output |
| {S004.§4.AC.07,.AC.08} | `interface ApplyOutcome` | `{ marked, replaced, skippedAnnotated, skippedUnmatched, failed }` — all numeric counters; `failed` carries `{path, error}[]` for messages |
| {S004.§7.AC.07} | `--skip-annotated` parse threading | {R017} (§8, DC.44): the `adapter.parse(content, file.filePath)` call at `apply-command.ts:210` gains `{ defaultReviewer }`, resolved at `:159-161` alongside `includeDate`. A bare digit then classifies `skip-annotated` |

DC.20:derives=S004.§4.AC.01 The `apply` command MUST accept the positional arguments `<ai|human>` and `<level>` (1-5), the filter flags `--types`, `--tags`, `--ids`, `--glob` (each comma-delimited where it accepts multiple values), and the behavior flags `--skip-annotated` (default `true`), `--overwrite` (default `false`), `--dry-run` (default `false`), `--verbose` (default `false`). Reviewer mapping and reviewer/level validation MUST run at the command layer per DC.16. The date passed to `adapter.insert` MUST honor `includeDate` per DC.17.

DC.21:derives=S004.§4.AC.02 The command MUST reject invocations with NO filter flags present — defined as: all four of `types`, `tags`, `ids`, `glob` are `undefined` OR empty strings/arrays. Rejection MUST exit non-zero with a clear "no filters supplied" error. This is distinct from the zero-match case (DC.27).

DC.22:derives=S004.§1.AC.04 The command MUST call `resolveFiles(pm, spec)` from `filters.ts` and MUST surface a thrown `FilterContradictionError` as a usage error with non-zero exit. Other thrown errors from `resolveFiles` MUST propagate to `BaseCommand.handleError`.

DC.23:derives=S004.§4.AC.03,S004.§4.AC.04,S004.§4.AC.06 For each `ResolvedFile` from the resolver, the command MUST classify the action via the following decision matrix, in order:

| Step | Condition | Action |
|---|---|---|
| 1 | `getAdapter(filePath)` returns `null` | `'skip-unmatched'` |
| 2 | `adapter.parse(content)` returns non-null AND `--overwrite` is false | `'skip-annotated'` (`--skip-annotated` is the default; `--overwrite` suppresses it per S004.§4.AC.03) |
| 3 | `adapter.parse(content)` returns non-null AND `--overwrite` is true | `'replace'` |
| 4 | `adapter.parse(content)` returns null | `'mark'` |
| (during write, if `adapter.insert` throws) | — | `'failed'` |

DC.24:derives=S004.§4.AC.05 Under `--dry-run`, the command MUST emit a per-file plan table with columns `path`, `scope`, `current`, `proposed`, `action`. The `current` column MUST show the existing annotation string when one is parsed (formatted via the adapter's `format(reviewer, level, date)` against the parsed payload) or `-` when absent. The `proposed` column MUST show the formatted annotation string the command would write (formatted via the same adapter). The command MUST NOT call `fs.writeFile` for any file. Exit status is 0 unless a planning error occurred (a `FilterContradictionError` already exited non-zero before reaching this point).

DC.25:derives=S004.§4.AC.07 Per-file failures during `adapter.insert` (including `FRONTMATTER_PARSE_ERROR` from {S003.§4} when YAML is malformed) MUST be caught, the file recorded under `failed` with the underlying error message, and the loop MUST continue to the next file. Files with classification `'skip-unmatched'` MUST be added to `skippedUnmatched` without invoking adapter operations. The command MUST exit non-zero if and only if the final `failed` count is greater than zero.

DC.26:derives=S004.§4.AC.08 The default (non-dry-run, non-verbose) output MUST emit a summary block with five count totals: `marked`, `replaced`, `skipped-annotated`, `skipped-unmatched`, `failed`. Under `--verbose`, the summary MUST be followed by the per-file plan table (same shape as DC.24's dry-run output, with `action` showing the actual action taken).

DC.27:derives=S004.§4.AC.09 When the resolver returns zero files, the command MUST exit with status 0 and emit a "no files matched" message naming the supplied filters. This is distinct from DC.21's no-filters error: zero matches with filters present is a successful no-op; absent filters is a usage error.

DC.28 File processing MUST be sequential (one file at a time, awaited). See Decision 3 below.

### `core/src/cli/commands/confidence/index.ts` (MODIFIED)

DC.29 The `confidenceCommand` group MUST register the new `applyCommand` alongside the existing `auditCommand` and `markCommand`. No other behavior changes.

### `core/src/notes/note-manager.ts` (MODIFIED)

| Requirement | Type/Function | Notes |
|---|---|---|
| {S004.§5.AC.01-07} | `private async maybeAutoInsertConfidence(notePath: string): Promise<void>` | New private method on `NoteManager` |
| {S004.§5.AC.01} | `createNote` body | Single new line: `await this.maybeAutoInsertConfidence(filepath);` between line 520's `createNoteFile` (or, more precisely, line 553's `note.filePath = filepath` assignment) and line 558's `return note` |
| {S004.§7.AC.08} | precedence parse threading | {R017} (§8, DC.45): the precedence `adapter.parse(content, notePath)` call at `note-manager.ts:611` gains `{ defaultReviewer }`, resolved from `impliedHuman` at the existing config read (`:592`). A pre-existing bare digit is then respected (not overwritten) |

DC.30:derives=S004.§5.AC.01 `NoteManager.createNote` MUST invoke `this.maybeAutoInsertConfidence(filepath)` exactly once per call, AFTER `noteFileManager.createNoteFile(note)` (line 520) and any post-write adjustments (lines 521-553), and BEFORE the `return note` exit (line 558). The hook call site is between line 553 (`note.filePath = filepath`) and line 555 (`this.emit('note:created', note)`). Placing it before `note:created` is intentional: listeners observing the new note SHOULD see it in its final on-disk shape.

DC.31:derives=S004.§5.AC.02,S004.§5.AC.03,S004.§5.AC.04,S004.§5.AC.05,S004.§5.AC.06 The new `maybeAutoInsertConfidence(notePath)` method MUST execute the following algorithm, in order:

1. Read `claims.confidence.autoInsert` from `this.configManager.getConfig().claims?.confidence?.autoInsert`. Treat `undefined` as `true` (the documented default per {S004.§5.AC.02}). When the resolved value is `false`, RETURN immediately without calling `getAdapter`, `parse`, or `insert` (per S004.§5.AC.04 — no adapter call permitted when the flag is off).
2. Call `getAdapter(notePath)`. When the result is `null`, RETURN silently (no error, no warning) per S004.§5.AC.05.
3. Read the file content via `this.noteFileManager` (existing read helper) or directly via `fs.readFile`. Call `adapter.parse(content, notePath)`. When the result is non-null, RETURN without modification per S004.§5.AC.03 (template-supplied confidence wins).
4. Read `claims.confidence.includeDate`; treat `undefined` as `true`. Compute `date = includeDate ? new Date().toISOString().slice(0, 10) : undefined`. Construct `payload = { reviewer: '🤖', level: 2, date }`.
5. Call `adapter.insert(content, payload)` inside a `try`. On throw, CATCH, emit `this.emit('warning', { type: 'auto_insert_failed', message: <error message>, notePath })`, and RETURN (per S004.§5.AC.06 — note creation is the user's primary intent and MUST NOT be blocked).
6. Write the new content to disk via `fs.writeFile(notePath, updated, 'utf-8')` (or the existing file-manager write path if one exists for this purpose).

DC.32:derives=S004.§5.AC.07 The hook MUST be invoked ONLY from `createNote`. No other note-mutation path (`updateNote`, `archiveNote`, `deleteNote`, `renameNote`) MUST call `maybeAutoInsertConfidence`. Source-file creation paths do not exist in this project and are out of scope.

DC.33 The hook is a private method on `NoteManager` — not a free function — so it has access to `this.configManager` and `this.noteFileManager` and emits warnings on the same `EventEmitter` instance that already carries `note:created` and other lifecycle events. This keeps the diagnostic surface uniform.

### `core/src/cli/formatters/confidence-formatter.ts` (MODIFIED)

| Requirement | Type/Function | Notes |
|---|---|---|
| {S004.§2.AC.07} | `formatConfidenceAudit` extension | Per-scope sections when both populated; combined-totals line (file counts only, no combined percentage) |
| {S004.§7.AC.06} | `renderScopeSection` per-reviewer line | {R017} (§8, DC.42): renders the human/AI annotated-file counts from `scope.byReviewer` alongside the per-level breakdown. JSON path carries `byReviewer` automatically |
| {S004.§2.AC.10} | `formatConfidenceAuditPaths` (new) | Per-directory breakdown; takes `{ tty: boolean }`; suppresses ANSI/box-drawing under non-TTY |
| {S004.§4.AC.05,.AC.08} | `formatApplySummary` (new) | Five-counter summary for non-dry-run, non-verbose path |
| {S004.§4.AC.05} | `formatApplyPlanTable` (new) | Per-file table for dry-run and `--verbose` output; backed by `cli-table3` |

DC.34:derives=S004.§2.AC.07 `formatConfidenceAudit` MUST emit two clearly delimited per-scope sections (each with header, count totals, percentage, and per-level breakdown) when both `bySource.total > 0` and `byNotes.total > 0`. Below the per-scope sections, a combined-totals line MUST be emitted that sums file counts (`total`, `annotated`, `unannotated`) but MUST NOT compute a combined percentage. When only one scope is populated (because the user passed `--source-only` or `--notes-only`, OR because the unscoped run found zero files in one scope), only the populated scope's section MUST be emitted and the combined-totals line MUST be omitted.

DC.35:derives=S004.§2.AC.10 The new `formatConfidenceAuditPaths(result, { tty, scope, level, unannotatedOnly })` function MUST emit a per-directory grouping of files with their annotation state — one block per directory, sorted lexicographically. Within each directory, files MUST be listed alphabetically, each prefixed with its annotation string (e.g., `🤖2 2026-05-05`) or the literal `unannotated`. When `tty: false`, ALL ANSI color codes MUST be suppressed and decorative box-drawing characters MUST NOT be emitted — only plain ASCII so the captured output is grep-friendly. When `tty: true`, color and decorations follow the existing formatter's conventions. The `--source-only`/`--notes-only`/`--unannotated`/`--level` flags scope the breakdown's content (the result is pre-filtered by the audit command before this function is called).

DC.36:derives=S004.§4.AC.08 `formatApplySummary(outcome)` MUST emit five lines, one per counter (`marked`, `replaced`, `skipped-annotated`, `skipped-unmatched`, `failed`), with the count and the human-readable label. When `failed > 0`, `formatApplySummary` MUST additionally list each failure's path and error message indented below the `failed` counter.

DC.37:derives=S004.§4.AC.05 `formatApplyPlanTable(rows)` MUST render a `cli-table3` table with the column headers `path`, `scope`, `current`, `proposed`, `action`. Used unchanged by `--dry-run` (planned actions) and by `--verbose` (executed actions). The action vocabulary is `mark`, `replace`, `skip-annotated`, `skip-unmatched`, `failed`.

DC.38 Existing `formatConfidenceAudit` callers (the audit command's `--format json` path) MUST continue to receive the legacy top-level shape via `JSON.stringify(result, null, 2)`. The result's new `bySource`/`byNotes` substructures appear in JSON output additively.

## §8 Implied-human policy: config resolution and read-path threading ({R017})

This section concretizes {S004.§7} — the command-layer half of the {R017} implied-human read-time policy. {DD016}.§10 gives `parse` an OPTIONAL `options?: { defaultReviewer?: ReviewerIcon | null }` parameter and widens both adapters' grammars; this DD resolves `claims.confidence.impliedHuman` to a `defaultReviewer` value and threads it into the three read-path `parse` calls that already hold config at their call site: the audit walk (§2), the `apply --skip-annotated` check (§4), and the auto-insert precedence check (§5/§6). It also adds the audit `byReviewer` per-reviewer tally and its formatter rendering. The DCs below ADD to §1-§7; they do not delete or reword any existing DC. Write paths are reaffirmed unaffected.

### Single resolution shape

All three read-path consumers resolve the flag identically and map it to the parse-policy value {S003.§1.AC.08} / {DD016.§10.DC.50} expects:

```typescript
const impliedHuman = config.claims?.confidence?.impliedHuman ?? true;   // default active
const defaultReviewer: ReviewerIcon | null = impliedHuman ? '👤' : null;
// … adapter.parse(content, filePath, { defaultReviewer }) …
```

This mirrors the `includeDate ?? true` resolution already used in `apply-command.ts:160` and `note-manager.ts:618`. There is no shared helper required — the one-line resolution is co-located with each consumer's existing config read. (`true → '👤'`, `false → null`; an unthreaded consumer passing no options gets today's behavior per {DD016.§10.DC.50}.)

DC.39:4:derives=S004.§7.AC.02 Each read-path consumer (the audit walk, the `apply --skip-annotated` parse, and the auto-insert precedence parse) MUST resolve the policy as `config.claims?.confidence?.impliedHuman ?? true`, so a project with no `impliedHuman` key gets bare-digit-reads-as-human behavior. The resolution MUST be co-located with each consumer's existing config read (`apply-command.ts:159-161` already reads `includeDate`; `note-manager.ts:592` already reads config; `auditConfidence` reads config at `audit.ts:223`). This is the {S004.§7.AC.02} default-active resolution; the mapping of the resolved boolean to `defaultReviewer` is DC.39a.

DC.39a:derives=S004.§7.AC.03 Each read-path consumer MUST map the resolved `impliedHuman` boolean (DC.39) to the `defaultReviewer` parse-policy value — `true → '👤'`, `false → null` — and MUST pass it as the `options.defaultReviewer` argument to every `adapter.parse(content, filePath, options)` call it makes on the read path. A consumer that does not resolve the flag (passes no options) MUST, per {DD016.§10.DC.50}, get today's behavior (bare digit unrecognized). `ReviewerIcon` MUST be imported wherever the mapped value is constructed. The per-consumer threading is captured in DC.41 (audit), DC.44 (apply), and DC.45 (auto-insert).

### Audit: thread the policy and add the `byReviewer` tally (`audit.ts`)

The policy threads from `auditConfidence` (which holds config at `audit.ts:223`) through `walkScope` into `adapter.parse` at `audit.ts:158`. The `ScopedAuditResult` interface (`audit.ts:42`) gains an additive `byReviewer` field; `emptyScopedResult` (`audit.ts:74`) zero-initializes it; `walkScope` (`audit.ts:142`) populates it; `unionScopes` (`audit.ts:186`) sums it. Existing fields (`total`, `annotated`, `unannotated`, `byLevel`, `files`, `unannotatedFiles`) are unchanged.

The `byReviewer` shape is a per-reviewer count of annotated files, keyed by the two reviewer icons:

```typescript
export interface ScopedAuditResult {
  total: number;
  annotated: number;
  unannotated: number;
  byLevel: Record<ConfidenceLevel, number>;
  byReviewer: Record<ReviewerIcon, number>;   // NEW — at minimum '🤖' and '👤'
  files: ConfidenceAnnotation[];
  unannotatedFiles: string[];
}
```

Threading: `walkScope` MUST accept the resolved `defaultReviewer` and pass `{ defaultReviewer }` into `adapter.parse(content, display, { defaultReviewer })`. `auditConfidence` resolves `impliedHuman ?? true → '👤'|null` once and passes the value into each `walkScope(...)` call. Because the bare-digit annotation now parses to a non-null `ConfidenceAnnotation` with `reviewer: '👤'`, it counts as annotated, its level lands in `byLevel`, and it increments `byReviewer['👤']`.

DC.40:4:derives=S004.§7.AC.05 `ScopedAuditResult` (`audit.ts:42`) MUST gain an additive `byReviewer: Record<ReviewerIcon, number>` field — a per-reviewer count of annotated files, at minimum the `'🤖'` and `'👤'` keys. `emptyScopedResult` (`audit.ts:74`) MUST zero-initialize it (`{ '🤖': 0, '👤': 0 }`) so the unrun scope's substructure is never `undefined`. `walkScope` (`audit.ts:142`) MUST increment `result.byReviewer[annotation.reviewer]` for each annotated file (alongside the existing `byLevel` increment). `unionScopes` (`audit.ts:186`) MUST sum `byReviewer` per reviewer across scopes (parallel to how it sums `byLevel`). A bare-digit-annotated file MUST contribute to the `'👤'` count. The existing `total`/`annotated`/`unannotated`/`byLevel`/`files`/`unannotatedFiles` fields MUST be unchanged. This amends DC.05 and DC.09 (the `ScopedAuditResult` shape) additively; it does not alter the existing fields.

DC.41:4:derives=S004.§7.AC.04 `auditConfidence` (`audit.ts:218`) MUST resolve `config.claims?.confidence?.impliedHuman ?? true`, map it to `defaultReviewer` (`true → '👤'`, `false → null`) per DC.39a, and thread it through each `walkScope(...)` call. `walkScope` MUST gain a `defaultReviewer: ReviewerIcon | null` parameter and pass `{ defaultReviewer }` as the third argument to `adapter.parse(content, display, { defaultReviewer })` at `audit.ts:158`. With the policy active, a file carrying a bare-digit annotation MUST be counted as annotated (not unannotated), and its level MUST be included in the scope's `byLevel` tally, in both the `bySource`/`byNotes` substructures and the top-level union. This amends DC.08 (the `walkScope` parse call) additively.

### Formatter: render the per-reviewer breakdown (`confidence-formatter.ts`)

`renderScopeSection` (`confidence-formatter.ts:94`) gains a per-reviewer line group alongside the existing per-level breakdown, per scope. The JSON path (`formatConfidenceAudit` with `format: 'json'`, `confidence-formatter.ts:53`) carries `byReviewer` automatically because it `JSON.stringify`s the whole result (additive per DC.38).

DC.42:derives=S004.§7.AC.06 The audit table formatter (`renderScopeSection` at `confidence-formatter.ts:94`, called by `formatConfidenceAudit`) MUST surface the per-reviewer breakdown (human vs AI annotated-file counts from `scope.byReviewer`) alongside the existing per-level breakdown, per scope. The `--format json` path MUST carry `byReviewer` (automatic via the whole-result `JSON.stringify`, additive per DC.38). This amends DC.34 additively; the existing per-scope sections and combined-totals line are unchanged.

### VS Code bucketing (consequence — no code change)

The VS Code confidence tree buckets annotated files by `ann.reviewer === '👤'` over `auditResult.files` (`vscode/src/views/confidence-tree-provider.ts:118`). Because the audit now attributes a bare-digit file's `reviewer` to `'👤'` (DC.41) and emits it in `files` unchanged, such a file lands in the human bucket automatically. No VS Code change is required; this DC records the consequence so the projection is not mistaken for unaddressed.

DC.43:derives=S004.§7.AC.06 The downstream human/AI bucketing that consumes the audit result — including the VS Code confidence tree, which buckets by `ann.reviewer === '👤'` at `confidence-tree-provider.ts:118` — MUST place a bare-digit-annotated file in the human bucket, consequent to its `reviewer: '👤'` parse outcome under DC.41. No VS Code code change is required: the bucketing already keys on `reviewer`, and the audit's `files` array carries the `'👤'` attribution. This DC records the projection as covered-by-consequence.

### Apply: thread the policy into `--skip-annotated` (`apply-command.ts`)

The `--skip-annotated` check parses each resolved file at `apply-command.ts:210`. The resolution point at `apply-command.ts:159-161` (which already reads `includeDate`) resolves `impliedHuman` and computes `defaultReviewer`; the loop passes `{ defaultReviewer }` into the parse call. A bare digit then parses non-null → classified `skip-annotated` per DC.23 (default `--skip-annotated`), so the hand-typed value is not clobbered. `--overwrite` is unaffected (a bare digit is still replaced under the overwrite branch).

DC.44:derives=S004.§7.AC.07 The `apply` command MUST resolve `impliedHuman ?? true` at its existing config-read point (`apply-command.ts:159-161`, alongside `includeDate`), map it to `defaultReviewer` per DC.39a, and pass `{ defaultReviewer }` as the third argument to the `adapter.parse(content, file.filePath)` call at `apply-command.ts:210`. With the policy active and `--skip-annotated` (the default per DC.23), a file carrying a bare-digit confidence annotation MUST parse non-null and therefore be classified `skip-annotated` — left untouched on disk. When `--overwrite` is set, the bare digit MUST be replaced per the DC.23 overwrite branch, unchanged by the policy. This amends DC.23 (the parse step of the action classification) additively.

### Auto-insert: thread the policy into the precedence parse (`note-manager.ts`)

`maybeAutoInsertConfidence` (`note-manager.ts:590`) reads config at `:592` and parses for template precedence at `:611`. The method resolves `impliedHuman` and passes `{ defaultReviewer }` into the precedence parse so a note pre-seeded with a bare `confidence: 4` parses non-null and is respected (the hook returns without overwriting), rather than being clobbered with the `🤖2` default.

DC.45:derives=S004.§7.AC.08 `maybeAutoInsertConfidence` (`note-manager.ts:590`) MUST resolve `config.claims?.confidence?.impliedHuman ?? true` at its existing config read (`note-manager.ts:592`), map it to `defaultReviewer` per DC.39a, and pass `{ defaultReviewer }` as the third argument to the precedence `adapter.parse(content, notePath)` call at `note-manager.ts:611`. A note that already carries a bare-digit `confidence` value MUST therefore parse non-null, so the hook MUST NOT overwrite it (per DC.31 step 3 / {S004.§5.AC.03}) — the pre-existing bare digit MUST be respected and left unchanged. This amends DC.31 (the precedence parse step) additively.

### Write side unaffected (reaffirmed)

The policy changes only the read path. No DC in §8 introduces a bare-digit write. `mark` (§4), `apply`'s write step (§5), and auto-insert's `insert` step (DC.31 step 5/6) continue to emit an explicit-emoji annotation via `adapter.format` / `adapter.insert`, and the reviewer written continues to originate from the explicit `ai`/`human` argument or the auto-insert `🤖` default.

DC.46:4:derives=S004.§7.AC.09 No §8 DC MUST introduce a bare-digit write. `mark` (DC.15-DC.19), `apply`'s write step (DC.23 onward), and auto-insert's `insert` step (DC.31 step 5/6) MUST continue to write an explicit-emoji annotation via `adapter.format` / `adapter.insert`, regardless of the `impliedHuman` flag's state. The reviewer written MUST continue to originate from the explicit `ai`/`human` argument (mapped per DC.16) or the auto-insert `🤖` default (DC.31 step 4) — unaffected by `impliedHuman`, per {S004.§7.AC.10}.

## Wiring Map

### Import graph

```
audit-command.ts
  ├─ ../../../claims/confidence/audit  (auditConfidence, ConfidenceAuditResult)
  ├─ ../../formatters/confidence-formatter  (formatConfidenceAudit, formatConfidenceAuditPaths)
  └─ ../base-command  (BaseCommand)

mark-command.ts
  ├─ ../../../claims/confidence/registry  (getAdapter)             [from {S003}/{DD016}]
  ├─ ../../../claims/confidence  (mapReviewerArg, validateReviewerLevel)
  └─ ../base-command

apply-command.ts
  ├─ ../../../claims/confidence/registry  (getAdapter)             [from {S003}/{DD016}]
  ├─ ../../../claims/confidence/filters  (resolveFiles, FilterContradictionError, FilterSpec)
  ├─ ../../../claims/confidence  (mapReviewerArg, validateReviewerLevel)
  ├─ ../../formatters/confidence-formatter  (formatApplySummary, formatApplyPlanTable)
  └─ ../base-command

audit.ts (new)
  ├─ ../confidence  (parseConfidenceAnnotation — interim; replaced by adapter.parse via getAdapter)
  ├─ ./registry  (getAdapter)                                       [from {S003}/{DD016}]
  └─ ../../project/project-manager  (ProjectManager type)

filters.ts (new)
  ├─ ../../project/project-manager  (ProjectManager)
  ├─ glob  (glob library)
  └─ ../../types/note  (Note type)

note-manager.ts (modified)
  └─ ../claims/confidence/registry  (getAdapter)                    [from {S003}/{DD016}]
```

### Call chains

**`scepter confidence audit --paths`:**
```
audit-command action
  → BaseCommand.execute(ctx)
  → validate scope flags (XOR check)
  → auditConfidence(pm, { scope })
      → discoverSourceFiles(...)                    [if scope ∈ {source, both}]
        → for each file: getAdapter(file) → adapter.parse(content, file)
      → pm.noteManager.getNotes({})                 [if scope ∈ {notes, both}]
        → for each Note.filePath: getAdapter(file) → adapter.parse(content, file)
      → assemble ConfidenceAuditResult { bySource, byNotes, …union }
  → formatConfidenceAudit(result)                   [summary, always]
  → if --paths: formatConfidenceAuditPaths(result, { tty })  [breakdown, appended]
  → console.log(output)
```

**`scepter confidence apply human 4 --types Requirement,Spec`:**
```
apply-command action
  → BaseCommand.execute(ctx)
  → mapReviewerArg('human') → '👤'
  → validateReviewerLevel('👤', 4) → ok
  → reject if no filters supplied (DC.21)
  → resolveFiles(pm, { types: ['Requirement', 'Spec'] })
      → pm.noteManager.getNotes({ types })
      → returns ResolvedFile[] with scope='notes'
  → for each ResolvedFile (sequential per DC.28):
      → getAdapter(filePath) → adapter | null
      → if null: classify 'skip-unmatched'; continue
      → fs.readFile → content
      → adapter.parse(content, filePath) → existing | null
      → classify mark/replace/skip-annotated per DC.23
      → if --dry-run: append PlanRow; continue
      → adapter.insert(content, payload) inside try/catch
      → fs.writeFile(filePath, updated)
  → if --dry-run: formatApplyPlanTable(rows) → console.log
  → else: formatApplySummary(outcome) → console.log
  → if --verbose: formatApplyPlanTable(rows) → console.log
  → exit non-zero iff outcome.failed.length > 0
```

**`NoteManager.createNote` with auto-insert:**
```
createNote(params)
  → validate, generate id, render template
  → noteFileManager.createNoteFile(note)
  → findNoteFile(id) → filepath
  → addNoteToIndexes(note, filepath)
  → extractAndStoreReferences(note, mentions)
  → attachReferences(note)
  → note.filePath = filepath
  → maybeAutoInsertConfidence(filepath)              ← NEW
      → check claims.confidence.autoInsert === false → return
      → getAdapter(filepath) → null → return
      → fs.readFile → content
      → adapter.parse(content, filepath) → non-null → return  (template wins)
      → compute date per claims.confidence.includeDate
      → try adapter.insert(content, payload) → updated
        catch: emit warning, return (note creation succeeds)
      → fs.writeFile(filepath, updated)
  → emit('note:created', note)
  → return note
```

## Data and Interaction Flow

### Multi-scope audit data flow

1. Command parses `--source-only`/`--notes-only` into `scope: 'source' | 'notes' | 'both'`.
2. `auditConfidence(pm, { scope })` walks `discoverSourceFiles` (source) and/or `pm.noteManager.getNotes({})` (notes), concatenating relative file paths.
3. For each file, `getAdapter(file)` returns either an adapter or `null` (skipped silently per DC.08).
4. Each adapter's `parse(content, file)` returns either `ConfidenceAnnotation` or `null` (unannotated).
5. Per-scope substructures accumulate independently. Top-level fields are computed as the union (sum/concat).
6. Formatter receives the assembled `ConfidenceAuditResult`. Standard summary always emitted. `--paths` appends a per-directory breakdown using the same data — no second walk.

### Apply data flow

1. Command parses positional args, filter flags, behavior flags. Reviewer/level validated at command layer.
2. `resolveFiles(pm, spec)` returns `ResolvedFile[]`. Note-only filters route through `pm.noteManager.getNotes(query)`; source-only globs walk `sourceCodeIntegration.folders`. AND-across-categories, OR-within-category combination is applied.
3. Sequential loop: per file, classify action, optionally write, accumulate `outcome`.
4. Output: dry-run → plan table only; non-verbose → summary only; verbose → summary + plan table.
5. Exit status: 0 unless `outcome.failed.length > 0`.

### Auto-insert data flow

1. `createNote` writes the note's file (template content, possibly with author-supplied frontmatter including `confidence:`).
2. `maybeAutoInsertConfidence` reads the on-disk content (post-template-render).
3. Adapter `parse` checks for an existing `confidence:` key. If present (template precedence), the hook returns silently.
4. Otherwise, payload `{reviewer:'🤖', level:2, date:<today-or-undefined>}` is constructed.
5. Adapter `insert` produces new content; command writes it.
6. On adapter throw, hook catches, emits warning event, returns; `createNote` proceeds to `emit('note:created')` and `return note` unblocked.

## Decisions

### Decision 1 — TTY detection method

**Decision:** Use `process.stdout.isTTY` directly at the command layer, queried once before invoking the formatter. Pass the boolean into the formatter as `{ tty: boolean }`.

**Alternatives considered:**
- **Rely on chalk's auto-detection.** Chalk auto-detects TTY and dims output when piped, but it does NOT suppress decorative box-drawing characters from `cli-table3` or other formatters. Relying on chalk alone would leak box-drawing into redirected output, defeating {S004.§2.AC.10}'s grep-friendly requirement.
- **A `--no-color` flag.** Standard but partial; users redirecting to a file should not have to remember a flag. The TTY heuristic is what `chalk`, `git`, and most CLI tools use for the same case.

**Rationale:** `process.stdout.isTTY` is a Node-built-in boolean check with no library dependency. It captures the redirection case ({S004.§2.AC.10}'s exact trigger) and lets the formatter make a single binary decision. Querying once at the command layer (rather than in the formatter) keeps the formatter pure — it receives a boolean rather than reading process state — which is consistent with how `formatConfidenceAudit` already works (no global reads, all input through arguments).

### Decision 2 — Plan table library

**Decision:** Use `cli-table3` for both the dry-run plan table and the verbose post-execute table.

**Alternatives considered:**
- **Custom plain-text table** (manual padding via `padRight` like the existing formatter). Works but reinvents column alignment. The existing `table-formatter.ts` already uses `cli-table3` for similar tabular output, so adding another column-alignment scheme would be inconsistent.
- **A minimal one-row-per-line format** (no columns). Loses the alignment that makes the plan readable; rejected.

**Rationale:** `cli-table3` is already a project dependency (`core/src/cli/formatters/table-formatter.ts:2`). Reusing it keeps the table style consistent with other tabular CLI output. Under non-TTY (queried per Decision 1), `cli-table3`'s default ASCII style is already grep-friendly; the decorative box-drawing glyphs that {S004.§2.AC.10} bans appear only when the formatter chooses Unicode line characters, which the default does not.

### Decision 3 — Apply concurrency model

**Decision:** Sequential file processing — one file read, classified, optionally written, before moving to the next.

**Alternatives considered:**
- **Bounded parallelism** (e.g., `p-limit` with concurrency 8). Faster on I/O-bound runs over many files but adds a dependency, makes the failure-isolation logic more complex (which file's `failed` outcome belongs to which thread of the loop), and complicates verbose-output ordering (rows appear out of source order).
- **Unbounded parallelism** (`Promise.all` over all files). Risks file-handle exhaustion on large filesystems and produces unpredictable failure-recovery order.

**Rationale:** {S004.§4.AC.07} requires per-file failure isolation; the simplest implementation is a sequential loop with try/catch around each `adapter.insert`. The expected `apply` invocation operates on tens to a few hundred files, not thousands; sequential I/O cost is dominated by the user reading the summary, not by the loop. Parallelism is premature optimization until profiling shows otherwise. The decision is reversible — bounded parallelism can be added later without changing the command surface.

## Integration Sequence

The eight steps below land in dependency order. Each step ends in a verifiable state.

### Step 1 — Author `filters.ts` and tests

**Files:** `core/src/claims/confidence/filters.ts` (NEW)
**Changes:** Implement `FilterSpec`, `ResolvedFile`, `FilterContradictionError`, `resolveFiles`. Cover §1.AC.01-06.
**Verify:** Unit tests pass for: AND-across/OR-within combinations, glob-only matching source files, note-only filters with conflicting glob raising `FilterContradictionError`, `discoveryExclude`/`sourceCodeIntegration.exclude` honored, scope tagging including overlap precedence.
**Spec:** {S004.§1.AC.01-06}

### Step 2 — Migrate and extend `auditConfidence`

**Files:** `core/src/claims/confidence/audit.ts` (NEW), `core/src/claims/confidence.ts` (MODIFIED — remove old `auditConfidence` and the local `discoverSourceFiles` helper, OR re-export them; the helper stays in place if callers are simpler with it there).
**Changes:** New `auditConfidence(pm, options)` walking both scopes; route per file through `getAdapter`; `bySource`/`byNotes` substructures populated; top-level fields kept as union.
**Verify:** Unit tests pass for: source-only behaviour matches pre-{R013} `auditConfidence` byte-identically (top-level fields); note-only walks `discoveryPaths`; both-scope produces correct union; `getAdapter` returning null silently skips.
**Spec:** {S004.§2.AC.01-09}

### Step 3 — Wire new audit flags

**Files:** `core/src/cli/commands/confidence/audit-command.ts` (MODIFIED), `core/src/cli/formatters/confidence-formatter.ts` (MODIFIED)
**Changes:** Add `--source-only`, `--notes-only`, `--paths`. Mutual-exclusivity check for the first two. Formatter emits per-scope sections + combined totals; new `formatConfidenceAuditPaths` function emits per-directory breakdown with `{ tty }` switch.
**Verify:** Manual run:
- `scepter confidence audit` emits both scopes with combined totals (no combined %).
- `scepter confidence audit --source-only` emits only source.
- `scepter confidence audit --paths > out.txt` produces grep-friendly plain ASCII; running interactively shows colored output.
- `scepter confidence audit --source-only --notes-only` errors out before discovery.
**Spec:** {S004.§2.AC.07,.AC.10,.AC.03}

### Step 4 — Refactor `mark-command.ts`

**Files:** `core/src/cli/commands/confidence/mark-command.ts` (REFACTORED)
**Changes:** Route through `getAdapter`; null-adapter error path; `includeDate`-honored date computation; command owns I/O. The legacy `formatConfidenceAnnotation`/`insertConfidenceAnnotation` direct calls are removed from this command (they remain in `core/src/claims/confidence/index.ts` as legacy-compat wrappers per {DD016.§1.DC.06}, retired when this command's refactor lands).
**Verify:**
- `scepter confidence mark src/foo.ts ai 2` produces byte-identical output to pre-refactor on a sample `.ts` file (regression).
- `scepter confidence mark notes/R001.md human 4` writes a `confidence:` key to the frontmatter via the markdown adapter.
- `scepter confidence mark file.unknown ai 2` exits non-zero with an explicit error naming `.unknown` and the supported adapter ids.
- With `claims.confidence.includeDate: false` in config, the written annotation omits the trailing space and date.
**Spec:** {S004.§3.AC.01-06}

### Step 5 — Author `apply-command.ts`

**Files:** `core/src/cli/commands/confidence/apply-command.ts` (NEW), `core/src/cli/commands/confidence/index.ts` (MODIFIED), `core/src/cli/formatters/confidence-formatter.ts` (MODIFIED — add `formatApplySummary`, `formatApplyPlanTable`)
**Changes:** Full apply command per DC.20-28. Register on the `confidence` command group.
**Verify:**
- `scepter confidence apply` (no args) → usage error, exit 1.
- `scepter confidence apply human 4` (no filters) → "no filters supplied" error, exit 1.
- `scepter confidence apply human 4 --types Requirement --dry-run` → plan table, no writes, exit 0.
- `scepter confidence apply human 4 --types Requirement` → writes annotations on Requirements lacking one; existing annotations skipped.
- `scepter confidence apply human 4 --types Requirement --overwrite` → writes annotations on every Requirement, replacing existing.
- `scepter confidence apply human 4 --glob "**/*.ts" --types Requirement` → `FilterContradictionError`, exit 1.
- `scepter confidence apply human 4 --glob "no-such-pattern-*"` → "no files matched", exit 0.
- A `.md` file with malformed frontmatter is recorded as `failed`; other files still process; exit 1.
**Spec:** {S004.§4.AC.01-09}

### Step 6 — Wire auto-insert hook

**Files:** `core/src/notes/note-manager.ts` (MODIFIED)
**Changes:** Add private `maybeAutoInsertConfidence` method; insert single call between line 553 and line 555 of `createNote`.
**Verify:**
- `scepter create Requirement "Foo"` with `claims.confidence.autoInsert: true` (default) writes `confidence: 🤖2 <today>` into the new note's frontmatter.
- With `autoInsert: false`, no annotation is written.
- A template containing `confidence: "👤4 …"` is preserved (not overwritten).
- With `claims.confidence.includeDate: false`, the written value is `🤖2` (no date).
- A simulated `adapter.insert` throw (e.g., a template producing intentionally malformed YAML) emits a warning event and `createNote` still returns successfully.
**Spec:** {S004.§5.AC.01-07}

### Step 7 — Cross-scope regression run

**Files:** None (test execution only).
**Changes:** Run the full test suite. Verify: no existing programmatic consumer of `auditConfidence`'s top-level fields breaks; no `note:created` listener regresses on hook-emitted warnings.
**Verify:** All tests pass. `scepter claims trace S004` shows source coverage on every {S004} AC except §6.AC.01 (release-notes — documentation projection, not source).
**Spec:** {S004.§2.AC.09}, regression coverage.

### Step 8 — Documentation

**Files:** Release notes for the version landing {R013.§2}.
**Changes:** Document the audit default-scope shift (source-only → both) and the `--source-only` opt-in for legacy behavior. Document `confidence apply` and the auto-insert hook.
**Verify:** Notes exist; user can find migration guidance.
**Spec:** {S004.§6.AC.01}

### Step 9 — Thread the implied-human policy ({R017})

**Depends on:** {DD016}.§10 (the `parse` 3-arg signature, the emoji-optional grammars, and the `impliedHuman` config slot must exist), plus Steps 2, 5, 6 (audit, apply, auto-insert).
**Files:** `core/src/claims/confidence/audit.ts` (MODIFIED), `core/src/cli/commands/confidence/apply-command.ts` (MODIFIED), `core/src/notes/note-manager.ts` (MODIFIED), `core/src/cli/formatters/confidence-formatter.ts` (MODIFIED), and their test files.
**Changes:** Resolve `impliedHuman ?? true → defaultReviewer` at each read-path consumer's existing config read (DC.39, DC.39a). Thread `{ defaultReviewer }` into `adapter.parse` in `walkScope` (DC.41), `apply --skip-annotated` (DC.44), and the auto-insert precedence parse (DC.45). Add the `byReviewer` field to `ScopedAuditResult`; zero it in `emptyScopedResult`, populate it in `walkScope`, sum it in `unionScopes` (DC.40). Render it in `renderScopeSection` (DC.42). No write-path change (DC.46); no VS Code change (DC.43, consequence-only).
**Verify:**
- `scepter confidence audit` (default config) counts a note carrying a bare `confidence: 4` as annotated, attributes it to `👤` in `byReviewer` and `byLevel[4]`, and the table shows a per-reviewer breakdown.
- A `.ts` file with `// @confidence 4` is counted human-annotated under the default policy.
- With `claims.confidence.impliedHuman: false`, the same files read unannotated (today's behavior).
- `scepter confidence apply human 4 --types Requirement` skips a Requirement carrying a bare `confidence: 4` (`skip-annotated`), rather than overwriting it.
- `scepter create Requirement "Foo"` against a template pre-seeded with bare `confidence: 4` leaves the bare value intact (no `🤖2` clobber).
- VS Code confidence tree places a bare-digit file in a human tier (consequent to the `👤` parse outcome; no extension change).
- The `--format json` audit output includes `byReviewer` on each scope.
**Spec:** {S004.§7.AC.02-10}

## Acceptance Criteria Summary

| Section | DCs | S004 ACs covered |
|---|---|---|
| §1 Filter resolution | DC.01-04 | §1.AC.01-06 |
| §2 Audit migration & extension | DC.05-10 | §2.AC.01-09 |
| §3 Audit command flags | DC.11-14 | §2.AC.03,.AC.08,.AC.10 |
| §4 Mark refactor | DC.15-19 | §3.AC.01-06 |
| §5 Apply | DC.20-28 | §4.AC.01-09 |
| §6 Auto-insert hook | DC.30-33 | §5.AC.01-07 |
| §7 Formatter changes | DC.34-38 | §2.AC.07,.AC.10 ; §4.AC.05,.AC.08 |
| §8 Implied-human policy ({R017}) | DC.39, DC.39a, DC.40-46 | §7.AC.02-10 |

{S004.§6.AC.01} is a documentation projection (release notes); covered by Integration Sequence Step 8, not by a DC.

## Non-Goals

- **Adapter registry internals.** {S003}/{DD016} owns the `ConfidenceAdapter` interface, the `ConfidencePayload` type, the registry's ordering policy, and the two built-in adapters' implementations. This DD consumes them as a settled boundary.
- **Third-party adapter registration.** Out of scope per {S003} and {S004} non-goals.
- **`--all` flag for `apply`.** Out of scope per {S004} non-goals; DC.21 mandates filters.
- **`--no-downgrade` guard.** Out of scope per {R013.OQ.02}; downgrades are user discretion.
- **Per-note-type `autoInsert` overrides.** Out of scope per {S004} non-goals.
- **Named confidence presets.** Out of scope per {S004} non-goals.
- **Source-file auto-insert at creation.** Out of scope per {S004.§5.AC.07}; no `scepter create` equivalent for source files exists.
- **Removal command.** Out of scope per {S003} non-goals.
- **Bounded-parallel apply execution.** Per Decision 3, sequential is the chosen model; parallelism is reversible future optimization.

## References

- {S004} — The spec this DD implements.
- {S004.§1} — Filter semantics (cross-cutting).
- {S004.§2} — `confidence audit` multi-scope.
- {S004.§3} — `confidence mark` adapter routing.
- {S004.§4} — `confidence apply` bulk command.
- {S004.§5} — Auto-insert on note creation.
- {S004.§6} — Migration and backward compatibility.
- {S004.§7} — Implied-human policy: config and read-path consumers. §8 concretizes the command-layer half: flag resolution ({S004.§7.AC.02}, {S004.§7.AC.03}), audit count + `byReviewer` tally ({S004.§7.AC.04}, {S004.§7.AC.05}), formatter/VS Code bucketing ({S004.§7.AC.06}), apply skip ({S004.§7.AC.07}), auto-insert precedence ({S004.§7.AC.08}), write-side-unaffected ({S004.§7.AC.09}, {S004.§7.AC.10}).
- {R017} — Implied-human read-time confidence defaulting. §8 implements the command-layer threading; {DD016}.§10 implements the adapter-layer mechanism. Origin task {T006}.
- {T006} — Origin task carrying the full design, resolved decisions, and code touch-points.
- {S003} — Adapter registry (consumed dependency).
- {S003.§6} — Implied-human read-time parse grammar and the `defaultReviewer` parse parameter ({S003.§1.AC.08}) — the boundary §8 threads `defaultReviewer` into, implemented by {DD016}.§10.
- {S003.§1} — Adapter interface and `ConfidencePayload`.
- {S003.§2} — Registry mechanics, `getAdapter(filePath)`.
- {S003.§3} — C-family adapter (preserves source-file behavior byte-identically).
- {S003.§4} — Markdown frontmatter adapter (`gray-matter` round-trip).
- {S003.§5} — Cross-cutting invariants (validation at command layer, side-effect freedom).
- {DD016} — Adapter registry implementation DD (settled; ships `core/src/claims/confidence/{registry,types,adapter,audit,index}.ts` and `confidence/adapters/{c-family,markdown-frontmatter}.ts`). {DD016}.§10 ({R017}) adds the `parse` `defaultReviewer` parameter, the emoji-optional grammars, the frontmatter YAML-number coercion, and the `impliedHuman` config slot — the adapter-layer boundary §8 consumes.
- {R013.§1} — Pluggable annotation adapters (upstream requirement; §1.AC.06 = `includeDate`).
- {R013.§2} — Audit scope (upstream; §2.AC.05 = `--paths`).
- {R013.§3} — Bulk apply (upstream).
- {R013.§4} — Auto-insert on note creation (upstream).
- {R004.§7} — Original confidence subsystem.
- `docs/architecture/ARCHITECTURE_OVERVIEW.md` — Subsystem map; this DD's modules sit in `core/src/claims/confidence/` and `core/src/cli/commands/confidence/`.
- `core/src/claims/confidence.ts` — Existing implementation; migration source for §2's `audit.ts`.
- `core/src/cli/commands/confidence/audit-command.ts` — Existing audit command; extension target.
- `core/src/cli/commands/confidence/mark-command.ts` — Existing mark command; refactor target.
- `core/src/cli/commands/confidence/index.ts` — Command group registration.
- `core/src/cli/formatters/confidence-formatter.ts` — Formatter; extension target. §8 renders the `byReviewer` breakdown in `renderScopeSection` (`:94`).
- `core/src/notes/note-manager.ts` — `createNote` (line 436); auto-insert hook insertion point. §8 threads `defaultReviewer` into the precedence parse at `:611`.
- `core/src/claims/confidence/audit.ts` — `walkScope` (`:142`), `auditConfidence` (`:218`), `ScopedAuditResult` (`:42`), `emptyScopedResult` (`:74`), `unionScopes` (`:186`) — §8 threads `defaultReviewer` and adds `byReviewer`.
- `core/src/cli/commands/confidence/apply-command.ts` — `--skip-annotated` parse (`:210`); §8 threads `defaultReviewer` resolved at `:159-161`.
- `vscode/src/views/confidence-tree-provider.ts:118` — reviewer bucketing (`ann.reviewer === '👤'`); bare-digit files land in the human bucket by consequence of the parse attribution (DC.43, no code change).
