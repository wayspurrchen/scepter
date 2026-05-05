# SCEpter Git Discipline

**MUST-LOAD whenever your task may invoke git.** All sce-* agents (producer, reviewer, researcher, linker, note-extractor, note-evolver) and the orchestrator share these rules. Violations have repeatedly destroyed cross-agent work — these are not stylistic preferences.

## Hard rules

### 1. Only stage what YOU touched.

- **Only stage files YOUR task created or modified.** Nothing else. Ever.
- **Never stage pre-existing untracked files.** The working tree contains research docs, config files, work logs, and artifacts from prior sessions. They are not yours to stage. If you didn't create or modify it in the current task, leave it alone.
- **Never run `git add -A`, `git add .`, or `git add --all`.** Always add specific files by name. No exceptions, including "I'll just stage everything for the user to review" rationalizations. Stage by name.

### 2. NEVER use git stash.

**Never use `git stash`, `git stash drop`, or `git stash pop` anywhere, ever.** This rule has no "verification" or "I'll just stash temporarily" exception.

A `git stash` opaquely captures the entire working tree — including uncommitted work from parallel agents and from other Claude Code sessions the current session can't see. A `git stash pop` can fail on an unrelated file's merge conflict; an instinctive `git stash drop` then permanently destroys the stash. **Multiple recurring incidents in active projects have wiped substantial cross-agent work this way.**

For verification reads against another commit's state, use:
- `git diff <ref>`
- `git diff <ref> -- <path>`
- `git show <ref>:<path>`

These do not mutate. If a stash already exists in your environment and something has "gone wrong," **STOP and surface to the user** — *especially* in that case, when reflexive cleanup does the most damage. Read-only `git stash list` and `git stash show -p stash@{N}` are fine; any mutating stash operation (push/pop/drop/apply/clear) requires explicit per-turn user authorization.

### 3. NEVER wipe the working tree.

**Never run `git reset --hard`, `git restore -W .`, `git checkout -- .`, or `git clean -fd`** without explicit per-turn user authorization. These destroy uncommitted state across all tracked files. Parallel agents may have in-flight edits that become collateral damage.

If you need to reset a specific file, use the path-scoped form (`git checkout -- path/to/file`) and only after confirming no other agent has uncommitted work on that file.

### 4. NEVER skip hooks.

**Never use `--no-verify`, `--no-gpg-sign`, or `-c commit.gpgsign=false`** unless the user has explicitly asked for it in the current turn. If a pre-commit or pre-push hook fails, investigate and fix the underlying issue. The hook fired for a reason.

## When `git status` shows unexpected files

Do NOT clean them up. Read them, understand who created them, and either leave them alone or surface to the user. Cleanup is the user's call, not the agent's.

## Pass-through rule

When dispatching subagents, include these rules in the dispatch context. Many agents reflexively reach for `git stash` or `git add .` when "verifying state"; explicit prohibition in the dispatch context is required.
