import chalk from 'chalk';
import type { Note } from '../../../types/note.js';
import type { CommandContext } from '../base-command.js';

export interface ArchiveOptions {
  projectDir: string;
  reason?: string;
  force?: boolean;
  json?: boolean;
}

export class ArchiveHandler {
  async execute(noteIds: string[], options: ArchiveOptions, context: CommandContext): Promise<void> {
    const { projectManager } = context;
    const noteManager = projectManager.noteManager;

    if (!noteManager) {
      throw new Error('Note manager not initialized');
    }

    // Validate all notes exist
    const notesToArchive: Note[] = [];
    const notFound: string[] = [];

    for (const noteId of noteIds) {
      const result = await noteManager.getNotes({ ids: [noteId] });
      if (result.notes.length === 0) {
        notFound.push(noteId);
      } else {
        notesToArchive.push(result.notes[0]);
      }
    }

    if (notFound.length > 0) {
      console.error(chalk.red(`Notes not found: ${notFound.join(', ')}`));
      process.exit(1);
    }

    // Show what will be archived
    if (!options.force && !options.json) {
      console.log(chalk.yellow('The following notes will be archived:'));
      notesToArchive.forEach((note) => {
        console.log(chalk.gray(`  - ${note.id}: ${note.title}`));
      });

      // Ask for confirmation
      console.log(
        chalk.yellow(
          '\nArchived notes will be moved to _archive folders and marked with #archived tag. ' +
            'Archived notes still show up in note counts for various commands, but are not included by default.',
        ),
      );
      console.log(chalk.yellow('They can be restored later using the restore command.'));
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
        console.log(chalk.gray('Archive cancelled'));
        return;
      }
    }

    // Archive each note
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const note of notesToArchive) {
      try {
        await noteManager.archiveNote(note.id, options.reason);
        results.push({ id: note.id, success: true });
      } catch (error) {
        results.push({
          id: note.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Output results
    if (options.json) {
      console.log(JSON.stringify({ results }, null, 2));
    } else {
      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      if (succeeded.length > 0) {
        console.log(chalk.green(`✓ Archived ${succeeded.length} note(s):`));
        succeeded.forEach((r) => console.log(chalk.gray(`  - ${r.id}`)));
      }

      if (failed.length > 0) {
        console.log(chalk.red(`✗ Failed to archive ${failed.length} note(s):`));
        failed.forEach((r) => console.log(chalk.red(`  - ${r.id}: ${r.error}`)));
      }
    }
  }
}
