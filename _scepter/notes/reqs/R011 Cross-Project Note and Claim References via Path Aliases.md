---
created: 2026-04-26T03:18:51.164Z
tags: [cross-project,references,aliases,configuration,documentation]
---

# R011 - Cross-Project Note and Claim References via Path Aliases

## Overview

A SCEpter project today is a closed reference world: every `{R042}`, every `{R004.§1.AC.03}`, every `derives=R005.§1.AC.01` resolves against the current project's claim index. This requirement opens that world to a bounded, configuration-declared set of *peer* SCEpter projects. A project author registers a named alias pointing at another SCEpter project on disk; references prefixed with that alias resolve against the peer project instead of the current one.

The shape borrows from TypeScript's `paths` aliasing: a small map from short names to filesystem locations, declared in config, used at the point of reference. A reference such as `vendor-lib/R042` reads as "look up R042 in the project registered under the alias `vendor-lib`." This gives a project a way to cite a vendored design document, an upstream specification, or a sibling project's architecture claim without copying content or fabricating local IDs.

**Core Principle:** Cross-project references are **read-only resolution**, not federation. The peer project's claims do not enter the current project's derivation graph, metadata store, gap report, or trace matrix as first-class entries. An alias-prefixed reference is a citation pointer the CLI can dereference for display; it is not a shared address space. This preserves the invariants stated in {R006.§Non-Goals} and {R009.§Non-Goals} that derivation and metadata are per-project — those constraints continue to hold and are not relaxed by this requirement.

**Spec coverage:** The alias-prefixed reference shape (`<alias>/<normal-reference>`) is canonicalized at {S002.§1.AC.10} as one of the reference forms in the consolidated grammar; the cross-project resolution semantics, prohibitions on `derives=`/`superseded=` against peer claims, and consumer-side behavior are consolidated in {S002.§7} (Cross-Project Behavior). S002 is the authoritative cross-tab spec for every reference shape and every consumer's contract; this requirement is its primary upstream input for the cross-project surface.

## Problem Statement

Today, when a project legitimately needs to refer to a claim or note in a peer SCEpter project, the only options are:

| Scenario | Current Workaround | Cost |
|----------|-------------------|------|
| Cite an upstream library's design claim in a downstream consumer's spec | Copy the claim text into a local note; lose traceability when upstream changes | Drift; reviewer cannot verify the citation matches the source |
| Reference a sibling project's architecture decision from a shared-team mono-repo | Include the prose verbatim; no link the CLI can follow | `scepter ctx show` cannot dereference the citation |
| Vendor a SCEpter-managed dependency and refer to its requirements | Maintain a parallel local mirror of relevant note IDs | Synchronization burden; no single source of truth |
| Federated team writing complementary projects that audit each other | Out-of-band documentation cross-references | Citations rot silently |

The problem is bounded but real. The constraint that `derives=` resolves only within the current project (per {R006.§Non-Goals — Cross-project derivation}) and that metadata events are per-project (per {R009.§Non-Goals — No cross-project metadata}) is correct: federation is a much larger problem than reference resolution, and conflating the two would compromise the per-project invariants those requirements depend on. But there is no current mechanism that lets a reference *point at* a peer project's note for read-only display purposes — even though that is the lower-cost half of the problem and addresses the most common need (citation, not federation).

## Design Principles

**Aliases are read-only citation pointers, not federation.** An alias-prefixed reference resolves to a peer project's note for display by `show`, `gather`, `search`, and trace-rendering commands. It does NOT introduce the peer's claims into the current project's index, derivation graph, metadata store, or gap report. The peer's data flows out (when the local CLI reads the peer to render); the local data never flows in.

**Aliases are local to the project, not portable.** An alias declared in project A's config maps a name to a filesystem path on the machine where the lookup happens. The same alias name in project B's config may point elsewhere. Aliases are not part of a shared registry, not synced, and not version-pinned by this requirement (version pinning is OQ.06).

**Cross-project references are explicit at the syntax level.** A reference with no alias prefix continues to resolve in the local project, exactly as today. The new syntax MUST be visually distinct from a local reference, so that a reader can tell at a glance whether a citation is local or cross-project. Backward compatibility is preserved by inversion: existing notes contain zero alias-prefixed references, so existing parsing behavior is unchanged.

**The peer project is itself a SCEpter project.** Resolution requires that the alias's target path contains a valid `_scepter/scepter.config.json` (or equivalent, per the standard discovery rules). Pointing an alias at an arbitrary directory is an error. This bounds the resolution algorithm: the local CLI loads the peer project the same way it loads itself, then performs a normal lookup against the peer's index.

