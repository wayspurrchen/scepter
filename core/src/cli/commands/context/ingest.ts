import { Command } from 'commander';
import chalk from 'chalk';
import { ingestNotes, type IngestOptions } from './ingest-handler.js';
import { BaseCommand } from '../base-command.js';

export const ingestCommand = new Command('ingest')
  .description('Import files into SCEpter as notes')
  .argument('<type>', 'Note type for ingested files (e.g., Decision, Requirement)')
  .argument('<sources...>', 'Files or directories to ingest')
  .option('--tags <tags...>', 'Tags to assign to all ingested notes')
  .option('-s, --status <status>', 'Status for ingested notes')
  .option('--move', 'Move files into the type folder under _scepter/ (default: rename in place)')
  .option('--dry-run', 'Preview what would be ingested without making changes')
  .action(async (type: string, sources: string[], options: IngestOptions & { projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: false,
        },
        async (context) => {
          const result = await ingestNotes(sources, { ...options, type }, context);

          // Summary
          const ingestedCount = result.ingested.length;
          const skippedCount = result.skipped.length;

          if (options.dryRun) {
            console.log(chalk.yellow(`\n[dry-run] Would ingest ${ingestedCount} file(s)`));
          } else {
            console.log(chalk.green(`\nIngested ${ingestedCount} file(s) as ${type}`));
          }

          if (skippedCount > 0) {
            console.log(chalk.yellow(`Skipped ${skippedCount} file(s):`));
            for (const s of result.skipped) {
              console.log(chalk.dim(`  ${s.sourcePath}: ${s.reason}`));
            }
          }

          return result;
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
