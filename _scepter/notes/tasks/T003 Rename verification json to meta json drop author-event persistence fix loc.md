---
created: 2026-05-07T05:21:15.726Z
tags: [refactor, metadata-store, naming, lock]
status: ready_for_review
confidence: "\U0001F9162 2026-05-07"
---

# T003 - Rename verification.json to meta.json, drop author-event persistence, fix lock leak

## Context

Forensic investigation surfaced three coupled issues in the metadata-store layer (existing design: {DD014}, architecture: {A004}, source requirement: {R009}):

1. **Filename anachronism.** The on-disk store is still named `verification.json` despite the in-code rename to `MetadataStorage` / `claims meta`. {DD014} and {A004} kept the old filename for installed-project compatibility. User has authorized dropping back-compat — rename to `meta.json` is now in scope.

2. **Author-event persistence pollutes the log.** Every `ensureIndex()` call walks every note and persists each author suffix token (`:closed`, `:derives=R001.§1.AC.01`, `:5`, etc.) as a `MetadataEvent` with `actor=author:<notepath>` (see `core/src/claims/metadata-ingest.ts:reconcileNoteEvents` and `core/src/cli/commands/claims/ensure-index.ts:101`). The author-event write is the basis of {R009.§4} ("lossless ingest") and {DD014.§3.DC.38-44}. The user's design call: source markdown is authoritative for what is written there; the event log holds only CLI/agent-issued meta that has no source-text equivalent. Author-event ingest is dropped entirely; reads merge parsed-from-markdown + applied-from-events at fold time.

3. **Lock sidecar leaks.** `FilesystemMetadataStorage.ensureLockFile` (`core/src/storage/filesystem/filesystem-metadata-storage.ts:220`) creates `verification.json.lock` as an empty regular file before `proper-lockfile.lock()` runs. `proper-lockfile` manages its own sidecar (a `.lock.lock` directory), but the eagerly-created regular file is never removed. The 0-byte `.lock` file we observe in the project root is exactly that artifact.

## Decision recorded

User-authorized 2026-05-07: do all three together as one coordinated change, no backward compatibility, no migration shim. Override semantics: CLI cannot override author tags — to remove `:closed`, edit the markdown.

## Scope

- New DD authoring the overlay model + rename + lock fix as one blueprint
- Supersede the affected claims in {DD014} (the §DC.38-44 author-delta ingest path) and the {A004} suffix-grammar half of the architecture
- Reassess {R009.§4} ("lossless ingest" requirement) — the new model satisfies losslessness trivially because author tokens are never transformed away from their markdown source
- Implementation: rename file, delete `applyAuthorDeltas` / `reconcileNoteEvents`, refactor read paths to merge parsed-markdown + folded-events, fix the lock leak

## Files in scope (preliminary)

- `core/src/storage/filesystem/filesystem-metadata-storage.ts` — rename constant, fix lock leak
- `core/src/claims/metadata-ingest.ts` — delete event-emission path; keep parsing helpers if needed
- `core/src/claims/claim-index.ts` — delete `applyAuthorDeltas` / `computeAuthorDeltas`
- `core/src/cli/commands/claims/ensure-index.ts` — drop the post-build delta commit
- `core/src/claims/claim-metadata.ts` and consumers — augment fold to merge markdown-parsed + event-derived
- Tests under `core/src/claims/__tests__/` and `core/src/storage/filesystem/` — update expectations
- `_scepter/verification.json` (and any project copies) — manual rename

## Acceptance

- `meta.json` is the on-disk filename
- No new events with `actor=author:*` ever get written
- `ensureIndex()` performs zero writes to the metadata store
- `meta.json.lock` does not persist after a successful CLI invocation completes
- `parseClaimMetadata` continues to return correct results — verified by existing lossless tests
- `claims trace` / `claims gaps` / `claims stale` output unchanged for claims with no CLI-issued events

## Status

`ready_for_review` — DD {DD019} authored 2026-05-07 covering all three parts (overlay model, `meta.json` rename, lock-leak fix). Awaiting user/reviewer pass before implementation begins.

