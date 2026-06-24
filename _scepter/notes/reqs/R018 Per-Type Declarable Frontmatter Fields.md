---
created: 2026-06-24T21:38:19.179Z
tags:
  - config
  - frontmatter
  - note-types
  - lint
confidence: 🤖2 2026-06-24
---

# R018 - Per-Type Declarable Frontmatter Fields

## Overview

A note type can govern an arbitrary set of frontmatter fields beyond the built-in `status`. A project declares fields per type — name, optional default, optional closed value set, optional required flag — and the system stamps them on every new note of that type and validates them when the note is linted. **Core Principle:** the per-type governance that `allowedStatuses` already provides for one hard-coded field (`status`) generalizes to any declared field, so that conventions like "every Specification carries a `version` and a `lifecycle`, every Requirement names an `owner`" become enforceable configuration rather than unwritten team habit.

## Problem Statement

`status` is the only frontmatter field a project can govern per note type. The governance is entirely hard-coded to that one key: `AllowedStatusesConfig` (`core/src/types/config.ts`) carries `values`/`sets`/`mode`/`defaultValue` for `status` and nothing else; `StatusValidator` (`core/src/statuses/status-validator.ts`) resolves and checks only `status`; the create-time stamping in `NoteFileManager.getNoteTemplate` (`core/src/notes/note-file-manager.ts`) special-cases `status` from `note.metadata` and stamps no other declared field.

Any other field a team wants every note of a type to carry — a `version`, a `lifecycle`, an `owner`, a `reviewer` — has no home. There is no way to declare it, no way to have it stamped so it is present to edit, and no way to have `scepter lint` flag a note that is missing a mandatory field or carries a value outside an agreed set. The convention lives only in reviewers' heads, and drift is invisible to the tooling.

| Scenario | Current Behavior | Required Behavior |
|----------|-----------------|-------------------|
| Project wants every Specification to carry a `version` | No declaration mechanism; field absent from new notes | Declare `fields: [{ name: "version", default: "0.1.0", required: true }]`; field stamped on create, flagged by lint if removed |
| Project wants `lifecycle` constrained to `draft`/`active`/`deprecated` | No closed-set enforcement for any field but `status` | Declare `allowed: ["draft","active","deprecated"]`; lint flags any out-of-set value |
| A note of a type with declared fields is created | Only `status` (and built-ins) appear in frontmatter | Each declared field appears with its default or an empty placeholder, always present to edit |
| A note type declares no extra fields | Frontmatter is built from built-ins only | Identical output — the feature is inert for types that do not opt in |

## Design Principles

**Generalize the proven mechanism, do not invent a new one.** The shape, the create-time-stamp-then-lint-time-validate lifecycle, and the cross-field checks (default must be a member of the allowed set) all mirror `allowedStatuses`. A field set is `allowedStatuses` for fields the system does not already own.

**Opt-in and inert by default.** A note type that declares no `fields` MUST behave exactly as it did before this feature — byte-identical new-note output, no new lint diagnostics. The feature adds capability only where a project asks for it.

**The built-in fields stay owned by the system.** `created`, `modified`, `tags`, and `status` are produced and governed by existing machinery. A declared field set MUST NOT redeclare them; `status` in particular is governed by `allowedStatuses`, and an attempt to declare it as a generic field is redirected there.

## Requirements

A note type configuration MAY carry a `fields` declaration: an ordered list of declared frontmatter fields. Each field declares a `name` and optionally a `default`, a closed `allowed` value set, and a `required` flag.

The field declaration vocabulary:

```typescript
interface NoteTypeFieldConfig {
  name: string;          // a valid identifier; not a reserved built-in name
  default?: string;      // stamped value when the caller supplies none
  allowed?: string[];    // closed set of permitted values; non-empty if present
  required?: boolean;    // lint flags the note when this field is absent or empty
}
```

### §1 Config Schema and Validation

The `fields` declaration is validated when the project config is loaded — both for the structural shape of each field and for cross-field constraints that the structural shape cannot express. A configuration that violates any constraint MUST be rejected with a diagnostic identifying the offending field.

§1.AC.01 A note type configuration MUST accept an optional ordered list of declared frontmatter fields, each declaring a `name` and optionally a `default`, an `allowed` value set, and a `required` flag.

§1.AC.02 Config validation MUST reject a declared field whose `name` is not a valid identifier (leading letter, then alphanumerics or underscore).

§1.AC.03 Config validation MUST reject a declared `allowed` set that is present but empty; a closed set MUST carry at least one value.

§1.AC.04 Config validation MUST reject a declared field whose `name` is a reserved built-in field (`created`, `modified`, `tags`, `status`). The diagnostic for `status` MUST direct the author to `allowedStatuses` instead. :4

§1.AC.05 Config validation MUST reject two declared fields that share the same `name` within a single note type.

§1.AC.06 Config validation MUST reject a declared field whose `default` is not a member of its `allowed` set, when both are present.

### §2 Create-Time Stamping