## Requirements

### §1 Alias Configuration

The project's configuration MUST allow declaring a map of alias names to peer SCEpter project paths. The map lives in the existing `scepter.config.json` schema; no new file is introduced.

§1.AC.01 The configuration schema MUST accept a top-level `projectAliases` (or equivalent — exact key name is OQ.05) field whose value is a map from alias name (string) to alias target. Each target MUST minimally include a filesystem path to a peer SCEpter project root (the directory containing `_scepter/`, or the directory containing `scepter.config.json`).

§1.AC.02 Alias targets MAY be specified as either a plain string path (shorthand) or an object permitting future extension fields. The string form `"alias": "../other-project"` is equivalent to the object form `"alias": { "path": "../other-project" }`. This shape preserves room to add fields like `version`, `pin`, or `description` later without a breaking change.

§1.AC.03 Alias paths MUST be resolved relative to the location of the `scepter.config.json` file that declares them. Absolute paths MUST also be supported. Tilde expansion (`~/projects/foo`) MUST be supported.

§1.AC.04 Alias names MUST conform to a constrained character set so they cannot collide with the note-ID regex (`[A-Z]{1,5}\d{3,5}`) or with the claim metadata grammar from {R009.§4}. The exact allowed character set is OQ.02, but at minimum: alias names MUST NOT match `[A-Z]{1,5}\d{3,5}` and MUST NOT contain `/` (the cross-project separator).

§1.AC.05 An alias name declared in `projectAliases` MUST NOT collide with any local note ID prefix. If `vendor` is configured as an alias and a local note `VENDOR001` exists, the system MUST report a configuration error at config-load time.

§1.AC.06 The configuration validator MUST verify, at load time, that each alias target path exists on disk and contains a valid SCEpter project. Targets that fail this check MUST produce a warning (not a hard error) and MUST be marked as unresolved — references through such aliases produce a clear "alias unresolved" error at the reference site, not silent failures.

### §2 Reference Syntax and Resolution

Alias-prefixed reference grammar specified in {S002.§1.AC.10} and {S002.§7}; {S002.§7.AC.01–07} carries the consumer contracts.

The reference parser accepts an alias prefix on note IDs and claim references; the resolver dereferences the prefix against the configured alias map and looks up the remainder in the peer project's index. Cross-project derivation and supersession are rejected: the citation-not-federation invariant ({R006.§Non-Goals}, {R009.§Non-Goals}) holds — peer claims do not enter the local index, derivation graph, or metadata store. Transitive aliasing is rejected.

§2.AC.01 The parser MUST accept references of the shape `<alias>/<normal-reference>` where `<normal-reference>` is any reference form already accepted by the existing parser ({R004.§1} grammar) — bare note ID, note + section, note + claim, note + section + claim, ranges. The separator is the forward slash `/`. Concrete shapes: `vendor-lib/R042`, `vendor-lib/R005.§1`, `vendor-lib/R005.§1.AC.01`, `vendor-lib/R005.§1.AC.01-06`.

§2.AC.02 An alias-prefixed reference MUST be valid in both braced contexts (e.g., inside `{...}` in note prose) and in code-comment annotations (`@implements`, `@see`, `@validates`, `@depends-on`, `@addresses`).

§2.AC.03 An alias-prefixed reference MUST NOT be valid as a `derives=TARGET` value. Per {R006.§Non-Goals}, derivation is per-project. The linter MUST reject `derives=<alias>/<id>` with a clear error pointing at the {R006} constraint. **Reconsideration is permitted** — a real downstream-deriving-from-upstream use case can motivate a future requirement that relaxes both R006 and this AC together. This is the default-rejected boundary, not a permanent invariant like §2.AC.04.

§2.AC.04 An alias-prefixed reference MUST NOT be valid as a `superseded=TARGET` value. The rationale is permanent and stronger than for §2.AC.03: supersession is an assertion *about the target's lifecycle*, and the local project has no authority to make lifecycle assertions on a peer project's claims. Allowing `superseded=<alias>/<id>` would let a local note unilaterally annotate a peer's claim as the "supersession target of" something the peer never opted into. This boundary SHOULD NOT be revisited without first establishing a federation contract that gives peer projects opt-in awareness of incoming supersession claims.

§2.AC.05 The resolver MUST resolve the alias prefix to a peer project, load that peer project's claim index (via the same mechanism the local CLI uses for itself), and then resolve the remainder of the reference against the peer's index. Resolution failures (alias not found, peer project absent, note not found in peer, claim not found in peer) MUST produce distinct, actionable error messages.

