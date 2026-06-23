---
created: 2026-05-05T16:35:52.103Z
status: draft
tags: [confidence, adapters, audit, mark, apply, auto-insert, test-plan]
---

# TS001 - Confidence subsystem test plan

**Spec:** {S003}, {S004} | **Requirements:** {R013}, {R017} | **Designs:** {DD016}, {DD017}
**Date:** 2026-05-05 (§12 added for {R017}: 2026-05-31)

## Context

This test plan establishes the verification surface for the {R013} confidence-extension stack. {S003}/{DD016} introduce a pluggable adapter registry under `core/src/claims/confidence/` (replacing the monolithic `core/src/claims/confidence.ts`), with a typed `ConfidenceAdapter` interface, ordered first-match lookup, a re-expressed C-family adapter (with the {S003.§3.AC.05} three-branch insert behavior change), and a new markdown-frontmatter adapter built on `gray-matter`. {S004}/{DD017} build four command surfaces atop the registry: a multi-scope `audit` with `--paths`, a registry-routed `mark`, a new bulk `apply`, and a `NoteManager.createNote` auto-insert hook. The plan covers verification for the entire stack as a single coherent body of tests because the two specs share fixtures and adapter dispatch is the integration seam where most behavior emerges.

The existing test file `core/src/claims/__tests__/confidence.test.ts` (312 lines, 5 describe blocks) is re-homed per {DD016.§9}: parse and validation cases survive byte-for-byte under new import paths; insert cases are revised to match the corrected three-branch behavior; a backward-compat parse case for legacy after-`*/` placement is added. This plan specifies the full target test surface — replacements, additions, and net-new files — not the migration mechanics.

§12 (added for {R017}) covers the implied-human read-time defaulting policy: the emoji-optional parse grammar in both adapters ({S003.§6}/{DD016.§10}), the frontmatter YAML-number coercion, the `claims.confidence.impliedHuman` config flag and its default-active resolution, and the read-path consumers that thread the resolved `defaultReviewer` ({S004.§7}/{DD017.§8}). These tests extend the existing confidence test files rather than adding new ones. Origin task {T006}.

## Scope

**In scope:**
- Adapter interface contract and round-trip/idempotence invariants ({S003.§1}, {S003.§5}).
- Registry dispatch and ordering ({S003.§2}).
- C-family adapter parse, format, insert (including the new three-branch insert and legacy parse backward-compat) ({S003.§3}, {DD016.§5}, {DD016.§9}).
- Markdown frontmatter adapter parse, format, insert across the three frontmatter cases plus `gray-matter` edges ({S003.§4}, {DD016.§6}).
- Filter resolver semantics including the source-via-glob constraint and the contradiction error ({S004.§1}, {DD017.DC.01-04}).
- Multi-scope audit with per-scope independence, `bySource`/`byNotes` substructures, and `--paths` plaintext output ({S004.§2}, {DD017.DC.05-14}).
- Mark refactor: source-file behavioral parity (where parity applies post-{S003.§3.AC.05}), markdown routing, command-layer validation, `includeDate` honor ({S004.§3}, {DD017.DC.15-19}).
- Apply: arg validation, action classification, dry-run accuracy, failure isolation, zero-match-vs-no-filters distinction, downgrade permission, `includeDate` honor ({S004.§4}, {DD017.DC.20-28}).
- Auto-insert hook: idempotence, template precedence, `autoInsert: false` no-op, null-adapter no-op, throw isolation, scope to creation path, `includeDate` honor ({S004.§5}, {DD017.DC.30-33}).
- Formatter behavior: per-scope sections, `--paths` TTY detection, apply summary, apply plan table ({DD017.DC.34-38}).
- `includeDate` config flag end-to-end across mark, apply, and auto-insert ({R013.§1.AC.06}, {S004.§3.AC.03}).
- Implied-human read-time policy ({R017}): the emoji-optional parse grammar in both adapters, the frontmatter YAML-number coercion, the `impliedHuman` config flag and its default-active resolution, and the read-path consumers (audit `byReviewer` tally, `apply --skip-annotated`, auto-insert precedence) that thread the resolved `defaultReviewer` ({S003.§6}, {S004.§7}, {DD016.§10}, {DD017.§8}).

**Out of scope:**
- Live integration tests against external services (none exist for this subsystem).
- Performance benchmarks for `apply` over thousands of files. Sequential I/O is the chosen model per {DD017} Decision 3; profiling-driven parallelism is reversible future work.
- VS Code extension tests. The confidence subsystem is core-only; the extension consumes nothing from this stack today.
- Byte-identity assertions for the legacy after-`*/` insert position. {S003.§3.AC.05} corrects that placement to before-`*/`. The byte-identity bar applies to format string, parse outcomes, and in-place replacement — not to the legacy insert position.
- Release-notes content ({S004.§6.AC.01}). Documentation projection covered by {DD017} Step 8, not by tests.

## Test Strategy

### Test Level Allocation

| Level | Scope | Proportion | Rationale |
|-------|-------|------------|-----------|
| Unit | Adapter operations, registry lookup, filter resolution, formatter rendering | ~70 cases | Pure functions over content strings and config — the bulk of the surface. Unit tests give the fastest feedback on adapter correctness, which is the integration seam. |
| Integration | Audit walking real fixture trees; apply over fixture trees; auto-insert through `NoteManager.createNote` | ~25 cases | Verify command-to-adapter wiring against fixture filesystems rather than mocked filesystems. Captures the data-flow paths that pure unit tests miss. |
| E2E | None | 0 | No full-stack workflow benefits over the integration level here; the CLI commands are thin Commander wrappers around the integration surface. |

### Approach

**Test isolation.** Each test creates its own fixture under `.test-tmp/<test-name>/` (per the `cross-project-commands.test.ts` precedent at `core/src/cli/commands/__tests__/cross-project-commands.test.ts:18-28`). Setup creates files; teardown via `fs.rm({recursive, force})` in `afterEach`. No shared mutable state between tests.

**Mocking boundaries.** Adapters are tested directly (no mocks — they are pure functions). Registry is tested directly. Filter resolver is tested against a `ProjectManager` constructed over a fixture project (per the existing pattern). Audit/apply integration tests use real `fs` against fixtures; only the auto-insert throw-isolation test mocks the adapter to throw. TTY detection is tested by setting `process.stdout.isTTY` directly within the test (and restoring in teardown).

**Fixture approach.** A new `core/src/claims/__tests__/fixtures/confidence/` directory holds per-shape sample files: `with-jsdoc.ts`, `no-jsdoc-comment-stack.ts`, `bare.ts`, `no-frontmatter.md`, `frontmatter-no-confidence.md`, `frontmatter-with-confidence.md`, `malformed-yaml.md`, `legacy-after-jsdoc.ts`. Tests read these via `fs.readFile` rather than embedding content inline; this keeps the test bodies focused on assertions and lets fixture files be reused across describes. Inline content remains acceptable for one-off cases.

**AC-tied descriptions.** Every test case description begins with the AC ID it validates: `it('S003.§3.AC.05(a): inserts inside JSDoc block before */', () => …)`. This makes coverage gaps visible at test-report time and lets a reader trace from a failing test back to its spec authority.

**`@validates` annotations.** Every test file's module-level docstring carries `@validates` for the AC IDs the file covers, per the project convention (see `core/src/cli/commands/__tests__/cross-project-commands.test.ts:1-8` for precedent). Inline `@validates` on individual `it` blocks is unnecessary when the description carries the AC ID.

### Automation Concerns

