---
created: 2026-03-16
tags: [claims,search,cli]
status: draft
---

# R007 - Claim Index Search

## Overview

{R004} established claim-level addressability and built a queryable in-memory index via `ClaimIndex.build()`. {R005} added importance and lifecycle metadata to index entries. {R006} added derivation relationships with bidirectional graph queries via `getDerivedFrom()` and `getDerivatives()`. The index can answer structured questions: "what claims exist in R005?", "which claims derive from this AC?", "what importance does this claim have?"

But there is no general-purpose search interface for claims. The existing `scepter search` command operates at the note level -- full-text search across note titles and content. There is no equivalent for the claim level. To find a specific claim, you must know its exact fully qualified ID, or grep the raw documents. There is no way to search across claim headings, filter by metadata dimensions, or explore the derivation graph interactively.

This requirement defines `scepter claims search`, a command that queries the computed claim index (not raw files) to find claims matching text patterns, metadata filters, and derivation graph relationships.

**Core Principle:** The claim index is an in-memory data structure computed from source documents. Search operates on this computed structure, not on raw file content. This means search results are always consistent with the index -- same claim IDs, same metadata, same derivation graph. It also means search is fast: once the index is built, queries are pure in-memory operations with no additional file I/O.

## Problem Statement

| Scenario | Current Behavior | Correct Behavior |
|----------|-----------------|------------------|
| "Find all AC.01 claims across the project" | Manual grep across all note files; results are raw text, not claim objects | `scepter claims search "AC.01"` returns structured results from the index |
| "Which claims mention 'catalog' or 'aspect' in their heading?" | No mechanism; grep gives false positives from body text | `scepter claims search "catalog\|aspect" --regex` matches against heading text |
| "Show me all claims that derive from R005.§1.AC.01" | Must read DD documents and manually search for `derives=` metadata | `scepter claims search --derives-from R005.§1.AC.01` queries the derivation index |
| "List all high-importance requirement claims" | No filter; read all documents and look for `:4` or `:5` suffixes | `scepter claims search "" --types Requirement --importance 4` |
| "Which claims have derivation metadata?" | No mechanism | `scepter claims search "" --has-derivation` filters on derivedFrom presence |
| "Find claims in S006 matching 'tradition'" | Open S006 manually and read | `scepter claims search "tradition" --note S006` scopes search to one note |
| "Pattern-match DC claim IDs" | Manual grep with regex | `scepter claims search "DC\.\d+" --id-only --regex` searches IDs only |

## Design Principles

**Index-first, not file-first.** Search reads from the computed claim index, not from raw markdown files. This means the command depends on `ClaimIndex.build()` having been called. The index IS the search corpus.

**Query plus filters.** The text query and filter options compose independently. The text query matches against claim IDs and/or heading text. Filters narrow the result set by type, note, importance, lifecycle, and derivation properties. An empty query with filters is valid (filter-only mode). A query with no filters is valid (text-only mode).

**Same normalization as existing search.** The `--regex` flag uses the same `\|` to `|` normalization as the existing `scepter search` command's regex handling. This keeps the CLI behavior consistent: shell-escaped `\|` is treated as alternation, not literal pipe.

**Three output tiers.** List (compact, default), detailed (heading text and context), JSON (machine-readable). These mirror the output formats established in the existing `scepter search` command.

## Requirements

### §1 Query Matching

The search command MUST accept a text query that matches against claim data in the index. By default, the query matches against both claim IDs and heading text. The `--id-only` flag restricts matching to claim IDs only.

§1.AC.01:4 The `scepter claims search <query>` command MUST match the query string against both claim IDs (the `fullyQualified` field) and heading text (the `heading` field) of every `ClaimIndexEntry` in the index.

§1.AC.02 The `--id-only` flag MUST restrict query matching to claim IDs only (the `fullyQualified` and `claimId` fields), excluding heading text from matching.

§1.AC.03 When `--regex` is specified, the query MUST be treated as a regular expression. Shell-escaped `\|` MUST be normalized to `|` for alternation, matching the behavior of the existing `scepter search` command.

§1.AC.04 When `--regex` is not specified, the query MUST be treated as a literal string with case-insensitive matching by default.

