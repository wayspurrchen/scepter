import { Command } from 'commander';
import chalk from 'chalk';
import { listNotes, formatPaginationInfo, type ListOptions } from './list-handler.js';
import { addCommonFilterOptions } from './common-filters.js';
import { writeOutput } from './show-handler.js';
import { BaseCommand } from '../base-command.js';

let listCommand = new Command('list')
  .description('List and filter notes (tree format defaults to 10 notes)')
  .option('--stats', 'Show statistics instead of note list')
  .option('--json', 'Output as JSON')
  .option('--contains <text>', 'Filter by content containing text')
  .option('--tree-depth <n>', 'Tree expansion depth (default: 2)', parseInt)
  .option('--tree-compact', 'Use ellipsis for repeated notes in tree view')
  .option('--filtered-refs', 'Show reference counts only for filtered notes')
  .option('--show-legend', 'Show status emoji legend at bottom')
  .option('--no-emoji', 'Disable emoji display in status column')
  .option('--include-archived', 'Include archived notes in results')
  .option('--include-deleted', 'Include deleted notes in results')
  .option('--only-archived', 'Show only archived notes')
  .option('--only-deleted', 'Show only deleted notes');

// Add common filter options
listCommand = addCommonFilterOptions(listCommand);

listCommand.action(async (options: ListOptions & { projectDir?: string }) => {
  try {
    const result = await BaseCommand.execute(
      {
        projectDir: options.projectDir,
        requireNoteManager: true
      },
      async (context) => listNotes(options, context)
    );

    // Show empty message for non-stats mode
    if (result.notes.length === 0 && !result.isStats) {
      console.log(chalk.yellow('No notes found matching the criteria'));
      return;
    }

    await writeOutput(result.output, options.output);

    // Show pagination info
    const paginationInfo = formatPaginationInfo(result, options.offset, options.format, result.additionalVisibleCount);
    if (paginationInfo) {
      console.log(chalk.gray(`\n${paginationInfo}`));
    }

    if (options.output) {
      console.log(chalk.green(`Output written to ${options.output}`));
    }
  } catch (error) {
    BaseCommand.handleError(error);
  }
});

export { listCommand };
