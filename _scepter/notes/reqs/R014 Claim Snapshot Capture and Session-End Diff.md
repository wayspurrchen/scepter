---
created: 2026-05-05
tags: [claims, snapshot, diff, regression, cli, lifecycle]
status: draft
---

# R014 - Claim Snapshot Capture and Session-End Diff

## Overview

A long-running session that touches notes, source code, or both can silently lose claim coverage — an `@implements` annotation gets removed during a refactor, a claim heading is renamed mid-edit, a note is deleted without retiring its claims first. The damage is invisible at the moment it happens because nothing in the trace matrix flags "this used to be covered." This requirement defines a snapshot artifact that captures the current state of the claim index to a JSON file and a diff command that compares a saved snapshot against the live index (or against another snapshot), grouping findings by category and offering an optional regression gate that exits non-zero on the specific shapes the user wants treated as regressions.

**Core Principle:** Snapshots are personal session artifacts, not repo-shared baselines. The agent or user invokes save explicitly at the start of meaningful work, does the work, and runs diff at the end. The artifact captures structural metadata and a body hash per claim — never the body text itself — so the file scales sub-linearly with claim body length and remains greppable plain JSON.

## Problem Statement

| Scenario | Current Behavior | Correct Behavior |
|----------|------------------|------------------|
| An `@implements` annotation is dropped during a refactor | No signal — `scepter claims trace` shows the gap, but only if the user already knew which claim to look at | `scepter claims snapshot diff <name>` lists the lost source ref under "Source ref drift" |
| A claim heading is silently renamed mid-session | Body and structure both change; FQID may even be preserved while the human-readable text drifts | Diff lists the heading change under "Heading / metadata changed" |
| A claim FQID disappears from the index because the note was edited | No history; the claim is just gone | Diff lists the FQID under "Lost claims" |
| The user wants a hard-fail signal for "covered claim that lost its coverage" | No facility — drift and regression collapse into the same noise | `scepter claims snapshot diff <name> --regressions` exits non-zero on dangling source coverage and on untombstoned claim loss |
| A claim was intentionally retired with `:removed` but the regression gate flagged it anyway | n/a — feature does not exist | Gate honors lifecycle tombstones plus a content-tombstone heuristic |

## Design Principles

**Snapshots are session artifacts, not baselines.** They live under `_scepter/snapshots/` and the directory is gitignored by default. The user is responsible for saving at session start; there is no auto-snapshot hook. Recovering snapshots from git history is out of scope.

**Capture metadata, not content.** A snapshot stores structural facts (FQIDs, headings, lifecycle, derivation, incoming refs) plus a content hash per claim and per note. The body bytes are never stored. This makes file size sub-linear in claim body length, keeps the artifact greppable, and ensures diffs can detect body changes without inflating the snapshot.

**Drift is information; regression is a gate.** Default diff output reports every category and exits zero — drift is the work being done and is not an error. The `--regressions` flag promotes two specific shapes (dangling source coverage, untombstoned claim loss) to non-zero exit, with suggested tombstone tags emitted alongside so the user can either fix the regression or explicitly accept it.

## Requirements

### §1 Snapshot Capture

The system MUST provide a CLI command that captures the current state of the claim index to a single JSON file. Capture consumes the in-memory claim index plus already-indexed source-reference data; it MUST NOT re-read claim body content from disk during capture (the indexer has already done that work).

§1.AC.01 The CLI MUST expose `scepter claims snapshot save [name]`, where `name` is an optional identifier for the snapshot.

§1.AC.02 When `name` is omitted, the system MUST default the name to a timestamp of the form `YYYY-MM-DD-HHMM` derived from the local clock at capture time.

§1.AC.03 The snapshot file MUST be plain JSON (no compression, no binary format) so that it is greppable and inspectable with standard tools.

§1.AC.04 For every claim in the index, the snapshot MUST record: the fully qualified claim ID, the parent note ID, the parent note's type, the heading text, the lifecycle state (lifecycle tag plus, if present, the supersession target FQID), the importance value, the list of `derivedFrom` target FQIDs, the list of incoming note-reference FQIDs, the list of incoming source references (each as `{filePath, line, refKind}`), and a content hash of the claim body.

§1.AC.05 The snapshot MUST NOT store claim body text — only the body hash MAY be stored as the body's representation.

§1.AC.06 For every note that contributes claims to the index, the snapshot MUST record: the note ID, the note title, the ordered list of claim FQIDs the note contains, and a hash of the note file's content.

§1.AC.07 The snapshot file MUST include top-level metadata: a schema version identifier, the capture timestamp as an ISO 8601 string, the absolute path of the project root, and, when the project root is inside a git working tree, the resolved git commit SHA at capture time.

