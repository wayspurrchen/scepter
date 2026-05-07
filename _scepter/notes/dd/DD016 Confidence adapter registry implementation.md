---
created: 2026-05-05T15:58:55.756Z
tags: [confidence, adapters, registry, frontmatter, detailed-design]
status: ready_for_review
---

# DD016 - Confidence adapter registry implementation

## Context

This DD concretizes {S003} — the adapter-registry contract that {R013.§1} introduces — into a file/symbol blueprint. The existing implementation lives in a single file `core/src/claims/confidence.ts` (305 lines, exports five functions plus `auditConfidence`). The DD splits that file into a small package under `core/src/claims/confidence/` with a typed `ConfidenceAdapter` interface, an ordered registry, and two built-in adapters (C-family comments, markdown frontmatter), and adds the `claims.confidence.includeDate` config flag introduced by {R013.§1.AC.06}.

Scope is the adapter layer only. The audit/mark/apply command surface and the auto-insert hook on `scepter create` are downstream consumers tracked separately under {S004}; this DD does not touch them. The C-family adapter changes one externally-observable behavior — the JSDoc-internal insert position per {S003.§3.AC.05} — and that single divergence is the only legacy-behavior break.

**Source spec:** {S003}.
**Source requirement:** {R013.§1}, in particular {R013.§1.AC.06}.
**Migration source:** `core/src/claims/confidence.ts` (entire file is removed; functions split per Module Inventory).

## Specification Scope

This DD covers:

- {S003.§1.AC.01-07} — The `ConfidenceAdapter` interface and its cross-cutting behavioral invariants.
- {S003.§2.AC.01-05} — The registry's ordered-list mechanics and `getAdapter(filePath)` lookup.
- {S003.§3.AC.01-06} — The C-family adapter (re-expression of existing behavior, plus the §3.AC.05 three-branch insert change).
- {S003.§4.AC.01-08} — The markdown-frontmatter adapter (new file shape).
- {S003.§5.AC.01-05} — Cross-cutting invariants (canonical IR, date round-trip, validation delegation, side-effect freedom).
- {R013.§1.AC.06} — The `claims.confidence.includeDate` config flag (type and validator additions only).

Explicitly out of scope (deferred to {S004}):

- `confidence audit` scope expansion to notes ({R013.§2}).
- `confidence apply` bulk command ({R013.§3}).
- `confidence mark` routing through the registry rather than direct imports.
- Auto-insert on `scepter create` ({R013.§4}).
- The standalone `auditConfidence` export migration target. The function moves to `core/src/claims/audit.ts` per {S004}'s DD; this DD removes it from `confidence.ts` but does NOT specify the new location's contents — only that the export must continue to be available somewhere consumers can import.
- Third-party adapter registration API (S003 §2 future-extension hook is informative only).

## Primitive Preconditions

| Primitive | Source Citation | Status |
|-----------|----------------|--------|
| `ConfidenceLevel`, `ReviewerIcon`, `ConfidenceAnnotation`, `ConfidenceAuditResult` types | `core/src/claims/confidence.ts:28-60` | PRESENT — moved to `confidence/types.ts` |
| `parseConfidenceAnnotation` | `core/src/claims/confidence.ts:94-122` | PRESENT — moved into C-family adapter `parse` |
| `formatConfidenceAnnotation` | `core/src/claims/confidence.ts:134-140` | PRESENT — moved into C-family adapter `format` |
| `insertConfidenceAnnotation` | `core/src/claims/confidence.ts:155-189` | PRESENT — replaced (semantics changed per {S003.§3.AC.05}) by C-family adapter `insert` |
| `validateReviewerLevel` | `core/src/claims/confidence.ts:199-213` | PRESENT — moved verbatim to `confidence/validation.ts` |
| `mapReviewerArg` | `core/src/claims/confidence.ts:218-227` | PRESENT — moved verbatim to `confidence/validation.ts` |
| `auditConfidence` | `core/src/claims/confidence.ts:267-304` | PRESENT — out of scope for this DD; relocation tracked by {S004}'s DD |
| `CONFIDENCE_REGEX` | `core/src/claims/confidence.ts:81` | PRESENT — moved into C-family adapter (private) |
| `gray-matter` library | `package.json:56` (`"gray-matter": "^4.0.3"`) | PRESENT — already a dependency |
| `gray-matter` usage precedent | `core/src/notes/note-file-manager.ts:8` (import), `:222`, `:701` (parse + stringify) | PRESENT — frontmatter adapter follows the same pattern |
| `ClaimConfig.confidence` interface | `core/src/types/config.ts:222-241` (with `autoInsert?: boolean`) | PRESENT — extended with `includeDate?: boolean` |
| `claims.confidence.autoInsert` Zod validator | `core/src/config/config-validator.ts:319-325` | PRESENT — extended with `includeDate` parallel field |
| `SourceCodeIntegrationConfig` (consumed for extension list) | `core/src/types/config.ts:116-123` | PRESENT — referenced by C-family `matches`; see Decision 1 |
| `core/src/claims/__tests__/confidence.test.ts` | `core/src/claims/__tests__/confidence.test.ts` | PRESENT — tests re-homed; one set updated for §3.AC.05 behavior change |
| `mark-command.ts` import surface | `core/src/cli/commands/confidence/mark-command.ts:15-21` | PRESENT — barrel re-exports preserve `mapReviewerArg`, `validateReviewerLevel`, `formatConfidenceAnnotation`, `insertConfidenceAnnotation`. Routing through the registry is {S004}'s concern; this DD's barrel keeps mark-command compiling unchanged. |
| `audit-command.ts` import surface | `core/src/cli/commands/confidence/audit-command.ts:13` | PRESENT — `auditConfidence` import preserved by barrel re-export until {S004}'s DD relocates it. |

No ABSENT primitives. The DD is self-contained within the existing project structure.

## Current State

`core/src/claims/confidence.ts` is the entire current implementation (305 lines):

- Three types (`ConfidenceLevel`, `ReviewerIcon`, `ConfidenceAnnotation`) and one result type (`ConfidenceAuditResult`).
- One regex constant (`CONFIDENCE_REGEX`) used by both `parseConfidenceAnnotation` and `insertConfidenceAnnotation`.
- Five exported functions: `parseConfidenceAnnotation`, `formatConfidenceAnnotation`, `insertConfidenceAnnotation`, `validateReviewerLevel`, `mapReviewerArg`.
- One async `auditConfidence` that consumes `SourceCodeIntegrationConfig` and aggregates results via `discoverSourceFiles`.

Two consumers import from this file:

- `core/src/cli/commands/confidence/mark-command.ts` imports `mapReviewerArg`, `validateReviewerLevel`, `formatConfidenceAnnotation`, `insertConfidenceAnnotation`, and the `ConfidenceLevel` type.
- `core/src/cli/commands/confidence/audit-command.ts` imports `auditConfidence`.

`core/src/types/config.ts:237-240` declares `claims.confidence.autoInsert` (default `true`). `core/src/config/config-validator.ts:319-325` validates it. Neither field is wired to anything yet — the autoInsert flag is unrealized per {R013}'s problem statement, and `includeDate` does not exist.

`core/src/notes/note-file-manager.ts` already imports `gray-matter` (line 8) and uses `matter()` for parse and `matter.stringify()` for write at lines 222 and 701-716. The frontmatter adapter must produce output consistent with this handler's behavior.

The existing test suite at `core/src/claims/__tests__/confidence.test.ts` validates parse, format, insert, validate, and reviewer-mapping behavior via the five exported function names. Insert tests at lines 215-229 codify the legacy "insert AFTER `*/`" behavior — those tests are the primary backward-compat-breaking cases per {S003.§3.AC.05}.

## Module Inventory

The new package is `core/src/claims/confidence/`. The existing `core/src/claims/confidence.ts` is removed; consumers import from `core/src/claims/confidence/index.ts` (the barrel) which preserves the legacy export surface for backward-compat with `mark-command.ts` and any external callers. `auditConfidence` remains importable from the same barrel during this DD's scope; {S004}'s DD relocates it.

