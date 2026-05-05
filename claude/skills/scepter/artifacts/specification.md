# Specification Document Guide

## Before You Draft (READ FIRST)

A specification claim is a behavioral contract — what the system promises at its observable boundary, expressed precisely enough to be verified without specifying internal mechanism. Three rules are absolute. **Apply them prospectively to every numbered claim as you write it, not retrospectively when you review.**

1. **Black-box litmus.** Can a tester verify this contract holds at the machine boundary, without knowing the internal mechanism? If yes, it's a spec claim. If verification requires inspecting specific data structures, library calls, or algorithm choices, the claim has crossed into implementation territory — relocate to a DD.

2. **Modal character.** Every numbered claim asserts existence, behavior, integration, constraint, ordering, or invariant. Specs lean heavily on **Behavior** ("X must do Y when Z"), **Constraint** ("X must NOT do Y"), **Ordering** ("X before Y"), and **Invariant** ("P must always hold"). The same non-claim patterns rejected by `claims.md` § Authoring Litmus apply here: "MUST distinguish concept A from concept B," "MUST handle X gracefully," "MUST be possible during {workflow context}," and authorial scope statements are NOT claims.

3. **Layer.** Specs sit between requirements and implementation. They describe **what** is contractually true at the boundary, not **how** it is internally achieved. Specifying "rate limiting MUST reject the 11th request in a 1-second window" is a spec claim. Specifying "the rate limiter MUST use a token-bucket algorithm with bucket size 10" is a DD claim — the algorithm choice is mechanism, not contract. Type interfaces and data shapes that define the contract surface are appropriate; full method bodies and library-specific call sequences are not.

**Brief-vs-guide rule.** If a dispatch brief specifies a section template that would force you to author non-claim content as a numbered MUST (e.g., a "Distinction from {adjacent specs}" section as numbered ACs, an option-enumeration section as ACs, a workflow-list section as ACs), the brief is wrong about claim grain. The guide is authoritative. Stop, surface the conflict to the orchestrator, and resolve before authoring — do not silently render structure into invalid claims to satisfy the brief.

---

A specification is the **behavioral contract** — the projection between requirements and detailed design that defines what a system does, what it guarantees, what data it operates on, and what it explicitly does not do. It answers the contractual questions: given these inputs and this state, what outputs and state transitions are promised? Requirements state intent (the system SHOULD do X). Code implements mechanisms (function f calls g with argument h). Between them is a translation gap where behavioral ambiguity lives. Requirements are deliberately abstract — they describe the "what and why" without committing to precise interfaces, state transitions, or data shapes. Code is maximally concrete but reveals nothing about what it promises versus what it happens to do. The specification closes this gap by expressing intent as testable contracts before any code is written. It takes requirements as upstream input and feeds the detailed design downstream.

**Methodological Lineage**:

| Methodology | Contribution to This Process | Context |
|-------------|------------------------------|---------|
| Cleanroom Software Engineering (Mills/Linger) | **Box structure refinement** | Black box (behavior) → State box (data) → Clear box (procedure). The specification is the black box — what is observed from outside. |
| IEEE 830 / ISO/IEC/IEEE 29148 | **Requirement quality characteristics** | Each requirement: unambiguous, complete, consistent, uniquely identified, traceable, testable. Applies to spec requirements equally. |
| Formal Methods (Z, VDM, B-Method) | **Informal-to-formal refinement** | The process of moving from natural-language requirements to precise pre/postcondition contracts through progressive formalization. |
| Michael Jackson (Problem Frames) | **Problem decomposition** | Requirements exist in the problem domain; specifications exist at the machine interface. Deriving specs means identifying where the machine boundary intersects each requirement. |
| Robertson & Robertson (Volere) | **Fit criteria** | Every requirement needs a measurable criterion that determines whether a solution satisfies it. The acceptance criteria mapping inherits this discipline. |
| Karl Wiegers (Software Requirements) | **Incremental specification** | Requirements elicitation, analysis, specification, and validation proceed iteratively, not sequentially. Discovery during specification feeds back to requirements. |
| DO-178C (aviation) | **Bidirectional traceability** | Every high-level requirement traces to a specification element; every specification element traces back to a requirement. Nothing unaccounted. |
| IEC 62304 (medical devices) | **Risk-driven specification depth** | Higher-risk elements demand more rigorous specification. Not everything needs a state machine — but safety-critical behavior does. |

What they all share: **you don't write specifications by listing features.** You write specifications by deriving precise behavioral contracts from requirements, identifying the data those contracts operate on, enumerating the states the system can occupy, and defining what constitutes correct behavior at every boundary.

**Relationship to other skills**:

- **Epistemic analysis** (`../`) provides the shared vocabulary this process operates with. Specification is the contractual projection (see `../epistemic-primer.md` §4) — the expression of understanding in terms of interfaces, invariants, acceptance criteria, and preconditions. The process uses **concretize** to move from architectural responsibilities to interface contracts, and **elaborate** to add precision to rough claims (see `../epistemic-primer.md` §5).
- **Requirements** (`requirements.md`) are the upstream input. Requirements express intent and need; specifications express contracts and guarantees. A specification without requirements is ungrounded. Requirements without a specification leave behavioral interpretation to the implementer.
- **Detailed design** (`detailed-design.md`) is the downstream consumer. The detailed design takes specification contracts as settled inputs and plans their realization in modules, wiring, and integration sequences. If you're still deciding what the system promises, you're in specification territory. If you've decided and need to plan how modules deliver those promises, you're in detailed design territory.

---

## When to Produce One

**Produce when:**
- Requirements exist (with identified needs, acceptance criteria, design principles) and the system's behavioral contracts need to be made precise before implementation
- The feature has behavioral complexity: multiple states, conditional logic, combinatorial interactions, or non-obvious edge cases
- Multiple implementers (human or LLM) will work from the same behavioral description and need an unambiguous shared reference
- Prior implementations diverged because behavioral expectations were left implicit in requirements
- The user asks for a "specification," "behavioral contract," "interface definition," or "what exactly should this do?"

