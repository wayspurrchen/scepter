/**
 * Verify command for SCEpter claims.
 *
 * In Phase 1 of DD014 the verify CLI is rewired as a thin alias to the
 * generalized metadata event log. Each invocation appends a single event:
 *
 *   verify CLAIM            -> append({op:"add", key:"verified", value:"true"})
 *   verify CLAIM --remove   -> append({op:"unset", key:"verified", value:""})
 *
 * The legacy `--method` flag is RENAMED to `--note`. The legacy `--all` flag
 * is REMOVED — `--remove` always wipes verification state via `unset`. The
 * asymmetric "log-level pop vs state-level wipe" distinction is gone; there
 * is only a state-level wipe.
 *
 * @implements {R005.§3.AC.03} `scepter claims verify <id>` command
 * @implements {R005.§3.AC.04} --actor option with OS username default
 * @implements {R005.§3.AC.06} Append-only verification events
 * @implements {R009.§7.AC.05} verify is a thin alias to meta writes
 * @implements {R009.§7.AC.06} note-level verify iterates claims in note
 * @implements {DD014.§3.DC.60} verify maps to add(verified=true) / unset(verified)
 * @implements {DD014.§3.DC.61} :removed lifecycle rejection preserved
 * @implements {DD014.§3.DC.62} note-level invocation iterates claims
 * @implements {DD014.§3.DC.63} --reindex flag preserved
 * @implements {DD014.§3.DC.64} no popLatestForKey carve-out; six-method MetadataStorage
 */

import * as os from 'os';
import { Command } from 'commander';
import chalk from 'chalk';
import { createId } from '@paralleldrive/cuid2';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import { resolveSingleClaim } from '../shared/resolve-claim-id.js';
import { emitClaimPreamble } from '../shared/claim-preamble.js';
import type { MetadataEvent } from '../../../claims/index.js';

/**
 * Detect whether the argument is a claim-level ID (contains dots with a claim prefix)
 * vs a plain note ID (just letters + digits like R004).
 */
function isClaimLevelId(id: string): boolean {
  return id.includes('.') && /[A-Z]+\.\d{2,3}/.test(id.replace(/§/g, ''));
}

/**
 * Get the default actor name from the OS.
 * Falls back to "cli" if the username cannot be determined.
 *
 * @implements {R005.§3.AC.04} Default actor from OS username
 */
function getDefaultActor(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'cli';
  }
}

export const verifyCommand = new Command('verify')
  .description('Record a verification event for a claim or all claims in a note')
  .argument('<id>', 'Claim ID (e.g., R004.§1.AC.03) or note ID (e.g., R004)')
  .option('--actor <name>', 'Name of the verifying actor')
  .option('--note <text>', 'Free-form note recorded with the event (replaces legacy --method)')
  .option('--remove', 'Wipe verification state for this claim (appends an unset event)')
  .option('--reindex', 'Force rebuild of claim index')
  .action(async (id: string, options: { actor?: string; note?: string; remove?: boolean; reindex?: boolean; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const actor = options.actor ?? getDefaultActor();
          const date = new Date().toISOString();

          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });

          const claimsToVerify: string[] = [];

          if (isClaimLevelId(id)) {
            // Single claim verification — uses the centralized flexible resolver
            // ($→§, zero-padding, suffix matching, fuzzy suggestions).
            const entry = resolveSingleClaim(id, data);
            if (!entry) {
              return;
            }

            await emitClaimPreamble(entry, context.projectManager.noteManager!);

            // @implements {DD014.§3.DC.61} Reject :removed claims
            if (entry.lifecycle?.type === 'removed') {
              console.log(chalk.red(`Cannot verify claim "${id}": claim is tagged :removed.`));
              return;
            }

            claimsToVerify.push(entry.fullyQualified);
          } else {
            // @implements {DD014.§3.DC.62} Note-level: iterate claims in the note
            const noteClaims = [...data.entries.values()].filter(
              (entry) => entry.noteId === id,
            );

            if (noteClaims.length === 0) {
              console.log(chalk.red(`No claims found for note: ${id}`));
              return;
            }

            const verifiable = noteClaims.filter(
              (entry) => entry.lifecycle?.type !== 'removed',
            );

            const removedCount = noteClaims.length - verifiable.length;
            if (removedCount > 0) {
              console.log(chalk.yellow(`Skipping ${removedCount} :removed claim(s).`));
            }

            for (const entry of verifiable) {
              claimsToVerify.push(entry.fullyQualified);
            }
          }

          if (claimsToVerify.length === 0) {
            console.log(chalk.yellow('No claims to verify.'));
            return;
          }

          const metadataStorage = context.projectManager.metadataStorage!;

          // @implements {DD014.§3.DC.60} --remove appends an unset event (state-level wipe)
          if (options.remove) {
            for (const claimId of claimsToVerify) {
              const event: MetadataEvent = {
                id: createId(),
                claimId,
                key: 'verified',
                value: '',
                op: 'unset',
                actor,
                date,
              };
              if (options.note) event.note = options.note;
              await metadataStorage.append(event);
              console.log(`${chalk.cyan(claimId)}: verification cleared`);
            }
            return;
          }

          // @implements {DD014.§3.DC.60} verify CLAIM appends add(verified=true)
          for (const claimId of claimsToVerify) {
            const event: MetadataEvent = {
              id: createId(),
              claimId,
              key: 'verified',
              value: 'true',
              op: 'add',
              actor,
              date,
            };
            if (options.note) event.note = options.note;
            await metadataStorage.append(event);
          }

          console.log(chalk.green(`Verified ${claimsToVerify.length} claim(s):`));
          for (const claimId of claimsToVerify) {
            console.log(`  ${chalk.cyan(claimId)}`);
          }
          console.log('');
          console.log(chalk.gray(`Actor: ${actor}`));
          if (options.note) {
            console.log(chalk.gray(`Note: ${options.note}`));
          }
          console.log(chalk.gray(`Date: ${date}`));
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
