/**
 * `scepter claims meta set CLAIM KEY=VALUE [KEY=VALUE...]`
 *
 * Atomic-replace semantic: the fold rule clears prior values for KEY at the
 * point of the `set` event and records VALUE as the only current value.
 *
 * @implements {R009.§2.AC.02} `meta set` command
 * @implements {DD014.§3.DC.29} `set` records op="set" events; KEY/resolution/:removed rules apply
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
  parseKeyValuePairs,
  getDefaultActor,
} from './shared.js';
import { emitClaimPreamble } from '../../shared/claim-preamble.js';
import type { MetadataEvent } from '../../../../claims/index.js';

interface SetOptions {
  actor?: string;
  date?: string;
  note?: string;
  reindex?: boolean;
  projectDir?: string;
}

export const setCommand = new Command('set')
  .description('Append set events for KEY=VALUE pairs (atomic replace)')
  .argument('<claim>', 'Claim ID')
  .argument('<pairs...>', 'One or more KEY=VALUE pairs')
  .option('--actor <name>', 'Name of the writing actor (default: OS username)')
  .option('--date <date>', 'ISO 8601 datetime or YYYY-MM-DD (default: now)')
  .option('--note <text>', 'Free-form note attached to each event')
  .option('--reindex', 'Force rebuild of claim index')
  .action(async (claim: string, pairs: string[], options: SetOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const actor = options.actor ?? getDefaultActor();
          const date = parseDateOption(options.date);

          const parsed = parseKeyValuePairs(pairs);
          if ('error' in parsed) {
            console.error(chalk.red(parsed.error));
            process.exit(1);
          }
          const keyValidation = validateKeys(parsed.pairs.map((p) => p.key));
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
          for (const { key, value } of parsed.pairs) {
            const event: MetadataEvent = {
              id: createId(),
              claimId: resolved.fullyQualified,
              key,
              value,
              op: 'set',
              actor,
              date,
            };
            if (options.note) event.note = options.note;
            await metadataStorage.append(event);
          }

          console.log(
            chalk.green(`Set ${parsed.pairs.length} key(s) on ${chalk.cyan(resolved.fullyQualified)}.`),
          );
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
