/**
 * Convert Handler - Convert notes between file and folder formats
 * @implements {T007} - Implement convert command for folder format conversion
 */

import chalk from 'chalk';
import type { Note } from '../../../types/note.js';
import type { CommandContext } from '../base-command.js';
import { FolderMigration } from '../../../migration/folder-migration.js';
import { scanFolderContents } from '../../../notes/folder-utils.js';

export interface ConvertOptions {
  projectDir: string;
  toFolder?: boolean;
  toFile?: boolean;
  backup: boolean;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
}

interface ConversionResult {
  id: string;
  success: boolean;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
  backupPath?: string;
  newPath?: string;
}

export class ConvertHandler {
  async execute(noteIds: string[], options: ConvertOptions, context: CommandContext): Promise<void> {
    // Step 1: Validate command options - mutual exclusivity
    if (!options.toFolder && !options.toFile) {
      console.error(chalk.red('Error: Must specify either --to-folder or --to-file'));
      process.exit(1);
    }

    if (options.toFolder && options.toFile) {
      console.error(chalk.red('Error: Cannot specify both --to-folder and --to-file'));
      process.exit(1);
    }

    // Step 2: Extract managers and create FolderMigration
    const { projectManager } = context;
    const noteManager = projectManager.noteManager;

    if (!noteManager) {
      throw new Error('Note manager not initialized');
    }

    // IMPORTANT: FolderMigration is NOT exposed by ProjectManager
    // Must instantiate manually with required dependencies
    const migration = new FolderMigration(
      projectManager.noteManager,
      projectManager.noteFileManager,
      projectManager.configManager
    );

    // Step 3: Resolve note IDs
    const notesToConvert: Note[] = [];
    const notFound: string[] = [];

    for (const noteId of noteIds) {
      const result = await noteManager.getNotes({ ids: [noteId] });
      if (result.notes.length === 0) {
        notFound.push(noteId);
      } else {
        notesToConvert.push(result.notes[0]);
      }
    }

    if (notFound.length > 0) {
      console.error(chalk.red(`Notes not found: ${notFound.join(', ')}`));
      process.exit(1);
    }

    // Step 4: Pre-validation for --to-file conversion
    if (options.toFile) {
      // Pre-validate each note for additional files
      const notesWithIssues: Array<{ note: Note; issues: string[] }> = [];

      for (const note of notesToConvert) {
        if (!note.isFolder) continue; // Will be handled as already-in-format

        const validation = await migration.validateMigration(note.id, 'file');

        // Check if there are warnings about additional files
        const hasAdditionalFiles = validation.warnings.some(w =>
          w.includes('additional files')
        );

        if (hasAdditionalFiles && !options.force && !options.dryRun) {
          // Get actual file list for better error message
          if (note.folderPath) {
            const additionalFiles = await scanFolderContents(note.folderPath);
            if (additionalFiles.length > 0) {
              notesWithIssues.push({
                note,
                issues: additionalFiles
              });
            }
          }
        }
      }

      if (notesWithIssues.length > 0 && !options.force) {
        for (const { note, issues } of notesWithIssues) {
          console.error(chalk.red(`❌ Cannot convert ${note.id} to file format\n`));
          console.error(chalk.yellow(`Folder contains ${issues.length} additional files:`));
          issues.forEach(file => console.error(chalk.gray(`  - ${file}`)));
          console.error('');
        }

        console.error(chalk.yellow('Options:'));
        console.error(chalk.yellow('  1. Remove additional files manually'));
        console.error(chalk.yellow('  2. Use --force to archive additional files and proceed'));
        console.error('');
        const errorWord = notesWithIssues.length === 1 ? 'error' : 'errors';
        console.error(chalk.red(`Command failed with ${notesWithIssues.length} ${errorWord}`));
        process.exit(1);
      }
    }

    // Step 5: Show preview and confirm (unless --force or --dry-run or --json)
    if (!options.force && !options.dryRun && !options.json) {
      const targetFormat = options.toFolder ? 'folder format' : 'file format';
      console.log(chalk.yellow(`The following notes will be converted to ${targetFormat}:`));

      notesToConvert.forEach((note) => {
        const currentFormat = note.isFolder ? 'folder' : 'file';
        console.log(chalk.gray(`  - ${note.id}: ${note.title} (currently ${currentFormat})`));
      });

      if (options.backup) {
        console.log(chalk.yellow('\nBackups will be created before conversion.'));
      } else {
        console.log(chalk.red('\n⚠️  Warning: Backups are disabled (--backup false).'));
      }

      console.log(chalk.yellow('Converted notes can be converted back if needed.'));

      // Confirmation prompt
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan('Continue? (y/N) '), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('Conversion cancelled'));
        return;
      }
    }

    // Step 6: Process conversions
    // Display header
    if (!options.json) {
      if (options.dryRun) {
        console.log(chalk.cyan('📋 DRY RUN: Showing what would be converted...\n'));
      } else {
        const icon = options.toFolder ? '📁' : '📄';
        const target = options.toFolder ? 'folder format' : 'file format';
        console.log(chalk.cyan(`${icon} Converting notes to ${target}...\n`));
      }
    }

    // Process each note
    const results: ConversionResult[] = [];

    for (const note of notesToConvert) {
      try {
        if (options.toFolder) {
          // Check if already folder
          if (note.isFolder) {
            results.push({
              id: note.id,
              success: true,
              skipped: true,
              skipReason: 'Already in folder format'
            });
            continue;
          }

          const result = await migration.convertToFolder(note.id, {
            backup: options.backup,
            dryRun: options.dryRun,
            verbose: false // We handle output ourselves
          });

          results.push({
            id: note.id,
            success: result.success,
            error: result.error,
            backupPath: result.backupPath,
            newPath: note.folderPath || note.filePath
          });

        } else {
          // Check if already file
          if (!note.isFolder) {
            results.push({
              id: note.id,
              success: true,
              skipped: true,
              skipReason: 'Already in file format'
            });
            continue;
          }

          const result = await migration.convertToFile(note.id, {
            backup: options.backup,
            dryRun: options.dryRun,
            verbose: false
          });

          results.push({
            id: note.id,
            success: result.success,
            error: result.error,
            backupPath: result.backupPath,
            newPath: note.folderPath || note.filePath
          });
        }

      } catch (error) {
        results.push({
          id: note.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Step 7: Display results
    if (options.json) {
      console.log(JSON.stringify({ results }, null, 2));
      return;
    }

    const succeeded = results.filter((r) => r.success && !r.skipped);
    const skipped = results.filter((r) => r.skipped);
    const failed = results.filter((r) => !r.success);

    // Display successful conversions
    if (succeeded.length > 0) {
      succeeded.forEach((r) => {
        const verb = options.dryRun ? 'Would convert' : 'Converted';
        const target = options.toFolder ? 'folder format' : 'file format';
        console.log(chalk.green(`✓ ${r.id}: ${verb} to ${target}`));

        if (r.newPath) {
          const action = options.dryRun ? 'Would create' : 'Created';
          console.log(chalk.gray(`  ${action}: ${r.newPath}`));
        }

        if (r.backupPath) {
          const action = options.dryRun ? 'Would backup' : 'Backed up';
          console.log(chalk.gray(`  ${action}: ${r.backupPath}`));
        }
      });
    }

    // Display skipped notes
    if (skipped.length > 0) {
      skipped.forEach((r) => {
        console.log(chalk.yellow(`✗ ${r.id}: ${r.skipReason} (skipped)`));
      });
    }

    // Display failures
    if (failed.length > 0) {
      failed.forEach((r) => {
        console.log(chalk.red(`✗ ${r.id}: ${r.error}`));
      });
    }

    // Summary
    console.log('');
    const verb = options.dryRun ? 'would be converted' : 'converted';
    const targetFormat = options.toFolder ? 'folder format' : 'file format';

    if (failed.length === 0) {
      const skipNote = skipped.length > 0 ? ` (${skipped.length} skipped)` : '';
      const noteWord = succeeded.length === 1 ? 'note' : 'notes';
      console.log(chalk.green(`✅ Successfully ${verb} ${succeeded.length} ${noteWord} to ${targetFormat}${skipNote}`));
    } else {
      const totalProcessed = succeeded.length + skipped.length + failed.length;
      const noteWord = totalProcessed === 1 ? 'note' : 'notes';
      console.log(chalk.yellow(`⚠️  ${verb} ${succeeded.length}/${totalProcessed} ${noteWord}`));
      console.log(chalk.red(`   ${failed.length} failed`));
    }
  }
}