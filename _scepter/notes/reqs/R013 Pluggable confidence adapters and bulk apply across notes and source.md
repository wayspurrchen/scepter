---
created: 2026-05-05
tags: [claims, confidence, traceability, cli, configuration]
status: draft
---

# R013 - Pluggable confidence adapters and bulk apply across notes and source

**Extends:** {R004.§7} — Confidence Markers. R004.§7 established file-level confidence annotations on source files via C-family comments (`// @confidence 🤖2 2026-03-11`), with a single-file `mark` command, an `audit` command scoped to source code, and a configuration flag for auto-insert (declared but currently unwired). This requirement formalizes four orthogonal extensions: a pluggable adapter registry that lets the same payload format live in non-comment file shapes, an audit that aggregates across notes and source, a bulk-apply command across multiple files in one invocation, and the realization of `claims.confidence.autoInsert` for note creation.

## Overview

Confidence markers in {R004.§7} answer a coarse question — "has anyone looked at this file?" — but the current implementation only knows how to read and write one file shape: C-family line comments. SCEpter's own knowledge graph is markdown, which has no place to put a `// @confidence` comment. As a result, the notes themselves carry no confidence signal even though they are exactly the kind of AI-generated artifact the marker was designed to track. The marker mechanism, the audit command, and the mark command all need to span both projections.

**Core Principle:** The confidence payload is a single string format (`<emoji><level> <YYYY-MM-DD>`); how that string is embedded in a file is the file shape's concern. Parsing, formatting, and insertion are pluggable per file shape; the surrounding tooling (audit, mark, apply) operates on the unified payload regardless of shape.

## Problem Statement

The current confidence subsystem has three concrete gaps:

| Gap | Current Behavior | Correct Behavior |
|-----|------------------|------------------|
| Confidence on a markdown note | No mechanism — the regex matches only `//` and ` * ` comments. Notes can never carry a confidence signal. | Frontmatter adapter writes/reads a `confidence:` scalar with the same `<emoji><level> <YYYY-MM-DD>` payload. |
| `scepter confidence audit` for a project of 200 source files and 80 notes | Audits source only. Notes are invisible. | Aggregates across both scopes with separate per-scope coverage stats; flags scope the audit when needed. |
| Marking 30 notes after a review pass | One `scepter confidence mark <file> <ai|human> <level>` invocation per file. 30 invocations. | One `scepter confidence apply human 4 --types Requirement,Spec --tags reviewed-2026-05` invocation. |
| Newly created notes | No annotation. The `claims.confidence.autoInsert` config flag exists in the schema (default `true`) but is unwired — `scepter create` never reads it. | When `autoInsert: true`, every new note gets `confidence: "🤖2 <today>"` in its frontmatter via the frontmatter adapter. |

The root cause for the first three: confidence parsing/formatting/insertion is hardcoded to a single regex over C-family comments. The fourth is a wiring gap — the schema describes the flag but no code consults it during note creation.

## Design Principles

**Adapters own file shape; tooling owns payload.** The payload `<emoji><level> <YYYY-MM-DD>` is shape-agnostic and shared across every adapter. Adapters know how to parse it out of, and write it into, a specific file shape. The rest of the system (audit, mark, apply, auto-insert) operates only on the payload — never on raw file bytes — so adding a third adapter (e.g., Python docstring) requires no changes to commands.

**Adapter selection is mechanical, not configurable.** The adapter for a given file is determined by file extension and path, not by per-file configuration. The user does not choose which adapter to use; the system picks the one that matches.

**Aggregate, but report independently.** Mixing source-file and note coverage into a single percentage is misleading when annotation density differs by scope. Per-scope breakdowns let coverage be evaluated against the appropriate denominator.

## Requirements

### §1 Pluggable annotation adapters

Confidence parsing, formatting, and insertion MUST go through an adapter registry rather than a single hardcoded regex. An adapter knows one file shape and exposes operations to detect, read, write, and remove a confidence annotation in that shape. Adapter selection is by file path and extension; an unmatched file is skipped, never errored. The string payload — `<emoji><level> <YYYY-MM-DD>`, no space between emoji and level — is identical across adapters; only the surrounding embedding differs.

§1.AC.01 The system MUST expose an adapter registry where each adapter declares the file extensions and path patterns it handles, and provides operations to parse, format, insert, and remove a confidence annotation for that shape.

§1.AC.02 A built-in C-family-comment adapter MUST handle `.ts`, `.tsx`, `.js`, `.jsx`, and `.css` files using the existing `// @confidence <emoji><level> <YYYY-MM-DD>` and ` * @confidence <emoji><level> <YYYY-MM-DD>` formats; behavior for these extensions MUST be unchanged from the existing implementation.

§1.AC.03 A built-in frontmatter adapter MUST handle `.md` files by reading and writing the payload as the value of a string scalar `confidence:` key in the file's YAML frontmatter (e.g., `confidence: "🤖2 2026-05-05"`); when no frontmatter exists, the adapter MUST create one to insert the annotation.