§1.AC.05:4 An empty string query (`""`) MUST be valid when at least one filter option is provided. This enables filter-only mode where all claims are candidates before filters are applied.

§1.AC.06 An empty string query with no filter options MUST produce an error message instructing the user to provide a query or at least one filter.

### §2 Filtering

The search command MUST support filter options that narrow results by note-level and claim-level properties. Filters compose conjunctively (AND) with each other and with the text query.

§2.AC.01 The `--types <types...>` option MUST filter results to claims whose containing note matches one of the specified note types (e.g., `Requirement`, `DetailedDesign`). Type matching MUST use the same resolution as the existing note type system (full name or shortcode).

§2.AC.02 The `--note <noteId>` option MUST restrict results to claims within the specified note ID. The note ID MUST be validated against the index; an unrecognized note ID MUST produce an error.

§2.AC.03 The `--importance <n>` option MUST filter results to claims with importance at or above the specified level (1-5). Claims with no importance annotation MUST be excluded when this filter is active.

§2.AC.04 The `--lifecycle <state>` option MUST filter results to claims with the specified lifecycle state (closed, deferred, removed, superseded). Claims with no lifecycle state MUST be excluded when this filter is active.

§2.AC.05 Multiple filters MUST compose conjunctively (AND). A claim must satisfy ALL active filters and the text query to appear in results.

§2.AC.06 The `--limit <n>` option MUST cap the number of results returned. The default limit MUST be 50.

### §3 Derivation Graph Queries

The search command MUST support querying the derivation graph built by {R006}. These options use the bidirectional derivation index ({R006.§2.AC.04}) to find claims based on their derivation relationships.

§3.AC.01 The `--derives-from <claimId>` option MUST return claims whose `derivedFrom` field contains the specified claim ID. The claim ID argument MUST be resolved against the index (supporting fully qualified and partial forms).

§3.AC.02 The `--derivatives-of <claimId>` option MUST return claims that appear in the derivatives list of the specified claim ID. This uses the reverse derivation index ({R006.§2.AC.03} `getDerivatives()`).

§3.AC.03 The `--has-derivation` flag MUST filter results to claims that have a non-empty `derivedFrom` field -- claims that declare derivation from at least one source.

§3.AC.04 Derivation query options MUST compose with text queries and other filters. For example, `--derives-from R005.§1.AC.01 --types DetailedDesign` finds only DetailedDesign claims deriving from that AC.

§3.AC.05 When `--derives-from` or `--derivatives-of` specifies a claim ID that does not resolve in the index, the command MUST produce an error message identifying the unresolvable claim.

### §4 Output Formats

The search command MUST support three output formats controlled by the `--format` option.

§4.AC.01 The `list` format (default) MUST display one line per matching claim showing: the fully qualified claim ID, the note type, and a truncated heading (max 60 characters, with ellipsis if truncated).

§4.AC.02 The `detailed` format MUST display each matching claim with: fully qualified claim ID, note type, full heading text, importance (if present), lifecycle state (if present), derivation sources (if present), and the note file path.

§4.AC.03 The `json` format MUST output a JSON array of objects, one per matching claim, containing: `fullyQualified`, `noteId`, `noteType`, `claimId`, `heading`, `sectionPath`, `importance` (number or null), `lifecycle` (string or null), `derivedFrom` (array of strings), and `noteFilePath`.

§4.AC.04 All output formats MUST report the total number of matching claims and whether the result set was truncated by the limit.

§4.AC.05 The `list` and `detailed` formats MUST visually distinguish claims with importance 4+ (e.g., bold or color highlighting), consistent with the display conventions in {R005.§1.AC.03}.

### §5 CLI Interface

The command MUST be registered under the `scepter claims` command group and follow established CLI conventions.

§5.AC.01:4 The command MUST be invoked as `scepter claims search <query> [options]` where `<query>` is a positional argument and all filter/format options are flags or option arguments.

§5.AC.02 The command MUST build the claim index via `ClaimIndex.build()` before executing the search. No persistent index cache is required -- the index is rebuilt on each invocation.

§5.AC.03 The command MUST NOT perform additional file I/O beyond what is required to build the claim index. Once the index is built, all query and filter operations MUST be in-memory.

