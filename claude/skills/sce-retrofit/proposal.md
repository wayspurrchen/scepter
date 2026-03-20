# Retrofit Proposal Guide

**Read this companion file during Phase 2 (Propose) of the retrofit process.** This details how to translate topology analysis into a concrete SCEpter configuration proposal.

Ensure you have loaded:
- **@scepter** (main skill) — non-negotiable rules, CLI reference, config structure
- The analysis from Phase 1

---

## From Topology to Configuration

The analysis phase identified bodies of information, their properties, and their relationships. This phase translates those findings into:

1. A `scepter.config.json` configuration
2. An initial note population plan
3. An ingestion plan for existing documents (if any)

---

## Step 1: Map Bodies to Note Types

### The Mapping Heuristic

Not every body of information becomes a note type. A body should become a SCEpter note type when:

1. **It benefits from the reference graph** — its instances need to reference and be referenced by other notes
2. **It has a clear lifecycle** — instances are created, evolve, and eventually settle or become obsolete
3. **It benefits from CLI queryability** — you'd want to `scepter list --type X` or `scepter search` within it
4. **There are enough instances** — a body with only 1-2 instances doesn't need its own type; it can be folded into another type or captured as a section in a broader note

Bodies that should NOT become note types:
- Operational artifacts (CI configs, deploy scripts) — these live in code
- Transient information (meeting notes, scratch pads) — these don't need a knowledge graph
- Very small bodies — fold into a related type or capture as tags instead

### The Configuration Structure

```json
{
  "noteTypes": {
    "TypeName": {
      "folder": "lowercase-plural",
      "shortcode": "X",
      "description": "What this type captures and when to create one"
    }
  }
}
```

**Design rules:**
- **folder**: lowercase, plural, hyphenated. Match the project's existing conventions if possible.
- **shortcode**: 1-4 uppercase characters. Single-letter preferred for common types. `T` is ALWAYS reserved for Tasks (virtual type).
- **description**: Write for a developer who will read this in `scepter config` output. Make it clear WHEN to create a note of this type, not just what it is.

### Common Type Mappings

| Topology body | Typical note type | Shortcode | When to use |
|--------------|------------------|-----------|-------------|
| Architectural decisions | Decision | D | Major technical choices with rationale |
| Open questions | Question | Q | Things that need answers before work can proceed |
| Requirements | Requirement | R | What the system must/should do |
| Technical debt | TechDebt | TD | Known issues requiring future attention |
| Integration points | Integration | I | External service connections and API contracts |
| Patterns & conventions | Pattern | P | Reusable approaches used across the codebase |
| Component specifications | Component | C | Major system components and their responsibilities |
| Domain concepts | (domain-specific) | varies | Named after the domain concept |
| Research/exploration | Exploration | E | Investigation results and spike outcomes |

**Shortcode conflict check**: Verify no two types share a shortcode. Verify no shortcode conflicts with `T` (Tasks).

### Domain-Specific Types

The most valuable retrofits produce types specific to the project's domain, not just generic engineering types. Examples:

- A cooking app might have `Recipe` (RC) and `Ingredient` (IG) types
- A financial system might have `Regulation` (RG) and `Compliance` (CMP) types
- A game engine might have `Mechanic` (MC) and `Balancing` (BL) types
- A research project might have `Experiment` (EX) and `Hypothesis` (H) types

Domain-specific types are justified when the topology analysis found distinct bodies of domain knowledge that would be muddled if forced into generic types.

---

## Step 2: Design Work Modes (Optional)

Work modes are OPTIONAL. Only propose them if the topology analysis revealed distinct workflow phases.

```json
{
  "workModes": {
    "modeName": {
      "title": "Human-Readable Title",
      "folder": "lowercase",
      "description": "When this mode is active and what it influences"
    }
  }
}
```

**When to propose work modes:**
- The project has clear phases (design → implement → test → deploy)
- Different phases produce different kinds of notes
- The team context-switches between distinctly different activities

**When NOT to propose work modes:**
- The project is small enough that modes add overhead
- The team works on everything simultaneously
- No clear phase boundaries exist in the topology

---

## Step 3: Status Configuration (Optional)

If the topology analysis revealed that different note types have different lifecycles, propose status sets:

```json
{
  "statusSets": {
    "workflow": ["pending", "in_progress", "blocked", "ready_for_review", "completed"],
    "maturity": ["draft", "review", "approved", "superseded"],
    "resolution": ["open", "investigating", "answered", "deferred"]
  },
  "noteTypes": {
    "Decision": {
      "allowedStatuses": { "set": "maturity", "mode": "suggest" }
    },
    "Question": {
      "allowedStatuses": { "set": "resolution", "mode": "suggest" }
    }
  }
}
```

Use `suggest` mode (warn on invalid) rather than `enforce` (block on invalid) for initial setup. Enforcement can be tightened later once the team has established habits.

---

## Step 4: Initial Note Population Plan

Prioritize notes by information value and risk of loss.

