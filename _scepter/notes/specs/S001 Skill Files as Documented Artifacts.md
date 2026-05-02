---
created: 2026-05-01T02:47:34.243Z
status: draft
tags: [skill-files,documentation,meta,cross-project]
---

# S001 - Skill Files as Documented Artifacts

## Overview

The SCEpter agent skill files at `claude/skills/scepter/` are the canonical training surface for AI agents that operate inside SCEpter projects. They encode the non-negotiable rules, the claim grammar, the artifact production guides, the review and conformance protocols, the team coordination protocol, the implementation methodology, the epistemic vocabulary, and the process scaffold. An agent loads SKILL.md as the entry point; SKILL.md routes to companion files (claims.md, implementing.md, reviewing.md, conformance.md, team.md, process.md, epistemic-primer.md) and to the per-artifact production guides under `artifacts/`.

This specification treats those files as **documented artifacts**: each file carries contractual obligations about what content it MUST encode, what conventions it MUST follow, and what verification surface it MUST present. The spec is the projection layer between requirement-level constraints on skill content (currently {R011.§5}; future requirements will accrete) and the actual files. Without this projection, requirements would either need to bind skill content directly with verbose per-AC granularity, or assume the skill files document themselves — which they don't, and which provides no mechanism to verify that downstream changes preserve their contracts.

**Scope (in):**
- The skill files at `claude/skills/scepter/*.md` and `claude/skills/scepter/artifacts/*.md`
- Per-file content contracts (what each file MUST encode)
- Structural conventions across files (heading levels, section ordering, the NON-NEGOTIABLE RULES pattern, the examples-vs-prescriptions discipline)
- Cross-project reference grammar coverage, derived from {R011.§5}
- The annotation discipline: how this spec is verified WITHOUT inflating skill-file token cost with dense claim references

**Scope (out):**
- The agent dispatch templates at `claude/agents/*.md` (per {R011.§Non-Goals — Updates to agent dispatch templates}; dispatch templates load skill files at runtime and inherit the grammar transitively)
- The CLI source code that the skill files describe (specified elsewhere; the skill files are documentation, not behavior)
- User-facing project documentation outside the skill directory (READMEs, architecture overviews, etc.)
- The mechanics of skill loading by Claude Code (governed by the runtime, not by SCEpter)

**Non-goals:**
- Defining new skill files. This spec specifies the existing files; new files are introduced by future requirements that bind them.
- Mandating a single canonical wording for any rule. Rules are content contracts; the exact prose is left to the skill author. Verification asks "does the file teach this?" not "does the file say these exact words?"

**Privacy/security:** N/A. Skill files contain no secrets and are checked into the public repository.

---

## At a Glance

