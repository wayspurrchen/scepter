# SCEpter

**Software Composition Environment** — a CLI-first knowledge management system for AI-assisted software development.

SCEpter builds a structured knowledge graph inside your codebase using atomic markdown notes, bidirectional references, and claim-level traceability. It solves the two core problems of working with AI coding agents: **context loss** (the AI doesn't know what it doesn't know) and **decision amnesia** (decisions made in one session are invisible to the next).

The system is designed for AI agents (Claude Code, Cursor, etc.) to read, write, and query — but everything is plain markdown and JSON, so humans can read and edit it directly.

**SCEpter is a maximalist approach to knowledge tracking — it captures more context than most projects bother with, because it's designed for environments where that context will be consumed programmatically.** When used with AI coding agents, this means higher token usage in exchange for more effective, traceable work. Most testing has been done with Claude Code on the Anthropic Max plan.

## Why SCEpter

**Use SCEpter if:**

- Your project has outgrown single-session AI conversations and you're re-explaining context repeatedly
- You have features with multiple acceptance criteria and need to track whether all of them were actually implemented
- Multiple people or agents work on the same code and decisions need to be externalized
- You've had cases where the code runs and tests pass but doesn't match what was intended
- You want AI agents that can verify their own work against a spec (`scepter claims trace R004`)
- You just need a scaffolded, searchable document structure with cross-references and unique IDs — even outside of a codebase

You don't need to be using AI coding tools. SCEpter was designed for AI-assisted workflows and the agent skills target that use case, but the note management, scaffolding, and claims system work independently. The core tooling is domain-neutral — research, writing, and other non-software domains work with custom note types and skill files.

**What about existing ticket trackers?**

SCEpter is complementary to ticket trackers, not a replacement. SCEpter is built around the idea that documentation about code should live as close to the code as possible — in the repo, in version control, queryable by CLI and by LLMs — so that both static analysis and AI agents can consume it. Ticket trackers are good at tracking work across people and sprints; SCEpter is good at tracking *knowledge* and its relationship to the codebase. You can configure SCEpter note types to mirror your ticket taxonomy if you want, but the intended pattern is: use tickets for high-level planning, keep the detailed requirements, decisions, and specifications in SCEpter where they're co-located with the code they describe.

## Quick Start

### 1. Install SCEpter

```bash
git clone https://github.com/wayspurrchen/scepter.git
cd scepter
npm install
npm run build
npm link -g .
```

### 2. Initialize a project

```bash
cd /path/to/your/project
scepter init          # Choose: blank, minimal, example, or epi
scepter scaffold      # Create folder structure from config
```

This creates a `_scepter/` directory with a `scepter.config.json` and note folders.

### 3. Set up Claude Code integration

SCEpter ships with Claude Code agents and skills in the `claude/` directory. Symlink them into your global Claude Code config:

```bash
# From the scepter repo directory
ln -s "$(pwd)/claude/agents"/* ~/.claude/agents/
ln -s "$(pwd)/claude/skills"/* ~/.claude/skills/
```

This gives you:
- **Agents:** `sce-researcher`, `sce-reviewer`, `sce-producer`, `sce-linker` — specialized subagents for research, review, artifact production, and cross-reference linking
- **Skills:** `scepter` (core workflow: reviewing, implementing, conformance checking) and `sce-retrofit` (analyze an existing codebase to bootstrap a SCEpter knowledge graph)

### 4. Bootstrap SCEpter in your CLAUDE.md

Add the following to your project's `CLAUDE.md` so that Claude Code loads the SCEpter methodology at the start of every session:

```markdown
## SCEpter

This project uses SCEpter for knowledge management. At the start of each session,
invoke /scepter to load the SCEpter methodology, then review relevant notes
before beginning work.

Use `scepter ctx list` to see available notes and `scepter ctx gather <id>` to
pull in context. Create Task notes for non-trivial work. Add `// @implements {ID}`
annotations to source code that realizes requirements or specifications.
```

### 5. Start working

The typical SCEpter workflow with an AI agent:

1. **Agent loads SCEpter** — the `/scepter` skill teaches it the methodology and available commands
2. **Agent gathers context** — `scepter ctx gather <note-id>` pulls in requirements, specs, and prior decisions by following the reference graph
3. **Agent creates a task note** — `scepter ctx create Task "Implement feature X"` with references to upstream requirements
4. **Agent implements** — writes code with `// @implements {R001}` annotations linking implementation to requirements
5. **Agent updates knowledge** — creates or updates notes to capture decisions made during implementation

This cycle builds a persistent, traceable knowledge graph that survives across sessions — every decision, requirement, and implementation link is recorded so the next session picks up where the last one left off.

### 6. (Optional) Add epi for epistemic vocabulary

[Epi](https://github.com/wayspurrchen/epi) is a useful and entirely optional companion skill to SCEpter. SCEpter's note taxonomy and claims system are inspired by Epi's concepts, while the Epi skill contains format and process guidance for creating well-specified documents with claims.

Install it the same way:

```bash
# From the epi repo directory
git clone https://github.com/wayspurrchen/epi.git ~/Projects/epi
ln -s ~/Projects/epi/claude/skills/* ~/.claude/skills/
```

Then add to your `CLAUDE.md`:

```markdown
## Epi

This project uses the Epi epistemic vocabulary. Invoke /epi to load the
perceptual discipline for analyzing claims, settlement status, and dependencies.
```

## Core Concepts

### Atomic Notes

Every piece of project knowledge gets a unique, permanent ID based on its type:

```
R001 - Core authentication system       (Requirement)
S003 - Claim parser specification        (Specification)
DD002 - Traceability matrix design       (DetailedDesign)
T005 - Implement claim search            (Task)
```

Note types are configurable. Define whatever taxonomy fits your project — the examples above use the "epi" boilerplate (Architecture, Requirement, Specification, DetailedDesign, TestPlan, Task), but you could use Decision/Question/Bug/Feature or anything else.

Notes are markdown files, discovered by their ID prefix rather than by a fixed folder location. By default, new notes are created under `_scepter/notes/[type_folder]/`, but you can configure `discoveryPaths` in `scepter.config.json` to scan any set of directories — for example, `["docs", "specs"]` or even `["."]` to pick up notes anywhere in the repo. This means existing markdown scattered across a project can participate in the knowledge graph without being relocated. Each note has YAML frontmatter for metadata (title, status, tags, dates) and a body that can contain references to other notes.

### Reference Graph

Notes reference each other with a brace syntax:

```markdown
<!-- In a task note -->
This implements the authentication requirement {R001} based on {DD003}.
```

SCEpter builds a bidirectional reference graph from these mentions. When you ask for context about any note, it follows references to pull in everything related — upstream requirements, downstream tasks, related decisions — automatically.

### Source Code Integration

SCEpter scans your source code for note references in comments:

```typescript
// @implements {R001}
export class AuthService {
  // Based on {DD003} — using JWT tokens
  authenticate(token: string): User { ... }
}
```

This creates bidirectional links between code and notes. You can query which files implement a requirement, which decisions guide a piece of code, or what's left unimplemented.

Configure which directories and file types to scan in `scepter.config.json`:

```json
{
  "sourceCodeIntegration": {
    "enabled": true,
    "folders": ["src"],
    "extensions": [".ts", ".tsx", ".js", ".py"],
    "exclude": ["node_modules/**", "**/*.test.ts"]
  }
}
```

### Claims System

The claims system provides **sub-note addressability**. Within a specification or requirement, individual acceptance criteria and section claims get addressable IDs:

```markdown
## S003 - Claim Parser

### $1 Address Grammar
- **AC.01** The parser MUST support dotted paths: `R004.3.AC.01`
- **AC.02** The parser MUST handle range suffixes: `R004.3.AC.01-03`

### $2 Tree Building
- **AC.01** The tree builder MUST parse markdown headings into a hierarchy
```

These claims can be referenced at any granularity: `{S003}` (whole note), `{S003.1}` (section), or `{S003.1.AC.01}` (specific acceptance criterion). The claims system then provides:

- **Traceability matrices** — how claims project across note types (Requirement -> Spec -> Design -> Code)
- **Gap detection** — which claims lack coverage in downstream artifacts
- **Verification tracking** — record when claims were last verified, detect staleness
- **Derivation chains** — trace how a requirement flows through specs into implementation
- **Search** — find claims by text, importance, lifecycle state, or derivation graph

### Context Gathering

The `gather` command is the primary way AI agents get context. Given a note ID, it follows references to a configurable depth and returns everything relevant:

```bash
$ scepter ctx gather R001 --depth 2

# Context for R001: Core authentication system
Origin: R001 [Requirement]
Gathered: 8 notes

## Direct References
### Incoming (referenced by)
T008 - Implement user registration (4/8+1s)
DD003 - Authentication design (13/3+4s)

### Outgoing (references)
S001 - Auth service specification (2/5)
```

The notation `(4/8+1s)` means: 4 incoming references, 8 outgoing references, 1 source code reference.

## CLI Reference

All commands support `--project-dir <path>` to target a specific project. Defaults to the current directory.

### Project Setup

| Command | Description |
|---|---|
| `scepter init [template]` | Initialize from a boilerplate (`blank`, `minimal`, `example`, `epi`) |
| `scepter scaffold` | Create folder structure from config |
| `scepter config` | Display current configuration |

### Notes (`scepter ctx`)

| Command | Description |
|---|---|
| `ctx create <type> <title>` | Create a new note |
| `ctx show <ids...>` | Show notes by ID (supports globs like `R*`, `D00[1-5]`) |
| `ctx list` | List and filter notes |
| `ctx search <query>` | Full-text search across notes |
| `ctx gather <noteId>` | Gather related context by following references |
| `ctx archive <ids...>` | Archive notes (preserved in `_archive` folders) |
| `ctx delete <ids...>` | Soft-delete notes (moved to `_deleted` folders) |
| `ctx restore <ids...>` | Restore archived or deleted notes |
| `ctx purge [ids...]` | Permanently delete from `_deleted` (irreversible) |
| `ctx convert <ids...>` | Convert between file and folder note formats |
| `ctx xref-sources [targets...]` | Cross-reference audit between source code and notes |

### Claims (`scepter claims`)

| Command | Description |
|---|---|
| `claims index` | Build claim index and report statistics |
| `claims trace <id>` | Traceability matrix for a note or specific claims |
| `claims gaps` | Report claims with partial coverage across projection types |
| `claims lint <noteId>` | Validate claim structure in a note |
| `claims scaffold <noteId>` | Generate a document skeleton with numbered sections |
| `claims verify <id>` | Record a verification event for claims |
| `claims stale` | Report stale/unverified claims based on source file changes |
| `claims search [query]` | Search claims by text, metadata, or derivation graph |
| `claims thread <id>` | Show relationship tree for a claim or note |

### Types (`scepter types`)

| Command | Description |
|---|---|
| `types list` | List all configured note types |
| `types add` | Add a new note type |
| `types rename` | Rename a note type (updates all references) |
| `types delete` | Remove a note type |

### Confidence (`scepter confidence`)

| Command | Description |
|---|---|
| `confidence audit` | Audit confidence annotations across source files |
| `confidence mark` | Add or update a confidence annotation on a file |

Confidence annotations mark review status on source files:

```typescript
// @confidence Human4  — reviewed by a human, high confidence
// @confidence AI3     — AI-generated, moderate confidence
```

## Configuration

SCEpter is driven by `_scepter/scepter.config.json`. Here's a full example:

```json
{
  "noteTypes": {
    "Architecture": {
      "shortcode": "A",
      "folder": "arch",
      "description": "System architecture and high-level design"
    },
    "Requirement": {
      "shortcode": "R",
      "folder": "reqs",
      "description": "Functional and non-functional requirements"
    },
    "Specification": {
      "shortcode": "S",
      "folder": "specs",
      "description": "Subsystem specifications with claim-addressable sections"
    },
    "DetailedDesign": {
      "shortcode": "DD",
      "folder": "dd",
      "description": "Implementation blueprints bridging specs to code"
    },
    "TestPlan": {
      "shortcode": "TS",
      "folder": "tests",
      "description": "Test plans and verification strategies"
    },
    "Task": {
      "shortcode": "T",
      "folder": "tasks",
      "description": "Actionable work items"
    }
  },
  "paths": {
    "notesRoot": "_scepter/notes",
    "dataDir": "_scepter"
  },
  "sourceCodeIntegration": {
    "enabled": true,
    "folders": ["src"],
    "extensions": [".ts", ".tsx", ".js", ".jsx"],
    "exclude": ["node_modules/**", "dist/**", "**/*.test.ts"]
  },
  "claims": {
    "projectionTypes": ["Requirement", "Specification", "DetailedDesign", "Source"]
  },
  "timestampPrecision": "datetime"
}
```

### Configuration Options

| Field | Description |
|---|---|
| `noteTypes` | Map of type name to `{shortcode, folder, description}`. Shortcodes become ID prefixes (R001, DD003). |
| `paths.notesRoot` | Where **new** notes are created. Default: `_scepter/notes` |
| `paths.dataDir` | Where SCEpter stores its data (config, templates, verification). Default: `_scepter` |
| `discoveryPaths` | Directories scanned for existing notes. Default: `["_scepter"]`. Use `["."]` to discover notes anywhere in the repo, or `["docs", "specs"]` to scan specific roots. Discovery is by ID prefix, independent of folder layout. |
| `discoveryExclude` | Additional glob patterns to exclude from discovery (on top of the built-in `node_modules`, `.git`, `dist`, etc.) |
| `sourceCodeIntegration` | Which source files to scan for note references |
| `claims.projectionTypes` | Note types that participate in traceability (order matters: upstream to downstream) |
| `timestampPrecision` | `"date"` (YYYY-MM-DD, default) or `"datetime"` (full ISO 8601) for note metadata |
| `statuses` | Optional status configuration with allowed values and visual mappings |

### Flexible Taxonomy

Your note types define your methodology. Some examples:

**Minimal** — just decisions and tasks:
```json
{ "Decision": { "shortcode": "D", "folder": "decisions" },
  "Task": { "shortcode": "T", "folder": "tasks" } }
```

**Research project:**
```json
{ "Hypothesis": { "shortcode": "H", "folder": "hypotheses" },
  "Experiment": { "shortcode": "E", "folder": "experiments" },
  "Finding": { "shortcode": "F", "folder": "findings" } }
```

**Bug tracking:**
```json
{ "Bug": { "shortcode": "B", "folder": "bugs" },
  "Feature": { "shortcode": "F", "folder": "features" },
  "TestCase": { "shortcode": "TC", "folder": "test-cases" } }
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Run CLI without building
npx tsx core/src/cli/index.ts <command>

# Build for distribution
npm run build
```

## Project Structure

```
scepter/
  core/               Source code
    src/
      cli/            CLI commands and formatters
      claims/         Claim indexing, traceability, verification
      config/         Configuration loading and validation
      context/        Context gathering
      discovery/      Note filesystem discovery
      notes/          Note CRUD and indexing
      parsers/        Note mention and claim address parsing
      project/        Composition root
      references/     Bidirectional reference graph
      scanners/       Source code reference scanning
      statuses/       Status validation and visual mapping
      templates/      Note type templates and project boilerplate
      types/          Shared type definitions
  _scepter/           SCEpter's own knowledge graph (dogfooding)
  claude/             Claude Code agents and skills
```

## License

MIT
