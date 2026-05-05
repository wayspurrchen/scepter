# SCEpter Status Management

**MUST-LOAD whenever you are about to flip a status, author a new artifact, or record a lifecycle transition.** Producers, reviewers, and orchestrators all consult this file. Load is lazy — read when about to perform a status operation, not necessarily during initial orientation.

## Frontmatter First Rule

All status changes MUST be in the frontmatter `status` key BEFORE adding any progress note about the change:

```yaml
---
status: in_progress  # ← UPDATE THIS FIRST
---

## Status Updates
- 2025-11-12: Changed status to in_progress
```

The frontmatter is the authoritative state. The Status Updates section is the change log; it must agree with the frontmatter, never contradict it.

## Completion Rule

**NEVER mark tasks as `completed`, `done`, or `approved`** without explicit user verification.

| Transition | Authority |
|---|---|
| `pending` → `in_progress` | any agent |
| `in_progress` → `blocked` | any agent |
| `blocked` → `in_progress` | any agent |
| `in_progress` → `ready_for_review` | any agent |
| → `completed`, `done`, `approved` | **user only** |

Check `scepter config` and `scepter types list` for project-specific allowed statuses. Per-project status sets and validation modes (`suggest` vs `enforce`) may differ.

## Artifact Authoring Status (Producers)

When authoring a SCEpter artifact note (Requirement, Specification, TestSpec, DetailedDesign, Architecture) for the first time, leave the frontmatter `status` at the project's pending-equivalent default — typically `pending`, `proposed`, or `draft`. Check `scepter config` for the project's allowed statuses.

**Producers MUST NOT set `status: accepted` (or any post-review status) at initial authoring.** The trace matrix would then assert a review-pass that has not happened, and the artifact's `§Status Log` (when it exists) would contradict the frontmatter.

The status flip to `accepted` is an **orchestrator action after the reviewer returns APPROVED**. The orchestrator updates frontmatter and adds a Status Log entry:

```yaml
status: accepted  # post-review flip
```

```markdown
- YYYY-MM-DD: Reviewer pass APPROVED; status pending → accepted.
```

If a producer set `accepted` prematurely and the review subsequently passed, the orchestrator MAY leave the status alone (no ceremonial walk-back to `pending`) but MUST add the explicit Status Log entry so the artifact's lifecycle is honestly recorded. Going forward, the producer should not author with the post-review status set.

## Progress Notes

Always date with exact `date "+%Y-%m-%d"` output, never with "today," "now," or guessed dates:

```markdown
## Progress
- 2025-11-12: Started implementation of auth module
- 2025-11-12: Completed token generation (src/services/auth.ts)
- 2025-11-12: All unit tests passing
```

Progress notes go BELOW the status flip in the frontmatter. They describe activity; the frontmatter `status` describes lifecycle state. These are different and must both be updated.

## Status flips during arc closure

When closing an arc (multi-step body of work tracked under an anchor T-note), status flips on derived artifacts (R/S/DD draft → implemented; T in_progress → ready_for_review) are mechanical lifecycle work. The `/close-arc` skill walks the closeout checklist; consult that skill rather than improvising. Supersession lifecycle tags (`:superseded=TARGET`) on individual claims are governed by `claims.md` § Lifecycle Tags, not by this file.