§1.AC.08 When the project root is not inside a git working tree (or git is unavailable), the snapshot MUST omit the git commit field rather than failing the capture.

§1.AC.09 The save command MUST refuse to overwrite an existing snapshot file by default and exit non-zero with a clear error naming the existing file. A `--force` flag MUST opt into overwrite. With `--force`, the command MUST replace the existing snapshot atomically — write to a temp file in the same directory, then rename in place — so that a partial write cannot leave a corrupted snapshot in the success path.

### §2 Snapshot Storage

§2.AC.01 The system MUST write snapshot files to `_scepter/snapshots/<name>.json` relative to the project root.

§2.AC.02 When the `_scepter/snapshots/` directory does not exist at save time, the system MUST create it before writing.

§2.AC.03 When `scepter claims snapshot save` runs and the `_scepter/snapshots/` directory does not contain a `.gitignore` file, the save command MUST create one whose sole content is the line `*` (a single asterisk followed by a newline) so that any file written into the directory is ignored by git by default. The mechanism MUST be self-contained in the save command — it does not depend on `scepter init` or any other project-initialization path having run, so the behavior works correctly in pre-existing projects whose `_scepter/` predates the snapshot feature. The save command's own first invocation establishes the gitignore at the boundary where the directory is first touched.

§2.AC.04 The system MUST NOT provide a `--shared`, `--commit`, or equivalent flag that opts a snapshot into version control. Snapshots are personal session artifacts; a project that wants to commit a snapshot does so by explicit out-of-band action.

### §3 Snapshot Management

§3.AC.01 The CLI MUST expose `scepter claims snapshot list` which prints a table of saved snapshots with columns for name, capture timestamp, claim count, and file size.

§3.AC.02 The CLI MUST expose `scepter claims snapshot rm <name>` which deletes the named snapshot file.

§3.AC.03 `scepter claims snapshot rm <name>` MUST exit non-zero with a clear error message when no snapshot of that name exists.

§3.AC.04 The CLI MUST expose `scepter claims snapshot show <name>` which prints the snapshot's top-level metadata plus summary statistics (e.g., claim count, note count, count of claims with source refs).

§3.AC.05 `scepter claims snapshot show <name>` MUST NOT dump the full per-claim list by default — its output stays summary-scale regardless of snapshot size.

### §4 Snapshot Diff

§4.AC.01 The CLI MUST expose `scepter claims snapshot diff <name>` which compares the named snapshot (the baseline) against the current state of the live claim index (the candidate).

§4.AC.02 The CLI MUST expose `scepter claims snapshot diff <a> <b>` which compares two saved snapshots, with `<a>` as baseline and `<b>` as candidate.

§4.AC.03 The default diff output MUST be a structured human-readable report grouped by the categories specified in §5.

§4.AC.04 The diff command MUST exit zero regardless of whether drift is reported, when invoked without the `--regressions` flag.

§4.AC.05 The diff command MUST support a `--json` flag that emits the diff as a single machine-readable JSON document instead of the human-readable report.

§4.AC.06 The diff command MUST NOT load claim body content from disk while computing the diff. Detection of body changes MUST rely on the body hashes recorded in the snapshot plus the body hashes computable from the live index (or from the second snapshot in a snapshot-vs-snapshot diff).

§4.AC.07 The human-readable diff output MUST lead with a one-line summary header listing the per-category counts (e.g., `Lost: 3, New: 2, Body changed: 5, Heading/metadata changed: 1, Source ref drift: 7, Incoming note-ref drift: 4, Regressions: 0`), followed by a blank line, followed by the per-category sections in the order specified by §5. The summary header MUST be omitted in the `--json` output mode (the JSON shape carries counts as fields). When `--regressions` is set, the header MUST surface the regression count distinctly so the user sees the gate result before scrolling.

### §5 Diff Categories

The diff output groups findings into the categories listed below. Each category is a section in both the human-readable report and the `--json` output, and each category MUST appear even when it contains zero findings — empty sections are informative ("no findings here").

§5.AC.01 The diff MUST emit a **Lost claims** section listing every FQID that was present in the baseline and is absent in the candidate.

§5.AC.02 The diff MUST emit a **New claims** section listing every FQID that was absent in the baseline and is present in the candidate.

§5.AC.03 The diff MUST emit a **Body changed** section listing every FQID that is present in both baseline and candidate but whose body hash differs.

§5.AC.04 The diff MUST emit a **Heading or metadata changed** section listing every FQID that is present in both baseline and candidate and whose heading text, lifecycle state, importance, or `derivedFrom` list differs between the two.

