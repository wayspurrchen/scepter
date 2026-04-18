/**
 * @implements {R004.§6.AC.02} `scepter claims lint` validates claim structure
 * @implements {R005.§2.AC.05} Lint warns when removed claims have incoming refs
 * @implements {R005.§2.AC.06} Lint validates supersession target resolves in index
 * @implements {R005.§2.AC.07} Lint errors on multiple lifecycle tags per claim
 * @implements {R005.§5.AC.02} Lint validates lifecycle syntax
 * @implements {R006.§5.AC.01} Lint validates derivation target resolution
 * @implements {R006.§5.AC.02} Lint warns on deep derivation chains
 * @implements {R006.§5.AC.03} Lint warns on partial derivation coverage
 * @implements {R008.§2.AC.02} Linter uses aggregated content for folder notes
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import { buildClaimTree, validateClaimTree } from '../../../parsers/claim/index.js';
import type { ClaimTreeError } from '../../../parsers/claim/index.js';
import { isLifecycleTag, isDerivationTag } from '../../../claims/index.js';
import type { ClaimIndex } from '../../../claims/index.js';
import { formatLintResults, formatClaimTree as formatClaimTreeDisplay } from '../../formatters/claim-formatter.js';

export const lintCommand = new Command('lint')
  .description('Validate claim structure in a note')
  .argument('<noteId>', 'Note ID to lint (e.g., R004)')
  .option('--reindex', 'Force rebuild of claim index')
  .option('--json', 'Output as JSON')
  .action(async (noteId: string, options: { reindex?: boolean; json?: boolean; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const noteManager = context.projectManager.noteManager;
          if (!noteManager) {
            throw new Error('Note manager not initialized');
          }

          // Read note content — use aggregated contents so that folder notes
          // have claims from companion sub-files included.
          const content = await noteManager.noteFileManager.getAggregatedContents(noteId);
          if (content === null) {
            throw new Error(`Note not found: ${noteId}`);
          }

          // Build and validate claim tree for this note
          const treeResult = buildClaimTree(content);
          const treeErrors = validateClaimTree(treeResult);

          // Also build the full index to check for cross-reference errors
          const indexData = await ensureIndex(context.projectManager, { reindex: options.reindex });

          // Collect index-level errors that pertain to this note
          const indexErrors = indexData.errors.filter((e) => {
            // Errors whose claimId starts with the noteId
            return e.claimId.startsWith(noteId + '.') || e.message.includes(`note ${noteId}`);
          });

          // @implements {R005.§2.AC.07} Validate multiple lifecycle tags on same claim
          // @implements {R005.§2.AC.06} Validate supersession target resolves in index
          // @implements {R005.§2.AC.05} Warn when removed claims have incoming cross-references
          const lifecycleErrors = validateLifecycleTags(noteId, indexData);

          // @implements {R006.§5.AC.01} Validate derivation links
          // @implements {R006.§5.AC.02} Detect deep derivation chains
          // @implements {R006.§5.AC.03} Detect partial derivation coverage
          const claimIndex = context.projectManager.claimIndex;
          const derivationErrors = validateDerivationLinks(noteId, indexData, claimIndex);

          // Merge errors, deduplicating by line + type
          const allErrors = [...treeErrors];
          const seen = new Set(treeErrors.map((e) => `${e.line}:${e.type}`));
          for (const err of indexErrors) {
            const key = `${err.line}:${err.type}`;
            if (!seen.has(key)) {
              allErrors.push(err);
              seen.add(key);
            }
          }
          for (const err of lifecycleErrors) {
            const key = `${err.line}:${err.type}`;
            if (!seen.has(key)) {
              allErrors.push(err);
              seen.add(key);
            }
          }
          for (const err of derivationErrors) {
            const key = `${err.line}:${err.type}`;
            if (!seen.has(key)) {
              allErrors.push(err);
              seen.add(key);
            }
          }

          if (options.json) {
            console.log(JSON.stringify({ noteId, errors: allErrors, tree: treeResult.roots }, null, 2));
            return;
          }

          console.log(chalk.bold(`Lint results for ${chalk.cyan(noteId)}`));
          console.log('');

          // Show claim tree
          if (treeResult.roots.length > 0) {
            console.log(chalk.bold('Claim structure:'));
            console.log(formatClaimTreeDisplay(treeResult.roots));
            console.log('');
          } else {
            console.log(chalk.yellow('No claims found in this note.'));
            console.log('');
          }

          // Show errors
          console.log(formatLintResults(allErrors));
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });

/**
 * Validate lifecycle tags on claims in a note.
 *
 * Checks:
 * - Multiple lifecycle tags on the same claim (error)
 * - Supersession target that doesn't resolve in the index (error)
 * - Removed claims that have incoming cross-references (warning)
 *
 * @implements {R005.§2.AC.05} reference-to-removed detection
 * @implements {R005.§2.AC.06} invalid-supersession-target detection
 * @implements {R005.§2.AC.07} multiple-lifecycle detection
 */
