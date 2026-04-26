---
created: 2026-04-26T01:39:18.918Z
tags: [claims, metadata, config, verification]
status: draft
---

# R010 - Verification Actor Default and Strictness Configuration

## Overview

{R009} generalized verification into an event-log key-value metadata store, and {DD014} shipped Phase 1 of that store with `scepter claims meta add|set|unset|clear` writes alongside the legacy `scepter claims verify`. Every write captures an `actor` field — a self-assigned string label per {R009.§1.AC.05} — and {DD014.§3.DC.25} fixed the default to the OS username (via `os.userInfo().username`, fallback `"cli"`). The OS username is a poor default for project-bound work: attribution drifts across machines and users, and a single project orchestrator passing `--actor` on every call has no way to make that the project's stable convention.

This requirement adds two CONFIG-level extensions to the metadata store: a configurable default actor for `meta`/`verify` writes, and a configurable strictness level governing whether `--actor` is required at write time. Both settings live in `scepter.config.json` under a new `claims.verification` section. **No event shape changes.** No CLI invocation that works today breaks. The on-disk event log is untouched.

## Problem Statement

The current actor-resolution path is fixed at one fallback (OS username) with no project-level control:

```typescript
// core/src/cli/commands/claims/meta/shared.ts (per DD014.§3.DC.25)
const actor = options.actor ?? os.userInfo().username ?? "cli";
```

Two distinct gaps fall out of this:

| Scenario | Current Behavior | Correct Behavior |
|----------|-----------------|------------------|
| Project author orchestrates verifications across two machines | Each machine writes events with a different `actor` (the local OS username) | Project config declares a single default actor; `--actor` omitted resolves to it on every machine |
| Multi-user team wants every meta write to carry an explicit author | `--actor` is optional; absence silently falls back to OS username | Strictness can be raised so absence of `--actor` is rejected with a clear error |
| Single-user solo project wants current behavior preserved | Already works | Default config (no `claims.verification` section) MUST behave identically to today |
| Suffix-grammar ingest writes events with `actor="author:<notepath>"` per {DD014.§3.DC.40} | Ingest path bypasses CLI; no actor flag involved | Strictness MUST NOT apply to ingest events — they have their own attribution discipline |

The user's verbatim framing of the strictness need: "If you add one without an actor, you get the error." Strictness is the policy that converts an absent `--actor` (with no configured default) from "fall back to OS username" into "reject the write."

## Design Principles

**Additive, no migration.** This requirement adds CONFIG. It does not change the `MetadataEvent` schema, the storage path, the CLI argument shape, or any existing behavior in the absence of new config. A project with no `claims.verification` section MUST behave exactly as it does today.

**Resolution is a precedence chain, not a special case.** The default actor and strictness participate in a single ordered resolution: explicit `--actor` flag wins; otherwise the configured default; otherwise the OS-username fallback (or a strictness-driven rejection). This is the same shape as how note types, status sets, and other config-driven values resolve in SCEpter today.

**Ingest attribution is a separate domain.** The suffix-grammar ingest already encodes provenance in the actor field itself (`author:<notepath>`). Strictness is a policy on user-driven CLI writes; it has no purchase on ingest, where the actor is mechanically determined and the `--actor` flag is not in play.

## Requirements

### §1 Default Actor Configuration

The project config MUST be able to declare a default actor for metadata writes. When configured, the default replaces the OS-username fallback in the CLI's actor-resolution chain. The default applies uniformly to both `scepter claims meta` writes and the legacy `scepter claims verify` write path.

§1.AC.01:5 The system MUST recognize a `claims.verification.defaultActor` setting in `scepter.config.json`. When present, its value MUST be used in place of the OS-username fallback in the actor-resolution chain at write time. High binding: this setting changes the attribution recorded on every CLI-driven event in the project and is the contract the strictness setting builds on.

§1.AC.02 The actor-resolution precedence MUST be: (1) explicit `--actor <name>` flag if provided; (2) `claims.verification.defaultActor` if configured; (3) OS-username fallback (per {DD014.§3.DC.25}, with `"cli"` as the final fallback). The chain MUST short-circuit at the first non-empty value.

§1.AC.03 The default actor MUST apply to both `scepter claims meta` write commands (`add`, `set`, `unset`, `clear`, and any future writes per {R009.§2}) and the legacy `scepter claims verify` command (per {R009.§7.AC.04}). Treating these surfaces inconsistently would split the attribution convention across two paths to the same store.

§1.AC.04 The `defaultActor` value MUST be a free-form string subject to the same constraints as the `actor` field on a `MetadataEvent` (per {R009.§1.AC.05}). The system MUST NOT validate actor identity, enforce roles, or restrict the value to a whitelist. The configured default is metadata about events, not an access-control credential.

§1.AC.05 If `claims.verification.defaultActor` is absent or empty, the resolution chain MUST behave exactly as specified by {DD014.§3.DC.25} today (OS username, then `"cli"`). Absence of the setting MUST NOT introduce any new error path.

§1.AC.06 The default actor MUST NOT apply to suffix-grammar ingest events. Ingest writes the actor mechanically as `author:<notepath>` per {R009.§4.AC.01} and {DD014.§3.DC.40}; this requirement does not modify that path.

### §2 Actor Strictness Configuration

The project config MUST be able to govern whether `--actor` is required on metadata writes. Three modes are defined: `optional` (current behavior), `default` (require either `--actor` or a configured default), and `required` (always require `--actor`). The strictness setting governs the actor-resolution chain at the point where it would otherwise fall through to the OS-username fallback.

§2.AC.01:5 The system MUST recognize a `claims.verification.actorStrictness` setting in `scepter.config.json` with the values `"optional"`, `"default"`, or `"required"`. The value MUST be validated at config load time (per the existing Zod-schema discipline in `core/src/config/config-validator.ts`); unknown values MUST cause config load to fail with a clear message naming the valid options. High binding: this setting governs the failure mode of every CLI-driven write in the project.

§2.AC.02 The default value of `claims.verification.actorStrictness` MUST be `"optional"`. A project with no `claims.verification` section, or with the section present but `actorStrictness` absent, MUST behave exactly as specified by {DD014.§3.DC.25} today.

§2.AC.03:4 In `optional` mode, the actor-resolution chain MUST proceed exactly as specified in §1.AC.02 — `--actor` if provided, then `defaultActor` if configured, then OS-username fallback. No write is rejected for actor reasons.

§2.AC.04:4 In `default` mode, the chain MUST require either an explicit `--actor` flag or a configured `defaultActor`. If neither is present, the write MUST be rejected with an error before any event is recorded. The OS-username fallback MUST NOT be consulted in this mode.

§2.AC.05:5 In `required` mode, the chain MUST require an explicit `--actor` flag on every write. The configured `defaultActor` MUST NOT satisfy the requirement, and the OS-username fallback MUST NOT be consulted. A write without `--actor` MUST be rejected before any event is recorded. High binding: this is the strict-attribution policy the user's verbatim framing motivates ("If you add one without an actor, you get the error"); every CLI-driven write in the project depends on its rejection semantics being correct.

§2.AC.06 Rejection in `default` and `required` modes MUST occur before claim resolution, KEY validation (per {R009.§2.AC.07}), or any storage I/O. Strictness is a precondition check, not a post-hoc filter.

§2.AC.07 The error message for a strictness rejection MUST name the configured strictness mode and the resolution rule that failed. A representative form: `"--actor is required (claims.verification.actorStrictness = required)"` or `"--actor or claims.verification.defaultActor must be set (claims.verification.actorStrictness = default)"`. The exact phrasing is a downstream design choice; the requirement is that the message identifies the policy and the missing input.

§2.AC.08 Strictness MUST NOT apply to suffix-grammar ingest events. Ingest sets the actor mechanically per §1.AC.06; the strictness setting governs only CLI-driven writes where `--actor` is a meaningful input.

§2.AC.09 Strictness MUST apply uniformly to both `scepter claims meta` writes and the legacy `scepter claims verify` writes (per §1.AC.03). A user cannot bypass strictness by routing through `verify` instead of `meta`.

§2.AC.10 If a strictness rejection occurs during a note-scoped or batch write (per {R009.§2.AC.10} or {R009.§2.AC.13}), the rejection MUST occur before any event in the batch is recorded. Atomicity across the batch MUST be preserved.

### §3 Migration and Compatibility

This requirement is purely additive at the configuration layer. No event on disk changes shape. No existing CLI invocation breaks. No project is required to adopt either setting.

§3.AC.01 No change to the `MetadataEvent` schema (per {R009.§1.AC.01}) is permitted by this requirement. The `actor` field on every event continues to be a string, written by the resolution chain at the moment of the write.

§3.AC.02 No change to the legacy `_scepter/verification.json` shape or migration path (per {R009.§7.AC.01}, {R009.§7.AC.02}) is permitted by this requirement. Strictness and the configured default operate at the CLI's actor-resolution layer, upstream of storage.

§3.AC.03 A project that does not declare a `claims.verification` section in `scepter.config.json` MUST behave identically to a project on the same SCEpter version before this requirement was implemented. The configuration is opt-in; the default mode is the current behavior.

§3.AC.04 A project that adopts `defaultActor` without setting `actorStrictness` MUST behave as if `actorStrictness = "optional"`. The two settings are independent — adopting one MUST NOT implicitly enable the other.

§3.AC.05 Existing events on disk MUST NOT be retroactively rewritten when this requirement is implemented. Strictness applies to writes after configuration takes effect, not to historical events.

## Edge Cases

### Empty `defaultActor` string

