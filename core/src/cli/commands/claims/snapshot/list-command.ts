/**
 * `scepter snapshot list`
 *
 * Lists every saved snapshot in `_scepter/snapshots/` as a small
 * table.  Returns an empty list (not an error) when no snapshots
 * directory exists or when the directory is empty.
 *
 * @implements {DD018.§3.DC.55} formatSnapshotList — rendering lives in `snapshot-formatter.ts`; this module is the CLI handler
 * @implements {DD018.§3.DC.67} `list` Commander spec + handler; empty-directory message + zero exit
 */

import { Command } from 'commander';
import { BaseCommand } from '../../base-command.js';
import {
  listSnapshots,
  formatSnapshotList,
} from '../../../../claims/snapshot/index.js';

interface ListOptions {
  projectDir?: string;
}

export const listCommand = new Command('list')
  .description('List saved snapshots')
  .action(async (options: ListOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const rows = await listSnapshots(context.projectPath);

          if (rows.length === 0) {
            console.log('No snapshots saved. Run `scepter snapshot save` to capture one.');
            return;
          }

          console.log(formatSnapshotList(rows));
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
