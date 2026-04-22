# Implementation Task Format

Output format guidance for implementation task documents. Defines structural patterns for planning, executing, and recording implementation work.

---

## Task Types

The format varies by task type. Each type has a natural structure that matches its workflow.

| Task Type | Natural Format | Key Elements |
|-----------|---------------|--------------|
| **Bug fix** | Root cause analysis + step plan | Root cause, "why tests missed it," fix steps, deviation log |
| **Spec-backed feature** | Phase blueprint + requirement tables | Requirement-to-code mapping, acceptance gates, testing strategy |
| **Decision-backed feature** | Step plan with function signatures | Phase-per-file, behavioral descriptions, acceptance criteria |
| **Refactoring** | Scope assessment + inventory | "What exists / what's missing," bypass inventory, severity ratings |
| **Investigation** | Questions + scope boundary | Questions to answer, "research only" scope, deliverables as ACs |
| **Multi-phase (long-running)** | Self-prompting + sub-files | Recovery protocol, progress file, decisions file, plan file |
| **Test implementation** | AC decomposition by dependency | Group-by-dependency, AC-to-test mapping, parallel strategy |

---

## Universal Elements

Every task document, regardless of type, should include these.

### Opening Sentence

States the objective and location in one line. A reader orients in 5 seconds.

```markdown
Implement the data coordinator as specified in {SXXX}. Greenfield at `src/module/`.
```

```markdown
Fix projection bug where related entity fields return null instead of actual values.
```

### Scope Boundaries

For features: explicit In Scope / Out of Scope lists.
For refactoring: "What Exists and Works" vs "What's Missing" framing.
For investigations: "Research only, no implementation" + deliverables.

### Known Issues (at completion)

What the task explicitly chose NOT to solve. Critical context for future work.

```markdown
## Known Issues

**Naive implementation** — Current approach fetches all entities and filters
in-memory. Acceptable for current scale, needs optimization for >10k entities.

**Missing edge case** — Concurrent modification during sync is not handled.
Tracked in {QXXX}.
```

---

## Bug Fix Format

```markdown
# [ID] - [Bug Title]

[One-sentence description of the bug]

## Root Cause

The bug is in `src/path/to/file.ts`, function `brokenFunction()` (lines N-M).
[Description of what's wrong]

```typescript
// file.ts line N
[Actual broken code]
```

## Why Tests Missed It

- [Specific test] asserts [weak condition] — passes even when bug is present
- [Other test] uses `toBeDefined()` which passes for null (only undefined fails)
- No test checks [the specific scenario that triggers the bug]

## Fix Direction

### Step 1: Fix `brokenFunction` in `src/path/to/file.ts`
[Description of the change]

### Step 2: Fix [related code] in `src/path/to/other.ts`
[Description]

### Step 3: Strengthen existing tests
- [Test name]: Change weak assertion to assert actual value
- Add test: [New scenario covering the gap]

## Progress
- [Timestamp]: [What was done, files affected, any deviations]

## Deviation from Plan
[Where reality diverged from the fix plan and why.
This section captures information that would otherwise be lost.]
```

The "Why tests missed it" section is the standout element. It doesn't just diagnose — it explains the testing gap that allowed the bug, providing both diagnosis and prevention.

---

## Spec-Backed Feature Format

```markdown
# [ID] - [Feature Title]

[One-sentence objective + location]

## Scope
**In scope (v1):** [Bullet list]
**Out of scope:** [Bullet list]

## Implementation Plan

### Phase 1: [Name]
[Brief description of what this phase accomplishes]

**File: `src/path/to/types.ts`**

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| SPEC.CORE.01 | `Interface` | Protocol interface |
| SPEC.CORE.04 | `Record` | Internal data |

**Acceptance gate:** [Concrete verification — "All types compile.
Review surface against spec before proceeding."]

### Phase 2: [Name]
**File: `src/path/to/impl.ts`**

| Requirement | Type/Function | Notes |
|-------------|--------------|-------|
| SPEC.CORE.02 | `createInstance()` | Factory function |

**Acceptance gate:** [Verification criteria]

[Continue for each phase]

## Testing Strategy
[What kind of tests, why this testing approach,
what framework/utilities to use]

## File Structure
[Target file layout for the implementation]

## Phase Status

| Phase | Description | Status | Commit |
|-------|-------------|--------|--------|
| 1 | Types | Complete | `abc123` |
| 2 | Core impl | In Progress | -- |

## Progress
- [Timestamp]: [What was done, files affected]

## Known Issues
```

The requirement-to-code mapping tables provide forward traceability (spec → code) and clear verification. The phase status table with commit hashes gives instant orientation.

