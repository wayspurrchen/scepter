/**
 * CLI command: `scepter claims thread`
 *
 * Produces a tree view showing all relationships for a given claim,
 * following derivation chains, source implementations, test validations,
 * note references, and verification events.
 *
 * @implements {DD005.§DC.21} `scepter claims thread <claimRef>` tree view
 * @implements {DD005.§DC.22} Default depth 1, --depth N for deeper traversal
 * @implements {DD005.§DC.23} Tree output format with indentation
 * @implements {DD005.§DC.24} --json for machine-readable output
 * @implements {DD005.§DC.25} Accept bare note ID for all claims in that note
 */

import * as path from 'path';
import { Command } from 'commander';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import { buildClaimThread, buildClaimThreadsForNote } from '../../../claims/claim-thread.js';
import { loadVerificationStore } from '../../../claims/index.js';
import type { VerificationStore } from '../../../claims/index.js';
import { parseClaimAddress } from '../../../parsers/claim/index.js';
import { formatClaimThread, formatClaimThreadJson } from '../../formatters/claim-formatter.js';

/**
 * Detect whether the argument is a claim-level ID (contains dots with a claim prefix)
 * vs a plain note ID (just letters + digits like R004).
 *
 * Reuses the same pattern as trace-command.ts.
 */
function isClaimId(id: string): boolean {
  if (!id.includes('.')) return false;
  const addr = parseClaimAddress(id);
  return addr !== null && addr.claimPrefix !== undefined;
}

// @implements {DD005.§DC.22} Default depth 1, --depth N flag
export const threadCommand = new Command('thread')
  .description('Show a tree view of all relationships for a claim or note')
  .argument('<id>', 'Claim ID (e.g., R004.§1.AC.01) or note ID (e.g., R004)')
  .option('--depth <n>', 'Maximum depth to traverse (default: 1)', parseInt)
  .option('--reindex', 'Force rebuild of claim index')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options: { depth?: number; reindex?: boolean; json?: boolean; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: true,
        },
        async (context) => {
          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });

          // Load verification store for verified events
          const config = context.projectManager.configManager.getConfig();
          const dataDir = path.join(context.projectPath, config.paths?.dataDir || '_scepter');
          const verificationStore: VerificationStore = await loadVerificationStore(dataDir);

          // Get derivatives lookup from claim index
          const claimIndex = context.projectManager.claimIndex;
          const getDerivatives = claimIndex.getDerivatives.bind(claimIndex);

          const threadOptions = { depth: options.depth ?? 1 };

          // @implements {DD005.§DC.25} Bare note ID threads all claims in the note
          if (isClaimId(id)) {
            // Single claim thread
            const normalized = id.replace(/§/g, '');
            const node = buildClaimThread(
              normalized,
              data,
              getDerivatives,
              threadOptions,
              verificationStore,
            );

            if (!node) {
              console.log(`Claim not found: ${id}`);
              console.log('');
              // Try fuzzy match
              const suffix = `.${normalized.split('.').slice(1).join('.')}`;
              const candidates = [...data.entries.keys()].filter((k) => k.endsWith(suffix));
              if (candidates.length > 0) {
                console.log('Did you mean:');
                for (const c of candidates.slice(0, 5)) {
                  console.log(`  ${c}`);
                }
              }
              return;
            }

            if (options.json) {
              console.log(formatClaimThreadJson([node]));
            } else {
              console.log(formatClaimThread([node]));
            }
          } else {
            // Note-level: thread all claims in the note
            const noteType = data.noteTypes.get(id);
            if (!noteType) {
              console.log(`Note not found: ${id}`);
              return;
            }

            const nodes = buildClaimThreadsForNote(
              id,
              data,
              getDerivatives,
              threadOptions,
              verificationStore,
            );

            if (nodes.length === 0) {
              console.log(`No claims found in note ${id}.`);
              return;
            }

            if (options.json) {
              console.log(formatClaimThreadJson(nodes));
            } else {
              console.log(formatClaimThread(nodes));
            }
          }
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
