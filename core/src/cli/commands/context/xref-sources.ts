import { Command } from 'commander';
import chalk from 'chalk';
import { xrefSources, formatXrefResults, writeXrefOutput, type XrefSourcesOptions } from './xref-sources-handler';
import { addCommonFilterOptions } from './common-filters';
import { BaseCommand } from '../base-command';

let xrefSourcesCommand = new Command('xref-sources')
  .description('Cross-reference audit between source code files and SCEpter notes')
  .argument('[targets...]', 'Note IDs, note glob patterns, or source file paths/globs')
  .option('-v, --verbose', 'Show context snippets and note excerpts')
  .option('--json', 'Output as JSON')
  .option('--direction <dir>', 'Filter reference direction: note-to-source, source-to-note, both', 'both')
  .option('--group-by <field>', 'Group results by: note, file, none', 'none');

// Add common filter options (includes -o/--output, --types, --tags, --status, etc.)
xrefSourcesCommand = addCommonFilterOptions(xrefSourcesCommand);

xrefSourcesCommand.action(async (targets: string[], options: XrefSourcesOptions & { projectDir?: string }) => {
  try {
    await BaseCommand.execute(
      {
        projectDir: options.projectDir,
        requireNoteManager: true,
        startWatching: true,
      },
      async (context) => {
        if (!context.projectManager.sourceScanner) {
          console.error(chalk.red('Error: Source code integration is not enabled in this project'));
          process.exit(1);
        }

        const result = await xrefSources(targets || [], options, context);
        const output = formatXrefResults(result, options);

        await writeXrefOutput(output, options.output);

        if (options.output) {
          console.log(chalk.green(`Output written to ${options.output}`));
        }
      },
    );
  } catch (error) {
    BaseCommand.handleError(error);
  }
});

export { xrefSourcesCommand };
