/**
 * `scepter claims meta log CLAIM`
 *
 * Prints the chronological event log for a claim. Each line includes op,
 * key, value (omitted for unset), actor, date, and note (if present).
 * `--json` emits the raw event array.
 *
 * Phase-1 supports only the `<claim>` filter; --key/--actor/--since/--until/
 * --op are deferred to Phase 2 per {R009.§3.AC.07}.
 *
 * @implements {R009.§3.AC.06} `meta log` command (chronological output)
 * @implements {R009.§3.AC.08} `--json` array output
 * @implements {DD014.§3.DC.35} log emits chronological events; --json -> array
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../../base-command.js';
import { ensureIndex } from '../ensure-index.js';
import { resolveClaimId } from './shared.js';
import { emitClaimPreamble } from '../../shared/claim-preamble.js';

interface LogOptions {
  json?: boolean;
  reindex?: boolean;
  projectDir?: string;
}

export const logCommand = new Command('log')
  .description('Print the chronological event log for a claim')
  .argument('<claim>', 'Claim ID')
  .option('--json', 'Output as JSON array')
  .option('--reindex', 'Force rebuild of claim index')
  .action(async (claim: string, options: LogOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });
          const resolved = resolveClaimId(claim, data);
          if (!resolved) return;

          await emitClaimPreamble(resolved, context.projectManager.noteManager!, options);

          const metadataStorage = context.projectManager.metadataStorage!;
          const events = await metadataStorage.query({ claimId: resolved.fullyQualified });

          if (options.json) {
            console.log(JSON.stringify(events, null, 2));
            return;
          }

          if (events.length === 0) {
            console.log(chalk.gray(`No events for ${resolved.fullyQualified}.`));
            return;
          }

          for (const event of events) {
            const valuePart = event.op === 'unset' ? '' : ` ${event.value}`;
            const notePart = event.note ? ` (${event.note})` : '';
            console.log(
              `${chalk.gray(event.date)} ${chalk.cyan(event.op.padEnd(7))} ${chalk.bold(event.key)}${valuePart}  ${chalk.gray(`by ${event.actor}`)}${notePart}`,
            );
          }
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
