---
created: 2026-05-21T02:14:00.448Z
tags:
  - resolver
  - lint
  - trace
  - claims
  - error-codes
confidence: 🤖2 2026-05-21
status: draft
---

# DD021 - Unified Reference Resolver and Failure-Mode Taxonomy

**Spec:** {R004}, {R006}, {R015}
**Spec consolidation:** {S002} — the cross-tab Specification that governs the reference grammar and consumer behavior this design unifies. The behavioral contract is in {S002.§3}; this document specifies the module decomposition that makes the contract hold.
**Created:** 2026-05-20
**Audit source:** `/Users/way/Projects/scepter/core/_scratch/202605202055 peer project claim audit class catalog.md` — eleven error classes catalogued from a peer SCEpter project, four of which (Classes 1, 2, 6, 7) share the same root cause and motivate this DD.

## §1 Problem Statement

The audit observed that SCEpter's `scepter claims lint` and `scepter claims trace` consumers reach into the claim index via different resolution code paths and produce conflicting signals to the author. The most damaging incidence pattern is on the consumer's S034 note: lint emits 91 `unresolved-reference` errors and 78 `unresolvable-derivation-target` errors against citations that the trace command silently resolves and renders as live. The author cannot tell whether the section-less reference form is supported or not — one tool accepts it, another rejects it.

The audit also observed that the single `unresolved-reference` error code conflates four mechanically distinct failures: the cited note never existed; the cited note exists but the claim ID was never defined in it; the cited note was archived; the cited token does not parse at the grammar level. Each failure has a different remediation. The conflated message blocks authors from picking the right one — and the audit measured 466 incidences of `unresolved-reference` across the corpus, with 164 of them tracing back to a single archived note (R057 in the peer's namespace) whose claims were still cited by active downstream design documents.

These two findings — the consumer-divergence problem and the conflated-error-code problem — share a single root cause: the resolver is not a primitive. It is reinvented inside each consumer. `core/src/claims/claim-index.ts` has a `resolveClaimAddress()` function that the index uses to wire `derives=` and inline references; `core/src/cli/commands/shared/resolve-claim-id.ts` has a `resolveClaimInput()` function that `show` and `trace` use for user-facing input. They implement different rules, return different types, and produce different outcomes on the same input.

The new ACs in {R004.§4.AC.06-09}, {R004.§5.AC.05}, {R004.§6.AC.05}, {R006.§1.AC.05}, {R006.§4.AC.04}, {R006.§5.AC.04-05}, and {R015.§1.AC.04a-c} make explicit the resolver behavior that has been implicit; this DD specifies the module decomposition that realizes them.

### Audit Class Coverage

| Audit class | What it observed | Realized by |
|---|---|---|
| Class 1 — bare-note-id `derives=` | Lint correctly emits `unresolvable-derivation-target`; trace silently omits the derivation line. 11+ incidences on a single peer DD. | {R006.§1.AC.05}, {R006.§4.AC.04}, this DD §3 (`derivation-target-bare-note-id` distinct code) |
| Class 2 — section-less claim refs | Trace fuzzy-resolves `R030.PRI.01` to `R030.7.PRI.01`; lint refuses. 91 conflicting incidences on a single note. | {R004.§4.AC.08}, {R004.§4.AC.09}, this DD §3 (unified resolver, section-less rule) |
| Class 6 — note exists but no parseable claims | Lint emits `unresolved-reference` for `{R017.PRG.01}` when R017 is narrative-only. Conflated with Class 7. | {R004.§4.AC.07}, this DD §3 (`reference-to-undefined-claim` distinct code) |
| Class 7 — note does not exist | Lint emits `unresolved-reference` for `{DEF015.§1.FC.01}` when DEF015 was never created. Conflated with Class 6. | {R004.§4.AC.07}, this DD §3 (`reference-to-unknown-note` distinct code) |
| Class 1 cross-cutting — trace silent on malformed | Trace renders no `Derived from:` line at all when `derives=` is malformed. | {R004.§5.AC.05}, {R006.§4.AC.04}, this DD §3 (consumer-side rendering contract) |

Class 5 (archived-note references) is in scope here for the error-code taxonomy ({R004.§4.AC.07} introduces `reference-to-archived`) and for the index-loading and entry-shape changes that make the archive-aware resolver functional ({R015.§1.AC.04a-b}, realized by §10.DC.16 + §10.DC.17 + §10.DC.05–.06). The remaining archive-lifecycle surface — {R015.§1.AC.04c}, the archive command warning on inbound references — remains a separate work surface in `archive-command.ts`, OOS for this DD.

Classes 3, 4, 8, 9, 10, 11 are out of scope for this DD. Class 3 (`forbidden-form` context restriction) is a parser/linter scope question, not a resolver question; it lives in a separate work surface. Class 4 (per-section monotonicity) is similar. Class 8 (`DC.14b` letter-suffix references) is, on inspection, a special case of Class 6 (the source DD never defined the suffixed claim) and is handled by the new error-code taxonomy. Classes 9 and 10 (lifecycle-driven references) are already covered by {R005.§2.AC.05} and {R006.§5.AC.01}; the new `claims dependents` command at {R006.§5.AC.05} is an ergonomic adjacent to but distinct from the resolver itself.

## §2 Epistemic Review of Bound Claims

### Binding analysis

**HIGH BINDING** (the resolver-shape decisions; everything else depends on these):

- **{R004.§4.AC.07}** — Error-code taxonomy. Five new codes (`reference-to-unknown-note`, `reference-to-undefined-claim`, `reference-to-archived`, `malformed-claim-reference`, `derivation-target-bare-note-id`). The taxonomy is the resolver's public interface; once fixed, every consumer renders against it.
- **{R004.§4.AC.08}** — Shared resolver invariant. Lint and trace MUST agree. This forces a single implementation; without it, the consumer-divergence pattern returns.
- **{R004.§4.AC.09}** — Section-less reference resolution rule. Default: resolve when unique, ambiguous-error otherwise. This decision determines the resolver's lookup algorithm.
- **{R006.§1.AC.05}** — Bare-note-id `derives=` rejection. The stance recorded for the audit's bare-note-id pattern: the user's framing was "a subclaim can point to the top of a claim, but it is not encouraged"; this DD records the rejection stance with reconsideration permitted via future requirement. Bare-note-id `derives=` produces `derivation-target-bare-note-id`, NOT a fallback to note-level derivation.

**MEDIUM BINDING** (constrained by the above; freedom in surface):

- **{R004.§5.AC.05}** — Trace rendering contract for unresolved references. The user-facing format is specification-layer; what binds here is that trace MUST NOT silently omit the slot.
- **{R006.§4.AC.04}** — Trace rendering contract for unresolved `derives=`. Same shape as §5.AC.05 but specific to the derivation slot.
- **{R015.§1.AC.04a-c}** — Archive lifecycle: archived notes stay in-index for resolution; archive command warns on inbound refs. The resolver consumes this; archive command behavior is its own work surface.

**LOW BINDING** (additive layers):

- **{R006.§5.AC.05}** — `claims dependents` command. Independent CLI surface; consumes the resolver but does not change its shape.
- **{R004.§6.AC.05}** — `forbidden-form` context restriction. Separate from this DD; called out here only because audit Class 3 sits adjacent.

### Modal status distribution

The cluster of new ACs is dominated by **Behavior** and **Integration** modal characters: behavior at the resolver (what it returns for each input shape) and integration at the consumers (lint reads the outcome and emits errors; trace reads the outcome and renders rows). There is one **Constraint** claim — `derives=` MUST NOT be a bare note ID — and one **Invariant** — lint and trace MUST agree. No Existence claims at the resolver layer; the resolver is internal infrastructure, not a user-facing surface.

## §3 Module Inventory

The work is concentrated in `core/src/claims/`. The two existing resolver implementations are unified into a single module that both consumers call.

### File: `core/src/claims/reference-resolver.ts` (NEW)

The shared resolver. Exposes one entry point and a discriminated-union return type. Replaces the per-consumer resolution logic in `claim-index.ts:resolveClaimAddress` and `cli/commands/shared/resolve-claim-id.ts:resolveClaimInput`.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R004.§4.AC.07} | `type ResolverFailureCode` | Discriminated union of the new error codes |
| {R004.§4.AC.07} | `type ResolverOutcome` | `RESOLVED` \| `AMBIGUOUS` \| `UNRESOLVED` |
| {R004.§4.AC.08} | `function resolveReference(raw, opts): ResolverOutcome` | The single entry point used by both lint and trace |
| {R004.§4.AC.09} | `function resolveSectionLessReference(raw, opts)` | Internal helper for the section-less unique-match rule |
| {R015.§1.AC.04a} | `interface ResolverOptions { includeArchived?: boolean }` | Archive-aware resolution toggle |
| {R015.§1.AC.04b} | `case 'archived'` in `ResolverFailureCode` | Distinct from `unknown-note` and `undefined-claim` |

