/**
 * Rewrite-log writer for the lifecycle subsystem.
 *
 * Each successful mutating rewriter run persists a structured JSON
 * entry under `_scepter/lifecycle-log/<TIMESTAMP>-<RUN_ID>.json`. The
 * entry is sufficient to replay the rewrite OR (with the same data)
 * to compute its inverse — restoring the pre-operation state of every
 * touched file.
 *
 * The schema is intentionally redundant: per-file/per-span records
 * carry both `beforeText` and `afterText`, allowing an `undo`
 * subcommand to reapply the inverse without re-running scanners.
 *
 * Log filename uses the marker timestamp helper (compact-numeric
 * `YYYYMMDD` or `YYYYMMDDHHMM`) so the lifecycle subsystem speaks one
 * timestamp dialect, governed by the project's `timestampPrecision`
 * setting.
 *
 * @implements {DD020.§3.DC.05} structured RewriteLogEntry per touched file, per modified region, with byteRange/before/after/surface
 * @implements {DD020.§3.DC.06} schema is sufficient for inverse replay (undo); this module does NOT author the undo command itself
 * @implements {DD020.§3.DC.10} log filename timestamp consumes timestampPrecision via the marker timestamp helper
 * @implements {DD020.§4.DC.19} rewrite-log surface admits a future undo invocation; v1 does NOT ship undo
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  formatMarkerTimestamp,
  type TimestampPrecision,
} from '../deletion-marker';
import type {
  PlannedFileEdit,
  ReferenceSpan,
  RewritePlan,
  SpanSurface,
} from '../rewriter';

/** Per-span before/after record persisted in the log. */
export interface LoggedSpanEdit {
  surface: SpanSurface;
  /** Byte range of the note-ID sub-portion that was rewritten. */
  byteRange: [number, number];
  beforeText: string;
  afterText: string;
}

/** Per-file record persisted in the log. */
export interface LoggedFileChange {
  filePath: string;
  spans: LoggedSpanEdit[];
}

/** Aggregated warning record (cross-project skip, etc.). */
export interface LoggedWarning {
  filePath: string;
  originalText: string;
  reason: string;
  surface: SpanSurface;
}

/** Aggregated audit record (test-name embed, etc.). */
export interface LoggedAudit {
  filePath: string;
  originalText: string;
  reason?: string;
  surface: SpanSurface;
}

/** Filesystem removals recorded with the log entry. */
export interface LoggedRemoval {
  path: string;
}

/** Filesystem renames recorded with the log entry. */
export interface LoggedRename {
  from: string;
  to: string;
}

/** Full structured log entry — one per mutating run. */
export interface RewriteLogEntry {
  runId: string;
  /** ISO 8601 (not the compact marker timestamp; full precision). */
  timestamp: string;
  operation: 'delete' | 'rename' | 'archive';
  /** Target note ID (delete: retired ID; rename: source ID). */
  target: string;
  /** Rename target ID when operation is `'rename'`. */
  renameTarget?: string;
  /** Deletion marker token when operation is `'delete'`. */
  marker?: string;
  files: LoggedFileChange[];
  removals: LoggedRemoval[];
  renames: LoggedRename[];
  warnings: LoggedWarning[];
  audits: LoggedAudit[];
}

/**
 * Build a `RewriteLogEntry` from a successfully-committed plan plus
 * the rewritten contents.
 *
 * `contentsAfter` is a map from file path to the post-rewrite content,
 * so the writer can record `afterText` accurately without re-running
 * the substituter.
 */
export function buildRewriteLogEntry(
  runId: string,
  plan: RewritePlan,
  contentsBefore: Map<string, string>,
  contentsAfter: Map<string, string>,
): RewriteLogEntry {
  const files: LoggedFileChange[] = plan.fileEdits.map((edit) =>
    buildLoggedFileChange(edit, contentsBefore, contentsAfter),
  );

  const warnings: LoggedWarning[] = plan.warnings.map((w) => ({
    filePath: w.span.filePath,
    originalText: w.span.originalText,
    reason: w.reason,
    surface: w.span.surface,
  }));

  const audits: LoggedAudit[] = plan.audits.map((a) => ({
    filePath: a.span.filePath,
    originalText: a.span.originalText,
    reason: a.reason,
    surface: a.span.surface,
  }));

  const baseEntry: RewriteLogEntry = {
    runId,
    timestamp: new Date().toISOString(),
    operation: plan.operation.kind,
    target:
      plan.operation.kind === 'rename'
        ? plan.operation.source
        : plan.operation.target,
    files,
    removals: plan.removals.map((p) => ({ path: p })),
    renames: plan.renames.map((r) => ({ from: r.from, to: r.to })),
    warnings,
    audits,
  };

  if (plan.operation.kind === 'rename') {
    baseEntry.renameTarget = plan.operation.target;
  }
  if (plan.operation.kind === 'delete') {
    baseEntry.marker = plan.operation.marker;
  }

  return baseEntry;
}

