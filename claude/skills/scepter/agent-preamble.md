# SCEpter Agent Project Context Preamble

**MUST-LOAD at session start by every sce-* agent** (producer, reviewer, researcher, linker, note-extractor, note-evolver). This file holds the project-context discipline that previously appeared verbatim in each agent file.

## You are part of the session, not an oracle

Any `MANDATORY BEFORE ANY WORK`, `START HERE`, or equivalent directive in the project's `./CLAUDE.md` (or the user's global CLAUDE.md for universal rules) applies to you. Do not assume the main agent has satisfied these mandates on your behalf unless its dispatch prompt explicitly cites what it has loaded.

## Required actions, in order

1. **Read `./CLAUDE.md`** at the project root, if it exists. Project-level rules and bootstrap directives apply to you. If a project mandate conflicts with the SCEpter generic rules, the project mandate wins.

2. **Load role-relevant project context.** Each agent role has different load priorities — see your agent file's "Project Context" section for the role-specific list. Common items, loaded when relevant to the current task:
   - **Architectural invariants** (often at `docs/ARCHITECTURE.md` or equivalent) — load when the artifact you're producing or reviewing invokes architectural structure
   - **Domain-specific context** (project skills, DOM notes, or relevant references) — load when working in a specific subsystem
   - **Pre-authoring gates** (e.g., an architecture-evaluation artifact for new R/S/DD) — verify before authoring. If the project's CLAUDE.md requires a gate artifact and the dispatch prompt does not cite one, refuse to proceed and report back rather than producing/reviewing without it.
   - **Testing conventions** — load when producing or reviewing test-related artifacts
   - **Primitive-existence verification** — when producing or reviewing designs that reference existing code primitives (`EXTEND X`, `MODIFY Y`), grep the code root and cite the file:line where the primitive currently exists. If ABSENT, flag explicitly with a disposition.

3. **Honor dispatcher context citations.** If the calling prompt cites what has been pre-loaded for you ("I've loaded /your-project; assume the architecture context"), skip redundant loads. If the prompt is silent on a required item, load it yourself. Be frugal — load only what your specific task requires, not the full context stack.

4. **Report in your process update / output** which project-mandate items you loaded or verified, so the calling agent can track discipline.

## Authority order (when instructions conflict)

1. Project `./CLAUDE.md` mandates (highest)
2. SCEpter agent file MANDATORY block
3. Companion file rules (`claims.md`, `artifacts/{type}.md`, etc.)
4. Dispatch brief
5. Conventions and structural templates the brief embeds (lowest)

The higher authority wins. The lower-authority instruction is reported to the orchestrator as needing reconciliation. **Do not silently choose between conflicting instructions** — surface the conflict and let the orchestrator (or user) resolve it.

## Producer-specific note

Producers commonly receive dispatch briefs that pre-bake structural templates ("follow this 9-section spine," "use this report as the section structure"). When the template would force authoring non-claim content as numbered claims, the artifact guide wins over the brief. See `~/.claude/agents/sce-producer.md` § When the Dispatch Brief Conflicts with the Artifact Guide for the prospective filter to apply before writing each claim.

## Reviewer-specific note

Reviewers must apply role-specific posture (adversarial-by-default per `sce-reviewer.md`) and project-specific review modes (e.g., reality-conformance — grep `src/` for every primitive cited and verify file:line existence). The agent file enumerates these; this preamble names the discipline and points there.

## Researcher-specific note

Researchers are context-frugal by design. The discipline above applies, but the load surface is lighter — load architectural context only if the research topic directly touches architecture; load subsystem context only if scoped to that subsystem. Heavy context loads blunt search focus.
