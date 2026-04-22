# Detailed Design Document Guide

A detailed design (DD) is the **implementation blueprint** between specification and code — the layer high-assurance engineering calls the "clear box." Given a specification with requirement IDs and acceptance criteria, a detailed design decomposes the work into module inventory, wiring maps, data and interaction flow, integration sequence, and traceability. It answers: what modules exist, what calls what, what wraps what, what data flows where, and in what order are things built and verified. The core problem it solves: specifications define contracts (MUST/SHOULD/MAY); code implements mechanisms; between them is a gap where integration decisions are made — and in LLM-assisted development, this gap is where drift lives. The model goes from spec to code in one leap, improvising glue at each file without a global picture. The DD closes this gap by planning the wiring before writing the code. This applies uniformly to backend logic, UI components, and mixed-domain features — the process and structure are the same; the content within each section reflects the domain.

---

## When to Produce One

**Produce one when:**
- A specification exists (with requirement IDs, acceptance criteria, dependencies) and implementation is about to begin
- The implementation will touch 4+ files with integration points between them
- Multiple modules or components need to be wired together
- The spec defines contracts but not how modules connect
- Glue code — context providers, hooks, resolution functions, import wiring, component composition — needs to be planned before coding
- Implementation order matters (some pieces must exist before others)
- Prior implementations drifted from spec because integration was improvised
- The user asks for an "implementation plan," "blueprint," "wiring map," or "detailed design" mapped to a specification