§2.AC.06 Peer project loading SHOULD be cached per CLI invocation — repeated references to the same alias within a single command MUST NOT re-load the peer project from disk. Caching MAY span longer scopes (per-process, per-watcher session) but cross-invocation persistence is not required.

§2.AC.07 Transitive aliasing — using an alias defined in a peer project to traverse to a third project — MUST NOT be supported in this requirement. If project A aliases project B, and project B aliases project C, then `A→B→C` is not resolvable from project A. A reference `b-alias/c-alias/R001` MUST produce a clear error. (See {R006.§Non-Goals} for the analogous principle on derivation chains.)

### §3 CLI Behavior on Alias-Prefixed References

The existing read-side commands (`show`, `gather`, `search`, `claims trace`, `claims thread`) MUST handle alias-prefixed references in their inputs and outputs without violating the read-only-citation principle.

§3.AC.01 `scepter show <alias>/<id>` (e.g., `scepter show vendor-lib/R042`) MUST display the peer project's note in the same format as a local note, with a clearly visible header indicating the source alias and peer project path. The displayed note MUST NOT be confusable with a local note.

§3.AC.02 `scepter gather` MUST follow alias-prefixed references encountered in the gathered notes' content for display purposes, but MUST NOT include the peer's claims, references, or metadata in any aggregate count, gap report, or trace matrix that the local project produces. Whether peer notes appear in `gather`'s output as full content, as a stub indicating the alias citation, or are omitted entirely is OQ.04.

§3.AC.03 `scepter claims trace` MUST render alias-prefixed references appearing in local notes as cross-project citations, visually distinguished from local references. The peer's trace matrix MUST NOT be merged into the local trace matrix.

§3.AC.04 `scepter claims gaps` MUST NOT include peer-project claims in its gap analysis. An alias-prefixed reference in a local note does not constitute "implementation" of any peer claim from the local project's perspective, and conversely an absent peer reference does not constitute a local gap.

§3.AC.05 `scepter search` MAY accept a flag to include peer projects in the search scope (exact flag name and default behavior is out-of-scope for this requirement — left to downstream design). By default, `search` MUST search only the local project. Peer-project search, if implemented, MUST clearly label results with their source alias.

§3.AC.06 The lint and index commands (`scepter claims lint`, `scepter claims index`) MUST validate alias-prefixed references in local notes: the alias MUST be declared, and the peer's note/claim MUST exist at the time of linting. Validation failures MUST be reported with the same severity model the linter uses for other broken references.

### §4 VS Code Extension Behavior

The VS Code extension surfaces peer-project content for alias-prefixed references so that an editor user — opening a SCEpter note in VS Code — can see what cross-project citations exist and dereference them in place. The extension's existing reference-resolution surface (hover, definition, decorations, diagnostics, claim index, markdown preview, sidebar views) MUST be extended to recognize, resolve, and visually distinguish alias-prefixed references. The peer project's content is loaded read-only via the same resolution rules established in §1 and §2; the local extension's index, diagnostics, and views MUST NOT merge peer-project state with local-project state.

§4.AC.01 The extension's reference-pattern matcher (currently in `vscode/src/patterns.ts`) MUST recognize alias-prefixed references in both braced (`{vendor-lib/R042}`, `{vendor-lib/R005.§1.AC.01}`) and code-comment (`@implements {vendor-lib/R005.§1.AC.01}`) contexts. Recognition MUST yield a match whose normalized form preserves the alias prefix so downstream providers can route to the peer project.

§4.AC.02 The extension MUST load the active project's `projectAliases` configuration (per §1.AC.01) at activation time and on configuration changes. The extension MUST detect changes to `scepter.config.json` and rebuild the alias map without requiring a manual reload. If the configuration declares an alias whose target path is unresolved (per §1.AC.06), the extension MUST surface the warning in its output channel and treat the alias as unresolved at the reference site.

§4.AC.03 Hover (`hover-provider.ts`) on an alias-prefixed reference MUST display peer-project note or claim content fetched from the resolved peer project. The hover MUST include a clearly visible header indicating the source alias and peer project (e.g., `vendor-lib (../vendor-lib)`), so the user cannot mistake peer content for local content. If the alias is unresolved or the peer note/claim is not found, the hover MUST surface a distinct message naming the failure mode (alias-unknown, peer-absent, note-not-found, claim-not-found) per §2.AC.05.

§4.AC.04 Go-to-definition (`definition-provider.ts`) on an alias-prefixed reference MUST resolve to the peer project's note or claim file location and open that file in the editor. The opened file is read-only from the local project's perspective in the sense that local commands (refresh-index, lint) MUST NOT treat edits to the peer file as edits to the local project; the extension MAY allow the user to edit the file as a normal text document, since file-system write access is the editor's responsibility and out of scope.