| File | Responsibility | Source | Derives |
|---|---|---|---|
| `core/src/claims/confidence/types.ts` | Type definitions: `ConfidenceLevel`, `ReviewerIcon`, `ConfidencePayload`, `ConfidenceAnnotation` | NEW (extracted from `confidence.ts:28-47`) | {S003.§1.AC.01}, {S003.§1.AC.02} |
| `core/src/claims/confidence/adapter.ts` | The `ConfidenceAdapter` interface | NEW | {S003.§1.AC.01}, {S003.§5.AC.04} |
| `core/src/claims/confidence/registry.ts` | Ordered adapter list + `getAdapter(filePath)` | NEW | {S003.§2.AC.01-05} |
| `core/src/claims/confidence/adapters/c-family.ts` | C-family-comments adapter (`.ts`/`.tsx`/`.js`/`.jsx`/`.css`); wraps existing parse regex; new three-branch insert logic | EXTEND of `confidence.ts:81, 94-122, 134-140, 155-189` (insert semantics changed per §3.AC.05) | {S003.§3.AC.01-06} |
| `core/src/claims/confidence/adapters/markdown-frontmatter.ts` | Markdown frontmatter adapter (`.md`); reads/writes `confidence:` scalar via `gray-matter` | NEW | {S003.§4.AC.01-08} |
| `core/src/claims/confidence/validation.ts` | `validateReviewerLevel`, `mapReviewerArg`, `REVIEWER_LEVEL_RANGES`, `VALID_LEVELS` | EXTEND of `confidence.ts:67-73, 199-227` (verbatim move) | {S003.§5.AC.03} |
| `core/src/claims/confidence/index.ts` | Barrel re-export: types + adapter interface + `getAdapter` + validation helpers + legacy-compat function names | NEW | {S003.§1.AC.01}, {S003.§5.AC.05} |
| `core/src/claims/confidence.ts` | DELETE | EXISTING | — |
| `core/src/types/config.ts` | EXTEND `ClaimConfig.confidence` with `includeDate?: boolean` | EXISTING `:222-241` | {R013.§1.AC.06} |
| `core/src/config/config-validator.ts` | EXTEND the inline `claims.confidence` Zod object with `includeDate: z.boolean().optional().default(true)` | EXISTING `:319-325` | {R013.§1.AC.06} |
| `core/src/claims/__tests__/confidence.test.ts` | DELETE — replaced by per-module test files (see §9) | EXISTING | — |
| `core/src/claims/confidence/__tests__/c-family.test.ts` | C-family adapter tests; legacy parse/format/replace cases preserved; insert tests updated for §3.AC.05 | NEW (most cases moved from existing test file) | {S003.§3.AC.01-06} |
| `core/src/claims/confidence/__tests__/markdown-frontmatter.test.ts` | New adapter tests covering parse/format/insert + the three frontmatter cases + idempotence | NEW | {S003.§4.AC.01-08} |
| `core/src/claims/confidence/__tests__/registry.test.ts` | Registry order + `getAdapter` lookup + null outcomes | NEW | {S003.§2.AC.01-05} |
| `core/src/claims/confidence/__tests__/validation.test.ts` | `validateReviewerLevel`, `mapReviewerArg` (verbatim from existing) | NEW (moved from existing test file) | {S003.§5.AC.03} |

`auditConfidence` is preserved for re-export from the barrel as a transitional measure: this DD does not move its body. {S004}'s DD will relocate `auditConfidence` and its `discoverSourceFiles` helper to `core/src/claims/audit.ts` and update the barrel. Consumers (`audit-command.ts`) continue to import from `../../../claims/confidence/index.js` until that DD ships.

## §1 Module structure

DC.01:5:derives=S003.§1.AC.01 The directory `core/src/claims/confidence/` MUST exist with the file layout in the Module Inventory above. The package replaces `core/src/claims/confidence.ts` as the single source of truth for confidence-annotation behavior; no consumer of the old file path retains a reference.

DC.02:derives=S003.§1.AC.01 Each adapter implementation MUST live in its own file under `core/src/claims/confidence/adapters/` and MUST export a single named adapter object (not a class) — `cFamilyAdapter` and `markdownFrontmatterAdapter`. Each adapter object MUST satisfy the `ConfidenceAdapter` interface from `adapter.ts`.

DC.03:derives=S003.§2.AC.01 `registry.ts` MUST own the ordered `adapters` array and the `getAdapter(filePath)` lookup. It MUST NOT export the array itself; only `getAdapter` is part of the public API. The order MUST be set at module-load time, not lazily.

DC.04:derives=S003.§5.AC.03 `validation.ts` MUST be the single home for the reviewer-level rule (`validateReviewerLevel`) and the CLI argument mapper (`mapReviewerArg`). Adapters MUST NOT import from `validation.ts` — the rule is enforced exclusively by command-layer callers.

DC.05:4:derives=S003.§3.AC.06 `core/src/claims/confidence.ts` MUST be deleted. All consumers (`mark-command.ts`, `audit-command.ts`, tests) MUST import from `../../../claims/confidence/index.js` (the barrel). No content from the deleted file may remain at the old path.

DC.06:derives=S003.§1.AC.01 `index.ts` MUST re-export at minimum: `ConfidenceLevel`, `ReviewerIcon`, `ConfidencePayload`, `ConfidenceAnnotation`, `ConfidenceAdapter`, `getAdapter`, `validateReviewerLevel`, `mapReviewerArg`. For backward-compatibility it MUST also re-export thin wrappers that preserve the pre-existing names `parseConfidenceAnnotation`, `formatConfidenceAnnotation`, `insertConfidenceAnnotation` by routing to the C-family adapter directly (callers passing a non-source-file path receive C-family behavior — this is acceptable because pre-existing callers passed only source files). It MUST also re-export `auditConfidence` from `confidence.ts`'s pre-deletion location pending {S004}'s relocation.

DC.07:4 No code outside `core/src/claims/confidence/adapters/` may import from `gray-matter` for confidence-annotation purposes. The adapter interface mediates all shape-specific reads and writes — direct frontmatter manipulation outside the adapter would defeat the registry's dispatch contract.

## §2 Type definitions (`types.ts`)

The four types in `types.ts` carry the data contract:

```typescript
/**
 * Numeric confidence level 1-5.
 * @implements {S003.§1.AC.02}
 */
export type ConfidenceLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Reviewer icon: AI-generated or human-reviewed.
 * @implements {S003.§1.AC.02}
 */
export type ReviewerIcon = '🤖' | '👤';

/**
 * Canonical in-memory representation of a confidence annotation.
 * Decoupled from any string format. Adapter `parse()` produces this
 * (wrapped in ConfidenceAnnotation); adapter `insert()` consumes it.
 *
 * @implements {S003.§1.AC.02}
 * @implements {S003.§5.AC.01}
 */
export interface ConfidencePayload {
  reviewer: ReviewerIcon;
  level: ConfidenceLevel;
  /**
   * ISO YYYY-MM-DD. Optional for parse paths reading legacy or hand-edited
   * annotations and for insert paths where claims.confidence.includeDate
   * is false (per R013.§1.AC.06).
   */
  date?: string;
}

/**
 * Parsed confidence annotation including location metadata. Returned by
 * adapter.parse(). Extends ConfidencePayload with line/filePath.
 *
 * @implements {S003.§1.AC.01}
 */
export interface ConfidenceAnnotation extends ConfidencePayload {
  line: number;
  filePath: string;
}
```

The `ConfidenceAuditResult` type (legacy, from `confidence.ts:53-60`) MUST NOT be moved to `types.ts`. It belongs to the audit subsystem and travels with `auditConfidence` to wherever {S004}'s DD relocates it. Keeping it out of `types.ts` keeps the adapter package cohesive around the four payload-and-annotation types.

DC.08:5:derives=S003.§1.AC.02 `ConfidencePayload` MUST be the canonical in-memory IR. Adapters MUST consume `ConfidencePayload` on `insert` and MUST produce a `ConfidenceAnnotation` (which extends `ConfidencePayload`) on `parse`. No adapter-specific payload subtype may be introduced.

DC.09:derives=S003.§1.AC.02 The legacy `ConfidenceAnnotation` shape (`level`, `reviewer`, `date`, `line`, `filePath` — five flat fields per `confidence.ts:41-47`) is preserved field-by-field by the new shape. No field is added; no field is removed; the `ConfidencePayload`/`ConfidenceAnnotation` split is internal restructuring. Existing test field accesses (`result!.level`, `result!.reviewer`, `result!.date`, `result!.line`, `result!.filePath`) MUST continue to work.

DC.10:derives=S003.§5.AC.01 Sub-letter handling: the existing implementation has none (the legacy regex captures a single digit, not a sub-letter); the new types add none. Future sub-letter support would be a new field on `ConfidencePayload` and a separate DD.