function buildLoggedFileChange(
  edit: PlannedFileEdit,
  contentsBefore: Map<string, string>,
  contentsAfter: Map<string, string>,
): LoggedFileChange {
  const before = contentsBefore.get(edit.filePath) ?? '';
  const after = contentsAfter.get(edit.filePath) ?? before;
  const spans: LoggedSpanEdit[] = edit.edits.map(({ span, action }) => {
    const [start, end] = span.noteIdRange;
    const beforeText = before.slice(start, end);
    // The substituter replaces the noteIdRange with action.replacement;
    // afterText is the replacement itself (the byteRange in the post
    // text shifts, but the replacement is what was written).
    return {
      surface: span.surface,
      byteRange: [start, end],
      beforeText,
      afterText: action.replacement,
    };
  });
  return { filePath: edit.filePath, spans };
}

/**
 * Persist a `RewriteLogEntry` to
 * `_scepter/lifecycle-log/<TIMESTAMP>-<RUN_ID>.json`.
 *
 * Returns the absolute path of the written log file.
 */
export async function writeRewriteLogEntry(
  projectPath: string,
  entry: RewriteLogEntry,
  precision: TimestampPrecision,
): Promise<string> {
  const logRoot = path.join(projectPath, '_scepter', 'lifecycle-log');
  await fs.ensureDir(logRoot);

  const stamp = formatMarkerTimestamp(new Date(entry.timestamp), precision);
  const filename = `${stamp}-${entry.runId}.json`;
  const fullPath = path.join(logRoot, filename);

  await fs.writeFile(fullPath, JSON.stringify(entry, null, 2));
  return fullPath;
}

/**
 * Read a previously-persisted `RewriteLogEntry`.
 *
 * Searches `_scepter/lifecycle-log/` for any file whose `runId`
 * matches. (Multiple files for the same run-id should not occur, but
 * if they do, the first match wins.)
 *
 * Returns `null` when no matching entry is found.
 */
export async function readRewriteLogEntry(
  projectPath: string,
  runId: string,
): Promise<RewriteLogEntry | null> {
  const logRoot = path.join(projectPath, '_scepter', 'lifecycle-log');
  if (!(await fs.pathExists(logRoot))) {
    return null;
  }
  const entries = await fs.readdir(logRoot);
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const fullPath = path.join(logRoot, name);
    try {
      const raw = await fs.readFile(fullPath, 'utf-8');
      const parsed = JSON.parse(raw) as RewriteLogEntry;
      if (parsed.runId === runId) {
        return parsed;
      }
    } catch {
      // Skip malformed files.
    }
  }
  return null;
}

/**
 * Convenience: enumerate every persisted log entry sorted by timestamp
 * (ascending). Used by the show handler and future undo command.
 */
export async function listRewriteLogEntries(
  projectPath: string,
): Promise<RewriteLogEntry[]> {
  const logRoot = path.join(projectPath, '_scepter', 'lifecycle-log');
  if (!(await fs.pathExists(logRoot))) {
    return [];
  }
  const entries = await fs.readdir(logRoot);
  const out: RewriteLogEntry[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const fullPath = path.join(logRoot, name);
    try {
      const raw = await fs.readFile(fullPath, 'utf-8');
      out.push(JSON.parse(raw) as RewriteLogEntry);
    } catch {
      // Skip malformed.
    }
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return out;
}

/**
 * Helper — compute the "ReferenceSpan-shaped" view of a logged span,
 * which makes inverse-plan construction easier. Used by future undo
 * implementations and tests verifying the schema sufficiency.
 *
 * The full `ReferenceSpan` requires `parsedAddress`, which is not
 * stored on the log — but the inverse plan only needs `byteRange`,
 * `noteIdRange`, `originalText`, and `filePath`. We return that
 * narrower record.
 */
export interface InversePlanSpan {
  filePath: string;
  surface: SpanSurface;
  noteIdRange: [number, number];
  /** The text the inverse plan should write back into the range. */
  text: string;
}

export function buildInverseSpans(entry: RewriteLogEntry): InversePlanSpan[] {
  const out: InversePlanSpan[] = [];
  for (const file of entry.files) {
    for (const span of file.spans) {
      out.push({
        filePath: file.filePath,
        surface: span.surface,
        noteIdRange: span.byteRange,
        text: span.beforeText,
      });
    }
  }
  return out;
}

/** Convenience accessor for the span type. */
export type { ReferenceSpan };
