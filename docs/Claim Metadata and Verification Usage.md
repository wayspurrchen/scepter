# Claim Metadata and Verification — Usage Guide

**Status:** stable (post-DD014 Phase 1, 2026-04-25)
**Audience:** humans and AI agents using SCEpter to attach metadata to claims, mark them verified, and filter on stored data
**Source artifacts:** R009 (requirement), A004 (architecture), DD014 (implementation blueprint)

---

## What this is

Every claim in a SCEpter project (an AC, a DC, a section, an OQ — anything addressable like `R009.§1.AC.01`) can carry free-form key-value metadata. Examples: `verified=true`, `reviewer=alice`, `priority=P0`, `tag=security`. The data lives in `_scepter/verification.json` as an append-only event log; each event records who wrote it, when, with what intent. A deterministic fold over the log produces the current state for any claim.

Two ways data enters the store:
1. **CLI commands** — explicit `scepter meta ...` and `scepter verify ...` invocations (this doc focuses here)
2. **Suffix-grammar ingest** — tokens on note headings like `### AC.01:5:reviewer=alice` flow into the same log automatically when the claim index rebuilds

Three ways data leaves the store:
1. **`meta get` / `meta log`** — direct read
2. **Folded state used by other commands** — `staleness` reads `verified`; `trace`/`gaps`/`search` filter on arbitrary keys
3. **Suffix reconstruction** — author tokens come back out via `parseClaimMetadata` for legacy R005-shape consumers

---

## The conceptual model in 60 seconds

### Events

Every write produces one event:

```typescript
interface MetadataEvent {
  id: string;              // 24-char cuid2, generated at append time
  claimId: string;         // e.g., "R009.§1.AC.01"
  key: string;             // /^[a-z][a-z0-9._-]*$/
  value: string;           // empty iff op === "unset"
  op: "add" | "set" | "unset" | "retract";
  actor: string;           // free-form; "author:<path>" for suffix-ingest events
  date: string;            // ISO 8601 datetime, e.g., "2026-04-25T15:30:42.123Z"
  note?: string;
}
```

Events are ordered by their position in the per-claim array. The cuid2 ID is unique but NOT time-sortable.

### Fold rule

