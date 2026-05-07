/**
 * Audit command for confidence annotations.
 *
 * Discovers files from sourceCodeIntegration (source scope) and/or
 * discoveryPaths (notes scope), routes each through the confidence
 * adapter registry, and displays summary or per-directory breakdown.
 *
 * @implements {R004.§7.AC.01} scepter confidence audit command
 * @implements {S004.§2.AC.01-10}
 * @implements {DD017.DC.11}
 * @implements {DD017.DC.12}
 * @implements {DD017.DC.13}
 * @implements {DD017.DC.14}
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import { auditConfidence } from '../../../claims/confidence/index.js';
import {
  formatConfidenceAudit,
  formatConfidenceAuditPaths,
} from '../../formatters/confidence-formatter.js';

/**
 * Resolve `--source-only`/`--notes-only` flags to a scope value, or
 * report a mutual-exclusivity error. Exported for unit testing of the
 * pre-discovery validation surface (TS001.§6.AC.04, DD017.DC.11).
 */
export function resolveAuditScope(opts: {
  sourceOnly?: boolean;
  notesOnly?: boolean;
}): { ok: true; scope: 'source' | 'notes' | 'both' } | { ok: false; message: string } {
  if (opts.sourceOnly && opts.notesOnly) {
    return {
      ok: false,
      message:
        '--source-only and --notes-only are mutually exclusive. Choose one or omit both for the default (both scopes).',
    };
  }
  return {
    ok: true,
    scope: opts.sourceOnly ? 'source' : opts.notesOnly ? 'notes' : 'both',
  };
}

export const auditCommand = new Command('audit')
  .description('Audit source files and notes for confidence annotations')
  .option('--format <format>', 'Output format: table or json', 'table')
  .option('--unannotated', 'List only files without annotations')
  .option('--level <level>', 'List only files at a specific confidence level')
  .option('--source-only', 'Audit only source files (sourceCodeIntegration.folders)')
  .option('--notes-only', 'Audit only notes (discoveryPaths)')
  .option('--paths', 'Emit a per-directory breakdown of files and their annotations')
  .action(async (options: {
    format?: string;
    unannotated?: boolean;
    level?: string;
    sourceOnly?: boolean;
    notesOnly?: boolean;
    paths?: boolean;
    projectDir?: string;
  }) => {
    try {
      // Mutual-exclusivity check BEFORE any discovery runs (DC.11).
      const scopeResult = resolveAuditScope({
        sourceOnly: options.sourceOnly,
        notesOnly: options.notesOnly,
      });
      if (!scopeResult.ok) {
        console.error(chalk.red(`Error: ${scopeResult.message}`));
        process.exit(1);
      }
      const scope = scopeResult.scope;

      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: false,
        },
        async (context) => {
          const config = context.projectManager.configManager.getConfig();

          if (
            scope === 'source' &&
            !config.sourceCodeIntegration?.enabled
          ) {
            console.log(
              chalk.yellow('Source code integration is not enabled in configuration.'),
            );
            console.log(
              chalk.gray(
                'Add sourceCodeIntegration to scepter.config.json to use confidence audit on source files.',
              ),
            );
            return;
          }

          const result = await auditConfidence(context.projectManager, { scope });

          // Filter by level if specified.
          if (options.level) {
            const level = parseInt(options.level, 10);
            if (level < 1 || level > 5 || isNaN(level)) {
              console.log(chalk.red(`Invalid level: ${options.level}. Must be 1-5.`));
              return;
            }
            const filtered = result.files.filter((f) => f.level === level);
            if (filtered.length === 0) {
              console.log(chalk.yellow(`No files found at confidence level ${level}.`));
              return;
            }
            console.log(chalk.bold(`Files at confidence level ${level}:`));
            console.log('');
            for (const f of filtered) {
              const dateStr = f.date ? ` ${chalk.gray(f.date)}` : '';
              console.log(`  ${f.reviewer}${f.level}${dateStr}  ${f.filePath}`);
            }
            console.log('');
            console.log(chalk.gray(`${filtered.length} file(s)`));
            return;
          }

          // Show only unannotated files if flag is set.
          if (options.unannotated) {
            if (result.unannotatedFiles.length === 0) {
              console.log(chalk.green('All files have confidence annotations.'));
              return;
            }
            console.log(
              chalk.bold(`Unannotated files (${result.unannotatedFiles.length}):`),
            );
            console.log('');
            for (const f of result.unannotatedFiles) {
              console.log(`  ${f}`);
            }
            return;
          }

          // Default summary output.
          const output = formatConfidenceAudit(result, {
            format: options.format === 'json' ? 'json' : 'table',
            scope,
          });
          console.log(output);

          // --paths breakdown appended below the summary (DC.12).
          if (options.paths && options.format !== 'json') {
            const tty = Boolean(process.stdout.isTTY);
            const breakdown = formatConfidenceAuditPaths(result, { tty, scope });
            console.log(breakdown);
          }
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
