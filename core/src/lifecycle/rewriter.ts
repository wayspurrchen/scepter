/**
 * Reference-rewriting engine for hard-delete and rename operations under R015.
 *
 * The engine is structured as a span-substitution pipeline with three
 * pluggable layers per {DD020.§2.DC.01}:
 *
 *   1. **Scanner adapters** (in `./scanners/`) read source text and emit
 *      `ReferenceSpan` records. One adapter per parser-visible surface.
 *   2. **Per-operation predicate** (`deleteRewritePredicate`,
 *      `renameRewritePredicate`, `archiveRewritePredicate`) inspects a
 *      span and returns a `RewriteAction`.
 *   3. **Substituter** (`applyActionsToContent`) consumes spans and
 *      actions and produces a rewritten string. Edits are applied
 *      right-to-left so byte offsets in earlier spans remain valid.
 *
 * Extending matching from note-ID-level to claim-level (a future
 * operation that targets `{R005.§1.AC.03}` specifically without
 * touching `{R005.§1.AC.04}`) requires changing only the predicate
 * — the scanner enumerates the same set of spans and the substituter
 * still applies whatever action the predicate returns.
 *
 * @implements {DD020.§2.DC.01} span-substitution pipeline with pluggable predicate
 * @implements {DD020.§2.DC.04} predicate returns noop for within-doc bare-section refs
 * @implements {DD020.§2.DC.05} substituter replaces only the note-ID byte range
 * @implements {DD020.§2.DC.05a} note-ID-only substitution preserves trailing claim path verbatim
 * @implements {DD020.§2.DC.07} alias-prefixed spans → warn-and-skip
 * @implements {DD020.§2.DC.19} renameRewritePredicate substitutes target ID
 * @implements {DD020.§2.DC.20} archive operation does NOT invoke rewriter (archivePredicate exposed but designed never to be called)
 * @implements {DD020.§2.DC.21} per-span cross-project warnings accumulated for live and dry-run output
 * @implements {DD020.§7.DC.01} alias detection independent of operation
 * @implements {DD020.§7.DC.02} cross-project warnings carry file, original text, operation
 */

import type { ClaimAddress } from '../parsers/claim/claim-parser';

// ---------------------------------------------------------------------------
// Span types — what scanner adapters emit
// ---------------------------------------------------------------------------

/**
 * The parser-visible surface a span occupies.
 *
 * Each `surface` value corresponds to one scanner adapter. The predicate
 * inspects `surface` to apply per-surface rules (e.g., `audit-only`
 * for `source-string-literal`).
 */
export type SpanSurface =
  | 'markdown-body'
  | 'source-comment'
  | 'source-annotation'
  | 'source-string-literal'
  | 'frontmatter-list'
  | 'frontmatter-id'
  | 'claim-metadata-derives'
  | 'claim-metadata-superseded'
  | 'self-prefix-heading'
  | 'self-prefix-paragraph'
  | 'filesystem-path';

/**
 * A reference span found by a scanner.
 *
 * `byteRange` is `[start, end)` over the original file content the
 * scanner saw — `content.slice(start, end)` MUST equal `originalText`.
 *
 * `noteIdRange` is the sub-range of `byteRange` that points at the
 * note-ID portion (the only portion the substituter modifies per
 * {DD020.§2.DC.05}). For `markdown-body` spans this is the position
 * of `R005` inside `{R005.§1.AC.03}`; for `frontmatter-list` spans
 * it is the position of `R005` inside the list entry.
 *
 * `parsedAddress` is the parser's interpretation of the reference,
 * carried through so the predicate can branch on `aliasPrefix` and
 * other parsed properties without re-parsing.
 */
export interface ReferenceSpan {
  filePath: string;
  surface: SpanSurface;
  byteRange: [number, number];
  noteIdRange: [number, number];
  originalText: string;
  parsedAddress: ClaimAddress;
}

// ---------------------------------------------------------------------------
// Action types — what the predicate decides per span
// ---------------------------------------------------------------------------

/** A substitution: replace the note-ID portion of the span with `replacement`. */
export interface SubstituteAction {
  kind: 'substitute';
  /** Text that replaces the note-ID range. */
  replacement: string;
}

/** No-op: the span is recognized but no rewriting is required. */
export interface NoopAction {
  kind: 'noop';
  reason?: string;
}