**Skip when:**
- Requirements are still being discovered (finish requirements first, or use exploration to gather context)
- Single-behavior features where the requirement IS the specification (e.g., "the button MUST be blue" — there's nothing to derive)
- Architecture decisions haven't been made yet (use architectural analysis to settle the structure first)
- You're doing implementation planning (that's detailed design — the spec defines contracts, not modules)

**Depth calibration** (from IEC 62304's risk-driven approach): Not every feature needs the same specification depth. A feature with complex state transitions, concurrent access patterns, or data integrity implications needs full state machines, truth tables, and systematic edge case analysis. A feature that is essentially a CRUD operation with straightforward validation needs keyword statements and a data model. Match the specification investment to the behavioral complexity and the cost of getting it wrong.

---

## What It Contains

A specification answers: what does this system do, what data does it operate on, what does it produce, what does it guarantee, and what does it explicitly not do?

Conceptually, a spec opens with an **Overview** that states purpose, scope, and non-goals. It follows with an **At a Glance** section — a pipeline diagram and one complete worked example that grounds the reader in the system's end-to-end behavior. **Prior Art and Design Rationale** situates the chosen approach in the solution space, referencing alternatives and their known failure modes. **Terminology** disambiguates domain-specific meanings. **State Machines** (where applicable) define lifecycle states and transitions. **Data Model** defines the persistent and transient types with field-level semantics. **Behavioral Requirements** specify what the system promises, using formats chosen per behavior — state machines for lifecycle, truth tables for combinatorial interactions, algorithms for procedures, scenarios for APIs, keyword statements for policy. **Edge Cases** enumerate boundary and failure conditions. **Error Conditions** consolidate error taxonomy. **Complete Worked Examples** show full end-to-end transformations for each major mode. **Acceptance Criteria Mapping** provides bidirectional traceability. **Design Decisions** document what was chosen and what was rejected. Optional **Implementation Notes** capture phase scope and known risks.

Each section builds on the previous so that a reader can stop at any depth and have useful understanding.

---

## Structure

### Spec vs Detailed Design Boundary

A specification defines *contracts*. A detailed design fills in *module connections*.

**Belongs in a specification:**
- Behavioral requirements (algorithms, state machines, scenarios)
- Data model interfaces with field semantics
- Output shapes, error codes, return types
- Invariants and acceptance criteria
- Scope boundaries and non-goals

**Does NOT belong in a specification:**
- Module layout (directory trees, file names)
- Implementation code (function bodies, class implementations)
- Wiring (what imports what, what wraps what, provider nesting)
- Build order (which file to create first, verification at each step)

**The practical test:** If you could implement the same spec with a completely different module structure (different file names, different class hierarchy, different wiring) and still satisfy all the requirements, then the module structure was detailed design content, not specification content.

### Code in Specifications

Specifications often need to express contracts in a programming language — type definitions, validation rules, behavioral algorithms. The question is how much code is spec content vs detailed design content. The boundary:

**Spec-appropriate code — shapes and contracts:**

| Content | Why it's spec | Example |
|---------|--------------|---------|
| Type/interface definitions (fields, types, nullability) | The shape IS the contract | `struct CanonicalKey(String)` with field docs |
| Enum variants with semantic definitions | The value set IS the behavioral space | `enum HttpMethod { Get, Post, Put, ... }` |
| Validation rules as tables or pseudocode | Rules define the contract boundary | Validation table: empty → rejected, uppercase → rejected |
| Function/method signatures | The API surface IS the contract | `fn new(raw: &str) -> Result<Self, KeyError>` |
| Error code enums (variants and their meaning) | Error taxonomy IS the contract | `enum KeyError { Empty, NonAscii, ... }` with one-line descriptions |
| Domain data tables | Reference data defines the domain | Canonical key ↔ NAIF ID mapping table |

**DD content — mechanisms and realization:**

| Content | Why it's DD | Spec alternative |
|---------|-----------|-----------------|
| Trait/interface implementations (Display, Serialize, etc.) | How the contract is fulfilled | "MUST implement Display with human-readable messages" |
| Constructor/function bodies | Mechanism, not contract | Validation rules table + pseudocode algorithm |
| Preset/catalog data as struct literals | Construction detail | "MUST provide a default preset containing: GET, POST, PUT, PATCH, DELETE" |
| File locations, module inventory | Module structure | (omit entirely — DD content) |
| Migration details, per-file change lists | Build planning | (omit entirely — DD content) |
| Helper function implementations | Internal wiring | (omit entirely — DD content) |

**The test:** Can you state what the system promises without showing how the code achieves it? If yes, state the promise and leave the mechanism to DD. If the code IS the most precise way to express the promise (a type definition, an enum, a signature), include it.

**Common trap — types that grow into implementations:** A type definition starts as spec content (the shape), but accretes constructor bodies, trait impls, helper methods, and preset data until it's 200 lines of implementation wearing a spec label. The spec should define the type's fields and their semantics. The DD should show how to construct, serialize, and populate instances.

### Section Order

The document flows from abstract to concrete to practical. **Every section of claims MUST be preceded by narrative context** — prose that explains what the section covers, why it exists, and how it fits into the whole. Claims without context are unreadable; context without claims is unverifiable. Both are required.

```markdown
# [Title]

## Overview
[Purpose statement: 1 paragraph]
[Scope: in-scope vs out-of-scope bullet lists]
[Non-goals: what this spec explicitly does not cover]
[Privacy/security non-negotiables, if applicable]
[Principle alignment table, if upstream architecture constraints apply]

## At a Glance
[Pipeline diagram: ASCII showing the system's data flow end-to-end]
[One complete worked example: concrete input → concrete output,
walking through every stage of the pipeline. This grounds everything
that follows. A reader who understands this example can navigate
the rest of the spec.]

## Prior Art and Design Rationale
[What approaches exist in the domain? What did we consider?
Why this design and not alternatives? What are the known failure
modes of alternative approaches? Reference specific systems,
papers, or implementations. This section is NOT optional for
specs that define novel interfaces or DSLs — the reader needs
to understand the solution space, not just the chosen solution.]

## Terminology
[Table: Term | Definition]
[Definitions include what the term IS and what distinguishes it
from related concepts. Not just definitions — disambiguations.]

## State Machine (if applicable)
[State definition table]
[State transition table]
[ASCII state diagram (optional, nice-to-have)]

## Data Model
[Type interfaces with field-level documentation]

## Behavioral Requirements
[Narrative introduction per section: what this section covers,
what problem it solves, how it connects to the pipeline shown
in At a Glance.]
[Algorithms, scenarios, truth tables, or keyword statements
— format varies by requirement type, see below]
[Concrete examples after each major claim block: "given this
input, the algorithm produces this output" with real values]

## Edge Cases
[One subsection per case: Trigger / Detection / Behavior]

## Error Conditions
[Consolidated table: Code | Condition | When | Recovery]

## Complete Worked Examples
[For each major mode or operation: full end-to-end walkthrough
with concrete data. Show the complete input, every intermediate
transformation, and the complete output. These examples serve
as both documentation and implicit test cases.]

## API Surface (if applicable)
[Public interface contracts — what operations exist
and their input/output types. NOT module wiring.]

## Acceptance Criteria Mapping
[Table: AC Code | Criterion | Spec Coverage (which section covers it)]

## Design Decisions
[Numbered decisions with rationale and rejected alternatives.
Dedicated section — not woven into individual requirements.
Each decision MUST include: what was decided, what alternatives
were considered, why they were rejected, and what prior art
informed the choice.]

## Implementation Notes (optional)
[Phase scope, constraints, known risks.
Clearly labeled as guidance, not specification.]

## References
```

### Progressive Disclosure

Each section builds on the previous. A reader can stop at any depth and have a useful understanding:
- After Overview: knows what this is and what it covers
- After At a Glance: understands the pipeline and can picture a concrete example
- After Prior Art: understands why this approach and not alternatives
- After Terminology + State Machine: understands the conceptual model
- After Data Model: understands the data structures
- After Behavioral Requirements: understands the behavior
- After Complete Worked Examples: can trace a full input through the entire system
- After Edge Cases + Error Conditions: understands the failure modes

### Terminology Section

Required when the domain has overloaded or ambiguous terms. Optional when terminology is already established by prior documents or the codebase.

```markdown
## Terminology

| Term | Definition |
|------|-----------|
| Linked Directory | A filesystem directory bound to a collection for sync. NOT a passive watcher — an active bidirectional relationship. |
| Mapping | The identity link between a file and a node. Persists across renames. |
```

Definitions must include distinguishing characteristics — "NOT a passive watcher" prevents a common misunderstanding. Plain definitions without disambiguation are less useful.

### State Machines

When a system has lifecycle states, provide at minimum two representations:

**State definition table** — what each state means:

```markdown
| State | Definition | Entity Exists? | File Exists? | Mapping Exists? |
|-------|------------|---------------|--------------|-----------------|
| Untracked | File exists but system is unaware | No | Yes | No |
| Tracked | File linked to entity, sync active | Yes | Yes | Yes |
| Detached | Entity exists but file missing | Yes | No | Yes (stale) |
```

The boolean columns make states machine-checkable. Each state is defined by a unique combination of conditions.

**State transition table** — what causes changes:

```markdown
| From | Trigger | To | Conditions | Actions |
|------|---------|-----|------------|---------|
| Untracked | File moved into tracked directory | Pending | Sync mode includes file-to-system | File detected by watcher |
| Pending | Import triggered | Tracked | File matches filter | Create entity, create mapping |
```

Five columns capture the complete transition contract: what triggers it, under what conditions, and what side effects occur.

An ASCII state diagram is a nice addition but not essential.

### Data Model

Type interfaces with dense field-level documentation. The key pattern: document WHEN SET, WHEN NULL, and INVARIANT for every nullable field.

```typescript
/**
 * How the entity's content relates to the file.
 *
 * RESOLUTION ORDER (first non-null wins):
 * 1. This field (per-entity override)
 * 2. Parent container's default
 * 3. System default by MIME type
 *
 * WHEN SET: Explicit override for this entity.
 * WHEN NULL: Use resolution chain to determine effective mode.
 * STORAGE: Always store resolved value after first sync.
 *
 * @implements {REQ-ID}
 */
contentMode: ContentMode | null;
```

The WHEN SET/WHEN NULL/INVARIANT pattern eliminates ambiguity about the meaning of null. `@implements` annotations provide traceability to upstream requirements.

Block comments after the interface that explain behavioral modes (e.g., what each enum value means in practice) complement the interface definition by separating "what the shape is" from "what each value means."

### Narrative Context Within Sections

Every section of behavioral requirements MUST begin with prose that orients the reader before diving into claims. The pattern:

1. **What this section is about** — one paragraph explaining the concept and its role in the system
2. **Why it exists** — what problem it solves, what would happen without it
3. **How it connects** — how this section's output feeds into subsequent sections
4. **Then the claims** — with concrete examples following each major claim block

**Wrong — claims without context:**
```markdown
## §1 — Token Classification

§1.AC.01:5 The Classifier MUST accept Token[] and RuleSet[].
§1.AC.02:4 The Classifier MUST produce a ClassificationResult containing...
```

**Right — narrative then claims with examples:**
```markdown
## §1 — Token Classification

Token classification is the first stage of the processing pipeline. Given a
stream of raw tokens and a set of classification rules, it produces a labeled,
ordered sequence that downstream stages consume. The classifier answers two
questions: what category does each token belong to (classification), and in
what order should tokens be processed (priority assignment).

### Input Contract

§1.AC.01:5 The Classifier MUST accept Token[] and RuleSet[].

### Priority Assignment

§1.AC.04:4 Tokens MUST be assigned numeric priority bands...

**Example:** Given tokens `[OPEN_PAREN, IDENTIFIER "x", OPERATOR "+", NUMBER 42, CLOSE_PAREN]`:
- OPEN_PAREN → priority 10 (delimiter)
- IDENTIFIER "x" → priority 20 (operand)
- OPERATOR "+" → priority 30 (operator)
- NUMBER 42 → priority 20 (operand)
- CLOSE_PAREN → priority 10 (delimiter)
```

The examples are not claims — they are illustrations that make claims parseable. A reader encountering "priority band 20" for the first time can immediately see what it means for a real token.

### Complete Worked Examples Section

Specifications for systems with a transformation pipeline (input → processing → output) MUST include a section showing complete end-to-end examples with real data. This section is distinct from the behavioral requirements — it shows the FULL transformation, not individual steps.

For each major mode or operation:
1. Show the **complete input** (real data, not placeholders)
2. Show **every intermediate transformation** (what each stage produces)
3. Show the **complete output** (the full result, not fragments)

These examples serve triple duty: they document the system, they validate the spec's internal coherence (if you can't produce a consistent worked example, the spec has a gap), and they become implicit test cases for implementation.

