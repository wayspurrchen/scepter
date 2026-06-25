---
created: 2026-06-12T16:25:30.361Z
tags:
  - bug
  - linter
  - code-scan
confidence: 🤖2 2026-06-12
---

# T008 - Bug - lint --code false-positives on multi-ref and in-prose note mentions


**Status:** pending · **Severity:** medium (no data loss; lint output unusable at scale) · **Reported:** 2026-06-12, scepter 0.1.0 · **Reproduced in:** the `work-inbox` project (192 incidences, ~145 false positives)

## Symptom

`scepter lint --all --code` reports `[UNKNOWN-NOTE]` / `[UNDEFINED-CLAIM]` for note references in **source-code comments** that resolve perfectly well from notes and via `scepter show`. The false positives follow a precise positional pattern:

1. **First-position annotation targets resolve.** `@see {T023}` alone → no incidence. `@implements {R008.§4.AC.01}` → no incidence.
2. **Trailing refs on the same annotation line fail.** `@see {T023} {DD005}` → the `{DD005}` is reported `[UNKNOWN-NOTE] DD005`, even though `scepter show DD005` resolves. 47 such sites for DD005 alone in work-inbox (every one is a second/third-position ref; the project has zero single-ref `{DD005}` code mentions to compare, but see point 3 for the same-ID control).
3. **In-prose mentions fail — same ID that resolves as an annotation target.** `{T023}` resolves at `@see {T023}` (many sites, no incidence) but the in-prose mention in `Non-blocking sync trigger core (P7 / {T023})` is reported `[UNKNOWN-NOTE] T023` — 22 sites. This is the controlled comparison that rules out a missing-note/index problem: same project, same ID, same file type, only the syntactic position differs.
4. **Third-position refs can land in a different bucket.** `@see {T024} {DD005} {A007}` (conformance.ts) puts `{A007}` under `[UNDEFINED-CLAIM] A007` rather than UNKNOWN-NOTE — A007 is a note with claims; the mention seems to enter a claim-resolution path with no claim suffix and fails there instead.

## Compounding display bug

The printed excerpt is truncated **at the failing ref**, showing only the text before it. Example: the line `* @see {T018} {DD005}` (github.ts:115) is displayed as:

```
  DD005 (47 sites)
    src/connectors/github.ts:115 (@mentions)  | @see {T018}
```

i.e. the row visually blames `{T018}` (which resolved fine) while the actual failing token `{DD005}` — the group key — is the one sliced out of the display. Until you cross-check the source line, the output reads as "T018 is unknown, filed under DD005," which is doubly wrong. Rows for multi-line annotations degrade further to bare `| @see` with no target at all (e.g. `engine/project-importer.ts:141`).

## Reproduction

In any project with two valid notes T001/T002 and source-integration enabled:

```ts
/**
 * Prose mention of {T001} inside a sentence.
 * @see {T001} {T002}
 */
export const x = 1;
```

`scepter lint --code` on this file reports the prose `{T001}` and the trailing `{T002}` as UNKNOWN-NOTE; the `@see`-first `{T001}` is fine. (Observed on scepter 0.1.0; reference project: `~/Projects/work-inbox`, run `scepter lint --all --code` there for the live 192-incidence corpus.)

## Hypothesis

The code-scan reference extractor classifies non-first-position and in-prose `{ID}` tokens as `@mentions` and routes them through a different resolver than annotation targets — and that resolver fails to consult the note index (or consults a claims-only index, given symptom 4). The note-side linter (`scepter lint <ID>`) resolves the identical syntax correctly, so the gap is specific to the code-scan path.

## Impact

- work-inbox: 192 incidences, of which ~145 are these false positives (128 UNKNOWN-NOTE + the @mentions rows under UNDEFINED-CLAIM). The 14 real findings (known/authorized cross-project `derives=`) drown in them — `lint --code` is currently unusable as a signal there.
- The truncated display actively misattributes failures, which cost a debugging round-trip before the pattern emerged.

## Suggested fix order

1. Route `@mentions`-classified tokens through the same note-index resolution as annotation targets (fixes ~all false positives).
2. Print the full matched token (and ideally the whole comment line) in the incidence row; never slice the excerpt at the match boundary.
3. Handle multi-line annotation bodies (the bare `@see` rows) — either parse the continuation line or report the site as unparseable rather than as a resolution failure.
