---
created: 2026-04-02T04:55:43.684Z
modified: 2026-04-02
tags: [parser, config, regex, note-id]
status: draft
---

# DD009 - Note ID Digit Width Relaxation

## Problem

SCEpter currently hardcodes `\d{3,5}` in ~24 regex patterns across 10 source files. This enforces that note IDs must have exactly 3-5 digits (e.g., R001 through R99999). The constraint is scattered at the parse layer rather than being a configurable creation-time default.

Consequences:
- A note with ID `R01` or `R000001` is invisible to parsers, discovery, references, and claims
- Projects that want shorter or longer IDs cannot configure them
- The digit width is a policy decision that belongs in configuration, not in regex literals

## Approach

Split the concern into two distinct behaviors:

1. **Parsing/acceptance**: All regex patterns relax to `\d+` (accept any count of digits). If a note exists on disk with any digit count, the system recognizes it.
2. **Creation-time default**: A new `defaultIdWidth` config field (default: 3) controls how many zero-padded digits are used when creating new notes. This is the only place the digit count is enforced.

The maximum counter ceiling in `NoteIdGenerator` becomes derived from `defaultIdWidth` rather than hardcoded to 99999.

## §1 Configuration

### Config Schema Addition

§DC.01 The `SCEpterConfig` interface MUST add an optional `defaultIdWidth` field of type `number`.

The field lives at the top level of `scepter.config.json`, alongside `discoveryPaths`, `timestampPrecision`, etc. Default value: 3 (preserving current behavior for existing projects). Valid range: 1-8 inclusive.

Files:
- `core/src/types/config.ts` — add `defaultIdWidth?: number` to `SCEpterConfig`
- `core/src/config/config-validator.ts` — add Zod validation: `z.number().int().min(1).max(8).optional().default(3)`
- `core/src/config/default-scepter-config.ts` — no change needed (the Zod default handles it)

§DC.02 The `NoteIdGenerator` MUST read `defaultIdWidth` from config to determine padding width and maximum counter value.

Currently `formatId()` hardcodes `5` as the digit count (line 151) and the counter ceiling is hardcoded to `99999` (line 66). Both must derive from config:
- Padding width = `config.defaultIdWidth ?? 3`
- Maximum counter = `10^defaultIdWidth - 1`

Files:
- `core/src/notes/note-id-generator.ts` lines 66-67, 150-151

§DC.03 The `formatNoteId()` utility MUST use `defaultIdWidth` as its fallback padding when no explicit `digits` parameter is provided.

Currently `formatNoteId()` in `shared-note-utils.ts` (line 115) defaults to 3 for single-char shortcodes and 5 for multi-char. The function signature already accepts an optional `digits` parameter, so the change is: callers that know the config pass the configured width; the function's internal default stays as-is (it cannot access config). The `NoteIdGenerator.formatId()` method is the caller that must change.

Files:
- `core/src/notes/note-id-generator.ts` line 151 — pass configured width instead of hardcoded `5`

## §2 Parser Relaxation — Accept Any Digit Count

Every regex that matches note IDs at parse time must change from `\d{3,5}` to `\d+`. These are read-path patterns — they determine what the system recognizes, not what it creates.

### shared-note-utils.ts

§DC.04 The `parseNoteId()` regex MUST change from `\d{3,5}` to `\d+`.

File: `core/src/parsers/note/shared-note-utils.ts` line 27
```
Before: /^([A-Z]{1,5})(\d{3,5})$/
After:  /^([A-Z]{1,5})(\d+)$/
```

§DC.05 The `extractModifier()` regexes MUST change from `\d{3,5}` to `\d+`.

File: `core/src/parsers/note/shared-note-utils.ts` lines 78, 88
```
Before: /^([A-Z]{1,5}\d{3,5})\+$/    (line 78)
         /^([A-Z]{1,5}\d{3,5})\.$/    (line 88)
After:  /^([A-Z]{1,5}\d+)\+$/
         /^([A-Z]{1,5}\d+)\.$/
```

