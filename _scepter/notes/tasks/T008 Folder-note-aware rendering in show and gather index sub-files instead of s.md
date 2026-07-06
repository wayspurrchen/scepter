---
created: 2026-06-23T01:30:39.246Z
tags:
  - cli
  - dx
  - folder-notes
  - show
  - gather
confidence: 🤖2 2026-06-23
---

# T008 - Folder-note-aware rendering in show and gather: index sub-files instead of single-note view

## Problem

`scepter show` and `scepter gather` present a folder-form note as if it were a single flat
note. A folder note ({R008}) is a directory containing a main file plus companion `.md`
sub-files whose content is aggregated for claim extraction. When the surface treats it as a
single note, two failures appear:

1. The reader is not told it is a folder note — the multi-file structure is invisible.
2. Either all sub-file content is concatenated (too much — folder notes exist precisely
   because the content is large), or sub-files are silently dropped, hiding content.

## Desired behavior

`show` and `gather` must be folder-note aware:

- **Label it.** Render an explicit indicator that the note is a folder note.
- **Index, don't dump.** List the companion sub-files as an index (filenames, and ideally
  their section/claim headers) rather than inlining all of their content. By definition the
  aggregate is too large to inline.
- **Make sub-files findable.** `show` should give the reader the concrete list of sub-file
  paths so they can open them directly — i.e., the index doubles as a navigation surface.

This is a rendering/DX change, not a change to the folder-note data model or to claim
aggregation (claims still aggregate under the parent ID per {R008}; sub-files remain
non-independently-referenceable per {S002.§9.AC.04}).

## Code surfaces

- `core/src/cli/commands/context/gather-handler.ts` — reads folder note attachments
  (`fs/promises` `stat`/`readFile`); per {DD010} this is where folder-note attachment
  content is pulled in.
- `scepter show` handler (context commands) — the single-note rendering path that needs a
  folder-note branch.
- `NoteStorage.getAttachments()` ({A002}, {DD010}) — the abstraction that already enumerates
  a folder note's companion files; reuse it for the index rather than re-globbing.
- Formatter layer — needs a folder-note header + sub-file index rendering (mirror in the
  `--format json` output so machine consumers see the structure too).

## Open questions

- **OQ.01 — index granularity.** Filenames only, or filenames + section/claim headers
  extracted from each sub-file? The latter is more useful for navigation but couples the
  renderer to claim/section parsing.
- **OQ.02 — gather depth interaction.** How does the sub-file index interact with
  `--depth` / `--max-notes`? The index should probably be unconditional (cheap) while
  inlining stays governed by depth.
- **OQ.03 — opt-in full content.** Provide a flag (e.g. `--full` / `--expand`) to inline a
  named sub-file's content on demand, so the index is the default but full read is reachable
  without leaving the CLI.

## Related notes

- {R008} — Folder Note Claim Aggregation (the data model this rendering must honor).
- {S002.§9} — folder-note rules; {S002.§9.AC.04} companion sub-files are NOT independently
  referenceable (the index lists files for navigation, not as `{ID/sub.md}` reference targets).
- {DD010} — Storage Protocol Extraction; `gather-handler` folder-note attachment reads and
  the `Attachment` abstraction.
- {A002} — Backend Agnosticism; `NoteStorage.getAttachments()` as the enumeration surface.
- {DD006} / {A001} — CLI Unification (the `show`/`gather` surfaces being refined here).
- {T009} — Umbrella audit of claims + folder-note handling and CLI DX. Scopes this task as the
  concrete folder-note-rendering instance ({T009} §3/§4, P0); index-granularity OQ.01 here is
  carried as {T009}.OQ.03. (Added 2026-06-23 — sibling/umbrella back-reference.)