---

## Refactoring Format

```markdown
# [ID] - [Refactoring Title]

[One-sentence description of what needs to change and why]

## Scope Assessment

### What Exists and Works
- [Component/function] does [what] correctly
- [Pipeline/path] already handles [scenario]
- [Data] is available at [point] (verified: [how])

### What's Missing
The **only missing piece** is [specific gap]:
1. [Step 1 of what needs to change]
2. [Step 2]

## Bypass Inventory (if applicable)

### Bypass 1: `function()` — [Description]
**File:** `src/path.ts` lines N-M
**Code:** [The problematic code]
**Should call:** [The correct approach]
**Severity:** HIGH | MEDIUM | LOW

[Repeat for each bypass]

### Summary

| Category | Count | Severity |
|----------|-------|----------|
| [Category] | N | HIGH |

## Implementation Plan
### Step 1: [Change]
### Step 2: [Change]

## Progress
```

The "What Exists / What's Missing" framing prevents over-engineering by making clear what the entire downstream pipeline already handles. Only the gap needs work.

---

## Investigation Format

```markdown
# [ID] - [Investigation Title]

[One-sentence description of what needs to be understood]

## Context
[Why this investigation matters, what depends on its outcome]

## Questions to Answer
1. **[Topic]**: [Specific question]
2. **[Topic]**: [Specific question]
3. **[Topic]**: [Specific question]

## Scope
- Research only, no implementation
- Document findings in a decision note
- May spawn follow-up tasks for actual changes

## Deliverables
- [ ] [Specific artifact: decision note, comparison table, etc.]
- [ ] [Specific artifact]

## Findings
[Populated during/after investigation]
```

The questions-to-answer format makes "done" unambiguous. The scope boundary ("research only") prevents scope creep.

---

## Multi-Phase / Long-Running Format

For tasks spanning multiple sessions where context loss is expected.

### Main File

```markdown
# [ID] - [Title]

[One-sentence objective]

## Recovery Protocol

After any context loss:
1. Re-read this file
2. Check `_progress.md` — current phase and last action
3. Check `_decisions.md` — decisions made so far
4. Check `_implementation-plan.md` — the validated plan
5. Resume from last checkpoint

## Knowledge Structure

| File | Purpose |
|------|---------|
| [ID].md | This file — overview and recovery |
| _progress.md | Current state, session log |
| _decisions.md | Numbered decision log |
| _implementation-plan.md | Validated implementation plan |
```

### Progress File (`_progress.md`)

```markdown
## Current State

**Phase:** [Current phase name]
**Status:** [In progress / blocked / complete]
**Last Action:** [What was just completed]
**Next Action:** [What to do next]
**Timestamp:** [When last updated]

## Session Log
- [Timestamp]: [What was done]
```

The Current State header with Last Action / Next Action is critical for session recovery. An agent reading this file after context loss knows exactly where to resume.

### Decisions File (`_decisions.md`)

```markdown
### DEC.001: [Decision Name]
**Timestamp:** [When decided]
**Decision:** [What was chosen]
**Rationale:**
- [Why this, not that]
- [Key factor]

### DEC.002: [Decision Name]
...
```

Numbered decisions with timestamps. Making decision capture explicit prevents decisions from being buried in progress logs where they're impossible to find later.

---

## Progress Logging

Two complementary patterns:

**Phase status table** — instant orientation, scannable:

```markdown
| Phase | Description | Status | Commit |
|-------|-------------|--------|--------|
| 1 | Types | Complete | `abc123` |
| 2 | Core | Complete | `def456` |
| 3 | Advanced | In Progress | -- |
```

**Timestamped entries** — detailed record:

```markdown
- 2026-02-05 12:47: Phase 3 complete — added resolution logic in
  `src/module/resolve.ts`, updated barrel exports. All 14 tests passing.
```

Each entry should include: timestamp, what was done, files affected, and any deviations from the plan. This is exactly the information someone picking up the task cold needs.

---

## Decision Capture

The largest common gap in implementation tasks. Most decisions get buried in progress logs or lost entirely.

**For multi-phase tasks:** Dedicated `_decisions.md` file with numbered entries.

**For simpler tasks:** A "Deviation from Plan" section capturing where reality diverged and why:

```markdown
## Deviation from Plan

The disambiguation fix was also needed in the batch compiler and filter
compiler — same root cause but the plan only mentioned the projection
compiler. Adding the test binding exposed the issue in those code paths.
All three paths now consistently handle the case.
```

This section captures information that would otherwise be lost — the plan was wrong, here's how and why.
