# Retrofit Analysis Guide

**Read this companion file during Phase 1 (Analyze) of the retrofit process.** This details how to use epistemic topology analysis to discover a project's natural information structure.

Ensure you have loaded:
- **@scepter** (main skill) — non-negotiable rules, CLI reference
- **@epi** — vocabulary.md + topology.md at minimum

---

## The Analysis Mindset

You are **perceiving**, not planning. The goal is to see what information exists, what structure it already has, and what structure it's pushing toward — before deciding what SCEpter configuration to impose.

From epi topology: "Information has intrinsic shape. Problems have natural boundaries. Perceive the topology before imposing structure."

Common failure mode: jumping to "this project needs Decision, Requirement, and Task types" before examining what's actually there. That produces generic configurations. The value of the retrofit is in discovering what THIS project's information actually looks like.

---

## Step 1: Surface Survey

### Project Manifest Analysis

Read the project's manifest files to understand the technology stack and project structure:

```bash
# Package manifests
cat package.json 2>/dev/null | head -30
cat Cargo.toml 2>/dev/null | head -30
cat requirements.txt 2>/dev/null | head -30

# Project structure
ls -la
find . -maxdepth 2 -type d | grep -v node_modules | grep -v .git | grep -v dist | sort
```

**What to extract:**
- Technology stack (language, framework, build tools)
- Project maturity signals (version number, changelog presence, CI config)
- Team signals (contributing guide, code owners, PR templates)

### Documentation Inventory

```bash
# All markdown files outside node_modules
find . -name "*.md" -type f | grep -v node_modules | grep -v _scepter | sort

# Look for structured documentation
find . -type d -name "docs" -o -name "documentation" -o -name "wiki" | grep -v node_modules
```

For each document found, note:
- What body of information does it belong to? (architecture, requirements, decisions, guides, etc.)
- How settled is it? (draft? living document? historical?)
- How current is it? (check last modified date)

### Code Pattern Scan

```bash
# TODO/FIXME/HACK density — signals undocumented technical debt
grep -rn "TODO\|FIXME\|HACK\|XXX\|WORKAROUND" --include="*.ts" --include="*.js" --include="*.py" --include="*.rs" --include="*.go" | head -30

# Decision comments — signals implicit architectural decisions
grep -rn "we chose\|decided to\|instead of\|trade.off\|because " --include="*.ts" --include="*.js" --include="*.py" -i | head -20

# Configuration complexity — signals integration concerns
find . -name "*.config.*" -o -name "*.env*" -o -name "*.yml" -o -name "*.yaml" | grep -v node_modules | sort
```

### Existing Knowledge Management

```bash
# ADR (Architecture Decision Records)
find . -type d -name "adr" -o -name "adrs" -o -name "decisions" | grep -v node_modules

# Changelogs and release notes
find . -maxdepth 2 -name "CHANGELOG*" -o -name "HISTORY*" -o -name "RELEASES*"

# Issue/PR templates
find . -path "*/.github/*" -name "*.md" 2>/dev/null
```

---

## Step 2: Body Identification

From the surface survey, identify distinct bodies of information. Use the epi topology framework.

### Guiding Questions

For each potential body:

1. **What claims does this body contain?** (IS claims? SHOULD claims? COULD claims?)
2. **What is its dominant modal status?** A body of IS claims (documentation of current state) is fundamentally different from a body of SHOULD claims (requirements/decisions).
3. **What projection does it operate at?** Intent, Architecture, Specification, or Implementation?
4. **Who is its audience?** Future developers? Current team? External users?
5. **How does it change?** With every commit? With every release? Rarely?

### Common Body Patterns in Software Projects

| Pattern | Evidence | Modal status | Projection |
|---------|----------|-------------|------------|
| **Architectural skeleton** | README architecture sections, diagram files, module structure comments | IS + SHOULD | Architecture |
| **Decision trail** | ADRs, "why" comments in code, design docs | WAS (decision context) + IS (the decision) | Architecture |
| **Requirements surface** | Feature requests, user stories, acceptance criteria, spec docs | SHOULD + MUST | Intent → Specification |
| **Technical debt register** | TODO/FIXME comments, known issues, tech debt docs | IS (the debt) + SHOULD (the fix) | Implementation |
| **API contracts** | OpenAPI specs, interface files, contract tests | MUST | Specification |
| **Operational knowledge** | Deployment docs, runbooks, monitoring config | IS + MUST | Implementation |
| **Domain model** | Entity types, business rules, validation logic | IS (inherent to domain) | Specification |
| **Integration map** | Third-party API clients, adapter patterns, config for external services | IS + CONSTRAINS | Architecture |
| **Convention set** | Style guides, linting config, naming patterns, code review norms | SHOULD | Architecture |
| **Learning trail** | Exploration docs, spike results, prototypes, research notes | WAS (understanding at time T) | Intent |

### Body Characterization Template

For each identified body, assess:

```markdown
### [Body Name]

**Evidence**: [Where this body manifests — files, comments, patterns]
**Dominant modal status**: [IS / SHOULD / MUST / COULD / etc.]
**Projection**: [Intent / Architecture / Specification / Implementation]
**Settledness**: [Dissolved → Geological]
**Velocity**: [Inert → Volatile]
**Binding**: [Isolated → Fused — how many other things depend on this?]
**Inherence**: [Inherent to the problem domain, or contingent on tech choices?]
**Completeness**: [Self-contained, or requires external context?]
**Current form**: [Where does this knowledge currently live?]
**Natural SCEpter type**: [What note type would capture this? Or does it not map to a type?]
```

Not every body maps to a SCEpter note type. Some bodies are better served by other organizational tools (wikis, issue trackers, code comments). Only propose note types for bodies that benefit from SCEpter's reference graph and context gathering.

---

## Step 3: Deep Dives (When Needed)

### When to Deep Dive

Deep dives are warranted when the surface survey reveals:
- A body with high binding (many things depend on it) but low clarity (hard to understand from the surface)
- Complex architectural patterns that need tracing to understand
- Multiple competing patterns that suggest unresolved decisions
- Significant code-level knowledge not captured anywhere

### When NOT to Deep Dive

- The surface survey provides sufficient clarity (most small-to-medium projects)
- The body is well-documented already
- The body has low binding (isolated, few downstream effects)
- Time constraints — better to ship a good-enough analysis than a perfect one

### Dispatching Parallel Agents

For large codebases, dispatch parallel Explore agents:

```
Each agent gets:
- A specific area to investigate (e.g., "the authentication subsystem")
- Specific questions to answer:
  1. What are the key patterns and implicit decisions?
  2. What knowledge exists only in code (not documented)?
  3. What are the integration points and dependencies?
  4. What TODO/FIXME items suggest undocumented concerns?
- A word limit (keep reports under 500 words per area)
```

Agents report back summaries. The orchestrator (you) synthesizes findings into the topology analysis.

---

## Step 4: Relationship Mapping

After identifying bodies, map their relationships. Use the epi relation types:

### Key Relationships to Discover

```
[Architectural decisions] --CONSTRAINS--> [Implementation patterns]
[Requirements]            --DERIVES FROM--> [Domain model]
[Technical debt]          --CONTRADICTS--> [Desired architecture]
[API contracts]           --CONSTRAINS--> [Integration implementations]
[Conventions]             --CONSTRAINS--> [All code]
```

### Relationship Discovery Techniques

1. **Follow the references**: When a document mentions another document, that's a relationship.
2. **Follow the imports**: When code imports from another module, that's a structural relationship.
3. **Follow the comments**: When a code comment references a decision or requirement, that's a knowledge-to-code relationship.
4. **Follow the config**: When configuration files reference environments or services, those are integration relationships.

### The Relationship Map Becomes the Reference Graph

SCEpter's power is in `{ID}` cross-references. The relationships you discover during analysis become the initial reference structure. Body A constrains Body B → Decision notes in A will reference Requirement notes in B.

---

## Step 5: Boundary Assessment

Identify where note types should be separate vs. combined.

### Separation Signals (different note types)

- Different velocity — decisions change slowly, tasks change fast
- Different audience — API specs for external consumers vs. internal architecture docs
- Different lifecycle — questions get answered, decisions get superseded, requirements get implemented
- Different modal status — IS bodies (documentation) vs. SHOULD bodies (requirements)

### Combination Signals (same note type)

- Same velocity — things that change together should live together
- Same lifecycle — things that are created, used, and archived together
- Same audience — things consumed by the same people
- Few enough that separation adds overhead without value

### The Shortcode Constraint

SCEpter shortcodes are 1-4 uppercase characters. With single-character shortcodes (most common), you have ~20 available slots (reserving T for Tasks and some letters that cause confusion). Don't exhaust shortcodes on types that could be combined.

---

## Analysis Output

The analysis phase produces an internal working document (for your own synthesis) that feeds into Phase 2. The key outputs:

1. **Body inventory** — list of identified bodies with characterizations
2. **Relationship map** — how bodies relate to each other
3. **Boundary assessment** — which bodies should be separate note types vs. combined
4. **Coverage assessment** — what knowledge is currently captured vs. at risk of loss
5. **Sizing estimate** — how many note types and initial notes are appropriate

This output does NOT go to the user directly. It feeds into the proposal (Phase 2), which is what the user reviews.
