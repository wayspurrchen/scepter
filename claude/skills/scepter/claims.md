# SCEpter Claims System

**Load this file when you encounter claim IDs, produce documents with claims, or validate claim traceability.** Requires `@scepter` loaded first.

Claims connect ideas *within* documents. They enable mechanical traceability ("does R001.§2.AC.03 have an implementation?"), gap detection, precise code annotations, and staleness tracking. Prefer `{R004.§1.AC.03}` over `{R004}` when you know the specific criterion.

---

## Nature and Purpose of Claims (READ FIRST)

A claim is **a statement with a subject, a predicate, and a modal status**. The modal status is constitutive: "the DC has four methods" (IS) and "the DC SHOULD have four methods" (SHOULD) are different information requiring different operations. See `epistemic-primer.md` in this skill directory for the vocabulary framework. This section covers the practical consequences for writing and tracking claims in SCEpter.

### Claims manifest across projections

A claim is not a document artifact or a code artifact — it's an assertion that manifests across projections. A single claim — "autoWire runs during bind()" — appears as a responsibility boundary at the architecture projection, as a lifecycle contract at the specification projection, as a callsite at the implementation projection, as a test assertion at the verification projection. These are all equally valid expressions of the same claim through different cognitive modes. No projection is primary.

An `@implements` annotation is the implementation projection's expression of a claim. A `@validates` annotation is the test projection's expression. The claim text in a requirement document is the intent projection's expression. The trace matrix tracks which claims have expressions at which projections. No single expression exhausts the claim — and the presence of an expression at one projection tells you nothing about whether the claim has been expressed (or correctly expressed) at others.

### Claims change scope across projections

A requirement-level claim like "autoWire runs during bind()" is naturally compound — it expresses intent without decomposition. This is appropriate at the intent projection. But as claims flow into design and specification, they are derived, decomposed, and concretized into narrower assertions, each expressible through a single cognitive mode. The same claim that was one AC at the requirement level may become three DCs at the design level: one for the algorithm, one for the lifecycle callsite, one for the config surface.

This is normal and expected. The derivation operations (decompose, concretize, elaborate — see `epistemic-primer.md` §5) are how claims become tractable at more concrete projections. A claim that resists decomposition at the design level — that still bundles multiple kinds of assertions — is a compound claim, and compound claims are the primary source of traceability gaps. When an agent annotates `@implements` on a component that satisfies one aspect of a compound claim, the trace matrix shows coverage while the other aspects remain unrealized.

### Working with claims: guidelines

**Modal character matters.** Claims assert different kinds of things, and each kind has a different confirmation mode:

| Character | What it asserts | Example | How it's confirmed | Annotation |
|-----------|----------------|---------|-------------------|------------|
| **Existence** | "X must exist" | "A companion field must be auto-created" | Inspect the component | `@implements` |
| **Behavior** | "X must do Y when Z" | "addField must return a pure function" | Inspect the component or test it | `@implements` / `@validates` |
| **Integration** | "X must be invoked from Z" | "autoWire must run during bind()" | Inspect the callsite, not the component | `@implements` at the callsite |
| **Constraint** | "X must NOT do Y" | "Must NOT run migrations on startup" | Confirm absence; test for it | `@validates` in a test |
| **Ordering** | "X before Y" | "Schema tx before instance batches" | Inspect the orchestrator or test the sequence | `@validates` in a test |
| **Invariant** | "P must always hold" | "Every query must filter by schemaId" | Test at every boundary that could violate it | `@validates` in tests |

For constraint, ordering, and invariant claims — where absence or sequence is the assertion — use `scepter claims verify` to record confirmation:

```bash
scepter claims verify ARCH017.§11.AC.62 --actor "dev" --method "code-review"
scepter claims verify ARCH017.§11.AC.64 --actor "dev" --method "integration-test"
```

**Decompose when a claim bundles different modal characters or projections.** Common compound patterns:
- **"X must exist AND be called from Y"** — existence + integration (different projections)
- **"X must do Y AND not do Z"** — behavior + constraint (different confirmation modes)
- **"X must be configurable AND have default D"** — capability + initialization (often different files)
- **"X must do Y before Z"** — behavior + ordering (component vs orchestration)

