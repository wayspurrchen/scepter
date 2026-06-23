---
created: 2026-05-05T15:14:35.691Z
tags: [confidence, adapters, registry, frontmatter, specification]
status: draft
---

# S003 - Confidence adapter registry

## Overview

This specification formalizes the adapter registry that {R013.§1} introduces: a small, ordered collection of adapter objects that mediate between the confidence subsystem's payload model and the byte-level file shapes that carry confidence annotations. It defines the adapter interface every implementation must satisfy, the registry's lookup contract, and the two built-in adapters — the C-family comment adapter (a re-expression of the existing behavior in `core/src/claims/confidence.ts`) and the markdown frontmatter adapter (a new shape that uses `gray-matter` to read and write a `confidence:` scalar).

The spec scopes to {R013.§1} plus the read-time parse-widening of {R017}. {R013.§2} (audit-scope expansion), {R013.§3} (bulk apply), and {R013.§4} (auto-insert on note creation) are downstream consumers of the registry and will be specified separately. This document defines the contract those consumers depend on; it does not specify their command surface, filter semantics, or wiring. §6 (added for {R017}) specifies the implied-human read-time policy that widens both adapters' parse grammars; the `claims.confidence.impliedHuman` config flag and the read-path consumers that resolve and thread it are specified in {S004.§7}.

The C-family adapter MUST preserve the externally observable contracts of {R004.§7.AC.01} and {R004.§7.AC.02} byte-for-byte — the same annotation strings produced by the existing `formatConfidenceAnnotation` and the same parse outcomes produced by the existing `parseConfidenceAnnotation` MUST hold under the adapter's `format` and `parse` operations.

### Scope

In scope:
- The adapter interface (`matches`, `parse`, `format`, `insert`) and the shared `ConfidencePayload` type.
- The registry's shape (ordered list), built-in registration order, and `getAdapter(filePath)` lookup contract.
- The C-family adapter's `matches`, `parse`, `format`, and `insert` behavior — specifying the existing implementation as a contract.
- The frontmatter adapter's `matches`, `parse`, `format`, and `insert` behavior — including the create-frontmatter-when-absent case.
- Cross-cutting invariants: payload canonicalization, date round-tripping, validation delegation, and side-effect freedom.
- The implied-human read-time policy (§6, {R017}): the emoji-optional parse grammar in both adapters, the OPTIONAL `defaultReviewer` parameter on `parse`, and the bare-digit-reads-as-human contract gated by that parameter.

Out of scope:
- The command-surface specifications for `confidence audit`, `confidence apply`, `confidence mark`, and auto-insert on `scepter create` — separate specs.
- Structured-object frontmatter shape (`confidence: {reviewer, level, date}`) — explicit non-goal in {R013}.
- A third-party adapter registration API. The registry's extensibility is mentioned as a future hook; the contract here covers built-in adapters only.
- Source-file auto-insert at creation. There is no `scepter create` equivalent for source files; the adapter contract is silent on creation-time wiring.
- The reviewer/level validation rule (AI 1-3, Human 3-5). That rule is enforced at the command layer (`mark`/`apply`) by `validateReviewerLevel`; adapters do not validate.
- The `claims.confidence.impliedHuman` config flag, its default-active resolution, and the wiring that threads the resolved `defaultReviewer` into each read-path consumer's `parse` call. §6 specifies the parse-grammar mechanism the flag activates; {S004.§7} specifies the flag and its consumer threading.

Non-goals:
- This spec does not redefine the payload string format. {R013.§1.AC.04} establishes `<emoji><level> <YYYY-MM-DD>` as canonical and shape-agnostic; this spec restates it as the payload contract that adapters preserve.
- This spec does not specify module structure, file layout, or symbol names. The TypeScript sketches below are illustrative; detailed design names the symbols and chooses the file layout.
- This spec does not specify the regex grammar of the C-family annotation beyond what {R004.§7} settled. Where {R004.§7} defines a format, this spec restates the consequence as an adapter contract.

## At a Glance

The adapter registry is a thin dispatch layer between callers (audit, mark, apply, auto-insert) and file-shape-specific parse/format/insert logic. A caller hands the registry a file path; the registry returns the matching adapter (or `null`); the caller invokes adapter operations against file content.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Callers: audit, mark, apply, auto-insert                              │
│  - Each holds a file path and (for write paths) a ConfidencePayload    │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ getAdapter(filePath)
                                 ▼
                       ┌──────────────────────┐
                       │  Adapter Registry    │
                       │  (ordered list,      │
                       │  first-match-wins)   │
                       └──────────┬───────────┘
                                  │ first .matches(filePath) === true
                                  ▼
            ┌────────────────────────────────────────────┐
            │  Adapter (one of):                          │
            │   - markdown-frontmatter (.md)              │
            │   - c-family-comments (.ts/.tsx/.js/...)    │
            │                                             │
            │  Operations:                                │
            │   parse(content, path)  → Annotation|null   │
            │   format(reviewer,level,date) → string      │
            │   insert(content, payload) → string         │
            └────────────────────────────────────────────┘
```

### Worked example: round-trip on a markdown note and a TypeScript file

**Input — `_scepter/notes/reqs/R042 Foo.md`:**

```markdown
---
created: 2026-05-05T00:00:00.000Z
tags: [foo]
---

# R042 - Foo
...
```

**Caller:** `confidence apply human 4` for this file.

**Pipeline:**

1. `getAdapter('_scepter/notes/reqs/R042 Foo.md')` walks the registry. The frontmatter adapter is checked first; `matches('R042 Foo.md')` returns `true` (`.md` extension). The frontmatter adapter is returned.
2. Caller computes `payload = {reviewer: '👤', level: 4, date: '2026-05-05'}`.
3. Caller calls `adapter.parse(content, path)` → `null` (no `confidence` key in frontmatter).
4. Caller calls `adapter.insert(content, payload)`. The adapter parses frontmatter via `gray-matter`, sets `data.confidence = '👤4 2026-05-05'`, re-stringifies. Result:

```markdown
---
created: 2026-05-05T00:00:00.000Z
tags: [foo]
confidence: 👤4 2026-05-05
---

# R042 - Foo
...
```

5. Caller writes the new content to disk. The adapter performs no I/O.

**Input — `core/src/claims/confidence.ts`:**

```ts
/**
 * Confidence markers for SCEpter.
 * ...
 */

import fs from 'fs-extra';
```

**Caller:** `confidence apply human 4` for this file.

**Pipeline:**

1. `getAdapter('core/src/claims/confidence.ts')`. The frontmatter adapter's `matches` returns `false` (not `.md`); the C-family adapter's `matches` returns `true` (`.ts`). The C-family adapter is returned.
2. `adapter.parse(content, path)` → `null` (no `@confidence` line in first 20 lines).
3. `adapter.insert(content, payload)` finds the first `*/` (end of the JSDoc block at the top), inserts the line `// @confidence 👤4 2026-05-05` immediately after it. Result:

```ts
/**
 * Confidence markers for SCEpter.
 * ...
 */
// @confidence 👤4 2026-05-05

import fs from 'fs-extra';
```

The two adapters consume the same `ConfidencePayload` and produce shape-appropriate annotations. The caller is identical in both cases.

## Prior Art and Design Rationale

### Domain comparison

| System | What it does | What this spec borrows | What this spec rejects |
|---|---|---|---|
| ESLint plugins / parsers | Pluggable parsers selected by file extension or path glob | Extension-based dispatch via `matches()` | The configuration heaviness — adapter selection is mechanical, not user-configured |
| Prettier plugin parsers | Per-language parse/print contract behind a uniform API | Per-shape `parse`/`format`/`insert` contract behind a uniform interface | Per-language AST representation — confidence has a single payload, not a tree |
| MIME-type dispatch (HTTP `Content-Type`) | Content-type → handler mapping | First-match-wins ordering, with a default no-handler outcome | Negotiation/quality values — confidence has no fallback chain |
| Pandoc reader/writer pairs | Symmetric parse/render for many input/output formats | The parse/format symmetry — every shape supports both directions | Format-specific intermediate representations — confidence's IR is the payload struct |
| `gray-matter` itself | YAML/TOML/JSON frontmatter detection in markdown | Reuse `gray-matter` for the markdown adapter rather than reimplementing | Reusing it for non-markdown shapes — `gray-matter` is markdown-specific |

### Why an adapter registry, not a switch

An obvious alternative is a `switch` on file extension inside each caller. Rejected because every caller would need to know every shape: a new adapter (Python docstrings, JSON Schema files) would touch every caller. The registry localizes shape knowledge to the adapter; callers operate on the payload only.

A second alternative is to make the adapter selection user-configurable. Rejected per {R013}'s design principle "Adapter selection is mechanical, not configurable" — the user has no useful control over which adapter handles `.md` files, so exposing the choice would create a surface for misconfiguration without enabling any real flexibility.

A third alternative is to fold the frontmatter adapter into a generic "structured frontmatter" reader that supports both string and object payloads. Rejected — {R013} Non-Goals explicitly defers structured-object frontmatter. Adding it speculatively would prematurely shape the adapter interface around a payload variant we have not committed to.

### Why first-match-wins, with markdown-frontmatter before c-family

Frontmatter applies only to `.md` files; C-family applies to `.ts`, `.tsx`, `.js`, `.jsx`, `.css`. There is currently no overlap. But the ordering matters as a forward-compatibility decision: if a future adapter were to claim a subset of `.md` files (e.g., a Markdoc adapter for `.md` files containing a Markdoc frontmatter sentinel), placing it before the generic frontmatter adapter is the natural way to refine the dispatch. Specifying the order now (most-specific-first) means future additions follow a clear rule rather than re-litigating dispatch policy each time.

C-family is broader and listed last for the same reason: it's the catchall for source-comment-bearing files. Future adapters for languages with different comment syntaxes (Python's `#`, Lua's `--`, etc.) would register before C-family, narrowing the catchall progressively.

## Terminology

| Term | Definition |
|---|---|
| **Adapter** | An object implementing the four-method interface in §1, bound to one file shape. Distinct from a "parser" — adapters do parse, but they also format and insert. The unit is the shape, not the operation. |
| **File shape** | The structural form a file takes for confidence-annotation purposes. Currently `.md`-with-frontmatter and `C-family-with-comments`. NOT a programming language (`.ts` and `.js` are the same shape). |
| **Payload** | The in-memory `{reviewer, level, date}` triple. Decoupled from any string serialization. The canonical unit of currency between callers and adapters. |
| **Annotation string** | The serialized form of a payload as embedded in file content. C-family form: `// @confidence 🤖2 2026-05-05`. Frontmatter form: `confidence: "🤖2 2026-05-05"` (the string scalar value, not the surrounding YAML key/quoting). |
| **Annotation** | The parsed result of reading an annotation string out of file content — `ConfidenceAnnotation` (payload + line + filePath). NOT a payload; an annotation is a payload plus location metadata. |
| **Registry** | The ordered list of adapters consulted by `getAdapter(filePath)`. NOT a map keyed by extension — order matters, and a single adapter may match multiple extensions. |
| **No-adapter outcome** | The result of `getAdapter(filePath)` returning `null` for a path no adapter claims. NOT an error; callers handle it (skip in audit; surface as a clear error in mark/apply if the user explicitly named the file). |

## Data Model

The shapes that flow between callers, the registry, and adapters. Field-level semantics for nullable fields use the WHEN SET / WHEN NULL / INVARIANT pattern.

```typescript
/**
 * Numeric confidence level. Existing type from confidence.ts; restated
 * here as the canonical level type the payload references.
 */
type ConfidenceLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Reviewer icon. Existing type from confidence.ts.
 */
type ReviewerIcon = '🤖' | '👤';

/**
 * Canonical in-memory representation of a confidence annotation.
 * Decoupled from any string format. Adapter `parse()` produces this
 * (wrapped in ConfidenceAnnotation); adapter `insert()` consumes it.
 *
 * INVARIANT: The triple uniquely determines the annotation string an
 * adapter MUST produce for `format(reviewer, level, date)`.
 */
interface ConfidencePayload {
  reviewer: ReviewerIcon;
  level: ConfidenceLevel;

  /**
   * WHEN SET: ISO `YYYY-MM-DD` string preserved verbatim from source
   *   content (parse path) or supplied by the caller (insert path).
   * WHEN UNDEFINED: The annotation in the source file omitted the
   *   date, or the caller chose not to supply one. Callers in this
   *   project always supply a date; undefined arises mainly on the
   *   parse side from legacy or hand-edited annotations.
   * INVARIANT: When set, MUST round-trip byte-identically through
   *   parse(insert(c, payload)).
   */
  date?: string;
}

/**
 * Parsed confidence annotation including location metadata. Returned
 * by adapter.parse(). The payload fields are inlined for callsite
 * convenience; line and filePath carry the source-position metadata.
 *
 * Equivalent in shape to the existing ConfidenceAnnotation type in
 * confidence.ts; renamed conceptually here to clarify that it is the
 * parse-side output, not the in-memory currency.
 */
interface ConfidenceAnnotation extends ConfidencePayload {
  /**
   * WHEN SET: 1-indexed line number where the annotation was found
   *   in the source content. C-family adapter: line of the `// @confidence`
   *   comment. Frontmatter adapter: line of the `confidence:` key
   *   within the frontmatter block.
   * INVARIANT: Always set when ConfidenceAnnotation is returned.
   */
  line: number;

  filePath: string;
}

/**
 * The adapter contract. Every shape-specific implementation conforms
 * to this interface. Operations are pure functions over content
 * strings — no I/O.
 */
interface ConfidenceAdapter {
  /**
   * Stable identifier for diagnostics, logs, and future config.
   * Examples: 'c-family-comments', 'markdown-frontmatter'.
   */
  readonly id: string;

  /**
   * Returns true if this adapter handles the given file path.
   * Pure function of path/extension; performs no I/O.
   */
  matches(filePath: string): boolean;

  /**
   * Parse a confidence annotation out of file content. Returns null
   * when the content carries no recognized annotation. Never throws.
   *
   * The OPTIONAL `options.defaultReviewer` carries the resolved
   * implied-human read-time policy (§6, {R017}). When set to '👤', a
   * bare level digit with no leading emoji reads as a human annotation.
   * When omitted or null, a bare digit MUST NOT parse — identical to
   * today's behavior. Explicit-emoji parsing is unaffected (§1.AC.09).
   */
  parse(
    content: string,
    filePath: string,
    options?: { defaultReviewer?: ReviewerIcon | null },
  ): ConfidenceAnnotation | null;

  /**
   * Render a payload as the adapter's annotation string. The string
   * is suitable for direct embedding by `insert`; callers SHOULD NOT
   * use it for other purposes.
   */
  format(reviewer: ReviewerIcon, level: ConfidenceLevel, date: string): string;

  /**
   * Insert or replace a confidence annotation in file content.
   * Returns the new content. Pure: no FS writes.
   *
   * INVARIANT (round-trip): For any content c and payload p,
   *   parse(insert(c, p), path)  ≈ p
   *   (matching reviewer, level, and date — line/filePath excluded).
   *
   * INVARIANT (idempotence): For any content c and payload p,
   *   insert(insert(c, p), p) === insert(c, p)
   *   (subject to trailing-newline handling per §4).
   *
   * INVARIANT (preservation): All non-annotation content in c is
   *   present and ordered identically in the output, except for the
   *   line(s) replaced or the insertion point.
   */
  insert(content: string, payload: ConfidencePayload): string;
}
```

The interface above is illustrative. Exact symbol names (`ConfidenceAdapter`, `ConfidencePayload`, method order) are an implementation detail belonging to the detailed design. The behavioral contract is what this spec settles.

## §1 Adapter interface

The adapter is the unit of file-shape knowledge. Every shape that carries confidence annotations is represented by exactly one adapter. The interface fixes four operations: `matches` (path-only dispatch), `parse` (content → payload+location, or null), `format` (payload → annotation string), and `insert` (content + payload → content). Callers use `parse` and `insert` for round-trip operations and use `format` only when they need the annotation string in isolation (e.g., for log output or dry-run preview).

The interface is content-pure. No operation reads or writes the filesystem. Callers own I/O; adapters own string transformations. This separation lets callers batch reads, run dry-runs, and compose adapter operations without adapters needing FS-mock infrastructure.

§1.AC.01:5:derives=R013.§1.AC.01 The system MUST expose a `ConfidenceAdapter` interface (or structurally equivalent contract) consisting of: a stable `id` string, a `matches(filePath: string): boolean` method, a `parse(content: string, filePath: string): ConfidenceAnnotation | null` method, a `format(reviewer, level, date): string` method, and an `insert(content: string, payload: ConfidencePayload): string` method.

§1.AC.02:4 The system MUST expose a `ConfidencePayload` type — the in-memory `{reviewer, level, date?}` representation — that is shape-agnostic and shared across every adapter. Adapter `parse()` MUST produce values whose payload fields are populated from this type; adapter `insert()` MUST accept this type as its payload argument.

§1.AC.03 `matches(filePath)` MUST be a pure function of the file path (extension and any path-based discriminator). It MUST NOT perform filesystem I/O, MUST NOT read or open the file, and MUST NOT depend on file content. Two invocations with the same path argument MUST return the same result.

§1.AC.04:4 `parse()` MUST return `null` when the content carries no recognized confidence annotation. It MUST NOT throw on absent annotations, malformed-but-non-confidence content, empty content, or content lacking the structural framing the adapter normally reads (e.g., a markdown file with no frontmatter is a successful `null` return for the frontmatter adapter, not an error).

§1.AC.05:5 The round-trip invariant MUST hold for every adapter: for any content `c` and payload `p`, `parse(insert(c, p), filePath)` returns an annotation whose `reviewer`, `level`, and `date` fields equal `p`'s.

§1.AC.06:4 `insert()` MUST preserve all non-annotation content in `c`. The output content MUST contain every line of `c` that did not carry the prior annotation, in the same order, with identical text. Replacement of an existing annotation MUST be in-place at the original line; insertion of a new annotation MUST add lines at the adapter's defined insertion point without reordering surrounding content.

§1.AC.07:4 `insert()` MUST be idempotent at a given payload: `insert(insert(c, p), p)` MUST equal `insert(c, p)`, modulo the trailing-newline handling defined in §4.AC.05 for the frontmatter adapter.

### Read-time policy parameter on `parse`

The implied-human read-time policy ({R017}) widens what `parse` accepts on the read path: when active, an annotation that carries a bare level digit with no leading emoji reads as a human (`👤`) annotation (see §6). The policy is a per-call read-time input, not adapter-global state — different callers may resolve the policy differently (a write-path caller never activates it; a read-path caller activates it from config). The contract therefore threads the resolved policy into `parse` as an OPTIONAL trailing parameter so callers that do not opt in compile and behave unchanged. The parameter carries a single resolved value — the reviewer to attribute to a bare digit — rather than a config object; resolving the `claims.confidence.impliedHuman` flag to that value is the caller's responsibility (see {S004.§7}).

§1.AC.08:4:derives=R017.AC.05 The `parse` operation MUST accept an OPTIONAL third parameter carrying the resolved default-reviewer policy — `parse(content: string, filePath: string, options?: { defaultReviewer?: ReviewerIcon | null })` (or a structurally equivalent options shape). The parameter MUST be optional so that every existing caller invoking `parse(content, filePath)` compiles and behaves identically to today. When the parameter is omitted, `parse` MUST behave as if `defaultReviewer` were absent — a bare digit MUST NOT parse, exactly as today.

§1.AC.09:derives=R017.AC.06 The read-time policy parameter MUST NOT alter the parse outcome of any annotation carrying an explicit `🤖` or `👤` emoji. The parameter governs ONLY the bare-digit case (§6.AC.01); for explicit-emoji annotations, `parse` MUST return the same reviewer, level, and date regardless of the parameter's presence or value.

### Public surface (illustrative)

The TypeScript shape above (under "Data Model") sketches the interface. Implementation MAY use a class, an object literal, or a discriminated union; MAY rename the symbols; MAY split `ConfidenceAnnotation` and `ConfidencePayload` differently. The behavioral contracts in the ACs above are normative; the symbol names are not.

## §2 Registry mechanics

The registry is a small, ordered list of adapter instances. Lookup is `getAdapter(filePath)` — the registry walks adapters in order and returns the first whose `matches(filePath)` returns true, or `null` if none match. Built-in adapters register at module load. Consumers retrieve their adapter via `getAdapter`; they never instantiate adapters directly.

The ordering invariant is "most-specific-first." Today the two built-in adapters do not overlap (`.md` vs C-family extensions), so order is functionally irrelevant. The order is specified anyway as a forward-compatible policy: future adapters that narrow an existing adapter's coverage MUST register before it. {R013}'s design principle "Adapter selection is mechanical, not configurable" implies callers cannot reorder; the registry's order is fixed by registration sequence.

§2.AC.01:4:derives=R013.§1.AC.01 The registry MUST be an ordered collection of adapter instances. Lookup order MUST follow registration order; first match wins.

§2.AC.02 At module load, the system MUST register the markdown-frontmatter adapter before the c-family-comments adapter. This order MUST be preserved without depending on object-key insertion behavior, registration source order, or any other implicit mechanism.

§2.AC.03:5 `getAdapter(filePath)` MUST return the first registered adapter for which `matches(filePath)` returns `true`, or `null` if no adapter matches. It MUST NOT throw on any string input, including empty strings, paths to non-existent files, or paths with unusual extensions.

§2.AC.04 `getAdapter(filePath)` MUST be a pure function of the file path: identical inputs yield identical outputs, with no filesystem access. The registry MUST NOT cache results in a way that would break this property.

§2.AC.05:4:derives=R013.§1.AC.05 Callers receiving `null` from `getAdapter(filePath)` MUST handle the no-adapter outcome explicitly. The adapter contract is silent on what callers do with `null`; consuming specs ({R013.§2}, {R013.§3}) define the audit-skip and apply-error behaviors. This adapter spec only guarantees that `null` is the well-defined signal for an unmatched file.

### Future extension hook (informative)

The registry MAY accept third-party adapters via a `register(adapter)` API in a future revision. {R013} does not require this, and this spec does not specify it. Adapters introduced in future Requirements would register before or after the built-in adapters per the most-specific-first rule. No claim in this spec depends on the extension hook existing.

## §3 C-family adapter

The C-family adapter re-expresses the existing behavior in `core/src/claims/confidence.ts` as an adapter implementation. Its goal is byte-identical equivalence with the current implementation: any `.ts`/`.tsx`/`.js`/`.jsx`/`.css` file the existing `parseConfidenceAnnotation` reads, the adapter's `parse` MUST read identically; any string the existing `formatConfidenceAnnotation` produces, the adapter's `format` MUST produce identically; any insertion point the existing `insertConfidenceAnnotation` chooses, the adapter's `insert` MUST choose identically.

The adapter is a thin wrapper. It does not change parse semantics, format conventions, or insertion-location heuristics. It reorganizes the existing functions behind the adapter interface so they participate in the registry's dispatch.

§3.AC.01:derives=R013.§1.AC.02 The C-family adapter's `matches(filePath)` MUST return `true` for files whose extension is one of `.ts`, `.tsx`, `.js`, `.jsx`, or `.css`. These five extensions are the project's default `sourceCodeIntegration.extensions`; if a project's config narrows the set, the adapter's `matches` MUST follow the active config.

§3.AC.02 The C-family adapter's `parse` MUST scan only the first 20 lines of `content`. It MUST recognize annotations matching the regex `(?:\/\/|\*)\s*@confidence\s+(🤖|👤)(\d)(?:\s+(.+))?`. The trailing capture group, when present, is treated as the payload's `date` field (after `.trim()`); when absent, `date` is `undefined`.

§3.AC.03:derives=R004.§7.AC.02 The C-family adapter's `format(reviewer, level, date?)` MUST produce the line-comment form `// @confidence <reviewer><level> <date>` with a single space between `@confidence` and the emoji, NO space between the emoji and the level digit, and a single space between the digit and the date. When `date` is `undefined` (e.g., `claims.confidence.includeDate` is false per {R013.§1.AC.06}), `format` MUST produce `// @confidence <reviewer><level>` with no trailing space. The JSDoc-internal carrier form ` * @confidence <reviewer><level> <date>` is constructed by `insert` per §3.AC.05(a) and is NOT returned by `format`. (Example: `// @confidence 🤖2 2026-05-05`.)

