---
created: 2026-05-05T15:25:45.341Z
tags: [confidence, audit, apply, mark, auto-insert, cli, specification]
status: draft
---

# S004 - Confidence command surface and creation hook

## Context

This specification consolidates the command-surface contracts for {R013.§2}, {R013.§3}, {R013.§4}, plus the registry-routing refactor that {S003} implies for the existing `confidence mark` command, plus the read-path command-layer half of the {R017} implied-human policy (§7). {S003} fixes the adapter registry — `getAdapter(filePath)`, the `ConfidencePayload` type, and first-match-wins lookup — and is a normative dependency: every command surface here is a consumer of that registry. {S003.§6} (the implied-human parse grammar and the `defaultReviewer` parse parameter) is the normative dependency for §7. {R004.§7} established the original confidence subsystem (audit and mark scoped to source files; the `claims.confidence.autoInsert` flag declared but unwired) and is the upstream contract this spec extends.

Scope here is contractual command behavior. The adapter registry's internals are owned by {S003} and are out of scope. The on-disk payload format and structured-vs-string frontmatter shape are settled by {R013} and {S003}; this spec does not relitigate them.

## Overview

Four command surfaces are specified:

1. **`confidence audit`** — extends to walk both source and note scopes and emits per-scope coverage breakdowns.
2. **`confidence mark`** — refactored to route through the adapter registry so it works on `.md` notes as well as source files.
3. **`confidence apply`** — new bulk command. Resolves a filter set into a target file list, routes each file through the registry, applies the annotation per behavior modifiers, and reports per-file outcomes.
4. **Auto-insert hook** — wires `claims.confidence.autoInsert` into the `scepter create` flow so newly created notes acquire a `🤖2 <today>` annotation by default.

A fifth, cross-cutting section (§7) factors the {R017} implied-human read-path policy: the `claims.confidence.impliedHuman` config flag, its resolution, the threading of the resolved `defaultReviewer` into each read-path consumer's `parse` call, and the audit per-reviewer breakdown that bucketing consumes.

A cross-cutting filter-semantics section (§1) factors the rules shared by `audit` (scope flags) and `apply` (target selection) so the per-command sections can reference rather than restate.

## §1 Filter semantics (cross-cutting)

Filters select target files and are reused across `audit` (scope toggles) and `apply` (target selection plus per-category filters). The rules below are the single source of truth for filter behavior; §2 and §3 reference this section instead of restating it.

The filter resolver returns a list of `{filePath, scope}` tuples where `scope ∈ 'source' | 'notes'`. Downstream commands route each tuple through `getAdapter(filePath)` per {S003.§2}; the resolver itself does not consult the adapter registry.

§1.AC.01:derives=R013.§3.AC.02 The filter vocabulary supported by `apply` MUST be `--types <T1,T2,...>`, `--tags <t1,t2,...>`, `--ids <ID1,ID2,...>`, and `--glob <pattern>`. The audit command MUST additionally support `--source-only` and `--notes-only` scope toggles per {R013.§2.AC.02}; these toggles are mutually exclusive and are NOT available to `apply`.

§1.AC.02:derives=R013.§3.AC.02 Filter combination semantics MUST be AND across categories and OR within a category. For example, `--types Requirement,Spec --tags security` MUST resolve to "(Requirement OR Spec) AND tagged security."

§1.AC.03:derives=R013.§3.AC.05 The `--types`, `--tags`, and `--ids` filters MUST select only notes; source files have no SCEpter metadata and MUST NOT be selectable through these categories. The `--glob` filter is the only filter that can match source files.

§1.AC.04:derives=R013.§3.AC.06 When the resolved filter set combines a note-only category (`--types`, `--tags`, or `--ids`) with a `--glob` whose matches lie entirely outside the project's `discoveryPaths` (i.e., yields only source files), the resolver MUST raise a clear error naming the contradiction, rather than silently returning an empty result.

§1.AC.05 The `--glob` pattern MUST be evaluated relative to the project root. Resolution MUST respect both `discoveryExclude` (for note-scope candidates) and `sourceCodeIntegration.exclude` (for source-scope candidates); files matching either exclusion MUST be omitted from the resolved set.

§1.AC.06 The resolver MUST tag each resolved file's scope as `'source'` when the file resides under `sourceCodeIntegration.folders`, and as `'notes'` when the file resides under `discoveryPaths`. A file matching both roots MUST be classified as `'notes'` (notes win the overlap; this is consistent with discovery precedence elsewhere in the system).

## §2 `confidence audit` — multi-scope

The existing `auditConfidence` walks only source files via `discoverSourceFiles`. This section extends the command to walk both source files and notes, route each through `getAdapter`, and emit per-scope coverage breakdowns. Default invocation (no flags) shifts from "source only" to "both scopes" — an intentional behavior change documented in §6.

The audit result substructure carries the per-scope coverage fields enumerated in §2.AC.05 (`total`, `annotated`, `unannotated`, `byLevel`, `files`, `unannotatedFiles`). {R017} adds one further additive field, `byReviewer` (a per-reviewer annotated-file tally), specified in §7.AC.05 — it parallels `byLevel` and is consumed by the human/AI bucketing. The §2.AC.05 enumeration is unchanged; `byReviewer` is additive on top of it.

§2.AC.01:derives=R013.§2.AC.01 `scepter confidence audit` MUST discover source files via the existing `sourceCodeIntegration.folders × extensions × exclude` rules, MUST discover notes via `discoveryPaths` glob-walking for `.md` files (subject to `discoveryExclude`), and MUST aggregate annotation coverage independently for each scope.

§2.AC.02:derives=R013.§2.AC.04 Note-scope discovery MUST follow the project's `discoveryPaths` config exclusively; source-scope discovery MUST follow `sourceCodeIntegration.folders` exclusively. The two configs MUST NOT be cross-consulted (notes are not discovered by walking source folders, and source files are not discovered by walking `discoveryPaths`).

§2.AC.03:derives=R013.§2.AC.02 The `--source-only` flag MUST restrict discovery and reporting to the source scope. The `--notes-only` flag MUST restrict discovery and reporting to the note scope. The two flags MUST be mutually exclusive; supplying both MUST raise a clear error.

§2.AC.04 Each discovered file MUST be processed by the adapter returned from `getAdapter(filePath)`. Files for which `getAdapter` returns `null` MUST be omitted from the audit silently — neither annotated nor unannotated counts include them — consistent with {S003.§2.AC.05}'s no-adapter-outcome contract.

§2.AC.05:derives=R013.§2.AC.03 The `ConfidenceAuditResult` MUST gain a per-scope breakdown structure containing `bySource` and `byNotes` substructures. Each substructure MUST carry the existing fields: `total`, `annotated`, `unannotated`, `byLevel` (1-5 counts), `files` (annotated entries), and `unannotatedFiles` (paths). The top-level `total`, `annotated`, `unannotated`, `byLevel`, `files`, and `unannotatedFiles` fields MUST be the union across scopes (sums for counts, concatenation for arrays).

§2.AC.06 Coverage percentages MUST be computed per scope (`annotated ÷ total` within that scope). The audit output MUST NOT emit a single combined percentage that mixes denominators across scopes, consistent with {R013.§2.AC.03}.

§2.AC.07 The default formatter (`--format table`) MUST emit two clearly delimited per-scope sections (each with its own header, count totals, percentage, and per-level breakdown) when both scopes are populated, followed by a combined-totals line that sums file counts but does NOT compute a combined percentage. When `--source-only` or `--notes-only` is set, the formatter MUST emit only the requested scope's section and MUST omit the combined-totals line.

§2.AC.08 The `--unannotated` flag MUST list unannotated files across whatever scopes are active (both by default; one when scope-toggled). The `--level <n>` flag MUST filter annotated files across whatever scopes are active. Output for these flags MUST tag each file with its scope (`source` or `notes`) when both scopes are active, so users can distinguish.

§2.AC.09 The `auditConfidence` library function MUST preserve its existing top-level fields (`total`, `annotated`, `unannotated`, `byLevel`, `files`, `unannotatedFiles`) so existing programmatic consumers continue to function without change. The new `bySource` and `byNotes` substructures are additive.

§2.AC.10:derives=R013.§2.AC.05 A `--paths` flag MUST extend `audit` to emit a per-file breakdown listing every discovered file with its annotation state (annotation string when present, `unannotated` marker when absent), grouped by directory. Output MUST be plaintext-friendly: when stdout is not a TTY (e.g., redirected to a file), the formatter MUST suppress ANSI color codes and decorative box-drawing characters so the captured output is grep-friendly. `--paths` MUST be compatible with `--source-only` and `--notes-only` (scoping the breakdown), with `--unannotated` (limiting the breakdown to unannotated files), and with `--level <n>` (limiting to a specific level). The breakdown MUST be emitted IN ADDITION TO the standard summary (the summary appears at the top); the breakdown is appended below.

## §3 `confidence mark` — adapter routing

The existing `mark <file> <ai|human> <level>` command calls `formatConfidenceAnnotation` and `insertConfidenceAnnotation` directly, hardcoded to C-family comments. With {S003} in place, `mark` MUST route through `getAdapter(filePath)` so the same command works on `.md` notes via the markdown-frontmatter adapter. Behavior on source files MUST be byte-identical to the current implementation per {S003.§3.AC.06}.

§3.AC.01:derives=R004.§7.AC.02 `mark <file> <ai|human> <level>` MUST resolve the adapter via `getAdapter(filePath)`. When `getAdapter` returns `null`, the command MUST exit with a non-zero status and a clear error message naming the file's extension and the supported adapter ids (e.g., `markdown-frontmatter`, `c-family-comments`); it MUST NOT silently no-op.

§3.AC.02 Reviewer mapping (`ai → 🤖`, `human → 👤`) and reviewer/level validation (AI levels 1-3, Human levels 3-5) MUST run at the command layer before any adapter call, consistent with {S003.§5.AC.03}. Adapters MUST NOT be invoked with a payload that violates the reviewer/level rule.

§3.AC.03:derives=R013.§1.AC.06 The date supplied to `adapter.format(reviewer, level, date)` and `adapter.insert(content, payload)` MUST be the current local date in ISO `YYYY-MM-DD` form when `claims.confidence.includeDate` is `true` (the default). When `claims.confidence.includeDate` is `false`, the command MUST pass `date: undefined` to the adapter, yielding the bare `<emoji><level>` payload form per {S003.§5.AC.02}. This rule is shared by `apply` (§4) and the auto-insert hook (§5); each downstream command references this AC rather than restating the policy.

§3.AC.04 On `.md` notes, the markdown-frontmatter adapter from {S003.§4} MUST be selected. The annotation MUST be written as a string scalar `confidence:` key in the file's YAML frontmatter, with no other frontmatter keys disturbed. When the file has no frontmatter, the adapter creates one per {S003.§4.AC.05}; when the key is already present, the adapter replaces only its value per {S003.§4.AC.07}.

§3.AC.05 On source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.css`), `mark`'s output MUST be byte-identical to the pre-{R013} implementation: the same annotation string, the same insertion point (after the first JSDoc end or at the top), the same in-place replacement when an annotation already exists. This invariant follows from {S003.§3.AC.06}.

§3.AC.06 The command MUST write the adapter's output to disk via a single `fs.writeFile` call after `adapter.insert` returns, using the same path supplied by the user. The adapter performs no I/O; the command owns the read and write.

## §4 `confidence apply` — bulk

A new `confidence apply <ai|human> <level> [filters] [behavior modifiers]` command applies the annotation across multiple files in one invocation. The command resolves filters per §1, routes each resolved file through `getAdapter(filePath)`, and applies the annotation according to behavior flags.

§4.AC.01:derives=R013.§3.AC.01 The system MUST expose `scepter confidence apply <ai|human> <level>` accepting the §1 filter flags (`--types`, `--tags`, `--ids`, `--glob`) plus the behavior modifiers `--skip-annotated` (default `true`), `--overwrite` (default `false`), `--dry-run` (default `false`), and `--verbose` (default `false`). Reviewer mapping and reviewer/level validation MUST run at the command layer per §3.AC.02. The date passed to adapter operations MUST honor `claims.confidence.includeDate` per §3.AC.03 (current date when `true`; `undefined` when `false`).

§4.AC.02 Invoking `apply` with no filter flags MUST raise a clear error and exit with non-zero status. The command MUST NOT march across every discoverable file when filters are absent. (An explicit `--all` flag is out of scope for this spec.)

§4.AC.03:derives=R013.§3.AC.03 When `--skip-annotated` is true (the default), files for which `adapter.parse(content, filePath)` returns a non-null `ConfidenceAnnotation` MUST be left untouched on disk and MUST be recorded under a `skipped-annotated` outcome. When `--overwrite` is true, files MUST be re-annotated regardless of any existing annotation; the `--skip-annotated` default MUST be effectively suppressed when `--overwrite` is set.

§4.AC.04 The `--overwrite` flag MUST replace the existing annotation with the new payload regardless of the current level or reviewer. The command MUST NOT block downgrades (e.g., replacing `👤4` with `🤖2`) — this is left to user discretion per {R013.OQ.02}, and a `--no-downgrade` guard is out of scope for this spec.

§4.AC.05:derives=R013.§3.AC.04 When `--dry-run` is set, the command MUST emit an operation plan and MUST NOT write any file to disk. The plan MUST be a per-file table with columns `path`, `scope`, `current`, `proposed`, and `action`, where `action ∈ {'mark', 'replace', 'skip-annotated', 'skip-unmatched'}`. The `current` column MUST show the existing annotation string when one exists, or a placeholder (`-`) when absent. The `proposed` column MUST show the formatted annotation that would be written.

§4.AC.06:derives=R013.§3.AC.07 When `getAdapter(filePath)` returns `null` for a resolved file, the command MUST record the file under the `skipped-unmatched` outcome, MUST NOT abort, and MUST continue processing remaining files. The output MUST surface a per-file count of skipped-unmatched files at the end.

§4.AC.07 Per-file failures during `adapter.insert` (including the `FRONTMATTER_PARSE_ERROR` case from {S003.§4} when an existing markdown file has malformed YAML) MUST be caught and recorded under a `failed` outcome with the underlying error message; the command MUST continue processing remaining files. The command MUST exit with non-zero status if any `failed` outcomes occurred, even when other files succeeded.

§4.AC.08 The default (non-dry-run, non-verbose) output MUST emit count totals: `marked`, `replaced`, `skipped-annotated`, `skipped-unmatched`, and `failed`. When `--verbose` is set, the output MUST additionally include the per-file table specified in §4.AC.05.

§4.AC.09 When the resolved filter set yields zero files, the command MUST exit with status 0 and emit a clear "no files matched" message. This case MUST be distinguished from the §4.AC.02 error (filters absent entirely): zero matches with filters present is a successful no-op; absent filters is a usage error.

## §5 Auto-insert on note creation

The `claims.confidence.autoInsert` flag is declared in `ClaimConfig` but currently unwired. This section realizes the flag for the `scepter create` flow so newly created notes acquire a default annotation. The hook routes through the adapter registry so it inherits whatever adapter handles `.md` files (the markdown-frontmatter adapter from {S003.§4} today).

§5.AC.01:derives=R013.§4.AC.01 After `NoteManager.createNote` writes the new note's file to disk and BEFORE returning the `Note` to the caller, the system MUST invoke an auto-insert hook against the new note's file path. The hook's logical position is post-file-write, pre-return; the exact symbol layout is a detailed-design concern.

§5.AC.02:derives=R013.§4.AC.01 When `claims.confidence.autoInsert` is `true` (the documented default per `ClaimConfig.confidence.autoInsert`), the hook MUST call `getAdapter(notePath)`, MUST call `adapter.parse(content, notePath)` against the file's current content, and MUST call `adapter.insert(content, {reviewer: '🤖', level: 2, date: <today-or-undefined>})` only when `parse` returns `null`. The `date` field of the payload MUST honor `claims.confidence.includeDate` per §3.AC.03 — current date in ISO `YYYY-MM-DD` when `true`, `undefined` when `false`.

§5.AC.03:derives=R013.§4.AC.03 When `adapter.parse(content, notePath)` returns a non-null annotation (e.g., the note's template supplied an explicit `confidence:` value), the auto-insert hook MUST NOT overwrite it; the explicit value MUST take precedence regardless of the `autoInsert` flag's value.

§5.AC.04:derives=R013.§4.AC.02 When `claims.confidence.autoInsert` is `false`, the hook MUST be a no-op. No `getAdapter`, `parse`, or `insert` call MUST occur, and the new note's file MUST be left as written by the template.

§5.AC.05 When `getAdapter(notePath)` returns `null` (a note shape with no registered adapter — not currently possible since note creation always produces `.md`, but specified for forward compatibility), the hook MUST be a silent no-op. No error MUST be raised.

§5.AC.06 If `adapter.insert` throws during auto-insert (e.g., the template produced malformed frontmatter), the hook MUST catch the error, MUST emit a non-fatal warning (via the existing `NoteManager` warning channel or the equivalent CLI-visible diagnostic), and MUST allow the `createNote` call to return the `Note` successfully without the annotation. Note creation is the user's primary intent; the confidence annotation is metadata and MUST NOT block primary intent.

§5.AC.07:derives=R013.§4.AC.04 The auto-insert hook MUST apply only to the note-creation path. No source-file creation path consults the hook (none exists in `scepter` today), and no other note-mutation path (rename, edit, archive) MUST trigger auto-insert.

## §6 Migration and backward compatibility

This section is informative; the only normative claim is §6.AC.01.

The audit default-scope shift (source-only → both) is the only externally visible behavior change for users who do not opt into new flags. Projects that rely on `scepter confidence audit`'s output mentioning only source files MUST migrate to invoking `--source-only` explicitly. This change is intentional per {R013.§2}'s framing — the prior default produced misleading "high coverage" numbers when notes were uncovered.

`mark`'s behavior on source files is preserved byte-for-byte per §3.AC.05 and {S003.§3.AC.06}; existing scripts that invoke `mark` against `.ts`/`.css`/etc. need no changes. New behavior on `.md` files is additive — prior invocations against `.md` files would have produced confused output (no JSDoc, no comment syntax) and are not a contract this spec preserves.

The `auditConfidence(...)` library API gains the additive `bySource` and `byNotes` substructures. Existing programmatic consumers reading only the top-level fields (`total`, `byLevel`, `files`, etc.) continue to function unchanged per §2.AC.08.

§6.AC.01 Release notes for the version that lands {R013.§2} MUST document the audit default-scope change as a behavior break, naming `--source-only` as the explicit-opt-in form for the prior behavior.

## §7 Implied-human policy: config and read-path consumers

{R017} adds a read-time defaulting policy: when active, a confidence annotation whose level digit carries no leading emoji reads as a human (`👤`) annotation. {S003.§6} specifies the parse-grammar mechanism (the emoji-optional grammar and the OPTIONAL `defaultReviewer` parameter on `parse`, per {S003.§1.AC.08}). This section specifies the command-layer half: the `claims.confidence.impliedHuman` config flag, its resolution, and the threading of the resolved `defaultReviewer` into each read-path consumer's `parse` call so that a bare-digit annotation is observed as a human annotation wherever annotation state is consumed.

Three read-path consumers parse on-disk content and must honor the policy: the audit walk (§2), the `apply --skip-annotated` check (§4), and the auto-insert precedence check (§5). All three already hold the project config at their call site, so each resolves the flag locally and passes the mapped `defaultReviewer` into `adapter.parse`. The write paths (`mark`, `apply`'s write step, auto-insert's `insert` step) are unaffected — the policy widens only what is read, never what is written.

### Configuration flag

The flag lives in the existing `claims.confidence` config block alongside `autoInsert` and `includeDate`, defaults active, and resolves with the same `?? true` pattern those flags use.

§7.AC.01:4:derives=R017.AC.08 A `claims.confidence.impliedHuman` boolean configuration field MUST control the implied-human policy. It MUST reside in the same `claims.confidence` block as `autoInsert` and `includeDate`. `true` activates bare-digit-reads-as-human; `false` deactivates it.

§7.AC.02:derives=R017.AC.09 The `impliedHuman` flag MUST default to active when unset: each read-path consumer MUST resolve it as `config.claims?.confidence?.impliedHuman ?? true`, so that a project with no `impliedHuman` key gets bare-digit-reads-as-human behavior. (This mirrors the `includeDate ?? true` resolution already used in §3.AC.03 and §5.AC.02.)

### Resolution and threading

Each read-path consumer maps the resolved boolean to the `defaultReviewer` value {S003.§1.AC.08} expects and passes it as the `parse` options parameter.

§7.AC.03:4:derives=R017.AC.08 Each read-path consumer (audit, `apply --skip-annotated`, auto-insert precedence) MUST map the resolved `impliedHuman` boolean to the `defaultReviewer` parse-policy value — `true → '👤'`, `false → null` — and MUST pass it as the `options.defaultReviewer` argument to every `adapter.parse(content, filePath, options)` call it makes on the read path. A consumer that does not resolve the flag (passing no options) MUST, per {S003.§1.AC.08}, get today's behavior (bare digit unrecognized).

### Audit: count bare digit as human, with a per-reviewer breakdown

With the policy threaded into the audit walk, a file carrying a bare-digit annotation parses to a non-null `ConfidenceAnnotation` with `reviewer: '👤'`, so it is counted as annotated and its level lands in `byLevel`. The audit result additionally gains a per-reviewer tally so consumers can bucket human vs AI coverage directly rather than re-deriving it from the per-file `files` array.

§7.AC.04:4:derives=R017.AC.10 With `impliedHuman` resolved active, `scepter confidence audit` MUST count a file carrying a bare-digit confidence annotation as annotated (not unannotated), and its level MUST be included in the scope's `byLevel` tally, in both the `bySource`/`byNotes` substructures and the top-level union (§2.AC.05).

§7.AC.05:4:derives=R017.AC.10 The audit result substructure (`ScopedAuditResult`, and by extension the top-level union and the `bySource`/`byNotes` substructures per §2.AC.05) MUST gain an additive `byReviewer` breakdown: a per-reviewer count of annotated files keyed by reviewer (at minimum `'🤖'` and `'👤'` counts). A bare-digit-annotated file MUST contribute to the `'👤'` count. The `byReviewer` breakdown MUST union across scopes the same way `byLevel` does (per-reviewer sums). This is additive to the §2.AC.05 substructure and MUST NOT remove or alter the existing `total`, `annotated`, `unannotated`, `byLevel`, `files`, or `unannotatedFiles` fields.

§7.AC.06:derives=R017.AC.10 The audit table formatter (§2.AC.07) MUST surface the per-reviewer breakdown (human vs AI annotated-file counts) alongside the existing per-level breakdown, per scope. The downstream human/AI bucketing that consumes the audit result (including the VS Code confidence tree, which buckets by `reviewer === '👤'`) MUST place a bare-digit-annotated file in the human bucket, consequent to its `reviewer: '👤'` parse outcome under §7.AC.04.

### Apply: bare digit is "already annotated"

§7.AC.07:derives=R017.AC.11 With `impliedHuman` resolved active, `scepter confidence apply` with `--skip-annotated` (the default per §4.AC.03) MUST treat a file carrying a bare-digit confidence annotation as already annotated: the threaded `adapter.parse(content, filePath, {defaultReviewer: '👤'})` returns non-null, so the file MUST be left untouched on disk and recorded under the `skipped-annotated` outcome (§4.AC.03), rather than overwriting the hand-typed value. When `--overwrite` is set, the bare digit MUST be replaced per §4.AC.03's overwrite branch, unchanged by the policy.

### Auto-insert: respect a pre-existing bare digit

§7.AC.08:derives=R017.AC.12 With `impliedHuman` resolved active, the auto-insert-on-create hook (§5) MUST thread `{defaultReviewer: '👤'}` into its precedence `adapter.parse(content, notePath, options)` call (§5.AC.02). A note that already carries a bare-digit `confidence` value MUST therefore parse non-null, so the hook MUST NOT overwrite it (§5.AC.03) — the pre-existing bare digit MUST be respected as an existing annotation and left unchanged, rather than being clobbered with the `🤖2` default.

### Write side unaffected

The policy changes only the read path. Every write path continues to emit an explicit emoji, and the reviewer written continues to originate from the explicit `ai`/`human` argument (or the auto-insert default), as already specified.

§7.AC.09:4:derives=R017.AC.13 The `impliedHuman` policy MUST NOT cause any writing path to emit a bare digit. `mark` (§3), `apply`'s write step (§4), and auto-insert's `insert` step (§5.AC.02) MUST continue to write an explicit-emoji annotation via `adapter.format` / `adapter.insert`, regardless of the flag's state.

§7.AC.10:derives=R017.AC.14 The reviewer written by `mark`, `apply`, and auto-insert MUST continue to originate from the explicit `ai`/`human` argument (mapped at the command layer per §3.AC.02) or the auto-insert `🤖` default (§5.AC.02), unaffected by `impliedHuman`. The policy MUST NOT alter what is written under any flag state.

## Acceptance Criteria Summary

| Section | Count |
|---------|-------|
| §1 Filter semantics | 6 |
| §2 `confidence audit` — multi-scope | 10 |
| §3 `confidence mark` — adapter routing | 6 |
| §4 `confidence apply` — bulk | 9 |
| §5 Auto-insert on note creation | 7 |
| §6 Migration and backward compatibility | 1 |
| §7 Implied-human policy: config and read-path consumers | 10 |
| **Total** | **49** |

## Non-Goals / Out of Scope

- **Adapter registry internals.** {S003} owns the `ConfidenceAdapter` interface, `getAdapter` lookup, ordering policy, and the two built-in adapters' implementations. This spec consumes the registry but does not redefine it.
- **Structured-object frontmatter shape.** Per {R013} Non-Goals, the markdown frontmatter adapter stores a string scalar. This spec does not introduce a structured form.
- **Per-note-type `autoInsert` overrides.** `claims.confidence.autoInsert` is a single project-wide boolean. Per-type knobs (e.g., "auto-insert for Requirement but not Task") would justify a future requirement.
- **Named confidence presets.** Aliases like `--preset reviewed` for `human 4` are deferred to a future requirement.
- **`--no-downgrade` guard for `apply --overwrite`.** Per {R013.OQ.02}, downgrades are user discretion. A future flag may emerge if downgrades become a footgun.
- **Third-party adapter registration.** The registry's extensibility hook is informative in {S003.§2}; this spec assumes only the two built-in adapters.
- **Source-file auto-insert at creation.** No `scepter create` equivalent exists for source files. The auto-insert hook applies to notes only per §5.AC.06.
- **`--all` flag for `apply`.** §4.AC.02 mandates filters; an unfiltered "apply to everything" mode is deferred.
- **Removal command.** No `scepter confidence remove <file>` is specified. Removing an annotation is a future operation.
- **Audit output persistence.** Audit results are not stored; no migration of historical audit output is implied.

## References

- {R013.§2} — Source requirement: audit scope spanning notes and source.
- {R013.§3} — Source requirement: bulk apply.
- {R013.§4} — Source requirement: auto-insert on note creation.
- {R013.OQ.02} — Open question: `--overwrite` and confidence downgrades; default assumption preserved here.
- {S003.§1} — Adapter interface (`matches`, `parse`, `format`, `insert`) and `ConfidencePayload` type — consumed by every command in this spec.
- {S003.§2} — Registry mechanics and `getAdapter(filePath)` lookup contract — the dispatch primitive every command uses.
- {S003.§3} — C-family adapter behavioral equivalence — preserves `mark` and `audit` source-file behavior byte-identically.
- {S003.§4} — Markdown frontmatter adapter — the new shape `mark`, `apply`, and the auto-insert hook write through on `.md` files.
- {S003.§5} — Cross-cutting invariants; §5.AC.03 (validation at command layer) is upstream of §3.AC.02 here.
- {S003.§6} — Implied-human read-time parse grammar and the `defaultReviewer` parse parameter ({S003.§1.AC.08}) — the normative dependency for §7; §7 resolves the `impliedHuman` flag and threads the mapped value into the consumers' `parse` calls.
- {R017} — Implied-human read-time confidence defaulting. §7 concretizes the command-layer half: config flag ({R017.AC.08}, {R017.AC.09}), threading ({R017.AC.08}), audit count + per-reviewer breakdown ({R017.AC.10}), apply skip ({R017.AC.11}), auto-insert precedence ({R017.AC.12}), and write-side-unaffected ({R017.AC.13}, {R017.AC.14}). Origin task {T006}.
- `core/src/claims/confidence.ts` — Existing `auditConfidence`, `parseConfidenceAnnotation`, `insertConfidenceAnnotation`, `formatConfidenceAnnotation`, `validateReviewerLevel`, `mapReviewerArg`. Audit walking and command-layer validation are extended/preserved here.
- `core/src/cli/commands/confidence/audit-command.ts` — Existing audit command shape extended in §2.
- `core/src/cli/commands/confidence/mark-command.ts` — Existing mark command refactored in §3 to consume `getAdapter`.
- `core/src/notes/note-manager.ts` — `NoteManager.createNote` (line 436); the auto-insert hook in §5 attaches between `noteFileManager.createNoteFile(note)` (line 520) and the `return note` exit.
- `core/src/types/config.ts` — `ClaimConfig.confidence` block (`autoInsert`, `includeDate`); §5 realizes `autoInsert`, and §7 adds the `impliedHuman` field to the same block.
- `core/src/claims/confidence/audit.ts` — `walkScope` calls `adapter.parse` (the read path §7 threads `defaultReviewer` into); `ScopedAuditResult`/`ConfidenceAuditResult` gain the additive `byReviewer` field per §7.AC.05.
- `core/src/cli/commands/confidence/apply-command.ts` — `apply --skip-annotated`'s `adapter.parse` call (the read path §7 threads `defaultReviewer` into per §7.AC.07).
- `core/src/claims/confidence/adapters/c-family.ts`, `core/src/claims/confidence/adapters/markdown-frontmatter.ts` — the two adapters whose `parse` accepts the §7-threaded `defaultReviewer` per {S003.§6}.
