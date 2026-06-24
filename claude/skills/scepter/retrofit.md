# SCEpter Retrofit

**Read this companion when establishing SCEpter on an existing project** — bootstrapping a knowledge graph where none exists, evaluating a thin `_scepter/` setup for gaps, or importing a collection of markdown docs into SCEpter's structure. This is the analysis-and-initialization path; for wiring the cold-start surface (CLAUDE.md FIRST ACTION RULE, allowlist, plugin) into a project, read `bootstrap.md` instead.

You are reading this as a companion of the `scepter` skill (already loaded — its non-negotiable rules and CLI conventions apply). For the topology analysis in Phase 1, also load **@epi** (`vocabulary.md` + `topology.md` at minimum).

## Companion routing

```
WHAT PHASE ARE YOU IN?
├─ Analyzing the project?      → Read retrofit-analysis.md from this skill directory
├─ Proposing configuration?    → Read retrofit-proposal.md from this skill directory
└─ Just starting?              → This file has the overview
```

---

## The Retrofit Process

The retrofit has three phases with an approval gate between analysis and execution.

```
Phase 1: ANALYZE  →  Phase 2: PROPOSE  →  [User Approval]  →  Phase 3: EXECUTE
 (perceive)           (derive)              (gate)               (apply)
```

### Phase 1: Analyze — Perceive the Project's Information Topology

**Goal**: Identify what bodies of information exist in the project, their properties, and their relationships.

This phase uses the epi topology analysis discipline. You are perceiving, not planning.

1. **Assess Current State**
   ```bash
   # Check if SCEpter already exists
   ls _scepter/ 2>/dev/null
   # If it exists, check current config
   scepter config
   ```

   If `_scepter/` exists and is populated, focus on gap analysis. If minimal/blank, proceed with full analysis. If absent, note that initialization will be needed.

2. **Survey the Project Surface**

   Get the lay of the land. Do NOT deep-dive yet — this is the horizontal pass.

   ```bash
   # Project structure overview
   ls -la

   # Find project manifests
   find . -maxdepth 2 -type f -name "*.json" | grep -E "(package|composer|requirements|Gemfile|Cargo)"

   # Find existing documentation
   find . -name "*.md" -type f | grep -v node_modules | grep -v _scepter | sort

   # Find source code distribution
   find . -type f -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.rs" -o -name "*.go" | grep -v node_modules | grep -v dist | head -50
   ```

3. **Identify Bodies of Information**

   Using epi topology analysis (see topology.md), identify the distinct bodies of information in the project. Common bodies found in codebases:

   | Body | Typical signals | Likely note types |
   |------|----------------|-------------------|
   | **Architectural decisions** | README sections, ADR files, code comments explaining "why" | Decision |
   | **Open questions** | TODO comments, issue references, "TBD" markers | Question |
   | **Requirements** | Feature docs, user stories, acceptance criteria | Requirement |
   | **Technical debt** | FIXME/HACK comments, workaround patterns | TechDebt |
   | **Integration points** | API clients, config files, adapter patterns | Integration |
   | **Patterns & conventions** | Repeated code structures, style guides | Pattern |
   | **Component boundaries** | Module structure, package organization | Component |
   | **Domain concepts** | Business logic, entity models, domain types | Domain-specific types |

   For each body found, characterize using epi vocabulary:
   - **Settledness** — How crystallized is this knowledge? (Dissolved → Geological)
   - **Velocity** — How fast is it changing? (Inert → Volatile)
   - **Binding** — How many other things depend on it? (Isolated → Fused)
   - **Inherence** — Is it inherent to the problem domain or contingent on technology choices?
   - **Completeness** — Is it self-contained or does it have implicit dependencies?

4. **Dispatch Deep Dives (if needed)**

   For large codebases where the surface survey reveals 5+ distinct areas worth investigating, dispatch parallel sub-agents using the Explore agent type. Each agent investigates one area and reports back.

   Keep deep dives focused: "What are the key patterns, implicit decisions, and undocumented knowledge in [area]?" Each produces a brief summary, not exhaustive documentation.

   For small-to-medium projects, the surface survey may be sufficient — don't over-analyze.

5. **Map Relationships and Boundaries**

   Between the identified bodies, map:
   - Which bodies derive from which (e.g., implementation decisions derive from architectural decisions)
   - Which bodies constrain which (e.g., API contracts constrain implementation choices)
   - Where natural boundaries exist (different velocity, different audience, different source of truth)

   This relationship map becomes the initial reference structure in SCEpter.

### Phase 2: Propose — Derive Configuration from Topology

**Goal**: Translate the topology analysis into a concrete SCEpter configuration proposal.

Read `retrofit-proposal.md` from this skill directory for detailed guidance on this phase.

