# Test Plan Document Guide

## Before You Draft (READ FIRST)

A test-plan claim asserts something about the verification strategy: that a test exists, that a coverage condition holds, that a verification activity occurs at a particular boundary. These are not system claims — they describe how confidence is built that the upstream spec and requirement claims hold.

Apply the litmus from `claims.md` § Authoring Litmus, with two test-plan-specific notes:

- **Modal character leans toward Existence and Coverage.** Common shapes: "A test case MUST exist for {AC.NN}" (Existence), "The integration suite MUST exercise all four state transitions in {S013.§3}" (Coverage), "A boundary-value test MUST verify the empty-input case" (Existence). Aspirational claims ("tests MUST be comprehensive," "the suite MUST be fast," "tests SHOULD be maintainable") are NOT test-plan claims — they are goals or design principles. Decompose them or relocate.

- **Verifiability is by inspection of the test code, not black-box behavior.** A test-plan claim is satisfied when the corresponding test exists and exercises the specified case. The litmus: *can a reader determine, by inspecting the test suite, whether this claim is satisfied?* If yes, it's a test-plan claim. If satisfaction requires running the system or measuring an external property, the claim is behavioral and likely belongs in the spec.

The "MUST distinguish," authorial-framing, and brief-vs-guide rules from `claims.md` § Authoring Litmus apply here as well. If a dispatch brief's section template forces non-claim content into numbered MUSTs (e.g., a "Distinction from {S020}'s test cases" section), surface the conflict before authoring.

---

A test plan is the projection between specification and test implementation — it defines what is tested, why, how, and in what order. It answers the verification questions: given these contracts and acceptance criteria, what test activities will demonstrate that the system satisfies them? A test plan defines *verification strategy*; it is not test code, not a requirements doc, not a task list.

**Core Problem**: Specifications define contracts. Code implements them. Tests verify them. Between the specification and the test code is a planning gap where verification strategy is decided. Without a test plan, verification is improvised: tests accumulate organically, clustering around easy-to-test areas while leaving hard-to-test areas uncovered. The test plan closes this gap by deriving a deliberate verification strategy from the upstream artifacts — requirements, specifications, and acceptance criteria — before any test code is written.

**The two failure modes**: Test plans sit between two extremes. Too sparse and they're just a list of "test that X works" — they don't constrain the tester or reveal coverage gaps. Too detailed and they become pseudocode for test implementations — they over-specify the mechanism and become brittle when the implementation changes. The discipline is stating *what* must be verified and *why*, at a level precise enough to assess coverage but abstract enough to survive refactoring.

**Methodological Lineage**:

| Methodology | Contribution to This Process | Context |
|-------------|------------------------------|---------|
| IEEE 829 / ISO/IEC/IEEE 29119 | Test plan structure: scope, approach, resources, schedule, risk assessment | International standards for test documentation |
| ISTQB Foundation | Test levels (unit, integration, system, acceptance), test design techniques | Industry certification body; provides the vocabulary for test classification |
| Risk-Based Testing (Bach, Veenendaal) | Prioritize testing effort by probability and impact of failure | Test everything is impossible; risk assessment allocates effort where it matters |
| Equivalence Partitioning / BVA | Systematic test case derivation from input domains | Techniques that produce minimum sets of cases with maximum coverage |
| Specification-Based Testing (Beizer) | Derive tests from behavioral specifications, not code | Tests verify the contract, not the mechanism |
| BDD (Cucumber/Gherkin) | Given/When/Then scenario structure for test case expression | Bridges the gap between requirements language and test language |
| Property-Based Testing (QuickCheck) | Express test intent as invariants over input domains, not individual cases | When the variety of valid inputs is large, properties cover the space better than examples |
| Contract Testing (Pact) | Verify integration points by testing the contract, not the full stack | For service boundaries where end-to-end testing is expensive or brittle |
| Testing Trophy / Test Pyramid | Proportion of test types by cost and confidence | More integration tests than unit tests (trophy); more unit tests than e2e (pyramid) — the right balance depends on the system |
| Mutation Testing | Measure test quality by whether tests detect code mutations | Tests that pass when the code is broken are worthless, regardless of coverage percentage |

**Relationship to other skills**:

- **Epistemic analysis** ([../epistemic-primer.md](../epistemic-primer.md)) provides the shared vocabulary this process operates with. Test plans are a verification projection — they express what must be demonstrated as true. They operate primarily on MUST claims from upstream requirements and specifications, converting them into testable assertions. The process uses binding to prioritize which verifications matter most (high-binding requirements get more thorough test coverage).

- **Requirements** ([requirements.md](requirements.md)) are the primary upstream input. Requirements provide acceptance criteria — the testable surface that the test plan must cover. Every MUST requirement with an acceptance criterion becomes a test plan entry.

- **Specification** ([specification.md](specification.md)) is the secondary upstream input. Specifications provide behavioral contracts, state machines, truth tables, error conditions, and edge cases — all of which generate test cases. The specification's acceptance criteria mapping is the starting point for the test plan's coverage matrix.

- **Detailed design** ([detailed-design.md](detailed-design.md)) provides integration context. The detailed design's module inventory and wiring map inform integration test boundaries — which components interact and where the seams are.