**Sizing:** One worked example per major mode or operation. For a system with browse/display/edit/create modes, show all four for one representative input type.

### Behavioral Requirement Expression

Use different formats based on the type of behavior being specified:

#### Numbered Pseudocode Algorithms

For complex multi-step behavior. Highest-clarity format. Every step is testable. Implementation can be nearly mechanical transcription.

```markdown
ALGORITHM: SyncFileToSystem(directoryId, relativePath)

INPUT:
  - directoryId: string
  - relativePath: string

OUTPUT:
  - SyncResult

PRECONDITIONS:
  - Directory exists and has appropriate sync mode
  - File exists at the specified path

PROCEDURE:
1. FETCH directory by ID
2. IF directory not found:
   -> RETURN { success: false, error: 'DIR_NOT_FOUND' }
3. RESOLVE effective content mode
4. READ file content and compute hash
...

POSTCONDITIONS:
- Entity exists with current file content
- Mapping exists with current hashes
```

#### Truth Tables

For combinatorial behavior where multiple conditions interact. The densest format — a few rows define the complete behavioral space.

```markdown
| Has Filter | Has Select | Optional | Mode | Join Type | Nullability |
|-----------|-----------|---------|------|-----------|------------|
| Yes | No | -- | Filter only | EXISTS | N/A |
| No | Yes | No | Include, required | OPTIONAL MATCH | Non-null |
| No | Yes | Yes | Include, optional | OPTIONAL MATCH | Nullable |
```

