import { Command } from 'commander';
import { ArchiveHandler } from './archive-handler.js';
import { BaseCommand } from '../base-command.js';

export const archiveCommand = new Command('archive')
  .description('Archive one or more notes, preserving them in _archive folders')
  .argument('<noteIds...>', 'IDs of notes to archive (e.g., D001 R002)')
  .option('-r, --reason <reason>', 'Reason for archiving')
  .option('--force', 'Skip confirmation prompt')
  .option('--json', 'Output result as JSON')
  .action(async (noteIds: string[], options) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const handler = new ArchiveHandler();
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