- **Implementation tasks** ([implementation.md](implementation.md)) are the downstream consumer. The test plan feeds into implementation tasks of type "test implementation," providing the what-to-test that the task turns into actual test code.

---

## When to Produce One

**Trigger conditions:**
- A specification or requirements document exists with acceptance criteria, and tests need to be planned before implementation
- The feature has enough behavioral complexity that ad-hoc test writing will leave coverage gaps
- Multiple test levels are needed (unit + integration + e2e) and their boundaries need to be defined
- A tester (human or LLM) needs an unambiguous reference for what verification is required
- The team needs to assess test effort, prioritize test activities, or negotiate test scope
- Prior test implementations had poor coverage because no plan guided what to test

**Not for:**
- Single-function bug fixes where the test is obvious from the defect (write the test directly)
- Exploratory testing sessions where the purpose is discovery, not verification
- Performance/load testing design (different discipline with different artifacts)
- Test code implementation (the plan says *what*; the implementation task says *how*)
- Features that don't have requirements or a specification yet (produce those first)

---

## What It Contains

A test plan answers: what verification is needed, how is it organized, what does each test demonstrate, and what coverage does the plan achieve?

**Belongs in a test plan:**
- What behaviors are tested and why (traceability to ACs)
- What test level each verification uses (unit, integration, e2e, contract)
- What test data is needed and how it's structured
- What constitutes passing and failing for each test case
- Coverage matrix showing AC-to-test mapping
- Prioritization and implementation order

**Does NOT belong in a test plan:**
- Actual test code (`expect`, `assert`, mock setups)
- Test framework configuration (jest.config, vitest.config)
- CI/CD pipeline setup
- Requirement definitions (those come from upstream)
- Implementation details of the system under test

**The practical test:** If you could implement the same test plan using a completely different test framework (switching from Jest to Vitest, or from pytest to unittest) and still satisfy all the verification goals, then the plan was correctly abstracted from the mechanism.

### No Separate Test Case IDs

Test entries do NOT get their own ID columns. The upstream acceptance criteria (e.g., `§1.AC.01`, `§3.AC.04`) already provide the canonical identifiers for what is being verified. Introducing a parallel `T01`/`UT.03`/`IT.07` numbering scheme creates competing identity systems — the exact problem the claim-level addressability system (R004) is designed to prevent.

If a test plan document itself lives within the SCEpter note system, its sections and claims inherit R004's hierarchical addressing. A test entry in section 2 of note TP001 is addressable as `TP001.§2` — it does not need a separate test case ID.

**Traceability flows through the AC codes, not through test-plan-local identifiers.**

---

## Structure

### Size Tiers

Test plans scale with the complexity of what they verify.

| Tier | Character | Line Budget | Coverage Format |
|------|-----------|-------------|-----------------|
| **Small** | Single feature, <15 test cases | <150 lines | Flat test case table with AC mapping |
| **Medium** | Multi-component feature, 15-50 test cases | 150-500 lines | Test cases grouped by level + coverage matrix |
| **Large** | Full subsystem or cross-cutting concern, 50+ test cases | Hub <200 lines + subfiles per test level | Per-level subfiles + summary coverage matrix in hub |

### Small Test Plan

For single features with few acceptance criteria and straightforward test needs.

```markdown
# Test Plan: [Feature Name]

**Spec:** {SXXX} | **Requirements:** {RXXX}
**Date:** YYYY-MM-DD

## Scope

**In scope:** [What behaviors this plan covers]
**Out of scope:** [What is explicitly not tested and why]

## Test Strategy

[1-3 sentences: which test levels, why this proportion,
any special considerations (mocking, fixtures, etc.)]

## Test Cases

| AC | Description | Level | Pass Criteria |
|----|-------------|-------|---------------|
| §1.AC.01 | [What is tested] | Unit | [Observable outcome] |
| §1.AC.02 | [What is tested] | Unit | [Observable outcome] |
| §2.AC.01 | [What is tested] | Integration | [Observable outcome] |

## Test Data

[What data each test needs. Specific enough
to reproduce — not "use valid input."]

## References
```

#### Small Plan Principles

- The test case table IS the coverage matrix — each row maps an AC to a test at a level.
- Pass criteria must be concrete — not "works correctly" but "returns `{ status: 'active', type: 'Decision' }`."
- The Description column should be precise enough that a tester can implement the test without consulting the spec.
- When one AC requires multiple tests (e.g., happy path + boundary), use multiple rows with the same AC code.

### Medium Test Plan

For multi-component features with multiple test levels.