The verification model for this spec is unusual and worth grounding before reading the contracts. A reader hitting §2's per-file ACs without context might reasonably ask: "Where do the `@implements` annotations go? How does the trace matrix know these claims are covered?" The answer is in §5 — and §5 is the operative constraint of this entire document.

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Verification Flow for S001                           │
│                                                                         │
│   S001 §2 / §3 / §4 ACs   ──pointing-at──▶   skill-file path + heading │
│       (this spec)                              (the file in claude/)    │
│                                                                         │
│   Reviewer reads BOTH:                                                  │
│     1. The AC ("file F MUST contain X at section S")                   │
│     2. The actual file at F, section S                                 │
│   Pass = the file content satisfies the AC. No annotation in the file. │
└────────────────────────────────────────────────────────────────────────┘
```

**Worked example.** §2.AC.04 says: "`claude/skills/scepter/claims.md` MUST contain a syntax-and-rules section that documents the `NOTE.§N.PREFIX.NN` reference grammar, the dot-mandatory rule, the no-hyphen rule, and the prefix is alphabetic-only rule." A reviewer verifies this AC by:
1. Opening `claude/skills/scepter/claims.md`.
2. Locating the "Syntax & Rules" heading.
3. Confirming the four required pieces of content are present in that section.

The reviewer does NOT search for `{S001.§2.AC.04}` annotations inside `claims.md`. Per §5, those annotations are forbidden — the file would be polluted with verification metadata that costs tokens on every skill load. The forward-pointing reference in S001's AC is sufficient: the spec points at the file; the reviewer reads the file; the contract is verified by inspection.

This inverts the default SCEpter pattern. For source-code projections, the trace matrix is the verification — `@implements {R004.§1.AC.01}` in code is what makes the matrix go green. For skill-file projections, the trace matrix would be redundant with reviewer inspection AND would impose per-load token cost on every agent that uses the skill. The forward-pointing model preserves verifiability without paying that cost.

---

## Prior Art and Design Rationale

The skill-file system used by Claude Code (and projected into SCEpter via `claude/skills/`) is a recent design pattern with limited prior art in the public literature. The closest analogues:

- **`man` pages and POSIX standards.** Specifies what a tool's documentation MUST cover (synopsis, description, options, examples, exit codes), without specifying the wording. The verification surface is the doc itself, read against the spec.
- **JSDoc, Sphinx, Doxygen contracts.** Documentation generators that enforce what each function/class/module's docblock MUST contain. Verification is mechanical (presence of `@param`, `@returns`) but not semantic (the wording can still be wrong).
- **DO-178C bidirectional traceability for documentation.** Aviation-grade software requires that every documentation artifact trace to a requirement and vice versa. The annotation overhead is paid willingly because the docs are not loaded as runtime context.
- **CLAUDE.md and AGENTS.md conventions.** Agent-instruction files at the project root are now common. None that I'm aware of carry per-section claim annotations — the cost is recognized empirically.

The design rationale specific to this spec:

**Why a Specification, not a Requirement.** {R011.§5} already binds specific skill-file content (the cross-project reference grammar, hard rules, examples discipline). Adding more claims directly in R011 to cover the rest of the skill files' contracts would balloon R011 with content unrelated to cross-project references. A Specification is the right projection: it derives from R011 §5 for the cross-project content, but stands on its own for the broader contracts about what each file encodes structurally.

**Why forward-pointing references, not embedded annotations.** Two competing pressures:
- *Verifiability* wants every claim to have a mechanical anchor in the artifact it specifies.
- *Token economy* observes that skill files are loaded as agent context on every skill use, sometimes hundreds of times per session.

Embedded annotations (`<!-- @implements {S001.§2.AC.04} -->` per section) would add 50–200 hidden lines to claims.md alone, and proportional cost to every other documented file. Multiplied by typical session skill loads, the cost is non-trivial. Forward-pointing references shift the verification cost to review-time (paid once per review) rather than load-time (paid every session). The tradeoff is that the trace matrix doesn't show coverage automatically — but for documentation-as-contract, reviewer inspection is the verification anyway. The trace matrix would be a duplicate witness, not an independent check.

**Rejected alternative — single top-of-file marker.** Each documented file could carry one HTML comment like `<!-- Documented by: S001 -->` for discoverability. This is acceptable per §5.AC.03 (and is the most a documented file may carry) but is not required — the forward-pointing reference is the operative mechanism. A single marker has token cost ~1 line per file; the discoverability benefit is small because grep over `_scepter/notes/specs/` for "skill" finds S001 in seconds.

**Rejected alternative — separate verification companion files.** Each skill file could have a `.spec.md` companion that carries the claim annotations. This adds files without solving the load-time cost (skills are loaded by directory) and complicates updates.

---

## Terminology

| Term | Definition |
|------|-----------|
| **Skill file** | A markdown file under `claude/skills/scepter/` (or `claude/skills/scepter/artifacts/`) that an agent loads as runtime context. NOT a generic "file in the skills directory" — only files explicitly enumerated in §1 are documented by this spec. |
| **Documented file** | A skill file that this spec binds. Each documented file is enumerated in §1 with a role description and has corresponding ACs in §2. |
| **Forward-pointing reference** | An AC in this spec that names a file path and a section heading inside that file, asserting what content the file MUST contain at that location. The verification mechanism for §2, §3, and §4. Does NOT require `@implements` or `{S001.§N.AC.NN}` to appear in the documented file. |
| **Annotation discipline** | The §5 rule set governing what claim references documented files MAY carry. Operatively: nothing per-section, at most one top-of-file marker, never per-AC granularity. |
| **NON-NEGOTIABLE RULES pattern** | The numbered list at the top of `SKILL.md` whose entries are stated as rules (not guidelines) and call out the most common agent failures. The pattern is structural, not just stylistic — agents are instructed to read these first. |
| **Examples-vs-prescriptions discipline** | The convention that examples in skill files illustrate prescriptions but do NOT replace them. A rule is a sentence stating the constraint; an example shows the rule applied. Both are required when the rule is non-obvious. |

---

## §1 Skill File Inventory

This section enumerates the documented files. Each file is identified by its path relative to the repo root, given a one-paragraph role description, and made the subject of contracts in §2. A file present in `claude/skills/scepter/` but absent from this inventory is NOT documented by this spec — future requirements that bind it MUST first add it here.

The Inventory ACs assert that the named files exist and play the named role. If a file is removed or renamed, the corresponding AC fails until S001 is updated. This makes file-level structural changes visible at the spec layer rather than silent.

### Top-level skill files

AC.01 The file `claude/skills/scepter/SKILL.md` MUST exist and serve as the **main entry point** for agents loading the SCEpter skill. Its role is to encode the non-negotiable rules that prevent the most common agent failures, provide a decision-tree for routing to companion files, define the core concepts (notes, references, knowledge graph), and surface the CLI command reference at the level of detail an agent needs to operate without loading further documentation.

AC.02 The file `claude/skills/scepter/claims.md` MUST exist and serve as the **claim system reference**. Its role is to define the claim reference grammar, the authoring conventions for claims and metadata, the lifecycle tag system, the smuggling failure mode, the derivation and binding assessment process, and the CLI tools for tracing, threading, and gap detection.

AC.03 The file `claude/skills/scepter/implementing.md` MUST exist and serve as the **implementation guide**. Its role is to describe the workflow an agent follows when implementing features from SCEpter plans, including pre-implementation context-gathering, source-code annotation patterns, the impact-analysis methodology, and the strict git-staging discipline that prevents over-staging.

AC.04 The file `claude/skills/scepter/reviewing.md` MUST exist and serve as the **review guide**. Its role is to define the four review subtypes (completeness, conformance, impact, coherence), the projection enumeration discipline, the AC interaction coverage methodology, and the finding-tagging convention (MECHANICAL vs HUMAN_JUDGMENT) that drives review-followup routing.

AC.05 The file `claude/skills/scepter/conformance.md` MUST exist and serve as the **conformance review guide**. Its role is to define the validation criteria for derived artifacts (functional compliance, scope adherence, quality standards, completeness, correctness), the structured verdict format, and the linking-pattern guidance for connecting verification work back into the knowledge graph.

AC.06 The file `claude/skills/scepter/team.md` MUST exist and serve as the **team coordination protocol**. Its role is to define the paired-agent (producer + reviewer) implementation protocol, the linker tag-along role, the BLOCKED-message and divergence-protocol conventions, the bash-command discipline that prevents permission-prompt stalls, and the pre-dispatch execution-assessment step.

AC.07 The file `claude/skills/scepter/process.md` MUST exist and serve as the **process scaffold guide**. Its role is to define the multi-operation feature loop (start, resume, after-every-operation), the orientation protocol for re-loading state after a compact or skill reload, and the structured task-note scaffold that tracks Active Notes, Frontier, Coverage, and Log.

AC.08 The file `claude/skills/scepter/epistemic-primer.md` MUST exist and serve as the **epistemic vocabulary reference**. Its role is to define the modal-status taxonomy (IS / MUST / SHOULD / MAY / MUST NOT / SHOULD-BE / WANT), the claim properties (binding, inherence, settledness), the projection vocabulary, and the derivation operations (decompose, concretize, elaborate). It is loaded on demand when artifact guides reference these terms.

### Artifact production guides

AC.09 The file `claude/skills/scepter/artifacts/architecture.md` MUST exist and serve as the **architecture artifact production guide**. Its role is to define what an Architecture note encodes, when to produce one, the structural conventions for architecture documents, and the relationship between architecture and downstream artifacts (specifications, designs).

AC.10 The file `claude/skills/scepter/artifacts/requirements.md` MUST exist and serve as the **requirement artifact production guide**. Its role is to define what a Requirement note encodes, the AC authoring discipline, the binding-assessment heuristics, the open-question convention, and the relationship between requirements and downstream specifications and designs.

AC.11 The file `claude/skills/scepter/artifacts/specification.md` MUST exist and serve as the **specification artifact production guide**. Its role is to define what a Specification note encodes (behavioral contracts, data model, state machines, edge cases), the spec-vs-detailed-design boundary, the code-in-specifications boundary, and the methodological lineage (Cleanroom, IEEE 830, formal methods).

AC.12 The file `claude/skills/scepter/artifacts/detailed-design.md` MUST exist and serve as the **detailed design artifact production guide**. Its role is to define what a DD encodes (module inventory, integration sequence, projection coverage), the derivation discipline from specifications, and the phase planning that downstream implementation consumes.

AC.13 The file `claude/skills/scepter/artifacts/implementation.md` MUST exist and serve as the **implementation artifact production guide**. Its role is to define how implementation work projects into source-code annotations, how `@implements` differs from `@see`, and how phased implementation interacts with the trace matrix.

AC.14 The file `claude/skills/scepter/artifacts/test-plan.md` MUST exist and serve as the **test plan artifact production guide**. Its role is to define what a Test Plan note encodes, the `@validates` annotation convention, the relationship between test claims and source claims, and the coverage discipline for AC verification.

---

## §2 Per-File Content Contracts

This section binds each documented file to the content it MUST encode. Contracts are stated as forward-pointing references: the AC names the file path, the section (or content type), and what MUST be present. Verification is by reviewer inspection of the named file at the named location.

The contracts are content-level, not wording-level. "The file MUST encode rule X" is satisfied by any prose that teaches rule X clearly; the exact phrasing is the skill author's discretion. Verification asks "does the file teach this rule effectively?" not "does the file contain these specific words?" This preserves the skill author's editorial freedom while making the contract testable.

The §2 contracts cover the **structural and conceptual content** that each file MUST teach. The cross-project reference grammar (a content contract that derives from {R011.§5}) is bound separately in §4 to keep the derivation chain visible.

### SKILL.md contracts

AC.01 `claude/skills/scepter/SKILL.md` MUST contain a section, at the top of the file, that enumerates the **non-negotiable rules** for agents operating in SCEpter. The section MUST use the heading "NON-NEGOTIABLE RULES" or a heading that is structurally and semantically equivalent. The rules MUST be presented as a numbered list, each entry stating one rule that prevents a specific agent failure mode.

AC.02 `claude/skills/scepter/SKILL.md` MUST contain a **decision tree or routing table** that directs an agent to the correct companion file based on the operation it is performing. Routes MUST cover at minimum: producing artifacts, reviewing, multi-step feature work, team operation, claim authoring, deriving, and implementing.

AC.03 `claude/skills/scepter/SKILL.md` MUST contain a **CLI Reference** section that surfaces the SCEpter command-line surface at the level of detail an agent needs to operate. The reference MUST cover at minimum: discovery (`config`, `list`), viewing (`show`), context gathering (`gather`), searching (`search`), creating notes (`create`), and lifecycle commands (`archive`, `delete`).

AC.04 `claude/skills/scepter/SKILL.md` MUST contain a section on **note creation triggers and discipline** that teaches: when to create a note (decision made, requirement found, question arises), the immediacy rule (now, not later), the quantity discipline (only what was requested), and the don't-isolate-notes rule (always reference related notes).

AC.05 `claude/skills/scepter/SKILL.md` MUST contain an **anti-patterns section** that names the most common agent failure modes and shows the correct alternative for each. At minimum: reading note files directly (instead of using the CLI), creating without searching first, isolated notes, fake dates, self-completing tasks, guessing note IDs, and preserving dead provenance when editing.

### claims.md contracts

AC.06 `claude/skills/scepter/claims.md` MUST contain a **claim reference grammar** section that documents the canonical reference forms (`NOTE.§N.PREFIX.NN`, `NOTE.PREFIX.NN`, `§N.PREFIX.NN`, `PREFIX.NN`), shows examples of each, and identifies the most-explicit form as preferred for cross-document references.

AC.07 `claude/skills/scepter/claims.md` MUST contain a **hard rules** table or section that teaches at minimum: the dot-is-mandatory rule (`AC.01` not `AC01`), the no-hyphens rule (`AC.01` not `AC-01`), the letter-prefix-required rule, the alphabetic-only-prefix rule, the one-letter-prefix-segment rule, the §-is-for-sections-only rule, and the monotonic-never-recycled rule.

AC.08 `claude/skills/scepter/claims.md` MUST contain a section on **claim authoring** that teaches the heading-level vs paragraph-level claim definition formats, the section-nesting rule (claims at a lower level than their containing section), and the consequences of violating these (the parser silently drops malformed claims).

AC.09 `claude/skills/scepter/claims.md` MUST contain a section on the **metadata suffix** that documents the colon-separated grammar, the importance digit (1-5), the lifecycle tags (`closed`, `deferred`, `removed`, `superseded=TARGET`), and the derivation metadata (`derives=TARGET`).

AC.10 `claude/skills/scepter/claims.md` MUST contain a section on **derivation and binding assessment** that teaches the file-count heuristic (1-3 files single module → pass through; 4+ files → decompose), the projection-boundary heuristic (decomposition triggered when claims bundle different projections), and the modal-character heuristic (existence vs behavior vs integration vs constraint vs ordering vs invariant).

AC.11 `claude/skills/scepter/claims.md` MUST contain a section on **smuggling** that defines the failure mode (agent-authored content treated as user-authored across sessions), enumerates common vectors (compacted summaries, agent-drafted `@implements`, scope paraphrases), and prescribes read, write, and review disciplines.

AC.12 `claude/skills/scepter/claims.md` MUST contain a section on **using claims in code** that teaches the `@implements` discipline (only on actually-realized code), the `@see` alternative for stubs, the `@validates` convention for tests, and the consequences of stub-`@implements` (poisoned trace matrix).

AC.13 `claude/skills/scepter/claims.md` MUST contain a section on the **CLI tools for claims** that surfaces at minimum: `trace`, `thread`, `gaps`, `lint`, `index`, `search`, and `verify`. Examples MUST show usage in the workflow contexts an agent encounters.

AC.14 `claude/skills/scepter/claims.md` MUST contain a section on **how traceability works mechanically** that explains how the Source projection is populated (from `@implements`/`@validates` annotations), how note projections are populated (from braced references in note markdown), and the critical-implication that an annotation pointing at a phantom claim is silently orphaned.

AC.15 `claude/skills/scepter/claims.md` MUST contain a **common mistakes** table that maps wrong forms to correct forms. At minimum: stub `@implements`, missing dot, hyphen instead of dot, alphanumeric prefix, two letter segments, bare number as claim, dropping claims from reference docs.

### implementing.md contracts

AC.16 `claude/skills/scepter/implementing.md` MUST contain a **strict git staging discipline** section at the top of the file that prohibits `git add -A`, `git add .`, and bulk-staging in any form, and prescribes adding files by name only.

AC.17 `claude/skills/scepter/implementing.md` MUST contain a section on the **pre-implementation workflow** that teaches: gather context first (`scepter ctx gather`), check mode prompts, get the date before edits (`date "+%Y-%m-%d"`), and only then begin work.

AC.18 `claude/skills/scepter/implementing.md` MUST contain a section on **source code references** that teaches the `@implements` / `@depends-on` / `@addresses` / `@validates` / `@see` annotation set, the fully-qualified-claim-path discipline, and the compact form for multiple claims under the same note/section.

AC.19 `claude/skills/scepter/implementing.md` MUST contain a section on **impact analysis** that teaches the methodology for assessing what downstream behaviors depend on a structural change, including how to enumerate consumers and verify each one.

### reviewing.md contracts

AC.20 `claude/skills/scepter/reviewing.md` MUST contain a section enumerating the **four review subtypes** (completeness, conformance, impact, coherence), defining each by its question and its trigger, and routing the reader to the appropriate companion file for non-completeness reviews.

AC.21 `claude/skills/scepter/reviewing.md` MUST contain a section on **projection enumeration** that teaches the discipline of identifying every projection where a feature should be visible (Source, Tests, CLI, UI, Documentation, etc.) and using `scepter claims trace` to detect missing-projection gaps.

AC.22 `claude/skills/scepter/reviewing.md` MUST contain a section on **AC interaction coverage** that teaches how to identify when ACs interact (combinatorial behaviors, ordering constraints, conditional flows) and how to verify the interaction is specified.

AC.23 `claude/skills/scepter/reviewing.md` MUST contain a section on **marking findings** that establishes the MECHANICAL vs HUMAN_JUDGMENT taxonomy and prescribes that reviewers tag each finding so the orchestrator can route it correctly.

### conformance.md contracts

AC.24 `claude/skills/scepter/conformance.md` MUST contain a **validation criteria** table or section that teaches the five criteria for derived-artifact validation: functional compliance, scope adherence, quality standards, completeness, correctness.

AC.25 `claude/skills/scepter/conformance.md` MUST contain a **structured verdict format** section that prescribes the PASS/FAIL/PARTIAL verdict, the per-requirement analysis, the issues-found section (with location, severity), and the recommendations.

AC.26 `claude/skills/scepter/conformance.md` MUST contain a section on **linking patterns** that teaches how to connect verification work back into the knowledge graph (`@validates` annotations on tests, references to the source requirement, decision notes for non-obvious validation choices).

### team.md contracts

AC.27 `claude/skills/scepter/team.md` MUST contain a **bash command discipline** section near the top of the file that prohibits the patterns that trigger Claude Code human-approval prompts (cd-prefixes, command chaining, heredocs, command substitution, bulk staging) and prescribes the use of dedicated tools (Read, Write, Edit, Grep, Glob).

AC.28 `claude/skills/scepter/team.md` MUST contain a section on the **paired-agent protocol** that defines the producer/reviewer pair, the linker tag-along, the message-exchange flow, and the BLOCKED message convention.

AC.29 `claude/skills/scepter/team.md` MUST contain a section on the **specification fidelity and divergence protocol** that prescribes: never improvise when the spec is unclear, send a BLOCKED message to surface the gap, never use `as unknown as` or other type-system escapes, and reserve internal-implementation latitude for choices invisible to all consumers.

AC.30 `claude/skills/scepter/team.md` MUST contain a **pre-dispatch execution assessment** section that teaches the orchestrator to inspect the DD's Module Inventory before dispatching the team, identifying behavior-preserving restructuring vs greenfield work.

### process.md contracts

AC.31 `claude/skills/scepter/process.md` MUST contain a **process loop** section that teaches the on-start, on-resume, and after-every-operation routines for multi-operation feature work.

AC.32 `claude/skills/scepter/process.md` MUST contain an **orientation protocol** section that teaches the 30-second state-of-the-world check (trace coverage on active notes, gaps, status changes) that runs before any work.

AC.33 `claude/skills/scepter/process.md` MUST contain a **scaffold structure** section that defines the task-note layout (Scope, Active Notes, Frontier, Coverage, Log) and shows how each section is populated and updated.

### epistemic-primer.md contracts

AC.34 `claude/skills/scepter/epistemic-primer.md` MUST contain a **modal status** section that defines IS, MUST, SHOULD, MAY, MUST NOT, SHOULD-BE, and WANT, the alethic-vs-deontic distinction, and the primary failure mode (treating IS as MUST).

AC.35 `claude/skills/scepter/epistemic-primer.md` MUST contain a **claim properties** section that defines binding (with the file-count heuristic), inherence, and settledness, and prescribes the annotation discipline (annotate only when a property deviates from the document's expected baseline).

AC.36 `claude/skills/scepter/epistemic-primer.md` MUST contain a **derivation operations** section that defines decompose, concretize, and elaborate, and shows how each operation moves a claim across projections.

### artifact production guides

AC.37 Each file under `claude/skills/scepter/artifacts/` (architecture.md, requirements.md, specification.md, detailed-design.md, implementation.md, test-plan.md) MUST contain a **methodological lineage** section that situates the artifact type in the existing literature (Cleanroom, IEEE 830, Volere, DO-178C, IEC 62304, formal methods, problem frames, etc., as applicable to the artifact). The lineage MUST be presented as a table mapping methodology to contribution.

AC.38 Each file under `claude/skills/scepter/artifacts/` MUST contain a **when to produce one** section that teaches the produce-when triggers, the skip-when triggers, and the depth-calibration heuristic that matches investment to complexity.

AC.39 Each file under `claude/skills/scepter/artifacts/` MUST contain a **structure** section that defines the canonical section ordering, the required versus optional sections, and the progressive-disclosure principle (each section builds on the previous so a reader can stop at any depth).

AC.40 Each file under `claude/skills/scepter/artifacts/` MUST contain an **anti-patterns** section that names the failure modes specific to that artifact type, with each anti-pattern paired with the correct alternative.

---

## §3 Structural Conventions

This section binds the cross-cutting structural conventions that span multiple skill files. These ACs verify that the files form a coherent corpus, not just individually-correct documents.

The structural conventions include heading discipline (so claim-bearing files remain parseable by SCEpter's own claim parser), the NON-NEGOTIABLE RULES pattern (which is structural, not stylistic — agents are instructed to read these first), the examples-vs-prescriptions discipline (rules and examples both exist; neither replaces the other), and the location of the canonical claim-reference grammar table.

AC.01 The "NON-NEGOTIABLE RULES" section in `SKILL.md` (§2.AC.01) MUST be the first or second top-level subsection of the file, appearing before any deeper conceptual content. The intent: an agent loading SKILL.md encounters the rules early enough that they shape interpretation of everything that follows.

AC.02 The canonical claim-reference grammar table — defining the four reference forms (`NOTE.§N.PREFIX.NN`, `NOTE.PREFIX.NN`, `§N.PREFIX.NN`, `PREFIX.NN`) with examples — MUST appear in `claims.md` under the "Syntax & Rules" section heading or a heading that is structurally and semantically equivalent. Per {R011.§5.AC.01}, this is the location to which cross-project grammar is appended.

AC.03 Heading discipline across all documented files: when a file uses claim IDs (e.g., `AC.NN`, `DC.NN`), claim definitions MUST be placed at a heading level deeper than their containing section, OR as paragraph-level definitions inside a section. Section headings and claim headings MUST NOT be at the same heading level. This convention preserves parseability for SCEpter's own claim parser (per `claims.md` §"Nesting: Claims Under Sections").

AC.04 Examples-vs-prescriptions discipline: when a skill file states a non-obvious rule, the rule MUST be expressed as a prescriptive sentence (using MUST/SHOULD/MAY) AND illustrated with a concrete example. Neither replaces the other — a rule without an example is often misread; an example without a rule is read as suggestion rather than constraint.

AC.05 Cross-file references: when one skill file refers to content in another (e.g., SKILL.md routing to claims.md, reviewing.md routing to conformance.md), the reference MUST name the target file by its filename or relative path, not by external description ("see the claims doc"). This makes the routing machine-checkable and preserves correctness across renames.

AC.06 Skill files MUST use markdown heading syntax (`#`, `##`, `###`, `####`) for section structure, NOT HTML headings, image-based section markers, or other non-standard delimiters. The parser and reviewers depend on markdown heading recognition.

