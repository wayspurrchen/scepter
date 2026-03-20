# Test SCEpter Project

This is a comprehensive test fixture for SCEpter CLI testing with source code integration.

## Structure
- 15 interconnected notes across 5 types (Requirements, Decisions, Questions, Components, Milestones)
- 15 tasks distributed across mode folders
- 7 source code files that reference SCEpter notes
- Rich cross-references between notes, tasks, and source code
- Example work modes (requirements, architecture, implementation, devops)
- Context hints embedded in task frontmatter
- Mode-specific templates with contextHints
- Source code integration enabled for tracking note references

## Task Distribution
- Requirements mode: 3 tasks (T001-T003)
- Architecture mode: 4 tasks (T004-T006, T014)
- Implementation mode: 5 tasks (T007-T011)
- DevOps mode: 3 tasks (T012-T013, T015)

## Source Code Files
The project includes example source files that demonstrate SCEpter note references:
- `src/auth/auth-service.js` - Implements {C001}, references {R001}, {D001}, {T008}
- `src/api/rate-limiter.js` - Implements {R003}, depends on {C001}, {D004}
- `src/db/migrations/001-initial-schema.js` - Implements {D002}, addresses {T006}
- `src/components/Dashboard.tsx` - Implements {C004}, uses {D003} React
- `lib/data-export.py` - Implements {R004}, depends on {D002}, {C002}
- `test/integration/auth.test.js` - Validates {R001}, {C001}, {D001}
- `src/services/notification-service.js` - Implements {C003}, supports {Q002}, {R005}

## Context Hints
Tasks and templates include contextHints in frontmatter to guide context gathering:
- `patterns`: Search patterns for related content
- `includeTypes`: Note types to prioritize
- `includeCategories`: Categories to include

## Source Code Integration
The project has source code integration enabled in `scepter.config.json`:
- Scans `src`, `lib`, and `test` folders
- Supports JavaScript, TypeScript, and Python files
- Tracks references in comments using patterns like `@implements`, `@depends-on`, `@see`

## Testing Commands
Run SCEpter CLI commands from this directory:
```bash
# List all notes with source reference counts
scepter context list

# Show a note with its source code references
scepter context show C001

# Analyze a source file to see which notes it references
scepter context show --source-file src/auth/auth-service.js

# Search for authentication-related content (includes source files)
scepter context search authentication

# List tasks with mode column
scepter context list --types Task

# Get a specific task with its context hints
scepter context show T001

# Create a new task in a mode
scepter context create Task "New task" --mode implementation
```
