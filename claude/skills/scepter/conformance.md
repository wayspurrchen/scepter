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

### Verify "No Code Changes Needed" Assertions (CRITICAL)

DDs and specs sometimes assert that a requirement is satisfied automatically — "existing mechanism handles this," "no code changes needed," "snapshots automatically capture new properties." **These assertions are claims, not facts. They require the same verification as any other claim.**

**Why this matters:** A DD that says "SnapshotFieldDef automatically includes new properties because the snapshot mechanism reads all node properties" may be wrong. The TypeScript interface may not include the new fields. The serialization code may filter properties. The read-back code may not parse the new shape. The assertion is a hypothesis about existing code behavior — it must be tested against reality.

**Verification process:**
1. **Read the actual type/interface** the DD references. Does it include the claimed properties?
2. **Trace the data flow.** If the DD says "X automatically captures Y," follow the code from X's write path through serialization, storage, and read-back. Is Y actually present at every stage?
3. **Check for filtering or selective capture.** Many snapshot/serialization mechanisms don't capture "all properties" — they capture a defined set. New properties may need explicit inclusion.
4. **If the assertion is correct**, document the evidence: specific file path, line number, and the code that proves it.
5. **If the assertion is wrong**, flag it as a conformance failure. A DC that claims "no code changes needed" but is actually wrong is an implementation gap — it means the requirement is NOT satisfied and code IS needed.

**This is a common failure mode.** Decomposition specifically exists to surface these cases — when a high-binding AC like "snapshots MUST preserve X" gets decomposed into a DC that says "no work needed," the decomposition should be validated, not accepted on faith. If it cannot be externally verified with a code citation, it has not been verified.

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

## Reality-Conformance Pass

**Scope-determining question:** "Does the real code realize the primitives the artifact depends on?" This is peer to "Does artifact X match source Y?" — additive, not a replacement for claim-to-claim conformance or format review.

### When to Use

Whenever the artifact under review references primitives, types, APIs, or modules with `EXTEND`, `MODIFY`, `derives=`, `@implements` (expected), or "existing mechanism" language. Run BEFORE `scepter claims trace` — trace presumes the pieces exist.

### Methodology

For every claim-cited primitive in the artifact under review, grep the actual code root (e.g., `src/`) and verify the primitive exists where the artifact says it does.

1. Extract the primitive list from the artifact — every symbol name referenced by EXTEND/MODIFY/ADD_TO/@implements/derives, every file path the artifact claims to touch.
2. For each primitive, run `grep -rn 'export (type|interface|class|const|function) <SymbolName>' src/` (or the project equivalent).
3. If the artifact includes a `## Primitive Preconditions` table, spot-check 2-3 PRESENT rows by running the grep against the cited `path:line`. Confirm the declaration is at the cited line.
4. For each ABSENT row, confirm the companion DD, deferral note, or spec-claim authorization exists and is linked.

### Output

Produce a primitive-presence table in the review findings:

| Primitive | Artifact Citation | Reality | Verdict |
|-----------|------------------|---------|---------|
| `<SymbolName>` | `src/<path>.ts:<line>` | found at cited location | VERIFIED |
| `<SymbolName>` | `src/<path>.ts:<line>` | not found / different signature | REALITY GAP |
| `<SymbolName>` | (not cited; appears in body) | not found in `src/` | REALITY GAP — missing from manifest |

### Critical Rule

Reality-conformance gaps are **pre-authorship failures**, not "implementation pending." A DD cannot `EXTEND X` when X has no declaration in code; the precondition is a separate DD to build X. A reality gap blocks conformance regardless of claim-to-claim fidelity.

### Relationship to Other Passes

This pass replaces neither claim-to-claim conformance (§Claim Verification) nor format review. Run all three when the authority-under-review pair is document-vs-code:
- **Reality conformance** — does `src/` realize the primitives?
- **Claim verification** — do claims trace through projections?
- **Format review** — does the artifact meet its format guide?
- **Attribution conformance** (below) — do user-attributions in the artifact trace to verifiable user utterances or events?

A claim-to-claim conformance PASS on an artifact whose primitives are absent from `src/` is a false positive. Reality conformance is the gate that closes it.

## Attribution-Conformance Pass

**Scope-determining question:** "Does every user-attribution in the artifact trace to a verifiable user utterance or recorded event?" Peer to reality-conformance — both check artifact claims against a ground-truth source. Reality-conformance grounds primitives against `src/`; attribution-conformance grounds user-intent claims against session quotes or event records.

### When to Use

Whenever the artifact under review attributes positions, decisions, endorsements, or intent to the user: scope statements framed as user-approved, DD §1 sections citing user goals, conformance reports asserting "user confirmed," handoffs paraphrasing user intent. Especially critical when the artifact was produced across multiple sessions or derived from a prior synthesized document.

### Methodology

For every user-attribution in the artifact under review, identify an acceptable source or flag as synthesized.

1. **Extract attribution phrases** from the artifact. Search for: "user stated," "user said," "user chose," "user agreed," "user approved," "user confirmed," "user wants," "as agreed," "the user decided," "per user direction," "user-endorsed." Include the scope section and any framing prose.
2. **For each attribution, classify the source**:
   - **Verbatim quote** with session or document reference — acceptable
   - **Event record** (`scepter claims verify` output, user-endorsement recorded in a sidecar) — acceptable
   - **Explicitly user-authored note** (the user wrote the prose themselves, not an agent paraphrasing) — acceptable
   - **Prose paraphrase in another document** — NOT acceptable on its own; trace to the original source
   - **Agent synthesis** (the attribution originates from an agent's synthesis of session context) — NOT acceptable; must be flagged
3. **Follow paraphrase chains to the root.** If the artifact cites a handoff, and the handoff cites an Axis report, and the Axis report quotes a user message — the root is acceptable. If any link in the chain is agent synthesis without a verbatim root, the attribution smuggles.
4. **Flag each smuggled attribution** with the actual source ("the Apr 21 handoff's agent-synthesized proposed scope"), not the claimed source ("user-approved scope").

### Output

Produce an attribution-presence table in the review findings:

| Attribution | Artifact Location | Claimed Source | Actual Source | Verdict |
|---|---|---|---|---|
| "user approved minimum-viable scope" | `DD052 §1.3` | "user stated" | Apr 21 handoff — agent synthesis from 5 quotes; no verbatim user utterance | SMUGGLED |
| "user chose Pattern B" | `DD052 §2.1` | (no source given) | no traceable source in session transcripts or event records | SMUGGLED |
| "user asked for auth work before May 24" | `DD052 §0` | (no source given) | verbatim user message 2026-04-22 in session log | VERIFIED |

### Critical Rule

An unsourced user-attribution is a conformance failure, not neutral prose. The correct downstream artifact cites the actual source: the handoff's synthesis, the agent that paraphrased, the section of session log where the user spoke. Smuggling compounds across derivations; the earliest catch is cheapest.

### Relationship to Other Passes

Peer to reality-conformance. Reality-conformance verifies primitives against code; attribution-conformance verifies user-intent claims against session or event sources. Run both when the artifact under review mixes technical claims with scope/intent claims — which is most DD and spec work.

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

`lint` catches structural issues: non-monotonic numbering, forbidden forms (line-leading `AC01`-style typos, alphanumeric prefixes like `PH1.01`, multi-letter-segment prefixes like `FOO.AC.01`), unresolved references, and lifecycle/derivation problems. Same-note repeats and bare-id ambiguity are tolerated by design.

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