#### Scenario-Based (Input → Output)

For API specifications where the variety of inputs matters more than internal steps. Each scenario is self-documenting.

```typescript
const results = await Entity.query({
  owner: { eq: aliceId },
  related: {
    $select: { node: { handle: true, email: true } },
  },
}).exec();
// -> Array<{ title: string; related: { node: { handle: string; email: string } } }>
```
**Returns:** Objects with narrowed nested relationship data
**Execution:** 1 main query + 1 batch query for to-many relationships

#### RFC 2119 Keyword Statements

For policy requirements and invariants without complex multi-step behavior.

```markdown
**REQ.03**: Schema-layer changes MUST run within a single transaction.
Schema-layer entities are low-volume; single-transaction is appropriate.
```

Good for declarative rules. Less useful when step ordering matters.

### Edge Cases

One subsection per case. Consistent structure makes them independently testable.

```markdown
### Edge Case 3: Query Change Would Remove Files

**Trigger:** User edits collection query so some entities no longer match.
**Context:** These entities have files via projected mapping.

**Detection:**
1. Query change event received
2. Compute set of entities that will no longer match
3. Filter to those with projected mapping source

**Behavior:**
1. BLOCK the query change temporarily
2. PRESENT user with affected count
3. PROMPT with options:
   - "Delete files" — remove from disk, delete mappings
   - "Detach files" — remove identity link, keep files
   - "Convert to manual" — change mapping source, keep files
   - "Cancel" — abort change
```

### Error Conditions

Consolidate all errors in a single table. Distributed error definitions (scattered across individual requirements) lead to duplicates and inconsistencies.

```markdown
| Code | Condition | When | Recovery |
|------|-----------|------|----------|
| DIR_NOT_FOUND | Directory doesn't exist | Any sync operation | Re-link or create directory |
| HASH_CONFLICT | Both sides changed since last sync | Bidirectional sync | Present conflict resolution UI |
| IDENTITY_MISSING | File lacks identity marker | Import or sync | Re-inject marker or skip |
```

The Recovery column is particularly useful — it tells implementers not just what went wrong but what to do about it.

### Acceptance Criteria Mapping

Provide both per-requirement ACs (for verification during implementation) AND a consolidated mapping table (for coverage review).

**Per-requirement ACs** (inline with each requirement):
```markdown
**AC.01:** Interface has exactly four methods
**AC.02:** Interface does not expose internal state
```

**Consolidated mapping table** (at the end):
```markdown
| Code | Criterion | Spec Coverage |
|------|-----------|--------------|
| CORE.AC01 | Interface has four methods | Data Model §2.1 |
| CORE.AC02 | No exposed internal state | Data Model §2.1 |
| SYNC.AC01 | File changes propagate within 5s | Algorithm 3, Step 7 |
```

The mapping table provides bidirectional traceability — you can verify that every AC points to a spec section that covers it.

---

## How to Produce

### Step Order Rationale

The steps below are numbered but not strictly sequential. Steps 1-3 (absorb, enumerate, classify) are largely sequential — you need to understand the requirements before enumerating behaviors, and you need to enumerate before classifying. Steps 4-6 (data model, specify, edge cases) are iterative — specifying behaviors reveals data model needs, and edge case analysis may reveal new behaviors. Steps 7-9 (acceptance criteria, open questions, validation) are completion steps that verify the work done in 4-6. Expect to cycle between Steps 4, 5, and 6 multiple times before moving to 7.

### Step 1: Absorb the Requirements

Load the requirements document(s). Don't skim — read for structure. Identify:

- **All requirement IDs and their modal statuses** (MUST, SHOULD, MAY). MUST requirements form the skeleton of the specification. SHOULD requirements fill it in. MAY requirements are documented but not deeply specified unless they affect the skeleton.
- **Design principles** stated in the requirements. These are high-binding claims (see `../epistemic-primer.md` §2) that constrain every downstream decision. A design principle like "the database is the source of truth" eliminates entire categories of specification choices.
- **Acceptance criteria** already defined. These are proto-contracts — they tell you what the requirements author already considers testable. They become inputs to the acceptance criteria mapping in the spec.
- **Open questions** deferred from requirements. Each one is a gap you must either resolve during specification or explicitly carry forward.
- **Non-goals and scope boundaries**. These are as important as what's in scope — they prevent specification drift.