§4.AC.05 Decorations (`decoration-provider.ts`) MUST visually distinguish alias-prefixed references from local references. The exact visual treatment (color, underline style, badge, icon) is left to downstream design, but the rendered decoration MUST be discriminable at a glance: a reader scanning a note MUST be able to tell which references are local and which are cross-project without hovering. Resolved cross-project references and unresolved cross-project references MUST also be distinguishable from each other (e.g., distinct decoration types).

§4.AC.06 Diagnostics (`diagnostics-provider.ts`) MUST surface alias-related errors as VS Code diagnostics in the Problems panel. At minimum: alias-unknown (the prefix is not declared in `projectAliases`), peer-unresolved (the configured target path does not resolve to a valid SCEpter project per §1.AC.06), and peer-target-not-found (the alias resolves but the note or claim does not exist in the peer). Severity SHOULD follow the existing severity model (errors for hard violations, warnings for soft issues such as a peer-claim that has been removed via lifecycle tag).

§4.AC.07 The claim index (`claim-index.ts`) MUST be aware that alias-prefixed references exist in local notes without merging peer claims into the local index's entry map. An alias-prefixed reference MUST NOT register as a local claim entry. The index MAY maintain a separate per-alias cache of peer indexes (mirroring §2.AC.06's per-invocation caching guidance) to power hover and definition without re-loading the peer project on every reference.

§4.AC.08 The markdown preview plugin (`markdown-plugin.ts`) MUST recognize alias-prefixed references so that the rendered preview marks them with the same visual distinction as in-editor decorations (per §4.AC.05) and exposes them as click-targets that resolve via the same path as definition jumping (per §4.AC.04).

§4.AC.09 Sidebar tree views (the providers in `vscode/src/views/`) and the traceability webview MUST NOT mix peer-project entries into the local-project listings. An alias-prefixed reference appearing in a local note's content MAY be visible in a per-note "outgoing references" listing (since it is genuinely an outgoing reference from a local note), but MUST be rendered with the same cross-project visual distinction as decorations (per §4.AC.05). Peer notes MUST NOT appear as top-level entries in the Notes Explorer or as rows in the local trace matrix view.

§4.AC.10 The user MUST have a way to view and edit the workspace's `projectAliases` configuration from within VS Code. At minimum, the extension MUST provide a command (e.g., `scepter.openConfig`) that opens `scepter.config.json` in an editor tab, scrolled to the `projectAliases` section if one exists. Whether the extension additionally offers a structured settings UI (e.g., a webview form or contributed settings) is left to downstream design.

§4.AC.11 The extension MUST handle multi-project workspaces (the existing `discoverProjects` flow in `extension.ts`) such that each detected SCEpter project's `projectAliases` is loaded for that project only. Switching the active project (via `scepter.selectProject`) MUST switch the active alias map. Aliases declared by one project in the workspace MUST NOT be visible to another project in the same workspace.

§4.AC.12 When `projectAliases` is reloaded at runtime (per §4.AC.02 — `scepter.config.json` edits, including via the user-facing flow established in §4.AC.10, and active-project switches per §4.AC.11), the `PeerProjectResolver`'s peer-cache MUST be invalidated for any alias whose configured target path changed, was renamed, or was removed. Aliases whose target paths are unchanged across the reload MUST NOT be re-loaded — the cache MUST persist for unchanged entries to preserve the per-invocation caching invariant established in §2.AC.06. The invalidation MUST apply both in the VS Code extension's in-process resolver (where the peer-cache lives across `refresh()` calls on a long-lived `ProjectManager`) and in the CLI's per-invocation resolver lifecycle when relevant (e.g., a long-running watcher session that reloads config mid-session). The intent is that after a user edits `projectAliases` to repoint `vendor → /a` to `vendor → /b`, the next reference through `vendor` resolves against `/b`, not the previously cached `/a`.

### §5 Agent-Facing Documentation Updates

The Claude Code skills, agent instructions, and CLI documentation read by AI agents (`claude/skills/scepter/`, `claude/agents/`) MUST be updated so that an agent reading them learns the cross-project reference grammar, the prohibitions established in §2.AC.03 and §2.AC.04, and the citation-versus-federation distinction. The goal is that an agent encountering a peer-project citation opportunity correctly chooses the alias-prefixed form, and conversely an agent attempting to use `derives=` or `superseded=` against a peer's claim is mechanically guided to refuse. The doc edits are the verification surface; the skill files are the editable artifacts.

