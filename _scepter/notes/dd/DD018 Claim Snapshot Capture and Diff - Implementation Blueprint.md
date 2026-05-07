---
created: 2026-05-07T02:30:55.332Z
tags: [claims,snapshot,diff,regression,cli]
status: draft
---

# DD018 - Claim Snapshot Capture and Diff - Implementation Blueprint

**Requirement:** {R014}
**Date:** 2026-05-06
**Scope:** Implementation blueprint for the claim-snapshot capture, storage, management, diff, and regression-gate feature specified in {R014}. Defines the new `core/src/claims/snapshot/` subsystem, its TypeScript schema, the body-hash algorithm and normalization, the atomic-write mechanics, the diff algorithm and category model, the tombstone-detection contract, and the new top-level CLI command tree. The DD pins binding decisions R014 deferred to the design layer (hash algorithm, schema-version semantics, default snapshot name, tombstone regex literal, ordering of category-evaluation passes) and decomposes high-binding R014 ACs across the snapshot writer, store, diff engine, and CLI surfaces.

This DD is implementation-ready in a single shipping unit; there are no deferred phases. Test work is described in §10 and authored as a separate test plan after implementation lands.

---

## §1 Specification Scope

### R014 ACs in scope

All 47 ACs of R014 are addressed by this DD. The DD authors no Phase-2 deferrals.

- **R014.§1 Snapshot Capture** ({R014.§1.AC.01}-{R014.§1.AC.09}) — capture command, default name, JSON shape, per-claim record fields, body-hash-only invariant, per-note record fields, top-level metadata, git-availability fallback, atomic overwrite.
- **R014.§2 Snapshot Storage** ({R014.§2.AC.01}-{R014.§2.AC.04}) — file path layout, directory creation, gitignore self-bootstrap, no `--shared` flag.
- **R014.§3 Snapshot Management** ({R014.§3.AC.01}-{R014.§3.AC.05}) — `list`, `rm`, `show` commands, `rm` not-found error, `show` summary-scale output.
- **R014.§4 Snapshot Diff** ({R014.§4.AC.01}-{R014.§4.AC.07}) — single-arg and two-arg diff, structured grouped report, exit-zero default, `--json`, no body-content reads on disk, summary header with per-category counts.
- **R014.§5 Diff Categories** ({R014.§5.AC.01}-{R014.§5.AC.07}) — six categories (Lost, New, Body changed, Heading or metadata changed, Source ref drift, Incoming note-ref drift), each always emitted even when empty.
- **R014.§6 Regression Gate** ({R014.§6.AC.01}-{R014.§6.AC.06}) — `--regressions` flag, dangling-source-coverage and untombstoned-loss shapes, regression marker without `--regressions`, suggested tombstone tags emitted with each regression.
- **R014.§7 Tombstone Equivalence** ({R014.§7.AC.01}-{R014.§7.AC.04}) — lifecycle-tag tombstone, content-tombstone heuristic, no schema-field addition.
- **R014.§8 Performance and Scale** ({R014.§8.AC.01}-{R014.§8.AC.04}) — body-hash-only field set, no per-claim disk reads beyond indexer, no body reads in diff, 10k-claim benchmark targets.

### Open questions resolved before this DD

R014 closed all open questions in its 2026-05-05 status update (atomic overwrite via `--force`, summary-header format, tombstone vocabulary tracks {R005} 1:1, gitignore self-bootstrap). No R014 OQs remain.

This DD resolves the following design-layer choices that R014 intentionally left unpinned. Each is settled in the DC noted:

- Body-hash algorithm → §DC.06 pins **sha256, hex-encoded**.
- Body-hash normalization → §DC.07 pins **trim leading and trailing whitespace; no other normalization**.
- Note-content hash algorithm → §DC.09 pins **same algorithm and same normalization as body hash**.
- Schema-version starting integer → §DC.11 pins **`1`**.
- Schema-version forward-compat behavior → §DC.13 pins **fail-fast on newer-than-known versions, with shim-tolerated older versions when migrations are mechanical**.
- Default snapshot name format and timezone → §DC.27 pins **`YYYY-MM-DD-HHMM` in local time**.
- CLI command-tree placement (top-level vs `claims` subgroup) → §DC.21 pins **top-level `snapshotCommand` group registered alongside other claim-system commands per the DD006 convention; `scepter claims snapshot ...` continues to work via the existing backward-compat alias**.
- Tombstone-content regex → §DC.32 pins **`/^(removed|superseded)\.?$/i`** and authors the implementation with body-trim semantics matching {R014.§7.AC.03}.
- `rm` confirmation behavior → §DC.70 pins **prompt-by-default with `--yes` to bypass**.

---

## §2 Primitive Preconditions

Every primitive the DD's body references at PRESENT/ABSENT granularity. Reviewers verify this section first; any EXTEND/MODIFY/@implements target in the body that is missing here is a conformance failure.

| Primitive | Source Citation | Status |
|-----------|----------------|--------|
| `ClaimIndex` class | `core/src/claims/claim-index.ts:256` | PRESENT — capture walks `claimIndex.getData()` |
| `ClaimIndexEntry` interface | `core/src/claims/claim-index.ts:62` | PRESENT — capture reads `noteId`, `noteType`, `heading`, `lifecycle`, `importance`, `derivedFrom`, `line`, `endLine`, `noteFilePath` |
| `ClaimIndexData` interface | `core/src/claims/claim-index.ts:113` | PRESENT — capture iterates `entries`, reads `noteTypes`, `crossRefs` |
| `ClaimCrossReference` interface | `core/src/claims/claim-index.ts:82` | PRESENT — diff reads `fromClaim`, `toClaim`, `line`, `filePath` to derive incoming source-ref triples and incoming note-ref FQIDs |
| `LifecycleState` interface | `core/src/claims/claim-metadata.ts:32` | PRESENT — `{ type: LifecycleType; target?: string }` mapped 1:1 into snapshot's `lifecycle` shape |
| `LifecycleType` type | `core/src/claims/claim-metadata.ts:24` | PRESENT — values `closed`, `deferred`, `removed`, `superseded` consumed by tombstone detector |
| `SourceReference` interface | `core/src/types/reference.ts:11` | PRESENT — diff classifies cross-refs as source-projection by inspecting `sourceType === 'source'` and reads `referenceType` for `refKind` |
| `SourceReferenceType` union | `core/src/types/reference.ts:19` | PRESENT — values become snapshot's `refKind` strings |
| `ClaimIndex.getData()` | `core/src/claims/claim-index.ts:611` | PRESENT — capture entry point |
| `ClaimIndex.getCrossRefsTo(fqid)` | `core/src/claims/claim-index.ts:597` | PRESENT — diff path to compute incoming source/note refs per claim |
| `NoteFileManager.getAggregatedContents(noteId)` | `core/src/notes/note-file-manager.ts:190` | PRESENT — capture reads body content for hashing through this API to honor folder-note aggregation per {R008} |
| `ProjectManager` composition root | `core/src/project/project-manager.ts:79` | PRESENT — DD wires the snapshot subsystem as a service-shaped consumer of `claimIndex`, `noteFileManager`, and `sourceScanner` already on the ProjectManager |
| `ProjectManager.claimIndex` field | `core/src/project/project-manager.ts:87` | PRESENT — read by snapshot writer |
| `ProjectManager.noteFileManager` field | `core/src/project/project-manager.ts:79` | PRESENT — read by snapshot writer for body-content hashing |
| `ProjectManager.sourceScanner` field | `core/src/project/project-manager.ts` | PRESENT — used by `ensureIndex` to populate source cross-refs that the snapshot reads |
| `ensureIndex` helper | `core/src/cli/commands/claims/ensure-index.ts:39` | PRESENT — capture and diff call this to obtain a fully populated `ClaimIndexData` |
| `BaseCommand.execute` | `core/src/cli/commands/base-command.ts` | PRESENT — every snapshot subcommand wraps its handler in `BaseCommand.execute` for consistent setup/cleanup |
| `BaseCommand.handleError` | `core/src/cli/commands/base-command.ts` | PRESENT — used by every snapshot subcommand for non-zero exits with chalked error |
| `cli-table3` package | `package.json` (transitively used at `core/src/cli/formatters/table-formatter.ts:2`) | PRESENT — `snapshot list` uses the same library |
| `chalk` package | `package.json` (used throughout `core/src/cli/`) | PRESENT — used for headers, regression markers, and category labels |
| `crypto.createHash` (Node builtin) | used at `core/src/context/context-gatherer.ts:9,240` | PRESENT — capture uses `createHash('sha256')` |
| `fs.rename` (Node builtin) | used at `core/src/config/config-manager.ts:381` for atomic writes | PRESENT — snapshot store reuses the temp-file-then-rename pattern |
| `fs.promises` API | used throughout `core/src/` | PRESENT — snapshot store uses `fs.promises.writeFile`, `mkdir`, `readFile`, `unlink`, `readdir`, `stat` |
| `child_process.execFile` (Node builtin) | (none in current `core/src/`) | PRESENT (Node builtin) — used by snapshot writer to resolve git commit SHA via `git rev-parse HEAD` with timeout, falling back to `null` per {R014.§1.AC.08} |
| `_scepter/snapshots/` directory | (none) | ABSENT — created on first `save` per §DC.18 |
| `_scepter/snapshots/.gitignore` file | (none) | ABSENT — created on first `save` per §DC.19 |
| `snapshot-types.ts` module | (none) | ABSENT — authored by this DD (§3 §DC.01-§DC.10) |
| `snapshot-writer.ts` module | (none) | ABSENT — authored by this DD (§3 §DC.14-§DC.20) |
| `snapshot-store.ts` module | (none) | ABSENT — authored by this DD (§3 §DC.22-§DC.26) |
| `snapshot-diff.ts` module | (none) | ABSENT — authored by this DD (§3 §DC.36-§DC.54) |
| `tombstone-detector.ts` module | (none) | ABSENT — authored by this DD (§3 §DC.32-§DC.35) |
| `snapshot-formatter.ts` module | (none) | ABSENT — authored by this DD (§3 §DC.55-§DC.62) |
| `snapshotCommand` Commander group | (none) | ABSENT — authored by this DD (§3 §DC.63-§DC.75) |

**Halt rule check:** Every ABSENT entry is authored by this DD itself. No companion DD or external deferral is required. No primitive is referenced outside this manifest.

---

## §3 Module Inventory

The implementation touches three logical layers: (1) a new snapshot subsystem under `core/src/claims/snapshot/`, (2) a new CLI command group under `core/src/cli/commands/claims/snapshot/` (sibling of `claims/meta/`, registered at the top level), and (3) wiring at `core/src/cli/index.ts` to register the group at the top level.

The subsystem has no pre-existing primitives to MODIFY — every file is NEW, with the exception of `core/src/cli/index.ts` (registration) and `core/src/claims/index.ts` (barrel re-exports).

### §3.1 Snapshot Subsystem

#### `core/src/claims/snapshot/snapshot-types.ts` (NEW)

Defines the on-disk JSON schema as TypeScript interfaces. No runtime logic — pure type declarations and the schema-version constant.

§3.DC.01:5:derives=R014.§1.AC.07 The module MUST export a `SCHEMA_VERSION` constant of type `number` whose value is the maximum schema version this binary can read and write. Initial value is `1`. The constant is the single source of truth — both the writer (which embeds it on save) and the diff reader (which validates against it) MUST reference this constant; no other module is permitted to inline a literal.