§5.AC.04 Error messages for invalid options (e.g., `--importance 7`, `--lifecycle unknown`, unresolvable `--note` ID) MUST be specific and actionable, identifying the invalid value and the valid alternatives.

§5.AC.05 The command MUST support `--help` displaying all options with descriptions and usage examples.

## Edge Cases

### Empty Index

**Detection:** No notes contain claim markup, so the index has zero entries.
**Behavior:** The command reports "No claims found in the index." and exits with code 0. This is not an error -- it means no documents participate in claim tracking.

### Query Matches ID but Not Heading

**Detection:** `scepter claims search "AC.01"` where "AC.01" appears in the fully qualified ID but not in the heading text.
**Behavior:** The claim matches because the default search scope includes both IDs and headings. The `--id-only` flag would also match. This is the common case for ID-based queries.

### Regex Syntax Error

**Detection:** `scepter claims search "[unclosed" --regex` with invalid regex.
**Behavior:** The command reports a specific regex syntax error and exits with a non-zero code. It does not fall back to literal matching.

### Derivation Chain Traversal

**Detection:** `--derives-from R005.§1.AC.01` where DC.01 derives from AC.01 and DC.01a derives from DC.01.
**Behavior:** Only direct derivatives are returned (DC.01). Transitive traversal is not performed. The user can chain queries or use `scepter claims trace --show-derived` for full chain visibility.

### Filter Produces Zero Results

**Detection:** `--types Specification` when no Specification notes exist in the project.
**Behavior:** The command reports "No claims match the specified filters." and exits with code 0. The result count line shows "0 claims found."

### Partial Claim ID Resolution in --derives-from

**Detection:** `--derives-from AC.01` (bare, no note ID).
**Behavior:** The claim ID is resolved against the index using the same resolution logic as {R004.§1.AC.03}. If the bare form is ambiguous (multiple notes have AC.01), the command reports the ambiguity and requires a more specific form.

## Non-Goals

- **Full-text body search within claims** -- The search matches claim IDs and heading text, not the body content under each claim heading. Body-level search is what the existing `scepter search` command does at the note level. Claim search is about structured index queries, not content grep.
- **Persistent search index or caching** -- The index is rebuilt on each invocation. Caching is an optimization that may be added later but is not part of this requirement.
- **Cross-reference graph queries** -- Searching based on cross-reference relationships (e.g., "find claims that reference R004") is a natural extension but is out of scope. This requirement focuses on text matching, metadata filtering, and derivation graph queries.
- **Interactive or fuzzy search** -- No interactive mode (like fzf-style filtering). The command is non-interactive, suitable for both human CLI use and agent automation.
- **Source code claim search** -- The search operates on the claim index built from notes. Source code `@implements` references are visible via `scepter claims trace`, not via `scepter claims search`.
- **Saved searches or search aliases** -- No mechanism to save frequently used search queries. The command is stateless.

## Acceptance Criteria Summary

| Category | Count |
|----------|-------|
| §1 Query Matching | 6 |
| §2 Filtering | 6 |
| §3 Derivation Graph Queries | 5 |
| §4 Output Formats | 5 |
| §5 CLI Interface | 5 |
| **Total** | **27** |

## References

- {R004} -- Claim-Level Addressability and Traceability System (claim index infrastructure, addressing syntax)
- {R004.§4.AC.01} -- Index scanning and queryable index (the data source this command queries)
- {R005} -- Claim Metadata, Verification, and Lifecycle (importance and lifecycle filters)
- {R005.§1.AC.01} -- Importance digit recognition (metadata available in index entries)
- {R005.§1.AC.03} -- Visual distinction for importance 4+ (output display convention)
- {R005.§2.AC.01} -- Lifecycle tag extraction (metadata available in index entries)
- {R006} -- Claim Derivation Tracing (derivation graph queries)
- {R006.§2.AC.02} -- `getDerivedFrom()` (used by --derives-from)
- {R006.§2.AC.03} -- `getDerivatives()` (used by --derivatives-of)
- {R006.§2.AC.04} -- Bidirectional derivation indexing (enables both query directions)
- `core/src/claims/claim-index.ts` -- `ClaimIndex` class and `ClaimIndexEntry` interface
- `core/src/cli/commands/context/search-handler.ts` -- Existing note-level search (prior art for regex normalization, output formats)