Type sketch (illustrative; final API is specification-layer):

```typescript
export type ResolverFailureCode =
  | 'reference-to-unknown-note'
  | 'reference-to-undefined-claim'
  | 'reference-to-archived'
  | 'malformed-claim-reference'
  | 'derivation-target-bare-note-id'
  | 'derivation-target-cross-project'
  | 'derivation-target-removed'
  | 'derivation-target-superseded'
  | 'derivation-target-ambiguous';

export type ResolverOutcome =
  | { kind: 'resolved'; canonicalId: string; entry: ClaimIndexEntry }
  | { kind: 'ambiguous'; candidates: string[]; reason: 'section-less' | 'bare-suffix' }
  | { kind: 'unresolved'; code: ResolverFailureCode; detail?: string };

export interface ResolverOptions {
  /** Current note ID for scope-resolution of bare references. */
  currentNoteId?: string;
  /** Whether the call site is a `derives=` (vs an inline reference). Some failure codes are derives-only. */
  derivesPosition?: boolean;
  /** Whether archived notes are considered resolvable. Default: true for resolution, false for projection coverage. */
  includeArchived?: boolean;
}

export function resolveReference(raw: string, index: ClaimIndexData, opts: ResolverOptions): ResolverOutcome;
```

### File: `core/src/claims/claim-index.ts` (MODIFIED)

The index consumes the resolver. The internal `resolveClaimAddress()` function is replaced by a call to `resolveReference()` from the new module. Outcomes that fall in the `unresolved` arm are turned into `ClaimTreeError` entries with the new error codes.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R004.§4.AC.07} | `ClaimTreeError.type` union extended | Add new error codes from the resolver |
| {R004.§4.AC.08} | `ClaimIndex.build()` uses `resolveReference()` | Replaces internal `resolveClaimAddress()` |
| {R006.§1.AC.05} | Bare-note-id `derives=` produces `derivation-target-bare-note-id` | Distinct from `unresolvable-derivation-target`. The latter is renamed or absorbed into the new taxonomy. |
| {R006.§5.AC.04} | Resolver-emitted error codes flow through the index unchanged | Lint reads them directly |
| {R015.§1.AC.04a} | `ClaimIndexEntry.archived: boolean` | New additive field, populated from `note.tags.includes('archived')` at entry construction. Per §10.DC.17. |

### File: `core/src/cli/commands/claims/ensure-index.ts` (MODIFIED)

The index-loading entry point currently calls `noteManager.getNotes({})`, which filters archived notes out (per `note-manager.ts:1315-1317`). For the resolver's archive-aware DCs to work, the loader MUST include archived notes so their claims are present in the index.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R015.§1.AC.04a} | `ensureIndex()` passes `{ includeArchived: true }` to `noteManager.getNotes()` | Per §10.DC.16. The change is one option-flag; the `NoteWithContent[]` produced downstream carries archived notes alongside active ones. Frontmatter / tag passthrough to `ClaimIndex.build()` requires no new shape — `NoteWithContent` does not yet carry a tag list, so the build step reads `archived` from a parallel channel (either by extending `NoteWithContent` with `archived: boolean` or by querying `noteManager` at entry-construction time; specification-layer). |

Migration note: the existing `unresolvable-derivation-target` error code is RETAINED for back-compat at the public lint output surface but is internally produced as a transformation from `resolveReference()` outcomes. Specifically: `derivation-target-bare-note-id` is a NEW code; `derivation-target-removed`, `derivation-target-superseded`, `derivation-target-ambiguous` are NEW codes that subdivide the prior single-code behavior; consumers that grep on `unresolvable-derivation-target` continue to match the legacy umbrella code path during a transition window (length TBD by the implementor).

### File: `core/src/cli/commands/shared/resolve-claim-id.ts` (MODIFIED)

The existing `resolveClaimInput()` function is replaced by a thin wrapper over `resolveReference()`. The user-input normalization steps (`$` → `§`, zero-padding, etc.) are PRESERVED — they are pre-resolver normalization that handles shell-escape and shorthand conventions. After normalization, resolution is delegated to the shared resolver.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R004.§4.AC.08} | `resolveClaimInput()` calls `resolveReference()` | Replaces ad-hoc lookup logic |
| {DD008.§1.DC.01} | Normalization preserved | Existing `$` → `§`, zero-pad, strip-§ behavior is unchanged |
| {R004.§4.AC.09} | Section-less rule applied by `resolveReference()` | The cross-note suffix-match logic moves OUT of this file and INTO the shared resolver |

### File: `core/src/claims/traceability.ts` (MODIFIED)

The trace matrix builder consumes the resolver. Unresolved citations produce rows with the new error codes; the rendering layer (CLI or VS Code) decides how to surface them.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R004.§5.AC.05} | Trace MUST surface unresolved citations explicitly | New row state for unresolved; rendering specification-layer |
| {R006.§4.AC.04} | `derives=` slot MUST show unresolved explicitly | Format: `Derived from: <UNRESOLVED — see lint>` or equivalent |

### File: `core/src/cli/commands/claims/trace-command.ts` (MODIFIED)

The trace CLI consumer renders the new resolver outcomes per {R004.§5.AC.05}.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R004.§5.AC.05} | Render unresolved rows explicitly | Distinct visual treatment per failure code |
| {R006.§4.AC.04} | Render unresolved `derives=` slots | The bare-note-id case shows `(bare note ID — claim address required)` or equivalent |

### File: `core/src/cli/commands/claims/lint-command.ts` (MODIFIED)

The lint CLI consumer renders the new resolver outcomes per the existing lint output shape, extended with the new error-code messages.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R004.§4.AC.07} | Error messages per code | `reference-to-unknown-note: "{X}" — no note with this ID exists`, `reference-to-undefined-claim: "{X}" — note {Y} exists but does not define claim {Z}`, etc. |
| {R004.§4.AC.08} | Lint output for an input MUST match trace output for the same input | A reference that trace renders as live MUST NOT appear in lint as an error; conversely |

### File: `core/src/cli/commands/claims/dependents-command.ts` (NEW)

The `scepter claims dependents <claim>` ergonomic command. Lists every claim declaring `derives=TARGET` against the queried claim, every inline reference, and every `superseded=TARGET` that targets it. Out of strict resolver scope but bundled here per audit Classes 9/10.

| Requirement | Type/Function | Notes |
|---|---|---|
| {R006.§5.AC.05} | `dependentsCommand` registered as a `scepter claims` subcommand | Surface design (flags, output format) is specification-layer |

### File: `core/src/claims/__tests__/reference-resolver.test.ts` (NEW)

Unit tests for the new resolver module. The audit's eleven classes are the regression test inventory — each class becomes one or more test cases that pin the resolver behavior. Test scaffolding lives here even though the broader test plan is out of scope for this DD.

## §4 Wiring Map

### Call chains

**Lint path (was; SUPERSEDED):**
```
lint-command.ts
  → ClaimIndex.build()
  → resolveClaimAddress() [internal to claim-index.ts]
  → ClaimTreeError with `unresolved-reference` or `unresolvable-derivation-target`
```

**Trace path (was; SUPERSEDED):**
```
trace-command.ts
  → resolveSingleClaim() [shared/resolve-claim-id.ts]
  → resolveClaimInput() [shared/resolve-claim-id.ts]
  → ClaimIndexEntry or null (silent on failure)
  → traceability.ts builds matrix from successful lookups only
```

**Unified path (NEW):**
```
                              ┌→ ClaimTreeError (with discrete failure code)
lint-command.ts ─→ ClaimIndex.build() ┤
                              └→ Cross-ref edge with resolver outcome attached

trace-command.ts ─→ traceability.ts ─→ resolveReference() ─→ ResolverOutcome
                                                              ├→ resolved: live row
                                                              ├→ ambiguous: ambiguous row
                                                              └→ unresolved: unresolved row with code

shared/resolve-claim-id.ts ─→ normalize() ─→ resolveReference() (same as above)

claim-index.ts:build() ─→ for each derives=, for each inline ref ─→ resolveReference()
```

The single arrow into `resolveReference()` from every consumer is the invariant {R004.§4.AC.08} enforces in code.

### Data flow

```
Markdown character stream
        │
        ▼
claim-parser.ts (extracts references, produces ClaimAddress[])
        │
        ▼
ClaimAddress (raw, noteId?, sectionPath?, claimPrefix?, claimNumber?, ...)
        │
        ▼
reference-resolver.ts: resolveReference(raw_or_address, index, opts)
        │
        ├─→ {kind: 'resolved', canonicalId, entry}     ─→ live edge
        ├─→ {kind: 'ambiguous', candidates, reason}    ─→ ambiguous-error edge
        └─→ {kind: 'unresolved', code, detail?}         ─→ failure edge (with code)
        │
        ▼
ClaimIndex (cross-references graph; each edge carries its resolver outcome)
        │
        ├─→ Linter: walks errors, formats per error code
        ├─→ Trace: walks edges, renders per outcome kind
        └─→ Gaps: walks coverage, skips archived per ResolverOptions
```

## §5 Data and Interaction Flow

### Flow 1: Author writes `{R030.PRI.01}` in a note (section-less, exactly one matching claim)

1. `claim-parser.ts` extracts the citation as `ClaimAddress { noteId: 'R030', claimPrefix: 'PRI', claimNumber: 1 }` (no `sectionPath`).
2. `ClaimIndex.build()` registers R030's claims first (R030.§7.PRI.01 is the canonical FQID).
3. For each `ClaimReference` on the citing note, the index calls `resolveReference(rawRef, indexData, { currentNoteId: citingNoteId, derivesPosition: false })`.
4. `resolveReference` finds no exact match for `R030.PRI.01`. It detects section-less form (noteId present, sectionPath absent, claimPrefix present). It enumerates index entries matching `R030.§*.PRI.01`. One match found — `R030.§7.PRI.01`. Returns `{ kind: 'resolved', canonicalId: 'R030.7.PRI.01', entry }`.
5. The index records a live cross-reference. Trace renders it as live. Lint emits no error. {R004.§4.AC.08} holds.

### Flow 2: Author writes `{R030.PRI.01}` in a note (section-less, multiple matches)

Same path through step 3. At step 4, `resolveReference` finds two entries matching the suffix (`R030.§7.PRI.01` AND `R030.§9.PRI.01`). Returns `{ kind: 'ambiguous', candidates: ['R030.7.PRI.01', 'R030.9.PRI.01'], reason: 'section-less' }`.

5. The index records an ambiguous-error edge. Lint emits `unresolved-reference` with `ambiguous` qualifier and lists the candidates. Trace renders an unresolved row with the same candidates as detail. The author sees "section-less form ambiguous; use {R030.§7.PRI.01} or {R030.§9.PRI.01}."

### Flow 3: Author writes `derives=ARCH028` in a DD (bare note ID; audit Class 1)

1. `claim-parser.ts` parses the metadata suffix and emits `derives=ARCH028` as a key-value metadata item.
2. `ClaimIndex.build()` reaches the `derives=` resolution phase. Calls `resolveReference('ARCH028', index, { currentNoteId: ddNoteId, derivesPosition: true })`.
3. `resolveReference` recognizes the value as a bare note ID (matches `[A-Z]{1,5}\d{3,5}` but has no claim suffix). With `derivesPosition: true`, returns `{ kind: 'unresolved', code: 'derivation-target-bare-note-id', detail: 'ARCH028' }`.
4. The index records the failure. Lint emits `derivation-target-bare-note-id` with the message "`derives=` requires a claim-level address (e.g., `ARCH028.§1.AC.03`); a bare note ID is not supported." Trace renders the derivation slot as `Derived from: <UNRESOLVED — bare note ID>` (or equivalent). {R006.§4.AC.04} holds.

### Flow 4: Author writes `{R057.§1.AC.08}` in a DD; R057 is archived (audit Class 5)

1. `claim-parser.ts` extracts the citation as a fully qualified `ClaimAddress`.
2. `ClaimIndex.build()` has loaded R057 from the archive per {R015.§1.AC.04a}. R057 is in the index with an `archived: true` flag on its entries.
3. Resolution calls `resolveReference('R057.§1.AC.08', index, { includeArchived: true })`. Match found.
4. The resolver returns `{ kind: 'resolved', canonicalId: 'R057.1.AC.08', entry }` with `entry.archived === true`.
5. The consumer (lint or trace or gaps) decides what to do with the archived flag:
   - **Lint** with default options: emits `reference-to-archived` as a warning (not an error). The author sees "reference resolves to archived note R057; consider rewriting or un-archiving."
   - **Trace**: renders the row live; the archived flag MAY produce a visual treatment (dimmed, struck-through, suffixed).
   - **Gaps**: skips the archived entry for projection-coverage calculations per {R015.§1.AC.04a}.

### Flow 5: Author writes `{R017.PRG.01}` in a note; R017 exists but is narrative-only (audit Class 6)

1. Citation extracted as `ClaimAddress { noteId: 'R017', claimPrefix: 'PRG', claimNumber: 1 }` (no section).
2. `resolveReference` finds R017 in the index (the note exists). Section-less lookup enumerates entries matching `R017.§*.PRG.01`. Zero matches found.
3. The resolver distinguishes "note absent" from "note present, claim absent": it confirms R017 is in the index, then returns `{ kind: 'unresolved', code: 'reference-to-undefined-claim', detail: 'R017 exists but defines no claim PRG.01' }`.
4. Lint emits a distinct message per code. Author can fix the right thing (either define the claim in R017 or rewrite the citation to plain `{R017}`).

### Flow 6: Author writes `{DEF015.§1.FC.01}`; DEF015 was never created (audit Class 7)

1. Citation extracted as a fully qualified `ClaimAddress`.
2. `resolveReference` checks the index for DEF015. Not found.
3. Returns `{ kind: 'unresolved', code: 'reference-to-unknown-note', detail: 'DEF015' }`.
4. Lint emits `reference-to-unknown-note: "DEF015" — no note with this ID exists in the project`. Distinct from Class 6's `reference-to-undefined-claim`. Author sees the difference and acts accordingly.

## §6 Integration Sequence

The implementation order pins the public-interface decisions before the internal-replacement work, so consumers can adopt the new outcomes incrementally.

| Step | Files touched | Verification |
|---|---|---|
| 1. Define `ResolverOutcome` and `ResolverFailureCode` types in the new resolver module | `reference-resolver.ts` (NEW, types only) | Types compile; no consumers yet |
| 2. Implement `resolveReference()` with the section-less rule and the bare-note-id rejection | `reference-resolver.ts` | Unit tests against the audit's eleven classes pass; lint runs against the resolver corpus produce expected codes |
| 3. Replace `resolveClaimAddress()` in claim-index.ts with calls to `resolveReference()`; map outcomes to `ClaimTreeError` entries | `claim-index.ts` | Existing `claim-index.test.ts` passes; the new error codes are emitted where expected; the legacy `unresolved-reference` and `unresolvable-derivation-target` codes are retained at the public lint output (for back-compat during transition) |
| 4. Replace `resolveClaimInput()` in shared/resolve-claim-id.ts with a normalize-then-resolve thin wrapper | `cli/commands/shared/resolve-claim-id.ts` | `show` command continues to work; ambiguous-match handling now goes through `resolveReference` |
| 5. Update `traceability.ts` to consume resolver outcomes for cross-ref edges; render unresolved rows explicitly | `traceability.ts`, `trace-command.ts` | Trace output now surfaces unresolved rows; the audit's bare `derives=ARCH028` case produces `Derived from: <UNRESOLVED — bare note ID>` rather than silent omission |
| 6. Update lint-command.ts to emit per-code messages | `lint-command.ts` | Lint output for the audit corpus shows distinct codes; the conflated `unresolved-reference` umbrella is split |
| 7. Implement `claims dependents <claim>` | `dependents-command.ts` (NEW), wiring in `index-command.ts` or claims subcommand registration | `scepter claims dependents R005.§1.AC.01` lists derivatives, inline refs, supersession targets |
| 8. Update `claims.md` (the agent skill file) to document the new error-code taxonomy | `claude/skills/scepter/claims.md` | Documentation conforms to {R004.§4.AC.07} taxonomy; agents reading the skill see the distinct codes |
| 9. Update `scepter claims gaps` to respect `archived: true` flag on entries per {R015.§1.AC.04a} | `gaps-command.ts` | Archived-note claims do not contribute to projection-coverage; trace can still render them |

The verification gates between steps mean that an interrupted partial implementation still produces consistent output. Each step is an idempotent migration of one consumer onto the new resolver.

## §7 Open Questions

### OQ.01 Legacy error code retention window

The new taxonomy introduces five new error codes and supersedes the umbrella `unresolved-reference` and `unresolvable-derivation-target`. Consumers — including the VS Code extension's diagnostic provider per {R012} surfaces, and any external tooling that greps lint output — depend on the legacy code names. The integration sequence above proposes a transition window where both the new codes and the legacy umbrella codes are emitted. The exact window length and the eventual retirement timing of the legacy codes are open.

**Default lean:** ship both during the same release; retire the umbrella codes when the VS Code extension and the agent skill have adopted the new taxonomy. The retirement is a separate work surface, tracked here so it isn't forgotten.

### OQ.02 Resolver outcome attachment to cross-ref edges — CLOSED

**Disposition:** Full `ResolverOutcome` is stored on `ClaimCrossReference.resolverOutcome` (additive field). Legacy `unresolved: boolean` is retained for transition and computed from `resolverOutcome.kind === 'unresolved'`. The cross-ref graph is the single source of truth; no separate diagnostics table. Realized by §10.DC.08 (`ClaimIndex.build()` writes outcome on edge).

### OQ.03 Same-note bare-suffix ambiguity vs cross-note ambiguity — CLOSED

