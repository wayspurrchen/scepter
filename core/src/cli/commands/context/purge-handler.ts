import chalk from 'chalk';
import { formatTable } from '../../formatters/table-formatter.js';
import { parseNoteId } from '../../../parsers/note/shared-note-utils.js';
import type { Note } from '../../../types/note.js';
import type { CommandContext } from '../base-command.js';

export interface PurgeOptions {
  projectDir?: string; // Optional since projectManager is provided via context
  force?: boolean;
  json?: boolean;
}

export class PurgeHandler {
  async execute(noteIds: string[], options: PurgeOptions, context: CommandContext): Promise<void> {
    const { projectManager } = context;
    const noteManager = projectManager.noteManager;
    const noteFileManager = projectManager.noteFileManager;
    const referenceManager = projectManager.referenceManager;

    if (!noteManager || !noteFileManager || !referenceManager) {
      throw new Error('Managers not initialized');
    }

    // Filter noteIds to only valid note IDs (prevents shell wildcard expansion issues)
    const validNoteIds = noteIds.filter(id => {
      const parsed = parseNoteId(id);
      return parsed !== null;
    });

    // Log any invalid IDs that were filtered out
    const invalidIds = noteIds.filter(id => !validNoteIds.includes(id));
    if (invalidIds.length > 0 && !options.json) {
      console.log(chalk.gray(`Ignoring invalid arguments: ${invalidIds.join(', ')}`));
    }

    // If no valid IDs provided, show all deleted notes
    if (validNoteIds.length === 0) {
      const result = await noteManager.getNotes({
        includeDeleted: true,
      });
      
      const deletedNotes = result.notes.filter(note => note.tags.includes('deleted'));
      
      if (deletedNotes.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ message: 'No deleted notes found', count: 0 }, null, 2));
        } else {
          console.log(chalk.gray('No deleted notes found.'));
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ 
          deletedNotes: deletedNotes.map(n => ({ id: n.id, type: n.type, title: n.title })),
          count: deletedNotes.length 
        }, null, 2));
        return;
      }

      // Show all deleted notes
      console.log(chalk.yellow(`Found ${deletedNotes.length} deleted note(s):`));
      console.log(formatTable(deletedNotes));
      
      if (options.force) {
        // With --force, purge all without confirmation
        console.log(chalk.red('\n⚠️  Purging all deleted notes (--force specified)'));
        validNoteIds.push(...deletedNotes.map(n => n.id));
      } else {
        // Ask for confirmation to purge all
        console.log(chalk.red('\n⚠️  WARNING: This will permanently delete ALL deleted notes!'));
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(chalk.red('Type "PURGE ALL" to confirm: '), resolve);
        });
        rl.close();

        if (answer !== 'PURGE ALL') {
          console.log(chalk.gray('Purge cancelled'));
          return;
        }

        // Set noteIds to all deleted notes for processing below
        validNoteIds.push(...deletedNotes.map(n => n.id));
      }
    }

    // Find notes to purge (must be deleted)
    const notesToPurge: Note[] = [];
    const notDeleted: string[] = [];
    const notFound: string[] = [];

    for (const noteId of validNoteIds) {
      const result = await noteManager.getNotes({
        ids: [noteId],
        includeDeleted: true,
      });

      if (result.notes.length === 0) {
        notFound.push(noteId);
      } else if (!result.notes[0].tags.includes('deleted')) {
        notDeleted.push(noteId);
      } else {
        notesToPurge.push(result.notes[0]);
      }
    }

    if (notFound.length > 0) {
      console.error(chalk.red(`Notes not found: ${notFound.join(', ')}`));
    }

    if (notDeleted.length > 0) {
      console.error(chalk.red(`Notes not in deleted state: ${notDeleted.join(', ')}`));
      console.error(chalk.red('Only deleted notes can be purged. Use "delete" command first.'));
    }

    if (notesToPurge.length === 0) {
      process.exit(1);
    }

    // Check for incoming references
    const notesWithRefs: Array<{ note: Note; refCount: number }> = [];
    for (const note of notesToPurge) {
      const refs = referenceManager.getReferencesTo(note.id);
      if (refs.length > 0) {
        notesWithRefs.push({ note, refCount: refs.length });
      }
    }

    // Show what will be purged
    if (!options.force && !options.json) {
      console.log(chalk.red('⚠️  WARNING: This action cannot be undone!'));
      console.log(chalk.yellow('\nThe following notes will be permanently deleted:'));
      console.log(formatTable(notesToPurge));

      if (notesWithRefs.length > 0) {
        console.log(chalk.red('\n⚠️  Critical Warning: The following notes have incoming references:'));
        notesWithRefs.forEach(({ note, refCount }) => {
          console.log(chalk.red(`  - ${note.id}: ${refCount} reference(s) will become broken`));
        });
      }

      // Ask for confirmation with extra safety
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log(chalk.red('\nThis will permanently delete the files. They cannot be recovered.'));
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.red('Are you absolutely sure? Type "PURGE" to confirm: '), resolve);
      });
      rl.close();

      if (answer !== 'PURGE') {
        console.log(chalk.gray('Purge cancelled'));
        return;
      }
    }

    // Purge each note
    const results: Array<{ id: string; success: boolean; error?: string; brokenRefs?: number }> = [];

    for (const note of notesToPurge) {
      try {
        const refs = referenceManager.getReferencesTo(note.id);
        await noteFileManager.purgeNoteFile(note.id);

        // Remove from reference manager
        referenceManager.removeNote(note.id);

        results.push({
          id: note.id,
          success: true,
          brokenRefs: refs.length,
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
        console.log(chalk.green(`✓ Purged ${succeeded.length} note(s):`));
        succeeded.forEach((r) => {
          console.log(chalk.gray(`  - ${r.id}`));
          if (r.brokenRefs && r.brokenRefs > 0) {
            console.log(chalk.red(`    ⚠️  ${r.brokenRefs} broken reference(s)`));
          }
        });
      }

      if (failed.length > 0) {
        console.log(chalk.red(`✗ Failed to purge ${failed.length} note(s):`));
        failed.forEach((r) => console.log(chalk.red(`  - ${r.id}: ${r.error}`)));
      }
    }
  }
}