Assess claim properties using the epistemic vocabulary:
- **High-binding requirements** constrain many downstream contracts. Specify these first.
- **Inherent requirements** are load-bearing — they derive from the nature of the problem, not from a design choice. These become invariants in the spec.
- **Contingent requirements** depend on decisions that could have gone otherwise. Flag these — if the decision changes, the spec changes.

### Step 1b: Gather Prior Art and Understand the Solution Space

Before specifying behaviors, understand the domain. This step is especially important for specs that define novel interfaces, DSLs, data formats, or algorithms. Skip it for specs that concretize well-understood patterns (CRUD operations, standard protocol implementations).

**What to gather:**

1. **Existing systems that solve the same problem.** How does Retool do auto-generated admin panels? How does Django Admin map model fields to form inputs? How does Forest Admin handle relationship display? What did A2UI specify for component trees? Read the actual implementations or specifications, not just marketing descriptions.

2. **Known failure modes.** What approaches were tried and failed? Uber Screenflow (14 people, 3 years, cancelled) — why? Xamarin.Forms (lowest common denominator abstraction) — what went wrong? Java AWT (cross-platform rendering) — what did we learn? Each failure mode is a constraint on the solution space.

3. **Prior exploration within the project.** If an exhaustive analysis, exploration note, or spike preceded this spec, read them. They contain alternatives that were considered and (often implicitly) rejected. The reasoning for those rejections is prior art too.

4. **Alternatives to the chosen approach.** For every major design choice in the spec, identify at least one alternative. Why was the chosen approach preferred? What would break if the alternative were used instead? This isn't busywork — it validates that the design is a reasoned choice rather than the first idea that seemed plausible.

**Where this goes in the document:** The "Prior Art and Design Rationale" section. This section gives the reader the context to evaluate whether the spec's contracts are well-grounded, not just internally consistent. A spec can be perfectly coherent and still solve the wrong problem if it ignores the solution space.

### Step 2: Identify the Behavioral Surface

Before specifying anything, enumerate what the system does at its boundary. Not internal mechanisms — external observables. For every interaction point:

1. **What stimuli does the system receive?** (User actions, API calls, events, timer expirations, data arriving)
2. **What responses does the system produce?** (Return values, state changes visible to callers, side effects, error signals)
3. **What state does the system maintain between interactions?** (Persistent data, in-memory state, configuration)

This is the Cleanroom "black box" step: describe the system purely by what an external observer sees. The behavioral surface defines the scope of what the specification must cover. If a behavior isn't on this surface, it's an internal mechanism — detailed design territory, not specification territory.

**Practical technique — verb extraction**: List every verb in the requirements that describes something the system does. Each verb is a candidate behavior. Group them by the entity or subsystem they affect. This enumeration becomes the skeleton for the Behavioral Requirements section.

**Practical technique — stimulus enumeration**: List every event the system must respond to. For each stimulus, identify whether it requires a synchronous response (return value), an asynchronous effect (side effect observable later), or both. This forces you to distinguish between query behaviors (read state, return data) and command behaviors (change state, produce effects) — a distinction that shapes the entire specification.

**The machine boundary**: Michael Jackson's Problem Frames approach identifies the key insight: requirements describe the problem domain, but the specification describes the machine interface. The behavioral surface is where the machine meets the world. A requirement like "users should be able to search their documents" spans both domains. The specification narrows to the machine boundary: "given a search query and a user ID, the system returns matching documents ordered by relevance within 200ms." The problem-domain concerns (what users want) stay in requirements; the machine-boundary concerns (what the system promises) enter the specification.

### Step 3: Classify Behaviors by Expression Type

Not all behaviors are best expressed the same way. For each behavior identified in Step 2, determine the appropriate expression format (see Behavioral Requirement Expression above):

| Signal | Use This Format | Why |
|--------|----------------|-----|
| The behavior has lifecycle states with defined transitions between them | **State machine** (state definition table + transition table) | States and transitions are the most unambiguous way to express lifecycle behavior. Truth tables would explode; prose would be ambiguous. |
| Multiple independent conditions interact to produce different outcomes | **Truth table** | Combinatorial behavior is nearly impossible to specify correctly in prose. A truth table enumerates the complete behavioral space in rows. |
| The behavior is a multi-step process with ordering, branching, and side effects | **Numbered pseudocode algorithm** | Step-by-step procedures need explicit sequencing. Each step is independently testable. |
| The behavior is best understood through input/output examples | **Scenario-based** (input → output) | API behaviors where the variety of inputs matters more than internal steps. Self-documenting through examples. |
| The behavior is a declarative rule or constraint without complex procedural logic | **RFC 2119 keyword statement** | Policy requirements and invariants. "The system MUST NOT..." or "All X MUST have Y." |

**Common mistake**: Defaulting to prose for everything. Prose is the worst specification format for anything involving state, combinations, or sequences — it's ambiguous by nature. If you find yourself writing paragraphs of conditional prose ("if A and B but not C, then D unless E..."), you need a truth table or state machine.

**Classification heuristic**: Count the conditions. One condition → keyword statement. Two to three conditions that interact → truth table. A condition that persists across interactions → state machine. A sequence of operations with ordering constraints → algorithm. None of these → scenario-based examples.

**Mixed formats are normal.** A single feature may need a state machine for its lifecycle, truth tables for its mode-selection logic, algorithms for its sync procedure, and keyword statements for its invariants. The classification is per-behavior, not per-feature. Use whatever format makes each individual behavior most unambiguous.

### Step 4: Derive the Data Model

The data model is not invented — it's derived from behavioral needs. For every behavior specified in Step 3:

1. **What data does this behavior read?** These become input fields on the relevant types.
2. **What data does this behavior write or produce?** These become output fields or new types.
3. **What data persists between behaviors?** These become entity fields.
4. **What values can a field take?** These become enums, union types, or constrained primitives.
5. **When is a field null vs. absent vs. default?** This must be explicit — the WHEN SET / WHEN NULL / INVARIANT pattern from the Data Model section eliminates ambiguity.

