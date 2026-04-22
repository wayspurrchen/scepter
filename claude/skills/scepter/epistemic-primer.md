# Epistemic Primer

Compact vocabulary for producing and reviewing SCEpter artifacts. Load alongside the relevant `artifacts/{type}.md` guide when the artifact doc references terms like *binding*, *inherence*, *settledness*, *projection*, or *derivation*. Covers the subset of Epi vocabulary that appears in artifact production; for the full framework (topology, operations heuristics, annotation conventions, and the optional shorthand notation), see the separate [`@epi`](https://github.com/wayspurrchen/epi) skill.

The section numbering here matches Epi's `vocabulary.md` — references to `§1`, `§2`, `§4`, `§5` in artifact docs resolve to sections here.

---

## §0. What a Claim Is

A claim is a statement with a subject, a predicate, and a **modal status**. Claims are valuable because they serve as specific and atomic descriptions of [desired] reality that can be cited and used as constraints for LLM-based work.

## §1. Modal Status

A claim's modal status is constitutive — the same subject carries different meanings depending on modal:

| Modal | Meaning | Example |
|-------|---------|---------|
| **IS** | Current state | "The parser returns a ClassificationResult" |
| **MUST** | Required | "The parser MUST return a ClassificationResult" |
| **SHOULD** | Recommended (but deviation is permitted with reason) | "The parser SHOULD log on parse failure" |
| **MAY** | Permitted (neither required nor forbidden) | "The parser MAY short-circuit on empty input" |
| **MUST NOT** | Forbidden | "The parser MUST NOT retain input state between calls" |
| **SHOULD-BE** | Normative target (future state) | "By phase 3, parser should support all token types" |
| **WANT** | Stakeholder desire (not yet committed) | "We want a dashboard that shows coverage" |

RFC 2119 keywords (MUST/SHOULD/MAY) define normative strength. IS claims describe reality; MUST claims describe requirements; the gap between them is what drives change.

**Primary failure mode:** treating an IS claim as MUST (or vice versa). "The system does X" is an observation; "the system must do X" is a requirement. Confusing these produces specifications that describe accidents of the current implementation as if they were contracts.

---

## §2. Properties of Claims

Properties describe how to think about a claim's role. Most claims don't carry explicit annotations — the baseline is assumed. **Annotate only when a property deviates from the document's expected baseline.**

### 2.1 Binding

How many downstream decisions a claim constrains — its "blast radius."

| Level | Character | Typical signal |
|-------|-----------|----------------|
| **Fundamental** | Touches 5+ projections or many files across modules | Identity/addressing schemes, core invariants |
| **High** | 3-4 projections, cross-module | Public API contracts, security boundaries |
| **Moderate (default)** | 1-2 projections, single module | Most ordinary requirements |
| **Local** | Single file, no downstream effect | Internal helpers, formatting choices |

**Use in artifact production:** high-binding claims drive the design skeleton — settle them first, test them most thoroughly, decompose them when they bundle multiple concerns. The file-count heuristic (4+ files → decompose) is a binding-based rule.

### 2.2 Inherence

Whether a claim follows from what the system IS, or from a choice that could have gone differently.

- **Inherent**: follows from the nature of the problem. Not worth designing around — bedrock.
- **Contingent**: a choice. Could be revisited. Flag as a decision point.

MUST claims are expected to be inherent (or treated as load-bearing); SHOULD/MAY claims are expected to be contingent. **Annotate only when surprising** — a MUST that's really a policy choice masquerading as a structural necessity, or a SHOULD that follows from physics rather than preference.

### 2.3 Settledness

How determined vs. open a claim is. Use the meaning in prose; don't use the scale names as section headers (anti-pattern).

| Level | Character |
|-------|-----------|
| **Crystallized** | Fully determined, won't change |
| **Developing** | Core settled, details in flux |
| **Glowing** | Known and actively being worked |
| **Dissolving** | Losing confidence, being revisited |
| **Dissolved** | Under active revision; treat as not-yet-determined |

**Use in artifact production:** in a UI proposal or architecture doc, distinguish "the backend already determines this shape" (crystallized — don't re-decide) from "this is a pure design choice" (dissolved — explore options). Express in natural language rather than using scale names as labels.

### 2.4 Alignment (Purpose vs. Form)

Every artifact has a **purpose** (what it is FOR) and a **form** (what it must BE to deliver on that purpose). The gap between the two is where design tension lives.

Example: a sandbox iteration tool's purpose is making the edit-run-inspect cycle fast; its form is an orchestration API with polling patterns, cost tracking, and output diffing. The design has to close that gap — or explicitly name where it can't.

**Use in artifact production:** a proposal or requirements doc should name the purpose and the major form concerns separately. Most feature-list-style proposals conflate the two, listing form decisions (endpoints, data shapes, UI elements) without grounding them in the purpose they serve.

### 2.5 Clarity

Unrelated to truth or settledness — how well-articulated the claim is right now. A perfectly-clear claim can be wrong; a foggy claim can be true. When reviewing, distinguish "this is wrong" from "this is unclear."

---

## §3. Relations

Claims connect to other claims. The relations that matter for artifact production:

| Relation | Meaning | Example |
|----------|---------|---------|
| **DERIVES FROM** | This claim is produced by transforming another (decompose, concretize, etc.) | DD claim derives from requirement AC |
| **CONSTRAINS** | This claim bounds what another can be | Requirement constrains specification |
| **IMPLEMENTS** | This realizes another at a more concrete projection | Code implements spec claim |
| **VALIDATES** | This confirms another holds | Test validates MUST claim |
| **SUPERSEDES** | This replaces a prior claim | New requirement supersedes old |
| **DEPENDS ON** | This can't hold without another | Feature X depends on capability Y |

These relations are what `scepter claims trace` follows to build the traceability matrix. In code, they're expressed as `@implements`, `@validates`, `@depends-on`, `@see` annotations. In notes, they appear as `{NOTE.§N.AC.NN}` braced references or `derives=TARGET` metadata.

---

## §4. Projections

A claim manifests across multiple **projections** — each projection expresses the same underlying claim through a different cognitive mode. No projection is primary.

| Projection | Cognitive mode | Typical containers |
|-----------|---------------|-------------------|
| **Intent** | What the user or system needs | Problem statements, user stories, exploration notes, UI proposals |
| **Requirements** | Testable statements of what must hold | R-notes, requirements docs |
| **Specification** | Behavioral contracts, data models, interfaces | S-notes, spec docs |
| **Architecture** | Structure, boundaries, invariants | ARCH-notes, architecture docs |
| **Detailed Design** | Module wiring, integration sequence | DD docs (spans Spec↔Implementation) |
| **Implementation** | Source code | Files + `@implements` annotations |
| **Verification** | Tests and audits | Test plans, test code + `@validates` annotations |

### Cross-Projection Identity

A single claim — "autoWire runs during bind()" — has a valid expression at architecture (responsibility boundary), specification (lifecycle contract), implementation (callsite), and verification (test assertion). These are all the same claim, expressed through different modes.

**An `@implements` annotation is the implementation projection's expression of a claim.** It doesn't exhaust the claim — the claim also needs spec expression, architecture expression, test expression. Gaps in any projection are potential traceability failures.

### Compound Claims

A claim that bundles assertions from multiple projections is **compound** and should be decomposed. Common patterns:

- "X must exist AND be called from Y" (existence + integration — different projections)
- "X must do Y AND not do Z" (behavior + constraint — different confirmation modes)
- "X is achieved by Y" (invariant + mechanism — different lifetimes)

The failure mode when compound claims survive into implementation: an agent builds and annotates the capability half, the trace matrix shows coverage, and the integration or constraint half is never realized because the trace already looks green. See `claims.md` for the decomposition catalog.

---

## §5. Derivation Operations

Six cognitive operations transform claims. When producing an artifact, you're usually doing one of these:

| Operation | Direction | What it produces |
|-----------|-----------|------------------|
| **Decompose** | Keeps projection, narrows scope | One compound claim → several discrete claims |
| **Concretize** | Moves to more concrete projection | Requirement → spec, spec → DD, DD → code |
| **Elaborate** | Keeps projection, adds detail | Rough requirement → complete requirement |
| **Abstract** | Moves to more abstract projection | Code → spec; observations → architecture |
| **Imply** | Derives a claim from existing claims | "If A and B, then C" |
| **Validate** | Cross-checks claims across projections | "Does the code realize the spec?" |

When deriving claims (e.g., a DD claim from a requirement AC), record the derivation in note metadata with `derives=SOURCE`. See `claims.md` for syntax.

**Every artifact production is a derivation.** Writing a spec from requirements is concretize + elaborate. Writing a DD from a spec is concretize + decompose. Writing a test plan is validate + elaborate.

---

## §6. Knower-State

How certain is the author? Annotate when it affects how a reader should treat the claim.

- **Knows** (default): has direct evidence or formal proof
- **Believes**: reasonable inference, not verified
- **Guesses**: extrapolation under uncertainty
- **Models**: working representation that may not fully match reality

Usually unmarked in formal artifacts — the baseline is "knows." Flag in exploratory docs or when a load-bearing claim is provisional.

---

## §7. When to Annotate

The default is unannotated. Claims that fit baseline expectations don't need marking.

**Annotate when:**
- A property deviates from the document's baseline (a MUST that's actually contingent)
- A property is structurally surprising (a high-binding requirement buried in a detail section)
- A projection transition is non-obvious (a claim that looks like a requirement but is really a spec)

**Don't annotate:**
- Every MUST with `[inherent]` — it's expected
- Every claim with `[known]` — it's the default
- Uniformly-valued properties across a document — they're the document's default

**The unmarked-default principle:** only deviations from expected baseline carry signal. If everything is crystallized, don't mark crystallized.

---

## §8. Anti-Patterns

- **Using scale names as section headers.** Don't write `## Crystallized Claims` or `## The Dissolved Items`. Describe meaning in prose: "The backend determines this" or "This is a pure design choice."
- **Mechanical annotation.** Walking through every claim assigning properties produces filled-in-template prose. Use the vocabulary selectively where it adds precision.
- **Annotating defaults.** Don't mark things that match expectations. Only deviation carries signal.
- **Treating properties as required metadata.** They're analytical lenses, not fields that must be filled.
- **Confusing IS and MUST.** An observation about current state is not a requirement. A requirement about future state is not an observation. Modal verb chosen deliberately.
- **Requirement hidden inside mechanism.** "X is achieved by Y" compound — if Y changes, X loses its independent expression. Separate the requirement from the mechanism.

---

## Relationship to `claims.md`

This primer covers epistemic *properties and structure* of claims. The companion `claims.md` covers *syntax and machinery* — how claim IDs parse, how `@implements` annotations work, how the CLI traces claims. Together they answer:

- Primer: "what kind of claim is this, what role does it play?"
- `claims.md`: "how do I write this claim down so the tooling sees it?"

Load both when authoring requirements, specs, or DDs. Load just `claims.md` for pure mechanics (ID syntax, lifecycle tags, CLI commands).

---

## Further Reading

For the full Epi framework — topology perception (seeing bodies of information), annotation conventions, operations heuristics (property→action mapping), coherence protocols, and the optional shorthand notation — see the `@epi` skill. This primer is the operational subset needed to produce and review SCEpter artifacts.