AC.07 Each skill file's top-level title (level-1 heading) MUST match its filename's intent (e.g., `claims.md` → "SCEpter Claims System", `team.md` → "SCEpter Agent Teams"). The intent-match is structural — a renamed file SHOULD also rename the title; a retitled file SHOULD prompt a filename review.

---

## §4 Cross-Project Reference Coverage

This section derives from {R011.§5} and binds the cross-project reference grammar coverage in the skill files. Each AC carries `derives=R011.§5.AC.NN` to make the derivation chain explicit. R011 §5 contains 6 ACs (after the 2026-04-30 renumber); this section carries forward all 6.

The coverage model: R011 §5 binds *what content must reach the skill files*; this section binds *that the skill files encode it correctly* and provides the verification anchor for inspection. A reviewer auditing R011 §5's verification surface reads R011 §5 → finds derived claims here → reads the named file at the named section.

AC.01:derives=R011.§5.AC.01 The canonical claim-reference grammar in `claude/skills/scepter/claims.md` (under the "Syntax & Rules" → "Claim Reference Format" section per §3.AC.02) MUST encode the alias-prefixed reference form `<alias>/<normal-reference>`. The encoding MUST include (a) the abstract grammar (alias name + `/` separator + existing reference grammar), (b) at least one braced example such as `{vendor-lib/R005.§1.AC.01}`, and (c) at least one code-annotation example such as `@implements {vendor-lib/R005.§1.AC.01}`. The new content MUST appear adjacent to the existing reference-format table so a reader scanning the grammar sees both local and cross-project forms together.