- **Determinism.** No timing or randomness. The auto-insert hook tests inject a fixed `today` via dependency injection or by mocking `new Date()` only when needed — most tests use a fixture-supplied date string and verify byte equality.
- **Independence.** No test depends on another test's filesystem state. Fixture trees are scoped per test under `.test-tmp/`.
- **Speed.** Unit tests under 50ms each; integration tests under 2s each. Sequential apply over a 50-file fixture should complete under 1s.
- **Data isolation.** `beforeEach`/`afterEach` lifecycle removes `.test-tmp/<test-name>/` so a previous test's residue cannot leak.
- **Environment.** All tests run in-memory or against ephemeral `.test-tmp/` paths. No containers, no live services.

## Test Coverage Map

The map below shows which test plan section validates which upstream AC ranges. Each row's specs are the authority that section's tests trace to via `derives=` metadata on the section's ACs.

| Test plan section | Source ACs validated |
|---|---|
| §1 Test infrastructure | (process — describes the test conventions; no upstream ACs) |
| §2 Adapter interface and registry | S003.§1.AC.01-07, S003.§2.AC.01-05 |
| §3 C-family adapter | S003.§3.AC.01-06, DD016.§9.DC.46-47 |
| §4 Markdown frontmatter adapter | S003.§4.AC.01-08, DD016.§9.DC.48 |
| §5 Filter resolution | S004.§1.AC.01-06, DD017.DC.01-04 |
| §6 Audit | S004.§2.AC.01-10, DD017.DC.05-14 |
| §7 Mark | S004.§3.AC.01-06, DD017.DC.15-19 |
| §8 Apply | S004.§4.AC.01-09, DD017.DC.20-28 |
| §9 Auto-insert hook | S004.§5.AC.01-07, DD017.DC.30-33 |
| §10 Cross-cutting invariants | S003.§5.AC.01-05, R013.§1.AC.06 |
| §11 Test execution | (process — invocation contract) |
| §12 Implied-human read-time policy ({R017}) | S003.§6.AC.01-08, S004.§7.AC.01-08, DD016.§10.DC.50-55, DD017.§8.DC.40-45 |

## §1 Test infrastructure

Tests run under `vitest` (the project test runner per `package.json:"test": "cd core && vitest"` and the `vitest` dependency at `^3.2.4`). Tests live as `*.test.ts` files in `__tests__` directories sibling to their source modules (existing convention: `core/src/claims/__tests__/`, `core/src/cli/commands/__tests__/`, `core/src/cli/commands/claims/__tests__/`). The new test surface adds files under `core/src/claims/confidence/__tests__/` (per {DD016.§9}'s `confidence/__tests__/c-family.test.ts`, `markdown-frontmatter.test.ts`, `registry.test.ts` re-homing) plus `core/src/cli/commands/confidence/__tests__/` for command-level integration tests.

AC.01 The test runner MUST be `vitest` invoked via `npm test` / `cd core && vitest` (per `package.json` `"test"` script). Tests MUST NOT introduce a parallel runner (jest, mocha, etc.).

AC.02 New test files MUST live in `__tests__` directories sibling to their target source module: adapter tests under `core/src/claims/confidence/__tests__/`; filter and audit tests under the same; command-level integration tests under `core/src/cli/commands/confidence/__tests__/`. The fixture directory MUST be `core/src/claims/__tests__/fixtures/confidence/` (existing fixtures convention extended to a `confidence/` subdirectory).

AC.03 Each test description MUST begin with the AC ID(s) it validates, followed by a colon and a human-readable summary: e.g., `it('S003.§3.AC.05(a): inserts inside JSDoc block before */', () => …)`. When a single test exercises multiple ACs, the description MUST list each AC ID joined by commas before the colon.

AC.04 Each new test file's module docstring MUST carry `@validates` annotations for every AC ID covered in that file. Per-`it` `@validates` is OPTIONAL when the description already carries the AC ID. The annotation format follows the project convention demonstrated at `core/src/cli/commands/__tests__/cross-project-commands.test.ts:1-8`.

AC.05 Multi-AC test cases (one test exercising several ACs) MUST be the exception, not the rule. When a single setup verifies multiple ACs naturally (e.g., parse round-trip verifies §1.AC.04 and §1.AC.05 simultaneously), the test description names all ACs and the test body's assertions are split into named blocks (one per AC) so a failure points at the specific AC that broke.

## §2 Adapter interface and registry tests

Test cases for the contract every adapter must satisfy and the registry's lookup behavior. New file: `core/src/claims/confidence/__tests__/registry.test.ts` plus shared assertions reused in the per-adapter test files.

AC.01:derives=S003.§1.AC.05 A round-trip test MUST exist for each built-in adapter: for each of a representative payload set (AI/level-1-3, Human/level-3-5, with-date, undefined-date), `parse(insert(c, p), filePath)` MUST return a `ConfidenceAnnotation` whose `reviewer`, `level`, and `date` fields equal `p`'s. The test MUST run against each adapter independently using shape-appropriate base content (a JSDoc-bearing `.ts` for C-family; a frontmatter-bearing `.md` for frontmatter; an empty-content variant for both).

AC.02:derives=S003.§1.AC.07 An idempotence test MUST exist for each built-in adapter: `insert(insert(c, p), p)` MUST byte-equal `insert(c, p)` for the C-family adapter, and MUST byte-equal modulo at most one trailing newline for the frontmatter adapter (per {S003.§4.AC.08}). The test MUST exercise all three insert branches for the C-family adapter (jsdoc, comment-stack, bare) and all three insert cases for the frontmatter adapter.

AC.03:derives=S003.§1.AC.03 A `matches` purity test MUST exist for each built-in adapter: invoking `matches(filePath)` twice with the same path MUST return the same result; invoking `matches` MUST NOT touch the filesystem (verified by spying on `fs` calls during the invocation). For the C-family adapter, `matches` MUST return `true` for `.ts`, `.tsx`, `.js`, `.jsx`, `.css` and `false` for `.md`, `.txt`, `.py`, `.json`. For the frontmatter adapter, `matches` MUST return `true` for `.md` only.

AC.04:derives=S003.§1.AC.04 A `parse`-returns-null-on-absent test MUST exist for each adapter, exercising multiple "no annotation" content shapes. For the C-family adapter: empty content, content with no `@confidence` line, content with `@confidence` past line 20, content with malformed annotation (no level digit). For the frontmatter adapter: empty content, content with no frontmatter, frontmatter without `confidence:` key, `confidence:` value that is a number/object/array/boolean. Every case MUST return `null`; `parse` MUST NOT throw.

AC.05:derives=S003.§2.AC.02 A registration-order test MUST verify that the registry's `adapters` array (or equivalent) lists `markdown-frontmatter` BEFORE `c-family-comments`. The test MUST inspect the exported registration order directly (via the registry's introspection surface or `adapters.map(a => a.id)`); it MUST NOT rely on inferred behavior alone.

AC.06:derives=S003.§2.AC.03 A `getAdapter` lookup test MUST cover each of: `getAdapter('foo.ts')` returns the C-family adapter; `getAdapter('foo.md')` returns the frontmatter adapter; `getAdapter('foo.unknown')` returns `null`; `getAdapter('foo.txt')` returns `null`; `getAdapter('foo.json')` returns `null`; `getAdapter('foo.py')` returns `null`; `getAdapter('')` returns `null`; `getAdapter('path/with/no/extension')` returns `null`. Per {DD016.§9.DC.49}, these constitute the minimum coverage.

AC.07:derives=S003.§2.AC.04 A `getAdapter` purity test MUST verify that two invocations with identical input strings return the same adapter instance (or, if the registry returns fresh objects, structurally equal adapters). The test MUST verify no filesystem access occurs during `getAdapter` calls (spy on `fs`).

AC.08:derives=S003.§1.AC.06 A non-annotation-content preservation test MUST exist for each adapter: given content `c` with several non-annotation lines (imports, declarations, prose), `insert(c, p)` MUST contain every original line in the same order, with the annotation added at the adapter's defined insertion point. Replacement of an existing annotation MUST leave all other lines byte-identical.

## §3 C-family adapter tests

