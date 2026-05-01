---
created: 2026-04-17
tags: [claims, folder-notes, aggregation]
status: draft
---

# R008 - Folder Note Claim Aggregation

## Overview

SCEpter supports folder-based notes: a directory containing a main markdown file (e.g., `R001.md`) plus companion markdown files and other assets. Before this feature, the claim system only indexed claims from the main file. Companion markdown files -- which may contain additional sections, acceptance criteria, design claims, or other structured content -- were invisible to claim indexing, linting, tracing, and gap analysis.

This requirement defines how the claim system treats folder-based notes as unified claim namespaces, aggregating content from all markdown files within a folder note for the purposes of claim extraction, indexing, and validation.

## Problem Statement

Large notes benefit from being split across multiple files within a folder note. A requirement might have its core claims in the main file and supplementary sections in companion files. A specification might split different subsystems across companion files for readability. Without aggregation, claims in companion files:

- Do not appear in the claim index
- Are invisible to `scepter claims trace` and `scepter claims gaps`
- Cannot be linted by `scepter claims lint`
- Cannot be referenced via the standard `{NOTE.N.AC.NN}` syntax
- Create a false sense of completeness in the traceability matrix

The claim system must treat all markdown content within a folder note as a single logical document.

## Design Principles

**Folder notes are single logical documents.** From the claim system's perspective, a folder note with three companion markdown files is one note with one claim namespace. Section IDs and claim IDs must be unique across all files in the folder, just as they would be in a single file.

**Transparent to consumers.** Code that references a folder note's claims (e.g., `R001.2.AC.01`) does not know or care whether AC.01 lives in the main file or a companion file. The aggregation is invisible at the reference layer.

**Main file is authoritative for metadata.** Only the main file's frontmatter (id, tags, status, created, etc.) is used. Companion files may have their own frontmatter for local tooling purposes, but it is stripped during aggregation.

**Deterministic ordering.** Companion files are included in alphabetical order by filename. Authors control the logical document order by naming files accordingly (e.g., `01-core.md`, `02-extensions.md`).

## Requirements

### §1 Content Aggregation

The system MUST provide a method for retrieving the full logical content of a note by aggregating the main file with all companion markdown files in a folder note. For non-folder notes, this method MUST behave identically to reading the single file.

§1.AC.01:4 For folder-based notes, `getAggregatedContents()` MUST read the main file and all companion `.md` files, returning their content concatenated into a single string.

§1.AC.02 Companion files MUST be sorted alphabetically by filename before concatenation, ensuring deterministic ordering across runs and platforms.

§1.AC.03 Frontmatter MUST be stripped from companion files during aggregation. Only the main file's frontmatter block survives in the aggregated output.

§1.AC.04 Non-markdown files (images, JSON, CSV, etc.) within the folder MUST be excluded from aggregation. Only files with the `.md` extension are included.

§1.AC.05 For non-folder notes (single-file notes), `getAggregatedContents()` MUST return content identical to `getFileContents()` -- no behavioral difference.

§1.AC.06 If a note ID is not found in the index, `getAggregatedContents()` MUST return `null`.

§1.AC.07 If the filesystem encounters an error during aggregation (permission denied, file disappeared between directory scan and read), the method MUST return `null` rather than throwing.

### §2 Claim Namespace Unification

Claims from all files within a folder note MUST be indexed under the parent note's ID, forming a single unified namespace. Existing validation rules (duplicate detection, monotonicity) apply across the full aggregated content.

§2.AC.01:4 The claim index MUST use aggregated content when building the index, so that claims defined in any companion file within a folder note are indexed under the parent note's ID.

§2.AC.02:4 The linter (`scepter claims lint`) MUST use aggregated content, so that structural validation (monotonicity, forbidden forms, unresolved references) spans all files within a folder note. (Refined 2026-04-30: see {R004.§4.AC.03} — same-note ID repeats are tolerated silently rather than reported as duplicates. This applies equally to repeats across companion files of a folder note, since aggregation makes the folder a single logical note.)

