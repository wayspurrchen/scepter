---
created: 2026-05-31T20:32:00.048Z
status: draft
tags: [claims, confidence, parse, configuration, traceability]
confidence: 🤖2 2026-05-31
---

# R017 - Implied-human read-time confidence defaulting

**Extends:** {R004.§7} — Confidence Markers. **Builds on:** {R013} — the pluggable adapter subsystem ({S003}, {S004}, {DD016}, {DD017}, {TS001}) whose parse contract this requirement relaxes on the read path. Origin task: {T006}.

## Overview

A human who wants to record a confidence level on a note or source file should be able to hand-type a bare level digit — `confidence: 4` in note frontmatter, `// @confidence 4` in source — and have the system read it as a human (`👤`) annotation, without pasting a `👤` emoji by hand. The automated actor (auto-insert, `mark ai`, `apply ai`) already writes `🤖` programmatically and pays the emoji cost; the human editing a file by hand should not have to. **Core principle:** the robot emoji `🤖` is the only marker that reads as AI; a bare digit and an explicit `👤` both read as human. This is a read-time defaulting policy layered on top of the {R013} payload format — it widens what `parse()` accepts, gated by one config switch, and changes nothing about what the system writes.

## Problem Statement

The {R013} confidence payload requires an explicit leading emoji ({R013.§1.AC.04}: "Emoji is `🤖` or `👤`; level is a digit 1-5"). Both adapter parse regexes make the emoji a **required** capture group, so a bare digit never parses — `parse()` returns `null` and the file is counted unannotated:

- C-family — `core/src/claims/confidence/adapters/c-family.ts:35`
  `/(?:\/\/|\*)\s*@confidence\s+(🤖|👤)(\d)(?:\s+(.+))?/`
- Frontmatter — `core/src/claims/confidence/adapters/markdown-frontmatter.ts:35`
  `/^(🤖|👤)(\d)(?:\s+(\S+))?$/`

| Scenario | Current Behavior | Correct Behavior (flag on) |
|----------|------------------|----------------------------|
| `confidence: 4` typed by hand in a note | Fails the regex; file reads unannotated | Reads as human (`👤`), level 4 |
| `// @confidence 4` typed by hand in source | Fails the regex; file reads unannotated | Reads as human (`👤`), level 4 |
| `confidence: 4 2026-05-31` (bare digit + date) | Fails the regex; file reads unannotated | Reads as human (`👤`), level 4, dated |
| `🤖2`, `👤4` (explicit emoji) | Parses to AI/2, Human/4 | Unchanged |
| No `confidence:` / no `@confidence` | Unannotated | Unchanged |

A human cannot today record confidence by hand without pasting an emoji that the YAML scalar or comment carrier does not need. The payload format treats the emoji as load-bearing on the read path even though, for human-typed annotations, its absence is unambiguous: the only actor that omits the emoji is a human.

## Design Principles

**The robot emoji is the only AI marker; everything else reads as human.** `🤖` reads as AI. A bare digit and an explicit `👤` both read as human. There is exactly one new case — bare digit → human — and it converges with the existing `👤` reading.

**Read leniently; write explicitly.** This policy changes only how an on-disk bare digit is *read*. Every confidence-writing path continues to emit an explicit emoji. The asymmetry is intentional: writers stay explicit so files remain self-describing; readers get lenient so humans can annotate by hand.

**The default is a parse policy, not a validation rule.** A bare digit reads as human at every level 1-5. Parse records what is on disk; it does not consult the writer-side reviewer/level ranges. The resulting asymmetry — a human can hand-type a bare level 2 and have it read as human/2, but cannot record level 2 via the `mark` command's human path — is intended.

## Requirements

### Bare-digit parse defaulting

When the implied-human policy is active, a confidence annotation whose level digit carries no leading emoji MUST parse as a human (`👤`) annotation at that level, in both the markdown-frontmatter and C-family-comment adapters. The reading of an explicit `🤖` or `👤` is unchanged. The policy applies at every level 1-5. A trailing ISO date parses identically whether or not the leading emoji is present.

