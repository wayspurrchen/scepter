/**
 * `scepter dependents <claim>` — list every claim and reference that depends
 * on a given claim. Output mirrors `scepter trace` structurally per OQ.04
 * default lean: target header + per-kind sections (derivatives, supersessions,
 * inline references) + cross-project citations footer per R011.§3.AC.03.
 *
 * Per DD006.§3.DC.03, the command is registered at the top level of the
 * scepter CLI; the backward-compat alias at `cli/index.ts:138` makes
 * `scepter claims dependents <claim>` work transparently with a deprecation
 * notice.
 *
 * @implements {DD021.§10.DC.15} dependents subcommand
 * @implements {DD006.§3.DC.03} top-level registration per flattening
 * @implements {R006.§2.AC.03} uses ClaimIndex.getDerivatives() for derivation dependents
 * @implements {R011.§3.AC.03} cross-project citations rendered separately as footer
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import { resolveSingleClaim } from '../shared/resolve-claim-id.js';
import { resolveReference } from '../../../claims/reference-resolver.js';
import type {
  ClaimIndexData,
  ClaimIndexEntry,
  ClaimCrossReference,
} from '../../../claims/index.js';

interface DependentsResult {
  target: string;
  targetEntry: ClaimIndexEntry;
  derivatives: string[];
  supersedeRefs: string[];
  inlineRefs: Array<{ fromClaim: string; fromNoteId: string; line: number; filePath: string }>;
  crossProjectRefs: Array<{ aliasPrefix: string; fromNoteId: string; line: number; filePath: string }>;
}

export const dependentsCommand = new Command('dependents')
  .description('List claims and references that depend on a given claim (derivatives, supersessions, inline references)')
  .argument('<id>', 'Claim FQID, partial form, or section-less form (e.g., R004.§1.AC.01 or R004.AC.01)')
  .option('--json', 'Output as JSON')
  .option('--reindex', 'Force rebuild of claim index')
  .option('--project-dir <path>', 'Project root (defaults to current directory)')
  .action(async (id: string, options: { json?: boolean; reindex?: boolean; projectDir?: string }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const data = await ensureIndex(context.projectManager, { reindex: options.reindex });
          const claimIndex = context.projectManager.claimIndex;

          // Resolve user input via the shared resolver (DC.10 wrapper).
          // resolveSingleClaim handles ambiguous/not-found diagnostics for us.
          const target = resolveSingleClaim(id, data);
          if (!target) return;
          const targetFqid = target.fullyQualified;

          // Gather the four dependent kinds.
          // @implements {R006.§2.AC.03} derivatives via ClaimIndex.getDerivatives()
          const derivatives = claimIndex.getDerivatives(targetFqid);
          const supersedeRefs = findSupersedeRefs(data, targetFqid);
          const inlineRefs = findInlineRefs(data, targetFqid);
          const crossProjectRefs = findCrossProjectRefs(data, targetFqid);

          const result: DependentsResult = {
            target: targetFqid,
            targetEntry: target,
            derivatives,
            supersedeRefs,
            inlineRefs,
            crossProjectRefs,
          };

          if (options.json) {
            // JSON output: structured data, omitting targetEntry's heavy fields
            // for cleanness; include only fully-qualified ID for the target.
            console.log(
              JSON.stringify(
                {
                  target: result.target,
                  archived: result.targetEntry.archived,
                  derivatives: result.derivatives,
                  supersedeRefs: result.supersedeRefs,
                  inlineRefs: result.inlineRefs,
                  crossProjectRefs: result.crossProjectRefs,
                },
                null,
                2,
              ),
            );
          } else {
            renderHuman(result, data);
          }
        },
      );
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

/**
 * Find every claim that declares `superseded=TARGET` against the queried claim.
 *
 * Per §6 ISSUE 13: `entry.lifecycle.target` is the raw author-written string,
 * NOT a canonical FQID. To match against the queried `targetFqid`, run each
 * candidate target through the resolver and compare canonical IDs.
 *
 * Tombstoned `lifecycle.target` values: the Phase 1.6 loop in
 * `claim-index.ts:498-506` captures tombstoned targets into
 * `entry.tombstonedSupersededBy` but does NOT clear `entry.lifecycle.target`.
 * So tombstoned entries DO reach this loop and DO call `resolveReference()`.
 * The resolver returns `unresolved` with `malformed-claim-reference`
 * (deletion markers fail the note-ID regex inside `parseClaimAddress`), and
 * the `outcome.kind === 'resolved'` filter below naturally excludes them
 * from results. Implementation is correct; the natural-filter pattern handles
 * tombstones safely.
 *
 * @implements {DD021.§10.DC.15} supersession dependents
 * @implements {DD021.§10.DC.08} every resolution flows through resolveReference()
 * @internal Exported for testing
 */
