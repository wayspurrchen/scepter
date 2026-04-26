/**
 * @implements {DD005.§DC.01} Trace-based partial coverage gap detection
 * @implements {DD005.§DC.02} Aggregate across all claim-defining notes
 * @implements {DD005.§DC.03} Dynamic projection type discovery
 * @implements {DD005.§DC.04} Optional projectionTypes config as filter
 * @implements {DD005.§DC.05} Trace-matrix-style output format
 * @implements {DD005.§DC.07} --note flag preserved
 * @implements {DD005.§DC.08} --importance filter preserved
 * @implements {DD005.§DC.09} --projection flag for targeted projection filtering
 * @implements {DD005.§DC.10} --include-zero flag for zero-coverage claims
 * @implements {DD005.§DC.11} --include-deferred and --include-closed preserved
 * @implements {DD005.§DC.12} --json output with trace-matrix-style data
 * @implements {DD005.§DC.13} --sort flag preserved
 * @implements {DD005.§DC.14} --show-derived flag preserved
 * @implements {R005.§1.AC.02} --importance numeric filter
 * @implements {R005.§1.AC.04} --sort importance option
 * @implements {R005.§2.AC.03} --include-deferred flag
 * @implements {R005.§2.AC.04} --include-closed flag
 * @implements {R006.§3.AC.03} --show-derived flag
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import { findPartialCoverageGaps } from '../../../claims/index.js';
import type { PartialCoverageOptions } from '../../../claims/index.js';
import { parseMetadataFilters, applyMetadataFilters, collectStrings } from '../../../claims/index.js';
import { formatTraceabilityMatrix, groupVerifiedEvents } from '../../formatters/claim-formatter.js';
import type { TraceDisplayOptions } from '../../formatters/claim-formatter.js';

export const gapsCommand = new Command('gaps')
  .description('Report claims with partial coverage across projection types')
  .option('--importance <level>', 'Filter by minimum importance level (1-5)', parseInt)
  .option('--include-deferred', 'Include deferred claims in gap analysis')
  .option('--include-closed', 'Include closed claims in gap analysis')
  .option('--sort <field>', 'Sort gaps by field (e.g., importance)')
  .option('--note <noteId>', 'Scope to a specific note')
  .option('--projection <types>', 'Filter to specific projection types (comma-separated)')
  .option('--include-zero', 'Include claims with zero coverage (no references at all)')
  // @implements {R006.§3.AC.03} --show-derived flag
  .option('--show-derived', 'Expand derivation tree for each gap')
  .option('--reindex', 'Force rebuild of claim index')
  .option('--json', 'Output as JSON')
  .option('--width <chars>', 'Max characters for claim title column (default: 70)', parseInt)
  .option('--full', 'Show full claim titles without truncation')
  // @implements {DD014.§3.DC.55} Metadata filters: --where, --has-key, --missing-key
  .option('--where <pair>', 'Filter to claims where KEY=VALUE in folded metadata (repeatable)', collectStrings, [])
  .option('--has-key <key>', 'Filter to claims with at least one value for KEY (repeatable)', collectStrings, [])
  .option('--missing-key <key>', 'Filter to claims with no value for KEY (repeatable)', collectStrings, [])
  .action(async (options: {
    importance?: number;
    sort?: string;
    includeDeferred?: boolean;
    includeClosed?: boolean;
    note?: string;
    projection?: string;
    includeZero?: boolean;
    showDerived?: boolean;
    reindex?: boolean;
    json?: boolean;
    width?: number;
    full?: boolean;
    where?: string[];
    hasKey?: string[];
    missingKey?: string[];
    projectDir?: string;
  }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });
          const config = context.projectManager.configManager.getConfig();
          const claimIndex = context.projectManager.claimIndex;

          // @implements {DD005.§DC.04} Use config projectionTypes as optional filter
          // @implements {DD005.§DC.09} --projection flag overrides config
          let projectionFilter: string[] | undefined;
          if (options.projection) {
            projectionFilter = options.projection.split(',').map(s => s.trim());
          } else if (config.claims?.projectionTypes && config.claims.projectionTypes.length > 0) {
            projectionFilter = config.claims.projectionTypes;
          }

          const gapOptions: PartialCoverageOptions = {
            noteId: options.note,
            projectionFilter,
            includeZeroCoverage: options.includeZero,
            excludeClosed: !options.includeClosed,
            excludeDeferred: !options.includeDeferred,
          };

          let matrix = findPartialCoverageGaps(data, gapOptions);

          // @implements {R005.§1.AC.02} Filter by minimum importance
          // @implements {DD014.§3.DC.57} --importance preserved unchanged at user-facing level
          if (options.importance !== undefined) {
            matrix.rows = matrix.rows.filter((row) =>
              row.importance !== undefined && row.importance >= options.importance!,
            );
          }

          // @implements {DD014.§3.DC.55} Parse and validate --where / --has-key / --missing-key
          const filterParse = parseMetadataFilters({
            where: options.where,
            hasKey: options.hasKey,
            missingKey: options.missingKey,
          });
          if (!filterParse.ok) {
            console.error(chalk.red(filterParse.error));
            process.exit(1);
          }
          // @implements {DD014.§3.DC.56} AND-compose metadata filters with the existing flag set
          matrix.rows = await applyMetadataFilters(
            matrix.rows,
            (row) => row.claimId,
            context.projectManager.metadataStorage!,
            filterParse,
          );

          // @implements {R005.§1.AC.04} Sort rows by importance descending
          if (options.sort === 'importance') {
            matrix.rows.sort((a, b) => {
              const aImp = a.importance ?? 0;
              const bImp = b.importance ?? 0;
              return bImp - aImp;
            });
          }

          // @implements {DD005.§DC.12} JSON output with trace-matrix-style data
          // @implements {DD014.§3.DC.53} gaps-command reads via metadataStorage
          if (options.json) {
            const verifiedEventList = await context.projectManager.metadataStorage!.query({ key: 'verified' });
            const verifiedEvents = groupVerifiedEvents(verifiedEventList);
            const serializable = {
              ...matrix,
              rows: matrix.rows.map((row) => {
                const events = verifiedEvents.get(row.claimId) ?? [];
                const latestVerification = events.length > 0 ? events[events.length - 1] : undefined;
                return {
                  ...row,
                  projections: Object.fromEntries(row.projections),
                  verification: latestVerification ?? undefined,
                };
              }),
            };
            console.log(JSON.stringify(serializable, null, 2));
            return;
          }

          // @implements {DD005.§DC.05} Use trace-matrix formatter in gap mode
          const displayOpts: TraceDisplayOptions = {
            gapMode: true,
            showDerived: options.showDerived,
            getDerivatives: claimIndex.getDerivatives.bind(claimIndex),
            getClaimEntry: (fqid: string) => data.entries.get(fqid) ?? null,
            hasSourceCoverage: (claimId: string) => data.crossRefs.some(
              (ref) => ref.toClaim === claimId && data.noteTypes.get(ref.fromNoteId) === 'Source',
            ),
          };
          if (options.width !== undefined) displayOpts.titleWidth = options.width;
          if (options.full) displayOpts.full = true;

          // @implements {DD014.§3.DC.53}
          const verifiedEventList = await context.projectManager.metadataStorage!.query({ key: 'verified' });
          const verifiedEvents = groupVerifiedEvents(verifiedEventList);
          console.log(formatTraceabilityMatrix(matrix, displayOpts, verifiedEvents));
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
