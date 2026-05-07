/**
 * Snapshot writer.  Captures the live in-memory `ClaimIndexData` plus
 * aggregated note bodies into a `Snapshot` value.  Pure transformation —
 * no filesystem I/O for the snapshot file itself; that lives in
 * `snapshot-store.ts`.
 *
 * Single-pass walk of the live `ClaimIndex`.  Per-note
 * `getAggregatedContents` reads are cached so each note is read at most
 * once per capture call.  No parallelism in v1 per §DC.17 — sequential
 * is the v1 baseline; bounded concurrency is reserved for a follow-up
 * DD if measurement misses the §DC.20 budget.
 *
 * @implements {DD018.§3.DC.12} writer reads SCHEMA_VERSION constant directly; no caller override
 * @implements {DD018.§3.DC.14} captureSnapshot async function signature
 * @implements {DD018.§3.DC.15} single-pass entries iteration; cross-ref classification
 * @implements {DD018.§3.DC.16} Body-content extraction algorithm
 * @implements {DD018.§3.DC.17} Sequential single-pass; no parallelism in v1
 * @implements {DD018.§3.DC.18} SnapshotNoteEntry emission per contributing note
 * @implements {DD018.§3.DC.19} gitCommit resolution via execFile with timeout fallback
 * @implements {DD018.§3.DC.20} 60s warning threshold; warning only, not hard-fail
 */

import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import type { ClaimIndex, ClaimIndexEntry, ClaimCrossReference } from '../claim-index.js';
import type { NoteFileManager } from '../../notes/note-file-manager.js';
import type { SourceCodeScanner } from '../../scanners/source-code-scanner.js';
import type { NoteManager } from '../../notes/note-manager.js';
import type {
  Snapshot,
  SnapshotClaimEntry,
  SnapshotLifecycle,
  SnapshotNoteEntry,
  SnapshotSourceRef,
} from './snapshot-types.js';
import {
  BODY_HASH_ALGORITHM,
  BODY_HASH_ENCODING,
  SCHEMA_VERSION,
  normalizeBodyForHash,
} from './snapshot-types.js';

const execFileAsync = promisify(execFile);

/**
 * Capture-time soft warning threshold per §DC.20.  Exceeding this
 * budget emits a stderr warning but does NOT fail the command — the
 * §8.AC.04 contract is informational, not hard.
 */
const CAPTURE_WARNING_BUDGET_MS = 60_000;

/**
 * Required dependencies for a snapshot capture.
 *
 * `claimIndex` and `noteFileManager` are required.  `noteManager` is
 * optional — when supplied, the writer reads note titles from it for
 * the per-note records; when absent, titles default to the empty string
 * per §DC.08's "MAY be the empty string" allowance.
 *
 * `sourceScanner` is OPTIONAL.  When supplied, the writer reads the
 * `referenceType` (`implements`, `validates`, etc.) of each incoming
 * source reference so the snapshot's `refKind` field is populated
 * faithfully per §DC.05's `SourceReferenceType` mapping.  When absent
 * (or when the scanner isn't ready), `refKind` defaults to `'mentions'`.
 *
 * The DD's §DC.14 signature names only `claimIndex`,
 * `noteFileManager`, and `projectRoot`; these two extra fields are
 * additive (the DD doesn't forbid them) and required to honor §DC.05's
 * faithful-`refKind` mapping — the existing `ClaimCrossReference`
 * doesn't carry `referenceType`, only the `SourceReference[]` from the
 * source scanner does.  The `noteManager` is similarly additive for
 * §DC.08's note-title resolution.
 */
export interface CaptureContext {
  claimIndex: ClaimIndex;
  noteFileManager: NoteFileManager;
  projectRoot: string;
  noteManager?: NoteManager;
  sourceScanner?: SourceCodeScanner;
}

