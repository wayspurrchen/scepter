---
created: 2026-05-07
status: ready_for_review
tags: [refactor, metadata-store, overlay, naming, lock]
confidence: "🤖2 2026-05-07"
---

# DD019 - Meta Store Overlay Model, `meta.json` Rename, and Lock-Leak Fix

**Task:** {T003}
**Supersedes (in part):** {DD014.§3.DC.19}, {DD014.§3.DC.38}, {DD014.§3.DC.40}, {DD014.§3.DC.41}, {DD014.§3.DC.42}, {DD014.§3.DC.43}, {DD014.§3.DC.44}, {A004.§2.AC.04}, {A004.§3.AC.01}, {A004.§3.AC.03}, {A004.§3.AC.04}, {R009.§7.AC.03}, {R009.§4.AC.07}, {R009.§4.AC.08}

## §1 Specification Scope

This DD authors a single coordinated refactor of the metadata-store layer with three coupled parts. The user has authorized dropping back-compat, deleting the author-event ingest path, renaming the on-disk file, and fixing a lock-file leak in one change. {T003} records the authorization.

### §1.1 Three coupled changes

DC.01:5 The metadata layer's read API MUST overlay author-declared suffix tokens onto the event-derived projection at fold time, so the markdown source is the authoritative input for any tag written there and the event log is reserved for CLI/agent-issued meta. The author-event ingest path (`reconcileNoteEvents`, `applyAuthorDeltas`, `computeAuthorDeltas`, the `ensureIndex` post-build commit) MUST be deleted; no events with `actor=author:*` are ever written. (Highest binding: this is the model change every consumer of `metadataStorage.fold` and `metadataStorage.query` depends on.)

DC.02:5 The on-disk filename MUST become `meta.json`. No back-compat shim, no migration of installed projects, no legacy auto-detection. The `STORE_FILENAME` constant, error message strings, lock-sidecar path, watch path, test-suite hardcoded constants, and DD/spec/note prose that names the file MUST all change in lockstep. (Highest binding: filename appears in storage, tests, the migration command, and downstream documentation.)

DC.03:4 The eagerly-created sidecar `meta.json.lock` regular file (currently produced by `ensureLockFile()` before `proper-lockfile.lock()` runs) MUST be removed from the codebase and from the runtime call sequence. `proper-lockfile` manages its own `.lock.lock` directory for the actual mutex; the eager regular file is a leak with no operational role. After this DD, no lock artifact persists on disk after a successful CLI invocation.

### §1.2 R009 ACs in scope

The DD addresses R009 ACs that govern the metadata store's substrate, the suffix-grammar ingest, the legacy-file boundary, and the lock semantic:

- **{R009.§4.AC.01–.AC.06}** — suffix grammar generalization. Re-interpreted under the overlay model: the markdown tokens are still recognized and STILL produce the same `ParsedMetadata`-shaped projection at read time, but they are NEVER persisted as events. The "implicit event" framing of these ACs is replaced by an "implicit projection" framing — same observable behavior at read sites, no event-log mutation. AC.01–.AC.06 remain *active and re-interpreted*; the DCs in §3 below are the new mechanism.
- **{R009.§4.AC.07}** — distinguishability of implicit vs CLI events by `actor` prefix. Under the overlay, no implicit events exist, so the "filter to implicit events only" capability is satisfied by filtering at the markdown-projection layer (which is per-note already). Marked **superseded** by §3 DC.10 below: the new model makes the distinction structural, not actor-prefix-based.
- **{R009.§4.AC.08}** — re-ingest reconciliation invariant. Under the overlay, re-indexing is a pure read (no events to reconcile), so the invariant ("the implicit-event set equals the set produced by parsing the current document") holds vacuously by construction. Marked **superseded** by §3 DC.04 (no implicit events to reconcile).
- **{R009.§7.AC.03}** — "system MUST preserve the legacy file name". Reversed by user authorization on 2026-05-07. Marked **superseded** by §3 DC.21 below.
- **{R009.§1.AC.10–.AC.12}** — persistence durability requirements. Preserved unchanged.
- **{R009.§7.AC.01–.AC.02}** — legacy-store load-time migration. The `meta migrate-legacy` command's role is reassessed; see §3 DC.40 (retire). The runtime no longer recognizes the legacy filename at all.

### §1.3 ACs requiring requirement-level work (out-of-scope for this DD)

The following items I cannot resolve at the DD level. The user (or a future requirement edit) needs to decide:

- **{R009.§4} as a whole** — under the overlay model, "the suffix grammar generalization" is no longer an ingest-mechanism requirement; it is a read-projection requirement. The §4 prose says "promotes those tokens to first-class implicit events" (line 187 of R009), which is no longer true. The individual ACs are addressable case-by-case (above), but the `§4` introductory framing is structurally inaccurate under the new model. **The user should consider an R009 §4 rewrite** that re-frames the section as "the suffix grammar is recognized at read time" rather than "translated to events at ingest time." This DD treats the existing ACs in their literal form and either re-interprets or supersedes them; it does not author a new framing for §4.
- **{A004.§3} (Ingest Paths and Reconciliation)** — the entire §3 of A004 architecturally describes the now-deleted ingest path. Three of its four ACs (.AC.01, .AC.03, .AC.04) are superseded here. {A004.§3.AC.02} (lossless normalization table) remains valid as a read-projection rule. {A004.§3.AC.05} (watch mode for the meta file) remains valid. The user should consider whether A004 §3 deserves a structural rewrite ("Read-Time Overlay" replacing "Ingest Paths and Reconciliation") or whether marking the individual ACs as superseded is sufficient.

### §1.4 Open questions