These need separate derived claims because they're confirmed through different modes. The signal to watch for: if `@implements` would go on multiple files for different *reasons*, each reason is a separate claim. The failure mode when compound claims survive into implementation is the **standalone implementation trap**: an agent builds and annotates the capability half, the trace matrix shows coverage, and the integration or constraint half is never realized because the trace already looks green.

**Never express a requirement as a consequence of a mechanism.** A common compound pattern that doesn't look compound:

- **"X is achieved by Y"** — invariant + mechanism (different survival conditions)

The requirement (what must hold) and the mechanism (how it currently holds) have different lifetimes. If the mechanism changes, the requirement must still be independently tracked. The diagnostic: **if the claim contains "because," "since," "automatically," or "through" followed by an implementation detail, the thing it serves should be its own claim.**

Wrong — requirement hidden inside mechanism:
```markdown
DC.42 SnapshotFieldDef MUST include shape, versioned, and companionFieldName
properties. __SchemaSnapshot payloads capture all FieldDefinition properties —
adding these fields preserves historical shapes automatically through the
snapshot chain without additional storage mechanisms.
```

If someone later changes snapshots to selectively capture properties, the requirement ("historical shapes must be preserved") has no independent expression. The trace matrix shows DC.42 covered by the SnapshotFieldDef type definition, but the invariant it was meant to protect is invisible.

Right — requirement and mechanism as separate claims:
```markdown
DC.42 Schema snapshots MUST preserve blob shape metadata at every historical
point. A snapshot from any point in history MUST be sufficient to reconstruct
the shape contract that was active at that time.

DC.43 SnapshotFieldDef MUST include shape, versioned, and companionFieldName
properties, read from FieldDefinition nodes during buildPayload(). This is the
current mechanism for satisfying DC.42.
```

Now if the mechanism changes, DC.42 still exists as a requirement that must be satisfied by whatever replaces it.

**Each step in a lifecycle or sequence diagram is a claim.** When a design document shows a numbered flow — "step 1: register schema, step 2: autoWire migrations, step 3: manual overrides" — each step asserts that something happens at that point in the sequence. If step 2 has no derived claim, no one tracks whether it was implemented.

**Binding assessment includes projection boundaries.** The file-count heuristic (4+ files → decompose) is useful but secondary. The stronger signal is whether the claim crosses projection boundaries — architecture and implementation assertions in the same claim need decomposition even if the total file count is low.

**The trace matrix tracks expressions, not truth.** An `@implements` annotation is one projection's expression of a claim. It tells you that someone wrote code they believe realizes it. It does not tell you whether the claim is fully realized, correctly realized, or realized at other projections. Well-decomposed claims reduce the gap between "expression exists" and "claim is fulfilled" — when each derived claim maps to a single assertion, the presence of an expression is stronger evidence.

**Unmarked claims are tentative by default.** A claim that carries no explicit origin marker, no recorded endorsement event, and no verification record is agent-drafted and unreviewed. Trust is elevated only by positive evidence: a recorded user-endorsement event, a mechanical verification (compilation, tests, reality-conformance), or derivation from a claim that itself meets those criteria. The polish of a document, the number of times a claim has been repeated in downstream artifacts, and the presence of `@implements` annotations are not evidence. This inverts the natural reading of prose — most writing asks to be read as "the author stands behind this"; SCEpter prose should be read as "someone wrote these words; trust is open until earned."

---

## Smuggling

**Smuggling** is the compounding pattern where agent-authored content is progressively treated as user-authored across sessions, compactions, and downstream documents. A chat paraphrase becomes a handoff's "user decided"; a handoff's "user decided" becomes a DD's scope statement; a DD's scope statement spawns test cases; the test cases carry `@implements` back to a claim the user never verified. Each step looks like ordinary carry-forward discipline; the cumulative effect is that the claim binds without the user ever having endorsed it.

