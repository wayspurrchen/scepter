import chalk from 'chalk';
import type { Note } from '../../../types/note.js';
import type { CommandContext } from '../base-command.js';

export interface DeleteOptions {
  projectDir: string;
  reason?: string;
  force?: boolean;
  json?: boolean;
}

export class DeleteHandler {
  async execute(noteIds: string[], options: DeleteOptions, context: CommandContext): Promise<void> {
    const { projectManager } = context;
    const noteManager = projectManager.noteManager;
    const referenceManager = projectManager.referenceManager;

    if (!noteManager || !referenceManager) {
      throw new Error('Managers not initialized');
    }

    // Validate all notes exist
    const notesToDelete: Note[] = [];
    const notFound: string[] = [];

    for (const noteId of noteIds) {
      const result = await noteManager.getNotes({ ids: [noteId] });
      if (result.notes.length === 0) {
        notFound.push(noteId);
      } else {
        notesToDelete.push(result.notes[0]);
      }
    }

    if (notFound.length > 0) {
      console.error(chalk.red(`Notes not found: ${notFound.join(', ')}`));
      process.exit(1);
    }

    // Check for incoming references
    const notesWithRefs: Array<{ note: Note; refCount: number }> = [];
    for (const note of notesToDelete) {
      const refs = referenceManager.getReferencesTo(note.id);
      if (refs.length > 0) {
        notesWithRefs.push({ note, refCount: refs.length });
      }
    }

    // Show what will be deleted
    if (!options.force && !options.json) {
      console.log(chalk.yellow('The following notes will be deleted:'));
      notesToDelete.forEach((note) => {
        console.log(chalk.gray(`  - ${note.id}: ${note.title}`));
      });

      if (notesWithRefs.length > 0) {
        console.log(chalk.yellow('\n⚠️  Warning: The following notes have incoming references:'));
        notesWithRefs.forEach(({ note, refCount }) => {
          console.log(chalk.yellow(`  - ${note.id}: ${refCount} reference(s)`));
        });
        console.log(chalk.yellow('References will be marked with #deleted tag.'));
      }

      // Ask for confirmation
      console.log(chalk.yellow('\nDeleted notes will be moved to _deleted folders.'));
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
        console.log(chalk.gray('Delete cancelled'));
        return;
      }
    }

    // Delete each note
    const results: Array<{ id: string; success: boolean; error?: string; refsUpdated?: number }> = [];

    for (const note of notesToDelete) {
      try {
        await noteManager.deleteNote(note.id, options.reason);
        const refs = referenceManager.getReferencesTo(note.id);
        results.push({
          id: note.id,
          success: true,
          refsUpdated: refs.length,
        });
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
        console.log(chalk.green(`✓ Deleted ${succeeded.length} note(s):`));
        succeeded.forEach((r) => {
          console.log(chalk.gray(`  - ${r.id}`));
          if (r.refsUpdated && r.refsUpdated > 0) {
            console.log(chalk.gray(`    Updated ${r.refsUpdated} reference(s)`));
          }
        });
      }

      if (failed.length > 0) {
        console.log(chalk.red(`✗ Failed to delete ${failed.length} note(s):`));
        failed.forEach((r) => console.log(chalk.red(`  - ${r.id}: ${r.error}`)));
      }
    }
  }
}
