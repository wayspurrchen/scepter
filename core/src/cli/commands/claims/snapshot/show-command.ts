/**
 * `scepter snapshot show <name>`
 *
 * Prints metadata + summary statistics for a saved snapshot.  Output
 * stays summary-scale per {R014.§3.AC.05} — does NOT iterate per-claim
 * lines.
 *
 * @implements {DD018.§3.DC.56} formatSnapshotShow — rendering lives in `snapshot-formatter.ts`; this module is the CLI handler
 * @implements {DD018.§3.DC.68} `show` Commander spec + handler; SnapshotNotFoundError / SnapshotSchemaError → non-zero exit
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import { BaseCommand } from '../../base-command.js';
import {
  readSnapshot,
  snapshotPath,
  formatSnapshotShow,
  SnapshotNotFoundError,
  SnapshotSchemaError,
} from '../../../../claims/snapshot/index.js';
import type { Snapshot } from '../../../../claims/snapshot/index.js';

interface ShowOptions {
  projectDir?: string;
}

export const showCommand = new Command('show')
  .description('Show metadata and summary statistics for a saved snapshot')
  .argument('<name>', 'Snapshot name')
  .action(async (name: string, options: ShowOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          let filePath: string;
          try {
            filePath = snapshotPath(context.projectPath, name);
          } catch (err) {
            console.error(chalk.red(err instanceof Error ? err.message : String(err)));
            process.exit(1);
          }

          let snapshot: Snapshot;
          let fileSize: number;
          try {
            const stat = await fs.stat(filePath);
            fileSize = stat.size;
            snapshot = await readSnapshot(filePath);
          } catch (err) {
            if (err instanceof SnapshotNotFoundError || err instanceof SnapshotSchemaError) {
              console.error(chalk.red(err.message));
              process.exit(1);
            }
            // ENOENT from fs.stat → translate to SnapshotNotFoundError shape.
            if (
              typeof err === 'object' &&
              err !== null &&
              'code' in err &&
              (err as { code: unknown }).code === 'ENOENT'
            ) {
              console.error(chalk.red(`Snapshot not found: ${name}`));
              process.exit(1);
            }
            throw err;
          }

          console.log(formatSnapshotShow(snapshot, fileSize));
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
