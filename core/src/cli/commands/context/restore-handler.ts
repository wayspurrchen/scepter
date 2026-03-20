import chalk from 'chalk';
import { formatTable } from '../../formatters/table-formatter.js';
import type { Note } from '../../../types/note.js';
import type { CommandContext } from '../base-command.js';

export interface RestoreOptions {
  projectDir?: string;  // Optional since projectManager is provided via context
  force?: boolean;
  json?: boolean;
}

export class RestoreHandler {
  async execute(noteIds: string[], options: RestoreOptions, context: CommandContext): Promise<void> {
    const { projectManager, projectPath } = context;
    const noteManager = projectManager.noteManager;
    
    if (!noteManager) {
      throw new Error('Note manager not initialized');
    }

      // Find notes to restore (check both archived and deleted)
      const notesToRestore: Array<{ note: Note; isArchived: boolean; isDeleted: boolean }> = [];
      const notFound: string[] = [];
      
      for (const noteId of noteIds) {
        // Check archived
        let result = await noteManager.getNotes({ 
          ids: [noteId], 
          includeArchived: true,
          includeDeleted: false 
        });
        
        if (result.notes.length > 0 && result.notes[0].tags.includes('archived')) {
          notesToRestore.push({ 
            note: result.notes[0], 
            isArchived: true, 
            isDeleted: false 
          });
          continue;
        }
        
        // Check deleted
        result = await noteManager.getNotes({ 
          ids: [noteId], 
          includeArchived: false,
          includeDeleted: true 
        });
        
        if (result.notes.length > 0 && result.notes[0].tags.includes('deleted')) {
          notesToRestore.push({ 
            note: result.notes[0], 
            isArchived: false, 
            isDeleted: true 
          });
          continue;
        }
        
        // Check if it's active (not archived/deleted)
        result = await noteManager.getNotes({ ids: [noteId] });
        if (result.notes.length > 0) {
          notesToRestore.push({ 
            note: result.notes[0], 
            isArchived: false, 
            isDeleted: false 
          });
        } else {
          notFound.push(noteId);
        }
      }
      
      if (notFound.length > 0) {
        console.error(chalk.red(`Notes not found: ${notFound.join(', ')}`));
        if (notesToRestore.length === 0) {
          process.exit(1);
        }
      }
      
      // Filter out notes that don't need restoration
      const activeNotes = notesToRestore.filter(n => !n.isArchived && !n.isDeleted);
      const restorable = notesToRestore.filter(n => n.isArchived || n.isDeleted);
      
      if (activeNotes.length > 0 && !options.json) {
        console.log(chalk.yellow('The following notes are already active:'));
        activeNotes.forEach(({ note }) => {
          console.log(chalk.gray(`  - ${note.id}: ${note.title}`));
        });
      }
      
      if (restorable.length === 0) {
        if (!options.json) {
          console.log(chalk.yellow('No notes to restore.'));
        } else {
          console.log(JSON.stringify({ results: [] }, null, 2));
        }
        return;
      }
      
      // Show what will be restored
      if (!options.force && !options.json) {
        console.log(chalk.yellow('\nThe following notes will be restored:'));
        const notesToShow = restorable.map(r => r.note);
        console.log(formatTable(notesToShow));
        
        const archivedCount = restorable.filter(r => r.isArchived).length;
        const deletedCount = restorable.filter(r => r.isDeleted).length;
        
        if (archivedCount > 0) {
          console.log(chalk.gray(`  ${archivedCount} archived note(s)`));
        }
        if (deletedCount > 0) {
          console.log(chalk.gray(`  ${deletedCount} deleted note(s) - #deleted tags will be removed from references`));
        }
        
        // Ask for confirmation
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise<string>((resolve) => {
          rl.question(chalk.cyan('Continue? (y/N) '), resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== 'y') {
          console.log(chalk.gray('Restore cancelled'));
          return;
        }
      }
      
      // Restore each note
      const results: Array<{ id: string; success: boolean; error?: string; wasArchived?: boolean; wasDeleted?: boolean }> = [];
      
      for (const { note, isArchived, isDeleted } of restorable) {
        try {
          await noteManager.restoreNote(note.id);
          results.push({ 
            id: note.id, 
            success: true,
            wasArchived: isArchived,
            wasDeleted: isDeleted
          });
        } catch (error) {
          results.push({ 
            id: note.id, 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      }
      
      // Output results
      if (options.json) {
        console.log(JSON.stringify({ results }, null, 2));
      } else {
        const succeeded = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        if (succeeded.length > 0) {
          console.log(chalk.green(`✓ Restored ${succeeded.length} note(s):`));
          succeeded.forEach(r => {
            const status = r.wasArchived ? 'archived' : 'deleted';
            console.log(chalk.gray(`  - ${r.id} (was ${status})`));
          });
        }
        
        if (failed.length > 0) {
          console.log(chalk.red(`✗ Failed to restore ${failed.length} note(s):`));
          failed.forEach(r => console.log(chalk.red(`  - ${r.id}: ${r.error}`)));
        }
      }
  }
}