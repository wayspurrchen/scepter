/**
 * Convert command - Convert notes between file and folder formats
 * @implements {T007} - Implement convert command for folder format conversion
 */

import { Command } from 'commander';
import { ConvertHandler } from './convert-handler.js';
import { BaseCommand } from '../base-command.js';

export const convertCommand = new Command('convert')
  .description('Convert notes between file and folder formats')
  .argument('<noteIds...>', 'IDs of notes to convert (e.g., D001 R002, supports glob patterns)')
  .option('--to-folder', 'Convert note(s) to folder format')
  .option('--to-file', 'Convert note(s) to file format')
  .option('--backup <boolean>', 'Create backup before conversion (default: true)', 'true')
  .option('-d, --dry-run', 'Show what would be converted without converting')
  .option('-f, --force', 'Skip confirmation prompts and force conversion')
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
          const handler = new ConvertHandler();
          await handler.execute(noteIds, {
            projectDir: context.projectPath,
            toFolder: options.toFolder,
            toFile: options.toFile,
            backup: options.backup === 'true' || options.backup === true,
            dryRun: options.dryRun,
            force: options.force,
            json: options.json,
          }, context);
        }
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });