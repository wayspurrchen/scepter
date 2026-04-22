# Requirements Document Guide

A requirements document is the bridge between a problem domain and a specification. It answers: what must the system do, why, under what constraints, and how will we know it's done. Requirements are the first formal commitment — upstream of them is intent (needs, goals, problems); downstream is specification (contracts, interfaces, invariants). This document defines both the output format for requirements and the process for producing one.

**Core Problem**: Requirements sit between two failure modes. Too vague and they don't constrain the solution — the implementer fills the gap with assumptions. Too specific and they embed design decisions — the solution space collapses prematurely, and the "requirement" is actually a specification wearing the wrong label. The discipline is finding the right level: precise enough to be testable, abstract enough to permit design freedom.

**Methodological Lineage**:

| Methodology | Contribution to This Process | Context |
|-------------|----------------------------|---------|
| IEEE/ISO 29148 | Three-process framework (mission analysis, stakeholder needs, system requirements) | The current international standard for requirements engineering |
| Volere (Robertson & Robertson) | Fit criteria, quality gateway, atomic requirement template | Forces testability at the individual requirement level |
| Wiegers & Beatty | Elicitation technique taxonomy, requirements development lifecycle | Pragmatic practitioner guidance across the full lifecycle |
| Jackson Problem Frames | Requirements derive from the problem domain, not the solution | Separates the "world" from the "machine" |
| GORE (KAOS, i*) | Goal decomposition into requirements via AND/OR refinement | Requirements trace to goals; obstacles refine requirements |
| Twin Peaks (Nuseibeh) | Requirements and architecture co-develop iteratively | Neither is frozen before the other is understood |
| DO-178C / IEC 62304 | Derived requirements, bidirectional traceability, completeness checks | Safety-critical rigor applicable to any serious requirements effort |
| Kano / MoSCoW | Prioritization by stakeholder satisfaction and necessity | Not all requirements carry equal weight |

**Relationship to other skills**:

- **Epistemic analysis** ([vocabulary.md](../epistemic-primer.md)) provides the terms this process operates with. Requirements are primarily MUST and SHOULD claims at the Intent-Specification boundary (see [vocabulary.md §4](../epistemic-primer.md) — Projections). The process uses modal statuses to distinguish what IS (current state) from what MUST be (required state), and binding to identify which requirements constrain the most downstream decisions.

- **Epistemic topology** ([topology.md](../epistemic-primer.md)) perceives the problem domain's structure. A topology analysis often precedes requirements development — the bodies identified in the topology become the requirement clusters in the document.

- **Detailed design** ([detailed-design.md](detailed-design.md)) is downstream. Detailed design takes settled requirements and plans their realization. If you're still deciding *what* the system should do, use this process. If you've decided and need to plan *how to build it*, use detailed design.

---

## When to Produce One

**Produce when:**
- A problem, need, or opportunity has been identified but not yet formally captured
- Stakeholders have expressed desires (WANT claims) that need to be converted into testable commitments
- An exploratory analysis or architectural investigation has matured to the point where requirements can be stated
- Implementation keeps drifting because there's no shared definition of "done"
- Multiple stakeholders have conflicting expectations that need to be reconciled into a single authoritative source

**Skip when:**
- Exploratory work where the problem itself isn't understood yet (do topology analysis or architectural analysis first)
- Single-line bug fixes where the requirement is self-evident from the defect
- Tasks that already have a specification — you don't need to back-derive requirements
- Capturing design decisions (those belong in architecture or specification documents)

---

## What It Contains

A requirements document is organized around a small number of conceptual sections, each answering a specific question. Not every section appears in every tier, but the questions themselves are universal.

- **Overview** — what is this and why does it matter? States the domain (not the document structure) and a foundational insight or design principle.
- **Problem Statement** — what concrete gap or need motivates this work? Evidence-grounded: actual code, behavior tables, or specific scenarios make the problem undeniable.
- **Design Principles** (medium+) — what 2-3 rules govern every requirement below? Front-loaded so the reader has the decision framework before encountering specific requirements.
- **Requirements** — the testable MUST/SHOULD commitments, organized into clusters that mirror the problem domain (not the system architecture).
- **Acceptance Criteria** — the verification surface. Each AC is a binary test that maps to a verification action.
- **Edge Cases** (medium+) — detection and behavior for each known case, made explicit and independently testable.
- **Scope Boundaries** — what's in, what's out, what's deferred, and why. Prevents scope creep and revisiting closed decisions.
- **Open Questions** (if any) — unresolved decisions that may affect requirements, with resolution paths.
- **References** — links to upstream inputs and related artifacts.

