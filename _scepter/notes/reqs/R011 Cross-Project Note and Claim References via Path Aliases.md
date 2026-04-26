---
created: 2026-04-26T03:18:51.164Z
tags: [cross-project,references,aliases,configuration]
---

# R011 - Cross-Project Note and Claim References via Path Aliases

## Overview

A SCEpter project today is a closed reference world: every `{R042}`, every `{R004.§1.AC.03}`, every `derives=R005.§1.AC.01` resolves against the current project's claim index. This requirement opens that world to a bounded, configuration-declared set of *peer* SCEpter projects. A project author registers a named alias pointing at another SCEpter project on disk; references prefixed with that alias resolve against the peer project instead of the current one.

The shape borrows from TypeScript's `paths` aliasing: a small map from short names to filesystem locations, declared in config, used at the point of reference. A reference such as `vendor-lib:R042` (illustrative — actual syntax is OQ.01) reads as "look up R042 in the project registered under the alias `vendor-lib`." This gives a project a way to cite a vendored design document, an upstream specification, or a sibling project's architecture claim without copying content or fabricating local IDs.

**Core Principle:** Cross-project references are **read-only resolution**, not federation. The peer project's claims do not enter the current project's derivation graph, metadata store, gap report, or trace matrix as first-class entries. An alias-prefixed reference is a citation pointer the CLI can dereference for display; it is not a shared address space. This preserves the invariants stated in {R006.§Non-Goals} and {R009.§Non-Goals} that derivation and metadata are per-project — those constraints continue to hold and are not relaxed by this requirement.

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

§1.AC.04 Alias names MUST conform to a constrained character set so they cannot collide with the note-ID regex (`[A-Z]{1,5}\d{3,5}`) or with the claim metadata grammar from {R009.§4}. The exact allowed character set is OQ.02, but at minimum: alias names MUST NOT match `[A-Z]{1,5}\d{3,5}` and MUST NOT contain the separator chosen for cross-project references (per OQ.01).

§1.AC.05 An alias name declared in `projectAliases` MUST NOT collide with any local note ID prefix. If `vendor` is configured as an alias and a local note `VENDOR001` exists, the system MUST report a configuration error at config-load time.

§1.AC.06 The configuration validator MUST verify, at load time, that each alias target path exists on disk and contains a valid SCEpter project. Targets that fail this check MUST produce a warning (not a hard error) and MUST be marked as unresolved — references through such aliases produce a clear "alias unresolved" error at the reference site, not silent failures.

### §2 Reference Syntax and Resolution

The reference parser MUST accept an alias prefix on note IDs and claim references; the resolver MUST dereference the prefix against the configured alias map and look up the remainder in the peer project's index.

§2.AC.01 The parser MUST accept references of the shape `<alias><sep><normal-reference>` where `<normal-reference>` is any reference form already accepted by the existing parser ({R004.§1} grammar) — bare note ID, note + section, note + claim, note + section + claim, ranges. The exact value of `<sep>` is OQ.01.

§2.AC.02 An alias-prefixed reference MUST be valid in both braced contexts (e.g., inside `{...}` in note prose) and in code-comment annotations (`@implements`, `@see`, `@validates`, `@depends-on`, `@addresses`).

§2.AC.03 An alias-prefixed reference MUST NOT be valid as a `derives=TARGET` value. Per {R006.§Non-Goals}, derivation is per-project; this requirement does not change that. The linter MUST reject `derives=<alias><sep><id>` with a clear error pointing at the {R006} constraint.

§2.AC.04 An alias-prefixed reference MUST NOT be valid as a `superseded=TARGET` value. Same rationale: supersession is a lifecycle relationship that must resolve within a single project's index.

§2.AC.05 The resolver MUST resolve the alias prefix to a peer project, load that peer project's claim index (via the same mechanism the local CLI uses for itself), and then resolve the remainder of the reference against the peer's index. Resolution failures (alias not found, peer project absent, note not found in peer, claim not found in peer) MUST produce distinct, actionable error messages.

§2.AC.06 Peer project loading SHOULD be cached per CLI invocation — repeated references to the same alias within a single command MUST NOT re-load the peer project from disk. Caching MAY span longer scopes (per-process, per-watcher session) but cross-invocation persistence is not required.

§2.AC.07 Transitive aliasing — using an alias defined in a peer project to traverse to a third project — MUST NOT be supported in this requirement. If project A aliases project B, and project B aliases project C, then `A→B→C` is not resolvable from project A. A reference `b-alias:c-alias:R001` (or whatever syntax OQ.01 settles on) MUST produce a clear error. (See {R006.§Non-Goals} for the analogous principle on derivation chains.)

### §3 CLI Behavior on Alias-Prefixed References