## §3 Adapter interface (`adapter.ts`)

```typescript
import type {
  ConfidenceAnnotation,
  ConfidencePayload,
  ConfidenceLevel,
  ReviewerIcon,
} from './types.js';

/**
 * The shape-specific adapter contract. Every shape that carries
 * confidence annotations is represented by exactly one adapter.
 * Operations are pure functions over content strings — no I/O.
 *
 * @implements {S003.§1.AC.01}
 * @implements {S003.§5.AC.04}
 */
export interface ConfidenceAdapter {
  /** Stable identifier for diagnostics and logs. */
  readonly id: string;

  /**
   * Returns true if this adapter handles the given file path.
   * Pure function of path/extension. No I/O.
   * @implements {S003.§1.AC.03}
   */
  matches(filePath: string): boolean;

  /**
   * Parse a confidence annotation out of file content. Returns null
   * when the content carries no recognized annotation. Never throws.
   * @implements {S003.§1.AC.04}
   */
  parse(content: string, filePath: string): ConfidenceAnnotation | null;

  /**
   * Render a payload as the adapter's annotation string. When date is
   * undefined (per R013.§1.AC.06's includeDate=false path), the adapter
   * MUST omit the trailing space and date.
   * @implements {S003.§5.AC.05}
   */
  format(reviewer: ReviewerIcon, level: ConfidenceLevel, date?: string): string;

  /**
   * Insert or replace a confidence annotation in file content.
   * Returns the new content. Pure: no FS writes.
   * @implements {S003.§1.AC.05}
   * @implements {S003.§1.AC.06}
   * @implements {S003.§1.AC.07}
   */
  insert(content: string, payload: ConfidencePayload): string;
}
```

DC.11:5:derives=S003.§1.AC.01 The interface MUST be exactly five members: `id`, `matches`, `parse`, `format`, `insert`. No more, no fewer. (`{S003.§1}` settled on four operations plus the diagnostic `id`; future operations like `remove` are explicit non-goals.)

DC.12:derives=S003.§5.AC.04 The interface signature MUST NOT include async return types. All operations are synchronous string transformations; FS I/O is the caller's responsibility. This is a typed constraint — the interface uses `boolean`, `ConfidenceAnnotation | null`, and `string` returns, never `Promise<…>`.

DC.13:derives=S003.§1.AC.06 `format`'s `date` parameter MUST be optional (`date?: string`). When called with `date === undefined`, every adapter's `format` MUST produce its no-date variant per the adapter-specific rules in §5 and §6. This is the type-level expression of {R013.§1.AC.06}'s `includeDate=false` path.

## §4 Registry (`registry.ts`)

```typescript
import type { ConfidenceAdapter } from './adapter.js';
import { markdownFrontmatterAdapter } from './adapters/markdown-frontmatter.js';
import { cFamilyAdapter } from './adapters/c-family.js';

/**
 * Ordered registry of built-in confidence adapters. Order is "most-
 * specific-first" — narrower matchers register before broader ones.
 *
 * @implements {S003.§2.AC.01}
 * @implements {S003.§2.AC.02}
 */
const adapters: readonly ConfidenceAdapter[] = [
  markdownFrontmatterAdapter,
  cFamilyAdapter,
];

/**
 * Look up the adapter registered for a given file path. Returns the
 * first adapter whose matches() returns true, or null if none match.
 *
 * @implements {S003.§2.AC.03}
 * @implements {S003.§2.AC.04}
 */
export function getAdapter(filePath: string): ConfidenceAdapter | null {
  for (const adapter of adapters) {
    if (adapter.matches(filePath)) return adapter;
  }
  return null;
}
```

DC.14:5:derives=S003.§2.AC.01 The `adapters` array MUST be declared `readonly` and MUST NOT be exported. Only `getAdapter` is part of the public surface. (Locking the array prevents external mutation; non-export prevents callers from depending on registration shape.)

DC.15:derives=S003.§2.AC.02 The registration order MUST be `[markdownFrontmatterAdapter, cFamilyAdapter]` literally — set by array-literal position, not by any registration function or sort step. {S003.§2.AC.02}'s "MUST be preserved without depending on object-key insertion behavior" is honored because the data structure is an array, not an object.

DC.16:derives=S003.§2.AC.03 `getAdapter` MUST iterate the array in declaration order, return the first match, and return `null` if no match is found. It MUST NOT throw on any string input — empty string, paths to non-existent files, paths with unusual extensions all yield `null`.

DC.17:derives=S003.§2.AC.04 `getAdapter` MUST be a pure function of the file path. No caching, no memoization, no global state mutation. Two calls with the same path argument MUST return the same adapter instance — guaranteed by the immutable `adapters` array.

DC.18 Future-extension hook (informative): the registry's array structure MAY be augmented in a future revision with a `register(adapter)` API per {S003.§2}'s informative future-extension note. This DD does not implement that hook; the constant array is sufficient for the built-in adapters.

## §5 C-family adapter (`adapters/c-family.ts`)

The C-family adapter is the largest module in this DD. It wraps the existing parse regex and format string verbatim and introduces the new three-branch insert logic per {S003.§3.AC.05}.

### Constants and helpers

```typescript
import type {
  ConfidenceAdapter,
} from '../adapter.js';
import type {
  ConfidenceAnnotation,
  ConfidencePayload,
  ConfidenceLevel,
  ReviewerIcon,
} from '../types.js';

const VALID_LEVELS: readonly ConfidenceLevel[] = [1, 2, 3, 4, 5] as const;

/**
 * Hardcoded extensions the C-family adapter handles. Per Decision 1,
 * this is the project's default sourceCodeIntegration.extensions set.
 * Config-driven extension matching is deferred.
 */
const C_FAMILY_EXTENSIONS: readonly string[] = [
  '.ts', '.tsx', '.js', '.jsx', '.css',
] as const;

/**
 * Regex matching @confidence annotations in both line comments and
 * doc blocks. Verbatim from the legacy implementation
 * (confidence.ts:81). Carrier prefix is `//` or `*`.
 */
const CONFIDENCE_REGEX = /(?:\/\/|\*)\s*@confidence\s+(🤖|👤)(\d)(?:\s+(.+))?/;

const SCAN_LIMIT = 20;
```

### `matches`

```typescript
function matches(filePath: string): boolean {
  return C_FAMILY_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}
```

DC.19:derives=S003.§3.AC.01 `matches` MUST return `true` if and only if the file path's extension (suffix match) is one of `.ts`, `.tsx`, `.js`, `.jsx`, `.css`. The adapter MUST NOT consult the project's `sourceCodeIntegration.extensions` config for this initial implementation (per Decision 1); a follow-up may resolve via config. Path comparison is case-sensitive (consistent with existing source code convention).

### `parse`

```typescript
function parse(
  content: string,
  filePath: string,
): ConfidenceAnnotation | null {
  if (content === '') return null;
  const lines = content.split('\n');
  const scanLimit = Math.min(lines.length, SCAN_LIMIT);

  for (let i = 0; i < scanLimit; i++) {
    const match = lines[i].match(CONFIDENCE_REGEX);
    if (!match) continue;

    const reviewer = match[1] as ReviewerIcon;
    const level = parseInt(match[2], 10);
    if (!VALID_LEVELS.includes(level as ConfidenceLevel)) continue;

    return {
      level: level as ConfidenceLevel,
      reviewer,
      date: match[3]?.trim(),
      line: i + 1,
      filePath,
    };
  }

  return null;
}
```

DC.20:derives=S003.§3.AC.02 `parse` MUST scan only the first 20 lines (matching the legacy 20-line bound). It MUST use `CONFIDENCE_REGEX` verbatim from the legacy implementation. The matched `(\d)` capture MUST be filtered against `VALID_LEVELS = [1,2,3,4,5]`; out-of-range digits cause continued scanning, not an early return. The trailing capture group, when present, becomes `payload.date` after `.trim()`; when absent or empty, `date` is `undefined`.

DC.21:derives=S003.§3.AC.06 `parse`'s output MUST be byte-identical to the legacy `parseConfidenceAnnotation` for any input. Specifically: legacy after-`*/` placements (e.g., `// @confidence …` on the line immediately following a JSDoc closer) MUST continue to parse identically — the regex matches the line regardless of carrier choice (`//` or `*`), and the 20-line scan covers it. This is the backward-compatibility guarantee for files written by the pre-{R013} `insertConfidenceAnnotation`.

### `format`

```typescript
function format(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
  date?: string,
): string {
  if (date === undefined) {
    return `// @confidence ${reviewer}${level}`;
  }
  return `// @confidence ${reviewer}${level} ${date}`;
}
```

DC.22:derives=S003.§3.AC.03 `format` MUST produce `// @confidence <reviewer><level> <date>` when `date` is defined. There MUST be a single space between `@confidence` and the reviewer emoji, NO space between the emoji and the level digit, and a single space between the digit and the date. When `date === undefined`, `format` MUST produce `// @confidence <reviewer><level>` with no trailing space — per {R013.§1.AC.06}'s `includeDate=false` path. `format` MUST NOT produce the JSDoc-internal carrier ` * @confidence …`; that form is constructed by `insert` per §5.AC.05(a).

### `insert` — three-branch logic per {S003.§3.AC.05}

The behavioral change vs. the legacy implementation is concentrated here. Pseudocode:

```
insert(content, payload):
  1. If content is empty:
       return format(payload) (no trailing newline)
  2. lines := content.split('\n')
  3. scanLimit := min(lines.length, 20)
  4. existing := find first index i ∈ [0, scanLimit) where CONFIDENCE_REGEX matches lines[i]
  5. If existing found:
       carrier := detectCarrier(lines[existing])     // 'jsdoc' | 'line-comment'
       if carrier === 'jsdoc':
         indent := the leading `<whitespace>* ` prefix from lines[existing] (or from
                   the asterisk-bearing line above if existing line has no asterisk —
                   in practice the matched line itself has the asterisk because
                   CONFIDENCE_REGEX requires `//` or `*`)
         lines[existing] := indent + '@confidence ' + payloadString(payload)
       else: // 'line-comment'
         lines[existing] := format(payload)
       return lines.join('\n')
  6. (No existing annotation — choose carrier per §3.AC.05 priority order.)

     6a. JSDoc carrier (preferred):
         openIdx := first i ∈ [0, scanLimit) where lines[i] contains '/**'
         If openIdx >= 0:
           closeIdx := first j ∈ (openIdx, scanLimit) where lines[j] contains '*/'
           If closeIdx >= 0:
             indent := leading-asterisk-indent of lines[closeIdx - 1]
                       (e.g., ' * ' from ' * Module description'). If the
                       previous line lacks a ` * ` prefix, fall back to ' * '.
             newLine := indent + '@confidence ' + payloadString(payload)
             insert newLine BEFORE lines[closeIdx]
             return lines.join('\n')

     6b. Line-comment-stack carrier:
         If lines[0].trimStart().startsWith('//'):
           stackEnd := largest k such that for all i ∈ [0, k], lines[i].trimStart().startsWith('//')
           insert format(payload) AT position stackEnd + 1 (i.e., after the last `//` line)
           return lines.join('\n')

     6c. New line-comment carrier (fallback):
         insert format(payload) AT position 0 (becomes the new first line)
         return lines.join('\n')
```

Where `payloadString(payload)` is `${payload.reviewer}${payload.level}` plus `' ' + payload.date` if `payload.date` is defined, else nothing.

DC.23:5:derives=S003.§3.AC.05 `insert`'s no-existing-annotation branching MUST follow the priority order `(a) JSDoc → (b) line-comment-stack → (c) new line-comment`, evaluated top-to-bottom and short-circuited on first match. Carriers are mutually exclusive — once a branch is selected, the others MUST NOT be consulted.

DC.24:5:derives=S003.§3.AC.05 In branch (a), the new ` * @confidence …` line MUST be inserted BEFORE the `*/` closing line — never after. The asterisk indent MUST be read from the line immediately above the `*/` (typically ` * `) so the inserted line aligns with the existing JSDoc body. If the line above has no leading-asterisk shape (degenerate JSDoc), fall back to `' * '` as the indent. This is the corrective divergence from the legacy implementation per {S003.§3.AC.06}.

DC.25:derives=S003.§3.AC.05 In branch (b), the line-comment stack MUST be detected by the contiguity rule: a line is part of the stack iff `line.trimStart().startsWith('//')`. The stack starts at line 0 and ends at the last index where the rule holds. The new `// @confidence …` line MUST be appended at the end of the stack — i.e., inserted at `stackEnd + 1` so it precedes the first non-`//` line.

DC.26:derives=S003.§3.AC.05 In branch (c), the new `// @confidence …` line MUST be inserted at index 0 — becoming the file's first line. The original line 0 (and all subsequent content) MUST shift down by one.

### `insert` — replacement (existing annotation found)

DC.27:4:derives=S003.§3.AC.04 When `parse`'s scan finds an existing annotation, `insert` MUST replace the entire matched line in-place with an annotation in the SAME carrier form: a `// @confidence …` line is replaced with another `// @confidence …` line; a ` * @confidence …` JSDoc-internal line is replaced with another ` * @confidence …` line. The original asterisk indentation MUST be preserved by reading the leading whitespace + `*` characters from the matched line itself (since the regex requires a `*` or `//` prefix, the matched line carries the carrier marker directly). Line index and surrounding lines MUST be unchanged.

### Helper: `detectCarrier`

```typescript
type Carrier = 'jsdoc' | 'line-comment';

function detectCarrier(line: string): Carrier {
  // Match the carrier portion: //... or *... (with optional leading whitespace
  // for JSDoc lines)
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//')) return 'line-comment';
  return 'jsdoc'; // CONFIDENCE_REGEX guarantees one of the two
}
```

DC.28:derives=S003.§3.AC.04 `detectCarrier(line)` MUST return `'line-comment'` when the line's first non-whitespace characters are `//`, and `'jsdoc'` otherwise. (Otherwise = the only other shape the regex matches, namely `*` with optional leading whitespace.) The function is private to `c-family.ts`.

### Adapter export

```typescript
export const cFamilyAdapter: ConfidenceAdapter = {
  id: 'c-family-comments',
  matches,
  parse,
  format,
  insert,
};
```

DC.29 The exported `cFamilyAdapter`'s `id` MUST be the string literal `'c-family-comments'` per the diagnostic-naming convention from {S003.§1}'s data-model sketch.

## §6 Markdown-frontmatter adapter (`adapters/markdown-frontmatter.ts`)

The frontmatter adapter is new code; no legacy migration source. It uses `gray-matter` consistent with `core/src/notes/note-file-manager.ts:8, 222, 701-716`.

### `matches`

```typescript
import matter from 'gray-matter';
import type { ConfidenceAdapter } from '../adapter.js';
import type {
  ConfidenceAnnotation,
  ConfidencePayload,
  ConfidenceLevel,
  ReviewerIcon,
} from '../types.js';

/**
 * Anchored payload regex — verifies a frontmatter `confidence:` value
 * matches `<emoji><level>(\s<date>)?` exactly. Distinct from the
 * C-family CONFIDENCE_REGEX because the YAML scalar carries no `//`
 * or `*` prefix.
 */
const FRONTMATTER_PAYLOAD_REGEX = /^(🤖|👤)(\d)(?:\s+(\S+))?$/;

const VALID_LEVELS: readonly ConfidenceLevel[] = [1, 2, 3, 4, 5] as const;

function matches(filePath: string): boolean {
  return /\.md$/i.test(filePath);
}
```

DC.30:derives=S003.§4.AC.01 `matches` MUST return `true` if and only if the file path ends in `.md` (case-insensitive). Other markdown extensions (`.markdown`, `.mdown`, `.mkd`) MUST NOT match — future adapter variants may register for them per {S003.§4.AC.01}.

### `parse`

```typescript
function parse(
  content: string,
  filePath: string,
): ConfidenceAnnotation | null {
  if (content === '') return null;

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    // Malformed frontmatter — per Edge Case 2, parse returns null,
    // suppressing the underlying error.
    return null;
  }

  const value = parsed.data?.confidence;
  if (typeof value !== 'string') return null;

  const m = value.match(FRONTMATTER_PAYLOAD_REGEX);
  if (!m) return null;

  const level = parseInt(m[2], 10);
  if (!VALID_LEVELS.includes(level as ConfidenceLevel)) return null;

  const reviewer = m[1] as ReviewerIcon;
  const date = m[3];

  return {
    reviewer,
    level: level as ConfidenceLevel,
    date,
    line: locateConfidenceKeyLine(content),
    filePath,
  };
}
```

DC.31:derives=S003.§4.AC.02 `parse` MUST invoke `gray-matter`'s `matter(content)` to extract frontmatter. If `data.confidence` is not a string, return `null`. If the string does not match `FRONTMATTER_PAYLOAD_REGEX` (anchored, optional trailing date with no internal whitespace), return `null`. If the level digit is outside `[1..5]`, return `null`. The adapter MUST NOT throw for malformed frontmatter — `gray-matter` errors are caught and converted to a `null` return.

DC.32:derives=S003.§4.AC.03 The returned `ConfidenceAnnotation`'s `line` field MUST be the 1-indexed line number of the `confidence:` key within the file's frontmatter block. If the key cannot be located (e.g., `gray-matter` parsed it from a non-standard frontmatter shape), `line` MUST be `0`. Implementation: see `locateConfidenceKeyLine` below.

### Helper: `locateConfidenceKeyLine`

```typescript
/**
 * Find the 1-indexed line number of the `confidence:` key within the
 * leading frontmatter block. Scans only the lines between the opening
 * and closing `---` markers. Returns 0 if the key is not located.
 */
