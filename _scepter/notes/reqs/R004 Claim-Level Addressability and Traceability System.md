---
created: 2026-03-10
tags: [claims, traceability, parser, cli, observatory]
status: draft
---

# R004 - Claim-Level Addressability and Traceability System

## Overview

SCEpter currently tracks knowledge at the note level — entire documents are referenceable via IDs like `{D045}` or `{REQ001}`. Individual claims within those documents (requirements, acceptance criteria, architectural constraints, specification contracts) are not addressable, traceable, or verifiable as discrete units. This means there is no mechanical way to answer: "Did this requirement make it into the implementation? Has it been tested? Is the specification stale?"

This requirement defines a system for making individual claims addressable within documents, traceable across projections (requirements, specifications, architecture, implementation, tests), and verifiable through automated tooling. The goal is to enable a "test runner for everything" — a computed property surface showing which claims are present, missing, or stale at each projection.

**Core Principle:** Code is a downstream artifact of information. The system manages claims about what code should be; the code implements those claims. Correctness is verified by tracing claims through projections, not by reading all the code.

## Problem Statement

AI-assisted development generates code faster than humans can verify it. The industry's current response — better one-shot code generation — misses the point. The solution is the same process humans use for high-quality code: rigorous requirements, specifications, and verification. But those processes were designed for manual execution and are too expensive to run manually at AI development speed.

SCEpter captures decisions, requirements, and knowledge as notes. But it cannot currently:

| Scenario | Current Behavior | Correct Behavior |
|----------|-----------------|------------------|
| "Does REQ001.AC.03 have a test?" | Manual grep, hope for consistent naming | `scepter trace REQ001.AC.03` shows presence/absence per projection |
| "Which requirements aren't in the spec yet?" | Read both documents, compare manually | `scepter gaps` shows claims missing from downstream projections |
| "Has this code been reviewed since it changed?" | No tracking | Staleness detection: last-verified vs last-modified |
| "What are the critical claims I need to check?" | Read everything, use judgment | Filter by priority, show only critical claims with gaps |
| "What does §3 of S012 cover?" | Open the file, scroll to section 3 | `scepter show S012.§3` displays the section and its claims |

The root cause: claims inside documents have no identity. They cannot be referenced, tracked, or queried as individual units.

## Design Principles

**Claims are leaves, documents are trees.** Every document has a tree structure defined by its headings. Claims (acceptance criteria, individual requirements, constraints) are leaf nodes in that tree. Sections are interior nodes. The tree is the document's internal structure; the graph of cross-references between documents is the project's knowledge graph.

**Convention over configuration.** The claim syntax uses lightweight conventions in standard markdown (section headings with IDs, inline references). No custom DSL, no application layer between the user and the document. LLMs produce the format naturally; the CLI repairs drift.

**Compute, don't maintain.** The claim index, traceability matrix, and property surface are all derived from scanning documents and source code. Nothing is manually maintained in a separate registry. The source documents are the single source of truth.

## Reference Syntax

This section defines the complete grammar for claim references. All other sections in this document use this syntax.

### Components

A reference is composed of up to four parts, all optional except that at least one must be present:

| Component | Pattern | Examples | Role |
|-----------|---------|----------|------|
| **Note ID** | `[A-Z]{1,5}\d{3,5}` | `REQ004`, `S012`, `D045` | Identifies the containing document |
| **Section path** | Dot-separated numerics, `§` optional | `3`, `§3`, `3.1`, `§3.§1` | Identifies position in the document tree |
| **Claim ID** | Letter prefix + `.` + number | `AC.01`, `SEC.03`, `CORE.12` | Identifies a leaf claim |
| **Metadata** | `:` + comma-separated tags | `:P0`, `:critical,security` | Inline priority and annotations |

### Rules

**Sections are numeric only.** A section is one or more dot-separated digits. Letter prefixes MUST NOT appear in section identifiers. Sections are interior nodes in the document tree.