### Priority 1: Load-Bearing Knowledge at Risk

Knowledge that is:
- **High binding** (many things depend on it)
- **Currently implicit** (exists only in code or developers' heads)
- **At risk of loss** (key contributor might leave, or context might fade)

These are typically major architectural decisions and foundational requirements.

### Priority 2: Active Questions and Decisions

Knowledge that is:
- **Currently in motion** (being discussed, debated, or implemented)
- **Time-sensitive** (losing the context around an active decision is costly)

These are typically open questions and recent decisions.

### Priority 3: Structural Documentation

Knowledge that:
- **Provides orientation** (helps new developers or AI agents understand the project)
- **Is relatively stable** (won't change soon)

These are typically component descriptions and pattern documentation.

### Population Plan Format

```markdown
## Initial Note Population Plan

### Priority 1: Load-Bearing Knowledge
1. **D001**: [Decision found in analysis] — Rationale: [why this is high priority]
2. **R001**: [Requirement found in analysis] — Rationale: [why this is high priority]

### Priority 2: Active Concerns
3. **Q001**: [Open question found] — Rationale: [why time-sensitive]
4. **D002**: [Recent decision] — Rationale: [context at risk]

### Priority 3: Structural Context
5. **C001**: [Core component] — Rationale: [orientation value]
6. **P001**: [Key pattern] — Rationale: [reuse value]
```

Each entry specifies the type, a proposed title, and why it matters. Actual IDs will be assigned by `scepter create` — NEVER pre-assign them.

---

## Step 5: Ingestion Plan (If Applicable)

If the project has existing markdown files that should become SCEpter notes:

### What to Ingest

- Architecture decision records (ADRs) → Decision notes
- Feature specs → Requirement notes
- Design docs → varies by content
- Research notes → Exploration notes
- Existing TODO lists → Task notes (with caution — verify they're still relevant)

### What NOT to Ingest

- README.md — this stays where it is
- CHANGELOG.md — this is a release artifact, not a knowledge note
- Contributing guides — these are operational, not knowledge
- Generated docs — these derive from code, not the other way around

### Ingestion Process

For each file to ingest:

1. **Determine the target note type** based on content analysis
2. **Determine creation order** by file creation date (for ID sequencing)
3. **Plan frontmatter addition** — status, created date, tags
4. **Plan reference extraction** — identify mentions of other notes or concepts
5. **Note any content that needs splitting** — a document covering multiple concerns should become multiple notes

Present this as a table:

```markdown
| Source file | Target type | Proposed title | Status | Notes |
|------------|-------------|---------------|--------|-------|
| docs/architecture.md | Decision | "Microservices Architecture" | draft | Split: also contains deployment decisions |
| docs/api-spec.md | Requirement | "REST API Contract" | approved | Contains acceptance criteria |
| notes/research-caching.md | Exploration | "Caching Strategy Research" | completed | Reference from D003 |
```

---

## Step 6: Produce the Proposal Document

Create a dated proposal document: `YYYYMMDD SCEpter Retrofit Proposal.md`

### Proposal Structure

```markdown
# SCEpter Retrofit Proposal for [Project Name]

Generated: YYYY-MM-DD HH:MM

## Executive Summary
[2-3 sentences: what was found, what's proposed, expected value]

## Analysis Findings

### Information Bodies Identified
[Brief table: body name, modal status, settledness, binding, proposed note type]

### Key Relationships
[The most important relationships between bodies — what constrains what]

### Knowledge at Risk
[What implicit knowledge was found that needs explicit capture]

## Proposed Configuration

### Note Types
```json
{
  "noteTypes": { ... }
}
```

[For each type: 1-2 sentence rationale linking it to the topology analysis]

### Work Modes (if proposed)
```json
{
  "workModes": { ... }
}
```

### Status Sets (if proposed)
```json
{
  "statusSets": { ... }
}
```

## Initial Note Population Plan
[Prioritized list from Step 4]

## Document Ingestion Plan (if applicable)
[Table from Step 5]

## Knowledge Gaps
[Bodies of information identified as critically underdocumented.
What implicit knowledge was found that exists only in code or developers' heads?
What areas have high binding but low clarity?]

## Migration Recommendations
[How to gradually adopt SCEpter practices:
1. Apply this configuration
2. Create Priority 1 notes
3. Run sce-linker to establish initial connections
4. Create Priority 2-3 notes as time allows
5. Establish team habits for ongoing use]

## What This Does NOT Cover
[Explicit scope boundaries — what was deliberately excluded and why]
```

### Proposal Quality Checklist

Before presenting to the user:

- [ ] Every proposed note type is justified by a body found in analysis
- [ ] No shortcode conflicts (including T for Tasks)
- [ ] Descriptions are specific to THIS project, not generic
- [ ] Initial notes are prioritized by actual value, not completeness
- [ ] Ingestion plan handles edge cases (files without dates, unclear types)
- [ ] The proposal is actionable — a developer reading it could execute it
- [ ] Nothing is over-configured — start minimal, grow with use