**AC.01:4:derives=R013.§1.AC.04** With the implied-human policy active, a confidence annotation consisting of a bare level digit with no leading emoji (`confidence: 4` in frontmatter, `// @confidence 4` or ` * @confidence 4` in C-family source) MUST parse to reviewer `👤` and the given level, in both the frontmatter adapter and the C-family adapter.
**AC.02:** With the implied-human policy active, an annotation with an explicit leading `🤖` MUST parse to reviewer `🤖`, and an annotation with an explicit leading `👤` MUST parse to reviewer `👤`, unchanged from the {R013} behavior — the policy widens what parses, it does not alter explicit-emoji parsing.
**AC.03:** Bare-digit defaulting MUST apply at every confidence level 1-5: a bare `1`, `2`, `3`, `4`, or `5` MUST each parse to reviewer `👤` at the corresponding level.
**AC.04:derives=R013.§1.AC.04** A bare digit followed by a single space and an ISO `YYYY-MM-DD` date (`confidence: 4 2026-05-31`, `// @confidence 4 2026-05-31`) MUST parse to reviewer `👤`, the given level, and the given date — the date capture MUST behave identically whether or not the leading emoji is present.

### Backward-compatible opt-out

The implied-human policy MUST be a pure, backward-compatible opt-out. When the policy is inactive, a bare digit MUST NOT parse — the file MUST read exactly as it does today (unannotated). No other parse behavior changes between the two policy states; the explicit-emoji forms parse identically regardless of the policy.

**AC.05:4** When the implied-human policy is inactive, a confidence annotation consisting of a bare level digit with no leading emoji MUST NOT parse: `parse()` MUST return the same no-match outcome it returns today, and the file MUST be read as unannotated, in both adapters.
**AC.06:** Toggling the implied-human policy MUST NOT change the parse outcome of any annotation that carries an explicit `🤖` or `👤` emoji; only the bare-digit case differs between the two states.

### Parse independence from write-side ranges

A bare digit MUST read as human at any level 1-5, independent of the reviewer/level ranges that constrain the write path. Parse records the on-disk value; it MUST NOT reject or reclassify a bare digit on the basis of the write-side human range (3-5).

**AC.07:4:derives=R013.§1.AC.04** A bare digit at a level outside the writer-side human range — `confidence: 1` and `confidence: 2` — MUST parse to reviewer `👤` at that level when the implied-human policy is active. Parse MUST NOT consult the reviewer/level range table, and MUST NOT downgrade, reject, or reclassify the annotation on the basis of that table.

### Configuration

A boolean configuration flag MUST govern the implied-human policy. It MUST live in the project's confidence configuration block alongside the existing auto-insert and date flags, and MUST default to active so that a bare digit reads as human unless the project explicitly opts out.

**AC.08:4** A `claims.confidence.impliedHuman` boolean configuration flag MUST control the implied-human policy: `true` activates bare-digit-reads-as-human, `false` deactivates it. The flag MUST sit within the same `claims.confidence` configuration block as `autoInsert` and `includeDate`.
**AC.09:** The `claims.confidence.impliedHuman` flag MUST default to active (`true`) when unset, so that a project receives bare-digit-reads-as-human behavior without configuring the flag.

### Read-path consumer behavior under the policy

The read-path consumers of the confidence parse — the audit, the bulk-apply skip check, and the auto-insert precedence check — MUST observe a bare-digit annotation as a human annotation when the policy is active. A bare digit MUST count as annotated wherever annotation state is consumed, and MUST report the human reviewer wherever the reviewer is surfaced.

**AC.10:4:derives=R004.§7.AC.01** With the policy active, `scepter confidence audit` MUST count a file carrying a bare-digit confidence annotation as annotated (not unannotated), and MUST attribute it to the human (`👤`) reviewer in the per-reviewer and per-level breakdown. The downstream human/AI bucketing that consumes the audit result (including the VS Code confidence tree) MUST place such a file in the human bucket.
**AC.11:** With the policy active, `scepter confidence apply` with `--skip-annotated` (on by default per {R013.§3.AC.03}) MUST treat a file carrying a bare-digit confidence annotation as already annotated and MUST skip it, rather than overwriting the hand-typed value.
**AC.12:derives=R004.§7.AC.03** With the policy active, auto-insert on note creation (per {R013.§4}) MUST NOT overwrite a confidence annotation that a new note already carries as a bare digit; a pre-existing bare-digit value MUST be respected as an existing annotation and left unchanged.

### Write side unaffected

The implied-human policy MUST change only how an on-disk bare digit is read. Every confidence-writing path MUST continue to emit an explicit emoji, regardless of the policy's state.

**AC.13:4** `scepter confidence mark`, `scepter confidence apply`, and auto-insert on note creation MUST continue to write a confidence annotation with an explicit leading emoji (`🤖` or `👤`); the implied-human policy MUST NOT cause any writing path to emit a bare digit.
**AC.14:** The reviewer written by `mark`, `apply`, and auto-insert MUST continue to originate from the explicit `ai`/`human` argument (or the auto-insert default), unaffected by the implied-human policy. The policy MUST NOT alter what is written under any flag state.

## Edge Cases

