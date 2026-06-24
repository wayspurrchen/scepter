# SCEpter Bootstrap

**Read this companion when installing SCEpter's cold-start surface into an existing project** — making sessions in that project auto-invoke the scepter skill on first action, ensuring the skills/agents are discoverable to the harness, and (optionally) seeding a baseline allowlist. For analyzing a project's information topology and proposing note types, read `retrofit.md` instead.

> **Terminology:** "bootstrap" here means *installing the cold-start surface into a target project*. It is distinct from the session-start "Bootstrap" sequence in `docs/SCEPTER_WORKFLOW.md` §2 (how an individual session begins with `Skill(scepter)`). This companion sets up the former so the latter can happen.

## Distribution: the plugin comes first

SCEpter ships as a Claude Code **plugin** (`scepter`, sourced from `claude/` in the SCEpter repo). When a project installs that plugin from the marketplace, the skills and agents are already discoverable — namespaced as `scepter:scepter`, `scepter:sce-producer`, etc. **Installing the plugin is the primary path**; it handles skill/agent discovery for you, and the symlink/copy steps below become unnecessary.

What the plugin does NOT do, and what this procedure adds on top:
- Augment the target project's `CLAUDE.md` with the FIRST ACTION RULE so sessions auto-invoke `Skill(scepter)`.
- Seed a baseline `.claude/settings.json` allowlist to reduce permission prompts.

The manual skill/agent installation (symlink/copy, below) is a **fallback** for environments not using the plugin system, or for projects that want to pin a local copy.

**This procedure does NOT:**
- Initialize a SCEpter project (no `scepter init` — assume the user runs that separately, or the project is already initialized).
- Propose note types or ingest existing docs into the knowledge graph (that's `retrofit.md`).
- Modify the global/plugin `scepter` skill content.
- Touch any files outside the well-defined edit surface listed below.

**Non-negotiable: every edit is non-destructive.** Existing `CLAUDE.md` content is preserved; new blocks are added with stable section anchors so subsequent runs are idempotent. Existing `.claude/settings.json` arrays are merged, not overwritten. Existing skill/agent files are never silently replaced.

## Edit surface

This skill modifies, at most, the following files:

| Path | Operation | Idempotency anchor |
|---|---|---|
| `<project>/CLAUDE.md` | Prepend or upsert blocks | `## FIRST ACTION RULE — DO NOT SKIP`, `## MANDATORY BEFORE ANY WORK` |
| `<project>/.claude/skills/scepter/` | Symlink or copy — **fallback only; skip if the plugin is installed** | Directory existence check |
| `<project>/.claude/agents/sce-producer.md`, `sce-reviewer.md`, `sce-researcher.md`, `sce-linker.md` | Create if absent — **fallback only; the plugin ships these** | Filename existence check |
| `<project>/.claude/settings.json` | Merge `permissions.allow` array | JSON parse + dedupe |
| `<project>/CLAUDE.md` (if no SCEPTER_WORKFLOW.md exists in target) | Note that `docs/SCEPTER_WORKFLOW.md` is referenced but may not yet exist | Skip the See-Also link if absent |

Nothing else is touched. If the user asks for additional changes, surface them as a separate proposal — do not expand this procedure's edit surface.

## Pre-flight (MANDATORY — do not skip)

Before proposing any edits, confirm the following:

1. **Project root identified.** The user's `cwd` or an explicit `--project-dir` argument names the target. Verify with `ls <root>` that the directory exists and is not the SCEpter source repo itself (that would create a destructive self-edit loop).
2. **Existing `CLAUDE.md` read in full.** If it exists, Read it. If it does not, plan to create it.
3. **Existing `.claude/` directory inspected.** Note which of `skills/`, `agents/`, `settings.json` already exist.
4. **SCEpter skill availability confirmed.** Determine how the target will reach the scepter skill: the **plugin** (installed from the marketplace — the primary path; check whether `scepter:scepter` resolves), or a fallback symlink/copy. If you intend a fallback install, confirm a source exists (a checkout of the SCEpter repo's `claude/skills/scepter/`, or a global `~/.claude/skills/scepter/SKILL.md`). If neither plugin nor source is available, surface to the user and stop.
5. **`scepter` CLI confirmed on PATH.** Run `command -v scepter`. The CLI ships separately via npm (`@wayspurrchen/scepter`), independent of the plugin. If absent, the bootstrap is still useful but the user's sessions will fail at `scepter config`. Surface and let the user decide whether to proceed.

## Proposal phase (MANDATORY — surface before applying)

After pre-flight, produce a proposal listing:

- Each file that will be created or modified
- For modifications: a unified-diff-style preview of the change
- For new files: a one-line description of contents
- Any decisions the user must make:
  - Plugin install vs. fallback symlink/copy for the skill and agents? (Default: plugin — skip the local install entirely.)
  - Add the baseline allowlist (Y/N)?
  - If falling back: symlink vs. copy, and whether to install agent files (skip if the project doesn't dispatch SCEpter agents directly).

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

## Making the skill and agents discoverable

The harness auto-discovers skills from installed plugins and from `.claude/skills/<name>/SKILL.md`. Pick ONE path:

### Option A — Plugin install (recommended; default)

Install the `scepter` plugin from the marketplace. Skills and agents are discoverable in every session in the project, namespaced `scepter:scepter`, `scepter:sce-producer`, `scepter:sce-reviewer`, `scepter:sce-researcher`, `scepter:sce-linker`. **No project-local skill/agent files are needed** — skip Options B/C entirely. The plugin tracks upstream and is the single-source distribution.

### Option B — Fallback symlink (for environments not using the plugin)

```bash
ln -s <scepter-repo>/claude/skills/scepter <project>/.claude/skills/scepter
```

Keeps the skill in lockstep with the source checkout. Drawback: if the source drifts in a way the project doesn't want, there's no override layer. Agents: symlink `<scepter-repo>/claude/agents/sce-*.md` into `<project>/.claude/agents/`.

### Option C — Fallback copy (to pin a local version)

Copy `<scepter-repo>/claude/skills/scepter/` into `<project>/.claude/skills/scepter/` (and `claude/agents/sce-*.md` into `.claude/agents/`). The project owns its copy and can modify project-specific routing. Drawback: drift from upstream must be managed manually.

**Default recommendation: Option A (plugin).** Use a fallback only when the plugin system is unavailable or the project must pin a version. Surface the trade-offs and let the user pick.

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
      "Skill(scepter:scepter)"
    ]
  }
}
```

**Merge rules:**
- If `settings.json` does not exist: create it with this structure.
- If it exists and has no `permissions.allow`: add the array.
- If it has an existing `permissions.allow`: union the arrays, deduplicate, preserve order of existing entries first.
- Never remove existing entries.

Notes:
- Plugin skills are namespaced — the skill is `scepter:scepter`, so the permission entry is `Skill(scepter:scepter)`. (The FIRST ACTION RULE may invoke it as `Skill(scepter)`; the harness resolves the namespace. If permission prompts still appear, confirm the entry matches the namespaced form the installed plugin exposes.) There is no longer a separate `scepter-bootstrap` skill to allowlist — retrofit and bootstrap are companions of the scepter skill.
- The `Bash(...)` patterns may need adaptation per project (a project using `npm` instead of `pnpm` should adjust). Surface the proposed entries and let the user edit before applying.

## Validation phase

After applying edits:

1. Read `<project>/CLAUDE.md` (first ~40 lines) — confirm the FIRST ACTION RULE is at the top.
2. Confirm the skill is reachable: if via plugin, that `scepter:scepter` resolves in a session; if via fallback, that `<project>/.claude/skills/scepter/SKILL.md` exists.
3. (Fallback only) `ls <project>/.claude/agents/sce-*.md` — confirm agent files are reachable.
4. If the project is already SCEpter-initialized: `scepter config --project-dir <project>` from the user's shell — confirm config loads.
5. Report to the user: list of files changed, line counts added, validation results.

## Hand-off message template

```markdown
SCEpter bootstrap installed.