/** Audit-only: the span is surfaced to the user but not rewritten. */
export interface AuditOnlyAction {
  kind: 'audit-only';
  reason?: string;
}

/** Warn-and-skip: the span is skipped and a warning is emitted. */
export interface WarnAndSkipAction {
  kind: 'warn-and-skip';
  reason: string;
}

export type RewriteAction =
  | SubstituteAction
  | NoopAction
  | AuditOnlyAction
  | WarnAndSkipAction;

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

export type RewriteOperationKind = 'delete' | 'rename' | 'archive';

/** Hard-delete operation: rewrite refs to the deletion marker. */
export interface DeleteOperation {
  kind: 'delete';
  /** The note ID being retired. */
  target: string;
  /** The pre-computed deletion marker token (per {DD020.§4.DC.03}). */
  marker: string;
}

/** Rename operation: rewrite refs to `targetId`. */
export interface RenameOperation {
  kind: 'rename';
  /** The note ID being renamed away from. */
  source: string;
  /** The new note ID. */
  target: string;
}

/** Archive operation: no-op for the rewriter (preserved unchanged). */
export interface ArchiveOperation {
  kind: 'archive';
  target: string;
}

export type RewriteOperation =
  | DeleteOperation
  | RenameOperation
  | ArchiveOperation;

// ---------------------------------------------------------------------------
// Plan and result types
// ---------------------------------------------------------------------------

/** A single file's planned edits. */
export interface PlannedFileEdit {
  filePath: string;
  /** Sub-edits, sorted by byte offset (ascending). */
  edits: Array<{
    span: ReferenceSpan;
    action: SubstituteAction;
  }>;
  /** Auditable but non-mutating spans (e.g., test-name embeds). */
  audits: Array<{
    span: ReferenceSpan;
    reason?: string;
  }>;
  /** Spans that triggered warn-and-skip (e.g., cross-project). */
  warnings: Array<{
    span: ReferenceSpan;
    reason: string;
  }>;
}

/**
 * A rewrite plan: every file the engine intends to modify, plus any
 * audit entries and warnings the user should see.
 *
 * The plan is produced by `plan(operation, files)` without mutating
 * disk. Apply mutates disk via the atomicity layer.
 */
