---
created: 2026-06-24T22:08:56.644Z
tags:
  - config
  - status
  - validation
confidence: 🤖2 2026-06-24
---

# R019 - Per-Type Predefined Status Values

## Overview

A project can govern the `status` frontmatter field per note type: declare which status values a type permits, whether an out-of-set value is merely warned about or outright blocked, and which value a new note of that type gets when the caller names none. Status values can be named inline per type or drawn from reusable named sets shared across types. **Core Principle:** `status` is the one frontmatter field the system already governs per type — a project says, in configuration, what "in progress" or "approved" means for each kind of note, and the tooling stamps the default at create time and checks membership against the declared set.

## Problem Statement

Without per-type status governance, every note's `status` is free text. Nothing records which values a project considers meaningful for a Requirement versus a Task, nothing stamps a sensible starting value when a note is created, and nothing catches a typo (`in-progres`) or an off-convention value (`wip` where the project standard is `in-progress`). The convention lives only in contributors' heads, and drift is invisible to the tooling. Two projects, or two contributors on one project, will disagree on the status vocabulary and never know it.

The mechanism must also avoid forcing ceremony on projects that do not want it: a note type that names no allowed statuses must behave exactly as untyped free-text status did before, and a project must be able to choose between a soft "warn but allow" posture and a hard "block on invalid" posture per type.

| Scenario | Current Behavior | Required Behavior |
|----------|-----------------|-------------------|
| Project wants Tasks to use only `pending`/`in-progress`/`completed` | `status` is free text; any value accepted silently | Declare `allowedStatuses: ["pending","in-progress","completed"]`; the set is recorded, first value is the default, out-of-set values are flagged |
| Several types share a `draft`/`proposed`/`approved` lifecycle | Each type repeats the literal list, or relies on convention | Declare a reusable `statusSets` entry once; types reference it by name and combine it with type-local literals |
| A note is created without a status for a type that declares one | No status stamped; field absent or free | The type's default status is applied and stamped into the new note's frontmatter |
| A type must hard-block off-convention statuses | No enforcement; invalid values persist | Declare `mode: "enforce"`; creation with an out-of-set status is rejected, naming the allowed values |
| A note type names no allowed statuses | `status` is free text | Identical behavior — no validation, no default, the feature is inert for types that do not opt in |

## Design Principles

**Two postures, declared per type.** A type either warns on an out-of-set status and allows it (`suggest`) or blocks it (`enforce`). The posture is a per-type choice, not a global switch, because different kinds of notes warrant different strictness.

**Reuse over repetition.** A status vocabulary shared by several note types is named once as a reusable set and referenced by name. A type's effective allowed values are the union of the sets it references and the literal values it names locally.

**Inert by default.** A note type that declares no `allowedStatuses` MUST behave exactly as it did before this feature — no validation, no stamped default, free-text status. The feature adds governance only where a project asks for it.

## Requirements

A note type configuration MAY carry an `allowedStatuses` declaration in one of two forms: a shorthand array of literal status strings, or a full object naming referenced sets, type-local literal values, a validation mode, and an explicit default. A project MAY also declare a top-level map of reusable named status sets that any type can reference.

The status-governance vocabulary:

```typescript
interface AllowedStatusesConfig {
  sets?: string[];                  // names of reusable statusSets entries to expand
  values?: string[];               // type-local literal status values
  mode: 'suggest' | 'enforce';     // warn-but-allow, or block-on-invalid
  defaultValue?: string;           // status applied when caller names none; required under enforce
}

// shorthand: allowedStatuses?: string[] | AllowedStatusesConfig
// reusable sets: statusSets?: Record<string, string[]>
```

### §1 Configuration Schema

A note type declares its permitted statuses either as a shorthand array (the simple case) or as a full object (when sets, mode, or an explicit default are needed). A project declares reusable named status sets at the config root. This section governs the shape and the meaning each form carries; cross-reference validation is §2.

