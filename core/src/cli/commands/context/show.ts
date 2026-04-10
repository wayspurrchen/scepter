import { Command } from 'commander';
import chalk from 'chalk';
import { showNotes, writeOutput, type ShowOptions } from './show-handler';
import { addCommonFilterOptions } from './common-filters';
import { BaseCommand } from '../base-command';

let showCommand = new Command('show')
  .description('Show notes by their IDs (supports glob patterns like D*, Q00[1-5]) or analyze source files')
  .argument('[ids...]', 'Note IDs or glob patterns to retrieve')
  .option('-r, --references', 'Include all referenced notes')
  .option('--include-incoming-refs', 'Include only incoming references')
  .option('--include-outgoing-refs', 'Include only outgoing references')
  .option('-d, --depth <n>', 'Reference traversal depth', '1')
  .option('-p, --preview', 'Show excerpt only')
  .option('--no-format', 'Output content without formatting (plain text)')
  .option('--json', 'Output as JSON')
  .option('--source-file <path>', 'Show notes referenced in a source file')
  .option('--include-file-refs', 'Include references to the file path itself')
  .option('--no-source-refs', 'Exclude source code references when showing notes');

// Add common filter options
showCommand = addCommonFilterOptions(showCommand);

showCommand.action(async (ids: string[], options: ShowOptions & { projectDir?: string }) => {
  try {
    await BaseCommand.execute(
      {
        projectDir: options.projectDir,
        requireNoteManager: true,
      },
      async (context) => {
        // Handle source file mode differently
        if (options.sourceFile) {
          // Import the handler dynamically to avoid circular dependencies
          const { showSourceFile } = await import('./show-handler');
          await showSourceFile(options.sourceFile, options, context);
          return;
        }

        // Regular note show mode
        if (!ids || ids.length === 0) {
          console.error(chalk.red('Error: Either provide note IDs or use --source-file option'));
          process.exit(1);
        }

        const result = await showNotes(ids, options, context);

        // Report not found notes
        if (result.notFound.length > 0) {
          console.error(chalk.yellow(`Warning: Notes not found: ${result.notFound.join(', ')}`));
        }

        await writeOutput(result.output, options.output);

        if (options.output) {
          console.log(chalk.green(`Output written to ${options.output}`));
        }
      }
    );
  } catch (error) {
    BaseCommand.handleError(error);
  }
});

export { showCommand };