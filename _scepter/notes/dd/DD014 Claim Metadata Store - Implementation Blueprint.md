---
created: 2026-04-25T04:03:40.742Z
tags: [claims,metadata,event-log,storage,implementation]
status: implemented
---

# DD014 - Claim Metadata Store - Implementation Blueprint

**Architecture:** {A004}
**Requirement:** {R009}
**Date:** 2026-04-25
**Scope:** Phase-1 implementation blueprint for the generalized claim metadata store specified in {R009.§8} and architected in {A004}. Defines the file-by-file integration sequence, the migration of `verification.json` data and consumer call sites from {A002}'s `VerificationStorage` to the new `MetadataStorage`, the suffix-grammar normalization path that preserves R005 importance and lifecycle vocabulary as consumer conventions on top of the generalized store, the `verify` CLI's log-level alias rewiring, the decomposition of R009's compound ACs into module-scoped DCs, and the verification points that gate each phase.

Phase-2 work (note-scoped writes, batch apply, cross-claim listing, grep, diff, changes, all of §6 maintenance ops) is summarized in §10 but not designed here. The Phase-1 subset MUST be implementable as a coherent shipping unit per {R009.§8}.

---

## §1 Specification Scope

### Phase-1 ACs in scope

The following R009 ACs are addressed by this DD per {R009.§8} (Minimum Viable Subset):

- **§1 Event Log Storage Model:** all 12 ACs ({R009.§1.AC.01}-{R009.§1.AC.12})
- **§2 Write Operations (single-claim subset):** {R009.§2.AC.01} (`add`), {R009.§2.AC.02} (`set`), {R009.§2.AC.04} (`unset`), {R009.§2.AC.05} (`clear`), {R009.§2.AC.07} (KEY validation), {R009.§2.AC.08} (claim-ID resolution), {R009.§2.AC.09} (`:removed` rejection)
- **§3 Read Operations (subset):** {R009.§3.AC.01}, {R009.§3.AC.02}, {R009.§3.AC.04} (`get` with `--json`), {R009.§3.AC.06}, {R009.§3.AC.08} (`log` with `--json`)
- **§4 Suffix Grammar Generalization:** all 8 ACs ({R009.§4.AC.01}-{R009.§4.AC.08}) — required because every R005-era claim in every project carries suffix tokens that must enter the new store losslessly
- **§5 Integration Filters:** {R009.§5.AC.01} (`--where`), {R009.§5.AC.02} (`--has-key`), {R009.§5.AC.03} (`--missing-key`), {R009.§5.AC.05} (existing `--importance` continues to work), {R009.§5.AC.06} (composability)
- **§7 Back-Compat:** all 11 ACs ({R009.§7.AC.01}-{R009.§7.AC.11}) per {R009.§8}, with one user-authorized scope reduction: the legacy on-disk store is migrated by a one-shot CLI command (§DC.19) rather than a runtime auto-migration shim, and the verify CLI's asymmetric `--remove` (log-level pop) vs `--remove --all` (state-level wipe) distinction is collapsed to a single state-level `--remove` semantic (§DC.60). The `--method` flag is renamed to `--note`. Markdown back-compat with R005 (suffix grammar, importance/lifecycle/derives vocabulary) is preserved fully via the lossless ingest path (§DC.39).

The full {A004} architecture (§1-§5) is in scope as structural grounding.

### Phase-1 ACs deferred (out of scope here)

Per {R009.§8} "Deferred to later phases":

- {R009.§2.AC.03} (`remove`), {R009.§2.AC.06} (`replace`)
- {R009.§2.AC.10}-{R009.§2.AC.12} (note-scoped writes)
- {R009.§2.AC.13}-{R009.§2.AC.15} (batch `apply`)
- {R009.§3.AC.03} (`get --history`), {R009.§3.AC.05} (`get --values-only`)
- {R009.§3.AC.07} (`log` filters), {R009.§3.AC.09}-{R009.§3.AC.11} (`list`), {R009.§3.AC.12}-{R009.§3.AC.13} (`grep`), {R009.§3.AC.14} (`diff`), {R009.§3.AC.15} (`changes`)
- {R009.§5.AC.04} (`--group-by`)
- All of {R009.§6} (revert, compact, export/import, validate, rename-key)

These are summarized in §10 below as a roadmap, not specified.

### Open questions resolved before this DD

- {R009.OQ.01} (sidecar filename) → resolved by {A004.§2.AC.04}: keep `verification.json`.
- {R009.OQ.02} (event identifier shape) → resolved by {A004.§2.AC.05}: cuid2 per event, present in MVS schema.
- {R009.OQ.03} (re-ingest atomicity) → resolved by {A004.§3.AC.03}: incremental, one event per token added or retracted.
- {R009.OQ.04} (note-scoped destructive ops on removed claims) → deferred with phase-1; default skip per {R009.§2.AC.12}.
- A004 OQs (compaction algorithm, concurrent-write mechanism, watch-mode integration) → resolved by {A004.§8} (algorithm: fold-then-synthesize-minimal-sequence; lock: file-level via `proper-lockfile`; watch: chokidar via filesystem adapter). DD-level decisions on library choice and lock-file placement are settled in §11 Open Questions below.

---

## §2 Primitive Preconditions

Every primitive the DD's body references at PRESENT/ABSENT granularity. Reviewers verify this section first; any EXTEND/MODIFY/@implements target in the body that is missing here is a conformance failure.

| Primitive | Source Citation | Status |
|-----------|----------------|--------|
| `VerificationEvent` interface | `core/src/claims/verification-store.ts:28-33` | PRESENT — replaced by `MetadataEvent` per {A004.§2.AC.01} |
| `VerificationStore` type | `core/src/claims/verification-store.ts:39` | PRESENT — replaced by `MetadataStore` per {A004.§2.AC.02} |
| `loadVerificationStore` function | `core/src/claims/verification-store.ts:58` | PRESENT — DELETED with the file; legacy data is migrated by the one-shot `meta migrate-legacy` command per §DC.19 |
| `saveVerificationStore` function | `core/src/claims/verification-store.ts:91` | PRESENT — DELETED; replaced by `FilesystemMetadataStorage.save` |
| `addVerificationEvent` function | `core/src/claims/verification-store.ts:105` | PRESENT — DELETED; replaced by `metadataStorage.append({op:"add", key:"verified", ...})` |
| `getLatestVerification` function | `core/src/claims/verification-store.ts:121` | PRESENT — DELETED; replaced by `metadataStorage.query({claimId, key:"verified"}).pop()` projection per {A004.§4.AC.02} |
| `removeLatestVerification` function | `core/src/claims/verification-store.ts:139` | PRESENT — DELETED; the asymmetric log-level-pop semantic is dropped along with `verify --remove --all`. New `verify --remove` appends an `unset` event (state-level wipe) per §DC.60 |
| `removeAllVerifications` function | `core/src/claims/verification-store.ts:161` | PRESENT — DELETED; subsumed by the new `verify --remove` semantic (single state-level wipe) per §DC.60 |
| Legacy `timestamp` → `date` normalization | `core/src/claims/verification-store.ts:64-71` | PRESENT — re-implemented inline inside the one-shot `meta migrate-legacy` command per §DC.19 |
| `VerificationStorage` interface | `core/src/storage/storage-backend.ts:87-90` | PRESENT — replaced by `MetadataStorage` per {A004.§2.AC.03} |
| `FilesystemVerificationStorage` class | `core/src/storage/filesystem/filesystem-verification-storage.ts:18` | PRESENT — DELETED per {A004.§2.AC.03} (no parallel coexistence); replaced by `FilesystemMetadataStorage` |
| `FilesystemVerificationStorage` test file | `core/src/storage/filesystem/filesystem-verification-storage.test.ts` | PRESENT — DELETED alongside the adapter |
| `ProjectManager.verificationStorage` field | `core/src/project/project-manager.ts:84` (declaration), `:103` (constructor assignment) | PRESENT — RENAMED to `metadataStorage` per {A004.§2.AC.03} |
| `ProjectManagerDependencies.verificationStorage` slot | `core/src/project/project-manager.ts:47` | PRESENT — RENAMED to `metadataStorage` |
| `createFilesystemProject` factory | `core/src/storage/filesystem/create-filesystem-project.ts:23,180,193` (verificationStorage construction) | PRESENT — MODIFIED to construct `FilesystemMetadataStorage` |
| `:removed` lifecycle rejection | `core/src/cli/commands/claims/verify-command.ts:97` | PRESENT — preserved at the new write path; rule moves to `metadata-write-guards.ts` per §3 |
| Metadata suffix regex tolerating `=` | `core/src/parsers/claim/claim-parser.ts:119` (regex `/^[A-Za-z0-9=_.§-]+$/`) | PRESENT — unchanged; existing tokens flow into the suffix-grammar ingest |
| `parseClaimMetadata` function | `core/src/claims/claim-metadata.ts:124` | PRESENT — UNCHANGED in shape; reimplemented per §4 below as a thin reconstruction over `metadataStorage.fold(claimId)` |
| `ParsedMetadata` interface | `core/src/claims/claim-metadata.ts:43-48` | PRESENT — UNCHANGED; the lossless-normalization invariant ({A004.§3.AC.02}) preserves its shape |
| `LifecycleState`, `LifecycleType`, `LIFECYCLE_TAGS` | `core/src/claims/claim-metadata.ts:24-63` | PRESENT — UNCHANGED |
| `computeStaleness` function | `core/src/claims/staleness.ts:75` | PRESENT — MODIFIED per §4 to read `metadataStorage.fold(claimId)["verified"]` instead of `getLatestVerification(store, claimId)` |
| `formatTraceabilityMatrix`, `formatIndexSummary` (claim-formatter consumers) | `core/src/cli/formatters/claim-formatter.ts:121,189,343,490,841` | PRESENT — MODIFIED per §4 to gain key-access path; legacy verification rendering routed through fold projection |
| `verify-command.ts` `verifyCommand` | `core/src/cli/commands/claims/verify-command.ts:48` | PRESENT — REWIRED per §DC.60-§DC.64 as a thin alias to `meta` writes; legacy `--method` and `--remove --all` flags REMOVED |
| Trace command verification reads | `core/src/cli/commands/claims/trace-command.ts:200,250,302,356` | PRESENT — MODIFIED per §4 |
| Gaps command verification reads | `core/src/cli/commands/claims/gaps-command.ts:108,112,137` | PRESENT — MODIFIED per §4; gains `--where`/`--has-key`/`--missing-key` |
| Stale command verification load | `core/src/cli/commands/claims/stale-command.ts:39` | PRESENT — MODIFIED per §4 |
| Thread command verification load | `core/src/cli/commands/claims/thread-command.ts:53` | PRESENT — MODIFIED per §4 |
| Index command verification load | `core/src/cli/commands/claims/index-command.ts:28` | PRESENT — MODIFIED per §4 |
| Search command verification load | `core/src/cli/commands/context/search.ts:191,194` | PRESENT — MODIFIED per §4; search trace blocks gain `--where`/`--has-key`/`--missing-key` |
| Show-handler verification load | `core/src/cli/commands/context/show-handler.ts:188` | PRESENT — MODIFIED per §4 |
| `claims/index.ts` barrel | `core/src/claims/index.ts:44-56` | PRESENT — MODIFIED per §3 to export new metadata types; legacy `VerificationEvent`/`VerificationStore`/`getLatestVerification` re-exports REMOVED |
| Top-level package barrel | `core/src/index.ts:22,40,96-101,139-140` | PRESENT — MODIFIED per §DC.54b; legacy verification-store re-exports REMOVED |
| `claim-thread.ts` verification-store consumer | `core/src/claims/claim-thread.ts:15,70,91,101,119,146,268-269` | PRESENT — MODIFIED per §DC.54a to read via `metadataStorage.query` |
| `BaseCommand.setup` ProjectManager initialization | `core/src/cli/commands/base-command.ts` | PRESENT — UNCHANGED in shape; the factory it calls now wires `metadataStorage` |
| `claims meta` subcommand group | (none) | ABSENT — requires this DD (§3 §DC.20-§DC.27 author the new commands) |
| `claims meta migrate-legacy` one-shot command | (none) | ABSENT — authored by this DD (§DC.19) |
| `MetadataEvent` type | (none) | ABSENT — authored by this DD (§3 §DC.01-§DC.07) |
| `MetadataStorage` interface | (none) | ABSENT — authored by this DD (§3 §DC.10-§DC.12) |
| `FilesystemMetadataStorage` class | (none) | ABSENT — authored by this DD (§3 §DC.13-§DC.18) |
| `MetadataIngest` (suffix-grammar normalizer) | (none) | ABSENT — authored by this DD (§3 §DC.28-§DC.34) |
| `proper-lockfile` dependency | `package.json` (not present) | ABSENT — added per §11 OQ.01 (file-level lock library) |
| `@paralleldrive/cuid2` dependency | `package.json` (not present) | ABSENT — added per {A004.§2.AC.05} |
| Storage filesystem barrel | `core/src/storage/filesystem/index.ts` | PRESENT — MODIFIED to export `FilesystemMetadataStorage` and remove the legacy `FilesystemVerificationStorage` export (scope expansion discovered during implementation; not in original §3 inventory) |
| `createFilesystemProject` factory test | `core/src/storage/filesystem/create-filesystem-project.test.ts` | PRESENT — MODIFIED to assert `pm.metadataStorage` is wired (replacing legacy `verificationStorage` assertions); validates §DC.45 + §DC.47 round-trip through the factory |
| Staleness test suite | `core/src/claims/__tests__/staleness.test.ts` | PRESENT — MODIFIED to construct in-memory `MetadataStorage` instances for `computeStaleness` (replacing legacy `VerificationStore` map literals); covers §DC.49 signature change |
| Claim-thread test suite | `core/src/claims/__tests__/claim-thread.test.ts` | PRESENT — MODIFIED to thread `MetadataStorage` through `BuildClaimThreadContext` (replacing legacy `verificationStore` parameter); covers §DC.54a migration |

