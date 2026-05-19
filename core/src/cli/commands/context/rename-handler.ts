import chalk from 'chalk';
import type { CommandContext } from '../base-command.js';
import { runRename } from '../../../lifecycle/operations/lifecycle-orchestrator.js';
import { isValidNoteId } from '../../../parsers/note/shared-note-utils.js';
import { isDeletionMarker } from '../../../lifecycle/deletion-marker.js';

export interface RenameOptions {
  projectDir: string;
  /** Print the rewrite plan, do not mutate disk. */
  dryRun?: boolean;
  /** Bypass the dirty-tree guard. */
  allowDirty?: boolean;
  json?: boolean;
}

/**
 * Rename a note ID. Validates inputs, then routes through the
 * lifecycle orchestrator (which does dirty-tree guard, file
 * discovery, plan construction, staged commit, and log persistence).
 *
 * Rejections (per {DD020.§4.DC.11} and {DD020.§4.DC.20}):
 *  - target ID fails `isValidNoteId`
 *  - source ID equals target ID
 *  - target ID collides with another live note in the project
 *
 * Allowed (per {R015.§1.AC.05}):
 *  - target ID is a deletion-marker token for a previously-deleted note
 *    (the swap case is supported as two separate operations; we don't
 *    inspect rewrite-log history here, only the live note index)
 *
 * @implements {DD020.§4.DC.11} validates target via isValidNoteId; rejects live-note collision; permits previously-deleted ID
 * @implements {DD020.§4.DC.20} rejects source-equals-target
 * @implements {R015.§1.AC.02} rename primitive entry point
 */
export class RenameHandler {
  async execute(
    sourceId: string,
    targetId: string,
    options: RenameOptions,
    context: CommandContext,
  ): Promise<void> {
    const { projectManager, projectPath } = context;
    const noteManager = projectManager.noteManager;
    const fileManager = projectManager.noteFileManager;
    const configManager = projectManager.configManager;

    if (!noteManager || !fileManager || !configManager) {
      throw new Error('Managers not initialized');
    }

    // Validation gates.

    if (sourceId === targetId) {
      console.error(chalk.red(`Source ID and target ID are identical: ${sourceId}`));
      process.exit(1);
    }

    if (isDeletionMarker(targetId)) {
      console.error(
        chalk.red(
          `Target ID '${targetId}' is a deletion-marker shape, not a valid note ID.`,
        ),
      );
      process.exit(1);
    }

    if (!isValidNoteId(targetId)) {
      console.error(
        chalk.red(
          `Target ID '${targetId}' is not a valid note ID. Expected pattern: 1-5 uppercase letters followed by 3-5 digits.`,
        ),
      );
      process.exit(1);
    }

    if (!isValidNoteId(sourceId)) {
      console.error(
        chalk.red(
          `Source ID '${sourceId}' is not a valid note ID. Expected pattern: 1-5 uppercase letters followed by 3-5 digits.`,
        ),
      );
      process.exit(1);
    }

    const sourceLayout = fileManager.resolveNoteLayout(sourceId);
    if (!sourceLayout) {
      console.error(chalk.red(`Note not found: ${sourceId}`));
      process.exit(1);
    }

    // Collision: target must NOT be a live note in this project.
    const targetLayout = fileManager.resolveNoteLayout(targetId);
    if (targetLayout) {
      console.error(
        chalk.red(
          `Target ID '${targetId}' is already in use by a live note in this project.`,
        ),
      );
      process.exit(1);
    }

    const config = configManager.getConfig();

    try {
      const result = await runRename({
        projectPath,
        config,
        fileManager,
        sourceId,
        targetId,
        options: {
          dryRun: options.dryRun,
          allowDirty: options.allowDirty,
        },
      });

      if ('formatted' in result) {
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                dryRun: true,
                operation: result.plan.operation,
                fileCount: result.plan.fileEdits.length,
                warnings: result.plan.warnings.length,
                audits: result.plan.audits.length,
                renames: result.plan.renames,
                removals: result.plan.removals,
              },
              null,
              2,
            ),
          );
        } else {
          console.log(result.formatted);
        }
        return;
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              sourceId,
              targetId,
              filesModified: result.filesModified,
              warnings: result.warningCount,
              audits: result.auditCount,
              logPath: result.logPath,
              renames: result.renames,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(chalk.green(`✓ Renamed ${sourceId} → ${targetId}`));
      console.log(chalk.gray(`  Modified ${result.filesModified} file(s)`));
      if (result.warningCount > 0) {
        console.log(chalk.yellow(`  ${result.warningCount} cross-project warning(s)`));
      }
      if (result.auditCount > 0) {
        console.log(chalk.gray(`  ${result.auditCount} audit-only span(s)`));
      }
      if (result.renames.length > 0) {
        console.log(chalk.gray(`  Filesystem renames:`));
        for (const r of result.renames) {
          console.log(chalk.gray(`    ${r.from} → ${r.to}`));
        }
      }
      console.log(chalk.gray(`  Log: ${result.logPath}`));
    } catch (err) {
      console.error(chalk.red('Rename failed:'), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
}