It is one member of a broader class of failures where a label overstates what reality supports: stub `@implements` is the code variety (an annotation claims realization the code doesn't deliver); reality gaps are the primitive variety (a spec cites `EXTEND X` when X has no declaration); smuggling is the attribution variety (prose cites user authorization that no user action produced). The general principle: **a label is a factual claim, not a convenience marker.**

### Why it happens

Markdown prose does not distinguish speaker. "The user wants X" reads the same whether X was a verbatim request or an agent synthesis. Compaction flattens "user said X verbatim" into "user wants X" and loses the provenance. Each re-reading re-reifies the synthesis as record. Polished artifacts feel authoritative; repetition feels like ratification.

### Common vectors

- Compacted summaries or handoffs that paraphrase user intent without preserving verbatim quotes
- `@implements` annotations on agent-drafted claims the user never endorsed
- Scope paraphrases in DD §1 that read as user-approved but originate from agent synthesis
- "User approved X," "user agreed to Y," "as agreed" assertions in docs without citation
- A reviewer's conformance pass citing a claim as "acknowledged" when the acknowledgment was another agent's output, not a user action
- Re-reading your own prior turn's output and treating its attributions as established fact

### Read discipline

When reading a document that attributes positions, decisions, or endorsements to the user, treat each attribution as a claim expression that needs verifying. Acceptable verification sources:

- A verbatim user utterance in the current session
- `scepter claims verify` or trace records
- An explicitly user-authored note

In the absence of any of these, the attribution is synthesized — flag it or rewrite it with the actual source ("per the agent synthesis in the Apr 21 handoff...") rather than carrying it forward as user-sourced.

### Write discipline

When producing an artifact that cites user intent, include the source of each attribution inline with the attribution itself. `The user stated: "{verbatim quote}"` with a session or document reference is durable across compactions. `The user wanted {paraphrase}` without a source is durable-as-fiction.

### Review discipline

Treat attribution phrases as a class of claim that requires the same rigor as any technical assertion. See `reviewing.md` for the attribution-review check and `conformance.md` for attribution-conformance verification.

---

## Syntax & Rules

### Claim Reference Format

```
NOTE_ID . section_path . CLAIM_PREFIX.number
```

| Component | Pattern | Examples |
|-----------|---------|----------|
| Note ID | `[A-Z]{1,5}\d{3,5}` | `R004`, `S012` |
| Section path (optional) | Dot-separated numerics, `§` optional | `3`, `§3`, `3.1` |
| Claim ID | Letter prefix + `.` + number | `AC.01`, `SEC.03` |

Reference forms, from most to least explicit:

| Form | When to use | Example |
|------|-------------|---------|
| `NOTE.§N.PREFIX.NN` | Cross-document (preferred) | `R004.§3.AC.01` |
| `NOTE.PREFIX.NN` | Claim unique within note | `R004.AC.01` |
| `§N.PREFIX.NN` | Within same document | `§3.AC.01` |
| `PREFIX.NN` | Within same section, unambiguous | `AC.01` |

**Always use fully qualified form in code and cross-document references.** The `§` symbol is optional emphasis — `R004.§3.AC.01` and `R004.3.AC.01` parse identically.

### Range References

`AC.01-06` or `AC.01-AC.06` expands to `AC.01` through `AC.06`. Works at any qualification level: `R004.§1.AC.01-06`. Works in braced and braceless contexts. Start must be less than end; sub-letters not supported in ranges.

### Hard Rules

| Rule | Valid | Invalid |
|------|-------|---------|
| Dot is mandatory | `AC.01` | `AC01` (rejected by linter) |
| No hyphens | `AC.01` | `AC-01` (collides with JIRA) |
| Letter prefix required | `§3.AC.01` | `§3.01` (that's a section path) |
| § is for sections only | `§3.AC.01`, `§1.2` | `§AC.01` (§ on a claim prefix, not a section number) |
| Monotonic, never recycled | Sequential numbering | Reusing deleted IDs |

### Folder Notes and Claims

Folder-based notes (`R001 Title/R001.md` with companion `.md` files) are treated as a single logical document for claim purposes. All companion markdown files are aggregated with the main file — the claim index, linter, tracer, and gap detection operate on the unified content.

**What this means in practice:**
- Claims in companion files (e.g., `R001 Title/details.md`) are indexed under the parent note's ID. A claim `§2.AC.01` in `details.md` becomes `R001.§2.AC.01`.
- Section IDs and claim IDs must be unique across ALL files in the folder. If two sub-files both define `§3`, the linter reports a duplicate section error.
- Companion files are included in alphabetical order by filename. Authors control logical order by naming files accordingly (e.g., `01-core.md`, `02-extensions.md`).
- Frontmatter is stripped from companion files — only the main file's frontmatter is authoritative.
- Sub-files are NOT independently referenceable. `{R001}` references the folder note as a whole. There is no syntax for `{R001/details.md}`.

**When authoring claims in a folder note:** Distribute sections across sub-files as needed, but maintain globally unique section numbering. Run `scepter claims lint NOTEID` to verify there are no collisions.

### Metadata Suffix

Colon-separated items after the claim ID carry importance, lifecycle, and derivation data:

```
AC.01:4                            → importance 4
AC.01:closed                       → lifecycle: closed
AC.01:4:closed                     → importance 4 AND closed
DC.01:derives=R005.§1.AC.01        → derived from R005.§1.AC.01
DC.01:4:derives=R005.§1.AC.01      → importance 4, derived
§1.AC.04:superseded=R004.§2.AC.07  → replaced by another claim
```

Metadata can also appear at the end of a claim heading line:

```markdown
**MODE.01**: A three-state mode preference MUST be stored. :4
### DC.03:derives=R005.§1.AC.01 — CLI displays importance. :4
```

---

## Authoring Claims

### Claim Definition Formats

Claims are recognized in two structural positions:

**Heading-level** — a markdown heading starting with a claim pattern:
```markdown
### AC.01 The parser MUST extract section IDs.
### DC.01:derives=R005.§1.AC.01 — Derived claim with metadata.
```

**Paragraph-level** — a non-heading line starting with a claim pattern (bold wrapping optional):
```markdown
§1.AC.01 The parser MUST extract section IDs.
DC.01:derives=R005.§1.AC.01 An <AppShell> MUST wrap every route.
**GLYPH.01**: A `GlyphSet` type MUST be defined.
**AC.02** The system MUST support filtering.
```

**Sections are optional.** Claims without a containing `§N` section produce bare IDs (`GLYPH.01`) with fully qualified forms like `S004.GLYPH.01`. Common in specs where the prefix provides namespacing (e.g., `GLYPH.01`, `CASCADE.01`, `THEME.01`).

### Nesting: Claims Under Sections

When grouping claims under named sections, claims MUST be at a lower level — either `§`-prefixed paragraphs or headings one level deeper:

```markdown
### Layout Shell

DC.01:derives=ARCH015.§1.AC.01 An <AppShell> MUST wrap every route.
DC.02:derives=ARCH015.§1.AC.01 The <AppShell> MUST be a layout route.

### Sidebar

DC.04:derives=ARCH015.§1.AC.02 The loader MUST call getOptionalAuth().
```

Or with heading-level claims (when claims have substantial body text):
```markdown
### Layout Shell

#### DC.01:derives=ARCH015.§1.AC.01 — An <AppShell> MUST wrap every route.

The shell renders the header unconditionally...
```

**WRONG — claims and sections at the same heading level destroys hierarchy:**
```markdown
### Layout Shell
### DC.01:derives=ARCH015.§1.AC.01 — ...    ← parser sees this as a peer, not a child
```

**WRONG — bold text + code span is invisible to the parser:**
```markdown
**DC.01** `derives=ARCH015.§1.AC.01` — ...  ← not recognized as a claim
```

### Writing Acceptance Criteria

Each AC should be independently verifiable. Use MUST/SHOULD/MAY consistently (RFC 2119).

**Good**: "The parser MUST extract importance digits 1-5 from the metadata suffix."
**Bad**: "The system MUST handle metadata correctly."

### Choosing Claim Prefixes

The prefix signals what kind of claim it is. Common prefixes:

| Prefix | Use for | Typical context |
|--------|---------|-----------------|
| `AC` | Acceptance criteria | Requirements |
| `DC` | Design claims (derived) | Detailed designs |
| `SEC` | Security constraints | Requirements, specs |
| `PERF` | Performance constraints | Requirements, specs |
| `UI` | UI-specific criteria | Requirements, specs |
| `API` | API contract claims | Specifications |
| `OQ` | Open questions | Any document |

Don't use `AC` in a DD that decomposes requirement ACs — use `DC` to distinguish derived claims from source claims.

### Importance

Importance is a digit 1-5 in the metadata suffix (5 = most critical). Most claims need no annotation — aim for 10-20% of ACs per document.

**Importance 5** (1-3 per document): System identity (addressing schemes, ID formats, core invariants), security boundaries, data integrity invariants.

**Importance 4** (3-8 per document): High-binding claims (3+ projections, 4+ files across modules), contract boundaries (public APIs, CLI syntax), error handling at trust boundaries.

**Leave unannotated**: Single-module claims, display/formatting, recoverable defects, anything importance 1-3.

**Quick test**: (1) If this has a gap, what breaks? (nothing / one feature / multiple / security) (2) How many projections? (1-2 / 3-4 / 5+) (3) Inherent or contingent? (inherent anchors higher)

**Through derivation**: Source importance is a ceiling. Derived claims should not exceed their source.

### Derivation and Binding Assessment

When concretizing a requirement AC into a DD, first check the guidelines in "Nature and Purpose of Claims" above — projection boundaries and modal character are the primary decomposition signals. Then use file count as a secondary heuristic:

| Files touched | Modules | Action |
|---------------|---------|--------|
| 1-3 | 1 | **Pass through.** Use `@implements {SOURCE.§N.AC.NN}` directly. |
| 1-3 | 2+ | **Judgment call.** Pass through if tightly coupled; derive if independent. |
| 4+ | any | **Decompose.** Create derived claims with `derives=TARGET`. |

**Even at low file counts, decompose if the claim bundles assertions from different projections** — e.g., a capability (implementation projection) and a lifecycle callsite (architecture projection). See the decomposition triggers table above.

When decomposing, scope each derived claim to one module or concern:

```markdown
## §1 Metadata Parsing

Source: {R005.§1.AC.01} — high binding (parser + index + CLI + gap filter)

### DC.01:derives=R005.§1.AC.01 — Parser extracts importance from metadata suffix

The claim parser MUST recognize a bare digit 1-5...

### DC.02:derives=R005.§1.AC.01 — Index builder stores importance on ClaimIndexEntry

`ClaimIndex.build()` MUST propagate importance to the entry...
```

When passing through, reference the source AC directly:

```markdown
## §2 Range References

### AC.05 — Range expansion

Implements {R004.§1.AC.05} directly. The parser MUST expand `AC.01-06`
into individual references `AC.01` through `AC.06`.
```

Derivation rules:
- `derives=TARGET` is validated by the linter (TARGET must exist)
- Can combine with importance and lifecycle: `DC.01:4:closed:derives=R005.§1.AC.01`
- `derives` and `superseded` are mutually exclusive on the same claim

### Lifecycle Tags

Lifecycle tags go in the metadata suffix. Mutually exclusive — at most one per claim.

| Tag | Meaning | In gap reports |
|-----|---------|----------------|
| `:closed` | Gap resolved | Excluded (use `--include-closed`) |
| `:deferred` | Intentionally postponed | Excluded (use `--include-deferred`) |
| `:removed` | Claim retired; ID not reused (see "Removing Claims" below) | Excluded; linter warns if still referenced |
| `:superseded=TARGET` | Replaced by TARGET | Excluded; linter validates TARGET exists |

### Removing Claims

When a claim is retired via `:removed`, the original claim text MUST be replaced with `[Removed]` in the document. The claim ID line is retained (for parseability and to prevent ID reuse), but the substantive text is cleared so that invalid requirements are not mistaken for active ones.

```markdown
§5.AC.04:removed [Removed]
```

The ID stays (monotonic, never recycled). The text goes. A future reader sees that something was here, that it was removed, and doesn't waste time evaluating a dead claim. Any references to the removed claim in other notes or code should be updated or removed — the linter warns about these.

### Enumerating Projections

Before finalizing a requirement or DD, verify every visible projection has coverage:

- **Source** — implementation code
- **Tests** — unit/integration/e2e
- **CLI** — commands, flags, output formatting
- **UI** — routes, components, loader data
- **Documentation** — user-facing docs, skill files

Missing a projection = gap. Add ACs or explicitly note as out-of-scope.

---

## Using Claims

### In Code

**`@implements` MEANS ACTUALLY IMPLEMENTED.** This is a non-negotiable rule. If the code does not realize the claim's behavior — if it is a stub, a placeholder, a no-op, or returns a hardcoded empty result — it is NOT an implementation and MUST NOT carry `@implements`. Violations poison the trace matrix: `scepter claims trace` shows Source coverage for something that doesn't work, and `scepter claims gaps` stays silent about a real gap. This failure mode is insidious in phased implementations — stubs get annotated with `@implements`, the trace matrix goes green, and nobody notices the features are missing because the mechanical system says they're covered.

| Code state | Correct annotation | Wrong annotation |
|---|---|---|
| **Full implementation** | `@implements {ID}` | — |
| **Stub / no-op / returns `[]`** | `@see {ID}` + comment "not yet implemented" | `@implements {ID}` |
| **Partial implementation** | `@implements {ID}` on working parts; `@see {ID}` on stubs | `@implements {ID}` on everything |
| **Deferred to later phase** | `@see {ID}` + claim must carry `:deferred` in the note | `@implements {ID}` with "(stub)" in comment |

```typescript
/**
 * @implements {R004.§1.AC.01} Section ID extraction from headings
 * @implements {R004.§1.AC.03} Fully qualified, partial, and bare claim resolution
 */
function parseClaimReference(input: string): ClaimPath { ... }

// Compact: multiple claims under same note/section
// @implements {R012.§1.AC.01,.AC.03,.AC.05} Multiple ACs in one line
```

Available annotations: `@implements`, `@validates`, `@depends-on`, `@addresses`, `@see`

In tests, use `@validates`:
```typescript
// @validates {R004.§1.AC.06} Forbidden form rejection
it('rejects AC01 (no dot separator)', () => { ... });
```

### Carrying Forward Claims

When reference documentation contains claim IDs, you MUST:

1. **Identify all claim references** — scan for `PREFIX.NN` patterns
2. **Preserve traceability** — add `@implements {NOTE.§N.PREFIX.NN}` in code
3. **Never drop claims silently** — note out-of-scope explicitly
4. **Use the most specific reference** — `{R004.§1.AC.03}`, not `{R004}`

### CLI Tools (MANDATORY — Use These, Don't Guess)

**You MUST use the claims CLI to verify traceability.** Do not rely on reading code comments, grep results, or your own memory to determine whether a claim is implemented, traced, or has gaps. The CLI is the single source of truth for claim state. If you haven't run `scepter claims trace` on a claim, you don't know its status.

```bash
# TRACING — What projections cover this claim?
scepter claims trace R004                    # Traceability matrix for a note
scepter claims trace R004.§1.AC.01           # Trace a single claim
scepter claims trace R004.§1.AC.01,R005.§2.AC.03  # Trace multiple claims (cross-note)
scepter claims trace R004.§1.AC.01-06        # Trace a range

# THREADING — Where does this claim derive from / lead to?
scepter claims thread R004.§1.AC.01          # Derivation tree for a claim
scepter claims thread R004 --depth 2         # All claim threads in a note

# GAPS — What's missing?
scepter claims gaps                          # Claims with partial projection coverage
scepter claims gaps --include-zero           # Also show completely untraced claims
scepter claims gaps --include-deferred       # Include deferred claims
scepter claims gaps --projection Source      # Filter to specific projection types

# VALIDATION
scepter claims lint R004                     # Structural validation
scepter claims index                         # Build/rebuild claim index

# SEARCH
scepter claims search "autoWire" --regex     # Search claims (use --regex for alternation |)

# VERIFICATION & STALENESS
scepter claims verify R004.§1.AC.03          # Record verification
scepter claims verify R004.§1.AC.03 --actor "developer" --method "code review"
scepter claims stale R004                    # Check for stale claims
scepter claims stale --importance 4          # Filter by importance
```

`trace` shows a matrix with one row per claim and columns per projection type. `-` means no coverage. Use `--importance N` to filter.

**Required workflow — no exceptions:**
1. **Before coding**: Run `trace` on every claim you're about to implement. Know the current state.
2. **While coding**: Add `@implements` annotations (only on code that actually implements the claim — see "In Code" above).
3. **After coding**: Run `trace` again. Verify the Source column shows your files. Run `gaps` to check for holes.
4. **When investigating claims**: Use `thread` to trace derivation chains and `search` to find related claims. Do not grep the notes directory — the CLI resolves cross-references that raw text search cannot.

### How Traceability Works Mechanically

The trace matrix is built from two data sources. Understanding what it measures is essential — if you don't know how coverage is detected, you'll add annotations that appear correct but are invisible to the system.

**Source projection** (the "Source" column): Populated from `@implements` and `@validates` annotations in source code files (`.ts`, `.js`, `.py`, etc.). The scanner reads comments, finds `@implements {R004.§1.AC.01}`, and creates a cross-reference from `source:filename.ts` to `R004.1.AC.01`. The claim ID in the annotation MUST match a claim that exists in the index — if R004 doesn't have parseable claims, the annotation is silently orphaned.

**Note projections** (all other columns): Populated from `{NOTE.§N.AC.NN}` braced references in note markdown files. When S015.md contains the text `{R034.§1.AC.01}`, the index creates a cross-reference from S015 to R034.1.AC.01. This makes S015 appear in R034's trace matrix as a "Spec" column entry.

**What makes a claim exist in the index**: The claim MUST be defined in parseable format — either a markdown heading starting with a claim pattern, or a `§`-prefixed paragraph line. Checkboxes (`- [ ] AC-1: ...`), bold-only text (`**AC.01** ...`), and other inline formats are NOT parsed. If you run `scepter claims trace NOTEID` and see "No claims found", the note's format is wrong.

**The critical implication**: Adding `@implements {R034.§1.AC.01}` to source code does nothing for traceability if R034 doesn't have a parseable `AC.01` claim. The annotation points at a phantom. Always verify with `scepter claims trace NOTEID` after adding annotations.

### Retrofitting Claims on Existing Code

When adding claims to an existing codebase that predates the claims system:

1. **Verify note format first.** Run `scepter claims trace NOTEID` on each note. If it shows "No claims found", reformat the note's claims into parseable syntax (heading-level or §-prefixed paragraphs). This is a prerequisite — everything downstream depends on it.

2. **Run `scepter claims lint NOTEID`.** Fix any structural issues (forbidden forms, duplicates, broken references) before adding cross-references.

3. **Add `@implements` annotations to source code.** Use fully qualified paths matching the claim IDs from step 1. Run `scepter claims trace NOTEID` again — the Source column should now show your files.

4. **Add cross-note references.** If a spec note S015 discusses claims from R034, add `{R034.§1.AC.01}` references in S015's prose where appropriate. If a DD derives from requirement ACs, use `derives=R034.§1.AC.01` metadata on the DD's claims. These create the non-Source projection columns.

5. **Verify the full picture.** Run `scepter claims trace NOTEID` one final time. Every claim should show coverage in the projection types you expect. Run `scepter claims gaps` to find remaining holes.

The verification steps (1, 2, 5) are not optional — they're how you confirm the mechanical system sees what you wrote.

---

## Common Mistakes

| Mistake | Correct form |
|---------|--------------|
| `@implements` on a stub/no-op | `@see` + `:deferred` on the claim. **This poisons the trace matrix.** |
| `AC01` (missing dot) | `AC.01` |
| `AC-01` (hyphen) | `AC.01` |
| `{R012.15}` (bare number = section, not claim) | `{R012.§1.AC.15}` |
| Bare `AC.01` in code (ambiguous) | `{R004.§1.AC.01}` |
| Dropping claims from reference docs | Carry forward or note as out-of-scope |
| Guessing claim status without CLI | Run `scepter claims trace` — the CLI is the source of truth |
| Dates in documents | Use `scepter claims verify` (sidecar store) |
| `:priority` or `:important` | Use bare digit `:4` |
| `**DC.01** \`derives=...\`` (bold + code span) | `DC.01:derives=...` (colon-suffix) |
| Claims at same heading level as sections | Use `§`-prefixed paragraphs or one level deeper |
