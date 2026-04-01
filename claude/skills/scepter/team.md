# SCEpter Agent Teams: Paired-Agent Implementation Protocol

**Read this companion file when operating as part of an agent team.** This defines how producer-reviewer pairs coordinate via DM exchange, how the linker operates as a background tag-along, and protocols for blocking, escalation, and phase transitions.

Ensure you have loaded `@scepter` (the main skill) first. Agents on a team should also read `implementing.md` or `conformance.md` from this directory depending on their role.

## Core Concept

The agent team replaces sequential agent handoffs with **live dialogue pairs**. Instead of "produce artifact → hand off → validate → loop if fail," two agents work the same phase simultaneously: one produces, one reviews, and they exchange feedback as work progresses.

There is exactly **one dialogue pair** and one **background tag-along**:

| Role | Agent | Notes |
|---|---|---|
| Producer | sce-producer | Handles both planning and implementation phases |
| Reviewer | sce-reviewer | Handles both plan validation and impl validation |
| Linker | sce-linker | Tag-along (no pair, runs in background) |
| Researcher | sce-researcher | On-demand (dispatched by producer or reviewer as needed) |

## STRICT: Bash Command Discipline (ALL AGENTS)

**Compound or complex Bash commands trigger a human approval prompt in Claude Code, which STALLS the entire team until a human intervenes.** This is catastrophic to throughput. Every agent MUST follow these rules without exception:

### Prohibited Patterns

1. **NEVER prefix commands with `cd /path/to/dir &&`.** Use the Bash tool's `cwd` parameter to set the working directory.
2. **NEVER chain unrelated commands** with `&&`, `;`, or `echo "---"` separators. Run each command as a separate Bash tool call.
3. **NEVER use heredocs** (`<< EOF`, `<< 'EOF'`), subshell substitutions (`$(cat ...)`), or `echo`/pipe constructions. Use the Write tool for file creation.
4. **NEVER use `grep`, `rg`, `find`, `cat`, `head`, `tail`, `sed`, or `awk` via Bash** when dedicated tools exist. Use Grep for content search, Glob for file search, Read for file reading, Edit for file modification.
5. **NEVER run `git add -A` or `git add .`** — always add specific files by name.
6. **NEVER stage files you did not create or modify as part of your task.** The working tree contains research docs, config files, work logs, and artifacts from prior sessions. They are not yours to stage. If in doubt, do NOT stage it.

### Required Patterns

- **One command per Bash call.** If you need to run `git status` and `bun test`, make two separate Bash tool calls — do NOT combine them.
- **Use dedicated tools first.** Grep tool instead of `grep`/`rg`. Glob tool instead of `find`/`ls`. Read tool instead of `cat`/`head`/`tail`. Edit tool instead of `sed`/`awk`. Write tool instead of `echo >>`/heredocs.
- **Use `cwd` parameter** on the Bash tool instead of `cd` prefixes.
- **Simple quoted strings only** for Bash arguments. No nested quoting, no command substitution.

### Why This Matters

A single compound command requiring human approval can block an agent for the entire duration of the human's absence. In a team, this means the paired agent is also blocked waiting for messages. One bad Bash call can halt the entire team. **When in doubt, use a dedicated tool or split into multiple simple calls.**

## Pre-Dispatch: Execution Assessment

Before dispatching the team, the orchestrator assesses whether the DD requires restructuring of existing code.

### The Check

Inspect the DD's Module Inventory. If the "Modified Files" section includes method removals, caller migrations, interface changes on files with existing consumers, or re-routing of existing call paths — the DD involves **behavior-preserving restructuring**, not just greenfield implementation.

### When Restructuring Is Involved

If a **refactoring skill** is available in the current environment (check the skill list), invoke it before team dispatch. The refactoring skill produces an execution plan that separates behavior-preserving moves (extract, redirect, remove) from feature additions (new implementations, new capabilities). This execution plan supplements the DD's integration sequence — the DD describes the end state; the refactoring plan describes the safe path from the current state to that end state.

The execution plan informs how the producer sequences its work within each phase. Pass it to the producer alongside the DD in the team dispatch prompt.

If no refactoring skill is available, the orchestrator should still assess the restructuring surface and flag it to the producer: "This DD modifies N existing files with M method removals and K caller migration sites. Sequence behavior-preserving changes before feature additions. Test after each caller migration." This is less rigorous than a formal refactoring plan but captures the key discipline: don't mix restructuring and feature work in the same step.

