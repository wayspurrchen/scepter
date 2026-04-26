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

import { Command } from 'commander';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import { buildClaimThread, buildClaimThreadsForNote } from '../../../claims/claim-thread.js';
import { parseClaimAddress } from '../../../parsers/claim/index.js';
import { resolveSingleClaim } from '../shared/resolve-claim-id.js';
import { formatClaimThread, formatClaimThreadJson, groupVerifiedEvents } from '../../formatters/claim-formatter.js';

/**
 * Detect whether the argument is a claim-level ID (contains dots with a claim prefix)
 * vs a plain note ID (just letters + digits like R004).
 *
 * Reuses the same pattern as trace-command.ts.
 */
function isClaimId(id: string): boolean {
  // A claim ID has dots and contains an uppercase claim prefix followed by a number.
  // Use a regex predicate (not parseClaimAddress) so leading-zero shortcuts like
  // `DD14.§11.OQ.01` classify correctly — the centralized `resolveSingleClaim`
  // normalizes them downstream.
  if (!id.includes('.')) return false;
  return /[A-Z]+\.\d{2,3}/.test(id.replace(/[$§]/g, ''));
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
        },
        async (context) => {
          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });

          // Load verification events from the metadata store.
          // @implements {DD014.§3.DC.54} thread-command reads via metadataStorage
          const verifiedEventList = await context.projectManager.metadataStorage!.query({ key: 'verified' });
          const verifiedEvents = groupVerifiedEvents(verifiedEventList);

          // Get derivatives lookup from claim index
          const claimIndex = context.projectManager.claimIndex;
          const getDerivatives = claimIndex.getDerivatives.bind(claimIndex);

          const threadOptions = { depth: options.depth ?? 1 };

          // @implements {DD005.§DC.25} Bare note ID threads all claims in the note
          if (isClaimId(id)) {
            // Single claim thread — uses the centralized flexible resolver
            // ($→§, zero-padding, suffix matching, fuzzy suggestions).
            const entry = resolveSingleClaim(id, data);
            if (!entry) {
              return;
            }
            const node = buildClaimThread(
              entry.fullyQualified,
              data,
              getDerivatives,
              threadOptions,
              verifiedEvents,
            );
            if (!node) {
              // Theoretically unreachable: resolver returned an entry but the thread builder didn't.
              console.log(`Claim not found: ${id}`);
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
              verifiedEvents,
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
