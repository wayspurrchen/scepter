---
created: 2026-05-19T17:15:40.728Z
tags:
  - cleanup
  - references
  - delete
  - dead-code
confidence: 🤖2 2026-05-19
---

# T004 - Remove stubbed #deleted reference-update subsystem

## Context

Surfaced during the {R015} / {DD020} implementation cycle on 2026-05-19. The producer and reviewer pair discovered that the existing `#deleted` tag reference-update path is a stub — the functions build in-memory maps and return without writing files; the call site logs `"Would update N references"` rather than mutating.

Today's effective soft-delete behavior:
- File is relocated to `_deleted/`.
- Frontmatter tag `#deleted` is appended.
- **Inbound references are NOT updated** despite the API surface suggesting they are. The references continue to resolve correctly only because discovery includes `_deleted/`.

The subsystem's stub nature has been latent in the codebase for an unknown duration. The user (Way) reports having forgotten about it.

## Affected code

- `core/src/references/reference-manager.ts:238–380` — three functions in the `#deleted` tag pipeline that build in-memory maps without persisting.
- `core/src/notes/note-manager.ts:797` — call site that logs `"Would update N references"` rather than mutating.
- Any related dead code in the `updateReferencesForDeletion` / `updateReferencesForRestoration` lineage.

Verify with a fresh read before removing — code may have shifted since the 2026-05-19 surface.

## Scope

Remove the stubbed subsystem entirely. Soft-delete continues to do what it actually does (relocate + tag); the API surface that pretended to update references gets removed so the code reflects reality.

In scope:
- Delete the stubbed functions in `reference-manager.ts`.
- Delete the `"Would update N references"` log call site.
- Audit for callers of the removed functions; remove or simplify each.
- Update any tests that exercise the stub.
- Ensure `scepter delete` (soft mode, the default after R015) still behaves correctly post-removal: file moves to `_deleted/`, tag is added, inbound refs continue to resolve via discovery.

Out of scope:
- Any reframing of what soft-delete should do in the future. If soft-delete reference-update is ever wanted as real behavior, that is a separate requirement note.
- {R015} hard-delete path (independent; uses the new rewriter).

## Acceptance

- The three stubbed functions are removed from `reference-manager.ts`.
- The `"Would update N references"` log call is removed.
- `pnpm tsc --noEmit` clean.
- `pnpm vitest run` clean.
- A manual or scripted soft-delete on a folder-form note in a test project confirms inbound refs still resolve via discovery.

## Sequencing

Wait until {R015} / {DD020} implementation is complete and committed. Then this task can run independently.

## References

- {R015} — Note Reference Rewriting on Delete and Rename (the work that surfaced this stub)
- {DD020} — Reference Rewriting on Delete and Rename - Implementation Blueprint