/**
 * Capture a `Snapshot` from the live in-memory claim index + filesystem.
 *
 * The function consumes `claimIndex.getData()` to obtain entries,
 * cross-refs, and noteTypes; it does NOT call `claimIndex.build()`
 * itself (the caller is responsible for ensuring the index is
 * populated, typically via `ensureIndex`).
 *
 * @implements {DD018.§3.DC.14}
 * @implements {DD018.§3.DC.15}
 * @implements {DD018.§3.DC.17}
 */
export async function captureSnapshot(ctx: CaptureContext): Promise<Snapshot> {
  const startedAtMs = Date.now();

  const data = ctx.claimIndex.getData();

  // Build a per-(refKind) lookup keyed by `${filePath}:${line}:${toClaim}`
  // so we can hydrate `refKind` faithfully from the source scanner's
  // `SourceReference[]` without re-scanning files.  Each cross-ref's
  // `(filePath, line, toClaim)` triple is unique enough to recover the
  // originating reference's `referenceType` per §DC.05.
  //
  // When the scanner is absent or not ready, the lookup is empty and
  // `refKind` falls back to `'mentions'` — the most-conservative
  // SourceReferenceType for citation-only mentions.
  const refKindByKey = new Map<string, string>();
  if (ctx.sourceScanner?.isReady()) {
    const sourceRefs = ctx.sourceScanner.getIndex().getAllReferences();
    for (const sr of sourceRefs) {
      if (!sr.claimPath) continue;
      const normalized = sr.claimPath.replace(/^\./, '').replace(/§/g, '');
      const fqid = `${sr.toId}.${normalized}`;
      const key = `${sr.filePath}|${sr.line ?? 0}|${fqid}`;
      refKindByKey.set(key, sr.referenceType);
    }
  }

  // Per-note aggregated-content cache; keyed by noteId.  Each note is
  // read at most once per capture call per §DC.16(1) and §DC.18.
  const aggregatedByNoteId = new Map<string, string>();

  /**
   * Resolve the aggregated content for a note id, using the cache.
   * Returns the empty string when the note isn't readable; the writer
   * tolerates this by emitting a hash of the empty string rather than
   * failing the capture (the snapshot's purpose is to record what was
   * present at capture time; an unreadable note is a real condition).
   *
   * @implements {DD018.§3.DC.16} cache aggregated content per noteId
   */
  async function aggregatedFor(noteId: string): Promise<string> {
    const cached = aggregatedByNoteId.get(noteId);
    if (cached !== undefined) return cached;
    const content = (await ctx.noteFileManager.getAggregatedContents(noteId)) ?? '';
    aggregatedByNoteId.set(noteId, content);
    return content;
  }

  // Per-note collector for the §DC.18 second-pass — populated as we
  // iterate claims so a single linear walk produces both records.
  const claimFqidsByNoteId = new Map<string, string[]>();
  const contributingNoteIds = new Set<string>();

  // Pre-bucket cross-refs by `toClaim` for O(1) per-claim lookup
  // during the single-pass walk.  Avoids the §DC.15-described
  // `data.crossRefs.filter(...)` per-claim, which would be O(N*M).
  const crossRefsByTarget = new Map<string, ClaimCrossReference[]>();
  for (const cref of data.crossRefs) {
    const list = crossRefsByTarget.get(cref.toClaim);
    if (list) {
      list.push(cref);
    } else {
      crossRefsByTarget.set(cref.toClaim, [cref]);
    }
  }

  const claimEntries: SnapshotClaimEntry[] = [];

  for (const entry of data.entries.values()) {
    const aggregated = await aggregatedFor(entry.noteId);

    // §DC.16: extract body slice [entry.line+1 .. entry.endLine] (skip
    // the heading line itself), join with \n, normalize, hash.
    const bodyHash = hashClaimBody(aggregated, entry.line, entry.endLine);

    const refsForClaim = crossRefsByTarget.get(entry.fullyQualified) ?? [];
    const incomingNoteRefs: string[] = [];
    const incomingSourceRefs: SnapshotSourceRef[] = [];

    for (const cref of refsForClaim) {
      // §DC.15: split by fromNoteId shape — `source:filename` vs note id.
      if (cref.fromNoteId.startsWith('source:')) {
        const lookupKey = `${cref.filePath}|${cref.line}|${cref.toClaim}`;
        const refKind = refKindByKey.get(lookupKey) ?? 'mentions';
        incomingSourceRefs.push({
          filePath: toProjectRelativePosix(ctx.projectRoot, cref.filePath),
          line: cref.line,
          refKind,
        });
      } else {
        incomingNoteRefs.push(cref.fromClaim);
      }
    }

    // Sort the per-claim ref arrays for determinism.  Two captures with
    // identical inputs MUST produce byte-equal JSON modulo capturedAt
    // per §DC.10; if cross-ref iteration order is non-deterministic
    // (it is, in practice — the index merges multi-pass refs), the
    // snapshot would diverge.
    incomingNoteRefs.sort();
    incomingSourceRefs.sort(compareSnapshotSourceRefs);

    const lifecycle = mapLifecycle(entry);

    const claim: SnapshotClaimEntry = {
      fqid: entry.fullyQualified,
      noteId: entry.noteId,
      noteType: entry.noteType,
      heading: entry.heading,
      lifecycle,
      importance: entry.importance ?? null,
      derivedFrom: [...entry.derivedFrom].sort(),
      incomingNoteRefs,
      incomingSourceRefs,
      bodyHash,
    };
    claimEntries.push(claim);

    contributingNoteIds.add(entry.noteId);
    const list = claimFqidsByNoteId.get(entry.noteId);
    if (list) {
      list.push(entry.fullyQualified);
    } else {
      claimFqidsByNoteId.set(entry.noteId, [entry.fullyQualified]);
    }
  }

  // §DC.10: claims sorted by fqid ascending.
  claimEntries.sort((a, b) => (a.fqid < b.fqid ? -1 : a.fqid > b.fqid ? 1 : 0));

  // §DC.18: emit one SnapshotNoteEntry per contributing note.
  const noteEntries: SnapshotNoteEntry[] = [];
  for (const noteId of contributingNoteIds) {
    const aggregated = aggregatedByNoteId.get(noteId) ?? '';
    const noteContentHash = hashAggregatedContent(aggregated);
    const claimFqids = claimFqidsByNoteId.get(noteId) ?? [];
    const noteTitle = await resolveNoteTitle(noteId, ctx.noteManager);

    noteEntries.push({
      noteId,
      noteTitle,
      claimFqids,
      noteContentHash,
    });
  }

  // §DC.10: notes sorted by noteId ascending.
  noteEntries.sort((a, b) => (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0));

  // §DC.19: resolve gitCommit; tolerate every failure shape with null.
  const gitCommit = await resolveGitCommit(ctx.projectRoot);

  // @implements {DD018.§3.DC.12} schemaVersion read from SCHEMA_VERSION
  // constant; the writer accepts no caller override.
  const snapshot: Snapshot = {
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      projectRoot: ctx.projectRoot,
      gitCommit,
    },
    claims: claimEntries,
    notes: noteEntries,
  };

  // §DC.20: warn-only if we exceeded the budget.  No hard-fail, no
  // non-zero exit; this is informational.
  const elapsedMs = Date.now() - startedAtMs;
  if (elapsedMs > CAPTURE_WARNING_BUDGET_MS) {
    const seconds = Math.round(elapsedMs / 1000);
    process.stderr.write(
      `Warning: snapshot capture took ${seconds}s (>60s budget). ` +
        `Investigate index size or filesystem latency.\n`,
    );
  }

  return snapshot;
}