### note-parser.ts

§DC.06 The `parseNoteMentions()` regex MUST change from `\d{3,5}` to `\d+`.

File: `core/src/parsers/note/note-parser.ts` line 191
```
Before: /\{([A-Z]{1,5}\d{3,5})(?!\d)...
After:  /\{([A-Z]{1,5}\d+)(?!\d)...
```

The `(?!\d)` negative lookahead already prevents partial matches; the relaxation to `\d+` does not change its behavior since `\d+` is greedy and consumes all digits before the lookahead fires.

### claim-parser.ts

§DC.07 The `NOTE_ID_RE` constant MUST change from `\d{3,5}` to `\d+`.

File: `core/src/parsers/claim/claim-parser.ts` line 60
```
Before: /^[A-Z]{1,5}\d{3,5}$/
After:  /^[A-Z]{1,5}\d+$/
```

§DC.08 The braceless claim-matching patterns MUST change from `\d{3,5}` to `\d+`.

File: `core/src/parsers/claim/claim-parser.ts` lines 526, 536
```
Line 526 before: /(?<![A-Za-z0-9{])[A-Z]{1,5}\d{3,5}\.\S+?...
Line 526 after:  /(?<![A-Za-z0-9{])[A-Z]{1,5}\d+\.\S+?...

Line 536 before: /(?<![A-Za-z0-9.{])[A-Z]{1,5}\d{3,5}(?![A-Za-z0-9.}])/g
Line 536 after:  /(?<![A-Za-z0-9.{])[A-Z]{1,5}\d+(?![A-Za-z0-9.}])/g
```

### claim-tree.ts

§DC.09 The note-ID guard in claim-tree validation MUST change from `\d{3,5}` to `\d+`.

File: `core/src/parsers/claim/claim-tree.ts` line 466
```
Before: /^[A-Z]{1,5}\d{3,5}$/
After:  /^[A-Z]{1,5}\d+$/
```

This guard prevents a note ID (e.g., `REQ004`) from being flagged as a forbidden claim form. With `\d+`, note IDs of any digit width are correctly excluded.

### unified-discovery.ts

§DC.10 The `NOTE_ID_REGEX` constant MUST change from `\d{3,5}` to `\d+`.

File: `core/src/discovery/unified-discovery.ts` line 25
```
Before: /^([A-Z]{1,5}\d{3,5})(?:\s|\.md|$)/
After:  /^([A-Z]{1,5}\d+)(?:\s|\.md|$)/
```

### note-manager.ts

§DC.11 The `validateNoteId()` regex MUST change from `\d{3,5}` to `\d+`.

File: `core/src/notes/note-manager.ts` line 415
```
Before: /^[A-Z]{1,5}\d{3,5}$/
After:  /^[A-Z]{1,5}\d+$/
```

### project-manager.ts

§DC.12 The shortcode rename regexes MUST change from `\d{3,5}` to `\d+`.

File: `core/src/project/project-manager.ts` lines 950, 1211
```
Line 950 before: new RegExp(`^${oldShortcode}(\\d{3,5})`)
Line 950 after:  new RegExp(`^${oldShortcode}(\\d+)`)

Line 1211 before: new RegExp(`^${shortcode}(\\d{3,5})`)
Line 1211 after:  new RegExp(`^${shortcode}(\\d+)`)
```

These are used during type rename operations to match existing note filenames regardless of their digit width.

### type-reference-utils.ts

§DC.13 The file-matching regex MUST change from `\d{3,5}` to `\d+`.

File: `core/src/project/type-reference-utils.ts` line 126
```
Before: new RegExp(`^(${oldShortcode}\\d{3,5})(\\s.+)?\\.md$`)
After:  new RegExp(`^(${oldShortcode}\\d+)(\\s.+)?\\.md$`)
```

### reference-tag-utils.ts

§DC.14 All four reference-tag regex patterns MUST change from `\d{3,5}` to `\d+`.