**Detection:** `claims.verification.defaultActor` is present in config but set to `""`.
**Behavior:** Treated as if absent. The resolution chain falls through to the OS-username fallback (in `optional` mode) or rejects the write (in `default`/`required` mode per the strictness rules). The config validator MAY warn but MUST NOT fail load.

### `defaultActor` configured, strictness `"required"`

**Detection:** Config sets both `defaultActor: "way"` and `actorStrictness: "required"`.
**Behavior:** Per §2.AC.05, `required` mode demands an explicit `--actor` on every write. The configured default MUST NOT satisfy the requirement. The combination is permitted (no config validation error) but the default has no effect under this strictness.

### Suffix-grammar ingest under `required` strictness

**Detection:** Project config sets `actorStrictness: "required"`. The claim index re-ingests a note that declares inline metadata (e.g., `AC.01:priority=P0`).
**Behavior:** Ingest writes events with `actor="author:<notepath>"` per {DD014.§3.DC.40}. Strictness MUST NOT apply per §2.AC.08; the ingest events are recorded normally.

### `--actor ""` (explicit empty string)

**Detection:** Caller passes `--actor ""`.
**Behavior:** Out of scope for this requirement. The handling of an explicit empty `--actor` value follows from {R009.§1.AC.05} (actor is a string label) and is governed by existing CLI argument validation, not by strictness. If a downstream design elects to reject empty actors, that's an addition to {R009}, not this requirement.

## Non-Goals

- **No actor identity verification.** Per {R009.§1.AC.05} and the {R009} non-goals, the `actor` field is a self-assigned label. This requirement does not introduce identity checks, signing, or authentication. Strictness governs whether the field is *present*, not whether the claimed identity is real.

- **No actor whitelist or role enforcement.** `defaultActor` is a single free-form string. This requirement does not introduce a list of permitted actors, role-based dispatch, or per-actor policy. See OQ.02 for the question of whether a whitelist is worth pursuing in a follow-up.

- **No retroactive rewriting.** Per §3.AC.05, events written before strictness was raised retain their original actor. Strictness is a write-time policy, not a stored-data invariant.

- **No effect on the suffix-grammar ingest.** Per §1.AC.06 and §2.AC.08, the ingest path has its own attribution mechanism (`author:<notepath>`) and is governed by {R009.§4} and {DD014.§3.DC.40}. This requirement does not modify or constrain it.

- **No new wire-format fields.** No additions to `MetadataEvent`. No new keys reserved in the metadata store. The two settings are config-only and never appear in the event log.

## Open Questions

### OQ.01 Cascade across nested projects

**Question:** If a SCEpter project contains a nested SCEpter project (a sub-repo or a vendored dependency with its own `_scepter/`), should the parent's `claims.verification` settings cascade into the child, or are they strictly per-project?

**Default assumption:** Strictly per-project. Each project's `scepter.config.json` is authoritative; no inheritance. This matches how other config sections (note types, status sets, paths) are scoped today.

**Resolution path:** User decision after observing real usage. If nested projects emerge in practice with a clear need for shared attribution policy, a downstream requirement can introduce cascade rules; the current default is the safer and simpler one.

### OQ.02 Approved-actor whitelist

**Question:** Should `claims.verification` support a list of permitted actor values (e.g., `approvedActors: ["way", "alice", "bob"]`) that the CLI validates `--actor` against?

**Default assumption:** Out of scope. A whitelist starts to encode project-level role information that {R009}'s non-goals explicitly disclaim ("No actor identity verification"). Strictness already ensures the field is filled; whitelisting goes a step further into territory that may be better served by external operational policy than by SCEpter config.

**Resolution path:** User decision. If the strictness-required mode in practice produces enough noise from typos and casual labels that a whitelist would meaningfully improve attribution quality, a follow-up requirement could revisit. Until then, the open question stands as deferred.

## Acceptance Criteria Summary

| Section | Count |
|---------|-------|
| §1 Default Actor Configuration | 6 |
| §2 Actor Strictness Configuration | 10 |
| §3 Migration and Compatibility | 5 |
| **Total** | **21** |

## References

- {R009} — Claim Metadata Key-Value Store (parent; established the `meta` CLI surface and the `actor` field on `MetadataEvent`)
- {R009.§1.AC.05} — `actor` field is a self-assigned string label
- {R009.§2} — Write Operations (the surface this requirement adds policy to)
- {R009.§4.AC.01} — Suffix-grammar ingest writes `actor="author:<notepath>"`
- {R009.§7.AC.04} — Legacy `scepter claims verify` CLI continues to work; this requirement applies to it uniformly with `meta` writes
- {DD014} — Claim Metadata Store - Implementation Blueprint (Phase 1 just shipped)
- {DD014.§3.DC.25} — Current `--actor` default = OS username via `os.userInfo().username` with `"cli"` fallback
- {DD014.§3.DC.40} — Ingest writes `actor="author:<notepath>"` mechanically; orthogonal to CLI strictness