When a note is created for a type that declares fields, each declared field MUST appear in the new note's frontmatter so that it is always present to edit. The stamped value is the declared default, or — when the caller supplied a value for that field — the caller's value, or — when neither exists — an empty placeholder.

§2.AC.01 On note creation, each field declared for the note's type MUST be stamped into the new note's frontmatter. :4

§2.AC.02 A declared field with a configured `default` and no caller-supplied value MUST be stamped with that default.

§2.AC.03 A declared field with no `default` and no caller-supplied value MUST be stamped with an empty placeholder, so the key is present for the author to fill in.

§2.AC.04 A caller-supplied value for a declared field MUST take precedence over that field's configured `default`.

§2.AC.05 Creating a note for a type that declares no fields MUST produce frontmatter byte-identical to the output before this feature existed. :4

### §3 Lint-Time Validation

When a note is linted, each field declared for the note's type is checked against the note's frontmatter. A field marked `required` that is absent or empty, and a present value outside a field's `allowed` set, are each reported as a distinct lint diagnostic.

§3.AC.01 `scepter lint` MUST report a diagnostic for a `required` declared field that is absent from a note's frontmatter or present but empty. :4

§3.AC.02 `scepter lint` MUST report a diagnostic for a declared field whose value is outside its configured `allowed` set.

§3.AC.03 An absent declared field that is not `required` MUST NOT be validated against its `allowed` set and MUST NOT produce a diagnostic.

§3.AC.04 Linting a note whose type declares no fields MUST produce no field-related diagnostics. :4

## Edge Cases

### Caller supplies a value outside the allowed set at create time

**Detection:** A note is created with a metadata value for a declared field that has an `allowed` set, and the supplied value is not a member.
**Behavior:** Create-time stamping records the supplied value (it does not silently substitute the default). The out-of-set condition surfaces at lint time via {§3.AC.02}, keeping create-time stamping mechanical and concentrating value-set enforcement on the lint projection.

### Field declared `required` with a non-empty `default`

**Detection:** A field is both `required: true` and carries a `default`.
**Behavior:** The default is stamped at create time ({§2.AC.02}), so a freshly created note already satisfies the required check ({§3.AC.01}). The required diagnostic fires only if an author later removes or empties the field.

### Reserved name `status` declared as a generic field

**Detection:** A `fields` entry names `status`.
**Behavior:** Config validation rejects it ({§1.AC.04}) with a diagnostic directing the author to declare status values via `allowedStatuses`, preventing two competing governance paths for the same key.

## Non-Goals

- **Typed field values (number, boolean, date)** — declared fields are string-valued. Richer value typing is deferred; the `allowed` closed set covers the enumerated-value case that motivates this feature.
- **Field validation on every read or write path** — validation is a lint-time concern, not enforced on every note mutation. This mirrors `allowedStatuses` `suggest` semantics and keeps create-time stamping mechanical.
- **Cross-field or conditional field rules** (e.g., "field B required only when field A equals X") — out of scope. Each declared field is validated independently.
- **Retroactive backfill of existing notes** — declaring a new field does not rewrite notes created before the declaration. Lint surfaces the gap ({§3.AC.01}); remediation is an authoring action.

## Acceptance Criteria Summary

| Cluster | Count |
|---------|-------|
| §1 Config Schema and Validation | 6 |
| §2 Create-Time Stamping | 5 |
| §3 Lint-Time Validation | 4 |
| **Total** | **15** |

## References

- Generalizes the per-type `status` governance mechanism (`allowedStatuses` / `StatusValidator`), which has no requirement note of its own. The field-set lifecycle (declare → stamp at create → validate at lint) and the cross-field default-in-allowed check are modeled on it directly.
- {R008} — Folder Note Claim Aggregation. Lint operates over the aggregated note unit; field validation reads the main file's frontmatter, which is the authoritative frontmatter for a folder note.
- Config-surface sibling: {R010} — Verification Actor Default and Strictness Configuration, another per-project config-governance requirement validated at config-load time.

## Status

Authored 2026-06-24 against an already-implemented working-tree feature (see Implementation Notes below). Draft; awaiting review.

### Implementation Notes

The feature was implemented in the working tree before this requirement was authored, under code annotations that cited a phantom `{F005}` identifier (no `Feature`/`F` note type exists in this project — the real taxonomy is A/R/S/DD/TS/T). This requirement is the authored home for that work; the `{F005}` code annotations have been re-pointed to R018 claims. Implementation sites:

- §1 — `core/src/types/config.ts` (`NoteTypeFieldConfig`, `NoteTypeConfig.fields`); `core/src/config/config-validator.ts` (`NoteTypeFieldConfigSchema`, `RESERVED_FIELD_NAMES`, `validateNoteTypeFields`).
- §2 — `core/src/notes/note-file-manager.ts` (`getNoteTemplate` stamping block); `core/src/cli/commands/context/create-handler.ts` (template-frontmatter injection).
- §3 — `core/src/cli/commands/claims/lint-command.ts` (`validateFrontmatterFields`); `core/src/parsers/claim/claim-tree.ts` (`missing-required-field`, `invalid-field-value` error codes).

