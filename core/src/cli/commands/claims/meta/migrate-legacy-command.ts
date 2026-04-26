/**
 * One-shot migration command for legacy verification.json data.
 *
 * Reads a legacy-shape `_scepter/verification.json` (events lacking the
 * `op` field) and rewrites it as a `MetadataStore` of the new shape.
 *
 * Each legacy event projects to one `MetadataEvent` with:
 *   - `op` = "add"
 *   - `key` = "verified"
 *   - `value` = "true"
 *   - `id` = freshly-generated cuid2
 *   - `claimId`, `actor`: verbatim
 *   - `date`: legacy `date`, or normalized `timestamp` (start-of-day UTC if
 *     the legacy value is a date-only `YYYY-MM-DD` string)
 *   - `note`: legacy `method` if present, prefixed with "method=" to align
 *     with the new `verify --note` convention
 *
 * The command is idempotent on already-migrated and missing-file inputs and
 * refuses mixed-shape inputs.
 *
 * @implements {R009.§7.AC.01} Legacy data migrates to new shape
 * @implements {DD014.§3.DC.19} One-shot meta migrate-legacy command
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { createId } from '@paralleldrive/cuid2';
import { BaseCommand } from '../../base-command.js';
import type { MetadataEvent } from '../../../../claims/metadata-event.js';

const STORE_FILENAME = 'verification.json';

export interface LegacyVerificationEvent {
  claimId?: string;
  date?: string;
  timestamp?: string;
  actor?: string;
  method?: string;
}

type RawEvent = LegacyVerificationEvent | (Partial<MetadataEvent> & { op?: string });

export function isLegacyEvent(event: RawEvent): boolean {
  return typeof event === 'object' && event !== null && !('op' in event);
}

export function isNewEvent(event: RawEvent): boolean {
  return typeof event === 'object' && event !== null && 'op' in event;
}

/**
 * Normalize a legacy `timestamp` or `date` string to a full ISO 8601 datetime.
 * Date-only `YYYY-MM-DD` becomes start-of-day UTC.
 */
export function normalizeLegacyDate(legacy: LegacyVerificationEvent): string {
  const raw = legacy.date ?? legacy.timestamp ?? '';
  if (!raw) return new Date(0).toISOString();
  // Match exact YYYY-MM-DD (date-only) and pad to start-of-day UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T00:00:00.000Z`;
  }
  return raw;
}

export function projectLegacyEvent(
  claimId: string,
  legacy: LegacyVerificationEvent,
): MetadataEvent {
  const event: MetadataEvent = {
    id: createId(),
    claimId: legacy.claimId ?? claimId,
    key: 'verified',
    value: 'true',
    op: 'add',
    actor: legacy.actor ?? '',
    date: normalizeLegacyDate(legacy),
  };
  if (legacy.method) {
    event.note = `method=${legacy.method}`;
  }
  return event;
}

/**
 * Pure migration: parse a legacy-shape JSON document and produce the new
 * shape. Returns a discriminated result indicating what action the caller
 * should take.
 */
export type MigrationOutcome =
  | { kind: 'empty' }
  | { kind: 'already-migrated'; eventCount: number }
  | { kind: 'mixed'; legacyCount: number; newCount: number }
  | { kind: 'invalid-claim-shape'; claimId: string }
  | { kind: 'migrated'; store: import('../../../../claims/metadata-event.js').MetadataStore; legacyCount: number };

export function classifyAndMigrate(parsed: Record<string, unknown>): MigrationOutcome {
  let legacyCount = 0;
  let newCount = 0;
  for (const [claimId, eventsRaw] of Object.entries(parsed)) {
    if (!Array.isArray(eventsRaw)) {
      return { kind: 'invalid-claim-shape', claimId };
    }
    for (const event of eventsRaw as RawEvent[]) {
      if (isLegacyEvent(event)) legacyCount += 1;
      else if (isNewEvent(event)) newCount += 1;
    }
  }
  if (legacyCount === 0 && newCount === 0) {
    return { kind: 'empty' };
  }
  if (legacyCount > 0 && newCount > 0) {
    return { kind: 'mixed', legacyCount, newCount };
  }
  if (legacyCount === 0) {
    return { kind: 'already-migrated', eventCount: newCount };
  }
  const store: import('../../../../claims/metadata-event.js').MetadataStore = {};
  for (const [claimId, eventsRaw] of Object.entries(parsed)) {
    const events = eventsRaw as LegacyVerificationEvent[];
    store[claimId] = events.map((legacy) => projectLegacyEvent(claimId, legacy));
  }
  return { kind: 'migrated', store, legacyCount };
}

export const migrateLegacyCommand = new Command('migrate-legacy')
  .description('Migrate the legacy verification.json shape to the new metadata event log')
  .action(async (options: { projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
        },
        async (context) => {
          const config = context.projectManager.configManager.getConfig();
          const dataDir = path.join(
            context.projectManager.projectPath,
            config.paths?.dataDir || '_scepter',
          );
          const filePath = path.join(dataDir, STORE_FILENAME);

          let raw: string;
          try {
            raw = await fs.readFile(filePath, 'utf-8');
          } catch (err) {
            if (isNodeError(err) && err.code === 'ENOENT') {
              console.log(
                chalk.gray(`No legacy verification.json found at ${filePath}; nothing to migrate.`),
              );
              return;
            }
            throw err;
          }

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch (err) {
            console.error(
              chalk.red(`Failed to parse ${filePath}: ${err instanceof Error ? err.message : err}`),
            );
            process.exit(1);
          }

          const outcome = classifyAndMigrate(parsed);
          switch (outcome.kind) {
            case 'invalid-claim-shape':
              console.error(
                chalk.red(
                  `Invalid verification.json: per-claim entries must be arrays (offender: ${outcome.claimId}).`,
                ),
              );
              process.exit(1);
            // eslint-disable-next-line no-fallthrough
            case 'empty':
              console.log(chalk.gray(`verification.json is empty; nothing to migrate.`));
              return;
            case 'mixed':
              console.error(
                chalk.red(
                  `Refusing to migrate ${filePath}: file contains ${outcome.legacyCount} legacy event(s) ` +
                    `and ${outcome.newCount} new event(s). Mixed-shape state is not expected. ` +
                    `Inspect the file manually and resolve before retrying.`,
                ),
              );
              process.exit(1);
            // eslint-disable-next-line no-fallthrough
            case 'already-migrated':
              console.log(
                chalk.gray(
                  `verification.json already migrated (${outcome.eventCount} event(s)); nothing to do.`,
                ),
              );
              return;
            case 'migrated':
              await fs.writeFile(
                filePath,
                JSON.stringify(outcome.store, null, 2) + '\n',
                'utf-8',
              );
              console.log(
                chalk.green(
                  `Migrated ${outcome.legacyCount} legacy event(s) across ${Object.keys(outcome.store).length} claim(s).`,
                ),
              );
              console.log(chalk.gray(`Wrote ${filePath}`));
              return;
          }
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
