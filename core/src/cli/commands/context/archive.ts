import { Command } from 'commander';
import { ArchiveHandler } from './archive-handler.js';
import { BaseCommand } from '../base-command.js';

/**
 * `scepter archive` — preserved unchanged with respect to reference
 * rewriting. No `--hard` flag, no rewriter invocation, no dirty-tree
 * guard tied to reference rewriting. Archive's underlying file
 * operations gained folder-unit atomicity in Phase 4a (per
 * {DD020.§3.DC.14}) but its observable command surface is unchanged.
 *
 * @implements {DD020.§4.DC.12} archive command unchanged with respect to reference rewriting
 * @implements {DD020.§4.DC.17} archive CLI command preserved unchanged with no reference-rewriting flag
 */
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