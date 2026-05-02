---
created: 2026-05-01T02:29:46.934Z
status: draft
tags: [cross-project,references,aliases,vscode,documentation]
---

# DD015 - Cross-Project Reference Resolution: Implementation Across Core, VS Code, and Agent Documentation

**Requirement:** {R011}
**Derives from:** R011 §1 (Alias Configuration), §2 (Reference Syntax and Resolution), §3 (CLI Behavior), §4 (VS Code Extension Behavior), §5 (Agent-Facing Documentation Updates)

## Specification Scope

This DD plans the implementation of R011 in full — all 37 ACs across §1-§5. It spans three execution domains:

- **Core CLI library** (`core/src/`) — config schema, parser grammar extension, peer-project resolver, lint/index/trace/show/gather behavior. Derives from R011 §1, §2, §3.
- **VS Code extension** (`vscode/src/`) — pattern matcher, alias-aware claim index, hover/definition/decoration/diagnostics providers, sidebar views, configuration UX. Derives from R011 §4.
- **Agent-facing documentation** (`claude/skills/scepter/`) — claim grammar, cross-project section, hard-rules updates, CLI reference. Derives from R011 §5. (Edits to `claude/agents/` dispatch templates are explicitly out of scope per R011 §Non-Goals — agents inherit cross-project grammar transitively from the skill files.)

The DD treats the three domains as a single feature because the pieces are interdependent: the parser grammar (core) is the contract the extension's pattern matcher (VS Code) and the agent grammar reference (docs) both consume. Implementing them in three separate DDs would risk drift between the projections.

**Open questions resolved at the DD level (pre-implementation defaults):**
- **OQ.02** (alias name character set): kebab-case `[a-z][a-z0-9-]*` with no leading/trailing hyphens. Permissive enough for `vendor-lib`, `team-platform`; restrictive enough that an alias name is visually unmistakable for a note-ID prefix or a metadata token.
- **OQ.03** (config key name): `projectAliases`, matching the R011.§1.AC.01 default and the existing camelCase convention in `SCEpterConfig` (`discoveryPaths`, `discoveryExclude`, `noteTypes`, `statusSets`, `timestampPrecision`).
- **OQ.04** (gather behavior): stub-only by default; no `--follow-aliases` flag in this implementation. Adding the flag is a follow-up.
- **OQ.05** (validation timing): eager at config load with results cached for the CLI invocation lifetime. Matches R011.§1.AC.06 and §2.AC.06's caching guidance.
- **OQ.06** (version pinning): not implemented. Out of scope per R011 Non-Goals.

The DD assumes these defaults; if the user/orchestrator wants different defaults, the affected sections (§Module Inventory entries, §Wiring Map, §Integration Sequence) need revisiting before implementation begins.

**Open questions explicitly deferred (not addressed by this DD):**
- Whether the resolver should support a `--follow-aliases` mode for `gather` is left for a follow-up DD that motivates the flag.
- Version pinning, hash-based integrity, and synchronization of peer projects are out of scope per R011 Non-Goals.

## §1 DD-Level Design Decisions

This section captures design decisions DD015 makes that are NOT direct restatements of R011 ACs — choices about how to realize the requirement that the requirement itself leaves open. Each decision is recorded as a DC claim so it has its own surface for review and supersession if the choice proves wrong during implementation.

DC.01:derives=R011.OQ.02 Alias names MUST conform to the regex `^[a-z][a-z0-9-]*[a-z0-9]$` — lowercase kebab-case, no leading or trailing hyphens, single-character names disallowed (the trailing `[a-z0-9]` requires at least two characters). This satisfies R011.§1.AC.04's minimum constraints while choosing a positive grammar consistent with common config conventions.

DC.02:derives=R011.OQ.03 The configuration key is `projectAliases`. This matches R011.§1.AC.01's default and the existing camelCase convention in `SCEpterConfig`.

DC.03:derives=R011.OQ.04 `scepter gather` renders alias-prefixed references encountered during traversal as one-line stubs (alias + peer note ID + a "(cross-project; not loaded)" marker) and does NOT load peer content. A `--follow-aliases` flag is deferred to a follow-up DD.

DC.04:derives=R011.OQ.05 Alias target validation is eager: `ConfigManager.loadConfigFromFilesystem()` calls `validateAliases()` once and caches results for the CLI invocation lifetime. Lazy validation is rejected because the failure mode (confusing errors mid-command) is worse than the startup cost.

DC.05 Cross-project resolution is owned by a new class `PeerProjectResolver` in `core/src/project/peer-project-resolver.ts`, instantiated lazily by `ProjectManager`. The resolver owns the per-invocation peer-project cache. Alternative considered and rejected: extending `NoteManager` or `ClaimIndex` directly. Rejected because both classes have a strong invariant of "this project's notes/claims" — adding a peer-resolution mode would compromise that invariant. A separate orchestrator class preserves the per-project invariant on `NoteManager` and `ClaimIndex` while consuming both.

DC.06 The extension reads the alias map directly from its in-process `ConfigManager` via `getAllAliasResolutions()` rather than from any CLI JSON serialization. This follows DD012's library-API model: the extension owns a long-lived local `ProjectManager`, so the alias data is already in memory and rebuilt as part of the standard `refresh()` path; no extension to `scepter claims index --json` is needed for the extension's sake. Alternative considered and rejected: extending the CLI JSON output with an `aliases` field. Rejected because the only proposed consumer was the extension, and the extension does not consume CLI JSON post-DD012. A future non-extension consumer wanting the alias map serialized can be addressed by a separate AC at that time.

DC.07 Cross-project decoration types in VS Code use a distinct color hue (purple `#C586C0` proposed) from local references (teal `#4EC9B0`), with the same underline-style discrimination between resolved (dotted) and unresolved (wavy). The exact color is implementation-tunable; the constraint is hue-distinct from local.

DC.08 Cross-project hover content is prefixed with a header line `**Cross-project citation: \`<alias>\`** (<resolved-peer-path>)` rendered as bold MarkdownString followed by a horizontal rule. This satisfies R011.§4.AC.03's "MUST NOT be confusable with local content" requirement with a fixed visual marker.

DC.09 Lint errors for cross-project `derives=` and `superseded=` produce two distinct `ClaimTreeError` types (`cross-project-derives` and `cross-project-superseded`) so the DiagnosticsProvider can apply the correct severity (Error for both) and the messages can carry the R011 rationale verbatim — the reconsideration clause for `derives=`, the authority argument for `superseded=`.

DC.10 The agent-facing `claims.md` revisions place the new "Cross-Project References" section after "Hard Rules" and before "Folder Notes and Claims". This sequencing means an agent reading top-to-bottom encounters the local grammar, the hard rules that constrain it, and then the cross-project extension as a recognized but bounded addition — preserving the "local references are the default" mental model while making cross-project visible.

## Primitive Preconditions

| Primitive | Source Citation | Status |
|-----------|----------------|--------|
| `SCEpterConfig` interface | `core/src/types/config.ts:~140` | PRESENT |
| `ConfigValidator` (Zod schemas) | `core/src/config/config-validator.ts:1+` | PRESENT |
| `ConfigManager` | `core/src/config/config-manager.ts:1+` | PRESENT |
| `ProjectManager` | `core/src/project/project-manager.ts:69` | PRESENT |
| `NoteManager` | `core/src/notes/note-manager.ts:1+` | PRESENT |
| `UnifiedDiscovery` | `core/src/discovery/unified-discovery.ts:1+` | PRESENT |
| `ClaimAddress` interface | `core/src/parsers/claim/claim-parser.ts:31` | PRESENT |
| `parseClaimAddress` | `core/src/parsers/claim/claim-parser.ts:128` | PRESENT |
| `parseClaimReferences` | `core/src/parsers/claim/claim-parser.ts:361` | PRESENT |
| `parseNoteMentions` | `core/src/parsers/note/note-parser.ts:1+` | PRESENT |
| `ClaimIndex` (core) | `core/src/claims/claim-index.ts:1+` | PRESENT |
| `ClaimIndexCache` (extension) | `vscode/src/claim-index.ts:1+` | PRESENT |
| `findAllMatches` (extension patterns) | `vscode/src/patterns.ts:40` | PRESENT |
| `ClaimHoverProvider` | `vscode/src/hover-provider.ts:1+` | PRESENT |
| `ClaimDefinitionProvider` | `vscode/src/definition-provider.ts:1+` | PRESENT |
| `DecorationProvider` | `vscode/src/decoration-provider.ts:1+` | PRESENT |
| `DiagnosticsProvider` | `vscode/src/diagnostics-provider.ts:1+` | PRESENT |
| `findProjectRoot` (core, used by extension) | `core/src/` (re-exported via `scepter` package) | PRESENT |
| `PeerProjectResolver` (new orchestrator class) | — | ABSENT — authored by this DD (§Module Inventory § core/src/project/peer-project-resolver.ts) |
| `AliasMap` / `ProjectAliases` types | — | ABSENT — authored by this DD (§Module Inventory § core/src/types/config.ts) |
| `claude/skills/scepter/claims.md` | `claude/skills/scepter/claims.md` | PRESENT |
| `claude/skills/scepter/SKILL.md` | `claude/skills/scepter/SKILL.md` | PRESENT |
| `claude/agents/sce-producer.md` | `claude/agents/sce-producer.md` | PRESENT |
| `claude/agents/sce-reviewer.md` | `claude/agents/sce-reviewer.md` | PRESENT |

All ABSENT primitives are authored by this DD itself; no companion DD or deferral is needed.

## Current State

Today the reference graph is a closed world: `ClaimIndex.build()` walks the local project's notes, `parseClaimReferences` resolves any `[A-Z]{1,5}\d{3,5}`-prefixed token against that local index, and `ProjectManager` owns a single `configManager` + `noteManager` pair scoped to one project root. Per DD012 the extension's `ClaimIndexCache` runs `ClaimIndex.build()` in-process against a local `ProjectManager` (via `createFilesystemProject`) and resolves all references against that single index — no CLI subprocess invocation on the read path. Multi-project workspace support already exists at the *active project switching* layer (per `extension.ts`'s `discoverProjects` and `selectProject`), but at any one moment a single project is "the project" — there is no notion of a peer project being read alongside.

The pattern matcher in `vscode/src/patterns.ts` already delegates to `parseClaimReferences` and `parseNoteMentions` from the core library (per DD012's CLI-to-library migration), so the extension and CLI share a single grammar implementation. This is the primary architectural lever for this DD: extending the grammar in core automatically extends the extension's matcher.

The agent-facing skill files (`claude/skills/scepter/claims.md`, `SKILL.md`) currently teach the closed-world grammar. The "Claim Reference Format" table at `claims.md:133-154` describes only local references. The "Hard Rules" table at `claims.md:160` enumerates forbidden forms but does not cover cross-project syntax. The "Common Mistakes" table at the bottom mentions `derives=...` and `superseded=...` as local-only without addressing alias prefixes.

## Module Inventory

### `core/src/types/config.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§1.AC.01} | `ProjectAliasTarget` interface | `{ path: string; description?: string }` — object form, leaves room for future fields |
| {R011.§1.AC.02} | `ProjectAliasValue` type | Discriminated union: `string \| ProjectAliasTarget` (string is shorthand for `{path}`) |
| {R011.§1.AC.01} | `SCEpterConfig.projectAliases?: Record<string, ProjectAliasValue>` | New optional field on the top-level config interface |

### `core/src/config/config-validator.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§1.AC.01,.AC.02} | Zod schema for `projectAliases` | `z.record(aliasNameSchema, z.union([z.string(), z.object({path: z.string(), description: z.string().optional()})])).optional()` |
| {R011.§1.AC.04} | `aliasNameSchema` | `z.string().regex(/^[a-z][a-z0-9-]*[a-z0-9]$/)` rejecting trailing hyphens; also rejects matches against `[A-Z]{1,5}\d{3,5}` and any name containing `/` |
| {R011.§1.AC.05} | `validateAliasShortcodeCollision` | New cross-field validator: walks `noteTypes` shortcodes and reports an error if any uppercase form of an alias name matches a configured shortcode prefix |

### `core/src/config/config-manager.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§1.AC.03} | `resolveAliasPath(aliasValue, configFilePath)` | Resolves the alias's target relative to the config file; supports absolute paths and `~` expansion via `os.homedir()` |
| {R011.§1.AC.06} | `validateAliases()` | Called during `loadConfigFromFilesystem()`; for each alias, checks that the resolved path exists and contains either `scepter.config.json` or `_scepter/scepter.config.json`; returns warnings (not errors) for unresolved targets |
| {R011.§1.AC.06} | `getAliasResolution(name)` | Returns `{resolved: true, path} \| {resolved: false, reason}` for the alias; consumed by the resolver to decide whether to proceed or surface "alias unresolved" |
| {R011.§4.AC.12} | `reloadConfig()` (event emission site) | Captures `prevAliases = new Map(this.aliasResolutions)` BEFORE the reload (which clears the cache as part of `loadConfigFromFilesystem` → `validateAliases`), then snapshots `nextAliases = new Map(this.aliasResolutions)` AFTER the reload, and emits an `aliases:changed` event with `{prev, next}`. The event is the signal that downstream consumers (`ProjectManager` → `peerResolver`) use to invalidate stale cache entries while preserving §2.AC.06 for unchanged aliases. |

### `core/src/parsers/claim/claim-parser.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§2.AC.01} | `ClaimAddress.aliasPrefix?: string` | New optional field on the parsed address; populated when the input begins with `<alias>/` |
| {R011.§2.AC.01} | MODIFY `parseClaimAddress()` | Pre-strip an `<alias>/` prefix using `/^([a-z][a-z0-9-]*)\//`; if matched, set `aliasPrefix` and parse the remainder against the existing grammar |
| {R011.§2.AC.07} | Reject transitive aliases | If after stripping one alias prefix the remainder also begins with `<alias>/`, return `null` (the parser does not produce a "two alias prefix" address; the resolver enforces the hard error message) |
| {R011.§2.AC.02} | MODIFY `parseClaimReferences()` | No structural change required — once `parseClaimAddress` recognizes alias prefixes, both braced and code-annotation contexts inherit recognition. Verify via tests in both contexts. |

### `core/src/parsers/claim/__tests__/claim-parser.test.ts` (new test cases)

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§2.AC.01} | Test cases for each shape: `vendor-lib/R042`, `vendor-lib/R005.§1`, `vendor-lib/R005.§1.AC.01`, `vendor-lib/R005.§1.AC.01-06` | Each must round-trip to a `ClaimAddress` with `aliasPrefix === 'vendor-lib'` |
| {R011.§2.AC.02} | Test braced and code-annotation contexts | `{vendor-lib/R042}` and `@implements {vendor-lib/R005.§1.AC.01}` |
| {R011.§2.AC.07} | Test transitive rejection | `b/c/R001` returns `null` (or surfaces a distinct error path) |

### `core/src/project/peer-project-resolver.ts` (NEW FILE)

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§2.AC.05} | `class PeerProjectResolver` | Owns the alias-to-`ProjectManager` cache for a single CLI invocation |
| {R011.§2.AC.05} | `resolve(aliasPrefix): Promise<PeerProject \| ResolutionError>` | Returns either a loaded peer `ProjectManager` plus the alias target metadata, or a typed error: `alias-unknown`, `peer-unresolved`, `peer-load-failed` |
| {R011.§2.AC.06} | Per-invocation cache | `Map<string, Promise<PeerProject>>` keyed by alias name; subsequent `resolve()` calls return the cached promise |
| {R011.§2.AC.05} | `lookupNote(aliasPrefix, noteId)` | Resolves alias, then queries the peer's `noteManager.getNote(noteId)`; returns `note-not-found` error if missing |
| {R011.§2.AC.05} | `lookupClaim(aliasPrefix, claimAddress)` | Resolves alias, queries the peer's `claimIndex.getClaim(fqid)`; returns `claim-not-found` if missing |
| {R011.§4.AC.12} | `invalidate(aliasName: string): void` | Removes the cached `Promise<PeerProject>` entry for the named alias, releasing the peer's `ProjectManager` resources for GC. Recommended API shape: per-alias rather than wholesale-swap, so caller can preserve §2.AC.06's caching invariant for unchanged aliases. Caller is responsible for diffing previous vs. next alias maps and invoking `invalidate` only for entries whose target path changed, was renamed, or was removed. A wholesale-swap (replace the resolver entirely on reload) would lose unchanged-alias cache entries and is rejected as an alternative; if the implementer finds the per-alias diff too awkward at the call site, an `invalidateChanged(prevResolutions, nextResolutions)` helper on the resolver itself is acceptable as long as the underlying invariant — preserve unchanged entries — holds. The method MUST be a no-op for alias names not present in the cache (avoids forcing the caller to track which aliases have been resolved yet). |

### `core/src/project/project-manager.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§2.AC.05,.AC.06} | `public readonly peerResolver: PeerProjectResolver` | Lazily instantiated; receives a reference to `configManager` to read the alias map |
| {R011.§4.AC.12} | constructor: `aliases:changed` subscription wiring | Constructor subscribes to `configManager.on('aliases:changed', ...)` and invokes `_peerResolver.invalidateChanged(payload.prev, payload.next)` IF the resolver was already lazily constructed. (No-op if the resolver was never accessed — empty cache, nothing to invalidate.) Subscription is in the constructor (not in `watchConfigChanges()`) so the wiring fires for every ProjectManager's lifetime, regardless of whether `watchConfigChanges()` is called by the caller. |

### `core/src/claims/claim-index.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§3.AC.04} | `ClaimIndex.build()` (no functional change) | Builds local-only; documented invariant: alias-prefixed references are *not* registered as local claim entries. Add a comment citing R011.§3.AC.04. |
| {R011.§3.AC.03,.AC.04} | `crossRefs` invariant | Cross-references derived from alias-prefixed targets MUST NOT appear in the local matrix. The reference scanner skips any reference whose target is alias-prefixed. |

### `core/src/claims/traceability.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§3.AC.03} | MODIFY render path | When a local claim has an outgoing alias-prefixed reference in its source text, the matrix renders the reference in a "cross-project citations" footer column — not as a projection coverage entry |
| {R011.§3.AC.04} | MODIFY gap analysis | `findGaps()` filters out alias-prefixed references entirely — they are not implementations of any local claim, and their absence is not a local gap |

### `core/src/cli/commands/claims/lint-command.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§3.AC.06} | Validate alias-prefixed references | For each outgoing reference in a local note, if `aliasPrefix` is set: (a) confirm alias is declared in `projectAliases`, else error `alias-unknown`; (b) confirm peer resolves, else warning `peer-unresolved`; (c) confirm peer note/claim exists, else warning/error per the existing severity model |
| {R011.§2.AC.03} | Reject `derives=<alias>/<id>` | New lint error: `derives` cannot point to a cross-project target. Error message cites {R006.§Non-Goals} and quotes R011.§2.AC.03 reconsideration clause. |
| {R011.§2.AC.04} | Reject `superseded=<alias>/<id>` | New lint error: `superseded` cannot point to a cross-project target. Error message states the authority argument from R011.§2.AC.04 verbatim or paraphrased. |

### `core/src/cli/commands/claims/index-command.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§3.AC.06} | Validation pass | When indexing, run the same alias-reference validation as lint; surface failures as `ClaimTreeError` entries with type `unresolved-reference` (existing) or new types `alias-unknown` / `peer-unresolved` if discriminating in diagnostics matters |

### `core/src/cli/commands/context/show-handler.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§3.AC.01} | Detect alias-prefixed argument | If `<noteId>` argument matches `^[a-z][a-z0-9-]*/`, route to `peerResolver.resolve(prefix).lookupNote(remainder)` |
| {R011.§3.AC.01} | Render with peer-source header | Wrap the rendered note with a header line: `From peer project: <alias> (<resolved-path>)` followed by a horizontal rule, so the output is unmistakably cross-project |

### `core/src/cli/commands/context/gather-handler.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§3.AC.02} | Stub-only treatment of alias-prefixed references (per resolved OQ.04) | When walking outgoing references from gathered notes, alias-prefixed references render as a one-line citation entry (alias + peer note ID + "(cross-project; not loaded)") and are not followed |
| {R011.§3.AC.02} | Aggregate counts exclude peers | Reference-count totals in the gather summary count only local references |

### `core/src/cli/commands/claims/trace-command.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§3.AC.03} | Render cross-project citations distinctly | When a traced claim has outgoing alias-prefixed references, those appear in a separate "Cross-project citations" footer of the matrix output, not merged into the projection columns |

### `core/src/cli/commands/context/search-handler.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§3.AC.05} | Default scope unchanged | `search` searches only the local project. A `--include-peers` flag is left for follow-up; this DD does not implement peer search. |

### `vscode/src/patterns.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.01} | `ClaimMatch.aliasPrefix?: string` | Add to the match record so downstream providers can route |
| {R011.§4.AC.01} | MODIFY `findAllMatches()` | When the underlying `ClaimAddress` carries `aliasPrefix`, propagate it to the match. No regex changes needed — the core parser does the work. |
| {R011.§4.AC.01} | MODIFY `matchAtPosition()` | Inherits behavior from `findAllMatches`; verify the alias prefix is preserved in the returned `ClaimMatch` |

### `vscode/src/claim-index.ts`

Per DD012, the extension consumes the core via the `scepter` library barrel (`createFilesystemProject`, `ProjectManager`, `ClaimIndex`, …). All cross-project work in this DD lives on top of that library surface — the extension does NOT shell out to the CLI for peer access.

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.02} | `aliasMap: Map<string, AliasMapEntry>` | Per-active-project alias map populated at refresh from `this.projectManager.configManager.getAllAliasResolutions()` (a core API). NOT shelled out from the CLI. |
| {R011.§4.AC.02} | Watch `scepter.config.json` | Already added by DD012's `setupFileWatcher` (the `configWatcher` reloads `configManager` and re-runs `debouncedRefresh`). On change, the alias map is rebuilt as part of `refresh()`; no subprocess call. |
| {R011.§4.AC.07} | Peer-index cache (owned by core) | The peer-project cache lives in the core's `PeerProjectResolver` (one cache per local `ProjectManager` instance, see Phase 4). The extension does NOT maintain its own `peerIndexes` map; it delegates to `this.projectManager.peerResolver`, which loads peer projects via the same `createFilesystemProject` factory applied to the resolved peer path. |
| {R011.§4.AC.07} | `resolveCrossProject(aliasName, address): Promise<CrossProjectLookup>` | New method on `ClaimIndexCache`. Delegates to `this.projectManager.peerResolver.lookupNote(aliasName, noteId)` for note lookups and `this.projectManager.peerResolver.lookupClaim(address)` for claim lookups. Returns a `CrossProjectLookup` discriminated union (`{ok:true,entry,…}` / `{ok:true,note,…}` / `{ok:false,reason,aliasName}`) rather than throwing. |

### `vscode/src/hover-provider.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.03} | Branch on `match.aliasPrefix` | If set, call `index.resolveCrossProject(...)` and build a peer-content hover; otherwise existing local hover path |
| {R011.§4.AC.03} | Peer-source header on hover MarkdownString | First line of hover content: `**Cross-project citation: \`<alias>\`** (<peer-path>) — visually distinct font/separator |
| {R011.§4.AC.03} | Distinct failure messages | "Alias `<name>` is not declared in projectAliases", "Peer project at `<path>` not found", "Note `<id>` not found in peer `<alias>`", "Claim `<fqid>` not found in peer note `<noteId>`" |

### `vscode/src/definition-provider.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.04} | Branch on `match.aliasPrefix` | If set, resolve via `index.resolveCrossProject(...)` and return a `vscode.Location` pointing at the peer's file path + line; otherwise existing local path |

### `vscode/src/decoration-provider.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.05} | `crossProjectResolvedDecoration` | New decoration type: distinct color (e.g., purple `#C586C0`) + dotted underline; visually distinguishable from local resolved (teal `#4EC9B0`) |
| {R011.§4.AC.05} | `crossProjectUnresolvedDecoration` | New decoration type: same purple hue + wavy underline so resolved/unresolved cross-project is also distinguishable |
| {R011.§4.AC.05} | MODIFY `updateDecorations()` | Branch on `match.aliasPrefix`: route to cross-project decoration types; await `index.resolveCrossProject` (with a timeout fallback) to decide resolved-vs-unresolved |

### `vscode/src/diagnostics-provider.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.06} | New severity entries in `SEVERITY_BY_TYPE` | `'alias-unknown': Error`, `'peer-unresolved': Warning`, `'peer-target-not-found': Warning` (or `Error` for hard not-found if linter classifies it that way) |
| {R011.§4.AC.06} | Surface alias-validation errors | Already inherits from `index.getErrors()`; the work is in `claim-index.ts` (extension side) collecting alias-validation errors into the `ClaimTreeError[]` it serves to the diagnostics provider |

### `vscode/src/markdown-plugin.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.08} | Recognize alias-prefixed references | Already inherits from `findAllMatches` — the plugin is a thin wrapper over the matcher. Verify rendering: alias-prefixed matches get the same purple class as decorations, click-handler routes to definition-provider equivalent in the preview pane |

### `vscode/src/views/notes-tree-provider.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.09} | Notes Explorer scope | No change to top-level: only local notes are listed. Document the invariant. |

### `vscode/src/views/references-tree-provider.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.09} | Outgoing references include alias-prefixed | An alias-prefixed reference IS a genuine outgoing edge from a local note; render it with a "cross-project" badge or icon, but include in the listing |
| {R011.§4.AC.09} | Incoming references exclude peers | Peer notes do not generate incoming-reference edges into the local graph (per R011 Non-Goals "Bidirectional references") |

### `vscode/src/views/traceability-view-provider.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.09} | Local-only matrix | The webview matrix renders local claims and their local projection coverage. Alias-prefixed citations appearing in local notes render in a footer "Cross-project citations" section, not as matrix rows. |

### `vscode/src/extension.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.10} | `scepter.openConfig` command | Opens `scepter.config.json` in an editor tab. If the document is loaded fresh, scroll to the `projectAliases` key (or to the top if not present, with a comment hint about how to add it) |
| {R011.§4.AC.11} | Per-project alias loading | The active project's alias map is loaded on activation and on `scepter.selectProject` switch; switching projects discards the previous project's alias map and peer index cache |
| {R011.§4.AC.02,.AC.11} | Watcher reinit on config change | When `scepter.config.json` changes, re-invoke the CLI to rebuild claim index and alias map |

### `vscode/package.json` (extension manifest)

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§4.AC.10} | Contribute `scepter.openConfig` | Add the command contribution and a Command Palette entry "SCEpter: Open Configuration" |

### `claude/skills/scepter/claims.md`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§5.AC.01} | EXTEND § "Claim Reference Format" table | Add a row for the alias-prefixed form `<alias>/<normal-reference>`, with braced and code-annotation examples |
| {R011.§5.AC.02} | NEW § "Cross-Project References" | Insert as a new sub-section under "Syntax & Rules" (between "Hard Rules" and "Folder Notes and Claims"). Covers when to use, when not to use (`derives=`/`superseded=` prohibitions), and the citation-vs-federation distinction. |
| {R011.§5.AC.03} | EXTEND § "Hard Rules" + § "Common Mistakes" | Add a row to "Hard Rules" rejecting `derives=<alias>/<id>` and `superseded=<alias>/<id>`. Add corresponding rows in "Common Mistakes" with the linter error messages the agent should expect. |
| {R011.§5.AC.05} | REVISE prose making closed-world assumption | Audit existing prose in `claims.md` for unqualified "all references resolve in the current project" statements; revise to the explicit two-case framing |
| {R011.§5.AC.06} | Examples remain primarily local | Existing local examples MUST NOT be rewritten to use alias prefixes; cross-project examples are added only in the contexts §5.AC.01–.AC.04 prescribe |

### `claude/skills/scepter/SKILL.md`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§5.AC.04} | EXTEND § "CLI Reference" | Add an example to `scepter show` showing `scepter show vendor-lib/R042`; add an example to `scepter gather` showing the stub-only treatment of alias-prefixed references encountered during gather |
| {R011.§5.AC.04} | EXTEND § "Source Code Integration" | Note that `@implements` annotations MAY use alias-prefixed targets for citation, but `derives=` and `superseded=` MUST NOT |
| {R011.§5.AC.05} | REVISE closed-world prose | Same audit as `claims.md` |

### `claude/agents/sce-producer.md` — WITHDRAWN

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§Non-Goals — Updates to agent dispatch templates} | Producer guidance on cross-project references | WITHDRAWN — out of scope per R011 §Non-Goals (Q2 resolved 2026-04-30 in favor of skill-files-only scope). Producer agents inherit cross-project grammar transitively from the skill files (§5.AC.01–§5.AC.04); a separate dispatch-template edit would either duplicate skill-file content or create a divergent second source of truth. |

### `claude/agents/sce-reviewer.md` — WITHDRAWN

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| {R011.§Non-Goals — Updates to agent dispatch templates} | Reviewer check for alias-prefixed reference correctness | WITHDRAWN — out of scope per R011 §Non-Goals (Q2 resolved 2026-04-30 in favor of skill-files-only scope). Reviewer agents inherit cross-project grammar transitively from the skill files (§5.AC.01–§5.AC.04); the skill-file revisions are the verification surface. |

## Wiring Map

### Import Graph (Core)

```
core/src/types/config.ts
  └─ ProjectAliasValue, ProjectAliasTarget exported

core/src/config/config-validator.ts
  └─ imports ProjectAliasValue (type)
  └─ Zod schema for projectAliases

core/src/config/config-manager.ts
  └─ imports ProjectAliasValue
  └─ resolveAliasPath(), validateAliases(), getAliasResolution()

core/src/parsers/claim/claim-parser.ts
  └─ ClaimAddress.aliasPrefix added
  └─ parseClaimAddress recognizes <alias>/ prefix
  └─ NO new dependencies

core/src/project/peer-project-resolver.ts (NEW)
  └─ imports ConfigManager (for alias lookup)
  └─ imports ProjectManager (instantiated for peers)
  └─ imports ClaimIndex, NoteManager (queried via the peer's ProjectManager)

core/src/project/project-manager.ts
  └─ imports PeerProjectResolver
  └─ owns peerResolver instance

core/src/cli/commands/* (lint, index, show, gather, trace)
  └─ each imports peerResolver via ProjectManager
  └─ branches on aliasPrefix where applicable
```

### Import Graph (VS Code)

Per DD012 the extension imports the core directly via the `scepter` barrel — `createFilesystemProject`, `ProjectManager`, `ClaimIndex`, etc. No subprocess invocation; the extension owns a long-lived local `ProjectManager` and reads through it.

```
vscode/src/patterns.ts
  └─ already imports parseClaimReferences, parseNoteMentions from 'scepter'
  └─ propagates aliasPrefix to ClaimMatch (no new imports)

vscode/src/claim-index.ts
  └─ already imports createFilesystemProject, ProjectManager, ClaimIndex from 'scepter' (DD012)
  └─ adds aliasMap populated from this.projectManager.configManager.getAllAliasResolutions()
  └─ resolveCrossProject() delegates to this.projectManager.peerResolver.lookupNote/lookupClaim
  └─ NO new subprocess invocations; peer loading owned by the core resolver

vscode/src/hover-provider.ts, definition-provider.ts, decoration-provider.ts, diagnostics-provider.ts
  └─ each imports ClaimIndexCache
  └─ each branches on match.aliasPrefix

vscode/src/views/* (no functional change to graph; views consume index.lookupNote, index.lookup, etc.)
```

### Call Chains

**Local reference (unchanged):**
```
hover at {R005.§1.AC.01}
  → matchAtPosition → ClaimMatch{kind:'claim', normalizedId:'R005.1.AC.01', aliasPrefix:undefined}
  → index.resolve(normalizedId)
  → buildClaimHover(localEntry)
```

**Cross-project reference:**
```
hover at {vendor-lib/R005.§1.AC.01}
  → matchAtPosition → ClaimMatch{kind:'claim', normalizedId:'R005.1.AC.01', aliasPrefix:'vendor-lib'}
  → ClaimIndexCache.resolveCrossProject('vendor-lib', {noteId:'R005', sectionPath:[1], claimPrefix:'AC', claimNumber:1})
    → this.projectManager.peerResolver.lookupClaim(address)
      → core PeerProjectResolver.resolve('vendor-lib')
        → first time: configManager.getAliasResolution('vendor-lib') → factory(resolvedPath) i.e. createFilesystemProject(resolvedPath); cached as Promise<PeerProject> on the resolver
        → subsequent: returns cached promise
      → peer ProjectManager.initialize() then peer.claimIndex.build(peerNotesWithContent)
      → peer.claimIndex.getClaim(fqid)
  → buildCrossProjectClaimHover(peerEntry, aliasPrefix, peerPath)
```

**Lint a derives= with alias prefix:**
```
lint local note
  → for each claim with `derives=` metadata
    → if metadata target's aliasPrefix is set → emit ClaimTreeError{type:'cross-project-derives', message:'derives=<alias>/<id> rejected per R011.§2.AC.03'}
  → reported via existing ClaimTreeError pipeline
```

### Provider/Resolver Nesting

```
ProjectManager (local)
  ├─ configManager — loads projectAliases from scepter.config.json
  ├─ noteManager  — local notes only
  ├─ claimIndex   — local claims only
  └─ peerResolver — owns:
       Map<aliasName, PeerProject>
       PeerProject = {
         configManager,  // peer's
         noteManager,    // peer's, read-only from local POV
         claimIndex,     // peer's
       }
```

### VS Code Component Tree (data ownership)

```
ClaimIndexCache (extension state)
  ├─ entries (local claims)
  ├─ noteMap (local notes)
  ├─ aliasMap (alias name → AliasMapEntry: resolvedPath + resolved/unresolvedReason)  [NEW]
  └─ projectManager (the local ProjectManager, owns peerResolver)
        └─ peerResolver: core PeerProjectResolver
              └─ Map<aliasName, Promise<ResolveResult>>  [peer-project cache, lazy, lifetime = local PM]

Providers consume ClaimIndexCache:
  HoverProvider, DefinitionProvider, DecorationProvider, DiagnosticsProvider, MarkdownPlugin
  Sidebar views: NotesTreeProvider, ClaimsTreeProvider, ReferencesTreeProvider, ConfidenceTreeProvider, TraceabilityViewProvider
```

The peer-project cache is owned by the core resolver, not by the extension. The extension's `ClaimIndexCache` only owns the `aliasMap` (a flat copy of the local config's resolutions for diagnostics/UI use); peer-`ProjectManager` instances are the resolver's concern.

## Data and Interaction Flow

### Flow 1: Cross-project hover from a local note

1. User opens a local note in VS Code; the note contains `{vendor-lib/R005.§1.AC.01}` in its prose
2. User hovers over the reference
3. `ClaimHoverProvider.provideHover` calls `matchAtPosition`
4. `matchAtPosition` → `findAllMatches` → `parseClaimReferences` (core) recognizes `vendor-lib/` as alias prefix, returns `ClaimAddress{aliasPrefix: 'vendor-lib', noteId: 'R005', sectionPath: ['1'], claimPrefix: 'AC', claimNumber: 1}`
5. `findAllMatches` propagates `aliasPrefix` to the `ClaimMatch`
6. Hover provider sees `match.aliasPrefix === 'vendor-lib'`, calls `index.resolveCrossProject('vendor-lib', address)`
7. `ClaimIndexCache.resolveCrossProject` delegates to `this.projectManager.peerResolver.lookupClaim(address)` (core library call — no subprocess)
8. The core `PeerProjectResolver` resolves the alias via `configManager.getAliasResolution`, on first hit calls `createFilesystemProject(resolvedPath)` and caches the resulting `Promise<PeerProject>`; on subsequent hits returns the cached promise. It then builds the peer's claim index from peer notes and returns the matching `ClaimIndexEntry`.
9. Hover provider builds a `MarkdownString` with the cross-project header and peer claim content; VS Code renders the popup.

### Flow 2: Lint rejection of `derives=<alias>/<id>`

1. User runs `scepter lint <local-note>` (or saves a note with the diagnostics provider active)
2. Lint walks the local note's parsed claims
3. For a claim with metadata `derives=vendor-lib/R005.§1.AC.01`, the metadata parser parses the target as a `ClaimAddress` with `aliasPrefix='vendor-lib'`
4. Lint detects `aliasPrefix !== undefined` and emits `ClaimTreeError{type:'cross-project-derives', line, message: 'derives=<alias>/<id> rejected: per R011.§2.AC.03 and R006.§Non-Goals, derivation is per-project. Reconsideration permitted via a future requirement that relaxes both R006 and R011.§2.AC.03 together.'}`
5. CLI surfaces the error in the lint report; in VS Code, `DiagnosticsProvider.rebuild` includes the error in the Problems panel with severity `Error`

### Flow 3: Show command on a peer note

1. User runs `scepter show vendor-lib/R042`
2. `show-handler` detects the alias prefix in the argument
3. Resolves via `projectManager.peerResolver.resolve('vendor-lib').lookupNote('R042')`
4. Resolver loads peer's `ProjectManager` (cached for the invocation), queries peer's `noteManager.getNote('R042')`
5. Handler renders the note with a peer-source header line and a horizontal rule
6. Output is unmistakably a peer-source note

### Flow 4: Config edit triggers re-load

1. User opens `scepter.config.json` via the `scepter.openConfig` command
2. User edits `projectAliases` (adds, removes, or renames an alias)
3. User saves
4. Extension's file watcher fires for `scepter.config.json` (the existing `configWatcher` set up by DD012)
5. The watcher calls `this.projectManager.configManager.reloadConfig()`, then re-runs `setupFileWatcher` and `debouncedRefresh`. `refresh()` rebuilds the local claim index AND re-populates `aliasMap` from `configManager.getAllAliasResolutions()`. The peer-project cache lives on the same `peerResolver` instance; if the implementation needs to invalidate stale peer loads after an alias rename, that is a resolver-level concern (not addressed by this DD — see Observations).
6. Diagnostics, decorations, hover, and definition all use the refreshed alias map immediately

## Integration Sequence

The 14 phases below are ordered for verifiability: each phase produces a verifiable artifact, and earlier phases produce primitives later phases consume.

### Phase 1: Config schema and validation

**Files:** `core/src/types/config.ts`, `core/src/config/config-validator.ts`
**Changes:** Add `ProjectAliasTarget`, `ProjectAliasValue`, extend `SCEpterConfig` interface; add Zod schemas including alias-name regex, shortcode-collision validator
**Verify:** `pnpm tsc` passes; existing config tests pass; new tests for alias-name validation (accepts `vendor-lib`, rejects `Vendor`, `vendor-`, `R042`, `vend/or`)
**Spec:** {R011.§1.AC.01,.AC.02,.AC.04,.AC.05}

### Phase 2: Config loading and resolution

**Files:** `core/src/config/config-manager.ts`
**Changes:** `resolveAliasPath`, `validateAliases`, `getAliasResolution`; integrate into `loadConfigFromFilesystem`
**Verify:** Unit tests for tilde expansion, relative-path resolution from config file location, absolute paths, missing target produces warning + unresolved status
**Spec:** {R011.§1.AC.03,.AC.06}

### Phase 3: Parser grammar extension

**Files:** `core/src/parsers/claim/claim-parser.ts`
**Changes:** `ClaimAddress.aliasPrefix`, `parseClaimAddress` strips and records the prefix, transitive aliases return `null`
**Verify:** New parser tests covering all alias-prefixed shapes (note, note+section, note+claim, ranges) in both braced and code-annotation contexts; transitive `b/c/R001` returns null; existing local-only tests unchanged
**Spec:** {R011.§2.AC.01,.AC.02,.AC.07}

### Phase 4: Peer project resolver

**Files:** `core/src/project/peer-project-resolver.ts` (new), `core/src/project/project-manager.ts`
**Changes:** Class with `resolve`, `lookupNote`, `lookupClaim`; per-invocation cache; typed error returns
**Verify:** Unit tests with a fixture peer project on disk; alias-unknown / peer-unresolved / note-not-found / claim-not-found each produce distinct errors; cache hit on second call doesn't re-load
**Spec:** {R011.§2.AC.05,.AC.06}

### Phase 5: Lint rejection of cross-project `derives=` and `superseded=`

**Files:** `core/src/cli/commands/claims/lint-command.ts`, `core/src/claims/claim-metadata.ts` (if metadata interpretation lives there)
**Changes:** Detect alias-prefixed targets in `derives=` and `superseded=` metadata; emit new `ClaimTreeError` types with the R011-cited messages
**Verify:** Lint a fixture note containing `derives=vendor/R001.§1.AC.01` → error; same for `superseded=`; cross-project `@implements` and braced `{vendor/...}` references are NOT flagged at lint time (other than alias-resolution checks)
**Spec:** {R011.§2.AC.03,.AC.04}

### Phase 6: Lint and index validation of alias-prefixed references

**Files:** `core/src/cli/commands/claims/lint-command.ts`, `core/src/cli/commands/claims/index-command.ts`
**Changes:** Validate alias is declared, peer resolves, peer note/claim exists; emit appropriate `ClaimTreeError` entries
**Verify:** Lint a fixture with `{undeclared/R001}` → alias-unknown; with `{ok-alias/MISSING}` → peer-target-not-found; clean references → no errors
**Spec:** {R011.§3.AC.06}

### Phase 7: Show, gather, trace command behavior

**Files:** `core/src/cli/commands/context/show-handler.ts`, `core/src/cli/commands/context/gather-handler.ts`, `core/src/cli/commands/claims/trace-command.ts`, `core/src/claims/traceability.ts`
**Changes:** Show routes alias-prefixed args to peerResolver and renders with peer header; gather treats alias-prefixed references as stubs; trace renders cross-project citations in a footer
**Verify:** Integration tests using fixture peer project: `scepter show vendor-lib/R042` returns peer content with header; `scepter gather <local-with-alias-ref>` shows stub line; `scepter claims trace <local-claim-with-alias-citation>` shows footer
**Spec:** {R011.§3.AC.01,.AC.02,.AC.03}

### Phase 8: Trace and gap analysis non-merger

**Files:** `core/src/claims/traceability.ts`, `core/src/cli/commands/claims/gaps-command.ts`
**Changes:** `findGaps` skips alias-prefixed references; matrix render ensures peer references never appear as projection coverage
**Verify:** Test that an alias-prefixed reference in a local note does NOT count as Source/Spec coverage of a local claim; gap report unchanged regardless of whether peer is reachable
**Spec:** {R011.§3.AC.04}

### Phase 9: Extension pattern matcher integration

**Files:** `vscode/src/patterns.ts`
**Changes:** Propagate `aliasPrefix` from `ClaimAddress` to `ClaimMatch`; ensure `findAllMatches` and `matchAtPosition` preserve it
**Verify:** Manual test: open a markdown file containing `{vendor-lib/R042}`; pattern matcher returns a match with `aliasPrefix === 'vendor-lib'` (verifiable via output channel logging)
**Spec:** {R011.§4.AC.01}

### Phase 10: Extension claim index alias map and peer-resolver delegation

