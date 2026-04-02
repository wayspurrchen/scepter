# SCEpter Architecture Overview

**Last updated:** 2026-04-01

## What Is SCEpter

SCEpter (Software Composition Environment) is a CLI-first knowledge management system for AI-assisted software development. It maintains a structured knowledge graph inside a codebase using atomic markdown notes, bidirectional references, and claim-level traceability. The system is designed for both humans and AI agents (Claude Code, Cursor, etc.) to read, write, and query. Everything is stored as plain markdown and JSON in the repository.

The two problems SCEpter solves:
1. **Context loss** -- AI agents don't know what they don't know across sessions
2. **Decision amnesia** -- decisions from prior sessions are invisible to the next

---

## High-Level Architecture

```
CLI (Commander.js)
 |
 +-- Commands (context, claims, types, confidence, init, scaffold, config)
 |     |
 |     +-- Command definitions (.ts) -- argument parsing, option setup
 |     +-- Handler functions (-handler.ts) -- business logic, formatting
 |
 +-- BaseCommand.setup() -- creates ProjectManager, loads config, initializes
 |
 +-- ProjectManager (composition root)
       |
       +-- ConfigManager           -- loads/validates scepter.config.json
       +-- NoteManager             -- CRUD, indexing, querying notes
       |     +-- NoteFileManager   -- filesystem I/O for notes
       |     +-- NoteTypeResolver  -- maps shortcodes to type names
       |     +-- NoteIdGenerator   -- generates sequential IDs per type
       |     +-- UnifiedDiscovery  -- discovers notes by ID prefix across directories
       +-- ReferenceManager        -- bidirectional reference graph
       +-- SourceCodeScanner       -- scans source files for @implements, {ID} mentions
       +-- ContextGatherer         -- follows references to collect related notes
       +-- TaskDispatcher          -- task creation and LLM-assisted preparation
       +-- NoteTypeTemplateManager -- Handlebars templates for note creation
       +-- StatusValidator         -- validates statuses against allowed values
       +-- ClaimIndex              -- indexes claims across all notes
```

The entry point is `core/src/cli/index.ts`, which registers Commander.js commands and parses arguments. The shell script `./scepter` at the project root runs this via `tsx` (no build step required for development).

---

## Directory Structure

```
scepter/
  core/                         Main source code
    src/
      cli/                      CLI layer
        index.ts                Entry point, Commander.js program setup
        commands/               Command definitions and handlers
          context/              Notes commands (show, list, create, search, gather, ...)
          claims/               Claims commands (index, trace, gaps, lint, ...)
          types/                Note type management (list, add, rename, delete)
          confidence/           Confidence audit/mark commands
          init.ts               Project initialization
          scaffold.ts           Directory scaffolding from config
          config.ts             Config display
          base-command.ts       Shared setup: ProjectManager creation + cleanup
        formatters/             Output formatting (notes, claims, tables, trees, gather)
        formatter.ts            Mention/reference formatting
        scanner.ts              CLI-level scanning utilities
      claims/                   Claims subsystem
        claim-index.ts          In-memory index of all claims across notes
        claim-metadata.ts       Metadata interpretation (importance, lifecycle, tags)
        claim-search.ts         Filtering/querying claims by text, type, derivation
        claim-thread.ts         Relationship tree builder for claims
        traceability.ts         Traceability matrix and gap analysis
        verification-store.ts   Append-only verification event store (JSON sidecar)
        staleness.ts            Detects stale claims by comparing file mtime vs verification
        confidence.ts           File-level confidence annotations (AI/Human 1-5)
        index.ts                Barrel re-exports
      config/                   Configuration
        config-manager.ts       Loads, validates, merges SCEpterConfig
        config-validator.ts     Zod schemas for config validation
        default-scepter-config.ts  Built-in default config
      context/                  Context gathering
        context-gatherer.ts     Follows references + hints to collect related notes
      discovery/                Note discovery
        unified-discovery.ts    Discovers notes by ID prefix across configurable directories
      notes/                    Note management
        note-manager.ts         Primary note CRUD, indexing, querying (largest file)
        note-file-manager.ts    Filesystem I/O (read, write, move, delete note files)
        note-id-generator.ts    Sequential ID generation per note type
        note-type-resolver.ts   Resolves shortcodes (R, DD, S) to type names
        folder-utils.ts         Folder-based note detection and utilities
      parsers/                  Parsing
        note/
          note-parser.ts        Parses {ID} mentions, modifiers, tag extensions
          shared-note-utils.ts  ID validation, parsing, formatting
        claim/
          claim-parser.ts       Parses claim addresses (R004.3.AC.01, ranges)
          claim-tree.ts         Builds hierarchical claim tree from markdown headings
        repo.ts                 Directory tree printing utility
      project/                  Composition root
        project-manager.ts      Wires all subsystems together, lifecycle management
        type-reference-utils.ts Utilities for finding type references across notes/code
        types.ts                ProjectManager-specific type definitions
      references/               Reference graph
        reference-manager.ts    Bidirectional reference graph (outgoing/incoming)
        source-reference-index.ts  Index of source code references
        reference-tag-utils.ts  Tag extraction from reference syntax
      scanners/                 Source code scanning
        source-code-scanner.ts  Scans source files for note mentions, maintains cache
      statuses/                 Status system
        status-validator.ts     Validates statuses per note type (suggest/enforce modes)
      templates/                Template system
        note-type-template-manager.ts  Loads Handlebars templates for note creation
      tasks/                    Task system
        task-dispatcher.ts      Creates and dispatches tasks with LLM assistance
      llm/                      LLM integrations
        claude-code.ts          Claude Code SDK integration (query, logging)
        claude-interactive-yield.ts  Interactive yield detection for Claude
        openai.ts               OpenAI API integration
        types.ts                SimpleLLMFunction, LLMProvider interfaces
      chat/                     Chat session management
        chat-orchestrator.ts    Orchestrates task-based and interactive chat sessions
        session-manager.ts      Session lifecycle (start, chat, resume)
        session-store.ts        File-based session persistence
        chat-orchestration.ts   Orchestration flow implementation
        claude-code/            Claude Code-specific conversation management
        types.ts                ChatSession, YieldReason, DomainMessage
      services/                 Shared services
      migration/                Migration utilities
      test-utils/               Testing helpers
      types/                    Shared type definitions
        config.ts               SCEpterConfig, NoteTypeConfig, ClaimConfig, etc.
        note.ts                 Note, NoteQuery, NoteMetadata interfaces
        reference.ts            Reference, SourceReference, ClaimAddress, ReferenceGraph
        context.ts              ContextHints, DiscoveryMetadata, GatheredNote
        task.ts                 Task, TaskStatus, TaskResult, Yield
    boilerplates/               Project initialization templates
      blank/                    Empty project
      minimal/                  Minimal starter
      example/                  Full example with sample notes
      epi/                      Epistemic vocabulary taxonomy
  claude/                       Claude Code integration
    agents/                     Specialized subagents (researcher, reviewer, producer, linker)
    skills/                     Skills (scepter workflow, sce-retrofit)
  _scepter/                     SCEpter's own knowledge graph (dogfooding)
  ui/                           Web UI (separate)
  vscode/                       VS Code extension (separate)
  docs/                         Documentation and analysis
```

---

## CLI Structure

### Commander.js Setup

