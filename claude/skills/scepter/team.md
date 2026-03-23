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

### Required Patterns

- **One command per Bash call.** If you need to run `git status` and `bun test`, make two separate Bash tool calls — do NOT combine them.
- **Use dedicated tools first.** Grep tool instead of `grep`/`rg`. Glob tool instead of `find`/`ls`. Read tool instead of `cat`/`head`/`tail`. Edit tool instead of `sed`/`awk`. Write tool instead of `echo >>`/heredocs.
- **Use `cwd` parameter** on the Bash tool instead of `cd` prefixes.
- **Simple quoted strings only** for Bash arguments. No nested quoting, no command substitution.

### Why This Matters

A single compound command requiring human approval can block an agent for the entire duration of the human's absence. In a team, this means the paired agent is also blocked waiting for messages. One bad Bash call can halt the entire team. **When in doubt, use a dedicated tool or split into multiple simple calls.**

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
6. **Escalation handling**: Surface disagreements and failures to user
7. **Shutdown**: Graceful `shutdown_request` to all agents when done

The orchestrator does NOT implement or review. It coordinates.

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
