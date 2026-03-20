/**
 * Audit command for confidence annotations.
 *
 * Discovers all source files from sourceCodeIntegration config,
 * parses each for @confidence annotations, and displays summary.
 *
 * @implements {R004.§7.AC.01} scepter confidence audit command
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import { auditConfidence } from '../../../claims/confidence.js';
import { formatConfidenceAudit } from '../../formatters/confidence-formatter.js';

export const auditCommand = new Command('audit')
  .description('Audit source files for confidence annotations')
  .option('--format <format>', 'Output format: table or json', 'table')
  .option('--unannotated', 'List only files without annotations')
  .option('--level <level>', 'List only files at a specific confidence level')
  .action(async (options: {
    format?: string;
    unannotated?: boolean;
    level?: string;
    projectDir?: string;
  }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: false,
          startWatching: false,
        },
        async (context) => {
          const config = context.projectManager.configManager.getConfig();

          if (!config.sourceCodeIntegration?.enabled) {
            console.log(chalk.yellow('Source code integration is not enabled in configuration.'));
            console.log(chalk.gray('Add sourceCodeIntegration to scepter.config.json to use confidence audit.'));
            return;
          }

          const result = await auditConfidence(
            context.projectPath,
            config.sourceCodeIntegration,
          );

          // Filter by level if specified
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
              console.log(`  ${f.reviewer}${f.level} ${chalk.gray(f.date)}  ${f.filePath}`);
            }
            console.log('');
            console.log(chalk.gray(`${filtered.length} file(s)`));
            return;
          }

          // Show only unannotated files if flag is set
          if (options.unannotated) {
            if (result.unannotatedFiles.length === 0) {
              console.log(chalk.green('All source files have confidence annotations.'));
              return;
            }
            console.log(chalk.bold(`Unannotated files (${result.unannotatedFiles.length}):`));
            console.log('');
            for (const f of result.unannotatedFiles) {
              console.log(`  ${f}`);
            }
            return;
          }

          // Default: full audit output
          const output = formatConfidenceAudit(result, {
            format: options.format === 'json' ? 'json' : 'table',
          });
          console.log(output);
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