§5.AC.05 The diff MUST emit a **Source ref drift** section that, per affected claim FQID, reports source refs (each as `{filePath, line, refKind}`) present in the baseline but absent in the candidate (lost) and source refs present in the candidate but absent in the baseline (gained).

§5.AC.06 The diff MUST emit an **Incoming note-ref drift** section that, per affected claim FQID, reports incoming note-reference FQIDs present in the baseline but absent in the candidate (lost) and incoming FQIDs present in the candidate but absent in the baseline (gained).

§5.AC.07 Every section MUST appear in the report even when its findings list is empty; an empty section MUST render with an explicit "no findings" indicator rather than being silently omitted.

### §6 Regression Gate

§6.AC.01 The diff command MUST support a `--regressions` flag.

§6.AC.02 With `--regressions`, the diff command MUST exit non-zero when, and only when, at least one finding matches one of the regression shapes defined in §6.AC.03 or §6.AC.04. Drift outside these shapes MUST NOT cause a non-zero exit.

§6.AC.03 The diff MUST treat as a **dangling source coverage** regression any claim FQID for which the baseline records at least one incoming source reference, the candidate records zero incoming source references, and the candidate state of the claim is not tombstoned per §7.

§6.AC.04 The diff MUST treat as an **untombstoned claim loss** regression any claim FQID that is present in the baseline, absent in the candidate, and whose baseline state was not tombstoned per §7.

§6.AC.05 Without `--regressions`, findings that match the regression shapes in §6.AC.03 and §6.AC.04 MUST appear under their normal categories (per §5) accompanied by a regression marker, and the command MUST still exit zero.

§6.AC.06 With `--regressions`, for every regression finding the diff MUST print a suggested action that would acknowledge or resolve the regression — naming the FQID and the file and line where the claim is defined (when available from the live index for the claim being lost or losing coverage). For `dangling-source-coverage` and `untombstoned-loss` regression shapes, the suggestion MUST name a lifecycle tag the user could add (`:removed` or `:superseded=TARGET`) to mark the regression as intentional. For the `derived-from-shrinkage` regression shape (§6.AC.07), the suggestion MUST present TWO options: either re-add the lost derivation target via `scepter meta add <fqid> derives=<lost-target>`, OR mark the regression intentional via `lifecycle=removed` or `lifecycle=superseded=TARGET`.

§6.AC.07 The diff MUST treat as a **derived-from shrinkage** regression any claim FQID that is present in BOTH the baseline and the candidate, whose baseline `derivedFrom` set included some target FQID Y that is absent from the candidate `derivedFrom` set, AND whose candidate-side state is not tombstoned per §7. Adding a derivation target (set growth) MUST NOT be treated as a regression; only shrinkage qualifies. The motivation is silent derivation-chain breakage: when a derivation link is dropped without an explicit tombstone, the trace graph silently loses the connection between the claim and its upstream target, and downstream consumers reasoning about the claim's authority lose their citation chain without notice. Tombstoning the claim per §7 MUST exempt it from this gate, matching the exemption pattern of §6.AC.03 and §6.AC.04.

### §7 Tombstone Equivalence

A claim is **tombstoned** for the purposes of the regression gate when at least one of the following holds. The tombstone check is evaluated against the appropriate state for the diff direction (live index for snapshot-vs-live diffs, baseline-side for §6.AC.04 baseline lookups, candidate-side for §6.AC.03 candidate lookups), not against pre-stored flags in the snapshot.

§7.AC.01 A claim MUST be treated as tombstoned when its lifecycle tag is `:removed`.

§7.AC.02 A claim MUST be treated as tombstoned when its lifecycle tag is `:superseded=<TARGET_FQID>`, regardless of whether the target FQID resolves.

§7.AC.03 A claim MUST be treated as tombstoned when the body content under the claim's heading (the text between the claim's heading and the next heading or claim, with leading and trailing whitespace stripped) matches the case-insensitive regex `/^(removed|superseded)\.?$/`. Examples that match include `Removed`, `removed.`, `REMOVED`, and `Superseded`. Examples that do not match include `Removed: see X` (longer prose), `This was removed in v2` (longer prose), and an empty body.

§7.AC.04 The tombstone check MUST NOT require any addition to the snapshot file schema. Body content for §7.AC.03 detection MUST come from the live claim index plus the project's existing claim parser, not from a new field on the snapshot.

### §8 Performance and Scale

§8.AC.01 The snapshot file MUST NOT include any field that stores claim body bytes; the body hash defined in §1.AC.04 is the only body-derived field permitted.

§8.AC.02 Snapshot capture MUST complete its computation by walking the in-memory claim index and the existing source-reference index, without per-claim disk reads of note files beyond what the indexer already performed.

§8.AC.03 The diff command MUST NOT read claim body content from disk; detection of body changes is satisfied by hash comparison alone (per §4.AC.06).

