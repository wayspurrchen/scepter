---
created: 2026-05-31T20:24:42.747Z
tags:
  - confidence
  - parse
  - config
confidence: 🤖2 2026-05-31
---

# T006 - Implied-human confidence: treat unmarked level as human via config switch

**Status:** ready_for_review — implemented 2026-05-31. {R017} authored; {S003}.§6/§1, {S004}.§7, {DD016}.§10, {DD017}.§8, {TS001}.§12 amended; code landed with `@implements` coverage; 242/242 confidence tests green; touched files typecheck-clean. Awaiting user review.
**Extends:** {R013}, {R004.§7} — Confidence Markers. Adds a parse-time reviewer-defaulting policy to the confidence subsystem built by R013 / DD016 / DD017 / S003 / S004 / TS001.

## Goal

Let a human express a confidence level by hand-typing a **bare level digit** — no emoji — and have the system read it as a **human** annotation. The robot emoji (`🤖`) stays the explicit marker for AI-generated; everything else (a bare digit, or an explicit `👤`) reads as human. Gated by a new config switch, **default on**.

User's stated rationale: pasting `👤` by hand is annoying. The automated actor (auto-insert, `mark ai`, `apply ai`) already writes `🤖` programmatically and pays the emoji cost; the human editing a note's frontmatter by hand should not have to.

**The parse rule (flag ON):**

| Annotation value | Reads as | Status |
|---|---|---|
| `🤖2` / `🤖2 2026-05-31` | AI, level 2 | unchanged |
| `👤4` / `👤4 2026-05-31` | Human, level 4 | unchanged |
| `4` / `4 2026-05-31` (bare digit) | **Human, level 4** | **NEW** |
| (no `confidence:` / no `@confidence`) | unannotated | unchanged |

**Flag OFF** ⇒ exactly today's behavior: a bare digit fails the regex and the file reads as *unannotated*. The flag is a pure, backward-compatible opt-out.

## Current behavior (why this is a real code change, not config-only)

Both adapter parse regexes make the emoji a **required** capture group, so a bare digit never parses — `parse()` returns `null` and the file is counted unannotated:

- C-family: `core/src/claims/confidence/adapters/c-family.ts:35`
  `/(?:\/\/|\*)\s*@confidence\s+(🤖|👤)(\d)(?:\s+(.+))?/`
- Frontmatter: `core/src/claims/confidence/adapters/markdown-frontmatter.ts:35`
  `/^(🤖|👤)(\d)(?:\s+(\S+))?$/`

A bare digit cannot be normalized "above" the adapter, because parse already swallowed it (returns `null`). The widening MUST happen inside each adapter's regex — only the adapter knows how to extract a bare level from its own file shape (`//`/`*` carrier vs. YAML scalar). A registry-level wrapper would have to re-encode that shape knowledge, violating R013's "adapters own file shape; tooling owns payload" principle. **Decision: the default lives in `parse()`, gated by a policy threaded in.**

## Design

### 1. Adapter contract change

Make the emoji group optional in both regexes (`(🤖|👤)?`), and when the captured emoji is absent, set `reviewer` per a policy passed into `parse`. Add an optional options argument to the interface (`core/src/claims/confidence/adapter.ts`):

```ts
interface ConfidenceParseOptions { defaultReviewer?: ReviewerIcon | null; }
parse(content: string, filePath: string, options?: ConfidenceParseOptions): ConfidenceAnnotation | null;
```

- `defaultReviewer: '👤'` (flag ON) → bare digit ⇒ human.
- `defaultReviewer: null` / omitted (flag OFF, and the safe default for callers that don't thread config) → bare digit ⇒ no match ⇒ `null` (today's behavior).

Optional third param keeps every existing call site compiling unchanged; only call sites that should honor the flag pass it.

### 2. Config flag

New field under the existing `claims.confidence` block (`core/src/types/config.ts:239`), alongside `autoInsert` and `includeDate`. Default `true`. Resolved as `config.claims?.confidence?.<flag> ?? true`. Map `true → defaultReviewer:'👤'`, `false → defaultReviewer:null` at each call site.

Name candidates (see Open Questions): `impliedHuman` | `unmarkedIsHuman` | `assumeHumanWhenUnmarked`, or a more general `defaultReviewer: 'human'|'ai'|'none'`.

### 3. Thread the flag to the parse call sites

Four read-side consumers of `adapter.parse` — all already have config in hand:

| Call site | File:line | Effect of the change |
|---|---|---|
| Audit walk | `core/src/claims/confidence/audit.ts:158` | bare-digit files now count as annotated; `byLevel` picks them up. Config available at `auditConfidence` → thread through `walkScope`. **Also feeds the VS Code tree** (`vscode/src/views/confidence-tree-provider.ts` consumes `ConfidenceAuditResult`; `:118` buckets by `reviewer === '👤'`) — bare digits land in the human buckets automatically. |
| Apply `--skip-annotated` | `core/src/cli/commands/confidence/apply-command.ts:210` | a hand-typed bare digit now counts as "already annotated" and is skipped (correct — don't clobber human intent). |
| Auto-insert precedence | `core/src/notes/note-manager.ts:611` | a note pre-seeded with a bare `confidence: 4` is now respected; auto-insert won't overwrite it with `🤖2`. Today it would, since the bare value parses `null`. |
| Mark display (`current`) | apply/audit formatters render `reviewer+level`; no change needed beyond reviewer now possibly `👤` for previously-bare values. |

### 4. Write side — unaffected (confirm in spec)

`mark`, `apply`, and auto-insert all write an **explicit** emoji via `format()`. The reviewer originates from `mapReviewerArg('ai'|'human')` (`validation.ts:48`). This feature does not change what gets written — it only changes how an already-on-disk bare digit is *read*. The asymmetry is intentional: writers stay explicit, readers get lenient.

## Edge cases & interactions

- **Level/reviewer range coupling.** `REVIEWER_LEVEL_RANGES` (`validation.ts:13`) restricts human to 3-5, AI to 1-3 — but that rule is enforced only at the **write** layer (mark/apply), and adapters MUST NOT import validation (DD016.§1.DC.04). So a bare `2` parses as human-level-2 even though a human couldn't *write* level 2 via `mark`. Keep parse lenient (read what's there); do not couple parse to the range table. See Open Question 2.
- **Both readings converge.** "no `🤖`" and "no emoji at all" produce the same outcome (`👤` and bare both → human; only `🤖` → AI). The single new case is bare-digit → human.
- **Single-digit level only.** `(\d)` matches one digit; `12` still parses as `1` with trailing `2` ignored (pre-existing, unchanged).
- **Date with bare digit.** `4 2026-05-31` must parse as human/4/dated — optional-emoji regex handles it; verify the date capture is unaffected.
- **Dogfood note:** this very note was auto-stamped `🤖2 2026-05-31` at creation, confirming the auto-insert path that interacts with call site #3.

## Notes / claim surface to update (sce-producer work, after approval)

- **Requirement:** authored as {R017} — Implied-human read-time confidence defaulting (2026-05-31). States the implied-human parse rule + the `impliedHuman` config flag across 14 ACs, with `derives=` edges to {R013.§1.AC.04} (AC.01/AC.04/AC.07), {R004.§7.AC.01} (AC.10), and {R004.§7.AC.03} (AC.12). New note rather than a `§` on {R013} — R013 is settled (authored 2026-05-05) and records what was built; the read-time defaulting is a distinct policy layered on top, cleaner to trace as its own requirement than as a mutation of a settled note.
- **{S003}** (adapter registry spec): parse contract — emoji-optional grammar, `defaultReviewer` policy param, both adapters. Amends `S003.§3.AC.02` (c-family parse) and `S003.§4.AC.02` (frontmatter anchored grammar).
- **{S004}** (command surface): audit/apply behavior under the flag.
- **{DD016}** (`§5`/`§6` adapters, `§7` validation boundary, `§8` config): regex + policy + new config field.
- **{DD017}** (audit/apply/auto-insert): config threading to the four call sites.
- **{TS001}** (test plan) + adapter unit tests: new cases for bare-digit parse (ON/OFF), dated bare digit, bare digit at every level 1-5, audit aggregation, apply skip, auto-insert precedence, VS Code bucketing.

## Resolved decisions (user, 2026-05-31)

1. **Flag name & type** → boolean **`impliedHuman`**, default `true`. (Enum `defaultReviewer` not adopted.) Internally still maps `true → defaultReviewer:'👤'`, `false → defaultReviewer:null` at the parse boundary.
2. **Bare levels 1-2** → read as **human regardless of level**. A bare digit is a *general* confidence marker, not bound to the writer-side human range (3-5). All bare digits 1-5 ⇒ human. The `REVIEWER_LEVEL_RANGES` table stays a write-only (`mark`/`apply`) guard; parse does not consult it. The resulting asymmetry — a human can hand-type `confidence: 2` (reads human/2) but cannot `mark <file> human 2` — is intended.
3. **Scope** → **both** adapters (markdown frontmatter AND C-family source comments).
4. **Default** → **on** by default. Accepted that stray bare digits in existing files begin counting as human-annotated on upgrade (low risk; bare digits are not a format anyone writes today).

## Next step

Decisions locked. Requirement note authored as {R017} (2026-05-31). Remaining: bring {R017} back for review, then derive the S003/S004 + DD016/DD017/TS001 amendments and implement. No code written yet.