```markdown
# Test Plan: [Feature Name]

**Spec:** {SXXX} | **Requirements:** {RXXX}
**Date:** YYYY-MM-DD

## Scope

**In scope:** [Categorized by concern]
**Out of scope:** [With rationale]

## Test Strategy

### Test Level Allocation

| Level | Scope | Proportion | Rationale |
|-------|-------|------------|-----------|
| Unit | [What unit tests cover] | [~N tests] | [Why this level] |
| Integration | [What integration tests cover] | [~N tests] | [Why this level] |
| E2E | [What e2e tests cover] | [~N tests] | [Why this level] |

### Approach

[Test isolation strategy, mocking boundaries,
fixture approach, shared utilities needed.]

### Automation Concerns

[Required for automated test suites. Address:]
- **Determinism:** Every test produces the same result on every run
- **Independence:** No test depends on another test's execution or state
- **Speed thresholds:** Acceptable execution time per level (e.g., unit <50ms, integration <2s)
- **Data isolation:** How test data is created, cleaned up, and prevented from leaking between tests
- **Environment:** What infrastructure each test level requires (in-memory, containers, live services)

## Unit Tests

### [Concern Group]

| AC | Description | Input | Expected Output |
|----|-------------|-------|-----------------|
| §1.AC.01 | [Behavior under test] | [Specific input] | [Specific output] |
| §1.AC.01 | [Boundary condition] | [Edge input] | [Edge output] |
| §1.AC.02 | [Another behavior] | [Input] | [Output] |

### [Concern Group]

| AC | Description | Input | Expected Output |
|----|-------------|-------|-----------------|
| §2.AC.01 | ... | ... | ... |

## Integration Tests

### [Integration Boundary]

| AC | Description | Components | Pass Criteria |
|----|-------------|------------|---------------|
| §3.AC.01 | [Interaction under test] | [A + B] | [Observable outcome] |
| §3.AC.02 | [Error at boundary] | [A + B] | [Error behavior] |

## End-to-End Tests

| AC | Description | Workflow | Pass Criteria |
|----|-------------|---------|---------------|
| §4.AC.01 | [Full path under test] | [Step sequence] | [Final observable state] |

## Edge Cases

| AC | Trigger | Detection | Expected Behavior |
|----|---------|-----------|-------------------|
| §1.AC.03 | [Condition] | [How system detects] | [Prescribed response] |

## Error Condition Tests

| AC | Error Code | Setup | Trigger | Expected |
|----|-----------|-------|---------|----------|
| §2.AC.04 | [Code] | [Precondition] | [Action] | [Error response] |

## Test Data Requirements

### Fixtures

| Fixture | Purpose | ACs Served |
|---------|---------|------------|
| [Name] | [What state it creates] | §1.AC.01, §1.AC.02, §3.AC.01 |

### Factories

| Factory | Produces | Key Parameters |
|---------|----------|---------------|
| [Name] | [Type] | [Overridable fields] |

## Coverage Matrix

| AC Code | Criterion | Level | Covered? |
|---------|-----------|-------|----------|
| §1.AC.01 | [From requirements] | Unit | Yes (2 cases) |
| §1.AC.02 | [From requirements] | Unit | Yes |
| §2.AC.01 | [From requirements] | Integration | Yes |
| §4.AC.01 | [From requirements] | E2E | Yes |
| §5.AC.01 | [From requirements] | — | **Gap: requires infrastructure** |

### Coverage Summary

| Level | Count | ACs Covered |
|-------|-------|-------------|
| Unit | N | §1.AC.01, §1.AC.02, ... |
| Integration | N | §2.AC.01, §3.AC.01, ... |
| E2E | N | §4.AC.01, ... |
| **Total** | **N** | **All / N of M** |

## Implementation Priority

1. [First group — and why these first]
2. [Second group]
3. [Third group]

## Open Questions

- [Testing question that affects the plan]

## References
```

#### Medium Plan Principles

- **Group by test level, then by concern.** The reader can find all unit tests together, all integration tests together. Within each level, group by the concern or component under test.
- **Integration test entries name the components.** "Components: NoteManager + NoteFileManager" tells the tester exactly what boundary is being exercised.
- **The coverage matrix is separate from the test cases.** Test case tables are organized for implementation (grouped by level and concern). The coverage matrix is organized for verification (grouped by AC). Both views are needed.
- **Edge cases and error conditions get dedicated sections.** They are not buried in the regular test case tables. This mirrors the specification format's treatment of edge cases and errors.
- **Multiple rows per AC is normal.** A single AC often needs several test cases (happy path, boundary, error). Repeat the AC code for each row.

### Large Test Plan (Hub + Subfiles)

For test plans spanning multiple subsystems or requiring hundreds of test cases.

#### Hub File (Under 200 Lines)

```markdown
# Test Plan: [Feature/System Name]

**Spec:** {SXXX} | **Requirements:** {RXXX}
**Date:** YYYY-MM-DD

## Scope

[High-level scope statement]

## Test Strategy Overview

| Level | Document | Test Count | Focus |
|-------|----------|------------|-------|
| Unit | [01 Unit Tests](./01%20Unit%20Tests.md) | ~N | [What] |
| Integration | [02 Integration Tests](./02%20Integration%20Tests.md) | ~N | [What] |
| E2E | [03 E2E Tests](./03%20E2E%20Tests.md) | ~N | [What] |

## Cross-Cutting Concerns

[Test isolation strategy, shared fixtures, mocking policy,
data management — anything that applies across all levels]

## Coverage Summary

| AC Code | Unit | Integration | E2E | Status |
|---------|------|-------------|-----|--------|
| §1.AC.01 | Yes (3 cases) | — | — | Covered |
| §2.AC.01 | — | Yes | Yes | Covered |
| §3.AC.01 | — | — | — | **Gap** |

## Implementation Priority

[Ordered list with rationale]

## Open Questions

## References
```

#### Subfiles

Each subfile follows the medium test plan's per-level format internally. The hub provides navigation and the consolidated coverage view.

