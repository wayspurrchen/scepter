---
created: 2026-04-02T03:29:19.414Z
tags: [cli, claims, ux]
---

# DD008 - Show Command - Claim Display and Fuzzy ID Resolution

**Related:** {A001} (CLI unification), {DD006} (unified CLI), {R004} (claim system)

## Problem

`scepter show` only accepts note IDs. Passing a claim address (`DD007.§1.DC.03`) returns "Notes not found." Users and agents have no way to view a specific claim via `show` and must know to use `trace` instead. Additionally, the show output renders note content as plain text — note IDs (`{R005}`) and claim addresses (`{R005.§1.AC.03}`) within the content are not visually distinguished.

Users also need tolerance for shorthand when typing claim addresses:
- `DD7` instead of `DD007` (compressed zeros)
- `DD0007` instead of `DD007` (excess zeros — strip down)
- `DD007.DC.01` without the section number (ambiguous → show matches)
- `DD007.1` to show all claims in a section
- `$` instead of `§` (shell-friendly)
- `DD007.1.DC.1` instead of `DD007.1.DC.01` (unpadded claim number)
- `DD007.01.DC.002` with excess zeros in section or claim number (strip down)

## §1 Fuzzy Claim ID Resolution

### NEW: `core/src/cli/commands/shared/resolve-claim-id.ts`

§DC.01 Create a `resolveClaimInput(input: string, data: ClaimIndexData)` function that normalizes and resolves a user-provided string to zero or more claim index entries. Normalization steps:

1. Replace `$` with `§` (shell escape)
2. Strip `§` for index lookup (the index uses dotted form without `§`)
3. Normalize digits bidirectionally: strip excess zeros then pad short ones (`DD7` → `DD007`, `DD0007` → `DD007`, `DC.1` → `DC.01`, `DC.002` → `DC.02`)
4. Strip leading zeros from section path segments (`01` → `1`) without affecting claim numbers
5. Attempt exact match in `data.entries`
6. If input is a section reference (NOTEID.SECTION, e.g., `DD007.1`): return all claims in that section
7. If no exact match and input has no section path: try all entries ending with the claim suffix (e.g., `DD007.DC.01` matches `DD007.1.DC.01` and `DD007.2.DC.01`)
8. Return `{ matches: ClaimIndexEntry[], normalized: string }`

§DC.02 Zero normalization is bidirectional: note ID shortcodes normalize to the width found in existing entries (strip excess or pad short). Claim numbers normalize to exactly 2 digits. Section path segments strip leading zeros (section `01` → `1`). The `stripSectionZeroPadding()` helper distinguishes section segments from claim numbers by checking whether the preceding part is an uppercase claim prefix.

### MODIFY: `core/src/cli/commands/context/show.ts` + `show-handler.ts`

§DC.03 Before note lookup, check if each input ID looks like a claim address (contains `.` and a claim prefix pattern) OR a section reference (NOTEID.DIGITS). Detection uses `looksLikeClaimAddress()` which tries `parseClaimAddress()` first, then `preNormalizeForDetection()` for shorthand forms, then checks for section-only patterns. The `preNormalizeForDetection()` helper normalizes digits bidirectionally (strips excess zeros, pads short ones) and strips section zero-padding, ensuring that `DD00007.001.DC.0000001` is recognized as a claim address.

§DC.04 When a claim address resolves to exactly one claim: display it using `formatClaimTrace()` from `claim-formatter.ts` (same format as `scepter trace <claimId>` — shows claim detail, references, verification history).

§DC.05 When a claim address resolves to multiple claims (ambiguous — e.g., section was omitted, or a section reference matching multiple claims): list all matches with their fully qualified IDs and section headings so the user can disambiguate. Format: one line per match showing FQID, heading, and line number.

§DC.06 When a claim address resolves to zero claims: show "Claim not found" with fuzzy suggestions (reuse existing fuzzy match logic from `trace-command.ts`).

§DC.07 When input looks like a bare note ID (no dots, no claim prefix) but is not found as a note: try zero-padding (`DD7` → `DD007`) and zero-stripping (`DD0007` → `DD007`) before giving up.

## §2 Content Syntax Highlighting

### MODIFY: `core/src/cli/formatters/note-formatter.ts`

§DC.08 In the `formatNote` content rendering, apply syntax highlighting to recognized patterns in note content via `highlightContent()`. Five pattern groups in a single combined regex:

1. Braced references: `{R005}`, `{DD007.§1.DC.03}` → cyan
2. Fully-qualified bare claims: `R005.§1.AC.03`, `DD007.1.DC.01` → cyan
3. Bare §-prefixed claims and sections: `§DC.01`, `§1.DC.01`, `§1`, `§3.1` → cyan
4. Bare note IDs: `DD007`, `R005`, `A001` (1-5 uppercase + 3-5 digits, not in braces or followed by `.`) → cyan
5. `@implements`, `@depends-on`, `@validates`, `@see`, `@addresses`, `@blocked-by` keywords → green

§DC.09 The highlighting MUST NOT alter the underlying text — only add ANSI color codes around recognized tokens. It MUST be disabled when `--no-format` is passed (the `format` option is already false in that case) or when outputting JSON.

§DC.10 Use a single combined regex per line for efficiency. The regex uses alternation groups with negative lookbehind/lookahead to prevent false matches inside words or braces.

## §3 Integration Sequence

1. Create `resolve-claim-id.ts` with `resolveClaimInput()` (DC.01, DC.02)
2. Modify `show-handler.ts` to detect claim addresses and route through claim resolution (DC.03-DC.07)
3. Add content highlighting to `note-formatter.ts` (DC.08-DC.10)
4. `pnpm tsc --noEmit` and `pnpm test -- --run`