function validateLifecycleTags(
  noteId: string,
  indexData: import('../../../claims/index.js').ClaimIndexData,
): ClaimTreeError[] {
  const errors: ClaimTreeError[] = [];

  for (const [fullyQualified, entry] of indexData.entries) {
    if (entry.noteId !== noteId) continue;

    // Check for multiple lifecycle tags in raw metadata
    const lifecycleTags = entry.metadata.filter((m) => isLifecycleTag(m));
    if (lifecycleTags.length > 1) {
      errors.push({
        type: 'multiple-lifecycle',
        claimId: fullyQualified,
        line: entry.line,
        message: `Claim "${fullyQualified}" has multiple lifecycle tags: ${lifecycleTags.join(', ')}. Only one lifecycle tag per claim is allowed.`,
      });
    }

    // Check supersession target resolves
    if (entry.lifecycle?.type === 'superseded' && entry.lifecycle.target) {
      // Normalize target: strip § for index lookup
      const normalizedTarget = entry.lifecycle.target.replace(/§/g, '');
      if (!indexData.entries.has(normalizedTarget)) {
        errors.push({
          type: 'invalid-supersession-target',
          claimId: fullyQualified,
          line: entry.line,
          message: `Claim "${fullyQualified}" is superseded by "${entry.lifecycle.target}" but that target does not exist in the index.`,
        });
      }
    }

    // Check removed claims for incoming cross-references
    if (entry.lifecycle?.type === 'removed') {
      const incomingRefs = indexData.crossRefs.filter(
        (ref) => ref.toClaim === fullyQualified,
      );
      if (incomingRefs.length > 0) {
        const refSources = incomingRefs.map((r) => r.fromNoteId).join(', ');
        errors.push({
          type: 'reference-to-removed',
          claimId: fullyQualified,
          line: entry.line,
          message: `Claim "${fullyQualified}" is tagged :removed but is still referenced by: ${refSources}.`,
        });
      }
    }
  }

  return errors;
}

/**
 * Validate derivation links on claims in a note.
 *
 * Checks:
 * 1. invalid-derivation-target — derives=TARGET doesn't resolve (error)
 * 2. deep-derivation-chain — chain > 2 hops (warning)
 * 3. partial-derivation-coverage — source has derivatives but not all have Source coverage (warning)
 * 4. circular-derivation — cycle in derivation chain (error)
 * 5. self-derivation — derives from self (error)
 * 6. derives-superseded-conflict — both derives and superseded on same claim (error)
 * 7. derivation-from-removed — derives from a :removed claim (warning)
 * 8. derivation-from-superseded — derives from a :superseded claim (warning)
 *
 * @implements {R006.§5.AC.01} invalid-derivation-target detection
 * @implements {R006.§5.AC.02} deep-derivation-chain and circular-derivation detection
 * @implements {R006.§5.AC.03} partial-derivation-coverage detection
 */