§3.AC.04 The C-family adapter's `insert` MUST locate an existing annotation by scanning the first 20 lines for the same regex used by `parse`. When found, the adapter MUST replace the entire matched line in-place with an annotation string in the SAME carrier form as the matched line — a `// @confidence …` line is replaced with another `// @confidence …` line; a ` * @confidence …` JSDoc-internal line is replaced with another ` * @confidence …` line preserving the original asterisk indentation. The line index and surrounding content MUST be unchanged.

§3.AC.05 When no existing annotation is found, the C-family adapter's `insert` MUST select carrier and insertion point as follows, in priority order: (a) **JSDoc carrier (preferred):** if the first 20 lines contain a top-level JSDoc block (a line containing `/**` followed by a later line containing `*/`, both within the first 20 lines), the adapter MUST insert a new line ` * @confidence <reviewer><level> <date>` immediately BEFORE the closing `*/` line, preserving the JSDoc's leading-asterisk indentation. (b) **Line-comment-stack carrier:** else if the file's first lines form a contiguous `//`-line-comment block (one or more leading lines whose first non-whitespace characters are `//`), the adapter MUST append a new `// @confidence <reviewer><level> <date>` line at the end of that contiguous block, before the first non-comment line. (c) **New line-comment carrier:** else the adapter MUST insert a new `// @confidence <reviewer><level> <date>` line as the file's first line. Carriers are mutually exclusive — (a) takes precedence over (b) which takes precedence over (c).

§3.AC.06 The C-family adapter MUST preserve the legacy parse contract: any file annotated by the pre-{R013} `parseConfidenceAnnotation` (whether the annotation appears as a `// @confidence` line, a ` * @confidence` line, or any first-20-line position including the legacy after-`*/` placement) MUST continue to parse identically under the adapter's `parse`. Insert behavior intentionally diverges from the pre-{R013} `insertConfidenceAnnotation` per §3.AC.05: the legacy implementation placed `// @confidence` AFTER the JSDoc closer, while §3.AC.05(a) places ` * @confidence` BEFORE the closer. This divergence is corrective — JSDoc-internal placement matches the carrier convention §3.AC.02 has always recognized in `parse` and aligns with conventional JSDoc-tag placement.

## §4 Markdown frontmatter adapter

The frontmatter adapter is the new shape introduced by {R013.§1.AC.03}. It uses the `gray-matter` library — already a project dependency, already used by `note-file-manager.ts` for note frontmatter parsing — to read and write a `confidence:` key in YAML frontmatter. The payload is stored as a string scalar (`confidence: "🤖2 2026-05-05"`), not as a structured object; structured-object frontmatter is an explicit non-goal in {R013}.

The adapter must handle three frontmatter cases on insert:

1. **No frontmatter at all.** The adapter creates a frontmatter block at the top of the file containing only the `confidence:` key.
2. **Frontmatter exists, no `confidence` key.** The adapter adds the `confidence` key inside the existing block, preserving all other keys and (best-effort) their ordering.
3. **Frontmatter exists, `confidence` key already present.** The adapter replaces the value of the existing `confidence` key with the new payload string.

`gray-matter`'s parse/stringify round-trip preserves all keys but does not preserve YAML comments or original key ordering with full fidelity. The adapter inherits these limitations; preserving comments is a best-effort property, not a contract.

§4.AC.01:derives=R013.§1.AC.03 The frontmatter adapter's `matches(filePath)` MUST return `true` if and only if the file path's extension is `.md`. Other markdown extensions (`.markdown`, `.mdown`, `.mkd`) are NOT matched by the default registration; future adapter variants MAY register for them.

§4.AC.02 The frontmatter adapter's `parse` MUST parse `content` via `gray-matter`. If the parsed `data` object has no `confidence` key, the adapter MUST return `null`. If the `confidence` key's value is not a string, the adapter MUST return `null`. If the value is a string but does not match the payload regex `^(🤖|👤)(\d)(?:\s+(\S+))?$` (anchored, optional trailing date), the adapter MUST return `null`.

§4.AC.03 When the `confidence` value matches the payload regex, the frontmatter adapter's `parse` MUST return a `ConfidenceAnnotation` with `reviewer` and `level` populated from the regex captures, `date` populated from the third capture (or `undefined` if absent), `filePath` set to the input path, and `line` set to the 1-indexed line number of the `confidence:` key within the source content's frontmatter block.

§4.AC.04:derives=R013.§1.AC.04 The frontmatter adapter's `format(reviewer, level, date)` MUST produce the exact string `<reviewer><level> <date>` — the bare payload value, with no surrounding YAML quotes, no `confidence:` prefix, and no trailing whitespace. YAML serialization of the value (including quoting decisions) is `gray-matter`'s responsibility; the adapter MUST NOT attempt to pre-quote.

§4.AC.05 When `content` has no leading frontmatter block, the frontmatter adapter's `insert` MUST create a new frontmatter block at the top of the file containing exactly the `confidence:` key (with the formatted payload as its value), followed by the original content. The resulting file MUST be parseable by `gray-matter` such that subsequent `parse` returns the inserted payload.

§4.AC.06 When `content` has a leading frontmatter block without a `confidence` key, the frontmatter adapter's `insert` MUST add the `confidence` key inside the existing block via `gray-matter.stringify`, preserving all other keys' values. Key ordering and YAML comment preservation follow `gray-matter`'s behavior; the adapter MUST NOT pre-process or post-process the frontmatter to enforce a specific ordering.

