---
created: 2026-04-24
tags: [claims, metadata, verification, event-log, cli, key-value]
status: draft
---

# R009 - Claim Metadata Key-Value Store

## Overview

{R005} introduced claim verification as a sidecar event store (`_scepter/verification.json`): an append-only per-claim event log recording who verified a claim, when, and how. The store works and is in production (see `core/src/claims/verification-store.ts`, 180 lines, a `Record<claimId, VerificationEvent[]>` with `load/save/add/getLatest/removeLatest/removeAll`). But its shape is specialized — the event type hardcodes the predicate ("verified"), and no other consumer (endorsement, origin attribution, review state, provenance, ad-hoc project metadata) can write to it without a parallel sidecar.

This requirement generalizes the verification event store into a **free-form key-value metadata store with an append-only event-log substrate**. The existing verification system becomes the first consumer, not the defining shape. Any caller — human, CLI, agent, future SCEpter feature — can record `key=value` events on any claim without the system imposing meaning. Verification becomes "write `verified=true` to the store." Endorsement becomes "write `endorsed=<actor>`." Project-specific concerns (review state, coverage estimates, risk flags) become consumer conventions layered on top of the same primitive.

**Core Principle:** **The store records events, not state.** Each event is `{claimId, key, value, op, actor, date, note?}` where `op ∈ {add, set, unset, retract}`. Current state is a fold over events per key: `add` appends; `set` is atomic "retract-all + add"; `unset` is "retract-all"; `retract` targets a single value. Keys are opaque strings; values are opaque strings. The system neither defines a key taxonomy nor validates what any key means — it only stores, folds, and queries.

## Problem Statement

The verification store's shape encodes a single consumer's semantics:

```typescript
// core/src/claims/verification-store.ts
export interface VerificationEvent {
  claimId: string;
  date: string;
  actor: string;
  method?: string;                     // ← predicate-specific field
}
export type VerificationStore = Record<string, VerificationEvent[]>;
```

The file name (`verification.json`), the type name (`VerificationEvent`), the CLI surface (`scepter claims verify`), and the field `method` all presuppose the predicate is "was verified." A second predicate — say, "was endorsed by the user" — has no home in this structure without either a parallel sidecar or a type-system contortion.

| Scenario | Current Behavior | Correct Behavior |
|----------|-----------------|------------------|
| Record that the user endorsed a claim (distinct from "verified") | No mechanism; would require a parallel sidecar file | `scepter claims meta add CLAIM endorsed=true` writes to the same store |
| Attach a freeform reviewer name to a claim without calling it a "verification" | Must abuse `--actor` and `--method` of `verify` | `scepter claims meta set CLAIM reviewer=alice` |
| Attach multiple values under one key (e.g., two independent reviewers) | No path — `VerificationEvent` is singular per event, and the CLI only appends | `scepter claims meta add CLAIM reviewer=alice; meta add CLAIM reviewer=bob` → `reviewer=[alice, bob]` |
| Retract a specific assertion without wiping history | `--remove` pops the latest event, `--remove --all` wipes everything; no surgical removal | `scepter claims meta remove CLAIM reviewer=bob` leaves `reviewer=[alice]` |
| Filter `trace`/`gaps` by an ad-hoc metadata key | Not supported | `scepter claims trace R009 --where priority=P0` |
| Author declares metadata inline in a note (e.g., `AC.01:priority=P0`) | Parser tolerates `=` but `priority` is relegated to freeform tags with no structured access | Note-body suffix grammar produces implicit events; `meta get` reads them alongside CLI-written events |

The parser already accepts `=` in metadata tokens (`core/src/parsers/claim/claim-parser.ts:119`, regex `/^[A-Za-z0-9=_.§-]+$/`). `parseClaimMetadata()` in `core/src/claims/claim-metadata.ts` already sorts suffix tokens into `importance | lifecycle | derivedFrom | tags[]`, and two of those buckets (`lifecycle=superseded=TARGET`, `derives=TARGET`) use `=` already. What's missing is a generalized path from arbitrary `key=value` suffix tokens and arbitrary CLI events into a single queryable store.

## Design Principles

**Event log substrate, folded state views.** Storage is an append-only log of events per claim. Every read constructs state by folding the event history. This preserves provenance, permits retraction without losing history, and makes the data shape explainable in one sentence.

**Opaque keys and opaque values.** A key is `[a-z][a-z0-9._-]*`. A value is any UTF-8 string. The system MUST NOT validate, categorize, or assign meaning to keys. Consumer conventions (e.g., "`verified` means the claim has been reviewed") live outside the store.

**Multi-value by default; single-value is sugar.** Every key holds 0..N values. `set` is sugar for "make it exactly one." `add` is "ensure this value is present." Enforcing singular cardinality is a consumer choice expressed through command selection, not a store-level constraint.

**Two grammars, one store.** Metadata enters through (1) a note-body suffix grammar (declarative, in markdown: `AC.01:priority=P0:reviewer=alice`) and (2) an event-log CLI grammar (runtime events written by `scepter claims meta ...`). Both produce the same event shape and feed the same fold.

**Back-compat is non-negotiable.** The existing `_scepter/verification.json` shape MUST continue to load. The existing `scepter claims verify` CLI MUST continue to work unchanged. Legacy events MUST migrate to the generalized shape at load time. R005 §1 (importance) and §2 (lifecycle) vocabularies MUST continue to be recognized as shorthand that normalizes into `key=value` events.

## Requirements

### §1 — Event Log Storage Model

The store MUST persist claim metadata as an append-only event log. Each event records an atomic modification to one `(claimId, key)` pair. Current-state views are constructed by folding events; the store itself never mutates prior entries.

#### Event schema

§1.AC.01:5 The system MUST define a `MetadataEvent` type with the fields `claimId: string`, `key: string`, `value: string`, `op: "add" | "set" | "unset" | "retract"`, `actor: string`, `date: string` (ISO 8601 YYYY-MM-DD), and optional `note?: string` (free-text annotation). High binding: this schema is the contract between every writer, every reader, every migration path, and every consumer.

§1.AC.02 The `value` field MUST be a string. The system MUST NOT interpret the value as a number, boolean, JSON literal, or any other typed form. Consumers that need typed values encode them as strings (e.g., `"true"`, `"42"`) and decode on read.

§1.AC.03 The `key` field MUST match the pattern `^[a-z][a-z0-9._-]*$`. The system MUST reject writes that supply a key outside this pattern. Keys are case-sensitive; the pattern requires lowercase to prevent `Reviewer` vs `reviewer` split-brain.

§1.AC.04 For `op = "unset"`, the `value` field MUST be the empty string `""`. For all other ops, the `value` field MUST be non-empty. The linter and validate commands MUST reject events that violate this invariant.

§1.AC.05 The `actor` field MUST be a self-assigned string label. The system MUST NOT validate actor identity, enforce actor roles, or check authenticity. An actor string is metadata about the event, not an access-control credential.

#### Op semantics (fold rules)

§1.AC.06:5 The state fold over an event log for a single `(claimId, key)` MUST produce `values: string[]` by applying the ops in chronological order: `add` appends the value if not present; `set` clears all prior values and records the new one atomically; `unset` clears all prior values; `retract` removes one specific value (no-op if absent). High binding: every read goes through this fold, and every consumer depends on its definition.

§1.AC.07 `set` MUST be an atomic composite of "retract all current values for this key, then add the new value." When a `set` event is replayed during fold, the result for that key MUST be exactly `[value]` regardless of prior history.

§1.AC.08 `add CLAIM KEY=VALUE` MUST be idempotent at the state-view level — applying it twice with the same value leaves the state identical. The store MUST still record both events (the event log is faithful to the invocation), but the folded state MUST deduplicate.

§1.AC.09 A claim's metadata state after fold MUST be a `Record<string, string[]>` — keys mapped to arrays of current values. Keys with zero current values (either never added, or retracted to empty) MUST NOT appear in the folded state.

#### Persistence

§1.AC.10 The event log MUST be persisted as JSON in the SCEpter data directory. The file name and exact shape are implementation choices for the downstream design, subject to the back-compat requirements in §7. The store MUST survive index rebuilds — it is not part of the computed index.

§1.AC.11 The store MUST expose its event log through a `MetadataStorage` interface (generalization of the existing `VerificationStorage` in `core/src/storage/storage-backend.ts`). The interface MUST provide methods to `load`, `save`, `append(event)`, `query(filter)`, and `fold(claimId) -> Record<string, string[]>`.

§1.AC.12 Writes MUST be durable — after a successful write, a subsequent read in a new process MUST see the event. The store MAY batch writes within a single CLI invocation but MUST flush before the process exits.

### §2 — Write Operations

