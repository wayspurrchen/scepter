/**
 * `scepter snapshot rm <name> [--yes]`
 *
 * Deletes a saved snapshot.  Default posture is prompt-with-`--yes`-bypass
 * per §DC.69/§DC.70 — accidental deletions of session artifacts have
 * real cost.
 *
 * TTY guard: when `--yes` is not passed AND `process.stdin.isTTY` is
 * falsy (CI, piped, or other non-interactive contexts), the command
 * exits non-zero with a clear error rather than attempting a stdin
 * read.  A blocking read would hang the process; an unguarded read
 * could consume garbage from a piped source.
 *
 * @implements {DD018.§3.DC.69} Commander spec, TTY guard, prompt path
 * @implements {DD018.§3.DC.70} Default-prompt posture rationale
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import * as fs from 'fs/promises';
import { BaseCommand } from '../../base-command.js';
import {
  removeSnapshot,
  snapshotPath,
  SnapshotNotFoundError,
} from '../../../../claims/snapshot/index.js';

interface RmOptions {
  yes?: boolean;
  projectDir?: string;
}

export const rmCommand = new Command('rm')
  .description('Delete a saved snapshot')
  .argument('<name>', 'Snapshot name to delete')
  .option('--yes', 'Skip the confirmation prompt')
  .action(async (name: string, options: RmOptions) => {
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

          // Pre-check existence so the not-found path doesn't depend on
          // the prompt outcome.  Per {R014.§3.AC.03} not-found is a
          // distinct error condition from confirmation refusal.
          try {
            await fs.access(filePath);
          } catch {
            console.error(chalk.red(`Snapshot not found: ${name}`));
            process.exit(1);
          }

          if (!options.yes) {
            // §DC.69: TTY guard.
            if (!process.stdin.isTTY) {
              console.error(
                chalk.red(
                  'Cannot prompt for confirmation in non-interactive context. Re-run with --yes.',
                ),
              );
              process.exit(1);
            }

            const confirmed = await promptYesNo(`Delete snapshot "${name}"? [y/N]: `);
            if (!confirmed) {
              console.log('Aborted.');
              return;
            }
          }

          try {
            await removeSnapshot(context.projectPath, name);
          } catch (err) {
            if (err instanceof SnapshotNotFoundError) {
              console.error(chalk.red(err.message));
              process.exit(1);
            }
            throw err;
          }

          console.log(chalk.green(`Deleted snapshot:`) + ` ${name}`);
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });

/**
 * Prompt the user with the given message and resolve to true only on
 * a leading `y` or `Y`.  Closes the readline interface before
 * resolving so the process can exit cleanly.
 */
async function promptYesNo(message: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed.length > 0 && (trimmed[0] === 'y' || trimmed[0] === 'Y'));
    });
  });
}
