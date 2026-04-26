/**
 * `scepter claims meta unset CLAIM KEY [KEY...]`
 *
 * Appends `unset` events that clear the named keys' folded values. Bare KEY
 * arguments only — KEY=VALUE forms are rejected at parse time.
 *
 * @implements {R009.§2.AC.04} `meta unset` command
 * @implements {DD014.§3.DC.30} bare-KEY parsing; op="unset" with empty value
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createId } from '@paralleldrive/cuid2';
import { BaseCommand } from '../../base-command.js';
import { ensureIndex } from '../ensure-index.js';
import {
  parseDateOption,
  resolveClaimId,
  validateKeys,
  getDefaultActor,
} from './shared.js';
import { emitClaimPreamble } from '../../shared/claim-preamble.js';
import type { MetadataEvent } from '../../../../claims/index.js';

interface UnsetOptions {
  actor?: string;
  date?: string;
  note?: string;
  reindex?: boolean;
  projectDir?: string;
}

export const unsetCommand = new Command('unset')
  .description('Append unset events that clear the named keys')
  .argument('<claim>', 'Claim ID')
  .argument('<keys...>', 'One or more bare KEY arguments (no =VALUE)')
  .option('--actor <name>', 'Name of the writing actor (default: OS username)')
  .option('--date <date>', 'ISO 8601 datetime or YYYY-MM-DD (default: now)')
  .option('--note <text>', 'Free-form note attached to each event')
  .option('--reindex', 'Force rebuild of claim index')
  .action(async (claim: string, keys: string[], options: UnsetOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const actor = options.actor ?? getDefaultActor();
          const date = parseDateOption(options.date);

          // @implements {DD014.§3.DC.30} Reject KEY=VALUE shape; bare KEY only.
          for (const k of keys) {
            if (k.includes('=')) {
              console.error(
                chalk.red(`unset takes bare KEY arguments only. Got "${k}". Use \`meta set ${k}\` to assign a value.`),
              );
              process.exit(1);
            }
          }
          const keyValidation = validateKeys(keys);
          if (keyValidation) {
            console.error(chalk.red(keyValidation));
            process.exit(1);
          }

          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });
          const resolved = resolveClaimId(claim, data);
          if (!resolved) return;

          await emitClaimPreamble(resolved, context.projectManager.noteManager!);

          if (resolved.lifecycle?.type === 'removed') {
            console.log(chalk.red(`Cannot write metadata to claim ${claim}: claim is tagged :removed.`));
            return;
          }

          const metadataStorage = context.projectManager.metadataStorage!;
          for (const key of keys) {
            const event: MetadataEvent = {
              id: createId(),
              claimId: resolved.fullyQualified,
              key,
              value: '',
              op: 'unset',
              actor,
              date,
            };
            if (options.note) event.note = options.note;
            await metadataStorage.append(event);
          }

          console.log(
            chalk.green(`Unset ${keys.length} key(s) on ${chalk.cyan(resolved.fullyQualified)}.`),
          );
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