- **OQ.01** — what happens to existing project data: this project's `_scepter/verification.json` contains 277KB of real events under the new shape (verified at the start of this DD). The user owns the manual rename at implementation time; the DD does not script it. Phase 4 of the integration sequence calls this out explicitly.
- **OQ.02** — `claims meta migrate-legacy` retirement: the command exists to convert pre-A004 legacy `VerificationEvent` documents to the post-A004 `MetadataEvent` shape. With the rename to `meta.json`, the legacy file (`verification.json` of either shape) is now invisible to the runtime. The migration command can either be (a) deleted outright, (b) retained as a one-shot offline tool the user invokes manually before the rename, or (c) repurposed to also rename `verification.json` → `meta.json` after migrating shape. Decision below in §3 DC.40 — recommendation is (a) delete; the user's project is the only known holder of legacy data and the user has already migrated.

---

## §2 Primitive Preconditions

Every type/function/file the DD references with PRESENT/ABSENT status. Halt if any ABSENT lacks a deferral or companion DD.

| Primitive | Source Citation | Status |
|---|---|---|
| `STORE_FILENAME` constant | `core/src/storage/filesystem/filesystem-metadata-storage.ts:38` | PRESENT |
| `STORE_FILENAME` constant (test mirror) | `core/src/storage/filesystem/filesystem-metadata-storage.test.ts:19` | PRESENT |
| `STORE_FILENAME` constant (lock test mirror) | `core/src/storage/filesystem/filesystem-metadata-storage.lock.test.ts:16` | PRESENT |
| `STORE_FILENAME` constant (watch test mirror) | `core/src/storage/filesystem/filesystem-metadata-storage.watch.test.ts:17` | PRESENT |
| `STORE_FILENAME` constant (migrate-legacy command) | `core/src/cli/commands/claims/meta/migrate-legacy-command.ts:33` | PRESENT |
| `FilesystemMetadataStorage` class | `core/src/storage/filesystem/filesystem-metadata-storage.ts:50` | PRESENT |
| `FilesystemMetadataStorage.ensureLockFile()` | `core/src/storage/filesystem/filesystem-metadata-storage.ts:220` | PRESENT — DELETED per §3 DC.31 |
| `FilesystemMetadataStorage.withLock<T>` | `core/src/storage/filesystem/filesystem-metadata-storage.ts:183` | PRESENT — MODIFIED per §3 DC.32 |
| `lockfile.lock` (proper-lockfile) | `core/src/storage/filesystem/filesystem-metadata-storage.ts:191` | PRESENT |
| `MetadataEvent` interface | `core/src/claims/metadata-event.ts:36` | PRESENT |
| `MetadataStore` type | `core/src/claims/metadata-event.ts:76` | PRESENT |
| `applyFold` function | `core/src/claims/metadata-event.ts:114` | PRESENT |
| `MetadataStorage` interface | `core/src/storage/storage-backend.ts:103` | PRESENT |
| `MetadataStorage.fold(claimId)` method | `core/src/storage/storage-backend.ts:103` (interface declaration) | PRESENT |
| `parseClaimMetadata` function | `core/src/claims/claim-metadata.ts:125` | PRESENT |
| `ParsedMetadata` interface | `core/src/claims/claim-metadata.ts:43` | PRESENT |
| `isLifecycleTag` function | `core/src/claims/claim-metadata.ts:77` | PRESENT |
| `isDerivationTag` function | `core/src/claims/claim-metadata.ts:96` | PRESENT |
| `tokenToKeyValues` function | `core/src/claims/metadata-ingest.ts:54` | PRESENT — DELETED per §3 DC.06 (logic re-homed in claim-metadata.ts) |
| `reconcileNoteEvents` function | `core/src/claims/metadata-ingest.ts:124` | PRESENT — DELETED per §3 DC.04 |
| `reconstructFromFold` function | `core/src/claims/metadata-ingest.ts:239` | PRESENT — DELETED per §3 DC.07 (test-only helper, no longer needed) |
| `ClaimIndex.computeAuthorDeltas` method | `core/src/claims/claim-index.ts:687` | PRESENT — DELETED per §3 DC.08 |
| `ClaimIndex.applyAuthorDeltas` method | `core/src/claims/claim-index.ts:723` | PRESENT — DELETED per §3 DC.08 |
| `ensureIndex` function (delta commit block) | `core/src/cli/commands/claims/ensure-index.ts:78–107` | PRESENT — DELETED per §3 DC.09 |
| `ClaimIndex.build` (claim entry construction) | `core/src/claims/claim-index.ts:351` (call to `parseClaimMetadata`) | PRESENT — UNCHANGED (this is the read-side projection point and stays exactly as-is) |
| `applyMetadataFilters` function | `core/src/claims/metadata-filters.ts:145` | PRESENT — MODIFIED per §3 DC.13 (overlay merge in fold call) |
| `verifyCommand` (verify CLI) | `core/src/cli/commands/claims/verify-command.ts:59` | PRESENT — UNCHANGED (writes `verified=true` events, which are NOT author-events; overlay model leaves this path intact) |
| `metaCommand` group | `core/src/cli/commands/claims/meta/index.ts:26` | PRESENT — MODIFIED per §3 DC.40 (drop migrate-legacy subcommand) |
| `migrateLegacyCommand` | `core/src/cli/commands/claims/meta/migrate-legacy-command.ts:127` | PRESENT — DELETED per §3 DC.40 |
| `_scepter/verification.json` (this project's data) | `_scepter/verification.json` (277KB on disk, new-shape events) | PRESENT — MANUAL RENAME at implementation time per §5 Phase 4. NOT a code change. |
| `_scepter/verification.json.lock` (leaked artifact) | `_scepter/verification.json.lock` (0 bytes, dated May 4) | PRESENT — MANUAL DELETE at implementation time. Confirms the leak this DD fixes. |
| `metadata-ingest.test.ts` test suite | `core/src/claims/__tests__/metadata-ingest.test.ts` | PRESENT — DELETED per §3 DC.06 (validates deleted module) |
| `claim-metadata.lossless.test.ts` test suite | `core/src/claims/__tests__/claim-metadata.lossless.test.ts` | PRESENT — REWRITTEN per §3 DC.42 (no longer round-trips through ingest; validates parser-only loss) |
| `groupVerifiedEvents` formatter helper | `core/src/cli/formatters/claim-formatter.ts:70` | PRESENT — UNCHANGED (consumes `verified=true` events from CLI, not author tokens) |

All ABSENT entries above carry an explicit deletion authorization tied to a DC in §3.

---

## §3 Module Inventory

The inventory is grouped by part (Overlay model, Rename, Lock fix, Cleanup) so reviewers can read a single coherent change at a time. DC IDs are sequential across parts.

### Overlay model — read-time merge replaces ingest-time write

The replacement strategy: `parseClaimMetadata` already runs at index build time (`claim-index.ts:351`) and populates `ClaimIndexEntry.importance`, `.lifecycle`, `.parsedTags`, `.derivedFrom` on every entry. Those fields are the read-side projection of the markdown source; consumers read them today and will continue to read them. The change is to delete the *write-side* path — the events that mirror the same data into the log — and to wire the fold operation so that filters (`--where`, `--has-key`, `--missing-key`) see the markdown projection alongside the event-log projection without persisting either.

#### `core/src/claims/metadata-ingest.ts` (DELETE)

DC.04:5:derives=R009.§4.AC.07 The `reconcileNoteEvents` function MUST be deleted along with its `IngestClaimEntry` and `ReconcileResult` types. No code path in the system requires producing author-attributed `MetadataEvent`s from suffix tokens after this DD. (Supersedes {DD014.§3.DC.38} and {A004.§3.AC.01}.)

DC.05 The `authorActor` helper function MUST be deleted. The `actor=author:<notepath>` convention is no longer authored anywhere; consumers that previously filtered on this prefix have no events to filter (overlay merges projections at read time, not events).

DC.06 The `tokenToKeyValues` function MAY be deleted entirely OR re-homed into `core/src/claims/claim-metadata.ts` as a non-exported helper if and only if a future Phase-2 keyword-projection consumer (e.g., `meta list` cross-claim folded view that includes author tokens) needs it. For Phase 1, the overlay merge is implemented directly inside `applyMetadataFilters` (§3 DC.13) using the existing `parseClaimMetadata`-populated entry fields, so `tokenToKeyValues` has no caller. **Recommendation: delete.** Re-introduce only when Phase-2 needs it. (Supersedes the projection table in {DD014.§3.DC.39} as a write-side rule; the same table survives as a read-side reference in {A004.§3.AC.02}, which remains valid prose.)

DC.07 The `reconstructFromFold` function MUST be deleted. It exists solely to support `claim-metadata.lossless.test.ts`, which validated the round-trip ingest→fold→reconstruct chain. Under the overlay, no round-trip exists; the lossless property is established at the parser layer alone (§3 DC.42).

The entire file `core/src/claims/metadata-ingest.ts` MUST be deleted. The barrel export in `core/src/claims/index.ts` MUST drop the `metadata-ingest` re-exports.

#### `core/src/claims/claim-index.ts` (MODIFY)

DC.08:5:derives=R009.§4.AC.08 The `computeAuthorDeltas` and `applyAuthorDeltas` methods MUST be deleted from the `ClaimIndex` class. The supporting imports (`MetadataEvent`, `MetadataStore` from `metadata-event`; `IngestClaimEntry`, `reconcileNoteEvents` from `metadata-ingest`; `MetadataStorage` from `storage-backend`) MUST be removed. (Highest binding: this is the architectural seam that decoupled "the index" from "the event store"; under the overlay, the index doesn't write to the store at all.) (Supersedes {DD014.§3.DC.44} and {A004.§3.AC.01}.)

The `ClaimIndex.build()` flow at `claim-index.ts:351` (the call to `parseClaimMetadata`) MUST remain unchanged — that is the surviving read-side projection point. `ClaimIndexEntry.importance`, `.lifecycle`, `.parsedTags`, `.derivedFrom` continue to be populated identically to today.

#### `core/src/cli/commands/claims/ensure-index.ts` (MODIFY)

DC.09:5:derives=R009.§4.AC.08 The post-build delta-commit block at `ensure-index.ts:78–107` MUST be deleted in its entirety. The `import * as fs from 'fs/promises'` import (line 10) and `import * as path from 'path'` import (line 11) MUST be removed. The `relativeNotePath` helper at lines 115–120 MUST be removed. The `@implements {DD014.§3.DC.44}` annotation in the JSDoc preamble MUST be removed. (Supersedes {DD014.§3.DC.44}.)

After this change, `ensureIndex` performs zero writes to `metadataStorage`. It is a pure read-and-build pipeline.

DC.10:4:derives=R009.§4.AC.07 The overlay model makes the markdown-vs-CLI distinction structural rather than actor-prefix-based. Markdown-authored values appear in the `ClaimIndexEntry`'s typed fields (`importance`, `lifecycle`, `parsedTags`, `derivedFrom`); CLI/agent-authored values appear in `metadataStorage` events. A consumer that wants "what did the author declare" reads the entry fields; a consumer that wants "what has the CLI recorded" calls `metadataStorage.query`. No `actor` prefix discipline is needed.

#### `core/src/claims/metadata-filters.ts` (MODIFY)

DC.11:5:derives=R009.§5.AC.01 The `applyMetadataFilters` function MUST overlay markdown-source values onto `metadataStorage.fold(claimId)` results before applying `--where`, `--has-key`, and `--missing-key` filters. The merge rule: for each claim, start with the event-log fold; for each `ClaimIndexEntry` field that maps to a known key (`importance` → `importance`, `lifecycle` → `lifecycle`/`supersededBy`, `derivedFrom[]` → `derives`, `parsedTags[]` → `tag`), append the markdown values to the corresponding key's value array if not already present. Keys with non-empty merged values appear; keys with empty merged values do not. (Highest binding: this is the read-time choke point that makes filters see markdown tags without the events being written.)

DC.12:5 The merge MUST preserve the existing semantics that filter callers depend on today. After the merge, `--where importance=5` against a claim with `:5` in its markdown still matches; `--where lifecycle=closed` against `:closed` still matches; `--where derives=R001.§1.AC.01` against `derives=R001.§1.AC.01` still matches; `--where tag=security` against a freeform `:security` still matches; `--where reviewer=alice` against a CLI-issued `meta add reviewer=alice` still matches. The change is mechanical: behavior is preserved, the path no longer writes events.

DC.13 The merge MUST be implemented as a pure function operating on `(ClaimIndexEntry, foldedEvents: Record<string, string[]>)` and returning a merged `Record<string, string[]>`. The function MUST live in `core/src/claims/metadata-filters.ts` (or be exported from `claim-metadata.ts`); it MUST NOT call `metadataStorage` directly. The caller (`applyMetadataFilters`) does the storage call once per claim and passes the result in.

DC.14 The merge MUST handle the `lifecycle=superseded` decomposition correctly. When `ClaimIndexEntry.lifecycle = { type: 'superseded', target: 'R005.§1.AC.01' }`, the merge MUST produce `lifecycle: ['superseded']` AND `supersededBy: ['R005.§1.AC.01']` (two key entries from one entry field), matching the table in {A004.§3.AC.02}.

#### `core/src/claims/index.ts` (MODIFY)

DC.15 The barrel re-exports for the deleted `metadata-ingest` module MUST be removed. Specifically: `reconcileNoteEvents`, `tokenToKeyValues`, `authorActor`, `reconstructFromFold`, `IngestClaimEntry`, `ReconcileResult`. (The barrel currently re-exports these; consumers outside the `claims/` directory get a compile error and that's intentional — the unused exports go away.)

### Rename `verification.json` → `meta.json`

The rename touches one constant in code, four constants in tests, error message strings, file-path constructions, and JSDoc comments. No back-compat affordance: the runtime will not recognize `verification.json` after this change.

#### `core/src/storage/filesystem/filesystem-metadata-storage.ts` (MODIFY)

DC.20:5:derives=A004.§2.AC.04 The `STORE_FILENAME` constant at line 38 MUST become `'meta.json'`. The lock-sidecar derivation (`this.lockFilePath = this.filePath + LOCK_SUFFIX`) is unaffected by name (it remains `<file>.lock`); after the rename it resolves to `meta.json.lock`. (Highest binding: the file path is the storage adapter's canonical persistence location; this DC formally reverses {A004.§2.AC.04}'s "filename unchanged" decision per user authorization on 2026-05-07.)

DC.21:4:derives=A004.§2.AC.04 The error message strings at lines 82, 89, and the JSDoc preamble at line 4 and line 12 (`@implements {A004.§2.AC.04} Filesystem adapter persists to verification.json`) MUST be updated to reference `meta.json`. The legacy-shape rejection error at line 89 MUST cite `meta.json` (not `verification.json`); the migration directive in that error MUST point at the user-facing ladder described in DC.40 (recommend deletion or one-shot pre-migration before rename), NOT at the deleted `meta migrate-legacy` command.

DC.22 The `@implements {A004.§2.AC.04}` annotation at line 12 MUST be replaced with `@implements {A004.§2.AC.04:superseded=DD019.§3.DC.20}` OR removed entirely (the supersession metadata on the A004 claim makes the annotation orphan-safe; either form is acceptable).

#### `core/src/storage/filesystem/filesystem-metadata-storage.test.ts` (MODIFY)

DC.23 The `STORE_FILENAME` constant at line 19 MUST become `'meta.json'`. The test description "rejects legacy-shape verification.json" at line 54 MUST be updated to reference `meta.json` (the test's purpose is unchanged: a file in the legacy `VerificationEvent` shape is rejected). The `@validates` annotation at line 5 MUST be updated to point at DC.20 (file is `meta.json`).

#### `core/src/storage/filesystem/filesystem-metadata-storage.lock.test.ts` (MODIFY)

DC.24 The `STORE_FILENAME` constant at line 16 MUST become `'meta.json'`. Lock-test assertions about `lockFilePath` derivation are unaffected (the test reads the constant). New lock-leak assertions per §3 DC.36 are added in this same file.

#### `core/src/storage/filesystem/filesystem-metadata-storage.watch.test.ts` (MODIFY)

DC.25 The `STORE_FILENAME` constant at line 17 MUST become `'meta.json'`. The chokidar watch path computation at line 53 (`path.join(tmpDir, STORE_FILENAME)`) is unaffected (the test reads the constant).

#### `core/src/cli/commands/claims/meta/migrate-legacy-command.ts` (DELETE — see DC.40 below)

The `STORE_FILENAME = 'verification.json'` constant at line 33 vanishes with the file. If migrate-legacy is RETAINED (alternative path in DC.40), the constant MUST stay `'verification.json'` because the command's whole point is to read the legacy filename — its existence justifies the legacy literal in source.

#### Documentation updates

DC.26 The architecture overview (`docs/architecture/ARCHITECTURE_OVERVIEW.md`) MUST be updated where it names `verification.json` (specifically: the `_scepter/` directory layout block in the `## Configuration System` section; the `### Claims System` paragraph that mentions `_scepter/verification.json`; the bullet under `## Key Dependencies` is unaffected). After this DD, the overview names `meta.json` in those locations.

DC.27 The skill files under `claude/skills/scepter/` and the user-facing CLI help text MUST be searched for `verification.json` and updated. (Specific list: `scepter ctx search verification.json` will surface the current set; this is a sweep, not a per-file claim.)

### Lock-leak fix

#### `core/src/storage/filesystem/filesystem-metadata-storage.ts` (MODIFY)

DC.30:4 The eagerly-created sidecar lock file MUST NOT persist as a regular file artifact after a successful CLI invocation. The current behavior (`ensureLockFile()` opens `<file>.lock` with `fs.open(path, 'a')` and never deletes it) MUST be removed. (High binding: this is a user-visible disk artifact across every project that uses SCEpter.)

DC.31:5 The `ensureLockFile` private method MUST be deleted. The call to `await this.ensureLockFile()` at line 188 in `withLock` MUST be removed. The `lockFilePath` property remains (proper-lockfile uses it as the lock target). (Highest binding: this is the load-bearing change for the leak fix; the other DCs in this group follow from this one.)

DC.32:4 `proper-lockfile.lock()` at line 191 MUST continue to use `realpath: false` so that the absence of the regular sidecar file does not trip its symlink-resolution path. The existing options block (retries, stale, realpath: false) MUST be preserved. The library handles its own `.lock.lock` directory (the actual mutex sidecar) and creates/deletes it as part of acquire/release; no application-level eager creation is needed or wanted.

DC.33 The lock-acquire timeout (2000ms default, configurable via `FilesystemMetadataStorageOptions.lockTimeoutMs`) MUST be preserved. The existing error message at lines 203–206 ("Concurrent write detected on …") MUST update its filename reference to `meta.json` per DC.21 but otherwise remain identical.

DC.34 Reads (`load`, `query`, `fold`) MUST NOT acquire the lock. {DD014.§3.DC.37} is preserved unchanged.

DC.35 The `mkdir` call inside `withLock` (line 184) MUST remain — proper-lockfile requires the directory to exist for its `.lock.lock` sidecar.

#### `core/src/storage/filesystem/filesystem-metadata-storage.lock.test.ts` (ADD)

DC.36:4 A new test case MUST be added asserting that after a successful `append()` returns, no regular file exists at `<dataDir>/meta.json.lock`. The test acquires the lock once, releases (via `append()` completion), then checks `fs.access(lockPath, fs.constants.F_OK)` rejects with `ENOENT`. The test's `@validates` annotation cites DC.30 and DC.31. (High binding: this is the explicit regression test for the leak.)

DC.37 An additional test case MUST verify that proper-lockfile's `.lock.lock` directory is also gone after release. Acquire via `withLock`, release, assert `fs.access(lockPath + '.lock', F_OK)` rejects with `ENOENT`. (Belt-and-suspenders — the library's contract is to clean its sidecar; we assert it explicitly.)

DC.38 Existing concurrent-write rejection tests (the `lock acquire fails when another holder is present` style) MUST continue to pass unchanged. The lock semantics — exclusive, 2000ms default timeout, error on contention — are preserved.

### Cleanup: migrate-legacy + verify ↔ meta relationship

Two operational concerns the user surfaced in {T003}:

1. `claims meta migrate-legacy` is no longer reachable from the runtime under the new filename — the legacy `verification.json` is invisible.
2. The `claims verify` command's relationship to the `claims meta` subcommand group warrants reassessment.

#### `core/src/cli/commands/claims/meta/migrate-legacy-command.ts` (DELETE)

DC.40:4 The `migrate-legacy-command.ts` file MUST be deleted. The companion test `migrate-legacy-command.test.ts` MUST be deleted. The barrel registration in `core/src/cli/commands/claims/meta/index.ts` MUST drop the `import { migrateLegacyCommand }` line and the `metaCommand.addCommand(migrateLegacyCommand)` line. **Rationale:** the only known holder of legacy-shape `verification.json` was this project, and that project has already been migrated to the new shape. Retaining a one-shot tool that targets a pre-rename filename, written for a single user's already-completed migration, is dead code. (Note: this collapses {DD014.§3.DC.19} into a delete operation; mark {DD014.§3.DC.19} as superseded.)

DC.41 If a future SCEpter user appears with a legacy-shape `verification.json` post-rename, they must run `git log` to find the deleted command, restore it from history, run it, and then rename the file. This is acceptable: the operation is one-shot, the user encountering it has historical context, and supporting it indefinitely costs more than the recovery path costs.

#### `core/src/cli/commands/claims/verify-command.ts` (UNCHANGED — analysis below)

DC.42 The `verify` command at `verify-command.ts:59` writes `verified=true` events with the OS username as `actor`, NOT with an `author:` prefix. These are CLI events, NOT author events. The overlay model does NOT touch the `verify` write path; it remains a thin alias for `meta add CLAIM verified=true` (per {DD014.§3.DC.60}, which remains valid). The user's surfacing of "the relationship between `verify` and `meta`" is answered: `verify` is `meta add … verified=true` with default key/value baked in, and the relationship is preserved exactly as the existing DD014 design intended. **No code change.**

DC.43 `verify --remove` continues to write an `unset verified` event (per {DD014.§3.DC.60}). No change.

DC.44 The existing `verify` tests continue to pass without modification (they test the CLI surface and event-write semantics, both of which are preserved). No test changes.

#### Lossless test relocation

DC.45 The test file `core/src/claims/__tests__/claim-metadata.lossless.test.ts` MUST be REWRITTEN. Currently it round-trips `parseClaimMetadata(tokens) ⟶ reconcileNoteEvents ⟶ applyFold ⟶ reconstructFromFold ⟶ ParsedMetadata` and asserts equality. Under the overlay, the round-trip doesn't exist; the test reduces to "every legal token combination through `parseClaimMetadata` produces the documented `ParsedMetadata` shape" — a parser unit test. The `@validates {A004.§3.AC.02}` annotation remains valid (the normalization table is now a read-time projection rule, not an event-emission rule).

DC.46 The test file `core/src/claims/__tests__/metadata-ingest.test.ts` MUST be DELETED. Every test it contains validates a function in the deleted `metadata-ingest.ts` module.

---

## §4 Wiring Map

### Before (current): write at ingest, read from store

```
build:
  ensureIndex()
    → claimIndex.build(notesWithContent)         [parses tokens; populates ClaimIndexEntry fields]
    → claimIndex.applyAuthorDeltas(...)          [DELETED]
        → reconcileNoteEvents(...)               [DELETED — emits author:* events]
        → metadataStorage.append(event)          [DELETED — write per author event]

read filter (--where, --has-key, --missing-key):
  applyMetadataFilters(items, ..., metadataStorage, parsedFilters)
    → for each item:
        folded = await metadataStorage.fold(claimId)  [reads events, folds; author tokens are mixed in via prior writes]
    → match against folded
```

### After (overlay): write only CLI/agent events, merge at read time

```
build:
  ensureIndex()
    → claimIndex.build(notesWithContent)         [parses tokens; populates ClaimIndexEntry fields]
    → (no further metadata work)                 [author tokens stay in the index entry; never persisted as events]

read filter (--where, --has-key, --missing-key):
  applyMetadataFilters(items, ..., projectManager, parsedFilters)
    → claimIndex.getEntry(claimId)               [resolve markdown projection]
    → folded = await metadataStorage.fold(claimId)   [event-derived only]
    → merged = mergeMarkdownIntoFold(entry, folded)  [overlay: see §3 DC.13]
    → match against merged

read display (verified-event consumers, claim-formatter):
  show-handler / trace-command / gaps-command / etc.
    → metadataStorage.query({key: "verified"})   [unchanged — verified events are CLI events]
    → groupVerifiedEvents(...)                   [unchanged]
```

### Key change: `applyMetadataFilters` gains an index dependency

Currently the function takes `metadataStorage` and the filter parse result. After this DD it MUST also receive a way to look up the `ClaimIndexEntry` for each item — the simplest path is to take a `claimIndex` (or a `Map<string, ClaimIndexEntry>`) parameter and use it inside the merge. Callers (`trace-command.ts:232`, `gaps-command.ts:118`, `search.ts:383`) all have access to the index data via `ensureIndex(...)`; the wiring is mechanical.

### Watch behavior

The chokidar watcher in `FilesystemMetadataStorage.watch()` continues to watch the metadata file. Under the rename it watches `meta.json`. {A004.§3.AC.05} (watch mode integration) is preserved.

---

## §5 Data and Interaction Flow

### Author edits a claim's suffix (under the new model)

**Scenario:** A note has `### AC.01:5:reviewer=alice`. The author edits to `### AC.01:5:reviewer=bob`.

1. Note re-index detects file change.
2. `claimIndex.build()` re-parses the note. `ClaimIndexEntry.parsedTags` (or the corresponding field) now reflects `reviewer=bob` rather than `reviewer=alice`.
3. NO events are written. NO `author:*` events exist anywhere.
4. A subsequent `scepter claims trace R001 --where reviewer=bob` matches: the merge in `applyMetadataFilters` reads `entry.parsedTags` (or whatever field carries `reviewer`), produces `{reviewer: ['bob']}`, merges with whatever events the CLI has written under `reviewer` (likely none), and the match succeeds.
5. A subsequent `scepter claims trace R001 --where reviewer=alice` does NOT match: the markdown source no longer carries `alice` and no event has ever been written for it.

This is the intended user-visible difference: edits to markdown tags are reflected immediately in the next read; no stale event-log baggage to retract.

### CLI write under the new model

**Scenario:** `scepter claims meta add <CLAIM-ID> reviewer=alice` (using any real claim in the project as `<CLAIM-ID>`).

1. `add-command.ts` calls `metadataStorage.append({op: 'add', key: 'reviewer', value: 'alice', actor: <os-username>, …})`.
2. The event lands in `meta.json` (post-rename).
3. A subsequent `scepter claims trace <CLAIM-ID> --where reviewer=alice` reads the merged view: `{reviewer: ['alice']}` (from the event log; the markdown `reviewer` field, if any, also contributes).

### Mixed: author tag + CLI event on the same key

**Scenario:** Note has `### AC.01:reviewer=alice`. CLI runs `meta add reviewer=bob`.

1. Markdown projection contributes `{reviewer: ['alice']}` via `entry.parsedTags`.
2. Event log contributes `{reviewer: ['bob']}` via `metadataStorage.fold`.
3. Merge produces `{reviewer: ['alice', 'bob']}`.
4. Both `--where reviewer=alice` and `--where reviewer=bob` match.

This preserves the multi-source coexistence semantic that {A004.§7 Scenario 2} validated, but achieves it via merge-at-read rather than via independent author/CLI event streams.

### Observation about `ClaimIndexEntry` field shape

`ClaimIndexEntry` already carries:
- `importance?: number` ← bare digit `:5`
- `lifecycle?: LifecycleState` ← `:closed`, `:superseded=TARGET`
- `derivedFrom: string[]` ← `derives=TARGET`
- `parsedTags: string[]` ← any other token that doesn't match the above

The `parsedTags` field is where freeform tokens AND `key=value` tokens that aren't `derives=` end up. This is where `reviewer=alice` lives today (since the parser doesn't structurally separate it). **Implementation note (not a claim):** the merge function will need to walk `parsedTags` and split on `=` to recover `(key, value)` pairs for tokens that are non-bare. The existing `tokenToKeyValues` logic from the deleted `metadata-ingest.ts` is the right reference for this split; if DC.06 chooses to delete it outright, the merge re-implements the split inline (it's <10 lines). If DC.06 chooses to re-home it, the merge calls it.

---

## §6 Integration Sequence

The phasing minimizes risk: each phase leaves the codebase in a verifiable state and isolates the failure modes.

### Phase 1 — Author the overlay merge alongside existing ingest

**Files:** `core/src/claims/metadata-filters.ts`, `core/src/cli/commands/claims/trace-command.ts`, `core/src/cli/commands/claims/gaps-command.ts`, `core/src/cli/commands/context/search.ts` (callers receive new index param).

**Changes:** Add `mergeMarkdownIntoFold(entry, folded)` (§3 DC.13). Modify `applyMetadataFilters` to take a `Map<claimId, ClaimIndexEntry>` (or the claim index data) parameter and apply the merge. Update the three callers to pass the index data.

**Acceptance gate:** All existing filter integration tests pass unchanged. `pnpm tsc` clean. Add a new test asserting that with the author-event ingest path STILL active, the merged read produces identical results to the unmerged read (idempotence — the events already capture what the markdown says, so the merge contributes nothing new). This is the "safety net" verification that the merge is correctly equivalent before we delete the writes.

**Spec coverage:** {DD019.§3.DC.11}, {DD019.§3.DC.12}, {DD019.§3.DC.13}, {DD019.§3.DC.14}.

### Phase 2 — Drop `applyAuthorDeltas` from `ensureIndex`

**Files:** `core/src/cli/commands/claims/ensure-index.ts`.

**Changes:** Delete the post-build delta-commit block (lines 78–107). Remove the now-unused `fs` and `path` imports and the `relativeNotePath` helper.

**Acceptance gate:** Run `pnpm tsc` clean. Run the full test suite: existing filter tests continue to pass (Phase 1's merge supplies the missing event projections). The author-event count in `meta.json` (still named `verification.json` at this point) stops growing on `ensureIndex` invocations — verifiable by running `claims index` twice and checking the file size doesn't change between runs.

**Spec coverage:** {DD019.§3.DC.09}.

### Phase 3 — Delete `metadata-ingest.ts` and `ClaimIndex` author-delta methods

**Files:** `core/src/claims/metadata-ingest.ts` (delete), `core/src/claims/claim-index.ts` (modify), `core/src/claims/__tests__/metadata-ingest.test.ts` (delete), `core/src/claims/__tests__/claim-metadata.lossless.test.ts` (rewrite), `core/src/claims/index.ts` (barrel update).

**Changes:** Per DC.04–DC.08, DC.15, DC.45, DC.46.

**Acceptance gate:** `pnpm tsc` clean. Test suite passes. The deleted/modified test files leave the lossless coverage intact at the parser-only level. Existing user-visible behavior for `trace --where`, `gaps --where`, `search --where` unchanged (Phase 1 already delivered the merge).

**Spec coverage:** {DD019.§3.DC.04}–{DD019.§3.DC.08}, {DD019.§3.DC.15}, {DD019.§3.DC.45}, {DD019.§3.DC.46}.

### Phase 4 — Rename `verification.json` → `meta.json`

**Files:** `core/src/storage/filesystem/filesystem-metadata-storage.ts`, `.test.ts`, `.lock.test.ts`, `.watch.test.ts`. Documentation: `docs/architecture/ARCHITECTURE_OVERVIEW.md`. Manual: `_scepter/verification.json` rename on disk.

**Changes:** Per DC.20–DC.27. The implementation order within the phase: (1) update the constant in storage source, (2) update test constants in lockstep, (3) update error strings and JSDoc, (4) update documentation, (5) at the end, manually `mv _scepter/verification.json _scepter/meta.json` on disk so the local project's data follows the rename.

**Acceptance gate:** `pnpm tsc` clean. All storage tests pass. A manual smoke test: `scepter claims trace R001` reads from `meta.json` (verify by `ls _scepter/`). The legacy filename `verification.json` is no longer referenced anywhere in source. `grep -r 'verification.json' core/src` returns zero results (or only inside a now-deleted migrate-legacy file if Phase 6 has not run yet).

**Spec coverage:** {DD019.§3.DC.20}–{DD019.§3.DC.27}.

### Phase 5 — Fix the lock leak

**Files:** `core/src/storage/filesystem/filesystem-metadata-storage.ts`, `core/src/storage/filesystem/filesystem-metadata-storage.lock.test.ts`.

**Changes:** Per DC.30–DC.38. Delete `ensureLockFile`. Remove the call from `withLock`. Add the regression tests.

**Acceptance gate:** `pnpm tsc` clean. New regression tests pass (asserting `meta.json.lock` does not persist; `meta.json.lock.lock` directory does not persist). Existing concurrent-write tests pass. Manual smoke test: `rm _scepter/meta.json.lock 2>/dev/null; scepter claims trace R001; ls _scepter/meta.json.lock` should report "no such file or directory."

**Spec coverage:** {DD019.§3.DC.30}–{DD019.§3.DC.38}.

### Phase 6 — Retire `migrate-legacy` and reshape `verify` ↔ `meta`

**Files:** `core/src/cli/commands/claims/meta/migrate-legacy-command.ts` (delete), `migrate-legacy-command.test.ts` (delete), `core/src/cli/commands/claims/meta/index.ts` (barrel update). `verify-command.ts` is UNCHANGED (per DC.42 analysis).

**Changes:** Per DC.40–DC.44.

**Acceptance gate:** `pnpm tsc` clean. Test suite passes. The `meta` subcommand group still registers `add`, `set`, `unset`, `clear`, `get`, `log` (six subcommands; one fewer than before). `scepter meta --help` does not list `migrate-legacy`. `scepter verify R001` continues to work and writes to `meta.json` (verify by inspecting the file).

**Spec coverage:** {DD019.§3.DC.40}, {DD019.§3.DC.41}, {DD019.§3.DC.42}, {DD019.§3.DC.43}, {DD019.§3.DC.44}.

### Sequencing rationale

Phases 1 → 2 → 3 are the overlay model in three steps: add the merge, stop writing, delete the dead code. Each phase is independently rollback-able. Phases 4 (rename) and 5 (lock fix) are independent of overlay model and could in principle run in parallel, but the rename moves the lock-file path so doing rename first avoids re-touching `STORE_FILENAME` when DC.30 changes the lock semantic. Phase 6 is last because retiring `migrate-legacy` requires the rename to be settled first (the command's only purpose was the pre-rename file, so it makes sense to retire it after the rename is complete).

---

## §7 Testing Strategy

| Test Level | Scope | Spec Coverage |
|---|---|---|
| Unit | `mergeMarkdownIntoFold(entry, folded)` purity tests covering every `ClaimIndexEntry` field that maps to a known key (`importance`, `lifecycle`/`supersededBy`, `derivedFrom`/`derives`, `parsedTags`/`tag`, `parsedTags`/`KEY=VALUE`-form tokens) | DC.11, DC.12, DC.13, DC.14 |
| Integration | `applyMetadataFilters` end-to-end: mixed markdown+CLI events on the same key, multi-value keys, lifecycle-superseded decomposition | DC.11, DC.14 |
| Integration | `ensureIndex` writes zero events: capture `meta.json` mtime/size before and after `claims index`, assert unchanged on rebuilds with no CLI activity | DC.09 |
| Storage | New lock-leak regression test: after `append()`, no regular file at `meta.json.lock` and no `meta.json.lock.lock` directory | DC.36, DC.37 |
| Storage | Existing concurrent-write rejection tests pass unchanged | DC.38 |
| Storage | Filename rename: `STORE_FILENAME === 'meta.json'`; load/save/append/query/fold all hit `meta.json` | DC.20, DC.23, DC.24, DC.25 |
| Parser | `parseClaimMetadata` lossless test rewritten as parser unit test (no round-trip through deleted ingest) | DC.45 |
| Deletion | The deleted file `metadata-ingest.ts` is gone; importing it produces a TS error (validated implicitly by the build) | DC.04, DC.05, DC.06, DC.07 |
| CLI | `meta migrate-legacy` is not a registered subcommand: `scepter meta --help` does not list it; running `scepter meta migrate-legacy` exits with "unknown command" | DC.40 |
| CLI | `verify` continues to work: writes `verified=true` events; `--remove` writes `unset verified` events (existing tests preserved) | DC.42, DC.43 |

The lock-leak regression test is the most important new test. The leak is silent (the file is empty and small, no operational consequence beyond clutter) so without an explicit assertion it could regress without anyone noticing.

---

## §8 Observations

### Author-event ingest was a write-time mirror of read-time data

Re-reading the {DD014} §3 ingest path with fresh eyes confirms it was always doing redundant work. `ClaimIndex.build()` parses the same suffix tokens, populates `ClaimIndexEntry.importance/.lifecycle/.parsedTags/.derivedFrom`, and consumers (`claim-formatter`, the linter, gap analysis) read from those fields directly. The author-event write path was a second projection of the same data into a second store, which then needed the merge filter (`applyMetadataFilters` calling `metadataStorage.fold`) to reach the same consumers. The overlay model collapses two projections into one read-time merge, which is what the data flow suggests should have been there from the beginning.

### Why this DD doesn't touch `parseClaimMetadata` or `ClaimIndexEntry`

These are the read-side projection point. They are also the load-bearing dependency for the linter, claim-formatter, and gap analysis (none of which call `metadataStorage.fold` today). Touching them would expand the blast radius unnecessarily. The fix is upstream of them: stop writing the redundant events; teach `applyMetadataFilters` to merge.

### {A004.§3} as a section deserves rewriting

Three of A004 §3's four ACs are superseded by this DD. The remaining `.AC.02` (lossless normalization table) is still valid but its prose context describes "ingest-time normalization" — the table is correct, the framing isn't. Marking individual ACs as superseded preserves traceability but leaves architectural prose that describes a deleted system. The user (or a future architecture-rewrite Task) should consider whether A004 §3 deserves a structural rewrite to "Read-Time Overlay" framing. Out of scope for this DD; surfaced for the user's attention.

### Lock-leak fix scope

DC.30–DC.38 address the regular-file leak only. There is no concurrent-process leak (proper-lockfile cleans its own `.lock.lock` directory on release). The new regression test at DC.36/DC.37 asserts both — we don't expect proper-lockfile to fail at its job, but the assertion catches future regressions if either side breaks.

### Watch-mode robustness across the rename

`FilesystemMetadataStorage.watch()` uses `chokidar.watch(this.filePath, ...)`. Under the rename, `this.filePath` resolves to `meta.json` automatically (the constant change propagates). No additional change is needed. The implementation should verify in Phase 4 that watch-mode tests pass after the rename.

### `parsedTags` carries `key=value` tokens today, structurally

The merge function (DC.13) needs to handle the fact that `ClaimIndexEntry.parsedTags` is a flat string array containing tokens like `reviewer=alice` alongside bare tokens like `security`. The split-on-`=` logic from the deleted `tokenToKeyValues` is the right reference. This isn't a new problem — `parsedTags` has held this shape since R005 — but it's easier to overlook because the current write-side code in `metadata-ingest.ts` did the structural decomposition before persisting, and the events arrive at filter time pre-split. Under the overlay, the merge has to do that split. The implementer should preserve the existing semantics of `tokenToKeyValues` exactly (the table at {A004.§3.AC.02} still governs).