function locateConfidenceKeyLine(content: string): number {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return 0;

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '---') return 0; // closed without finding key
    if (/^confidence\s*:/.test(trimmed)) return i + 1;
  }
  return 0;
}
```

DC.33:derives=S003.§4.AC.03 `locateConfidenceKeyLine` MUST search only the leading frontmatter block (lines between the first `---` on line 1 and the next `---`). It MUST match `/^confidence\s*:/` after trimming whitespace from the line. It MUST NOT consider `confidence:` keys appearing in YAML nested under other keys (a simple top-level scan is sufficient for the project's flat frontmatter convention). When the key is not found, return `0` so callers can distinguish "located" from "not located."

### `format`

```typescript
function format(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
  date?: string,
): string {
  if (date === undefined) {
    return `${reviewer}${level}`;
  }
  return `${reviewer}${level} ${date}`;
}
```

DC.34:derives=S003.§4.AC.04 `format` MUST produce the bare payload string `<reviewer><level> <date>` when `date` is defined (e.g., `"🤖2 2026-05-05"`) — no surrounding YAML quotes, no `confidence:` prefix, no leading or trailing whitespace. When `date === undefined`, `format` MUST produce `<reviewer><level>` with no trailing space (per {R013.§1.AC.06} parallel to §5's C-family rule). YAML quoting decisions belong to `gray-matter.stringify`; the adapter MUST NOT pre-quote.

### `insert`

```typescript
function insert(content: string, payload: ConfidencePayload): string {
  const valueString = format(payload.reviewer, payload.level, payload.date);

  // Three cases:
  //   (1) No frontmatter at all
  //   (2) Frontmatter exists, no confidence key
  //   (3) Frontmatter exists, confidence key present (replace)
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch (err) {
    // Per Edge Case 2: parse returns null on malformed frontmatter, but
    // insert MAY propagate the error since the caller is acting deliberately.
    throw err;
  }

  // Detect whether content actually had a leading frontmatter block. The
  // gray-matter parser populates `data` to {} for both "no frontmatter" and
  // "empty frontmatter" cases; check the raw content for the leading `---`
  // sentinel.
  const hadFrontmatter = /^---\r?\n/.test(content);

  // Set the confidence key. gray-matter mutates parsed.data freely; this
  // covers cases (2) and (3) uniformly.
  parsed.data.confidence = valueString;

  if (!hadFrontmatter) {
    // Case (1): create a frontmatter block. matter.stringify produces a
    // file with a leading `---` block followed by the body.
    return matter.stringify(parsed.content, parsed.data);
  }

  // Cases (2) and (3): re-stringify the existing block.
  return matter.stringify(parsed.content, parsed.data);
}
```

DC.35:derives=S003.§4.AC.05 When `content` has no leading frontmatter block, `insert` MUST create a new frontmatter block at the top of the file containing the `confidence:` key with the formatted payload as its value, followed by the original body. The output MUST be parseable by `gray-matter` such that subsequent `parse` returns the inserted payload (the round-trip invariant {S003.§1.AC.05}).

DC.36:derives=S003.§4.AC.06 When `content` has a leading frontmatter block without a `confidence:` key, `insert` MUST add the key inside the existing block via `matter.stringify`, preserving every other key's value. Key ordering and YAML comment preservation follow `gray-matter`'s behavior (Decision 2); the adapter MUST NOT pre-process or post-process the frontmatter to enforce specific ordering.

DC.37:derives=S003.§4.AC.07 When `content` has a leading frontmatter block with an existing `confidence:` key, `insert` MUST replace only that key's value, preserving all other keys byte-identically through `gray-matter`'s `stringify` (subject to known limitations on comment and ordering preservation).

DC.38:derives=S003.§4.AC.08 Idempotence: applying `insert(content, payload)` twice in succession MUST yield content byte-identical to a single application, modulo a single trailing newline that `gray-matter.stringify` MAY add or normalize. The adapter MUST NOT attempt to strip or normalize that trailing newline (Decision 2). Tests asserting idempotence MUST tolerate the difference.

DC.39:derives=S003.§4.AC.05 The leading-frontmatter detection MUST use the regex `/^---\r?\n/` against the raw `content` — `gray-matter`'s parsed `data` is `{}` both for "no frontmatter" and "empty frontmatter," so the parser-output alone cannot distinguish the create case. The raw-content sentinel check is the discriminator.

### Adapter export

```typescript
export const markdownFrontmatterAdapter: ConfidenceAdapter = {
  id: 'markdown-frontmatter',
  matches,
  parse,
  format,
  insert,
};
```

DC.40 The exported `markdownFrontmatterAdapter`'s `id` MUST be the string literal `'markdown-frontmatter'` per the diagnostic-naming convention.

## §7 Validation (`validation.ts`)

Verbatim move of `validateReviewerLevel` and `mapReviewerArg` (and their supporting constants) from `core/src/claims/confidence.ts:67-73, 199-227`. No behavior change. No imports from adapter modules — this file is leaf-of-the-tree.

```typescript
import type { ConfidenceLevel, ReviewerIcon } from './types.js';

const VALID_LEVELS: readonly ConfidenceLevel[] = [1, 2, 3, 4, 5] as const;

const REVIEWER_LEVEL_RANGES: Record<ReviewerIcon, readonly ConfidenceLevel[]> = {
  '🤖': [1, 2, 3],
  '👤': [3, 4, 5],
};

/**
 * Validate that a level is within the allowed range for a reviewer icon.
 * AI (🤖) can assign levels 1-3, Human (👤) can assign levels 3-5.
 *
 * @implements {S003.§5.AC.03}
 */
export function validateReviewerLevel(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
): { valid: boolean; message?: string } {
  const allowed = REVIEWER_LEVEL_RANGES[reviewer];
  if (!allowed.includes(level)) {
    const range = `${allowed[0]}-${allowed[allowed.length - 1]}`;
    const label = reviewer === '🤖' ? 'AI (🤖)' : 'Human (👤)';
    return {
      valid: false,
      message: `${label} can only assign levels ${range}, got ${level}`,
    };
  }
  return { valid: true };
}

/**
 * Map CLI positional argument to reviewer icon.
 *
 * @implements {S003.§5.AC.03}
 */
