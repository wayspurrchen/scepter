/**
 * @implements {T003} - Folder content gathering with --include-folder-contents flag
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { gatherContext, type GatherCommandOptions } from './gather-handler';
import { BaseCommand } from '../base-command';

const gatherCommand = new Command('gather')
  .description('Gather related context for a note')
  .argument('<noteId>', 'Note ID to gather context for')

  // Gathering control
  .option('--refs-only', 'Only follow explicit references (no context hints)')
  .option('--hints-only', 'Only use context hints (no reference following)')
  .option('--depth <n>', 'Maximum reference depth (default: 2)', parseInt)
  .option('--max-chars <n>', 'Maximum total characters to include', parseInt)
  .option('--max-notes <n>', 'Maximum number of notes to gather', parseInt)

  // Reference direction
  .option('--outgoing', 'Only follow outgoing references')
  .option('--incoming', 'Only follow incoming references')
  .option('--bidirectional', 'Follow both directions (default)')

  // Context hint sources
  .option('--no-note-hints', "Don't use individual note context hints")
  .option('--patterns <patterns...>', 'Additional search patterns')
  .option('--hint-types <types...>', 'Additional note types to include')
  .option('--hint-tags <tags...>', 'Additional tags to include')

  // Output options
  .option('--include-metadata', 'Include discovery metadata')
  .option('--no-content', 'Only show note list without content')
  .option('--excerpt-length <n>', 'Limit content excerpt to N characters', parseInt)
  .option('--include-content', 'Include full note content in output')
  .option('--include-tree', 'Include tree view in markdown output')
  .option('--include-folder-contents', 'Include contents of folder-based notes instead of just summary')
  
  // Archive/Delete options
  .option('--include-archived', 'Include archived notes in gathering')
  .option('--include-deleted', 'Include deleted notes in gathering')
  
  // General options
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .option('-v, --verbose', 'Show gathering statistics');

// Note: We don't add common filter options that include format
// The gather command always outputs in markdown format

gatherCommand.action(async (noteId: string, options: GatherCommandOptions & { projectDir?: string; output?: string; verbose?: boolean }) => {
  try {
    await BaseCommand.execute(
      {
        projectDir: options.projectDir,
        requireNoteManager: true,
        startWatching: true,
      },
      async (context) => {
        // Validate options
        if (options.refsOnly && options.hintsOnly) {
          throw new Error('Cannot use both --refs-only and --hints-only');
        }

        if (options.outgoing && options.incoming && !options.bidirectional) {
          console.log(chalk.yellow('Note: Both --outgoing and --incoming specified, using bidirectional mode'));
          options.bidirectional = true;
        }

        // Set defaults
        if (!options.depth) {
          options.depth = options.hintsOnly ? 0 : 2;
        }

        // Gather context
        console.log(chalk.gray(`Gathering context for ${noteId}...`));
        const result = await gatherContext(noteId, options, context);

        // Write output
        if (options.output) {
          const fs = await import('fs-extra');
          await fs.writeFile(options.output, result.output, 'utf-8');
        } else {
          console.log(result.output);
        }

        // Show performance stats if verbose
        if (options.verbose) {
          console.log(chalk.gray('\nGathering stats:'));
          console.log(chalk.gray(`  Time: ${result.stats.gatherTimeMs}ms`));
          console.log(chalk.gray(`  Total notes: ${result.stats.totalNotes}`));

          if (Object.keys(result.stats.bySource).length > 0) {
            console.log(chalk.gray('  By source:'));
            for (const [source, count] of Object.entries(result.stats.bySource)) {
              console.log(chalk.gray(`    ${source}: ${count}`));
            }
          }

          if (Object.keys(result.stats.byDepth).length > 0) {
            console.log(chalk.gray('  By depth:'));
            for (const [depth, count] of Object.entries(result.stats.byDepth)) {
              console.log(chalk.gray(`    Depth ${depth}: ${count}`));
            }
          }
        }

        if (options.output) {
          console.log(chalk.green(`Output written to ${options.output}`));
        }
      }
    );
  } catch (error) {
    BaseCommand.handleError(error);
  }
});

export { gatherCommand };