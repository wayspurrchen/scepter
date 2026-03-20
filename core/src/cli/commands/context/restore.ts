import { Command } from 'commander';
import { RestoreHandler } from './restore-handler.js';
import { BaseCommand } from '../base-command.js';

export const restoreCommand = new Command('restore')
  .description('Restore archived or deleted notes back to their original locations')
  .argument('<noteIds...>', 'IDs of notes to restore (e.g., D001 R002)')
  .option('--force', 'Skip confirmation prompt')
  .option('--json', 'Output result as JSON')
  .action(async (noteIds: string[], options) => {
    await BaseCommand.execute({
      projectDir: options.projectDir,
      requireNoteManager: true,
      startWatching: true,
      includeArchived: true,
      includeDeleted: true,
    }, async (context) => {
      const handler = new RestoreHandler();
      await handler.execute(noteIds, {
        force: options.force,
        json: options.json,
      }, context);
    });
  });