## Progress

- 2026-05-07: Authored {DD019} (Meta Store Overlay Model and `verification.json` Rename) covering all three parts as a single coordinated refactor. Applied `:superseded=DD019.§3.DC.NN` markers to the invalidated claims in {DD014} (DC.19, DC.38, DC.40, DC.41, DC.42, DC.43, DC.44), {A004} (§2.AC.04, §3.AC.01, §3.AC.03, §3.AC.04), and {R009} (§4.AC.07, §4.AC.08, §7.AC.03). Lint clean apart from expected derives-from-superseded warnings on DD019 itself (claims that derive from claims they supersede — natural for this kind of refactor). Status flipped `ready_for_design` → `ready_for_review`.

- 2026-05-07: Implemented {DD019} per its §6 six-phase integration sequence. Phase 1 added `mergeMarkdownIntoFold(entry, folded)` to `metadata-filters.ts` and threaded a `getEntry` lookup through `applyMetadataFilters`; updated `trace`, `gaps`, and `search` callers; added 12 new tests (overlay merge purity + Phase-1 idempotence safety net) — all passing alongside the 24 pre-existing filter tests. Phase 2 deleted the post-build delta-commit block from `ensure-index.ts`; verified `meta.json` size unchanged across `ensureIndex` invocations. Phase 3 deleted `metadata-ingest.ts`, `metadata-ingest.test.ts`, and the `applyAuthorDeltas`/`computeAuthorDeltas` methods on `ClaimIndex`; rewrote `claim-metadata.lossless.test.ts` as a parser-only invariant per DC.45. Phase 4 renamed `STORE_FILENAME` to `'meta.json'` in source + three test mirrors; updated error strings, JSDoc, and `docs/architecture/ARCHITECTURE_OVERVIEW.md` + `CLAIM_SYSTEM.md`; manually `mv`d the on-disk file. Phase 5 wrote three regression tests for the lock leak (TDD: two failed against the eager `ensureLockFile`, one passed asserting proper-lockfile cleans its `.lock.lock`), then deleted `ensureLockFile()` and its callsite in `withLock`; all six lock tests pass; manually `rm`d the leaked `verification.json.lock`. Phase 6 deleted `migrate-legacy-command.ts` + its test, dropped the barrel registration in `meta/index.ts`, updated `meta-structure.test.ts` to expect six subcommands. Final state: `meta.json` exists, `verification.json` is gone, no lock file persists. Real-CLI verifications against `DD019.§3.DC.20` and `DD019.§3.DC.42` confirm the write path works and leaves no lock artifact. `scepter trace DD019` shows Source projection coverage on all DCs that produced code changes. Pre-existing baseline failures (5 test files: context-gatherer, task-dispatcher x2, auth fixture, gather-source-refs) unchanged. Status flipped `in_progress` → `ready_for_review`.

- 2026-05-07: Linker pass complete. Verified zero stale `@implements {DD014.§3.DC.19/.38/.40-44}` annotations on superseded DCs. Added missing annotations: `@implements {DD019.§3.DC.34}` on `query`/`fold` in `filesystem-metadata-storage.ts` (reads-don't-lock invariant); `@implements {DD019.§3.DC.15}` in `claims/index.ts` (metadata-ingest barrel removal); `@validates {DD019.§3.DC.34,.DC.38}` on the existing concurrent-write describe block in `filesystem-metadata-storage.lock.test.ts`. Confirmed all 14 supersession targets resolve. Lint state: DD019 = 6 expected derives-from-superseded warnings (no others); DD014 = 2 derives-from-superseded warnings on DC.14/DC.15 deriving from now-superseded A004.§2.AC.04 (intentional historical link, surfaced not auto-fixed); A004 = 3 partial-derivation warnings on pre-existing DD014 coverage gaps (unrelated to DD019); R009 = 1 partial-derivation on R009.§4.AC.07 (DD019.§3.DC.04 source coverage is via deletion — correctly empty).

- 2026-05-07: R009.§4 and A004.§3 framing prose rewritten to overlay model.
