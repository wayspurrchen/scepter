/**
 * `scepter claims meta add CLAIM KEY=VALUE [KEY=VALUE...]`
 *
 * Appends `add` events to the claim metadata log. Each KEY=VALUE pair
 * produces one event with op="add". The key must match
 * /^[a-z][a-z0-9._-]*$/. The claim must resolve in the index. Claims tagged
 * `:removed` are rejected.
 *
 * @implements {R009.§2.AC.01} `meta add` command
 * @implements {R009.§2.AC.07} KEY pattern validation
 * @implements {R009.§2.AC.08} Claim ID resolution with fuzzy suggestions
 * @implements {R009.§2.AC.09} :removed claim rejection
 * @implements {DD014.§3.DC.25} `add` accepts variadic KEY=VALUE
 * @implements {DD014.§3.DC.26} KEY validation atomicity
 * @implements {DD014.§3.DC.27} Claim resolution with fuzzy match
 * @implements {DD014.§3.DC.28} :removed lifecycle rejection
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

interface AddOptions {
  actor?: string;
  date?: string;
  note?: string;
  reindex?: boolean;
  projectDir?: string;
}

export const addCommand = new Command('add')
  .description('Append add events for KEY=VALUE pairs on a claim')
  .argument('<claim>', 'Claim ID (e.g., R004.§1.AC.01)')
  .argument('<pairs...>', 'One or more KEY=VALUE pairs')
  .option('--actor <name>', 'Name of the writing actor (default: OS username)')
  .option('--date <date>', 'ISO 8601 datetime or YYYY-MM-DD (default: now)')
  .option('--note <text>', 'Free-form note attached to each event')
  .option('--reindex', 'Force rebuild of claim index')
  .action(async (claim: string, pairs: string[], options: AddOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const actor = options.actor ?? getDefaultActor();
          const date = parseDateOption(options.date);

          // @implements {DD014.§3.DC.26} Validate every KEY before any append.
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

          // @implements {DD014.§3.DC.27} Resolve claim against the index.
          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });
          const resolved = resolveClaimId(claim, data);
          if (!resolved) return;

          await emitClaimPreamble(resolved, context.projectManager.noteManager!);

          // @implements {DD014.§3.DC.28} Reject :removed claims.
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
              op: 'add',
              actor,
              date,
            };
            if (options.note) event.note = options.note;
            await metadataStorage.append(event);
          }

          console.log(
            chalk.green(`Recorded ${parsed.pairs.length} event(s) on ${chalk.cyan(resolved.fullyQualified)}.`),
          );
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