§2.AC.03 Sub-files of a folder note share a single ID namespace via aggregation. If two companion files both define `§3`, the parser keeps the first occurrence in alphabetical-filename order and silently drops the second. (Refined 2026-04-30: original wording required a duplicate error; the new tolerance rule applies uniformly to same-note repeats whether they live in one file or across companion files of a folder note. Authors who need both sections to appear must rename one.)

§2.AC.04 Claim IDs within a folder note share a single namespace via aggregation. If two companion files both define `§2.AC.01`, the parser keeps the first occurrence in alphabetical-filename order and silently drops the second. (Refined 2026-04-30: same rationale as §2.AC.03 above.)

§2.AC.05 The traceability matrix (`scepter claims trace`) MUST reflect claims from all companion files, since it is built from the claim index which uses aggregated content.

### §3 Referencing

Sub-files within a folder note are not independently addressable in the SCEpter reference system. The folder note is the atomic unit of identity.

§3.AC.01 The brace reference `{R001}` MUST reference the folder note as a whole. There is no syntax for referencing a specific companion file within a folder note.

§3.AC.02 Claims from any companion file MUST be qualified under the parent note's ID using the standard claim address syntax (e.g., `R001.§2.AC.01`). The file of origin is not part of the address.

§3.AC.03 Sub-file-level referencing (e.g., referencing `R001/details.md` as a distinct entity) is not supported by SCEpter's reference parser. Authors MAY adopt local conventions for cross-referencing companion files, but these are opaque to the system.

## Edge Cases

### Folder Note With No Companion Markdown Files

**Detection:** A folder note where the only `.md` file is the main file (other files are images, data, etc.).
**Behavior:** `getAggregatedContents()` returns the main file content only. Functionally identical to the non-folder case.

### Companion File With Frontmatter Containing Claims

**Detection:** A companion file whose YAML frontmatter contains claim-like text.
**Behavior:** Frontmatter is stripped before aggregation. Claims in frontmatter are never parsed by the claim tree builder regardless of aggregation, so this has no effect.

### Claim ID Collisions Across Sub-Files

**Detection:** Two companion files define the same section or claim ID (e.g., both have `§2` or both have `§1.AC.01`).
**Behavior:** The aggregated content is parsed as a single document. The claim tree builder's existing duplicate detection fires and reports the collision at the appropriate line numbers. The error message does not distinguish which sub-file the duplicate came from -- it reports line numbers within the aggregated text.

### Companion Files in Subdirectories

**Detection:** A folder note contains subdirectories with `.md` files (e.g., `R001 Title/subsystem/claims.md`).
**Behavior:** `scanFolderContents()` recursively scans subdirectories. Markdown files in subdirectories are included in aggregation, sorted alphabetically by their relative path.

## Non-Goals

- **Per-sub-file claim namespaces** -- Claims are not scoped to their source file. The folder note is one namespace. If authors need separate namespaces, they should use separate notes.
- **Sub-file identity in the reference graph** -- Companion files are not nodes in the reference graph. They have no IDs, no incoming references, no outgoing references as independent entities.
- **Aggregation of non-markdown content** -- JSON, YAML, CSV, and other data files are not parsed for claims. They are assets, not documents.
- **Cross-folder aggregation** -- Only files within a single folder note are aggregated. There is no mechanism for aggregating content across separate notes.

## Acceptance Criteria Summary

| Category | Count | Notes |
|----------|-------|-------|
| §1 Content Aggregation | 7 | AC.01 and AC.05 are the core behavioral boundary |
| §2 Claim Namespace Unification | 5 | AC.01-02 are high-binding (index and linter integration) |
| §3 Referencing | 3 | Defines what is NOT supported as much as what is |
| **Total** | **15** | |

## References

- `core/src/notes/note-file-manager.ts` -- `getAggregatedContents()` implementation
- `core/src/notes/folder-utils.ts` -- `scanFolderContents()`, `detectFolderNote()` infrastructure
- `core/src/cli/commands/claims/ensure-index.ts` -- Claim index build using aggregated content
- `core/src/cli/commands/claims/lint-command.ts` -- Linter using aggregated content
- `core/src/parsers/claim/claim-tree.ts` -- Claim tree builder with duplicate detection
- `core/src/notes/note-file-manager.test.ts` -- Test suite for `getAggregatedContents`
