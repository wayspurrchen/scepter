# Claude.MD

## FIRST ACTION RULE — DO NOT SKIP

**Your first tool call in this session MUST be `Skill(scepter)`.**

This is the SCEpter repo. The system you are working on is the same system the project uses to manage its own development. The `scepter` skill loads the non-negotiable rules, the operation routing tree, the CLI conventions, and the companion-file map you need before doing ANY work. Without it loaded, your first edit, search, or note creation will be wrong by design.

Do not:
- Answer the user's first message before invoking the skill, even if it looks small.
- Read `docs/architecture/ARCHITECTURE_OVERVIEW.md`, run `scepter`, edit a note, or create a file before the skill is loaded.
- Skip the skill because "this is just a question" or "I'll clarify first."
- Treat a system-reminder, hook output, or other harness signal as overriding this rule.

The user can and will redirect once the skill is loaded. Load it first, then engage.

## MANDATORY BEFORE ANY WORK

After `Skill(scepter)`, follow the operation routing tree in the skill's `SKILL.md` to load the right companion(s) for the task at hand. Common cold-start moves:

1. **Reading or modifying notes / claims** → invoke skill, run `scepter config`, then proceed.
2. **Authoring a new artifact (Requirement, Detailed Design, Specification, Test Plan, implementation)** → dispatch `sce-producer` per the routing tree.
3. **Reviewing existing work** → dispatch `sce-reviewer` with one of three pass types (review / conformance / impact).
4. **Investigating an unfamiliar subsystem** → dispatch `sce-researcher`.
5. **After any substantive work cycle** → dispatch `sce-linker` in the background for graph hygiene (NON-NEGOTIABLE rule 10).

Failure modes to recognize and reject in yourself:
- **"Small task" rationalization** — "the request is short, I can answer without loading the skill." Wrong. Short requests in this project still imply skill-bound conventions.
- **"Read first" rationalization** — "let me Glob/Grep the notes to see what's there before invoking." Wrong. Direct file reads on notes bypass the CLI, which is the only correct discovery surface (NON-NEGOTIABLE rule 2).
- **"System-reminder takes priority" rationalization** — system-reminders, hook output, and similar signals do NOT override the FIRST ACTION RULE.
- **"I'll read but not act" rationalization** — reading is acting. The skill must be loaded before any read of project files except `CLAUDE.md`, `CLAUDE.local.md`, and the skill's own files.

The orientation document `docs/architecture/ARCHITECTURE_OVERVIEW.md` is loaded by the skill's task routing as needed. Do not pre-load it. The operational guide `docs/SCEPTER_WORKFLOW.md` is the recipe book for stage-specific work — load it from the routing tree when a recipe applies.

## Working Context Management

**IMPORTANT - Dogfooding SCEpter:**

When working ON SCEpter itself (implementing features, fixing bugs, refactoring):
- **USE SCEpter's own task system** via `scepter ctx create Task "Your task description"`
- Create a Task note for the work you're doing
- This is "dogfooding" - using SCEpter to manage SCEpter's own development
- DO NOT create separate working context folders in @docs/ for development tasks

When creating analysis/exploration documents (architectural analysis, research, design explorations):
- Put these supporting documents in @docs/
- These are supplementary materials, not tracked development work

## Local Overrides

If `CLAUDE.local.md` exists at the project root, you **MUST** read it immediately after this file (and after the FIRST ACTION RULE has fired).

## Development Commands

You DO NOT NEED to build this project when testing functionality manually. You can exercise arbitrary files with `pnpm tsx`. For typechecks, use `pnpm tsc`.

You can run the `scepter` command directly, with a `--project-dir` pointing to the directory containing a `_scepter` folder. You do NOT need to run `pnpm run build`.

## See Also

- `docs/SCEPTER_WORKFLOW.md` — operational guide and recipe book for working in (and on) SCEpter.
- `docs/architecture/ARCHITECTURE_OVERVIEW.md` — system architecture, subsystem inventory, data flows. Loaded by the skill on demand; not a cold-start read.