**The derivation test**: Every field in the data model must be justified by at least one behavior that reads it, writes it, or uses it as a condition. A field that no behavior references is either premature (belonging to a future spec) or dead weight. Conversely, every behavior that references data must find that data in the model. Missing fields are specification gaps.

**Resolution chains**: When a field can have multiple sources (per-entity override, parent default, system default), the specification must define the resolution order explicitly. "First non-null wins" resolution chains are common and must be documented in the data model, not left to implementation discretion.

**Type derivation sequence**: Work through the data model in this order:
1. **Entities** — the persistent things the system manages. These emerge from nouns in the requirements that have identity and lifecycle.
2. **Value objects** — data that describes entities but has no independent identity. These emerge from adjectives and properties.
3. **Enumerations** — constrained sets of values. These emerge from state definitions, mode selections, and any field with a closed set of legal values.
4. **Input/Output shapes** — request and response types for operations. These emerge from the behavioral surface identified in Step 2.
5. **Configuration types** — settings that control behavior without being part of the domain data. These emerge from requirements that say "configurable" or "user-selectable."

This sequence ensures that each layer builds on the previous. Entities reference value objects; operations take entities as inputs and produce output shapes; configuration types control how operations behave.

**Code boundary discipline**: When expressing types in a programming language, include the shape (fields, types, nullability, enum variants) and the field-level semantics (WHEN SET, WHEN NULL, INVARIANT). Stop there. Constructor bodies, trait/interface implementations (Serialize, Display, etc.), helper methods, and preset data construction are mechanisms — they belong in the detailed design. The spec says "this type MUST be serializable" and "MUST produce human-readable error messages." The DD shows how. See the Code in Specifications boundary table above for the full partition.

A common failure mode: a type definition starts as spec content (5 lines defining fields) and accretes constructor logic, validation implementations, trait impls, and catalog data until it's 200 lines of implementation. At that point the spec has crossed into DD territory. The discipline is: define the shape, define the validation rules (as a table or pseudocode algorithm), define the semantic constraints, and stop. The DD takes that contract and shows how to implement it.

### Step 5: Specify the Behaviors

Now write each behavior using the format determined in Step 3. For each one:

**Preconditions**: What must be true before this behavior can execute? State preconditions in terms of the data model. "Directory exists and has sync mode including file-to-system" is a precondition that references specific data model fields.

**The behavior itself**: Express using the chosen format — state transitions, truth table rows, algorithm steps, scenarios, or keyword statements. Be mechanically precise. An implementer reading this should have no behavioral questions — only mechanism questions (how to achieve the behavior, not what the behavior is).

**Postconditions**: What is guaranteed to be true after the behavior completes? Postconditions are the specification's promises. "Entity exists with current file content. Mapping exists with current hashes." These become test assertions.

**Error conditions**: What happens when preconditions are violated or operations fail? Every behavior has a happy path and failure modes. Failure modes that are undocumented become implementation surprises. Consolidate errors in the Error Conditions table, but reference them from each behavior.

**The formalization gradient**: Not every behavior needs the same rigor. Formal methods teach that specification is a spectrum from informal prose to mathematical precision. The right position on the spectrum depends on the risk of ambiguity. High-binding behaviors (many things depend on getting them right) need high precision — algorithms with numbered steps, truth tables with complete rows. Low-binding behaviors (isolated, few downstream dependents) can tolerate keyword statements. Match the formalization effort to the binding level (see `../epistemic-primer.md` §2).

### Step 6: Identify Edge Cases Systematically

Edge cases are not "things you happen to think of." They are systematically discoverable from the specification's own structure. Apply these techniques in order:

**Boundary analysis** (from equivalence partitioning): For every numeric field, enum, or constrained value in the data model, test the boundaries. What happens at zero? At maximum? At the transition between valid and invalid? For collections: empty, one element, maximum. For strings: empty, whitespace-only, maximum length.

**State pair analysis**: For every pair of states in a state machine, ask: can the system transition directly between them? What prevents an illegal transition? What happens if the trigger for transition A arrives while the system is processing transition B?

**Timing and ordering**: For every sequence of operations, ask: what if they arrive out of order? What if two arrive simultaneously? What if one is interrupted by another? Concurrent access, race conditions, and re-entrancy are edge cases that are structurally derivable from the operation list.

**Null and absence analysis**: For every nullable field in the data model, trace every behavior that reads it. What does each behavior do when it encounters null? Is the behavior defined for every combination of null/non-null across related fields?

**Conflict analysis**: For every pair of behaviors that can modify the same data, ask: what if both execute? Which wins? Is the outcome deterministic? What information does the user need to resolve a conflict?

**Precondition violation**: For every precondition on every behavior, ask: what happens if this precondition is false at runtime? Is the violation detectable? Is the error message actionable?

**Domain-specific invariant violation**: For every invariant stated in the spec ("collections are static XOR dynamic," "every entity carries a schemaId"), ask: what would happen if this invariant were violated? Even if the system should prevent it, the specification should define what happens if it occurs anyway — is it a hard error, a self-healing correction, or undefined behavior? Making this explicit prevents silent corruption.

Document each edge case with the Trigger / Detection / Behavior structure. Each edge case should be independently testable.

**Completeness check**: After enumerating edge cases, count them against the specification's structural elements. A state machine with N states has at most N*(N-1) possible transitions — each non-defined one is a potential edge case. A data model with M nullable fields has 2^M null combinations — not all meaningful, but the meaningful ones should be covered. These structural counts provide a floor for edge case coverage.

### Step 7: Build the Acceptance Criteria Mapping

Acceptance criteria close the loop between requirements and specification. The mapping is bidirectional:

**Forward (requirement → spec)**: For each requirement ID, identify which specification sections cover it. Every MUST requirement must map to at least one spec section. Every SHOULD requirement should map to at least one. Any unmapped MUST is a coverage gap.

**Backward (spec → requirement)**: For each specification section, identify which requirement(s) it satisfies. A spec section with no requirement traceability is either over-scoped (specifying something nobody asked for) or reveals a gap in the requirements (something needed but not yet captured as a requirement).

