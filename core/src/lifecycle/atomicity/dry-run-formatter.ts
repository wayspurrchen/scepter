/**
 * Dry-run formatter for the rewriter.
 *
 * Renders a `RewritePlan` as a human-readable manifest covering
 * every per-file per-span before/after, plus cross-project
 * skipped-reference warnings and test-name-embed audit list — all
 * in a single rendering. The output is a superset of the rewrite-log
 * entry schema per {DD020.§3.DC.09}.
 *
 * The formatter is pure: no filesystem reads, no side effects.
 * Callers pass the plan plus a map of pre-rewrite contents (used to
 * render the `afterText` by simulating the substitution).
 *
 * Output is plain text with header lines, file blocks, and a trailing
 * summary. Color is not emitted here — CLI command surfaces may wrap
 * the formatted output in `chalk` if they want.
 *
 * @implements {DD020.§3.DC.09} dry-run manifest is per-file/per-span before/after + warnings + audits; superset of rewrite-log entry
 */

import { applyFileEdit, type RewritePlan } from '../rewriter';

export interface DryRunFormatOptions {
  /**
   * Map of file path → original content. Used to compute `afterText`
   * by running the substituter without touching disk.
   *
   * When a planned edit's file is not present in this map, the
   * `afterText` rendering falls back to "[content not provided]" —
   * the rest of the manifest still renders.
   */
  contentsBefore?: Map<string, string>;

  /**
   * Truncate long before/after snippets to this many chars per side.
   * Defaults to 200. Set to 0 (or a negative value) to disable
   * truncation.
   */
  snippetMaxLength?: number;
}

/**
 * Format a `RewritePlan` for dry-run output.
 */
export function formatDryRun(
  plan: RewritePlan,
  options: DryRunFormatOptions = {},
): string {
  const contentsBefore = options.contentsBefore ?? new Map<string, string>();
  const maxLen =
    options.snippetMaxLength === undefined ? 200 : options.snippetMaxLength;
  const lines: string[] = [];

  lines.push('===== REWRITE DRY-RUN =====');
  lines.push(`Operation: ${plan.operation.kind}`);
  switch (plan.operation.kind) {
    case 'delete':
      lines.push(`Target: ${plan.operation.target}`);
      lines.push(`Marker: ${plan.operation.marker}`);
      break;
    case 'rename':
      lines.push(`Source: ${plan.operation.source}`);
      lines.push(`Target: ${plan.operation.target}`);
      break;
    case 'archive':
      lines.push(`Target: ${plan.operation.target}`);
      break;
  }
  lines.push(`Planned at: ${plan.plannedAt}`);
  lines.push('');

  // ---- Files ----
  if (plan.fileEdits.length === 0) {
    lines.push('(No file edits planned.)');
  } else {
    lines.push(`Files to modify: ${plan.fileEdits.length}`);
    lines.push('');
    for (const fileEdit of plan.fileEdits) {
      lines.push(`--- ${fileEdit.filePath} ---`);
      const before = contentsBefore.get(fileEdit.filePath);
      const after =
        before !== undefined ? applyFileEdit(before, fileEdit) : undefined;
      for (const { span, action } of fileEdit.edits) {
        const [s, e] = span.noteIdRange;
        lines.push(
          `  • [${span.surface}] bytes ${s}..${e}: ` +
            `"${truncate(span.originalText, maxLen)}"`,
        );
        if (before !== undefined && after !== undefined) {
          const beforeSnippet = before.slice(s, e);
          lines.push(`      before: "${truncate(beforeSnippet, maxLen)}"`);
          lines.push(
            `      after:  "${truncate(action.replacement, maxLen)}"`,
          );
        } else {
          lines.push(`      after:  "${truncate(action.replacement, maxLen)}"`);
        }
      }
      if (fileEdit.audits.length > 0) {
        lines.push(`  ${fileEdit.audits.length} audit-only span(s):`);
        for (const a of fileEdit.audits) {
          lines.push(
            `    - "${truncate(a.span.originalText, maxLen)}" (${a.reason ?? 'audit'})`,
          );
        }
      }
      if (fileEdit.warnings.length > 0) {
        lines.push(`  ${fileEdit.warnings.length} warning(s):`);
        for (const w of fileEdit.warnings) {
          lines.push(
            `    - "${truncate(w.span.originalText, maxLen)}" (${w.reason})`,
          );
        }
      }
      lines.push('');
    }
  }

  // ---- Removals ----
  if (plan.removals.length > 0) {
    lines.push(`Removals: ${plan.removals.length}`);
    for (const r of plan.removals) {
      lines.push(`  - ${r}`);
    }
    lines.push('');
  }

  // ---- Renames ----
  if (plan.renames.length > 0) {
    lines.push(`Renames: ${plan.renames.length}`);
    for (const r of plan.renames) {
      lines.push(`  - ${r.from} → ${r.to}`);
    }
    lines.push('');
  }

  // ---- Aggregate warnings ----
  if (plan.warnings.length > 0) {
    lines.push(`Aggregate warnings: ${plan.warnings.length}`);
    for (const w of plan.warnings) {
      lines.push(
        `  - [${w.span.surface}] ${w.span.filePath}: ` +
          `"${truncate(w.span.originalText, maxLen)}" (${w.reason})`,
      );
    }
    lines.push('');
  }

  // ---- Aggregate audits ----
  if (plan.audits.length > 0) {
    lines.push(`Aggregate audits: ${plan.audits.length}`);
    for (const a of plan.audits) {
      lines.push(
        `  - [${a.span.surface}] ${a.span.filePath}: ` +
          `"${truncate(a.span.originalText, maxLen)}" (${a.reason ?? 'audit'})`,
      );
    }
    lines.push('');
  }

  // ---- Summary ----
  lines.push('===== END DRY-RUN =====');
  lines.push(
    `Summary: ${plan.fileEdits.length} file(s) to modify, ` +
      `${plan.removals.length} removal(s), ` +
      `${plan.renames.length} rename(s), ` +
      `${plan.warnings.length} warning(s), ` +
      `${plan.audits.length} audit(s).`,
  );

  return lines.join('\n');
}

function truncate(s: string, maxLen: number): string {
  if (maxLen <= 0) return s;
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}
