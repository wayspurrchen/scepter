---
created: 2026-06-24T21:22:15.074Z
status: ready_for_review
tags:
  - skills
  - routing
  - refactor
  - docs
confidence: 🤖2 2026-06-24
---

# T007 - Fold sce-retrofit and scepter-bootstrap into main scepter skill as companion files with explicit router branches

## Goal

Today `sce-retrofit` and `scepter-bootstrap` are standalone skills in the `scepter` plugin (`claude/skills/`). The main `scepter` skill's operation routing tree has **no branch** pointing at either — so a session that obeys the FIRST ACTION RULE (`Skill(scepter)` first) never gets routed to the setup/adoption skills. Fold both into the main skill as companion files and add explicit router branches so "retrofit"/"bootstrap"/"set up scepter here" routes correctly from the one tree everyone loads.

## Locked direction (user, 2026-06-24)

**Merge as companion files, not keep-separate.** Companion files are loaded on demand via Read (only `SKILL.md` is auto-injected on invoke), so folding the bodies into `claude/skills/scepter/` carries no always-on token cost. The two standalone skills are removed; their content becomes companions of the main skill, reached through new routing-tree branches. (Rejected alternative: keep them as separate skills with a router pointing at `Skill(scepter:...)`.)

Tradeoff accepted: loses cold standalone invocation (`/sce-retrofit` on a not-yet-set-up project). Mitigated by the main skill's description reading as the obvious entry point + the new routing branches.

## Plan

1. **Move content → companions** under `claude/skills/scepter/`:
   - `sce-retrofit/SKILL.md` + `analysis.md` + `proposal.md` → `retrofit.md` (+ `retrofit-analysis.md`, `retrofit-proposal.md` if kept split).
   - `scepter-bootstrap/SKILL.md` → `bootstrap.md`.
2. **Add router branches** to `scepter/SKILL.md` operation routing tree + Companion Files list.
3. **Delete** `claude/skills/sce-retrofit/` and `claude/skills/scepter-bootstrap/` dirs.
4. **Completeness refresh** (see below) folded in during the move.
5. **Disambiguate "bootstrap"** — `SCEPTER_WORKFLOW.md` §2 already uses "Bootstrap" for session-start. Name the companion/branch to avoid collision (e.g. "Installing SCEpter into a project" rather than bare "Bootstrap").
6. Update any cross-references (`SCEPTER_WORKFLOW.md`, manifest) that named the old skills.

## Completeness findings to fix during the move

- **retrofit (most stale, last substantive update 2026-03/04):** Phase 3 step 4 tells the agent to use `scepter normalize`/`scepter import` "when available" and otherwise manually move files + assign IDs. Reality: **`scepter ingest <type> <sources...>`** exists now (`--dry-run`, `--move`, `--tags`, `--status`). `normalize` never existed; `import` is `ingest`. Rewrite the ingestion step around the real command.
- retrofit doesn't mention `scepter lint --all` (project-wide ref audit, landed R016/DD022) as post-ingest validation, nor `gaps`/`trace`/`convert`.
- retrofit never mentions the **claims system** — SCEpter's headline differentiator. Its examples lean on `Decision`/`Question` types this project doesn't even use (real taxonomy: A/R/S/DD/TS/T).
- **bootstrap (last update 2026-05-07, structurally sound):** Its install model (symlink/copy from `~/.claude/skills/scepter`, copy agent files) predates the **plugin packaging**. Installing the `scepter` plugin from the marketplace already makes skills+agents discoverable — so bootstrap's skill/agent-copying step is largely superseded, leaving CLAUDE.md augmentation + allowlist. Reframe around the plugin; the baseline allowlist's `Skill(scepter)` / `Skill(scepter-bootstrap)` patterns are namespace-stale vs `scepter:scepter`.
- Neither the marketplace nor plugin manifest lists these skills (moot after merge, but the manifest description should reflect the final shape).

## Status

**ready_for_review** (2026-06-24). Merge executed:
- Created companions under `claude/skills/scepter/`: `retrofit.md` (refreshed: real `scepter ingest`, `lint --all`/`gaps`/`trace` validation, claim-addressability guidance), `retrofit-analysis.md` + `retrofit-proposal.md` (evergreen, moved verbatim), `bootstrap.md` (reframed around the plugin as primary install; symlink/copy demoted to fallback; namespace-fixed allowlist, dropped dead `Skill(scepter-bootstrap)`).
- Added two router branches to `SKILL.md` operation tree (ADOPTING → retrofit.md, INSTALLING cold-start surface → bootstrap.md) and expanded the skill `description` so cold "retrofit"/"bootstrap"/"set up scepter here" invocations resolve to this skill.
- Deleted `claude/skills/sce-retrofit/` and `claude/skills/scepter-bootstrap/`.
- Updated cross-refs: `README.md` (single skill + adoption companions), `docs/architecture/ARCHITECTURE_OVERVIEW.md` dir tree.
- Verified: no stale `sce-retrofit`/`scepter-bootstrap` refs remain (except this note + bootstrap.md's explanatory line); routing tree well-formed; companions intact.

Bundled in the same session: the F005 reconciliation (now {R018}) — tracked separately, NOT under this task.