**Leaf claims MUST have a letter prefix.** A claim identifier is an uppercase letter group followed by a dot followed by a number: `AC.01`, `SEC.03`, `CORE.12`. The letter prefix names the claim category. The dot separating prefix from number is mandatory.

**The form `AC01` (no dot) is FORBIDDEN.** This is always invalid syntax. The dot between the letter prefix and number is what distinguishes a claim reference from arbitrary text. Agents and LLMs MUST NOT produce this form.

**The claim prefix MUST be alphabetic-only (`[A-Z]+`).** Alphanumeric prefixes (e.g., `PH1`, `PRD2`, `WO3`) are FORBIDDEN. The prefix-with-digits form overlaps the note-ID namespace (`[A-Z]{1,5}\d{3,5}`) and creates ambiguity between bare note references and claim references. Addressing depth needs are met by deeper section paths (`§1.2.AC.01`) and sub-letters (`AC.01a`), not by digits in the prefix.

**The `§` symbol is optional emphasis.** The section symbol `§` MAY be placed before any section number or claim ID to explicitly mark it as a structural reference. Its presence or absence does not change the meaning — it is disambiguation and visual emphasis only. Both `REQ004.§3.§AC.01` and `REQ004.3.AC.01` parse identically.

**The dot `.` is the universal separator.** Dots separate all components in a reference path: note ID from section, section from subsection, section from claim. The one exception is the dot *within* a claim ID (e.g., `AC.01`), which separates the letter prefix from the number. The parser distinguishes these by rule: a segment beginning with uppercase letters followed by a dot and digits is a claim; a purely numeric segment is a section.

### Fully Qualified Path

The maximal form of a reference:

```
NOTE_ID . section_path . CLAIM_PREFIX.number : metadata
```

Concrete example:

```
REQ004.§3.1.§AC.01:P0
│       │ │  │  │  └── metadata (priority P0)
│       │ │  │  └───── claim number
│       │ │  └──────── claim prefix (acceptance criterion)
│       │ └─────────── subsection 1
│       └───────────── section 3 (with optional §)
└───────────────────── note ID
```

### Valid Reference Forms

From most to least explicit:

| Form | Context | Example |
|------|---------|---------|
| `NOTE.§N.M.§PREFIX.NN:meta` | Fully qualified, maximum emphasis | `REQ004.§3.1.§AC.01:P0` |
| `NOTE.N.M.PREFIX.NN:meta` | Fully qualified, no `§` | `REQ004.3.1.AC.01:P0` |
| `NOTE.N.PREFIX.NN` | Skip subsection (claim in top-level section) | `REQ004.3.AC.01` |
| `NOTE.PREFIX.NN` | Skip section (claim unique within note) | `REQ004.AC.01` |
| `N.PREFIX.NN` | Within same document | `3.AC.01` |
| `§N.PREFIX.NN` | Within same document, with `§` | `§3.AC.01` |
| `PREFIX.NN` | Within same section, or globally unique | `AC.01` |
| `§PREFIX.NN` | Bare claim with `§` emphasis | `§AC.01` |
| `NOTE.§N` | Section reference | `S012.§3` |
| `NOTE.N` | Section reference, no `§` | `S012.3` |
| `§N` | Section within same document | `§3` |
| `NOTE` | Whole note reference | `REQ004` |

### Scope Resolution

Short-form references are resolved from innermost scope outward:

1. **Within the current section** — `AC.01` resolves to the AC.01 in the current section
2. **Within the current document** — `3.AC.01` resolves to §3's AC.01 in this document
3. **Across the project** — `REQ004.3.AC.01` is globally unambiguous

If a short-form reference is ambiguous (e.g., `AC.01` when multiple sections define an AC.01), the parser MUST reject it and report the conflicting definitions.

### Braceless Matching

Note IDs (e.g., `REQ004`) may appear with or without the existing brace syntax (`{REQ004}`). Braceless matching is controlled by a project configuration flag (default: enabled). When enabled, the parser validates that the matched shortcode prefix is a configured note type.

Braced references (`{REQ004}`) MUST always work regardless of configuration.