export function mapReviewerArg(arg: string): ReviewerIcon | null {
  switch (arg.toLowerCase()) {
    case 'ai':
      return '🤖';
    case 'human':
      return '👤';
    default:
      return null;
  }
}
```

DC.41:derives=S003.§5.AC.03 `validation.ts` MUST export `validateReviewerLevel` and `mapReviewerArg` with body and signature byte-identical to the legacy implementation (`confidence.ts:199-227`). The internal constants `VALID_LEVELS` and `REVIEWER_LEVEL_RANGES` MUST be preserved verbatim. No adapter imports `validation.ts` — the rule remains command-layer-only.

DC.42 `validation.ts` MUST import `ConfidenceLevel` and `ReviewerIcon` from `./types.js` rather than redeclaring them. This is the type-import discipline that justifies the package split: types are shared, behavior is per-module.

## §8 Config additions

### Type addition (`core/src/types/config.ts`)

Modify `ClaimConfig.confidence` (currently lines 237-240):

```typescript
export interface ClaimConfig {
  bracelessMatching?: boolean;
  projectionTypes?: string[];
  /**
   * Configuration for file-level confidence markers.
   * @implements {R004.§7.AC.03} Confidence auto-insert config
   * @implements {R013.§1.AC.06} Date inclusion control
   */
  confidence?: {
    /** Whether to auto-insert confidence annotations on file creation. Default: true */
    autoInsert?: boolean;
    /**
     * Whether confidence annotations carry a trailing ISO date.
     * When true (default), annotations include `<emoji><level> <YYYY-MM-DD>`.
     * When false, all writing paths emit the bare `<emoji><level>` form.
     * Parse paths accept both forms regardless of this flag's value.
     * Default: true
     */
    includeDate?: boolean;
  };
}
```

### Validator addition (`core/src/config/config-validator.ts`)

Modify the inline `claims.confidence` Zod object (currently lines 322-324):

```typescript
confidence: z.object({
  autoInsert: z.boolean().optional().default(true),
  includeDate: z.boolean().optional().default(true),
}).optional(),
```

DC.43:derives=R013.§1.AC.06 `ClaimConfig.confidence.includeDate` MUST exist as an optional boolean field at `core/src/types/config.ts` parallel to the existing `autoInsert`. Default semantics MUST be `true` (preserves the existing dated-annotation behavior for projects that don't opt in to dateless mode).

DC.44:derives=R013.§1.AC.06 The Zod validator at `core/src/config/config-validator.ts:319-325` MUST be extended with `includeDate: z.boolean().optional().default(true)`. The existing `autoInsert` validator entry MUST remain unchanged. The default value `true` MUST come from the Zod `.default(true)` chain so the parsed config's `claims.confidence.includeDate` is always defined when `claims.confidence` is provided.

DC.45 Adapters MUST NOT read the `claims.confidence.includeDate` flag directly. The flag is consumed at the command layer (`mark`, `apply`, the auto-insert hook — all in {S004}'s scope), which decides whether to pass `date` through to `format` or to omit it. Adapters' `format` and `insert` honor `date === undefined` per §3, §5, and §6; the policy decision lives one layer up.

## §9 Migration and test mapping

### File deletion

`core/src/claims/confidence.ts` (existing 305-line file) MUST be deleted in the same change-set that introduces the `confidence/` package. Imports MUST be updated:

- `core/src/cli/commands/confidence/mark-command.ts:15-21` — change import path from `../../../claims/confidence.js` to `../../../claims/confidence/index.js` (or rely on package barrel resolution). Imported names (`mapReviewerArg`, `validateReviewerLevel`, `formatConfidenceAnnotation`, `insertConfidenceAnnotation`, `ConfidenceLevel`) MUST resolve from the new barrel — `formatConfidenceAnnotation` and `insertConfidenceAnnotation` are preserved as legacy-compat wrappers per DC.06.
- `core/src/cli/commands/confidence/audit-command.ts:13` — same path change. `auditConfidence` is re-exported from the barrel until {S004}'s DD relocates it.

### Test file deletion and re-homing

`core/src/claims/__tests__/confidence.test.ts` (existing 312-line file) MUST be deleted. Its test cases are re-homed to the new per-module test files. Mapping:

| Existing test (line range) | New home | Adjustment |
|---|---|---|
| `parseConfidenceAnnotation` describe block (lines 23-162) | `confidence/__tests__/c-family.test.ts` (parse describe) | Update import paths and call `cFamilyAdapter.parse()` instead of bare function. Behavior assertions UNCHANGED. |
| `formatConfidenceAnnotation` describe block (lines 168-193) | `confidence/__tests__/c-family.test.ts` (format describe) | Same — call `cFamilyAdapter.format()`. Behavior assertions UNCHANGED. |
| `insertConfidenceAnnotation` describe block (lines 199-256) | `confidence/__tests__/c-family.test.ts` (insert describe) | **BEHAVIOR CHANGE** — see below. |
| `validateReviewerLevel` describe block (lines 262-286) | `confidence/__tests__/validation.test.ts` | Update import paths. Behavior assertions UNCHANGED. |
| `mapReviewerArg` describe block (lines 292-311) | `confidence/__tests__/validation.test.ts` | Update import paths. Behavior assertions UNCHANGED. |

### Insert tests — required behavior adjustments per {S003.§3.AC.05}

Two existing test cases assert legacy "insert AFTER `*/`" behavior and MUST be updated:

1. **`'inserts after JSDoc block'` (existing test, lines 215-229).** The current expectation is `lines[3]` equals the new annotation (one line after `*/`). The new expectation per §3.AC.05(a): the new annotation appears at `lines[2]` as ` * @confidence …` (the JSDoc body) and the original `*/` shifts to `lines[3]`. The test name should change to `'inserts inside JSDoc block before */'` and the assertions become:
   ```typescript
   expect(lines[0]).toBe('/**');
   expect(lines[1]).toBe(' * Module doc');
   expect(lines[2]).toBe(' * @confidence 👤4 2026-03-11');
   expect(lines[3]).toBe(' */');
   expect(lines[4]).toBe('const x = 1;');
   ```

2. **`'replaces existing annotation within JSDoc'` (existing test, lines 243-255).** The original sets up content where the legacy implementation had inserted `// @confidence 🤖1 2026-01-01` AFTER `*/` (line 3 of a 5-line file). Under the new behavior, the equivalent input would be ` * @confidence 🤖1 2026-01-01` BEFORE `*/`. The test name and content need updating. The behavioral assertion is then: when an annotation already exists in the JSDoc-internal carrier, replacement happens in-place at that line preserving the ` * ` prefix.

DC.46:5:derives=S003.§3.AC.05 The C-family adapter test file MUST contain at least these new/updated cases:
- `'inserts inside JSDoc block before */'` — verifies branch (a).
- `'inserts at end of leading line-comment stack'` — new test, verifies branch (b). Input: `'// header line 1\n// header line 2\nconst x = 1;'`. Expected output: annotation appended at line 3 (after the second `//` line), with `const x = 1;` shifted to line 4.
- `'inserts as first line when no JSDoc and no //-stack'` — verifies branch (c). Equivalent to the existing `'inserts at first line when no JSDoc exists'` (lines 207-213) — that test already covers this case and MUST be retained.
- `'replaces existing JSDoc-internal annotation in-place preserving asterisk indent'` — adapted from the existing `'replaces existing annotation within JSDoc'`.
- `'replaces existing line-comment annotation in-place'` — equivalent to existing `'replaces existing annotation in-place'` (lines 231-241), MUST be retained.

DC.47:4:derives=S003.§3.AC.06 The C-family adapter test file MUST contain a backward-compatibility test asserting that a file containing the legacy after-`*/` placement still parses correctly:
```typescript
it('parses legacy after-*/ placement', () => {
  const content = [
    '/**',
    ' * Module doc',
    ' */',
    '// @confidence 🤖2 2026-03-11',
    'const x = 1;',
  ].join('\n');
  const result = cFamilyAdapter.parse(content, 'legacy.ts');
  expect(result).not.toBeNull();
  expect(result!.level).toBe(2);
  expect(result!.line).toBe(4);
});
```

DC.48:derives=S003.§4.AC.05 The new `markdown-frontmatter.test.ts` file MUST cover at minimum: (a) parse returns null on `.md` with no frontmatter; (b) parse returns null on `.md` with frontmatter but no `confidence:` key; (c) parse returns null on `.md` where `confidence:` is a number or object; (d) parse returns the payload on `.md` where `confidence:` is a valid string scalar; (e) insert creates frontmatter when absent (matches the worked example in {S003} `## At a Glance`); (f) insert adds the key when frontmatter exists without it; (g) insert replaces the value when the key exists; (h) idempotence — `insert(insert(c, p), p)` differs from `insert(c, p)` by at most one trailing newline.

DC.49:derives=S003.§2.AC.03 The new `registry.test.ts` MUST cover at minimum: (a) `getAdapter('foo.ts')` returns the C-family adapter; (b) `getAdapter('foo.md')` returns the frontmatter adapter; (c) `getAdapter('foo.unknown')` returns `null`; (d) `getAdapter('')` returns `null` (empty path); (e) registration order is `[markdown-frontmatter, c-family]` — verified by checking that an `.md` file routes to the frontmatter adapter, NOT to a hypothetical narrower adapter (informational only since no narrower adapter exists in this DD).

## Wiring Map

### Import graph

