---
created: 2026-04-25
tags: [architecture, claims, metadata, event-log, key-value, storage]
status: draft
---

# A004 - Claim Metadata Store Architecture

**Date:** 2026-04-25
**Status:** Draft
**Scope:** Structural architecture for the generalized claim metadata store specified by {R009}. Defines the event-log substrate, the `MetadataStorage` interface, the two ingest grammars and their reconciliation, the consumer migration philosophy from R005's verification subsystem, and the cross-cutting invariants every implementation MUST preserve.

---

## Overview

The metadata store is an **append-only event log** of `(claimId, key, value, op)` tuples per claim, with a deterministic fold producing a `key → values[]` view. Two ingest grammars feed the same log: a note-body suffix grammar (declarative, parsed at index time, attributed to `author:<notepath>`) and a CLI grammar (imperative, attributed to whatever `--actor` declares). Consumers (the existing `verify` CLI, staleness detection, trace filters, formatters) read folded views or raw events.

```
                  ┌────────────────────────────┐
                  │  AUTHORS                   │
                  │  (note-body suffix tokens) │
                  └─────────────┬──────────────┘
                                │ ingest-time normalization
                                │ (one event per token, actor="author:<path>")
                                ▼
┌─────────────┐    ┌────────────────────────────┐    ┌──────────────────┐
│  CLI USERS  │───▶│   MetadataStorage          │◀───│  LEGACY          │
│ (meta cmd)  │    │   • append-only event log  │    │  verification    │
└─────────────┘    │   • {claimId: Event[]}     │    │  .json migrated  │
                   │   • interface in           │    │  to key=verified │
                   │     storage-backend.ts     │    └──────────────────┘
                   └─────────────┬──────────────┘
                                 │
                                 │ fold(claimId) → Record<key, string[]>
                                 ▼
                  ┌──────────────────────────────────┐
                  │  CONSUMERS                       │
                  │  • verify CLI (log-level alias)  │
                  │  • staleness (filter key=verified)│
                  │  • trace --where KEY=VALUE       │
                  │  • formatters (key access)       │
                  │  • parseClaimMetadata (lossless) │
                  └──────────────────────────────────┘
```

### Key distinctions

| Concern | Model | Example |
|---------|-------|---------|
| **Storage** vs **state** | Events are stored; state is derived by fold | `add reviewer=alice; add reviewer=bob` are events; `reviewer: [alice, bob]` is state |
| **Suffix grammar** vs **event log grammar** | Both produce events; one is declarative-at-ingest, one is imperative-at-runtime | `AC.01:priority=high` becomes an `author:` event; `meta set R009.§1.AC.01 priority=critical` becomes a CLI event |
| **Verification** vs **general metadata** | Verification is one consumer convention on `key=verified`; general metadata is any other key | `verify` CLI writes `verified=true`; `meta add reviewer=alice` writes a different key |
| **Soft retraction** vs **hard deletion** | `unset`/`retract`/`set` are events that change folded state but preserve the log; `compact` and `revert --hard` physically mutate the log and require explicit invocation | Default discipline is "the log is faithful to invocations" |

This architecture extends {A002}'s storage-protocol abstraction. Specifically, it generalizes {A002.§2.AC.04}'s `VerificationStorage` interface into `MetadataStorage`, preserves {A002.§2.AC.06}'s async-signature requirement, and lives behind the same composition root rules established in {A002.§3}.

---

## §1 Core Concepts

### §1.AC.01:5 The store MUST be an append-only event log at the storage layer.

Every successful write appends one or more events to the log. The store MUST NOT modify or delete prior events as a side effect of any write operation. The only operations that physically mutate the log are explicitly destructive and named separately: `compact` (removes superseded events), `revert --hard` (removes a specific event), `import --replace` (clears events for the listed claims). Each of these is opt-in and named "destructive" in its own AC. High binding: append-only is the substrate property that makes provenance, audit, and time-travel queries possible. Violation breaks every consumer that reads the event log directly.

### §1.AC.02:5 The op vocabulary MUST be closed at four operations: `add`, `set`, `unset`, `retract`.

Every event in the log carries an `op` field with one of these four values. No additional ops are permitted. Higher-level commands (e.g., `clear`, `replace`) MUST decompose into sequences of the four primitives at write time, not into new op values. Closed vocabulary is what makes the fold rule (§1.AC.03) finite and verifiable.

### §1.AC.03:5 The fold rule MUST produce a deterministic `Record<key, string[]>` view.

For every `(claimId, key)` pair, applying the events in chronological order produces a list of current values. The fold rule per op:

| Op | Effect on `values[]` for that key |
|----|-----------------------------------|
| `add value` | Append `value` if not present (idempotent at the view level; both events still in log) |
| `set value` | Clear `values[]`, then append `value` (atomic: a single event encodes both effects) |
| `unset` | Clear `values[]` (event's `value` field MUST be `""`) |
| `retract value` | Remove `value` from `values[]` if present; no-op if absent |

The fold MUST be deterministic — given the same event sequence, every implementation produces the same `Record<key, string[]>`. Keys with empty `values[]` after fold MUST NOT appear in the result. High binding: every read consumer depends on this. Any change to fold semantics is a breaking change.

### §1.AC.04 Author-event convention: implicit events from suffix tokens MUST carry `actor` prefix `"author:"`.

The two ingest grammars are distinguishable by the `actor` field. Implicit events from note-body suffix tokens MUST set `actor = "author:<notepath>"` where `<notepath>` is the relative path from the project root to the note file declaring the claim. CLI events MUST NOT use the `author:` prefix — they carry whatever `--actor` flag was passed (default: OS username). Consumers that need "what did the author declare" filter on this prefix.

### §1.AC.05 Storage location is per-project; no cross-project metadata.

The store is rooted in a single project's `_scepter/` directory. Events reference claims in the project's own claim index. There is no federation, sync, or cross-project query. This matches {R006}'s scope rule and the broader SCEpter convention.

### §1.AC.06:4 Concurrent writes MUST be detected and rejected.

The filesystem adapter MUST acquire an exclusive lock (e.g., advisory file lock via `lockfile` or equivalent) before any write. If the lock cannot be acquired within a short timeout (default: 2 seconds), the write MUST be rejected with a clear error message naming the conflicting writer where possible. The operation MUST NOT silently retry, queue, or merge with the concurrent writer. Reads MAY proceed without locking — the append-only invariant guarantees that any partially-flushed write is either fully visible or fully absent at the event-array boundary.

Reject-on-contention is the right semantic because: (a) two CLI processes writing simultaneously is rare and indicates a workflow problem the user should see, (b) merge or queue semantics introduce hidden ordering ambiguity that contradicts the deterministic-fold invariant (§1.AC.03), and (c) the failure mode is recoverable — the rejected user retries.

---

## §2 Interface Definitions

### §2.AC.01:5 `MetadataEvent` MUST have exactly the following fields.

```typescript
interface MetadataEvent {
  id: string;              // ULID, generated at append time (see §6 OQ resolution)
  claimId: string;         // fully qualified claim ID (e.g., "R009.§1.AC.01")
  key: string;             // matches /^[a-z][a-z0-9._-]*$/
  value: string;           // UTF-8 string; empty iff op === "unset"
  op: "add" | "set" | "unset" | "retract";
  actor: string;           // free-form label; "author:<path>" or any other string
  date: string;            // ISO 8601 YYYY-MM-DD
  note?: string;           // optional free-text annotation
}
```

This is the wire format, the storage format, and the in-memory format — one shape, no transformations. High binding: every reader, writer, migration, and downstream tool depends on this.

### §2.AC.02 `MetadataStorage` interface MUST live at `core/src/storage/storage-backend.ts`.

```typescript
interface MetadataStorage {
  load(): Promise<MetadataStore>;
  save(store: MetadataStore): Promise<void>;
  append(event: MetadataEvent): Promise<void>;
  query(filter: EventFilter): Promise<MetadataEvent[]>;
  fold(claimId: string): Promise<Record<string, string[]>>;
  watch?(callback: (event: StorageEvent) => void): Unsubscribe;
}

type MetadataStore = Record<string, MetadataEvent[]>; // claimId → events

interface EventFilter {
  claimId?: string;
  key?: string;
  actor?: string;
  op?: MetadataEvent["op"];
  since?: string;  // YYYY-MM-DD
  until?: string;
}
```

### §2.AC.03:5 `MetadataStorage` REPLACES `VerificationStorage`. The two interfaces MUST NOT coexist.

`VerificationStorage` ({A002.§2.AC.04}) and its filesystem adapter (`FilesystemVerificationStorage`) are removed in favor of `MetadataStorage` and `FilesystemMetadataStorage`. `ProjectManager.verificationStorage` is renamed `metadataStorage`. The legacy verification CLI continues to work (§4) but reads/writes through `MetadataStorage`. This is a hard boundary — parallel coexistence creates two stores that drift, exactly the problem we're avoiding. High binding: composition-root change ripples through every consumer.

### §2.AC.04 The filesystem adapter MUST persist to `_scepter/verification.json`.

The legacy filename is preserved (resolves R009 OQ.01). Renaming would force every project through a one-time migration with no functional benefit — the contents of the file are a strict superset of legacy verification events, but the storage location is unchanged. Future renaming is not blocked: `ConfigStorage.load()` may surface a configurable `metadataStorePath` setting in a downstream phase.

### §2.AC.05 Event identifiers MUST be ULIDs.

Each event carries a ULID generated at append time (resolves R009 OQ.02). ULIDs are 26 characters, lexicographically sortable by generation time, and survive log compaction (an array index would not). The choice is final — alternatives considered in §6.

### §2.AC.06 The interface MUST follow {A002.§2.AC.06} (async signatures throughout).

Every method returns a `Promise`, even for the filesystem adapter where some operations could be synchronous. Required for compatibility with future backends (REST, database) per A002's existing rule.

---

## §3 Ingest Paths and Reconciliation

Two ingest grammars produce events. The architecture's job is to keep them composable without conflict.

### §3.AC.01:4 Suffix-token ingest MUST emit one event per token.

When the claim index is built (or rebuilt), every `key=value` token in a claim's metadata suffix produces one implicit event with `op="add"`, `actor="author:<notepath>"`, `date = <note file mtime as YYYY-MM-DD>`, and `note = "inline"`. Bare-token shorthands (`:5`, `:closed`, `:deferred`, `:removed`, `:superseded=TARGET`, `:derives=TARGET`, freeform tags) normalize to k=v form before becoming events, per the rules in §3.AC.02. High binding: every R005-era claim in every project carries such tokens, and this rule governs how they enter the generalized store.

### §3.AC.02 Bare-token shorthand normalization MUST be lossless.

| Shorthand | Normalized event(s) |
|-----------|---------------------|
| `:5` (digit 1-5) | `importance=5` |
| `:closed` | `lifecycle=closed` |
| `:deferred` | `lifecycle=deferred` |
| `:removed` | `lifecycle=removed` |
| `:superseded=TARGET` | `lifecycle=superseded` AND `supersededBy=TARGET` (two events) |
| `:derives=TARGET` | `derives=TARGET` |
| `:freeform` (digit-less, no `=`) | `tag=freeform` |

The reconstruction invariant: applying `parseClaimMetadata()` to a claim's suffix and reconstructing `ParsedMetadata` from the folded state of its implicit events MUST produce identical results. This is the load-bearing rule that makes back-compat work — every existing R005-era consumer of `parseClaimMetadata` continues to see the same shape.

### §3.AC.03:4 Re-ingest reconciliation MUST be incremental.

When a claim's note is re-indexed (file mtime changed, claim re-parsed), the ingest path MUST reconcile per token: emit `retract` events for tokens the author removed, emit `add` events for tokens the author added, leave unchanged tokens untouched. A compound "reconciliation event" MUST NOT be used (resolves R009 OQ.03). High binding: this rule is what makes the event log faithful to author edits at token granularity rather than collapsing them into opaque snapshots. The verbosity cost is acceptable — `compact` exists for log compression.

### §3.AC.04 Implicit-event idempotence: re-ingest of an unchanged token MUST be a no-op.

If a token is present in the suffix and an `author:` event already exists for it with the same key=value, re-ingest MUST NOT emit a new event. This prevents log churn on every index rebuild for unchanged source files.

### §3.AC.05 Watch mode MUST observe the metadata store file alongside note files.

When SCEpter is running in watch mode (the existing chokidar-based mechanism in `unified-discovery` and `note-manager`), the `MetadataStorage` filesystem adapter MUST register a watcher on its backing file (`_scepter/verification.json`). On file change, the storage MUST re-load the event log and emit a change notification via the optional `watch?` callback (§2.AC.02). Consumers that maintain folded-state caches (formatters, trace renderers, the long-running CLI in chat sessions) MUST subscribe and refresh on change.

This makes the metadata store first-class in the project's reactive surface — the same way note edits trigger re-indexing today, external edits or out-of-band writes to `verification.json` (e.g., from a sibling process or a manual edit) are observed and reflected. Watch is opt-in at the consumer level (matching A002's `watch?` optional method); not every consumer needs to subscribe.

---

## §4 Consumer Migration Philosophy

Existing consumers (verify CLI, staleness, trace formatters, parseClaimMetadata) MUST continue to work. The migration philosophy distinguishes three patterns: **thin alias** (consumer becomes a wrapper over the meta CLI), **filtered read** (consumer reads the generalized store with a key filter), and **shape preservation** (consumer's data shape stays identical via fold).

### §4.AC.01:5 The `verify` CLI's data path MUST be a log-level alias, not a meta-CLI thin alias.

This resolves the reviewer's blocker on R009 §7.AC.06. The plain `verify CLAIM_ID --remove` operation pops the latest verification event — it is a log-level pop, not a state-level retract. Reasoning: under the generalized fold, multiple `add verified=true` events deduplicate into the single state value `[true]`. A meta-level `remove verified=true` would clear the entire verified state, equivalent to `--remove --all`. Preserving legacy `--remove` semantics requires operating at the event-log layer (pop the most recent matching event, not the state value). The mapping:

| Legacy verify CLI | Generalized implementation |
|-------------------|----------------------------|
| `verify CLAIM` | `metadataStorage.append({op: "add", key: "verified", value: "true", ...})` |
| `verify CLAIM --actor A --method M` | Same, with `actor=A`, `note="method=M"` |
| `verify CLAIM --remove` | Pop the most recent matching event (log-level operation, no `meta` equivalent) |
| `verify CLAIM --remove --all` | `metadataStorage.append({op: "unset", key: "verified", value: "", ...})` |

The `verify` command keeps its argument shape, flags, and observable behavior. Its internal data path goes through `MetadataStorage`. The asymmetry — `--remove` is log-level, `--remove --all` is state-level — is preserved exactly because changing it would break every script that depends on the current verify CLI.

### §4.AC.02 Staleness MUST default to filtering on `key="verified"`, configurable.

R005 §4 (Staleness Detection) continues to work. The input source generalizes from "the verification store" to "events in the metadata store with `key=verified`." The default key is `"verified"`. A future configuration option (`scepter.config.json` field, e.g., `staleness.key`) MAY override the default per-project, but the default is the only thing the system enforces. R005 §4's ACs remain valid; only the input source changes.

### §4.AC.03 `parseClaimMetadata()` shape MUST be reconstructible from the folded state.

Every existing caller of `parseClaimMetadata(rawMetadata)` (`ClaimIndex`, the linter, formatters) continues to work without source changes. The lossless-normalization invariant from §3.AC.02 is what makes this possible: given a claim's folded state from implicit events, the `ParsedMetadata` shape (`importance`, `lifecycle`, `derivedFrom`, `tags`) is mechanically reconstructible. Internally, `parseClaimMetadata` MAY be reimplemented as a thin adapter that calls `metadataStorage.fold(claimId)` and projects to the legacy shape, OR may continue to operate on raw token strings — both are valid implementations of this AC.

### §4.AC.04 Formatters MUST gain key-access affordances.

`claim-formatter.ts` and related output paths currently read `entry.metadata` (raw tokens), `entry.importance`, `entry.lifecycle`, and `entry.derivedFrom`. After this architecture lands, formatters MUST gain a key-access path (e.g., `entry.metadataState[key]`) that reads from the folded view. Legacy fields (`importance`, `lifecycle`) continue to render via §4.AC.03's reconstructed shape. Custom keys (`reviewer`, `priority`, etc.) render via the new key-access path.

---

## §5 Cross-Cutting Invariants

These invariants apply across every section of the architecture. Implementation conformance MUST preserve all of them.

| Invariant | Statement | Consequence of violation |
|-----------|-----------|--------------------------|
| **Append-only** (§1.AC.01) | Writes never modify prior events; only `compact`, `revert --hard`, `import --replace` mutate the log | Provenance is destroyed; audits become impossible |
| **Closed op vocabulary** (§1.AC.02) | The four ops are the entire grammar | Fold rule becomes undefined for new ops; consumers break |
| **Fold determinism** (§1.AC.03) | Same event sequence → same folded state, in every implementation | Cross-implementation drift; consumer behavior diverges |
| **Lossless normalization** (§3.AC.02) | Suffix tokens round-trip through the store with no semantic loss | R005-era consumers see different data; back-compat collapses |
| **Author-event tagging** (§1.AC.04) | Implicit events carry `actor="author:..."` | "What did the author say" filter becomes unimplementable |
| **Per-project scope** (§1.AC.05) | Store is rooted in `_scepter/`; no cross-project federation | Conflicts with R006 derivation scope; introduces sync semantics out of scope |
| **Reject-on-contention** (§1.AC.06) | Concurrent writers detected via file lock; second writer rejected | Hidden ordering ambiguity; deterministic fold collapses |
| **Durability** (R009 §1.AC.12) | Successful writes are visible to a subsequent read in a new process | Race conditions; lost writes |
| **Watch coherence** (§3.AC.05) | External changes to the metadata file are observed; subscribed consumers re-fold | Stale reads in long-running processes; UI/CLI drift |

---

## §6 R005 Supersession Boundary

R009 §7.AC.10 declared R005 §3 "partially superseded" without a crisp boundary. This section closes that gap.

### §6.AC.01 R005 supersession boundary, by AC

| R005 AC | Status | Mechanism |
|---------|--------|-----------|
| §3.**AC.01** (verification.json file path) | **Preserved** | Filename unchanged per §2.AC.04; consumers see the same path |
| §3.**AC.02** (`VerificationEvent` interface) | **Superseded by A004.§2.AC.01** | Generalized to `MetadataEvent`; legacy events migrate at load time |
| §3.**AC.03** (verify CLI creates event) | **Preserved** | CLI argument shape and behavior unchanged per §4.AC.01 |
| §3.**AC.04** (`--actor` flag) | **Preserved** | Unchanged; carried through to `MetadataEvent.actor` |
| §3.**AC.05** (`--method` flag) | **Preserved** | Unchanged; mapped to `MetadataEvent.note` as `"method=..."` |
| §3.**AC.06** (append-only) | **Superseded by A004.§1.AC.01** | Elevated to architectural invariant; same property, named explicitly |
| §3.**AC.07** (trace shows latest verification) | **Preserved** | Renderer reads folded state filtered on `key=verified`; output unchanged |
| §3 edge case "Verification of Removed Claims" | **Preserved** | Continues to hold via R009 §2.AC.09 (this is the rule misattributed in R009 §7.AC.07) |
| §1 (Importance) all ACs | **Preserved as shorthand** | Bare-digit `:5` normalizes to `importance=5` per §3.AC.02; vocabulary in force |
| §2 (Lifecycle) all ACs | **Preserved as shorthand** | Bare-token `:closed` etc. normalize to `lifecycle=closed`; vocabulary in force |
| §4 (Staleness) all ACs | **Preserved with generalized input** | Reads from `key=verified` filter per §4.AC.02; AC text unchanged |
| §5 (Command Surface Integration) all ACs | **Preserved** | Index summary, lint validation, JSON output all continue to work |

### §6.AC.02 R005 ACs that supersede MUST be marked with `:superseded=A004.§N.AC.NN`.

The R005 file MUST be updated to add `:superseded=A004.§1.AC.01` on §3.AC.06 and `:superseded=A004.§2.AC.01` on §3.AC.02. No other R005 ACs are superseded — the rest are preserved.

---

## §7 Stress Testing

### Scenario 1: Legacy verification.json migration

**Setup:** A project with `_scepter/verification.json` containing 50 events from the old `VerificationEvent` shape (`{claimId, date, actor, method?}`), some with the legacy `timestamp` field.

**Data flow:**
1. `FilesystemMetadataStorage.load()` opens `verification.json`.
2. For each event, the loader applies the existing `timestamp → date` normalization (`verification-store.ts:64-71` precedent), THEN maps to `MetadataEvent` with `key="verified"`, `value="true"`, `op="add"`, preserving `actor`, `date`, and setting `note = method ? "method=" + method : undefined`.
3. The loader generates a ULID for each migrated event (id field is new in A004).
4. The store is in-memory ready; subsequent `verify` CLI calls and `trace --where verified=true` filters work identically to the legacy world.

**Verdict:** Holds. Migration is a pure projection at load time; no on-disk rewrite required. Round-trip invariant: `getLatestVerification(legacy_store, claimId)` and `metadataStorage.fold(claimId).verified[0]` produce equivalent results.

### Scenario 2: Author edits a claim's suffix

**Setup:** A note has `### AC.01:priority=high:reviewer=alice`. After CLI calls have added `add reviewer=bob`, the author edits the note to `### AC.01:priority=critical:reviewer=alice` (changed priority, removed nothing of theirs).

**Data flow:**
1. Note re-index detects the change (file mtime newer than last index).
2. Suffix tokens parse: `{priority=critical, reviewer=alice}`.
3. Reconciliation per §3.AC.03: existing `author:` events for this claim are compared.
   - `priority=high` (author event) → not in new suffix → emit `retract` event with `actor="author:..."`.
   - `priority=critical` → not in old author events → emit `add` event.
   - `reviewer=alice` → unchanged → no event (idempotence per §3.AC.04).
4. CLI-written events (`reviewer=bob`) are untouched — only events with `author:` prefix are reconciled.

**Verdict:** Holds. Author intent is faithfully reflected; CLI-written state coexists. Folded result: `priority: [critical], reviewer: [alice, bob]`.

### Scenario 3: Custom key with multi-value semantics

**Setup:** Project convention: track multiple reviewers under `reviewer` key. Three CLI calls: `meta add R009.§1.AC.01 reviewer=alice`, `meta add reviewer=bob`, `meta add reviewer=charlie`.

**Data flow:**
1. Three `add` events appended to the log, each with its own ULID, actor (OS username), and date.
2. Fold for `R009.§1.AC.01` produces `reviewer: [alice, bob, charlie]`.
3. `scepter claims trace R009 --where reviewer=alice` includes the claim. `--where reviewer=david` excludes it. `--has-key reviewer` includes it.

**Verdict:** Holds. Multi-value is the default; consumers compose filters.

### Scenario 4: Compaction after many events

**Setup:** Over 6 months, a claim has accumulated 200 events: 50 `set verified=true` (re-verifications), 100 `add tag=...` (various), 50 `unset` operations. Log size becomes a concern.

**Data flow:**
1. `scepter claims meta compact R009.§1.AC.01` runs.
2. The compactor folds the events to current state, then synthesizes a minimal event sequence reproducing that state: one `set` per current key with one value, `add` events for additional values, no orphan `retract`/`unset` events.
3. Log shrinks (e.g., 200 → 8 events). Folded state is identical.
4. Subsequent `revert --event <ULID>` against a compacted-away event reports "event not in log" per R009 §6 edge case.

**Verdict:** Holds, with the documented trade-off: compaction trades history depth for log size. Users who need full history avoid compaction or run it with `--keep-last N`.

---

## §8 Design Decisions

### Adopted: Event-sourcing-with-fold pattern

Storage is the event log; views are folds. Reads compute current state on demand from the log.

**Alternatives considered:**
- *State-as-storage with optional history* — Store current state primarily, append events as a side-channel audit log. **Rejected**: two sources of truth that drift; defeats the audit purpose; requires more migration code than the unified approach.
- *Pure command log without fold* — Store invocations as opaque commands and let consumers replay them. **Rejected**: every consumer reimplements fold; no canonical view; debugging becomes execution-trace-archeology.

### Adopted: Closed four-op grammar (`add`/`set`/`unset`/`retract`)

Higher-level operations decompose into these four primitives at write time.

**Alternatives considered:**
- *Open op vocabulary with consumer-defined ops* — Let consumers introduce custom ops like `increment` or `merge`. **Rejected**: fold rule becomes undefined for unknown ops; cross-consumer interaction explodes; closed vocabulary is the load-bearing simplification.
- *Three ops without `retract`* — Drop `retract` and use `set` for all "remove" cases. **Rejected**: `retract value` (remove one specific value from a multi-value key) has no clean expression in `set` alone; removing it forces consumers to read-then-set, which is racy.

### Adopted: `MetadataStorage` replaces `VerificationStorage` (no coexistence)

The new interface supersedes the old. The legacy adapter is removed.

**Alternatives considered:**
- *Coexist with `VerificationStorage` as a thin wrapper* — Keep both interfaces, have `VerificationStorage` delegate to `MetadataStorage` internally. **Rejected**: two interfaces in `storage-backend.ts` that mean the same thing; surface area inflation; long-term maintenance burden.
- *Keep `VerificationStorage` and add `MetadataStorage` as parallel* — Two stores, two files, two migration paths. **Rejected**: drift inevitable; conflicts when the same claim has both verification events and metadata; defeats the unification purpose.

### Adopted: Sidecar filename remains `verification.json`

Resolves R009 OQ.01.

**Alternatives considered:**
- *Rename to `meta.json`* — Semantically cleaner. **Rejected**: forces every project through a one-time file rename for zero functional benefit; the file's semantics generalize but its location is unchanged.
- *Configurable filename via `scepter.config.json`* — Maximum flexibility. **Rejected**: introduces a config field that 99% of users will never touch; the default-only path is simpler and can be extended later if real demand emerges.

### Adopted: ULID per event

Resolves R009 OQ.02.

**Alternatives considered:**
- *Auto-incrementing integer counter* — Smallest, simplest. **Rejected**: doesn't survive compaction (renumbering breaks references); doesn't sort well across distributed scenarios (relevant if backends ever diverge).
- *Content hash (SHA of event fields)* — Naturally unique. **Rejected**: long (64+ chars); collides if two identical events are deliberately recorded (allowed in the model); slow to compute.
- *UUID v4* — Common. **Rejected**: not lexicographically sortable; ULID gets the time-ordering property for free.

### Adopted: Incremental re-ingest reconciliation

Resolves R009 OQ.03.

**Alternatives considered:**
- *Transactional reconciliation (one compound event per claim per re-index)* — Compact log. **Rejected**: collapses per-token provenance; "what changed in the author's last edit" becomes invisible.
- *Snapshot replacement (clear all `author:` events, re-emit)* — Simple. **Rejected**: every re-index churns the log even for unchanged tokens; defeats §3.AC.04 idempotence.

### Adopted: `verify --remove` is a log-level pop, not a state-level retract

Resolves the reviewer's blocker on R009 §7.AC.06.

**Alternatives considered:**
- *Map `verify --remove` to `meta remove verified=true`* — Surface-level consistency. **Rejected**: under fold semantics, `meta remove verified=true` clears the entire verified state (equivalent to `--remove --all`); breaks legacy semantics.
- *Deprecate `verify --remove` and redirect to `meta` CLI* — Long-term cleanup. **Rejected**: violates R009 §7.AC.04's "MUST continue to work...behavior" promise; out of scope for this architecture.

### Adopted: Staleness defaults to `key="verified"`, configurable

**Alternatives considered:**
- *Hardcoded `verified` key with no override* — Simplest. **Rejected**: projects with custom verification workflows (e.g., `key="audited"`) lose flexibility.
- *Required configuration with no default* — Explicit. **Rejected**: every project pays the configuration tax; the default is correct for 95% of cases.

### Adopted: Author actor convention `actor="author:<notepath>"`

**Alternatives considered:**
- *Single `actor="author"` constant* — Simpler. **Rejected**: loses notepath provenance; useful for "events declared in this file" filters during refactors.
- *Structured actor field with `type` and `path`* — More queryable. **Rejected**: changes the `MetadataEvent` shape; string-based filter (`actor.startsWith("author:")`) is sufficient.

### Adopted: Lossless normalization with `parseClaimMetadata()` shape

**Alternatives considered:**
- *Drop `ParsedMetadata` and force consumers to read folded state directly* — Cleaner long-term. **Rejected**: would require rewriting every consumer of `parseClaimMetadata()` in this same change; combinatorial blast radius.
- *Hard-deprecate `parseClaimMetadata` after one phase* — Forces migration. **Rejected**: out of scope; this architecture is about substrate generalization, not API churn.

### Adopted: ULID-based event IDs added to MVS schema

R009 §8 Phase-1 MVS includes `MetadataEvent` schema (§1.AC.01). The ULID id field is part of the schema from day one, even though `revert` (which uses it) is deferred to a later phase. Adding the id later would be a non-breaking schema extension, but adding it up front is simpler and supports the "log is faithful to invocations" property even before revert ships.

### Adopted: Compaction algorithm is fold-then-synthesize-minimal-sequence

`compact` folds the targeted events to current state, then synthesizes a minimal event sequence that reproduces that state from scratch (typically: one `set` per current key with one value, one or more `add` events for additional values, no orphan `retract`/`unset` events). Surviving events get fresh ULIDs at compaction time.

**Alternatives considered:**
- *Peephole removal of provably-redundant pairs (`add X; retract X`)* — Preserves ULIDs of unaffected events and original temporal ordering. **Rejected**: complexity grows with the set of recognized peephole patterns; users running `compact` have already opted into history loss; the simpler algorithm matches the "shrink my log" mental model.
- *Hybrid (peephole within recent window, fold-and-synthesize for older)* — Best of both. **Rejected**: introduces two algorithms maintained in parallel; the `--keep-last N` and `--older-than DATE` flags already give users granularity controls without algorithm complexity.

The fold-equivalence invariant (R009 §6.AC.03) is the binding requirement; this decision specifies the algorithm that satisfies it. Users who need to preserve ULID identity for cross-system references should not run `compact`.

### Adopted: Concurrent writes are detected and rejected via file-level locking

The filesystem adapter acquires an exclusive lock on `verification.json` (or its lock-sidecar) before any write. If acquisition fails within a 2-second timeout, the write is rejected with an error.

**Alternatives considered:**
- *Last-write-wins* — Simplest. **Rejected**: silently drops one writer's work; defeats the audit purpose of an event log.
- *Optimistic merge (CRDT-style or content-addressed)* — Most robust. **Rejected**: massively over-engineered for a local-only single-user-typical workflow; the implementation cost dwarfs the use-case frequency.
- *Queue-and-retry* — Hides contention. **Rejected**: hidden ordering creates non-determinism that violates §1.AC.03's fold determinism invariant; users should see the contention.

### Adopted: Watch mode observes the metadata store

The `MetadataStorage` filesystem adapter registers a chokidar watcher on `verification.json` when watch mode is enabled. Consumers subscribe via the `watch?` callback to refresh folded state caches.

**Alternatives considered:**
- *Polling (re-load on every read)* — Simplest. **Rejected**: O(N) reads per session; doesn't scale and creates UI jank in long-running processes.
- *Watch mode opt-in per consumer with no central observer* — Most flexible. **Rejected**: every consumer reimplements file watching; chokidar resource costs multiply; consumer order-of-load determines who sees what.
- *No watch integration; require restart on store changes* — Simplest to skip. **Rejected**: violates the existing SCEpter watch-mode invariant where external file edits propagate; surprising drift between note and metadata reactivity.

---

## §9 Open Questions

All architectural open questions are resolved. R009 OQs are addressed in §6 / §8 above. The three A004 OQs raised during initial drafting are settled by the new ACs:

- **Compaction algorithm specifics** → resolved by §8 "Compaction algorithm is fold-then-synthesize-minimal-sequence" with R009 §6.AC.03 as the binding fold-equivalence invariant.
- **Concurrent writer semantics** → resolved by §1.AC.06 (detect and reject via file lock).
- **Watch-mode integration** → resolved by §2.AC.02 (interface gains `watch?`) and §3.AC.05 (filesystem adapter registers watcher).

Any further open questions belong in the downstream DD or a follow-up requirement.

---

## References

- {R009} — Claim Metadata Key-Value Store (the requirement this architecture realizes)
- {R009.§1} — Event log storage model (architectural primitives elevated here)
- {R009.§7.AC.10} — Partial-supersession declaration (boundary made crisp in §6)
- {R005} — Claim Metadata, Verification, and Lifecycle (back-compat parent)
- {R005.§3.AC.02} — `VerificationEvent` interface (superseded by §2.AC.01)
- {R005.§3.AC.06} — Append-only store semantics (superseded by §1.AC.01)
- {R005.§4} — Staleness Detection (preserved with generalized input per §4.AC.02)
- {R006} — Claim Derivation Tracing (coexists; `derives` key queryable via generalized surface)
- {A002} — Backend Agnosticism — Storage Protocol Extraction (parent architecture)
- {A002.§2.AC.04} — `VerificationStorage` interface (replaced per §2.AC.03)
- {A002.§2.AC.06} — Async signature requirement (preserved)
- {A002.§3} — Composition root rules (followed)
- `core/src/storage/storage-backend.ts` — host file for the new interface
- `core/src/claims/verification-store.ts` — being generalized; legacy migration precedent at lines 64-71
- `core/src/cli/commands/claims/verify-command.ts:97` — `:removed` rejection rule preserved per §6