Test cases targeting the three-branch insert logic and legacy backward-compat. New file: `core/src/claims/confidence/__tests__/c-family.test.ts` (per {DD016.§9} re-homing). Existing parse and format describes (`confidence.test.ts:23-193`) move here unchanged. Insert describe (`confidence.test.ts:199-256`) is rebuilt per the cases below.

AC.01:derives=S003.§3.AC.05 A test `'S003.§3.AC.05(a): inserts inside JSDoc block before */'` MUST exist with the input from {DD016.§9.DC.46} (existing test at `confidence.test.ts:215-229` rebuilt). Input:
```
/**
 * Module doc
 */
const x = 1;
```
Expected output: `lines[0] = '/**'`, `lines[1] = ' * Module doc'`, `lines[2] = ' * @confidence 👤4 2026-03-11'`, `lines[3] = ' */'`, `lines[4] = 'const x = 1;'`. The leading-asterisk indentation MUST be preserved. This test REPLACES the existing `'inserts after JSDoc block'` test at `confidence.test.ts:215-229`; the legacy after-`*/` expectation is incorrect post-{S003.§3.AC.05}.

AC.02:derives=S003.§3.AC.05 A test `'S003.§3.AC.05(b): inserts at end of leading line-comment stack'` MUST exist (per {DD016.§9.DC.46}). Input: `'// header line 1\n// header line 2\nconst x = 1;'`. Expected: the annotation `'// @confidence 👤4 2026-03-11'` appended at line 3 (after the second `//` line); `'const x = 1;'` shifted to line 4. An additional regression test SHOULD assert spec-faithful behavior on a length-1 leading stack followed by a non-`//` line: input `'// header\n\n// later\nconst x = 1;'`, expected output places the annotation at index 1 (immediately after `'// header'`), because S003.§3.AC.05(b)'s "one or more leading lines" predicate is satisfied by the line-0 single-line stack — the algorithm walks until the first non-`//` line at index 1 and inserts there.

AC.03:derives=S003.§3.AC.05 A test `'S003.§3.AC.05(c): inserts as first line when no JSDoc and no //-stack'` MUST exist. Input: `'const x = 1;\nconst y = 2;'`. Expected: `lines[0] = '// @confidence 👤4 2026-03-11'`, `lines[1] = 'const x = 1;'`, `lines[2] = 'const y = 2;'`. This test EXTENDS the existing `'inserts at first line when no JSDoc exists'` (`confidence.test.ts:207-213`); the existing test is retained per {DD016.§9.DC.46}.

AC.04:derives=S003.§3.AC.04 Two carrier-preservation replacement tests MUST exist:
- `'S003.§3.AC.04: replaces existing line-comment annotation in-place'` — adapted from existing `'replaces existing annotation in-place'` (`confidence.test.ts:231-241`). A `// @confidence` line is replaced with another `// @confidence` line at the same index.
- `'S003.§3.AC.04: replaces existing JSDoc-internal annotation in-place preserving asterisk indent'` — adapted from existing `'replaces existing annotation within JSDoc'` (`confidence.test.ts:243-255`). Per {DD016.§9}'s explicit re-spec, the input now uses ` * @confidence 🤖1 2026-01-01` BEFORE `*/` (not `// @confidence` AFTER `*/` as the legacy fixture had it). The replacement preserves the ` * ` carrier prefix and the line index.

AC.05:5:derives=S003.§3.AC.06,DD016.§9.DC.47 A test `'S003.§3.AC.06: parses legacy after-*/ placement'` MUST exist with the verbatim assertion body from {DD016.§9.DC.47}. This test asserts that a file annotated by the pre-{R013} `insertConfidenceAnnotation` (which placed `// @confidence` AFTER `*/`) STILL parses correctly under the new C-family adapter's `parse`. Importance 5: this is the explicit backward-compat invariant {DD016.§9.DC.47} mandates and the only protection against regressing existing source-file annotations.

AC.06:derives=S003.§3.AC.03 A `format` shape test MUST verify: `format('🤖', 2, '2026-05-05')` returns `'// @confidence 🤖2 2026-05-05'`; `format('👤', 4, '2026-05-05')` returns `'// @confidence 👤4 2026-05-05'`; the emoji and digit MUST have NO space between them; there MUST be exactly one space between the digit and the date; when `date` is `undefined`, `format('🤖', 2, undefined)` returns `'// @confidence 🤖2'` with NO trailing space. The existing format tests at `confidence.test.ts:168-193` cover the dated cases; the undefined-date case is new, derived from {S003.§3.AC.03}'s second sentence.

AC.07:derives=S003.§3.AC.02 A `parse` regex acceptance test MUST verify that both carrier forms (`// @confidence …` and ` * @confidence …`) parse identically. Inputs:
- `'// @confidence 🤖2 2026-03-11\nconst x = 1;'` → parsed.
- `'/**\n * @confidence 🤖2 2026-03-11\n */\nconst x = 1;'` → parsed at line 2.
- `'// @confidence 🤖2\nconst x = 1;'` (no date) → parsed with `date: undefined`.
- `'/**\n * @confidence 🤖2\n */\nconst x = 1;'` (no date, JSDoc carrier) → parsed with `date: undefined`.

The existing parse describe block (`confidence.test.ts:23-162`) covers most variations and MUST be retained verbatim (modulo the wrapper change from bare function to `cFamilyAdapter.parse`); the no-date JSDoc case is new.

AC.08:derives=S003.§1.AC.07 An insert-idempotence test MUST verify that for each of the three insert branches, `insert(insert(c, p), p)` byte-equals `insert(c, p)`. The test MUST exercise (a) JSDoc, (b) comment-stack, (c) bare; all three MUST be byte-stable.

AC.09:derives=S003.§3.AC.02 An edge-case test `'S003.§3.AC.02: ignores */ deeper than first 20 lines'` MUST exist. Input: a file whose first 20 lines are imports and `const` declarations, followed by a function-level JSDoc (containing `*/`) starting at line 25. Expected: branch (a) does NOT trigger (no `/**` in first 20 lines); branch (b) or (c) handles the insert per the leading-line shape. The function-level JSDoc and its `*/` MUST be untouched.

AC.10:derives=S003.§3.AC.05 An edge-case test `'S003.§3.AC.05: file with /** in first 20 lines but no */ in first 20 lines falls to branch (b) or (c)'` MUST exist. Input: a file with `/**` at line 0 and `*/` at line 25. Expected: branch (a) does NOT trigger (per {S003.§3.AC.05}'s "both within the first 20 lines" requirement); the insert falls through to branch (b) if there is a leading `//` stack, or branch (c) otherwise.

## §4 Markdown frontmatter adapter tests

Test cases for the three frontmatter cases and `gray-matter` edges. New file: `core/src/claims/confidence/__tests__/markdown-frontmatter.test.ts` (per {DD016.§9.DC.48}).

AC.01:derives=S003.§4.AC.05 A test `'S003.§4.AC.05: insert creates frontmatter when absent'` MUST exist. Input: `'# R042 - Foo\n\nbody text\n'` (no leading `---`). Expected output: a leading frontmatter block containing only `confidence: <payload>` followed by the original body. Re-parsing the output MUST return the inserted payload (round-trip closure).

AC.02:derives=S003.§4.AC.06 A test `'S003.§4.AC.06: insert adds confidence key when frontmatter exists without it'` MUST exist. Input: a `.md` with `---\ncreated: 2026-05-05\ntags: [foo]\n---\n\n# R042\n`. Expected output: the same frontmatter block extended with `confidence: <payload>`; `created` and `tags` MUST appear with byte-identical values; the body MUST be unchanged. Key ordering and YAML comments are best-effort per {S003.§4.AC.06} (the test asserts presence and value byte-equality, not byte-identical key ordering).

AC.03:derives=S003.§4.AC.07 A test `'S003.§4.AC.07: insert replaces existing confidence value preserving siblings'` MUST exist. Input: a `.md` with `---\ncreated: 2026-05-05\nconfidence: "🤖2 2026-05-05"\ntags: [foo]\n---\n\nbody\n`. Expected output: the `confidence` value is replaced with the new payload string; `created` and `tags` MUST round-trip with byte-equal values; the body MUST be unchanged.

AC.04:derives=S003.§4.AC.02 A test `'S003.§4.AC.02: parse rejects non-string confidence value'` MUST exist with parametrized variants: `confidence: 4` (number), `confidence: {reviewer: ai}` (object), `confidence: [foo, bar]` (array), `confidence: true` (boolean). Each variant MUST return `null` from `parse`. The test MUST also verify `parse` does NOT throw on any variant.

AC.05:derives=S003.§4.AC.02 A test `'S003.§4.AC.02: parse rejects malformed confidence string'` MUST exist with parametrized variants: `confidence: "X2 2026-05-05"` (non-emoji prefix), `confidence: "🤖 2026-05-05"` (missing level digit), `confidence: "🤖22 2026-05-05"` (multi-digit level), `confidence: "🤖2 not-a-date"` (regex still matches because the trailing capture is `(.+)` after `\s+`; verify the parsed date is `'not-a-date'` rather than a strict ISO check — the spec does NOT mandate ISO validation at parse). Variants whose payload regex does not match MUST return `null`; variants whose regex does match MUST return a payload, with the `date` field as captured (validation is the command layer's concern per {S003.§5.AC.03}).

AC.06:derives=S003.§4.AC.03 A `parse` line-number test MUST verify that the returned `line` is the 1-indexed line of the `confidence:` key within the source content. Inputs vary the position of `confidence:` within the frontmatter block (first key, middle key, last key) and verify each returns the correct line number.

AC.07:derives=S003.§4.AC.08 An idempotence test `'S003.§4.AC.08: insert is idempotent modulo trailing newline'` MUST verify that for each of the three insert cases (no frontmatter, frontmatter without key, frontmatter with key), `insert(insert(c, p), p)` byte-equals `insert(c, p)` modulo at most one trailing newline. The trailing-newline tolerance MUST be implemented by a custom equality predicate, not by string-trimming the comparison (so that other whitespace differences would fail).

AC.08:derives=S003.§4.AC.04 A `format` shape test MUST verify: `format('🤖', 2, '2026-05-05')` returns `'🤖2 2026-05-05'` (the bare payload value, no surrounding quotes, no `confidence:` prefix); `format('🤖', 2, undefined)` returns `'🤖2'` (no trailing space). YAML quoting MUST be `gray-matter`'s responsibility; the adapter MUST NOT pre-quote.

AC.09:derives=S003.§4.AC.02 An edge-case test `'S003.§4.AC.02: parse on malformed YAML returns null without throwing'` MUST exist. Input: a `.md` with malformed frontmatter (`---\nunclosed: "quote\n---\nbody`). Expected: `parse` returns `null`. The test MUST verify `gray-matter`'s underlying error is suppressed at the adapter boundary.

AC.10 An edge-case test `'S003 Edge case 2: insert on malformed YAML propagates error'` MUST exist. Input: same malformed frontmatter as AC.09. Expected: `insert(content, payload)` throws; the thrown error message includes the underlying `gray-matter` parse failure detail. This is the asymmetry {S003} Edge case 2 mandates: `parse` swallows; `insert` propagates.

## §5 Filter resolution tests (`filters.ts`)

Test cases for the filter resolver and the source-via-glob constraint. New file: `core/src/claims/confidence/__tests__/filters.test.ts`. Tests construct a fixture project (with `_scepter/` and source folders) per the existing `cross-project-commands.test.ts` pattern, then invoke `resolveFiles(pm, spec)`.

AC.01:derives=S004.§1.AC.02 An AND-across-categories OR-within-category test MUST exist with a fixture project containing notes typed Requirement/Spec/Decision and tagged security/migration/none. The test MUST exercise: `--types Requirement,Spec --tags security` returns "(Requirement OR Spec) AND tagged security"; `--types Requirement` returns all Requirements; `--tags security,migration` returns all notes tagged with either; combining `--types Requirement --tags security --ids R001` returns Requirement R001 only if it is also tagged security. Each combo MUST be a distinct `it` block with the AC ID prefix.

AC.02:derives=S004.§1.AC.03 A note-only-categories test MUST verify that `--types`, `--tags`, and `--ids` MUST NOT match source files. Fixture: a project with notes AND `.ts` files. Resolver invoked with each note-only filter independently MUST return only `ResolvedFile` entries with `scope: 'notes'` — never `'source'`.

AC.03:derives=S004.§1.AC.06 A glob-reaches-both test MUST verify that `--glob` is the only filter that can match source files. Fixture: a project with `_scepter/notes/reqs/R001 Foo.md` and `core/src/foo.ts`. `--glob '**/*.{md,ts}'` MUST return tuples for both, with `R001 Foo.md` tagged `'notes'` and `foo.ts` tagged `'source'`.

AC.04:5:derives=S004.§1.AC.04 A contradiction-error test MUST verify that a note-only filter combined with a source-only glob raises `FilterContradictionError`. Fixture: same as AC.03. Spec: `{types: ['Requirement'], glob: 'core/src/**/*.ts'}`. Expected: `resolveFiles` throws `FilterContradictionError`; the error message names both contributing filters and explains the contradiction (note-only categories cannot intersect a source-only glob). Importance 5: the contradiction error is the user-facing surface of the most subtle invariant in the filter system.

AC.05:derives=S004.§1.AC.05 A discoveryExclude/sourceCodeIntegration.exclude honor test MUST verify that files matching either exclusion pattern are omitted from the resolver's output, even when their paths would otherwise match a glob. Fixture: a `core/dist/foo.ts` (excluded by `sourceCodeIntegration.exclude`) and a `_scepter/notes/_archive/R999.md` (excluded by `discoveryExclude`). Both MUST be absent from the resolver's output for `--glob '**/*'`.

AC.06:derives=S004.§1.AC.06 A scope-tagging test MUST verify the classification rule: a file under `sourceCodeIntegration.folders` is `'source'`; a file under `discoveryPaths` is `'notes'`; a file matching both roots is `'notes'` (notes win the overlap). The test MUST construct a fixture where one path is reachable through both configs and verify the `'notes'` precedence.

AC.07:derives=S004.§1.AC.05 A glob-evaluated-from-project-root test MUST verify that `--glob '**/*.md'` is evaluated relative to the project root, not relative to the user's cwd or absolute paths. The test MUST run from a different cwd than the project root and confirm the glob still resolves correctly.

## §6 Audit tests

Tests for `auditConfidence` and the audit command. New file: `core/src/claims/confidence/__tests__/audit.test.ts` (library) and `core/src/cli/commands/confidence/__tests__/audit-command.test.ts` (command-level integration).

AC.01:derives=S004.§2.AC.02 A per-scope-independence test MUST verify that `--source-only` runs `discoverSourceFiles` and DOES NOT walk `discoveryPaths`; `--notes-only` walks `discoveryPaths` and DOES NOT call `discoverSourceFiles`. The test MUST spy on the discovery functions (or assert on the resulting file paths) to confirm cross-consultation does not occur.

AC.02:derives=S004.§2.AC.05 A `bySource`/`byNotes` substructure test MUST verify that the returned `ConfidenceAuditResult` carries both substructures, each with all six fields (`total`, `annotated`, `unannotated`, `byLevel` mapping `1-5` to counts, `files`, `unannotatedFiles`). When a scope is unrun (because of `--source-only` or `--notes-only`), the unrun scope's substructure MUST be zero-valued, NOT `undefined` (per {DD017.DC.09}).

AC.03:derives=S004.§2.AC.09 A top-level union test MUST verify that the result's top-level `total === bySource.total + byNotes.total`; `annotated === bySource.annotated + byNotes.annotated`; `unannotated === bySource.unannotated + byNotes.unannotated`; `byLevel[N] === bySource.byLevel[N] + byNotes.byLevel[N]` for each level 1-5; `files === [...bySource.files, ...byNotes.files]` (order-tolerant set equality acceptable); `unannotatedFiles` similarly.

AC.04:derives=S004.§2.AC.03 A mutual-exclusivity error test MUST verify that the audit command rejects `--source-only --notes-only` simultaneously with a clear error and non-zero exit, BEFORE any discovery runs (verified by spying on the discovery functions and asserting they were NOT called).

AC.05:5:derives=S004.§2.AC.10 A `--paths` plaintext-friendly test MUST verify the output format. Setup: a fixture project with two annotated files and one unannotated file. Invoke `audit --paths` with `process.stdout.isTTY` mocked to `false`. Expected: output groups files by directory (one block per directory, lexicographically sorted); within each block, files are listed alphabetically with their annotation string or the literal `unannotated`; output contains NO ANSI escape codes (verified via `expect(output).not.toMatch(/\x1b\[/)`); output contains NO box-drawing characters (verified via a regex matching the Unicode box-drawing range). Importance 5: the `--paths` output is the user-facing surface of the audit-export workflow; ANSI leakage breaks downstream `grep`/`awk` consumers.

AC.06:derives=S004.§2.AC.10 A `--paths` compatibility test MUST verify that `--paths` works in combination with `--source-only`, `--notes-only`, `--unannotated`, and `--level`. Each combo MUST be a distinct `it` block: `--paths --source-only` shows only source files in the breakdown; `--paths --notes-only` shows only notes; `--paths --unannotated` lists only unannotated files; `--paths --level 4` lists only level-4-annotated files.

AC.07:derives=S004.§2.AC.09 A library-API backward-compat test MUST verify that an existing programmatic consumer reading only `result.byLevel`, `result.total`, `result.files`, and `result.unannotatedFiles` continues to function after the additive `bySource`/`byNotes` substructures are introduced. The test MUST construct a fake "legacy consumer" function that reads only the top-level fields and confirm it produces the same output it would have produced under the pre-{R013} `auditConfidence`.

AC.08:derives=S004.§2.AC.04 A `getAdapter`-null-skip test MUST verify that files for which `getAdapter` returns `null` are omitted from the audit (neither annotated nor unannotated counts include them). Fixture: a project with one `.txt` file (no adapter) and one `.ts` file (has adapter). The audit's `total` MUST be 1, not 2; the `.txt` file MUST NOT appear in `unannotatedFiles`.

AC.09:derives=S004.§2.AC.07 A formatter per-scope-section test MUST verify that when both scopes have populated results, the table-format output emits two clearly-delimited sections (each with header, totals, percentage, per-level breakdown), followed by a combined-totals line that does NOT compute a combined percentage. When `--source-only` or `--notes-only` is set, only the requested scope's section MUST be emitted and the combined-totals line MUST be omitted.

## §7 Mark tests

Tests for the refactored `mark` command. New file: `core/src/cli/commands/confidence/__tests__/mark-command.test.ts`.

AC.01:derives=S004.§3.AC.05 A source-file format-and-parse parity test MUST verify that for a `.ts` fixture, `mark` writes an annotation whose format string and re-parsed payload match the pre-{R013} implementation's output for the same inputs. The byte-identity bar applies to the format string and the parse-back outcome — NOT to the legacy after-`*/` insert position. The fixture MUST use a file with NO existing JSDoc (so branch (c) of {S003.§3.AC.05} applies and the legacy "insert at first line" behavior coincides byte-for-byte). Files WITH JSDoc are covered by §3.AC.01 (the corrected before-`*/` placement) and MUST NOT be byte-compared against the legacy output.

AC.02:derives=S004.§3.AC.04 A `.md` notes mark test MUST verify that `mark <file> human 4` on a `.md` fixture writes `confidence: "👤4 <today>"` to the frontmatter via the markdown adapter. Other YAML keys MUST be preserved byte-for-byte. The on-disk file MUST be parseable by `gray-matter` after the mark.

AC.03:derives=S004.§3.AC.01 A null-adapter error test MUST verify that `mark <file>.txt ai 2` exits non-zero with an error message containing (a) the file's path, (b) its extension `.txt`, (c) the supported adapter ids exposed by the registry (e.g., `markdown-frontmatter`, `c-family-comments`). The test MUST verify NO file write occurred (the `.txt` file's contents MUST be byte-identical before and after).

AC.04:derives=S004.§3.AC.02 A validation-before-adapter test MUST verify that an invalid reviewer/level combo (e.g., `mark file.ts ai 5`) exits non-zero with a validation error and that NO call to `getAdapter`, `adapter.parse`, or `adapter.insert` occurs. The test MUST spy on `getAdapter` (or use a registry double) to confirm zero calls. AI levels valid only 1-3; Human levels valid only 3-5 (per {S003.§5.AC.03} and the existing `validateReviewerLevel` table at `core/src/claims/confidence.ts:199-213`).

AC.05:derives=R013.§1.AC.06,S004.§3.AC.03 An `includeDate: false` test MUST verify that with `claims.confidence.includeDate: false` configured, `mark file.ts ai 2` writes `// @confidence 🤖2` (no trailing space, no date). The test MUST verify the file contents byte-for-byte. With `includeDate: true` (or `undefined`, the default), the same invocation writes `// @confidence 🤖2 2026-05-05` (or whatever the test's frozen date is).

AC.06:derives=S004.§3.AC.06 A command-owns-I/O test MUST verify that `mark`'s implementation calls `fs.writeFile` exactly once after `adapter.insert` returns and that the adapter is NOT passed a filesystem handle. The test MUST inspect the mark command's call sequence (read → adapter.insert → write) by spying on `fs` and the adapter.

## §8 Apply tests

The largest test surface in the command layer. New file: `core/src/cli/commands/confidence/__tests__/apply-command.test.ts`.

AC.01:derives=S004.§4.AC.03,S004.§4.AC.04,DD017.DC.23 An action-classification test MUST exhaustively verify the action assigned to each combination of (existing annotation, `--skip-annotated`, `--overwrite`):

| Existing annotation | --skip-annotated | --overwrite | Expected action |
|---|---|---|---|
| Absent | true (default) | false | `mark` |
| Absent | false | false | `mark` |
| Absent | true | true | `mark` |
| Present | true (default) | false | `skip-annotated` |
| Present | false | false | `mark` (skip-annotated suppressed) |
| Present | (any) | true | `replace` (overwrite suppresses skip-annotated) |
| Adapter null | (any) | (any) | `skip-unmatched` |
| `adapter.insert` throws | (any) | (any) | `failed` |

Each row MUST be a distinct `it` block. The test MUST verify the action label in the output (dry-run plan or verbose post-execute table).

AC.02:5:derives=S004.§4.AC.05 A dry-run accuracy test MUST verify that the `--dry-run` plan predicts the wet-run outcome exactly across a fixture of 20 files of mixed shape (notes and source) and mixed annotation state (annotated and unannotated). For each file, the dry-run's `action` column MUST match the action that a wet run would actually take (verified by running the wet run with `--dry-run` removed against a fresh copy of the fixture and comparing). Importance 5: dry-run is the user's safety surface for bulk apply; divergence from wet-run reality is a high-impact correctness defect.

AC.03:derives=S004.§4.AC.02 A no-filters error test MUST verify that `apply human 4` (no filter flags) exits non-zero with a "no filters supplied" error and writes NO files.

AC.04:derives=S004.§4.AC.09 A zero-matches-with-filters test MUST verify that `apply human 4 --types Requirement --tags nonexistent` (filters present, but no notes match) exits with status 0 and emits a "no files matched" message. NO files MUST be written. This test MUST be paired with AC.03 to confirm the two cases are distinguished — same fixture, same exit-status assertions, different error messages.

AC.05:derives=S004.§4.AC.07 A per-file failure isolation test MUST verify that with a fixture containing one `.md` file with malformed frontmatter and three `.md` files with valid frontmatter, `apply human 4 --glob '**/*.md'` continues across the valid files (writing annotations to all three) AND records the malformed file under `failed` AND exits non-zero. The test MUST verify (a) the malformed file's contents are unchanged on disk, (b) the three valid files have annotations written, (c) the summary output shows `failed: 1` and `marked: 3`, (d) exit status is non-zero.

AC.06:derives=S004.§4.AC.04,R013.OQ.02 An overwrite-permits-downgrade test MUST verify that `apply ai 2 --types Requirement --overwrite` on a Requirement annotated `👤4 2026-05-04` writes `🤖2 2026-05-05` (downgrade from human 4 to AI 2). The test MUST verify the on-disk content reflects the downgrade. Per {R013.OQ.02}'s default assumption, no `--no-downgrade` guard exists.

AC.07:derives=S004.§4.AC.06 A `skipped-unmatched` reporting test MUST verify that with a fixture containing a `.txt` file matched by `--glob '**/*.{txt,md}'`, the `.txt` file is recorded under `skipped-unmatched` (not `failed`); the `.md` files in the same glob proceed normally; the run does NOT abort; the per-file count of `skipped-unmatched` appears in the summary output.

AC.08:derives=S004.§4.AC.08 A `--verbose` output-shape test MUST verify that non-dry-run output WITHOUT `--verbose` emits only the five-counter summary, and with `--verbose` adds the per-file plan table. The plan table's columns MUST be `path`, `scope`, `current`, `proposed`, `action`. The action vocabulary MUST be exactly `mark`, `replace`, `skip-annotated`, `skip-unmatched`, `failed` (per {DD017.DC.37}).

AC.09:derives=R013.§1.AC.06,S004.§3.AC.03 An `includeDate: false` apply test MUST verify that with `claims.confidence.includeDate: false`, `apply human 4 --types Requirement` writes `confidence: "👤4"` (no trailing space, no date) to each matched note's frontmatter. The same invocation with `includeDate: true` (or `undefined`) writes `confidence: "👤4 2026-05-05"`.

AC.10:derives=S004.§1.AC.04 A filter-contradiction-surfaced-as-usage-error test MUST verify that `apply ai 2 --types Requirement --glob 'core/src/**/*.ts'` exits non-zero and emits an error message naming both the note-only filter and the source-only glob (per `FilterContradictionError`'s message contract from {DD017.DC.04}). NO files MUST be written.

## §9 Auto-insert hook tests

Tests for the `NoteManager.createNote` auto-insert hook. New file: `core/src/notes/__tests__/auto-insert-hook.test.ts` (the directory is created if absent — currently no `__tests__` exists under `core/src/notes/`; this is an additive structural change, not a deviation from convention).

AC.01:derives=S004.§5.AC.01 A creation-time annotation test MUST verify that with `claims.confidence.autoInsert: true` (default), `noteManager.createNote({type, title, ...})` returns a Note AND the on-disk file has `confidence: "🤖2 <today>"` in its frontmatter. The today value MUST be the test's frozen date (injected via dependency or by mocking `Date`).

AC.02:derives=S004.§5.AC.01 An idempotence-on-double-create test MUST verify that creating a note, then... the test framework cannot create the same ID twice, so this test instead verifies that calling `maybeAutoInsertConfidence` directly TWICE on the same note path yields one annotation, not two. The on-disk content after the second call MUST byte-equal the on-disk content after the first call (per {S003.§4.AC.08}'s frontmatter idempotence).

AC.03:5:derives=S004.§5.AC.03 A template-precedence test MUST verify that when the note's template (or template variables) supplies an explicit `confidence: "👤4 2026-05-05"` value, the auto-insert hook DOES NOT overwrite it. The on-disk file MUST contain the template value (`👤4 2026-05-05`), NOT the hook's default (`🤖2 <today>`). The hook's `parse` call MUST return the template's annotation, triggering the early-return path. Importance 5: the template-precedence rule is the explicit user-control surface; failure here would silently overwrite reviewed annotations.

AC.04:derives=S004.§5.AC.04 An `autoInsert: false` no-op test MUST verify that with `claims.confidence.autoInsert: false`, `createNote` produces a note with NO `confidence:` key in its frontmatter. The test MUST also verify that `getAdapter` is NOT called during the createNote flow (spy on the registry export). NO `parse`, NO `insert` calls.

AC.05:derives=S004.§5.AC.05 A null-adapter silent-no-op test MUST verify that when `getAdapter(notePath)` returns `null` (synthesized by stubbing the registry to return null for the test's note path), `createNote` returns the Note successfully WITHOUT throwing. NO error is raised; NO warning is emitted; NO annotation is added.

AC.06:5:derives=S004.§5.AC.06 A failure-isolation test MUST verify that when `adapter.insert` throws (synthesized by mocking the markdown-frontmatter adapter to throw for this test), `createNote` returns the Note successfully (the user's primary intent is unblocked). The test MUST verify (a) the Note return value is well-formed, (b) the on-disk file exists at the expected path with the template's content but WITHOUT the auto-inserted annotation, (c) a warning event is emitted on `NoteManager`'s warning channel containing the underlying error message and the note path. Importance 5: this is the contract that prevents auto-insert defects from blocking note creation.

AC.07:derives=R013.§1.AC.06 An `includeDate: false` auto-insert test MUST verify that with `claims.confidence.includeDate: false` and `autoInsert: true`, the new note's frontmatter contains `confidence: "🤖2"` (no date, no trailing space). The default (`includeDate: true` or undefined) writes `confidence: "🤖2 2026-05-05"`.

AC.08:derives=S004.§5.AC.07 A hook-scope test MUST verify that the auto-insert hook fires ONLY from `createNote`. The test MUST exercise other note-mutation paths (`updateNote`, `archiveNote`, `deleteNote`, `renameNote` — whichever exist on `NoteManager`) and verify (via a spy on `getAdapter` or the hook's internal state) that NONE of those paths invoke the hook. The test MUST also verify that the hook is NOT triggered by source-file creation paths (none exist in the project today; this is asserted as "no source-file creation symbol invokes the hook" rather than as a runtime call).

## §10 Cross-cutting invariant tests

Tests for the cross-cutting invariants in {S003.§5}. These tests MAY live in the per-adapter test files (one assertion per adapter) or in a dedicated `cross-cutting.test.ts` file under `core/src/claims/confidence/__tests__/`. The plan does not mandate the file split; the tests must exist somewhere in the new test surface.

AC.01:derives=S003.§5.AC.04 A side-effect freedom test MUST verify that `parse` and `insert` produce no FS writes (spy on `fs.writeFile`, `fs.appendFile`, `fs.unlink` during adapter operations and assert zero calls) and no module-state mutation (the registry's exported state MUST be byte-identical before and after a sequence of adapter operations). The test MUST run for both the C-family adapter and the frontmatter adapter.

AC.02:derives=S003.§5.AC.02 A date verbatim round-trip test MUST verify that `insert(c, {reviewer, level, date: '2024-12-31'})` followed by `parse(...)` returns a payload with `date === '2024-12-31'` byte-identically. The adapter MUST NOT normalize, reformat, or canonicalize the date string. Variants exercise valid ISO dates, dates outside the current year, and the boundary date `'1970-01-01'`.

AC.03:derives=S003.§5.AC.03 An adapter-validation-absent test MUST verify that `adapter.format('🤖', 4, '2026-05-05')` does NOT throw, even though AI level 4 is invalid at the command layer. The adapter accepts the out-of-range payload and returns the formatted string. Conversely, the test MUST verify that `mark file.ts ai 4` (the same payload at the command layer) DOES throw — validation is enforced at the command layer per {DD017.DC.16}, not at the adapter.

AC.04 A reviewer/level validation table test MUST verify that `validateReviewerLevel` accepts AI levels 1-3, rejects AI levels 4-5, accepts Human levels 3-5, and rejects Human levels 1-2. The existing tests at `confidence.test.ts:262-286` cover this surface and MUST be retained verbatim under their new home at `core/src/claims/confidence/__tests__/validation.test.ts` (per {DD016.§9}).

## §11 Test execution and verification gates

AC.01 The full test suite MUST be invocable via `npm test` from the project root, which runs `cd core && vitest` per `package.json`. Confidence-subsystem tests MUST run as part of the default test selection (no separate config or filter required to include them).

AC.02 The exit-status contract: a passing test run exits 0; any failed test exits non-zero. Pre-commit hooks invoking `npm test` (or the project's `verify` gate) MUST fail the commit on non-zero exit. This plan does NOT introduce a custom verification gate; it relies on the project's existing test-script invocation.

## §12 Implied-human read-time policy tests ({R017})

The {R017} implied-human policy widens both adapters' parse grammars on the read path and threads a resolved `defaultReviewer` through the read-path consumers. {S003.§6}/{DD016.§10} own the adapter-layer mechanism (emoji-optional grammar, the OPTIONAL `parse` `defaultReviewer` parameter, frontmatter YAML-number coercion); {S004.§7}/{DD017.§8} own the command-layer half (the `claims.confidence.impliedHuman` config flag, its default-active resolution, the per-consumer threading, and the audit `byReviewer` tally). These tests extend the EXISTING confidence test files rather than adding new ones — the policy is an additive read-time behavior layered on the adapters and consumers TS001 §2-§11 already cover. {R017}, {S003}, {S004}, {DD016}, {DD017}, {T006} are the upstream authority.

### Adapter parse grammar (C-family and frontmatter)

AC.01:5:derives=S003.§6.AC.01 The C-family adapter test file (`core/src/claims/confidence/__tests__/c-family.test.ts`) MUST contain a describe block exercising the emoji-optional grammar with `{defaultReviewer: '👤'}`: a bare `// @confidence 4` MUST parse to reviewer `👤` at level 4; the JSDoc carrier form ` * @confidence 3` MUST parse to `👤`/3; and a bare digit at every level 1-5 MUST parse to `👤` at that level. Each case names {S003.§6.AC.01} / {S003.§6.AC.03}.

AC.02:derives=S003.§6.AC.05 The C-family test file MUST assert the inactive-policy outcome: a bare `// @confidence 4` parsed with NO options (and with `{defaultReviewer: null}`) MUST return `null` — today's behavior. This is the backward-compat opt-out at the adapter layer ({S003.§6.AC.05} / {DD016.§10.DC.51}).

AC.03:derives=S003.§6.AC.04 The C-family test file MUST assert that a bare digit followed by an ISO date (`// @confidence 4 2026-05-31`) parses to `👤`/4 dated under the active policy, and that explicit `🤖2`/`👤4` annotations parse UNCHANGED with and without options (the explicit-emoji regression, {S003.§6.AC.02} / {S003.§6.AC.06}).

AC.04:5:derives=S003.§6.AC.08 The markdown-frontmatter test file (`core/src/claims/confidence/__tests__/markdown-frontmatter.test.ts`) MUST contain a describe block covering: a YAML **string** `confidence: "4"` with policy active → `👤`/4; an unquoted YAML **number** `confidence: 4` with policy active → `👤`/4 via the YAML-integer coercion ({S003.§6.AC.08} / {DD016.§10.DC.53}); both the string and number forms with NO options → `null`; and the bare-digit-plus-date string `confidence: 4 2026-05-31` → `👤`/4 dated ({S003.§6.AC.04}).

AC.05:derives=S003.§6.AC.08 The markdown-frontmatter test file MUST assert that out-of-range integers (`confidence: 6`, `confidence: 0`), a non-integer (`confidence: 4.5`), and YAML object / array / boolean confidence values all return `null` under BOTH policy states, and that explicit `🤖2`/`👤4` parse unchanged with and without options ({S003.§6.AC.02} / {S003.§6.AC.06} / {DD016.§10.DC.52}).

AC.06:derives=S003.§6.AC.07 Both adapter test files MUST assert no validation coupling: a bare `1` and a bare `2` — levels below the writer-side human range 3-5 — MUST still parse to `👤` under the active policy. Parse MUST NOT consult the reviewer/level range table ({S003.§6.AC.07} / {DD016.§10.DC.54}).

### Command-layer consumers (audit, apply, auto-insert)

AC.07:4:derives=S004.§7.AC.04 The audit test file (`core/src/claims/confidence/__tests__/audit.test.ts`) MUST assert that with `impliedHuman` active, a source file carrying a bare-digit confidence annotation counts as `annotated` (not `unannotated`) and its level lands in `byLevel`; and that with `impliedHuman` inactive the same bare-digit file counts `unannotated` ({S004.§7.AC.04} / {DD017.§8.DC.41}).

AC.08:4:derives=S004.§7.AC.05 The audit test file MUST assert that a bare-digit annotated file increments `byReviewer['👤']`, that `byReviewer` is summed across scopes in the top-level union, and that `byReviewer` is zero-initialized (`{ '🤖': 0, '👤': 0 }`) on every scope substructure of a run with no annotations ({S004.§7.AC.05} / {DD017.§8.DC.40}).

AC.09:derives=S004.§7.AC.06 The confidence-formatter test file (`core/src/cli/formatters/__tests__/confidence-formatter.test.ts`) MUST assert that `renderScopeSection` emits the per-reviewer breakdown (a "By reviewer:" block with human/AI counts) per scope, and that the `--format json` path carries the additive `byReviewer` field at every scope ({S004.§7.AC.06} / {DD017.§8.DC.42}). The hand-rolled `ScopedAuditResult` fixtures in this file MUST include the `byReviewer` field so `renderScopeSection` does not throw.

AC.10:derives=S004.§7.AC.07 The apply command test file (`core/src/cli/commands/confidence/__tests__/apply-command.test.ts`) MUST assert that with `impliedHuman` active, `apply --skip-annotated` classifies a file carrying a bare digit as `skip-annotated` and leaves it byte-identical on disk; and that with `impliedHuman` inactive the same file classifies `mark` (bare digit unrecognized) ({S004.§7.AC.07} / {DD017.§8.DC.44}).

AC.11:derives=S004.§7.AC.08 The auto-insert hook test file (`core/src/notes/__tests__/auto-insert-hook.test.ts`) MUST assert that with `impliedHuman` active, a new note pre-seeded with a bare-digit `confidence` value is NOT overwritten by the auto-insert default — the precedence parse returns non-null, so the hand-typed bare digit survives and the `🤖2` default is not written ({S004.§7.AC.08} / {DD017.§8.DC.45}).

### Configuration default

AC.12:4:derives=S004.§7.AC.02 The config-validator test file (`core/src/config/config-validator.test.ts`) MUST assert that `claims.confidence.impliedHuman` is accepted as a boolean and rejected as a non-boolean, and — mirroring the `includeDate` default coverage — that the parsed `impliedHuman` value defaults to `true` when the confidence block omits it (asserted against the Zod schema directly) while an explicit `false` survives the default ({S004.§7.AC.01} / {S004.§7.AC.02} / {DD016.§10.DC.55}).

## Decisions

### Decision 1 — Fixture organization: per-section fixtures, not one shared tree

**Decision:** Each test section (§3, §4, §6, §8, etc.) maintains its own fixture subdirectory under `core/src/claims/__tests__/fixtures/confidence/<section>/`. Fixtures are NOT shared across sections.

**Alternatives considered:**
- **One shared fixture tree.** Faster setup, smaller repo footprint. Rejected because changes to one section's tests can inadvertently invalidate another section's fixtures, producing distant test failures whose root cause is hard to trace.
- **Inline content only, no fixture files.** Maximum locality; rejected because the C-family adapter's three branches and the frontmatter adapter's three insert cases each have multiple shape variants; inlining all of them clutters the test bodies and obscures the assertions.

**Rationale:** Per-section fixtures balance locality (each section owns its data) against duplication (some shapes appear in multiple sections, but the duplication is small and keeps section coupling minimal). The fixture directory grows with the test surface; if duplication becomes painful, a future refactor can extract a `shared/` subdirectory.

### Decision 2 — Mocking strategy: spy on `process.stdout.isTTY` and on `getAdapter`/`adapter.insert` for failure-isolation tests; do not mock `gray-matter`

**Decision:** Use `vitest.spyOn` (or `vi.spyOn`) for `process.stdout.isTTY` (set/restore in `beforeEach`/`afterEach`) and for the registry's `getAdapter` and an adapter's `insert` method when the test specifically synthesizes a null-return or throw. Do NOT mock `gray-matter` — its real behavior is what we are testing through the frontmatter adapter.

**Alternatives considered:**
- **Mock `gray-matter` to control parse/stringify behavior.** Rejected because the frontmatter adapter's contract IS its `gray-matter`-mediated behavior (per {DD016} Decision 4 — `gray-matter` is the single source of truth for frontmatter handling). Mocking it would test a contract we don't ship.
- **Pure behavioral testing without spies.** Rejected for the failure-isolation cases — the only way to synthesize a malformed-YAML throw deterministically is to mock the adapter. The alternative (handcrafting a malformed YAML file that `gray-matter` reliably throws on) couples the test to `gray-matter`'s internal error conditions, which can change across versions.

**Rationale:** Mock at the seam (registry, adapter method) rather than inside the adapter's body. The mock is narrow and per-test; the adapter's real behavior is exercised in every other test.

### Decision 3 — Existing `confidence.test.ts` is fully replaced, not interleaved

**Decision:** The existing `core/src/claims/__tests__/confidence.test.ts` (312 lines) is DELETED in the same change-set that lands the adapter package. Its test cases are redistributed per {DD016.§9}'s mapping (parse and validation cases byte-for-byte; insert cases revised). No legacy file remains alongside the new files.

**Alternatives considered:**
- **Keep `confidence.test.ts` as a smoke suite with the new files added.** Faster to land; rejected because the legacy file imports from the soon-to-be-deleted `core/src/claims/confidence.ts`. After the package split, the legacy import path no longer exists and the file would fail to compile.
- **Update the legacy file in place to import from the new package barrel.** Rejected because the file's organization (one describe per legacy free function: `parseConfidenceAnnotation`, `formatConfidenceAnnotation`, `insertConfidenceAnnotation`) does not map cleanly to the adapter shape (one describe per operation per adapter). Re-homing is the natural reorganization.

**Rationale:** The legacy file's structure is a mismatch for the adapter-shape test organization. Deleting it and rebuilding under the new structure is cleaner than incremental edits and matches {DD016.§9}'s explicit re-homing instruction.

## Acceptance Criteria Summary

| Section | Count |
|---------|-------|
| §1 Test infrastructure | 5 |
| §2 Adapter interface and registry | 8 |
| §3 C-family adapter | 10 |
| §4 Markdown frontmatter adapter | 10 |
| §5 Filter resolution | 7 |
| §6 Audit | 9 |
| §7 Mark | 6 |
| §8 Apply | 10 |
| §9 Auto-insert hook | 8 |
| §10 Cross-cutting invariants | 4 |
| §11 Test execution | 2 |
| §12 Implied-human read-time policy ({R017}) | 12 |
| **Total** | **91** |

## Non-Goals

- **End-to-end CLI tests** that spawn `scepter` as a subprocess and parse stdout. Integration tests against the command-action body (calling the handler directly with a constructed `ProjectManager`) provide the same coverage at lower cost.
- **Performance benchmarks.** Apply over thousands of files is out of scope; the chosen sequential model per {DD017} Decision 3 is reversible if profiling later motivates parallelism.
- **VS Code extension tests.** The confidence subsystem is core-only.
- **Byte-identity contract for the legacy after-`*/` insert position.** {S003.§3.AC.05} corrects the placement; {DD016.§9.DC.47} preserves only the parse-side compatibility, not the insert-side legacy behavior.
- **Migration-script tests.** The migration from `confidence.ts` to `confidence/` is a code change, not a runtime feature; it is verified by the broader test suite continuing to pass after the change-set lands.
- **Third-party adapter registration tests.** The extension hook is informative in {S003.§2}; no claim is bound by it.
- **Audit output persistence tests.** Audit results are not stored to disk; nothing to test.

## References

- {R013} — Source requirement: pluggable confidence adapters and bulk apply across notes and source.
- {R013.§1.AC.06} — `claims.confidence.includeDate` config flag.
- {R013.§3.AC.05} — Source files unreachable via `--types`/`--tags`/`--ids` (filter constraint).
- {R013.OQ.02} — `--overwrite` permits downgrade (open question default assumption).
- {S003} — Adapter registry specification.
- {S003.§1} — Adapter interface contract.
- {S003.§2} — Registry mechanics and `getAdapter`.
- {S003.§3} — C-family adapter (including the §3.AC.05 three-branch insert correction and §3.AC.06 legacy-parse backward-compat).
- {S003.§4} — Markdown frontmatter adapter.
- {S003.§5} — Cross-cutting invariants.
- {S003.§6} — Implied-human read-time parse grammar ({R017}): the emoji-optional grammar in both adapters, the `parse` `defaultReviewer` parameter, and the frontmatter YAML-number coercion. §12 verifies this surface.
- {S004} — Command surface and creation hook specification.
- {S004.§1} — Filter semantics (cross-cutting).
- {S004.§2} — `confidence audit` multi-scope.
- {S004.§3} — `confidence mark` adapter routing.
- {S004.§4} — `confidence apply` bulk command.
- {S004.§5} — Auto-insert on note creation.
- {S004.§7} — Implied-human policy ({R017}): the `impliedHuman` config flag, its default-active resolution, the read-path consumer threading, and the audit `byReviewer` tally. §12 verifies this surface.
- {R017} — Implied-human read-time confidence defaulting; the requirement §12 verifies. Origin task {T006}.
- {DD016} — Adapter registry implementation; §9 mandates the test re-homing and the new C-family/frontmatter/registry test cases.
- {DD016.§9.DC.46-49} — Explicit test-case enumeration for C-family insert, legacy parse compat, frontmatter coverage, and registry lookup.
- {DD016.§10.DC.50-55} — Adapter-layer implementation of {R017}: the emoji-optional regexes, the `parse` `defaultReviewer` parameter, the frontmatter YAML-number coercion, the reaffirmed validation boundary, and the `impliedHuman` config slot. §12 verifies these DCs.
- {DD017} — Command surface implementation; §2-§7 enumerate the DCs whose tests this plan covers.
- {DD017.§8.DC.40-45} — Command-layer implementation of {R017}: the `byReviewer` audit tally, the flag resolution, and the `defaultReviewer` threading into the audit, apply, and auto-insert read-path consumers. §12 verifies these DCs.
- {T006} — Origin task for {R017}: the scoping note carrying the design, decisions, and code touch-points.
- `core/src/claims/__tests__/confidence.test.ts` — Existing 312-line test file; deleted and re-homed per Decision 3 and {DD016.§9}.
- `core/src/cli/commands/__tests__/cross-project-commands.test.ts` — Command-level integration test pattern this plan follows for fixture-based testing under `.test-tmp/`.
- `core/package.json` (root: `/Users/way/Projects/scepter/package.json`) — Test runner script (`npm test` → `cd core && vitest`); `vitest@^3.2.4` dependency.