§8.AC.04 On a project with 10,000 claims, snapshot capture SHOULD complete in single-digit seconds on commodity hardware, and the resulting snapshot file SHOULD remain under 500KB. These targets are informational benchmarks, not hard contracts; failure to meet them is a signal to investigate, not a test failure.

## Edge Cases

### Snapshot name collides with an existing file

**Detection:** `scepter claims snapshot save <name>` is invoked with a `<name>` for which `_scepter/snapshots/<name>.json` already exists.

**Behavior:** The save command MUST refuse to overwrite by default and exit non-zero with a clear error naming the existing file. A `--force` flag opts into atomic overwrite per §1.AC.09.

### Snapshot file is malformed or schema-incompatible

**Detection:** `scepter claims snapshot diff <name>` is invoked against a file whose top-level schema version is missing or is a value the running CLI does not recognize.

**Behavior:** The diff command MUST exit non-zero with a clear error naming the snapshot file and the unrecognized schema version. The command MUST NOT attempt to run a diff against a snapshot it cannot read.

### Diff finds zero drift in every category

**Detection:** Baseline and candidate produce identical state across all six categories.

**Behavior:** Per §5.AC.07 every category section MUST still appear in the report with an explicit "no findings" indicator. The command exits zero with or without `--regressions`.

## Non-Goals

- **Auto-snapshot on session start** — Out of scope. The agent or user invokes save explicitly. The cost of an unintentional auto-capture (stale baselines, noise, write races with parallel agents) outweighs the convenience.
- **`--shared` or committed-snapshot variants** — Out of scope. Snapshots are personal session artifacts; cross-session-shared baselines are a different problem with different storage, naming, and lifecycle requirements.
- **Gzip or other compressed snapshot formats** — Out of scope for v1. Plain JSON only. Compression can be added later if file sizes warrant it.
- **Diff against arbitrary git refs** — Out of scope. The snapshot file is the unit of comparison; recovering snapshots from git history is the user's problem, not a CLI feature.
- **A snapshot-aware variant of `scepter claims trace` or `scepter claims gaps`** — Out of scope. The diff command is the dedicated surface for snapshot-vs-current comparison.
- **Tombstone vocabulary expansion** — The content-tombstone heuristic in §7.AC.03 recognizes the bare-word forms `removed` and `superseded` only. Adding adjacent vocabulary (`retired`, `obsolete`, `deleted`) is deferred unless real-world false-negative rate proves uncomfortable; the lifecycle vocabulary in {R005} is the canonical authority and the tombstone heuristic intentionally tracks that vocabulary 1:1.

## Open Questions

None open.

## Acceptance Criteria Summary

| Cluster | Count |
|---------|-------|
| §1 Snapshot Capture | 9 |
| §2 Snapshot Storage | 4 |
| §3 Snapshot Management | 5 |
| §4 Snapshot Diff | 7 |
| §5 Diff Categories | 7 |
| §6 Regression Gate | 7 |
| §7 Tombstone Equivalence | 4 |
| §8 Performance and Scale | 4 |
| **Total** | **47** |

## References

- {R005} — Claim Metadata, Verification, and Lifecycle. Defines the `:removed` and `:superseded=<TARGET>` lifecycle vocabulary that §7.AC.01 and §7.AC.02 consume.
- {R005.§2} — Lifecycle Tags. The closed lifecycle vocabulary and mutual-exclusion rule.
- {R004} — Claim-Level Addressability and Traceability System. Establishes the FQID format and the claim index that capture and diff consume.
- {S002} — Claim Reference Grammar Cross-Tab. The authoritative grammar for FQIDs that snapshot files serialize.
- {R009} — Claim Metadata Key-Value Store. The current home of the importance and lifecycle values that §1.AC.04 captures.

## Status

**2026-05-05** — Authored as draft. Implementation is a separate downstream dispatch; this requirement defines the AC set the user reviews before that dispatch begins.

**2026-05-05** — Resolved §OQ.01 → §1.AC.09 (`--force` flag with atomic temp-write-and-rename overwrite); §OQ.02 → §4.AC.07 (one-line summary header with per-category counts before category sections; omitted in `--json`); §OQ.03 → Non-Goals (tombstone vocabulary tracks {R005} 1:1, no adjacent vocab in v1). Rewrote §2.AC.03 to make the gitignore mechanism self-contained in the save command rather than coupled to `scepter init`. Total ACs 44 → 46.

**2026-05-06** — Added §6.AC.07 (`derivedFrom` shrinkage as third regression shape). Updated §6.AC.06 suggestion-text requirement to cover the new shape's two-option suggestion (restore derivation OR tombstone). Total ACs 46 → 47.