export function findSupersedeRefs(data: ClaimIndexData, targetFqid: string): string[] {
  const results: string[] = [];
  for (const [fqid, entry] of data.entries) {
    if (entry.lifecycle?.type !== 'superseded') continue;
    if (!entry.lifecycle.target) continue;
    const outcome = resolveReference(entry.lifecycle.target, data, {
      currentNoteId: entry.noteId,
      derivesPosition: false,
      includeArchived: true,
    });
    if (outcome.kind === 'resolved' && outcome.canonicalId === targetFqid) {
      results.push(fqid);
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

/**
 * Find every inline reference targeting the queried claim. Filters on
 * `resolverOutcome.kind === 'resolved'` — unresolved refs don't actually
 * point at the target, so listing them as dependents would be misleading.
 *
 * @implements {DD021.§10.DC.15} inline-ref dependents
 * @internal Exported for testing
 */
export function findInlineRefs(
  data: ClaimIndexData,
  targetFqid: string,
): Array<{ fromClaim: string; fromNoteId: string; line: number; filePath: string }> {
  const results: ClaimCrossReference[] = [];
  for (const ref of data.crossRefs) {
    if (ref.toClaim !== targetFqid) continue;
    if (ref.resolverOutcome === undefined) {
      // Pre-migration crossRefs may lack resolverOutcome; fall back to the
      // legacy unresolved boolean.
      if (ref.unresolved === true) continue;
      results.push(ref);
      continue;
    }
    if (ref.resolverOutcome.kind !== 'resolved') continue;
    results.push(ref);
  }
  return results
    .map(ref => ({
      fromClaim: ref.fromClaim,
      fromNoteId: ref.fromNoteId,
      line: ref.line,
      filePath: ref.filePath,
    }))
    .sort((a, b) => a.fromClaim.localeCompare(b.fromClaim));
}

/**
 * Find cross-project alias-prefixed references that cite the queried claim.
 * Per R011 "citation, not federation," cross-project refs are read-only
 * display pointers; this listing walks the local `data.crossProjectRefs`
 * for entries whose resolved peer-side address would match the queried local
 * target. Today this is a no-op for the local-target lookup direction (peer
 * citations live in the peer's index; the local crossProjectRefs holds
 * LOCAL refs TO peers, not peer refs TO local). The footer documents this
 * boundary explicitly.
 *
 * @implements {R011.§3.AC.03} cross-project citations rendered separately
 * @internal Exported for testing
 */
export function findCrossProjectRefs(
  _data: ClaimIndexData,
  _targetFqid: string,
): Array<{ aliasPrefix: string; fromNoteId: string; line: number; filePath: string }> {
  // The local `crossProjectRefs` records local notes citing peer claims,
  // not the inverse. There is no cross-project lookup for "peers citing
  // local target" in v1 (citation, not federation). Returns empty list;
  // the footer below documents the boundary.
  return [];
}

/**
 * Human-readable rendering. Structure mirrors `scepter trace` per OQ.04
 * default lean: target header + per-kind sections in fixed order (Q19
 * disposition: structural-depth) + cross-project footer (always present
 * per §6.7 even when empty).
 */
function renderHuman(result: DependentsResult, data: ClaimIndexData): void {
  const { target, targetEntry, derivatives, supersedeRefs, inlineRefs, crossProjectRefs } = result;

  // Target header
  const archivedSuffix = targetEntry.archived ? chalk.yellow(' [ARCHIVED]') : '';
  console.log(chalk.bold(`Dependents of ${chalk.cyan(target)}${archivedSuffix}:`));
  console.log(`  ${targetEntry.heading}`);
  console.log(`  ${chalk.gray(`Defined in ${targetEntry.noteId} at L${targetEntry.line}-${targetEntry.endLine}`)}`);
  console.log('');

  // Derivatives section
  console.log(chalk.bold(`Derivatives (claims declaring derives=${target}):`));
  if (derivatives.length === 0) {
    console.log(`  ${chalk.gray('(none)')}`);
  } else {
    for (const fqid of derivatives) {
      const entry = data.entries.get(fqid);
      const heading = entry ? entry.heading.slice(0, 70) : '';
      const loc = entry ? chalk.gray(`L${entry.line}`) : '';
      console.log(`  - ${chalk.cyan(fqid)}  ${heading}  ${loc}`);
    }
    console.log(`  ${chalk.gray(`(${derivatives.length} derivative${derivatives.length === 1 ? '' : 's'})`)}`);
  }
  console.log('');

  // Supersessions section
  console.log(chalk.bold(`Supersessions (claims declaring superseded=${target}):`));
  if (supersedeRefs.length === 0) {
    console.log(`  ${chalk.gray('(none)')}`);
  } else {
    for (const fqid of supersedeRefs) {
      const entry = data.entries.get(fqid);
      const heading = entry ? entry.heading.slice(0, 70) : '';
      const loc = entry ? chalk.gray(`L${entry.line}`) : '';
      console.log(`  - ${chalk.cyan(fqid)}  ${heading}  ${loc}`);
    }
    console.log(`  ${chalk.gray(`(${supersedeRefs.length} supersession${supersedeRefs.length === 1 ? '' : 's'})`)}`);
  }
  console.log('');

  // Inline references section
  console.log(chalk.bold('Inline references (live):'));
  if (inlineRefs.length === 0) {
    console.log(`  ${chalk.gray('(none)')}`);
  } else {
    for (const ref of inlineRefs) {
      console.log(`  - ${chalk.cyan(ref.fromClaim)}  →  cited at ${chalk.gray(`L${ref.line} in ${ref.fromNoteId}.md`)}`);
    }
    console.log(`  ${chalk.gray(`(${inlineRefs.length} inline reference${inlineRefs.length === 1 ? '' : 's'})`)}`);
  }
  console.log('');

  // Cross-project citations footer — always present per §6.7.
  // @implements {R011.§3.AC.03}
  console.log(chalk.bold('Cross-project citations:'));
  if (crossProjectRefs.length === 0) {
    console.log(`  ${chalk.gray('(no cross-project citations)')}`);
  } else {
    for (const ref of crossProjectRefs) {
      console.log(`  - ${chalk.cyan(ref.aliasPrefix)} cites this claim at ${chalk.gray(`L${ref.line} in ${ref.fromNoteId}`)} (read-only)`);
    }
    console.log(`  ${chalk.gray(`(${crossProjectRefs.length} cross-project citation${crossProjectRefs.length === 1 ? '' : 's'}; see {R011.§3} for cross-project semantics)`)}`);
  }
}
