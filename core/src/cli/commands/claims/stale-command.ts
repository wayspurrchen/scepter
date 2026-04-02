/**
 * Staleness detection command for SCEpter claims.
 *
 * Reports claims that are stale (source modified after last verification),
 * unverified (never verified), or current (verified and up-to-date).
 *
 * @implements {R005.§4.AC.01} `scepter claims stale` command
 * @implements {R005.§4.AC.02} Separate stale vs unverified reporting
 * @implements {R005.§4.AC.03} --importance and --note filtering
 */

import * as path from 'path';
import { Command } from 'commander';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import {
  loadVerificationStore,
  computeStaleness,
} from '../../../claims/index.js';
import type { StalenessOptions } from '../../../claims/index.js';
import { formatStalenessReport } from '../../formatters/claim-formatter.js';

export const staleCommand = new Command('stale')
  .description('Report stale and unverified claims based on source file changes')
  .option('--importance <level>', 'Filter by minimum importance level (1-5)', parseInt)
  .option('--note <noteId>', 'Scope to claims from a specific note')
  .option('--reindex', 'Force rebuild of claim index')
  .option('--json', 'Output as JSON')
  .action(async (options: { importance?: number; note?: string; reindex?: boolean; json?: boolean; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: true,
        },
        async (context) => {
          // Build the claim index
          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });

          // Load the verification store
          const config = context.projectManager.configManager.getConfig();
          const dataDir = path.join(context.projectPath, config.paths?.dataDir || '_scepter');
          const store = await loadVerificationStore(dataDir);

          // Build staleness options from CLI flags
          // @implements {R005.§4.AC.03} --importance and --note filtering
          const stalenessOptions: StalenessOptions = {};
          if (options.importance !== undefined) {
            stalenessOptions.minImportance = options.importance;
          }
          if (options.note) {
            stalenessOptions.noteId = options.note;
          }

          // Compute staleness
          const entries = await computeStaleness(data, store, stalenessOptions);

          if (options.json) {
            console.log(JSON.stringify(entries, null, 2));
            return;
          }

          console.log(formatStalenessReport(entries));
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
