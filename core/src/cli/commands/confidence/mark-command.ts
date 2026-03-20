/**
 * Mark command for confidence annotations.
 *
 * Reads a file, maps positional ai/human to emoji, validates level range,
 * formats and inserts the confidence annotation, writes back.
 *
 * @implements {R004.§7.AC.02} scepter confidence mark command
 */

import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import { BaseCommand } from '../base-command.js';
import {
  mapReviewerArg,
  validateReviewerLevel,
  formatConfidenceAnnotation,
  insertConfidenceAnnotation,
} from '../../../claims/confidence.js';
import type { ConfidenceLevel } from '../../../claims/confidence.js';

export const markCommand = new Command('mark')
  .description('Add or update a confidence annotation on a file')
  .argument('<file>', 'Path to the source file')
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
          // Resolve file path
          const filePath = path.isAbsolute(file)
            ? file
            : path.resolve(context.projectPath, file);

          // Validate file exists
          if (!await fs.pathExists(filePath)) {
            console.log(chalk.red(`File not found: ${file}`));
            return;
          }

          // Map reviewer argument
          const reviewer = mapReviewerArg(reviewerArg);
          if (!reviewer) {
            console.log(chalk.red(`Invalid reviewer: "${reviewerArg}". Must be "ai" or "human".`));
            return;
          }

          // Parse and validate level
          const level = parseInt(levelArg, 10);
          if (isNaN(level) || level < 1 || level > 5) {
            console.log(chalk.red(`Invalid level: "${levelArg}". Must be 1-5.`));
            return;
          }
          const confidenceLevel = level as ConfidenceLevel;

          // Validate reviewer-level range
          const validation = validateReviewerLevel(reviewer, confidenceLevel);
          if (!validation.valid) {
            console.log(chalk.red(validation.message!));
            return;
          }

          // Read file content
          const content = await fs.readFile(filePath, 'utf-8');

          // Format annotation with today's date
          const today = new Date().toISOString().slice(0, 10);
          const annotation = formatConfidenceAnnotation(reviewer, confidenceLevel, today);

          // Insert or replace
          const updated = insertConfidenceAnnotation(content, annotation);

          // Write back
          await fs.writeFile(filePath, updated, 'utf-8');

          console.log(chalk.green('Confidence annotation written:'));
          console.log(`  ${chalk.cyan(annotation)}`);
          console.log(`  ${chalk.gray(`File: ${file}`)}`);
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