Summary:
1. Map identified bodies to note types (with folders, shortcodes, descriptions)
2. Map identified workflows to work modes (if the project has distinct phases)
3. Design the initial note population plan (prioritized list of notes to create)
4. Produce the proposal document for user review

**Consider claim-addressability when proposing types.** SCEpter's headline value is claim-level traceability — a note type whose instances carry acceptance criteria, constraints, or specifications (Requirement, Specification, Design) can have its claims (`{R001.§2.AC.03}`) traced into code `@implements` annotations and tests. When a body of information is full of testable assertions, propose a type that will hold claims, and flag in the proposal which types are claim-bearing vs. which are narrative. See `claims.md` for the claim system.

### Approval Gate

Present the proposal to the user. The proposal includes:
- Proposed `scepter.config.json` configuration
- Rationale for each note type (linked to topology findings)
- Initial note population plan (what notes to create first)
- Ingestion plan for existing documents (if any)

**Do not proceed past this point without explicit user approval.**

### Phase 3: Execute — Apply Configuration and Ingest Notes

**Goal**: Initialize SCEpter and create the initial knowledge graph.

1. **Initialize SCEpter** (if `_scepter/` doesn't exist)
   ```bash
   scepter init blank --target .
   # `scepter init --list` shows available templates (blank, default, example, minimal).
   # Use `blank` when you intend to apply a custom, topology-derived config.
   ```

2. **Apply Configuration**

   Update `scepter.config.json` with the approved configuration using the Edit tool. Then verify it loads:
   ```bash
   scepter config
   ```

3. **Create Initial Notes**

   Using the scepter CLI (NEVER manual file creation; NEVER guess IDs — read them from output):
   ```bash
   scepter create Decision "Use PostgreSQL for persistence" --tags database,infrastructure
   scepter create Question "How should we handle auth token refresh?" --tags auth,security
   ```

   After creating each note, edit its file to add content and `{ID}` references.

4. **Ingest Existing Documents** (if applicable)

   Use `scepter ingest` to import existing markdown files as notes of a given type — it assigns IDs, adds frontmatter, and (with `--move`) relocates files into the type folder. Always preview first:

   ```bash
   # Preview what would be ingested — no changes made
   scepter ingest Decision docs/adr/ --dry-run

   # Ingest a directory of ADRs as Decision notes, moving them into the type folder
   scepter ingest Decision docs/adr/ --move --tags architecture

   # Ingest specific files as Requirement notes with an initial status
   scepter ingest Requirement docs/specs/auth.md docs/specs/billing.md --status draft
   ```

   `--move` relocates files under the type folder in `_scepter/`; omit it to rename in place. Ingest one type at a time (the type is the first argument). For documents that cover multiple concerns, split them before ingesting so each note is atomic.

5. **Establish Initial Connections**

   After all initial notes exist, add `{ID}` cross-references to build the graph. Every note should reference at least one other note. Then dispatch `sce-linker` (per non-negotiable rule 10) to sweep for missing bidirectional references and `@implements` annotations.

6. **Validate the Initial Graph**

   ```bash
   scepter lint --all          # Project-wide reference audit — catch dangling/broken {ID} refs
   scepter claims gaps         # Claims with partial projection coverage (for claim-bearing types)
   scepter trace <ID>          # Spot-check that a key note's claims trace as expected
   ```

   A clean `lint --all` confirms the initial references resolve; gaps/trace confirm the claim layer is wired where you intended.

---

## Sizing Heuristic

| Project size | Analysis depth | Sub-agents? | Expected output |
|-------------|---------------|-------------|-----------------|
| Small (<20 files, <5 docs) | Surface survey only | No | 3-5 note types, 5-10 initial notes |
| Medium (20-200 files, 5-20 docs) | Surface + selective deep dives | Optional | 5-8 note types, 10-20 initial notes |
| Large (200+ files, 20+ docs) | Surface + parallel deep dives | Yes | 6-12 note types, 20-40 initial notes |

Don't over-configure. Start minimal and let the configuration grow with actual use.

---

## Anti-Patterns

### Documenting Everything at Once
The goal is a minimal viable knowledge graph, not comprehensive documentation. Capture the highest-value knowledge — major decisions, critical questions, key patterns — and let the rest emerge through normal development.

### Inventing Note Types for Completeness
Every proposed note type MUST be justified by actual bodies of information found during analysis. Don't add "Bug" as a type because it seems standard if no bug-tracking patterns exist in the project.

### Guessing Project Structure
Run the analysis commands. Read the actual files. Don't assume a TypeScript project with `src/` has a particular architecture — verify.

### Skipping the Topology Step
Going straight from "read the README" to "propose 8 note types" produces generic configurations that don't fit the project. The topology analysis is what makes the retrofit specific to THIS project.

### Over-Analyzing Small Projects
A 5-file utility library doesn't need 30 minutes of deep-dive analysis. Survey it, propose 3-4 note types, and move on.