**Files:** `vscode/src/claim-index.ts`
**Changes:**
- Add `aliasMap: Map<string, AliasMapEntry>` populated in `refresh()` from `this.projectManager.configManager.getAllAliasResolutions()` (a core API; per DD012 the extension owns a long-lived local `ProjectManager` and reads through it).
- Verify the existing `configWatcher` (added by DD012's `setupFileWatcher`) reloads on `scepter.config.json` change — no new watcher needed for the alias map; it rebuilds as part of the standard refresh path.
- Expose `resolveCrossProject(aliasName, address)` on `ClaimIndexCache` that delegates to `this.projectManager.peerResolver.lookupNote` / `lookupClaim` and adapts the core's typed result into a `CrossProjectLookup` discriminated union for the providers.
- The peer-project cache itself lives in the core `PeerProjectResolver` (built in Phase 4); the extension does NOT maintain a parallel peer-index map. There is no subprocess invocation anywhere in this phase — all peer access goes through the library API per DD012.

**Verify:** With a configured alias and a peer project on disk, calling `index.resolveCrossProject('alias', {noteId:'R001', sectionPath:[1], claimPrefix:'AC', claimNumber:1})` returns `{ok:true, entry, aliasName, peerPath}`; second call hits the resolver's cached `Promise<PeerProject>` (no second `createFilesystemProject` call); editing `scepter.config.json` triggers `configManager.reloadConfig()` and `refresh()` rebuilds the alias map.
**Spec:** {R011.§4.AC.02,.AC.07}

### Phase 11: Hover, definition, decoration, diagnostics providers

**Files:** `vscode/src/hover-provider.ts`, `vscode/src/definition-provider.ts`, `vscode/src/decoration-provider.ts`, `vscode/src/diagnostics-provider.ts`
**Changes:** Each branches on `match.aliasPrefix`; hover/definition route to peer resolution; decoration uses cross-project decoration types; diagnostics surface alias-related errors
**Verify:** Manual test in a workspace with peer project: hover over `{vendor-lib/R005.§1.AC.01}` shows peer content with header; Cmd-click opens peer file; decoration is purple not teal; misconfigured alias surfaces in Problems panel
**Spec:** {R011.§4.AC.03,.AC.04,.AC.05,.AC.06}

### Phase 12: Markdown preview, sidebar views, and configuration UX

**Files:** `vscode/src/markdown-plugin.ts`, `vscode/src/views/*`, `vscode/src/extension.ts`, `vscode/package.json`
**Changes:** Markdown plugin recognizes alias-prefixed (inherits from matcher); references view shows alias-prefixed outgoing edges with badge; trace/notes views remain local-only; `scepter.openConfig` command added; per-project alias loading on activation/switch
**Verify:** Open a markdown preview of a note with cross-project reference — purple class applied; click navigates; Notes Explorer does not show peer notes; References view shows the alias-prefixed reference distinctly; `SCEpter: Open Configuration` opens the config file
**Spec:** {R011.§4.AC.08,.AC.09,.AC.10,.AC.11}

### Phase 12.5: Peer-cache invalidation on `projectAliases` reload

**Files:** `core/src/config/config-manager.ts` (`reloadConfig` emits `aliases:changed` event with `{prev, next}` snapshots), `core/src/project/project-manager.ts` (constructor subscribes to `aliases:changed` and calls `peerResolver.invalidateChanged`), `core/src/project/peer-project-resolver.ts` (new `invalidate(name)` and `invalidateChanged(prev, next)` primitives — diff-based invalidation that preserves §2.AC.06 caching for unchanged aliases)
**Changes:** Capture prior alias resolution map in `reloadConfig` before reload, emit event with both maps after; ProjectManager forwards to resolver; resolver removes only entries whose path or resolved-status changed (or were removed). Aliases unchanged across reload remain cached.
**Verify:** `peer-project-resolver.test.ts` covers 6 dedicated tests: invalidate-drops-cache, idempotent-invalidate-of-unknown, repoint (path change), remove (alias deleted), unchanged-preserved (§2.AC.06 invariant — factory called exactly once), mixed (a unchanged + b repointed + c removed).
**Spec:** {R011.§4.AC.12}

### Phase 13: Agent-facing skill files

**Files:** `claude/skills/scepter/claims.md`, `claude/skills/scepter/SKILL.md`
**Changes:** Reference Format table extended; new "Cross-Project References" section; Hard Rules + Common Mistakes rows added; CLI Reference examples added; closed-world prose audited and revised
**Verify:** `grep -n "alias\|cross-project\|<alias>/" claude/skills/scepter/claims.md` returns the new content; reading the documents end-to-end as an agent would, the cross-project syntax is encountered before any closed-world assumption
**Spec:** {R011.§5.AC.01,.AC.02,.AC.03,.AC.04,.AC.05,.AC.06}

### Phase 14: Agent dispatch templates — WITHDRAWN

**Status:** WITHDRAWN — out of scope per R011 §Non-Goals (Q2 resolved 2026-04-30 in favor of skill-files-only scope).
**Files:** `claude/agents/sce-producer.md`, `claude/agents/sce-reviewer.md` (no longer in scope)
**Rationale:** Producer and reviewer agents load the skill files at runtime, so the cross-project grammar reaches them transitively through the §5.AC.01–§5.AC.04 skill-file edits completed in Phase 13. A separate dispatch-template binding would either duplicate skill-file content or create a divergent second source of truth.
**Spec:** {R011.§Non-Goals — Updates to agent dispatch templates}

## Testing Strategy

| Test Level | Scope | Requirements Covered |
|------------|-------|----------------------|
| Unit (parser) | `parseClaimAddress` recognizes alias prefixes; transitive rejection | {R011.§2.AC.01,.AC.07} |
| Unit (config) | Zod schema accepts/rejects alias names; shortcode collision detected | {R011.§1.AC.01,.AC.02,.AC.04,.AC.05} |
| Unit (config) | Path resolution: tilde, relative, absolute | {R011.§1.AC.03} |
| Unit (config) | Unresolved targets produce warnings, not hard errors | {R011.§1.AC.06} |
| Unit (resolver) | `PeerProjectResolver` cache + error taxonomy | {R011.§2.AC.05,.AC.06} |
| Unit (resolver) | Peer-cache invalidation on `projectAliases` reload — 6 tests in `peer-project-resolver.test.ts`: `invalidate(name)` drops cache; idempotent for unknown aliases; repoint (path change re-loads); remove (alias deleted → next resolve returns `alias-unknown`); unchanged-preserved (factory called exactly once across reload — §2.AC.06 invariant); mixed (a unchanged + b repointed + c removed) | {R011.§4.AC.12} |
| Unit (lint) | `derives=<alias>/<id>` and `superseded=<alias>/<id>` rejection | {R011.§2.AC.03,.AC.04} |
| Integration (CLI) | `scepter show vendor-lib/R042` against fixture peer project | {R011.§3.AC.01} |
| Integration (CLI) | `scepter gather` stub-only treatment of alias references | {R011.§3.AC.02} |
| Integration (CLI) | `scepter claims trace` cross-project footer | {R011.§3.AC.03} |
| Integration (CLI) | `scepter claims gaps` excludes peer claims | {R011.§3.AC.04} |
| Integration (CLI) | `scepter claims lint`/`index` validate alias references | {R011.§3.AC.06} |
| Manual (VS Code) | Hover, definition, decoration, diagnostics on alias-prefixed refs | {R011.§4.AC.01,.AC.03,.AC.04,.AC.05,.AC.06} |
| Manual (VS Code) | Config edit triggers reload; multi-project alias isolation | {R011.§4.AC.02,.AC.11} |
| Manual (VS Code) | Markdown preview, sidebar views, openConfig command | {R011.§4.AC.07,.AC.08,.AC.09,.AC.10} |
| Doc grep | Skill files contain alias grammar; closed-world prose audited | {R011.§5.AC.01,.AC.02,.AC.03,.AC.04,.AC.05,.AC.06} |
| Doc grep | ~~Agent dispatch templates updated~~ — WITHDRAWN per R011 §Non-Goals (Q2 resolved 2026-04-30) | {R011.§Non-Goals — Updates to agent dispatch templates} |

The unit/integration boundary follows the existing test discipline in `core/src/**/__tests__/`. Manual VS Code testing is the existing extension test discipline (no automated harness yet — cf. the audit at `docs/202604021030 VS Code Extension Audit.md`, "No test files. The extension has zero tests"). This DD does not introduce VS Code automated tests; that is a separate effort.

## Out of Scope

Explicitly excluded from this DD (per R011 Non-Goals and resolved OQs):

- **Cross-project derivation** — `derives=<alias>/<id>` is rejected at lint time per Phase 5. Reconsideration is left to a future requirement per R011.§2.AC.03.
- **Cross-project supersession** — `superseded=<alias>/<id>` is rejected permanently per R011.§2.AC.04.
- **Cross-project metadata events** — `scepter meta` operations on alias-prefixed addresses are not implemented. The metadata store remains per-project per R011 Non-Goals.
- **Cross-project gap detection or trace federation** — peer claims do not enter the local gap report or trace matrix per Phase 8.
- **Transitive aliasing** — `b/c/R001` returns parser null and a CLI hard-error per Phase 3 / R011.§2.AC.07.
- **Version pinning, semver, or hash integrity** — no alias target version field is implemented; OQ.06 deferred.
- **Synchronization / fetching of peer projects** — out of scope.
- **Shared registry of project IDs** — out of scope.
- **Bidirectional references across projects** — peer projects do not gain incoming-reference edges from local citations.
- **Write operations against peer projects** — all cross-project operations are read-only. The VS Code definition-jump opens the peer file as a normal text document; the local extension's commands (refresh-index, lint) do not propagate edits.
- **`@implements` annotations in source code attributing to peer claims as Source-projection coverage in the peer's own trace matrix** — peer trace matrices are peer-project-internal; an `@implements vendor-lib/R005.§1.AC.01` in local source code creates a citation-display relationship only.
- **Peer-project search** — `scepter search --include-peers` is left for a follow-up DD per R011.§3.AC.05.
- **`gather --follow-aliases`** — left for a follow-up per resolved OQ.04 default.
- **VS Code automated test harness** — separate effort; this DD relies on manual VS Code testing.
- **Structured settings UI for `projectAliases`** — `scepter.openConfig` opens the JSON file directly per R011.§4.AC.10; a richer UI is left for follow-up.
- **Edits to agent dispatch templates** (`claude/agents/sce-producer.md`, `claude/agents/sce-reviewer.md`) — explicitly out of scope per R011 §Non-Goals (Q2 resolved 2026-04-30 in favor of skill-files-only scope). Producer and reviewer agents load the skill files at runtime and inherit cross-project grammar transitively through the §5.AC.01–§5.AC.04 skill-file edits.

## Observations

### Multi-project workspace already exists; alias loading layers on top

The extension already implements multi-SCEpter-project workspace discovery (`extension.ts:38-72` `discoverProjects`; `selectProject` command). Each detected project is a candidate for alias loading. {R011.§4.AC.11} requires that switching the active project switches the active alias map; the existing architecture makes this straightforward — the active project's `projectAliases` is loaded on activation and on switch, peer indexes are scoped to the active project's alias map. No structural change to multi-project handling is needed.

### The CLI's `claims index --json` is not on the alias path

Per DD012 the extension does not consume the CLI's JSON output to build its index — it imports the core directly and runs `ClaimIndex.build()` against an in-process `ProjectManager`. The alias map is therefore read straight from `configManager.getAllAliasResolutions()`; no new CLI plumbing is required for the extension's sake.

If a future consumer of `scepter claims index --json` (e.g. a non-extension CLI tool) wants the alias map serialized in the JSON, that is a separate concern and a separate AC. It does not gate this DD.

### Peer-cache invalidation on config edits — RESOLVED via §4.AC.12 + Phase 12.5

This observation was originally flagged during the Phase 10 architecture correction as a gap: when `projectAliases` is edited, `refresh()` rebuilds the alias map from the reloaded `configManager`, but the core `PeerProjectResolver` instance was not torn down — its cached `Promise<PeerProject>` entries could remain stale for renamed/repointed/removed aliases. R011.§4.AC.12 (added 2026-04-30) and Phase 12.5 of this DD's Integration Sequence implement the resolution: `ConfigManager.reloadConfig()` emits an `aliases:changed` event with `{prev, next}` snapshots; `ProjectManager`'s constructor subscribes and calls `peerResolver.invalidateChanged(prev, next)`; the resolver's diff-based invalidation drops only entries whose path or resolved-status changed (or were removed), preserving §2.AC.06's caching invariant for unchanged aliases. See Phase 12.5 in the Integration Sequence and the Module Inventory rows on `core/src/config/config-manager.ts` (event emission), `core/src/project/project-manager.ts` (subscription wiring), and `core/src/project/peer-project-resolver.ts` (`invalidate` / `invalidateChanged` primitives).

### `claim-metadata.ts` is the natural site for `derives=`/`superseded=` validation

Phase 5 places the rejection logic in lint-command, but the underlying parsing of metadata targets happens in `core/src/claims/claim-metadata.ts`. The implementer may find it cleaner to do the alias-prefix detection there (returning a typed `MetadataTarget` with an `aliasPrefix?: string` field) and let the lint command consume that. Either placement is correct; the DD does not mandate one.

### VS Code test gap is pre-existing

The VS Code extension has no automated test harness today (per the audit). Phase 11 and 12 rely on manual testing. This is a known pre-existing condition; introducing a test harness alongside this feature would expand scope significantly. The implementer should note this and leave the test-harness work as a separate effort.

### The agent docs are read by humans too

Phase 13's revisions to `claims.md` and `SKILL.md` are read by both agents (during dispatch) and humans (when learning the system). The revisions should preserve the existing readability for humans while making the cross-project case visible to agents. Watch for over-promotion of cross-project syntax — per R011.§5.AC.06, the cross-project case is the minority and existing local examples should remain primarily local.

## References

- {R011} — Cross-Project Note and Claim References via Path Aliases (this DD's source requirement)
- {R004} — Claim-Level Addressability and Traceability System (the parser grammar this DD extends)
- {R005.§2.AC.06} — `:superseded=TARGET` lifecycle primitive (whose cross-project use is permanently rejected per R011.§2.AC.04)
- {R006.§Non-Goals — Cross-project derivation} — Per-project derivation invariant (preserved by Phase 5)
- {R009.§Non-Goals — No cross-project metadata} — Per-project metadata invariant (preserved by Out of Scope)
- {A004.§1.AC.05} — Per-project storage location invariant
- {DD012} — VS Code Extension Migration: CLI to Library (the migration that gave the extension `parseClaimReferences`/`parseNoteMentions` directly; Phases 9-12 build on the post-DD012 surface)
- {DD013} — VS Code Rich Views: Sidebar TreeView (the views Phase 12 must keep peer-project-isolated per {R011.§4.AC.09})
- {S001} — Skill Files as Documented Artifacts (parallel coverage projection of {R011.§5}; S001 covers §5 via spec-level forward-pointing ACs on what each skill file MUST encode, while this DD covers §5 via Module Inventory rows describing the editing operations against `claims.md` and `SKILL.md`. Both projections are expected to coexist — S001 is the specification-side projection (artifact contracts), this DD is the implementation-side projection (Phase 13 edit plan). For an agent implementing Phase 13, S001 §2 / §3 / §4 give the contractual targets the edits must satisfy; the Module Inventory rows here describe how to perform those edits.)
- `docs/202604021030 VS Code Extension Audit.md` — Background audit of the extension surface; Issue 2 (`noteTypes` not emitted in JSON) and Issue 8 (extension never reads config directly) are relevant context for {R011.§4.AC.02}
- `docs/202604021930 VS Code Extension Rich Views Research and UI Proposal.md` — Background on the rich-views layer Phase 12 touches

## Status

- 2026-04-30: Retargeted §5.AC.07 → §5.AC.06 references at lines 304 and 645 after R011 renumber. Descoped four §5.AC.05 module rows (dispatch-template editing) at lines 318, 324, 580, 601 per R011's new §Non-Goals entry (Q2 resolved 2026-04-30 in favor of skill-files-only scope). Two additional silent-alias references found and retargeted from `§5.AC.06` → `§5.AC.05` at lines 303 and 312 ("REVISE closed-world prose" rows; under the new R011 numbering, closed-world-prose binds to AC.05, not AC.06). Phase 13's spec line and the Testing Strategy doc-grep row updated from `.AC.06,.AC.07` to `.AC.05,.AC.06`. Specification Scope and Out of Scope sections updated to reflect that `claude/agents/` dispatch-template edits are explicitly out of scope.
- 2026-04-30: Added {S001} to References as the parallel coverage projection of R011 §5. S001 covers §5 via specification-level forward-pointing ACs (S001 §4 derives all six §5.AC.01–§5.AC.06 via `derives=R011.§5.AC.NN`); this DD covers §5 via Phase-13 Module Inventory rows for `claims.md` and `SKILL.md`. The two paths coexist: S001 is the contractual projection (what the skill files MUST encode); this DD is the implementation projection (how to edit them). Cross-link added in graph-hygiene pass; no AC/DC change.
- 2026-04-30: Phase 10 description originally prescribed CLI subprocess invocation (`scepter --project-dir <peer> claims index --json`) for peer-project loading and an extension-owned `peerIndexes` cache. This contradicted DD012's library-API model and was caught when the implementation team correctly diverged from the (wrong) brief and used the core's `PeerProjectResolver` (DD015 Phase 4) via `this.projectManager.peerResolver` — `aliasMap` is now populated from `configManager.getAllAliasResolutions()` and `resolveCrossProject` delegates to `peerResolver.lookupNote`/`lookupClaim` (see `vscode/src/claim-index.ts:178,271-314`). DD015 prose updated in three places to reflect the actual library-API architecture: Module Inventory row for `vscode/src/claim-index.ts`, Wiring Map (Import Graph VS Code, Call Chains cross-project flow, Component Tree, Flow 1, Flow 4), Integration Sequence Phase 10, and Observations (replaced the now-obsolete CLI-serialization observation with a peer-cache-invalidation follow-up note). No code change; no AC/DC numbering change.
- 2026-05-01: Phase 12.7 binding cleanup. Added Phase 12.5 entry to Integration Sequence (peer-cache invalidation on `projectAliases` reload, R011.§4.AC.12) between Phase 12 and Phase 13. Added Module Inventory rows for the §4.AC.12 call-sites: `core/src/config/config-manager.ts` (`reloadConfig` event emission) and `core/src/project/project-manager.ts` (constructor `aliases:changed` subscription wiring) — the resolver-side primitive row for §4.AC.12 was already in place at line 150. Added Testing Strategy row for §4.AC.12 covering the 6 new tests in `peer-project-resolver.test.ts`. Updated Specification Scope prose from "all 36 ACs" to "all 37 ACs". Replaced the "Peer-cache invalidation on config edits is unspecified" Observation with a RESOLVED note pointing at §4.AC.12 + Phase 12.5. Phase 12.7 also added DC-level `@implements {DD015.§1.DC.NN}` source annotations alongside existing R011 annotations at the design-decision sites: DC.01 at `core/src/config/config-validator.ts:ALIAS_NAME_REGEX`, DC.02 at `core/src/types/config.ts:projectAliases`, DC.03 at `core/src/cli/commands/context/gather-handler.ts:CrossProjectStub`, DC.04 at `core/src/config/config-manager.ts:validateAliases`, DC.05 at `core/src/project/peer-project-resolver.ts` file header, DC.06 at `vscode/src/claim-index.ts` alias-map refresh site, DC.07 at `vscode/src/decoration-provider.ts` purple decoration block + `vscode/src/markdown-plugin.ts` cross-project class wiring, DC.08 at `vscode/src/hover-provider.ts:buildCrossProjectHover`, DC.09 at `core/src/parsers/claim/claim-tree.ts` `ClaimTreeError.type` extension + `vscode/src/diagnostics-provider.ts` SEVERITY_BY_TYPE. DC.10 binds skill-file content (`claude/skills/scepter/claims.md` "Cross-Project References" section ordering); not annotated per S001 §5's per-section-claim-ref prohibition (token cost is binding; skill-file annotation discipline overrides DC-bound source annotation here). No AC/DC numbering change.