All write commands live under the subcommand group `scepter claims meta`. Every write accepts the common options `--actor <name>` (default: OS username), `--date <YYYY-MM-DD>` (default: today's date), and `--note <text>` (optional free-text annotation).

#### Single-claim writes

§2.AC.01:4 `scepter claims meta add CLAIM KEY=VALUE [KEY=VALUE...]` MUST record one `op=add` event per KEY=VALUE pair, all sharing the same actor, date, and optional note. High binding: this is the primary write entry point; multiple CLI consumers and the suffix-grammar ingest both funnel through it.

§2.AC.02:4 `scepter claims meta set CLAIM KEY=VALUE [KEY=VALUE...]` MUST record one `op=set` event per KEY=VALUE pair. `set` MUST replace all current values for KEY with VALUE atomically — immediately after the `set` event and before any subsequent op on KEY, `meta get CLAIM KEY` MUST return exactly `[VALUE]`. `set` does not lock the key to single-value semantics; a later `add` may append additional values per §1.AC.06.

§2.AC.03 `scepter claims meta remove CLAIM KEY=VALUE [KEY=VALUE...]` MUST record one `op=retract` event per KEY=VALUE pair. It MUST remove one specific value from the key's current values, leaving other values under the same key intact.

§2.AC.04 `scepter claims meta unset CLAIM KEY [KEY...]` MUST record one `op=unset` event per KEY. It MUST clear all current values for the named keys in a single atomic event per key.

§2.AC.05 `scepter claims meta clear CLAIM` MUST unset every key that currently has values for the claim. It MUST record one `op=unset` event per key with current values. The command MUST be a no-op (and MUST NOT record any events) if the claim has no current metadata.

§2.AC.06 `scepter claims meta replace CLAIM KEY=VALUE [KEY=VALUE...]` MUST first clear every current key for the claim (as in `clear`), then apply the provided pairs as `set` events. The combined operation MUST be recorded as the corresponding event sequence in the log (not collapsed).

§2.AC.07 All write commands MUST validate the KEY portion of each KEY=VALUE argument against the key pattern (§1.AC.03) before recording any events. If any KEY is invalid, the command MUST reject the entire invocation and record no events (atomicity across the argument list).

§2.AC.08 All write commands MUST reject claim IDs that do not resolve to a claim in the index, with a helpful error suggesting close matches. The command MUST NOT record events for unresolved claim IDs.

§2.AC.09 Write commands MUST reject claims whose current lifecycle state is `:removed`, consistent with the existing rule in `verify-command.ts:97`. A removed claim has no current meaning to attach metadata to. The system MAY provide an override flag for archival writes; if so, the flag MUST be explicit and MUST NOT be the default.

#### Note-scoped writes

§2.AC.10 All write operations (`add`, `set`, `remove`, `unset`, `clear`, `replace`) MUST accept a note ID (e.g., `R009`) in place of a claim ID, operating on every claim in that note. For each claim in the note, the same events MUST be recorded as if the command had been invoked per claim.

§2.AC.11:4 Destructive note-scoped operations (`unset`, `clear`, `remove`, `replace`) MUST require an explicit `--confirm` flag. Without the flag, the command MUST print the count of affected claims and events and exit without writing. High binding: this is the primary safety boundary for bulk writes.

§2.AC.12 Note-scoped writes MUST skip claims tagged `:removed` and report the skip count, consistent with §2.AC.09.

#### Batch apply

§2.AC.13 `scepter claims meta apply --from FILE` MUST read a batch of writes from FILE and apply them as a sequence. The file format MUST be either JSON (an array of event-shaped objects) or TSV (columns: `claimId`, `op`, `key`, `value`, `actor?`, `date?`, `note?`). The format SHOULD be detected from the file extension.

§2.AC.14 `scepter claims meta apply --from FILE --dry-run` MUST parse and validate the batch without recording any events, printing the planned event count and any errors. This is the safe-reconciliation path for scripted writes.

§2.AC.15 If any event in a batch fails validation, the command MUST report every failing event with line number (for TSV) or index (for JSON) and record no events from the batch. Partial application is forbidden.

### §3 — Read Operations

Read commands produce either folded current-state views or raw event logs.

#### Current state

§3.AC.01 `scepter claims meta get CLAIM` MUST print the folded current state for the claim as `key: value` (one value) or `key: [value1, value2, ...]` (multiple values) for every key with current values. If the claim has no current metadata, the command MUST print an empty result without error.

§3.AC.02 `scepter claims meta get CLAIM KEY` MUST print only the values for the named key. If the key has no current values, the command MUST exit with a distinguishable status (e.g., non-zero or an explicit empty-marker line) to support scripting.

§3.AC.03 `scepter claims meta get CLAIM --history` MUST print the full chronological event log for the claim alongside the folded state, so the caller can see how the state was reached.

§3.AC.04 `scepter claims meta get CLAIM --json` MUST emit a machine-readable object with two top-level fields: `state` (the folded `Record<string, string[]>`) and optionally `events` (the full log, when `--history` is combined).

§3.AC.05 `scepter claims meta get CLAIM --values-only` MUST print only the values (one per line) without keys. Useful for piping a single key's values to another tool.

#### Event log

§3.AC.06 `scepter claims meta log CLAIM` MUST print the full chronological event log for the claim. Each event line MUST include the op, key, value, actor, date, and note (if present).

§3.AC.07 `scepter claims meta log CLAIM` MUST accept filter options `--key KEY` (restrict to one key), `--actor ACTOR` (restrict to events by one actor), `--since YYYY-MM-DD` and `--until YYYY-MM-DD` (date range, inclusive), and `--op OP` (restrict to one op). Filters MUST be composable (AND semantics).

§3.AC.08 `scepter claims meta log CLAIM --json` MUST emit the filtered event array as a JSON array of `MetadataEvent` objects.

#### Cross-claim listing

§3.AC.09 `scepter claims meta list` MUST print the folded current-state metadata across all claims in the project, one row per `(claim, key)` pair with current values. `scepter claims meta list NOTE_ID` MUST restrict to claims in the named note. `scepter claims meta list CLAIM_PREFIX` MUST restrict to claims whose fully qualified ID starts with the prefix.

§3.AC.10 `scepter claims meta list` MUST accept composable filters: `--has-key KEY` (include only claims with any value for KEY), `--missing-key KEY` (include only claims with no value for KEY), `--where KEY=VALUE` (repeatable, include only claims whose current state contains the given pair), `--where-not KEY=VALUE` (repeatable, exclude claims matching), and `--key KEY` (project output to one key).

§3.AC.11 `scepter claims meta list --json` MUST emit a machine-readable array of `{claimId, state}` objects matching the filter.

#### Text search

§3.AC.12 `scepter claims meta grep PATTERN` MUST match PATTERN against the values in folded current state across all claims. Matches MUST be substring by default; `--regex` MUST treat PATTERN as a JavaScript regular expression.

§3.AC.13 `scepter claims meta grep PATTERN --key KEY` MUST restrict matching to values under the named key.

#### Diff and changes

§3.AC.14 `scepter claims meta diff CLAIM_A CLAIM_B` MUST print the symmetric difference between the two claims' folded states, organized by key: keys present only in A, keys present only in B, keys present in both with different values.

§3.AC.15 `scepter claims meta changes CLAIM` MUST print the chronological sequence of folded-state transitions for the claim — at each event, the key affected and the before/after values. Options `--since YYYY-MM-DD`, `--until YYYY-MM-DD`, and `--by ACTOR` MUST filter which events drive the displayed transitions.

### §4 — Suffix Grammar Generalization

The note-body metadata suffix grammar (defined in {R004.§2.AC.04}, clarified in {R005.§2.AC.04a}, {R005.§2.AC.04b}) carries `key=value` tokens today. This requirement promotes those tokens to first-class implicit events in the store at ingest time.

§4.AC.01:4 Every `key=value` token in a claim's metadata suffix MUST be interpreted at claim-index time as an implicit `op=add` event with `actor="author:<notepath>"`, `date = <note file mtime as YYYY-MM-DD>`, and `note = "inline"`. High binding: every R005-era claim in the project carries such tokens, and this rule governs how they enter the generalized store.

§4.AC.02 Bare importance digits (`:1` through `:5`) MUST normalize to implicit events `importance=<digit>` per §4.AC.01. This makes R005 §1 importance a consumer convention on the `importance` key rather than a special-case field.

§4.AC.03 Bare lifecycle tokens (`:closed`, `:deferred`, `:removed`, `:superseded=TARGET`) MUST normalize to implicit events `lifecycle=<tag>` (or `lifecycle=superseded` with a separate `supersededBy=TARGET` event) per §4.AC.01. This makes R005 §2 lifecycle a consumer convention on the `lifecycle` key.

§4.AC.04 The `derives=TARGET` token from {R006.§1.AC.01} MUST continue to be recognized as an inline derivation shorthand. It MUST also be emitted as an implicit event `derives=TARGET` per §4.AC.01, making it queryable via `meta list --where derives=TARGET`. Derivation semantics defined by {R006} (gap closure, bidirectional index, trace expansion) remain governed by R006 — this requirement only ensures the `derives` key is readable through the generalized surface.

§4.AC.05 Freeform suffix tokens that do not contain `=` (e.g., `:security`, `:wip`) MUST normalize to implicit events with the pseudo-key `tag` and the token as value (e.g., `:security` → `tag=security`). This makes R004-era freeform tags queryable as `meta list --where tag=security` and preserves their current semantics.

§4.AC.06 The implicit-event normalization MUST be lossless with respect to the existing `parseClaimMetadata()` output: reconstructing `ParsedMetadata` (importance, lifecycle, derivedFrom, tags) from the folded state for a claim's implicit events MUST produce the same structure as the direct parser output. The current-state fold is a strict superset of the legacy shape.

§4.AC.07 Implicit events from suffix tokens MUST be distinguishable from CLI-written events by their `actor` field (prefix `author:`). Downstream tooling that needs only author-declared state (e.g., a "what did the author say about this claim" view) MUST be able to filter the event log to implicit events only.

§4.AC.08 When a claim's document is re-indexed, implicit events from the prior parse MUST NOT accumulate. The ingest MUST reconcile: retract any implicit events the author no longer declares, and add any implicit events the author newly declares. The invariant is that the current implicit-event set for a claim equals the set produced by parsing the current document.

### §5 — Integration Filters on Existing Commands

The metadata store becomes a composable filter surface for existing claim commands.

§5.AC.01 `scepter claims trace`, `scepter claims search`, and `scepter claims gaps` MUST accept `--where KEY=VALUE` (repeatable). A claim MUST be included in the output only if its folded metadata state contains every specified `(key, value)` pair.

§5.AC.02 The same three commands MUST accept `--has-key KEY` (repeatable). A claim MUST be included only if its folded state has at least one value for every specified key.

§5.AC.03 The same three commands MUST accept `--missing-key KEY` (repeatable). A claim MUST be included only if its folded state has no values for any specified key.

§5.AC.04 `scepter claims trace` MUST accept `--group-by KEY`. The trace output MUST be grouped by the claim's current value(s) under KEY (with a separate group for claims missing the key).

§5.AC.05 Where existing commands already support similar filters (e.g., `--importance N` on `trace` per {R005.§1.AC.02}), the existing flags MUST continue to work unchanged and SHOULD be implemented internally as special-case `--where importance=N` semantics once the back-compat normalization (§7) is in place.

§5.AC.06 `--where`, `--has-key`, and `--missing-key` MUST be composable with each other and with existing filters. All filters compose with AND semantics.

### §6 — Maintenance Operations

Maintenance commands operate on the event log itself, not on folded state.

#### Revert

§6.AC.01 `scepter claims meta revert CLAIM --event EVENT_ID` MUST append a compensating event that inverts the targeted event's effect on current state: reverting an `add` appends a `retract`; reverting a `set` appends a `set` to the prior value (or `unset` if no prior); reverting an `unset` appends `add` events for each cleared value; reverting a `retract` appends an `add`. Events retain unique identifiers for this purpose.

§6.AC.02 `scepter claims meta revert CLAIM --event EVENT_ID --hard` MUST physically remove the targeted event from the log rather than compensating. Hard revert MUST require confirmation or be explicitly flagged as destructive — it erases history.

#### Compact

§6.AC.03 `scepter claims meta compact [CLAIM]` MUST physically remove events that have been superseded and have no current effect (e.g., `add` events followed by a `set` to a different value for the same key). The compacted log, when folded, MUST produce the identical current-state view as the uncompacted log. Without CLAIM, the command compacts the entire store.

§6.AC.04 `scepter claims meta compact [CLAIM] --older-than YYYY-MM-DD` MUST compact only events older than the given date. `--keep-last N` MUST preserve at least the last N events per `(claimId, key)` pair regardless of supersession. These options MUST be composable.

#### Export / Import

§6.AC.05 `scepter claims meta export [NOTE_ID | CLAIM]` MUST emit the current folded state. `--events` MUST emit the raw event log instead. `--format json|yaml|tsv` MUST select the output format. The default format MUST be JSON.

§6.AC.06 `scepter claims meta import FILE --merge` MUST add the file's events to the existing store, preserving both. `--replace` MUST clear current events for any claim mentioned in the file before applying the file's events. `--merge` MUST be the default.

#### Validate

§6.AC.07 `scepter claims meta validate` MUST scan the event log for structural problems: events referencing claim IDs not in the current index (orphan events), events with malformed keys or empty values under non-unset ops, and events with unparseable dates or missing required fields.

§6.AC.08 `scepter claims meta validate --fix` MUST offer automated remediation for safely-remediable problems: suggesting archival for orphan events, date normalization, etc. Unsafely-remediable problems MUST be reported without being auto-fixed.

#### Rename key

§6.AC.09 `scepter claims meta rename-key OLD_KEY NEW_KEY` MUST record compensating events across all affected claims that effectively rename one key to another: for every claim with current values under OLD_KEY, an `unset OLD_KEY` event and a sequence of `add NEW_KEY=VALUE` events for each prior value.

§6.AC.10 `scepter claims meta rename-key OLD_KEY NEW_KEY --scope NOTE_ID` MUST restrict the rename to claims in the named note.

§6.AC.11 `scepter claims meta rename-key OLD_KEY NEW_KEY --dry-run` MUST print the planned event sequence without recording it.

### §7 — Back-Compat with R005 and Legacy verification.json

This requirement generalizes R005's verification subsystem; it does not replace it in a way that breaks consumers. The migration path MUST be invisible to existing CLI users and existing stored data.

#### Legacy store format

§7.AC.01:5 The system MUST load `_scepter/verification.json` in its existing shape (`Record<claimId, VerificationEvent[]>`, see `core/src/claims/verification-store.ts:39`) and MUST migrate each legacy event to a generalized `MetadataEvent` at load time. The migration MUST map `{claimId, date, actor, method?}` to `{claimId, key: "verified", value: "true", op: "add", actor, date, note: method ?? undefined}`. High binding: every project with existing verification data depends on this normalization being correct.

§7.AC.02 The migration precedent is the existing `timestamp` → `date` normalization in `loadVerificationStore` (`core/src/claims/verification-store.ts:64-71`). The legacy-event migration MUST follow the same pattern: transparent on load, no separate migration step required of the user.

§7.AC.03 The system MUST preserve the legacy file name (`verification.json`) as the canonical storage path. This is settled by {A004.§2.AC.04} (filename unchanged); a future rename is not blocked but requires explicit configuration support, not silent migration.

#### Legacy CLI

§7.AC.04:5 `scepter claims verify CLAIM_ID` MUST continue to work with its current argument shape, flags (`--actor`, `--method`, `--remove`, `--all`, `--reindex`), and behavior as specified in {R005.§3.AC.03}-{R005.§3.AC.05}. High binding: this is the public verify CLI and any script depending on it MUST continue to pass.

§7.AC.05 Internally, `scepter claims verify CLAIM_ID --actor A --method M` MUST be implemented as a thin alias for the equivalent `scepter claims meta add CLAIM_ID verified=true --actor A --note "method=M"` (or an equivalent normalization). The exact alias shape is a downstream design choice; the requirement is that `verify` becomes one consumer of the generalized store, not a separate subsystem.

§7.AC.06 `scepter claims verify CLAIM_ID --remove` MUST remain supported via the equivalent `scepter claims meta remove` semantics. `--remove --all` MUST map to an `unset verified` event (clearing every value under the `verified` key for the claim).

§7.AC.07 The rejection of writes against `:removed` claims (R005's "Verification of Removed Claims" edge case, as implemented at `verify-command.ts:97`) MUST continue to hold. Under the generalized surface, this follows from §2.AC.09. The original rule lives in R005's edge-cases prose, not in any R005 AC; this AC is the canonical home for the rule going forward.

#### R005 §1 and §2 vocabularies

§7.AC.08 R005 §1 (importance) and §2 (lifecycle) vocabularies MUST remain in force as recognized shorthand. Their semantics (digit-1-5 importance, fixed lifecycle vocabulary, mutual exclusion of lifecycle tags, etc.) continue to govern. The implementation mechanism moves to the generalized suffix-grammar normalization (§4.AC.02, §4.AC.03) — importance becomes a consumer convention on the `importance` key, lifecycle on the `lifecycle` key — but the author-facing syntax and system-enforced rules do not change.

§7.AC.09 `parseClaimMetadata()` (`core/src/claims/claim-metadata.ts`) MUST continue to produce the same `ParsedMetadata` structure for callers that depend on it (e.g., `ClaimIndex`, the linter, the formatter). The §4.AC.06 losslessness requirement is the invariant that makes this work: the current fold surface MUST be reconstructible into the legacy shape for back-compat.

#### R005 §3 supersession boundary

§7.AC.10 R005 §3 (Verification Events) is **partially superseded** by this requirement. The event-store subsystem R005 §3 defines becomes a specialization of the new generalized event log: same substrate, narrower consumer semantics. The author-facing `scepter claims verify` CLI and the sidecar-not-inline boundary ({R005.§3} "Verification events are external judgments — they MUST NOT be written into the claim's source document") remain in force; the storage shape underneath generalizes.

§7.AC.11 R005 §4 (Staleness Detection) is not superseded. Staleness continues to be computed from verification dates and file mtimes, but now derives its input from the generalized log filtered on the `verified` key (or whatever key a consumer uses to denote "reviewed against implementation"). The R005 §4 ACs remain valid; their input source is the only change.

### §8 — Minimum Viable Subset

Implementations MAY ship the generalized store in phases. The following subset MUST be implementable and shippable as a coherent first phase without any of the rest:

**Phase-1 write:** §2.AC.01 (`add`), §2.AC.02 (`set`), §2.AC.04 (`unset`), §2.AC.05 (`clear`), §2.AC.07 (KEY validation), §2.AC.08 (claim-ID resolution), §2.AC.09 (removed-claim rejection).

**Phase-1 read:** §3.AC.01, §3.AC.02, §3.AC.04 (`get` with `--json`), §3.AC.06, §3.AC.08 (`log` with `--json`).

**Phase-1 integration:** §5.AC.01, §5.AC.02, §5.AC.03 (`--where`, `--has-key`, `--missing-key` on `trace`/`search`/`gaps`). `--group-by` (§5.AC.04) deferred.

**Phase-1 back-compat:** All of §7 (§7.AC.01 through §7.AC.11) — back-compat is not optional and cannot be deferred.

**Deferred to later phases:** `remove` (§2.AC.03), `replace` (§2.AC.06), note-scoped writes (§2.AC.10-12), batch apply (§2.AC.13-15), cross-claim `list` (§3.AC.09-11), `grep` (§3.AC.12-13), `diff` (§3.AC.14), `changes` (§3.AC.15), all of §6 (maintenance operations).

The phase-1 subset MUST be sufficient to express every use case R005 §3 today covers, plus the common ad-hoc metadata scenarios in the problem statement table (priority, reviewer, endorsement, origin).

## Edge Cases

### Duplicate `add` of the same KEY=VALUE

**Detection:** Two consecutive `add CLAIM reviewer=alice` invocations.
**Behavior:** Both events MUST be recorded in the log (the invocations were both made). The folded state MUST contain `reviewer: [alice]` with a single entry — `add` is idempotent at the state-view level per §1.AC.08. The log preserves the provenance; the view deduplicates.

### `set` followed by `add` on the same key

**Detection:** `set CLAIM reviewer=alice; add CLAIM reviewer=bob`.
**Behavior:** Folded state is `reviewer: [alice, bob]`. `set` established the exact value; `add` appended a second value. This is the intended semantics — `set` does not lock the key to single-value; it atomically resets to one value at the moment of the event.

### Retract targeting a value that is not present

**Detection:** `remove CLAIM reviewer=charlie` when `reviewer` currently holds `[alice, bob]`.
**Behavior:** The event MUST be recorded (faithful log) but MUST be a no-op in the fold. The command SHOULD print a notice that no value was removed. No error.

### Legacy verification.json with timestamp but no date

**Detection:** An event in `verification.json` has a `timestamp` field but no `date` field.
**Behavior:** The existing migration in `loadVerificationStore` (`verification-store.ts:64-71`) normalizes `timestamp` → `date`. The generalized loader MUST preserve this behavior and layer the R005-to-R009 normalization on top: first normalize `timestamp` → `date`, then normalize to `key=verified, value=true`.

### Implicit event from a suffix token whose key conflicts with a CLI-written key

**Detection:** A note has `AC.01:reviewer=alice`; the CLI has also recorded `add CLAIM reviewer=bob`.
**Behavior:** Both events enter the log under the same `reviewer` key. Folded state is `reviewer: [alice, bob]`. The author's declaration and the CLI writer's declaration coexist — the system does not arbitrate. A consumer that wants "author says" vs "CLI says" filters the log by actor (author implicit events have the `author:` prefix per §4.AC.07).

### Empty-value write attempt

**Detection:** `scepter claims meta add CLAIM reviewer=` (empty string after `=`).
**Behavior:** The write MUST be rejected per §1.AC.04. The CLI MUST report the specific argument and exit without recording. Empty values are reserved exclusively for `unset` events.

### `validate` finds orphan events

**Detection:** Events reference a claim ID that no longer exists in the index (e.g., the note was deleted or the claim was removed from the note body).
**Behavior:** `validate` MUST report each orphan event. `validate --fix` MUST NOT auto-delete orphan events — it SHOULD suggest archival or manual review. History removal is destructive and requires explicit opt-in.

### Compact removes an event that a future revert would target

**Detection:** User runs `compact`, then later attempts `revert CLAIM --event EVENT_ID` against an event that was compacted away.
**Behavior:** `revert` MUST report that the target event is not in the log. This is a consequence of compaction trading history depth for log size. The system MUST NOT silently succeed.

## Non-Goals

- **No built-in key taxonomy.** Keys like `verified`, `endorsed`, `reviewer`, `origin`, `priority` are consumer conventions, not system primitives. The system does not define, validate, or reserve any key. A project that wants a conventional set of keys documents them; SCEpter does not enforce the convention.

- **No value types beyond string.** All values are UTF-8 strings. Consumers that need typed values encode them (`"true"`, `"42"`, `"2026-04-24"`) and decode on read. Adding a type system to values would require a parallel schema mechanism; the cost outweighs the benefit.

- **No per-key cardinality enforcement.** Every key is multi-value. A consumer that wants singular cardinality uses `set` exclusively; the store does not validate that no `add` ever appends a second value. Enforcing cardinality at the store level would require either per-key declarations (creeping toward a schema) or contradict the "opaque keys" principle.

- **No propagation rules across derivation edges.** If a consumer wants derived claims to inherit their source's metadata, that's consumer logic, not a store primitive. The `derives` relationship (governed by {R006}) is queryable via the generalized surface but carries no automatic metadata flow.

- **No actor identity verification.** The `--actor` flag is a self-assigned label. The system does not check that the running user is who they claim to be, nor enforce actor roles. If stronger identity is needed, it is layered on top by an operational policy, not by the store.

- **No display opinions about key semantics.** Current-state views render `key → [values]` mechanically. Any dashboard, trust summary, coverage metric, or prioritization display built on top is consumer code that reads `meta export --events` or the `fold()` API. SCEpter does not bake in UX for any particular key.

- **No cross-project metadata.** Like derivation (per {R006}), metadata events reference claims within the current project's index. The store is per-project; there is no cross-project synchronization or federation.

- **No `verification.json` path migration in this requirement.** Whether to rename the sidecar file (e.g., to `meta.json` or `metadata.json`) is a downstream design choice. See OQ.01. This requirement preserves the existing name to avoid forcing projects through a file rename; the downstream design may elect to rename with appropriate migration.

## Open Questions

All four original open questions have been resolved by {A004} (Claim Metadata Store Architecture). Their resolutions are recorded here for traceability; the binding decisions live in A004.

### OQ.01 Sidecar file name — RESOLVED in {A004.§2.AC.04}

**Resolution:** Keep `_scepter/verification.json`. The filename is preserved to avoid forcing every project through a one-time file rename for zero functional benefit. A future configurable path is not blocked.

### OQ.02 Event identifier shape — RESOLVED in {A004.§2.AC.05}

**Resolution:** ULID per event. The `id` field is part of the `MetadataEvent` schema from Phase 1, even though `revert` (which uses it) is deferred. Adding it later would be a non-breaking schema extension; adding it up front is simpler.

### OQ.03 Implicit-event re-ingest atomicity — RESOLVED in {A004.§3.AC.03}

**Resolution:** Incremental. Re-ingest emits one event per token added or retracted. Compound reconciliation events MUST NOT be used. The log compaction path (§6.AC.03) handles size growth.

### OQ.04 Note-scoped destructive operations on removed claims — DEFERRED

**Question:** §2.AC.09 rejects writes to `:removed` claims. §2.AC.12 says note-scoped writes skip them. Is that the right default, or should `clear` on a note forcibly include removed claims for tidiness?

**Default assumption:** Skip `:removed` by default (matches R005). An explicit `--include-removed` flag MAY be added if the use case materializes.

**Resolution path:** Observe real usage during phase-1 rollout; decide in a follow-up if the flag is needed.

## Acceptance Criteria Summary

| Category | Count |
|----------|-------|
| §1 Event Log Storage Model | 12 |
| §2 Write Operations | 15 |
| §3 Read Operations | 15 |
| §4 Suffix Grammar Generalization | 8 |
| §5 Integration Filters | 6 |
| §6 Maintenance Operations | 11 |
| §7 Back-Compat | 11 |
| §8 Minimum Viable Subset | (structural — no ACs) |
| **Total** | **78** |

## References

- {R004} — Claim-Level Addressability and Traceability System (parent addressability)
- {R004.§2.AC.04} — Colon-suffix metadata parsing (superseded by R005.§2.AC.04a)
- {R005} — Claim Metadata, Verification, and Lifecycle (the requirement this generalizes)
- {R005.§1} — Importance (§1 AC.01-AC.05 remain in force; implementation moves to `importance` key convention per §4.AC.02)
- {R005.§2} — Lifecycle Tags (§2 ACs remain in force; implementation moves to `lifecycle` key convention per §4.AC.03)
- {R005.§3.AC.01} — Verification store as JSON file (partially superseded; substrate generalizes, file name preserved)
- {R005.§3.AC.02} — VerificationEvent interface (partially superseded; generalized to `MetadataEvent`)
- {R005.§3.AC.06} — Append-only store semantics (preserved and elevated to §1.AC.06)
- {R005.§4} — Staleness Detection (not superseded; input source generalizes per §7.AC.11)
- {R006} — Claim Derivation Tracing (coexists; `derives=` token queryable via generalized surface per §4.AC.04)
- {R006.§1.AC.01} — `derives=TARGET` metadata recognition (preserved)
- `core/src/claims/verification-store.ts` — existing store implementation (180 lines, the thing being generalized)
- `core/src/claims/claim-metadata.ts` — existing metadata interpreter (importance/lifecycle/derives/tags sorting)
- `core/src/parsers/claim/claim-parser.ts` — metadata suffix parser (already tolerates `=`)
- `core/src/cli/commands/claims/verify-command.ts` — verify CLI (becomes thin alias per §7.AC.05)
- `core/src/storage/storage-backend.ts` — `VerificationStorage` interface (generalized to `MetadataStorage`)