/**
 * Hash a claim body extracted from aggregated note content.  Slice is
 * `[line+1 .. endLine]` inclusive, joined with `\n`, normalized via the
 * canonical normalizer.
 *
 * @implements {DD018.§3.DC.16}
 */
function hashClaimBody(aggregated: string, lineOneBased: number, endLineOneBased: number): string {
  const lines = aggregated.split('\n');
  // Convert 1-based line numbers (claim-tree convention) to 0-based
  // array indices.  Slice from line+1 (skip heading itself) to
  // endLine (inclusive).  Array.slice(start, end) is end-exclusive.
  const startIdx = lineOneBased; // (lineOneBased - 1) + 1 = lineOneBased
  const endIdx = endLineOneBased; // (endLineOneBased - 1) + 1 = endLineOneBased

  // Defensive bounds — an unreadable note (empty aggregated) yields an
  // empty slice and an empty-body hash; a corrupt index with
  // out-of-range lines yields the same. Both are honest signals.
  const slice = lines.slice(startIdx, endIdx);
  const body = slice.join('\n');
  const normalized = normalizeBodyForHash(body);
  return createHash(BODY_HASH_ALGORITHM).update(normalized).digest(BODY_HASH_ENCODING);
}

/**
 * Hash aggregated note content using the same algorithm and
 * normalization as the body hash, per §DC.09.
 *
 * @implements {DD018.§3.DC.09}
 */