For large requirements, these sections decompose across a hub file (context, navigation, summary) and subfiles (detailed requirements per sub-domain).

---

## Structure

### Size Tiers

Requirements naturally fall into three complexity tiers. The format scales with the tier.

| Tier | Character | Line Budget | AC Format |
|------|-----------|-------------|-----------|
| **Small** | Single concept, <10 requirements | <150 lines | Entity-prefixed table |
| **Medium** | Single domain, technically deep | 150-700 lines | Inline ACs per requirement cluster + summary table |
| **Large** | Multiple sub-domains, cross-cutting | Hub <300 lines + subfiles | Merged requirement/AC tables per subfile + count summary in hub |

### Small Requirements

For single-concept features with fewer than 10 requirements.

```markdown
# [ID] - [Title]

## Overview
[2-4 sentences: what is this, why does it matter, core principle.
Describes the DOMAIN, never the document structure.
States a foundational insight or design principle.]

## Problem Statement
[User-centered description of the need or gap.
If a code bug motivates this, show the actual code with file/line reference.
If a behavior gap, use current-vs-correct behavior table:]

| Scenario | Current Behavior | Correct Behavior |
|----------|-----------------|------------------|
| ... | ... | ... |

## Requirements
### 1. [Requirement Name]
The system MUST [requirement statement].

### 2. [Requirement Name]
The system SHOULD [requirement statement].

## Acceptance Criteria

| Code | Criterion |
|------|-----------|
| [PREFIX].AC01 | [Testable statement] |
| [PREFIX].AC02 | ... |

## References
```

#### Overview Rules

The overview must answer "what is this?" and "why does it matter?" in prose. It must state a design principle or core insight. It is 2-5 sentences, never more.

**Good**: "Feature X enables the system to do Y — things can be Z for bidirectional sync. **Core Principle:** The database is the source of truth."

**Bad**: "This document defines comprehensive requirements for the X system, derived from the architecture." — This describes the document, not the domain.

### Medium Requirements

For technically deep single-domain requirements.

```markdown
# [ID] - [Title]

## Overview
[What this covers AND what it doesn't. 5-8 sentences.]

## Problem Statement
[Evidence-grounded: exact file/line, actual code, behavior table.
Name the root cause, show the broken code or missing behavior,
make the problem undeniable and verifiable.]

## Design Principles
[2-3 bolded principles that govern all decisions in this requirement.
Stated before requirements so the reader has the decision framework
before encountering specific requirements.]

**[Principle Name]:** [Statement]. [Brief rationale.]

## Requirements

### [ID].1 — [Cluster Name]
[Requirement prose with MUST/SHOULD language.
Each requirement is a single coherent thought that says
what the system must do, what it must NOT do, and names
the concrete artifacts.]

**AC.01:** [Inline acceptance criterion — immediately adjacent to the
requirement it tests. No section-hopping.]
**AC.02:** ...

### [ID].2 — [Cluster Name]
...

## Edge Cases
### [Case Name]
**Detection:** [How the system knows this case occurred]
**Behavior:** [What the system does, as numbered steps]

## Non-Goals
- **[Anti-requirement]** — [Brief rationale preventing revisitation]

## Acceptance Criteria Summary

| Category | Count |
|----------|-------|
| [ID].1 Cluster | N |
| [ID].2 Cluster | N |
| **Total** | **N** |

## References
```

#### Design Principles Section

This appears before requirements and provides the decision framework. Different from the Overview's "core principle" — Design Principles are the 2-3 rules that govern every specific requirement below. Front-load the principles, then present requirements that follow from them.

#### Edge Cases

Dedicated section, one subsection per case with detection and behavior. Most requirements bury edge cases in prose or omit them entirely. Making edge cases explicit and independently addressable makes them implementable and testable in isolation.

### Large Requirements (Hub + Subfiles)

For requirements spanning multiple sub-domains.

#### Hub File (Under 300 Lines)

```markdown
# [ID] - [Title]

## Overview
[Purpose, user need, core principle. 2-4 sentences.]

## Use Case Analysis
[Table evaluating motivating use cases against architecture principles]

## Architectural Alignment
[Which architectural invariants this touches]

## Document Structure

| Document | Scope | Status |
|----------|-------|--------|
| [01 Sub-Domain A](./01%20Sub-Domain%20A.md) | ... | Active |
| [02 Sub-Domain B](./02%20Sub-Domain%20B.md) | ... | Active |

## Scope
### In Scope
[Categorized by sub-domain]

### Out of Scope
[Specific enough to be unambiguous]

### Deferred
[With dates or conditions for revisitation]

## Dependencies

## Open Questions

## AC Summary

| Sub-Domain | Count |
|------------|-------|
| 01 Sub-Domain A | N |
| 02 Sub-Domain B | N |
| **Total** | **N** |

## References
```