**Files modified:**
- `CLAUDE.md` — added FIRST ACTION RULE and MANDATORY BEFORE ANY WORK blocks (N lines).
- Skill/agents: installed via the `scepter` plugin (no local files) — OR (fallback) `.claude/skills/scepter/` {symlinked|copied} from {source} and `.claude/agents/` sce-{producer|reviewer|researcher|linker}.
- `.claude/settings.json` — merged baseline allowlist (M new entries).

**Next session:**
- Restart Claude Code in this project. The first tool call should be `Skill(scepter)`.
- Run `scepter config` to confirm the project's note types and paths.
- If this is a new SCEpter project (no `_scepter/` folder yet), run `scepter init` to scaffold it.

**To audit:**
- The scepter skill's `SKILL.md` (via the plugin, or the fallback `.claude/skills/scepter/SKILL.md`) lists the non-negotiable rules and operation routing.
- `<project>/docs/SCEPTER_WORKFLOW.md` (if present) is the recipe book for stage-specific work.
```

## Failure modes and recovery

| Failure | Recovery |
|---|---|
| `CLAUDE.md` already has divergent FIRST ACTION RULE block | Surface diff. Do not silently overwrite. Ask user to choose: keep, replace, merge. |
| User declines all changes | Exit cleanly, no files modified. |
| Symlink creation fails (filesystem doesn't support, or target inside source repo) | Fall back to copy. Surface the fallback to the user. |
| Fallback chosen but no source (`<scepter-repo>/claude/skills/scepter/` or global) exists | Stop. Surface to user. Cannot symlink or copy from a non-existent source — prefer the plugin install instead. |
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

## Bootstrap vs. retrofit (the two adoption companions)

| Goal | Companion |
|---|---|
| Make a session auto-invoke `Skill(scepter)` | `bootstrap.md` (this companion) |
| Make the skill and agents discoverable to the harness (plugin or fallback) | `bootstrap.md` |
| Add a baseline allowlist to reduce permission prompts | `bootstrap.md` |
| Analyze an existing codebase for SCEpter note-type fit | `retrofit.md` |
| Propose note types based on the project's epistemic topology | `retrofit.md` |
| Ingest existing docs as SCEpter notes | `retrofit.md` |

The two are complementary. A typical adoption flow runs the **retrofit** path first (decides note types and ingests content), then the **bootstrap** path (wires the cold-start surface). Either may run alone if the user only wants part of the adoption.