**Per-requirement ACs**: Write inline acceptance criteria adjacent to each behavioral requirement. These are the specific, testable assertions that determine whether an implementation satisfies the requirement. Use the Volere fit criterion discipline: every AC must be measurable. "The system handles errors gracefully" is not an AC. "The system returns error code DIR_NOT_FOUND with HTTP 404 when the directory does not exist" is.

**Consolidated mapping table**: Assemble the mapping table at the end of the spec. This is the coverage dashboard — a reader can scan it to verify that every requirement has spec coverage and every spec section traces to a requirement.

### Step 8: Resolve Open Questions

Requirements often defer decisions that can't be resolved without more context. The specification process forces these decisions because you cannot write precise contracts while a key behavioral question is still open.

For each open question carried forward from requirements:

1. **Can the spec proceed without resolving it?** If the question affects only a MAY requirement that doesn't interact with the behavioral skeleton, note it and move on.
2. **Does the specification's own structure resolve it?** Often, the act of specifying state machines and data models makes the answer obvious — one option creates an impossible state, or one option requires data that doesn't exist.
3. **Does the codebase resolve it?** If this is a specification for an existing system, the current implementation may already embody an answer. Read the code. The IS-state is evidence.
4. **Does it require a stakeholder decision?** If so, present specific options with their implications — not open-ended questions. "Should we use approach A (simpler, but loses ordering) or approach B (preserves ordering, adds complexity)?" is actionable. "How should we handle ordering?" is not.

Document resolutions with rationale. Carry unresolvable questions as explicit open items in the spec, clearly marked so downstream consumers know the contract is incomplete at that point.

### Step 9: Validate Internal Coherence

Before the specification is complete, verify its internal consistency:

- **State machine completeness**: Every state has at least one entry transition (except the initial state) and at least one exit transition (except terminal states). Every trigger is handled in every state where it could occur (even if the handling is "ignore" or "error").
- **Data model coverage**: Every field is referenced by at least one behavior. Every behavior references only fields that exist in the data model.
- **Error completeness**: Every error code in the error table is referenced by at least one behavior. Every error-producing path in a behavior has an entry in the error table.
- **AC completeness**: Every MUST requirement maps to at least one acceptance criterion. Every acceptance criterion is testable in isolation.
- **Scope discipline**: The specification does not define behavior that is out of scope per the requirements. If specification work revealed a needed behavior not in the requirements, it is surfaced in a Design Decisions section with rationale — not silently added as a requirement.
- **Terminology consistency**: Every technical term used in behavioral requirements and the data model is either defined in the Terminology section or is unambiguous in context. If a term appears in multiple behaviors with subtly different meanings, it needs disambiguation.
- **Cross-reference integrity**: Every reference from one spec section to another (e.g., "see Error Conditions table," "per the state machine in Section 3") points to content that exists and says what the reference claims it says.

### Resolving the Specification / Requirements Boundary

During specification, you will discover things the requirements didn't say. This is normal — it's the primary value of doing specification work. Handle discoveries by category:

**Missing requirement**: The specification needs a behavior that no requirement covers. Don't invent the requirement — document the gap. "The spec requires a conflict resolution behavior when both sides change, but no requirement addresses this." Surface it. Let the requirements owner decide.

**Ambiguous requirement**: The requirement can be read two ways, and the spec needs to commit to one. Document the interpretation in the Design Decisions section with rationale and the rejected alternative. If the ambiguity is consequential (it affects other requirements), escalate to the requirements owner.

**Contradictory requirements**: Two requirements cannot both be satisfied. This is a defect in the requirements, not a spec problem. Document the contradiction and stop specifying the affected area until resolution.

**Requirement that resists specification**: You cannot express the requirement as a precise contract. This usually means the requirement is actually a goal (Intent projection) masquerading as a requirement (Specification projection). "The system should be easy to use" is a goal, not a specifiable contract. Push it back to requirements for decomposition into testable claims.

**Implicit requirement discovered during specification**: The spec process reveals a behavior that is clearly necessary (operations fail without it) but was never stated as a requirement. This is distinct from "missing requirement" — there, you noticed a gap. Here, the specification's own logic demands the behavior. Document it as a derived requirement with the THEREFORE status (see `../epistemic-primer.md` §1), noting the chain of reasoning that makes it necessary. Example: "The state machine requires a DETACHED state to handle files deleted outside the system, but no requirement addresses this. THEREFORE the spec defines DETACHED state handling, derived from the state machine's completeness requirement."

### Relationship to Upstream and Downstream

```
Requirements ──[concretize]──→ Specification ──[input to]──→ Detailed Design
  (intent)                      (contracts)                    (modules)
```

**From requirements**: The specification concretizes requirements by deriving precise behavioral contracts. It does not add new requirements — it makes existing ones implementable. When specification work reveals gaps, those gaps flow back to requirements as observations.

**To detailed design**: The specification provides the contracts that the detailed design must realize in modules, wiring, and integration sequences. The detailed design names every file, every connection, every data path — the spec tells it what those modules must promise. See `detailed-design.md` for how the detailed design consumes specification contracts.

**Feedback loops**: Specification is not a one-pass activity. Specifying behaviors reveals data model needs. Specifying the data model reveals missing behaviors. Building the acceptance criteria mapping reveals coverage gaps. Each discovery feeds back into the specification and may feed back into requirements. The process is iterative within a single specification effort.

**Epistemic grounding**: The specification process is the **concretize** derivation operation (see `../epistemic-primer.md` §5) applied to the transition from Intent/Architecture to the Specification projection. Each step increases precision: requirements express SHOULD/MUST claims in natural language; the specification re-expresses those same claims as formal contracts with pre/postconditions, state definitions, and data models. The cognitive mode shifts from evaluative ("what and why") to contractual ("what is promised"). A common failure is producing a specification while still thinking evaluatively — writing about why the system should work a certain way instead of precisely defining what it promises. If you find yourself writing rationale instead of contracts, you're in the wrong cognitive mode for this projection.

**Cross-projection coherence**: After completing the specification, check coherence with the architecture projection (if one exists). Every architectural responsibility should have specification coverage. Every specification contract should trace to an architectural responsibility. See `../epistemic-primer.md` — Cross-Projection Coherence Checks for the verification protocol.

