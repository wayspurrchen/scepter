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
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import {
  loadVerificationStore,
  saveVerificationStore,
  addVerificationEvent,
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
  .action(async (id: string, options: { actor?: string; method?: string; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: true,
        },
        async (context) => {
          const config = context.projectManager.configManager.getConfig();
          const dataDir = path.join(context.projectPath, config.paths?.dataDir || '_scepter');
          const actor = options.actor ?? getDefaultActor();
          const date = new Date().toISOString().split('T')[0];

          // Build index to validate claim IDs and get claim entries
          const data = await ensureIndex(context.projectManager);

          // Load existing verification store
          const store = await loadVerificationStore(dataDir);

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
          await saveVerificationStore(dataDir, store);

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
