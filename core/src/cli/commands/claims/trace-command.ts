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

import * as path from 'path';
import { Command } from 'commander';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import { buildTraceabilityMatrix, loadVerificationStore, getLatestVerification } from '../../../claims/index.js';
import type { ClaimIndexData, ClaimIndexEntry, VerificationStore, TraceabilityMatrix, TraceabilityRow, ProjectionPresence } from '../../../claims/index.js';
import { parseClaimAddress, parseRangeSuffix, expandClaimRange } from '../../../parsers/claim/index.js';
import { formatTraceabilityMatrix, formatClaimTrace } from '../../formatters/claim-formatter.js';
import type { TraceDisplayOptions, ClaimTraceOptions } from '../../formatters/claim-formatter.js';

/**
 * Detect whether the argument is a claim-level ID (contains dots with a claim prefix)
 * vs a plain note ID (just letters + digits like R004).
 */
function isClaimId(id: string): boolean {
  // A claim ID has dots and resolves to something with a claim prefix
  if (!id.includes('.')) return false;
  const addr = parseClaimAddress(id);
  return addr !== null && addr.claimPrefix !== undefined;
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
  .option('--json', 'Output as JSON')
  .action(async (id: string, options: { importance?: number; sort?: string; width?: number; full?: boolean; excerpts?: boolean; showDerived?: boolean; json?: boolean; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: true,
        },
        async (context) => {
          const data = await ensureIndex(context.projectManager);

          // @implements {R005.§3.AC.07} Load verification store for date display
          const config = context.projectManager.configManager.getConfig();
          const dataDir = path.join(context.projectPath, config.paths?.dataDir || '_scepter');
          const verificationStore: VerificationStore = await loadVerificationStore(dataDir);

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
            if (options.importance !== undefined) {
              matrix.rows = matrix.rows.filter((row) =>
                row.importance !== undefined && row.importance >= options.importance!,
              );
            }

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
                  const latestVerification = getLatestVerification(verificationStore, row.claimId);
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
            console.log(formatTraceabilityMatrix(matrix, displayOpts, verificationStore));
            return;
          }

          // Single-claim trace: show all documents referencing this specific claim
          if (isClaimId(id)) {
            // Normalize: strip § for index lookup
            const normalized = id.replace(/§/g, '');
            const entry = data.entries.get(normalized);

            if (!entry) {
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

            const incoming = data.crossRefs.filter((ref) => ref.toClaim === entry.fullyQualified);

            if (options.json) {
              // @implements {R005.§5.AC.03} JSON includes importance, lifecycle, verification
              // @implements {R006.§4.AC.01} JSON includes derivedFrom
              const latestVerification = getLatestVerification(verificationStore, entry.fullyQualified);
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
            console.log(await formatClaimTrace(entry, incoming, data.noteTypes, traceOpts, verificationStore));
            return;
          }

          // Note-level trace: show traceability matrix
          const matrix = buildTraceabilityMatrix(id, data);

          // @implements {R005.§1.AC.02} Filter rows by minimum importance level
          if (options.importance !== undefined) {
            matrix.rows = matrix.rows.filter((row) =>
              row.importance !== undefined && row.importance >= options.importance!,
            );
          }

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

          if (options.json) {
            // @implements {R005.§5.AC.03} JSON includes importance, lifecycle, verification
            const serializable = {
              ...matrix,
              rows: matrix.rows.map((row) => {
                const latestVerification = getLatestVerification(verificationStore, row.claimId);
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
          console.log(formatTraceabilityMatrix(matrix, displayOpts, verificationStore));
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