Claim paths involving section numbers or letter-prefixed claims rely on the dot-and-letter-prefix structure for disambiguation, not on braces or `§`.

## Requirements

### §1 Claim Syntax and Addressing

The system MUST support hierarchical claim addresses using the existing note ID as the root, numeric section paths, and letter-prefixed dot-number claims as leaves. The full address space is:

- `NOTE_ID` — a note (e.g., `REQ001`, `S012`)
- `NOTE_ID.N` or `NOTE_ID.§N` — a section within a note
- `NOTE_ID.N.M` — a sub-section
- `NOTE_ID.N.PREFIX.NN` — a claim within a section
- `NOTE_ID.PREFIX.NN` — a claim addressed directly (when unique within the note)

The system MUST support short-form references within scope:
- `N.PREFIX.NN` or `§N.PREFIX.NN` within the same document
- `PREFIX.NN` or `§PREFIX.NN` within the same section (when unambiguous)

The system MUST resolve short-form references using scope rules: innermost scope wins, ambiguity is an error surfaced by the linter.

The system MUST NOT require machine-generated hashes or UUIDs. The UID is the claim's persistent identity. Claim IDs are monotonic within a document and MUST NOT be recycled.

The form `PREFIX` + digits without a separating dot (e.g., `AC01`) is invalid syntax and MUST be rejected by the parser.

The claim prefix MUST be alphabetic-only. Alphanumeric prefixes (e.g., `PH1.01`, `PRD2.05`) are invalid syntax — they collide with the note-ID namespace (`[A-Z]{1,5}\d{3,5}`) and create ambiguity between bare note references and claim references. The linter MUST reject alphanumeric prefix attempts and suggest an alphabetic-only alternative.

§1.AC.01 The parser MUST extract section IDs from markdown headings that start with `§` followed by a numeric pattern (e.g., `§1`, `§3.1`). The `§` prefix is REQUIRED — bare numbers in headings are not treated as sections.

§1.AC.02 The parser MUST extract claim IDs from markdown headings containing letter-prefix-dot-number patterns (e.g., `AC.01`, `SEC.03`).

§1.AC.03 The parser MUST resolve fully qualified paths (`NOTE.N.PREFIX.NN`), partial paths (`N.PREFIX.NN`, `NOTE.PREFIX.NN`), and bare claims (`PREFIX.NN`) using scope rules.

§1.AC.04 The parser MUST reject ambiguous short-form references and report the ambiguity with the conflicting definitions.

§1.AC.05 Claim IDs within a document MUST be monotonically increasing and MUST NOT be recycled after deletion.

§1.AC.06 The form `PREFIX` + digits without separating dot (e.g., `AC01`) MUST be rejected as invalid syntax.

§1.AC.07:5 The claim prefix MUST be alphabetic-only (`[A-Z]+`). Alphanumeric prefixes (e.g., `PH1.01`, `PRD2.05`, `WO3.01`) are FORBIDDEN because the prefix-with-digits form overlaps the note-ID namespace (`[A-Z]{1,5}\d{3,5}`) and creates ambiguity between bare note references and claim references. The linter MUST emit a `forbidden-form` error on alphanumeric prefix attempts with a diagnostic that explains the rule and suggests the alphabetic-only portion of the prefix as a replacement (e.g., for `PH1.01`, suggest `PH.01`).

### §2 Reference Matching and Configuration

The system MUST support braceless references for claim paths. The existing braced syntax `{NOTE_ID}` MUST continue to work. Braces SHOULD be optional, controlled by a project configuration flag (default: braceless enabled).

When braceless matching is enabled, the parser MUST validate matched shortcodes against the project's configured note types to prevent false positives. Only configured shortcodes (e.g., `REQ`, `S`, `D`, `T`) are recognized as bare note ID references.

Claim paths containing letter-prefix-dot-number patterns (e.g., `AC.01`, `3.SEC.03`) are structurally distinctive and do not require braces or `§` for disambiguation. The dot between letter prefix and number is the distinguishing feature.

