/**
 * `scepter snapshot diff <a> [b] [--json] [--regressions]`
 *
 * Compares two snapshots — or one snapshot vs the live claim index
 * when `[b]` is omitted — and prints a categorized report.
 *
 * Both single-arg and two-arg paths construct a `SnapshotSide` for
 * each operand; the diff core operates on `SnapshotSide`, not on
 * `Snapshot` or `ClaimIndex` directly per §DC.38.
 *
 * The `tombstoneCtx` is always built (regardless of `--regressions`)
 * so `LostClaimFinding.isRegression` is computed on every diff path
 * per §DC.50; the `--regressions` flag controls only the exit code
 * and the suggestion-line emission per §DC.74.
 *
 * @implements {DD018.§3.DC.71} Commander spec for `diff` (a, b, --json, --regressions)
 * @implements {DD018.§3.DC.72} Handler resolves both sides
 * @implements {DD018.§3.DC.73} Handler builds tombstoneCtx
 * @implements {DD018.§3.DC.74} Output flow + exit-code semantics
 * @implements {DD018.§3.DC.75} Body-access boundary in the diff command
 * @implements {DD018.§3.DC.54a} (with diff-engine.ts §DC.54) composite enforcement of R014.§8.AC.03 — no body-content disk reads in diff
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../../base-command.js';
import { ensureIndex } from '../ensure-index.js';
import {
  loadSnapshotSide,
  liveSide,
  computeDiff,
} from '../../../../claims/snapshot/diff-engine.js';
import {
  formatDiffHeader,
  formatDiffSections,
  formatDiffJson,
  formatRegressionSuggestions,
} from '../../../../claims/snapshot/snapshot-formatter.js';
import {
  SnapshotNotFoundError,
  SnapshotSchemaError,
  snapshotPath,
  normalizeBodyForHash,
} from '../../../../claims/snapshot/index.js';
import type { ClaimIndexEntry } from '../../../../claims/claim-index.js';
import type { TombstoneContext, SnapshotSide } from '../../../../claims/snapshot/diff-types.js';
import type { ProjectManager } from '../../../../project/project-manager.js';

interface DiffOptions {
  json?: boolean;
  regressions?: boolean;
  projectDir?: string;
}

export const diffCommand = new Command('diff')
  .description('Compare a snapshot to another snapshot or to the live claim index')
  .argument('<a>', 'Baseline snapshot name')
  .argument('[b]', 'Optional candidate snapshot name (compares <a> vs <b>); omit to compare <a> vs the live index')
  .option('--json', 'Emit machine-readable JSON instead of the human report')
  .option('--regressions', 'Treat regressions as gate failures (non-zero exit when regressions > 0)')
  .action(async (a: string, b: string | undefined, options: DiffOptions) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const projectRoot = context.projectPath;
          const pm = context.projectManager;

          // Baseline is always the snapshot named by <a>.
          const baselinePath = snapshotPath(projectRoot, a);
          let baseline: SnapshotSide;
          try {
            baseline = await loadSnapshotSide(baselinePath);
          } catch (err) {
            handleSnapshotLoadError(err, a);
            return;
          }

          // Candidate is either the live index (when b omitted) or a
          // second snapshot.  When live, ensureIndex populates the
          // claimIndex so liveSide can capture in-memory.
          let candidate: SnapshotSide;
          let liveEntries: Map<string, ClaimIndexEntry>;
          if (b === undefined) {
            await ensureIndex(pm);
            candidate = await liveSide({
              claimIndex: pm.claimIndex,
              noteFileManager: pm.noteFileManager,
              noteManager: pm.noteManager ?? undefined,
              sourceScanner: pm.sourceScanner,
              projectRoot,
            });
            liveEntries = new Map(pm.claimIndex.getData().entries.entries());
          } else {
            const candidatePath = snapshotPath(projectRoot, b);
            try {
              candidate = await loadSnapshotSide(candidatePath);
            } catch (err) {
              handleSnapshotLoadError(err, b);
              return;
            }
            // Per §DC.73 + §DC.53: snapshot-vs-snapshot mode passes an
            // empty live-entries Map; the diff engine falls back to
            // candidate-side lifecycle-tag-only checks for tombstone
            // status.
            liveEntries = new Map();
          }

          const tombstoneCtx: TombstoneContext = {
            liveEntries,
            bodyResolver: makeBodyResolver(pm),
            cache: new Map(),
          };

          const report = computeDiff({
            baseline,
            candidate,
            tombstoneCtx,
          });

          const regressionsActive = !!options.regressions;

          if (options.json) {
            console.log(formatDiffJson(report, regressionsActive));
          } else {
            process.stdout.write(formatDiffHeader(report, regressionsActive));
            process.stdout.write(formatDiffSections(report, regressionsActive));
            if (regressionsActive && report.regressions.length > 0) {
              process.stdout.write(formatRegressionSuggestions(report));
            }
          }

          // Exit code: per §DC.74, when --regressions and regressions > 0,
          // exit 1; otherwise exit 0.  Default diff (no --regressions)
          // exits 0 regardless of drift per {R014.§4.AC.04}.
          if (regressionsActive && report.regressions.length > 0) {
            process.exitCode = 1;
          }
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });

/**
 * Handle a failed `loadSnapshotSide` call by translating typed
 * snapshot errors into clean CLI exits.  Other errors propagate to
 * `BaseCommand.handleError` via the outer try/catch.
 */
function handleSnapshotLoadError(err: unknown, name: string): never {
  if (err instanceof SnapshotNotFoundError) {
    console.error(chalk.red(`Snapshot not found: ${name}`));
    process.exit(1);
  }
  if (err instanceof SnapshotSchemaError) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
  throw err;
}

/**
 * Build the body-resolver closure used by the tombstone-detection
 * fallback.  Mirrors the writer's §DC.16 slice + normalize logic
 * minus the hashing step.
 *
 * The diff engine calls this lazily — only for regression candidates
 * whose lifecycle field doesn't already settle the tombstone
 * question.  Most diff runs never invoke it (lifecycle alone settles
 * tombstone status for the explicit cases) and therefore read no
 * body bytes from disk per {R014.§8.AC.03}.
 *
 * The resolver caches per-noteId aggregated content via a closed-over
 * Map so repeated queries against the same note are O(1) after the
 * first read.  Synchronous shape — `isTombstoned` (the consumer) is
 * sync, so the resolver MUST be sync.  Honors folder-note
 * aggregation via `noteFileManager.getAggregatedContentsSync`, the
 * sibling sync API to the writer's async `getAggregatedContents`.
 *
 * DESIGN-NOTE {DD018.§3.DC.52}: the DD names
 * `noteFileManager.getAggregatedContents` (async) but the detector
 * consumes the resolver synchronously.  We use the existing
 * `getAggregatedContentsSync` companion (same folder-note semantics,
 * same fallback shape) so the resolver path matches the writer's
 * §DC.16 logic exactly.  The slice indices `[entry.line .. entry.endLine]`
 * mirror the writer (whose `lineOneBased`/`endLineOneBased` map to
 * `slice(start, end)` semantics; see snapshot-writer.ts:hashClaimBody).
 */
function makeBodyResolver(pm: ProjectManager): (entry: ClaimIndexEntry) => string {
  const aggregatedByNoteId = new Map<string, string>();

  return (entry: ClaimIndexEntry): string => {
    let aggregated = aggregatedByNoteId.get(entry.noteId);
    if (aggregated === undefined) {
      try {
        aggregated = pm.noteFileManager.getAggregatedContentsSync(entry.noteId) ?? '';
      } catch {
        aggregated = '';
      }
      aggregatedByNoteId.set(entry.noteId, aggregated);
    }
    const lines = aggregated.split('\n');
    const slice = lines.slice(entry.line, entry.endLine);
    const body = slice.join('\n');
    return normalizeBodyForHash(body);
  };
}