### When It's Greenfield

If the DD is entirely or predominantly new files — new engine implementations, new types, new modules with only minor wiring additions to existing entry points — the DD's integration sequence is the execution plan. Proceed directly to team dispatch.

### Heuristic

| DD Characteristic | Action |
|---|---|
| All new files, few modified | Skip — DD integration sequence is sufficient |
| Mixed new and modified, modifications are additive (new methods, new fields) | Skip — additive changes are low-risk |
| Substantial modifications: method removals, caller migrations, re-routing, interface changes | Load refactoring skill if available; flag restructuring concerns if not |

## The Two Phases

The producer-reviewer pair works through two sequential phases. The same two agents handle both — they transition roles internally based on the phase.

### Phase 1: Planning

The producer drafts the implementation plan. The reviewer verifies each section as it's produced.

**The producer BLOCKS on each section.** Downstream plan sections depend on upstream decisions. Getting section 2 wrong makes sections 3+ wasted work. The producer sends a section, waits for reviewer feedback, incorporates it, then moves on.

**Sequence:**

1. Both agents receive the same task context
2. Both independently explore the codebase (dispatching sce-researcher if needed)
3. Producer drafts first plan section → sends to reviewer via DM
4. Reviewer verifies assumptions, checks APIs, responds with feedback
5. Producer incorporates feedback → moves to next section
6. Repeat until plan is complete
7. Reviewer does final holistic review → APPROVED or NEEDS_REVISION
8. If NEEDS_REVISION: producer addresses specific issues, resubmits
9. On APPROVED: both signal orchestrator, phase ends

### Phase 2: Implementation

The producer writes code. The reviewer reads actual files and checks against the plan.

**The producer does NOT block on every message.** It sends change notifications and continues working. The reviewer responds asynchronously. Only a **STOP** verdict (critical cascading issue) causes the producer to pause. This maximizes throughput.

**Sequence:**

1. Both agents receive the approved plan
2. Producer begins coding in layers
3. After each logical unit → sends change summary to reviewer via DM
4. Reviewer reads actual files, checks against plan → responds with feedback
5. Producer addresses critical issues immediately, queues minor ones
6. On "implementation complete" → reviewer does final pass
7. Reviewer responds: PASS, PARTIAL, or FAIL
8. If not PASS: specific issues sent back, producer addresses them
9. On PASS: both signal orchestrator, phase ends

## Specification Fidelity and Divergence Protocol (ALL AGENTS INCLUDING ORCHESTRATOR)

This section applies to every agent on the team — producer, reviewer, linker — AND to the orchestrator (the main Claude Code session). There are no exceptions.

### The Rule

Implementation is mechanical translation from specification to code. The spec is the contract. The agent's job is to realize the spec precisely, not to "get the task done." When those two goals conflict, fidelity to the spec wins. Always.

### When the Spec Can't Be Implemented As Written

If an agent encounters a divergence — a missing API, a type that doesn't exist, an interface that doesn't match what the spec assumes, a feature that would require changes outside the current scope — the agent MUST:

1. **HALT on that specific piece.** Do not implement it. Do not approximate it. Do not comment it out. Do not stub it and mark it `@implements`.
2. **Continue implementing everything else** that does not depend on the blocked piece. Maximize useful output around the gap.
3. **Report the divergence explicitly.** In a team: send a BLOCKED message to the reviewer and orchestrator. Solo: surface the gap to the user immediately.
4. **Leave the blocked piece visibly unimplemented.** No code, no stub, no workaround. The absence is the signal.

**BLOCKED message format (teams):**
```markdown
## BLOCKED: {CLAIM_ID}

### Spec says
[Exact claim text from the spec/DD]

### Reality
[What actually exists in the codebase — the missing API, wrong type, etc.]

### Why it can't be implemented as specified
[The specific incompatibility]

### What I did instead
Nothing. This piece is untouched, waiting for resolution.

### Impact on surrounding work
[What other claims depend on this, if any]
```

**Solo agent (including orchestrator):** Surface the same information to the user directly. Do not attempt to resolve it yourself unless you have complete certainty that your resolution matches the spec's intent. "Complete certainty" means you can point to a specific claim, decision note, or settled architecture that resolves the ambiguity. If you're reasoning from general principles or guessing what the spec probably meant, that's not certainty — yield to the user.

### The One Exception