§3.DC.02:derives=R014.§1.AC.07 The module MUST export an interface `SnapshotMetadata` with fields: `schemaVersion: number`, `capturedAt: string` (ISO 8601 UTC), `projectRoot: string` (absolute path), `gitCommit: string | null`. The `gitCommit` field is `null` when the project root is not in a git working tree or when git is unavailable per {R014.§1.AC.08}.

§3.DC.03:derives=R014.§1.AC.04 The module MUST export an interface `SnapshotClaimEntry` with fields: `fqid: string`, `noteId: string`, `noteType: string`, `heading: string`, `lifecycle: SnapshotLifecycle | null`, `importance: number | null`, `derivedFrom: string[]`, `incomingNoteRefs: string[]`, `incomingSourceRefs: SnapshotSourceRef[]`, `bodyHash: string`.

§3.DC.04:derives=R014.§1.AC.04 The module MUST export an interface `SnapshotLifecycle` with fields: `type: string` (one of `closed`, `deferred`, `removed`, `superseded`), `supersedes: string | undefined` (the resolved supersession target FQID, present only when `type === 'superseded'`). The `supersedes` field name in the snapshot intentionally differs from the in-memory `target` field name on `LifecycleState` to make the on-disk payload self-documenting; the writer translates between the two.

§3.DC.05:derives=R014.§1.AC.04 The module MUST export an interface `SnapshotSourceRef` with fields: `filePath: string` (project-relative POSIX path), `line: number`, `refKind: string` (one of the `SourceReferenceType` union values: `implements`, `validates`, `depends-on`, `addresses`, `blocked-by`, `see`, `mentions`).

§3.DC.06:5:derives=R014.§1.AC.04 The module MUST export a constant `BODY_HASH_ALGORITHM = 'sha256'` and a constant `BODY_HASH_ENCODING = 'hex'`. The writer and diff engine MUST both reference these constants — no module is permitted to inline `'sha256'` or `'hex'` independently. Selecting sha256 over md5 (which appears at `core/src/context/context-gatherer.ts:240`) is a security-and-determinism choice: snapshots may be checked into version control by user choice and md5 collisions are too cheap to defend against accidental or intentional content collisions.

§3.DC.07:5:derives=R014.§1.AC.04 The module MUST export a function `normalizeBodyForHash(body: string): string` that returns the input with leading and trailing ASCII whitespace stripped (equivalent to `body.trim()`), with no other normalization (no line-ending translation, no Unicode normalization, no case folding). Determinism of the snapshot output depends on this function being the single canonical normalizer; any divergence between the writer's and the diff engine's normalization invalidates body-hash equality and produces phantom drift.

§3.DC.08:derives=R014.§1.AC.06 The module MUST export an interface `SnapshotNoteEntry` with fields: `noteId: string`, `noteTitle: string`, `claimFqids: string[]` (in document order), `noteContentHash: string`. The `noteTitle` SHOULD be the note's display title from the index; if unavailable the field MAY be the empty string.

§3.DC.09:derives=R014.§1.AC.06 The note-content hash MUST be computed via `createHash(BODY_HASH_ALGORITHM).update(normalizeBodyForHash(noteAggregatedContent)).digest(BODY_HASH_ENCODING)` over the full aggregated note content (per `NoteFileManager.getAggregatedContents`). Both the algorithm and the normalization MUST be the same as the body hash (§DC.06, §DC.07) — having two hash mechanisms in one file is a documentation and consistency liability with no offsetting benefit.

§3.DC.10:derives=R014.§1.AC.03 The module MUST export the top-level interface `Snapshot` with fields: `metadata: SnapshotMetadata`, `claims: SnapshotClaimEntry[]` (sorted by `fqid` ascending), `notes: SnapshotNoteEntry[]` (sorted by `noteId` ascending). Sort order is part of the contract: deterministic ordering enables byte-equality diffs of snapshot files modulo `capturedAt`, which is the basis for the determinism test in §10.

§3.DC.11:5:derives=R014.§1.AC.07 The schema version is an integer-monotonic counter. The initial published version is `1`. Bumping the version is required for any change that breaks read compatibility (field rename, semantic shift on an existing field, removal of an existing field). Adding a field that older readers can ignore (purely additive, optional in shape) does NOT require a bump. The DC.01 constant is bumped at the same commit that introduces the breaking change.

§3.DC.12:derives=R014.§1.AC.07 Snapshot files emitted by this DD MUST set `schemaVersion: 1`. The writer MUST NOT accept a caller-supplied override; the constant from §DC.01 is read directly. This prevents agents from "fixing" version mismatches by writing arbitrary versions into snapshots they capture.

§3.DC.13:5:derives=R014.§4.AC.01 Forward-compatibility contract: the diff command MUST fail fast with a clear error and a non-zero exit when reading a snapshot whose `schemaVersion` exceeds `SCHEMA_VERSION`. The error text MUST name the file, the snapshot's version, and the binary's known maximum, in the form `Snapshot was captured by a newer version of scepter (schema vN). Upgrade scepter or use a compatible binary.` The diff command MAY tolerate older snapshot versions through a versioned shim layer when the migration is mechanical (e.g., adding a new optional field with a known default); the shim layer is a switch on `schemaVersion` inside the snapshot-loader. When no shim exists for an older version, the diff errors with an upgrade-required message naming the version and the binary's minimum supported version.

#### `core/src/claims/snapshot/snapshot-writer.ts` (NEW)

Captures the live in-memory `ClaimIndexData` plus aggregated note bodies into a `Snapshot` value. Pure transformation — no filesystem I/O for the snapshot file itself; that lives in the store module.

§3.DC.14:derives=R014.§8.AC.02 The module MUST export an async function `captureSnapshot(ctx: { claimIndex: ClaimIndex; noteFileManager: NoteFileManager; projectRoot: string; }): Promise<Snapshot>`. The function consumes `claimIndex.getData()` to obtain entries, cross-refs, and noteTypes; it does NOT call `claimIndex.build()` itself (the caller is responsible for ensuring the index is populated, typically via `ensureIndex`).

§3.DC.15:derives=R014.§8.AC.02 The capture MUST iterate `data.entries.values()` exactly once to produce `SnapshotClaimEntry` records. Per-claim work: read the in-memory `ClaimIndexEntry` fields directly; classify the claim's incoming cross-references via `data.crossRefs.filter(ref => ref.toClaim === fqid)`, splitting each into source vs. note-ref by the `fromNoteId` shape (`source:filename` → source-projection; otherwise → note-projection); compute `bodyHash` from the claim body extracted from the aggregated note content (§DC.16). The capture MUST NOT re-scan source files or re-parse notes — the `claimIndex.crossRefs` already encode the source-ref edges per {R014.§1.AC.04}.

§3.DC.16:derives=R014.§1.AC.04 Body-content extraction for a claim FQID MUST proceed: (1) call `noteFileManager.getAggregatedContents(noteId)` to obtain the aggregated note content, caching the result per `noteId` for the duration of the capture call so each note is read at most once; (2) split the aggregated content into lines and select the slice from `entry.line + 1` (skip the heading line itself) to `entry.endLine` inclusive (using the `line`/`endLine` already populated by the claim-tree builder); (3) join the slice with `\n`; (4) pass the result through `normalizeBodyForHash` (§DC.07); (5) hash via `createHash(BODY_HASH_ALGORITHM).update(normalized).digest(BODY_HASH_ENCODING)`.

§3.DC.17:derives=R014.§8.AC.02 Capture MUST be single-pass and sequential — no `Promise.all`, no worker threads, no bounded-concurrency pool in v1. The performance contract is "capture finishes in seconds, not minutes" per {R014.§8.AC.04}. Adding parallelism is reserved for a follow-up DD if measurement shows the sequential baseline misses the §DC.20 budget on real projects.