AC.02:derives=R011.§5.AC.02 `claude/skills/scepter/claims.md` MUST contain a dedicated section on cross-project references that covers (a) when to use the alias-prefixed form (citing a peer project's note or claim for display, where local copy would lose traceability); (b) when NOT to use it — for `derives=` per {R011.§2.AC.03} default, and PERMANENTLY for `superseded=` per {R011.§2.AC.04}; and (c) the citation-versus-federation distinction (peer claims do not enter the local index, gap report, or trace matrix per the Core Principle of {R011}). The section MUST include the {R011.§2.AC.03} reconsideration clause and the {R011.§2.AC.04} permanence rationale, verbatim or paraphrased with attribution to R011.

AC.03:derives=R011.§5.AC.03 The "Hard Rules" or "Common Mistakes" tables in `claims.md` MUST gain rows that specifically reject `derives=<alias>/<id>` and `superseded=<alias>/<id>`. The error message text the agent should expect from the linter SHOULD be quoted or summarized so the agent can recognize and act on it.

AC.04:derives=R011.§5.AC.04 The agent-facing CLI reference in `claude/skills/scepter/SKILL.md` (under §"CLI Reference" per §2.AC.03) MUST surface alias-prefixed reference forms in at least one example per relevant subcommand: `show`, `gather`, and the lint/trace surfaces from {R011.§3.AC.06}. The intent: an agent skimming the CLI reference encounters the cross-project syntax in its natural usage context, not buried in claims.md.

AC.05:derives=R011.§5.AC.05 The skill files MUST be revised such that an agent reading them encounters the alias-prefixed grammar BEFORE any prose that could be read as "all references resolve in the current project." The existing implicit closed-world assumption MUST be replaced with the explicit two-case framing: local references resolve in the current project; alias-prefixed references resolve in the named peer project. This is a structural-edit requirement: existing prose that embeds the closed-world assumption MUST be revised, not merely supplemented.

AC.06:derives=R011.§5.AC.06 Examples in `claims.md` and `SKILL.md` that currently use only local references SHOULD remain primarily local-reference examples (cross-project references are the minority case; over-promoting them in examples would distort the agent's frequency model). The cross-project examples introduced by §4.AC.01–§4.AC.04 are sufficient. Existing examples MUST NOT be rewritten to use alias prefixes unless the example is specifically about cross-project usage.

---

## §5 Annotation Discipline (CRITICAL)

This section is the operative constraint of S001. Every other AC in this spec is verifiable WITHOUT the documented files carrying dense per-section claim references — and §5 is what makes that property hold. Without §5, the natural temptation is to embed `<!-- @implements {S001.§2.AC.04} -->` (or similar) at every section the spec binds, which would inflate skill-file token cost on every agent load. §5 explicitly forbids that path.

The binding concern is **token cost**. Skill files are loaded as agent context on every skill use. A typical session may load `claims.md` dozens of times. Per-section claim annotations would add 50–200 hidden lines to claims.md alone, and proportional cost to every documented file. Multiplied across sessions and across files, the cost is non-trivial — and provides no verification benefit beyond what reviewer inspection already provides. Verification of S001 happens by reading the files against the spec; the trace matrix would be a duplicate witness, not an independent check.

The verification model this section establishes: S001 maintains forward-pointing references (file paths and section headings); reviewers read the named file at the named location; the contract is verified by content inspection. No annotation in the documented file is required, and per AC.01 below, none is permitted at per-section granularity.

The §5 ACs are the most important ACs in this document. An agent implementing S001 by adding heavy annotation to the skill files has not satisfied S001; it has violated S001.

AC.01 Skill files (the documented files enumerated in §1) MUST NOT carry per-section claim references such as `{S001.§2.AC.04}`, `<!-- @implements {S001.§N.AC.NN} -->`, or any equivalent per-section annotation pointing back at this spec or any other spec. The prohibition extends to inline metadata, footnote-style references, HTML comments at section boundaries, and any other annotation form whose token cost scales with section count.

AC.02 The verification path for §2, §3, and §4 MUST be reviewer inspection: the AC names a file path and a content location; the reviewer opens the file at that location; the reviewer confirms the named content is present. A reviewer MUST NOT be required to grep for claim annotations inside the documented file in order to verify an AC.

AC.03 A documented file MAY carry at most ONE top-of-file marker indicating that it is documented by this spec. The marker, if present, MUST be a single HTML comment line such as `<!-- Documented by: S001 -->`, placed within the first 5 lines of the file (before or after the level-1 heading). This is the ONLY claim reference a documented file MAY carry pointing at S001. The marker is OPTIONAL — a documented file with no marker is fully compliant; a marker is permitted for discoverability but never required.

AC.04 If a future spec extends or supersedes S001's coverage of a documented file, the new spec MUST follow the same forward-pointing model. Documented files MUST NOT accumulate a chain of `<!-- Documented by: S001, S002, S003 -->` markers. The single-marker discipline of AC.03 stands; new specs are discoverable through their own forward-pointing references and through `scepter ctx list --type Specification`.

AC.05 Verification of S001 ACs MUST NOT depend on `scepter claims trace` showing source coverage on documented files. The trace matrix for S001 will show no Source projection coverage — that is correct and expected. Source coverage for S001 would be EITHER (a) `@implements {S001.§N.AC.NN}` annotations in source code, which only applies if a source-code projection exists for some S001 AC (none currently do — S001 specifies markdown documentation, not source behavior); OR (b) cross-references from other notes (e.g., a future test plan that `@validates` S001 contracts), which is permitted. The expected projection coverage for S001 is reviewer-attested verification events (`scepter claims verify`) rather than mechanical trace matrix entries.

AC.06 If an agent implementing or reviewing S001 finds itself wanting to add per-section markers to documented files to "make the trace matrix go green," that wanting is a signal the agent has misread S001. The trace matrix is not the verification mechanism for this spec. The agent MUST escalate the question to the user before adding any annotation beyond the single optional top-of-file marker permitted by AC.03.

---

## Acceptance Criteria Summary

| Section | Count |
|---------|-------|
| §1 Skill File Inventory | 14 |
| §2 Per-File Content Contracts | 40 |
| §3 Structural Conventions | 7 |
| §4 Cross-Project Reference Coverage | 6 |
| §5 Annotation Discipline | 6 |
| **Total** | **73** |

---

## References

- {R011.§5} — Agent-Facing Documentation Updates (the primary requirement source for §4; this spec carries forward all 6 R011 §5 ACs via `derives=R011.§5.AC.NN` metadata, and provides a stable verification surface for skill-file content beyond R011's §5 scope)
- {R011.§Non-Goals — Updates to agent dispatch templates} — The 2026-04-30 scope decision that excludes `claude/agents/` dispatch templates from R011's binding scope; S001 inherits the same exclusion (dispatch templates are out of scope per §Overview "Scope (out)")
- {DD015} — Cross-Project Reference Resolution (the design projection of R011; DD015's coverage of R011 §5 via Module Inventory rows is one valid traceability path; S001's coverage via §4 derived ACs is the parallel valid path — both are expected to coexist)
- `claude/skills/scepter/SKILL.md` — The main skill entry point; documented file per §1.AC.01 and contracted by §2 / §3 / §4 ACs
- `claude/skills/scepter/claims.md` — The claim system reference; documented file per §1.AC.02 and the primary subject of §2 (claim authoring contracts) and §4 (cross-project grammar contracts)
- `claude/skills/scepter/implementing.md`, `claude/skills/scepter/reviewing.md`, `claude/skills/scepter/conformance.md`, `claude/skills/scepter/team.md`, `claude/skills/scepter/process.md`, `claude/skills/scepter/epistemic-primer.md` — Documented files per §1.AC.03–§1.AC.08
- `claude/skills/scepter/artifacts/*.md` — Artifact production guides; documented files per §1.AC.09–§1.AC.14

---

## Status

- 2026-04-30: Authored. Establishes the skill-file inventory, per-file content contracts, structural conventions, cross-project reference coverage derived from {R011.§5}, and the annotation-discipline constraint that defines the spec's verification model. Status: `draft`. The spec stands as the projection layer between requirement-level constraints on skill content and the actual files; future requirements that bind skill content SHOULD add their derived claims here rather than scattering them across requirements.
