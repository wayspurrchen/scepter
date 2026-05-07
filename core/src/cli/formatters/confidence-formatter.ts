/**
 * Formatter for confidence audit output and apply summaries.
 *
 * Renders multi-scope audit results, per-directory `--paths` breakdown,
 * and the apply command's summary + plan-table outputs.
 *
 * @implements {R004.§7.AC.01} Confidence audit display formatting
 * @implements {S004.§2.AC.07}
 * @implements {S004.§2.AC.10}
 * @implements {S004.§4.AC.05}
 * @implements {S004.§4.AC.08}
 * @implements {DD017.DC.34}
 * @implements {DD017.DC.35}
 * @implements {DD017.DC.36}
 * @implements {DD017.DC.37}
 * @implements {DD017.DC.38}
 */

import chalk from 'chalk';
import * as path from 'path';
import Table from 'cli-table3';
import type {
  ConfidenceAuditResult,
  ConfidenceLevel,
  ConfidenceAnnotation,
} from '../../claims/confidence/index.js';
import type { ScopedAuditResult } from '../../claims/confidence/audit.js';

/** Level name labels for display */
const LEVEL_NAMES: Record<ConfidenceLevel, string> = {
  1: 'Experimental',
  2: 'Draft',
  3: 'Developing',
  4: 'Settled',
  5: 'Stable',
};

/**
 * Format a confidence audit result for terminal display.
 *
 * When both scopes have populated results, emit two clearly-delimited
 * per-scope sections followed by a combined-totals line (file counts
 * only — no combined percentage). When only one scope is populated, emit
 * only that scope's section.
 *
 * @implements {S004.§2.AC.07}
 * @implements {DD017.DC.34}
 */