**Critical rule**: The hub file contains NO detailed requirements, NO type definitions, NO data models. Those belong in subfiles. The hub provides context, navigation, and summary.

#### Subfiles

Each subfile follows the medium-requirement format internally, using merged requirement/AC tables where each row is simultaneously a requirement and an acceptance criterion:

```markdown
| Code | Requirement |
|------|-------------|
| PLG.01 | System MUST implement the plugin interface |
| PLG.02 | System MUST declare a name (string identifier) |
```

This merged format is maximally testable — each row maps directly to a test function name. Use it when requirements are discrete, independently verifiable statements. Use the medium-format inline ACs instead when requirements need prose explanation beyond a single sentence.

### Acceptance Criteria Format Selection

Choose based on the requirement's character:

| Situation | AC Format | Why |
|-----------|-----------|-----|
| Discrete, independently verifiable statements | **Merged table** (requirement IS the AC) | Eliminates duplication, each row is a test |
| Complex domain with natural categories | **Categorized tables** with entity-prefixed codes + summary | Groups ACs by concern, supports scanning all ACs at once |
| Technically deep, requirement tightly coupled to its test | **Inline ACs** immediately after each requirement | No section-hopping, AC is in the context where it makes sense |
| Minimal/early capture, not yet fleshed out | **Numbered prose list** (temporary) | Better than nothing, but should be upgraded before implementation |

Entity-prefix all acceptance criteria. Prefixes derived from the domain (e.g., FM for file mode, PLG for plugin, SCH for schema) are the most traceable and testable format. Avoid bare checkbox lists or unnumbered prose criteria.

### Contamination Rules

#### Allowed in Requirements

- **Type interfaces defining domain vocabulary** — precise vocabulary definition crosses the requirement/specification boundary but the precision is worth it. The interface is the most efficient way to express "what fields must exist."
- **Design principle diagrams** — when the design decision is so fundamental it's effectively part of the requirement. Pseudocode or flow diagrams that explain the "what" through a "how" lens.
- **Root cause code excerpts in problem statements** — the actual broken code grounds the requirement in verifiable reality.

#### Prohibited in Requirements

- **File trees and code structure** — ephemeral snapshots that become outdated. No lasting value.
- **Full class/function implementations with method bodies** — specification content. The requirement is the one-sentence "what"; the implementation belongs elsewhere.
- **Inline status updates within requirements or ACs** — valuable as project journal but poisons the requirements as a reference document.
- **Obsolete-but-preserved content** — creates trust problems. Either delete it, move it to an archive subdocument, or collapse under a "Historical Context" section at the bottom.

#### Status and Progress

Dedicate a section at the bottom for status updates, implementation progress, and timestamps. Never inline status with requirements or ACs. This keeps the requirements clean as a reference while preserving the changelog.

### Scope Boundaries

Every requirement of medium complexity or above should have explicit scope boundaries. Two formats:

**Three-part scope** (for large requirements):
- In Scope (categorized by sub-domain)
- Out of Scope (specific enough to be unambiguous)
- Deferred (with dates or conditions for revisitation)

**Non-Goals with rationale** (for medium requirements):
- **[Anti-requirement]** — [Brief rationale]

The rationale on each non-goal prevents revisiting the same design decisions. "We don't do X because Y" closes the loop.

---

## How to Produce

### Step 1: Identify the Problem Domain

Before writing any requirements, establish what problem you're solving and for whom. This is Jackson's core insight: requirements live in the problem world, not the solution world. The system is the machine you will build; the requirements describe effects the machine must produce in the world.

**Actions:**
- State the problem or need in 2-3 sentences. If you can't, the problem isn't understood well enough for requirements.
- Identify the affected stakeholders — who experiences the problem, who benefits from the solution, who constrains the solution.
- Identify the domain concepts — the nouns of the problem world. These become the vocabulary of the requirements.
- Distinguish domain facts (IS claims about the world) from domain needs (WANT/SHOULD claims about desired changes).

**Checkpoint:** Can you explain the problem without mentioning any technology or solution approach? If not, you're already embedding design. Back up.