The `§` symbol MAY appear before any section number or claim ID for visual emphasis. Its presence MUST NOT change parsing behavior — `REQ004.§3.§AC.01` and `REQ004.3.AC.01` MUST parse identically.

The system MUST support an optional colon-suffix for inline metadata on references: `3.AC.01:P0`, `REQ001.AC.03:critical,security`. The metadata portion MUST be stripped for ID resolution and captured separately.

§2.AC.01 Bare note IDs (e.g., `REQ001` without braces) MUST be recognized when the shortcode matches a configured note type.

§2.AC.02 Braced references `{NOTE_ID}` MUST continue to work identically to current behavior.

§2.AC.03 `§` before any component MUST be treated as optional emphasis — parsing results MUST be identical with or without it.

§2.AC.04:superseded=R005.§2.AC.04 Colon-suffix metadata (`:P0`, `:critical,security`) MUST be parsed and stored separately from the claim ID.

§2.AC.05 A project configuration flag MUST control whether braceless note-ID matching is active (default: enabled).

### §3 Claim Definition via Section Headings

Claims are defined by their presence in section headings. A heading with a numeric identifier defines a section. A heading with a letter-prefix-dot-number pattern defines a leaf claim. Everything under a heading until the next heading at the same or higher level is the claim's content.

The system MUST NOT require any format beyond standard markdown headings with a naming convention. No custom block syntax (e.g., `[REQUIREMENT]`), no mandatory frontmatter per claim, no structured fields.

LLMs SHOULD be guided (via prompting and scaffolding) to use descriptive labels alongside IDs and to use distinct short names per section where appropriate. The CLI MUST NOT enforce label conventions — only ID uniqueness and monotonicity.

§3.AC.01 Any markdown heading starting with `§` followed by a numeric pattern (e.g., `§1`, `§3.1`) defines a section claim covering all content until the next heading at the same or higher level. The `§` prefix is REQUIRED for section recognition — bare numbers in headings (dates, numbered lists) are not treated as sections.

§3.AC.02 Any markdown heading containing a letter-prefix-dot-number pattern defines an atomic claim (leaf node).

§3.AC.03 The system MUST build a tree structure from the heading hierarchy of each document, with sections as interior nodes and claims as leaves.

§3.AC.04 The system MUST NOT require any structured format beyond the heading convention for claim definitions.

### §4 Claim Index and Cross-Reference Graph

The system MUST compute a claim index by scanning all documents in the project. The index contains:
- The tree of claims per document (derived from heading structure)
- The graph of cross-references between claims (derived from inline references)
- The set of all claim IDs with their locations, labels, and metadata

The index MUST be rebuildable from source documents at any time. It MUST NOT require manual maintenance.

§4.AC.01 `scepter index` MUST scan all notes and configured source code directories, extract claim trees and cross-references, and produce a queryable index.

§4.AC.02 The index MUST be derivable entirely from document and source file content — no separate registry or metadata store is required.

§4.AC.03 The index MUST detect and report: duplicate claim IDs within a document, non-monotonic numbering, and broken cross-references.

§4.AC.04 The cross-reference scanner MUST NOT create cross-references from section-only references (parsed addresses with a section path but no claim prefix). References like `§10`, `§3.1`, `§14.5.1` are structural navigation markers within documents and MUST NOT resolve to claim entries whose fully qualified IDs happen to end with the same numeric suffix.

§4.AC.05 Fuzzy claim address resolution MUST require the raw reference string to contain a claim prefix pattern (uppercase letters followed by a dot and digits, e.g., `AC.01`) before attempting suffix-based matching against index entries. Bare numeric strings (e.g., `"10"`, `"3.1"`) MUST NOT fuzzy-match claim IDs ending with those numbers.

### §5 Traceability Matrix

The system MUST compute a traceability matrix showing, for each claim, which projections contain a reference to it. Projections are identified by document type (Requirement, Specification, Architecture, etc.) and source code.

