# SCEpter CLI Reference

**MUST-LOAD for any agent about to invoke the `scepter` CLI.** This includes producers (running `scepter create`, `scepter claims trace`), reviewers (running `scepter claims trace/gaps/lint/stale`), researchers (running `scepter ctx show/gather/search`, `scepter claims trace/search/thread`), and any orchestrator running CLI commands directly. Load timing is lazy — read this file the first time your dispatch needs to invoke the CLI, not necessarily during initial orientation. Do NOT improvise commands; consult this reference before guessing flags or syntax.

## Invocation rule (read before running anything)

ALWAYS invoke as plain `scepter <subcommand>`. NEVER prefix with `./scepter`, an absolute path, `pnpm tsx <something>`, `node <something>`, or any other runtime wrapper. The plain command is the contract; PATH resolution is the user's environment problem, not yours.

If `scepter` is not in `$PATH` (e.g., `command -v scepter` empty, `scepter --version` errors with `command not found`), STOP immediately and surface to the dispatcher: report that the CLI is not installed and ask the user to install it properly (e.g., `npm link`, global install, shell alias). Do NOT work around a missing CLI by reaching into the project source tree to invoke `tsx core/src/cli/index.ts` directly — that bypasses the user's installed version, produces inconsistent behavior across sessions, and hides an environment problem the user needs to fix once.

Context subcommands work at the top level: `scepter list` = `scepter ctx list`.

## Discovery
```bash
scepter config                                    # ALWAYS run first - see types, shortcodes, modes
scepter list                                      # All notes (default: 25, newest first)
scepter list --limit 50                           # Override default limit
scepter list -t Decision,Requirement              # Filter by type
scepter list -t T --status pending                # Pending tasks
scepter list --modified-after "3 days ago"        # Recent activity
scepter list --created-after "1 week ago"         # Recently created
scepter list --tags auth,security                 # Filter by tags
scepter list --has-refs                           # Notes with references
scepter list --has-no-refs                        # Orphan notes
scepter list --references D001                    # What references D001?
scepter list --referenced-by T025                 # What does T025 reference?
scepter list --format tree --tree-depth 2         # Hierarchical view
scepter list --format json                        # Machine readable
scepter list --columns id,title,status            # Specific columns
```

## Viewing Notes
```bash
scepter show D001                                 # View a specific note
scepter show D001 -r                              # With references
scepter show D001 -r --depth 2                    # With reference chain (2 levels)
scepter show "D*"                                 # Glob: all decisions
scepter show "T00[1-9]"                           # Range: T001-T009
scepter show --source-file src/auth/service.ts    # What notes does this file reference?

# Cross-project: an alias-prefixed argument shows a peer project's note
# with a clearly visible peer-source header. Aliases are declared in the
# local project's scepter.config.json under projectAliases.
scepter show vendor-lib/R042                      # Peer project's R042
```

## Context Gathering
```bash
scepter gather T001                               # EXTREMELY USEFUL; prefer over `show` for task bootstrapping
scepter gather T001 --depth 1                     # Direct references only
scepter gather T001 --depth 2                     # Two levels deep
scepter gather D001 --refs-only                   # Just reference structure
scepter gather T001 --max-notes 20                # Limit context size

# Cross-project references encountered in the gathered note's content
# are listed as one-line stubs (alias + peer note ID, "not loaded")
# in a "Cross-project citations" footer. Peer content is NOT loaded
# by default; the local project's aggregate counts exclude peers.
```

## Searching
```bash
scepter search "authentication"                   # Full-text search in notes
scepter search "jwt" --include-source             # Search notes AND code
scepter search "auth|login" --regex               # Regex search
scepter search "api" --types Requirement          # Search specific types
scepter search "jwt" --context-lines 3            # Show context around matches
```

## Creating Notes
```bash
# ALWAYS search first to avoid duplicates
scepter search "caching strategy"
scepter list --types Decision --tags cache

# Create notes (ID is auto-generated - NEVER guess it)
scepter create Decision "Use Redis for caching" --tags cache,infrastructure
scepter create Requirement "Support OAuth2" --tags auth,security
scepter create Task "Implement login flow" --tags auth

# With initial content
scepter create Decision "Use JWT" --content "Based on {R001}, JWT provides stateless auth..."

# Folder-based notes (for complex notes with sub-documents)
scepter create Requirement "API Spec" --folder --tags api

# Convert between formats
scepter convert D001 --to-folder
scepter convert D001 --to-folder --dry-run

# Folder notes and claims: companion .md files are aggregated for claim
# extraction. Claims in any sub-file are indexed under the parent note ID.
# Section/claim IDs must be unique across all sub-files in the folder.
# See claims.md "Folder Notes and Claims" for details.
```

## After Creating a Note
The create command prints the file path and auto-generated ID. Use that path to edit content directly. Add `{ID}` references to connect to related notes.

## Claim Tools (CRITICAL — Use These, Don't Guess)

**You MUST use the claims CLI to verify traceability.** Do not rely on reading code comments, grep results, or your own memory to determine whether a claim is implemented, traced, or has gaps. The CLI is the single source of truth for claim state.

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

## Lifecycle
```bash
scepter archive D001                              # Archive a note
scepter restore D001                              # Restore from archive
scepter delete D001                               # Soft delete
scepter purge D001                                # Permanent delete
```

## Help
```bash
scepter --help                                    # Main help
scepter ctx list --help                           # List command help
scepter ctx create --help                         # Create command help
scepter claims --help                             # Claim subcommands
```