---

## Anti-Patterns

### [Process] Specifying Mechanisms Instead of Contracts

**Wrong**: "The system SHALL use a HashMap to store mappings, iterating with forEach to find matches."
**Right**: "The system MUST return all mappings matching the given filter criteria in O(n) time or better."

The specification defines what is promised, not how the promise is kept. If the mechanism is load-bearing (performance characteristics depend on it), specify the constraint, not the mechanism. The detailed design chooses the mechanism.

### [Process] Skipping the Data Model

Writing behavioral requirements without first establishing the data model leads to behaviors that reference vague, inconsistent, or contradictory data concepts. "The entity's sync status" means nothing until sync status is defined as a field with enumerated values and transition rules.

### [Process] Copy-Pasting Requirements as Specifications

A specification is not a reformatted requirements document. Requirements say "the system SHOULD support bidirectional sync." The specification says: here is the state machine for sync states, here are the seven transitions, here is what happens at each transition, here are the conflict resolution rules, here is the error table. The specification is a derivation — a concretization of requirements into contracts.

### [Structural] Leaving Nullable Fields Undocumented

Every nullable field is a behavioral branch. If the spec doesn't say what happens when a field is null, every implementer will guess differently. The WHEN SET / WHEN NULL pattern exists to force this decision.

### [Both] Truth Table Avoidance

When multiple conditions interact, the temptation is to describe the interactions in prose. Prose is ambiguous for combinatorial behavior. If you have three boolean conditions, you have eight cases. A truth table makes all eight explicit. Prose will cover the four obvious ones and leave the other four to implementation discretion.

### [Process] Specifying Without Traceability

A specification with no requirement IDs, no acceptance criteria mapping, and no traceability is a design document — it expresses opinion rather than obligation. Every behavioral claim in the spec must trace to a requirement. Every requirement must trace to a spec section. Without this, you cannot verify coverage or identify gaps.

### [Process] Over-Specifying Stable Areas

If the requirements explicitly mark something as out of scope or as a non-goal, the specification does not specify it. Specifying non-goals wastes effort and creates false obligations.

### [Structural] Incomplete State Machines

A state machine with undefined transitions is worse than no state machine. If the spec defines five states but only documents the "happy path" transitions, implementers face ambiguity for every off-path trigger. The transition table must account for every trigger in every state — even if the entry says "ignored" or "error." Incompleteness in the transition table is incompleteness in the specification.

### [Structural] Scattered Error Definitions

Defining errors inline within individual behaviors instead of consolidating them in an error table leads to duplicate error codes, inconsistent error messages, and behaviors that return different errors for the same condition. The error table is the single source of truth for error semantics. Behaviors reference it; they don't define their own.

### [Both] Types That Grow Into Implementations

A type definition enters the spec as a legitimate contract: 10 lines of fields with semantic documentation. Then the author adds a constructor body "for clarity." Then trait implementations "since they're part of the interface." Then preset data "to show what the values look like." The type is now 200 lines and the spec has become a detailed design wearing a spec label. Stop at the shape: fields, types, enum variants, validation rules (as tables or pseudocode), and field-level semantics. Everything else — constructor bodies, serialization mechanics, preset construction, helper methods — belongs in the DD.

### [Structural] Confusing the Terminology Section with a Glossary

A terminology section in a specification is not a general glossary. It defines terms that have specific, potentially surprising meanings within this specification. A term that means exactly what a reader would expect doesn't need an entry. A term that looks familiar but has a specific, narrowed, or counterintuitive meaning in this context does. The disambiguation — "NOT a passive watcher" — is the valuable part.

---

## Scaling and Folder Discipline

**Single file** (preferred): When the spec covers a single coherent feature, up to ~2,500 lines. Clear linear reading order.

**Layer-organized files**: When the spec spans multiple architectural layers (data, operations, API, UX) and different teams consume different layers. Main file acts as navigation hub with reading paths per implementation phase.

**Spec + supporting materials**: When extensive research preceded the spec. Use underscore-prefixed subdirectories (`_research/`, `_audits/`) to separate the spec itself from supporting material.

In all cases, there should be one clearly identifiable document that IS the spec. If a reader has to guess which file to start with, the organization has failed.

---

## Remember

- **The spec is contracts, not mechanisms** — what is promised, not how
- **Claims without context are unreadable** — every claim section needs narrative prose explaining what it covers and why. A reader encountering "§1.AC.04:4 Fields MUST be sorted by numeric priority bands" needs to first understand what field analysis is, why ordering matters, and how this fits into the pipeline. Context first, then claims, then examples.
- **Show before you specify** — include a complete worked example (At a Glance section) before any behavioral claims. A reader who can picture the system end-to-end can parse individual claims. A reader dropped into claim §1.AC.04 without context cannot.
- **Every major claim block needs a concrete example** — after specifying an algorithm, show it running on real data. "Given tokens [OPEN_PAREN, ID 'x', OP '+', NUM 42], the classifier produces [delimiter, operand, operator, operand]." This is not redundant with the algorithm — it validates that the algorithm says what you think it says.
- **Prior art is not optional for novel interfaces** — if the spec defines a new DSL, data format, or algorithm, the reader needs to know what alternatives exist and why this approach was chosen. A spec that presents its design as the only possibility is either lazy or dishonest.
- **Derive the data model from behaviors** — every field justified by a behavior that uses it
- **Choose expression formats deliberately** — state machines for lifecycle, truth tables for combinations, algorithms for sequences, keyword statements for policy
- **Edge cases are structural, not creative** — derive them from boundaries, state pairs, null fields, and concurrent access
- **Bidirectional traceability** — requirement → spec and spec → requirement, both complete
- **Resolve ambiguity, surface gaps** — the spec forces behavioral precision that requirements deliberately avoid
- **Nullable fields are behavioral branches** — document every one
- **When in doubt about the boundary**: if you're deciding what the system promises, you're in specification; if you're deciding how modules deliver those promises, you're in detailed design
- **The spec is a living document during implementation** — when implementation reveals a contract is wrong, update the spec first, then update the code. The spec is the source of truth for what the system promises; drifted specs are worse than no specs