### Bare digit at a write-forbidden level

**Detection:** A file carries `confidence: 2` (bare), a level the human write path forbids (the human range is 3-5).
**Behavior:** With the policy active, parse reads it as human/2. This is intended (per AC.07): parse records the on-disk value and does not consult the write-side range table. The asymmetry — readable as human/2, not writable as human/2 via `mark` — is accepted.

### Bare digit with trailing date

**Detection:** A file carries `confidence: 4 2026-05-31` (bare digit, ISO date).
**Behavior:** With the policy active, parse reads it as human/4 dated 2026-05-31 (per AC.04). The date capture is unaffected by the absence of the leading emoji.

### Policy off, bare digit present

**Detection:** A file carries a bare digit and the project has set `impliedHuman: false`.
**Behavior:** The bare digit fails the parse and the file reads unannotated — exactly today's behavior (per AC.05). The flag is a pure opt-out.

### Existing project upgraded with the policy on by default

**Detection:** A project upgrades to a build that ships `impliedHuman` defaulting to active; existing files may contain stray bare digits.
**Behavior:** Such bare digits begin reading as human-annotated. This is accepted (low risk — a bare digit is not a confidence format any writer emits today). A project that wants the prior behavior sets `impliedHuman: false`.

## Non-Goals

- **Changing what the system writes** — This requirement governs read-time defaulting only. Writers stay explicit; no path emits a bare digit. (See AC.13, AC.14.)
- **Coupling parse to the reviewer/level ranges** — The write-side range table (human 3-5, AI 1-3) stays a write-only guard. Parse does not consult it; a bare digit reads as human at any level 1-5. Binding parse to the range table is explicitly rejected.
- **An enum / multi-valued reviewer-default policy** — The configuration surface is a single boolean (`impliedHuman`). A tri-state "default reviewer = human | ai | none" form is not adopted; the only defaulting this requirement introduces is bare-digit → human.
- **Per-note-type or per-scope policy** — `claims.confidence.impliedHuman` is a single project-wide boolean. There is no per-type, per-tag, or per-scope override.
- **A new payload syntax** — A bare digit is not a new payload format the system writes or canonicalizes; it is an input shape the read path tolerates. The canonical written payload remains `<emoji><level>[ <date>]` per {R013.§1.AC.04}.

## Acceptance Criteria Summary

| Cluster | Count |
|---------|-------|
| Bare-digit parse defaulting | 4 |
| Backward-compatible opt-out | 2 |
| Parse independence from write-side ranges | 1 |
| Configuration | 2 |
| Read-path consumer behavior under the policy | 3 |
| Write side unaffected | 2 |
| **Total** | **14** |

## References

- {R004.§7} — Confidence Markers: the origin section establishing file-level confidence annotations, review icons (`🤖`/`👤`), and levels 1-5. This requirement extends that surface with a read-time defaulting policy.
- {R013} — Pluggable confidence adapters: the subsystem this requirement builds on. {R013.§1.AC.04} fixes the payload format (`<emoji><level>`, emoji required) that this requirement relaxes on the read path; {R013.§3.AC.03} establishes the `--skip-annotated` default that AC.11 depends on; {R013.§4} establishes the auto-insert path that AC.12 depends on.
- {S003} — Confidence adapter registry spec: the parse-contract surface (emoji-optional grammar, defaulting-policy parameter, both adapters) where this requirement is realized.
- {S004} — Confidence command surface spec: the audit / apply behavior surface affected by the policy.
- {DD016} — Adapter registry implementation: the adapter regexes, the policy parameter, and the new config field.
- {DD017} — Command surface implementation: the read-path consumers that thread the policy.
- {TS001} — Confidence subsystem test plan: the verification surface for the bare-digit parse cases.
- {T006} — Origin task: the scoping note carrying the full design, the resolved decisions, and the code touch-points.

### Realizing primitives (verified 2026-05-31)

- `core/src/claims/confidence/adapters/c-family.ts:35` — C-family parse regex; emoji currently a required capture group.
- `core/src/claims/confidence/adapters/markdown-frontmatter.ts:35` — frontmatter parse regex; emoji currently a required capture group.
- `core/src/types/config.ts:239` — `claims.confidence` config block (`autoInsert`, `includeDate` siblings) where `impliedHuman` lands.
- `core/src/claims/confidence/validation.ts:13` — `REVIEWER_LEVEL_RANGES`, the write-only guard parse MUST NOT consult (AC.07).
- `vscode/src/views/confidence-tree-provider.ts:118` — human/AI bucketing that consumes the audit reviewer (`reviewer === '👤'`), feeding AC.10.