§5.AC.01 The canonical claim-reference grammar in `claude/skills/scepter/claims.md` (currently in §"Syntax & Rules" → "Claim Reference Format") MUST be extended to define the alias-prefixed form `<alias>/<normal-reference>`. The extension MUST include the abstract grammar (alias name + separator + existing reference grammar), at least one braced example (`{vendor-lib/R005.§1.AC.01}`), and at least one code-annotation example (`@implements {vendor-lib/R005.§1.AC.01}`). The new content MUST appear adjacent to the existing reference-format table so a reader scanning the grammar sees both local and cross-project forms together.

§5.AC.02 `claude/skills/scepter/claims.md` MUST gain a dedicated section on cross-project references covering: (a) when to use the alias-prefixed form (citing a peer project's note or claim for display, where local copy would lose traceability), (b) when NOT to use it (for `derives=` per §2.AC.03 default, and PERMANENTLY for `superseded=` per §2.AC.04), and (c) the citation-versus-federation distinction (peer claims do not enter the local index, gap report, or trace matrix per the Core Principle of this requirement). The section MUST include the §2.AC.03 reconsideration clause and the §2.AC.04 permanence rationale verbatim or paraphrased with attribution to this requirement.

§5.AC.03 The "Hard Rules" or "Common Mistakes" tables in `claims.md` MUST gain rows or entries specifically rejecting `derives=<alias>/<id>` and `superseded=<alias>/<id>`. The error message text the agent should expect from the linter SHOULD be quoted or summarized so the agent can recognize and act on it.

§5.AC.04 The agent-facing CLI reference in `claude/skills/scepter/SKILL.md` (currently in §"CLI Reference") MUST surface alias-prefixed reference forms in at least one example per relevant subcommand (`show`, `gather`, and the lint/trace surfaces from §3.AC.06). The intent is that an agent skimming the CLI reference encounters the cross-project syntax in its natural usage context, not buried in claims.md.

§5.AC.05 The skill files MUST be updated such that an agent reading them encounters the alias-prefixed grammar BEFORE any prose that could be read as "all references resolve in the current project" — the existing implicit assumption MUST be replaced with the explicit two-case framing (local references resolve in the current project; alias-prefixed references resolve in the named peer project). This is a structural-edit requirement: where existing prose embeds the closed-world assumption, that prose MUST be revised, not merely supplemented.

§5.AC.06 Examples in `claims.md` and `SKILL.md` that currently use only local references SHOULD remain primarily local-reference examples (cross-project references are the minority case and over-promoting them in examples would distort the agent's frequency model). The cross-project examples introduced by §5.AC.01–§5.AC.04 are sufficient; existing examples MUST NOT be rewritten to use alias prefixes unless the example is specifically about cross-project usage.

## Edge Cases

### Peer Project Moved or Deleted

**Detection:** An alias's configured path no longer exists, or no longer contains a valid SCEpter project.
**Behavior:** Per §1.AC.06, configuration load reports a warning and marks the alias as unresolved. Per §2.AC.05, references through that alias produce an "alias unresolved" error at the reference site, naming the alias and the configured (now-invalid) path. No silent fallback to a local lookup.

### Alias Name Collides with Local Note ID Prefix

**Detection:** Configuration declares alias `R` while local notes use shortcode `R` for Requirement.
**Behavior:** Per §1.AC.05, configuration load produces an error. The system refuses to load until the collision is resolved (rename the alias).

### Reference to a Removed Claim in the Peer

**Detection:** `vendor:R005.§1.AC.04` resolves, but the peer's `R005.§1.AC.04` carries the `:removed` lifecycle tag.
**Behavior:** The reference resolves successfully (the claim ID exists). Display of the peer claim MUST surface the lifecycle state ("removed in peer project as of ..."). Whether the linter additionally warns is left to downstream design.

### Peer Project Updated Between Reads

**Detection:** Peer project content changed on disk between two CLI invocations, or even within a single invocation if cache lifetime allows it.
**Behavior:** Peer project state is whatever the local CLI most recently loaded. There is no version pinning in this requirement (see OQ.06). The local user is responsible for being aware that peer state can drift.

### Conflicting Alias Declarations Across Configs

**Detection:** Two separate `scepter.config.json` files in a project tree (e.g., a workspace and a sub-project) both declare the alias `vendor` pointing at different paths.
**Behavior:** The configuration loader's existing precedence rules govern. This is not a new failure mode introduced by this requirement; it inherits whatever the current `ConfigManager` does for conflicting top-level keys. Downstream design should document the resolution explicitly.

## Non-Goals

- **Cross-project derivation** — `derives=<alias><sep><id>` is rejected per §2.AC.03. The derivation graph remains per-project, preserving {R006.§Non-Goals — Cross-project derivation}.

- **Cross-project metadata** — Metadata events (per {R009}) on alias-prefixed claim addresses are not supported. The metadata store remains per-project, preserving {R009.§Non-Goals — No cross-project metadata}. Whether `scepter meta get vendor:R005.§1.AC.01` should be a read-only display passthrough is out of scope for this requirement.

- **Cross-project gap detection or trace federation** — The local trace matrix and gap report describe only local claims. Peer claims are not unified into a single matrix. Per §3.AC.03 and §3.AC.04.

- **Transitive aliasing** — Per §2.AC.07. A→B→C resolution is not supported in this requirement.

- **Version pinning, semver, or hash-based integrity** — Aliases in this requirement point at filesystem paths. Whether and how to add a `version` or `hash` field to alias targets is OQ.06.

- **Synchronization, fetching, or mirroring of peer projects** — SCEpter does not pull, push, clone, or update peer projects. The local user is responsible for placing peer projects on disk (via git clone, submodule, package manager, or any other mechanism).

- **A shared registry of project IDs** — There is no central directory of SCEpter projects, no project URN, and no global namespace. Aliases are local to the project that declares them.

- **Bidirectional references** — A peer project does not gain an "incoming reference from project X" edge in its reference graph when X cites it. The reference graph remains per-project.

- **Write operations against peer projects** — All cross-project operations are read-only. The local CLI never modifies a peer project's notes, config, or metadata store.

- **Alias-prefixed references in source code without local-project context** — The source-code scanner attributes `@implements` annotations to the project whose `core/src/` (or equivalent configured source folder) contains the file. An `@implements vendor:R005.§1.AC.01` annotation in local source code creates a citation-display relationship, but does NOT enter the peer project's traceability matrix as a Source-projection entry from the peer's perspective. (Peer-project trace matrices remain peer-project-internal.)

- **Updates to agent dispatch templates in `claude/agents/`** — Editing the dispatch templates (e.g., `sce-producer.md`, `sce-reviewer.md`) is NOT a binding scope of this requirement. Producer and reviewer agents inherit cross-project syntax knowledge transitively from the skill files (per §5.AC.01–§5.AC.06). The skill-file updates are the verification surface; the dispatch templates load those skill files at runtime and therefore acquire the new grammar without separate edits. If a future reviewer pass identifies a specific dispatch-template gap that the skill-file routing does not cover, that gap should motivate a follow-up requirement, not a retroactive expansion of R011's verification surface.

## Open Questions

### OQ.01 Reference syntax — separator and shape — RESOLVED 2026-04-30

**Question:** What is the concrete syntax for an alias-prefixed reference?

**Decision:** **Forward slash (`/`).** Concrete shape: `<alias>/<normal-reference>`. Examples: `{vendor-lib/R042}`, `{vendor-lib/R005.§1.AC.01}`, `@implements {vendor-lib/R005.§1.AC.01}`.

**Rationale:**
- Visually evokes a path, which matches the mental model of "look this up in another project."
- Avoids collision with the metadata-suffix grammar from {R009.§4}, which uses `:` extensively (`:P0`, `:security`, `:draft`, `derives=...`). Colon was the leading default and is still parseable, but the closeness to metadata grammar carries a non-trivial chance of reader confusion at the boundary between alias and metadata.
- Does not collide with the note-ID regex `[A-Z]{1,5}\d{3,5}` or with the hyphen prohibition inside claim IDs ({R004}'s hard rule against `AC-01`).
- Visually distinct from a local reference at a glance.

**Candidates considered:**

| Candidate | Example | Note |
|-----------|---------|------|
| Forward slash (chosen) | `{vendor-lib/R005.§1.AC.01}` | Path-evoking, no metadata-grammar collision |
| Colon | `{vendor:R005.§1.AC.01}` | Default fallback; close enough to `:lifecycle` and `key=value` suffixes to risk reader confusion |
| Hyphen | `{vendor-R005.§1.AC.01}` | Confusing given the {R004} prohibition on hyphens inside claim IDs |
| At-sign suffix | `{R005.§1.AC.01@vendor}` | Suffix form awkward for common case |
| Double-colon | `{vendor::R005.§1.AC.01}` | Visually heavy |
| Bracketed alias | `{[vendor]R005.§1.AC.01}` | Visually disruptive |

**Constraints satisfied:**
- Parseable by extending the existing claim parser without breaking local-only references.
- Does not match `[A-Z]{1,5}\d{3,5}`.
- Does not collide with R009.§4 metadata grammar.
- Distinguishable in both braced (`{...}`) and braceless (code-annotation) contexts.

**Forward constraint introduced by this resolution:** Future range/filter syntax extensions ({R004} grammar evolution) MUST avoid using `/` in a way that conflicts with the cross-project separator. This is now a binding constraint on parser-grammar work downstream of R011.

**Unblocks:** §2.AC.01, §2.AC.02, §2.AC.07 (each was previously blocked on this OQ).

### OQ.02 Alias name character set

**Question:** What characters are allowed in alias names? The minimum constraints are stated in §1.AC.04, but the full positive grammar is undecided.

**Candidates:**
- Lowercase letters, digits, hyphens (kebab-case): `vendor-lib`, `team-platform`
- Lowercase letters, digits, underscores: `vendor_lib`
- Both, with one preferred convention

**Constraints:** Must not match `[A-Z]{1,5}\d{3,5}` (the note-ID regex). Must not include the separator chosen in OQ.01. Should be readable.

**Resolution path:** Downstream design. Default assumption: lowercase kebab-case (`[a-z][a-z0-9-]*`), prohibiting trailing hyphens.

### OQ.03 Configuration key name

**Question:** Is the config field `projectAliases`, `aliases`, `peers`, `references`, or something else?

**Resolution path:** Downstream design picks a name consistent with existing config conventions in `scepter.config.json`. Default assumption: `projectAliases`.

### OQ.04 Behavior of `gather` on alias-prefixed references

**Question:** When `scepter gather LOCAL_NOTE` encounters an alias-prefixed reference in `LOCAL_NOTE`'s content, what does the output show?

**Candidates:**
1. **Stub only.** Show the citation, the alias, and the peer note ID; do not load or display peer content. Cheapest and most predictable.
2. **Stub + lazy fetch.** Show the citation by default; offer a flag like `--follow-aliases` that loads and includes peer content.
3. **Full fetch by default.** Load and display peer content inline, marked as cross-project.

**Constraints:** Must not violate the principle that peer claims do not enter local aggregate counts (per §3.AC.02).

**Default assumption:** Stub-only by default; downstream design may add a flag for fuller behavior.

### OQ.05 Configuration validation timing

**Question:** When does the config validator check that alias targets resolve to valid SCEpter projects? At every CLI invocation, lazily on first use, or only when an explicit `scepter doctor`-style command runs?

**Tradeoff:** Eager validation surfaces problems early but adds startup cost when peer projects are large. Lazy validation defers cost but may produce confusing errors mid-command.

**Default assumption:** Eager validation at config load (per §1.AC.06), with results cached for the CLI invocation lifetime.

### OQ.06 Version pinning and integrity

**Question:** Should an alias target be able to declare an expected version, commit hash, or content hash of the peer project? If so, what enforcement does the system perform?

**Out of scope for this requirement, but flagged because the user's verbatim example syntax (`other-project-hash-10.12.12.CR.1`) suggested a hash-like component.** The illustrative example is treated as gestural — version pinning is a real concern in cross-project references but is not in scope here. A follow-up requirement may add it.

**Default assumption:** No version pinning. Aliases point at filesystem paths; the local user is responsible for peer-project integrity (e.g., via git, package manager, or build pipeline).

## Acceptance Criteria Summary

| Section | Count |
|---------|-------|
| §1 Alias Configuration | 6 |
| §2 Reference Syntax and Resolution | 7 |
| §3 CLI Behavior on Alias-Prefixed References | 6 |
| §4 VS Code Extension Behavior | 12 |
| §5 Agent-Facing Documentation Updates | 6 |
| **Total** | **37** |

## References

- {R004} — Claim-Level Addressability and Traceability System (the reference grammar this requirement extends; OQ.01's resolution introduces a forward constraint on future {R004.§1} grammar work — see "Forward constraint introduced by this resolution")
- {S002.§7} — Cross-Project Behavior (consolidated spec for cross-project resolution and consumer contracts)
- {S002.§1.AC.10} — Alias-prefixed reference shape (canonical form in the cross-tab grammar)
- {R005.§2.AC.06} — `:superseded=TARGET` lifecycle primitive (the underlying primitive whose cross-project use §2.AC.04 permanently rejects on authority grounds)
- {R006.§Non-Goals — Cross-project derivation} — Per-project derivation invariant (preserved by §2.AC.03; reconsideration permitted per the same AC, but only via a future requirement that relaxes both R006 and §2.AC.03 together)
- {R009.§Non-Goals — No cross-project metadata} — Per-project metadata invariant (preserved by this requirement's Non-Goals section)
- {A004.§1.AC.05} — Per-project storage location invariant (the structural anchor for "no cross-project metadata"; not relaxed by this requirement)
- {DD012} — VS Code Extension Migration: CLI to Library (the migration that gave the extension direct access to core parsers — §4 builds on the post-DD012 surface)
- {DD013} — VS Code Rich Views: Sidebar TreeView (the views referenced in §4.AC.09 that must remain peer-project-isolated)
- {DD015} — Cross-Project Reference Resolution: Implementation Across Core, VS Code, and Agent Documentation (the design projection of this requirement; covers §1–§5 ACs with DD-level design decisions and a phased integration sequence)
- {S001} — Skill Files as Documented Artifacts (the specification projection covering §5 ACs; carries forward all six §5.AC.01–§5.AC.06 via `derives=R011.§5.AC.NN` in S001 §4. Two valid coverage paths now exist for §5: DD015's Module Inventory rows (the implementation-side projection) and S001's §4 derived ACs (the specification-side projection on what the skill files MUST encode))

## Status

- 2026-04-25: Authored. Captures the user's intent at the level of "what would the user write?" — concrete syntax, alias name grammar, gather behavior, and version pinning are deferred to Open Questions for downstream resolution.
- 2026-04-30: OQ.01 resolved to forward-slash separator (`<alias>/<normal-reference>`). Examples and grammar references throughout the document updated accordingly. §2.AC.04 rationale sharpened from a "same as derives" framing to an authority argument: the local project lacks authority to assert lifecycle facts about a peer's claims, so `superseded=` against an alias-prefixed target is a permanent boundary, not a "for now" choice. §2.AC.03 (cross-project `derives=`) reaffirmed as rejected, with an explicit "reconsideration permitted" clause noting that a real downstream-deriving-from-upstream use case can motivate a future requirement.
- 2026-04-30: Amended to add §4 VS Code Extension Behavior (11 ACs covering pattern matching, config loading, hover, definition jumping, decorations, diagnostics, claim index awareness, markdown preview, sidebar/trace views, configuration UX, and multi-project workspaces) and §5 Agent-Facing Documentation Updates (7 ACs covering the canonical reference grammar in `claims.md`, a dedicated cross-project section, additions to the Hard Rules / Common Mistakes tables, the agent CLI reference in `SKILL.md`, the agent dispatch templates, structural revision of closed-world prose, and the don't-distort-frequency principle for examples). Total ACs: 19 → 37. Added {DD012} and {DD013} to References to ground §4 in the post-migration extension surface and the rich-views layer §4.AC.09 must respect.
- 2026-04-30: {DD015} authored as the design projection covering all 37 ACs across §1–§5; added to References as the bidirectional inverse of DD015's `**Requirement:** {R011}` header.
- 2026-04-30: §5 scope tightened. **Q2 resolved (skill-files-only scope):** §5.AC.05 (the prior AC binding updates to agent dispatch templates in `claude/agents/`) was dropped. Producer and reviewer agents load the skill files at runtime, so the cross-project grammar reaches them transitively through the §5.AC.01–§5.AC.04 skill-file edits — a separate dispatch-template binding would either duplicate the skill-file content or create a divergent second source of truth. Subsequent ACs renumbered: prior §5.AC.06 is now §5.AC.05; prior §5.AC.07 is now §5.AC.06. Total ACs: 37 → 36. A Non-Goal entry was added explicitly excluding dispatch-template editing from §5's binding scope. **Q1 confirmed (open-the-JSON authoring per option A):** §4.AC.10's existing wording — "the extension MUST provide a command (e.g., `scepter.openConfig`) that opens `scepter.config.json` in an editor tab, scrolled to the `projectAliases` section if one exists" — is the resolved shape; no edit to §4.AC.10 needed. A structured settings UI remains explicitly out of scope and deferred to downstream design.
- 2026-04-30: {S001} authored as the specification projection for §5. S001's §4 carries forward all six §5.AC.01–§5.AC.06 via `derives=R011.§5.AC.NN` metadata. Trace matrix now shows two valid coverage paths for §5: DD015 (implementation/module-inventory projection) and S001 (specification/forward-pointing projection). Added to References as the bidirectional inverse of S001's reference to {R011.§5}.
- 2026-04-30: Added §4.AC.12 to bind peer-cache invalidation when `projectAliases` reloads at runtime. Surfaced from DD015 Phase 10 architecture correction; user-authorized scope addition. Team held on Phase 13 until §4.AC.12 is implemented as a Phase 12.5 follow-up. Total ACs: 36 → 37.
