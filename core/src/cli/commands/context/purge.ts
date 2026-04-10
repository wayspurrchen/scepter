import { Command } from 'commander';
import { PurgeHandler } from './purge-handler.js';
import { BaseCommand } from '../base-command.js';

export const purgeCommand = new Command('purge')
  .description('Permanently delete notes from _deleted folders (cannot be undone)')
  .argument('[noteIds...]', 'IDs of deleted notes to purge (e.g., D001 R002) - if not provided, shows all deleted notes')
  .option('--force', 'Skip confirmation prompt')
  .option('--json', 'Output result as JSON')
  .action(async (noteIds: string[] = [], options) => {
    await BaseCommand.execute({
      projectDir: options.projectDir,
      requireNoteManager: true,
      includeDeleted: true,
    }, async (context) => {
      const handler = new PurgeHandler();
      await handler.execute(noteIds, {
        force: options.force,
        json: options.json,
      }, context);
    });
  });