/**
 * @implements {R004.§6.AC.04} `scepter claims trace` shows traceability
 * @implements {R005.§1.AC.02} --importance numeric filter replaces --priority
 * @implements {R005.§1.AC.04} --sort importance option for descending importance sort
 * @implements {R005.§5.AC.03} JSON output includes importance, lifecycle, verification
 * @implements {R005.§3.AC.07} Trace shows latest verification date per claim
 * @implements {R006.§4.AC.01} Trace displays derivation links
 * @implements {R006.§4.AC.02} --show-derived expands derivative sub-rows
 * @implements {R006.§4.AC.03} Default trace shows <-SOURCE indicator
 * @implements {DD005.§DC.19} Trace accepts claim references: single, range, comma-separated
 * @implements {DD005.§DC.20} Cross-note claim traces merge projection columns
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import { buildTraceabilityMatrix } from '../../../claims/index.js';
import type { ClaimIndexData, ClaimIndexEntry, MetadataEvent, TraceabilityMatrix, TraceabilityRow, ProjectionPresence } from '../../../claims/index.js';
import { parseMetadataFilters, applyMetadataFilters, collectStrings } from '../../../claims/index.js';
import { parseClaimAddress, parseRangeSuffix, expandClaimRange } from '../../../parsers/claim/index.js';
import { resolveSingleClaim } from '../shared/resolve-claim-id.js';
import { formatTraceabilityMatrix, formatClaimTrace, groupVerifiedEvents } from '../../formatters/claim-formatter.js';
import type { TraceDisplayOptions, ClaimTraceOptions } from '../../formatters/claim-formatter.js';
import type { SourceReference } from '../../../types/reference.js';

/**
 * Detect whether the argument is a claim-level ID (contains dots with a claim prefix)
 * vs a plain note ID (just letters + digits like R004).
 */
function isClaimId(id: string): boolean {
  // A claim ID has dots and contains an uppercase claim prefix followed by a number.
  // Use a regex predicate (not parseClaimAddress) so leading-zero shortcuts like
  // `DD14.§11.OQ.01` classify correctly — the centralized `resolveSingleClaim`
  // normalizes them downstream.
  if (!id.includes('.')) return false;
  return /[A-Z]+\.\d{2,3}/.test(id.replace(/[$§]/g, ''));
}

/**
 * Detect whether the input contains comma-separated claim references.
 * @implements {DD005.§DC.19} Comma-separated claim input detection
 */
function isMultiClaimInput(id: string): boolean {
  return id.includes(',');
}

/**
 * Detect whether the input contains range syntax (e.g., AC.17-20).
 * Only returns true if the input is NOT also comma-separated (that case
 * is handled by splitting on comma first, then checking each part for ranges).
 * @implements {DD005.§DC.19} Range syntax detection
 */
function isRangeInput(id: string): boolean {
  if (id.includes(',')) return false;
  return parseRangeSuffix(id) !== null;
}

/**
 * Resolve a single claim reference string (which may be a range) into
 * an array of fully qualified claim IDs found in the index.
 *
 * Returns an array of { fqid, entry } pairs for claims that exist in the index.
 * Claims that don't resolve in the index are collected into the notFound array.
 *
 * @implements {DD005.§DC.19} Claim reference resolution (single, range)
 */
export function resolveClaimRef(
  ref: string,
  data: ClaimIndexData,
): { found: { fqid: string; entry: ClaimIndexEntry }[]; notFound: string[] } {
  const found: { fqid: string; entry: ClaimIndexEntry }[] = [];
  const notFound: string[] = [];

  // Check for range syntax first
  const rangeInfo = parseRangeSuffix(ref);
  if (rangeInfo) {
    const baseAddr = parseClaimAddress(rangeInfo.baseRef);
    if (baseAddr) {
      const expanded = expandClaimRange(baseAddr, rangeInfo.endNumber);
      for (const addr of expanded) {
        const normalized = addr.raw.replace(/§/g, '');
        const entry = data.entries.get(normalized);
        if (entry) {
          found.push({ fqid: entry.fullyQualified, entry });
        } else {
          notFound.push(addr.raw);
        }
      }
      return { found, notFound };
    }
  }

  // Single claim reference
  const normalized = ref.replace(/§/g, '');
  const entry = data.entries.get(normalized);
  if (entry) {
    found.push({ fqid: entry.fullyQualified, entry });
  } else {
    notFound.push(ref);
  }
  return { found, notFound };
}

/**
 * Build a merged traceability matrix from multiple claim entries that may
 * span different notes. Rows come from looking up each entry in the index
 * and finding incoming cross-references. Projection columns are unified
 * across all entries.
 *
 * @implements {DD005.§DC.20} Cross-note merged projection columns
 */
export function buildMergedClaimMatrix(
  entries: ClaimIndexEntry[],
  data: ClaimIndexData,
): TraceabilityMatrix {
  const projectionTypesSet = new Set<string>();
  const rows: TraceabilityRow[] = [];

  // Collect unique source note IDs for the header
  const sourceNoteIds = new Set<string>();

  for (const entry of entries) {
    sourceNoteIds.add(entry.noteId);

    // Find all cross-references pointing TO this claim
    const incomingRefs = data.crossRefs.filter(
      (ref) => ref.toClaim === entry.fullyQualified,
    );

    // Group by the note type of the referring note
    const projections = new Map<string, ProjectionPresence[]>();
    for (const crossRef of incomingRefs) {
      const fromType = data.noteTypes.get(crossRef.fromNoteId) ?? 'Unknown';
      projectionTypesSet.add(fromType);

      const presence: ProjectionPresence = {
        noteId: crossRef.fromNoteId,
        noteType: fromType,
        claimId: crossRef.fromClaim,
        line: crossRef.line,
      };

      const existing = projections.get(fromType) ?? [];
      existing.push(presence);
      projections.set(fromType, existing);
    }

    rows.push({
      claimId: entry.fullyQualified,
      claimPrefix: entry.claimPrefix,
      claimNumber: entry.claimNumber,
      ...(entry.claimSubLetter ? { claimSubLetter: entry.claimSubLetter } : {}),
      heading: entry.heading,
      sectionPath: entry.sectionPath,
      metadata: entry.metadata,
      importance: entry.importance,
      lifecycle: entry.lifecycle,
      derivedFrom: entry.derivedFrom,
      projections,
    });
  }

  const sourceNoteIdList = [...sourceNoteIds].sort();
  const sourceLabel = sourceNoteIdList.length === 1
    ? sourceNoteIdList[0]
    : sourceNoteIdList.join(', ');

  return {
    sourceNoteId: sourceLabel,
    sourceNoteType: sourceNoteIdList.length === 1
      ? (data.noteTypes.get(sourceNoteIdList[0]) ?? '')
      : '(multiple)',
    rows,
    projectionTypes: [...projectionTypesSet].sort(),
  };
}

export const traceCommand = new Command('trace')
  .description('Display traceability matrix for a note, or trace specific claims (single, range, or comma-separated)')
  .argument('<id>', 'Note ID (R004), claim ID (R004.§1.AC.01), range (R004.§1.AC.01-05), or comma-separated claims')
  .option('--importance <level>', 'Filter by minimum importance level (1-5)', parseInt)
  .option('--sort <field>', 'Sort rows by field (e.g., importance)')
  .option('--width <chars>', 'Max characters for claim title column (default: 70)', parseInt)
  .option('--full', 'Show full claim titles without truncation')
  .option('--no-excerpts', 'Hide line excerpts in single-claim trace')
  // @implements {R006.§4.AC.02} --show-derived flag
  .option('--show-derived', 'Expand derivative sub-rows under source claims')
  .option('--reindex', 'Force rebuild of claim index')
  .option('--json', 'Output as JSON')
  // @implements {DD006.§3.DC.21} Verbose flag controls note-level source ref detail
  .option('--verbose', 'Show full detail for note-level source references')
  // @implements {DD014.§3.DC.55} Metadata filters: --where, --has-key, --missing-key
  .option('--where <pair>', 'Filter to claims where KEY=VALUE in folded metadata (repeatable)', collectStrings, [])
  .option('--has-key <key>', 'Filter to claims with at least one value for KEY (repeatable)', collectStrings, [])
  .option('--missing-key <key>', 'Filter to claims with no value for KEY (repeatable)', collectStrings, [])
  .action(async (id: string, options: { importance?: number; sort?: string; width?: number; full?: boolean; excerpts?: boolean; showDerived?: boolean; reindex?: boolean; json?: boolean; verbose?: boolean; where?: string[]; hasKey?: string[]; missingKey?: string[]; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });

          // @implements {R005.§3.AC.07} Load verification events from metadata store for date display
          // @implements {DD014.§3.DC.52} trace-command reads via metadataStorage
          const verifiedEventList = await context.projectManager.metadataStorage!.query({ key: 'verified' });
          const verifiedEvents = groupVerifiedEvents(verifiedEventList);

          // Helper to get the latest `verified` event for a claim from the
          // pre-grouped map.
          const getLatestVerified = (claimId: string): MetadataEvent | undefined => {
            const events = verifiedEvents.get(claimId);
            return events && events.length > 0 ? events[events.length - 1] : undefined;
          };

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
          // @implements {DD014.§3.DC.56} Apply metadata filters to TraceabilityRow[] AND-composed with importance
          const metadataStorage = context.projectManager.metadataStorage!;
          const applyFilters = async <R extends { claimId: string }>(rows: R[]): Promise<R[]> => {
            return applyMetadataFilters(rows, (row) => row.claimId, metadataStorage, filterParse);
          };

          // @implements {R006.§4.AC.02} Get derivatives lookup from claim index
          const claimIndex = context.projectManager.claimIndex;

          // @implements {DD005.§DC.19} Multi-claim and range trace
          // @implements {DD005.§DC.20} Cross-note merged matrix
          if (isMultiClaimInput(id) || isRangeInput(id)) {
            // Split comma-separated refs and resolve each (including range expansion)
            const rawRefs = id.split(',').map((r) => r.trim()).filter((r) => r.length > 0);
            const allFound: ClaimIndexEntry[] = [];
            const allNotFound: string[] = [];

            for (const ref of rawRefs) {
              const { found, notFound } = resolveClaimRef(ref, data);
              for (const f of found) allFound.push(f.entry);
              allNotFound.push(...notFound);
            }

            if (allNotFound.length > 0) {
              console.log(`Claims not found: ${allNotFound.join(', ')}`);
            }

            if (allFound.length === 0) {
              console.log('No matching claims found in the index.');
              return;
            }

            const matrix = buildMergedClaimMatrix(allFound, data);

            // Apply importance filter
            // @implements {DD014.§3.DC.57} --importance preserved unchanged at user-facing level
            if (options.importance !== undefined) {
              matrix.rows = matrix.rows.filter((row) =>
                row.importance !== undefined && row.importance >= options.importance!,
              );
            }

            // @implements {DD014.§3.DC.56} AND-compose metadata filters with importance
            matrix.rows = await applyFilters(matrix.rows);

            // Apply sort
            if (options.sort === 'importance') {
              matrix.rows.sort((a, b) => {
                const aImp = a.importance ?? 0;
                const bImp = b.importance ?? 0;
                return bImp - aImp;
              });
            }

            if (options.json) {
              const serializable = {
                ...matrix,
                rows: matrix.rows.map((row) => {
                  const latestVerification = getLatestVerified(row.claimId);
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

            const displayOpts: TraceDisplayOptions = {
              showDerived: options.showDerived,
              getDerivatives: claimIndex.getDerivatives.bind(claimIndex),
              getClaimEntry: (fqid: string) => data.entries.get(fqid) ?? null,
              hasSourceCoverage: (claimId: string) => data.crossRefs.some(
                (ref) => ref.toClaim === claimId && data.noteTypes.get(ref.fromNoteId) === 'Source',
              ),
            };
            if (options.width !== undefined) displayOpts.titleWidth = options.width;
            if (options.full) displayOpts.full = true;
            console.log(formatTraceabilityMatrix(matrix, displayOpts, verifiedEvents));
            return;
          }

          // Single-claim trace: show all documents referencing this specific claim.
          // Uses the centralized flexible resolver ($→§, zero-padding, suffix matching).
          if (isClaimId(id)) {
            const entry = resolveSingleClaim(id, data);
            if (!entry) {
              return;
            }

            const incoming = data.crossRefs.filter((ref) => ref.toClaim === entry.fullyQualified);

            if (options.json) {
              // @implements {R005.§5.AC.03} JSON includes importance, lifecycle, verification
              // @implements {R006.§4.AC.01} JSON includes derivedFrom
              const latestVerification = getLatestVerified(entry.fullyQualified);
              const derivatives = options.showDerived
                ? claimIndex.getDerivatives(entry.fullyQualified)
                : undefined;
              console.log(JSON.stringify({
                entry,
                incoming,
                verification: latestVerification ?? undefined,
                ...(derivatives ? { derivatives } : {}),
              }, null, 2));
              return;
            }

            const traceOpts: ClaimTraceOptions = {
              showDerived: options.showDerived,
              getDerivatives: claimIndex.getDerivatives.bind(claimIndex),
              getClaimEntry: (fqid: string) => data.entries.get(fqid) ?? null,
            };
            if (options.excerpts === false) traceOpts.excerpts = false;
            console.log(await formatClaimTrace(entry, incoming, data.noteTypes, traceOpts, verifiedEvents));
            return;
          }

          // Note-level trace: show traceability matrix
          const matrix = buildTraceabilityMatrix(id, data);

          // @implements {R005.§1.AC.02} Filter rows by minimum importance level
          // @implements {DD014.§3.DC.57} --importance preserved unchanged at user-facing level
          if (options.importance !== undefined) {
            matrix.rows = matrix.rows.filter((row) =>
              row.importance !== undefined && row.importance >= options.importance!,
            );
          }

          // @implements {DD014.§3.DC.56} AND-compose metadata filters with importance
          matrix.rows = await applyFilters(matrix.rows);

          // @implements {R005.§1.AC.04} Sort rows by importance descending
          if (options.sort === 'importance') {
            matrix.rows.sort((a, b) => {
              // Claims with importance come first, sorted descending
              // Claims without importance come last
              const aImp = a.importance ?? 0;
              const bImp = b.importance ?? 0;
              return bImp - aImp;
            });
          }

          // @implements {DD006.§3.DC.19} Query bare note-level source references
          // @implements {DD006.§3.DC.22} Include sourceReferences in JSON output
          const bareRefs = getBareNoteRefs(id, context);

          if (options.json) {
            // @implements {R005.§5.AC.03} JSON includes importance, lifecycle, verification
            // @implements {DD006.§3.DC.22} JSON includes sourceReferences field
            const serializable = {
              ...matrix,
              rows: matrix.rows.map((row) => {
                const latestVerification = getLatestVerified(row.claimId);
                return {
                  ...row,
                  projections: Object.fromEntries(row.projections),
                  verification: latestVerification ?? undefined,
                };
              }),
              sourceReferences: bareRefs.map((ref) => ({
                filePath: path.relative(context.projectPath, ref.filePath),
                line: ref.line ?? 0,
                referenceType: ref.referenceType,
                context: ref.context,
              })),
            };
            console.log(JSON.stringify(serializable, null, 2));
            return;
          }

          const displayOpts: TraceDisplayOptions = {
            showDerived: options.showDerived,
            getDerivatives: claimIndex.getDerivatives.bind(claimIndex),
            getClaimEntry: (fqid: string) => data.entries.get(fqid) ?? null,
            hasSourceCoverage: (claimId: string) => data.crossRefs.some(
              (ref) => ref.toClaim === claimId && data.noteTypes.get(ref.fromNoteId) === 'Source',
            ),
          };
          if (options.width !== undefined) displayOpts.titleWidth = options.width;
          if (options.full) displayOpts.full = true;
          console.log(formatTraceabilityMatrix(matrix, displayOpts, verifiedEvents));

          // @implements {DD006.§3.DC.19} Bare note-level source references section
          // @implements {DD006.§3.DC.20} Format as "Source References (note-level)"
          // @implements {DD006.§3.DC.21} Verbose/summary threshold
          // @implements {DD006.§3.DC.23} Not shown in single-claim trace (we're in note-level branch)
          if (bareRefs.length > 0) {
            console.log(formatNoteSourceReferences(bareRefs, context.projectPath, !!options.verbose));
          }
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });

/**
 * Query the SourceCodeScanner for bare note-level references (claimPath undefined).
 *
 * @implements {DD006.§3.DC.19} Filter to refs where claimPath is undefined/empty
 */
function getBareNoteRefs(
  noteId: string,
  context: { projectManager: any; projectPath: string },
): SourceReference[] {
  const scanner = context.projectManager.sourceScanner;
  if (!scanner?.isReady()) return [];

  const allRefs: SourceReference[] = scanner.getReferencesToNote(noteId);
  return allRefs.filter((ref: SourceReference) => !ref.claimPath);
}

/**
 * Format bare note-level source references for console output.
 *
 * @implements {DD006.§3.DC.20} "Source References (note-level)" section
 * @implements {DD006.§3.DC.21} Verbose/summary threshold (>10 = summary unless verbose)
 */
function formatNoteSourceReferences(
  bareRefs: SourceReference[],
  projectPath: string,
  verbose: boolean,
): string {
  const lines: string[] = [];

  // Count unique files
  const uniqueFiles = new Set(bareRefs.map((ref) => ref.filePath));

  lines.push('');
  lines.push(chalk.bold(`Source References (note-level): ${bareRefs.length} reference${bareRefs.length !== 1 ? 's' : ''} across ${uniqueFiles.size} file${uniqueFiles.size !== 1 ? 's' : ''}`));

  const SUMMARY_THRESHOLD = 10;
  const showDetail = bareRefs.length <= SUMMARY_THRESHOLD || verbose;

  if (showDetail) {
    // Full detail: file path, line, reference type
    // Sort by file path then line number
    const sorted = [...bareRefs].sort((a, b) => {
      const pathCmp = a.filePath.localeCompare(b.filePath);
      if (pathCmp !== 0) return pathCmp;
      return (a.line ?? 0) - (b.line ?? 0);
    });

    for (const ref of sorted) {
      const relPath = path.relative(projectPath, ref.filePath);
      const lineStr = ref.line ? `:${ref.line}` : '';
      const typeStr = ref.referenceType === 'mentions' ? 'mentions' : `@${ref.referenceType}`;
      lines.push(`  ${chalk.dim(relPath + lineStr)}  ${typeStr}`);
      if (ref.context) {
        lines.push(`    ${chalk.dim(ref.context.trim())}`);
      }
    }
  } else {
    // Summary: file list with counts
    lines.push(chalk.dim('  (use --verbose to see full detail)'));
    lines.push('');

    // Count refs per file
    const fileCounts = new Map<string, number>();
    for (const ref of bareRefs) {
      const relPath = path.relative(projectPath, ref.filePath);
      fileCounts.set(relPath, (fileCounts.get(relPath) ?? 0) + 1);
    }

    const fileEntries = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);
    const fileList = fileEntries.map(([f, c]) => `${f} (${c})`).join(', ');
    lines.push(`  Files: ${fileList}`);
  }

  return lines.join('\n');
}
