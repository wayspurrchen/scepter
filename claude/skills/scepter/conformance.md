# SCEpter Conformance Guide

**Read this companion file when validating implementations or enhancing the knowledge graph.** This combines validation methodology with source code integration and linking patterns.

Ensure you have loaded `@scepter` (the main skill) first — it contains the non-negotiable rules, CLI reference, and core concepts.

## Requirements Validation

### Identify Scope of Review

1. Execute `git status` to identify recently changed or new files
2. Focus only on files directly relevant to the task
3. Explicitly ignore unrelated uncommitted files

### Extract Requirements

Analyze the conversation history or task context to identify:
- **Explicit requirements** stated by the user
- **Implicit expectations** based on context
- **Success criteria** mentioned or implied

### Validation Criteria

| Criterion | Question |
|---|---|
| **Functional Compliance** | Does the implementation do what was asked? |
| **Scope Adherence** | Was only what was requested implemented? |
| **Quality Standards** | Does the code follow project conventions? |
| **Completeness** | Are all aspects of the requirement addressed? |
| **Correctness** | Is the implementation technically sound? |

### Requirements Validation Output

```markdown
## VERDICT: [PASS/FAIL/PARTIAL]

## REQUIREMENTS ANALYSIS

### Requirement 1: [Description]
**Status:** ✓ PASS / ✗ FAIL
**Analysis:** [Why it passes or fails]
**References:** Implements {R001}, follows {D005}

[Continue for all requirements]

## ISSUES FOUND (if not PASS)

### Issue 1: [Problem]
**Location:** src/services/auth.ts:45
**Severity:** Critical / Major / Minor
**Expected:** [What should happen]
**Actual:** [What currently happens]

## RECOMMENDED ACTIONS
1. [Specific action with file and change needed]

## SCEPTER REFERENCES
- Implements: {R001}, {R002}
- Follows: {D005}, {D007}
```

## Plan Validation

### Analyze Plan Structure

- Does the plan follow a logical sequence?
- Are dependencies identified correctly?
- Is the scope well-defined and achievable?
- Are all affected files/modules identified?

### Cross-Reference with Codebase

- Check for conflicts with existing functionality
- Verify proposed changes align with current code structure
- Do naming conventions match the project?

### Identify Gaps and Issues

- Missing error handling or edge cases
- Incomplete specs for critical components
- Performance bottlenecks or scalability concerns
- Security vulnerabilities
- Breaking changes affecting other system parts

### Verify Claims and Assumptions (CRITICAL)

Actively verify any claims in the plan:
- Check if files, modules, systems mentioned actually exist
- Verify dependencies and libraries are available
- Validate integration points are correctly identified
- Confirm architectural patterns are present in the codebase
- Use Grep, Read, code-explorer to gather evidence

**Document verification:**
```markdown
### Claim: "User service has a getUser() method"
**Status:** ✓ VERIFIED / ✗ NOT FOUND / ⚠️ DIFFERENT
**Evidence:** Found in src/services/user.ts:45
**Signature:** `getUser(id: string): Promise<User>`
```

### Plan Validation Output

```markdown
## PLAN VALIDATION SUMMARY

**Verdict:** APPROVED / NEEDS REVISION / REJECTED

## STRENGTHS
1. [What the plan does well]

## CRITICAL ISSUES (Must Fix)
### Issue 1: [Problem]
**Severity:** Critical
**Impact:** [What breaks]
**Recommendation:** [Specific fix]
**References:** Conflicts with {D003}, misses {R005}

## VERIFICATION RESULTS
[List of claims verified or refuted]
```

## Claim Verification

Claims (e.g., `§1.AC.01`, `R004.§3.AC.02`) are SCEpter's mechanism for sub-document traceability. When validating implementations, you MUST verify that claims have been carried forward correctly. **Read `claims.md` from this skill directory for the full claim syntax and rules.**

### Start with the CLI

The claims tooling already computes coverage — use it before doing any manual analysis:

```bash
# 1. Run trace to see the full coverage matrix for the relevant note
scepter claims trace R004

# 2. Run gaps to find claims missing from downstream projections
scepter claims gaps

# 3. Run lint to check structural validity (numbering, syntax, nesting)
scepter claims lint R004
```

`trace` shows each claim and which projections (DetailedDesign, Source, etc.) reference it. The **Source** column shows which files have `@implements` annotations. A `-` in the Source column means no code annotation exists for that claim.

`gaps` reports claims present upstream but absent downstream — these are your coverage gaps.

`lint` catches structural issues: duplicate IDs, non-monotonic numbering, forbidden forms like `AC01`.

### Interpreting Trace Output for Validation

After running `scepter claims trace`, assess:

1. **Source column gaps** — claims with `-` in the Source column have no `@implements` annotation in code. If the implementation should cover that claim, it's a coverage gap.
2. **Projection coverage** — for claims that should flow through multiple projections (Requirement → Spec → DetailedDesign → Source), missing intermediate projections may indicate documentation gaps.
3. **§7 claims** — deferred claims (like stability/verification markers) showing no coverage is expected and should not be flagged.

### After CLI Analysis

Based on what `trace` and `gaps` reveal, decide your validation approach:
- **All claims covered in Source** → focus validation on whether the implementation is correct, not whether it exists
- **Claims missing from Source** → flag as coverage gaps; the implementer needs to add `@implements` annotations or the code doesn't exist yet
- **Lint errors** → structural issues in the documents themselves need fixing before claim traceability is reliable

## Knowledge Graph Enhancement

### Change Detection

```bash
git status && git diff
scepter ctx list --sort-by created --sort-order desc --limit 10
```

### Relationship Discovery

For each changed file or note, search for related SCEpter content:
```bash
scepter ctx search "keyword"
scepter ctx list --tags relevant-tag
scepter ctx list --types DecisionType --tags domain
```

Identify:
- Decision notes that influenced implementation
- Requirement notes being fulfilled
- Question notes that may have been answered

### Source Code Reference Enhancement

For modified source files lacking SCEpter references, add:
```typescript
// @implements {R001} Requirement being implemented
// @depends-on {D005} Decision this code follows
// @addresses {Q003} Question this code answers
// @see {C001} Related component
```

### Note Reference Enhancement

Update notes to add missing connections:
```markdown
Based on {R001}, we decided to use JWT tokens.
This answers {Q003} about session management.
Will be implemented in {T025}.
```

Close loops:
```markdown
## Answer
**Answered by {D005} on 2025-11-10**
Decision made to use JWT tokens. See {D005} for rationale.
```

### Tech Debt Validation (CRITICAL)

When encountering TODOs or outstanding work items:
- VERIFY the work is still needed (grep/search for the code)
- If completed: update with strikethrough and verification date
- If outstanding: create verified tech debt note with evidence

## Loop Closing Patterns

Close information loops whenever possible:

| Pattern | Flow |
|---|---|
| Question → Answer | {Q003} → {D005} answers it → Update Q003 "Answered by {D005}" |
| Requirement → Task | {R001} → {T025} implements it → Update on completion |
| Bug → Fix | {BUG001} → investigate → {T050} fixes it → Update BUG001 |
| Research → Decision | {T012} research → {D012} recommendation → Update T012 |
