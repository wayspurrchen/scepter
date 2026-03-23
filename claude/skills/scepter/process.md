# SCEpter Claims Process

**Read this companion file when working on a feature or change that spans multiple operations** — authoring requirements, deriving designs, implementing, reviewing, verifying. This file tells you how to track that work across compacts and skill reloads using a structured SCEpter task.

Ensure you have loaded `@scepter` (the main skill) first — it contains the non-negotiable rules, CLI reference, and core concepts.

## The Loop

This runs at the top level — you drive it, not a subagent.

### On Start

1. **Check for an existing process task.** Run `scepter list -t T --status in_progress --tags process`. If one exists for the current work, gather it (`scepter ctx gather TASK_ID`) and skip to "On Resume."
2. **Create a process task.** `scepter create Task "FEATURE_NAME" --tags process`. Edit it using the scaffold below.
3. **Populate the scaffold.** Fill in Scope, add the initial notes to Active Notes, and seed the Frontier with your first concrete actions.
4. **Run the Orientation Protocol** (see below) to understand current claim state before starting work.

### On Resume (after compact or skill reload)

1. **Gather the process task.** The scaffold has everything: what notes are in play, what's next.
2. **Run the Orientation Protocol** on active notes to check for changes since last session.
3. **Read the Frontier.** Propose the highest-impact item to the user based on dependencies and coverage gaps.
4. **Continue from where you left off.** Don't re-derive context that's already in the scaffold.

### After Every Operation

1. **Update Active Notes** if you touched, created, or discovered a new note.
2. **Update the Frontier.** Remove completed items. Add newly discovered work — missing projections, cross-requirement interactions, structural property cascades, anything unexpected.
3. **Append to the Log** with a date and a one-line summary of what you did.

### Choosing What's Next

Read the Frontier and assess:

- **Coverage gaps** — Run `scepter claims trace` on active notes to see which claims lack source coverage. Prioritize closing gaps.
- **Blockers** — If an item is blocked, skip it and note why in the Frontier.
- **Discovery** — New items from review or implementation often take priority because they represent risks you didn't know about.
- **User direction** — The user can override priority at any time. Always present your proposed next action and wait for confirmation before large operations (authoring new requirements, starting a new projection).

Use the operation routing table in SKILL.md to load the right companion file for whatever operation the Frontier item requires.

## Orientation Protocol

Run this before starting any work. It takes 30 seconds and gives you the state of the world.

```bash
# 1. Trace coverage for all active notes (substitute actual note IDs)
scepter claims trace NOTEID1
scepter claims trace NOTEID2

# 2. Check for structural issues
scepter claims lint NOTEID1

# 3. Check staleness (if verification events exist)
scepter claims stale --note NOTEID1

# 4. Search for related claims you might not know about
scepter claims search "KEYWORD"
```

### How to interpret

- **Trace**: Each `-` in the Source column is a claim without implementation. Each `-` in another column is a potential documentation or spec gap. Missing columns entirely means a whole projection is absent.
- **Lint**: Errors mean the claim structure is broken — fix before relying on trace/gaps results.
- **Stale**: Claims attached to files that changed since verification need re-checking.
- **Search**: Use keyword search to discover related claims across the entire project. Claim prefixes act as natural component tags (e.g., `CASCADE`, `DIFF`, `APPLY`). Search for the domain you're working in to find claims you might miss by only looking at gathered notes.

### When to re-orient

- At session start (always)
- After a compact (context was lost — re-derive state)
- After a significant block of implementation (check what changed)
- Before committing (verify you didn't break coverage)

### Dispatching Agents

The process loop dispatches two SCEpter agents for focused work. The main agent stays at the top level driving the process; agents execute specific tasks and return results.

#### sce-producer

Produces artifacts. The prompt specifies what to create; the agent loads the appropriate companion files.

| Frontier item | Companion files | Inputs | Output |
|---|---|---|---|
| Author requirements | claims.md | Problem description, existing notes | Requirement note with ACs |
| Write design document from requirements | claims.md, @epi detailed-design format | Requirement content, relevant code | Design doc with derived claims where needed |
| Write test plan | claims.md, @epi test-plan format | Requirement + design doc content | Test plan with @validates references |
| Implement a design section | implementing.md | Design section, existing code | Code with @implements annotations |
| Write specification | claims.md, @epi spec format | Requirement + architecture notes | Spec with claim references |
| Update documentation | claims.md | Current file, feature context | Updated doc |

#### sce-reviewer

Assesses artifacts. Dispatched with one of three pass types, each loading its companion file.

**Review pass** (loads reviewing.md) — "Is the claim stack sufficient and do projections agree?"

| Check | When | Inputs |
|---|---|---|
| Completeness | Design or requirement written, before implementation | Requirement + design doc |
| AC interaction coverage | Same — part of completeness | ACs that share metadata dimensions |
| Binding assessment | Same — part of completeness | Each AC's file/module footprint |
| Coherence | Periodically, or after propagation | Multiple projections of same claims |
| Staleness | After changes to any projection | `scepter claims trace` + `scepter claims stale` output |

**Conformance pass** (loads conformance.md) — "Does artifact X match source Y?"

| Check | When | Inputs |
|---|---|---|
| Implementation conformance | After implementing a design section or spec | Source document + implementation code |
| Plan validity | Design or plan produced, before implementation | Plan + actual codebase state |
| Claim coverage | After implementation | `scepter claims trace` + `scepter claims gaps` output |

**Impact pass** (loads implementing.md `## Impact Analysis`) — "What did this structural change break?"

| Check | When | Inputs |
|---|---|---|
| Structural property cascade | After a change that alters what an entity IS | Changed code + downstream consumers |
| Dispatch signal audit | Same — part of impact | Code that branches on the changed property |
| Trace regression | After parser or detection changes | `scepter claims trace` before/after comparison |

**Dispatch rules:**
- Specify the pass type in the prompt: "review pass on the design doc against R005", "conformance pass on §1 implementation", "impact pass on claim parser changes."
- Review and conformance passes can be dispatched at the same time on different artifacts (they're independent).
- Impact passes are triggered by discovery — you changed something structural and need to assess downstream effects before continuing.

### When to Close

The process task moves to `ready_for_review` when:
- `scepter claims trace` shows source coverage for all active notes' claims
- `scepter claims gaps` is clean for all active notes
- The Frontier is empty (or contains only deferred items)

The user decides when to mark it `completed`.

## Process Task Scaffold

When creating a process task, use this structure. The section headings are fixed; the content within them evolves as you work.

```markdown
## Scope
[One sentence describing the feature, change, or initiative this task tracks.]

## Active Notes
| Note | Role | Status |
|------|------|--------|

## Frontier
[Flat bullet list of concrete next actions.]

## Log
[Append-only, dated entries.]
```

### Section Guide

**Scope** — One sentence. What is this work about? Read this first on resume.

**Active Notes** — Every note in play. Add rows as notes enter scope. Role is freeform: "source requirement", "detailed design", "discovered dependency", etc. Status uses operation vocabulary: authored, derived, implemented, reviewed, verified, updated. Rows are updated in place, never deleted.

**Frontier** — Flat bullet list of concrete next actions. Each item is a specific thing to do, not a category ("implement staleness detection in verification-store.ts", not "do implementation"). Items are added as work is discovered, struck through or removed when completed. No ordering — the agent assesses priority on each iteration based on the process loop above.

**Log** — Append-only, dated with `date "+%Y-%m-%d"` output. One line per significant action. Never edited, only appended. This is the record that survives compacts.