File: `core/src/references/reference-tag-utils.ts` lines 19, 57, 94, 116

All four have identical structure:
```
Before: /^(\{[A-Z]{1,5}\d{3,5})([$+><*]*)(#[^}]+)?(\}.*)/
After:  /^(\{[A-Z]{1,5}\d+)([$+><*]*)(#[^}]+)?(\}.*)/
```

### resolve-claim-id.ts

§DC.15 All four note-ID validation regexes MUST change from `\d{3,5}` to `\d+`.

File: `core/src/cli/commands/shared/resolve-claim-id.ts` lines 176, 194, 207, 253

All have identical pattern:
```
Before: /^[A-Z]{1,5}\d{3,5}$/
After:  /^[A-Z]{1,5}\d+$/
```

### note-formatter.ts

§DC.16 The syntax-highlighting regexes MUST change from `\d{3,5}` to `\d+`.

File: `core/src/cli/formatters/note-formatter.ts` lines 134, 138

```
Line 134 before: [A-Z]{1,5}\\d{3,5}\\.§?\\d+...
Line 134 after:  [A-Z]{1,5}\\d+\\.§?\\d+...

Line 138 before: [A-Z]{1,5}\\d{3,5})(?![A-Za-z0-9.}])
Line 138 after:  [A-Z]{1,5}\\d+)(?![A-Za-z0-9.}])
```

Note: Line 132 already uses `\d{1,5}` for braced references. This should also change to `\d+` for consistency, though it is less urgent since `{1,5}` is already more permissive than `{3,5}`.

### search.ts

§DC.17 The `BARE_NOTE_ID_RE` constant MUST change from `\d{3,5}` to `\d+`.

File: `core/src/cli/commands/context/search.ts` line 34
```
Before: /^[A-Z]{1,5}\d{3,5}$/i
After:  /^[A-Z]{1,5}\d+$/i
```

The comment on line 6 should also be updated to reflect the new pattern.

## §3 Creation-Time Enforcement

These changes control what IDs are produced (not what is accepted).

§DC.18 The `NoteIdGenerator.formatId()` method MUST use `config.defaultIdWidth` instead of hardcoded `5`.

File: `core/src/notes/note-id-generator.ts` line 151
```
Before: const baseId = formatNoteId(shortcode, number, 5);
After:  const baseId = formatNoteId(shortcode, number, this.config.defaultIdWidth ?? 3);
```

§DC.19 The `NoteIdGenerator` counter ceiling MUST derive from `defaultIdWidth`.

File: `core/src/notes/note-id-generator.ts` lines 66-67
```
Before:
  if (this.counters[typeName] > 99999) {
    throw new Error(`Note ID counter for ${typeName} exceeded maximum of 99999`);
  }

After:
  const maxId = Math.pow(10, (this.config.defaultIdWidth ?? 3)) - 1;
  if (this.counters[typeName] > maxId) {
    throw new Error(`Note ID counter for ${typeName} exceeded maximum of ${maxId}`);
  }
```

## §4 Integration Sequence

The changes must be applied in this order to keep tests passing throughout:

§DC.20 The implementation MUST follow this phased sequence to maintain green tests at each step.

**Phase 1 — Config schema (no behavioral change).**
Add `defaultIdWidth` to the type, Zod schema, and default config. No code reads it yet. All tests pass trivially.

**Phase 2 — Parser relaxation (broadens acceptance).**
Change all `\d{3,5}` patterns to `\d+` across parsers, discovery, references, formatters, and CLI utilities. Existing tests continue to pass because all existing IDs (3-5 digits) are still accepted. New IDs with fewer or more digits also become accepted.

**Phase 3 — Creation-time width (narrows creation output).**
Wire `NoteIdGenerator` to read `defaultIdWidth`. The default value is 3, which matches the most common test expectations. Tests that assert 5-digit output (the current `formatId` hardcodes 5) must be updated to expect 3-digit output, or the tests must supply `defaultIdWidth: 5` in their config fixtures.

