import chalk from 'chalk';
import type { Note } from '../../../types/note.js';
import type { CommandContext } from '../base-command.js';
import { runHardDelete } from '../../../lifecycle/operations/lifecycle-orchestrator.js';

export interface DeleteOptions {
  projectDir: string;
  reason?: string;
  force?: boolean;
  /** Hard-delete mode (rewrites inbound refs, removes note unit). */
  hard?: boolean;
  /** Hard-delete: dry-run, print plan only, no disk mutation. */
  dryRun?: boolean;
  /** Hard-delete: bypass the dirty-tree guard. */
  allowDirty?: boolean;
  json?: boolean;
}

/**
 * `scepter delete` handler. Routes to either the preserved soft-delete
 * code path (default) or the new hard-delete pipeline (under the
 * `--hard` flag).
 *
 * @implements {DD020.§4.DC.00} soft-delete preserved unchanged as default
 * @implements {DD020.§4.DC.01} hard-delete invokes removeNoteEntry (via orchestrator)
 * @implements {DD020.§4.DC.02} hard-delete invokes rewriter against every inbound reference
 * @implements {DD020.§4.DC.04} file removal + inbound rewrite staged together
 */
export class DeleteHandler {
  async execute(noteIds: string[], options: DeleteOptions, context: CommandContext): Promise<void> {
    if (options.hard) {
      await this.executeHardDelete(noteIds, options, context);
      return;
    }
    await this.executeSoftDelete(noteIds, options, context);
  }

  /**
   * Preserved soft-delete code path. Unchanged in semantics from the
   * pre-R015 implementation (modulo the Phase 4a folder-atomicity
   * refactor, which lives inside NoteFileManager).
   */
  private async executeSoftDelete(
    noteIds: string[],
    options: DeleteOptions,
    context: CommandContext,
  ): Promise<void> {
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

  /**
   * Hard-delete pipeline: dirty-tree guard, planRewrite over every
   * project file, stage edits + filesystem removal together, persist
   * the rewrite-log entry.
   */
  private async executeHardDelete(
    noteIds: string[],
    options: DeleteOptions,
    context: CommandContext,
  ): Promise<void> {
    const { projectManager, projectPath } = context;
    const noteManager = projectManager.noteManager;
    const fileManager = projectManager.noteFileManager;
    const configManager = projectManager.configManager;

    if (!noteManager || !fileManager || !configManager) {
      throw new Error('Managers not initialized');
    }

    const config = configManager.getConfig();

    // Validate all notes exist locally.
    const notFound: string[] = [];
    const resolved: string[] = [];
    for (const noteId of noteIds) {
      const layout = fileManager.resolveNoteLayout(noteId);
      if (!layout) {
        notFound.push(noteId);
      } else {
        resolved.push(noteId);
      }
    }
    if (notFound.length > 0) {
      console.error(chalk.red(`Notes not found: ${notFound.join(', ')}`));
      process.exit(1);
    }

    // For each note, run the hard-delete pipeline.
    const summaries: Array<{
      id: string;
      success: boolean;
      error?: string;
      dryRun?: boolean;
      filesModified?: number;
      warnings?: number;
      audits?: number;
      logPath?: string;
      removals?: string[];
    }> = [];

    for (const noteId of resolved) {
      try {
        const result = await runHardDelete({
          projectPath,
          config,
          fileManager,
          noteId,
          options: {
            dryRun: options.dryRun,
            allowDirty: options.allowDirty,
          },
        });

        if ('formatted' in result) {
          if (!options.json) {
            console.log(result.formatted);
          }
          summaries.push({ id: noteId, success: true, dryRun: true });
          continue;
        }

        summaries.push({
          id: noteId,
          success: true,
          filesModified: result.filesModified,
          warnings: result.warningCount,
          audits: result.auditCount,
          logPath: result.logPath,
          removals: result.removals,
        });
      } catch (err) {
        summaries.push({
          id: noteId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ results: summaries, mode: 'hard' }, null, 2));
      return;
    }

    if (options.dryRun) {
      // The formatted dry-run output was already printed above; nothing
      // more to summarize.
      return;
    }

    const succeeded = summaries.filter((s) => s.success);
    const failed = summaries.filter((s) => !s.success);

    if (succeeded.length > 0) {
      console.log(chalk.green(`✓ Hard-deleted ${succeeded.length} note(s):`));
      for (const s of succeeded) {
        console.log(chalk.gray(`  - ${s.id}`));
        if (s.filesModified !== undefined) {
          console.log(chalk.gray(`    Modified ${s.filesModified} file(s)`));
        }
        if (s.warnings && s.warnings > 0) {
          console.log(chalk.yellow(`    ${s.warnings} cross-project warning(s)`));
        }
        if (s.audits && s.audits > 0) {
          console.log(chalk.gray(`    ${s.audits} audit-only span(s)`));
        }
        if (s.logPath) {
          console.log(chalk.gray(`    Log: ${s.logPath}`));
        }
      }
    }

    if (failed.length > 0) {
      console.log(chalk.red(`✗ Failed to hard-delete ${failed.length} note(s):`));
      for (const s of failed) {
        console.log(chalk.red(`  - ${s.id}: ${s.error}`));
      }
      process.exitCode = 1;
    }
  }
}