**Halt rule check:** Every ABSENT entry is authored by this DD itself. No companion DD or external deferral is required. The dependency additions (`proper-lockfile`, `@paralleldrive/cuid2`) are routine package additions, not architectural primitives requiring a separate DD. The four scope-expansion entries above were discovered during implementation: the filesystem barrel export and the three test files all required edits to keep the codebase compiling and the test suite passing once the legacy types were removed. They follow mechanically from §DC.10, §DC.45, §DC.47, §DC.49, §DC.54a and do not introduce new contracts.

---

## §3 Module Inventory

The Phase-1 plan touches four logical layers: (1) new types, (2) new storage interface and adapter, (3) new ingest path, (4) consumer migration. Each module is listed with its file, primary types/functions, and the DC numbers that own its specification.

### Phase 1A: Type and Interface Definitions

#### `core/src/claims/metadata-event.ts` (NEW)

The wire/storage/in-memory shape for events. Lives in `claims/` (not `storage/`) because its semantics are claim-system-level; the storage layer just persists events.

§DC.01:5:derives=A004.§2.AC.01 The `MetadataEvent` interface MUST have exactly the eight fields defined in {A004.§2.AC.01}: `id: string`, `claimId: string`, `key: string`, `value: string`, `op: "add" | "set" | "unset" | "retract"`, `actor: string`, `date: string`, `note?: string`. No additional fields, no removed fields. This is the wire format, the storage format, and the in-memory format. Highest binding: every reader, writer, migration, ingest path, and consumer depends on this exact shape.

§DC.02:derives=R009.§1.AC.01 The `id` field MUST be a 24-character cuid2 string generated at append time via `@paralleldrive/cuid2`'s `createId()`. cuid2 is collision-resistant and URL-safe but explicitly NOT time-sortable; per {A004.§2.AC.05} the system orders events by their position in the per-claim event array, not by ID, so the lack of lexicographic time-sortability is not load-bearing. The schema includes the field even though `revert` (its primary consumer) is deferred to a later phase.

§DC.03:derives=R009.§1.AC.01 The `claimId` field MUST be a fully qualified claim ID string in the form `NOTEID.§N.PREFIX.NN` (e.g., `R009.§1.AC.01`). The DD does not constrain the canonical form of the `§` symbol — both `R009.§1.AC.01` and `R009.1.AC.01` are accepted by the existing parser; the field stores whichever form was passed in. Consumers that need normalized comparison MUST normalize via the existing `normalizeSectionSymbol` function from `core/src/parsers/claim/claim-parser.ts:85`.

§DC.04:derives=R009.§1.AC.03 The `key` field MUST be a string matching `/^[a-z][a-z0-9._-]*$/`. The pattern is enforced at write time by the `MetadataIngest` (§DC.28) and at command boundaries by the `meta` write commands (§DC.20-§DC.24). No runtime validation in the storage layer itself — the layer accepts whatever it is given; validation is the caller's responsibility.

§DC.05:derives=R009.§1.AC.04 The `value` field MUST be the empty string `""` if and only if `op === "unset"`. For all other ops the value MUST be non-empty. The invariant is enforced at the same boundaries as §DC.04.

§DC.06:derives=R009.§1.AC.01 The `op` field MUST be one of the four string literals `"add"`, `"set"`, `"unset"`, `"retract"`. The closed vocabulary is what makes the fold rule (§DC.08) finite. Per {A004.§1.AC.02}, no additional ops are permitted.

§DC.07:derives=A004.§1.AC.04 The `actor` field MUST be a string. Implicit events from the suffix-grammar ingest MUST set `actor` to `author:<notepath>` where `<notepath>` is the project-root-relative path of the note file. CLI events MUST NOT use the `author:` prefix. The storage layer does not enforce this prefix discipline; the ingest layer (§DC.28-§DC.34) and the CLI write commands (§DC.20-§DC.24) are responsible.

`core/src/claims/metadata-event.ts` also exports the `MetadataStore` type alias and the `EventFilter` query shape:

§DC.08:derives=A004.§1.AC.03 `MetadataStore` MUST be defined as `Record<string, MetadataEvent[]>` (claimId → events in chronological order). The `fold(claimId)` function (§DC.11) takes this shape and produces `Record<string, string[]>` per the rule:

| Op | Effect on `values[]` for that key |
|----|-----------------------------------|
| `add value` | Append `value` if not present (idempotent at view level; both events still in log) |
| `set value` | Clear `values[]`, then append `value` (atomic) |
| `unset` | Clear `values[]` (event's `value` field MUST be `""`) |
| `retract value` | Remove `value` from `values[]` if present; no-op if absent |

The fold MUST be deterministic: same event sequence → same folded state, in every implementation. Keys with empty `values[]` after fold MUST NOT appear in the result.

§DC.09:derives=R009.§3.AC.07 `EventFilter` MUST be defined per {A004.§2.AC.02}: `{ claimId?, key?, actor?, op?, since?, until? }` with all fields optional. The Phase-1 implementation supports at least `claimId` and `key`; the others (actor/op/since/until) are required by Phase-2 `log` filters but their type signature is part of Phase-1 to avoid a non-breaking-change shuffle later.

§DC.09a:4:derives=A004.§1.AC.03 `metadata-event.ts` MUST also export a pure function `applyFold(events: MetadataEvent[]): Record<string, string[]>` implementing the rule table in §DC.08. The function takes a chronologically-ordered event array for a single claim and returns the folded state for that claim (keys with empty `values[]` excluded). `FilesystemMetadataStorage.fold(claimId)` (§DC.11) is a thin delegate: load the store, look up `store[claimId] ?? []`, pass to `applyFold`, return. The function lives in the type module (not the storage module) so the fold rule is testable in isolation without any storage mock — every implementation of `MetadataStorage.fold` MUST produce the same output as `applyFold` for the same input event sequence. High binding: this is the canonical fold and the only place the rule's mechanics live.

#### `core/src/storage/storage-backend.ts` (MODIFY)

§DC.10:5:derives=A004.§2.AC.03 The `VerificationStorage` interface (lines 87-90) MUST be REMOVED. Its replacement `MetadataStorage` MUST be added in the same file. The two interfaces MUST NOT coexist. This is a hard boundary: parallel coexistence creates two stores that drift, defeating the unification purpose. Highest binding: every storage consumer in the codebase imports from this file.

§DC.11:5:derives=A004.§2.AC.02 The `MetadataStorage` interface MUST define exactly six methods:

```
load(): Promise<MetadataStore>
save(store: MetadataStore): Promise<void>
append(event: MetadataEvent): Promise<void>
query(filter: EventFilter): Promise<MetadataEvent[]>
fold(claimId: string): Promise<Record<string, string[]>>
watch?(callback: (event: StorageEvent) => void): Unsubscribe
```

All non-watch methods return `Promise` per {A002.§2.AC.06} preserved by {A004.§2.AC.06}. `watch?` is optional, matching the existing `NoteStorage.watch?` shape ({A002}). Highest binding: every consumer of the metadata store reaches it through one of these six methods; their union is the entire surface area.

§DC.12:derives=A004.§2.AC.02 The `MetadataStorage` interface MUST import `StorageEvent` and `Unsubscribe` from `./storage-types` and `MetadataEvent`, `MetadataStore`, `EventFilter` from `../claims/metadata-event`. The legacy `import type { VerificationStore } from '../claims/verification-store'` (line 15) MUST be REMOVED.

#### `core/src/claims/index.ts` (MODIFY)

§DC.13:derives=A004.§2.AC.03 The barrel MUST add re-exports for `MetadataEvent`, `MetadataStore`, `EventFilter` from `./metadata-event`. The legacy re-exports of `loadVerificationStore`, `saveVerificationStore`, `addVerificationEvent`, `getLatestVerification`, `removeLatestVerification`, `removeAllVerifications`, `VerificationEvent`, and `VerificationStore` from `./verification-store` (lines 44-56) MUST be REMOVED. Consumers that imported any of these get a compile error and must migrate to the new surface — that's the intent of {A004.§2.AC.03}'s "MUST NOT coexist" rule.

### Phase 1B: Filesystem Adapter and Migration

#### `core/src/storage/filesystem/filesystem-metadata-storage.ts` (NEW)

§DC.14:5:derives=A004.§2.AC.04 `FilesystemMetadataStorage` MUST implement `MetadataStorage` and persist to `_scepter/verification.json` (filename preserved). The class lives in `storage/filesystem/` alongside the other adapters per the {A002}/{DD010} composition pattern. Highest binding: this is the canonical storage adapter; renaming the file or changing the persistence path breaks every existing project.

§DC.15:derives=A004.§2.AC.04 The adapter constructor MUST accept a single `dataDir: string` parameter (the project's `_scepter` path). The constructor MUST NOT touch the filesystem; first I/O happens on the first `load()` or `append()` call.

§DC.16:derives=R009.§1.AC.10 `load()` MUST read `verification.json` from `dataDir`, parse JSON, and return a `MetadataStore`. If the file does not exist, return `{}`. If the file exists but contains data in the legacy `VerificationEvent` shape (events with no `op` field), `load()` MUST throw a clear error directing the user to run `scepter claims meta migrate-legacy` (the one-shot migration command per §DC.19). `load()` does NOT silently auto-migrate — the legacy shape is the user's data and the migration is a single-direction transform that the user invokes explicitly.

§DC.17:derives=R009.§1.AC.10 `save(store)` MUST write the entire store to `verification.json` as JSON with 2-space indentation (matching the existing `saveVerificationStore` formatting at `core/src/claims/verification-store.ts:96`). The save path MUST acquire a file lock per §DC.36 before opening for write and MUST release the lock before returning.

§DC.18:5:derives=R009.§1.AC.12 `append(event)` MUST be durable: after the call resolves, a subsequent `load()` in a new process MUST see the event. The implementation MUST: (a) acquire the file lock; (b) re-load the current on-disk store (to pick up any external writes); (c) push the event onto the appropriate `claimId` array; (d) write the entire store back; (e) release the lock. The implementation MAY NOT cache an in-memory store across calls — every `append()` is a load-modify-write cycle. (This is conservative for Phase 1; an in-memory cache with invalidation is a Phase-2 optimization.) Highest binding: this is the load-modify-write cycle that backs every durability guarantee.

§DC.19:5:derives=R009.§7.AC.01 A new one-shot CLI command `scepter claims meta migrate-legacy` MUST live at `core/src/cli/commands/claims/meta/migrate-legacy-command.ts`. Invocation reads the existing legacy-shape `verification.json`, projects each legacy event to a `MetadataEvent`, writes the resulting store to disk, and exits. The projection per legacy event:

- `id` = freshly generated cuid2
- `claimId` = legacy `claimId` verbatim
- `key` = `"verified"` (constant)
- `value` = `"true"` (constant)
- `op` = `"add"` (constant)
- `actor` = legacy `actor` verbatim (no `author:` prefix — these are CLI-written events from the legacy verify command)
- `date` = legacy `date`, or the normalized form of legacy `timestamp` per the rule at `core/src/claims/verification-store.ts:64-71` (re-implemented inline in the migration command since `verification-store.ts` is deleted in Step 6)
- `note` = legacy `method` if present, prefixed with `"method="` to align with the new `verify --note` convention (e.g., legacy `method: "manual"` becomes `note: "method=manual"`). Legacy events without `method` get no `note`.

The command MUST be idempotent in the sense that running it on an already-migrated file (events already have `op` set) is a no-op with a clear message. Running on a missing file is a no-op with a clear message. Running on a file with mixed legacy and new events MUST refuse to proceed and exit with a clear error — that state is not expected and the user should resolve manually.

Highest binding: this is the single sanctioned migration path. There is NO load-time auto-migration (§DC.16); the user runs this command once, on their schedule. The author's own project is the only known holder of legacy data, so the conservative single-shot path is sufficient.

#### `core/src/storage/filesystem/filesystem-verification-storage.ts` (DELETE)

§DC.20:derives=A004.§2.AC.03 The file MUST be deleted. Its 28-line content is fully subsumed by `FilesystemMetadataStorage`. The companion test file `filesystem-verification-storage.test.ts` MUST also be deleted.

#### `core/src/claims/verification-store.ts` (DELETE)

§DC.21:derives=A004.§2.AC.03 The file MUST be deleted. Its types (`VerificationEvent`, `VerificationStore`) and functions (`loadVerificationStore`, `saveVerificationStore`, `addVerificationEvent`, `getLatestVerification`, `removeLatestVerification`, `removeAllVerifications`) are fully replaced by `MetadataEvent`, `MetadataStore`, `metadataStorage.append`, and the fold projection per §DC.40-§DC.42. The legacy `timestamp → date` normalization at `core/src/claims/verification-store.ts:64-71` MUST be re-implemented inside `FilesystemMetadataStorage.load` per §DC.16 — the file goes away, the precedent doesn't.

The companion test file `core/src/claims/__tests__/verification-store.test.ts` MUST also be deleted.

#### `package.json` (MODIFY)

§DC.22:derives=A004.§2.AC.05 Add `@paralleldrive/cuid2` (^2.x) to `dependencies`. The library exposes a `createId()` function that returns a 24-character cuid2 string.

§DC.23:derives=A004.§1.AC.06 Add `proper-lockfile` (^4.x) to `dependencies`. See §11 OQ.01 for the library choice rationale.

### Phase 1C: CLI Write Path — `meta` Subcommand Group

The `meta` subcommand group's source files live under `core/src/cli/commands/claims/meta/` (alongside the other claim-system commands), but the command itself is registered at the top level of the CLI. Per DD006, SCEpter's CLI does not have a `claimsCommand` parent group — `verify`, `trace`, `gaps`, etc. are top-level commands with backward-compatibility aliases for the legacy `claims/...` paths. `meta` follows the same convention: invocation is `scepter meta add ...`, not `scepter claims meta add ...`.

#### `core/src/cli/commands/claims/meta/index.ts` (NEW)

§DC.24:derives=R009.§2.AC.01 The barrel MUST export a `metaCommand` Commander subcommand with description "Read and write claim metadata" and seven child subcommands wired up: `add`, `set`, `unset`, `clear` (writes), `get`, `log` (reads), and `migrate-legacy` (one-shot migration). The barrel registers the parent command at the top level of the CLI program (`program.addCommand(metaCommand)` at `core/src/cli/index.ts`). There is no `claimsCommand` parent group — DD006 established that claim-system commands are top-level. File-system colocation under `commands/claims/meta/` is for source organization only; runtime invocation is `scepter meta <subcmd>`.

#### `core/src/cli/commands/claims/meta/add-command.ts` (NEW)

§DC.25:4:derives=R009.§2.AC.01 The `add` command MUST accept `<claim>` (positional, required) and one or more `KEY=VALUE` pairs (variadic, required, at least one). It MUST accept `--actor <name>` (default: OS username via `os.userInfo().username`, fallback `"cli"` matching the existing precedent at `core/src/cli/commands/claims/verify-command.ts:40-46`), `--date <ISO-8601>` (default: now as a full ISO 8601 datetime; the option accepts either a date `YYYY-MM-DD` (treated as start-of-day UTC) or a full datetime), and `--note <text>` (optional). For each parsed `KEY=VALUE` it MUST call `metadataStorage.append({op: "add", key, value, actor, date, claimId, note, id: createId()})` (where `createId` comes from `@paralleldrive/cuid2`). High binding: this is the primary write entry point and the suffix-grammar ingest funnels through it.

§DC.26:derives=R009.§2.AC.07 Before recording any events, the command MUST validate every KEY in the argument list against `/^[a-z][a-z0-9._-]*$/`. If any KEY fails validation, the command MUST exit with non-zero status, print the offending KEY and pattern, and record NO events (atomic across the argument list).

§DC.27:derives=R009.§2.AC.08 The command MUST resolve the claim ID against the claim index (via the existing `ensureIndex` pattern at `core/src/cli/commands/claims/ensure-index.ts`). If the ID does not resolve, MUST print the unresolved ID with up-to-5 fuzzy-match suggestions (using the same suffix-tail pattern as `verify-command.ts:84-92`) and exit with non-zero status. NO events are recorded.

§DC.28:derives=R009.§2.AC.09 The command MUST reject claim IDs whose lifecycle is `:removed`, mirroring the existing rule at `core/src/cli/commands/claims/verify-command.ts:97`. The check is implemented identically: read `entry.lifecycle?.type === 'removed'` from the claim index entry. Print "Cannot write metadata to claim X: claim is tagged :removed." and exit with non-zero status. NO events are recorded.

The remaining write commands (`set`, `unset`, `clear`) follow the same shape; per-command DCs:

#### `core/src/cli/commands/claims/meta/set-command.ts` (NEW)

§DC.29:4:derives=R009.§2.AC.02 The `set` command MUST accept the same arguments and options as `add`. For each parsed `KEY=VALUE` it MUST call `metadataStorage.append({op: "set", key, value, ...})`. The fold rule (§DC.08) ensures atomic replace: at the point of the `set` event, prior values for the key are cleared and the new value is recorded as the only current value. KEY validation, claim resolution, and `:removed` rejection rules per §DC.26-§DC.28 apply identically.

#### `core/src/cli/commands/claims/meta/unset-command.ts` (NEW)

§DC.30:derives=R009.§2.AC.04 The `unset` command MUST accept `<claim>` and one or more bare `KEY` arguments (no `=VALUE`). For each KEY it MUST call `metadataStorage.append({op: "unset", key, value: "", ...})`. The KEY validation, resolution, and `:removed` rejection rules per §DC.26-§DC.28 apply identically. Bare-key parsing (rejecting `=` in arguments to `unset`) MUST happen at the Commander argument-parse layer.

#### `core/src/cli/commands/claims/meta/clear-command.ts` (NEW)

§DC.31:derives=R009.§2.AC.05 The `clear` command MUST accept `<claim>` only (no key arguments). It MUST call `metadataStorage.fold(claimId)` to discover all keys with current values, then call `metadataStorage.append({op: "unset", key, value: "", ...})` once per such key. If the fold produces an empty record, the command MUST print "No metadata to clear." and exit with status 0 (no events recorded). The resolution and `:removed` rejection rules per §DC.27-§DC.28 apply.

#### `core/src/cli/commands/claims/meta/get-command.ts` (NEW)

§DC.32:derives=R009.§3.AC.01 The `get` command MUST accept `<claim>` (required) and an optional `[key]` second positional. With no key, it MUST print every `(key, values)` pair from the fold. Single-value keys render as `key: value`; multi-value keys render as `key: [v1, v2, ...]`. With a key, it prints only the values for that key, one per line.

§DC.33:derives=R009.§3.AC.02 If the named key has no current values, the command MUST exit with non-zero status and print no values (an explicit empty marker is acceptable; the contract is "scriptable distinguishability between empty and missing"). Without the key argument, an empty fold prints nothing (status 0) — empty metadata is not an error condition.

§DC.34:derives=R009.§3.AC.04 With `--json`, the command MUST emit `{state: Record<string, string[]>}` for the no-key case and `{values: string[]}` for the key case. Non-zero exit on key-not-found is preserved with `--json` (the JSON document is still emitted; exit status carries the missing-key signal).

#### `core/src/cli/commands/claims/meta/log-command.ts` (NEW)

§DC.35:derives=R009.§3.AC.06 The `log` command MUST accept `<claim>` (required) and emit the chronological event log for that claim. Each line MUST include op, key, value (omitted for `unset`), actor, date, and note (if present). Events are read via `metadataStorage.query({claimId})` (no other filters in Phase 1; the {EventFilter} type carries the rest for Phase 2). With `--json`, emit a JSON array of `MetadataEvent` objects per {R009.§3.AC.08}. Phase-2 filters (`--key`, `--actor`, `--since`, `--until`, `--op` per {R009.§3.AC.07}) are not implemented here; the command MUST expose only the `claimId` filter and `--json`.

### Phase 1D: Concurrent-Write Lock

§DC.36:derives=A004.§1.AC.06 The filesystem adapter MUST acquire an exclusive lock before every write (`save` and `append`). The lock is acquired via `proper-lockfile` against the lock file path `<dataDir>/verification.json.lock` (sidecar lock file, not the JSON file itself, so the file's existence is not gated on contention). The acquire timeout MUST default to 2000ms and MUST be configurable via the `MetadataStorage` constructor for testing. On timeout, the operation MUST throw a clear error naming the conflicting lock (the library returns the holder's PID when known) and the operation MUST NOT silently retry or queue.

§DC.37:derives=A004.§1.AC.06 Reads (`load`, `query`, `fold`) MUST NOT acquire the lock. The append-only invariant ({A004.§1.AC.01}) plus atomic full-file rewrites at save time guarantee that any partially-flushed write is either fully visible or fully absent at the JSON-document boundary. Concurrent reads against an in-flight writer see one or the other, never a torn state.

### Phase 1E: Suffix-Grammar Ingest Reconciliation

The ingest path is what makes R005-era inline metadata (`AC.01:5:closed:reviewer=alice`) flow into the new event log. Two ingest grammars produce events ({A004.§3}); this section authors the suffix-grammar half. The CLI grammar half is the `meta` write commands (§DC.24-§DC.31).

#### `core/src/claims/metadata-ingest.ts` (NEW)

§DC.38:4:derives=A004.§3.AC.01 The `MetadataIngest` module MUST expose a function `reconcileNoteEvents(noteId, claimEntries, store)` that, for one note, produces a list of `MetadataEvent`s representing the deltas between the author's current declarations (in the `claimEntries`) and the existing `author:` events in the store. The function returns `{toAppend: MetadataEvent[], toRetract: MetadataEvent[]}`. The caller is responsible for invoking `metadataStorage.append` for each event in the result. High binding: this is the canonical ingest-time reconciliation; every implementation difference produces invisible drift between author intent and persisted state.

§DC.39:5:derives=A004.§3.AC.02 The bare-token shorthand normalization rules per {A004.§3.AC.02} MUST be applied losslessly inside `reconcileNoteEvents`:

| Suffix token | Generated event(s) |
|--------------|---------------------|
| `:5` (digit 1-5) | `key="importance"`, `value="5"` |
| `:closed` | `key="lifecycle"`, `value="closed"` |
| `:deferred` | `key="lifecycle"`, `value="deferred"` |
| `:removed` | `key="lifecycle"`, `value="removed"` |
| `:superseded=TARGET` | TWO events: `key="lifecycle", value="superseded"` AND `key="supersededBy", value=TARGET` |
| `:derives=TARGET` | `key="derives"`, `value=TARGET` |
| `:freeform` (digit-less, no `=`) | `key="tag"`, `value="freeform"` |
| `:KEY=VALUE` (general k=v) | `key=KEY`, `value=VALUE` |

Highest binding: this is the table that makes back-compat work. Every normalization is reversed by the projection in §DC.42, restoring the legacy `ParsedMetadata` shape.

§DC.40:derives=A004.§3.AC.01 Every emitted event MUST set `op="add"`, `actor="author:<notepath>"` (relative to project root), `date=<note file mtime as ISO 8601 datetime>`, and `note="inline"`. The `id` is a freshly-generated cuid2 per event.

§DC.41:derives=A004.§3.AC.03 Reconciliation MUST be incremental at the token level. For each `(claimId, key, value)` declared by the author in the current parse:
- If a matching `author:` event already exists in the store and its current folded state still contains the value, emit nothing (idempotent — §DC.42 invariant).
- If the value is missing from the current folded state, emit an `add` event.

For each `(claimId, key, value)` event currently in the store with an `author:<this notepath>` actor:
- If the corresponding token is no longer in the author's declarations, emit a `retract` event (the author removed it).

Compound reconciliation events (one event per claim summarizing the delta) MUST NOT be used — every change is per-token. The verbosity cost is acceptable; `compact` (Phase 2) handles size growth.

§DC.42:derives=A004.§3.AC.04 Re-ingest of unchanged tokens MUST be a no-op. If a token is present in the suffix and the author's existing events for that `(claimId, key, value)` triple already produce the value in the folded state, no new event is emitted. This prevents log churn on every index rebuild for unchanged source files. Combined with §DC.41's idempotence, this means the steady-state cost of repeated index builds is zero events.

§DC.43:derives=A004.§3.AC.04 Reconciliation operates ONLY on events with the `author:` prefix in their actor field. CLI-written events (no prefix) MUST NOT be touched by reconciliation — they live independently. This is what allows author edits and CLI writes to coexist on the same key (Scenario 2 in {A004.§7}).

#### `core/src/claims/claim-index.ts` (MODIFY)

§DC.44:derives=A004.§3.AC.01 At the end of each claim-index build, after all notes are parsed and all `(claimId, suffixTokens)` pairs are known, the index builder MUST invoke `reconcileNoteEvents` for each note and append the resulting events to `metadataStorage`. The hook point is a new method `applyAuthorDeltas(metadataStorage)` on `ClaimIndex` which the caller invokes after `build()`. The actual call site is the `ensureIndex` pipeline at `core/src/cli/commands/claims/ensure-index.ts:101` (not `ProjectManager.initialize()`); every CLI command that needs the claim index goes through `ensureIndex`, so wiring the deltas there ensures author tokens are committed on every reindex without coupling them to construction. The index itself does not write events directly; it produces the planned deltas and the caller commits them. This separation enables the `--dry-run` semantics that future Phase-2 commands need.

### Phase 1F: Composition Root and Consumer Migration

#### `core/src/project/project-manager.ts` (MODIFY)

§DC.45:5:derives=A004.§2.AC.03 The `ProjectManager.verificationStorage` field (line 84) MUST be RENAMED to `metadataStorage` with type `MetadataStorage`. The `ProjectManagerDependencies.verificationStorage` slot (line 47) MUST be RENAMED identically. The constructor assignment (line 103) follows. Highest binding: this rename ripples through every consumer; all 8 known call sites (per §DC.46-§DC.53) MUST update in lockstep.

§DC.46:derives=A004.§2.AC.03 The legacy `import type { VerificationStorage } from '../storage'` (current line 19 area) MUST be REPLACED with `import type { MetadataStorage } from '../storage'`. The `../storage` barrel (`core/src/storage/index.ts`) MUST be updated to export `MetadataStorage` and remove the `VerificationStorage` export.

#### `core/src/storage/filesystem/create-filesystem-project.ts` (MODIFY)

§DC.47:derives=A004.§2.AC.03 The factory MUST construct `FilesystemMetadataStorage` (not `FilesystemVerificationStorage`) at line 180 and pass it as `metadataStorage` (not `verificationStorage`) at line 193. The import at line 23 MUST be updated. The factory body remains otherwise unchanged — the dataDir computation is identical.

#### Consumer migration table

Each of the following call sites currently reads `projectManager.verificationStorage!.load()` and uses `getLatestVerification`. After this DD, they read `projectManager.metadataStorage!` and project to the legacy shape via fold. The mechanical change is:

```
// Before:
const store = await projectManager.verificationStorage!.load();
const latest = getLatestVerification(store, claimId);
const lastVerifiedDate = latest?.date;

// After:
const folded = await projectManager.metadataStorage!.fold(claimId);
const verifiedValues = folded["verified"] ?? [];
// For staleness/display: derive the latest "verified=true" event's date by querying the log
const verifiedEvents = await projectManager.metadataStorage!.query({claimId, key: "verified"});
const latestVerifiedEvent = verifiedEvents[verifiedEvents.length - 1];
const lastVerifiedDate = latestVerifiedEvent?.date;
```

The `query` call replaces the in-memory array indexing the legacy code did. For consumers that only need "is this claim verified?" the simpler `folded["verified"]?.includes("true")` check suffices.

§DC.48:derives=A004.§4.AC.02 `core/src/cli/commands/claims/stale-command.ts:39` MUST be updated to call `metadataStorage.query({key: "verified"})` (or equivalent) and pass the result into `computeStaleness`. The `computeStaleness` signature in `core/src/claims/staleness.ts:75` MUST be updated per §DC.49.

§DC.49:derives=A004.§4.AC.02 `core/src/claims/staleness.ts:75` `computeStaleness(index, store, options)` MUST be updated to take a `MetadataStorage` instance (not a `VerificationStore` object) and call `await metadataStorage.query({claimId: fullyQualified, key: "verified"})` per claim. The latest-event derivation at line 131 MUST be replaced with the equivalent fold-derived form. The R005 §4 ACs (staleness three-way status, mtime comparison, no-Source claims excluded) remain unchanged in semantics.

§DC.50:derives=A004.§4.AC.04 `core/src/cli/formatters/claim-formatter.ts` MUST be updated at every call site that currently takes `verificationStore?: VerificationStore` (lines 121, 189, 343, 490, 841). The parameter type MUST become `metadataStorage?: MetadataStorage` (or, for synchronous formatter contexts, a pre-folded `Record<string, Record<string, string[]>>` where the outer key is claimId and the inner is the fold). The renderer code at line 189 (`getLatestVerification(verificationStore, row.claimId)`) MUST become `metadataStorage.query({claimId: row.claimId, key: "verified"})` (or the pre-folded equivalent), then take the last element of the resulting array. The same applies at line 343.

§DC.51:derives=A004.§4.AC.04 `claim-formatter.ts` MUST gain a new function `formatMetadataKey(claim, key, folded)` that renders an arbitrary `(claim, key) → values[]` cell for use by future `--show-key` and `--group-by` formatter modes (Phase 2). For Phase 1, the function is exported but invoked only by `meta get` (§DC.32) — formal trace/gaps integration of arbitrary keys is via filter, not display.

§DC.52:derives=A004.§4.AC.02 `core/src/cli/commands/claims/trace-command.ts` MUST be updated at lines 200, 250, 302, 356. Line 200 (the load) becomes a metadataStorage reference. Lines 250, 302, 356 (the latest-verification reads) follow §DC.50's pattern.

§DC.53:derives=A004.§4.AC.02 `core/src/cli/commands/claims/gaps-command.ts` MUST be updated at lines 108, 112, 137 following the same pattern. The gaps command also gains the new `--where`, `--has-key`, `--missing-key` filters per §DC.55.

§DC.54:derives=A004.§4.AC.02 The remaining four consumer files MUST be updated identically: `thread-command.ts:53`, `index-command.ts:28`, `context/show-handler.ts:188`, `context/search.ts:191,194`.

§DC.54a:derives=A004.§4.AC.02 `core/src/claims/claim-thread.ts` MUST be migrated alongside `thread-command.ts`. The file currently imports `VerificationStore`, `VerificationEvent` (line 15) and threads a `verificationStore?: VerificationStore` parameter through `BuildClaimThreadContext` (line 70), `buildClaimThread` (line 91), `buildClaimThreadList` (line 119), the recursive call (line 146), and the verification-event read (lines 268-269). After this DD: imports change to `MetadataEvent` and the parameter becomes `metadataStorage?: MetadataStorage`. Line 269's `ctx.verificationStore[entry.fullyQualified]` becomes `await ctx.metadataStorage.query({claimId: entry.fullyQualified, key: "verified"})`. Without this DC the package-level `T-Imports` gate fails because the file imports from the deleted `verification-store`.

§DC.54b:derives=A004.§2.AC.03 `core/src/index.ts` (the top-level package barrel) MUST drop every legacy verification-store re-export: `VerificationStorage` (line 22), `FilesystemVerificationStorage` (line 40), `loadVerificationStore`, `saveVerificationStore`, `addVerificationEvent`, `getLatestVerification`, `removeLatestVerification`, `removeAllVerifications` (lines 96-101), and `VerificationEvent`, `VerificationStore` (lines 139-140). New exports `MetadataStorage`, `FilesystemMetadataStorage`, `MetadataEvent`, `MetadataStore`, `EventFilter` MUST be added in the corresponding sections. Without this DC external consumers of the published library surface still reach the deleted symbols and the `T-Imports` grep gate fails.

### Phase 1G: Filter Integration on `trace`/`search`/`gaps`

#### `core/src/cli/commands/claims/trace-command.ts`, `search.ts`, `gaps-command.ts` (MODIFY)

§DC.55:4:derives=R009.§5.AC.01 Each of `trace`, `search` (claim search subset), and `gaps` MUST accept three new repeatable options: `--where KEY=VALUE`, `--has-key KEY`, `--missing-key KEY`. The Commander argument definition uses `.option('--where <pair>', '...', collectFn, [])` to enable repeatability. KEY validation against `/^[a-z][a-z0-9._-]*$/` MUST occur at parse time. High binding: these flags are the primary affordance making the generalized store visible to existing claim commands.

§DC.56:derives=R009.§5.AC.06 The three new filters MUST compose with each other and with all existing filters (e.g., `--importance`, `--note-type`, `--note`, `--lifecycle`) using AND semantics. A claim is included only if it passes every filter. The filter implementation lives in a new utility `applyMetadataFilters(claims, metadataStorage, options): Promise<Claim[]>` in `core/src/claims/metadata-filters.ts` (new file).

§DC.57:derives=R009.§5.AC.05 The existing `--importance N` flag MUST continue to work unchanged at the user-facing level. Internally, after the suffix-grammar ingest (§DC.38-§DC.43) lands, the `importance` key in the folded state is the source of truth, and `--importance N` MAY be reimplemented as `--where importance=N`. Phase-1 keeps the legacy `--importance` codepath as a special case that reads `claim.importance` from the index entry; the entry itself is populated by the reconstruction in §DC.42 (importance derived from `folded["importance"][0]`). The two paths produce identical results because of the lossless invariant.

### Phase 1H: parseClaimMetadata Reconstruction

#### `core/src/claims/claim-metadata.ts` (MODIFY — internal only, public shape unchanged)

§DC.58:5:derives=A004.§4.AC.03 The `parseClaimMetadata(rawMetadata: string[]): ParsedMetadata` function (line 124) MUST continue to produce the exact same `ParsedMetadata` shape ({importance?, lifecycle?, tags[], derivedFrom[]}) for every input it accepts today. The function continues to operate on raw token strings — it does NOT take a `MetadataStorage` and does NOT call `fold`. This is a deliberate Phase-1 choice (see §11 OQ.02 alternative): `parseClaimMetadata` is invoked with raw tokens parsed off the heading or paragraph at index time, and its job is to interpret those tokens. It is the suffix-grammar ingest (§DC.38) that translates the same tokens into events; the two paths produce the same logical content through different in-memory shapes. This Phase-1 separation lets the reconstruction-via-fold path be added in Phase 2 without breaking the inline parser.

§DC.59:derives=A004.§3.AC.02 The lossless-normalization invariant ({A004.§3.AC.02}) MUST be enforced by a unit test that, for every legal suffix token form, asserts:

```
parseClaimMetadata(tokens) === reconstructFromFold(reconcileNoteEvents(...).toAppend.foldByKey())
```

where `reconstructFromFold` is a small helper inside the test file (not exported) that walks `Record<key, string[]>` and rebuilds `ParsedMetadata` per the inverse table of §DC.39. This test is the binding mechanical check on §DC.39 + §DC.58 agreement.

**Caveat — Source-coverage visibility for test-only DCs:** §DC.59 is realized as a `@validates` annotation in `core/src/claims/__tests__/claim-metadata.lossless.test.ts`. Whether this realization shows up as Source coverage in `scepter claims trace DD014` depends on the project's `sourceCodeIntegration.exclude` config. The dogfood project excludes `**/*.test.ts`, which means test-only DCs (and any other DC realized solely in test files) will appear with no Source column entry even when they are correctly validated. This is a configuration choice, not a coverage gap — verifying §DC.59 requires reading the test annotation directly, not relying on the trace matrix. The same caveat applies to any future DC whose only realization is `@validates` in a test file.

### Phase 1I: Verify CLI Rewiring (Thin Alias to `meta`)

#### `core/src/cli/commands/claims/verify-command.ts` (MODIFY)

The `verify` CLI is preserved as a convenience surface for the common "this claim is verified now" case. Per {R009.§7.AC.05}, `verify` becomes a thin alias to `meta` writes. Phase 1 deliberately drops the asymmetric `--remove` (log-level pop) vs `--remove --all` (state-level wipe) distinction that the legacy command carried; both flags collapse to a single state-level semantic via `unset`. The user authorized this simplification — there is no on-disk back-compat to preserve, and the legacy asymmetry was a workaround for not having a generalized event log.

§DC.60:5:derives=R009.§7.AC.05 The `verify` command MUST map to `metadataStorage` operations as follows:

| Invocation | New implementation |
|------------|-------------------|
| `verify CLAIM` | `metadataStorage.append({op: "add", key: "verified", value: "true", actor: <flag or OS user>, date: today, claimId, note?})` |
| `verify CLAIM --actor A` | Same, with `actor=A` |
| `verify CLAIM --note N` | Same, with `note=N` |
| `verify CLAIM --remove` | `metadataStorage.append({op: "unset", key: "verified", value: "", actor, date, claimId})` |

The `--method` flag from the legacy command is REMOVED. Callers that previously used `--method M` MUST migrate to `--note M` (the `method` semantic was always a free-form note label; the rename aligns the verify CLI with the `meta` surface). The `--all` flag is REMOVED — `--remove` now always means "wipe verification state for this claim." Highest binding: this is the user-facing CLI cutover; scripts depending on the legacy asymmetric `--remove` semantic break here, by design.

§DC.61:derives=R009.§7.AC.07 The `:removed` lifecycle rejection rule at `verify-command.ts:97` MUST be preserved verbatim in the new body. Semantics unchanged: a write attempt against a `:removed` claim is rejected with the existing message. The rule also MUST hold for the `meta` write commands per §DC.28 — both surfaces share the same guard, factored into a shared `metadata-write-guards.ts` helper.

§DC.62:derives=R009.§7.AC.06 The note-level invocation `verify NOTE_ID` MUST continue to work for the bulk-verify case: iterate over the note's claims and append one `add verified=true` event per claim. The note-level `--remove` invocation MUST iterate over the note's claims and append one `unset verified` event per claim. There is no longer a "note-level --remove --all" rejection path because `--all` is gone; the simple `--remove` semantic now does what `--remove --all` did before.

§DC.63:derives=R009.§7.AC.04 The `--reindex` flag MUST continue to work. Semantic unchanged: force claim-index rebuild before resolving the claim ID. Internally the rebuild also re-runs the suffix-grammar ingest reconciliation per §DC.44, but this is invisible to the user.

§DC.64:derives=R009.§7.AC.05 `MetadataStorage` exposes exactly the six methods listed in §DC.11. The verify CLI does NOT require a special log-level-pop primitive (the legacy `popLatestForKey` carve-out is dropped along with the asymmetric `--remove` semantic). Every verify path either appends an `add` or appends an `unset`; no path mutates prior events. This keeps the storage interface clean and makes the append-only invariant ({A004.§1.AC.01}) hold without exception.

### Phase 1J: Watch-Mode Integration

#### `core/src/storage/filesystem/filesystem-metadata-storage.ts` (additional method)

§DC.65:derives=A004.§3.AC.05 The `watch?` method MUST register a chokidar watcher on the `verification.json` file (NOT on the `.lock` sidecar). On any `change` event, the implementation MUST re-load the store and emit a `StorageEvent` of type `"modified"` with `noteId` set to a sentinel value (e.g., `"__metadata_store__"`) since the existing `StorageEvent` shape is note-oriented. Subscribers receive the notification and refresh their folded-state caches.

§DC.66:derives=A004.§3.AC.05 Watch mode is opt-in per consumer. Phase 1 does not subscribe any specific consumer to the metadata-store watcher — the affordance exists in the adapter, but no consumer in Phase 1 maintains a long-lived folded-state cache that would benefit from it. Phase 2 (UI, long-running chat sessions) will add subscribers; this DC documents the affordance is in place from Phase 1 so adding subscribers later requires no adapter changes.

---

## §4 Wiring Map

### Import Graph After Phase 1

```
CLI Commands (claims/meta/*, claims/verify, claims/trace, claims/gaps, ...)
    │
    ▼
BaseCommand.setup()
    │  Creates ProjectManager via createFilesystemProject()
    ▼
ProjectManager (composition root)
    ├─ metadataStorage: MetadataStorage  ← injected
    ├─ noteStorage, configStorage, templateStorage  ← unchanged
    ├─ claimIndex (now triggers MetadataIngest reconciliation post-build)
    └─ ...

Storage Interfaces (NoteStorage, ConfigStorage, TemplateStorage, MetadataStorage)
    ▲
    │ MetadataStorage REPLACES VerificationStorage
    ▼
Filesystem Adapters
    ├─ FilesystemMetadataStorage (NEW; persists to verification.json)
    │     ├─ uses proper-lockfile for concurrent-write detection
    │     └─ uses @paralleldrive/cuid2 for event IDs
    ├─ FilesystemNoteStorage  ← unchanged
    ├─ FilesystemConfigStorage  ← unchanged
    └─ FilesystemTemplateStorage  ← unchanged

Claim System
    ├─ MetadataEvent, MetadataStore, EventFilter (NEW types in metadata-event.ts)
    ├─ MetadataIngest (NEW — reconciles author suffix tokens to events)
    ├─ ClaimIndex.applyAuthorDeltas(metadataStorage) (NEW hook post-build)
    ├─ parseClaimMetadata (UNCHANGED public shape; raw-token interpreter)
    └─ computeStaleness (MODIFIED to read fold projection)
```

### Call Chain: `scepter claims meta add R009.§1.AC.01 reviewer=alice`

```
CLI: scepter claims meta add R009.§1.AC.01 reviewer=alice
  → BaseCommand.execute() / createFilesystemProject() / ProjectManager.initialize()
  → meta/add-command.ts handler
       → ensureIndex(projectManager) — resolves the claim ID
       → validateKey("reviewer") — passes
       → projectManager.metadataStorage!.append({
             id: createId(),
             claimId: "R009.§1.AC.01",
             key: "reviewer",
             value: "alice",
             op: "add",
             actor: <os user>,
             date: <today>,
         })
            → FilesystemMetadataStorage.append
                 → properLockfile.lock(verification.json.lock, {timeout:2000})
                 → load() (re-read on-disk store)
                 → store["R009.§1.AC.01"].push(event)
                 → fs.writeFile(verification.json, JSON.stringify(store, null, 2) + "\n")
                 → properLockfile.unlock()
       → console.log success
```

### Call Chain: `scepter claims trace R009 --where verified=true`

```
CLI: scepter claims trace R009 --where verified=true
  → BaseCommand.execute() / createFilesystemProject() / ProjectManager.initialize()
       → ClaimIndex.build() then applyAuthorDeltas(metadataStorage) — author tokens flow into store
  → trace-command.ts handler
       → buildTraceabilityMatrix(claimIndex, ...)
       → applyMetadataFilters(rows, metadataStorage, {where: ["verified=true"], ...})
            → for each row: const folded = await metadataStorage.fold(row.claimId)
            → keep iff folded["verified"]?.includes("true")
       → claim-formatter.formatTraceabilityMatrix(filteredRows, ..., metadataStorage)
            → for each row, render verified-date via metadataStorage.query({claimId, key:"verified"})
       → stdout
```

### Call Chain: `scepter claims verify R009.§1.AC.01 --remove` (state-level wipe)

```
CLI: scepter claims verify R009.§1.AC.01 --remove
  → BaseCommand.execute() / ProjectManager.initialize()
  → verify-command.ts handler
       → ensureIndex — resolves claim ID
       → :removed lifecycle check (preserved from line 97)
       → projectManager.metadataStorage!.append({
              id: createId(),
              claimId: "R009.§1.AC.01",
              key: "verified",
              value: "",
              op: "unset",
              actor: <flag or os user>,
              date: <today>,
         })
            → properLockfile.lock(...)
            → load() — re-read store
            → store[claimId].push(event)
            → save()
            → properLockfile.unlock()
       → console.log "verification cleared for <claimId>"
```

Per §DC.60 the asymmetric log-level-pop semantics from the legacy verify CLI are not preserved. `--remove` always wipes state via `unset`; `--all` is gone.

### Call Chain: claim-index rebuild → suffix ingest reconciliation

```
ProjectManager.initialize() (or `--reindex` flag)
  → ClaimIndex.build()
       → for each note: parse markdown → extract claims with suffix tokens → ClaimIndexEntry[]
  → ClaimIndex.applyAuthorDeltas(metadataStorage)
       → for each note:
            → metadataIngest.reconcileNoteEvents(noteId, claimEntries, currentStore)
                 → authorEventsByClaim = filter store events to actor.startsWith("author:" + noteId)
                 → currentDeclarations = parse suffix tokens per §DC.39 normalization
                 → diff: emit add for new tokens, retract for vanished tokens, no-op for unchanged
            → for each event in {toAppend, toRetract}: metadataStorage.append(event)
```

---

## §5 Data and Interaction Flow

### Flow 1: Legacy `verification.json` migration on first load

1. User upgrades SCEpter; existing project has `_scepter/verification.json` with 50 legacy events.
2. Any CLI command runs: `BaseCommand.setup()` constructs `ProjectManager` via `createFilesystemProject`.
3. The factory constructs `FilesystemMetadataStorage(dataDir)`. No I/O yet.
4. The first command that needs metadata invokes `metadataStorage.load()`.
5. `load()` reads `verification.json`, parses JSON.
6. For each top-level key (claimId), iterates the events array. Each event has no `op` field → triggers the legacy-path migration shim (§DC.19).
7. The shim applies `timestamp → date` normalization first (per the existing `core/src/claims/verification-store.ts:64-71` precedent), then maps to the `MetadataEvent` shape with `key="verified"`, `value="true"`, `op="add"`, `note=method` (verbatim).
8. Each migrated event gets a freshly-generated cuid2.
9. `load()` returns the migrated `MetadataStore` to the caller.
10. No on-disk rewrite happens at load time. The next `save()` (e.g., from a subsequent verify call) writes the new shape. Reads-only sessions never touch the file.

**Round-trip invariant test:** for every legacy event `e`, the equivalence `getLatestVerification(legacyStore, claimId)` ≈ `metadataStorage.fold(claimId).verified[0]` for the purposes of staleness's three-way classification ({R005.§4.AC.02}). This is exercised by §8 Test Plan T-Migration-1.

### Flow 2: Author edits a claim's suffix in a re-indexed note

1. Note `_scepter/notes/reqs/R009 ...md` has `### AC.01:5:reviewer=alice`. After CLI calls add `reviewer=bob` via `meta add`, the store has three `author:` events for AC.01 (`importance=5`, `reviewer=alice`) plus one CLI event (`reviewer=bob`).
2. The user edits the note: `### AC.01:5:reviewer=alice:priority=high`. File mtime updates.
3. Next index rebuild (any CLI command, or `--reindex`): `ClaimIndex.build()` parses the new suffix tokens.
4. `ClaimIndex.applyAuthorDeltas(metadataStorage)` invokes `metadataIngest.reconcileNoteEvents(R009, [{claimId: R009.§1.AC.01, tokens: ["5", "reviewer=alice", "priority=high"]}, ...], store)`.
5. Reconciliation:
   - `importance=5`: present in author events, present in current declarations, fold contains `5` → no event emitted (idempotent per §DC.42).
   - `reviewer=alice`: present in author events, present in current declarations → no event.
   - `priority=high`: NOT in author events, present in current declarations → emit `add` event with `key=priority`, `value=high`, `actor=author:_scepter/notes/reqs/R009 ...md`.
   - No author events to retract.
   - The CLI event `reviewer=bob` is untouched (its actor lacks `author:` prefix per §DC.43).
6. Folded state for R009.§1.AC.01: `{importance: ["5"], reviewer: ["alice", "bob"], priority: ["high"]}`. Author intent and CLI writes coexist.

### Flow 3: Concurrent write rejected

1. Process A runs `scepter claims meta add R009.§1.AC.01 priority=high`.
2. Process A's `metadataStorage.append` acquires `verification.json.lock` via `proper-lockfile`.
3. While A holds the lock, Process B runs `scepter claims meta add R009.§1.AC.01 reviewer=carol`.
4. B's `append` calls `properLockfile.lock(verification.json.lock, {timeout: 2000})`.
5. After 2000ms with A still holding, the lock-acquire rejects.
6. B's `append` throws an error: "Concurrent write detected on verification.json (locked by PID <A's pid>). Retry in a moment.". Non-zero exit.
7. A's append completes normally and releases the lock.
8. B re-runs; this time, no contention; B's append succeeds.

This matches {A004.§1.AC.06} (reject-on-contention) and {R009.§1.AC.12} (durability — A's write is durable before B retries).

---

## §6 Migration of `verification.json`

The migration is performed exactly once, by the one-shot CLI command `scepter claims meta migrate-legacy` (§DC.19). There is no load-time back-compat affordance — `load()` rejects legacy-shape files with a clear instruction to run the migration command (§DC.16). The author's own project is the only known holder of legacy data, so a single-shot user-invoked migration is sufficient and the runtime stays clean.

### Per-event projection

| Legacy field | New `MetadataEvent` field | Notes |
|--------------|---------------------------|-------|
| `claimId` | `claimId` | Verbatim |
| `date` (or normalized `timestamp`) | `date` | Normalization rule from `core/src/claims/verification-store.ts:64-71` re-implemented inline in the migration command |
| `actor` | `actor` | Verbatim — CLI-written events; no `author:` prefix |
| `method` (optional) | `note` | Prefixed with `"method="` to align with the new `verify --note` convention (legacy `method: "manual"` → `note: "method=manual"`) |
| (none) | `id` | Freshly generated cuid2 |
| (none) | `key` | Always `"verified"` |
| (none) | `value` | Always `"true"` |
| (none) | `op` | Always `"add"` |

### Behavioral invariant after migration

For every claim ID that had a legacy verification entry, the post-migration store MUST satisfy:

```
const events = await metadataStorage.query({claimId, key: "verified"});
events.length >= 1 && events[events.length - 1].date === <latest legacy date for this claim>
```

This preserves the staleness three-way classification ({R005.§4.AC.02}) across the migration boundary.

### Exception handling

- File missing: migration command exits with status 0, prints "No legacy verification.json found; nothing to migrate."
- File already in new shape (every event has `op` field): exits with status 0, prints "verification.json already migrated; nothing to do."
- File invalid JSON: re-raise the parse error.
- File mixed-shape (some events have `op`, some don't): exit with non-zero status, refuse to proceed, print a clear error directing the user to inspect the file. This is not an expected state and silent partial migration would be worse than refusing.
- File present, in legacy shape, but `meta migrate-legacy` not yet run: subsequent calls to `metadataStorage.load()` (e.g., from any other CLI command) throw with a clear directive to run the migration command first (§DC.16).

---

## §7 DCs Decomposed from Compound Source Claims

The R009 reviewer flagged three compound ACs that needed decomposition. This section captures the per-aspect DCs that resolve them. (These DCs are also embedded in §3 above where they apply to specific files; this section gathers them for reviewer convenience.)

### Decomposition of {R009.§1.AC.01} (`MetadataEvent` schema with 7 fields)

The source AC bundles 8 schema decisions ({A004.§2.AC.01} added the `id` field). Per-field DCs already authored above:

- §DC.01 — Field set is exactly the eight named (binding contract on the whole shape).
- §DC.02 — `id` is a 24-char cuid2 (specifies the type and generation rule).
- §DC.03 — `claimId` form, normalization rules (specifies acceptance regime).
- §DC.04 — `key` regex `/^[a-z][a-z0-9._-]*$/` (specifies the validation rule).
- §DC.05 — `value` empty-iff-unset invariant (specifies the cross-field constraint).
- §DC.06 — `op` closed vocabulary (specifies the type union).
- §DC.07 — `actor` `author:` prefix discipline (specifies the prefix convention but not enforcement layer).
- §DC.09 — `EventFilter` shape (specifies the query input type).

Note: `date` and `note?` are not separately decomposed because their constraints are minimal (ISO 8601 string per {R009.§1.AC.01}; `note` is unconstrained free text). They are implicitly covered by §DC.01.

### Decomposition of {R009.§1.AC.06} (fold rule covering all four ops)

The source AC bundles four op semantics. Per-op DCs already authored above:

- §DC.08 — The full fold rule table is in §DC.08; below are the per-op semantics that table specifies.
- The `add` semantic: append if not present (idempotent at view level; both events still in log).
- The `set` semantic: clear values, then append the new value (atomic).
- The `unset` semantic: clear values, value field is `""`.
- The `retract` semantic: remove the named value if present, no-op if absent.

These four are declared as one DC (§DC.08) because they share the same data structure (`Record<key, string[]>`) and the same guarantee (deterministic across implementations). However, each is verified by an isolated test per §8 T-Fold-1 through T-Fold-4. The reviewer's concern (each op has a distinct fold semantic) is satisfied by the per-op test isolation, even though the DC is unified for type-coherence reasons.

If a future reviewer prefers per-op DCs, the natural decomposition is four sub-claims (one per op: fold-add, fold-set, fold-unset, fold-retract) using the sub-letter convention (a/b/c/d). The current unified §DC.08 is the judgment call discussed in §11 OQ.03. This DD adopts the unified form but flags the alternative for future revision.

### Decomposition of {R009.§7.AC.01} (legacy migration with three concerns)

The source AC bundles (1) legacy file detection, (2) per-field mapping to the new shape, (3) post-migration behavioral invariant. Per-aspect DCs:

- §DC.16 — Legacy detection: `load()` rejects legacy-shape files and directs the user to the migration command (loader-rejection DC).
- §DC.19 — One-shot migration command, including the per-field projection table (per-field-mapping DC).
- §6 — Behavioral invariant: stated as a binding contract on the post-migration store (latest `verified` event date preserves the staleness three-way classification across the migration boundary).

The §6 invariant is stated as prose-binding rather than as a numbered DC because it is a property over the conjunction of §DC.16, §DC.19, and consumer behavior (§DC.49 staleness shape). Adding a §DC.X for the invariant alone would be redundant with the test that exercises it (§8 T-Migration-1).

---

## §8 Test Plan

Every DC in §3 has at least one verification path. The plan below groups tests by category; each test references the DC(s) it validates via `@validates` annotations in the test file.

### One-shot legacy migration command

| Test ID | File | Validates |
|---------|------|-----------|
| T-Migration-1 | `core/src/cli/commands/claims/meta/__tests__/migrate-legacy-command.test.ts` (NEW) | §DC.19 + §6 behavioral invariant. Setup: write a `verification.json` with 5 known legacy events including one with `timestamp` instead of `date` and one with `method`. Run `meta migrate-legacy`. Assert: file rewritten to new shape; every legacy event present in the new store with `key="verified"`, `value="true"`, `op="add"`; per-claim `query({key:"verified"}).pop().date` equals the latest legacy date; events with legacy `method=M` have `note="method=M"` after migration. |
| T-Migration-2 | same file | Missing-file no-op: file absent → command exits 0 with the documented message; no file is created. |
| T-Migration-3 | same file | Already-migrated no-op: file already in new shape → command exits 0 with "already migrated" message; file unchanged. |
| T-Migration-4 | same file | Mixed-shape refusal: file with some legacy and some new events → command exits non-zero with the documented refusal message; file unchanged. |
| T-Migration-5 | `core/src/storage/filesystem/__tests__/filesystem-metadata-storage.test.ts` (NEW) | §DC.16 legacy-rejection: `load()` against a legacy-shape file throws with a message naming `meta migrate-legacy`. |

### Fold determinism (per-op)

| Test ID | File | Validates |
|---------|------|-----------|
| T-Fold-1 | `core/src/claims/__tests__/metadata-event.test.ts` (NEW) | §DC.08 add semantic. `[add a, add b]` folds to `[a, b]`. `[add a, add a]` folds to `[a]` (idempotent). |
| T-Fold-2 | same file | §DC.08 set semantic. `[add a, set b]` folds to `[b]`. `[set a, add b]` folds to `[a, b]`. |
| T-Fold-3 | same file | §DC.08 unset semantic. `[add a, add b, unset]` folds to (key absent from result). |
| T-Fold-4 | same file | §DC.08 retract semantic. `[add a, add b, retract a]` folds to `[b]`. `[add a, retract c]` folds to `[a]` (no-op on absent value). |
| T-Fold-5 | same file | Combined sequence determinism. A 12-event sequence produces deterministic state across two independent fold invocations. |

### Concurrent-write rejection

| Test ID | File | Validates |
|---------|------|-----------|
| T-Lock-1 | `core/src/storage/filesystem/__tests__/filesystem-metadata-storage.lock.test.ts` (NEW) | §DC.36, §DC.37. Two `FilesystemMetadataStorage` instances against the same dataDir. Process A acquires lock manually. Process B's `append` rejects within the configured timeout (2000ms in production, configurable to ~200ms in test). Error message names the conflicting holder. |
| T-Lock-2 | same file | Reads do not lock. While A holds the write lock, B's `load`/`fold`/`query` proceed without contention. |
| T-Lock-3 | same file | After A releases, B's retry succeeds. |

### Watch-mode coherence

| Test ID | File | Validates |
|---------|------|-----------|
| T-Watch-1 | `core/src/storage/filesystem/__tests__/filesystem-metadata-storage.watch.test.ts` (NEW) | §DC.65. Subscribe via `watch?(cb)`. Externally mutate `verification.json`. Assert callback fires within 1s with a `StorageEvent` of type `"modified"`. |

### Verify CLI as thin alias

| Test ID | File | Validates |
|---------|------|-----------|
| T-Verify-1 | `core/src/cli/commands/claims/__tests__/verify-command.test.ts` (existing — UPDATE) | §DC.60 happy path: `verify CLAIM` appends one `add verified=true` event with the OS-username actor and today's date. |
| T-Verify-2 | same | §DC.60 `--actor`, `--note` round-trip: `verify CLAIM --actor A --note N` appends an event with `actor=A` and `note=N`. |
| T-Verify-3 | same | §DC.60 `--remove` state-level wipe: after `verify CLAIM` then `verify CLAIM --remove`, folded state for `verified` is empty (key absent from result). The log retains both events. |
| T-Verify-4 | same | §DC.61 `:removed` rejection preserved on both add and remove paths. |
| T-Verify-5 | same | §DC.62 note-level: `verify NOTE_ID` appends one `add verified=true` per claim in the note; `verify NOTE_ID --remove` appends one `unset verified` per claim. |
| T-Verify-6 | same | Removed flags: passing `--method` or `--all` produces a Commander-level "unknown option" error (no silent acceptance). |

### Suffix-grammar ingest reconciliation

| Test ID | File | Validates |
|---------|------|-----------|
| T-Ingest-1 | `core/src/claims/__tests__/metadata-ingest.test.ts` (NEW) | §DC.39 normalization table. For every row in §DC.39, asserting that the suffix token produces the named event(s) with the correct key/value. |
| T-Ingest-2 | same | §DC.40 actor format `author:<notepath>` with project-root-relative path. |
| T-Ingest-3 | same | §DC.41 incremental reconciliation. Author edits adding a token emit one `add`; removing a token emits one `retract`; unchanged tokens emit nothing. |
| T-Ingest-4 | same | §DC.42 idempotence on re-ingest of unchanged tokens (no events emitted on second build). |
| T-Ingest-5 | same | §DC.43 CLI events untouched by reconciliation. |
| T-Ingest-6 | `core/src/claims/__tests__/claim-metadata.lossless.test.ts` (NEW) | §DC.59 lossless invariant. For every legal suffix token combination, `parseClaimMetadata(tokens)` and the fold reconstruction produce identical `ParsedMetadata`. |

### Filter integration

| Test ID | File | Validates |
|---------|------|-----------|
| T-Filter-1 | `core/src/cli/commands/claims/__tests__/trace-command.test.ts` (existing — EXTEND) | §DC.55, §DC.56 `--where`, `--has-key`, `--missing-key` on trace. Compose with `--importance`. |
| T-Filter-2 | `core/src/cli/commands/claims/__tests__/gaps-command.test.ts` (existing — EXTEND) | §DC.55, §DC.56 same on gaps. |
| T-Filter-3 | `core/src/cli/commands/context/__tests__/search.test.ts` (existing — EXTEND) | §DC.55, §DC.56 same on search. |
| T-Filter-4 | `core/src/claims/__tests__/metadata-filters.test.ts` (NEW) | The composability matrix: every pair of filters AND together correctly. Edge cases: empty filter list (no filtering); `--where KEY=VALUE` with KEY-validation failure (rejected at parse). |
| T-Filter-5 | `core/src/cli/commands/claims/__tests__/trace-command.test.ts` | §DC.57 `--importance N` continues to produce identical output to the legacy implementation; cross-checked against the importance reconstruction path. |

### Meta CLI surface

| Test ID | File | Validates |
|---------|------|-----------|
| T-Meta-Add-1 | `core/src/cli/commands/claims/meta/__tests__/add-command.test.ts` (NEW) | §DC.25 happy path: single `KEY=VALUE`. |
| T-Meta-Add-2 | same | §DC.25 multi-pair: three `KEY=VALUE` arguments produce three events with the same actor/date/note. |
| T-Meta-Add-3 | same | §DC.26 KEY validation: bad KEY rejects whole command, no events recorded. |
| T-Meta-Add-4 | same | §DC.27 unresolved claim ID rejected with fuzzy suggestions. |
| T-Meta-Add-5 | same | §DC.28 `:removed` claim rejected. |
| T-Meta-Set-1 | `core/src/cli/commands/claims/meta/__tests__/set-command.test.ts` (NEW) | §DC.29 atomic replace. After `add reviewer=a, add reviewer=b, set reviewer=c`, fold is `[c]`. |
| T-Meta-Unset-1 | `core/src/cli/commands/claims/meta/__tests__/unset-command.test.ts` (NEW) | §DC.30 clears named keys, leaves others. |
| T-Meta-Clear-1 | `core/src/cli/commands/claims/meta/__tests__/clear-command.test.ts` (NEW) | §DC.31 clears all keys; no-op on empty. |
| T-Meta-Get-1 | `core/src/cli/commands/claims/meta/__tests__/get-command.test.ts` (NEW) | §DC.32 prints all keys; with key, prints values. §DC.33 distinguishable exit on missing key. |
| T-Meta-Get-2 | same | §DC.34 `--json` output shape. |
| T-Meta-Log-1 | `core/src/cli/commands/claims/meta/__tests__/log-command.test.ts` (NEW) | §DC.35 prints chronological log; `--json` array. |

### Consumer migration smoke

| Test ID | File | Validates |
|---------|------|-----------|
| T-Consumer-1 | `core/src/cli/commands/claims/__tests__/stale-command.test.ts` (existing — UPDATE) | §DC.48, §DC.49. Existing R005 §4 staleness tests pass against the new fold-based input. |
| T-Consumer-2 | All other consumer test files where present | §DC.50, §DC.52, §DC.53, §DC.54. Trace, gaps, search, thread, index, show output is byte-identical to pre-migration baseline for projects with no metadata changes. |

### TypeScript and lint

| Test ID | Validates |
|---------|-----------|
| T-Compile | `pnpm tsc --noEmit` passes after every phase. |
| T-Imports | `grep "verificationStorage\|VerificationStore\|getLatestVerification" core/src` returns zero matches after Phase 1F (consumer migration) is complete. |

---

## §9 Integration Sequence (the load-bearing artifact)

The phase-1 work is sequenced so that each step leaves the codebase in a compiling, testable state. Each step lists the files touched, the verification gate, and the DC(s) it lands.

### Step 1 — Add `MetadataEvent` types, pure fold, and barrel exports

**Files:** `core/src/claims/metadata-event.ts` (NEW); `core/src/claims/index.ts` (MODIFY — add new exports; keep legacy for now); `package.json` (MODIFY — add `@paralleldrive/cuid2`).

**Changes:** §DC.01-§DC.09 type definitions plus §DC.09a's pure `applyFold` function. New file is self-contained; no other source file imports it yet.

**Verify:** `pnpm tsc --noEmit` passes. T-Fold-1 through T-Fold-5 (fold determinism) run against `applyFold` directly; no storage mock needed. Step 3 re-verifies the same tests through `FilesystemMetadataStorage.fold` to confirm the delegate path is consistent.

**Spec coverage:** {R009.§1.AC.01}, {R009.§1.AC.06}, {A004.§2.AC.01}, {A004.§1.AC.02}, {A004.§1.AC.03}.

### Step 2 — Add `MetadataStorage` interface

**Files:** `core/src/storage/storage-backend.ts` (MODIFY — add `MetadataStorage` interface); `core/src/storage/index.ts` (MODIFY — add export).

**Changes:** §DC.11, §DC.12 interface (exactly six methods, no carve-outs). This step does not yet remove `VerificationStorage` — that happens in Step 5 once consumers are migrated.

**Verify:** `pnpm tsc --noEmit` passes. Both interfaces coexist transiently for the duration of the integration sequence; the shipped state per {A004.§2.AC.03} has only `MetadataStorage`.

**Spec coverage:** {A004.§2.AC.02}, {A004.§2.AC.06}.

### Step 3 — Implement `FilesystemMetadataStorage` and one-shot migration command

**Files:** `core/src/storage/filesystem/filesystem-metadata-storage.ts` (NEW); `core/src/cli/commands/claims/meta/migrate-legacy-command.ts` (NEW); `package.json` (MODIFY — add `proper-lockfile`).

**Changes:** §DC.14-§DC.18, §DC.36, §DC.37, §DC.65 watch hook. The migration command (§DC.19) re-implements the `timestamp → date` normalization rule inline (since `verification-store.ts` is deleted in Step 6). `load()` rejects legacy-shape input per §DC.16; auto-migration is not implemented.

**Verify:** T-Migration-1 through T-Migration-5 (one-shot command + legacy-rejection) pass. T-Lock-1 through T-Lock-3 (concurrent-write tests) pass. T-Fold-1 through T-Fold-5 re-run against `FilesystemMetadataStorage.fold` and confirm parity with the Step 1 pure-function path. T-Watch-1 (watch coherence) passes.

**Spec coverage:** {R009.§1.AC.10}, {R009.§1.AC.12}, {R009.§7.AC.01}, {R009.§7.AC.02}, {A004.§1.AC.06}, {A004.§2.AC.04}, {A004.§3.AC.05}.

### Step 4 — Implement suffix-grammar ingest

**Files:** `core/src/claims/metadata-ingest.ts` (NEW); `core/src/claims/claim-index.ts` (MODIFY — add `applyAuthorDeltas` hook).

**Changes:** §DC.38-§DC.44 reconciliation logic. The hook at §DC.44 is opt-in — `ProjectManager.initialize()` does not call it yet (Step 7 wires it in).

**Verify:** T-Ingest-1 through T-Ingest-5 pass. T-Ingest-6 (lossless invariant cross-check between `parseClaimMetadata` and fold reconstruction) passes. The `parseClaimMetadata` shape (`ParsedMetadata`) is unchanged at this step (§DC.58).

**Spec coverage:** {R009.§4.AC.01}-{R009.§4.AC.08}, {A004.§3.AC.01}-{A004.§3.AC.04}.

### Step 5 — Migrate consumers from `verificationStorage` to `metadataStorage`

**Files:** `core/src/project/project-manager.ts` (MODIFY — rename field per §DC.45); `core/src/storage/filesystem/create-filesystem-project.ts` (MODIFY — construct `FilesystemMetadataStorage` per §DC.47); `core/src/cli/commands/claims/stale-command.ts`, `core/src/cli/commands/claims/trace-command.ts`, `core/src/cli/commands/claims/gaps-command.ts`, `core/src/cli/commands/claims/thread-command.ts`, `core/src/cli/commands/claims/index-command.ts`, `core/src/cli/commands/claims/verify-command.ts`, `core/src/cli/commands/context/show-handler.ts`, `core/src/cli/commands/context/search.ts`, `core/src/claims/staleness.ts`, `core/src/claims/claim-thread.ts`, `core/src/cli/formatters/claim-formatter.ts`, `core/src/index.ts` (top-level barrel) (MODIFY per §DC.48-§DC.54b, §DC.60-§DC.64).

**Changes:** Mechanical replacement of `verificationStorage.load()` + `getLatestVerification(...)` with `metadataStorage.query({key:"verified"})` projections. Verify command rewires per §DC.60-§DC.64 as a thin alias (state-level only; legacy `--method` and `--all` flags removed). Top-level barrel (§DC.54b) drops legacy verification-store re-exports and adds the new metadata symbols. `claim-thread.ts` (§DC.54a) migrates alongside `thread-command.ts`.

**Verify:** T-Verify-1 through T-Verify-6 pass (verify CLI as thin alias). T-Consumer-1, T-Consumer-2 pass (other commands produce byte-identical output to pre-migration baseline for projects with no new metadata writes). All existing R005 §3 and §4 ACs pass against the new substrate. `pnpm tsc --noEmit` passes; the codebase compiles end-to-end through the new path.

**Spec coverage:** {R009.§7.AC.04}-{R009.§7.AC.11}, {A004.§2.AC.03}, {A004.§4.AC.02}-{A004.§4.AC.04}.

### Step 6 — Delete legacy code

**Files:** `core/src/claims/verification-store.ts` (DELETE per §DC.21); `core/src/claims/__tests__/verification-store.test.ts` (DELETE); `core/src/storage/filesystem/filesystem-verification-storage.ts` (DELETE per §DC.20); `core/src/storage/filesystem/filesystem-verification-storage.test.ts` (DELETE); `core/src/storage/storage-backend.ts` (MODIFY — remove `VerificationStorage` per §DC.10); `core/src/storage/index.ts` (MODIFY — remove `VerificationStorage` export); `core/src/claims/index.ts` (MODIFY — remove legacy exports per §DC.13); `core/src/storage/storage-boundary.test.ts` (UPDATE — strip hardcoded `loadVerificationStore`/`verificationStorage` assertions at lines 131, 135, 140, 146, 150).

**Changes:** Pure deletion of the superseded substrate. After this step, the codebase has zero references to `VerificationStorage`, `VerificationEvent`, `VerificationStore`, `loadVerificationStore`, `saveVerificationStore`, `getLatestVerification`, `addVerificationEvent`, `removeLatestVerification`, `removeAllVerifications`, `FilesystemVerificationStorage`.

**Verify:** T-Imports (grep verification) returns zero matches. `pnpm tsc --noEmit` passes. Full test suite passes (the only consumers of the legacy surface were already migrated in Step 5).

**Spec coverage:** {A004.§2.AC.03}.

### Step 7 — Wire suffix-grammar ingest into initialization

**Files:** `core/src/project/project-manager.ts` (MODIFY — invoke `claimIndex.applyAuthorDeltas(metadataStorage)` after `claimIndex.build()` during initialization or on `--reindex`).

**Changes:** The hook authored in Step 4 gets called. Author tokens flow into the store on every claim-index rebuild.

**Verify:** Run a full integration test: project with R005-era claims (importance, lifecycle, derives, tags, freeform). After init, `metadataStorage.fold(claimId)` produces the expected key-value map for every claim. Existing R005 §1 importance display tests, R005 §2 lifecycle tests, R006 derivation tests all pass — because §DC.58's `parseClaimMetadata` is the path those tests exercise, and it's unchanged in shape.

**Spec coverage:** {R009.§4.AC.06}, {R009.§4.AC.08}, {A004.§3.AC.01}, {A004.§3.AC.03}, {A004.§3.AC.04}.

### Step 8 — Add `meta` CLI subcommand group

**Files:** `core/src/cli/commands/claims/meta/index.ts` (NEW); `core/src/cli/commands/claims/meta/add-command.ts`, `set-command.ts`, `unset-command.ts`, `clear-command.ts`, `get-command.ts`, `log-command.ts` (all NEW); `core/src/cli/commands/claims/index.ts` (MODIFY — register `metaCommand` on the `claimsCommand` group).

**Changes:** §DC.24-§DC.35 commands and their tests.

**Verify:** T-Meta-Add-1 through T-Meta-Log-1 pass. End-to-end smoke: `scepter claims meta add CLAIM key=value`, then `scepter claims meta get CLAIM` reflects the write, then `scepter claims meta log CLAIM` shows the event with `--json` returning a parseable array.

**Spec coverage:** {R009.§2.AC.01}, {R009.§2.AC.02}, {R009.§2.AC.04}, {R009.§2.AC.05}, {R009.§2.AC.07}-{R009.§2.AC.09}, {R009.§3.AC.01}, {R009.§3.AC.02}, {R009.§3.AC.04}, {R009.§3.AC.06}, {R009.§3.AC.08}.

### Step 9 — Filter integration on `trace`/`search`/`gaps`

**Files:** `core/src/claims/metadata-filters.ts` (NEW per §DC.56); `core/src/cli/commands/claims/trace-command.ts`, `gaps-command.ts`, `core/src/cli/commands/context/search.ts` (MODIFY — add `--where`, `--has-key`, `--missing-key` Commander options and pass through to `applyMetadataFilters`).

**Changes:** §DC.55-§DC.57.

**Verify:** T-Filter-1 through T-Filter-5 pass. End-to-end: `scepter claims trace R009 --where reviewer=alice` filters as expected; combined with `--importance 4` produces the AND'd intersection.

**Spec coverage:** {R009.§5.AC.01}-{R009.§5.AC.03}, {R009.§5.AC.05}, {R009.§5.AC.06}.

### Step 10 — Final verification gate

**Verify:** Full test suite (`pnpm test`) passes. `pnpm tsc --noEmit` passes. `./scepter claims trace DD014` produces a trace matrix showing DCs derived from R009 and A004 with non-empty Source coverage for the implemented DCs (§DC.01-§DC.66 minus the deferred ones). `./scepter claims gaps --note DD014` returns no Phase-1 gaps. `./scepter claims lint DD014` is clean.

**Spec coverage:** All of §1 ACs above.

---

## §10 Phase 2 (Deferred Work)

Summarized for roadmap, not specified here. A future DD ("Claim Metadata Store - Phase 2") will own these.

- **Write ops:** `meta remove` ({R009.§2.AC.03}), `meta replace` ({R009.§2.AC.06}).
- **Note-scoped writes:** {R009.§2.AC.10}-{R009.§2.AC.12}.
- **Batch apply:** {R009.§2.AC.13}-{R009.§2.AC.15}.
- **Read ops:** `meta list` ({R009.§3.AC.09}-{R009.§3.AC.11}), `meta grep` ({R009.§3.AC.12}-{R009.§3.AC.13}), `meta diff` ({R009.§3.AC.14}), `meta changes` ({R009.§3.AC.15}), `meta get --history` ({R009.§3.AC.03}), `meta get --values-only` ({R009.§3.AC.05}), `meta log` filters ({R009.§3.AC.07}).
- **Filter ops:** `--group-by` on trace ({R009.§5.AC.04}).
- **Maintenance ops:** all of {R009.§6} — revert ({R009.§6.AC.01}, {R009.§6.AC.02}), compact ({R009.§6.AC.03}, {R009.§6.AC.04}), export/import ({R009.§6.AC.05}, {R009.§6.AC.06}), validate ({R009.§6.AC.07}, {R009.§6.AC.08}), rename-key ({R009.§6.AC.09}-{R009.§6.AC.11}).
- **`parseClaimMetadata` reimplementation** as a fold-projection adapter (§11 OQ.02 alternative). Phase-1 keeps the raw-token path; Phase-2 may unify.
- **Watch-mode subscribers:** UI components, long-running chat sessions (per §DC.66 the affordance is in place from Phase 1).

---

## §11 Open Questions

DD-level open questions that the producer settled. The user may revise.

### OQ.01 — File-locking library: `proper-lockfile`

**Question:** {A004.§1.AC.06} settled the architectural decision (file-level lock with 2s timeout, reject-on-contention). DD-level question: which library?

**Resolution:** `proper-lockfile` (npm). Rationale:

- Maintained, widely used (10M weekly downloads), MIT license.
- Supports the exact semantic A004 demands: exclusive lock with timeout, no merge/queue, returns the holder's PID for the error message.
- Lock-file path convention: a sidecar `.lock` next to the protected file (per §DC.36, the path is `<dataDir>/verification.json.lock`). The lock file is created on acquire and removed on release.
- Cross-platform (Windows + Linux + macOS) without polyfills.

**Alternatives considered:**

- **`lockfile` (npm):** older, less maintained. Same API shape but maintained at lower frequency. Rejected.
- **`flock` shell utility via subprocess:** Linux-only. Rejected.
- **In-process lock (e.g., a `Mutex` from `async-mutex`):** doesn't protect against cross-process concurrency, which is the actual scenario A004 cares about. Rejected.

**Lock file location:** `<dataDir>/verification.json.lock` rather than locking `verification.json` directly. This matters because some filesystems (notably some NFS implementations) have weak `flock` semantics; locking a sidecar avoids any case where the protected file's existence is itself the contended resource.

### OQ.02 — `parseClaimMetadata` reimplementation

**Question:** {A004.§4.AC.03} states `parseClaimMetadata` MAY be reimplemented as a thin adapter over `metadataStorage.fold`, OR may continue operating on raw token strings — both are valid implementations. This DD picks one.

**Resolution:** Phase-1 keeps `parseClaimMetadata` as a raw-token interpreter (§DC.58). Rationale:

- The function is invoked at index-build time on tokens parsed off the heading line. The tokens are already in memory at that point; routing them through the storage layer (`fold`) and back is a strict overhead.
- The lossless invariant (§DC.59 test) ensures the two paths produce the same `ParsedMetadata`. No semantic gap.
- Reimplementing as a fold adapter would couple `parseClaimMetadata` to `MetadataStorage`, which is a new dependency for every test that exercises the parser (the existing parser tests are pure).
- Phase-2 may unify the two paths if a use case emerges (e.g., a consumer that has the fold but not the raw tokens). Phase-1 deferral is cheap.

**Alternative considered:** `parseClaimMetadata(tokens)` becomes a thin wrapper that builds an in-memory event list, folds it, projects to `ParsedMetadata`. Rejected for Phase 1 per the rationale above.

### OQ.03 — DC granularity for {R009.§1.AC.06} (fold rule)

**Question:** Should the fold rule be one DC (§DC.08) covering all four ops, or four DCs (§DC.08a-d) one per op?

**Resolution:** One DC (§DC.08), with per-op test isolation in §8 T-Fold-1 through T-Fold-4. Rationale: the four ops share the same data structure and the same "deterministic across implementations" guarantee; splitting them yields four DCs with the same source AC and identical body shape, which is template-completion noise. The reviewer's concern (each op has a distinct fold semantic) is satisfied by the test isolation, not by DC count. See §7 for the alternative decomposition table if a reviewer prefers per-op DCs.

---

## §12 Observations

Non-blocking findings from the DD process. The user/orchestrator decides whether any of these warrants follow-up.

1. **Consumer migration scope, post-revision: 16+ touch sites across the codebase.** The original producer count (5 in claim-formatter.ts plus 8 other production files plus 3 test files = 16) missed two: `core/src/index.ts` (top-level package barrel re-exporting verification-store symbols at lines 22, 40, 96-101, 139-140) and `core/src/claims/claim-thread.ts` (a separate file from `thread-command.ts` that takes `VerificationStore` as a parameter at lines 15, 70, 91, 101, 119, 146, 268-269). DCs §DC.54a and §DC.54b cover them.

2. **No on-disk back-compat affordance.** Per user authorization, the legacy `verification.json` shape is migrated by an explicit one-shot CLI command (§DC.19) rather than runtime auto-migration. The verify CLI's asymmetric `--remove` (log-level pop) vs `--remove --all` (state-level wipe) distinction is dropped — `--remove` always wipes via `unset`. The `--method` flag is renamed to `--note`. This simplification cleans the runtime substantially; the only known holder of legacy data is the author's own project, so the user-invoked migration path is sufficient.

3. **The brief's note ID prediction was DD011, but DD011-DD013 already exist.** This DD landed at DD014. Cross-references that the user wrote based on the DD011 assumption (in handoffs, follow-up notes, or future ACs) need to be updated. The producer flagged this in the report rather than silently using DD011 as if available.

4. **{A004.§7} stress-test scenario 2 (author edits a claim's suffix)** is exercised by §8 T-Ingest-3 and T-Ingest-4. The DD's reconciliation logic (§DC.41-§DC.43) is the algorithmic specification of A004's described behavior; the test verifies the algorithm matches A004's description.

5. **{A004.§7} stress-test scenario 3 (custom multi-value key) is implicitly covered** by T-Meta-Add-2 (multi-pair add) and T-Fold-1 (the `add` semantic test). No additional dedicated test is added because the scenario has no behavior beyond what these tests already verify.

6. **{A004.§7} stress-test scenario 4 (compaction) is Phase-2 work** ({R009.§6.AC.03}, {A004.§8} adopted fold-then-synthesize-minimal-sequence). Not designed here.

7. **Watch-mode (§DC.65, §DC.66) ships in Phase 1 even though no Phase-1 consumer subscribes.** The rationale (§DC.66) is that adding subscribers later requires no adapter changes; absent the affordance now, every subscriber-adding PR would have to also touch the adapter. Front-loading the adapter side is small effort and removes future churn.

---

## References

- {R009} — Claim Metadata Key-Value Store (the requirement this DD realizes)
- {R009.§1} — Event log storage model
- {R009.§2} — Write operations (Phase-1 subset per §1)
- {R009.§3} — Read operations (Phase-1 subset per §1)
- {R009.§4} — Suffix grammar generalization
- {R009.§5} — Integration filters on existing commands
- {R009.§7} — Back-compat with R005 and legacy verification.json
- {R009.§8} — Minimum viable subset (Phase-1 scope)
- {A004} — Claim Metadata Store Architecture
- {A004.§1} — Core concepts (append-only, closed ops, fold determinism, concurrent-write rejection)
- {A004.§2} — Interface definitions (`MetadataEvent`, `MetadataStorage`, replaces `VerificationStorage`)
- {A004.§3} — Ingest paths and reconciliation
- {A004.§4} — Consumer migration philosophy
- {A004.§6} — R005 supersession boundary
- {A004.§7} — Stress testing scenarios
- {A004.§8} — Design decisions (file-lock, cuid2, compaction algorithm)
- {R005} — Claim Metadata, Verification, and Lifecycle (back-compat parent)
- {R005.§3.AC.02} — `VerificationEvent` interface (superseded by {A004.§2.AC.01})
- {R005.§3.AC.06} — Append-only store (superseded by {A004.§1.AC.01})
- {R005.§4} — Staleness Detection (preserved with generalized input per §DC.49)
- {R006} — Claim Derivation Tracing (`derives=` token preserved per §DC.39)
- {A002} — Backend Agnosticism — Storage Protocol Extraction (parent architecture)
- {A002.§2.AC.04} — `VerificationStorage` interface (replaced)
- {A002.§2.AC.06} — Async signature requirement (preserved)
- {DD002} — Claim Metadata Verification and Lifecycle (DD for R005, the parent)
- {DD007} — Verification Removal - Verify Command Extension (precedent for the `verify --remove` log-level pop semantic)
- {DD010} — Storage Protocol Extraction - Implementation Blueprint (the DD this one extends; structurally analogous)
- `core/src/claims/verification-store.ts` — being deleted; legacy migration precedent at lines 64-71 reused inside `FilesystemMetadataStorage.load`
- `core/src/storage/storage-backend.ts` — `VerificationStorage` removed at lines 87-90; `MetadataStorage` added in same file
- `core/src/storage/filesystem/filesystem-verification-storage.ts` — being deleted (§DC.20)
- `core/src/cli/commands/claims/verify-command.ts:97` — `:removed` rejection rule preserved (§DC.62)
- `core/src/cli/commands/claims/verify-command.ts:40-46` — OS-username default actor pattern reused by `meta` writes (§DC.25)
- `core/src/parsers/claim/claim-parser.ts:119` — metadata regex `/^[A-Za-z0-9=_.§-]+$/` already tolerates `=`; unchanged
- `core/src/claims/claim-metadata.ts:124` — `parseClaimMetadata` shape preserved (§DC.58); reconstruction invariant (§DC.59)
- `core/src/claims/staleness.ts:75,131` — `computeStaleness` migrated to fold-based input (§DC.49)
- `core/src/cli/formatters/claim-formatter.ts:121,189,343,490,841` — verification consumer call sites migrated (§DC.50)
- `core/src/project/project-manager.ts:47,84,103` — `verificationStorage` field renamed to `metadataStorage` (§DC.45)
- `core/src/storage/filesystem/create-filesystem-project.ts:23,180,193` — factory updated to construct `FilesystemMetadataStorage` (§DC.47)

### Implementation Artifacts (Phase 1, completed 2026-04-25)

New source files created during Phase-1 implementation:

- `core/src/claims/metadata-event.ts` — `MetadataEvent`, `MetadataStore`, `EventFilter` types; pure `applyFold` function (§DC.01-§DC.09a)
- `core/src/claims/metadata-ingest.ts` — `reconcileNoteEvents` suffix-grammar normalizer (§DC.38-§DC.43)
- `core/src/claims/metadata-filters.ts` — `applyMetadataFilters` for `--where`/`--has-key`/`--missing-key` (§DC.55-§DC.56)
- `core/src/storage/filesystem/filesystem-metadata-storage.ts` — `FilesystemMetadataStorage` adapter with `proper-lockfile` and chokidar watch (§DC.14-§DC.18, §DC.36-§DC.37, §DC.65)
- `core/src/cli/commands/claims/meta/index.ts` — `metaCommand` barrel registered at top-level (§DC.24)
- `core/src/cli/commands/claims/meta/add-command.ts` — `meta add` command (§DC.25-§DC.28)
- `core/src/cli/commands/claims/meta/set-command.ts` — `meta set` command (§DC.29)
- `core/src/cli/commands/claims/meta/unset-command.ts` — `meta unset` command (§DC.30)
- `core/src/cli/commands/claims/meta/clear-command.ts` — `meta clear` command (§DC.31)
- `core/src/cli/commands/claims/meta/get-command.ts` — `meta get` command (§DC.32-§DC.34)
- `core/src/cli/commands/claims/meta/log-command.ts` — `meta log` command (§DC.35)
- `core/src/cli/commands/claims/meta/migrate-legacy-command.ts` — one-shot `meta migrate-legacy` (§DC.19)
- `core/src/cli/commands/claims/meta/shared.ts` — shared write-guard helpers (KEY validation, claim resolution, `:removed` rejection) (§DC.04, §DC.25-§DC.27)

New test files created during Phase-1 implementation:

- `core/src/claims/__tests__/metadata-event.test.ts` — fold determinism (T-Fold-1..5)
- `core/src/claims/__tests__/metadata-ingest.test.ts` — suffix-grammar reconciliation (T-Ingest-1..5)
- `core/src/claims/__tests__/claim-metadata.lossless.test.ts` — lossless invariant (§DC.59, T-Ingest-6)
- `core/src/claims/__tests__/metadata-filters.test.ts` — filter composability (T-Filter-4)
- `core/src/storage/filesystem/filesystem-metadata-storage.test.ts` — adapter happy path + legacy-rejection (T-Migration-5)
- `core/src/storage/filesystem/filesystem-metadata-storage.lock.test.ts` — concurrent-write rejection (T-Lock-1..3)
- `core/src/storage/filesystem/filesystem-metadata-storage.watch.test.ts` — watch coherence (T-Watch-1)
- `core/src/cli/commands/claims/__tests__/verify-command.test.ts` — verify CLI as thin alias (T-Verify-1..6)
- `core/src/cli/commands/claims/__tests__/filter-integration.test.ts` — filter integration on trace/search/gaps (T-Filter-1..3, T-Filter-5)
- `core/src/cli/commands/claims/meta/__tests__/meta-integration.test.ts` — meta CLI end-to-end (T-Meta-Add-1..5, T-Meta-Set-1, T-Meta-Unset-1, T-Meta-Clear-1, T-Meta-Get-1..2, T-Meta-Log-1)
- `core/src/cli/commands/claims/meta/__tests__/meta-structure.test.ts` — Commander wiring assertions
- `core/src/cli/commands/claims/meta/__tests__/shared.test.ts` — write-guard helpers
- `core/src/cli/commands/claims/meta/migrate-legacy-command.test.ts` — one-shot migration command (T-Migration-1..4)

Files deleted during Phase-1 implementation:

- `core/src/claims/verification-store.ts` (§DC.21)
- `core/src/claims/__tests__/verification-store.test.ts`
- `core/src/storage/filesystem/filesystem-verification-storage.ts` (§DC.20)
- `core/src/storage/filesystem/filesystem-verification-storage.test.ts`