export interface RewritePlan {
  operation: RewriteOperation;
  /** ISO timestamp when the plan was constructed. */
  plannedAt: string;
  /** Edits to existing files (substitutions only). */
  fileEdits: PlannedFileEdit[];
  /**
   * Filesystem entries to remove (hard-delete only). The set is
   * populated by the orchestrator; the engine itself does not perform
   * filesystem discovery, only reference rewriting. Filenames are
   * absolute paths.
   */
  removals: string[];
  /**
   * Filesystem entries to rename (rename op only). The set is
   * populated by the orchestrator.
   */
  renames: Array<{ from: string; to: string }>;
  /**
   * Aggregate warnings across all files (e.g., cross-project skips).
   * Each warning is also recorded on its `PlannedFileEdit.warnings`,
   * but the aggregate view is the most useful for CLI summary.
   */
  warnings: Array<{
    span: ReferenceSpan;
    reason: string;
  }>;
  /** Aggregate audit entries (e.g., test-name embeds). */
  audits: Array<{
    span: ReferenceSpan;
    reason?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * Classify a span under the `delete` operation.
 *
 * @implements {DD020.§2.DC.02} delete predicate substitutes for matching note ID
 * @implements {DD020.§2.DC.04} delete predicate noops bare-section refs
 * @implements {DD020.§2.DC.07} alias-prefixed spans → warn-and-skip
 * @implements {DD020.§2.DC.10} source-string-literal spans → audit-only
 * @implements {DD020.§2.DC.15} self-prefix-* on deleted note's own file: scanner emits nothing (moot — file removed)
 */
export function deleteRewritePredicate(
  span: ReferenceSpan,
  op: DeleteOperation,
): RewriteAction {
  // Cross-project alias refs are always skipped, regardless of operation
  // and regardless of whether the local target matches the cited peer ID.
  if (span.parsedAddress.aliasPrefix !== undefined) {
    return { kind: 'warn-and-skip', reason: 'cross-project-alias' };
  }

  // Within-document bare-section refs (no noteId) — noop.
  // For delete the containing document is being removed so the
  // references disappear with the file; nothing to rewrite in OTHER files.
  if (span.parsedAddress.noteId === undefined) {
    return { kind: 'noop', reason: 'bare-section-ref' };
  }

  // Test-name embed surface — audit-only under every operation.
  // (Phase 6: the test-name scanner is not wired in Phase 3; this
  // branch nonetheless governs the surface so the predicate is
  // future-stable.)
  if (span.surface === 'source-string-literal') {
    return { kind: 'audit-only', reason: 'test-name-embed' };
  }

  // Note-ID does not match the delete target — noop.
  if (span.parsedAddress.noteId !== op.target) {
    return { kind: 'noop', reason: 'unrelated-note' };
  }

  // Match — substitute the note-ID portion with the marker.
  return { kind: 'substitute', replacement: op.marker };
}

/**
 * Classify a span under the `rename` operation.
 *
 * @implements {DD020.§2.DC.19} rename substitutes target id for non-excluded surfaces
 * @implements {DD020.§2.DC.04} rename predicate noops bare-section refs
 * @implements {DD020.§2.DC.07} alias-prefixed spans → warn-and-skip
 * @implements {DD020.§2.DC.10} source-string-literal spans → audit-only under rename too
 * @implements {DD020.§2.DC.12} frontmatter-id only emitted for renamed note's own file
 * @implements {DD020.§2.DC.14} self-prefix spans only emitted for renamed note's own file
 */
export function renameRewritePredicate(
  span: ReferenceSpan,
  op: RenameOperation,
): RewriteAction {
  if (span.parsedAddress.aliasPrefix !== undefined) {
    return { kind: 'warn-and-skip', reason: 'cross-project-alias' };
  }

  // Within-document bare-section refs — noop. Under rename the
  // containing document's ID changes, but the bare form continues
  // to resolve correctly without textual modification.
  if (span.parsedAddress.noteId === undefined) {
    return { kind: 'noop', reason: 'bare-section-ref' };
  }

  if (span.surface === 'source-string-literal') {
    return { kind: 'audit-only', reason: 'test-name-embed' };
  }

  if (span.parsedAddress.noteId !== op.source) {
    return { kind: 'noop', reason: 'unrelated-note' };
  }

  return { kind: 'substitute', replacement: op.target };
}

/**
 * Classify a span under the `archive` operation.
 *
 * Archive never invokes the rewriter per {DD020.§2.DC.20}; this predicate
 * exists as a defensive no-op so accidental invocation does not mutate.
 * Every span returns `noop`.
 *
 * @implements {DD020.§2.DC.20} archive operation does not invoke rewriter
 */
export function archiveRewritePredicate(
  _span: ReferenceSpan,
  _op: ArchiveOperation,
): RewriteAction {
  return { kind: 'noop', reason: 'archive-no-rewrite' };
}

/**
 * Dispatch table: operation → predicate.
 *
 * Adding a new operation (e.g., a future `consolidate` that redirects
 * refs to a surviving note) requires only adding a new predicate and a
 * new entry here. Scanner adapters and the substituter are untouched.
 */
export function predicateFor(
  op: RewriteOperation,
): (span: ReferenceSpan) => RewriteAction {
  switch (op.kind) {
    case 'delete':
      return (span) => deleteRewritePredicate(span, op);
    case 'rename':
      return (span) => renameRewritePredicate(span, op);
    case 'archive':
      return (span) => archiveRewritePredicate(span, op);
  }
}

// ---------------------------------------------------------------------------
// Substituter
// ---------------------------------------------------------------------------

/**
 * Apply a sequence of substitution actions to file content.
 *
 * Edits MUST be applied in descending byte-offset order so that early
 * `noteIdRange` offsets remain valid as later edits change downstream
 * lengths. The function performs that ordering internally; callers
 * pass edits in any order.
 *
 * Only the `noteIdRange` sub-range of the span is rewritten — the
 * trailing claim path (section, prefix, number, range, compact-multi,
 * sub-letter) and any surrounding markdown decoration are preserved
 * verbatim per {DD020.§2.DC.05, §2.DC.05a, §2.DC.06}.
 *
 * @implements {DD020.§2.DC.05} byte-range-scoped substitution preserves trailing inline metadata
 * @implements {DD020.§2.DC.05a} trailing claim path preserved verbatim across all recognized reference forms
 * @implements {DD020.§2.DC.06} surrounding markdown decoration (code spans, fences) preserved verbatim
 */
export function applyActionsToContent(
  content: string,
  edits: Array<{ span: ReferenceSpan; action: SubstituteAction }>,
): string {
  if (edits.length === 0) {
    return content;
  }
  // Sort by descending noteIdRange[0] so earlier offsets are not
  // invalidated by later splices.
  const sorted = [...edits].sort(
    (a, b) => b.span.noteIdRange[0] - a.span.noteIdRange[0],
  );
  let out = content;
  for (const { span, action } of sorted) {
    const [start, end] = span.noteIdRange;
    out = out.slice(0, start) + action.replacement + out.slice(end);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

/**
 * A scanner-adapter callable: given file content, emit spans.
 *
 * Some adapters take additional context (e.g., the self-prefix scanner
 * needs `expectedNoteId`). Callers wrap such adapters in a closure
 * before passing to the engine.
 */
export type ScannerAdapter = (filePath: string, content: string) => ReferenceSpan[];

/**
 * Per-file input to `planRewrite`: filename, file content, and the
 * scanner adapters that should run against this file.
 *
 * The orchestrator decides which adapters apply (e.g., source-code
 * adapter only for `.ts`/`.tsx`/`.js`/`.jsx`/`.py` files; frontmatter
 * adapter only for files starting with `---`).
 */
export interface FileToScan {
  filePath: string;
  content: string;
  scanners: ScannerAdapter[];
}

/**
 * Build a `RewritePlan` from a set of files and an operation.
 *
 * Pure function — no filesystem I/O. The orchestrator (delete/rename
 * handler) reads files, calls this, then routes to either the staging
 * layer or the dry-run formatter.
 *
 * @implements {DD020.§3.DC.01} two-phase plan() + apply(); plan does not mutate
 */
export function planRewrite(
  operation: RewriteOperation,
  files: FileToScan[],
): RewritePlan {
  const predicate = predicateFor(operation);
  const fileEdits: PlannedFileEdit[] = [];
  const aggregateWarnings: RewritePlan['warnings'] = [];
  const aggregateAudits: RewritePlan['audits'] = [];

  for (const file of files) {
    const allSpans: ReferenceSpan[] = [];
    for (const scanner of file.scanners) {
      const spans = scanner(file.filePath, file.content);
      allSpans.push(...spans);
    }

    const edits: PlannedFileEdit['edits'] = [];
    const audits: PlannedFileEdit['audits'] = [];
    const warnings: PlannedFileEdit['warnings'] = [];

    for (const span of allSpans) {
      const action = predicate(span);
      switch (action.kind) {
        case 'substitute':
          edits.push({ span, action });
          break;
        case 'audit-only':
          audits.push({ span, reason: action.reason });
          aggregateAudits.push({ span, reason: action.reason });
          break;
        case 'warn-and-skip':
          warnings.push({ span, reason: action.reason });
          aggregateWarnings.push({ span, reason: action.reason });
          break;
        case 'noop':
          // Drop silently.
          break;
      }
    }

    if (edits.length === 0 && audits.length === 0 && warnings.length === 0) {
      continue;
    }

    // Stable ordering for deterministic output / replay.
    edits.sort((a, b) => a.span.byteRange[0] - b.span.byteRange[0]);
    audits.sort((a, b) => a.span.byteRange[0] - b.span.byteRange[0]);
    warnings.sort((a, b) => a.span.byteRange[0] - b.span.byteRange[0]);

    fileEdits.push({
      filePath: file.filePath,
      edits,
      audits,
      warnings,
    });
  }

  return {
    operation,
    plannedAt: new Date().toISOString(),
    fileEdits,
    removals: [],
    renames: [],
    warnings: aggregateWarnings,
    audits: aggregateAudits,
  };
}

/**
 * Convenience helper: apply a `PlannedFileEdit` to its content.
 *
 * @implements {DD020.§2.DC.05a} substitution preserves trailing path verbatim
 */
export function applyFileEdit(
  content: string,
  fileEdit: PlannedFileEdit,
): string {
  return applyActionsToContent(content, fileEdit.edits);
}
