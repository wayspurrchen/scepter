/**
 * @implements {R005.§5.AC.01} Index summary includes importance, lifecycle, and verification counts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import type { VerificationStore } from '../../../claims/index.js';
import { formatIndexSummary } from '../../formatters/claim-formatter.js';
import { formatClaimTree } from '../../formatters/claim-formatter.js';

export const indexCommand = new Command('index')
  .description('Build the claim index and report statistics')
  .option('--json', 'Output as JSON')
  .option('--tree', 'Show claim tree per note')
  .action(async (options: { json?: boolean; tree?: boolean; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const data = await ensureIndex(context.projectManager);

          // @implements {R005.§5.AC.01} Load verification store for verified/unverified counts
          const verificationStore: VerificationStore = await context.projectManager.verificationStorage!.load();

          if (options.json) {
            // Serialize maps for JSON output
            const serializable = {
              entries: Object.fromEntries(data.entries),
              trees: Object.fromEntries(
                [...data.trees.entries()].map(([k, v]) => [k, v]),
              ),
              crossRefs: data.crossRefs,
              errors: data.errors,
            };
            console.log(JSON.stringify(serializable, null, 2));
            return;
          }

          console.log(formatIndexSummary(data, verificationStore));

          if (options.tree) {
            console.log('');
            console.log(chalk.bold('Claim Trees:'));
            for (const [noteId, roots] of data.trees) {
              if (roots.length === 0) continue;
              console.log('');
              console.log(chalk.cyan(`--- ${noteId} ---`));
              console.log(formatClaimTree(roots));
            }
          }
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