**Critical rule**: The hub file contains NO individual test case definitions. Those belong in the level-specific subfiles. The hub provides strategy, navigation, and the coverage summary.

### Test Case Expression

#### How to Write a Test Case Description

A test case description must convey: what is being verified, under what conditions, and what outcome is expected.

**Good**: "Given a configuration with two note types where one has `allowedStatuses: ['active', 'resolved']` and one has none, when creating a note of the constrained type with status 'invalid', then creation MUST be rejected with a validation error."

**Bad**: "Test status validation works." — Too vague. A tester can't implement this without reading the spec.

**Bad**: `expect(validator.validate('invalid', noteType)).toThrow(StatusValidationError)` — Too coupled to the mechanism. This is test code, not a plan entry.

#### Input/Output Specification

For unit and integration tests, specify inputs and expected outputs concretely:

```markdown
| AC | Description | Input | Expected Output |
|----|-------------|-------|-----------------|
| §1.AC.01 | Parse valid note ID | `"D001"` | `{ type: "Decision", number: 1 }` |
| §1.AC.03 | Reject empty string | `""` | Error: `INVALID_NOTE_ID` |
| §1.AC.03 | Reject non-prefixed | `"001"` | Error: `MISSING_TYPE_PREFIX` |
```

The Input and Expected Output columns should contain values concrete enough to copy directly into test assertions.

#### Workflow Specification

For e2e tests, specify the workflow as numbered steps:

```markdown
| AC | Workflow | Pass Criteria |
|----|---------|---------------|
| §4.AC.01 | 1. Create project with `scepter init` | |
| | 2. Add note type "Bug" with `scepter type add` | |
| | 3. Create note with `scepter ctx create Bug "Title"` | |
| | 4. List notes with `scepter ctx list` | Listed output includes the new note |
| | 5. Show note with `scepter ctx show B001` | All fields populated correctly |
```

#### Parameterized Test Descriptions

When multiple test cases share the same structure but differ in values:

```markdown
### Parameterized: Note ID Parsing

**Template:** Given note ID `{input}`, parser MUST return `{expected}`.
**AC:** §1.AC.01, §1.AC.03

| Variant | Input | Expected |
|---------|-------|----------|
| Valid standard | `"D001"` | `{ type: "Decision", number: 1 }` |
| Valid high number | `"D999"` | `{ type: "Decision", number: 999 }` |
| Valid custom type | `"BUG001"` | `{ type: "Bug", number: 1 }` |
| Invalid empty | `""` | Error: INVALID_NOTE_ID |
| Invalid no prefix | `"001"` | Error: MISSING_TYPE_PREFIX |
```

This avoids repeating the same description structure N times while keeping each variant explicit. The AC reference is at the group level since all variants verify the same criteria.

### Coverage Matrix Patterns

#### Flat Coverage (Small Plans)

The test case table IS the coverage matrix. Each row has an AC column.

#### Grouped Coverage (Medium Plans)

Separate the coverage matrix from test case tables. Test cases are organized for implementation (by level and concern). The matrix is organized for verification (by AC).

#### Gap Analysis

When the matrix reveals gaps, flag them explicitly:

```markdown
| AC Code | Criterion | Level | Status |
|---------|-----------|-------|--------|
| §1.AC.01 | Note creation validates type | Unit | Covered (2 cases) |
| §2.AC.01 | Status enforcement blocks invalid | Integration | Covered |
| §3.AC.03 | Concurrent note creation is safe | — | **Gap: requires concurrency test infrastructure** |
```

Gaps are not failures — they are honest about what isn't covered and why. Each gap should explain what would be needed to close it.

### Test Data Specification

#### Fixture Documentation

```markdown
## Fixtures

### `valid-project`
**Purpose:** A minimal but complete SCEpter project for integration tests.
**Contents:**
- `_scepter/scepter.config.json` with 2 note types (Decision, Question)
- `_scepter/notes/decisions/D001 Test Decision.md` with references to Q001
- `_scepter/notes/questions/Q001 Test Question.md`
**ACs served:** §3.AC.01 through §3.AC.04, §4.AC.01

### `empty-project`
**Purpose:** A project initialized with `scepter init` but no notes.
**Contents:**
- `_scepter/scepter.config.json` with default configuration
- Empty `_scepter/notes/` directory structure
**ACs served:** §5.AC.01, §6.AC.01
```

#### Factory Documentation

```markdown
## Factories

### `createTestNote(overrides?)`
**Produces:** A valid Note object with sensible defaults.
**Default values:** type: "Decision", status: "active", title: "Test Note"
**Overridable:** All fields. Pass `{ status: 'resolved', type: 'Question' }` to override.
```

### Relationship to Implementation Tasks

A test plan feeds into test implementation in three ways:

1. **Inline in an implementation task** — When tests and feature code are implemented together. The task's "Testing Strategy" section references the test plan.
2. **Separate test implementation task** — When tests are a distinct work item. The task references the test plan and works through it mechanically.
3. **Continuous reference during code review** — The coverage matrix serves as a review checklist: "Does the PR include all planned tests?"

The test plan should never live inside the specification. The spec defines contracts; the test plan derives verification from those contracts. Keeping them separate means the spec can be evaluated independently of any particular testing approach.

### Progress Tracking

For test plans that will be implemented over multiple sessions:

```markdown
## Implementation Status

| Level | Planned | Implemented | Passing | Status |
|-------|---------|-------------|---------|--------|
| Unit | 12 | 12 | 12 | Complete |
| Integration | 8 | 5 | 4 | In Progress |
| E2E | 3 | 0 | 0 | Not Started |

## Progress Log
- [Timestamp]: Unit tests for §1 complete. All 12 passing.
- [Timestamp]: Integration tests for §3 in progress. §3.AC.02 failing — [issue description].
```

Keep status tracking at the bottom. The plan itself (what to test) should remain clean as a reference document.

---

## How to Produce

### Step 1: Absorb Upstream Artifacts

Load the requirements and specification documents. Identify:

- **All acceptance criteria** with their entity-prefixed codes. These are the primary test targets — each AC maps to at least one test case.
- **Behavioral contracts** from the specification — state machines, truth tables, algorithms, keyword statements. Each contract is a source of test cases.
- **Edge cases** explicitly documented in the specification. Each edge case with its Trigger/Detection/Behavior structure becomes a test case directly.
- **Error conditions** from the consolidated error table. Each error code with its condition and recovery behavior needs a test.
- **Non-goals and scope boundaries**. These define what is explicitly NOT tested. A test plan that covers non-goals wastes effort.
- **Design decisions** that affect testability. Some architectural choices make certain test approaches easier or harder.

**Assessment using epistemic vocabulary:**
- **High-binding requirements** (see [../epistemic-primer.md](../epistemic-primer.md) §2) need deeper test coverage — more cases, more edge conditions, more test levels. A failure in a high-binding area cascades.
- **Inherent requirements** are load-bearing and non-negotiable — their tests are mandatory and should be among the first written.
- **MUST vs. SHOULD vs. MAY**: MUST requirements need comprehensive testing. SHOULD requirements need representative testing. MAY requirements need existence testing (does the feature work at all) if implemented.

### Step 2: Classify Test Levels

Not all verification happens at the same level. Determine which test levels apply and what each level is responsible for verifying.

**Test level classification:**

| Level | What It Verifies | Typical Scope | When to Use |
|-------|-----------------|---------------|-------------|
| **Unit** | Single function/module in isolation | One function, one class, one module | Pure computation, validation logic, data transformation, parsers |
| **Integration** | Interaction between components | Two or more modules working together through their actual interfaces | Data flow across module boundaries, state management, event handling |
| **End-to-end** | Full system behavior from entry to exit | Complete user workflow or API request lifecycle | Critical user paths, acceptance criteria that span the entire stack |
| **Contract** | Agreement between service boundaries | API surface between producer and consumer | Service interfaces, shared data formats, protocol compliance |

**Per-level structural concerns:**

- **Unit tests** follow the Arrange-Act-Assert (AAA) pattern: set up preconditions, execute the unit, verify the output. Each test should be self-contained with inline data.
- **Integration tests** must address specific boundary concerns: data flow between components, error propagation across boundaries, timeout behavior, retry logic, and transaction boundaries. The test plan should name which of these concerns each integration test exercises.
- **Contract tests** require additional planning beyond other levels: who owns each side of the contract (consumer vs. provider), how contracts are versioned and published, and what happens when a contract is broken (blocks CI? notification? graceful degradation?).

**Classification heuristic — test at the lowest level that verifies the behavior:**
- If the behavior is pure computation (input → output, no side effects), test it at the unit level.
- If the behavior requires two components to interact through their real interfaces, test it at the integration level.
- If the behavior spans the full request/response cycle or requires the complete runtime environment, test it at the e2e level.
- If the behavior is a contract between two independently deployable services, test it at the contract level.

**The Testing Trophy vs. Test Pyramid decision**: The right proportion depends on your system. Systems with complex business logic in isolated functions benefit from many unit tests (pyramid). Systems with complex integration and few pure functions benefit from more integration tests (trophy). The test plan should state the chosen proportion and justify it based on where the system's complexity lives.

### Step 3: Derive Test Cases from Contracts

For each behavioral contract in the specification, derive test cases systematically. The derivation technique depends on how the behavior was expressed:

**From state machines:**
- One test per valid transition (happy path through the state machine)
- One test per invalid transition attempt (trigger arrives in a state where it's not valid)
- One test per terminal state (verify the system reaches and stays in terminal states)
- Sequence tests: paths through multiple transitions that exercise common workflows
- State pair coverage: for each pair of states, at least one test passes through both

**From truth tables:**
- One test per row in the truth table — this is the minimum. Each row is an explicit behavioral contract.
- If the truth table has N conditions, verify that 2^N combinations are addressed (either explicitly in the table or by a default/error row covering the remainder)

**From numbered algorithms:**
- One test per step that produces an observable output or side effect
- One test per branch point (each IF produces at least two test cases)
- One test per error return path
- One test for the complete happy-path execution

**From scenario-based specs:**
- Each scenario IS a test case. Translate the input/output example directly into a test.
- Add boundary variations: what happens at the edges of each scenario's input domain?

**From RFC 2119 keyword statements:**
- MUST statements: at least one positive test (the behavior holds) and one negative test (violation is detected/prevented)
- MUST NOT statements: at least one test that attempts the prohibited behavior and verifies it fails appropriately
- SHOULD statements: one positive test demonstrating the recommended behavior

**From property-based specifications:**

When a behavior is best expressed as an invariant over an input domain rather than individual input/output pairs, derive tests as properties:

| Property Pattern | What It Tests | Example |
|-----------------|---------------|---------|
| **Round-trip / Symmetry** | Encoding/decoding, serialize/deserialize | `deserialize(serialize(x)) === x` for all valid x |
| **Invariant preservation** | Operations that transform but preserve a property | "Sorting a list does not change its length or element set" |
| **Commutativity** | Operation order independence | `filter(sort(list)) === sort(filter(list))` |
| **Idempotency** | Repeated application produces same result | `normalize(normalize(x)) === normalize(x)` |
| **Oracle comparison** | New implementation against known-correct reference | "New parser produces same AST as reference parser for all valid inputs" |

Property-based tests supplement example-based tests — they cover the input space more broadly but are harder to diagnose when they fail. Use them for parsers, serializers, data transformations, validators, and any function with clear mathematical properties. The test plan should identify which components are property-based testing candidates and which properties must hold.

### Step 4: Derive Test Cases from Edge Cases

The specification's Edge Cases section provides pre-analyzed test targets. For each documented edge case:

1. **Translate the trigger** into a test precondition — set up the state described in the trigger
2. **Translate the detection** into a verification step — confirm the system detects the condition
3. **Translate the behavior** into assertions — verify each step of the prescribed response

Additionally, apply systematic edge case derivation techniques to supplement the specification's explicit edge cases:

**Boundary value analysis**: For every numeric parameter, test at: minimum valid, minimum valid + 1, nominal, maximum valid - 1, maximum valid, minimum invalid, maximum invalid.

**Empty/null analysis**: For every collection parameter, test with: empty, one element, many elements. For every nullable field, test with: null, non-null.

**Ordering and timing**: For every pair of operations that could occur concurrently or out of order, consider: what if A happens before B? What if B happens before A? What if both happen simultaneously?

### Step 5: Build the Coverage Matrix

Map every acceptance criterion to its test cases and test level. The coverage matrix is the test plan's primary verification artifact — it demonstrates that every upstream obligation has a corresponding downstream test.

**Forward traceability (requirement → test):**
- Every MUST requirement with an AC must have at least one test case
- Every SHOULD requirement should have at least one test case
- Any unmapped MUST AC is a coverage gap — document it or fill it

**Backward traceability (test → requirement):**
- Every test case must trace to at least one AC or specification section
- A test case with no upstream traceability is either testing an implicit requirement (surface it) or is unnecessary

**Coverage assessment**: After building the matrix, assess:
- Are there ACs with no tests? (coverage gaps)
- Are there test cases with no ACs? (over-testing or implicit requirements)
- Is each test level pulling its weight? (are there integration tests that should be unit tests, or unit tests that only make sense as integration tests?)

### Step 6: Define Test Data Requirements

Test cases need data. Define what data each test needs and how it will be provided.

**Test data categories:**

| Category | Description | Example |
|----------|-------------|---------|
| **Fixtures** | Static data that sets up the precondition | A configuration file with specific settings |
| **Factories** | Functions that generate valid instances with overridable fields | `createNote({ type: 'Decision', status: 'active' })` |
| **Snapshots** | Captured real-world data used for regression | An actual project's `scepter.config.json` |
| **Generated** | Randomized or property-based data | Arbitrary strings for fuzzing, random valid configs |
| **Boundary** | Values at the edges of valid ranges | Empty strings, maximum-length strings, zero, MAX_INT |

For each test case or group, specify:
- What data setup is required
- Whether the data is shared across tests or isolated per test
- Whether the data requires cleanup after the test
- Whether the data can be generated or must be hand-crafted

### Step 7: Prioritize Test Implementation Order

Not all tests are equally urgent. Prioritize based on:

**Risk-based prioritization inputs:**
- **Binding** (from [../epistemic-primer.md](../epistemic-primer.md) §2): High-binding requirements affect many downstream behaviors. If the test for a high-binding requirement fails, many other things are also broken. Test these first.
- **Failure impact**: What breaks if this behavior is wrong? User-facing data corruption > internal state inconsistency > cosmetic issues.
- **Failure probability**: Novel code, complex logic, and areas with a history of bugs are more likely to fail. Test these earlier.
- **Detection difficulty**: If a failure in this area would be hard to diagnose without tests, the test is more valuable.

**Implementation order heuristic:**
1. **Smoke tests first**: The minimal set of tests that verifies the system is basically operational. If these fail, nothing else matters.
2. **High-binding MUST requirements**: The load-bearing behaviors that everything else depends on.
3. **State machine and lifecycle tests**: Core workflow paths through the system's states.
4. **Edge cases for high-impact areas**: Boundary conditions in areas where failure is costly.
5. **Error condition tests**: Verify the system fails correctly.
6. **SHOULD requirement tests**: Nice-to-have behaviors that enhance quality.
7. **MAY requirement tests**: Only if time permits.

### Step 8: Define Pass/Fail Criteria

For each test case (or group of test cases), state what constitutes passing and what constitutes failure. This is especially important for tests that verify non-binary behaviors.

**Binary behaviors**: The assertion is straightforward — the output matches or it doesn't.

**Performance behaviors**: Define thresholds. "Response time MUST be under 200ms" becomes: test passes if 95th percentile response time < 200ms over N iterations.

**State behaviors**: The system must be in a specific state after the test. Define what "in state X" means concretely — which fields have which values.

**Error behaviors**: The system must produce the correct error. Define the exact error code, message format, and any side effects (or absence of side effects) expected.

**Non-deterministic behaviors**: For behaviors involving randomness, concurrency, or external dependencies, define statistical or probabilistic pass criteria. "Must succeed in at least 95 of 100 runs" or "must complete within timeout in the absence of network failures."

### Step 9: Validate the Plan

Before the test plan is complete, verify:

**Coverage completeness:**
- Every MUST acceptance criterion has at least one test case assigned
- Every error code in the specification's error table has at least one test
- Every state transition in any state machine has at least one test
- Every row in any truth table has at least one test
- Every documented edge case has at least one test

**Level appropriateness:**
- No test is assigned to a level higher than necessary (don't e2e-test what can be unit-tested)
- Integration boundaries are clearly defined — each integration test names the specific components it exercises
- E2e tests are reserved for behaviors that genuinely require the full stack

**Feasibility:**
- Every test case has a plausible data setup
- No test case requires infrastructure that doesn't exist or isn't planned
- The total test effort is proportional to the feature's importance and complexity

**Traceability integrity:**
- The coverage matrix has no orphaned rows (tests without requirements, requirements without tests)
- Every test case can answer: "which spec section told me to test this?"

**Entry/exit criteria:**
- **Entry criteria**: What must be true before testing can start? At minimum: the specification's MUST requirements are stable, the test environment is available, test data can be provisioned. If these aren't met, testing will be interrupted or produce unreliable results.
- **Exit criteria**: What constitutes "testing is complete"? Define this concretely: all MUST ACs have passing tests, all error conditions have been exercised, coverage matrix shows no gaps in MUST requirements. Without exit criteria, testing either stops arbitrarily or never stops.

---

## Distinguishing Test Plans from Neighbors

Test plans occupy a specific epistemic zone. Confusing them with adjacent artifacts causes structural problems.

| If you're writing... | You're probably writing... | Move it to... |
|---------------------|--------------------------|---------------|
| "The system MUST support X" | A requirement | Requirements document |
| "Given X, the system returns Y" | A behavioral contract | Specification |
| "Test that the function returns the correct value" | A test plan entry | Keep it here — but add the specific value and condition |
| `expect(result).toBe(42)` | Test code | Test implementation file |
| "Run `npm test` and check the output" | A manual test instruction | Test execution guide (not a test plan) |
| "Add test for the new feature" | A task item | Implementation task |

The litmus test: can a tester produce a test implementation from this description without needing to read the specification themselves? If yes, it's a good test plan entry. If they need to go back to the spec to understand what to test, the plan entry is too vague. If the entry contains actual assertion code, it's too specific — that's implementation.

---

## Anti-Patterns

### Testing the Implementation, Not the Contract [Both]

**Symptom**: Test cases that describe internal function calls, private state, or implementation data structures rather than observable behavior.
**Fix**: Every test case should be expressible in terms of inputs, outputs, and observable state changes — the same vocabulary as the specification. If the implementation changes but the contract is preserved, no test plan entry should need to change.

### Coverage Counting Without Risk Assessment [Process]

**Symptom**: "We have 90% code coverage" used as evidence of test quality. Coverage measures what code was exercised, not whether the right things were tested.
**Fix**: The test plan's coverage matrix traces to acceptance criteria, not to lines of code. A test suite with 50% code coverage that tests all MUST acceptance criteria and high-risk edge cases is better than one with 95% code coverage that misses a critical state transition.

### The Test Specification That Is Actually Test Code [Structural]

**Symptom**: Test plan entries that contain actual assertions, mock setups, or framework-specific syntax.
**Fix**: Test plan entries describe *what* is verified and *why*. The implementation task describes *how* using the specific test framework. A test plan entry should survive a complete framework migration — if switching from Jest to Vitest invalidates your test plan, the plan was too coupled to the mechanism.

### Happy Path Only [Process]

**Symptom**: Test plan covers only the successful execution paths. Error conditions, edge cases, and boundary values are absent.
**Fix**: For every happy-path test case, ask: "What are the three most likely ways this could fail?" Each answer is a candidate test case. Use the specification's error conditions table and edge cases section as checklists — every entry should have a corresponding test.

### The Ice Cream Cone (Inverted Pyramid) [Process]

**Symptom**: All tests run through the full stack because "that's how users use it." The test suite has many e2e tests, few integration tests, and almost no unit tests — the testing pyramid inverted.
**Fix**: E2e tests are expensive (slow, brittle, hard to debug). Use the test level classification from Step 2 to push tests down to the lowest appropriate level. A unit test that verifies parsing logic is faster and more diagnostic than an e2e test that happens to exercise the parser along the way.

### Flaky Tests by Design [Process]

**Symptom**: Test plan entries that depend on timing, shared mutable state, external service availability, or non-deterministic behavior without acknowledging it. The resulting tests pass sometimes and fail sometimes, eroding trust in the entire suite.
**Fix**: Every test entry in the plan must be achievable deterministically. If a behavior genuinely involves non-determinism (concurrency, network calls), the plan must specify how the test isolates or controls it: mocking the external dependency, using fixed seeds, serializing concurrent operations for testing, or defining statistical pass thresholds. Tests that are flaky by design train the team to ignore failures.

### Orphaned Tests [Both]

**Symptom**: Tests that exist but don't trace to any requirement or acceptance criterion.
**Fix**: Every test in the plan must answer "which AC does this verify?" Tests without upstream traceability are either testing implicit requirements (surface them) or are legacy tests that should be evaluated for removal.

### Under-Specified Test Data [Structural]

**Symptom**: "Use a valid configuration" or "set up a test project" without defining what "valid" or "test project" means concretely.
**Fix**: Test data requirements must be specific enough that a tester can reproduce the exact setup. "A configuration with two note types, one with allowed statuses and one without" is actionable. "A valid configuration" is not.

### Premature Test Plan [Process]

**Symptom**: Writing a test plan before the specification is settled. The plan keeps changing as spec requirements are added or modified.
**Fix**: Test plans derive from specifications. If the spec is still in flux, the test plan will be too. Wait until at least the MUST requirements and their acceptance criteria are stable before investing in a formal test plan. Preliminary notes on testing approach are fine; a full plan is premature.

---

## Scaling and Folder Discipline

**Small test plans (< 15 test cases):** Single file. Test case table doubles as coverage matrix. Minimal test data section.

**Medium test plans (15-50 test cases):** Single file. Separate sections per test level. Dedicated coverage matrix. Fixture and factory documentation.

**Large test plans (50+ test cases):** Hub + subfiles per test level. Hub contains strategy, cross-cutting concerns, and consolidated coverage. Subfiles contain test case definitions. Consider whether the scope should be split into independent test plans per subsystem.

---

## Upstream and Downstream

**Upstream — what feeds into test plans:**

| Input | What it provides | How it becomes a test plan entry |
|-------|-----------------|----------------------------------|
| Requirements (acceptance criteria) | Testable conditions the system must satisfy | Each AC becomes at least one test case |
| Specification (behavioral contracts) | State machines, truth tables, algorithms, error conditions | Each behavioral contract generates test cases by its expression type |
| Specification (edge cases) | Pre-analyzed boundary conditions | Each edge case becomes a test case directly |
| Detailed design (module inventory) | Component boundaries and integration points | Defines integration test scope — which components interact at which boundaries |
| Architecture (invariants) | System-wide rules that must always hold | Cross-cutting tests that verify invariants aren't violated by the feature |

**Downstream — what test plans feed into:**

| Output | What the test plan provides | Key handoff |
|--------|----------------------------|-------------|
| Test implementation tasks | What to test, at what level, with what data | Task works through the plan mechanically, implementing each test case |
| Code review | Expected test coverage as a review checklist | Reviewer verifies that the implementation includes all planned tests |
| CI/CD pipeline | Test classification for pipeline stage assignment | Unit tests run first (fast feedback), integration tests next, e2e tests last |
| Regression suite | Catalog of tests that must continue passing | New features don't break existing test plan commitments |

---

## Test Plans and the Epistemic Framework

Test plans are a **verification projection** — they express what must be demonstrated. They sit at the boundary between the Specification and Implementation projections (see [../epistemic-primer.md](../epistemic-primer.md) §4), translating contractual claims into empirical checks.

- **Test plans verify, specifications promise.** The specification says "the system MUST do X." The test plan says "here is how we will demonstrate that the system does X." The derivation operation is **validate** (see [../epistemic-primer.md](../epistemic-primer.md) §5): converting promised behavior into observable evidence.

- **High-binding requirements need deeper verification.** A requirement with high outward binding (see [../epistemic-primer.md](../epistemic-primer.md) §2) affects many downstream behaviors. Its test coverage should be proportionally deeper — more cases, more edge conditions, more test levels. The test plan's prioritization (Step 7) uses binding as a primary input.

- **Inherent requirements need mandatory tests.** Requirements that are inherent — true because of the problem domain's nature — cannot be relaxed. Their tests are non-negotiable and should be among the first implemented.

- **The test plan makes verification claims about the specification's claims.** This creates a two-level epistemic structure: the spec claims "X is true of the system," the test plan claims "test T will detect if X is false." Both levels can be wrong — the spec can mis-state the contract, and the test plan can mis-derive the verification. Validation (Step 9) checks both levels.

---

## Remember

- **Derive tests from contracts, not from code** — tests verify what the system promises, not how it works internally
- **Test at the lowest level that verifies the behavior** — don't e2e-test what can be unit-tested
- **Every test traces to an AC** — orphaned tests are waste or implicit requirements
- **Every AC traces to a test** — unmapped ACs are coverage gaps
- **Risk drives depth** — high-binding, high-impact areas get more thorough testing
- **Test data must be specific** — "valid input" is not a test data specification
- **The plan survives refactoring** — if an implementation change breaks the plan, the plan was too coupled to the mechanism
- **Edge cases are structural, not creative** — derive them from state pairs, boundaries, null fields, and concurrency
- **Test plans are living documents** — update when the spec changes, when tests reveal gaps, when the architecture evolves
- **Prioritize by risk, not by ease** — the hardest-to-test behaviors are usually the most important to test
