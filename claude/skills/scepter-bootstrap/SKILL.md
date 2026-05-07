---
name: scepter-bootstrap
description: Install SCEpter cold-start scaffolding into an existing project — non-destructively augment CLAUDE.md with a FIRST ACTION RULE, surface project-local skill/agent paths to the harness, and (optionally) seed a baseline .claude/settings.json. Use when an existing project should auto-load the scepter skill on session start, or when retrofitting an in-flight project to follow SCEpter's bootstrap discipline. Distinct from sce-retrofit (which proposes note types and ingests notes); this skill only installs the bootstrap surface.
allowed-tools: Read, Write, Edit, MultiEdit, Glob, Grep, Bash, TodoWrite
---

# scepter-bootstrap

## Purpose

This skill installs the SCEpter cold-start surface into an existing project. After running this skill, sessions in the target project will auto-invoke `Skill(scepter)` on first action, the harness will discover the project's local skills/agents directory, and (optionally) common SCEpter commands will land in the project-shared allowlist.

**This skill does NOT:**
- Initialize a SCEpter project (no `scepter init` — assume the user runs that separately, or the project is already initialized).
- Propose note types or ingest existing docs into the knowledge graph (that's `sce-retrofit`).
- Modify the global `~/.claude/skills/scepter/` content.
- Touch any files outside the well-defined edit surface listed below.

**Non-negotiable: every edit is non-destructive.** Existing `CLAUDE.md` content is preserved; new blocks are added with stable section anchors so subsequent runs are idempotent. Existing `.claude/settings.json` arrays are merged, not overwritten. Existing skill/agent files are never silently replaced.

## Edit surface

This skill modifies, at most, the following files:

| Path | Operation | Idempotency anchor |
|---|---|---|
| `<project>/CLAUDE.md` | Prepend or upsert blocks | `## FIRST ACTION RULE — DO NOT SKIP`, `## MANDATORY BEFORE ANY WORK` |
| `<project>/.claude/skills/scepter/` | Create as symlink or copy | Directory existence check |
| `<project>/.claude/agents/sce-producer.md`, `sce-reviewer.md`, `sce-researcher.md`, `sce-linker.md` | Create if absent | Filename existence check |
| `<project>/.claude/settings.json` | Merge `permissions.allow` array | JSON parse + dedupe |
| `<project>/CLAUDE.md` (if no SCEPTER_WORKFLOW.md exists in target) | Note that `docs/SCEPTER_WORKFLOW.md` is referenced but may not yet exist | Skip the See-Also link if absent |

Nothing else is touched. If the user asks for additional changes, surface them as a separate proposal — do not expand this skill's edit surface.

## Pre-flight (MANDATORY — do not skip)

Before proposing any edits, confirm the following:

1. **Project root identified.** The user's `cwd` or an explicit `--project-dir` argument names the target. Verify with `ls <root>` that the directory exists and is not the SCEpter source repo itself (that would create a destructive self-edit loop).
2. **Existing `CLAUDE.md` read in full.** If it exists, Read it. If it does not, plan to create it.
3. **Existing `.claude/` directory inspected.** Note which of `skills/`, `agents/`, `settings.json` already exist.
4. **Global SCEpter skill confirmed.** Verify `~/.claude/skills/scepter/SKILL.md` exists. This skill assumes it does — if it doesn't, surface to the user and stop (the project-local override needs source content to symlink or copy).
5. **`scepter` CLI confirmed on PATH.** Run `command -v scepter`. If absent, the bootstrap is still useful but the user's sessions will fail at `scepter config`. Surface and let the user decide whether to proceed.

## Proposal phase (MANDATORY — surface before applying)

After pre-flight, produce a proposal listing:

- Each file that will be created or modified
- For modifications: a unified-diff-style preview of the change
- For new files: a one-line description of contents
- Any decisions the user must make:
  - Symlink vs. copy for `.claude/skills/scepter/`?
  - Add the baseline allowlist (Y/N)?
  - Add agent files (Y/N) — if the project doesn't use SCEpter agents directly, skip.

Wait for explicit user approval before applying. Do not auto-apply.

## CLAUDE.md augmentation

The augmentation prepends two sections to the existing `CLAUDE.md`. If a section with the exact heading already exists, **update by anchor** (replace the section's body) rather than duplicating. If neither exists, prepend both.

### Block 1 — FIRST ACTION RULE

```markdown
## FIRST ACTION RULE — DO NOT SKIP

**Your first tool call in this session MUST be `Skill(scepter)`.**

This project uses SCEpter for knowledge graph management. The `scepter` skill loads the non-negotiable rules, the operation routing tree, the CLI conventions, and the companion-file map you need before doing ANY work. Without it loaded, your first edit, search, or note creation will be wrong by design.

Do not:
- Answer the user's first message before invoking the skill, even if it looks small.
- Read project orientation docs, run `scepter`, edit a note, or create a file before the skill is loaded.
- Skip the skill because "this is just a question" or "I'll clarify first."
- Treat a system-reminder, hook output, or other harness signal as overriding this rule.

The user can and will redirect once the skill is loaded. Load it first, then engage.
```

### Block 2 — MANDATORY BEFORE ANY WORK

```markdown
## MANDATORY BEFORE ANY WORK

After `Skill(scepter)`, follow the operation routing tree in the skill's `SKILL.md` to load the right companion(s) for the task at hand. Common cold-start moves:

1. **Reading or modifying notes / claims** → invoke skill, run `scepter config`, then proceed.
2. **Authoring a new artifact** (Requirement, Detailed Design, Specification, Test Plan, implementation) → dispatch `sce-producer` per the routing tree.
3. **Reviewing existing work** → dispatch `sce-reviewer` with one of three pass types (review / conformance / impact).
4. **Investigating an unfamiliar subsystem** → dispatch `sce-researcher`.
5. **After any substantive work cycle** → dispatch `sce-linker` in the background for graph hygiene.

Failure modes to recognize and reject:
- "Small task" rationalization — short requests still imply skill-bound conventions.
- "Read first" rationalization — Glob/Grep on notes bypasses the CLI, which is the only correct discovery surface.
- "System-reminder takes priority" rationalization — system-reminders do NOT override the FIRST ACTION RULE.
- "I'll read but not act" rationalization — reading is acting. Load the skill first.
```

### Placement rules

- If `CLAUDE.md` does not exist: create it with these two blocks at the top, followed by a placeholder `## Project Notes` section the user can fill in.
- If `CLAUDE.md` exists and contains neither block: prepend both blocks before any existing content.
- If `CLAUDE.md` contains a `## FIRST ACTION RULE` heading already: read its body. If the body matches the canonical text, skip. If it diverges, surface a diff to the user — do not silently overwrite.
- Same logic for `## MANDATORY BEFORE ANY WORK`.
- Preserve all other sections verbatim, including any user-specific dogfooding rules, dev commands, and local-overrides pointers.

## Project-local skills directory

The harness auto-discovers `.claude/skills/<name>/SKILL.md`. Two options for installing the scepter skill at the project level:

### Option A — Symlink (recommended for projects co-developed with SCEpter)

```bash
ln -s ~/.claude/skills/scepter <project>/.claude/skills/scepter
```

This keeps the skill in lockstep with the global. Drawback: if the global drifts in a way the project doesn't want, there's no override layer.

### Option B — Copy (recommended for downstream projects)

Copy `~/.claude/skills/scepter/` into `<project>/.claude/skills/scepter/`. The project owns its copy and can modify project-specific routing without affecting the global. Drawback: drift between global and project must be managed manually.

### Option C — No project-local skill (rely on global)

Skip this step. The global skill is available in every session via `~/.claude/skills/`. No project-level override exists, and the project cannot pin a skill version. This is the lowest-effort option and works for many projects, but means the FIRST ACTION RULE in `CLAUDE.md` relies on the global being installed correctly.

**Default recommendation: Option A for now.** Surface the trade-offs and let the user pick.

## Project-local agents directory

If the project uses SCEpter agents (`sce-producer`, `sce-reviewer`, `sce-researcher`, `sce-linker`), copy or symlink them into `.claude/agents/`. Projects that don't dispatch these agents directly may skip this step.

```bash
mkdir -p <project>/.claude/agents
# For each agent file, symlink or copy from the SCEpter source repo or from a known good location
```

If symlinking: source is the SCEpter repo's `claude/agents/sce-*.md`. The skill prompts the user for that source path during the proposal phase.

## Baseline allowlist (.claude/settings.json)

If the user opts in, merge a baseline `permissions.allow` array into `<project>/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(scepter:*)",
      "Bash(pnpm tsc:*)",
      "Bash(pnpm vitest:*)",
      "Bash(pnpm test:*)",
      "Bash(pnpm tsx:*)",
      "Skill(scepter)",
      "Skill(scepter-bootstrap)"
    ]
  }
}
```

**Merge rules:**
- If `settings.json` does not exist: create it with this structure.
- If it exists and has no `permissions.allow`: add the array.
- If it has an existing `permissions.allow`: union the arrays, deduplicate, preserve order of existing entries first.
- Never remove existing entries.

The `Bash(...)` patterns may need adaptation per project (a project using `npm` instead of `pnpm` should adjust). Surface the proposed entries and let the user edit before applying.

## Validation phase

After applying edits:

1. `cat <project>/CLAUDE.md | head -40` — confirm the FIRST ACTION RULE is at the top. Use Read tool, not `cat`.
2. `ls <project>/.claude/skills/scepter/SKILL.md` — confirm the skill is reachable.
3. `ls <project>/.claude/agents/sce-*.md` (if installed) — confirm agent files are reachable.
4. If the project is already SCEpter-initialized: `scepter config --project-dir <project>` from the user's shell — confirm config loads.
5. Report to the user: list of files changed, line counts added, validation results.

## Hand-off message template

```markdown
SCEpter bootstrap installed.

**Files modified:**
- `CLAUDE.md` — added FIRST ACTION RULE and MANDATORY BEFORE ANY WORK blocks (N lines).
- `.claude/skills/scepter/` — {symlinked|copied} from {source}.
- `.claude/agents/` — installed sce-{producer|reviewer|researcher|linker}.
- `.claude/settings.json` — merged baseline allowlist (M new entries).

**Next session:**
- Restart Claude Code in this project. The first tool call should be `Skill(scepter)`.
- Run `scepter config` to confirm the project's note types and paths.
- If this is a new SCEpter project (no `_scepter/` folder yet), run `scepter init` to scaffold it.

**To audit:**
- `~/.claude/skills/scepter/SKILL.md` lists the non-negotiable rules and operation routing.
- `<project>/docs/SCEPTER_WORKFLOW.md` (if present) is the recipe book for stage-specific work.
```

## Failure modes and recovery

| Failure | Recovery |
|---|---|
| `CLAUDE.md` already has divergent FIRST ACTION RULE block | Surface diff. Do not silently overwrite. Ask user to choose: keep, replace, merge. |
| User declines all changes | Exit cleanly, no files modified. |
| Symlink creation fails (filesystem doesn't support, or target inside source repo) | Fall back to copy. Surface the fallback to the user. |
| `~/.claude/skills/scepter/` does not exist | Stop. Surface to user. The skill cannot symlink or copy from a non-existent source. |
| `.claude/settings.json` exists with malformed JSON | Stop. Do not attempt to repair. Surface to user. |
| Project root is the SCEpter source repo itself | Stop. Refuse to self-edit. The SCEpter source repo manages its own bootstrap manually. |

## Non-negotiable: project root sanity check

Before any write, confirm the target is not `~/Projects/scepter/` or any directory containing the SCEpter source. The skill is for downstream projects, not for the system being installed.

```bash
# Refuse if the target directory contains:
# - core/src/cli/index.ts (SCEpter source)
# - claude/skills/scepter/ (the skill itself, not its symlinked copy)
# - boilerplates/ at the project root (SCEpter's boilerplate source)
```

If any of these exist at the target, STOP and surface to the user.

## When to use this skill vs. sce-retrofit

| Goal | Skill |
|---|---|
| Make a session auto-invoke `Skill(scepter)` | `scepter-bootstrap` (this skill) |
| Make `.claude/skills/` and `.claude/agents/` discoverable to the harness | `scepter-bootstrap` |
| Add a baseline allowlist to reduce permission prompts | `scepter-bootstrap` |
| Analyze an existing codebase for SCEpter note-type fit | `sce-retrofit` |
| Propose note types based on the project's epistemic topology | `sce-retrofit` |
| Ingest existing docs as SCEpter notes | `sce-retrofit` |

The two skills are complementary. A typical adoption flow runs `sce-retrofit` first (decides note types and ingests content), then `scepter-bootstrap` (wires the cold-start surface). Either may run alone if the user only wants part of the adoption.