§1.AC.04 The payload format MUST be identical across adapters: `<emoji><level>` followed by a single space and an ISO `YYYY-MM-DD` date when the date is present, or `<emoji><level>` with no trailing space when the date is omitted (per §1.AC.06). Emoji is `🤖` or `👤`; level is a digit 1-5. Adapters MUST NOT vary the payload syntax.

§1.AC.05 When a file's path or extension matches no registered adapter, operations on that file MUST return a "no adapter" outcome (treated as skipped by callers), not raise an error.

§1.AC.06 A `claims.confidence.includeDate` boolean configuration flag MUST control whether confidence annotations carry a trailing ISO date. When `true` (default), annotations include the date as specified in §1.AC.04. When `false`, every confidence-writing path (`mark`, `apply`, auto-insert on note creation) MUST emit the bare `<emoji><level>` form, omitting the trailing space and date. Parse paths MUST accept both forms regardless of the flag's value (a project that flips the flag does not invalidate previously dated annotations).

### §2 Audit scope spanning notes and source

`scepter confidence audit` MUST aggregate confidence coverage across both source files (per `sourceCodeIntegration`) and notes (per `discoveryPaths`), producing per-scope breakdowns rather than a single combined percentage. New flags MUST scope the audit to one side when desired.

§2.AC.01:derives=R004.§7.AC.01 `scepter confidence audit` MUST report confidence annotation coverage independently for the source-file scope and the note scope: total file count, annotated count, unannotated count, and per-level counts (1-5) per scope.

§2.AC.02 `scepter confidence audit --source-only` MUST restrict the audit to source files only; `scepter confidence audit --notes-only` MUST restrict the audit to notes only; the two flags MUST be mutually exclusive.

§2.AC.03 Coverage percentages MUST be computed per scope (annotated ÷ total within that scope) and reported separately; the audit MUST NOT emit a single combined percentage that mixes denominators across scopes.

§2.AC.04 Note-scope file discovery MUST follow the project's `discoveryPaths` configuration; source-scope file discovery MUST follow the existing `sourceCodeIntegration` configuration.

§2.AC.05 A `--paths` flag (or equivalent verbose-output flag) MUST extend `scepter confidence audit` to emit a per-file breakdown listing every discovered file with its annotation state, grouped by directory. The output is expected to be voluminous on large projects and is intended for redirection to a file (e.g., `scepter confidence audit --paths > audit.txt`). The flag MUST be compatible with `--source-only` and `--notes-only`.

### §3 Bulk apply

A new `scepter confidence apply <ai|human> <level>` command MUST mark or replace the confidence annotation across multiple files in a single invocation, with filters to select target files, behavior modifiers to control overwrite policy, and a dry-run mode for preview.

§3.AC.01:derives=R004.§7.AC.02 `scepter confidence apply <ai|human> <level>` MUST insert or replace the confidence annotation in every selected file, using the adapter registered for that file's shape; reviewer (`ai` → 🤖, `human` → 👤) and level (1-5) are positional arguments matching the existing `mark` command.

§3.AC.02 The command MUST support filters `--types T1,T2`, `--tags t1,t2`, `--ids ID1,ID2`, and `--glob PATTERN`; filters combine as AND across categories and OR within a category (e.g., `--types Requirement,Spec --tags security` selects "(Requirement OR Spec) AND tagged security").

§3.AC.03 By default, files that already carry a confidence annotation MUST be left unchanged (`--skip-annotated` is on by default); `--overwrite` MUST replace existing annotations with the new payload.

§3.AC.04 `--dry-run` MUST list each file that would be marked and each file that would be skipped (with the reason for skipping), and MUST NOT write any file.

§3.AC.05 Filters `--types`, `--tags`, and `--ids` MUST select only notes; `--glob` MUST be the only filter that can match source files (which carry no SCEpter metadata).

§3.AC.06 Combining a note-only filter (`--types`, `--tags`, or `--ids`) with a `--glob` that matches only source files MUST raise a clear error stating that the filter combination cannot match any file, rather than silently producing an empty result.

§3.AC.07 When a selected file's shape has no registered adapter, the command MUST report the file as skipped with reason "no adapter," and MUST continue processing the remaining selected files.

### §4 Auto-insert on note creation

The existing `claims.confidence.autoInsert` configuration flag — declared in the schema but unwired in code — MUST be realized for the note-creation path. When the flag is true (default), `scepter create <Type>` MUST insert a confidence annotation into the new note's frontmatter via the frontmatter adapter. When false, no annotation is added at creation time. An explicit confidence value supplied through a custom template variable MUST take precedence over the auto-inserted default.