The system MUST detect gaps: claims present at one projection but absent from downstream projections (e.g., a requirement AC that has no specification reference, or a specification claim with no implementation reference). Gap detection operates on claim presence — whether a claim ID appears in other documents — without prescribing relationship types between projections.

§5.AC.01 `scepter trace NOTE_ID` MUST display a matrix showing each claim from the note and its presence/absence across all projections.

§5.AC.02 `scepter gaps` MUST report claims that exist in upstream projections but are absent from expected downstream projections.

[Removed — 2026-03-09] §5.AC.03 Removed. Staleness detection deferred — depends on verification event infrastructure (§7) which is not yet designed.

[Removed — 2026-03-09] §5.AC.04 Removed. Relationship type inference was too opinionated. How projections relate to each other is left to the user/agent, not hardcoded into the system.

### §6 CLI Tooling for Mechanical Consistency

The system MUST provide CLI commands that handle the mechanical operations LLMs are unreliable at: numbering, ID assignment, structural validation, and scaffolding.

LLMs write content freely in documents. The CLI repairs drift after each editing pass. The CLI MUST NOT constrain how LLMs interact with document text — it validates and repairs structure, not content.

§6.AC.01 `scepter scaffold spec NOTE_ID --sections N` MUST create a document skeleton with numbered section headings and placeholder claim entries.

§6.AC.02 `scepter lint NOTE_ID` MUST detect: broken ID nesting, missing IDs on headings, duplicate IDs, non-monotonic numbering, orphaned references, and forbidden forms (e.g., `AC01`).

[Removed — 2026-03-09] §6.AC.03 Removed. Headings without IDs are allowed — they simply aren't addressable. The fix command does not force IDs onto headings.

§6.AC.04 The CLI MUST support both direct document editing by LLMs and CLI-mediated creation. The scaffolding command creates initial structure; subsequent edits may be direct.

### §7 Confidence Markers

[Updated — 2026-03-11: Renamed from "Stability and Verification Markers" to "Confidence Markers." The concept is file-level review confidence — has a human reviewed this AI-generated code? — not API stability levels. Claim-level verification is handled separately by {R005.§3}.]

[Updated — 2026-03-13: Numeric confidence levels 1-5 replace named levels. Emoji prefix (🤖/👤) is a positional parameter, not inferred. No space between emoji and number. CLI uses positional args, not flags.]

The system MUST support confidence annotations on source files indicating whether the code has been reviewed by a human. In AI-assisted development, code is generated faster than humans can verify it. Confidence markers provide a file-level signal of review status, complementing the claim-level verification events in {R005.§3}.

Review icons:
- 🤖 — AI-generated or AI-modified (can assign levels 1-3)
- 👤 — Human reviewed or human-modified (can assign levels 3-5)

Confidence levels (1-5):
1. **Experimental** — Exploring, expect major changes
2. **Draft** — Basic shape, likely significant changes
3. **Developing** — Core settled, details may change
4. **Settled** — Confident, only minor tweaks expected (human review required)
5. **Stable** — API contract, breaking changes require major version (human review required)

The system MUST support in-source confidence markers as structured comments using the format `// @confidence <emoji><level> <YYYY-MM-DD>` (e.g., `// @confidence 👤4 2026-03-11`). No space between the emoji and the numeric level. These are coarse file-level annotations — they do not replace claim-level verification ({R005.§3}) but complement it by answering "has anyone looked at this file at all?"

§7.AC.01 `scepter confidence audit` MUST report confidence annotation coverage across source files: count and percentage of files at each confidence level (1-5, unannotated).

§7.AC.02 `scepter confidence mark <file> <ai|human> <level>` MUST add or update a confidence annotation in the specified source file. Both the reviewer type (`ai` → 🤖, `human` → 👤) and the numeric level are positional arguments. The annotation MUST include a date.

§7.AC.03 A project configuration flag MUST control whether confidence markers are automatically inserted on new file creation (default: enabled).

§7.AC.04:superseded=R005.§3.AC.04 The traceability index MUST track verification events per claim: date, actor (human/AI/automated), and method.

