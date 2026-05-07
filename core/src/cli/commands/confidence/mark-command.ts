/**
 * Mark command for confidence annotations.
 *
 * Reads a file, validates reviewer/level, resolves the appropriate
 * adapter via `getAdapter(filePath)`, computes the date per
 * `claims.confidence.includeDate`, and writes the updated content back.
 * The command owns all I/O; adapters are side-effect free per
 * S003.§5.AC.04.
 *
 * @implements {R004.§7.AC.02} scepter confidence mark command
 * @implements {S004.§3.AC.01-06}
 * @implements {DD017.DC.15}
 * @implements {DD017.DC.16}
 * @implements {DD017.DC.17}
 * @implements {DD017.DC.18}
 * @implements {DD017.DC.19}
 */

import * as path from 'path';
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
import type { ProjectManager } from '../../../project/project-manager.js';

export type MarkOutcome =
  | {
      ok: true;
      adapterId: string;
      annotation: string;
      filePath: string;
    }
  | {
      ok: false;
      reason:
        | 'file-not-found'
        | 'invalid-reviewer'
        | 'invalid-level'
        | 'invalid-reviewer-level-combo'
        | 'no-adapter';
      message: string;
    };

/**
 * Execute the mark workflow against a single file. Pure of console I/O —
 * the CLI wrapper handles user-facing output. All filesystem reads and
 * writes happen here; adapters are not given fs handles per DC.18.
 *
 * @implements {S004.§3.AC.01-06}
 * @implements {DD017.DC.15-19}
 */
export async function executeMark(
  pm: ProjectManager,
  args: { file: string; reviewerArg: string; levelArg: string },
): Promise<MarkOutcome> {
  // Resolve file path.
  const filePath = path.isAbsolute(args.file)
    ? args.file
    : path.resolve(pm.projectPath, args.file);

  if (!(await fs.pathExists(filePath))) {
    return {
      ok: false,
      reason: 'file-not-found',
      message: `File not found: ${args.file}`,
    };
  }

  // Reviewer mapping (DC.16 — runs BEFORE getAdapter).
  const reviewer = mapReviewerArg(args.reviewerArg);
  if (!reviewer) {
    return {
      ok: false,
      reason: 'invalid-reviewer',
      message: `Invalid reviewer: "${args.reviewerArg}". Must be "ai" or "human".`,
    };
  }

  // Level parsing (DC.16).
  const level = parseInt(args.levelArg, 10);
  if (isNaN(level) || level < 1 || level > 5) {
    return {
      ok: false,
      reason: 'invalid-level',
      message: `Invalid level: "${args.levelArg}". Must be 1-5.`,
    };
  }
  const confidenceLevel = level as ConfidenceLevel;

  // Reviewer-level range validation (DC.16). When this fails, MUST NOT
  // call getAdapter, parse, or insert.
  const validation = validateReviewerLevel(reviewer, confidenceLevel);
  if (!validation.valid) {
    return {
      ok: false,
      reason: 'invalid-reviewer-level-combo',
      message: validation.message!,
    };
  }

  // Adapter resolution (DC.15).
  const adapter = getAdapter(filePath);
  if (!adapter) {
    const ext = path.extname(filePath) || '(no extension)';
    return {
      ok: false,
      reason: 'no-adapter',
      message:
        `No confidence adapter registered for ${args.file} (extension ${ext}). ` +
        'Supported adapters: c-family-comments (.ts, .tsx, .js, .jsx, .mjs, .cjs, .c, .h, .cc, .cpp, .hpp, .cs), ' +
        'markdown-frontmatter (.md, .markdown).',
    };
  }

  // Date per claims.confidence.includeDate (DC.17). undefined → true.
  const config = pm.configManager.getConfig();
  const includeDate = config.claims?.confidence?.includeDate ?? true;
  const date = includeDate ? new Date().toISOString().slice(0, 10) : undefined;

  // I/O at the command layer (DC.18). Adapter is pure.
  const content = await fs.readFile(filePath, 'utf-8');
  const updated = adapter.insert(content, {
    reviewer,
    level: confidenceLevel,
    date,
  });
  await fs.writeFile(filePath, updated, 'utf-8');

  return {
    ok: true,
    adapterId: adapter.id,
    annotation: adapter.format(reviewer, confidenceLevel, date),
    filePath: args.file,
  };
}

export const markCommand = new Command('mark')
  .description('Add or update a confidence annotation on a file')
  .argument('<file>', 'Path to the file (source or note)')
  .argument('<reviewer>', 'Reviewer type: ai or human')
  .argument('<level>', 'Confidence level: 1-5')
  .action(async (
    file: string,
    reviewerArg: string,
    levelArg: string,
    options: { projectDir?: string },
  ) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: false,
          startWatching: false,
        },
        async (context) => {
          const outcome = await executeMark(context.projectManager, {
            file,
            reviewerArg,
            levelArg,
          });

          if (!outcome.ok) {
            console.log(chalk.red(outcome.message));
            process.exit(1);
          }

          console.log(chalk.green('Confidence annotation written:'));
          console.log(`  ${chalk.cyan(outcome.annotation)}`);
          console.log(`  ${chalk.gray(`File: ${outcome.filePath}`)}`);
          console.log(`  ${chalk.gray(`Adapter: ${outcome.adapterId}`)}`);
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
