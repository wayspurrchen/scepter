import { Command } from 'commander';
import { DeleteHandler } from './delete-handler.js';
import { BaseCommand } from '../base-command.js';

/**
 * `scepter delete` — soft-delete by default (preserved unchanged from
 * the prior implementation), with an opt-in hard-delete mode behind
 * the `--hard` flag that rewrites every inbound reference to a deletion
 * marker and removes the note unit outright.
 *
 * @implements {DD020.§4.DC.15} delete CLI command preserved; soft-delete default + hard-delete flag
 * @implements {DD020.§4.DC.18} dry-run flag routes through planner without mutating disk
 * @implements {DD020.§4.DC.21} flag toggles between soft-delete (default) and hard-delete (opt-in)
 * @implements {DD020.§3.DC.04} override flag (--allow-dirty) propagates to dirty-tree guard
 */
export const deleteCommand = new Command('delete')
  .description(
    'Delete one or more notes. Default mode is soft-delete (relocates to _deleted/, ' +
      'inbound references intact). Pass --hard to rewrite inbound references to a ' +
      'deletion marker and remove the note unit outright.',
  )
  .argument('<noteIds...>', 'IDs of notes to delete (e.g., D001 R002)')
  .option('-r, --reason <reason>', 'Reason for deletion (soft-delete only)')
  .option('--force', 'Skip confirmation prompt')
  .option('--hard', 'Hard-delete: rewrite inbound references and remove the note unit outright')
  .option('-n, --dry-run', 'Hard-delete only: print the rewrite plan without mutating files')
  .option('--allow-dirty', 'Hard-delete only: proceed even if the git working tree is dirty')
  .option('--json', 'Output result as JSON')
  .action(async (noteIds: string[], options) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const handler = new DeleteHandler();
          await handler.execute(
            noteIds,
            {
              projectDir: context.projectPath,
              reason: options.reason,
              force: options.force,
              hard: options.hard,
              dryRun: options.dryRun,
              allowDirty: options.allowDirty,
              json: options.json,
            },
            context,
          );
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