The CLI uses [Commander.js](https://github.com/tj/commander.js/) v11. The root program is defined in `core/src/cli/index.ts`:

- **Root command:** `scepter` with a `--project-dir <path>` option (defaults to cwd)
- **Subcommand groups:** `context` (alias `ctx`), `claims`, `types`, `confidence`
- **Standalone commands:** `init`, `scaffold`, `config`

A `preAction` hook propagates `--project-dir` to all subcommands, resolving it to an absolute path.

### Context Subcommand Shortcuts

The CLI auto-injects `ctx` when a user types a context subcommand without the prefix. For example, `scepter create Decision "Title"` is rewritten to `scepter ctx create Decision "Title"` at parse time. This eliminates the most common mistake where agents omit the `ctx` prefix.

### Command/Handler Pattern

Each command follows a two-file pattern:

1. **Command definition** (e.g., `show.ts`) -- defines Commander arguments, options, and calls the handler
2. **Handler** (e.g., `show-handler.ts`) -- contains the business logic, receives parsed options

All commands initialize through `BaseCommand.setup()`, which:
1. Creates a `ProjectManager` for the target directory
2. Loads config via `configManager.loadConfigFromFilesystem()`
3. Calls `projectManager.initialize()` to set up note discovery, scanning, etc.
4. Returns a `CommandContext` with the initialized `ProjectManager`

Cleanup is handled by `BaseCommand.execute()`, which wraps the handler in a try/finally.

### Formatters

Output formatting is separated from command handlers in `core/src/cli/formatters/`:
- `note-formatter.ts` -- note display (list, detail, metadata)
- `claim-formatter.ts` -- claim tables, trace output
- `gather-formatter.ts` -- context gathering output
- `tree-formatter.ts` -- hierarchical tree rendering
- `table-formatter.ts` -- tabular output
- `confidence-formatter.ts` -- confidence audit display
- `excerpt-extractor.ts` -- extracts relevant excerpts from note content

---

## Key Subsystems

### Notes Management

**Primary class:** `NoteManager` (`core/src/notes/note-manager.ts`)

NoteManager is the largest single file in the codebase and handles:
- Note CRUD (create, read, update, delete)
- In-memory indexing for fast querying
- The `NoteQuery` API (filter by type, tag, status, content, date ranges, references)
- Archive and soft-delete operations (notes go to `_archive` / `_deleted` subdirectories)
- File-system watching via chokidar for live reloading

NoteManager delegates to:
- **NoteFileManager** -- physical file I/O (read, write, move markdown files, parse frontmatter via `gray-matter`)
- **NoteTypeResolver** -- resolves shortcodes (e.g., "R" -> "Requirement") and determines folder paths
- **NoteIdGenerator** -- generates sequential IDs (R001, R002, ...) with collision checking
- **NoteTypeTemplateManager** -- renders Handlebars templates for new notes
- **UnifiedDiscovery** -- discovers notes by scanning configured directories for files matching the `[SHORTCODE][DIGITS]` pattern

Notes support two formats:
- **File-based:** `R001 Title.md` -- single markdown file
- **Folder-based:** `R001 Title/index.md` -- folder with main file plus additional assets (images, data)

### Reference System

**Primary class:** `ReferenceManager` (`core/src/references/reference-manager.ts`)

Maintains a bidirectional graph (`outgoing` and `incoming` maps) of references between notes. References are parsed from:

1. **Note content** -- `{R001}` brace syntax with optional modifiers (`+`, `>`, `<`, `$`, `*`), tags (`{R001#security,auth}`), and content extensions (`{R001: additional context}`)
2. **Source code** -- `@implements {R001}`, `@depends-on {R001}`, `@validates {R001}`, `@see {R001}`, and plain `{R001}` mentions in comments

The `SourceCodeScanner` discovers references in source files and feeds them into a `SourceReferenceIndex`, which the `ReferenceManager` queries alongside note-to-note references.

### Claims System

The claims system provides sub-note addressability. Within a markdown note, sections and acceptance criteria get structured IDs:

```
R004
  +-- section 1 (R004.1)
  |     +-- AC.01 (R004.1.AC.01)
  |     +-- AC.02 (R004.1.AC.02)
  +-- section 2 (R004.2)
        +-- AC.01 (R004.2.AC.01)
```

**Key components:**

- **Claim Parser** (`parsers/claim/claim-parser.ts`) -- Parses claim addresses like `R004.3.AC.01`, supports ranges (`AC.01-06`), braced and braceless forms, metadata suffixes (`:P0:security`)
- **Claim Tree Builder** (`parsers/claim/claim-tree.ts`) -- Parses markdown into a hierarchical tree of sections and claims based on heading structure
- **Claim Index** (`claims/claim-index.ts`) -- Builds an in-memory index across all notes, mapping fully-qualified claim IDs to their entries with cross-references
- **Traceability** (`claims/traceability.ts`) -- Builds traceability matrices showing how claims project across note types (Requirement -> Spec -> Design -> Source) and detects gaps
- **Verification Store** (`claims/verification-store.ts`) -- Append-only JSON store (`_scepter/verification.json`) recording when claims were verified
- **Staleness** (`claims/staleness.ts`) -- Detects stale claims by comparing source file modification times against verification dates
- **Search** (`claims/claim-search.ts`) -- Filters claims by text, note type, importance, lifecycle state, and derivation graph
- **Thread** (`claims/claim-thread.ts`) -- Builds relationship trees showing how claims connect across notes

**Claim metadata** is interpreted from colon-suffix tokens:
- **Importance:** digits 1-5 (e.g., `:P0` = priority 0... `:5` = importance 5)
- **Lifecycle:** `draft`, `active`, `deprecated`, `removed`, `superseded`
- **Derivation:** `derives=R004.1.AC.01` links claims across notes
- **Freeform tags:** any other token (e.g., `:security`)

### Confidence Tracking

**Module:** `claims/confidence.ts`

File-level annotations classify source files by review status:

```typescript
// @confidence AI3     -- AI-generated, moderate confidence
// @confidence Human4  -- human-reviewed, high confidence
```

- Levels 1-5, with reviewer type (AI or Human)
- `confidence audit` scans all source files and aggregates stats
- `confidence mark` adds or updates annotations

### Context Gathering

**Primary class:** `ContextGatherer` (`core/src/context/context-gatherer.ts`)

The `gather` command is the main interface for AI agents to pull in relevant knowledge. Given a note ID, it:

1. Finds the target note
2. Follows outgoing and incoming references to a configurable depth
3. Applies context hints (patterns, tags, type filters)
4. Deduplicates and sorts results
5. Outputs a formatted summary with reference counts

Context hints are stored in note frontmatter and specify search patterns, tags, and type inclusions that guide gathering.

### Template System

**Primary class:** `NoteTypeTemplateManager` (`core/src/templates/note-type-template-manager.ts`)

Manages Handlebars templates for note creation:
- Templates are stored in `_scepter/templates/types/` by default (configurable)
- Each note type can have a `.md` template with Handlebars variables
- Templates are loaded at initialization and cached in memory
- Supports file watching for live reloading

Project initialization templates (boilerplates) are stored in `core/boilerplates/` with four options: `blank`, `minimal`, `example`, and `epi`.

### Type System

Types are defined in `core/src/types/` and used throughout the codebase:

- **`SCEpterConfig`** -- top-level configuration with note types, paths, source integration, claims, statuses
- **`NoteTypeConfig`** -- per-type config: shortcode, folder, description, allowed statuses, folder note support
- **`Note`** -- core note entity with ID, type, title, content, tags, references, metadata
- **`NoteQuery`** -- unified query API with filters for type, tag, status, content, dates, references
- **`Reference`** -- edge in the reference graph (fromId, toId, modifier, sourceType)
- **`SourceReference`** -- extends Reference with file path, language, reference type (implements, depends-on, etc.)
- **`ClaimAddress`** -- parsed claim reference (noteId, sectionPath, claimPrefix, claimNumber)
- **`ContextHints`** -- patterns, tags, and type filters for context gathering
- **`Task`** -- task entity with status, context, result, and LLM conversation history
- **`ChatSession`** -- chat session with message history, yield detection, and status tracking

### Status System

**Primary class:** `StatusValidator` (`core/src/statuses/status-validator.ts`)

Validates note statuses against configured allowed values per note type:

- **Shorthand:** `["pending", "in-progress", "completed"]` with suggest mode
- **Full config:** sets (referencing reusable `statusSets`), values, mode (`suggest`/`enforce`), default
- Validation modes: `suggest` (warn but allow) or `enforce` (block invalid statuses)

### LLM Integrations

Located in `core/src/llm/`:

- **`claude-code.ts`** -- Integration with the Claude Code SDK (`@anthropic-ai/claude-code`). Uses the `query()` function with streaming. Includes session logging.
- **`openai.ts`** -- OpenAI API integration via the `openai` npm package. Supports all GPT-4 variants.
- **`types.ts`** -- Defines `SimpleLLMFunction` (a simple message-in, string-out interface) and `LLMProvider` (with streaming support). These abstractions allow the `TaskDispatcher` to work with either provider.

### Chat System

Located in `core/src/chat/`:

An orchestration layer for managing multi-turn conversations:

- **`ChatOrchestrator`** -- Coordinates task-based and interactive chat sessions, building system prompts from gathered context
- **`ChatSessionManager`** -- Session lifecycle management (start, chat, resume), delegates to `ClaudeConversationManager` for actual LLM interaction
- **`FileChatSessionStore`** -- Persists sessions as JSON files
- **`ClaudeConversationManager`** -- Claude Code SDK-specific conversation management with yield pattern detection
- **`MessageProcessor`** -- Transforms SDK messages into domain messages

Chat sessions track Claude Code session IDs, message history, and yield state. Yield detection supports pattern matching, token limits, and task completion signals.

### Note Discovery

**Primary class:** `UnifiedDiscovery` (`core/src/discovery/unified-discovery.ts`)

The "Notes Anywhere" system discovers notes by their ID prefix rather than by folder location:

- Scans configurable directories (default: `["_scepter"]`, can be `["."]` for entire project)
- Matches files against the pattern `[A-Z]{1,5}\d{3,5}` (e.g., `R001`, `DD003`)
- Builds a shortcode-to-type mapping from config
- Supports file watching for live discovery of new notes
- Respects exclusion patterns (node_modules, .git, dist, etc.)

---

## Configuration System

### _scepter Folder

Every SCEpter-enabled project has a `_scepter/` directory containing:

```
_scepter/
  scepter.config.json    Configuration file
  notes/                 Note storage (organized by type folders)
    arch/                Architecture notes
    reqs/                Requirement notes
    specs/               Specification notes
    tasks/               Task notes
    ...
  templates/
    types/               Handlebars templates per note type
  verification.json      Verification event store (for claims)
```

### scepter.config.json

Configuration is loaded by `ConfigManager` from two paths (in priority order):
1. `<project>/scepter.config.json`
2. `<project>/_scepter/scepter.config.json`

Validated at load time using Zod schemas (`ConfigValidator`). Key sections:

| Section | Purpose |
|---|---|
| `noteTypes` | Map of type name to `{shortcode, folder, description, allowedStatuses, ...}` |
| `paths` | `notesRoot` and `dataDir` (default: `_scepter`) |
| `sourceCodeIntegration` | Folders, extensions, and excludes for source code scanning |
| `claims` | Projection types for traceability, braceless matching, confidence config |
| `discoveryPaths` | Directories to scan for notes (default: `["_scepter"]`) |
| `discoveryExclude` | Additional glob patterns to exclude from discovery |
| `statusSets` | Reusable groups of status values |
| `timestampPrecision` | `"date"` or `"datetime"` for note metadata timestamps |
| `templates` | Template system config (enabled, paths, global variables) |

---

## Data Flow

### Creating a Note

```
CLI: scepter ctx create Requirement "Auth system"
  -> BaseCommand.setup() creates ProjectManager
  -> create-handler.ts validates type, generates ID via NoteIdGenerator
  -> NoteTypeTemplateManager renders template with variables
  -> NoteFileManager writes markdown file to disk
  -> NoteManager updates in-memory index
  -> StatusValidator validates initial status (if configured)
```

### Gathering Context

```
CLI: scepter ctx gather R001 --depth 2
  -> BaseCommand.setup() creates ProjectManager
  -> gather-handler.ts calls ContextGatherer.gatherContext()
  -> ContextGatherer follows ReferenceManager graph to depth 2
  -> Collects primary notes, then referenced notes
  -> Deduplicates, sorts by relevance
  -> gather-formatter.ts renders output with reference counts
```

### Tracing Claims

```
CLI: scepter claims trace R004
  -> BaseCommand.setup() creates ProjectManager
  -> trace-command.ts builds ClaimIndex from all notes
  -> buildTraceabilityMatrix() maps claims to projection types
  -> claim-formatter.ts renders matrix showing coverage across types
  -> Gap detection shows which claims lack downstream coverage
```

### Source Code Scanning

```
ProjectManager.initialize()
  -> SourceCodeScanner.initialize()
  -> Discovers files matching configured folders/extensions
  -> For each file: parseNoteMentions() extracts references
  -> Builds SourceReferenceIndex
  -> ReferenceManager.setSourceIndex() enables unified queries
```

---

## Key Dependencies

| Package | Role |
|---|---|
| `commander` | CLI argument parsing and command structure |
| `chalk` | Terminal output coloring |
| `gray-matter` | YAML frontmatter parsing from markdown files |
| `handlebars` | Template rendering for note creation |
| `chokidar` | Filesystem watching for live reloading |
| `zod` | Configuration schema validation |
| `glob` | File pattern matching for discovery and scanning |
| `fs-extra` | Extended filesystem operations |
| `@anthropic-ai/claude-code` | Claude Code SDK for LLM integration |
| `openai` | OpenAI API client |
| `cli-table3` | Table rendering for CLI output |
| `minimatch` | Glob pattern matching |
| `uuid` | Session ID generation |
| `vitest` | Test framework |
| `tsx` | TypeScript execution without build step |
| `tsup` | Build/bundling for distribution |
