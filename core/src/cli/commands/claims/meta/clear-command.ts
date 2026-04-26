/**
 * `scepter claims meta clear CLAIM`
 *
 * Discovers all keys with current values via fold and emits one `unset`
 * event per key. No-op (with a friendly message) if the fold is empty.
 *
 * @implements {R009.§2.AC.05} `meta clear` command
 * @implements {DD014.§3.DC.31} clear iterates over folded keys; no-op message on empty
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createId } from '@paralleldrive/cuid2';
import { BaseCommand } from '../../base-command.js';
import { ensureIndex } from '../ensure-index.js';
import {
  parseDateOption,
  resolveClaimId,
  getDefaultActor,
} from './shared.js';
import { emitClaimPreamble } from '../../shared/claim-preamble.js';
import type { MetadataEvent } from '../../../../claims/index.js';

interface ClearOptions {
  actor?: string;
  date?: string;
  note?: string;
  reindex?: boolean;
  projectDir?: string;
}

export const clearCommand = new Command('clear')
  .description('Clear ALL metadata keys on a claim (one unset event per current key)')
  .argument('<claim>', 'Claim ID')
  .option('--actor <name>', 'Name of the writing actor (default: OS username)')
  .option('--date <date>', 'ISO 8601 datetime or YYYY-MM-DD (default: now)')
  .option('--note <text>', 'Free-form note attached to each event')
  .option('--reindex', 'Force rebuild of claim index')
  .action(async (claim: string, options: ClearOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const actor = options.actor ?? getDefaultActor();
          const date = parseDateOption(options.date);

          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });
          const resolved = resolveClaimId(claim, data);
          if (!resolved) return;

          await emitClaimPreamble(resolved, context.projectManager.noteManager!);

          if (resolved.lifecycle?.type === 'removed') {
            console.log(chalk.red(`Cannot write metadata to claim ${claim}: claim is tagged :removed.`));
            return;
          }

          const metadataStorage = context.projectManager.metadataStorage!;
          const folded = await metadataStorage.fold(resolved.fullyQualified);
          const keys = Object.keys(folded);
          if (keys.length === 0) {
            console.log('No metadata to clear.');
            return;
          }

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
            chalk.green(`Cleared ${keys.length} key(s) on ${chalk.cyan(resolved.fullyQualified)}.`),
          );
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