§1.AC.01 A note type configuration MUST accept an optional `allowedStatuses` declaration in either of two forms: a non-empty array of literal status strings, or an object carrying referenced `sets`, literal `values`, a `mode`, and an optional `defaultValue`. :4

§1.AC.02 The shorthand array form MUST be equivalent to an object form whose mode is `suggest` and whose default is the array's first element.

§1.AC.03 The object form MUST require a `mode` of either `suggest` or `enforce`, and MUST require at least one of `sets` or `values` to be present.

§1.AC.04 The object form MUST require a `defaultValue` when `mode` is `enforce`.

§1.AC.05 A project configuration MUST accept an optional top-level map of named reusable status sets, each mapping an identifier-shaped name to a non-empty list of status strings. :4

### §2 Validation

A note type's effective allowed status values are resolved by expanding every referenced set and combining the result with the type's literal values. The configuration is validated when the project config is loaded, both for referenced-set existence and for the default-in-allowed cross-constraint. A status value is validated against the resolved set under the type's mode.

§2.AC.01 The effective allowed values for a note type MUST be resolved by expanding each referenced set against the project's status sets and combining the expansion with the type's literal `values`. :4

§2.AC.02 A note type that declares no `allowedStatuses` MUST resolve to no governed values and MUST report a validation mode of `none` — every status is accepted without warning. :4

§2.AC.03 Under `enforce` mode, a status that is not a member of the resolved allowed values MUST be reported invalid, with a message naming the allowed values. :4

§2.AC.04 Under `suggest` mode, a status that is not a member of the resolved allowed values MUST be reported valid but accompanied by a warning naming the suggested values.

§2.AC.05 Config validation MUST reject an `allowedStatuses` object that references a set name absent from the project's status sets.

§2.AC.06 Config validation MUST reject an `allowedStatuses` object whose `defaultValue` is not a member of the type's resolved allowed values. :4

### §3 Create-Time Default and Validation

When a note is created for a type that governs status, the type's default is applied if the caller named no status, and the resulting status is validated under the type's mode before the note is written. Under `enforce`, an invalid status aborts creation; under `suggest`, it warns and proceeds. The resolved status is stamped into the new note's frontmatter.

§3.AC.01 On note creation without a caller-supplied status, the governing type's default status MUST be applied as the note's status. :4

§3.AC.02 On note creation, the resulting status MUST be validated against the type's resolved allowed values under the type's mode before the note file is written. :4

§3.AC.03 Under `enforce` mode, creating a note with a status outside the type's resolved allowed values MUST abort creation with an error naming the allowed values. :4

§3.AC.04 Under `suggest` mode, creating a note with a status outside the type's resolved allowed values MUST emit a warning and proceed with creation.

§3.AC.05 The status resolved at create time (caller-supplied or applied default) MUST be stamped into the new note's frontmatter.

### §4 Display of Allowed and Effective Statuses

The configuration-inspection surfaces expose a type's governed statuses: `scepter config` shows each type's allowed values with its mode and default and lists the reusable status sets, and the type-listing surface shows per-type status configuration.

§4.AC.01 `scepter config` MUST display, for each note type that governs status, the type's allowed values together with its mode and default value.

§4.AC.02 `scepter config` MUST display the project's reusable status sets and their values.

§4.AC.03 The note-type listing surface MUST expose, for each type that governs status, the resolved allowed values with the type's mode and default value.

## Edge Cases

### Referenced set name does not exist

**Detection:** A note type's `allowedStatuses.sets` names a set absent from the project's `statusSets`.
**Behavior:** Config validation reports the dangling reference ({§2.AC.05}). At resolution time, an absent set contributes no values rather than throwing, so resolution stays total even if validation is bypassed.

### Status named but no default configured