### §8 Priority and Metadata on Claims

The system MUST support inline priority and metadata on claims via the colon-suffix syntax (`:P0`, `:critical`, `:P0,security`). Priority levels MUST be configurable per project.

The traceability matrix and property surface MUST support filtering and sorting by priority, enabling users to focus on critical claims first.

§8.AC.01 Claims with priority metadata MUST be filterable in `scepter trace` and `scepter gaps` output.

§8.AC.02 High-priority claims MUST be surfaced more prominently than low-priority claims in `scepter trace` and `scepter gaps` output.

§8.AC.03 The system MUST support arbitrary comma-separated tags in the metadata suffix position, not only priority levels.

## Edge Cases

### Ambiguous Short-Form References

**Detection:** A bare `AC.01` reference where multiple sections in the same document define an AC.01.
**Behavior:** The linter flags the ambiguity with the list of conflicting definitions. The parser does not resolve ambiguous references — it reports them as errors.

### Documents Without Claim Markup

**Detection:** A document with no section or claim patterns in its headings.
**Behavior:** The document is invisible to the traceability system. This is not an error — not all documents participate in claim tracking. The system operates on whatever level of annotation exists.

### Claims Removed from Documents

**Detection:** A claim ID that previously existed in the index but no longer appears in any document.
**Behavior:** The ID is retired. References to it from other documents are flagged as broken by the linter. The ID MUST NOT be reused. The CFR `[Reserved]` pattern is recommended as guidance for LLMs: replace content with "[Removed]" rather than deleting the heading, to preserve numbering stability.

### Braceless Matching Collision

**Detection:** A bare uppercase+digits string matches the note ID format but is not intended as a reference (e.g., in code, URLs, or prose discussing the format itself).
**Behavior:** The shortcode filter eliminates most false positives. Remaining false matches are acceptable — users can wrap non-references in backticks (code formatting) to exclude them from scanning, or the system can be configured to ignore references inside code blocks.

### JIRA Ticket Collision

**Detection:** A JIRA-style ticket reference like `PROJ-123` or `AUTH-42` could superficially resemble a claim reference.
**Behavior:** No collision occurs. Claim IDs use dot notation (`AC.01`), never hyphens (`AC-01`). The hyphenated form is not valid claim syntax. JIRA tickets use hyphens and are not dot-separated, so the two patterns are structurally distinct.

### Forbidden Form Detection

**Detection:** An LLM produces `AC01` (no dot between prefix and number).
**Behavior:** The linter detects and flags this as invalid syntax. `scepter fix` MAY offer to repair it to `AC.01` if the intent is clear from context.

### Alphanumeric Prefix Detection

**Detection:** An LLM produces `PH1.01`, `PRD2.05`, or other alphanumeric prefixes (letters followed by digits before the dot).
**Behavior:** The linter detects and flags this as a `forbidden-form` error. The diagnostic explains that prefixes must be alphabetic-only because alphanumeric prefixes overlap the note-ID namespace (`[A-Z]{1,5}\d{3,5}`), and suggests the letter-only portion as a replacement (e.g., `PH` for `PH1`). Authors needing more addressing depth use deeper section paths or sub-letters.

## Non-Goals

- **Machine-generated persistent IDs (UUIDs, hashes)** — The UID is the persistent identity. Adding a separate machine ID creates a mapping layer that must be maintained, displayed, and synchronized. The benefit (surviving restructuring) is handled instead by the monotonic-never-recycle rule.
- **Custom document format or DSL** — StrictDoc-style `[REQUIREMENT]` blocks are too rigid, too token-heavy, and too unnatural for LLM generation. Standard markdown with heading conventions is sufficient.
- **Explicit relationship type annotations** — Relationship types (derives-from, implements, verifies) are inferrable from document types. Forcing explicit annotation adds syntax overhead without proportional value.
- **Per-claim files** — Claims live inside documents. A file-per-claim model explodes the filesystem and creates maintenance burden disproportionate to the value.
- **Real-time collaborative editing** — The system is CLI-first and file-based. Collaboration happens through git, not through live multi-user editing.
- **Full formal verification** — The system tracks whether claims are present, stale, and prioritized. It does not formally prove that implementations satisfy claims. Verification is a human/AI judgment triggered by the system, not automated proof.
- **Hyphenated claim IDs** — The hyphen form (e.g., `AC-01`) is deliberately excluded to avoid collision with JIRA tickets and other hyphenated identifier conventions. The dot form (`AC.01`) is normative.