§4.AC.01:derives=R004.§7.AC.03 When `claims.confidence.autoInsert` is true (default), `scepter create <Type> <Title>` MUST insert `confidence: "🤖2 <today>"` (using the project's current date in `YYYY-MM-DD` form) into the new note's frontmatter via the frontmatter adapter.

§4.AC.02 When `claims.confidence.autoInsert` is false, `scepter create <Type> <Title>` MUST NOT insert any confidence annotation into the new note's frontmatter.

§4.AC.03 When the new note's template (or template variables) supplies an explicit `confidence:` frontmatter value, the auto-insert MUST NOT overwrite it; the explicit value wins regardless of the `autoInsert` flag.

§4.AC.04 Auto-insert at creation time applies only to notes; source files have no `scepter create` equivalent, so the flag MUST have no effect on source-file creation paths.

## Edge Cases

### Frontmatter with no confidence key

**Detection:** A `.md` file has YAML frontmatter (delimited by `---`) but no `confidence:` key.
**Behavior:** The frontmatter adapter reports the file as unannotated. On insert, the adapter adds the `confidence:` key inside the existing frontmatter block, preserving other keys and ordering.

### Markdown file with no frontmatter

**Detection:** A `.md` file has no leading frontmatter block.
**Behavior:** On read, the frontmatter adapter reports the file as unannotated. On insert, the adapter creates a new frontmatter block at the top of the file containing only the `confidence:` key.

### Apply with no matching files

**Detection:** All selected filters AND the existing-file/skip-policy check eliminate every candidate.
**Behavior:** The command exits successfully with a clear "no files matched" message; no error. `--dry-run` and live runs behave identically here.

### Apply across mixed shapes

**Detection:** A single `apply` invocation matches files of two or more shapes (e.g., `.md` notes and `.ts` source via `--glob "**/*.{md,ts}"`).
**Behavior:** Each file is processed by the adapter that matches its extension; the result reports per-file outcomes grouped by shape.

### Existing source file marked via apply with `--types`

**Detection:** A user passes `--types Requirement` and the command would match no source files (because source files have no type), but `--glob "*.ts"` is also set.
**Behavior:** Per §3.AC.06, the command raises a clear error explaining that note-only filters and source-only globs cannot intersect, rather than producing an empty result silently.

## Non-Goals

- **Per-note-type `autoInsert` overrides** — `claims.confidence.autoInsert` is a single project-wide boolean. Future need for "auto-insert for Requirements but not Tasks" would justify a separate requirement; this one does not introduce per-type knobs.
- **Named confidence presets in config** — Aliases like `"presets": { "reviewed": "human4" }` would let users invoke `scepter confidence apply --preset reviewed`. Out of scope here; the positional `<ai|human> <level>` form is the only contract.
- **Structured (object) frontmatter shape** — The frontmatter adapter stores the payload as a string scalar (`confidence: "🤖2 2026-05-05"`), not as a nested object (`confidence: { reviewer: ai, level: 2, date: 2026-05-05 }`). The string form keeps adapters payload-equivalent.
- **Source-file auto-insert at creation** — There is no `scepter create` equivalent for source files. Source files acquire confidence markers via `mark` or `apply`, not at creation.
- **Broader pluggable annotation framework for `@implements`, `@validates`, etc.** — The adapter pattern in §1 is scoped to confidence. Other annotation classes have their own parsers and discovery paths and are not adapter-mediated.
- **Migration of existing source-only audit output format** — The audit output shape changes (per-scope breakdown), but no migration of historical audit data is implied; audit results are not persisted.

## Open Questions

### OQ.02 Apply with `--overwrite` and confidence downgrades

**Question:** Should `--overwrite` permit a downgrade (e.g., replacing `👤4` with `🤖2`)?

**Impact:** A bulk apply with `human 3` would silently overwrite human-reviewed `👤4` annotations as `👤3`. That may be intended (re-review pass found problems) or accidental (forgot to scope filters).

**Default assumption:** `--overwrite` permits any replacement, including downgrades. The user is expected to scope filters appropriately. A future `--no-downgrade` flag could be added if downgrades become an observed footgun.

## Acceptance Criteria Summary

| Section | Count |
|---------|-------|
| §1 Pluggable annotation adapters | 6 |
| §2 Audit scope spanning notes and source | 5 |
| §3 Bulk apply | 7 |
| §4 Auto-insert on note creation | 4 |
| **Total** | **22** |

## References

- {R004.§7} — Source requirement: file-level confidence markers (audit, mark, auto-insert config flag, superseded verification AC).
- {R005.§3} — Claim-level verification events (the per-claim verification surface that complements file-level confidence).
- `core/src/claims/confidence.ts` — Current implementation: regex-based, hardcoded to C-family comments, source-file-only audit.
- `core/src/types/config.ts` — `ClaimConfig.confidence.autoInsert` schema declaration (default true, currently unwired).
- `core/src/cli/commands/confidence/` — Existing `audit` and `mark` command shapes that §2 and §3 extend.