**Detection:** A note is created without a status for a type that governs status but configures no `defaultValue` (possible only under `suggest`, since `enforce` requires a default per {§1.AC.04}).
**Behavior:** No default is applied; the note is created without a stamped status. Validation reports `suggest` mode with no value to flag.

### Empty status string supplied at create time

**Detection:** A note is created with an empty-string status for a governing type.
**Behavior:** The empty string is treated as "no status supplied," so the type's default ({§3.AC.01}) applies if one is configured.

## Non-Goals

- **Status transition rules (state machines)** — this requirement governs which status values are permitted, not which transitions between them are legal. Workflow enforcement ("`approved` may only follow `proposed`") is out of scope.
- **Validation on every status edit** — invalid statuses written into a note after creation are not blocked on every mutation. Governance applies at create time (and is surfaceable on inspection); it mirrors the `suggest`/`enforce` posture rather than guarding every write path.
- **Status display styling (emoji/color)** — how a status renders is governed by the separate `statusMappings` configuration, not by `allowedStatuses`. This requirement governs the value set, not its presentation.
- **Cross-type status coupling** — each type's allowed set is resolved independently. A shared set referenced by two types does not couple their status lifecycles beyond the shared vocabulary.

## Acceptance Criteria Summary

| Cluster | Count |
|---------|-------|
| §1 Configuration Schema | 5 |
| §2 Validation | 6 |
| §3 Create-Time Default and Validation | 5 |
| §4 Display of Allowed and Effective Statuses | 3 |
| **Total** | **19** |

## References

- {R018} — Per-Type Declarable Frontmatter Fields. R018 generalizes this mechanism from the hard-coded `status` field to an arbitrary set of declared frontmatter fields; the field-set lifecycle (declare → stamp at create → validate) and the default-in-allowed cross-check are modeled directly on the `allowedStatuses` governance specified here. R019 is the concrete origin R018 derives its shape from.
- Config-surface sibling: {R010} — Verification Actor Default and Strictness Configuration, another per-project config-governance requirement validated at config-load time.

## Status

Authored 2026-06-24 against an already-shipped feature (see Implementation Notes below). Draft; awaiting review.

### Implementation Notes

The `allowedStatuses` / `StatusValidator` feature shipped before this requirement was authored, under code annotations that cited a phantom `T011` identifier ("Status Validation Service"). At the time of authoring (2026-06-24), no `T011` note existed in this project — the real taxonomy is A/R/S/DD/TS/T and that `T011` was never created. This requirement is the authored home for that work; the phantom-`T011` family of code annotations has been re-pointed to R019 claims. (Note: an unrelated, real {T011} — a Task on peer-claim-index caching in `PeerProjectResolver` — was created in this project on 2026-07-05; it has no connection to this Status Validation history, and the ID coincidence is noted here to prevent confusion.) Implementation sites:

- §1 — `core/src/types/config.ts` (`AllowedStatusesConfig`, `NoteTypeConfig.allowedStatuses`, `SCEpterConfig.statusSets`); `core/src/config/config-validator.ts` (`AllowedStatusesConfigSchema`, `AllowedStatusesSchema`, `StatusSetsSchema`).
- §2 — `core/src/statuses/status-validator.ts` (`StatusValidator`, `resolveAllowedStatuses`, `validateStatus`, `getMode`, `getDefaultStatus`); `core/src/config/config-validator.ts` (`validateStatusSetsReferences`); tests in `core/src/statuses/status-validator.test.ts`.
- §3 — `core/src/notes/note-manager.ts` (`createNote` status-validation-and-default block); `core/src/cli/commands/context/create-handler.ts` (CLI create-time status integration).
- §4 — `core/src/cli/commands/config-display-handler.ts` (`scepter config` allowed-status and status-set display); `core/src/cli/commands/types/list-handler.ts` and `core/src/project/types.ts` (`TypeInfo.allowedStatuses`) and `core/src/project/project-manager.ts` (`listNoteTypes` population) for the type-listing surface.