**Not for:**
- Tasks with no specification (write the spec first, or use architectural analysis to design the approach)
- Bug fixes with 2-3 files of changes (a step-based fix plan suffices)
- Single-file changes where the spec requirement maps 1:1 to a code change
- Greenfield single-file implementations
- Exploratory prototyping where the design is expected to emerge
- Architecture decisions that haven't been made yet (use architectural analysis)
- When the spec already specifies module structure (it shouldn't, but if it does, the DD is already written)

---

## What It Contains

A detailed design document has five core sections and up to three conditional UI sections. The core sections are required for completeness. The conditional sections are included when the design involves UI components.

### Core Sections

**1. Module Inventory** — Every file that will be created, modified, or deleted, with the specific changes described at the type/function/component level. Not "update TraceMatrix.tsx to show importance" — that's a task list. Instead: ADD/MODIFY/DELETE verbs with specific types, function signatures, or component contracts, each tagged with spec references. *Epistemic grounding*: the module inventory is a set of IS claims about the current state (what exists) and MUST claims derived from the specification (what must exist after).

**2. Wiring Map** — How modules connect: what imports what, what wraps what, what provides what, what consumes what. For backend: import graphs, call chains, dependency injection. For UI: component hierarchy with state ownership, route-to-component mapping, data flow direction (props down, events up, context sideways). Answers: "If I'm standing at component X and I call hook Y, where did the value come from?" This is the section that prevents glue improvisation.

**3. Data and Interaction Flow** — End-to-end paths showing where state enters the system, how it transforms, and where it exits. Backend flows trace data from input to persistence. UI interaction flows trace user action to visual change. Both must name every intermediate step — these are the integration points where glue gets improvised if not designed.

**4. Integration Sequence** — The order in which changes are made, with a verification point after each step. Each step: files touched, verification criteria, spec requirements covered. This is what makes implementation mechanical. *Epistemic grounding*: each verification point is a cross-projection coherence check: does the code satisfy the spec?

**5. Traceability Matrix** — Every spec requirement maps to its design realization. Every design decision maps back to a spec requirement. Two-directional: forward (spec → design → file) and backward (file → design → spec). Missing coverage in either direction is the primary signal that the design is incomplete or over-scoped.

### Conditional UI Sections

**Visual State Catalog** — For each stateful UI component, enumerate all visual states (empty, loading, populated, error, etc.) with entry conditions, visual description, exit conditions, and spec reference. Include when the design introduces or modifies components with user-visible state changes.

**Accessibility Contracts** — Per interactive component: keyboard navigation pattern, ARIA roles/states/properties, focus management, screen reader behavior, and WCAG success criteria. Include when the design introduces or modifies interactive components.

**Responsive Behavior** — Per component or view: behavior at each breakpoint, layout changes, visibility changes, component-level adaptations. Include when the design introduces or modifies components whose layout changes across viewport sizes.

---

## Structure

### Section Order

```markdown
# Detailed Design: [Feature Name]

**Spec:** {SXXX}
**Task:** {TXXX}

## Module Inventory

Per target file, a table mapping spec requirements to types/functions/components:

### File: `src/path/to/module.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| SPEC.CORE.01 | `MainInterface` | Protocol interface (4 methods) |
| SPEC.CORE.04 | `InternalRecord` | Internal registration record |

### File: `src/path/to/factory.ts`

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| SPEC.CORE.02 | `createInstance(registry, adapter, options?)` | Factory function |

[Continue for each target file]

## Wiring Map

How modules connect. Show import paths, provider/injection nesting,
component hierarchy, and call chains for key operations.

### Import Graph
[Which modules depend on which — can be ASCII diagram or table]

### Call Chains
[For each key operation: entry point → intermediate calls → terminal call]

### Provider / Context Nesting (if applicable)
[What wraps what, what scope each lives in]

### Component Tree (if applicable)
[Which components contain which, state ownership annotations]

## Data and Interaction Flow

End-to-end paths from input to output, showing transformations at each step.
For backend: data entry → validation → transformation → persistence.
For UI: user action → state transition → visual change → feedback.

### [Flow Name]
1. [Entry point]
2. [Transformation / state change]
3. [Delivery / rendering]
4. [Consumption / visual output]

## Visual State Catalog (when designing stateful UI components)

For each stateful component, enumerate all visual states:

| State | Entry Condition | User Sees | Exit Condition |
|-------|----------------|-----------|----------------|
| empty | data.length === 0 && !loading | Empty state message | Data loaded |
| loading | fetch initiated | Skeleton / spinner | Data arrives or error |
| populated | data.length > 0 | Normal content view | — |
| error | fetch failed | Error message + retry | Retry clicked |

## Accessibility Contracts (when designing interactive UI components)

Per component, specify:
- **Keyboard**: Navigation pattern, key bindings, tab order
- **ARIA**: Roles, states, properties
- **Focus**: Trap behavior, restoration, initial focus target
- **Screen reader**: Announcement format, live regions
- **WCAG criteria**: Specific success criteria this component must satisfy

## Responsive Behavior (when designing layout-affecting UI components)

Per component or view, specify behavior at breakpoints:
- Breakpoint tokens used
- Layout changes (e.g., "cards stack vertically below 768px")
- Visibility changes (what appears/disappears)
- Component-level adaptations (e.g., "table switches to card layout")

## Integration Sequence

Build order with verification points. Each phase has an acceptance
gate that prevents proceeding without verification.

### Phase 1: [Name]
[What to build in this phase]
**Acceptance gate:** [How to verify this phase is complete]

### Phase 2: [Name]
**Depends on:** Phase 1
[What to build]
**Acceptance gate:** [Verification criteria]

## Testing Strategy

[What kind of tests, at what level, for what requirements]

| Test Level | Scope | Requirements Covered |
|-----------|-------|---------------------|
| Unit | Pure computation functions | SPEC.CORE.31, SPEC.CORE.32 |
| Integration | Full lifecycle with persistence | SPEC.CORE.01 through SPEC.CORE.15 |
| Interaction | User flows via Testing Library | SPEC.UI.01 through SPEC.UI.08 |
| Visual regression | Chromatic/Percy baselines | SPEC.UI.10, SPEC.UI.12 |
| Accessibility | axe-core + manual audit | SPEC.A11Y.01 through SPEC.A11Y.05 |
```

### Key Principles

**The Module Inventory IS the Traceability Matrix.** The per-file requirement mapping tables serve dual duty: they're the implementation plan AND the verification checklist. Each row tells you what to build, where, and why. An implementer can work through each table mechanically.

**When using claims-aware tooling (e.g., SCEpter):** Do NOT include a separate static traceability matrix section. The traceability is already embedded in the claims themselves — `derives=` metadata on DCs, `@implements` annotations in source, and `{NOTE.§N.AC.NN}` cross-references in prose. The tooling materializes the matrix dynamically from these (`scepter claims trace`). A static matrix table is redundant with the claim metadata and goes stale instantly. The module inventory tables remain valuable as *design intent* — they say what SHOULD implement what, not what currently does.

**Acceptance Gates Prevent Drift.** Each phase ends with a concrete verification checkpoint. "All types compile. No logic yet. Review type surface for correctness against spec before proceeding." This forces verification before moving on, catching spec-implementation drift at the earliest possible point.

**The Wiring Map Fills the Spec's Gap.** Specifications define endpoints and contracts. Detailed designs fill in the intermediate module connections. The wiring map is the component that specs deliberately leave out — it shows how the contracts connect to each other through concrete module boundaries.

**Phase Ordering Encodes Dependencies.** The integration sequence isn't arbitrary. Types before factories. Factories before consumers. Data layer before presentation. The build order reflects the dependency graph. Making this explicit prevents implementers from starting in the wrong place.

**Uniform Rigor Across Domains.** Backend logic, UI components, and mixed features receive the same process and the same traceability discipline. DO-178C treats cockpit display software with the same verification rigor as flight control algorithms. The content within each section differs — a UI module inventory includes component contracts where a backend one includes function signatures — but the structural expectations are identical.

### Module Inventory: Domain-Specific Content

The module inventory section uses the same per-file structure for all domains, but the content within each entry reflects what that file contains.

#### Backend Entries

Backend entries describe types, functions, and their signatures:

```
src/claims/claim-index.ts
  - ADD `interface ClaimIndexEntry` with fields: noteId, claimId, importance, lifecycle
  - ADD `class ClaimIndex` with methods: build(), getClaimsForNote(), getClaim()
  - MODIFY `ensureIndex()` to populate importance and lifecycle fields
    [Spec: R005.§1.AC.01, R005.§2.AC.01]
```

The grain is: types, function signatures, import paths. Not function bodies.

#### UI Component Entries

UI entries describe component contracts — the public API surface a component exposes:

```
ui/components/Claims/TraceMatrix.tsx
  - ADD `interface TraceMatrixProps`:
    | Prop | Type | Required | Default | Description |
    |------|------|----------|---------|-------------|
    | rows | TraceabilityRow[] | yes | — | Claim rows with projection data |
    | onClaimSelect | (id: string) => void | no | — | Callback when claim row clicked |
    | importanceFilter | number | no | 0 | Minimum importance to display |

  - STATE:
    | Name | Type | Initial | Description |
    |------|------|---------|-------------|
    | sortColumn | string | 'id' | Active sort column |
    | sortDirection | 'asc' | 'desc' | 'asc' | Sort order |

  - EVENTS: onClaimSelect, onSort
  - SLOTS: none (leaf component)
    [Spec: R005.§3.AC.01, R005.§3.AC.02]
```

The grain is: props contract, state shape, events, and slots. Not rendering logic, not CSS, not JSX structure.

#### Mixed Entries

Many features span both domains. A single DD can have backend entries (types, parsers, indexes) and UI entries (components, routes, loaders) in the same module inventory. The format handles this naturally — each file gets the entry style appropriate to its content.

### Wiring Map: Domain-Specific Content

#### Backend Wiring

```
Call chain: gap analysis

CLI command (gaps-command.ts)
  → ProjectManager.claimIndex.build()
    → ClaimIndex.build() returns ClaimIndexData
  → buildTraceabilityMatrix(indexData, noteTypes)
    → returns TraceabilityMatrix
  → findGaps(indexData, noteTypes, filterOptions)
    → returns GapReport[]
  → ClaimFormatter.formatGaps(gaps, options)
    → stdout
```

#### UI Wiring

```
Component tree: Claims Dashboard

dashboard.claims.tsx (route)
  ├─ Loader: withProjectContext → claimIndex.build() → serialize
  └─ Component: CoverageDashboard
       ├─ CoverageBySection
       │    └─ ClaimRow (per claim)
       │         ├─ ClaimBadge
       │         ├─ CoverageStatusBadge
       │         └─ ProjectionDots
       ├─ GapList
       │    └─ GapRow (per gap)
       ├─ StructuralIssues (expandable)
       └─ TraceMatrix
            └─ ClaimRow (per claim, with projection cells)

State ownership:
  - selectedNote: URL param (?note=R005), owned by route
  - sortColumn/sortDirection: local state in TraceMatrix
  - filter values: URL search params, trigger loader revalidation
```

```
Data flow direction:
  - Props down: CoverageDashboard → CoverageBySection → ClaimRow
  - Events up: ClaimRow.onSelect → CoverageDashboard → URL update
  - Context sideways: ProjectProvider (from layout route)
```

#### Route-to-Component Mapping (when applicable)

```
| Route | Component | Loader Data |
|-------|-----------|-------------|
| /claims | CoverageDashboard | matrix, gaps, errors, claimDetails |
| /claims?note=R005 | CoverageDashboard (filtered) | same, scoped to R005 |
```

### Data and Interaction Flow: Domain-Specific Content

#### Backend Data Flow

End-to-end paths from input to persistence:

```
Claim indexing flow:

1. CLI invokes `scepter claims index`
2. ProjectManager.claimIndex.build() called
3. For each note: read file → parse markdown → extract headings → buildClaimTree()
4. For each claim heading: parseClaimReference() → ClaimInfo
5. parseClaimMetadata(info) → importance, lifecycle, derivation
6. Assemble ClaimIndexData: entries[], tree per note
7. Return to caller (CLI formatter, trace command, gap command)
```

#### UI Interaction Flow

End-to-end paths from user action to visual change:

```
Claim filtering flow:

1. User changes importance filter dropdown to "≥ 4"
2. Filter component updates URL: ?note=R005&importance=4
3. React Router detects search param change
4. Loader re-runs: reads importance from searchParams
5. Loader filters: matrix.rows.filter(r => (r.importance ?? 0) >= 4)
6. Component receives filtered data via useLoaderData()
7. TraceMatrix re-renders with fewer rows
8. CoverageBar recalculates percentage from filtered set
9. GapList re-filters to show only importance ≥ 4 gaps
```

Note the structural parallel: both flows trace the complete path from entry point to terminal effect. Backend flows end at persistence or stdout. UI flows end at visual state change. The DD must name every intermediate step — these are the integration points where glue gets improvised if not designed.

### Visual State Catalog

Include this section when the design involves stateful UI components. Each component with user-visible state changes gets an entry.

**Why this section exists**: Visual states have no backend equivalent. A backend service is request-response — it doesn't have an "empty state" or a "loading state." UI components are visual state machines, and each state is a claim target: "the component MUST display a skeleton loader during data fetch" is a traceable AC.

#### Format

```markdown
### TraceMatrix

| State | Entry Condition | User Sees | Exit Condition | Spec |
|-------|----------------|-----------|----------------|------|
| empty | rows.length === 0 | "No claims found" message | Claims loaded | §3.AC.02 |
| loading | isLoading === true | Skeleton rows (3) | Data arrives or error | §3.AC.03 |
| populated | rows.length > 0 | Sortable table | — | §3.AC.01 |
| error | error !== null | Error message + retry button | Retry clicked | §3.AC.04 |

### GapList

| State | Entry Condition | User Sees | Exit Condition | Spec |
|-------|----------------|-----------|----------------|------|
| no-gaps | gaps.length === 0 | "Full coverage" badge | Gaps appear | §4.AC.01 |
| has-gaps | gaps.length > 0 | Sorted gap rows | Gaps resolved | §4.AC.02 |
```

#### Criticality Classification (optional)

When risk-driven specification depth is appropriate (per IEC 62366), classify components:

| Classification | Criteria | Spec Depth |
|----------------|----------|-----------|
| **Critical** | User error causes data loss, security breach, or incorrect results | Full visual state catalog, accessibility contract, interaction flow |
| **Standard** | Normal interactive component | Props contract, key visual states |
| **Decorative** | No interactive behavior, no data dependency | File listing in module inventory only |

Not every component needs every section. A critical transaction confirmation dialog needs the full treatment. A static heading component does not.

### Accessibility Contracts

Include this section when the design involves interactive UI components. Accessibility claims are structured, testable, and traceable — WCAG success criteria are already numbered and leveled, making them natural claim targets.

#### Format

```markdown
### TraceMatrix

- **Role**: `table` with `role="grid"`
- **Keyboard**:
  - Arrow keys navigate cells
  - Enter selects claim (fires onClaimSelect)
  - Escape clears selection
  - Tab moves to next interactive element outside grid
- **Screen reader**: Column headers announced on cell focus
- **Focus**: First data cell receives focus on table mount
- **WCAG**: 1.3.1 (Info and Relationships), 2.1.1 (Keyboard), 4.1.2 (Name, Role, Value)
  [Spec: §3.AC.05]

### FilterControls

- **Role**: Each filter is a labeled form control
- **Keyboard**: Standard form control patterns (Tab between controls, Space/Enter to activate)
- **Screen reader**: Filter changes announced via aria-live region
- **WCAG**: 1.3.1, 3.3.2 (Labels or Instructions), 4.1.3 (Status Messages)
  [Spec: §5.AC.01]
```

#### Relationship to WCAG Traceability

Each accessibility contract entry references specific WCAG success criteria. These trace through to the testing strategy: automated verification via axe-core for criteria it covers (~57%), manual verification for the remainder. The traceability matrix should include accessibility claims alongside functional claims.

### Responsive Behavior

Include this section when the design involves layout changes across viewport sizes.

#### Format

```markdown
### TraceMatrix

| Breakpoint | Layout | Content Changes |
|-----------|--------|-----------------|
| ≥ 1024px | Full table, all columns visible | — |
| 768–1023px | Table with horizontal scroll, sticky first column | Projection columns abbreviated |
| < 768px | Card layout, one card per claim | Projection dots instead of full cells |
  [Spec: §3.AC.06]
```

### Full Output Template

```markdown
# Detailed Design: [Phase/Feature Name]

<!-- derived-from: [specification document path] -->
<!-- created: [YYYY-MM-DD] -->

## Specification Scope

[List the spec requirement IDs this design covers, grouped by area.
Note any open questions resolved and any deferred.]

## Primitive Preconditions

| Primitive | Source Citation | Status |
|-----------|----------------|--------|
| `<SymbolName>` | `src/<path>.ts:<line>` | PRESENT |
| `<SymbolName>` | `src/<path>.ts:—` | ABSENT — requires {DDxxx} OR deferred per {Q/D/note} OR authorized by {Sxxx.§N.AC.NN} |

[Every EXTEND/MODIFY/@implements target in the body appears as a row.
PRESENT requires a verifiable file:line. ABSENT requires a companion DD,
deferral note, or spec-claim authorization. See Step 2.5 for the rule.]

## Current State

[Concrete baseline: what files, types, hooks, components, and wiring
exist today that this design builds on. File paths and brief
descriptions — not full code listings.]

## Module Inventory

### [file path]
- ADD / MODIFY / DELETE: [specific type, function, component, hook, or import]
  [Spec: REQUIREMENT-ID]

[For UI components, include props/state/events tables.
For backend modules, include function signatures.]

### [file path]
...

## Wiring Map

[Diagrams or structured text showing:
- Import graph (what imports what)
- Call chains (what calls what)
- Provider/context nesting (what wraps what)
- Component tree with state ownership (what contains what)]

## Data and Interaction Flow

### [Flow name]
1. [Entry point — API call, user action, event]
2. [Transformation — parsing, validation, state change]
3. [Delivery — persistence, rendering, broadcast]
4. [Consumption — display, side effect, response]

## Visual State Catalog (if applicable)

### [Component Name]
| State | Entry Condition | User Sees | Exit Condition | Spec |
|-------|----------------|-----------|----------------|------|

## Accessibility Contracts (if applicable)

### [Component Name]
- Role: ...
- Keyboard: ...
- Screen reader: ...
- WCAG: ...

## Responsive Behavior (if applicable)

### [Component/View Name]
| Breakpoint | Layout | Content Changes |
|-----------|--------|-----------------|

## Integration Sequence

### Step 1: [description]
**Files**: [list]
**Changes**: [specific additions/modifications]
**Verify**: [testable criterion]
**Spec**: [requirement IDs covered]

### Step 2: [description]
...

## Testing Strategy

| Test Level | Scope | Requirements Covered |
|-----------|-------|---------------------|

## Observations

[Anything the design process revealed that the spec doesn't cover.
Gaps, implicit requirements, decisions that need to be made.
NOT resolutions — observations. The spec owner decides.]
```

---

## How to Produce

### Methodological Lineage

| Methodology | Term for This Layer | Context |
|-------------|-------------------|---------|
| Cleanroom Software Engineering | **Clear Box** | The procedural decomposition between spec (black box) and code |
| DO-178C (aviation) | **Software Low-Level Requirements** | Level 3 of 4 between system requirements and source code |
| IEC 62304 (medical devices) | **Detailed Design** | The module-level design between architecture and implementation |
| B-Method | **Refinement** | Each step adds implementation detail while preserving correctness |
| Stepwise Refinement (Dijkstra/Wirth) | **Refinement step** | Decompose abstract to concrete in verified stages |
| ARINC 661 (cockpit displays) | **Widget Specification** | Formally defined component contracts for display systems |
| IEC 62366 (medical usability) | **UI Specification** | Risk-driven specification depth for user interfaces |

What they all share: **you don't go from specification to code in one step.** You go from specification to a module-level design that names every file, every connection, every data path — and then the code becomes mechanical transcription of that design. Each step is small enough to verify. This holds for display software and logic software equally — DO-178C demands the same rigor for both.

### Relationship to Other Skills

- **Epistemic analysis** (`../epistemic-primer.md`) provides the shared vocabulary this skill operates with. Detailed design is a specific application of the **concretize** derivation operation (see `../epistemic-primer.md` §5) — moving from the specification projection to a level of concreteness that maps directly to implementation without being implementation. The skill uses modal statuses to distinguish IS claims (current code state) from MUST claims (spec requirements), binding to prioritize integration order, and inherence to identify which design decisions are load-bearing.

- **Architectural analysis** maps decision spaces and evaluates trade-offs. Detailed design takes architectural decisions as settled inputs and plans their realization. If you're still deciding *whether* to do something, use architectural analysis. If you've decided and need to plan *how*, use detailed design.

- **Epistemic topology** (`../epistemic-primer.md`) perceives the bodies of information and their boundaries. A topology analysis often precedes detailed design — the bodies identified in the topology become the modules decomposed in the design.

### Step 1: Read the Specification

Load the specification document. Identify:
- All requirement IDs
- Their modal statuses (MUST, SHOULD, MAY)
- Their dependencies and relations (DERIVES FROM, CONSTRAINED BY, IMPLEMENTS)
- Open questions that remain unresolved
- Which requirements affect backend, UI, or both

Use the epistemic vocabulary to assess claim properties. Pay special attention to:
- **High-binding requirements**: These constrain many downstream decisions. Design them first.
- **Inherent requirements**: These are load-bearing — the design must honor them without exception.
- **MUST vs. SHOULD vs. MAY**: MUST requirements drive the design skeleton. SHOULD requirements fill it in. MAY requirements are noted but not designed unless they affect the skeleton.

### Step 2: Ground in the Current Codebase

Read the relevant files to establish the IS-state — what exists now. This is the concrete baseline the design builds on.

For each area the spec touches, determine:
- What types, functions, hooks, and components exist
- What the current wiring looks like (imports, context providers, component hierarchy, call sites)
- What conventions the codebase follows (naming, file organization, hook patterns, component patterns)
- For UI: what design system components are available, what styling approach is used

**Do not accept characterizations.** Read the actual code. The gap between how something is described and what the code actually shows is where bad designs hide.

### Step 2.5: Primitive Preconditions

Before writing any module inventory entry that uses `EXTEND`, `MODIFY`, `ADD_TO`, or that carries an `@implements` / `derives=` annotation against an existing target, enumerate every primitive (type, interface, class, function, schema entry, module path) the design touches and assign it a disposition.

For each entry:
1. Run `grep -rn 'export (type|interface|class|const|function) <SymbolName>' src/` (or the project equivalent).
2. If a declaration exists, mark **PRESENT** with `path:line` of the declaration.
3. If no declaration exists, mark **ABSENT** and assign one of:
   - **Requires {DDxxx}** — a companion DD authors this primitive
   - **Deferred per {Q/D/note}** — explicit deferral with a linked note
4. If a primitive belongs to a future spec claim that has not yet been built, cite the S-note claim ID that authorizes its eventual existence.

**Halt rule:** If any ABSENT entry has neither a companion DD nor an explicit deferral, the DD cannot ship. Either author the prerequisite DD first, create a deferral note, or scope this DD to exclude the unbuilt primitive.

**Output:** the DD MUST include a `## Primitive Preconditions` section between `## Specification Scope` and `## Current State`, with this table:

| Primitive | Source Citation | Status |
|-----------|----------------|--------|
| `<SymbolName>` | `src/<path>.ts:<line>` | PRESENT |
| `<SymbolName>` | `src/<path>.ts:—` | ABSENT — requires {DDxxx} |
| `<SymbolName>` | `src/<path>.ts:—` | ABSENT — deferred per {Qxxx} |
| `<SymbolName>` | `src/<path>.ts:—` | ABSENT — authorized by {Sxxx.§N.AC.NN} |

Reviewers check this section first. Any EXTEND/MODIFY/@implements target in the DD body that is missing from the manifest is a conformance failure.

### Step 3: Decompose Requirements into Modules

Map each spec requirement to the file(s) it affects. Group related requirements that touch the same files. Identify:

- **New files** that need to be created (types, utilities, components)
- **Modified files** with the specific additions or changes
- **Deleted code** (hardcoded values being replaced, etc.)
- **Untouched files** that are explicitly out of scope

For UI components, this step also produces the component contracts: props tables, state shapes, event definitions, and slot specifications.

The module inventory emerges from this decomposition.

### Step 4: Design the Wiring

For each new type, function, hook, or component:
- Who creates it?
- Who provides it (if it's context-based)?
- Who consumes it?
- What is the import path?
- What is the call site?

For backend: draw the import graph and call sequence.
For UI: draw the component tree with state ownership annotations. Draw the provider nesting. Map routes to components to loader data.

**This is the step that prevents drift.** Without explicit wiring design, each file's implementation chooses its own integration approach. Those choices may not compose. A wiring map forces coherence before code exists.

### Step 5: Trace Data and Interaction Flow

For each significant path through the system, trace the full route. Name every intermediate step.

**Backend paths**: configuration load → resolution → delivery. Request → validation → processing → persistence → response.

**UI paths**: user action → event handler → state change → re-render → visual update. Loader → data transformation → component props → rendered output.

**Mixed paths**: user action → API call → server processing → response → state update → re-render. These are the paths most likely to have missing integration steps.

Flow tracing often reveals missing pieces: "the data needs to get from here to there, but there's no path." These missing paths are the glue that gets improvised at implementation time if not designed here.

### Step 6: Specify Visual States, Accessibility, and Responsive Behavior

**This step applies only when the design involves UI components.**

For each stateful component: enumerate all visual states. Think beyond the happy path — what does the user see when data is loading? When the fetch fails? When the dataset is empty? When permissions are insufficient?

For each interactive component: specify the accessibility contract. What keyboard pattern does it follow? What ARIA roles and states does it use? How is focus managed?

For each layout-affecting component: specify responsive behavior at each breakpoint.

**Risk-driven depth** (per IEC 62366): not every component needs the same level of specification. Classify components by criticality — critical interactions get full visual state catalogs and accessibility contracts; decorative components get a file listing in the module inventory and nothing more.

### Step 7: Sequence the Integration

Order the module changes into a series of steps, each independently verifiable. The sequence respects dependencies and prioritizes early verification.

Heuristics for good sequencing:
- **Types before consumers**: Define the types first, then the providers, then the consumers.
- **Data layer before presentation**: Backend changes that produce data before UI changes that display it.
- **Infrastructure before integration**: Build hooks and utilities before using them in components.
- **Verify-on-green**: Each step should leave the codebase in a compiling, working state. No step should break things that are fixed by a later step.
- **Smallest verifiable unit**: Each step should be small enough that when verification fails, the cause is obvious.

Example:
```
Step 1: Add ClaimMetadata types and parser
  Files: src/claims/claim-metadata.ts
  Verify: TypeScript compiles. Unit test: parseClaimMetadata extracts importance 4.
  Spec: R005.§1.AC.01

Step 2: Populate metadata during index build
  Files: src/claims/claim-index.ts
  Verify: Index entries have importance and lifecycle fields populated.
  Spec: R005.§1.AC.02

Step 3: Add importance column to TraceMatrix
  Files: ui/components/Claims/TraceMatrix.tsx
  Verify: Importance digit visible in column. Importance 4-5 bold.
  Spec: R005.§1.AC.03

Step 4: Add lifecycle visual treatment
  Files: ui/components/Claims/TraceMatrix.tsx
  Verify: Closed claims dimmed. Removed claims struck through.
  Spec: R005.§2.AC.08
```

### Step 8: Build the Traceability Matrix

Map every spec requirement to its design realization. Verify two-directional coverage:
- Every MUST requirement has at least one row.
- Every SHOULD requirement has at least one row (or an explicit "deferred" note).
- Every design decision traces to a spec requirement.
- For UI: accessibility claims trace to WCAG criteria.

Missing coverage in either direction is the primary signal that the design is incomplete or over-scoped.

### Resolving Open Questions

Specifications often contain open questions — decisions that were deferred because they couldn't be resolved without more context.

The detailed design MUST resolve open questions that affect the wiring or integration sequence. You cannot design module connections when a key interface decision is still open.

For each open question:
1. **Assess whether the design can proceed without resolving it.** If the question affects a MAY requirement that doesn't change the skeleton, note it and move on.
2. **If resolution is needed, assess what information would resolve it.** Can you determine the answer from the codebase (read the code)? From the specification's constraints (the answer is implied)? Or does it require a decision from the user?
3. **If the codebase or spec resolves it, resolve it and document the resolution** with rationale.
4. **If a user decision is needed, ask** — with specific options and their implications. Don't present open-ended questions; present the options the design analysis has narrowed to.

---

## Anti-Patterns

### Designing at the Wrong Grain [Both]

**Too coarse**: "Update TraceMatrix.tsx to show importance." This is a task list, not a design. It doesn't say what props, what state, what visual states, or how components connect.

**Too fine**: Writing JSX, function bodies, or CSS. That's implementation, not design. The design names the components and their contracts and connections — not their internal logic or visual style.

**Right grain**: Types, function/hook signatures, component contracts (props, state, events), import paths, provider nesting, visual states, accessibility contracts. Enough to know what connects to what; not enough to write the code directly.

### Designing Without Reading [Process]

Producing a design from the spec alone, without reading the current codebase. The design MUST be grounded in the actual IS-state: current types, current hooks, current component hierarchy, current conventions. A design that assumes a file structure or naming convention that doesn't exist will produce code that doesn't fit the codebase.

### Over-Designing Stable Areas [Process]

Spending design effort on parts of the system that the spec doesn't touch. The design covers the scope of the specification — no more.

### Improvising Scope [Both]

Adding design decisions that have no corresponding spec requirement. If the design reveals that something is needed that the spec didn't anticipate, surface it as an observation ("the spec does not cover X, but the wiring requires a decision about X") — don't silently resolve it.

### Skipping Verification Points [Structural]

An integration sequence without verification points is just a task list. Every step MUST have a testable verification criterion. "It compiles" is a valid verification. "It renders identically to before" is a valid verification. "The component displays the correct number of rows" is a valid verification. But each step needs one.

### Treating the Design as Disposable [Process]

The detailed design is a living document during implementation. When implementation reveals that the design was wrong (a wiring path doesn't work, a prop type needs a different shape), update the design first, then update the code. The design is the ground truth for how modules connect. If it drifts from the code, it's useless; if the code drifts from it, the code may have improvised incorrectly.

---

## Scaling and Folder Discipline

**Small detailed designs (4-6 files):** All sections in a single document. Module inventory + integration sequence are the minimum useful components. Wiring map can be implicit. Conditional sections (visual states, accessibility, responsive) included only when applicable.

**Medium detailed designs (7-15 files):** Full document with all applicable components. Single file, ~200-500 lines.

**Large detailed designs (15+ files):** Main document with module inventory and integration sequence. Wiring map and data flow in a separate companion file. Consider whether the scope should be split into multiple detailed designs for independent subsystems.

---

## Remember

- **The design is the map, not the territory** — it plans the wiring, not the logic
- **Read the code before designing** — the IS-state grounds the design in reality
- **Every step verifies** — no step leaves the codebase in an unverifiable state
- **Traceability lives in claims, not tables** — `derives=` and `@implements` are the traceability; run the tools to materialize it
- **Two-directional traceability** — spec → design and design → spec, both complete
- **Surface, don't resolve, scope gaps** — if the spec doesn't cover something, say so
- **The right grain is contracts and connections** — not task descriptions, not implementation code
- **The design lives during implementation** — update it when reality diverges
- **Uniform rigor** — backend and UI get the same process, the same traceability, the same verification discipline
- **Conditional sections earn their place** — include visual states, accessibility, and responsive behavior when the design involves UI; omit when it doesn't

---

## Relationship to Implementation

The detailed design is **input to** implementation, not a replacement for it. The implementer (human or LLM) follows the integration sequence, implements each step, verifies at each verification point, and consults the wiring map when connecting modules.

When an implementer follows the detailed design:
- They know exactly which files to touch (module inventory)
- They know how modules and components connect (wiring map)
- They know where data flows and how interactions propagate (data and interaction flow)
- They know what visual states each component must handle (visual state catalog)
- They know what accessibility contracts to fulfill (accessibility contracts)
- They know what order to work in (integration sequence)
- They know what to verify (verification points)
- They know which spec requirements each change satisfies (traceability)

What remains for the implementer: the function bodies, the CSS, the rendering logic, the animation choreography — the actual *mechanism*. The design tells them the skeleton; they fill in the muscles.

If the implementer discovers that the design was wrong (a wiring path doesn't work, a component contract needs adjustment), they should:
1. Stop implementing
2. Update the design to reflect the correction
3. Reassess downstream steps that may be affected
4. Continue from the corrected design

This is the Cleanroom discipline: the design is the source of truth for structure. Code that deviates from the design is either a design bug (update the design) or an implementation bug (fix the code).
