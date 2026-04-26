/**
 * `scepter claims meta get CLAIM [KEY]`
 *
 * Without KEY: prints every (key, values) pair from the fold.
 * With KEY: prints only the values for that key, one per line.
 * `--json` emits structured output.
 *
 * Exit status: with KEY, non-zero if the key has no current values
 * (scriptable distinguishability between empty and missing).
 *
 * @implements {R009.§3.AC.01} `meta get` command without key
 * @implements {R009.§3.AC.02} `meta get` with key + missing-key exit
 * @implements {R009.§3.AC.04} `--json` output
 * @implements {DD014.§3.DC.32} get prints fold contents
 * @implements {DD014.§3.DC.33} missing-key exit semantics
 * @implements {DD014.§3.DC.34} --json shape
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../../base-command.js';
import { ensureIndex } from '../ensure-index.js';
import { resolveClaimId, validateKeys } from './shared.js';
import { emitClaimPreamble } from '../../shared/claim-preamble.js';

interface GetOptions {
  json?: boolean;
  reindex?: boolean;
  projectDir?: string;
}

export const getCommand = new Command('get')
  .description('Print the folded metadata state for a claim')
  .argument('<claim>', 'Claim ID')
  .argument('[key]', 'Optional KEY; if provided, prints only that key\'s values')
  .option('--json', 'Output as JSON')
  .option('--reindex', 'Force rebuild of claim index')
  .action(async (claim: string, key: string | undefined, options: GetOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          if (key !== undefined) {
            const keyValidation = validateKeys([key]);
            if (keyValidation) {
              console.error(chalk.red(keyValidation));
              process.exit(1);
            }
          }

          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });
          const resolved = resolveClaimId(claim, data);
          if (!resolved) return;

          await emitClaimPreamble(resolved, context.projectManager.noteManager!, options);

          const metadataStorage = context.projectManager.metadataStorage!;
          const folded = await metadataStorage.fold(resolved.fullyQualified);

          // @implements {DD014.§3.DC.32} With KEY: print only that key's values.
          if (key !== undefined) {
            const values = folded[key];
            if (options.json) {
              // @implements {DD014.§3.DC.34}
              console.log(JSON.stringify({ values: values ?? [] }));
            } else if (values && values.length > 0) {
              for (const v of values) console.log(v);
            }
            // @implements {DD014.§3.DC.33} Missing key -> non-zero exit.
            if (!values || values.length === 0) {
              process.exit(1);
            }
            return;
          }

          // No KEY: print every (key, values) pair.
          if (options.json) {
            // @implements {DD014.§3.DC.34}
            console.log(JSON.stringify({ state: folded }));
            return;
          }

          const keys = Object.keys(folded).sort();
          if (keys.length === 0) {
            // @implements {DD014.§3.DC.33} Empty fold without KEY = exit 0 (not an error).
            return;
          }
          for (const k of keys) {
            const values = folded[k];
            if (values.length === 1) {
              console.log(`${chalk.cyan(k)}: ${values[0]}`);
            } else {
              console.log(`${chalk.cyan(k)}: [${values.join(', ')}]`);
            }
          }
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