function hashAggregatedContent(aggregated: string): string {
  const normalized = normalizeBodyForHash(aggregated);
  return createHash(BODY_HASH_ALGORITHM).update(normalized).digest(BODY_HASH_ENCODING);
}

/**
 * Translate the in-memory `LifecycleState` to the on-disk
 * `SnapshotLifecycle` shape.  The on-disk `supersedes` field name
 * intentionally diverges from the in-memory `target` per §DC.04.
 */
function mapLifecycle(entry: ClaimIndexEntry): SnapshotLifecycle | null {
  const lc = entry.lifecycle;
  if (!lc) return null;
  const out: SnapshotLifecycle = { type: lc.type };
  if (lc.type === 'superseded' && typeof lc.target === 'string') {
    out.supersedes = lc.target;
  }
  return out;
}

/**
 * Comparator that orders source-refs deterministically by
 * (filePath, line, refKind).  Used to make per-claim
 * `incomingSourceRefs` arrays byte-stable across captures.
 */
function compareSnapshotSourceRefs(a: SnapshotSourceRef, b: SnapshotSourceRef): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.refKind !== b.refKind) return a.refKind < b.refKind ? -1 : 1;
  return 0;
}

/**
 * Convert an absolute (or already-relative) file path to a
 * project-relative POSIX path per §DC.05.  Path separators are
 * normalized to `/` so snapshots captured on Windows are diff-stable
 * against snapshots captured on POSIX hosts.
 */
function toProjectRelativePosix(projectRoot: string, filePath: string): string {
  const rel = path.isAbsolute(filePath) ? path.relative(projectRoot, filePath) : filePath;
  return rel.split(path.sep).join('/');
}

/**
 * Resolve a note's display title via the note manager.  Returns the
 * empty string when no title is available, per §DC.08's "MAY be the
 * empty string" allowance.
 */
async function resolveNoteTitle(noteId: string, noteManager: NoteManager | undefined): Promise<string> {
  if (!noteManager) return '';
  try {
    const note = await noteManager.getNoteById(noteId);
    return note?.title ?? '';
  } catch {
    return '';
  }
}

/**
 * Resolve `gitCommit` via `git rev-parse HEAD` with a 2-second timeout.
 * Returns the trimmed SHA on success or `null` on any failure
 * (non-zero exit, ENOENT, timeout, not in a git working tree) per
 * {R014.§1.AC.08}.  The capture MUST NOT propagate the underlying
 * error — the snapshot MUST succeed regardless of git availability.
 *
 * @implements {DD018.§3.DC.19}
 */
async function resolveGitCommit(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      timeout: 2000,
      // Inherit-stderr would pollute snapshot stdout when piped; suppress it.
      // execFile in promisified form uses an internal pipe — that's fine.
    });
    const trimmed = String(stdout).trim();
    if (trimmed.length === 0) return null;
    return trimmed;
  } catch {
    return null;
  }
}