**Disposition:** The resolver returns a single `ambiguous` outcome kind with `reason: 'bare-suffix' | 'cross-note-section-less'`; consumers discriminate via `reason` when messaging. Realized by §10.DC.01 (entry point) and §10.DC.03 (section-less rule). Same-note bare-suffix ambiguity is detected at exact-match-fail time in §10.DC.01 step 2; cross-note section-less ambiguity is detected in §10.DC.03 step 4d.

### OQ.04 `claims dependents` output surface

{R006.§5.AC.05} asserts the command exists but leaves the output format specification-layer. The natural shape mirrors `scepter claims trace`: one section per kind of dependent (derivatives, inline references, supersession references). Cross-project citations are listed in a separate footer per {R011}.

**Default lean:** mirror `trace` output structure for ergonomic familiarity.

## §8 Requirements Coverage

Every AC added or referenced by the audit work is realized by at least one module in §3, or is explicitly flagged as out-of-scope.

| AC | Module(s) | Out-of-scope reason |
|---|---|---|
| {R004.§4.AC.06} | — | Per-section monotonicity (audit Class 4) — not a resolver concern; lives in `claim-tree.ts` validation. |
| {R004.§4.AC.07} | `reference-resolver.ts` (types), `claim-index.ts`, `lint-command.ts` | |
| {R004.§4.AC.08} | `reference-resolver.ts` (entry point), `claim-index.ts`, `traceability.ts`, `shared/resolve-claim-id.ts` | |
| {R004.§4.AC.09} | `reference-resolver.ts` (section-less rule) | |
| {R004.§5.AC.05} | `trace-command.ts`, `traceability.ts` | |
| {R004.§6.AC.05} | — | `forbidden-form` context restriction (audit Class 3) — parser/linter concern, not a resolver concern; separate work surface. |
| {R006.§1.AC.05} | `reference-resolver.ts` (bare-note-id rule), `claim-index.ts` | |
| {R006.§4.AC.04} | `trace-command.ts`, `traceability.ts` | |
| {R006.§5.AC.04} | `reference-resolver.ts` (the entire DD realizes this) | |
| {R006.§5.AC.05} | `dependents-command.ts` (NEW) | |
| {R015.§1.AC.04a} | `ensure-index.ts` (loader includes archived, per §10.DC.16), `claim-index.ts` (`archived` field on entry, per §10.DC.17), `reference-resolver.ts` (`includeArchived` option, per §10.DC.05) | |
| {R015.§1.AC.04b} | `reference-resolver.ts` (`reference-to-archived` code) | |
| {R015.§1.AC.04c} | — | Archive command warning surface; separate work in `archive-command.ts`. |

## §9 Non-Goals

- **Implementation timing or sequencing decisions for downstream consumers (VS Code extension, agent skill files, external tooling).** Each consumer adopts the new taxonomy on its own schedule. This DD specifies the core CLI surface only.
- **Lifecycle behavior for hard-delete or rename.** {R015} owns those mechanics. This DD only touches archive insofar as the resolver needs to know the archived flag on entries.
- **Claim-level vs note-level derivation projection.** The audit's bare-note-id case raises the question of whether note-level derivation should be a thing. This DD records the rejection stance per {R006.§1.AC.05}. The question is reopen-able via a future requirement.
- **Cross-project resolver behavior.** {R011}'s alias-prefix rules are unchanged. This DD's resolver passes alias-prefixed references through to the cross-project citation tracking path, unchanged.
- **Test plan.** Per the dispatch scope, test plans are not produced in this work cycle. The resolver test scaffolding mentioned in §3 is a placeholder; the full test plan is downstream work.

## §10 Detailed Design Claims

The DCs in this section are the implementation-binding assertions for the modules in §3. Each derives from an AC in {R004}, {R006}, or {R015}; the `derives=TARGET` metadata is the load-bearing link.

### §10.1 Resolver Module (`core/src/claims/reference-resolver.ts`)

§10.DC.01:5:derives=R004.§4.AC.08 The module MUST export a single function `resolveReference(raw, index, opts)` that takes the raw reference text (or pre-parsed `ClaimAddress`), the `ClaimIndexData`, and a `ResolverOptions` bag, and returns a discriminated-union `ResolverOutcome` whose variants are `resolved` (canonical FQID + entry), `ambiguous` (candidate list + reason), and `unresolved` (failure code + optional detail). This function is the single normative resolver invoked by every consumer — `claim-index.ts` during cross-ref edge construction, `shared/resolve-claim-id.ts` for user-typed CLI input, `traceability.ts` for matrix construction, and any future consumer. No consumer MAY implement its own resolution path.

§10.DC.02:5:derives=R004.§4.AC.07 The module MUST export a `ResolverFailureCode` discriminated union covering at minimum: `reference-to-unknown-note`, `reference-to-undefined-claim`, `reference-to-archived`, `malformed-claim-reference`, `derivation-target-bare-note-id`, `derivation-target-cross-project`, `derivation-target-removed`, `derivation-target-superseded`, `derivation-target-ambiguous`. Each code MUST be produced under exactly one structural condition; codes MUST NOT be reused across structurally distinct conditions. The discriminated-union is the resolver's public taxonomy; consumers render against it.