**Phase 4 — Test updates.**
- `note-id-generator.test.ts`: Update assertions that expect 5-digit IDs (e.g., `D00001` becomes `D001` with default width 3). Tests for the 99999 ceiling must test the configured ceiling instead.
- `shared-note-utils.test.ts`: Add tests for IDs with 1-2 digits and 6+ digits.
- `note-manager.test.ts`: Update `validateNoteId` tests to accept any digit count.
- Add integration test: create a note with `defaultIdWidth: 5`, verify ID is 5-digit padded.

## §5 Inventory Summary

Complete list of files and change counts:

| File | Lines | Change Type |
|---|---|---|
| `core/src/types/config.ts` | new field | Add `defaultIdWidth` |
| `core/src/config/config-validator.ts` | ~L250 | Add Zod field |
| `core/src/parsers/note/shared-note-utils.ts` | 27, 78, 88 | `\d{3,5}` to `\d+` |
| `core/src/parsers/note/note-parser.ts` | 191 | `\d{3,5}` to `\d+` |
| `core/src/parsers/claim/claim-parser.ts` | 60, 526, 536 | `\d{3,5}` to `\d+` |
| `core/src/parsers/claim/claim-tree.ts` | 466 | `\d{3,5}` to `\d+` |
| `core/src/discovery/unified-discovery.ts` | 25 | `\d{3,5}` to `\d+` |
| `core/src/notes/note-manager.ts` | 415 | `\d{3,5}` to `\d+` |
| `core/src/notes/note-id-generator.ts` | 66-67, 151 | Config-driven width + ceiling |
| `core/src/project/project-manager.ts` | 950, 1211 | `\d{3,5}` to `\d+` |
| `core/src/project/type-reference-utils.ts` | 126 | `\d{3,5}` to `\d+` |
| `core/src/references/reference-tag-utils.ts` | 19, 57, 94, 116 | `\d{3,5}` to `\d+` |
| `core/src/cli/commands/shared/resolve-claim-id.ts` | 176, 194, 207, 253 | `\d{3,5}` to `\d+` |
| `core/src/cli/formatters/note-formatter.ts` | 132, 134, 138 | `\d{3,5}` / `\d{1,5}` to `\d+` |
| `core/src/cli/commands/context/search.ts` | 6, 34 | `\d{3,5}` to `\d+` |

**Total: 15 files, 27 regex sites, 2 config additions, 2 generator logic changes.**

## §6 Risks and Edge Cases

§DC.21 The relaxation to `\d+` introduces a false-positive risk for braceless matching of short IDs.

An ID like `R1` or `A12` could collide with ordinary English abbreviations or version strings. Mitigation: braceless matching already requires known shortcodes (the `knownShortcodes` guard in claim-parser.ts line 535). The short-ID false-positive risk only applies to bare matches, not braced `{R1}` references. This is acceptable because:
- Braced references are unambiguous regardless of digit count
- Braceless matching is already opt-in via `claims.bracelessMatching` config
- Real-world usage will predominantly use 3+ digit IDs; short IDs are edge cases

§DC.22 The `defaultIdWidth` MUST NOT affect parsing — only creation.

This is the core architectural invariant of the change. Parsing always uses `\d+`. If a note file exists with any digit count, it is discovered, parsed, referenced, and traced. The `defaultIdWidth` only controls what `NoteIdGenerator.generateNextId()` produces.

## §7 Projections

- **Source**: 15 files with regex changes, 2 files with config additions, 1 file with generator logic changes
- **Tests**: Test updates in Phase 4; new test cases for short/long IDs
- **CLI**: No command interface changes; behavior changes are transparent
- **Documentation**: ARCHITECTURE_OVERVIEW.md mentions `[A-Z]{1,5}\d{3,5}` in the discovery description (line 357) — update to reflect relaxed pattern
- **Config**: New `defaultIdWidth` field visible in `scepter config` output