### Step 2: Elicit Raw Requirements

Requirements don't appear fully formed. They're extracted from multiple sources through deliberate techniques. Different sources yield different types of requirements.

**Sources and what they yield:**

| Source | Typical yield | Technique |
|--------|-------------|-----------|
| Stakeholder conversations | Functional needs, priorities, constraints | Interviews, workshops |
| Existing system behavior | Implicit requirements (things that must continue working) | Observation, reverse engineering |
| Defect reports and pain points | Negative requirements (what must NOT happen) | Root cause analysis |
| Domain standards and regulations | Non-negotiable constraints | Document analysis |
| Competitor/analogous systems | Capability expectations, quality benchmarks | Comparative analysis |
| Architecture constraints | Feasibility boundaries, integration requirements | Architecture review |
| Failed prior attempts | Hidden requirements that weren't captured before | Post-mortem analysis |

**Elicitation heuristics:**
- Ask "what must be true when this is done?" rather than "what should the system do?" The former yields testable conditions; the latter yields feature wish lists.
- Ask "what would make this unacceptable?" to surface constraints and negative requirements.
- When a stakeholder states a solution ("I need a dropdown"), ask "what problem does that solve?" to recover the underlying requirement.
- Capture rationale alongside each requirement. A requirement without rationale is a requirement you can't prioritize or challenge.
- Use goal decomposition (from GORE/KAOS): state the high-level goal, then ask "what sub-goals must ALL be satisfied for this goal to be met?" (AND-refinement) or "what alternative sub-goals could satisfy this?" (OR-refinement). Each leaf goal that can't be decomposed further is a candidate requirement.
- Look for obstacles — conditions that prevent a goal from being achieved. Each obstacle, once identified, generates a requirement to mitigate or prevent it. "Users must be able to recover their account" generates "The system MUST support password reset" only after the obstacle "users forget passwords" is identified.

**Output:** A raw list of needs, constraints, and expectations — unstructured, possibly contradictory, not yet in requirement form. That's expected. Structure comes in the next steps.

### Step 3: Determine the Tier

The Size Tiers section above defines three tiers (small, medium, large). Determining the tier early prevents both over-engineering simple needs and under-structuring complex ones.

**Tier indicators:**

| Signal | Points toward |
|--------|--------------|
| Fewer than 10 discrete requirements | Small |
| Single domain, technically deep | Medium |
| Multiple sub-domains with cross-cutting concerns | Large |
| Requirements cluster into 2-3 natural groups | Medium |
| Requirements cluster into 4+ groups needing separate documents | Large |
| All requirements fit in one reader's head simultaneously | Small |
| Requires a navigation hub for readers to find relevant sections | Large |

Tier assessment is provisional. If you start at medium and discover the problem decomposes into independent sub-domains, promote to large. If you start at large and realize the sub-domains are tightly coupled, demote to medium with more clusters.

### Step 4: Decompose into Requirement Clusters

Group related raw requirements by domain concern, not by solution component. Clusters emerge from the problem structure, not from the system architecture.

**Decomposition heuristics:**
- Requirements that share domain vocabulary belong together. If they use the same nouns, they're about the same concern.
- Requirements that must be verified together belong together. If testing one requires the other to be in place, they're coupled.
- Requirements that could be deferred independently belong in separate clusters. If one cluster can ship without the other, they're separate concerns.

Each cluster gets a name derived from the domain ("Schema Resolution," "Consumer Lifecycle," "Access Control") — not from the solution ("Database Layer," "API Endpoints," "UI Components").

For large requirements, clusters may become subfiles. For medium requirements, clusters become headed sections. For small requirements, clustering is usually unnecessary.

### Step 5: Formalize Each Requirement

Convert raw needs into formal requirement statements. This is where the Volere insight matters most: every requirement must have a fit criterion — a measurable condition that determines whether a solution satisfies it.

**Formalization checklist for each requirement:**

1. **Modal verb.** Is this MUST, SHOULD, or MAY? (See [vocabulary.md §RFC 2119](../epistemic-primer.md).) Most raw requirements arrive as unmarked assertions. Assigning a modal verb forces a priority decision.

2. **Subject.** What entity does this requirement govern? "The system" is acceptable for system-level requirements. Specific component names are acceptable when the requirement genuinely applies only to that component — but watch for premature design.

3. **Predicate.** What must the subject do, be, or not do? Use active voice. One requirement, one predicate. If a requirement contains "and," it's probably two requirements.

4. **Boundary.** What is explicitly excluded? Requirements without boundaries grow during implementation. State what the requirement does NOT cover.

