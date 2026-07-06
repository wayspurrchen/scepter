---
created: 2026-06-23T01:30:38.437Z
tags:
  - cli
  - dx
  - project-root
  - config
confidence: 🤖2 2026-06-23
---

# T007 - Resolve project root by walking up from cwd on subdirectory invocation

## Problem

Running `scepter` from a subdirectory of a SCEpter project does not find the project's
config. The user must `cd` to the project root or pass `--project-dir`. The expected
behavior is the one `git` and `npm` give: invoke the tool from anywhere inside the tree
and it discovers the governing project by walking up to the nearest ancestor that holds a
config.

## Current behavior

- `findProjectRoot(startPath)` (`core/src/storage/filesystem/create-filesystem-project.ts:238`)
  **already walks up** the directory tree and returns the first ancestor containing any of
  `scepter.config.js`, `_scepter/scepter.config.json`, or `_scepter/config.json`. It returns
  `null` if none is found before the filesystem root.
- The gap: the CLI's global option `--project-dir` (`core/src/cli/index.ts:62`) defaults to
  `process.cwd()` and is resolved to an absolute path **without** calling `findProjectRoot`
  (`core/src/cli/index.ts:66-72`). So nearly every command runs against the raw cwd.
- The only consumer that walks up today is `config.ts` (`core/src/cli/commands/config.ts:19`),
  which calls `ProjectManager.findProjectRoot(projectPath)`. The behavior is therefore
  inconsistent across commands.

## Desired behavior

Wire upward resolution into the global project-dir resolution in `core/src/cli/index.ts`
so that **every** command resolves the project root from cwd by walking up, matching the
git/npm experience. When the user passes an explicit `--project-dir`, honor it as the
starting point (and decide whether to still walk up from it — see OQ.01). When no config is
found in the ancestry, fail with a clear "not inside a SCEpter project" message rather than
silently operating against an empty cwd.

## Code surfaces

- `core/src/cli/index.ts:62` — global `--project-dir` default (`process.cwd()`).
- `core/src/cli/index.ts:66-72` — preSubcommand hook that absolutizes `projectDir`; the
  natural insertion point for an upward-resolve step.
- `core/src/storage/filesystem/create-filesystem-project.ts:238` — `findProjectRoot` (reuse,
  do not reimplement).
- `core/src/cli/commands/config.ts:19` — existing precedent consumer.
- Tests: `core/src/storage/filesystem/create-filesystem-project.test.ts:147-176`,
  `core/src/project/project-manager.test.ts:265-275` already cover `findProjectRoot` from a
  subdir; new tests should cover the CLI-level wiring.

## Open questions

- **OQ.01 — nearest vs. uppermost.** The request says find the "uppermost" config (analogy:
  npm/package.json). `findProjectRoot` currently returns the **nearest** ancestor with a
  config (which is what git/npm actually do). The two differ only when SCEpter projects are
  nested. Given `projectAliases` ({R011}) and VS Code multi-project support ({DD015}) make
  nested/peer projects a real concept, decide deliberately: keep nearest (consistent with
  git/npm and with `findProjectRoot` as-is), or add an "uppermost" walk that continues past
  the first hit to the topmost config. **Surface to user before implementing.**
- **OQ.02 — explicit `--project-dir` semantics.** When the user passes `--project-dir`,
  should resolution still walk up from that path, or treat it as an exact root? Likely treat
  an explicit flag as exact (no walk), but confirm.

## Related notes

- {DD011} — exports `findProjectRoot` ("Project root detection") in the library API surface.
- {R011} — Cross-Project Note and Claim References; nested/peer projects motivate OQ.01.
- {DD015} — VS Code multi-project resolution; adjacent prior art for "which project am I in".
- {T009} — Umbrella audit of claims + folder-note handling and CLI DX. Lists this task as the
  canonical "only one surface does it right" DX instance; OQ.01/OQ.02 here are tracked under
  {T009}.OQ.05. (Added 2026-06-23 — sibling/umbrella back-reference.)

