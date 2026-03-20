## Claude.MD

Read @docs/prompts/working-intelligently.md and follow its instructions, then read @docs/architecture/ARCHITECTURE_OVERVIEW.md immediately, and ask the user what they want to accomplish.

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

## Development Commands

You DO NOT NEED to build this project when testing functionality manually. You can exercise arbitrary files with `pnpm tsx`. For typechecks, use `pnpm tsc`.

You can run the `scepter` command directly, with a `--project-dir` pointing to the directory containing a _scepter folder. You do NOT need to run `pnpm run build`.