export function formatConfidenceAudit(
  result: ConfidenceAuditResult,
  options?: { format?: 'table' | 'json'; scope?: 'source' | 'notes' | 'both' },
): string {
  if (options?.format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const scope = options?.scope ?? 'both';
  const showSource = scope === 'source' || scope === 'both';
  const showNotes = scope === 'notes' || scope === 'both';
  const sourcePopulated = showSource && result.bySource.total > 0;
  const notesPopulated = showNotes && result.byNotes.total > 0;
  const bothPopulated = sourcePopulated && notesPopulated;

  const lines: string[] = [];
  lines.push(chalk.bold('Confidence Audit'));
  lines.push('');

  if (sourcePopulated) {
    lines.push(...renderScopeSection('Source', result.bySource));
  }

  if (notesPopulated) {
    if (sourcePopulated) lines.push('');
    lines.push(...renderScopeSection('Notes', result.byNotes));
  }

  // Combined-totals line ONLY when both scopes contributed (DC.34).
  if (bothPopulated) {
    lines.push('');
    lines.push(chalk.bold('Combined totals (file counts only):'));
    lines.push(`  Total:       ${chalk.cyan(String(result.total))}`);
    lines.push(`  Annotated:   ${chalk.green(String(result.annotated))}`);
    lines.push(
      `  Unannotated: ${result.unannotated > 0 ? chalk.yellow(String(result.unannotated)) : chalk.green('0')}`,
    );
  } else if (!sourcePopulated && !notesPopulated) {
    lines.push(chalk.gray('No files discovered.'));
  }

  lines.push('');
  return lines.join('\n');
}

function renderScopeSection(label: string, scope: ScopedAuditResult): string[] {
  const lines: string[] = [];
  lines.push(chalk.bold(`${label}:`));
  lines.push(`  Total files:    ${chalk.cyan(String(scope.total))}`);
  lines.push(`  Annotated:      ${chalk.green(String(scope.annotated))}`);
  lines.push(
    `  Unannotated:    ${scope.unannotated > 0 ? chalk.yellow(String(scope.unannotated)) : chalk.green('0')}`,
  );
  if (scope.total > 0) {
    const pct = ((scope.annotated / scope.total) * 100).toFixed(1);
    lines.push(`  Coverage:       ${chalk.cyan(pct + '%')}`);
  }
  if (scope.annotated > 0) {
    lines.push('  By level:');
    const levels: ConfidenceLevel[] = [1, 2, 3, 4, 5];
    for (const level of levels) {
      const count = scope.byLevel[level];
      if (count > 0) {
        const pct = ((count / scope.annotated) * 100).toFixed(1);
        const name = LEVEL_NAMES[level];
        lines.push(
          `    ${level} ${padRight(name, 14)} ${padRight(String(count), 5)} ${chalk.gray(pct + '%')}`,
        );
      }
    }
  }
  return lines;
}

/**
 * Format a per-directory `--paths` breakdown of the audit result. Each
 * directory becomes a block (directories sorted lexicographically); files
 * within a block are sorted alphabetically and prefixed with their
 * annotation string (e.g. `🤖2 2026-05-05`) or the literal `unannotated`.
 *
 * Under `tty: false`, ALL ANSI color codes and decorative box-drawing
 * characters are suppressed so the captured output is grep/awk friendly.
 *
 * @implements {S004.§2.AC.10}
 * @implements {DD017.DC.35}
 */
export function formatConfidenceAuditPaths(
  result: ConfidenceAuditResult,
  options: { tty: boolean; scope?: 'source' | 'notes' | 'both' },
): string {
  const useColor = options.tty;
  const scope = options.scope ?? 'both';

  type Entry = { filePath: string; label: string };
  const entries: Entry[] = [];

  if (scope === 'source' || scope === 'both') {
    for (const f of result.bySource.files) {
      entries.push({ filePath: f.filePath, label: annotationLabel(f) });
    }
    for (const fp of result.bySource.unannotatedFiles) {
      entries.push({ filePath: fp, label: 'unannotated' });
    }
  }
  if (scope === 'notes' || scope === 'both') {
    for (const f of result.byNotes.files) {
      entries.push({ filePath: f.filePath, label: annotationLabel(f) });
    }
    for (const fp of result.byNotes.unannotatedFiles) {
      entries.push({ filePath: fp, label: 'unannotated' });
    }
  }

  // Group by directory.
  const byDir = new Map<string, Entry[]>();
  for (const entry of entries) {
    const dir = path.dirname(entry.filePath) || '.';
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(entry);
  }

  const sortedDirs = [...byDir.keys()].sort();
  const lines: string[] = [];
  for (const dir of sortedDirs) {
    const block = byDir.get(dir)!.sort((a, b) => a.filePath.localeCompare(b.filePath));
    const dirHeader = useColor ? chalk.bold(dir) : dir;
    lines.push(dirHeader);
    for (const entry of block) {
      const fileName = path.basename(entry.filePath);
      lines.push(`  ${entry.label}  ${fileName}`);
    }
  }
  return lines.join('\n');
}

function annotationLabel(annotation: ConfidenceAnnotation): string {
  return annotation.date
    ? `${annotation.reviewer}${annotation.level} ${annotation.date}`
    : `${annotation.reviewer}${annotation.level}`;
}

/**
 * Apply summary block. Five counters; if `failed > 0`, list each
 * failure's path and message indented below.
 *
 * @implements {S004.§4.AC.08}
 * @implements {DD017.DC.36}
 */
export interface ApplyOutcome {
  marked: number;
  replaced: number;
  skippedAnnotated: number;
  skippedUnmatched: number;
  failed: { path: string; error: string }[];
}

export function formatApplySummary(outcome: ApplyOutcome): string {
  const lines: string[] = [];
  lines.push(chalk.bold('Apply summary'));
  lines.push(`  marked:            ${chalk.green(String(outcome.marked))}`);
  lines.push(`  replaced:          ${chalk.cyan(String(outcome.replaced))}`);
  lines.push(`  skipped-annotated: ${chalk.gray(String(outcome.skippedAnnotated))}`);
  lines.push(`  skipped-unmatched: ${chalk.gray(String(outcome.skippedUnmatched))}`);
  const failed = outcome.failed.length;
  lines.push(`  failed:            ${failed > 0 ? chalk.red(String(failed)) : chalk.green('0')}`);
  if (failed > 0) {
    for (const f of outcome.failed) {
      lines.push(`    ${chalk.red(f.path)}: ${f.error}`);
    }
  }
  return lines.join('\n');
}

/**
 * Apply plan-table row.
 *
 * @implements {S004.§4.AC.05}
 */
export interface PlanRow {
  path: string;
  scope: 'source' | 'notes';
  current: string;
  proposed: string;
  action: 'mark' | 'replace' | 'skip-annotated' | 'skip-unmatched' | 'failed';
}

/**
 * Render the apply plan as a `cli-table3` table. Used unchanged by
 * `--dry-run` and `--verbose` paths; the action column reflects either
 * planned or executed action.
 *
 * @implements {S004.§4.AC.05}
 * @implements {DD017.DC.37}
 */
export function formatApplyPlanTable(rows: PlanRow[]): string {
  const table = new Table({
    head: ['path', 'scope', 'current', 'proposed', 'action'],
  });
  for (const row of rows) {
    table.push([row.path, row.scope, row.current, row.proposed, row.action]);
  }
  return table.toString();
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return str + ' '.repeat(width - str.length);
}