5. **Fit criterion.** How will you verify this? If you can't state a verification condition, the requirement is either ambiguous (refine it) or a goal masquerading as a requirement (move it to the overview's design principles).

**The requirements/specification boundary:**

| Belongs in requirements | Belongs in specification |
|------------------------|------------------------|
| "The system MUST support undo for all editing operations" | "Undo MUST use a command stack with serialize/deserialize" |
| "Response time MUST be under 200ms for queries" | "Queries MUST use indexed lookups on the `schemaId` field" |
| "Data MUST survive process restart" | "Data MUST be persisted to SQLite using WAL mode" |
| Type interfaces defining domain vocabulary | Full class implementations with method bodies |

The left column constrains what the system must achieve. The right column constrains how. Requirements stay in the "what" column. When you catch yourself writing "how," you're specifying, not requiring.

**Exception:** The Contamination Rules above permit type interfaces that define domain vocabulary. A `UserProfile` interface listing required fields is requirement-level — it's the most precise way to say "these fields must exist." A `UserProfileService` class with method bodies is specification-level.

### Step 6: Write Acceptance Criteria

Acceptance criteria are the testable surface of requirements. Each criterion maps to a verification action — a test that passes or fails.

**Properties of good acceptance criteria:**

- **Independently testable.** Each criterion can be verified without relying on the result of another criterion.
- **Entity-prefixed.** Use domain-derived codes (SCH.AC01, PLG.AC02) for traceability. Avoid bare numbered lists.
- **Binary.** The criterion is met or not met. "The system should be fast" is not a criterion. "Response time MUST be under 200ms at the 95th percentile" is.
- **Scenario-grounded.** State the precondition, action, and expected result. "Given [state], when [action], then [observable outcome]."
- **Covering edge cases.** If a requirement has known edge cases, each edge case gets its own criterion. The Edge Cases section (medium tier) makes this explicit.

**Format selection** (see Acceptance Criteria Format Selection above) depends on character:
- Discrete, independently verifiable statements → merged table (requirement IS the AC)
- Technically deep, tightly coupled to requirement context → inline ACs
- Multiple natural categories → categorized tables with entity-prefixed codes

### Step 7: Define Scope Boundaries