## Open Questions

### OQ.01 AC Numbering Scope

**Question:** Should claim numbers be unique per-section (§1 and §2 can both have AC.01) or unique per-document (§1 gets AC.01 through AC.05, §2 gets AC.06 through AC.09)?

**Impact:** Per-document uniqueness makes `NOTE_ID.AC.NN` unambiguous without the section specifier. Per-section uniqueness is more natural for LLMs writing sections independently.

**Default assumption:** Per-document uniqueness is recommended via LLM guidance but not enforced. The linter warns when a bare `PREFIX.NN` reference is ambiguous due to per-section numbering.

### OQ.02 Verification Event Storage

**Question:** Where are verification events stored? Options: (a) in the SCEpter note's frontmatter, (b) in a separate index file, (c) in the computed index only (not persisted across rebuilds).

**Impact:** If verification events are only in the computed index, they're lost on rebuild. If they're in frontmatter, they clutter the source documents. A separate file is a registry we said we don't want.

**Default assumption:** Verification events are stored in a lightweight JSON file (`_scepter/verification.json`). This is a lightweight system — a CLI call that LLMs are encouraged to use on specific key claims or when directed to verify things explicitly. Not first-class infrastructure; if it becomes important, it can be promoted later. Deferred until §7 (Stability) is designed, since that's its primary consumer.

### OQ.03 Observatory Integration Scope

**Question:** How does the property surface (claim status dashboard) integrate with Observatory? Is it a panel within Observatory, a separate view, or a CLI-only output initially?

**Impact:** Determines whether this requirement has UI dependencies or can be fully CLI-first initially.

**Default assumption:** CLI-first. `scepter trace`, `scepter gaps`, and `scepter stale` produce terminal output. Observatory integration is a subsequent feature that consumes the same index data.

## Acceptance Criteria Summary

| Category | Count | Notes |
|----------|-------|-------|
| §1 Claim Syntax and Addressing | 7 | AC.07 added: alphabetic-only prefix rule |
| §2 Reference Matching and Configuration | 5 | |
| §3 Claim Definition via Section Headings | 4 | |
| §4 Claim Index and Cross-Reference Graph | 5 | AC.04-05 added: section-only ref filtering, fuzzy match guarding |
| §5 Traceability Matrix | 2 | AC.03, AC.04 removed |
| §6 CLI Tooling for Mechanical Consistency | 3 | AC.03 removed |
| §7 Confidence Markers | 4 | AC.04 superseded by {R005.§3.AC.04} |
| §8 Priority and Metadata on Claims | 3 | |
| **Total** | **33** | 3 removed from original 33, 3 added (§4.AC.04-05, §1.AC.07) |

## References

- `core/src/parsers/note/note-parser.ts` — Current parser implementation
- `core/src/parsers/note/shared-note-utils.ts` — Current note ID validation
- `docs/20260309 Specification Format Prior Art Survey.md` — Survey of 33 specification formats
- `docs/20260309 AppMap vs CodeSee Synthesis.md` — Feature analysis informing Observatory vision
- Akoma Ntoso dual-ID system (eId + wId) — Prior art for hierarchical addressing
- SARA (Rust CLI) — Closest existing tool (Markdown + YAML + Git knowledge graph)
- StrictDoc — Richest within-document claim structure (SDoc format)
- core/src/claims/confidence.ts — Numeric-level file confidence annotation system (🤖/👤 + 1-5)
- {R005.§3} — Claim-level verification events (complements file-level confidence)