The existing read-side commands (`show`, `gather`, `search`, `claims trace`, `claims thread`) MUST handle alias-prefixed references in their inputs and outputs without violating the read-only-citation principle.

§3.AC.01 `scepter show <alias><sep><id>` MUST display the peer project's note in the same format as a local note, with a clearly visible header indicating the source alias and peer project path. The displayed note MUST NOT be confusable with a local note.

§3.AC.02 `scepter gather` MUST follow alias-prefixed references encountered in the gathered notes' content for display purposes, but MUST NOT include the peer's claims, references, or metadata in any aggregate count, gap report, or trace matrix that the local project produces. Whether peer notes appear in `gather`'s output as full content, as a stub indicating the alias citation, or are omitted entirely is OQ.04.

§3.AC.03 `scepter claims trace` MUST render alias-prefixed references appearing in local notes as cross-project citations, visually distinguished from local references. The peer's trace matrix MUST NOT be merged into the local trace matrix.

§3.AC.04 `scepter claims gaps` MUST NOT include peer-project claims in its gap analysis. An alias-prefixed reference in a local note does not constitute "implementation" of any peer claim from the local project's perspective, and conversely an absent peer reference does not constitute a local gap.

§3.AC.05 `scepter search` MAY accept a flag to include peer projects in the search scope (exact flag name and default behavior is out-of-scope for this requirement — left to downstream design). By default, `search` MUST search only the local project. Peer-project search, if implemented, MUST clearly label results with their source alias.

§3.AC.06 The lint and index commands (`scepter claims lint`, `scepter claims index`) MUST validate alias-prefixed references in local notes: the alias MUST be declared, and the peer's note/claim MUST exist at the time of linting. Validation failures MUST be reported with the same severity model the linter uses for other broken references.

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

## Open Questions

### OQ.01 Reference syntax — separator and shape

**Question:** What is the concrete syntax for an alias-prefixed reference? The user-facing shape needs to be parseable by the existing claim parser ({R004.§1}), visually distinct from a local reference, and unambiguous when nested inside `{...}` braced contexts.

**Candidates** (illustrative; not yet evaluated):

| Candidate | Example | Constraints to verify |
|-----------|---------|----------------------|
| Colon separator | `{vendor:R005.§1.AC.01}` | Must not collide with the metadata-suffix grammar from {R009.§4} which already uses `:` heavily inside claim addresses |
| Slash separator | `{vendor/R005.§1.AC.01}` | Visually evokes a path; must not collide with future range or filter syntax |
| Hyphen separator | `{vendor-R005.§1.AC.01}` | Hyphens are forbidden inside claim IDs ({R004} hard rule against `AC-01`); could the separator-hyphen confuse readers given that prohibition? |
| At-sign separator | `{R005.§1.AC.01@vendor}` | Suffix form is unusual but unambiguous; awkward to read for the common case |
| Double-colon | `{vendor::R005.§1.AC.01}` | Visually heavy but maximally unambiguous; verify parser tractability |
| Bracketed alias | `{[vendor]R005.§1.AC.01}` | Visually disruptive; verify brace nesting works |

**Constraints any chosen syntax MUST satisfy:**
- Parseable by an extension of the existing claim parser without breaking changes to local-only references
- Does not collide with the note-ID regex `[A-Z]{1,5}\d{3,5}` (so the parser can distinguish `vendor:R005` from a hypothetical local note named `VENDOR`)
- Does not collide with the metadata-suffix grammar from {R009.§4} (`key=value`, `:lifecycle`, etc.)
- Visually distinguishable from a local reference at a glance
- Unambiguous in both braced (`{...}`) and braceless (code-annotation, prose) contexts

**Resolution path:** Downstream specification or detailed design evaluates the candidates against the parser's existing grammar. Default assumption if not resolved: colon separator (`vendor:R005.§1.AC.01`), with explicit verification that the metadata-suffix grammar does not collide.

**Blocks:** §2.AC.01, §2.AC.02, §2.AC.07 cannot be implemented until the syntax is chosen. The other ACs in §2 and §3 are syntax-independent.

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
| **Total** | **19** |

## References

- {R004} — Claim-Level Addressability and Traceability System (the reference grammar this requirement extends)
- {R006} — Claim Derivation Tracing (its `§Non-Goals — Cross-project derivation` is preserved by §2.AC.03 of this requirement)
- {R009} — Claim Metadata Key-Value Store (its `§Non-Goals — No cross-project metadata` is preserved by this requirement's Non-Goals section)
- {A004} — Claim Metadata Store Architecture (per-project store invariants this requirement does not relax)

## Status

- 2026-04-25: Authored. Captures the user's intent at the level of "what would the user write?" — concrete syntax, alias name grammar, gather behavior, and version pinning are deferred to Open Questions for downstream resolution.
