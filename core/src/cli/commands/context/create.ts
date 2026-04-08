/**
 * @implements {T003} - Folder-based notes CLI integration (--folder flag)
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { createNote, type CreateOptions } from './create-handler.js';
import { BaseCommand } from '../base-command.js';

export const createCommand = new Command('create')
  .description('Create a new note')
  .argument('[type]', 'Note type (e.g., Decision, Requirement, TODO)')
  .argument('[title]', 'Note title')
  .option('-t, --type <type>', 'Note type (alternative to positional argument)')
  .option('-c, --content <content>', 'Note content')
  .option('--tags <tags...>', 'Tags to assign')
  .option('-e, --editor', 'Open in editor')
  .option('--template <template>', 'Use specific template')
  .option('--no-template', 'Create without template')
  .option('--stdin', 'Read content from stdin')
  .option('--folder', 'Create as folder-based note')
  .option('-s, --status <status>', 'Note status (e.g., proposed, active, completed)')
  .action(async (type: string | undefined, title: string | undefined, options: CreateOptions & { projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          requireModePrompts: false, // create doesn't use mode prompts
          startWatching: true,
        },
        async (context) => {
          // @implements {T009} - Handle --type option with smart positional argument interpretation
          // When --type is provided, the first positional becomes the title
          let actualType: string;
          let actualTitle: string | undefined;

          if (options.type) {
            // --type option provided, so first positional is the title
            actualType = options.type;
            actualTitle = type || title || options.title;
          } else {
            // No --type option, use positional arguments as normal
            actualType = type || '';
            actualTitle = title || options.title;
          }

          if (!actualType) {
            throw new Error('Note type is required. Provide it as a positional argument or use --type option.');
          }

          const result = await createNote(actualType, { ...options, title: actualTitle }, context);
          // Display full path of created file
          if (result.note.filePath) {
            console.log(chalk.green(`Created note at: ${chalk.cyan(result.note.filePath)}`));
          } else {
            console.log(chalk.green(`Created note ${chalk.cyan(result.note.id)}`));
          }
          console.log(chalk.dim('🤖 For agents: remember to read the file first before writing or your update may fail.'));

          // Add folder creation confirmation
          if (result.note.isFolder && result.note.folderPath) {
            console.log(chalk.yellow(
              '📁 Note created as folder. Additional files can be added at:\n' +
              `   ${result.note.folderPath}`
            ));
          }

          console.log(result.output);

          return result;
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'Note creation cancelled') {
        console.log(chalk.yellow('Note creation cancelled'));
      } else {
        BaseCommand.handleError(error);
      }
    }
  });