/** @internal Exported for testing */
export function validateDerivationLinks(
  noteId: string,
  indexData: import('../../../claims/index.js').ClaimIndexData,
  claimIndex: ClaimIndex,
): ClaimTreeError[] {
  const errors: ClaimTreeError[] = [];

  for (const [fullyQualified, entry] of indexData.entries) {
    if (entry.noteId !== noteId) continue;

    // Check 6: derives-superseded-conflict
    const hasDerivation = entry.derivedFrom.length > 0;
    const hasSupersession = entry.lifecycle?.type === 'superseded';
    if (hasDerivation && hasSupersession) {
      errors.push({
        type: 'derives-superseded-conflict',
        claimId: fullyQualified,
        line: entry.line,
        message: `Claim "${fullyQualified}" has both derives= and superseded= metadata. These are mutually exclusive.`,
      });
    }

    // Check derivation-specific issues for claims with derives=
    if (hasDerivation) {
      for (const sourceFqid of entry.derivedFrom) {
        // Check 5: self-derivation
        if (sourceFqid === fullyQualified) {
          errors.push({
            type: 'self-derivation',
            claimId: fullyQualified,
            line: entry.line,
            message: `Claim "${fullyQualified}" derives from itself.`,
          });
          continue;
        }

        // Check 1: invalid-derivation-target (resolved derivedFrom should exist)
        const sourceEntry = indexData.entries.get(sourceFqid);
        if (!sourceEntry) {
          errors.push({
            type: 'invalid-derivation-target',
            claimId: fullyQualified,
            line: entry.line,
            message: `Claim "${fullyQualified}" declares derives=${sourceFqid} but that target does not exist in the index.`,
          });
          continue;
        }

        // Check 7: derivation-from-removed
        if (sourceEntry.lifecycle?.type === 'removed') {
          errors.push({
            type: 'derivation-from-removed',
            claimId: fullyQualified,
            line: entry.line,
            message: `Claim "${fullyQualified}" derives from "${sourceFqid}" which is tagged :removed.`,
          });
        }

        // Check 8: derivation-from-superseded
        if (sourceEntry.lifecycle?.type === 'superseded') {
          errors.push({
            type: 'derivation-from-superseded',
            claimId: fullyQualified,
            line: entry.line,
            message: `Claim "${fullyQualified}" derives from "${sourceFqid}" which is tagged :superseded. Consider re-deriving from the replacement.`,
          });
        }
      }

      // Check 2 + 4: deep-derivation-chain and circular-derivation
      // Walk the derivation chain from this claim upward
      const visited = new Set<string>();
      let current = fullyQualified;
      let depth = 0;

      while (true) {
        if (visited.has(current)) {
          // Check 4: circular-derivation
          errors.push({
            type: 'circular-derivation',
            claimId: fullyQualified,
            line: entry.line,
            message: `Claim "${fullyQualified}" is part of a circular derivation chain involving "${current}".`,
          });
          break;
        }
        visited.add(current);

        const currentDerivedFrom = claimIndex.getDerivedFrom(current);
        if (currentDerivedFrom.length === 0) break;

        // Follow the first derivation source for chain depth counting
        current = currentDerivedFrom[0];
        depth++;

        if (depth > 2) {
          // Check 2: deep-derivation-chain (> 2 hops)
          errors.push({
            type: 'deep-derivation-chain',
            claimId: fullyQualified,
            line: entry.line,
            message: `Claim "${fullyQualified}" is part of a derivation chain deeper than 2 hops.`,
          });
          break;
        }
      }
    }

    // Check 3: partial-derivation-coverage
    // For source claims in THIS note that have derivatives, check if all derivatives
    // have Source coverage
    const derivatives = claimIndex.getDerivatives(fullyQualified);
    if (derivatives.length > 0) {
      let covered = 0;
      const uncovered: string[] = [];

      for (const derivFqid of derivatives) {
        const hasSource = indexData.crossRefs.some(
          (ref) =>
            ref.toClaim === derivFqid &&
            indexData.noteTypes.get(ref.fromNoteId) === 'Source',
        );
        if (hasSource) {
          covered++;
        } else {
          uncovered.push(derivFqid);
        }
      }

      if (uncovered.length > 0 && covered > 0) {
        errors.push({
          type: 'partial-derivation-coverage',
          claimId: fullyQualified,
          line: entry.line,
          message: `Claim "${fullyQualified}" has ${derivatives.length} derivatives but only ${covered} have Source coverage. Missing: ${uncovered.join(', ')}.`,
        });
      }
    }
  }

  return errors;
}
