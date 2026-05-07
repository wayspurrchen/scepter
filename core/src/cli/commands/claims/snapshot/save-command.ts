/**
 * `scepter snapshot save [name] [--force]`
 *
 * Captures the live in-memory claim index into a `Snapshot` value and
 * writes it to `_scepter/snapshots/<name>.json` via the atomic
 * temp-then-rename pattern.  Defaults the name to the local-clock
 * `YYYY-MM-DD-HHMM` timestamp when omitted.  Refuses to overwrite an
 * existing snapshot unless `--force` is passed.
 *
 * @implements {DD018.§3.DC.65} Commander spec for `save` ([name], --force)
 * @implements {DD018.§3.DC.66} Handler: ensureIndex → captureSnapshot → writeSnapshot
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { BaseCommand } from '../../base-command.js';
import { ensureIndex } from '../ensure-index.js';
import {
  captureSnapshot,
  writeSnapshot,
  defaultSnapshotName,
  SnapshotExistsError,
  SNAPSHOT_DIR_RELATIVE,
} from '../../../../claims/snapshot/index.js';

interface SaveOptions {
  force?: boolean;
  projectDir?: string;
}

export const saveCommand = new Command('save')
  .description('Capture the live claim index into a snapshot file')
  .argument('[name]', 'Snapshot name (default: current local timestamp YYYY-MM-DD-HHMM)')
  .option('--force', 'Overwrite an existing snapshot of the same name')
  .action(async (name: string | undefined, options: SaveOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const projectRoot = context.projectPath;
          const effectiveName = name ?? defaultSnapshotName();

          // Populate the index (cross-refs from sourceScanner included).
          await ensureIndex(context.projectManager);

          const startedAt = Date.now();
          const snapshot = await captureSnapshot({
            claimIndex: context.projectManager.claimIndex,
            noteFileManager: context.projectManager.noteFileManager,
            noteManager: context.projectManager.noteManager ?? undefined,
            sourceScanner: context.projectManager.sourceScanner,
            projectRoot,
          });

          let writeResult;
          try {
            writeResult = await writeSnapshot(projectRoot, effectiveName, snapshot, {
              force: !!options.force,
            });
          } catch (err) {
            if (err instanceof SnapshotExistsError) {
              console.error(chalk.red(err.message));
              process.exit(1);
            }
            throw err;
          }

          const elapsedMs = Date.now() - startedAt;
          const projRelative = path.relative(projectRoot, writeResult.filePath) ||
            path.join(SNAPSHOT_DIR_RELATIVE, `${effectiveName}.json`);
          console.log(
            chalk.green(`Wrote snapshot:`) + ` ${projRelative.split(path.sep).join('/')}`,
          );
          console.log(`  Claims:    ${snapshot.claims.length}`);
          console.log(`  Notes:     ${snapshot.notes.length}`);
          console.log(`  Wall time: ${elapsedMs}ms`);
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
