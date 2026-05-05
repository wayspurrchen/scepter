# Architecture Document Guide

## Before You Draft (READ FIRST)

An architectural claim asserts something structural about the system: a boundary, a responsibility, an invariant that holds across the whole, a constraint on how parts interact. Three rules are absolute. **Apply them prospectively to every numbered claim as you write it, not retrospectively when you review.**

1. **Modal character — architecture leans toward Invariant and Constraint.** Most architectural claims are of the form "P must always hold across all instances of X" (Invariant) or "modules of class Y must NOT do Z" (Constraint). Existence claims appear ("a router component must exist between A and B") and Integration claims sometimes ("layer N must call layer N+1 only via interface I"). Behavior, Ordering apply less. The non-claim patterns rejected by `claims.md` § Authoring Litmus apply with full force here: "MUST distinguish boundary A from boundary B," "MUST be modular," "MUST be applied during reviews," and authorial framings about what the document does or doesn't cover are NOT claims.

2. **Inspection-verifiability litmus.** Architectural claims are typically verified by structural inspection (a layer-violation lint, a module-boundary check, a manual code review against the invariant), not by black-box test. The litmus: *given this claim, can a reader determine whether a specific code change violates it without running the system?* If yes, it's an architectural claim. If determining violation requires runtime behavior, the claim is behavioral and may belong in a spec instead.

3. **Layer.** Architecture sits above specification — it describes the structural rules every spec and implementation must honor. Architectural claims do NOT specify interfaces, type signatures, or behavioral contracts at the AC grain — those are spec content. They DO specify that boundaries exist, what is on each side, what may cross, and what may not. If a claim names a specific function signature or response shape, it has crossed into specification.

**The "this is not Y" antipattern is especially common in architecture docs.** Architecture documents frequently include "Distinction from" or "Not in scope" sections describing what the architecture is NOT. These are authorial framing — they belong in the Overview or a Scope Boundary section, not as numbered MUST claims. "The system MUST distinguish authentication from authorization" is not an architectural claim; "Authorization decisions MUST consult AuthN-resolved identity, never raw request headers" is.

**Brief-vs-guide rule.** If a dispatch brief specifies a section template that would force you to author non-claim content as a numbered MUST, the brief is wrong about claim grain. The guide is authoritative. Stop, surface the conflict to the orchestrator, and resolve before authoring.

---

An architecture document is the **architecture projection** of a system or subsystem — the layer of understanding that perceives boundaries, responsibilities, flows, and constraints. It answers: what are the parts, what does each part own, how do they interact, and what rules govern the whole. Architecture exists whether you document it or not. Every system has structure, boundaries, and implicit rules. The problem is not creating architecture — it is perceiving and articulating the architecture that already exists (or is emerging), so that contributors share a single structural mental model rather than each holding a private, partially wrong one. Without explicit architecture documentation, every contributor reverse-engineers their own model from the code, and those models diverge at exactly the boundaries and invariants that matter most.

**Relationship to architectural analysis**: The [architectural-analysis](../../architectural-analysis/SKILL.md) skill helps you *decide* what the architecture should be — it maps decision spaces, evaluates trade-offs, assesses risk. This guide helps you *write it down* once you have that understanding. If you're still choosing between architectural approaches, use architectural analysis. If you've reached understanding and need to communicate it, use this guide.

**Methodological Lineage**:

| Methodology | Contribution | Context |
|-------------|--------------|---------|
| ISO/IEC/IEEE 42010 | Stakeholder-driven view selection; architecture descriptions as first-class artifacts | International standard for architecture descriptions |
| Kruchten 4+1 View Model | Systematic coverage through multiple concurrent views; scenario-driven validation | IEEE Software, 1995 |
| Simon Brown / C4 Model | Progressive zoom (context → container → component → code); pragmatic diagramming | Practitioner-driven, widely adopted since ~2011 |
| arc42 | Section ordering optimized for reading; "everything is optional" pragmatism | Pragmatic template by Starke & Hruschka |
| SEI Views and Beyond | View selection method; "beyond" information that ties views together | Carnegie Mellon SEI documentation approach |
| George Fairbanks | Risk-driven scoping — document proportional to risk, not completeness | *Just Enough Software Architecture*, 2010 |
| Michael Nygard / ADRs | Lightweight decision capture; decisions as first-class architectural artifacts | Cognitect blog, 2011 |
| DO-178C / IEC 62304 | Traceability from requirements through architecture to design; verification at each layer | Safety-critical aviation and medical device standards |

---

## When to Produce One

**Trigger conditions:**
- A system or subsystem has enough structure that contributors need a shared mental model to work effectively
- Multiple people (or an AI agent) will make design decisions that must respect the same boundaries and rules
- The architecture has been decided (via analysis, exploration, or emergence) and needs to be captured
- Existing architecture documentation has drifted from reality and needs to be re-derived
- A new domain or subsystem is being added and needs its structural context established
- The user asks for an "architecture document," "system overview," "component map," or "architectural description"

**Not for:**
- Decisions that haven't been made yet (use architectural analysis to decide, then this process to document)
- Implementation-level plans with file paths and function signatures (use the [detailed design process](detailed-design.md))
- Formal contracts with requirement IDs and acceptance criteria (use the specification process)
- Exploratory prototyping where the architecture is expected to change daily
- Single-component internals with no boundary or interaction concerns

---

## What It Contains

Architecture documents fall into four categories, each answering different questions:

- **System architecture** — lays out layers, components, responsibilities, and interaction rules for a full system. Answers: what are the major parts, what does each own, how do they talk? Example content: API layer stack, pipeline stages.
- **Feature architecture** — describes how a specific subsystem works within the larger system. Answers: how does this subsystem slot into the whole, and how does it handle the cases it exists to handle? Example content: caching strategy, capability model.
- **Philosophical/foundational** — establishes shared values, vocabulary, and evaluation frameworks for an entire project. Answers: what are we optimizing for, and how do we evaluate proposed changes? Example content: design principles, evaluation checklists.
- **Empirical/reference** — presents benchmarks, performance data, and evidence-based guidance. Answers: given the measurements, which approach should we use for which access pattern? Example content: storage mode comparison, query performance.

If a document has requirement codes, component interfaces, and execution sequences, it has crossed into specification territory and should be classified accordingly.

---

## Structure

### Structural Spine (All Categories)

Every architecture document should be readable at three depths:

1. **30-second scan**: Title + primary diagram + key distinction table (first 50 lines)
2. **5-minute read**: All section headings + design decisions + summary tables
3. **Full read**: Everything, including code examples, stress tests, and prior art

### Required Sections

```
# [Title]

## Overview
[Primary ASCII diagram, <30 lines. Communicates the mental model.]
[1-2 paragraphs: what this is, why it exists, core insight.]

## [Content sections — vary by category, see below]

## Design Decisions
### Adopted: [Decision Name]
[One-line description of what was chosen]
**Alternatives considered:**
- [Alternative 1] — [One-line reason for rejection]
- [Alternative 2] — [One-line reason for rejection]

## Open Questions
- [Question text] (dated YYYY-MM-DD, or link to decision/question note)

## References
```

### Design Decisions Are Mandatory

Every architecture document must surface what was decided, what was rejected, and why. This prevents future contributors from re-proposing discarded alternatives.

---

### System Architecture Documents

Defines layers or components, assigns responsibilities, shows interactions.

**Section Order:**

```
## Overview
[ASCII layer/component diagram]
[1-2 paragraphs of context]

## [Layer/Component] Responsibilities
### [Component Name]
**Purpose:** [One sentence]
**Characteristics:**
- [Bullet list of defining traits]
**When to use:**
- [Concrete guidance for choosing this layer/component]
**Example:**
[Code showing the expected API surface]

[Repeat for each layer/component]

## Design Principles
[Bold constraints with check/cross examples — see Invariant Expression below]

## Naming Conventions
[Reference table if applicable]

## Summary Tables
[Quick-reference tables for scanning]

## Design Decisions
## Open Questions
## References
```

The repeating Purpose/Characteristics/When-to-use/Example structure per component creates a scannable rhythm. "When to use" is the most valuable subsection — it translates abstract responsibilities into concrete decision guidance.

### Invariant Expression

Use different formats based on the invariant's character:

**Behavioral rules** — check/cross patterns for binary visual comparison:

```
✓ node.getFields() — scoped traversal via relationship
✓ node.addField(defId, value) — modifies own relationships
✗ node.findRelated(criteria) — use services for filtered queries
✗ node.queryGraph(cypher) — engines only
```

**Complex conditional rules** — executable pseudocode:

```typescript
function canAccessPath(userId, pluginId, path): boolean {
  if (!userHasGrant(userId, path)) return false;
  if (!policyAllows(pluginId, path)) return false;
  if (!userGrantedAccess(userId, pluginId, path)) return false;
  if (globalDenyExists(path)) return false;
  return true;
}
```

**Judgment-based constraints** — bold constraint + rationale:

```
**Schema Isolation:** Plugins create their own schemas.
Never pollute user schemas with plugin types. Rationale: data sovereignty
requires that user data boundaries are never crossed by plugin logic.
```

---

### Feature Architecture Documents

Defines how a specific subsystem works within the larger architecture.

**Section Order:**

```
## Overview
[Stack/flow diagram showing where this subsystem sits]
[Key distinction table — forces precision, eliminates ambiguity]

| Concern | Model | Example |
|---------|-------|---------|
| ... | ... | ... |

## Core Concepts
[Concept definitions with distinguishing characteristics]

## Interface Definitions
[Contracts for the subsystem]

## Stress Testing Against Use Cases
### [Scenario Name]
**Data Flow:** [How data moves through the subsystem]
**Behavior:** [How the subsystem's mechanisms manifest]
**Verdict:** [Does the architecture hold?]

## Design Decisions
## Prior Art (optional)
### [System Name]
| Aspect | Approach |
|--------|----------|
| ... | ... |
**Key insight:** [What we borrowed and why]

### Common Patterns Across Systems
1. [Synthesized principle from the survey]

## Open Questions
## References
```

### Concept-Distinguishing Tables

The single most effective format in architecture documents. They force precision — you cannot hide ambiguity in a small table. The concrete examples column prevents abstract hand-waving. Use them whenever two concepts could be confused.

### Stress Testing

Apply the architecture against concrete scenarios. Each scenario shows data flow and behavior, exposing whether the architecture handles the case cleanly or requires workarounds. This provides *evidence* that the architecture works rather than just asserting it.

---

### Philosophical / Foundational Documents

Rare. These establish shared values, vocabulary, and evaluation frameworks for an entire project.

**Section Order:**

```
## Overview
[What this framework does for you — lead with utility]

## Core Concepts
[Named principles with memorable subtitles as mnemonic anchors]
[Blockquote sourcing gives principles provenance and weight]

### [Principle Name]: "[Memorable Subtitle]"
> "[Primary source quote grounding the principle]"
[1-2 sentences explaining the design constraint this creates]

## Evaluation Framework
[Tables with questions — actionable checklists for feature evaluation]

| Principle | Question |
|-----------|----------|
| ... | Does this violate...? Can users still...? |

## Application Examples
[How to use the framework on a concrete feature]

## Design Decisions
## References
```

The named-principles approach creates shared vocabulary that functions as mnemonic anchors across the project. This is appropriate for foundational documents establishing project-wide values — not a default section for every architecture document.

The evaluation framework is the operationally useful content. Place it early.

---

### Empirical / Reference Documents

Data-driven format for benchmarks, performance analysis, and evidence-based guidance.

**Section Order:**

```
## Overview
[What was measured and why, in 2-3 sentences]

## Methodology
[Environment, conditions, caveats]

## Results
### [Condition Set Name]
| Operation | Mode A | Mode B | Winner |
|-----------|--------|--------|--------|
| ... | ... | ... | ... |

## Key Findings
1. [Finding with explanatory prose]

## Implications
[Translate raw data into design guidance]

| Access Pattern | Recommended Approach | Reason |
|---------------|---------------------|--------|
| ... | ... | ... |

## Deliverables
[File paths for benchmark code, data artifacts]

## References
```

The "Implications" section is the most important — it translates numbers into decisions. The summary guidance table should distill the entire document into actionable recommendations.

---

## How to Produce

### Step 0: Determine Category and Scope

Before writing anything, identify which of the four categories this is (see *What It Contains* above). The category determines which sections to emphasize and what level of decomposition is appropriate.

**Category identification heuristics:**

| If the subject is... | Category is likely... |
|----------------------|-----------------------|
| A full system with multiple components/layers | System architecture |
| A specific subsystem within a known larger system | Feature architecture |
| A set of design values or evaluation criteria | Philosophical/foundational |
| Performance data or comparison evidence | Empirical/reference |

Also determine scope boundaries. An architecture document that tries to cover everything covers nothing well. Scope the document to a coherent unit — a system, a subsystem, a cross-cutting concern — where the boundaries, responsibilities, and rules form a self-contained story. If you find yourself describing two unrelated subsystems, write two documents.

