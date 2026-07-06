---
created: 2026-07-05T21:27:40.621Z
status: ready_for_review
tags:
  - performance
  - vscode
  - cross-project
confidence: 🤖2 2026-07-05
---

# T011 - Peer claim index rebuilt on every lookupClaim freezes VS Code extension host

## Symptom

VS Code became unusable (multi-second spins on ordinary edits like paste) while
a project containing cross-project alias references was open. A CPU profile of
the extension host showed 5.26s spent almost entirely in a single
`lookupClaim → ClaimIndex.build` call chain.

## Root cause

`PeerProjectResolver.lookupClaim` (`core/src/project/peer-project-resolver.ts`)
rebuilt the **entire peer project's claim index from scratch on every call** —
`claimIndex.build(peerNotesWithContent)` with no caching of the result. The
existing `peerCache` cached only the peer `ProjectManager`, not the built index.

This is a **conformance gap against {R011.§4.AC.07}** ("Peer-index cache owned
by core") and the {DD015} design, which specified that `lookupClaim` queries an
*already-built* peer index via `claimIndex.getClaim(fqid)`.

Two multipliers turned one slow build into a freeze:
1. `ClaimIndexCache.validateCrossProjectReferences` (extension `refresh()`) calls
   `lookupClaim`/`lookupNote` once per cross-project reference, sequentially. A
   project with N claim-level cross-project refs paid N full peer rebuilds per
   refresh (observed field case: 17 refs → ~17 rebuilds ≈ 90s of blocked host).
2. The hover provider and definition provider call `resolveCrossProject` →
   `lookupClaim` on every hover/goto over a cross-project reference — another
   full rebuild each.

The peer in the field case had ~1,942 notes / ~48,553 claim references, so a
single build was ~5s. `ClaimIndex.build` is fully synchronous, so each build
blocks the single-threaded extension host event loop for its full duration.

Two O(references × entries) scans inside `build()` amplified per-build cost:
- `ClaimIndex.findContainingClaim` scanned **all** index entries per cross-note
  reference (~26% of build self-time in the profile).
- The shared resolver's `collectSectionlessMatches` and `noteExistsInIndex`
  (`reference-resolver.ts`) each scan all entries per reference (~41% self-time,
  shown as `resolveClaimAddress` in the profiled bundle).

## Fix (this change)

1. **Cache the peer's built index** — added `peerIndexCache` +
   `ensurePeerIndexBuilt()` to `PeerProjectResolver`; `lookupClaim` now builds
   once per alias and reuses it. Cleared in `invalidate()` /
   `invalidateChanged()` so an alias repoint rebuilds on next lookup.
   Realizes {R011.§4.AC.07} / {R011.§2.AC.06}. This is the fix that turns the
   N-rebuilds-per-refresh freeze into a single one-time build.
2. **`findContainingClaim` O(entries) → O(claims-in-note)** — `ClaimIndex.build`
   Phase 2 now groups entries by note once (`entriesByNote`) and passes the
   citing note's own claims into `findContainingClaim`. Behavior-preserving.

Verified: `pnpm typecheck` clean; the `peer-project-resolver.test.ts` and
`core/src/claims/__tests__/claim-index.test.ts` suites pass — 69/69 total.

## Follow-up (not in this change)

- **Resolver O(references × entries) scans.** `collectSectionlessMatches` and
  `noteExistsInIndex` in `reference-resolver.ts` iterate the full entry map per
  reference. With the peer index now cached this is off the hot repeat path, but
  a single large build still blocks the host for ~3s. Precomputing a note-id set
  + suffix→FQID index once per build would remove it. Higher-risk (the resolver
  is the shared normative path used by lint/trace/gaps) — route through review.
- **Make `ClaimIndex.build` yield** (or run off the host) so even a first cold
  build never blocks paste/typing.
- **Dedup `validateCrossProjectReferences`** by resolved target.

## References

Implemented in `core/src/project/peer-project-resolver.ts` and
`core/src/claims/claim-index.ts`. Design context: {DD015} (cross-project
resolution), {R011} (cross-project references, esp. §2.AC.06 / §4.AC.07).

