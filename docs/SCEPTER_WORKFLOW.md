# SCEpter Workflow

**Operational guide for working in (and on) SCEpter.** This doc is the integration layer above the skill files — it answers "given a stage of work, what do I do, what does SCEpter do, and what changes in the graph?" The conceptual sections are short by design; the recipe book at the bottom is where most readers will spend time.

The single-source companions live under `~/.claude/skills/scepter/` (mirrored from `claude/skills/scepter/` in this repo). When this doc cites a rule or table, the citation points to the file that defines it. **Do not duplicate; load the citation when needed.**

---

## Table of Contents

1. [Purpose and audience](#1-purpose-and-audience)
2. [Bootstrap — how a session starts](#2-bootstrap--how-a-session-starts)
3. [The knowledge graph in one page](#3-the-knowledge-graph-in-one-page)
4. [Operation routing — what to do for what task](#4-operation-routing--what-to-do-for-what-task)
5. [The process loop](#5-the-process-loop)
6. [Authoring discipline](#6-authoring-discipline)
7. [Implementation discipline](#7-implementation-discipline)
8. [Review discipline](#8-review-discipline)
9. [Linking and graph hygiene](#9-linking-and-graph-hygiene)
10. [Team protocol](#10-team-protocol)
11. [Closing and verification](#11-closing-and-verification)
12. [Reference appendix](#12-reference-appendix)
13. [Recipes](#13-recipes)

---

## 1. Purpose and audience

This guide serves two readers:

- **An agent (or human contributor) joining a SCEpter project** who needs to know which surface to touch for a given stage of work.
- **A SCEpter contributor working on the SCEpter system itself**, who needs to keep dogfooding discipline — every change to the system goes through the same workflow this doc describes.

The doc is a **router and recipe book**, not a re-explanation of the skill files. Where a topic has authoritative coverage in another file (the skill `SKILL.md`, `claims.md`, `process.md`, `team.md`, the artifact companions, the agent definitions), this doc cites the file and stops. Stage-specific procedures live in the recipes.

**What this doc is not:**
- Not a tutorial. Read `~/.claude/skills/scepter/SKILL.md` first; that's the core orientation.
- Not a CLI reference. That's `cli.md` in the skill directory.
- Not an architecture overview. That's `docs/architecture/ARCHITECTURE_OVERVIEW.md`.

---

## 2. Bootstrap — how a session starts

The first move in any session is `Skill(scepter)`. The project's `CLAUDE.md` enforces this with a FIRST ACTION RULE block. The rationale and the diagnosis behind that rule live in the project-internal bootstrap-recommendations doc.

**The cold-start sequence:**

1. **Invoke the skill** — `Skill(scepter)`. This loads the non-negotiable rules, the operation routing tree, and the companion-file map. Until this fires, no other tool call is correct.
2. **Run `scepter config`** — confirms the project's note types, shortcodes, status modes, and discovery paths. Never assume.
3. **Run the Orientation Protocol** — defined in `process.md` § Orientation. Thirty seconds of `trace` / `lint` / `stale` / `search` on the active notes tells you the state of the world before you touch anything.
4. **Resolve any in-flight work** — if a process Task note exists for the current initiative (`scepter list -t T --status in_progress --tags process`), gather it (`scepter ctx gather TASK_ID`) and resume from its Frontier rather than re-deriving context.
5. **Then engage with the user's request.**

**See:** Recipe R1 (cold start) and R2 (resume after compact). The bootstrap-rec doc captures the diagnosis if a session does not start cleanly.

---

## 3. The knowledge graph in one page

This is a survival summary. The authoritative coverage is in the skill `SKILL.md` and `claims.md`.

**Notes** are atomic markdown files with sequential IDs (`R001`, `DD003`, `S004`). Note types and their folders are configured per project in `scepter.config.json`; **never assume types or paths** — run `scepter config` first.

**References** form a bidirectional graph. `{R001}` written in a note creates an outgoing reference from the writing note to R001 and an incoming reference from R001 to the writing note. References from source code use comment annotations: `@implements`, `@validates`, `@depends-on`, `@addresses`, `@see`.

**Claims** are sub-note addressable units (acceptance criteria, design constraints, security claims). A claim ID like `R004.§3.AC.01` identifies a specific assertion within R004 section 3. Claim references in code use the same syntax (`@implements {R004.§3.AC.01}`). Claims are projected across documents — a single claim manifests as a requirement AC, a derived design DC, a test `@validates` annotation, and an `@implements` annotation in code. The **trace matrix tracks expressions, not truth** — coverage means someone wrote the annotation, not that it's correct.

**Lifecycle** is encoded in metadata suffixes: `:closed`, `:deferred`, `:removed`, `:superseded=TARGET`, plus importance digits `:1`–`:5` and derivation `:derives=TARGET`.

**Cross-project citations** use kebab-case alias prefixes (`{vendor-lib/R005.§1.AC.01}`). Peer claims do not enter the local index, derivation graph, or trace matrix — they are read-only display pointers. `derives=` and `superseded=` MUST NOT cross projects (linter errors `cross-project-derives` and `cross-project-superseded`).

**See:** `claims.md` for the full claim system, `~/.claude/skills/scepter/SKILL.md` for the rules and routing.

---

## 4. Operation routing — what to do for what task

The skill's `SKILL.md` contains the canonical routing tree. The summary:

| Operation | Surface to use |
|---|---|
| Producing an artifact (req / DD / spec / test plan / impl / docs update) | Dispatch `sce-producer`. Do not produce inline. |
| Reviewing or validating | Dispatch `sce-reviewer` with one of three pass types: **review** (completeness + coherence), **conformance** (X matches Y?), **impact** (what did a structural change break?). |
| Investigating, tracing, debugging | Dispatch `sce-researcher`. Read-only by design. |
| Connecting / linking after work | Dispatch `sce-linker` in the background. NON-NEGOTIABLE rule 10. |
| Multi-step feature work spanning operations | Drive the **process loop** (§5) at the top level; dispatch sub-agents for specific operations. |

**The four agents at a glance:**

| Agent | Role | Typical companion files |
|---|---|---|
| `sce-producer` | Writes artifacts with claim traceability. | Whichever `artifacts/<type>.md` matches the artifact, plus `claims.md` and `implementing.md` for code work. |
| `sce-reviewer` | Validates artifacts against sources. | `reviewing.md` (review pass), `conformance.md` (conformance pass), `implementing.md § Impact Analysis` (impact pass). |
| `sce-researcher` | Investigates and reports. Read-only. | None mandatory — context-frugal by design. |
| `sce-linker` | Adds missing references and `@implements` annotations after work. Background. | `conformance.md`. |

**See:** the agent definition files at `claude/agents/sce-*.md` for full dispatch contracts.

---

## 5. The process loop

When work spans multiple operations (author → derive → implement → review), the orchestrator drives a process loop tracked in a SCEpter Task note tagged `process`. The loop survives compacts.

**Scaffold:** Scope (one sentence) / Active Notes (table: ID, role, status) / Frontier (flat bullet list of concrete next actions) / Log (append-only dated entries). See `process.md` § Process Task Scaffold for the exact structure.

**On start:** Check for an existing process Task; if none, create one. Populate Scope, seed Active Notes and Frontier, run the Orientation Protocol.

**On resume:** Gather the process Task. Re-run Orientation. Read the Frontier. Propose the highest-impact item. Wait for ack before large operations.

**After every operation:** Update Active Notes, prune/add Frontier items, append to Log.

**See:** `process.md` for the full loop, the dispatching tables (which producer / reviewer pass goes with which Frontier item), and the Orientation Protocol commands.

---

## 6. Authoring discipline

Before writing any numbered claim, run the **Authoring Litmus** in `claims.md`: modal character (existence / behavior / integration / constraint / ordering / invariant), testability (can a tester write a pass/fail test?), and layer (claim layer vs. specification layer). A line that fails any filter is not a claim — move it to overview prose, scope, or design principles.

**Decomposition signals:** if a claim bundles multiple modal characters or crosses projection boundaries, decompose with `derives=`. The file-count heuristic (4+ files → decompose) is secondary; the projection-boundary signal is primary.

**Status authoring rules:** frontmatter `status` is updated FIRST, then progress notes describing the change. Producers leave new artifacts at the pending-equivalent default — never author with `status: accepted`. `completed`, `done`, and `approved` are user-only transitions; agents stop at `ready_for_review`.

**Anti-patterns to recognize:** smuggling (agent-authored content treated as user-authored across compactions), stub `@implements` (annotation claims realization the code doesn't deliver), reality gaps (a doc cites a primitive that doesn't exist), dead provenance (preserving old wrong state inline when correcting), fake dates (use `date "+%Y-%m-%d"`).

**See:** `claims.md` § Authoring Litmus and § Smuggling, `status-management.md` for the full status discipline.

---

## 7. Implementation discipline

`@implements` MEANS ACTUALLY IMPLEMENTED. A stub, no-op, or hardcoded-empty-result MUST carry `@see` + `:deferred` on the claim, not `@implements`. A stub annotation poisons the trace matrix.

**Spec-fidelity / divergence protocol** (`team.md` § Specification Fidelity): when a spec can't be implemented as written, HALT on that piece, continue everything else, send a BLOCKED message (or surface to user solo), leave the blocked piece visibly unimplemented. **No agent may self-defer.** "Not started" is a status description, not a deferral directive — only the user can defer a claim.

**See:** `implementing.md` for the full implementation companion (called by producers and by impact-pass reviewers); `claims.md` § In Code for the annotation table.

---

## 8. Review discipline

Three pass types, each loading its companion file:

- **Review pass** (`reviewing.md`) — completeness, AC interaction coverage, binding assessment, coherence, staleness. Run before implementation begins.
- **Conformance pass** (`conformance.md`) — does artifact X match source Y? implementation conformance, plan validity, reality conformance (cited primitives EXIST), claim coverage. Run after implementation.
- **Impact pass** (`implementing.md § Impact Analysis`) — what did a structural change break? structural property cascade, dispatch signal audit, trace regression. Triggered by discovery.

**Adversarial posture:** the reviewer assumes the producer cut corners. Verify every DC in the DD against the actual files. Verify "no code changes needed" assertions by reading the code. Do not rationalize gaps as "acceptable" or "known deferral" without recorded user authorization.

**Routing reviewer findings:** classify each finding before acting (NON-NEGOTIABLE rule 11). Mechanical findings (typos, citation updates, missing bidirectional refs, stub-`@implements`-to-`@see` conversions, format alignment) → dispatch `sce-producer` with the specific finding(s). Human-judgment findings (scope changes, naming alternatives, classification framings) → surface to user. Failure-to-follow-source is NOT human judgment — default to MECHANICAL revert/flesh-out.

**See:** `reviewing.md`, `conformance.md`, and `team.md` § Reviewer Enforcement.

---

## 9. Linking and graph hygiene

After any substantive work cycle that touches SCEpter notes or `@implements`-annotated code, dispatch `sce-linker` in the background (NON-NEGOTIABLE rule 10). The linker handles:

- Missing `@implements` / `@validates` / `@depends-on` annotations
- Bidirectional reference hygiene
- Supersession lifecycle tags
- Cross-references between produced notes and adjacent graph context

**Dispatch with `run_in_background: true`.** The linker should not block the next user-facing decision. The orchestrator collects linker output before the final user review.

**See:** `team.md` § The Tag-Along: Linker.

---

## 10. Team protocol

When the work warrants paired-agent coordination (long DD, restructuring), use the team protocol: one producer-reviewer dialogue pair, one linker tag-along, on-demand researcher.

**Two phases:**
- **Phase 1 (planning)** — producer blocks per section; reviewer verifies as work progresses.
- **Phase 2 (implementation)** — producer does NOT block; reviewer responds asynchronously. Only a STOP verdict pauses the producer.

**Pre-dispatch refactoring assessment:** if the DD's Module Inventory shows method removals, caller migrations, or interface changes on existing-consumer files, load the refactoring skill (if available) before team dispatch. Behavior-preserving changes sequence before feature additions.

**Independent verification (orchestrator MANDATORY):** before relaying any agent verdict to the user, run `tsc --noEmit` and the test suite yourself, spot-check scope alignment, and verify any silently-resolved BLOCKED items.

**See:** `team.md` for the full protocol — DM exchange, verdict meanings, escalation patterns, fidelity rules for all roles including orchestrator.

---

## 11. Closing and verification

A process Task moves to `ready_for_review` when:

1. `scepter claims trace` shows source coverage for all active notes' claims
2. `scepter claims gaps` is clean for all active notes
3. The Frontier is empty (or contains only deferred items the user authorized)

The user decides when to mark `completed` (NON-NEGOTIABLE rule on user-only transitions).

**Verification events** record explicit confirmation of constraint, ordering, or invariant claims that absence-testing alone can't capture:

```bash
scepter claims verify R004.§1.AC.03 --actor "developer" --method "code review"
```

**Staleness checks** compare verification dates against file modification times — `scepter claims stale --note NOTEID` flags claims whose underlying code has changed since last verification.

**See:** `claims.md` § CLI Tools for the verification and staleness commands; `process.md` § When to Close.

---

## 12. Reference appendix

### A. CLI cheat-sheet pointer
The full command catalog is in `~/.claude/skills/scepter/cli.md`. Always invoke as plain `scepter <subcommand>`, never with `./scepter`, `pnpm tsx`, or absolute paths. If `scepter` is not on `$PATH`, STOP and surface to the user — do not work around with `tsx core/src/cli/index.ts`.

### B. Companion-file map (which file answers which question)

| Question | File |
|---|---|
| What are the non-negotiable rules? | `SKILL.md` |
| What is the operation routing tree? | `SKILL.md` § Companion Files |
| How do I write a claim? | `claims.md` § Authoring Litmus + § Authoring Claims |
| What CLI commands exist for claims? | `claims.md` § CLI Tools |
| How do I drive multi-operation work? | `process.md` |
| How do agents on a team coordinate? | `team.md` |
| How do I write code from a design? | `implementing.md` |
| How do I review a claim stack? | `reviewing.md` |
| How do I check that X matches Y? | `conformance.md` |
| What status transitions are valid? | `status-management.md` |
| What's the epistemic vocabulary? | `epistemic-primer.md` |
| What's the CLI command syntax? | `cli.md` |
| What artifact template fits my task? | `artifacts/{requirements,specification,architecture,detailed-design,test-plan,implementation}.md` |

### C. Agent dispatch templates

**Producer (artifact authoring):**
```
Dispatch sce-producer to author {ARTIFACT_TYPE} for {SOURCE_NOTE_OR_DESCRIPTION}.
Companion files: {claims.md, artifacts/<type>.md}.
Carry forward claims from: {SOURCE_IDS}.
Output location: {INFER_FROM_CONFIG_OR_ASK}.
```

**Reviewer (review / conformance / impact pass):**
```
Dispatch sce-reviewer for a {review|conformance|impact} pass on {ARTIFACT}.
Source: {SOURCE_NOTE_OR_FILE}.
Companion: {reviewing.md|conformance.md|implementing.md}.
Tag findings MECHANICAL or HUMAN_JUDGMENT.
```

**Researcher (investigation):**
```
Dispatch sce-researcher to investigate {SPECIFIC_QUESTION}.
Search both knowledge graph and codebase.
Read-only — report findings, do not modify.
```

**Linker (graph hygiene, background):**
```
Dispatch sce-linker (run_in_background: true) to enhance graph after {WORK_DESCRIPTION}.
Focus areas: {ANNOTATIONS|BIDIRECTIONAL_REFS|SUPERSESSION_TAGS|CROSS_REFS}.
```

---

## 13. Recipes

Each recipe has the same shape:

> **Core:** one-line description with relevant note/claim refs.
> **Trigger:** when to reach for it.
> **What happens:**
> - **You / orchestrator:** what the driving agent does.
> - **SCEpter CLI:** which commands fire and what they index/produce.
> - **Sub-agents:** which sub-agents are dispatched and with what mandate.
> - **Graph effect:** what changes in notes, references, claims, or annotations.
>
> **Steps:** 5–10 ordered actions.
> **Slips:** common ways the recipe goes wrong.

---

### R1. Cold session start

**Core:** Invoke the skill, confirm config, orient — before doing anything else. Enforced by FIRST ACTION RULE in `CLAUDE.md`.

**Trigger:** First turn of any session in a SCEpter project.

**What happens:**
- **You / orchestrator:** invoke `Skill(scepter)`; resist the urge to "answer the small question first."
- **SCEpter CLI:** `scepter config` (confirms types, shortcodes, paths); optional `scepter list -t T --status in_progress --tags process` to find any in-flight process Task.
- **Sub-agents:** none yet — orientation is solo.
- **Graph effect:** none. This is read-only orientation.

**Steps:**
1. `Skill(scepter)`.
2. `scepter config`.
3. Search for an in-flight process Task: `scepter list -t T --status in_progress --tags process`.
4. If a process Task exists for the current initiative → `scepter ctx gather TASK_ID` and jump to R2.
5. Else, run the Orientation Protocol on whatever notes are referenced in the user's request (or the most-recently-modified active notes if the request is generic).
6. Engage with the user's request.

**Slips:**
- Reading `ARCHITECTURE_OVERVIEW.md` first (the FIRST ACTION RULE forbids it).
- Glob/Grep on `_scepter/` to "see what's there" — bypasses the CLI (NON-NEGOTIABLE rule 2).
- Asking the user clarifying questions before the skill is loaded.

---

### R2. Resume an in-flight feature after compact

**Core:** Re-load the process Task scaffold, re-run Orientation, propose the next Frontier item. See `process.md` § On Resume.

**Trigger:** Session restart after a compact, or any time the orchestrator believes context has been lost.

**What happens:**
- **You / orchestrator:** gather the process Task; re-derive nothing that's already in the scaffold.
- **SCEpter CLI:** `scepter ctx gather TASK_ID`, then `scepter claims trace` / `lint` / `stale` on Active Notes.
- **Sub-agents:** none until the user acks the proposed next item.
- **Graph effect:** none yet. The Log gets a "resumed at <date>" entry once the next item begins.

**Steps:**
1. `scepter ctx gather TASK_ID` (the process Task's ID).
2. Run Orientation on every Active Note in the scaffold.
3. Read the Frontier; classify items by impact (coverage gaps > blockers > discovery > everything else).
4. Propose the highest-impact item to the user.
5. Wait for ack.
6. On ack, append `## YYYY-MM-DD — resumed; next: <Frontier item>` to the Log and proceed per the relevant recipe.

**Slips:**
- "Just continue from where you left off" without re-running Orientation — the claim graph may have changed.
- Re-deriving Active Notes from prose summaries instead of trusting the scaffold.

---

### R3. Capture a new requirement from a conversation

**Core:** Search → create → fill claims using the Authoring Litmus. See `claims.md` § Authoring Litmus.

**Trigger:** The user describes a need that doesn't have an existing requirement note.

**What happens:**
- **You / orchestrator:** search before creating; dispatch the producer for authoring.
- **SCEpter CLI:** `scepter search "<keyword>"`, `scepter list --types Requirement --tags <tag>`, then `scepter create Requirement "<title>" --tags ...`.
- **Sub-agents:** `sce-producer` with `artifacts/requirements.md` + `claims.md` to draft ACs.
- **Graph effect:** new R-note added to the index, with claim entries for each AC. Bidirectional refs to any cited source notes.

**Steps:**
1. Search for existing coverage: `scepter search "<topic>"`, `scepter list --types Requirement --tags <tag>`.
2. If a near-match exists, surface it to the user before creating.
3. Else: `scepter create Requirement "<title>" --tags ...`. Read the assigned ID from CLI output.
4. Dispatch `sce-producer` to author the body, citing the conversation as the source.
5. Producer applies the Authoring Litmus filters before writing each AC.
6. Verify with `scepter claims trace <NEW_ID>` — the note should appear with its ACs.
7. Dispatch `sce-linker` in the background.

**Slips:**
- Guessing the new ID before reading CLI output.
- Inventing ACs the user didn't state ("note questions to clarify rather than inventing specifications").

---

### R4. Derive a detailed design from a requirement

**Core:** Decompose high-binding ACs into DCs with `derives=`. See `claims.md` § Derivation and Binding Assessment.

**Trigger:** A requirement is settled and the next concretization is a Detailed Design.

**What happens:**
- **You / orchestrator:** dispatch the producer with the source requirement and the DD artifact companion.
- **SCEpter CLI:** `scepter claims trace R<NN>` before; `scepter create DetailedDesign "<title>"` to allocate the DD note.
- **Sub-agents:** `sce-producer` with `artifacts/detailed-design.md` + `claims.md`.
- **Graph effect:** new DD note with DCs carrying `derives=R<NN>.§<S>.AC.<NN>`. Bidirectional refs from DD to source requirement and to any architectural notes consulted.

**Steps:**
1. `scepter claims trace R<NN>` — record current coverage as baseline.
2. `scepter create DetailedDesign "<title>" --tags ...`. Note the assigned ID.
3. Dispatch `sce-producer` with the source requirement, the new DD ID, and `artifacts/detailed-design.md`.
4. Producer assesses binding for each source AC: pass-through (1–3 files, 1 module) vs. decompose (4+ files OR projection-boundary crossing).
5. Producer writes DCs using `:derives=R<NN>.§<S>.AC.<NN>`.
6. `scepter claims lint DD<NN>` — fix any structural errors.
7. `scepter claims trace R<NN>` — DD column should now show coverage for each AC.
8. Dispatch `sce-reviewer` for a review pass against the source requirement (R9).
9. Dispatch `sce-linker` in the background.

**Slips:**
- Pass-through annotation on a 4+-file claim — produces an `@implements`-bearing claim that nobody can actually realize as one unit.
- Decomposing into DCs that bundle different modal characters — defeats the point of decomposition.

---

### R5. Write a specification across many parallel entities

**Core:** Choose entity-as-section OR entity-as-prefix. Never `FOO.AC.01`. See `claims.md` § Spec authoring with many entities.

**Trigger:** A spec covers N parallel entities (Foo, Bar, Baz…) each with M acceptance criteria.

**What happens:**
- **You / orchestrator:** decide which axis carries the entity (sections or prefix), pass the convention to the producer.
- **SCEpter CLI:** `scepter create Specification "<title>"`, then `scepter claims trace S<NN>` after authoring.
- **Sub-agents:** `sce-producer` with `artifacts/specification.md` + `claims.md`.
- **Graph effect:** new spec note with claim IDs that the parser actually recognizes.

**Steps:**
1. Decide axis: **(A)** entity-as-section (`## §1 Foo` with `AC.01`, `AC.02`) — preferred when the AC/SEC/PERF distinction matters; **(B)** entity-as-prefix (`FOO.01`, `FOO.02`) — preferred when entity context dominates and the AC distinction doesn't.
2. Allocate the spec note.
3. Dispatch `sce-producer` with the chosen axis explicit in the prompt.
4. Producer writes claims in the chosen shape only — the parser silently drops `FOO.AC.01`-style two-letter-segment IDs.
5. `scepter claims lint S<NN>` — confirms structural validity.
6. `scepter claims trace S<NN>` — confirms claims appear in the index. If the trace shows "No claims found," the format is wrong.
7. Dispatch `sce-linker` to add cross-references to upstream requirements/architecture notes.

**Slips:**
- Combining axes (`FOO.AC.01`) — silent parser drop; trace matrix shows zero claims.
- `**FOO.01** \`text\`` (bold + code span) — not recognized as a claim.

---

### R6. Author a test plan

**Core:** Map each AC/DC to a `@validates` plan. See `claims.md` § Modal character (constraint/ordering/invariant claims need `@validates`, not just `@implements`).

**Trigger:** A requirement and DD exist; implementation will follow; the test surface needs to be planned.

**What happens:**
- **You / orchestrator:** dispatch the producer with the test-plan companion.
- **SCEpter CLI:** `scepter create TestPlan "<title>"`, then `scepter claims trace` after.
- **Sub-agents:** `sce-producer` with `artifacts/test-plan.md` + `claims.md`.
- **Graph effect:** new TP note. Test files later carry `@validates` annotations referencing the AC/DC IDs.

**Steps:**
1. `scepter claims trace R<NN>` and `scepter claims trace DD<NN>` to enumerate every claim in scope.
2. `scepter create TestPlan "<title>"`.
3. Dispatch `sce-producer` with the source notes, the new TP ID, and `artifacts/test-plan.md`.
4. Producer maps each claim to a test pattern, distinguishing `@implements`-confirmable (existence/behavior) from `@validates`-required (constraint/ordering/invariant).
5. `scepter claims lint TP<NN>`.
6. Dispatch `sce-linker` to wire cross-refs.

**Slips:**
- Treating every claim as `@implements`-confirmable — constraint and invariant claims require explicit test assertions.

---

### R7. Implement a design section

**Core:** Translate DCs to code with `@implements` only on real implementations. See `claims.md` § In Code and `team.md` § Specification Fidelity.

**Trigger:** A DD section is approved and ready to be realized in code.

**What happens:**
- **You / orchestrator:** dispatch the producer with the DD section and `implementing.md`.
- **SCEpter CLI:** `scepter claims trace DD<NN>` before and after; `scepter claims gaps --note DD<NN>` to find holes.
- **Sub-agents:** `sce-producer` with `implementing.md` + `claims.md`. `sce-linker` in the background after.
- **Graph effect:** source files gain `@implements {DD<NN>.§<S>.DC.<NN>}` annotations. The Source column populates in the trace matrix.

**Steps:**
1. `scepter claims trace DD<NN>` — record baseline coverage.
2. Dispatch `sce-producer` with the DD section, the relevant existing code paths, and `implementing.md`.
3. Producer writes code, adds `@implements` annotations only on actual implementations (stubs use `@see` + claim must carry `:deferred`).
4. On a divergence (missing API, type mismatch, etc.) the producer HALTs that piece, BLOCKS, and continues the rest. Surface BLOCKED items to the user; do not self-resolve.
5. After the producer reports done: orchestrator runs `tsc --noEmit` and the test suite (independent verification).
6. `scepter claims trace DD<NN>` — confirm Source column shows the new files.
7. `scepter claims gaps --note DD<NN>` — confirm no unintended gaps.
8. Dispatch `sce-reviewer` for a conformance pass (R10).
9. Dispatch `sce-linker` in the background.

**Slips:**
- `@implements` on a stub. **This poisons the trace matrix.** The fix is to flip to `@see` and add `:deferred` to the claim — see R8.
- Self-deferring a DC because the DD says "Not started" — that's a status description, not a deferral directive.
- Inventing an API or type to make the spec work, instead of BLOCKing.

---

### R8. Convert a stub `@implements` into proper coverage

**Core:** Stub annotations are protocol violations. Flip to `@see` + claim `:deferred`, OR implement and re-trace.

**Trigger:** A reviewer (or the linker, or the orchestrator) finds an `@implements` annotation on code that returns `[]`, `null`, a hardcoded constant, or otherwise doesn't realize the claim.

**What happens:**
- **You / orchestrator:** decide implement-now vs. deferral-with-user-approval.
- **SCEpter CLI:** `scepter claims trace <CLAIM_ID>` before and after.
- **Sub-agents:** `sce-producer` for the actual fix (mechanical finding).
- **Graph effect:** Source-projection coverage flips from "false-positive" to either "real" (if implemented) or "absent" (if `@see` + `:deferred`).

**Steps:**
1. Identify the offending file / claim pair.
2. Decide path: **A.** implement now, OR **B.** convert to `@see` and request user approval to add `:deferred` to the claim.
3. If A: dispatch `sce-producer` to implement; verify with `tsc --noEmit` and tests.
4. If B: edit the annotation to `@see {CLAIM_ID}` with a comment "not yet implemented"; ask the user to authorize `:deferred` on the claim. The user marks `:deferred`; the orchestrator does not.
5. `scepter claims trace <CLAIM_ID>` — confirm the matrix reflects reality.

**Slips:**
- Self-deferring without user approval — see NON-NEGOTIABLE rule 11.
- Leaving the `@implements` annotation in place "with a TODO comment" — the trace matrix only sees the annotation, not the comment.

---

### R9. Run a review pass (completeness / coherence)

**Core:** Has the producer covered every AC interaction, projection, and binding consideration before implementation begins? See `reviewing.md`.

**Trigger:** A new DD or requirement is drafted; before any implementation begins.

**What happens:**
- **You / orchestrator:** dispatch the reviewer with `reviewing.md`.
- **SCEpter CLI:** `scepter claims trace`, `scepter claims gaps --include-zero`, `scepter claims lint`.
- **Sub-agents:** `sce-reviewer` reads the artifact and the cited sources; tags findings MECHANICAL or HUMAN_JUDGMENT.
- **Graph effect:** none directly. Findings drive subsequent producer dispatches (mechanical) or user surfacing (judgment).

**Steps:**
1. Dispatch `sce-reviewer` with: artifact ID, source IDs, pass type "review", `reviewing.md`.
2. Reviewer enumerates every projection and AC interaction, runs trace/gaps/lint, checks binding assessment.
3. Reviewer returns a finding list with each tagged MECHANICAL or HUMAN_JUDGMENT.
4. Orchestrator routes per NON-NEGOTIABLE rule 11.
5. For mechanical findings: dispatch `sce-producer` with the specific findings as the unit of work.
6. For judgment findings: surface to user with options.
7. Re-run review pass after fixes if scope warrants.

**Slips:**
- Auto-applying judgment findings as if mechanical — strips the user's substantive review.
- Pausing for user ack on every typo — wastes user attention.

---

### R10. Run a conformance pass (does X match Y?)

**Core:** Does the implementation realize every claim in the source? Does the code cite primitives that actually exist? See `conformance.md`.

**Trigger:** Implementation is reported done; before the orchestrator presents the verdict to the user.

**What happens:**
- **You / orchestrator:** dispatch the reviewer with `conformance.md`; do independent verification yourself.
- **SCEpter CLI:** `scepter claims trace`, `scepter claims gaps`; `tsc --noEmit`; the project's test suite.
- **Sub-agents:** `sce-reviewer` reads the code AND the source DD; verifies "no code changes needed" assertions by reading actual types.
- **Graph effect:** none from the review itself. Mechanical findings drive subsequent producer fixes.

**Steps:**
1. Dispatch `sce-reviewer` with: implementation files, source DD, pass type "conformance", `conformance.md`.
2. Reviewer reads each DC against the actual code (not the producer's summary).
3. Reviewer verifies cited primitives exist via grep.
4. Reviewer runs `tsc --noEmit` before issuing any verdict.
5. Orchestrator independently runs `tsc --noEmit` and tests; spot-checks scope alignment.
6. Reviewer returns PASS / PARTIAL / FAIL with tagged findings.
7. Orchestrator relays only after independent verification confirms.

**Slips:**
- Trusting the reviewer's "PASS" without independent verification — relays a false verdict.
- Accepting "no code changes needed" assertions without reading the actual interfaces.

---

### R11. Run an impact pass (what did this structural change break?)

**Core:** A change altered what an entity IS, or how the parser/detector classifies it. Trace the cascade. See `implementing.md § Impact Analysis`.

**Trigger:** A parser change, a type rename, a detection-rule change, or any change that alters dispatch on a property.

**What happens:**
- **You / orchestrator:** dispatch the reviewer with `implementing.md § Impact Analysis`.
- **SCEpter CLI:** `scepter claims trace` BEFORE the change (from git history if needed) and AFTER, to spot regressions.
- **Sub-agents:** `sce-reviewer` reads downstream consumers, traces dispatch signals, checks trace regression.
- **Graph effect:** none from the review. Findings drive subsequent fixes if downstream consumers broke.

**Steps:**
1. Snapshot pre-change trace: `git stash` is forbidden in this project — use `git diff <ref>` or `git show <ref>:<path>` to read pre-change state non-destructively.
2. Dispatch `sce-reviewer` with: changed file(s), pass type "impact", `implementing.md`.
3. Reviewer enumerates structural properties that changed.
4. Reviewer greps for downstream consumers that branch on each changed property.
5. Reviewer compares pre/post trace output for regressions.
6. Reviewer returns finding list.
7. Orchestrator routes mechanical fixes to producer; surfaces judgment findings.

**Slips:**
- Using `git stash` to compare states (FORBIDDEN — see project's hard safety rules).
- Treating the change as additive when it's structural ("we just added a field" — but downstream code branches on field presence).

---

### R12. Route reviewer findings (mechanical vs. human-judgment)

**Core:** Mechanical findings auto-dispatch to producer; human-judgment findings surface to user. See NON-NEGOTIABLE rule 11.

**Trigger:** A reviewer returns a finding list.

**What happens:**
- **You / orchestrator:** classify each finding; route accordingly; report in next user-facing message.
- **SCEpter CLI:** none directly.
- **Sub-agents:** `sce-producer` for mechanical batches.
- **Graph effect:** mechanical fixes update notes/code; judgment findings stay open until user decides.

**Steps:**
1. For each finding, read the reviewer's tag (MECHANICAL or HUMAN_JUDGMENT).
2. If untagged: default to HUMAN_JUDGMENT, but check whether it's actually a source-deviation or skeletal-authoring case (those are MECHANICAL).
3. Batch all MECHANICAL findings into a single `sce-producer` dispatch with explicit instructions.
4. Surface HUMAN_JUDGMENT findings to the user with options. Do NOT auto-apply.
5. After mechanical fixes apply, summarize what was applied in the next user-facing message — do not pause for per-item ack.

**Slips:**
- Surfacing mechanical fixes for ack (over-pausing).
- Silently routing judgment findings as if mechanical (over-applying).
- Laundering authoring failures as design questions ("should we use the invented namespace or the cited one?" — one is a hallucination).

---

### R13. Dispatch the linker (graph hygiene, background)

**Core:** After any substantive work cycle that touches notes or `@implements`-annotated code, dispatch `sce-linker` with `run_in_background: true`. NON-NEGOTIABLE rule 10.

**Trigger:** Producer dispatch finished, implementation pass finished, arc closed, multi-step edit completed.

**What happens:**
- **You / orchestrator:** dispatch the linker; do not wait for it.
- **SCEpter CLI:** `scepter ctx gather` and `scepter claims trace` — by the linker, not the orchestrator.
- **Sub-agents:** `sce-linker` runs in the background.
- **Graph effect:** missing `@implements` / `@validates` / `@depends-on` annotations added; bidirectional refs reconciled; supersession lifecycle tags applied; cross-references between produced notes and adjacent graph context.

**Steps:**
1. After the work cycle, dispatch `sce-linker` with `run_in_background: true`.
2. Continue with the next user-facing decision. Do not wait.
3. Before final user review, collect linker output.
4. Surface any linker findings that warrant user attention; otherwise summarize briefly.

**Slips:**
- Forgetting to dispatch the linker. The linker is the only systematic surface that catches missing bidirectional refs.
- Blocking on the linker when running in foreground.

---

### R14. Investigate an unfamiliar subsystem

**Core:** Dispatch `sce-researcher` with a precise question; receive a report, not a synthesis.

**Trigger:** The orchestrator (or a producer/reviewer) needs facts about a subsystem before producing or reviewing.

**What happens:**
- **You / orchestrator:** formulate a precise question; dispatch the researcher.
- **SCEpter CLI:** `scepter ctx show`, `scepter ctx gather`, `scepter ctx search`, `scepter claims trace/search/thread` — by the researcher.
- **Sub-agents:** `sce-researcher`, read-only.
- **Graph effect:** none. Researcher reports facts.

**Steps:**
1. Formulate a single-sentence question.
2. Dispatch `sce-researcher` with the question and any relevant note IDs / file paths the researcher should look at first.
3. Researcher uses the CLI for note/claim discovery; uses Grep/Read for code.
4. Researcher returns a findings report — facts with citations (file:line, note ID).
5. Orchestrator integrates the findings into the next decision. Do not delegate the decision to the researcher.

**Slips:**
- Vague questions ("tell me about the parser") — produce vague reports.
- Letting the researcher modify files (it's read-only by design).

---

### R15. Retire or supersede a claim

**Core:** Claims aren't deleted; they're tagged. `:removed [Removed]` for retired, `:superseded=TARGET` for replaced. See `claims.md` § Removing Claims.

**Trigger:** A claim is no longer accurate or has been replaced by another claim.

**What happens:**
- **You / orchestrator:** decide retire vs. supersede; dispatch the producer.
- **SCEpter CLI:** `scepter claims lint NOTEID` after; `scepter claims trace` to confirm gap report excludes the retired claim.
- **Sub-agents:** `sce-producer` for the edit.
- **Graph effect:** claim ID retained (monotonic, never recycled); claim text replaced with `[Removed]` (for `:removed`); supersession edge added (for `:superseded=TARGET`).

**Steps:**
1. Decide tag: `:removed` (retired, no replacement) or `:superseded=TARGET` (replaced by target).
2. Dispatch `sce-producer` to apply the tag and replace the claim text with `[Removed]` for the `:removed` case.
3. `scepter claims lint NOTEID` — confirm references to the retired claim are flagged for cleanup.
4. Update or remove cross-references in other notes / code that point to the retired claim.
5. `scepter claims trace NOTEID` — confirm gap report behaves correctly.
6. Dispatch `sce-linker` in the background.

**Slips:**
- Reusing the retired ID — IDs are monotonic, never recycled.
- Cross-project supersession (`superseded=vendor-lib/...`) — permanently rejected; linter error.

---

### R16. Verify a constraint, ordering, or invariant claim

**Core:** Some claims can't be confirmed by inspecting components alone — record verification events. See `claims.md` § Modal character.

**Trigger:** A constraint ("MUST NOT do X"), ordering ("X before Y"), or invariant ("P always holds") claim has been confirmed via code review, test execution, or integration testing.

**What happens:**
- **You / orchestrator:** record the event with actor and method.
- **SCEpter CLI:** `scepter claims verify <CLAIM_ID> --actor "<who>" --method "<how>"`.
- **Sub-agents:** none required.
- **Graph effect:** verification event appended to the verification store (`_scepter/verification.json` or equivalent). `scepter claims stale` can now detect re-verification needs when underlying files change.

**Steps:**
1. Confirm the claim is a constraint, ordering, or invariant — those are the modes verification covers.
2. Run the verification (code review, integration test, etc.) and capture the result.
3. `scepter claims verify <CLAIM_ID> --actor "<name>" --method "<code-review|integration-test|...>"`.
4. The CLI appends an event to the verification store.
5. Optional: `scepter claims stale --note NOTEID` to confirm the claim is no longer flagged stale.

**Slips:**
- Recording verification before the actual verification happened — the event is now misleading.
- Verifying behavior claims with `scepter claims verify` instead of `@validates` annotations — duplicate work.

---

### R17. Close a process Task

**Core:** Trace-clean + gaps-clean + Frontier empty (or only authorized deferrals) → `ready_for_review`. User flips to `completed`. See `process.md` § When to Close.

**Trigger:** All Frontier items are done or authorized as deferrals; coverage is in place.

**What happens:**
- **You / orchestrator:** verify the close conditions; flip to `ready_for_review`; surface to user.
- **SCEpter CLI:** `scepter claims trace`, `scepter claims gaps`, `scepter ctx update <TASK_ID> --status ready_for_review`.
- **Sub-agents:** `sce-linker` for final pass.
- **Graph effect:** Task status flips. User-only transition to `completed` happens later, by the user.

**Steps:**
1. `scepter claims trace` on every Active Note.
2. `scepter claims gaps` on every Active Note.
3. Confirm Frontier is empty or contains only items the user explicitly authorized as deferred.
4. Dispatch `sce-linker` for a final hygiene pass.
5. Update Task status to `ready_for_review`.
6. Surface to the user with a summary: what was completed, what was deferred (with user authorization references), what's open.
7. User decides when to mark `completed`.

**Slips:**
- Self-promoting to `completed` — VIOLATES status discipline (user-only transition).
- Closing with open Frontier items the user didn't authorize as deferred.

---

### R18. Cite a peer project's claim (cross-project reference)

**Core:** Use alias prefix (`vendor-lib/R005.§1.AC.01`) for read-only display. Never `derives=` or `superseded=` across projects. See `claims.md` § Cross-Project References.

**Trigger:** Citing a peer project's note or claim — vendored library, federated repo, sibling project.

**What happens:**
- **You / orchestrator:** declare the alias in `scepter.config.json` `projectAliases`; cite with the alias prefix.
- **SCEpter CLI:** `scepter show vendor-lib/R042` (peer note display), `scepter claims trace <local-note>` (renders alias citations in a footer).
- **Sub-agents:** none required.
- **Graph effect:** alias citation appears in trace output as a footer; peer claims do NOT enter the local index, derivation graph, gap report, or trace matrix.

**Steps:**
1. Confirm the alias is declared in local `scepter.config.json` under `projectAliases`.
2. Use the alias-prefixed form: `{vendor-lib/R005.§1.AC.01}` in prose, `@implements {vendor-lib/...}` or `@see {vendor-lib/...}` in code.
3. NEVER use `derives=vendor-lib/...` or `superseded=vendor-lib/...` (linter errors).
4. `scepter claims lint` to confirm alias resolution.

**Slips:**
- Cross-project `derives=` — linter error `cross-project-derives`. Decompose locally and reference upstream as a separate citation.
- Cross-project `superseded=` — permanently rejected; the local project lacks authority over peer lifecycle.
- Transitive aliases (`a/b/R001`) — not supported; declare each peer directly.

---

### R19. Refactor before feature work

**Core:** Behavior-preserving moves precede feature additions. Pre-dispatch refactoring assessment. See `team.md` § Pre-Dispatch.

**Trigger:** A DD's Module Inventory shows method removals, caller migrations, interface changes on existing-consumer files.

**What happens:**
- **You / orchestrator:** assess the restructuring surface; load the refactoring skill if available; sequence behavior-preserving changes first.
- **SCEpter CLI:** `scepter claims trace` to confirm coverage before structural changes; again after.
- **Sub-agents:** the refactoring skill (if present) produces an execution plan; producer follows the plan.
- **Graph effect:** structural changes preserve `@implements` annotations across moves; the trace matrix should not regress.

**Steps:**
1. Read the DD's Module Inventory.
2. If "Modified Files" includes method removals / caller migrations / interface changes on existing consumers → restructuring is involved.
3. Check skill list for a refactoring skill. If present, invoke it. Otherwise, manually sequence: extract → redirect → remove BEFORE feature additions.
4. After each behavior-preserving move, run tests.
5. Once restructuring is complete, proceed to feature work per R7.
6. `scepter claims trace` after restructuring — confirm no annotations were lost in moves.

**Slips:**
- Mixing restructuring with feature additions in the same step — bug source unclear when tests fail.
- Removing methods without first verifying all callers have migrated.

---

### R20. Recover from a smuggling drift

**Core:** Re-attribute paraphrased "user said" to its actual source; re-verify any endorsement that drives binding decisions. See `claims.md` § Smuggling.

**Trigger:** The orchestrator notices "the user wanted X" or "as agreed, Y" in a doc whose provenance can't be traced to a verbatim user utterance or a recorded event.

**What happens:**
- **You / orchestrator:** flag the attribution; dispatch the producer to rewrite with the actual source.
- **SCEpter CLI:** `scepter claims search` for related claims with similar attribution; `scepter claims trace` to confirm no `@implements` cascades from the unverified attribution.
- **Sub-agents:** `sce-producer` to rewrite attributions.
- **Graph effect:** documents updated with sourced attributions; any claims whose binding rested on smuggled endorsement are flagged for re-verification.

**Steps:**
1. Flag the attribution in question. Quote the exact phrase.
2. Search the session record (chat history, prior handoffs) for a verbatim user utterance.
3. If a verbatim utterance exists, rewrite as `The user stated: "<verbatim>"` with a session reference.
4. If no verbatim exists, rewrite as `Per the agent synthesis in <doc>, ...` — make the source visible.
5. If the smuggled attribution drove an `@implements` annotation or a claim's binding, surface to the user: "this claim's endorsement traces to a synthesis, not a recorded event — please confirm or revise."
6. Wait for user decision.

**Slips:**
- Treating "the agent paraphrase repeats across N docs" as evidence — repetition is not ratification.
- Re-paraphrasing with new wording — same problem, different prose.