Every requirement set of medium complexity or above needs explicit scope boundaries. Scope boundaries prevent two failure modes: scope creep (requirements growing during implementation) and scope ambiguity (stakeholders assuming something is included that isn't).

**Three mechanisms:**

1. **Non-Goals with rationale** (medium tier). State what the requirement explicitly does NOT cover and why. The rationale prevents revisiting the same decision later. "We don't do X because Y" closes the loop.

2. **In/Out/Deferred scope** (large tier). Categorize scope explicitly. Deferred items get revisitation conditions ("deferred until v2" or "deferred until performance data is available").

3. **Open Questions.** Decisions that can't be made now. Each open question states what information is missing and what decision it blocks. Open questions are not failures — they're honest about the limits of current knowledge. But every open question should have a path to resolution.

**Handling open questions and deferred decisions:**

Open questions differ from deferred scope. A deferred scope item is a known requirement postponed to a later phase. An open question is an unresolved decision that may affect current requirements.

For each open question:
- State the question precisely. "How should we handle X?" is too vague. "Should X support concurrent access, and if so, with optimistic or pessimistic locking?" is actionable.
- Identify what it blocks. Which requirements can't be finalized until this is answered?
- Identify who or what can resolve it. Is this a stakeholder decision, a technical investigation, or dependent on external information?
- Identify the default assumption. If the question isn't resolved before implementation begins, what assumption will the implementer make? Making the default explicit prevents silent drift.
- Assign a resolution path. "Resolved by: user decision after prototype" or "Resolved by: load testing results" or "Resolved by: legal review of data residency rules."

### Step 8: Prioritize

Not all requirements are equal. Prioritization determines implementation order, scope negotiations, and what gets cut when resources are constrained.

**Prioritization inputs:**

- **Modal status.** MUST requirements are non-negotiable. SHOULD requirements are the negotiation space. MAY requirements are deferred unless free.
- **Binding.** High-binding requirements (see [vocabulary.md §2](../epistemic-primer.md) — Binding) constrain many downstream decisions. Settle and implement these first. A high-binding requirement left unresolved creates cascading uncertainty.
- **Stakeholder value.** The Kano model distinguishes basic expectations (must be present, cause dissatisfaction only when absent), performance factors (satisfaction scales linearly with delivery), and delight factors (unexpected value). Most requirements are basic or performance; delight requirements are the ones worth being strategic about.
- **Risk.** Requirements touching poorly understood domains or novel technology carry implementation risk. Prioritize these early to surface problems before commitments are made.

### Step 9: Validate

Requirements validation checks two things: do the requirements capture what stakeholders actually need (external validity), and are the requirements internally consistent (internal validity).

**External validation — against stakeholders and problem domain:**
- Walk each requirement cluster with stakeholders. Ask: "If the system satisfies this requirement, does it solve your problem?" Not "do you agree with this requirement?" — the former tests adequacy, the latter tests phrasing.
- Check for missing requirements. The most dangerous requirements defect is an absent requirement — one that no one stated because it was assumed. Ask: "What else would make this unacceptable even if every stated requirement is met?"
- Check for gold-plating. Requirements that don't trace to any stakeholder need or problem-domain constraint are candidates for removal.

**Internal validation — consistency and completeness:**
- **Contradictions.** Two requirements that cannot both be satisfied simultaneously. Common sources: requirements from different stakeholders that conflict, or functional requirements that contradict quality requirements (e.g., "MUST respond in under 50ms" vs. "MUST validate against external service").
- **Redundancy.** Two requirements that say the same thing in different words. Redundancy is a maintenance burden — when one is updated, the other must be updated too. Merge or cross-reference.
- **AC coverage.** Every MUST requirement must have at least one acceptance criterion. Every SHOULD requirement should have one. Requirements without acceptance criteria are untestable commitments.
- **Traceability.** Every requirement should trace to a stakeholder need or problem statement (upward traceability). Every acceptance criterion should trace to a requirement (downward traceability). Missing links are gaps. DO-178C calls this bidirectional traceability and treats gaps as findings.
- **Completeness against problem statement.** Re-read the problem statement. Does every aspect of the stated problem have at least one requirement addressing it? Does every requirement trace back to the stated problem? Requirements that don't address the problem are gold-plating; problem aspects without requirements are coverage gaps.
- **Terminology consistency.** The same domain concept should use the same term throughout. If "user," "account holder," and "customer" all refer to the same entity, pick one and standardize.

**Validation against architecture (Twin Peaks):**

Requirements and architecture inform each other. Pure top-down requirements development — "freeze requirements, then design" — ignores that architectural feasibility constrains requirements, and requirements discovery reveals architectural implications.

- Share draft requirements with the architectural projection. Are there requirements that the current architecture cannot support without fundamental changes? If so, either the requirement needs negotiation or the architecture needs evolution — but this must be a conscious decision, not a surprise during implementation.
- Watch for **derived requirements** — requirements that emerge from architectural decisions rather than stakeholder needs. DO-178C calls these out explicitly: a requirement that exists because of how the system is built (not because of what it must do) needs special attention. Derived requirements are legitimate but must be traced to the architectural decision that created them, not presented as stakeholder requirements.

---

## Distinguishing Requirements from Neighbors

Requirements live in a specific epistemic zone. Confusing them with adjacent artifacts causes structural problems.

| If you're writing... | You're probably writing... | Move it to... |
|---------------------|--------------------------|---------------|
| "Users need to..." | A goal or intent | Overview / Problem Statement |
| "The system MUST..." | A requirement | Keep it here |
| "The system MUST use [specific technology]..." | A specification or design constraint | Specification document |
| "Implement by adding a method to class X" | An implementation task | Detailed design or task tracker |
| "We chose approach A over B because..." | An architectural decision | Architecture document or decision record |
| "The system SHOULD [vague aspiration]..." | A goal, not a requirement | Refine into a testable statement or move to design principles |

The litmus test: can a tester write a pass/fail test from this statement alone, without knowing the system's internal design? If yes, it's a requirement. If they need to know implementation details to test it, it's a specification. If they can't test it at all, it's a goal.

---

## Anti-Patterns

### Solution Masquerading as Requirement [Process]

**Symptom:** "The system MUST store data in PostgreSQL." This constrains the solution without stating what problem it solves.
**Fix:** State the need: "The system MUST persist data with ACID guarantees across process restarts." If PostgreSQL is the only viable option, state that as a design constraint with rationale — not as a requirement.

### Requirements by Analogy [Process]

**Symptom:** "Like Slack, but for [domain]." Analogy is useful for communicating vision but terrible for requirements. It imports thousands of implicit assumptions without examining any of them.
**Fix:** Decompose the analogy into specific capabilities. Which aspects of Slack? Real-time messaging? Threading? Presence? Each becomes a requirement candidate that can be independently evaluated.

### The Kitchen Sink [Process]

**Symptom:** A requirements document that captures every possible future need, "just in case."
**Fix:** Requirements for the current scope only. Future needs go in a backlog or deferred section with revisitation conditions. Over-specifying upfront creates false precision — you don't know enough yet to state those requirements, and they'll change.

### Untestable Aspirations [Both]

**Symptom:** "The system SHOULD be user-friendly." "The system MUST be fast." "The system SHOULD be maintainable."
**Fix:** Decompose into measurable criteria. "User-friendly" → "A new user MUST complete [core task] within [time] without documentation." "Fast" → "95th percentile response time MUST be under [threshold]." If you can't decompose it, it's a design principle, not a requirement.

### Missing Negative Requirements [Both]

**Symptom:** Requirements that only state what the system must do, never what it must NOT do.
**Fix:** Explicitly capture prohibitions and constraints. "The system MUST NOT expose user data to other tenants." "The system MUST NOT require downtime for configuration changes." Negative requirements often represent the hardest engineering constraints and surface the most important architectural decisions.

### Premature Completeness [Process]

**Symptom:** Refusing to publish requirements until every question is answered and every edge case is covered.
**Fix:** Requirements are living documents during early development. Open questions are legitimate content. Publish with known gaps marked explicitly (the Open Questions section supports this). Waiting for completeness means waiting forever — and meanwhile implementation proceeds without any formal requirements at all.

### Conflating Priority with Modality [Process]

**Symptom:** Marking everything MUST because it all feels important.
**Fix:** MUST means "the system is unacceptable without this." SHOULD means "strongly recommended but the system can ship without it." MAY means "nice to have." If 90% of requirements are MUST, the prioritization is not doing its job. A realistic distribution has few MUSTs, a healthy set of SHOULDs, and some MAYs.

### Document-About-the-Document Overview [Structural]

**Symptom:** An overview that describes the document ("This document defines comprehensive requirements...") instead of the domain.
**Fix:** The overview describes the DOMAIN, never the document structure. State what the feature is, why it matters, and the core principle — in prose, in 2-5 sentences.

### Status Updates Inlined with Requirements [Structural]

**Symptom:** Implementation progress, timestamps, or review notes interleaved with requirement text or acceptance criteria.
**Fix:** Status and progress belong in a dedicated section at the bottom. Inlining poisons the requirements as a reference document. Keep the requirements clean; preserve the changelog separately.

### Obsolete Content Preserved in Body [Structural]

**Symptom:** Superseded requirements or outdated material kept in the main body "for reference."
**Fix:** Either delete it, move it to an archive subdocument, or collapse it under a "Historical Context" section at the bottom. Obsolete-but-present content creates trust problems — readers can't tell what's current.

### Hub File Contains Detail [Structural]

**Symptom:** The hub file in a large requirement includes detailed requirements, type definitions, or data models.
**Fix:** The hub is context, navigation, and summary only. Detailed requirements belong in subfiles. A hub over 300 lines is almost always smuggling subfile content.

### File Trees and Code Structure in Requirements [Structural]

**Symptom:** Directory listings, class hierarchies, or implementation structure diagrams embedded in requirements.
**Fix:** These are ephemeral snapshots that become outdated and have no lasting value as requirement content. Move structural detail to specifications or design documents.

---

## Scaling and Folder Discipline

The tier choice determines file organization:

- **Small**: A single markdown file. No folder structure needed.
- **Medium**: A single markdown file with multiple clustered sections. No splitting.
- **Large**: A folder containing a hub file and numbered subfiles (e.g., `01 Sub-Domain A.md`, `02 Sub-Domain B.md`). The hub links to each subfile. Each subfile is self-contained at the medium-tier format.

**When to split a medium into a large:**
- Word count exceeds roughly 700 lines
- 4+ requirement clusters emerge, each with distinct concerns
- Different readers will navigate to different sections — the doc has become a reference index
- Subsections have grown subsections (nested complexity)

**When to collapse a large into a medium:**
- Subfiles are all short (under 100 lines each)
- Cross-references between subfiles outnumber internal references
- Readers always read the full set, never just one subfile

**Subfile rules:**
- Each subfile covers one sub-domain end-to-end: its own overview, requirements, ACs, and edge cases
- Subfiles do not duplicate the hub's context — they assume the reader arrived from the hub
- Cross-subfile dependencies are declared in the hub's Dependencies section, not scattered across subfiles
- Numbering reflects reading order, not implementation order (e.g., foundational sub-domains first)

---

## Upstream and Downstream

Requirements sit in a pipeline. Understanding their position prevents both scope confusion and orphaned artifacts.

**Upstream — what feeds into requirements:**

| Input | What it provides | How it becomes a requirement |
|-------|-----------------|------------------------------|
| Problem statement / user need | The "why" — motivation for the system | Decomposed into specific capabilities the system must have |
| Domain analysis / topology | Structure of the problem space — the bodies of information, their boundaries | Requirement clusters mirror domain structure |
| Architectural constraints | What the existing system can and cannot support | Feasibility boundaries become constraints; architectural decisions generate derived requirements |
| Stakeholder intent (WANT claims) | Desires and priorities | Refined into testable MUST/SHOULD/MAY commitments |
| Exploratory research | Options considered and rejected | Non-goals and design principles that frame the requirements |

If these upstream inputs don't exist or are weak, requirements will be unstable. You'll write requirements, then discover the problem is different than you thought, and rewrite. The cure is better upstream work — not more requirements iterations.

**Downstream — what requirements feed into:**

| Output | What requirements provide to it | Key handoff |
|--------|---------------------------------|-------------|
| Specification | Contracts to satisfy, boundaries to respect | Each spec section traces to requirement IDs |
| Architecture | Capability demands, quality constraints | Architecture must demonstrate it can satisfy all MUST requirements |
| Test plan | Acceptance criteria become test cases | Entity-prefixed ACs map directly to test function names |
| Implementation | Definition of "done" | Implementer verifies against ACs, not against informal understanding |
| Scope negotiation | Prioritized set of commitments to trade against resources | MoSCoW categories provide the negotiation vocabulary |

The critical handoff is requirements to specification. Requirements say "what must be true"; specifications say "what contracts must hold to make it true." A specification without requirements is unconstrained. Requirements without a specification leave the "how" to the implementer's judgment — which may be fine for small scope but is unreliable for medium or large scope.

---

## Requirements and the Epistemic Framework

Requirements straddle the Intent and Specification projections (see [vocabulary.md §4](../epistemic-primer.md) — Projections). They capture stakeholder intent (WANT claims) as testable commitments (MUST/SHOULD claims). This cross-projection position gives them specific properties:

- **Requirements decompose intent into testable claims.** The derivation operation is primarily **decompose** + **concretize** (see [vocabulary.md §5](../epistemic-primer.md)): breaking broad goals into specific capabilities, then making each precise enough to verify.

- **Requirements constrain specifications.** The relation type is CONSTRAINS (see [vocabulary.md §3](../epistemic-primer.md)). Specifications must satisfy requirements; they cannot violate them without the requirement being changed first.

- **High-binding requirements deserve early attention.** A requirement with high outward binding constrains many specifications and design decisions. Leaving it unsettled creates cascading uncertainty downstream. Use the binding property ([vocabulary.md §2](../epistemic-primer.md)) to identify which requirements to prioritize.

- **Inherent requirements are load-bearing.** A requirement that is inherent — true because of what the problem domain IS, not because of a choice that was made — cannot be relaxed without changing the problem. "Multi-tenant systems MUST isolate tenant data" is inherent to multi-tenancy. "Data MUST be stored in region-local datacenters" is contingent on a regulatory decision. Both are valid MUST requirements, but they differ in how permanent they are and how much scrutiny they deserve before building on them.

---

## Remember

- **Requirements live in the problem world** — they describe effects in the domain, not mechanisms in the solution
- **Every requirement needs a fit criterion** — if you can't test it, it's not a requirement
- **State the "what," not the "how"** — solutions belong in specifications
- **Capture rationale** — a requirement without "because" can't be prioritized or challenged
- **Scope boundaries prevent scope creep** — state what's out as clearly as what's in
- **Open questions are honest, not incomplete** — mark what you don't know yet
- **Requirements and architecture co-develop** — neither should be frozen before the other is understood
- **Prioritize by binding and necessity** — high-binding MUST requirements first, then everything else
- **Validate against stakeholders and against architecture** — external and internal validity are both required
- **The document lives during development** — update it when understanding changes
- **The overview describes the domain, never the document** — 2-5 sentences of prose naming a core insight
- **Entity-prefix all acceptance criteria** — domain-derived codes map directly to test function names
- **Status belongs in a dedicated section at the bottom** — never inline with requirements or ACs
- **The hub file is context and navigation only** — detailed content belongs in subfiles
