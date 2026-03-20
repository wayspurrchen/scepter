import { Command } from 'commander';
import { DeleteHandler } from './delete-handler.js';
import { BaseCommand } from '../base-command.js';

export const deleteCommand = new Command('delete')
  .description('Delete one or more notes, moving them to _deleted folders')
  .argument('<noteIds...>', 'IDs of notes to delete (e.g., D001 R002)')
  .option('-r, --reason <reason>', 'Reason for deletion')
  .option('--force', 'Skip confirmation prompt')
  .option('--json', 'Output result as JSON')
  .action(async (noteIds: string[], options) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: true,
        },
        async (context) => {
          const handler = new DeleteHandler();
          await handler.execute(noteIds, {
            projectDir: context.projectPath,
            reason: options.reason,
            force: options.force,
            json: options.json,
          }, context);
        }
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });