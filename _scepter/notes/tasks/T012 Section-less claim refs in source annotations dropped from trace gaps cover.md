---
created: 2026-07-06T17:07:31.575Z
tags: [bug, parser, traceability, coverage-gap]
confidence: 🤖2 2026-07-06
status: ready_for_review
---

# T012 - Section-less § claim refs in source annotations dropped from trace/gaps coverage

**Status: fixed 2026-07-06, pending review.**

## Symptom

`scepter gaps` / `scepter trace` reported claims as having zero `Source` coverage even when the claim was cited in live `@implements` blocks — the "the coverage tool overstates disconnection" false-positive class. Surfaced on a downstream project's `DD018` (a fully-built cross-type query API): 29 of its claims showed `Source = -` in `trace` despite the implementation file carrying an `@implements` for each. `scepter show --source-file` on the implementation file revealed the cause: every `@implements {DD018.§DC.06}` was being indexed as a bare note-level `{DD018}` mention — the claim path was silently dropped.

## Root cause

The source-mention regex in `core/src/parsers/note/note-parser.ts` (`parseNoteMentions`, group 2 = claimPath) tolerated the `§` section marker only when it preceded a **numeric** section segment (`.§3`), not when it preceded the **claim prefix** in a section-less citation (`.§DC.06`):

```
(?:\.§?\d+)*(?:\.[A-Z]+\.\d{2,3}[a-z]?)?
                  ^^^ no §? before the claim prefix
```

So `{DD018.§DC.06}` (a section-less note whose author wrote the `§` marker directly before the claim prefix) matched an empty claim path and degraded to a note-level mention. `{DD018.DC.06}` (no `§`) and `{DD014.§3.DC.55}` (`§` before a numeric section) both worked. This is a direct violation of {R004.§2.AC.03} — "§ is optional emphasis, parsing identical with/without" — in the source-annotation projection.

Every sibling claim-segment regex in the codebase already carried the `§?` before `[A-Z]+` (`claim-parser.ts` `CLAIM_SEGMENT_RE`, `claim-tree.ts:296`/`:340`, `claim-formatter.ts:152`). `note-parser.ts` was the lone straggler. The downstream `addSourceReferences` (`claim-index.ts:929`) already strips `§` before FQID assembly, so no other layer needed touching.

## Fix

Added `§?` before the claim prefix in the claim-segment portion of the mention regex, mirroring the section-segment's existing `§?`:

```
(?:\.§?\d+)*(?:\.§?[A-Z]+\.\d{2,3}[a-z]?)?
```

- Source: `core/src/parsers/note/note-parser.ts` (the `startRegex` at the `parseNoteMentions` mention-scan) — @see {R004.§2.AC.03}
- Tests: `core/src/parsers/note/note-parser.test.ts` — two regression cases pinning the section-less `§`-before-prefix form (`{DD018.§DC.06}`, sub-letter `{DD018.§DC.06a}`).

## Verification

- `note-parser`, `partial-coverage-gaps`, `traceability`, `source-code-scanner-adapter` suites: 147 pass (145 prior + 2 new regression).
- `pnpm tsc`: clean.
- Reproduction corpus re-traced after fix: `DD018.DC.10` went from `Source = -` to `cross-type-query-engine.ts(x4)`; all previously-missed implementation-file `@implements` now register.
- Blast radius on the corpus: the broken section-less `§` form appeared at 772 source annotation sites → 327 distinct claims across 21 notes, all previously invisible to coverage tooling (the ~8,930 `§`-before-numeric-section sites were unaffected). A large slice of the reported coverage-gap false positives traces to this single regex.

## Follow-up (not in scope here)

- The false-positive rate of `scepter gaps` was itself unrecorded upstream. This fix removes the largest mechanical contributor; genuinely-uncovered and scope-exclusion-prose claims remain (correctly) reported.
- Realizes {R004.§2.AC.03} in the source-annotation projection; consider whether {R004} warrants an explicit AC that the source-mention parser (not just the note-content parser) honors §-optionality, since the two use different regex engines.

## Related

- {R004.§2.AC.03} — the requirement this fix restores conformance to (§-optionality is emphasis-only, identical parse with/without).
- {DD001} — primary detailed design for R004; §7's traceability matrix row for `R004.§2.AC.03` cited only `claim-parser.ts`'s `normalizeSectionSymbol()` as the realization site. `note-parser.ts`'s independent mention-scan regex is a second, previously-undocumented realization site for the same AC — this task is its fix and its record.
- {DD005} — the `gaps`/`trace` redesign whose partial-coverage matrix is exactly the surface this bug corrupted; this fix is a data-accuracy precondition for DD005's coverage output, not a change to DD005's own logic. `partial-coverage-gaps` and `traceability` suites (DD005's test surfaces) were included in this fix's regression run (see Verification above).

