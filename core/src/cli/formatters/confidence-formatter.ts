/**
 * Formatter for confidence audit output.
 *
 * Renders audit results as either a terminal table or JSON.
 *
 * @implements {R004.§7.AC.01} Confidence audit display formatting
 */

import chalk from 'chalk';
import type { ConfidenceAuditResult, ConfidenceLevel } from '../../claims/confidence.js';

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
 * @implements {R004.§7.AC.01} Render audit with count/percentage per level
 */
export function formatConfidenceAudit(
  result: ConfidenceAuditResult,
  options?: { format?: 'table' | 'json' },
): string {
  if (options?.format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];

  lines.push(chalk.bold('Confidence Audit'));
  lines.push('');

  // Summary
  lines.push(`Total files:    ${chalk.cyan(String(result.total))}`);
  lines.push(`Annotated:      ${chalk.green(String(result.annotated))}`);
  lines.push(`Unannotated:    ${result.unannotated > 0 ? chalk.yellow(String(result.unannotated)) : chalk.green('0')}`);

  if (result.total > 0) {
    const pct = ((result.annotated / result.total) * 100).toFixed(1);
    lines.push(`Coverage:       ${chalk.cyan(pct + '%')}`);
  }

  lines.push('');

  // Level breakdown
  if (result.annotated > 0) {
    lines.push(chalk.bold('By level:'));

    const levels: ConfidenceLevel[] = [1, 2, 3, 4, 5];
    for (const level of levels) {
      const count = result.byLevel[level];
      if (count > 0) {
        const pct = ((count / result.annotated) * 100).toFixed(1);
        const name = LEVEL_NAMES[level];
        lines.push(`  ${level} ${padRight(name, 14)} ${padRight(String(count), 5)} ${chalk.gray(pct + '%')}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return str + ' '.repeat(width - str.length);
}