§10.DC.03:4:derives=R004.§4.AC.09 The resolver MUST implement section-less reference resolution per the unique-match rule: given a reference with `noteId` and `claimPrefix.claimNumber` but no `sectionPath`, enumerate index entries matching `<noteId>.§*.<claimPrefix>.<claimNumber>`. If exactly one matches, return `resolved` with that entry's canonical FQID. If multiple match, return `ambiguous` with `reason: 'cross-note-section-less'` and the candidate FQIDs. If none match, fall through to the next resolution attempt (and ultimately to `unresolved` with a code determined by the note-presence check).

§10.DC.04:5:derives=R006.§1.AC.05 The resolver MUST detect bare-note-id `derives=` values and produce `unresolved` with code `derivation-target-bare-note-id`. Detection: when `opts.derivesPosition === true` AND the parsed value has `noteId` set but no `claimPrefix`. The detection MUST fire before any note-existence check — a bare `derives=ARCH028` produces this code even when ARCH028 exists in the index. The code's distinct identity is what lets the diagnostic say "you gave me a note ID, but `derives=` requires a claim ID" rather than the conflated "target does not resolve."

§10.DC.05:4:derives=R015.§1.AC.04a The resolver MUST accept a `ResolverOptions.includeArchived` flag. When true (the default for resolution), archived-note entries are eligible matches and the resolver returns `resolved` for citations targeting them. When false (the consumer's choice for projection-coverage calculation), archived-note entries are excluded from match candidates and the resolver returns the appropriate `unresolved` code as if the entry were absent. The flag does NOT remove the archived-state signal from a resolved outcome — the consumer receives `entry.archived === true` and decides what to do.

§10.DC.06:5:derives=R015.§1.AC.04b When `resolveReference` resolves a citation to an archived-note entry AND the consumer treats archived as a failure (e.g., default lint behavior), the resolver MUST produce `unresolved` with code `reference-to-archived`, distinct from `reference-to-unknown-note` and `reference-to-undefined-claim`. The three codes correspond to mechanically distinct failures: archived = note was retired but still resolvable; unknown-note = note never existed or was hard-deleted without lifecycle marker; undefined-claim = note exists but cited claim ID was never defined.

§10.DC.07:4:derives=R004.§4.AC.07 The resolver MUST distinguish `reference-to-unknown-note` (the cited noteId is absent from the index entirely) from `reference-to-undefined-claim` (the cited noteId exists in the index but no entry matches the cited claim suffix). The two cases require sequential checks: first check noteId presence; if absent, return `unknown-note`; if present, attempt claim-suffix lookup (including section-less rule per §10.DC.03); if no match, return `undefined-claim`.

### §10.2 Index Integration (`core/src/claims/claim-index.ts`)

§10.DC.08:4:derives=R004.§4.AC.08 `ClaimIndex.build()` MUST call `resolveReference()` for every `derives=TARGET` metadata value and every inline `ClaimReference`. The function's previously-internal `resolveClaimAddress()` MUST be removed; no fallback resolution path may exist outside the shared module. Outcomes are translated into `ClaimTreeError` entries (for `unresolved` outcomes carrying a `derives=`-position code) or into cross-ref edges (for `resolved` outcomes and for `unresolved`-on-inline-ref outcomes that still need to surface to lint and trace).

§10.DC.09:3:derives=R004.§4.AC.07 The `ClaimTreeError.type` union MUST be extended to include the new resolver-emitted codes per §10.DC.02. Existing consumers (lint output formatter, VS Code diagnostic provider) MUST be updated to render messages for each new code. The following five legacy codes MAY be retained as a transition-window alias surface — emitted in parallel with the new codes — until downstream consumers have adopted the new taxonomy: the umbrella codes `unresolved-reference` and `unresolvable-derivation-target` (which split into the new `reference-to-*` and `derivation-target-bare-note-id`/`derivation-target-ambiguous` codes), and the rename-mapped codes `cross-project-derives`, `derivation-from-removed`, and `derivation-from-superseded` (which rename to `derivation-target-cross-project`, `derivation-target-removed`, and `derivation-target-superseded` respectively). For each failure mode covered by the transition window, the emitter pushes TWO `ClaimTreeError` entries — one with the legacy code and one with the new code — so that consumers grepping on either surface continue to match. Legacy-first emission ordering preserves stable grep behavior for today's tooling. The transition window length is OQ.01.

§10.DC.16:5:derives=R015.§1.AC.04a The index loading entry point (`core/src/cli/commands/claims/ensure-index.ts:ensureIndex()`) MUST pass `{ includeArchived: true }` (or equivalent) to `noteManager.getNotes()` so that notes tagged `archived` are present in the `NoteWithContent[]` passed to `ClaimIndex.build()`. Without this, archived-note entries are absent from the index entirely and §10.DC.05's `includeArchived` flag has no candidates to filter; the resolver degenerates `reference-to-archived` to `reference-to-unknown-note`. This is the call-site invocation point that realizes R015.§1.AC.04a's "archived notes MUST stay in-index for resolution" invariant.

§10.DC.17:4:derives=R015.§1.AC.04a `ClaimIndexEntry` (in `core/src/claims/claim-index.ts`) MUST carry an `archived: boolean` field, populated at entry-construction time from the source note's tag set (`note.tags.includes('archived')`). The field carries the archived-state signal that §10.DC.05's resolver branches on and that §10.DC.06's `reference-to-archived` failure code depends on. Without this field, the resolver cannot distinguish an archived-but-resolved entry from an active-and-resolved entry, and §10.DC.05's per-call `includeArchived` toggle has nothing to read.

### §10.3 Shared Input Resolution (`core/src/cli/commands/shared/resolve-claim-id.ts`)

§10.DC.10:3:derives=R004.§4.AC.08 `resolveClaimInput()` MUST be reduced to a thin wrapper that performs user-input normalization (`$` → `§` replacement per {DD008.§1.DC.01}, zero-padding per {DD008.§1.DC.02}, `§`-stripping for index lookup) and then delegates to `resolveReference()`. The ad-hoc section-only and suffix-matching logic in the current implementation MUST be removed; equivalent behavior is provided by the resolver's section-less rule (§10.DC.03).

### §10.4 Trace Consumer (`core/src/claims/traceability.ts`, `core/src/cli/commands/claims/trace-command.ts`)

§10.DC.11:4:derives=R004.§5.AC.05 The trace matrix builder MUST consume `resolveReference()` outcomes and emit a row for every citation in the input set, including unresolved ones. An `unresolved` outcome MUST NOT cause the citation to be dropped from the matrix; the row MUST surface the failure with a sentinel value in the relevant projection column. The exact rendering (text label, color, distinct row section) is the trace-command's choice, but the MUST is that the row exists and is visually distinguishable from a `resolved` row.

§10.DC.12:4:derives=R006.§4.AC.04 The trace command's `Derived from:` rendering for a claim with `derives=TARGET` metadata MUST render the resolver's outcome explicitly. For a `resolved` outcome, render the canonical FQID linked to the source claim. For an `ambiguous` outcome, render the candidates. For an `unresolved` outcome, render a sentinel of the form `<UNRESOLVED — code=<code>>` (or equivalent — the precise label is a UX choice) so the slot is visible. Silent omission of the `Derived from:` line for a malformed `derives=` is FORBIDDEN.

### §10.5 Lint Consumer (`core/src/cli/commands/claims/lint-command.ts`)

§10.DC.13:4:derives=R004.§4.AC.07 The lint command MUST emit a distinct human-readable message for each `ResolverFailureCode`. The messages MUST be specific enough to direct the user to the correct remediation: e.g., for `reference-to-unknown-note`, "no note {X} exists in the project"; for `reference-to-undefined-claim`, "note {X} exists but does not define claim {Y}"; for `reference-to-archived`, "reference resolves to archived note {X}"; for `derivation-target-bare-note-id`, "`derives=` requires a claim address; got bare note ID {X}". The umbrella `unresolved-reference` is RETAINED as a parallel-emit during transition but MUST NOT be the sole message for any of the new failure modes.

§10.DC.14:5:derives=R004.§4.AC.08 The lint output MUST satisfy the lint-trace invariant: for every citation in the input set, if the trace command renders the citation as a `resolved` row, the lint command MUST NOT emit any unresolved-reference-family error for that citation; conversely, if the trace command renders the citation as an `unresolved` row, the lint command MUST emit the corresponding error. The implementation mechanism — both consumers calling `resolveReference()` and trusting its outcome — is what realizes this invariant. Regression testing MUST include a property test asserting this invariant over the audit's eleven-class corpus.

### §10.6 Dependents Command (`core/src/cli/commands/claims/dependents-command.ts`)

§10.DC.15:3:derives=R006.§5.AC.05 A new `dependents` subcommand under `scepter claims` MUST be implemented. Inputs: a claim FQID. Outputs: a structured list of every claim in the project that declares `derives=TARGET` against the input, every claim that declares `superseded=TARGET` against the input, and every inline reference to the input. The output format mirrors `scepter claims trace` structurally (per OQ.04 default lean). Cross-project citations MUST be listed in a separate footer per {R011}.

## §11 Acceptance Criteria Summary

| Section | DC count | Derives From |
|---------|----------|--------------|
| §10.1 Resolver Module | 7 (DC.01–07) | {R004.§4.AC.07–09}, {R006.§1.AC.05}, {R015.§1.AC.04a–b} |
| §10.2 Index Integration | 4 (DC.08–09, DC.16–17) | {R004.§4.AC.07–08}, {R015.§1.AC.04a} |
| §10.3 Shared Input Resolution | 1 (DC.10) | {R004.§4.AC.08} |
| §10.4 Trace Consumer | 2 (DC.11–12) | {R004.§5.AC.05}, {R006.§4.AC.04} |
| §10.5 Lint Consumer | 2 (DC.13–14) | {R004.§4.AC.07–08} |
| §10.6 Dependents Command | 1 (DC.15) | {R006.§5.AC.05} |
| **Total DCs** | **17** | |

## References

- {R004} — Claim-Level Addressability and Traceability System (resolver behavior ACs)
- {R006} — Claim Derivation Tracing (bare-note-id stance, `claims dependents` ergonomic)
- {R015} — Note Reference Rewriting on Delete and Rename (archive lifecycle)
- {S002} — Claim Reference Grammar (cross-tab specification consumed by the resolver)
- `core/src/claims/claim-index.ts` — The current `resolveClaimAddress()` site replaced by this DD
- `core/src/cli/commands/shared/resolve-claim-id.ts` — The current `resolveClaimInput()` site that this DD unifies with the above
- `core/src/claims/traceability.ts` — Trace matrix builder that consumes resolver outcomes
- `core/_scratch/202605202055 peer project claim audit class catalog.md` — The audit source identifying eleven error classes; this DD covers Classes 1, 2, 5 (error-code portion), 6, 7, and the cross-cutting lint-vs-trace observation
