/**
 * Verify command for SCEpter claims.
 *
 * Records verification events for individual claims or all claims in a note.
 * Verification events are stored in the verification store (_scepter/verification.json).
 *
 * @implements {R005.§3.AC.03} `scepter claims verify <id>` command
 * @implements {R005.§3.AC.04} --actor option with OS username default
 * @implements {R005.§3.AC.05} --method option for verification method
 * @implements {R005.§3.AC.06} Append-only verification events
 */

import * as os from 'os';
import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import {
  addVerificationEvent,
  removeLatestVerification,
  removeAllVerifications,
} from '../../../claims/index.js';
import type { VerificationEvent } from '../../../claims/index.js';

/**
 * Detect whether the argument is a claim-level ID (contains dots with a claim prefix)
 * vs a plain note ID (just letters + digits like R004).
 */
function isClaimLevelId(id: string): boolean {
  // A claim-level ID has dots and contains a prefix.number pattern
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
  .option('--method <method>', 'Verification method (e.g., code-review, test)')
  .option('--remove', 'Remove verification events instead of adding')
  .option('--all', 'With --remove: clear all verification history (requires claim ID, not note ID)')
  .option('--reindex', 'Force rebuild of claim index')
  .action(async (id: string, options: { actor?: string; method?: string; remove?: boolean; all?: boolean; reindex?: boolean; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: true,
        },
        async (context) => {
          const actor = options.actor ?? getDefaultActor();
          const date = new Date().toISOString().split('T')[0];

          // Build index to validate claim IDs and get claim entries
          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });

          // Load existing verification store
          const store = await context.projectManager.verificationStorage!.load();

          const claimsToVerify: string[] = [];

          if (isClaimLevelId(id)) {
            // Single claim verification
            // Normalize: strip § for index lookup
            const normalized = id.replace(/§/g, '');
            const entry = data.entries.get(normalized);

            if (!entry) {
              console.log(chalk.red(`Claim not found: ${id}`));
              // Try fuzzy match
              const suffix = `.${normalized.split('.').slice(1).join('.')}`;
              const candidates = [...data.entries.keys()].filter((k) => k.endsWith(suffix));
              if (candidates.length > 0) {
                console.log('');
                console.log('Did you mean:');
                for (const c of candidates.slice(0, 5)) {
                  console.log(`  ${c}`);
                }
              }
              return;
            }

            // @implements {R005.§3.AC.03} Reject verification of :removed claims
            if (entry.lifecycle?.type === 'removed') {
              console.log(chalk.red(`Cannot verify claim "${id}": claim is tagged :removed.`));
              return;
            }

            claimsToVerify.push(entry.fullyQualified);
          } else {
            // Note-level verification: verify all claims in the note
            const noteClaims = [...data.entries.values()].filter(
              (entry) => entry.noteId === id,
            );

            if (noteClaims.length === 0) {
              console.log(chalk.red(`No claims found for note: ${id}`));
              return;
            }

            // Filter out removed claims
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

          // @implements {DD007.§1.DC.03} --remove flag: remove instead of add
          // @implements {DD007.§1.DC.04} --remove without --all: pop latest event
          // @implements {DD007.§1.DC.05} --remove --all: clear full history
          // @implements {DD007.§1.DC.06} --remove --all with note ID is rejected
          if (options.remove) {
            if (options.all && !isClaimLevelId(id)) {
              console.log(chalk.red('--remove --all requires a specific claim ID, not a note ID.'));
              console.log(chalk.gray('Use --remove without --all to remove the latest event from each claim.'));
              return;
            }

            if (options.all) {
              // Clear full history for each claim
              for (const claimId of claimsToVerify) {
                const count = removeAllVerifications(store, claimId);
                if (count > 0) {
                  console.log(`${chalk.cyan(claimId)}: removed ${chalk.yellow(String(count))} verification event(s)`);
                } else {
                  console.log(`${chalk.cyan(claimId)}: no verification history`);
                }
              }
            } else {
              // Remove latest event for each claim
              for (const claimId of claimsToVerify) {
                const removed = removeLatestVerification(store, claimId);
                if (removed) {
                  const parts = [removed.date];
                  if (removed.actor) parts.push(`by ${removed.actor}`);
                  if (removed.method) parts.push(`(${removed.method})`);
                  console.log(`${chalk.cyan(claimId)}: removed ${chalk.yellow(parts.join(' '))}`);
                } else {
                  console.log(`${chalk.cyan(claimId)}: no verification history`);
                }
              }
            }

            await context.projectManager.verificationStorage!.save(store);
            return;
          }

          // @implements {R005.§3.AC.06} Append verification events
          for (const claimId of claimsToVerify) {
            const event: VerificationEvent = {
              claimId,
              date,
              actor,
            };
            if (options.method) {
              event.method = options.method;
            }
            addVerificationEvent(store, event);
          }

          // Save updated store
          await context.projectManager.verificationStorage!.save(store);

          console.log(chalk.green(`Verified ${claimsToVerify.length} claim(s):`));
          for (const claimId of claimsToVerify) {
            console.log(`  ${chalk.cyan(claimId)}`);
          }
          console.log('');
          console.log(chalk.gray(`Actor: ${actor}`));
          if (options.method) {
            console.log(chalk.gray(`Method: ${options.method}`));
          }
          console.log(chalk.gray(`Date: ${date}`));
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
