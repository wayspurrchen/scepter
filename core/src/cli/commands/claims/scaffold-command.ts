/**
 * @implements {R004.§6.AC.01} `scepter claims scaffold` generates heading structure
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BaseCommand } from '../base-command.js';
import * as fs from 'fs/promises';

export const scaffoldCommand = new Command('scaffold')
  .description('Create a document skeleton with numbered sections and placeholder claims')
  .argument('<noteId>', 'Note ID to scaffold into (e.g., R004)')
  .requiredOption('--sections <n>', 'Number of sections to generate', parseInt)
  .option('--prefix <prefix>', 'Claim prefix (default: AC)', 'AC')
  .option('--claims-per-section <n>', 'Number of claims per section (default: 3)', parseInt)
  .action(
    async (
      noteId: string,
      options: {
        sections: number;
        prefix: string;
        claimsPerSection?: number;
        projectDir?: string;
      },
    ) => {
      try {
        await BaseCommand.execute(
          {
            projectDir: options.projectDir,
            requireNoteManager: true,
            startWatching: true,
          },
          async (context) => {
            const noteManager = context.projectManager.noteManager;
            if (!noteManager) {
              throw new Error('Note manager not initialized');
            }

            // Look up the note to find its file path
            const note = await noteManager.getNoteById(noteId);
            if (!note) {
              throw new Error(`Note not found: ${noteId}`);
            }

            if (!note.filePath) {
              throw new Error(`Note ${noteId} has no file path`);
            }

            const sectionCount = options.sections;
            const prefix = options.prefix;
            const claimsPerSection = options.claimsPerSection ?? 3;

            if (sectionCount < 1) {
              throw new Error('Number of sections must be at least 1');
            }

            // Generate the markdown scaffold
            const lines: string[] = [];
            let claimCounter = 1;

            for (let s = 1; s <= sectionCount; s++) {
              lines.push(`## ${s} Section ${s}`);
              lines.push('');

              for (let c = 0; c < claimsPerSection; c++) {
                const numStr = String(claimCounter).padStart(2, '0');
                lines.push(`${s}.${prefix}.${numStr} [TODO: Describe claim]`);
                lines.push('');
                claimCounter++;
              }
            }

            const scaffold = lines.join('\n');

            // Read existing content and append
            const existingContent = await noteManager.noteFileManager.getFileContents(noteId);
            const separator = existingContent && existingContent.trim().length > 0
              ? '\n\n'
              : '';

            const newContent = (existingContent || '') + separator + scaffold;
            await fs.writeFile(note.filePath, newContent, 'utf-8');

            console.log(
              chalk.green(
                `Scaffolded ${sectionCount} section(s) with ${claimCounter - 1} claim(s) into ${chalk.cyan(noteId)}`,
              ),
            );
            console.log(chalk.gray(`File: ${note.filePath}`));
          },
        );
      } catch (error) {
        BaseCommand.handleError(error);
      }
    },
  );