**Risk-driven scoping** (Fairbanks): Document depth should be proportional to risk. High-risk areas (novel technology, complex integration, unclear boundaries) deserve deep treatment. Low-risk areas (well-understood patterns, stable libraries) can be described briefly or by reference. Ask: "If a contributor misunderstands this area, what breaks?" The answer determines how much attention that area gets.

### Step 1: Identify the Audience and Their Questions

Architecture documents serve different readers with different needs. Before writing, identify who will read this and what questions they bring.

Common audiences and their questions:

| Audience | Primary Questions |
|----------|------------------|
| New contributors | What are the parts? What is each part for? Where do I put new code? |
| Feature developers | What can I depend on? What boundaries must I respect? What's off-limits? |
| Reviewers | Does this change violate any invariants? Is the responsibility in the right layer? |
| Future architects | Why was it built this way? What alternatives were rejected? What forces shaped this? |

ISO 42010 calls these **concerns** — the questions that stakeholders bring to the architecture. The document must answer them, and the audience determines emphasis: contributor-facing documents emphasize responsibilities and "when to use" guidance; reviewer-facing documents emphasize invariants and boundary rules; future-facing documents emphasize decisions and rationale.

### Step 2: Perceive the Actual Structure

Read the code (or design artifacts, if the system doesn't exist yet). Do not work from memory, descriptions, or assumptions. The architecture document must describe what IS, not what was intended or what someone remembers.

**Do not accept characterizations.** Read the actual code, actual configs, actual deployment artifacts. The gap between how a system is described and what the code actually shows is exactly where architectural documentation goes wrong. This follows the same verification discipline described in the [detailed design process](detailed-design.md) §Step 2.

For each area within scope, identify:
- **Components/layers**: What are the distinct units with their own responsibilities?
- **Boundaries**: Where does one component end and another begin? What crosses the boundary?
- **Flows**: How does data/control move through the system? What are the primary paths?
- **Rules**: What is always true? What is never allowed? What is the consequence of violation?
- **Tensions**: Where does the current structure fight itself? Where do abstractions leak?

**Epistemic grounding**: This step is primarily IS-claim generation (see [vocabulary.md](../epistemic-primer.md) §1). You are observing and recording what exists. Resist the urge to prescribe at this stage — if you see something that should change, note it separately. Mixing IS and SHOULD in the perception phase produces documents that describe neither reality nor intent accurately.

Use claim properties to assess what you're seeing:
- **Settledness**: Is this structure crystallized or still nucleating? Architecture documents should primarily capture crystallized structure. Nucleating areas get flagged as "evolving" rather than presented as settled.
- **Inherence**: Is this boundary inherent (forced by the problem domain) or contingent (a design choice)? This distinction matters enormously for the invariants section.
- **Binding**: Which structural decisions constrain the most downstream work? These are your architectural load-bearing elements — they need the most careful description.
- **Velocity**: Which parts are changing rapidly? High-velocity areas need looser descriptions that won't become stale within a sprint. Low-velocity areas can be described precisely.

### Step 3: Construct the Overview Diagram

The overview diagram is the single most important element of an architecture document. It is the mental model in visual form — the picture a contributor holds in their head while working. Every architecture document needs one, and it should appear in the first 30 lines.

**What to include:**
- Every major component or layer within scope
- The primary interaction paths between them (calls, data flow, events)
- The system boundary — what is inside the architecture and what is external
- Layer ordering or containment relationships, if they exist
- Labels that match the vocabulary used throughout the document

**What to exclude:**
- Implementation details (database table names, class hierarchies, file paths)
- Error handling paths (unless error handling IS the architecture)
- Every possible interaction (show primary paths; note secondary paths in prose)
- Decorative elements that consume space without carrying information

**Construction heuristics:**
- Start by listing the components. If you have more than 7-9 at the top level, you need an intermediate grouping — the diagram won't be parseable.
- Use ASCII diagrams. They live in the document, render everywhere, and are trivially editable. They also impose a healthy constraint on complexity — if you can't draw it in ASCII, it's probably too complex for an overview.
- Test the diagram by asking: "If I showed only this diagram and its labels to a new contributor, could they correctly answer 'where does X belong?'" If not, the diagram is missing a boundary or a label.
- The C4 model's progressive zoom is useful: Context (system in its environment) → Container (major runtime units) → Component (internal structure). Most architecture documents need one or two of these levels, not all four.

### Step 4: Define Responsibilities and Boundaries

For each component or layer identified in Step 2, articulate:

1. **Purpose** — one sentence stating what this component is for
2. **Owns** — what concerns, data, or operations belong to this component exclusively
3. **Does not own** — what commonly confused responsibilities belong elsewhere (this is often more valuable than the positive statement)
4. **Depends on** — what other components this one uses
5. **Depended on by** — what components use this one
6. **When to use** — concrete guidance for a developer deciding whether new code belongs here

The "when to use" guidance is the operationally most valuable content. Abstract responsibility descriptions ("manages data access") are hard to apply in the moment. Concrete guidance ("if you're writing a query that joins across entity types, it belongs in the service layer, not the engine") drives correct placement decisions.

Use the repeating structure from the format template (Purpose / Characteristics / When to use / Example) to create a scannable rhythm. Readers learn the pattern after one section and can then skim subsequent sections efficiently.

### Step 5: Extract and Express Invariants

Invariants are the rules that are always true in the architecture. They are the most load-bearing content in the document — everything else can be reconstructed from the code, but invariants are often invisible in code because they are expressed through absence (things that never happen) rather than presence (things that do happen).

**How to identify invariants:**

1. **From decisions**: Every architectural decision implies at least one invariant. "We use a four-layer API stack" implies "no layer may be skipped." Ask: "What would violate this decision?"
2. **From constraints**: External constraints (frameworks, protocols, regulations) impose invariants. "We use framework X" often implies "all data access goes through X's API."
3. **From patterns of avoidance**: If contributors consistently avoid doing something, there may be an implicit invariant. Surface it and make it explicit.
4. **From bugs**: Past bugs often reveal violated invariants that were never documented. "We had a bug where component A directly accessed component B's data" reveals the invariant "A must access B's data through B's interface."
5. **From inherent properties**: Some invariants arise from what the thing IS, not from decisions. These are the most stable invariants — they can't change without changing the system's fundamental nature. See [vocabulary.md](../epistemic-primer.md) §2, Inherence.

**How to express invariants** — match the format to the invariant's character:
- Binary behavioral rules → check/cross patterns (see *Invariant Expression* above)
- Conditional rules → executable pseudocode
- Judgment-based constraints → bold constraint + rationale
- Cross-cutting rules → table with scope and applicability

Every invariant should answer: "What breaks if this is violated?" If you can't articulate the consequence, the invariant may not be real — or you don't yet understand why it exists.

**Distinguishing invariants from conventions**: An invariant is violated when the system produces incorrect results, data corruption, security failures, or unrecoverable state. A convention is violated when the code is harder to read, maintain, or extend — but still works. Both are worth documenting, but only invariants belong in the architecture's invariant section. Conventions belong in coding guidelines or the "when to use" guidance for each component.

### Step 6: Surface and Document Design Decisions

Architecture documents must capture what was decided, what was rejected, and why. This prevents future contributors from re-proposing discarded alternatives and provides rationale for constraints that may otherwise appear arbitrary.

**Mining implicit decisions:**

Most architectural decisions were never explicitly made — they emerged from convention, precedent, or a conversation that was never recorded. To surface them:

1. **Look for structural patterns**: Why is the code organized this way rather than another way? The organization itself is a decision.
2. **Look for absent alternatives**: If a common approach (e.g., direct database access from handlers) is never used, someone decided against it. Find out why.
3. **Ask "why not"**: For each boundary or rule, ask what would happen if it didn't exist. The answer reveals the decision's rationale.
4. **Check for rejected PRs or reverted commits**: These are explicit evidence of alternatives that were tried and discarded.

**Recording decisions:**

Use the Adopted / Alternatives Considered format from the required sections above. Each decision needs:
- What was chosen (one line)
- What alternatives were considered (one line each, with reason for rejection)
- The forces that drove the choice (constraints, goals, trade-offs)

For systems with many decisions, separate out frequently-referenced ones as standalone ADRs (Nygard format: Context, Decision, Consequences) and link them from the architecture document. The architecture document should always contain a summary of key decisions inline, even if full ADRs exist elsewhere.

### Step 7: Stress-Test Against Scenarios

Apply the architecture against concrete scenarios to verify it handles real cases. This follows the feature architecture format's Stress Testing section but applies at whatever level the document covers.

For each scenario:
1. **Describe the scenario** concretely (not abstractly)
2. **Trace the path** through the architecture — which components are involved, in what order, through which boundaries
3. **Identify friction points** where the architecture's rules make the scenario harder
4. **Assess the verdict** — does the architecture handle this cleanly, with acceptable friction, or does it break?

Scenario selection heuristics:
- Include at least one **happy path** (the most common usage pattern)
- Include at least one **boundary case** (something that sits at the edge of two components' responsibilities)
- Include at least one **cross-cutting case** (something that touches multiple layers or components)
- If the system has known pain points, include a scenario that exercises each one

Scenarios that produce a "breaks" verdict are not failures of the documentation process — they are discoveries. Either the architecture needs adjustment (go back to architectural analysis) or the scenario is out of scope (document that explicitly).

**Stress testing is the architecture document's verification discipline.** It is the equivalent of the detailed design's verification points (see [detailed design process](detailed-design.md) §Integration Sequence) — concrete evidence that the architecture handles its intended cases rather than just asserting that it does. An architecture document without stress-tested scenarios is an architecture document that hasn't been verified.

### Step 8: Determine Decomposition Depth

Not every component deserves the same depth of description. Determine how far to decompose by assessing:

- **Risk**: High-risk components (novel, complex, frequently misunderstood) need deeper treatment
- **Binding**: High-binding components (many things depend on them) need precise description
- **Audience need**: If your audience includes contributors who will work inside a component, decompose it; if they only interact with it through its interface, describe the interface
- **Stability**: Volatile components should be described at a coarser grain — detailed descriptions of rapidly changing internals become stale immediately

The right depth is where a contributor can answer their structural questions without needing to read the code. Too shallow: they still have to guess where things belong. Too deep: you're writing implementation documentation, not architecture.

Arc42's principle applies: every section is optional, and decomposition depth should match actual need, not a completeness checklist.

### Step 9: Validate the Document

Before the document is complete, validate it against three criteria:

**1. Coherence with adjacent projections:**
Does the architecture document cohere with existing requirements, specifications, and implementation? See [operations.md](../epistemic-primer.md) §Cross-Projection Coherence Checks. Specifically:
- Every architectural responsibility should trace to an intent or requirement
- Every interface in existing specs should trace to an architectural component
- The implementation should conform to the boundaries and rules described

**2. Internal consistency:**
- Do the diagram and the prose agree? (A component in the diagram that isn't described in text, or vice versa, is a defect.)
- Do the invariants and the responsibilities agree? (An invariant that contradicts a stated responsibility reveals a misunderstanding.)
- Do the design decisions and the invariants agree? (Every decision should support the invariants, and every invariant should be traceable to a decision or inherent property.)

**3. Completeness relative to scope:**
- Every component within scope has at least Purpose and When-to-use
- Every significant boundary has rules governing what crosses it
- Every architectural decision within scope is documented with rationale
- Open questions are listed explicitly rather than left as silent gaps

---

## Anti-Patterns

### The Aspirational Architecture [Process]
Describing the system as you wish it were, rather than as it is. Architecture documents that describe a target state without acknowledging the current state mislead contributors into building against a model that doesn't match reality. If the document describes a future state, label it explicitly and maintain a separate description of the current state.

### The Implementation Mirror [Process]
Restating the code's structure in prose without adding architectural insight. If the document says "the `UserService` class handles user operations" and that's all, it has added nothing the code didn't already say. Architecture documents earn their existence by articulating things invisible in the code: boundaries, invariants, rationale, responsibilities that span multiple files.

### The Exhaustive Catalog [Both]
Documenting every component, every interaction, and every edge case at uniform depth. This produces documents no one reads. Use risk-driven scoping — deep where it matters, brief where it's obvious, absent where it's irrelevant.

### The Decision-Free Architecture [Structural]
Describing structure without ever stating what was decided or why. These documents answer "what" but not "why," leaving future contributors unable to distinguish intentional constraints from accidental ones. Every architecture has decisions; if the document doesn't surface them, it is incomplete.

### The Orphan Diagram [Structural]
An overview diagram that isn't referenced by or connected to the prose. The diagram and the text must describe the same system using the same vocabulary. If the diagram says "Engine Layer" and the text says "Data Access Layer," the document is incoherent.

### Invariant Inflation [Structural]
Listing dozens of "invariants" that are actually conventions, preferences, or guidelines. True invariants are few and load-bearing — violation causes failure, not just style inconsistency. Diluting invariants with preferences trains readers to ignore all of them.

### The Frozen Document [Process]
Treating the architecture document as a one-time deliverable rather than a living artifact. Architecture documents must be updated when the architecture changes. A stale architecture document is worse than no document — it actively misleads. Include a date and plan for review.

### Cognitive Mode Mismatch [Process]
Writing an architecture document while thinking mechanically (implementation mode) rather than topologically (architecture mode). The symptom: the document is full of algorithms, data structures, and control flow but never says which component is responsible for what or where the boundaries are. The architecture projection requires thinking in terms of responsibilities, boundaries, and flows — not mechanisms. See [vocabulary.md](../epistemic-primer.md) §4 for the cognitive modes associated with each projection.

---

## Scaling and Folder Discipline

Prefer single-file architecture documents. Decompose only when a section exceeds ~300 lines AND serves a distinct audience from the main document.

**Good decomposition:** Main document + 1-3 specific subfiles for code examples, data tables, or prior art surveys. The main document is fully readable without the subfiles.

**Excessive decomposition:** Main document + many sub-documents. Creates navigation overhead and maintenance burden. Cross-cutting changes require editing multiple files.

Sub-documents should have:
- A one-line parent reference at the top
- No independent metadata (they are not separate knowledge graph entities)
- A clear purpose distinct from the main document

### Relationship to Adjacent Processes

**Upstream — Requirements and Problem Domain:** Architecture is constrained by requirements (what the system must do) and shaped by the problem domain (what the system is about). The architecture document should reference these constraints but not duplicate them. When requirements change, architecture documents become potentially stale — use the propagation rules in [operations.md](../epistemic-primer.md) to assess impact.

The flow: Intent/Requirements → **Architecture** → Specification → Detailed Design → Implementation

**Downstream — Specification and Detailed Design:** Architecture provides the structural context that specifications and detailed designs build within. A specification defines contracts for a component that the architecture document assigned responsibility to. A detailed design plans the implementation of a feature within the boundaries the architecture established.

When writing specifications, the architecture document answers: "Which component owns this? What are its boundaries? What invariants must the spec respect?" When writing detailed designs, it answers: "What layers does data flow through? What wiring patterns does this system use? What dependencies are allowed?"

**Peer — Other Architecture Documents:** Architecture documents at different scopes (system-level, subsystem-level) must cohere. A subsystem architecture cannot violate the system architecture's invariants. When creating a new architecture document, check whether a parent-scope or sibling-scope document already exists that constrains the new document's design space.

**Relationship to ADRs:** Architecture Decision Records (ADRs) and architecture documents are complementary, not redundant. ADRs capture individual decisions with their context, alternatives, and consequences — they are the journal of architectural reasoning. The architecture document synthesizes the results of those decisions into a coherent structural picture. The architecture document's Design Decisions section should reference ADRs where they exist, summarizing the conclusion inline and linking to the ADR for full rationale. If no separate ADR practice exists, the architecture document's Design Decisions section serves both purposes.

### Maintaining Architecture Documents

Architecture documents are living artifacts. Their value degrades proportionally to their staleness.

**When to update:**
- When a component is added, removed, or has its responsibilities changed
- When an invariant is discovered to be violated (either fix the code or update the invariant)
- When a design decision is revisited and changed
- When stress testing against a new scenario reveals the architecture doesn't handle it

**Staleness signals:**
- The overview diagram doesn't match the actual component structure
- Code review discussions reference rules that aren't in the architecture document
- New contributors report that the architecture document didn't help them understand the system
- The document's vocabulary doesn't match the vocabulary used in code and conversations

**Lightweight maintenance**: Not every update requires a full re-derivation. Small changes (adding a new component to the diagram, adding a new invariant discovered during development) can be made incrementally. Full re-derivation is needed when the architecture has shifted enough that the document's overall narrative no longer holds.

---

## Remember

- **Perceive before prescribing** — describe what IS before stating what SHOULD be
- **The diagram is the document** — if the overview diagram is wrong, nothing else matters
- **Invariants over descriptions** — what is always true is more valuable than what usually happens
- **Decisions must include rejections** — alternatives considered and reasons for rejection prevent re-litigation
- **Risk drives depth** — document proportionally to what breaks if misunderstood
- **Test against scenarios** — architecture that hasn't been stress-tested is architecture that hasn't been verified
- **The document lives** — a stale architecture document is worse than none at all