Purely internal implementation details — variable names, loop structure, local algorithm choice, private helper functions — that are invisible to every external consumer and have zero upstream or downstream effects may be decided by the agent. The test: if changing this decision would require updating any claim, any test assertion, any public API, or any other file, it is NOT a purely internal detail.

### Deferral Authority (CRITICAL — No Agent May Self-Defer)

**Only the user can defer a spec claim.** No agent — producer, reviewer, orchestrator — has the authority to decide that a DC or AC is "deferred," "out of scope," "not needed," or "can be added later."

**"Not started" does not mean "deferred."** A DD's Projection Coverage table, status fields, or phase descriptions may say "Not started" or "Not implemented" for a projection. This is a **status description** of the current state, not a deferral directive. Unless the DD or requirement explicitly says "deferred" or "out of scope" with a rationale, every DC and AC is in scope and must be implemented.

**If a producer believes something should be deferred**, they MUST send a BLOCKED message explaining why and wait for the user's decision. The producer does not skip the work. The reviewer does not accept "known gap" as a verdict category for claims that were never authorized as deferrals.

**Violation examples:**
- Reading a DD's "CLI: Not started" status and treating it as permission to skip CLI implementation
- Accepting a DD's "no code changes needed" assertion without verifying it against the actual codebase
- Classifying an unimplemented DC as an "acceptable gap" or "known deferral" in a review verdict

### What Counts as Silent Divergence (Protocol Violation)

All of the following are protocol violations equivalent in severity to data loss:

- **Commenting out a requirement** ("can be added later") without escalating
- **Excluding a test case or backend** that the spec lists, without escalating
- **Stubbing a function and annotating it `@implements`** (see claims.md — use `@see` and `:deferred`)
- **Narrowing scope** (e.g., "we'll skip Neo4j for now") without escalating
- **Self-deferring a claim** (treating "not started" as "deferred," or deciding a DC doesn't need implementation)
- **Accepting unverified DD assertions** (e.g., "no code changes needed" without checking the actual types/interfaces)
- **Inventing an API or type** that doesn't exist in the codebase to make the spec work
- **Using `as unknown as`** or other type-system escapes to force a round peg into a square hole
- **Proceeding with incomplete context** when the agent isn't sure whether the spec can be satisfied

### Escalation Path for BLOCKED Items

When the orchestrator receives a BLOCKED message from a subagent:

1. **Assess whether the orchestrator can resolve it directly.** A resolution is valid ONLY if it requires no spec interpretation — e.g., adding a missing getter method, fixing an import path, correcting a type name that was renamed. The fix must be mechanical and obvious.
2. **If the orchestrator can resolve it:** make the fix, notify the producer, and log what was done. The producer resumes on that piece.
3. **If the orchestrator cannot resolve it** — because the resolution requires a design choice, a scope decision, a spec clarification, or anything that involves judgment about what the system should do — **escalate to the user immediately.** Present the BLOCKED message contents and wait for the user's decision.
4. **The orchestrator does NOT have authority to silently defer.** "We'll skip this for now" is not an orchestrator-level decision. Only the user can defer a spec claim.

### Orchestrator Responsibilities (Fidelity)

The orchestrator (main session agent) is not exempt from this protocol. When subagents or the orchestrator's own work encounters a spec divergence:

1. **Surface it to the user.** Do not resolve ambiguities by reasoning about what the spec "probably" means.
2. **Present the divergence clearly**: what the spec says, what reality is, why they don't match.
3. **Wait for the user's decision** before proceeding on the blocked piece.
4. **Do not relay subagent workarounds as completed work.** If a subagent reports "done" but worked around a spec requirement, the orchestrator must flag it, not pass it through.

### Reviewer Enforcement — Adversarial Posture (CRITICAL)

The reviewer's job is not just to review — it is to assume the producer will cut corners, skip work, misread the spec, and silently narrow scope. The reviewer must be **adversarial to the producer's claims of completeness.** When a producer says "all phases complete," the reviewer's default posture is skepticism, not trust.

The reviewer MUST specifically check for silent divergences during every review pass:

- Scan for commented-out features or test cases that reference spec claims
- Check whether all backends/scenarios listed in the spec are present in the implementation
- Verify `@implements` annotations point to real implementations, not stubs (see claims.md)
- Run `tsc --noEmit` (or the project's type checker) before issuing any verdict — a PASS on code that doesn't compile is void
- Compare the scope of what was implemented against the scope of what was specified — are any claims quietly missing?
- **Check every DC in the DD against the actual files.** Do not accept the producer's summary of what was implemented. Read the files yourself.
- **Verify "no code changes needed" assertions.** If a DD claims that something works automatically or requires no implementation, the reviewer MUST verify this by reading the actual code, types, and interfaces. An unverified assertion is not evidence.
- **Do not rationalize gaps.** If a DC was not implemented, the verdict is FAIL or PARTIAL with the gap flagged as a protocol violation — not "acceptable gap," "known deferral," or "maintenance invariant." The reviewer does not have authority to accept deferrals that the user didn't authorize.
- **Do not accept "Not started" as deferral.** If a DD's Projection Coverage or status table says "Not started" for a projection, and the DD contains DCs for that projection, those DCs are in scope. The status description is not a deferral directive.

A reviewer who passes silent divergence shares responsibility for the protocol violation. A reviewer who rationalizes gaps as "acceptable" or "known" without user authorization is committing the same violation as a producer who skips work.

## The Tag-Along: Linker

The `sce-linker` runs as a **background task after each dialogue phase completes**. It does not participate in any pair. No agent needs to interact with it, wait for it, or send it messages.

**After planning phase completes:**
- Linker processes plan artifacts: connects new plan notes to existing requirements, decisions, questions
- Links the plan to the originating task
- Runs with `run_in_background: true`

**After implementation phase completes:**
- Linker processes code changes: adds `@implements`, `@depends-on`, `@see` references
- Closes loops on questions answered by the implementation
- Updates task status and cross-references
- Runs with `run_in_background: true`

**The linker does not block phase transitions.** If planning is done and the linker is still processing planning artifacts, the implementation phase starts immediately. The orchestrator only collects linker output before the final user review.

## On-Demand Research: Researcher

The `sce-researcher` is not part of any pair or phase. Either the producer or reviewer can dispatch it when they need to:
- Search the knowledge graph for prior decisions or requirements
- Explore unfamiliar code paths
- Trace execution flow through the codebase
- Build context about a subsystem before producing or reviewing

The researcher runs as a subagent of whoever dispatched it, returns findings, and terminates. It does not participate in the DM exchange protocol.

## DM Exchange Protocol

Agents communicate via `SendMessage` with `type: "message"`. Messages use lightweight markdown conventions, not rigid JSON.

### Producer → Reviewer Message

```markdown
## Section Review: [Section Name]

### Plan Step
[Which step/requirement this addresses]

### Content
[The actual plan section or code change summary]

### Files Touched
- path/to/file.ts (new/modified/deleted)

### Assumptions Made
- [Assumptions that need verification]

### Questions for Reviewer
- [Specific things to check]
```

### Reviewer → Producer Message

```markdown
## Review: [Section Name]

### Verdict: LGTM | ISSUES | STOP

### Findings
- [Observations, verified claims, issues]

### Verified
- [Assumptions confirmed with evidence: file path, line number]

### Action Required
- [Specific changes needed, if any]
```

### Verdict Meanings

| Verdict | Meaning | Producer Action |
|---|---|---|
| **LGTM** | Section/change is good | Proceed to next section |
| **ISSUES** | Non-critical problems found | Address before proceeding (planning) or queue for fix (implementation) |
| **STOP** | Critical cascading issue | Stop immediately, address before any further work |

### Completion Messages

**Producer signals completion:**
```markdown
## Phase Complete: [Planning/Implementation]

### Summary
[Brief description of what was produced]

### Artifacts
- [List of files/notes created or modified]

### Ready for final review
```

**Reviewer signals final verdict:**
```markdown
## Final Review: [Planning/Implementation]

### Verdict: APPROVED | PASS | NEEDS_REVISION | PARTIAL | FAIL

### Assessment
[Holistic evaluation]

### Outstanding Items
- [Any remaining issues, if applicable]
```

## Blocking Behavior Summary

| Phase | Producer Blocks? | Rationale |
|---|---|---|
| Planning | **Yes**, per section | Downstream sections depend on upstream decisions |
| Implementation | **No**, async notifications | Code units are more independent; throughput matters |
| Linker | N/A - background | Nobody waits for it |
| Researcher | N/A - on demand | Dispatched as subagent, returns results |

**Exception**: Even in the implementation phase, a **STOP** verdict means the producer must pause and address the issue before continuing. STOP is reserved for problems that would cascade if ignored.

## Escalation Patterns

### Disagreement Loop
If the producer and reviewer exchange 3 rounds on the same issue without resolution:
1. Producer sends a message to the orchestrator summarizing both positions
2. Orchestrator presents the disagreement to the user
3. User decides; orchestrator relays the decision

### Agent Timeout
If an agent doesn't respond within a reasonable number of turns:
1. Orchestrator checks idle status
2. Sends a check-in message
3. If still unresponsive after check-in, escalates to user

### Critical Failure
If the reviewer issues FAIL on final review:
1. Orchestrator collects the failure report
2. Presents to user with options: retry with feedback, manual intervention, or abort
3. On retry: implementation phase restarts with failure context

## Orchestrator Responsibilities

The orchestrator (user's Claude Code session) manages:

1. **Team lifecycle**: `TeamCreate` → coordinate → `TeamDelete`
2. **Phase transitions**: Spawn pair, monitor completion, advance to next phase
3. **Linker dispatch**: Fire linker in background after each phase
4. **Linker collection**: Wait for linker output before user review
5. **Researcher dispatch**: Available to any agent that requests context
6. **Escalation handling**: Surface disagreements, failures, and BLOCKED items to user
7. **Shutdown**: Graceful `shutdown_request` to all agents when done

The orchestrator does NOT implement or review. It coordinates. But coordination includes verification — the orchestrator is not a relay.

### Independent Verification (MANDATORY)

**The orchestrator MUST NOT present agent verdicts to the user without independent verification.** An agent saying "PASS" or "216 tests passing" is a claim, not a fact. Before presenting results to the user:

1. **Run `tsc --noEmit`** (or the project's type checker) yourself. If it fails, the agent's verdict is void regardless of what they reported.
2. **Run the test suite** yourself. If it fails, same.
3. **Spot-check scope alignment.** Compare what the spec said should be implemented against what the agent says it implemented. Are any claims missing from the agent's report? Are any backends, scenarios, or test dimensions from the spec absent?
4. **Check for BLOCKED items that were silently resolved.** If the agent originally reported a divergence and later reported success, verify the resolution was correct — don't assume.

If independent verification reveals problems, do NOT present the agent's verdict to the user. Present the actual state: "The agent reported PASS, but `tsc --noEmit` shows 5 errors" or "The agent excluded Neo4j from the test matrix despite the spec requiring it."

The cost of this verification is minutes. The cost of relaying a false PASS is a user who trusts a broken implementation.

## Agent Skill Loading

All team agents load `@scepter` (which includes rules, CLI reference, and core concepts). Then they read companion files based on their role:

- **Producer**: Read `implementing.md` from this directory + `claims.md`
- **Reviewer**: Read `conformance.md` from this directory + `claims.md`
- **Linker**: Read `conformance.md` from this directory
- **Researcher**: No additional companion files needed (reads `@scepter` only)

All agents also read **this file** (`team.md`) to understand the DM exchange protocol and their role.

### Claims Awareness (ALL AGENTS)

**Every agent on the team MUST read `claims.md` from this skill directory** if the task context contains claim IDs (patterns like `§1.AC.01`, `R004.§3.AC.02`, `SEC.03`). Claims are SCEpter's sub-document traceability system — they are how individual acceptance criteria, constraints, and specifications are tracked across projections.

- **Producers** must reference specific claims from upstream requirements, not just whole notes
- **Producers** must add `@implements {NOTE.§N.PREFIX.NN}` annotations for each claim they satisfy
- **Reviewers** must verify claim coverage — every claim in the reference material should have a corresponding annotation in the implementation
- **Reviewers** must check claim health during review (see below)
- **Linkers** must ensure claim references are properly connected in the knowledge graph

### Reviewer Claim Health Check

The reviewer MUST run claim health checks at two points:

**Before planning phase begins** (orientation):
```bash
# Trace coverage for all notes referenced by the task
scepter claims trace NOTEID

# Search for related claims the task might not reference
scepter claims search "KEYWORD"
```

Report any claims that lack source coverage, any lint errors, or any related claims the task doesn't reference. This prevents the producer from working against stale or incomplete context.

**During final review** (both phases):
```bash
# Verify coverage after implementation
scepter claims trace NOTEID

# Check for gaps
scepter claims gaps --note NOTEID

# Lint for structural issues introduced during work
scepter claims lint NOTEID
```

The reviewer's final verdict (PASS/PARTIAL/FAIL) MUST account for claim health. A PARTIAL verdict is appropriate when code is correct but claim coverage is incomplete (missing `@implements` annotations, claims in the spec that have no corresponding code).