§4.AC.07 When `content` has a leading frontmatter block with an existing `confidence` key, the frontmatter adapter's `insert` MUST replace only the `confidence` value, preserving all other keys and their values byte-identically through `gray-matter`'s stringify (subject to that library's known limitations on comment and ordering preservation).

§4.AC.08 Idempotence: applying `insert(content, payload)` twice in succession MUST yield content byte-identical to a single application, modulo a single trailing newline that `gray-matter.stringify` MAY add or normalize. Callers comparing outputs for idempotence MUST account for this trailing-newline tolerance.

## §5 Cross-cutting invariants

The adapter contract relies on four invariants that hold across every adapter, present and future. They factor out behavior that would otherwise be re-stated in every adapter section.

§5.AC.01:5 `ConfidencePayload` is the canonical in-memory representation. Adapters MUST NOT define adapter-specific payload subtypes or extensions. If a future adapter needs to carry shape-specific state through parse/insert (e.g., a comment-style marker for a language with multiple comment forms), that state MUST be derived from the file content at parse/insert time, not encoded in the payload type.

§5.AC.02:derives=R013.§1.AC.04 The date format is ISO `YYYY-MM-DD`. Adapters MUST round-trip the `date` field verbatim: when `parse` reads a date from source content, the same string MUST appear in the payload's `date` field; when `insert` is called with a non-undefined `date`, the same string MUST appear at the date position in the inserted annotation. Adapters MUST NOT normalize, reformat, or canonicalize the date string. When the source content omits the date, `parse` MUST set `date` to `undefined`; when the payload's `date` is `undefined`, `insert`'s output is adapter-defined (the C-family adapter omits the trailing date; the frontmatter adapter omits the trailing space and date).

§5.AC.03 Reviewer/level validation (the rule that AI=🤖 may use levels 1-3 and Human=👤 may use levels 3-5) is enforced at the command layer (`mark` / `apply`) by `validateReviewerLevel`. Adapters MUST NOT validate the reviewer/level combination on `parse` or `insert`; they MUST store and return whatever the caller supplies. This delegation lets adapters remain payload-format-only and lets validation policy evolve at the command layer without touching adapter implementations.

§5.AC.04:5 Adapter operations MUST NOT have side effects beyond returning new values. `parse` MUST NOT mutate the input `content` string (TypeScript strings are immutable, but the rule extends to any out-parameters the implementation might add). `insert` MUST NOT write to the filesystem, MUST NOT log to a globally observable channel by default, and MUST NOT mutate any registry-level or module-level state. The caller is responsible for FS writes that persist `insert`'s output.

§5.AC.05 `format` is the canonical serializer for the payload-as-string. Adapters MAY compose `format` internally inside `insert`, or MAY embed equivalent string construction directly; the choice is an implementation detail. What the contract guarantees is that `format(reviewer, level, date)` produces the exact string a caller would see if it parsed the inserted annotation back out and re-rendered just the payload portion.

## §6 Implied-human read-time policy

{R017} introduces a read-time defaulting policy layered on top of the {R013.§1.AC.04} payload format: when active, a confidence annotation whose level digit carries no leading emoji parses as a human (`👤`) annotation at that level. The motivation is ergonomic — a human editing a file by hand can type `confidence: 4` in note frontmatter or `// @confidence 4` in source, rather than pasting a `👤` emoji the YAML scalar or comment carrier does not otherwise need. The automated actor already writes `🤖` programmatically; only the human hand-editing a file benefits from the leniency. The governing principle is that the robot emoji `🤖` is the only marker that reads as AI; a bare digit and an explicit `👤` both read as human, and the two human readings converge.

This section amends the parse grammar of both built-in adapters by making the leading emoji capture OPTIONAL. It does not touch `format` or `insert` — every write path continues to emit an explicit emoji (the read-leniently/write-explicitly asymmetry is intentional). The policy is threaded into `parse` via the OPTIONAL parameter specified in §1.AC.08; the bare-digit case is the only new parse outcome, and it is gated entirely by the resolved `defaultReviewer` value. When `defaultReviewer` is absent or null, the grammar widening is inert and parse behaves exactly as §3.AC.02 and §4.AC.02 specify today.

The policy is a parse-time defaulting rule, not a validation rule: it records what is on disk and MUST NOT consult the writer-side reviewer/level ranges (the AI 1-3 / Human 3-5 table enforced by `validateReviewerLevel` at the command layer per §5.AC.03). A bare digit reads as human at every level 1-5, including levels a human could not write via `mark`. This preserves the §5.AC.03 / {DD016.§1.DC.04} boundary that adapters MUST NOT import validation.

### Emoji-optional grammar

The amendment widens the emoji capture group in each adapter's parse regex from required to optional. §3.AC.02 specifies the C-family grammar `(?:\/\/|\*)\s*@confidence\s+(🤖|👤)(\d)(?:\s+(.+))?` and §4.AC.02 the frontmatter grammar `^(🤖|👤)(\d)(?:\s+(\S+))?$`. Under the policy, the `(🤖|👤)` group becomes `(🤖|👤)?` in both. The level capture, the optional trailing-date capture, and the line/anchoring behavior are otherwise unchanged. These claims amend §3.AC.02 and §4.AC.02 — they do not delete those claims; they add the read-time-active behavior on top of the unchanged explicit-emoji behavior.

§6.AC.01:5:derives=R017.AC.01 When `parse` is invoked with `defaultReviewer: '👤'`, an annotation consisting of a bare level digit with no leading emoji MUST parse to reviewer `👤` and the captured level, in BOTH the C-family adapter (`// @confidence 4` and ` * @confidence 4` carrier forms, per the §3.AC.02 grammar with the emoji group optional) and the markdown-frontmatter adapter (`confidence: 4`, per the §4.AC.02 anchored grammar with the emoji group optional). Amends §3.AC.02 and §4.AC.02.

§6.AC.02:derives=R017.AC.02 When the leading emoji IS present, parse outcome MUST be unchanged from §3.AC.02 / §4.AC.02 regardless of `defaultReviewer`: an explicit `🤖` parses to reviewer `🤖`, an explicit `👤` parses to reviewer `👤`. The grammar widening attaches the `defaultReviewer` value ONLY when the (now-optional) emoji capture is absent.

§6.AC.03:derives=R017.AC.03 Bare-digit defaulting MUST apply at every level 1-5: with `defaultReviewer: '👤'`, a bare `1`, `2`, `3`, `4`, or `5` MUST each parse to reviewer `👤` at the corresponding level, in both adapters.

§6.AC.04:derives=R017.AC.04 The trailing-date capture MUST behave identically whether or not the leading emoji is present. With `defaultReviewer: '👤'`, a bare digit followed by a single space and an ISO `YYYY-MM-DD` date (`confidence: 4 2026-05-31`; `// @confidence 4 2026-05-31`) MUST parse to reviewer `👤`, the captured level, and the captured date — the same date capture group the explicit-emoji form uses (§3.AC.02's third group, §4.AC.02's third group).

### Inactive policy is identical to today

§6.AC.05:4:derives=R017.AC.05 When `parse` is invoked with `defaultReviewer` omitted or null, a bare level digit with no leading emoji MUST NOT parse: `parse` MUST return the same no-match outcome (`null`) it returns today, in both adapters. The widened (emoji-optional) grammar MUST attach a reviewer to a bare digit ONLY when `defaultReviewer` is a reviewer value; with no resolved default, a bare digit is not a recognized annotation.

§6.AC.06:derives=R017.AC.06 Toggling `defaultReviewer` between `'👤'` and absent/null MUST change the parse outcome of ONLY the bare-digit case. Any annotation carrying an explicit `🤖` or `👤` MUST parse identically under both states (this is the adapter-level expression of §1.AC.09).

### Parse independence from write-side ranges

§6.AC.07:4:derives=R017.AC.07 With `defaultReviewer: '👤'`, a bare digit at a level outside the writer-side human range — `confidence: 1`, `confidence: 2` — MUST parse to reviewer `👤` at that level. Parse MUST NOT consult the reviewer/level range table, MUST NOT downgrade, reject, or reclassify the annotation on the basis of that table, and MUST NOT import validation (preserving the §5.AC.03 and {DD016.§1.DC.04} adapter/validation boundary).

### YAML-number coercion in the frontmatter adapter

A hand-typed bare `confidence: 4` is the motivating case for {R017.AC.01}, but `gray-matter` parses an unquoted single digit as a YAML number. The current §4.AC.02 string-scalar guard (`typeof value !== 'string'` → `null`) would reject a YAML number before the emoji-optional grammar runs, so the motivating case would never reach §6.AC.01. The frontmatter adapter therefore MUST coerce an in-range YAML integer to its digit-string form under the active policy. The dated form (`confidence: 4 2026-05-31`) is already a YAML string and needs no coercion; only the bare single-digit case becomes a number.

§6.AC.08:4:derives=R017.AC.01 When the markdown-frontmatter adapter is invoked with `defaultReviewer: '👤'` and the `confidence` frontmatter value is a YAML integer in the range 1-5, `parse` MUST coerce it to the corresponding single-digit string and apply the §6.AC.01 bare-digit grammar, yielding reviewer `👤` at that level. When `defaultReviewer` is omitted or null, a YAML-integer `confidence` value MUST continue to return `null` per §4.AC.02 (Edge case 3, policy-inactive). YAML object, array, boolean, and out-of-range numeric values MUST return `null` under both policy states. This claim amends Edge case 3; it does not relax the §4.AC.02 string-scalar contract for explicit-emoji annotations.

## Edge Cases

### Edge case 1: empty content

**Trigger:** Caller invokes `parse('', filePath)` or `insert('', payload)`.
**Behavior — parse:** All adapters MUST return `null`. Empty content carries no annotation by definition.
**Behavior — insert:** The C-family adapter MUST return the formatted annotation string as the entire output (effectively prepending it to the empty file). The frontmatter adapter MUST return a freshly created frontmatter block containing the `confidence` key, followed by an empty body. Both outcomes satisfy the round-trip invariant: re-parsing the output yields the inserted payload.

### Edge case 2: malformed frontmatter

**Trigger:** A `.md` file begins with `---` but the YAML inside is malformed (unclosed quotes, invalid indentation).
**Detection:** `gray-matter` throws or returns a structure with parse errors.
**Behavior:** The frontmatter adapter's `parse` MUST treat malformed frontmatter as "no recognized annotation" and return `null` rather than propagating the error. The adapter's `insert` MAY propagate the underlying error to the caller; callers handling malformed frontmatter is the command layer's responsibility, not the adapter's. (Rationale: parse must be safe to call broadly, including during audit scans of unknown content; insert is invoked deliberately and a parse failure during insert is a real problem the caller needs to surface.)

### Edge case 3: confidence value present but not a string

**Trigger:** A `.md` file's frontmatter has `confidence: 4` (a YAML number) or `confidence: {reviewer: ai, level: 2}` (an object — the explicit non-goal shape).
**Behavior (policy inactive — `defaultReviewer` omitted/null):** The frontmatter adapter's `parse` MUST return `null`. Per §4.AC.02, only string-scalar values that match the payload regex are recognized. Numbers, objects, arrays, and booleans are all unrecognized. The user receives no special diagnostic from the adapter; the command layer MAY surface a "found unrecognized confidence value" message if it inspects the raw frontmatter directly.
**Behavior (policy active — `defaultReviewer: '👤'`):** A hand-typed bare `confidence: 4` is the motivating case for {R017} — but `gray-matter` parses an unquoted single digit as a YAML *number*, not a string, so the §4.AC.02 string-scalar guard would reject it before the emoji-optional grammar runs. Per §6.AC.08, when the policy is active the frontmatter adapter MUST coerce a YAML *integer* `confidence` value in the range 1-5 to its single-digit string form and run it through the emoji-optional grammar, yielding reviewer `👤` at that level. Object, array, boolean, and out-of-range numeric values remain unrecognized (`null`) under both policy states. (The dated form `confidence: 4 2026-05-31` is already a YAML string — it carries a space — so it is recognized by the string path without coercion.)

### Edge case 4: C-family file with annotation past line 20

**Trigger:** A `.ts` file has a `// @confidence 🤖2 2026-05-05` comment at line 30 (e.g., inside a function-level JSDoc).
**Behavior:** The C-family adapter's `parse` MUST return `null` per §3.AC.02 (only the first 20 lines are scanned). The adapter's `insert` MUST insert a new annotation in the file-level position per §3.AC.05, leaving the line-30 annotation untouched. The result is a file with two `@confidence` markers; the file-level one is canonical for adapter purposes, and the buried one is treated as inert prose. (Rationale: the 20-line scan is part of the contract; widening it would change which annotations are recognized and could surface unintended values.)

### Edge case 5: idempotence with a trailing-newline difference

**Trigger:** `insert(content, p)` produces `output1`. `insert(output1, p)` produces `output2`.
**Behavior:** For the C-family adapter, `output2 === output1` (the existing implementation replaces in-place when an annotation is already at the JSDoc-end line). For the frontmatter adapter, `output2` MAY differ from `output1` by exactly one trailing newline because `gray-matter.stringify` normalizes trailing whitespace. Per §4.AC.08, callers comparing outputs for idempotence MUST tolerate this difference. The round-trip invariant in §1.AC.05 is unaffected — `parse(output2)` and `parse(output1)` produce identical payloads.

## Error Conditions

The adapter contract is intentionally narrow on errors. Most "error" outcomes manifest as `null` (no annotation present, no adapter matches) rather than as thrown exceptions. The table below consolidates the conditions under which an adapter MAY surface an error, and the conditions under which it MUST NOT.

| Code | Condition | When | Contract |
|---|---|---|---|
| (none — returns `null`) | No annotation present in content | `parse` on any adapter | MUST return `null`, MUST NOT throw |
| (none — returns `null`) | No adapter matches file path | `getAdapter` | MUST return `null`, MUST NOT throw |
| (none — returns `null`) | Frontmatter malformed or absent | Frontmatter adapter `parse` | MUST return `null`; underlying `gray-matter` error is suppressed |
| `FRONTMATTER_PARSE_ERROR` | Frontmatter malformed | Frontmatter adapter `insert` | MAY propagate `gray-matter`'s error to the caller |
| (none — returns `null`) | Empty content | Either adapter `parse` | MUST return `null` |
| (none — returns content) | Empty content | Either adapter `insert` | MUST return content with the annotation, satisfying round-trip |

The adapter contract does not define error types or codes for the parse path; the absence of an annotation is signalled by `null`, not by exception. The single legitimate insert-time error path is malformed frontmatter, which is a real "I cannot satisfy this operation" condition rather than a missing-annotation case.

## Acceptance Criteria Summary

| Section | Criterion | Coverage |
|---|---|---|
| §1.AC.01 | Adapter interface (id, matches, parse, format, insert) | §1, Data Model |
| §1.AC.02 | ConfidencePayload as canonical type | §1, Data Model, §5 |
| §1.AC.03 | matches() is pure path-only | §1 |
| §1.AC.04 | parse() returns null, never throws | §1, Edge cases 1-3 |
| §1.AC.05 | Round-trip invariant | §1, all adapters |
| §1.AC.06 | insert() preserves non-annotation content | §1, all adapters |
| §1.AC.07 | insert() idempotence | §1, §4.AC.08 |
| §1.AC.08 | parse() OPTIONAL defaultReviewer param; omitted = today | §1, §6 |
| §1.AC.09 | read-time param governs bare-digit only; explicit-emoji unaffected | §1, §6 |
| §2.AC.01 | Registry is ordered, first-match-wins | §2 |
| §2.AC.02 | Built-in registration order | §2 |
| §2.AC.03 | getAdapter returns adapter or null, never throws | §2 |
| §2.AC.04 | getAdapter is pure | §2 |
| §2.AC.05 | Caller handles null no-adapter outcome | §2 |
| §3.AC.01 | C-family matches `.ts`/`.tsx`/`.js`/`.jsx`/`.css` | §3 |
| §3.AC.02 | C-family parse: regex over first 20 lines | §3 |
| §3.AC.03 | C-family format string (R004.§7.AC.02 contract) | §3 |
| §3.AC.04 | C-family insert: replace in-place | §3 |
| §3.AC.05 | C-family insert: after JSDoc / top of file | §3 |
| §3.AC.06 | C-family adapter is byte-identical to existing impl | §3 |
| §4.AC.01 | Frontmatter matches `.md` only | §4 |
| §4.AC.02 | Frontmatter parse: gray-matter + payload regex | §4 |
| §4.AC.03 | Frontmatter parse returns ConfidenceAnnotation | §4 |
| §4.AC.04 | Frontmatter format: bare payload, no quoting | §4 |
| §4.AC.05 | Frontmatter insert: create block when absent | §4, Edge case 1 |
| §4.AC.06 | Frontmatter insert: add key when absent | §4 |
| §4.AC.07 | Frontmatter insert: replace value when present | §4 |
| §4.AC.08 | Frontmatter idempotence (modulo trailing newline) | §4, Edge case 5 |
| §5.AC.01 | ConfidencePayload is the canonical IR | §5 |
| §5.AC.02 | Date verbatim round-trip | §5 |
| §5.AC.03 | Validation delegated to command layer | §5 |
| §5.AC.04 | No side effects on adapter ops | §5 |
| §5.AC.05 | format() is canonical payload serializer | §5 |
| §6.AC.01 | bare digit reads as 👤 in both adapters (policy active) | §6 |
| §6.AC.02 | explicit emoji unchanged regardless of policy | §6 |
| §6.AC.03 | bare-digit defaulting applies at every level 1-5 | §6 |
| §6.AC.04 | date capture identical with/without leading emoji | §6 |
| §6.AC.05 | policy inactive → bare digit returns null (today) | §6 |
| §6.AC.06 | toggling policy changes only the bare-digit case | §6 |
| §6.AC.07 | parse does not consult write-side reviewer/level ranges | §6 |
| §6.AC.08 | frontmatter coerces in-range YAML int under active policy | §6, Edge case 3 |

## Design Decisions

### Decision 1 — Adapter interface size: four operations, not three or five

**Decision:** The adapter exposes `matches`, `parse`, `format`, and `insert` — four operations.

**Alternatives considered:**
- **Three operations** (drop `format`; embed it inside `insert`). Rejected because callers need the annotation string in isolation for dry-run preview ({R013.§3.AC.04}) and for log output. Without `format`, callers would either parse `insert`'s output to recover the string or duplicate the formatting logic — both worse than exposing `format`.
- **Five operations** (add `remove(content): string`). Rejected for this spec — {R013}'s scope does not include a removal command. A future revision MAY add `remove` if a use case emerges; doing so is an additive change that preserves the existing four operations.

**Rationale:** Four operations is the minimum that lets callers parse, format, and round-trip. `matches` is necessary for registry dispatch. The shape is symmetrical: `matches` for dispatch, `parse` for read, `format` and `insert` for write.

### Decision 2 — Payload as a flat triple, not a discriminated union

**Decision:** `ConfidencePayload` is `{reviewer, level, date?}` — a flat record.

**Alternatives considered:**
- **Discriminated union by reviewer** (`{kind: 'ai', level} | {kind: 'human', level}`). Rejected because the level constraint (AI 1-3, Human 3-5) is a command-layer policy, not a payload invariant. Encoding it in the payload type would force adapters to reason about validation; per §5.AC.03, that responsibility belongs to the command layer.
- **Tagged with adapter id** (`{adapterId, reviewer, level, date}`). Rejected because it would couple the payload to the source adapter, breaking shape-agnosticism. A payload parsed by the frontmatter adapter MUST be insertable by the C-family adapter — that's the registry's whole point.

**Rationale:** A flat triple is the minimal shape that lets payloads cross adapter boundaries without translation. Validation, command-layer policy, and source-adapter tracking happen above the payload, not inside it.

### Decision 3 — `matches()` over registration-by-extension-list

**Decision:** Adapters expose a `matches(filePath)` method rather than a list of extensions consumed by the registry.

**Alternatives considered:**
- **Extension list** (`adapter.extensions = ['.ts', '.tsx', ...]`). Simpler API; rejected because future adapters may need path-based discrimination (e.g., a Markdoc adapter for `.md` files in a specific subtree, or a Python-test adapter for `**/test_*.py`). A method is strictly more expressive than a list.
- **Glob list** (`adapter.globs = ['**/*.ts', ...]`). More expressive than extensions but introduces glob-engine dependencies and per-call glob matching cost. Rejected — `matches` as a plain method lets adapters use whatever discrimination they need without imposing glob semantics on adapters that just want extension matching.

**Rationale:** A method is the most flexible shape and the cost (each adapter implements one short function) is negligible. The C-family adapter's `matches` is effectively a five-element extension check; the frontmatter adapter's is one. Future adapters with more complex dispatch needs are not constrained by the adapter contract.

### Decision 4 — Frontmatter adapter via `gray-matter`, not a custom YAML parser

**Decision:** The frontmatter adapter uses `gray-matter` for both parse and stringify.

**Alternatives considered:**
- **Custom YAML reader for the `confidence:` key only** (regex over the frontmatter block). Faster than full YAML parsing; rejected because it would diverge from the project's existing frontmatter handling in `note-file-manager.ts`. Two parsers for the same block invites consistency drift — a `confidence:` value the adapter would accept but `note-file-manager` would reject (or vice versa) is a real failure mode.
- **A different YAML library** (`yaml`, `js-yaml`). Rejected because `gray-matter` is already a project dependency and is the canonical frontmatter handler. Adding a second YAML library to the project for this single adapter is unjustified.

**Rationale:** `gray-matter` is the single source of truth for frontmatter handling in the project. Reusing it ensures the adapter's parse and write operations interoperate with the rest of the system's frontmatter handling without translation.

### Decision 5 — String-scalar payload, not structured-object frontmatter

**Decision:** The frontmatter adapter stores the payload as a string scalar (`confidence: "🤖2 2026-05-05"`).

**Alternatives considered:**
- **Structured object** (`confidence: {reviewer: 🤖, level: 2, date: 2026-05-05}`). More YAML-idiomatic, easier for users to read and edit by hand. Rejected because {R013} Non-Goals explicitly defers structured-object frontmatter and because string-scalar parity with the C-family adapter ("payload-equivalent across adapters") is a {R013} design principle. The structured form would require translation between adapters — exactly the asymmetry the registry is designed to avoid.

**Rationale:** Per {R013}'s "Adapters own file shape; tooling owns payload" principle, the payload's syntactic form is identical across shapes; only the embedding differs. String-scalar serves that constraint.

## Non-Goals / Out of Scope

This spec deliberately excludes:

- **Command-surface specifications.** {R013.§2} (`confidence audit` scope expansion), {R013.§3} (`confidence apply` bulk command), {R013.§4} (auto-insert on `scepter create`), and the existing `confidence mark` command are downstream consumers of the registry. Each will be specified separately or as part of a consolidated command-surface spec. This spec defines only the adapter and registry contract those consumers depend on.
- **Structured-object frontmatter shape.** Per {R013} Non-Goals, the frontmatter adapter stores the payload as a string scalar. A nested-object form (`confidence: {reviewer, level, date}`) is not specified here and would require a future Requirement.
- **Third-party adapter registration API.** The registry's extensibility hook is mentioned informatively in §2 but not specified. Adding a `register(adapter)` API is an additive change a future Requirement may motivate.
- **Source-file auto-insert at creation.** No `scepter create` equivalent exists for source files. The adapter contract is silent on creation-time wiring; {R013.§4} defines auto-insert for notes only.
- **Removal operation.** No `remove(content)` adapter operation is specified. The current scope is parse / format / insert (replace-or-add). Removing an annotation is a future operation if a command-layer use case emerges.
- **Caching or memoization.** The registry's lookup is specified as pure with no caching. If profiling reveals lookup is hot, a future revision MAY introduce caching, subject to preserving the purity contract in §2.AC.04.
- **Observability hooks.** Adapters do not emit events, log to a global channel, or expose metrics. Side-effect freedom (§5.AC.04) is part of the contract.
- **Migration of existing source files.** The C-family adapter's behavioral equivalence with the existing implementation (§3.AC.06) means no migration is needed for files already carrying `// @confidence` annotations. Notes that lack `confidence:` keys today acquire them through `confidence mark`/`apply` or auto-insert; no batch migration is specified here.

## References

- {R013.§1} — Source requirement: pluggable annotation adapters. §1.AC.01-05 are the upstream contracts this spec concretizes.
- {R017} — Implied-human read-time confidence defaulting. §6's emoji-optional parse grammar and the `parse` `defaultReviewer` parameter concretize {R017.AC.01-07}; the YAML-number coercion (§6.AC.08) realizes the {R017.AC.01} `confidence: 4` frontmatter case. Origin task {T006}.
- {R013.§2} — Audit scope expansion (downstream consumer; separate spec).
- {R013.§3} — Bulk apply (downstream consumer; separate spec).
- {R013.§4} — Auto-insert on note creation (downstream consumer; separate spec).
- {R004.§7.AC.01} — Original confidence audit contract; preserved by the C-family adapter via §3.AC.06.
- {R004.§7.AC.02} — Original confidence mark contract (format string, insert behavior); restated as the C-family adapter's format/insert contract via §3.AC.03 and §3.AC.04-05.
- {R005.§3} — Claim-level verification events (orthogonal subsystem; cited for context, not derived from).
- `core/src/claims/confidence.ts` — Existing implementation. The five exported functions (`parseConfidenceAnnotation`, `formatConfidenceAnnotation`, `insertConfidenceAnnotation`, `validateReviewerLevel`, `mapReviewerArg`) plus `auditConfidence` are the surface the C-family adapter wraps.
- `core/src/notes/note-file-manager.ts` — Existing `gray-matter` usage (see `updateFrontmatter`, lines 700-717). The frontmatter adapter MUST be consistent with this handler's parse/stringify behavior.
- `core/src/types/config.ts` — `ClaimConfig.confidence` schema; `sourceCodeIntegration.extensions` config consumed by the C-family adapter's `matches`.
