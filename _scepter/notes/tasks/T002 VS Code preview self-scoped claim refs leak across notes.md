---
created: 2026-05-04
tags: [vscode, claims, hover, bug]
status: ready_for_review
---

# T002 - VS Code preview: self-scoped claim refs leak across notes

## Bug

In the VS Code Markdown **preview hover** (and click navigation, editor hover, go-to-definition, decoration), a claim reference written without an explicit note id — e.g. `§5.AC.04`, `2.AC.02`, `AC.04` — could resolve to a same-suffix claim in an **unrelated note**.

Reproducer: open `/path/to/202605041433 R079 redraft - Schema Change Planning.md`. The basename does not start with a recognized note id (the ZK timestamp prefix defeats `noteIdFromPath`), so `contextNoteId` is `null`. A `§5.AC.04` written inside the document hovers/clicks through to `S040.§5.AC.04`. A `§1.AC.02` lands on `WL033.§1.AC.02`. The targets are completely unrelated to the document the user is reading.

The same failure mode applies even when the file IS a SCEpter note: if a self-scoped ref doesn't match a local claim, the resolver fell through to a global search and returned an arbitrary cross-note hit.

## Root cause

`ClaimIndexCache.resolve(id, contextNoteId)` had three steps:
1. Exact FQID match (`entries.get(id)`).
2. `${contextNoteId}.${id}` match (current-note overlay).
3. Bare-suffix fallback via `resolveBare` → `suffixIndex` keyed by claim id (e.g. `5.AC.04` → `[S040.5.AC.04]`).

Step 3 is correct for explicit FQIDs that happen not to match exactly. It is wrong for refs that **never had a note id in the first place** — those must stay scoped to the current document. The same defect affected `isKnown`.

## Fix

`vscode/src/patterns.ts:19` — added `selfScoped: boolean` to `ClaimMatch`. Set in `findAllMatches` as `!addr.noteId && !addr.aliasPrefix`. Always `false` for `parseNoteMentions` results (those are always explicit `{NOTEID}` forms).

`vscode/src/claim-index.ts` — `resolve` and `isKnown` accept `opts: { selfScoped?: boolean }`. When `selfScoped` is true, the resolver short-circuits before the bare-suffix fallback: if the local-overlay lookup misses, it returns `undefined` instead of grabbing a same-suffix claim from somewhere else.

Consumers updated to pass `match.selfScoped`:
- `vscode/src/markdown-plugin.ts` — preview hover (`buildDataAttrs`), click target (`buildLinkTarget`), inline badge emission, range members
- `vscode/src/hover-provider.ts` — editor hover, range hover
- `vscode/src/definition-provider.ts` — go-to-definition
- `vscode/src/decoration-provider.ts` — `isKnown` for resolved-vs-unresolved decoration

## Verified

- Parser flag exercise (`tsx /tmp/test-self-scoped.ts`): `§5.AC.04`, `2.AC.02`, `AC.04`, `{§5.AC.04}` all flagged `selfScoped=true`; `R044.§5.AC.04`, `{R044.§5.AC.04}`, `R005` flagged `selfScoped=false`.
- `pnpm tsc --noEmit` clean (the pre-existing `mismatched-self-prefix` error in `diagnostics-provider.ts` is unrelated).
- `node esbuild.mjs` clean build.

## Behavior matrix

| Ref | File context | Before | After |
|---|---|---|---|
| `§5.AC.04` | non-SCEpter doc | resolves to `S040.§5.AC.04` (random) | unresolved, "not in index" |
| `§5.AC.04` | R044.md, claim defined locally | resolves to `R044.§5.AC.04` | resolves to `R044.§5.AC.04` |
| `§5.AC.04` | R044.md, claim NOT defined locally | falls through to first matching note | unresolved |
| `R044.§5.AC.04` | anywhere | resolves to `R044.§5.AC.04` | resolves to `R044.§5.AC.04` |
| `vendor-lib/R005.§1.AC.01` | anywhere | cross-project route | cross-project route (unchanged) |

## Out of scope

- The redraft document at `docs/reviews/202605041433 R079 redraft - ...` is not in the SCEpter index; even with `contextNoteId` set, claims defined inside it cannot be resolved, because the index doesn't know they exist. The user's ask was specifically that the hover stop pointing at unrelated notes — that is what this fix delivers. Scanning the live preview document for in-flight claim definitions would be a follow-up.
- `noteIdFromPath` regex is unchanged. Recognizing ZK-prefixed redraft documents as SCEpter notes is a separate concern.