```
core/src/claims/confidence/
  index.ts ←─────────────── (consumers: mark-command, audit-command, future S004 modules)
   ├── types.ts            (no imports from this package; pure type defs)
   ├── adapter.ts          ← types.ts
   ├── validation.ts       ← types.ts
   ├── registry.ts         ← adapter.ts, adapters/c-family.ts, adapters/markdown-frontmatter.ts
   └── adapters/
        ├── c-family.ts            ← adapter.ts, types.ts
        └── markdown-frontmatter.ts ← adapter.ts, types.ts, gray-matter (npm)

core/src/types/config.ts          (independent — config type addition)
core/src/config/config-validator.ts (independent — Zod schema addition)
```

No circular dependencies. The adapter modules depend only on `adapter.ts` and `types.ts`; `registry.ts` depends on the adapters; `index.ts` depends on everything to re-export.

### Call chain — confidence mark (current consumer, unchanged surface)

```
CLI: scepter confidence mark <file> <reviewer> <level>
  → mark-command.ts (no changes needed beyond import path)
    → mapReviewerArg(arg)            (validation.ts via barrel)
    → validateReviewerLevel(rev, lv) (validation.ts via barrel)
    → formatConfidenceAnnotation(…)  (legacy-compat wrapper → cFamilyAdapter.format)
    → insertConfidenceAnnotation(…)  (legacy-compat wrapper → cFamilyAdapter.insert)
  → fs.writeFile(filePath, updated)
```

The mark command's call surface is identical to today — the legacy-compat wrappers in `index.ts` (DC.06) preserve the function names and signatures. Routing mark through `getAdapter(filePath)` is {S004}'s concern.

### Call chain — future apply consumer (informational)

```
CLI: scepter confidence apply <reviewer> <level> --types Requirement
  → (S004's apply-command, not in this DD)
    → for each selected file:
        → adapter = getAdapter(filePath)  (registry.ts)
        → if adapter === null: skip with reason 'no adapter'
        → existing = adapter.parse(content, filePath)
        → newContent = adapter.insert(content, payload)
        → fs.writeFile(...)
```

## Data and Interaction Flow

### Flow 1 — Adapter dispatch

```
1. Caller resolves filePath (CLI arg, glob expansion, etc.).
2. Caller invokes getAdapter(filePath) (registry.ts).
3. Registry iterates `adapters` array in declaration order.
4. For each adapter: adapter.matches(filePath) is checked.
5. First adapter whose matches() returns true is returned.
6. If no match: returns null.
7. Caller checks for null:
   - parse path (audit): silently skip the file.
   - insert path (mark/apply): surface a clear error or skip with reason.
```

### Flow 2 — C-family insert (no existing annotation, JSDoc carrier branch)

```
1. Caller has content with a JSDoc header at lines 0..N (containing /** and */).
2. Caller invokes cFamilyAdapter.insert(content, payload).
3. Insert splits content into lines.
4. Scans first 20 lines for an existing CONFIDENCE_REGEX match — none found.
5. Branch (a) check: scans for /** and */ within first 20 lines. Both found.
6. Reads asterisk indent from line above */ (typically ' * ').
7. Constructs new line: ' * @confidence <reviewer><level> <date>'.
8. Splices new line at index of */ (so */ shifts down by one).
9. Joins lines with '\n' and returns.
```

### Flow 3 — Frontmatter insert (no frontmatter present)

```
1. Caller has content that starts with '# Title' (no leading ---).
2. Caller invokes markdownFrontmatterAdapter.insert(content, payload).
3. Insert calls matter(content). Returns parsed object with empty data.
4. Detects no leading frontmatter via /^---\r?\n/ — false.
5. Sets parsed.data.confidence = format(payload).
6. Calls matter.stringify(parsed.content, parsed.data).
7. gray-matter generates a leading ---\nconfidence: ...\n---\n block followed
   by parsed.content.
8. Returns the new string. Caller writes to disk.
```

### Flow 4 — Round-trip invariant verification

```
1. Test starts with content c and payload p.
2. inserted = adapter.insert(c, p).
3. parsed = adapter.parse(inserted, filePath).
4. Assert: parsed !== null.
5. Assert: parsed.reviewer === p.reviewer.
6. Assert: parsed.level === p.level.
7. Assert: parsed.date === p.date (when p.date is defined).
8. (line and filePath are excluded from the round-trip equality.)
```

## Integration Sequence

### Phase 1: Type and validation extraction (no behavior change)

**Files**: `core/src/claims/confidence/types.ts`, `core/src/claims/confidence/validation.ts`, `core/src/claims/confidence/index.ts` (initial barrel).
**Changes**: Move `ConfidenceLevel`, `ReviewerIcon`, `ConfidenceAnnotation` types to `types.ts`. Add new `ConfidencePayload` type and rewire `ConfidenceAnnotation` to extend it (preserving field-by-field shape per DC.09). Move `validateReviewerLevel`, `mapReviewerArg`, `VALID_LEVELS`, `REVIEWER_LEVEL_RANGES` to `validation.ts`. Create initial `index.ts` re-exporting types and validation. `confidence.ts` STAYS in place but imports from `confidence/types.js` and `confidence/validation.js` to avoid duplication.
**Verify**: `pnpm tsc` passes. `core/src/claims/__tests__/confidence.test.ts` still runs against `confidence.ts` (now thin) and passes byte-identically.
**Spec**: {S003.§1.AC.02}, {S003.§5.AC.01}, {S003.§5.AC.03}.

### Phase 2: Adapter interface and C-family adapter

**Files**: `core/src/claims/confidence/adapter.ts`, `core/src/claims/confidence/adapters/c-family.ts`, `core/src/claims/confidence/__tests__/c-family.test.ts`.
**Changes**: Define `ConfidenceAdapter` interface. Implement `cFamilyAdapter` with `matches`, `parse`, `format`, `insert`. The `insert` includes the new three-branch logic per {S003.§3.AC.05}. Author the new C-family test file with parse/format tests UNCHANGED from legacy and insert tests UPDATED per DC.46.
**Verify**: `pnpm tsc` passes. New test file passes. Legacy test file (`confidence.test.ts`) is updated to call through `cFamilyAdapter` for the cases that survive — the legacy "insert after `*/`" expectations are deleted (those cases are now in the new test file with the corrected assertions).
**Spec**: {S003.§1.AC.01-07}, {S003.§3.AC.01-06}.

### Phase 3: Frontmatter adapter

**Files**: `core/src/claims/confidence/adapters/markdown-frontmatter.ts`, `core/src/claims/confidence/__tests__/markdown-frontmatter.test.ts`.
**Changes**: Implement `markdownFrontmatterAdapter` per §6. Author the new test file covering DC.48's cases.
**Verify**: `pnpm tsc` passes. New test file passes. Round-trip invariant ({S003.§1.AC.05}) verified for at least three round-trip cases per DC.48.
**Spec**: {S003.§4.AC.01-08}.

### Phase 4: Registry

