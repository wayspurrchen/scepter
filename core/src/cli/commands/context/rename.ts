import { Command } from 'commander';
import { RenameHandler } from './rename-handler.js';
import { BaseCommand } from '../base-command.js';

/**
 * `scepter rename <sourceId> <targetId>` — rename a note's ID and
 * rewrite every inbound reference accordingly. Greenfield in R015.
 *
 * Rename rewrites:
 *  - The renamed note's filesystem entry (file or folder + inner main)
 *  - The renamed note's frontmatter `id` field
 *  - Every self-prefixed claim definition inside the renamed note
 *  - Every inbound reference (markdown body, source code, frontmatter
 *    lists, claim metadata) across the project
 *
 * All five behaviors are staged together and committed together; a
 * failure in any one rolls back the others.
 *
 * @implements {DD020.§4.DC.16} rename CLI command accepts source + target positional args
 * @implements {DD020.§4.DC.18} dry-run flag routes through planner without mutating disk
 * @implements {DD020.§3.DC.04} override flag (--allow-dirty) propagates to dirty-tree guard
 */
export const renameCommand = new Command('rename')
  .description(
    'Rename a note ID. Renames the filesystem entry, updates the frontmatter id, ' +
      'rewrites self-prefixed claim definitions inside the renamed note, and rewrites ' +
      'every inbound reference across the project.',
  )
  .argument('<sourceId>', 'Current note ID (e.g., R005)')
  .argument('<targetId>', 'New note ID (e.g., R042)')
  .option('-n, --dry-run', 'Print the rewrite plan without mutating files')
  .option('--allow-dirty', 'Proceed even if the git working tree is dirty')
  .option('--json', 'Output result as JSON')
  .action(async (sourceId: string, targetId: string, options) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const handler = new RenameHandler();
          await handler.execute(
            sourceId,
            targetId,
            {
              projectDir: context.projectPath,
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