| Op | Effect on `values[]` for that key |
|----|-----------------------------------|
| `add value` | Append if not present (idempotent at view; both events stay in log) |
| `set value` | Clear `values[]`, then append (atomic replace) |
| `unset` | Clear `values[]` (event's `value` field is `""`) |
| `retract value` | Remove if present, no-op if absent |

Keys with empty `values[]` after fold disappear from the result. Multi-value is the default; `set` enforces single-value semantics atomically.

### Worked example

```
e1: add reviewer=alice
e2: add tag=security
e3: add tag=security    (duplicate — recorded but doesn't change state)
e4: add reviewer=bob
e5: set reviewer=carol  (clears [alice, bob], appends [carol])
e6: add tag=blocker
e7: retract tag=security
e8: add verified=true
e9: unset reviewer

Final folded state:
  tag: ["blocker"]
  verified: ["true"]
  (reviewer absent — unset cleared it)
```

The log retains all 9 events forever. The fold is a projection.

---

## CLI reference

All commands live under `scepter meta` (top-level). The legacy form `scepter claims meta ...` works via backward-compat alias but emits a deprecation banner — prefer the top-level form.

### Write commands

#### `scepter meta add CLAIM KEY=VALUE [KEY=VALUE...] [options]`

Append `add` events. Idempotent at the view level: repeated `add CLAIM tag=blocker` produces multiple events but one current value.

| Option | Default | Effect |
|--------|---------|--------|
| `--actor <name>` | OS username (fallback `"cli"`) | Recorded verbatim on each event |
| `--date <ISO-8601>` | `now()` as full ISO datetime | Accepts `YYYY-MM-DD` (treated as start-of-day UTC) or full datetime |
| `--note <text>` | (none) | Free-form note attached to each event |

Validation gates (atomic — any failure means zero events recorded):
- KEY must match `/^[a-z][a-z0-9._-]*$/`
- Claim ID must resolve against the claim index
- Claim must not be `:removed` (lifecycle rejection rule preserved from `verify`)

Examples:
```
scepter meta add R009.§1.AC.01 reviewer=alice
scepter meta add R009.§1.AC.01 reviewer=bob priority=high tag=security
scepter meta add R009.§1.AC.01 verified=true --actor reviewer-team --date 2026-04-25 --note "passed code review"
```

#### `scepter meta set CLAIM KEY=VALUE [KEY=VALUE...] [options]`

Atomic single-value replace. The `set` event clears prior values for the key and records the new value. Use for keys that are scalar by convention (`priority`, `assignee`, `lifecycle`).

```
scepter meta set R009.§1.AC.01 priority=P0
scepter meta set R009.§1.AC.01 priority=P1
# folded: priority: [P1]   (not [P0, P1])
```

#### `scepter meta unset CLAIM KEY [KEY...] [options]`

Clear named keys (the key disappears from folded state). Bare keys only — passing `KEY=VALUE` to `unset` is rejected at parse time. Records one `unset` event per key.

```
scepter meta unset R009.§1.AC.01 reviewer
scepter meta unset R009.§1.AC.01 reviewer priority tag
```

#### `scepter meta clear CLAIM [options]`

Clear every key with current values. Implementation: fold the claim, iterate keys, append one `unset` per. Empty fold is a no-op (`"No metadata to clear."`, exit 0).

```
scepter meta clear R009.§1.AC.01
```

#### `scepter meta migrate-legacy`

One-shot migration of legacy `verification.json` shape (R005 verification events) into the new event log. Run once per project upgrade.

Behavior matrix:
- File missing → exit 0, "No legacy verification.json found"
- File already migrated → exit 0, "already migrated"
- File mixed-shape → exit non-zero, refuse to proceed
- Otherwise → rewrite file in-place, exit 0

Until this runs, `MetadataStorage.load()` rejects legacy-shape input — every other CLI command will fail with a directive to run `migrate-legacy` first. Idempotent; safe to re-run.

### Read commands

#### `scepter meta get CLAIM [KEY] [--json]`

Without KEY: prints the entire folded state for the claim. Single-value keys render as `key: value`; multi-value as `key: [v1, v2, ...]`. Empty fold prints nothing (exit 0 — empty metadata is not an error).

With KEY: prints values for that key, one per line. Missing key exits non-zero (scriptable distinguishability between "empty" and "missing").

`--json` shapes:
- No-key form: `{state: Record<string, string[]>}`
- Key form: `{values: string[]}`

```
scepter meta get R009.§1.AC.01
scepter meta get R009.§1.AC.01 reviewer
scepter meta get R009.§1.AC.01 --json
```

#### `scepter meta log CLAIM [--json]`

Chronological event log for the claim. Each line shows op, key, value (omitted for `unset`), actor, date, and note (if present). Reads via the storage layer's filtered query.

`--json` emits a `MetadataEvent[]` array.

Phase 1 only filters by claimId. Filter flags (`--key`, `--actor`, `--since`, `--until`, `--op`) are reserved for Phase 2 — the `EventFilter` type carries them so adding them later is non-breaking.

```
scepter meta log R009.§1.AC.01
scepter meta log R009.§1.AC.01 --json
```

### Verify CLI (thin alias)

Preserved as a convenience for the most common pattern. Functionally a thin alias to `meta` writes after DD014's rewire.

```
scepter verify CLAIM
scepter verify CLAIM --actor A --note N
scepter verify CLAIM --remove
scepter verify NOTE_ID            # bulk: every claim in the note
scepter verify NOTE_ID --remove   # bulk: unset for every claim
scepter verify CLAIM --reindex    # force claim-index rebuild first
```

Mapping to `meta`:

| Invocation | Equivalent `meta` operation |
|------------|------------------------------|
| `verify CLAIM` | `meta add CLAIM verified=true` |
| `verify CLAIM --note N` | `meta add CLAIM verified=true --note N` |
| `verify CLAIM --remove` | `meta unset CLAIM verified` |

Removed flags (post-DD014): `--method` (use `--note`), `--all` (gone — `--remove` always state-level wipes).

The `:removed` lifecycle rejection rule and `--reindex` flag carry over verbatim.

### Filter integration

`trace`, `gaps`, and `search` (claim search subset) gain three repeatable options that compose AND-style with each other and with all existing filters:

| Flag | Semantic |
|------|----------|
| `--where KEY=VALUE` | Claim's folded state has KEY containing VALUE |
| `--has-key KEY` | Claim's folded state has KEY (any value) |
| `--missing-key KEY` | Claim's folded state has no KEY |

KEY validation is the same as write-side: `/^[a-z][a-z0-9._-]*$/`, enforced at parse time.

```
scepter trace R009 --where verified=true
scepter trace R009 --where reviewer=alice --importance 4
scepter gaps --has-key reviewer
scepter gaps --missing-key verified --note-type Requirement
scepter search "auth" --where lifecycle=active
```

`--importance N` continues to work as it always did. Internally, after the suffix-grammar ingest lands, importance is just another key in the fold; `--importance N` is equivalent to `--where importance=N`.

---

## Suffix-grammar ingest (the markdown side)

Author-written suffix tokens on claim headings flow into the same event log automatically. A heading like:

```markdown
### AC.01:5:reviewer=alice:tag=security
```

produces three events (after the next claim-index rebuild):

```
{op: "add", key: "importance", value: "5",        actor: "author:_scepter/notes/.../R009.md", ...}
{op: "add", key: "reviewer",   value: "alice",    actor: "author:_scepter/notes/.../R009.md", ...}
{op: "add", key: "tag",        value: "security", actor: "author:_scepter/notes/.../R009.md", ...}
```

The `actor: "author:<notepath>"` prefix discipline distinguishes ingest events from CLI events. CLI writes (no prefix) and author edits coexist on the same key without overwriting each other.

### Lossless normalization table

R005-era shorthands normalize to k=v form before becoming events:

| Suffix token | Generated events |
|--------------|------------------|
| `:5` (digits 1-5) | `key="importance"`, `value="5"` |
| `:closed` / `:deferred` / `:removed` | `key="lifecycle"`, value=token |
| `:superseded=TARGET` | TWO events: `lifecycle=superseded` + `supersededBy=TARGET` |
| `:derives=TARGET` | `key="derives"`, `value=TARGET` |
| `:KEY=VALUE` | `key=KEY`, `value=VALUE` |
| `:freeform` (digit-less, no `=`) | `key="tag"`, `value="freeform"` |

### Reconciliation discipline

Re-ingest is incremental:
- Author adds a token → emits one `add` event
- Author removes a token → emits one `retract` event
- Token unchanged → emits nothing (idempotent)

CLI events are never touched by reconciliation (their actor lacks the `author:` prefix). This is what allows author edits and CLI writes to coexist.

---

## Common workflows

### Mark a claim verified

```
scepter verify R009.§1.AC.01
# or, equivalently:
scepter meta add R009.§1.AC.01 verified=true
```

The first form is shorter; the second is equivalent and lets you pass arbitrary keys in one call.

### Mark a claim verified by a non-default actor with a method note

```
scepter verify R009.§1.AC.01 --actor reviewer-bob --note "passed manual review against spec"
```

### Record reviewer + priority on a claim

```
scepter meta add R009.§1.AC.01 reviewer=alice priority=P0 tag=blocker
```

One command, three events, all sharing the same actor/date/note.

### Atomically set a single-value field

```
scepter meta set R009.§1.AC.01 assignee=carol
```

If the claim previously had `assignee=bob`, this single `set` event clears `[bob]` and records `[carol]`.

### List every claim that lacks `verified` metadata

```
scepter gaps --missing-key verified --note-type Requirement
```

### List every claim assigned to a specific reviewer

```
scepter trace R009 --where reviewer=alice
```

### Filter by importance and verification status together

```
scepter gaps --where verified=true --importance 5
```

### Inspect a claim's full event history

```
scepter meta log R009.§1.AC.01
```

Every event ever written for that claim, chronologically.

### Inspect current state only

```
scepter meta get R009.§1.AC.01
```

The fold output — what's currently true. No history.

---

## Verifying claims that have no code-side annotation

Some claims can't carry an `@implements` annotation in code: file deletions, dependency adds, test-only DCs that the project config excludes from source scanning, opt-in absences by design, and Open Questions whose resolution is documentary. Use `meta add` with `verified=true` and an explanatory `--note`:

```
scepter meta add DD014.§3.DC.20 verified=true \
  --actor claude-orchestrator \
  --note "FilesystemVerificationStorage and its test deleted; absence verified via git status"

scepter meta add DD014.§3.DC.59 verified=true \
  --actor claude-orchestrator \
  --note "lossless invariant test exists at .../claim-metadata.lossless.test.ts; passing; excluded from Source scanning per project config"
```

For Open Questions resolved by an explicit decision, also mark `lifecycle=closed`:

```
scepter meta add DD014.§11.OQ.01 verified=true lifecycle=closed \
  --actor claude-orchestrator \
  --note "resolved by §DC.23: proper-lockfile selected and shipped"
```

These now surface via `scepter trace DD014 --has-key verified` and `scepter gaps --has-key verified`, restoring uniform "is it verified?" semantics across all claims regardless of how they were satisfied.

---

## Caveats and tips

### `verified=true` is just a value

The system has no built-in taxonomy. `verified=true` is the same shape as `priority=P0` or `cost=42`. The string `"true"` has no special semantics — it's just the string the verify CLI happens to write. Filters like `--where verified=true` literally compare to the string `"true"`. If you wanted, you could write `verified=passed` or `verified=2026-04-25` instead. Convention is uniform-shape across `verify` and `meta` users; nothing forces it.

### Multi-value vs single-value

Multi-value is the default. Use `set` for keys that are conceptually scalar. There's no schema enforcing single-vs-multi — it's a per-key convention.

### Lists of values within one key

A value is a single UTF-8 string. There's no native list type. To attach multiple `tag` values, repeat `add tag=X`:

```
scepter meta add CLAIM tag=security tag=blocker tag=p0-bug
```

This produces three events; the fold yields `tag: [security, blocker, p0-bug]`. Encoding a list inside a single value (e.g., `tag="a,b,c"`) works mechanically but breaks `retract tag=a` semantics — the stored value is the literal string `"a,b,c"`, not the element.

### Hierarchical keys

The KEY regex permits `.` and `-`, so namespaced keys work: `review.status`, `cost.estimate-hours`. The system treats them as opaque strings; nothing parses dot-segments structurally. `meta grep review.*` (Phase 2) will match by prefix; Phase 1 only retrieves by exact key.

### `verify --remove` is now a state-level wipe, not a log-level pop

Pre-DD014, `verify --remove` removed the latest verification event from the log; `verify --remove --all` wiped the verification state. Post-DD014, both flags collapse: `verify --remove` appends an `unset verified` event, which clears the folded state in one shot. The log retains the prior `verified=true` events; only the current state is wiped.

If you need the old log-level pop semantic — physically removing the latest event — that's a Phase-2 `meta revert --event <eventId>` operation (deferred).

### Concurrent writes reject; reads don't lock

Every write acquires an exclusive lock (`proper-lockfile`, 2-second timeout, sidecar at `verification.json.lock`). If two processes try to write at the same time, the second receives a clear error naming the holder and exits non-zero. Re-run after the conflicting writer finishes.

Reads (`load`, `query`, `fold`) don't lock. They see either the pre-write state or the post-write state — never a torn intermediate.

### Watch-mode is built but unsubscribed in Phase 1

The filesystem adapter exposes a `watch?(callback)` method that fires when `verification.json` changes externally. No Phase-1 consumer subscribes (no long-running cache to invalidate). Phase-2 consumers (UI, long-running chat sessions) can subscribe without touching the adapter — the affordance is in place.

### The legacy `verification.json` shape is rejected on load

If a project upgrades and tries to use `meta` / `verify` / `trace` without running `migrate-legacy` first, the load fails with a clear directive. Run `scepter meta migrate-legacy` once per project; it's idempotent.

---

## Where to read more

- **R009** — the requirement that authorized this system. Read for the "why" and the full Phase-2 roadmap.
- **A004** — the architecture that made the cross-cutting commitments (append-only invariant, ULID→cuid2 decision, fold determinism, concurrent-write rejection).
- **DD014** — the implementation blueprint with all 66 DCs realized in Phase 1. Read for "how it actually works" at the file/function level.
- **`docs/architecture/ARCHITECTURE_OVERVIEW.md`** — the project-wide architecture overview, updated post-DD014 to reference the metadata store.
- **`scepter --help` and `scepter meta --help`** — runtime reference for the actual CLI surface.