**Files**: `core/src/claims/confidence/registry.ts`, `core/src/claims/confidence/__tests__/registry.test.ts`.
**Changes**: Define the ordered `adapters` array with `markdownFrontmatterAdapter` first, `cFamilyAdapter` second. Implement `getAdapter(filePath)`. Author the test file covering DC.49's cases.
**Verify**: `pnpm tsc` passes. Registry test passes. `getAdapter('x.md')` returns the frontmatter adapter (proves order — if reversed, `.md` would still match c-family's broader regex if hypothetically broadened).
**Spec**: {S003.§2.AC.01-05}.

### Phase 5: Config additions

**Files**: `core/src/types/config.ts`, `core/src/config/config-validator.ts`.
**Changes**: Add `includeDate?: boolean` to `ClaimConfig.confidence`. Add the parallel Zod field with `.default(true)`.
**Verify**: `pnpm tsc` passes. The existing config validator test passes. A new test (in the existing config-validator test file or a new one) asserts that `claims.confidence.includeDate` defaults to `true` when omitted.
**Spec**: {R013.§1.AC.06}.

### Phase 6: Barrel finalization and legacy-file deletion

**Files**: `core/src/claims/confidence/index.ts`, DELETE `core/src/claims/confidence.ts`, DELETE `core/src/claims/__tests__/confidence.test.ts`, UPDATE `core/src/cli/commands/confidence/mark-command.ts`, UPDATE `core/src/cli/commands/confidence/audit-command.ts`.
**Changes**: Finalize barrel re-exports per DC.06. Delete the legacy `confidence.ts` and its test file (legacy test cases have been re-homed in earlier phases; any remaining cases that depended on the legacy insert behavior have been updated). Update mark-command and audit-command import paths. `auditConfidence` is preserved by re-exporting it from the barrel — its definition does not move yet (that's {S004}'s DD).
**Verify**: `pnpm tsc` passes. All test files (c-family, markdown-frontmatter, registry, validation) pass. `pnpm tsx` exercise of `scepter confidence mark` and `scepter confidence audit` against a sample project produces unchanged behavior.
**Spec**: {S003.§3.AC.06}, all DCs in §1.

**Acceptance gate for the entire DD**: `pnpm tsc` passes; all new test files pass; one end-to-end exercise of `scepter confidence mark <file> human 4` against a `.ts` file with a JSDoc header produces output that places ` * @confidence …` BEFORE the `*/` (the §3.AC.05 corrective behavior); the same exercise against a `.md` file (via the existing mark-command, even though full routing is {S004}'s job — at minimum the legacy-compat wrapper still produces working output for `.ts`) compiles.

## Decisions

### Decision 1 — C-family adapter uses a hardcoded extension list, not config-driven

**Decision:** `C_FAMILY_EXTENSIONS` is a `readonly string[]` literal in `c-family.ts` containing `['.ts', '.tsx', '.js', '.jsx', '.css']`. The adapter does NOT consult the project's `sourceCodeIntegration.extensions` config in this DD.

**Alternatives considered:**
- **Pass config to the adapter at construction time.** Would require adapters to be created (not exported as constants) and the registry to be config-aware. Adds complexity for a use case that is currently theoretical — no project today narrows the C-family extension set.
- **Read config in `matches()`.** Would require `matches()` to access a global config singleton, breaking the purity guarantee in {S003.§1.AC.03}. Rejected on those grounds alone.

**Rationale:** {S003.§3.AC.01} permits config-driven extension matching ("if a project's config narrows the set, the adapter's `matches` MUST follow the active config") but does not require it; the spec's wording is "MUST follow the active config" only when config narrowing is in play. Hardcoding the default set is simpler, preserves purity, and matches the pre-{R013} behavior. A follow-up requirement can introduce config-driven dispatch when a real use case appears.

### Decision 2 — Trailing-newline policy: tolerate `gray-matter`'s normalization, do not pre/post-process

**Decision:** The frontmatter adapter's `insert` returns `matter.stringify(...)`'s output verbatim. No pre-processing of input content; no post-processing of output. Tests asserting idempotence MUST tolerate a single trailing-newline difference per {S003.§4.AC.08}.

**Alternatives considered:**
- **Strip the trailing newline post-stringify.** Would make idempotence byte-exact but would diverge from `gray-matter`'s output convention used elsewhere in the project (`note-file-manager.ts:716` writes `gray-matter`'s stringified output verbatim). Two different stringify policies in the project = consistency drift.
- **Append a known trailing newline always.** Would normalize differently from `gray-matter`'s default. Same drift problem.

**Rationale:** {S003.§4.AC.08} explicitly accepts the trailing-newline tolerance. `note-file-manager.ts` already trusts `gray-matter`'s output as-is. The adapter MUST behave consistently with the project's other frontmatter handler, not impose its own normalization.

### Decision 3 — Frontmatter line-number computation: scan for `confidence:` directly, not via gray-matter

**Decision:** `locateConfidenceKeyLine(content)` is a hand-written linear scan over the leading frontmatter block, matching `/^confidence\s*:/` after trim. It does NOT use `gray-matter`'s parsed AST or any other YAML library.

**Alternatives considered:**
- **Use a YAML parser (`yaml` package) to find the key's line:column.** Adds a dependency for a single line-number lookup. The `yaml` package is not a current dependency (only `gray-matter` is); adding it for this is unjustified.
- **Stringify and re-parse, counting `\n`s.** Convoluted; line numbers from stringify wouldn't necessarily match the source content's line numbers if the input had different formatting.
- **Skip line-number computation; always set `line: 0`.** Would violate {S003.§4.AC.03}'s requirement that `line` be the 1-indexed line number of the `confidence:` key.

**Rationale:** The flat scan is sufficient because the project's frontmatter is shallow (top-level keys only — see `note-file-manager.ts:701-716` which treats frontmatter as flat key-value pairs). It uses no extra dependencies, runs in O(N) where N is small (frontmatter blocks rarely exceed 20 lines), and returns a precise answer for the project's actual data shape. Future need for nested-key handling would justify revisiting; for now, this is the right grain.

## Acceptance Criteria Summary

| Section | DC count | Spec coverage |
|---|---|---|
| §1 Module structure | 7 (DC.01-DC.07) | {S003.§1.AC.01}, {S003.§2.AC.01}, {S003.§3.AC.06}, {S003.§5.AC.03} |
| §2 Type definitions | 3 (DC.08-DC.10) | {S003.§1.AC.02}, {S003.§5.AC.01} |
| §3 Adapter interface | 3 (DC.11-DC.13) | {S003.§1.AC.01}, {S003.§5.AC.04}, {R013.§1.AC.06} |
| §4 Registry | 5 (DC.14-DC.18) | {S003.§2.AC.01-05} |
| §5 C-family adapter | 11 (DC.19-DC.29) | {S003.§3.AC.01-06} |
| §6 Markdown-frontmatter adapter | 11 (DC.30-DC.40) | {S003.§4.AC.01-08} |
| §7 Validation | 2 (DC.41-DC.42) | {S003.§5.AC.03} |
| §8 Config additions | 3 (DC.43-DC.45) | {R013.§1.AC.06} |
| §9 Migration and test mapping | 4 (DC.46-DC.49) | {S003.§3.AC.05}, {S003.§3.AC.06}, {S003.§4.AC.05}, {S003.§2.AC.03} |
| **Total** | **49** | — |

## Non-Goals / Out of Scope

This DD deliberately excludes:

- **`confidence audit` scope expansion to notes** ({R013.§2}; tracked by {S004}'s DD). The existing `auditConfidence` function is preserved verbatim and re-exported from the barrel; no behavior change to the audit command.
- **`confidence apply` bulk command** ({R013.§3}; tracked by {S004}'s DD). The registry is built so the future apply command can route through `getAdapter(filePath)`, but the command itself is not in scope.
- **`confidence mark` routing through the registry.** The mark command continues to import `formatConfidenceAnnotation` and `insertConfidenceAnnotation` (legacy-compat wrappers) which call the C-family adapter directly. Routing through `getAdapter(filePath)` so `mark` can write `.md` files is {S004}'s concern.
- **Auto-insert hook on `scepter create`** ({R013.§4}; tracked by {S004}'s DD). The `claims.confidence.autoInsert` flag remains unwired.
- **Third-party adapter registration API.** The `adapters` array is `readonly` and not exported. {S003.§2}'s informative future-extension hook is not implemented.
- **Broader pluggable `@implements`/`@validates` framework.** The adapter pattern here is scoped to the confidence payload only, per {R013}'s Non-Goals.
- **Migration of `auditConfidence` and `discoverSourceFiles` out of the legacy file.** They are preserved at the new barrel's re-export surface; the body relocates in {S004}'s DD.
- **Removing `formatConfidenceAnnotation` and `insertConfidenceAnnotation` from the public surface.** They remain as legacy-compat wrappers re-exported from the barrel so the mark-command continues to compile unchanged. They become candidates for deletion when {S004}'s DD finishes routing all consumers through `getAdapter`.

## References

- {S003} — Source spec: confidence adapter registry. This DD concretizes §1-§5.
- {R013.§1} — Source requirement: pluggable annotation adapters.
- {R013.§1.AC.06} — `claims.confidence.includeDate` flag (this DD's §8).
- {R004.§7} — Original confidence requirement (preserved by C-family adapter via {S003.§3.AC.06}).
- {S004} — Downstream consumer spec: command surface and creation hook.
- {DD017} — Downstream consumer DD: command surface implementation (concretizes {S004}, consumes the adapter registry built here).
- `core/src/claims/confidence.ts` — Existing implementation; deleted by this DD.
- `core/src/claims/__tests__/confidence.test.ts` — Existing tests; deleted by this DD with cases re-homed.
- `core/src/notes/note-file-manager.ts:8, 222, 701-716` — Existing `gray-matter` usage convention the frontmatter adapter aligns with.
- `core/src/types/config.ts:222-241` — `ClaimConfig.confidence`; extended by this DD.
- `core/src/config/config-validator.ts:319-325` — `claims.confidence` Zod validator; extended by this DD.
- `core/src/cli/commands/confidence/mark-command.ts`, `audit-command.ts` — Existing consumers; import paths updated, behavior unchanged.
