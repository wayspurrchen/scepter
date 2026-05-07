/**
 * Apply command for bulk confidence annotation.
 *
 * Resolves a filter spec to a list of files, classifies each (mark /
 * replace / skip-annotated / skip-unmatched), and writes annotations
 * accordingly. Supports `--dry-run` to preview the plan and
 * `--verbose` to print the per-file table after wet execution. Failure
 * isolation: per-file `adapter.insert` throws are caught and recorded;
 * the loop continues to the next file.
 *
 * @implements {R013.§3} bulk apply
 * @implements {S004.§4.AC.01-09}
 * @implements {DD017.DC.20}
 * @implements {DD017.DC.21}
 * @implements {DD017.DC.22}
 * @implements {DD017.DC.23}
 * @implements {DD017.DC.24}
 * @implements {DD017.DC.25}
 * @implements {DD017.DC.26}
 * @implements {DD017.DC.27}
 * @implements {DD017.DC.28}
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import { BaseCommand } from '../base-command.js';
import {
  mapReviewerArg,
  validateReviewerLevel,
  getAdapter,
} from '../../../claims/confidence/index.js';
import type { ConfidenceLevel } from '../../../claims/confidence/index.js';
import {
  resolveFiles,
  FilterContradictionError,
} from '../../../claims/confidence/filters.js';
import type { FilterSpec, ResolvedFile } from '../../../claims/confidence/filters.js';
import {
  formatApplySummary,
  formatApplyPlanTable,
} from '../../formatters/confidence-formatter.js';
import type {
  ApplyOutcome,
  PlanRow,
} from '../../formatters/confidence-formatter.js';
import type { ProjectManager } from '../../../project/project-manager.js';

export type ApplyExitReason =
  | 'invalid-reviewer'
  | 'invalid-level'
  | 'invalid-reviewer-level-combo'
  | 'no-filters'
  | 'filter-contradiction';

export type ApplyResult =
  | { ok: true; outcome: ApplyOutcome; rows: PlanRow[]; dryRun: boolean }
  | { ok: false; reason: ApplyExitReason; message: string };

interface ApplyArgs {
  reviewerArg: string;
  levelArg: string;
  filters: FilterSpec;
  skipAnnotated: boolean;
  overwrite: boolean;
  dryRun: boolean;
  verbose: boolean;
}

function commaSplit(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/**
 * The pure logic of apply. Returns the outcome (counters + per-file
 * rows) or an early-exit reason. Tests exercise this directly.
 *
 * @implements {DD017.DC.20}
 * @implements {DD017.DC.21}
 * @implements {DD017.DC.22}
 * @implements {DD017.DC.23}
 * @implements {DD017.DC.24}
 * @implements {DD017.DC.25}
 * @implements {DD017.DC.26}
 * @implements {DD017.DC.27}
 * @implements {DD017.DC.28}
 */
export async function executeApply(
  pm: ProjectManager,
  args: ApplyArgs,
): Promise<ApplyResult> {
  const reviewer = mapReviewerArg(args.reviewerArg);
  if (!reviewer) {
    return {
      ok: false,
      reason: 'invalid-reviewer',
      message: `Invalid reviewer: "${args.reviewerArg}". Must be "ai" or "human".`,
    };
  }

  const level = parseInt(args.levelArg, 10);
  if (isNaN(level) || level < 1 || level > 5) {
    return {
      ok: false,
      reason: 'invalid-level',
      message: `Invalid level: "${args.levelArg}". Must be 1-5.`,
    };
  }
  const confidenceLevel = level as ConfidenceLevel;

  const validation = validateReviewerLevel(reviewer, confidenceLevel);
  if (!validation.valid) {
    return {
      ok: false,
      reason: 'invalid-reviewer-level-combo',
      message: validation.message!,
    };
  }

  // No-filters error vs zero-match: distinct outcomes per DC.21/DC.27.
  // No-filters: all four categories empty/undefined.
  const hasAnyFilter =
    (args.filters.types && args.filters.types.length > 0) ||
    (args.filters.tags && args.filters.tags.length > 0) ||
    (args.filters.ids && args.filters.ids.length > 0) ||
    (args.filters.glob && args.filters.glob.length > 0);
  if (!hasAnyFilter) {
    return {
      ok: false,
      reason: 'no-filters',
      message:
        'no filters supplied: at least one of --types, --tags, --ids, or --glob is required for apply.',
    };
  }

  // Resolve files via the filter resolver. FilterContradictionError
  // surfaces as a usage error (DC.22).
  let resolved: ResolvedFile[];
  try {
    resolved = await resolveFiles(pm, args.filters);
  } catch (err) {
    if (err instanceof FilterContradictionError) {
      return {
        ok: false,
        reason: 'filter-contradiction',
        message: err.message,
      };
    }
    throw err;
  }

  // Compute today's date once per apply invocation; reused for every
  // file's payload. includeDate honored per DC.17.
  const config = pm.configManager.getConfig();
  const includeDate = config.claims?.confidence?.includeDate ?? true;
  const date = includeDate ? new Date().toISOString().slice(0, 10) : undefined;

  const outcome: ApplyOutcome = {
    marked: 0,
    replaced: 0,
    skippedAnnotated: 0,
    skippedUnmatched: 0,
    failed: [],
  };
  const rows: PlanRow[] = [];

  // Sequential processing per Decision 3 (DC.28). Per-file try/catch
  // gives failure isolation per DC.25.
  for (const file of resolved) {
    const adapter = getAdapter(file.filePath);
    if (!adapter) {
      // Adapter null → skip-unmatched per DC.23 step 1. Tracked
      // separately from no-files-matched (DC.27).
      outcome.skippedUnmatched++;
      rows.push({
        path: file.filePath,
        scope: file.scope,
        current: '-',
        proposed: '-',
        action: 'skip-unmatched',
      });
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(file.filePath, 'utf-8');
    } catch (err) {
      outcome.failed.push({
        path: file.filePath,
        error: (err as Error).message,
      });
      rows.push({
        path: file.filePath,
        scope: file.scope,
        current: '-',
        proposed: '-',
        action: 'failed',
      });
      continue;
    }

    let parsed: ReturnType<typeof adapter.parse> | null = null;
    try {
      parsed = adapter.parse(content, file.filePath);
    } catch {
      // Parse-throws are part of the adapter contract surface; treat
      // as failed for this file. (parse() shouldn't throw, but if a
      // future adapter does, we don't want one bad file to abort the
      // run.)
      outcome.failed.push({
        path: file.filePath,
        error: 'parse threw',
      });
      rows.push({
        path: file.filePath,
        scope: file.scope,
        current: '-',
        proposed: '-',
        action: 'failed',
      });
      continue;
    }

    // Action classification per DC.23.
    const proposedAnnotation = adapter.format(reviewer, confidenceLevel, date);
    let action: PlanRow['action'];
    if (parsed) {
      // Existing annotation present.
      if (args.overwrite) {
        action = 'replace';
      } else if (args.skipAnnotated) {
        action = 'skip-annotated';
      } else {
        // skip-annotated false AND overwrite false → still mark? Per
        // DC.23 step 2: "skip-annotated default true; overwrite false"
        // is skip. For "skip-annotated false, overwrite false" the
        // matrix in TS001 §8.AC.01 says action is 'mark' (the user
        // explicitly turned skip off without enabling overwrite — they
        // accept the rewrite). We surface that path here.
        action = 'mark';
      }
    } else {
      action = 'mark';
    }

    const currentAnnotation = parsed
      ? adapter.format(parsed.reviewer, parsed.level, parsed.date)
      : '-';

    rows.push({
      path: file.filePath,
      scope: file.scope,
      current: currentAnnotation,
      proposed: proposedAnnotation,
      action,
    });

    if (args.dryRun) continue;

    if (action === 'skip-annotated') {
      outcome.skippedAnnotated++;
      continue;
    }

    // mark or replace → invoke adapter.insert and write.
    try {
      const updated = adapter.insert(content, {
        reviewer,
        level: confidenceLevel,
        date,
      });
      await fs.writeFile(file.filePath, updated, 'utf-8');
      if (action === 'mark') outcome.marked++;
      else outcome.replaced++;
    } catch (err) {
      outcome.failed.push({
        path: file.filePath,
        error: (err as Error).message,
      });
      // Mutate the row's action to reflect the actual outcome.
      rows[rows.length - 1].action = 'failed';
    }
  }

  return { ok: true, outcome, rows, dryRun: args.dryRun };
}

export const applyCommand = new Command('apply')
  .description('Bulk-apply a confidence annotation across notes and/or source files')
  .argument('<reviewer>', 'Reviewer type: ai or human')
  .argument('<level>', 'Confidence level: 1-5')
  .option('--types <types>', 'Comma-separated note types (e.g. Requirement,Spec)')
  .option('--tags <tags>', 'Comma-separated tags (OR-within)')
  .option('--ids <ids>', 'Comma-separated note ids (e.g. R001,R002)')
  .option('--glob <pattern>', 'Glob pattern (the only filter that can reach source files)')
  .option('--no-skip-annotated', 'Mark even files that already have an annotation (default: skip)')
  .option('--overwrite', 'Replace existing annotations (suppresses skip-annotated)', false)
  .option('--dry-run', 'Preview the plan without writing any files', false)
  .option('--verbose', 'Print the per-file plan table after the summary', false)
  .action(async (
    reviewerArg: string,
    levelArg: string,
    options: {
      types?: string;
      tags?: string;
      ids?: string;
      glob?: string;
      skipAnnotated?: boolean;
      overwrite?: boolean;
      dryRun?: boolean;
      verbose?: boolean;
      projectDir?: string;
    },
  ) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: false,
        },
        async (context) => {
          const result = await executeApply(context.projectManager, {
            reviewerArg,
            levelArg,
            filters: {
              types: commaSplit(options.types),
              tags: commaSplit(options.tags),
              ids: commaSplit(options.ids),
              glob: options.glob,
            },
            // commander --no-skip-annotated yields skipAnnotated === false.
            // Default (no flag): skipAnnotated is undefined → true.
            skipAnnotated: options.skipAnnotated !== false,
            overwrite: options.overwrite ?? false,
            dryRun: options.dryRun ?? false,
            verbose: options.verbose ?? false,
          });

          if (!result.ok) {
            console.log(chalk.red(result.message));
            process.exit(1);
          }

          if (result.rows.length === 0) {
            console.log(chalk.yellow('no files matched the supplied filters.'));
            return;
          }

          if (result.dryRun) {
            console.log(chalk.bold('Dry run — no files written.'));
            console.log(formatApplyPlanTable(result.rows));
            return;
          }

          console.log(formatApplySummary(result.outcome));
          if (options.verbose) {
            console.log('');
            console.log(formatApplyPlanTable(result.rows));
          }
          if (result.outcome.failed.length > 0) {
            process.exit(1);
          }
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