§3.DC.18:derives=R014.§1.AC.06 For each note that contributes at least one claim to the index, the capture MUST emit one `SnapshotNoteEntry` recording the note ID, the note title (read from `noteFileManager`'s note metadata; if unavailable, empty string), the ordered list of claim FQIDs that belong to the note (collected during the §DC.15 iteration to avoid a second pass), and the note-content hash computed per §DC.09 over the same aggregated content cached in §DC.16.

§3.DC.19:derives=R014.§1.AC.07 The capture MUST resolve `gitCommit` by invoking `git rev-parse HEAD` via `child_process.execFile` with `cwd: projectRoot`, a 2-second timeout, and `stdio: ['ignore', 'pipe', 'ignore']`. On success, the SHA is the trimmed stdout. On any failure (non-zero exit, ENOENT for git binary, timeout, not in a git working tree), the field is `null` per {R014.§1.AC.08}. The capture MUST NOT propagate the underlying error — the snapshot MUST succeed regardless of git availability.

§3.DC.20:derives=R014.§8.AC.04 Capture targets sub-30-second wall-clock on a 10,000-claim project on commodity hardware. Implementation MUST emit a stderr warning (not an error, not a non-zero exit) when capture exceeds 60 seconds, with the form `Warning: snapshot capture took NNs (>60s budget). Investigate index size or filesystem latency.` This is an informational benchmark per {R014.§8.AC.04} — exceeding the budget is not a failure.

#### `core/src/claims/snapshot/snapshot-store.ts` (NEW)

Filesystem I/O for the snapshot directory: read, write, list, remove, atomic-overwrite, gitignore self-bootstrap.

§3.DC.21:5:derives=R014.§2.AC.01 The module MUST export a constant `SNAPSHOT_DIR_RELATIVE = '_scepter/snapshots'`. Every store function resolves its absolute path as `path.join(projectRoot, SNAPSHOT_DIR_RELATIVE)`.

§3.DC.22:derives=R014.§2.AC.01 The module MUST export a function `snapshotPath(projectRoot: string, name: string): string` that returns `path.join(projectRoot, SNAPSHOT_DIR_RELATIVE, `${name}.json`)`. The `name` argument MUST match the allowlist regex `/^[a-zA-Z0-9._-]+$/` AND MUST NOT begin with a leading dot (`.`); the function MUST throw with a clear error if either check fails. The error message MUST be: `Snapshot name must match /^[a-zA-Z0-9._-]+$/ and not start with a dot. Reject: <bad-name>.` Defense-in-depth rationale: the allowlist matches typical filesystem-friendly naming, behaves predictably on every OS, eliminates shell-quoting friction (no quoting required for any accepted name), and excludes shell metacharacters and unicode at the input boundary rather than trusting downstream layers to handle them. The leading-dot rejection blocks invisible-dotfile snapshots that would be silently filtered out by `listSnapshots`'s `.json` glob (a name like `.secret.json` would save successfully but never appear in `list`, surprising the user). Real-world snapshot names are unaffected: `auth-refactor`, `pre-r014-impl`, `2026-05-06-1742` (the §DC.27 default), `baseline_v2`, `final.tag` all pass the allowlist. Names with spaces (`my work`) require the user to adapt to dashes or underscores (`my-work`, `my_work`) — near-zero UX cost for the predictability gain.

§3.DC.23:derives=R014.§1.AC.09 The module MUST export an async function `writeSnapshot(projectRoot: string, name: string, snapshot: Snapshot, options: { force: boolean }): Promise<{ filePath: string }>`. Behavior: (1) compute `filePath = snapshotPath(projectRoot, name)`; (2) `await ensureSnapshotDir(projectRoot)` — creates `_scepter/snapshots/` if absent (per {R014.§2.AC.02}) and ensures `.gitignore` exists per §DC.31; (3) when `options.force === false` and `filePath` exists, throw a typed error `SnapshotExistsError` carrying the path; (4) write to a sibling temp file `<filePath>.tmp` via `fs.promises.writeFile`, then `fs.promises.rename(tempPath, filePath)`. Same-filesystem rename semantics are required — `_scepter/snapshots/` lives inside the project, so the temp and target are guaranteed to share a filesystem; cross-device renames are not a supported path.

§3.DC.24:derives=R014.§2.AC.02 The module MUST export an async function `ensureSnapshotDir(projectRoot: string): Promise<void>` that uses `fs.promises.mkdir(snapshotDir, { recursive: true })` to create the directory if absent. Idempotent — calling on an existing directory is a no-op.

§3.DC.25:derives=R014.§3.AC.01 The module MUST export an async function `listSnapshots(projectRoot: string): Promise<Array<{ name: string; filePath: string; capturedAt: string; claimCount: number; fileSize: number; }>>`. Implementation: `fs.promises.readdir` the snapshot directory, filter to `.json` files, for each file `fs.promises.stat` for `fileSize`, then a small lazy-read of the file's metadata block to extract `capturedAt` and `claims.length`. The function MUST tolerate a missing snapshot directory by returning the empty array (per {R014.§2.AC.02} the directory is created on first save; no save means no list).

§3.DC.26:derives=R014.§3.AC.02 The module MUST export an async function `removeSnapshot(projectRoot: string, name: string): Promise<void>` that calls `fs.promises.unlink(snapshotPath(projectRoot, name))`. When the file does not exist, the function MUST throw a typed `SnapshotNotFoundError` carrying the name.

§3.DC.27:5:derives=R014.§1.AC.02 The module MUST export a function `defaultSnapshotName(now?: Date): string` returning the local-clock timestamp in the format `YYYY-MM-DD-HHMM` (e.g., `2026-05-06-1742` for May 6 2026, 5:42 PM local). Implementation: build the string from `now.getFullYear()`, `getMonth()+1`, `getDate()`, `getHours()`, `getMinutes()`, each zero-padded to 2 digits (year is 4). The `now` parameter exists for testability — production callers pass nothing (uses `new Date()`); tests pass a fixed Date. Local-clock semantics align with how the rest of the codebase displays dates and how the user invokes the command in their session — UTC would surprise the user during late-night work spanning the date boundary.

§3.DC.28:derives=R014.§1.AC.09 The module MUST export typed errors `SnapshotExistsError` (carrying `filePath: string`) and `SnapshotNotFoundError` (carrying `name: string`). CLI handlers catch these and emit user-facing messages with non-zero exits via `BaseCommand.handleError`. Other failures (filesystem permission errors, JSON parse errors) are propagated as plain errors and handled by the same `handleError` path.

§3.DC.29:derives=R014.§4.AC.06 The module MUST export an async function `readSnapshot(filePath: string): Promise<Snapshot>` that reads the file via `fs.promises.readFile`, parses JSON, and returns the typed `Snapshot`. The function MUST validate `schemaVersion` per §DC.13 — if the value is missing, non-numeric, or exceeds `SCHEMA_VERSION` with no shim available, it throws a typed `SnapshotSchemaError` carrying the filename and the offending version. The function MUST NOT load any claim body content as a side effect.

§3.DC.30:derives=R014.§3.AC.01 The module MUST NOT format output for human consumption. CLI display formatting (table rendering for `list`, summary rendering for `show`) lives in the snapshot-formatter module (§DC.55-§DC.56). This separation mirrors the rest of the claim subsystem (e.g., `claim-formatter.ts` is separate from `claim-index.ts`).

#### `core/src/claims/snapshot/snapshot-store.ts` — gitignore self-bootstrap

§3.DC.31:derives=R014.§2.AC.03 `ensureSnapshotDir` (§DC.24) MUST also ensure that `_scepter/snapshots/.gitignore` exists with the single-line content `*\n` (one ASCII asterisk followed by a single LF). Implementation: after `mkdir`, attempt `fs.promises.access(gitignorePath)`; if it throws ENOENT, write the file via `fs.promises.writeFile(gitignorePath, '*\n', 'utf8')`. If the file already exists, the function MUST NOT rewrite it — this preserves any user customization and makes the behavior idempotent across saves. The mechanism is self-contained in the store and does not depend on `scepter init` having run, satisfying R014's pre-existing-project requirement.

#### `core/src/claims/snapshot/tombstone-detector.ts` (NEW)

Encapsulates the §7 tombstone-equivalence rules. Used by the diff regression-gate to decide whether a "lost claim" or "lost source coverage" finding should be promoted to a regression.

§3.DC.32:5:derives=R014.§7.AC.03 The module MUST export a regex constant `CONTENT_TOMBSTONE_RE = /^(removed|superseded)\.?$/i`. The constant is the canonical authority — both the detector and any debug helper MUST reference this constant; no module is permitted to inline the literal regex independently. Examples that match: `Removed`, `removed.`, `REMOVED`, `Superseded`, `superseded.`, `Superseded.`. Examples that do NOT match: `Removed: see X`, `This was removed in v2`, the empty string.

§3.DC.33:derives=R014.§7.AC.01 The module MUST export a function `isLifecycleTombstone(lifecycle: LifecycleState | undefined | null): boolean` returning true when the lifecycle's `type` is exactly `removed` or `superseded`. The presence or absence of the supersession `target` is irrelevant per {R014.§7.AC.02} — an unresolved target still tombstones.

§3.DC.34:derives=R014.§7.AC.03 The module MUST export a function `isContentTombstone(body: string): boolean` returning true when `CONTENT_TOMBSTONE_RE.test(body.trim())` is true. Implementation MUST trim leading and trailing whitespace before regex testing per {R014.§7.AC.03}. The empty-body case (`body.trim() === ''`) returns false — empty bodies are NOT tombstones.

§3.DC.35:derives=R014.§7.AC.04 The module MUST export a function `isTombstoned(ctx: { fqid: string; entry: ClaimIndexEntry | undefined; bodyResolver: (entry: ClaimIndexEntry) => string; cache: Map<string, boolean>; }): boolean` that: (1) returns the cached result if `ctx.cache.has(ctx.fqid)`; (2) returns `false` if `ctx.entry` is undefined (the claim doesn't exist in the live index — there's nothing to tombstone); (3) returns `true` and caches if `isLifecycleTombstone(ctx.entry.lifecycle)` is true; (4) otherwise computes `body = ctx.bodyResolver(ctx.entry)`, returns `isContentTombstone(body)`, and caches. The cache is per-diff-run, owned by the diff caller and passed through, so repeated checks during gate evaluation are O(1) per FQID. The cache MUST NOT be a module-level singleton — that would cross-contaminate diff runs.

#### `core/src/claims/snapshot/snapshot-diff.ts` (NEW)

Diff engine: load both sides into a uniform `SnapshotData` shape, compute set differences and content drift across the six categories, evaluate the regression gate. Pure transformation; output formatting lives in the formatter module.

§3.DC.36:derives=R014.§4.AC.01 The module MUST export an interface `SnapshotSide` with fields: `kind: 'snapshot' | 'live'`, `claims: Map<string, SnapshotClaimEntry>` (keyed by fqid), `notes: Map<string, SnapshotNoteEntry>` (keyed by noteId), `metadata: SnapshotMetadata | null` (null for `kind: 'live'`).

§3.DC.37:derives=R014.§4.AC.02 The module MUST export an async function `loadSnapshotSide(filePath: string): Promise<SnapshotSide>` that wraps `readSnapshot` and indexes the resulting `Snapshot`'s `claims` and `notes` arrays into the `Map` shapes for O(1) FQID lookup during diff.

§3.DC.38:derives=R014.§4.AC.01 The module MUST export an async function `liveSide(ctx: { claimIndex: ClaimIndex; noteFileManager: NoteFileManager; projectRoot: string; }): Promise<SnapshotSide>` that calls `captureSnapshot(ctx)` and indexes the result the same way as §DC.37. Both single-arg and two-arg diff paths construct a `SnapshotSide` for each operand; the diff core operates on `SnapshotSide`, not on `Snapshot` or `ClaimIndex` directly.

§3.DC.39:derives=R014.§5.AC.01 The module MUST export an interface `DiffReport` with fields: `lostClaims: LostClaimFinding[]`, `newClaims: NewClaimFinding[]`, `bodyChanged: BodyChangedFinding[]`, `headingOrMetadataChanged: HeadingMetadataFinding[]`, `sourceRefDrift: SourceRefDriftFinding[]`, `incomingNoteRefDrift: NoteRefDriftFinding[]`, `regressions: RegressionFinding[]`, `summary: { lost: number; new: number; bodyChanged: number; headingOrMetadataChanged: number; sourceRefDrift: number; incomingNoteRefDrift: number; regressions: number; }`. The summary counts mirror the array lengths and exist as a denormalization so that the formatter can build the summary header (§DC.57) without re-counting.

§3.DC.40:derives=R014.§5.AC.01 `LostClaimFinding` MUST be `{ fqid: string; baselineHeading: string; baselineLifecycle: SnapshotLifecycle | null; isRegression: boolean; }`.

§3.DC.41:derives=R014.§5.AC.02 `NewClaimFinding` MUST be `{ fqid: string; candidateHeading: string; candidateLifecycle: SnapshotLifecycle | null; }`.

§3.DC.42:derives=R014.§5.AC.03 `BodyChangedFinding` MUST be `{ fqid: string; baselineBodyHash: string; candidateBodyHash: string; }`. The finding records hashes only — actual body diff content is out of scope for the snapshot subsystem (the user opens the file to see what changed).

§3.DC.43:derives=R014.§5.AC.04 `HeadingMetadataFinding` MUST be `{ fqid: string; changes: Array<{ field: 'heading' | 'lifecycle' | 'importance' | 'derivedFrom'; baseline: unknown; candidate: unknown; }>; }`. The `changes` array enumerates each field that differs; multiple fields on the same claim produce one finding with multiple `changes` entries, not multiple findings.

§3.DC.44:derives=R014.§5.AC.05 `SourceRefDriftFinding` MUST be `{ fqid: string; lost: SnapshotSourceRef[]; gained: SnapshotSourceRef[]; }`. A claim with no drift in its source refs MUST NOT appear in `sourceRefDrift`. Two source-refs are equal iff `filePath`, `line`, and `refKind` all match; `line` differences alone produce one lost + one gained, not a "moved" finding.

§3.DC.45:derives=R014.§5.AC.06 `NoteRefDriftFinding` MUST be `{ fqid: string; lost: string[]; gained: string[]; }`. Each `lost`/`gained` entry is the FQID of an incoming note-ref present on one side but absent on the other.

§3.DC.46:derives=R014.§6.AC.03 `RegressionFinding` MUST be `{ kind: 'dangling-source-coverage' | 'untombstoned-loss' | 'derived-from-shrinkage'; fqid: string; baselineSourceRefCount: number; suggestedTombstoneTag: string; locationHint: { filePath: string; line: number; } | null; lostDerivationTargets?: string[]; }`. The `suggestedTombstoneTag` is `:removed` for the default suggestion; the `locationHint` is populated from the live-index `ClaimIndexEntry` when the claim still exists at definition time, and `null` when not (e.g., the loss case where the claim is gone from the live side). The optional `lostDerivationTargets` field is populated only for `kind: 'derived-from-shrinkage'` findings per §DC.51a-§DC.51b, listing the FQIDs the baseline `derivedFrom` set carried that the candidate `derivedFrom` set lacks; it is undefined for the other two kinds.

§3.DC.47:derives=R014.§4.AC.01 The module MUST export a function `computeDiff(ctx: { baseline: SnapshotSide; candidate: SnapshotSide; tombstoneCtx: TombstoneContext | null; }): DiffReport`. The function performs the four stages (§DC.48-§DC.51) in order. `tombstoneCtx` MAY be `null` for callers that want to skip regression detection entirely (e.g., synthetic test fixtures); in that case the regression-gate stage (§DC.51) is skipped and `regressions` is `[]`. The CLI handler always passes a real `tombstoneCtx` per §DC.73; the `--regressions` flag controls only exit-code interpretation and suggestion-line emission, not whether `LostClaimFinding.isRegression` is computed.

§3.DC.48:derives=R014.§5.AC.01 Stage 2 (set difference): for each FQID in `baseline.claims` but not in `candidate.claims`, append to `lostClaims`. For each FQID in `candidate.claims` but not in `baseline.claims`, append to `newClaims`. The two passes use `Map` key-set operations for O(n) total.

§3.DC.49:derives=R014.§5.AC.03 Stage 3 (content drift, FQIDs in both sides): for each shared FQID, compare `bodyHash` — append to `bodyChanged` on inequality. Then compare `heading`, `lifecycle` (deep-equal as JSON values), `importance`, and `derivedFrom` (set-equal, order-insensitive) — append a single `headingOrMetadataChanged` finding listing each differing field. Note that `derivedFrom` GROWTH (set-add) is reported here as drift only; `derivedFrom` SHRINKAGE (set-minus, baseline `\` candidate non-empty) flows additionally to the regression-gate stage per §DC.51a-§DC.51b for tombstone-exempt classification as a `derived-from-shrinkage` regression. Stage 3 still emits the `headingOrMetadataChanged` finding for the field-level drift signal; the regression-gate stage adds a separate `RegressionFinding` when the shrinkage is untombstoned. Then compute source-ref set difference (§DC.44 equality rule) and note-ref set difference (§DC.45) — append findings only when the lost+gained set is non-empty.

§3.DC.50:derives=R014.§6.AC.04 Stage 4 (regression gate, only when `tombstoneCtx` non-null): for each `LostClaimFinding`, evaluate `isTombstoned({ fqid, entry: tombstoneCtx.liveEntries.get(fqid), bodyResolver: tombstoneCtx.bodyResolver, cache: tombstoneCtx.cache })`. **Crucially, the `entry` looked up here is from the live index, not from `baseline` — per {R014.§6.AC.04} the gate asks "is this currently tombstoned?".** If `false`, mark the finding `isRegression = true` and append a `RegressionFinding` of `kind: 'untombstoned-loss'`. The `LostClaimFinding.isRegression` boolean is what the formatter uses to render the regression marker per {R014.§6.AC.05}; the separate `regressions` array is what the gate exit code uses per {R014.§6.AC.02}.

§3.DC.51:derives=R014.§6.AC.03 Stage 4 continued: for each shared-FQID claim, compute `baselineSourceRefCount = baseline.claims.get(fqid).incomingSourceRefs.length` and `candidateSourceRefCount = candidate.claims.get(fqid).incomingSourceRefs.length`. When `baselineSourceRefCount > 0` AND `candidateSourceRefCount === 0` AND the claim is NOT tombstoned in the candidate-side live index per `isTombstoned(...)`, append a `RegressionFinding` of `kind: 'dangling-source-coverage'`. The candidate-side check applies whether the candidate is `kind: 'live'` or `kind: 'snapshot'` — when comparing two snapshots, `tombstoneCtx.liveEntries` MAY still be `null`/empty (caller's choice, see §DC.52); in that case the snapshot-vs-snapshot path skips the live-tombstone resolution and treats the candidate-side claim as not-tombstoned via the lifecycle field alone (§DC.53).

§3.DC.51a:derives=R014.§6.AC.07 Stage 4 continued (set-difference for `derivedFrom` shrinkage): for each shared-FQID claim, compute `lostDerivationTargets = baseline.claims.get(fqid).derivedFrom \ candidate.claims.get(fqid).derivedFrom` as an order-insensitive set-minus operation (every FQID present in the baseline `derivedFrom` array that is absent from the candidate `derivedFrom` array). When the result is non-empty, the claim has shrunk `derivedFrom`; record the `lostDerivationTargets` per claim for downstream classification by §DC.51b. Set GROWTH (FQIDs in candidate not in baseline) MUST NOT contribute to this computation — only shrinkage qualifies per {R014.§6.AC.07}. The set-minus uses string equality on FQIDs; no normalization beyond the existing `derivedFrom` storage shape is applied.

§3.DC.51b:derives=R014.§6.AC.07 Stage 4 continued (tombstone exemption + regression classification for `derivedFrom` shrinkage): for each shared-FQID claim with non-empty `lostDerivationTargets` from §DC.51a, evaluate `isTombstoned({ fqid, entry: tombstoneCtx.liveEntries.get(fqid), bodyResolver: tombstoneCtx.bodyResolver, cache: tombstoneCtx.cache })` against the candidate-side live index — the same gate used by §DC.50 and §DC.51. The tombstone exemption MUST share the cached `tombstoneCtx` (the same `cache` Map) to avoid recomputation across §DC.50, §DC.51, and §DC.51b — a single FQID's tombstone state is computed at most once per diff run regardless of which gate evaluates it. When the claim is NOT tombstoned, append a `RegressionFinding` of `kind: 'derived-from-shrinkage'` with `lostDerivationTargets` populated per §DC.51a, `baselineSourceRefCount` set to the baseline incoming-source-ref count (carried through for symmetry with the other two kinds; not load-bearing for the suggestion-text emit), and `locationHint` populated from `tombstoneCtx.liveEntries.get(fqid)` when the entry exists (the claim is by definition present in both sides, so the live entry is normally available; null when the candidate is a snapshot and `liveEntries` is empty per §DC.53). The snapshot-vs-snapshot fallback per §DC.53 (lifecycle-tag-only tombstone check) applies here exactly as it does for §DC.51 — the content-tombstone heuristic is unavailable when no live index is queried, but the lifecycle-tag check via the candidate-side `SnapshotClaimEntry.lifecycle` is sufficient for the explicit-tombstone case.

§3.DC.52:derives=R014.§7.AC.04 The module MUST export an interface `TombstoneContext` with fields: `liveEntries: Map<string, ClaimIndexEntry>` (keyed by fqid; may be empty when no live index is available, e.g., during snapshot-vs-snapshot regression gate runs in unusual contexts), `bodyResolver: (entry: ClaimIndexEntry) => string` (callback that returns the trimmed body text for an entry; the diff caller wires this up using `noteFileManager.getAggregatedContents` plus the `entry.line`/`endLine` slice — the same logic as §DC.16 minus the hashing step), `cache: Map<string, boolean>` (per-diff-run tombstone cache).

§3.DC.53:derives=R014.§7.AC.04 When `liveEntries.get(fqid)` returns `undefined` for a candidate-side tombstone check (snapshot-vs-snapshot mode where the live index isn't queried), the regression gate MUST fall back to the candidate-side `SnapshotClaimEntry.lifecycle` field for the lifecycle-tag check only. The content-tombstone heuristic (§DC.34) is NOT available in this fallback because snapshots don't store body text; this is an accepted tradeoff for the snapshot-vs-snapshot path. The lifecycle-tag check is sufficient for the common case where users tombstone explicitly via `:removed` or `:superseded=`.

§3.DC.54:derives=R014.§4.AC.06 `computeDiff` MUST NOT call `noteFileManager.getAggregatedContents` directly. All body-content access flows through `tombstoneCtx.bodyResolver`, which the caller wires up. This keeps the diff engine decoupled from filesystem I/O and makes it testable with synthetic inputs.

§3.DC.54a:derives=R014.§8.AC.03 The "no body-content disk reads in diff" performance contract is satisfied by §DC.54 (the `computeDiff` body-access boundary, which forbids direct `noteFileManager.getAggregatedContents` calls from the diff engine) together with §DC.75 (the diff handler's body-access boundary, which routes all body access through `tombstoneCtx.bodyResolver` and bounds the call count by the regression-candidate subset). Both DCs together enforce the {R014.§8.AC.03} invariant: detection of source-ref drift, note-ref drift, body-hash drift, and heading/metadata drift never reads body bytes from disk; the only body access path is the regression-gate fallback, which is bounded by the regression-candidate count and not by the claim count.

#### `core/src/claims/snapshot/snapshot-formatter.ts` (NEW)

Output formatting for both human-readable and `--json` paths. Reads `DiffReport` plus rendering options; produces strings.

§3.DC.55:derives=R014.§3.AC.01 The module MUST export a function `formatSnapshotList(rows: ListRow[]): string` that renders the list output as a `cli-table3` table with columns Name, Captured, Claims, Size. The Captured column displays `metadata.capturedAt` reformatted as `YYYY-MM-DD HH:MM` for readability; raw ISO is too noisy for a list view.

§3.DC.56:derives=R014.§3.AC.04 The module MUST export a function `formatSnapshotShow(snapshot: Snapshot, fileSize: number): string` that renders the snapshot's metadata block plus summary statistics: claim count, note count, count of claims with at least one incoming source ref, count of claims with a non-null lifecycle, file size. The function MUST NOT iterate `snapshot.claims` to print per-claim lines — output stays summary-scale per {R014.§3.AC.05}.

§3.DC.57:derives=R014.§4.AC.07 The module MUST export a function `formatDiffHeader(report: DiffReport, regressionsActive: boolean): string` that returns the one-line summary `Lost: X, New: Y, Body changed: Z, Heading/metadata changed: W, Source ref drift: V, Incoming note-ref drift: U, Regressions: T` followed by a blank line. When `regressionsActive` is true, the `Regressions: T` segment is rendered with chalk emphasis (red when T > 0, green when T === 0) so the gate result is visible before scrolling. When `regressionsActive` is false, `Regressions: T` MUST still appear in the header so the user sees the count; the chalk treatment is plain.

§3.DC.58:derives=R014.§5.AC.07 The module MUST export a function `formatDiffSections(report: DiffReport, regressionsActive: boolean): string` that emits the six categories (Lost claims, New claims, Body changed, Heading or metadata changed, Source ref drift, Incoming note-ref drift) in the order specified by R014.§5, each as a section with a header line and either the per-finding lines or an explicit `(no findings)` indicator. Empty sections MUST appear; silent omission is forbidden per {R014.§5.AC.07}.

§3.DC.58a:derives=R014.§4.AC.03 The default human-readable diff output (no `--json`) is the composition of `formatDiffHeader` (§DC.57) followed by `formatDiffSections` (§DC.58) emitted by the diff handler (§DC.74); together these constitute the structured human-readable report grouped by §5 categories that {R014.§4.AC.03} mandates. This DC pins the §4.AC.03 binding on the `header + sections` composition rather than on either function alone, because the AC's "structured human-readable report grouped by §5 categories" surface is the union, not either part in isolation.

§3.DC.59:derives=R014.§5.AC.05 Per-finding rendering for source-ref drift: `<fqid>` line followed by indented `- lost: <filePath>:<line> [<refKind>]` lines and `- gained: <filePath>:<line> [<refKind>]` lines. Per-finding rendering for note-ref drift: `<fqid>` line followed by indented `- lost: <fromFqid>` and `- gained: <fromFqid>` lines. Per-finding rendering for heading-or-metadata changes: `<fqid>` line followed by indented `- <field>: <baseline> → <candidate>` lines.

§3.DC.60:derives=R014.§6.AC.05 When a `LostClaimFinding` has `isRegression === true` (regression-gate active OR a default diff that still computed regression flags per the same code path), the finding's line MUST carry a chalk-red `[REGRESSION]` marker after the FQID. Without `--regressions`, the marker still appears in the per-section output to surface intent, but the command exits zero per {R014.§6.AC.05}.

§3.DC.61:derives=R014.§6.AC.06 The module MUST export a function `formatRegressionSuggestions(report: DiffReport): string` that, when `report.regressions.length > 0`, renders one line per regression in the form `Suggest: scepter meta add <fqid> lifecycle=removed   # was: <kind>; baseline source refs: N; defined at <filePath>:<line>; substitute lifecycle=superseded=TARGET if this regression is a planned replacement` (when `locationHint` is non-null) or, when `locationHint` is null, the same form with the `defined at <filePath>:<line>;` clause omitted. The trailing comment surfaces both lifecycle alternatives the AC mandates ({R014.§6.AC.06} requires the suggestion name BOTH `:removed` AND `:superseded=TARGET`), keeping the line copy-pasteable while making the supersession alternative discoverable inline. The default suggested tag is `:removed` per §DC.46; users substitute `:superseded=TARGET` per the trailing comment when the regression is a planned replacement rather than a deletion. The function emits nothing when there are no regressions. For `kind: 'derived-from-shrinkage'` findings, the line shape diverges per §DC.61a — the `dangling-source-coverage` and `untombstoned-loss` shape above governs the other two kinds.

§3.DC.61a:derives=R014.§6.AC.06 For `RegressionFinding` entries with `kind === 'derived-from-shrinkage'`, `formatRegressionSuggestions` (§DC.61) MUST emit a two-option suggestion line per finding rather than the single-option lifecycle-only line used for the other two kinds. The line shape is: `Suggest: scepter meta add <fqid> derives=<lost-target>   # restore derivation chain; OR lifecycle=removed (or lifecycle=superseded=TARGET) to acknowledge intentional drop` (when `locationHint` is null) or the same form with a trailing `; defined at <filePath>:<line>` clause appended before the closing newline (when `locationHint` is non-null). When `lostDerivationTargets` contains multiple FQIDs, the function MUST emit ONE line per lost target FQID — each line names a single `<lost-target>` so the suggestion is directly copy-pasteable. The two-option phrasing mirrors {R014.§6.AC.06}'s mandate that the suggestion present BOTH the restoration path (`scepter meta add <fqid> derives=<lost-target>`) AND the tombstone path (`lifecycle=removed` or `lifecycle=superseded=TARGET`); neither option is the "default" — the user picks based on whether the dropped derivation was intentional or accidental.

§3.DC.62:derives=R014.§4.AC.05 The module MUST export a function `formatDiffJson(report: DiffReport, regressionsActive: boolean): string` that returns `JSON.stringify(payload, null, 2)` where `payload` is `{ summary: report.summary, regressionsActive, lostClaims, newClaims, bodyChanged, headingOrMetadataChanged, sourceRefDrift, incomingNoteRefDrift, regressions }` (the `summary` field is the `report.summary` denormalized counts per §DC.39). The JSON output MUST omit the human-readable summary header per {R014.§4.AC.07} — the counts are already in the `summary` field.

### §3.2 CLI Command Group

#### `core/src/cli/commands/claims/snapshot/index.ts` (NEW)

Commander group barrel. Exports `snapshotCommand` and registers all child subcommands.

§3.DC.63:5:derives=R014.§1.AC.01 The barrel MUST export a `snapshotCommand` Commander subcommand with description "Capture and diff claim-index snapshots" and five child subcommands wired up: `save`, `list`, `show`, `rm`, `diff`. The barrel registers the parent command at the top level of the CLI program (`program.addCommand(snapshotCommand)` at `core/src/cli/index.ts`). The runtime invocation is `scepter snapshot <subcmd>`. The legacy form `scepter claims snapshot <subcmd>` continues to work via the existing `createBackwardCompatAlias('claims')` path established by {DD006.§3.DC.06}, which intercepts `scepter claims X Y...` and re-dispatches to `scepter X Y...`. R014's user-facing wording (`scepter claims snapshot save`) remains valid; no separate alias work is required by this DD.

§3.DC.64:derives=R014.§1.AC.01 Source files for the `snapshot` subcommand group MUST live under `core/src/cli/commands/claims/snapshot/` (a sibling of `claims/meta/`, nested under `claims/`). The `claims/meta/` group introduced by {DD014} is the actual post-{DD006} convention for new claim-subsystem CLI command groups: source files for `meta` live at `core/src/cli/commands/claims/meta/` while the `metaCommand` Commander group is registered at the top level of the CLI program via `program.addCommand(metaCommand)` at `core/src/cli/index.ts:97`. Snapshot follows the same shape — files nested under `claims/`, registration flat at the top level via `program.addCommand(snapshotCommand)` per {DD006.§3.DC.06}'s flat-registration rule. The engine subsystem at `core/src/claims/snapshot/` is already nested under `claims/`; placing the CLI files at `core/src/cli/commands/claims/snapshot/` preserves engine↔CLI placement symmetry under `claims/`. A sibling-of-`claims/` placement would break that symmetry without offsetting benefit.

#### `core/src/cli/commands/claims/snapshot/save-command.ts` (NEW)

§3.DC.65:derives=R014.§1.AC.01 The command MUST be defined as `new Command('save').argument('[name]', 'Snapshot name (default: current local timestamp)').option('--force', 'Overwrite an existing snapshot of the same name')`. Handler runs through `BaseCommand.execute({ projectDir, requireNoteManager: true })`.

§3.DC.66:derives=R014.§1.AC.02 Handler resolves `effectiveName = name ?? defaultSnapshotName()` (calling §DC.27), calls `ensureIndex(projectManager)` to populate the claim index, calls `captureSnapshot({ claimIndex, noteFileManager, projectRoot })`, then `writeSnapshot(projectRoot, effectiveName, snapshot, { force: !!options.force })`. On success, prints `Wrote snapshot: _scepter/snapshots/<name>.json` plus per-stat lines (claim count, note count, file size, capture wall time). On `SnapshotExistsError`, exits non-zero per {R014.§1.AC.09} with message `Snapshot already exists at <filePath>. Use --force to overwrite.`

#### `core/src/cli/commands/claims/snapshot/list-command.ts` (NEW)

§3.DC.67:derives=R014.§3.AC.01 The command MUST be defined as `new Command('list').description('List saved snapshots')`. Handler calls `listSnapshots(projectRoot)`, then `formatSnapshotList(rows)` (§DC.59), prints. When the result is empty, prints `No snapshots saved. Run \`scepter snapshot save\` to capture one.` and exits zero.

#### `core/src/cli/commands/claims/snapshot/show-command.ts` (NEW)

§3.DC.68:derives=R014.§3.AC.04 The command MUST be defined as `new Command('show').argument('<name>', 'Snapshot name')`. Handler computes `filePath = snapshotPath(projectRoot, name)`, calls `readSnapshot(filePath)` (§DC.29), `fs.promises.stat(filePath)` for size, then `formatSnapshotShow(snapshot, fileSize)` (§DC.56). On `SnapshotNotFoundError` or `SnapshotSchemaError`, exits non-zero with the typed error's message.

#### `core/src/cli/commands/claims/snapshot/rm-command.ts` (NEW)

§3.DC.69:derives=R014.§3.AC.02 The command MUST be defined as `new Command('rm').argument('<name>', 'Snapshot name to delete').option('--yes', 'Skip the confirmation prompt')`. Handler computes `filePath = snapshotPath(projectRoot, name)`. When the file does not exist, exits non-zero with `Snapshot not found: <name>` (per {R014.§3.AC.03}). When the file exists and `--yes` is not passed, the handler MUST first inspect `process.stdin.isTTY`: when `process.stdin.isTTY` is false (CI, piped, or other non-interactive contexts), the command MUST exit non-zero with the error message `Cannot prompt for confirmation in non-interactive context. Re-run with --yes.` and MUST NOT attempt to read from stdin (a blocking read would hang the process; an unguarded read could consume garbage from a piped source). When `process.stdin.isTTY` is true and `--yes` is not passed, prompts `Delete snapshot \"<name>\"? [y/N]: ` on stdin; only proceeds on a leading `y` or `Y`. With `--yes`, deletes without prompting regardless of TTY state. On confirmed delete, calls `removeSnapshot(projectRoot, name)`, prints `Deleted snapshot: <name>`.

§3.DC.70:derives=R014.§3.AC.02 The default-prompt-with-`--yes`-bypass posture (§DC.69) is the safer of the two options the dispatch brief weighed (`--yes` to bypass vs. silent deletion). Snapshots are session artifacts the user may have invested time in; an accidental deletion has real cost. Defaulting to a prompt prevents shell-history-replay accidents at minimal cost to scripted workflows (which pass `--yes` once).

#### `core/src/cli/commands/claims/snapshot/diff-command.ts` (NEW)

§3.DC.71:5:derives=R014.§4.AC.01 The command MUST be defined as `new Command('diff').argument('<a>', 'Snapshot name (or first snapshot in two-arg mode)').argument('[b]', 'Optional second snapshot name (compares <a> vs <b>)').option('--json', 'Emit machine-readable JSON instead of the report').option('--regressions', 'Treat regressions as gate failures (non-zero exit)')`.

§3.DC.72:derives=R014.§4.AC.01 Handler resolves both sides: when `b` is omitted, the candidate is `liveSide({ claimIndex, noteFileManager, projectRoot })` after `ensureIndex`; when `b` is provided, the candidate is `loadSnapshotSide(snapshotPath(projectRoot, b))`. The baseline is always `loadSnapshotSide(snapshotPath(projectRoot, a))`.

§3.DC.73:derives=R014.§6.AC.02 Handler builds `tombstoneCtx`: when the candidate is the live side, `liveEntries` is `new Map(claimIndex.getData().entries.entries())`; when the candidate is a snapshot, `liveEntries` is `new Map()` (per §DC.53 fallback). `bodyResolver` is wired to `noteFileManager.getAggregatedContents` plus the `entry.line+1..endLine` slice. `cache` is a fresh empty `Map`. The handler always builds `tombstoneCtx` (passes it into `computeDiff` regardless of `--regressions`) so that `LostClaimFinding.isRegression` is computed on every diff path per §DC.50; the `--regressions` flag controls only the exit code and the suggestion-line emission.

§3.DC.74:derives=R014.§4.AC.04 Output: when `options.json`, `console.log(formatDiffJson(report, !!options.regressions))` and exit (regression-gate behavior follows below). Otherwise, `console.log(formatDiffHeader(report, !!options.regressions))`, then `console.log(formatDiffSections(report, !!options.regressions))`, then if `options.regressions && report.regressions.length > 0`, `console.log(formatRegressionSuggestions(report))`. Exit code: when `options.regressions`, exit `report.regressions.length > 0 ? 1 : 0`; otherwise exit `0` regardless of drift.

§3.DC.75:derives=R014.§4.AC.06 The diff command MUST NOT call any filesystem reader for claim body content during diff computation — the only body access path is `tombstoneCtx.bodyResolver`, and that is invoked lazily only when a regression candidate's lifecycle field doesn't already settle the question. Capture-side body reads (already done by §DC.16) populate the live side's entries; the snapshot side carries only hashes per {R014.§1.AC.05}.

### §3.3 Wiring

#### `core/src/cli/index.ts` (MODIFY)

§3.DC.76:derives=R014.§1.AC.01 ADD an import `import { snapshotCommand } from './commands/claims/snapshot/index.js';` next to the existing `metaCommand` import (line 41). ADD `program.addCommand(snapshotCommand);` next to the existing `program.addCommand(metaCommand);` (line 97). ADD `'Quality and Hygiene': [..., 'snapshot']` to the help-grouping table at line 137 — `snapshot` is a quality-and-hygiene tool (it surveils coverage drift), aligned with `lint`, `verify`, `stale`. No backward-compat alias work is needed beyond what `createBackwardCompatAlias('claims')` already provides (§DC.63).

#### `core/src/claims/index.ts` (MODIFY)

§3.DC.77:derives=R014.§1.AC.04 ADD barrel re-exports for the snapshot subsystem's public types and functions: `Snapshot`, `SnapshotMetadata`, `SnapshotClaimEntry`, `SnapshotNoteEntry`, `SnapshotSourceRef`, `SnapshotLifecycle`, `SCHEMA_VERSION`, `BODY_HASH_ALGORITHM`, `BODY_HASH_ENCODING`, `normalizeBodyForHash`, `captureSnapshot`, `writeSnapshot`, `readSnapshot`, `listSnapshots`, `removeSnapshot`, `defaultSnapshotName`, `snapshotPath`, `SnapshotExistsError`, `SnapshotNotFoundError`, `SnapshotSchemaError`, `computeDiff`, `loadSnapshotSide`, `liveSide`, `DiffReport`, plus the per-finding interfaces. The library API surface ({DD011}) takes the snapshot subsystem on as a peer of the metadata store; consumers (UI, VS Code, scripted callers) get the same types the CLI uses.

---

## §4 Wiring Map

### §4.1 Import Graph

```
core/src/claims/snapshot/
  snapshot-types.ts          (no internal deps)
  tombstone-detector.ts      ← snapshot-types.ts (LifecycleState only via re-export from claim-metadata)
  snapshot-writer.ts         ← snapshot-types.ts, claim-index.ts (types), note-file-manager.ts (interface)
  snapshot-store.ts          ← snapshot-types.ts (Snapshot, SCHEMA_VERSION)
  snapshot-diff.ts           ← snapshot-types.ts, tombstone-detector.ts, snapshot-writer.ts (captureSnapshot for liveSide), snapshot-store.ts (readSnapshot)
  snapshot-formatter.ts      ← snapshot-types.ts, snapshot-diff.ts (DiffReport)

core/src/cli/commands/claims/snapshot/
  index.ts                   ← save-, list-, show-, rm-, diff-command.ts
  save-command.ts            ← snapshot-writer.ts, snapshot-store.ts, ensure-index.ts, base-command.ts
  list-command.ts            ← snapshot-store.ts, snapshot-formatter.ts, base-command.ts
  show-command.ts            ← snapshot-store.ts, snapshot-formatter.ts, base-command.ts
  rm-command.ts              ← snapshot-store.ts, base-command.ts, readline (Node builtin)
  diff-command.ts            ← snapshot-diff.ts, snapshot-store.ts, snapshot-formatter.ts, ensure-index.ts, base-command.ts

core/src/cli/index.ts        ← claims/snapshot/index.ts (ADD)
core/src/claims/index.ts     ← snapshot/* (ADD re-exports)
```

The subsystem has no inbound dependencies from existing modules; it is purely additive. The diff engine takes `noteFileManager` and `claimIndex` as constructor-injected ports rather than importing the project-manager directly, keeping the engine testable.

### §4.2 Call Chain — `scepter snapshot save`

```
CLI: scepter snapshot save my-baseline
  → BaseCommand.execute({ requireNoteManager: true })
    → BaseCommand.setup → createFilesystemProject → projectManager.initialize
  → save-command handler
    → ensureIndex(projectManager)                          // populates claimIndex with cross-refs from sourceScanner
    → captureSnapshot({ claimIndex, noteFileManager, projectRoot })
      → for each entry in claimIndex.getData().entries:
         → cache noteFileManager.getAggregatedContents(noteId) per noteId
         → extract body slice [entry.line+1 .. entry.endLine]
         → normalizeBodyForHash → createHash('sha256').update(...).digest('hex')
         → split data.crossRefs.filter(toClaim === fqid) by fromNoteId shape
         → emit SnapshotClaimEntry
      → for each contributing noteId:
         → reuse cached aggregated content → noteContentHash
         → emit SnapshotNoteEntry
      → resolve gitCommit via execFile('git', ['rev-parse','HEAD'], { cwd: projectRoot, timeout: 2000 })
    → writeSnapshot(projectRoot, name, snapshot, { force })
      → ensureSnapshotDir(projectRoot)                     // mkdir + ensure .gitignore
      → fs.access(filePath) → throw SnapshotExistsError if exists && !force
      → fs.writeFile(tempPath, JSON.stringify(snapshot, null, 2))
      → fs.rename(tempPath, filePath)
    → console.log success summary
  → projectManager.cleanup
```

### §4.3 Call Chain — `scepter snapshot diff baseline --regressions`

```
CLI: scepter snapshot diff baseline --regressions
  → BaseCommand.execute
  → diff-command handler
    → loadSnapshotSide(snapshotPath(projectRoot, 'baseline'))
      → readSnapshot → JSON.parse → schema-version validate → index into Maps
    → ensureIndex(projectManager)
    → liveSide({ claimIndex, noteFileManager, projectRoot })
      → captureSnapshot(...) (same path as save, no file write)
      → index into Maps
    → build TombstoneContext
      → liveEntries = Map(claimIndex.entries)
      → bodyResolver = (entry) => normalizeBodyForHash(slice(getAggregatedContentsSync(entry.noteId), entry.line+1, entry.endLine))
      → cache = new Map()
    → computeDiff({ baseline, candidate, tombstoneCtx })
      → Stage 2: set-difference → lostClaims, newClaims
      → Stage 3: shared-FQID drift → bodyChanged, headingOrMetadataChanged, sourceRefDrift, incomingNoteRefDrift
      → Stage 4: regressions
        → for each lostClaim: isTombstoned(liveEntries.get(fqid)) → mark + RegressionFinding(untombstoned-loss)
        → for each shared FQID: baseSrcCount > 0 && candSrcCount === 0 && !isTombstoned → RegressionFinding(dangling-source-coverage)
    → console.log(formatDiffHeader(report, true))
    → console.log(formatDiffSections(report, true))
    → if regressions.length > 0: console.log(formatRegressionSuggestions(report))
    → process.exit(regressions.length > 0 ? 1 : 0)
```

The diff engine never reads claim bodies in the snapshot-vs-snapshot path (no `tombstoneCtx.bodyResolver` calls when `liveEntries` is empty and lifecycle alone settles tombstone state). When candidate is live, body reads happen only for the regression-finding subset whose lifecycle didn't settle — bounded by the regression count, not by the claim count.

### §4.4 Provider / Context Nesting

No new providers. The snapshot subsystem is a pure library that `BaseCommand.execute`-style handlers consume. `ProjectManager` does NOT gain a `snapshotStore` field — snapshot operations are CLI-scoped, not project-lifecycle-scoped, and adding a field would create a misleading lifecycle implication.

---

## §5 Data and Interaction Flow

### §5.1 Snapshot file lifecycle

```
1. user runs `scepter snapshot save baseline`
2. ClaimIndex builds in-memory (or returns cached) → entries, crossRefs populated
3. captureSnapshot walks entries, computing per-claim body hashes from aggregated note content
4. captureSnapshot resolves gitCommit (or null) via execFile
5. writeSnapshot ensures _scepter/snapshots/ exists + .gitignore (`*\n`) bootstrapped
6. writeSnapshot writes baseline.json.tmp → fs.rename → baseline.json
7. CLI prints success summary
```

### §5.2 Diff lifecycle

```
1. user runs `scepter snapshot diff baseline --regressions`
2. baseline-side: readSnapshot → schemaVersion check → index into Maps
3. candidate-side: ensureIndex + captureSnapshot (no file write) → index into Maps
4. tombstoneCtx built from live ClaimIndex entries + bodyResolver closure
5. computeDiff stages 2-4 produce DiffReport
6. formatter renders header + sections (+ suggestions when --regressions and regressions > 0)
7. exit code: 1 when --regressions and regressions > 0; 0 otherwise
```

### §5.3 Regression-gate decision flow

For each lost-claim finding in stage 4:

```
liveEntry = tombstoneCtx.liveEntries.get(fqid)
if liveEntry === undefined:
   not tombstonable (claim is gone) → REGRESSION (untombstoned-loss)
elif liveEntry.lifecycle.type in {removed, superseded}:
   tombstoned → no regression
else:
   body = bodyResolver(liveEntry)
   if /^(removed|superseded)\.?$/i.test(body.trim()):
      tombstoned → no regression
   else:
      REGRESSION (untombstoned-loss)
```

For each shared-FQID source-coverage drop:

```
baselineCount = baseline.claims.get(fqid).incomingSourceRefs.length
candidateCount = candidate.claims.get(fqid).incomingSourceRefs.length
if baselineCount > 0 and candidateCount === 0:
   liveEntry = tombstoneCtx.liveEntries.get(fqid)
   if liveEntry exists and isTombstoned(liveEntry, bodyResolver, cache):
      no regression (the user explicitly retired it)
   else:
      REGRESSION (dangling-source-coverage)
```

The cache is populated once per FQID per diff run; both gate paths share the same `Map`.

---

## §6 Snapshot File Schema (worked example)

A snapshot file's on-disk JSON shape:

```json
{
  "metadata": {
    "schemaVersion": 1,
    "capturedAt": "2026-05-06T17:42:31.219Z",
    "projectRoot": "/Users/way/Projects/scepter",
    "gitCommit": "f86400b9a1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6"
  },
  "claims": [
    {
      "fqid": "R014.§1.AC.01",
      "noteId": "R014",
      "noteType": "Requirement",
      "heading": "§1.AC.01 The CLI MUST expose `scepter claims snapshot save [name]`...",
      "lifecycle": null,
      "importance": null,
      "derivedFrom": [],
      "incomingNoteRefs": ["DD018.§3.DC.61", "DD018.§3.DC.62"],
      "incomingSourceRefs": [
        { "filePath": "core/src/cli/commands/claims/snapshot/save-command.ts", "line": 14, "refKind": "implements" }
      ],
      "bodyHash": "8a4f2c5d3e6b7a9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c"
    }
  ],
  "notes": [
    {
      "noteId": "R014",
      "noteTitle": "R014 - Claim Snapshot Capture and Session-End Diff",
      "claimFqids": ["R014.§1.AC.01", "R014.§1.AC.02", "..."],
      "noteContentHash": "1f2e3d4c5b6a798877665544332211009988776655443322110099887766aabb"
    }
  ]
}
```

Note: `claims` array is sorted by `fqid` ascending; `notes` array is sorted by `noteId` ascending. These sorts are part of the determinism contract (§DC.10) so that two captures with identical inputs produce byte-equal files modulo `metadata.capturedAt`.

---

## §7 Integration Sequence

Each phase has a verification gate. Phases are sequential; do not start a later phase until the prior gate passes.

### Phase 1: Types and constants (no behavior)

**Files:** `core/src/claims/snapshot/snapshot-types.ts` (NEW)

**Changes:** Add all interfaces and constants per §3.DC.01-§3.DC.13 (excluding writer/store logic). Pure type declarations.

**Verify:** `pnpm tsc` passes. Manual review confirms `Snapshot`, `SnapshotClaimEntry`, `SnapshotMetadata`, `SnapshotLifecycle`, `SnapshotSourceRef`, `SnapshotNoteEntry`, `SCHEMA_VERSION`, `BODY_HASH_ALGORITHM`, `BODY_HASH_ENCODING`, and `normalizeBodyForHash` exist with the documented shapes.

**Spec:** {R014.§1.AC.04}, {R014.§1.AC.06}, {R014.§1.AC.07}

### Phase 2: Tombstone detector

**Files:** `core/src/claims/snapshot/tombstone-detector.ts` (NEW)

**Changes:** §DC.32-§DC.35. Pure functions over `LifecycleState` and body strings.

**Verify:** Unit tests against the regex constant: `Removed`, `removed.`, `REMOVED`, `Superseded`, `superseded.` match; `Removed: see X`, `This was removed in v2`, empty string do not match. `isLifecycleTombstone({type:'removed'})` → true; `isLifecycleTombstone({type:'closed'})` → false. `isLifecycleTombstone(undefined)` → false.

**Spec:** {R014.§7.AC.01}-{R014.§7.AC.04}

### Phase 3: Snapshot writer

**Files:** `core/src/claims/snapshot/snapshot-writer.ts` (NEW)

**Changes:** §DC.14-§DC.20 — `captureSnapshot` plus body-hash extraction and gitCommit resolution helpers.

**Verify:** Synthetic-input determinism test: build a fixture `ClaimIndex` with 3 claims in 2 notes, capture, capture again with a fixed `now` Date — assert the two snapshots are byte-equal modulo `metadata.capturedAt`. Manual: capture against the real project (no file write yet — print to stdout via a temporary harness), confirm `gitCommit` populates and body hashes are stable across two consecutive captures.

**Spec:** {R014.§1.AC.04}-{R014.§1.AC.08}, {R014.§8.AC.01}, {R014.§8.AC.02}

### Phase 4: Snapshot store

**Files:** `core/src/claims/snapshot/snapshot-store.ts` (NEW)

**Changes:** §DC.21-§DC.31 — `writeSnapshot`, `ensureSnapshotDir` (with gitignore bootstrap per §DC.31), `listSnapshots`, `removeSnapshot`, `readSnapshot`, `defaultSnapshotName`, `snapshotPath`, typed errors.

**Verify:** Round-trip: write a fixture snapshot, list it, read it back, assert equality. Force semantics: write twice without `--force` → second throws `SnapshotExistsError`; write twice with `--force` → second succeeds. Atomic-overwrite: simulate a partial write by interrupting between `writeFile(tempPath)` and `rename` — confirm the original file is untouched. `.gitignore` bootstrap: delete the snapshots directory, run save, confirm `.gitignore` exists with content `*\n`. Idempotency: run save twice, confirm `.gitignore` is not rewritten on the second run.

**Spec:** {R014.§1.AC.09}, {R014.§2.AC.01}-{R014.§2.AC.03}, {R014.§3.AC.01}-{R014.§3.AC.05}

### Phase 5: Diff engine

**Files:** `core/src/claims/snapshot/snapshot-diff.ts` (NEW)

**Changes:** §DC.36-§DC.54 — `SnapshotSide`, `loadSnapshotSide`, `liveSide`, `computeDiff`, the per-finding interfaces, `TombstoneContext`.

**Verify:** Per-category integration test (one fixture per category): (a) delete a claim → assert `lostClaims` populates and `newClaims` empty; (b) add a claim → assert `newClaims` populates; (c) modify claim body content → assert `bodyChanged` populates and headingOrMetadataChanged empty; (d) add `:removed` lifecycle tag → assert `headingOrMetadataChanged` populates with lifecycle change and `bodyChanged` empty; (e) drop an `@implements` annotation → assert `sourceRefDrift` populates with `lost`; (f) add an incoming note ref pointing at the fixture's seed claim → assert `incomingNoteRefDrift` populates with `gained`. Regression gate: scenario where a covered claim is dropped and not tombstoned → assert `regressions` includes `untombstoned-loss`; same scenario with `:removed` lifecycle tag added → assert no regression. Snapshot-vs-snapshot mode with `liveEntries: new Map()` → assert lifecycle-tag fallback works (§DC.53).

**Spec:** {R014.§4.AC.01}-{R014.§4.AC.07}, {R014.§5.AC.01}-{R014.§5.AC.07}, {R014.§6.AC.01}-{R014.§6.AC.06}

### Phase 6: Formatter

**Files:** `core/src/claims/snapshot/snapshot-formatter.ts` (NEW)

**Changes:** §DC.55-§DC.62 — `formatSnapshotList`, `formatSnapshotShow`, `formatDiffHeader`, `formatDiffSections`, `formatRegressionSuggestions`, `formatDiffJson`.

**Verify:** Snapshot-test (vitest snapshot, not the SCEpter sense) the rendered output for a fixture `DiffReport`. Confirm empty sections render with `(no findings)` indicator. Confirm `--json` output omits the human header and includes `summary` field. Confirm regression marker appears even without `--regressions` per {R014.§6.AC.05}.

**Spec:** {R014.§3.AC.01}, {R014.§3.AC.04}-{R014.§3.AC.05}, {R014.§4.AC.05}, {R014.§4.AC.07}, {R014.§5.AC.07}, {R014.§6.AC.05}, {R014.§6.AC.06}

### Phase 7: CLI commands

**Files:** `core/src/cli/commands/claims/snapshot/index.ts`, `save-command.ts`, `list-command.ts`, `show-command.ts`, `rm-command.ts`, `diff-command.ts` (all NEW)

**Changes:** §DC.63-§DC.75 — Commander definitions plus handlers wiring writer/store/diff/formatter through `BaseCommand.execute`.

**Verify:** End-to-end against the real project: `scepter snapshot save test-baseline`; `scepter snapshot list`; `scepter snapshot show test-baseline`; `scepter snapshot diff test-baseline` (no drift expected → all categories show `(no findings)`); `scepter snapshot diff test-baseline --json` (valid JSON, summary field present); `scepter snapshot diff test-baseline --regressions` (exit 0, no regressions); `scepter snapshot rm test-baseline --yes` (deletes); `scepter snapshot rm nonexistent` (exit non-zero with clear message). Confirm `scepter claims snapshot save other` works through the backward-compat alias.

**Spec:** {R014.§1.AC.01}, {R014.§3.AC.01}-{R014.§3.AC.05}, {R014.§4.AC.01}-{R014.§4.AC.05}, {R014.§6.AC.01}-{R014.§6.AC.02}

### Phase 8: Wiring + barrel

**Files:** `core/src/cli/index.ts` (MODIFY), `core/src/claims/index.ts` (MODIFY)

**Changes:** §DC.76-§DC.77 — register `snapshotCommand`, add help-grouping entry, add barrel re-exports.

**Verify:** `pnpm tsc` passes. `scepter --help` shows `snapshot` under Quality and Hygiene. Library consumers can import `Snapshot` and `captureSnapshot` from the top-level barrel.

**Spec:** {R014.§1.AC.01}

---

## §8 Testing Strategy

| Test Level | Scope | Requirements Covered |
|-----------|-------|---------------------|
| Unit | Tombstone detector regex and lifecycle check | {R014.§7.AC.01}-{R014.§7.AC.03} |
| Unit | `defaultSnapshotName` format, `snapshotPath` traversal-rejection | {R014.§1.AC.02}, {R014.§2.AC.01} |
| Unit | `normalizeBodyForHash` idempotence and trim semantics | {R014.§1.AC.04} |
| Unit | Schema-version forward-compat (newer rejected, older with shim accepted) | {R014.§4.AC.01}, edge case from R014 |
| Unit | Determinism of capture (same input → byte-equal output modulo `capturedAt`) | {R014.§1.AC.03}-{R014.§1.AC.07} |
| Integration | One scenario per diff category (lost, new, body, heading/metadata, source-ref drift, note-ref drift) | {R014.§5.AC.01}-{R014.§5.AC.07} |
| Integration | Regression gate: dangling source coverage with and without lifecycle tombstone, with and without content tombstone | {R014.§6.AC.03}-{R014.§6.AC.05}, {R014.§7.AC.01}-{R014.§7.AC.03} |
| Integration | Atomic overwrite (interrupted write leaves original intact) | {R014.§1.AC.09} |
| Integration | `.gitignore` self-bootstrap (created on first save with `*\n`; not rewritten on subsequent saves) | {R014.§2.AC.03} |
| Integration | Empty-result `list` (no snapshots dir → empty array, no error) | {R014.§3.AC.01} |
| Integration | `rm` with and without `--yes`; `rm` of nonexistent name | {R014.§3.AC.02}, {R014.§3.AC.03} |
| Integration | `--json` output is valid JSON, omits human header, includes `summary` | {R014.§4.AC.05}, {R014.§4.AC.07} |
| Integration | Snapshot-vs-snapshot diff with no live index queries | {R014.§4.AC.02}, {R014.§4.AC.06} |
| Integration | Backward-compat alias: `scepter claims snapshot save` works identically to `scepter snapshot save` | {R014.§1.AC.01} (compat with R014's wording) |
| Integration | `git rev-parse` failure → `gitCommit: null`, capture still succeeds | {R014.§1.AC.07}, {R014.§1.AC.08} |
| Performance | 10k-claim fixture: capture under 30s, file under 500KB | {R014.§8.AC.04} |

The test plan is authored as a separate `TestPlan` note after implementation; this DD lists the test scope for the test-plan author to elaborate.

---

## §9 Non-Goals (explicit)

- **Concurrent / parallel snapshot capture in v1.** Sequential per-note, per-claim work is the v1 baseline. Adding bounded concurrency (`p-limit`-style) is reserved for a follow-up DD if measurement shows the §DC.20 budget is missed on real projects.
- **Snapshot diffing against arbitrary git refs.** Out of {R014} scope.
- **Snapshot compression (gzip, brotli).** Out of {R014} scope.
- **Auto-snapshot hooks** (pre-edit, post-implementation, etc.). Out of {R014} scope.
- **`--shared` snapshots written outside the gitignored directory.** Out of {R014} scope; explicitly forbidden by {R014.§2.AC.04}.
- **A `restore` command.** Snapshots are read-only references, not undo points. Restoring would require either re-applying source-code edits (`@implements` annotations) or rewriting note content from the snapshot's hashes (impossible — hashes don't carry content). Any "restore" semantics belong in a separate requirement.
- **A snapshot-aware variant of `scepter trace` or `scepter gaps`.** Out of {R014} scope. The diff command is the dedicated surface.
- **Tombstone vocabulary expansion (`retired`, `obsolete`, `deleted`).** {R014} explicitly defers this; the DD tracks {R005}'s `removed`/`superseded` 1:1.

---

## §10 Observations

### §10.1 R014 ACs lacking a derived DC

Every R014 AC has at least one DC deriving from it (verified by inspection of the `derives=` metadata across §3). The minimal-derivation cases worth flagging for the reviewer:

- {R014.§1.AC.05} (no body text, only body hash) — covered indirectly by §DC.06-§DC.07 and §DC.16 (body acquisition for hashing only); the negative invariant ("MUST NOT store body text") is enforced by the absence of any body-text field in `SnapshotClaimEntry` per §DC.03. Reviewer should confirm the schema declaration in §DC.03 is the authoritative enforcement and no separate constraint DC is needed.
- {R014.§5.AC.07} (every category section MUST appear, empty MUST render explicitly) — covered by §DC.58. The DD does not author a separate "no findings" indicator-text DC because the formatter rendering choice is judgment-laden display detail; the AC's testability is satisfied by §DC.58's contract.
- {R014.§8.AC.01} (no body-bytes field) — same reasoning as {R014.§1.AC.05}; enforced by the schema declaration.
- {R014.§8.AC.02} (capture walks the in-memory index) — enforced collectively by §DC.14-§DC.17. No separate "MUST NOT" DC was authored because the affirmative DCs already constrain the access path.
- {R014.§8.AC.03} (no body-content disk reads in diff) — bound by §DC.54a, which derives from §8.AC.03 directly and pins the contract on the §DC.54 + §DC.75 body-access boundary pair.
- {R014.§4.AC.03} ("default diff output MUST be a structured human-readable report grouped by the categories specified in §5") — bound by §DC.58a, which derives from §4.AC.03 directly and pins the contract on the `formatDiffHeader` (§DC.57) + `formatDiffSections` (§DC.58) composition emitted by the diff handler (§DC.74).

### §10.2 Decisions held back from DC-level pinning

The dispatch brief asked the DD to weigh in on several decisions; these are settled in DCs above. Two are worth surfacing for explicit user review before the implementation pass:

- **Default-prompt for `rm` vs. `--yes`-required deletion** (§DC.69, §DC.70). The DD picks default-prompt-with-`--yes`-bypass. The brief recommended the same but flagged it as a judgment call. Worth confirming.
- **Local-time vs. UTC in default snapshot name** (§DC.27). The DD picks local time per the brief's explicit recommendation, but a project that runs in CI or across multiple developers' timezones might prefer UTC for consistency. The trade-off is "user surprise during late-night work" vs. "CI consistency"; v1 picks local. Reverting to UTC is a one-line change if the user prefers.

### §10.3 Open questions for reviewer

- **`refKind` enumeration in snapshot vs. live index.** The schema's `refKind` field (§DC.05) carries the `SourceReferenceType` union value verbatim. If the union adds a new value in a future change to the source-reference parser, snapshots captured by older binaries will lack that value while snapshots from newer binaries will carry it. The diff engine treats `refKind` as a string and an opaque equality key, so this is forward-compatible at the diff layer. No schema bump required for adding a new value to the union, but the user should be aware: a snapshot captured against an old parser is faithful only to that parser's refKind vocabulary.
- **Backward-compat alias surface.** §DC.63/§DC.76 lean on the existing `createBackwardCompatAlias('claims')` to make `scepter claims snapshot save` work. The alias re-dispatches to `scepter snapshot save` via `program.parseAsync(args, { from: 'user' })` per `cli/index.ts:121`. This works for the simple `claims snapshot save baseline` form but should be smoke-tested with `--force`, `--json`, and `--regressions` flag passing, since the alias path's flag-forwarding is via `allowExcessArguments + allowUnknownOption` and re-parse, not first-class option declaration. If flag forwarding misbehaves, the fix is in `createBackwardCompatAlias`, not in this DD's scope.
- **Snapshot-vs-snapshot tombstone fallback (deferred candidate for an {R014.§7} amendment).** §DC.53 falls back to the candidate-side `SnapshotClaimEntry.lifecycle` field when comparing two snapshots and no live index is available, because that path has no other tombstone source. {R014.§7}'s preamble says tombstone equivalence "is evaluated against the live index, not against pre-stored flags," which targets the snapshot-vs-live path; the snapshot-vs-snapshot fallback in §DC.53 is in tension with the literal preamble wording even though the preamble's evident target is the live-comparison path. The fallback is an accepted v1 simplification — without it, snapshot-vs-snapshot regression evaluation cannot resolve any tombstone state. A future {R014.§7} amendment to explicitly authorize the snapshot-vs-snapshot fallback (and clarify the preamble's scope) is a candidate iteration if the v1 behavior proves problematic in practice. No DD18 change required; track via R014 amendment if the user surfaces a real-world conflict.
- **`derivedFrom` shrinkage as a third regression shape (resolved).** Previously held as a deferred-candidate {R014.§6} amendment. {R014.§6.AC.07} now mandates this regression shape: an untombstoned `derivedFrom` set-shrinkage between baseline and candidate is the third regression shape alongside `dangling-source-coverage` and `untombstoned-loss`. DD018 realizes the shape via §DC.51a (set-difference computation), §DC.51b (tombstone-exempt classification as `kind: 'derived-from-shrinkage'`), §DC.46 (extension of the `RegressionFinding.kind` union plus the optional `lostDerivationTargets` payload), §DC.49 (clarification that `derivedFrom` GROWTH is drift while SHRINKAGE flows additionally to the regression-gate stage), and §DC.61a (two-option suggestion-text emit covering both restoration and tombstone paths per {R014.§6.AC.06}). The candidate-side tombstone exemption shares `tombstoneCtx.cache` with §DC.50 and §DC.51 so per-FQID tombstone state is computed at most once per diff run.

### §10.4 Items the dispatch brief surfaced that are NOT pinned in DCs

- **Performance budget hard-fail vs. warning.** The brief asked for "hard fail with a warning if capture exceeds 60s." §DC.20 implements warning-only (stderr message, no non-zero exit) because a hard-fail exit on a warning condition is contradictory; the §DC.20 phrasing is "warning only, no exit code change" since {R014.§8.AC.04} explicitly says these are informational benchmarks not hard contracts. Reviewer should confirm.

---

## §11 References

- {R014} — the binding requirement; this DD addresses all 47 ACs.
- {R005} — claim metadata, lifecycle vocabulary; the tombstone detector at §DC.32-§DC.35 consumes this. Specifically {R005.§2} for the `closed | deferred | removed | superseded` vocabulary.
- {R004} — claim-level addressability and FQID format; the snapshot's `fqid` field carries this format verbatim.
- {S002} — claim grammar reference; the FQIDs serialized into snapshots conform to this grammar.
- {R008} — folder-note aggregation; the snapshot writer's body-content extraction at §DC.16 routes through `NoteFileManager.getAggregatedContents` to honor it.
- {R009} — claim metadata key-value store; the lifecycle field on `ClaimIndexEntry` that the snapshot serializes is folded from this store via the existing claim-index path.
- {R012} — sync-aggregation context; not directly invoked by snapshot work (snapshot capture uses async path), but a reminder that `getAggregatedContentsSync` exists if the diff's tombstone bodyResolver needs it for the live-side path during regression evaluation.
- {DD006} — CLI unification / claims-flattening; §DC.63, §DC.76, and §10.3 depend on the backward-compat alias DD006 established.
- {DD011} — library API surface; §DC.77's barrel re-exports add the snapshot subsystem to the library API for UI/VS Code consumers.
- {DD014} — claim metadata store; provides the `metadataStorage` path that populates lifecycle on `ClaimIndexEntry`. Also serves as the structural model this DD follows (per-DC inventory, primitive preconditions, integration sequence).
- Existing claim subsystem peers: `core/src/claims/claim-index.ts`, `core/src/claims/claim-metadata.ts`, `core/src/claims/traceability.ts`, `core/src/claims/staleness.ts` — the snapshot subsystem at `core/src/claims/snapshot/` is a peer of these.

---

## Status

**2026-05-06** — Authored as draft. Awaiting review pass per the SCEpter process loop. Implementation is a separate downstream dispatch.

**2026-05-06** — Applied reviewer mechanical findings: N1 (§DC.58a binding R014.§4.AC.03 to the `formatDiffHeader + formatDiffSections` composition), N2 (§DC.54a binding R014.§8.AC.03 to the §DC.54 + §DC.75 body-access boundary pair), N3 (§DC.61 suggestion expansion to surface the `:superseded=TARGET` alternative inline per {R014.§6.AC.06}), N4 (§DC.69 TTY guard for the `rm` confirmation prompt to fail clean in non-interactive contexts), N5 (§DC.47 wording fix to remove the contradiction with §DC.73's always-real-`tombstoneCtx` posture). Trace coverage closed for {R014.§4.AC.03} and {R014.§8.AC.03}; both ACs now have formal `derives=` links. HUMAN_JUDGMENT items from the same review (CLI placement under `cli/commands/snapshot/` vs. `cli/commands/claims/snapshot/`, allowlist defense for `snapshotPath` traversal rejection, `derivedFrom` shrinkage as regression candidate, snapshot-vs-snapshot tombstone fallback) deferred to user disposition.

**2026-05-06** — Applied four resolved dispositions from the review pass. (1) §DC.64 reverted to `core/src/cli/commands/claims/snapshot/` (nested under `claims/`) to match the {DD014} `meta/` precedent for new claim-subsystem CLI groups and preserve engine↔CLI placement symmetry under `claims/`; registration remains top-level via `program.addCommand(snapshotCommand)` per {DD006}'s flat-registration rule. Section headers in §3.2, §3.DC.76's import path, §4.1's import-graph diagram, §6's worked example, and Phase 7's file list updated to the new path. §10.4's divergence-from-brief bullet for CLI placement removed (resolved). (2) §DC.22 tightened from a separator/`..` reject-list to an `/^[a-zA-Z0-9._-]+$/` allowlist plus an explicit leading-dot rejection, with a spelled-out error message and defense-in-depth rationale (eliminates shell-quoting friction, blocks invisible-dotfile snapshots that would be silently filtered out by `listSnapshots`'s `.json` glob, near-zero UX cost on real-world snapshot names). (3) §10.3 expanded with a deferral note acknowledging the tension between §DC.53's snapshot-vs-snapshot fallback and {R014.§7}'s preamble wording; the v1 behavior is the accepted simplification (no other tombstone source available in that path) and an {R014.§7} amendment to explicitly authorize the fallback is the candidate future iteration. (4) §10.3 also expanded with a deferral note for `derivedFrom` shrinkage as a third regression shape (an {R014.§6} amendment with a §6.AC.07 entry is the path forward if real-world cases surface post-implementation); the existing "drift not regression" bullet was rewritten in place into the deferred-candidate framing.

**2026-05-06** — Promoted `derivedFrom` shrinkage from deferred-candidate to implemented regression shape per user disposition. Replaced §10.3 deferral note with a resolution note pointing at the new DCs. Added §DC.51a (set-difference computation `baseline.derivedFrom \ candidate.derivedFrom` with growth excluded), §DC.51b (tombstone-exempt regression classification emitting `RegressionFinding` of `kind: 'derived-from-shrinkage'` sharing `tombstoneCtx.cache` with §DC.50 and §DC.51), and §DC.61a (two-option suggestion-text emit naming BOTH restoration via `scepter meta add <fqid> derives=<lost-target>` AND tombstone via `lifecycle=removed` or `lifecycle=superseded=TARGET`, one line per lost target FQID). Extended §DC.46's `RegressionFinding.kind` union with `'derived-from-shrinkage'` and added the optional `lostDerivationTargets: string[]` payload. Refined §DC.49 to clarify that `derivedFrom` GROWTH is drift while SHRINKAGE flows additionally to the regression-gate stage. {R014.§6.AC.07} now binds via `derives=` on §DC.51a and §DC.51b; {R014.§6.AC.06}'s extended two-option mandate binds via `derives=` on §DC.61 and §DC.61a. Implicit DC count 79 → 82.
