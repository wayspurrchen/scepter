---
created: 2026-04-26T18:16:43.535Z
tags: [claims,parser,linter,docs]
status: ready_for_review
refs: [R004]
---

# T001 - Document and enforce single-letter-segment claim prefix rule

## Context

A spec authored in another project defined ~150 acceptance criteria in tables
using shapes like `FOO.AC.01`, `BAR.AC.01`. The parser silently drops these
(they fail to match `[A-Z]+\.\d{2,3}`), producing zero claims while the
document looks well-structured. R004 forbade alphanumeric prefixes (`PH1.01`)
but never explicitly addressed multi-letter-segment prefixes; the rule was
implicit in the grammar.

## Changes

**R004 (the requirement):**
- Added §1.AC.08:4 explicitly forbidding multi-letter-segment claim prefixes
- Added parallel design-prose paragraph above the AC list
- Updated `Acceptance Criteria Summary` table (§1: 7 → 8, total: 33 → 34)

**claims.md (the skill):**
- Added "One letter-prefix segment" row to `Hard Rules` table
- Added "A claim ID has exactly one letter-prefix segment" callout in
  `Choosing Claim Prefixes` section
- Added new `Spec authoring with many entities` worked example showing both
  valid alternatives (sections + single prefix; or single namespacing prefix)
- Added forbidden-shape row to `Common Mistakes` table

**Parser (`core/src/parsers/claim/claim-tree.ts`):**
- Added `MULTI_SEGMENT_PREFIX_RE` (global, in-text) and
  `LINE_MULTI_SEGMENT_PREFIX_RE` (anchored, line-leading)
- Added `checkMultiSegmentPrefix()` helper with constructive error message
- Wired into heading, table-cell, and paragraph-leading positions
- Added `@implements {R004.§1.AC.08}` annotation

**Tests (`core/src/parsers/claim/__tests__/claim-tree.test.ts`):**
- Added 10 tests under `validateClaimTree — multi-letter-segment prefix detection`
- Covers heading / paragraph / table-cell / bold-wrapped positions
- Covers prefix variations
- Covers no-flag cases: note-ID-prefixed forms, fully-qualified prose refs,
  backtick-protected discussion, valid single-prefix claims
- Regression baseline test confirming the silent-drop behavior is now surfaced

## Verification

- All 470 claim-related tests pass; type-check clean
- `scepter lint R004` produces no false positives from new R004 prose
- `scepter trace R004` shows AC.08 with `claim-tree.ts(x2)` source coverage
- Regression check on the original problem document: prior `No claims found`
  silent drop now produces line-by-line forbidden-form errors with
  constructive suggestions

## Out of scope

- Reformatting the source document that motivated this work
- Documenting table-claims in claims.md (flagged as a separate gap)
- Header-row footgun in table parser (separate issue)
