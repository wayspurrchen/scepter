import { ProjectManager } from '../../../project/project-manager.js';
import type { RenameResult, ProgressInfo } from '../../../project/types.js';
import chalk from 'chalk';

export interface RenameOptions {
  shortcode?: string;
  description?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export async function renameType(
  oldName: string,
  newName: string,
  options: RenameOptions,
  projectPath: string
): Promise<RenameResult> {
  const projectManager = new ProjectManager(projectPath);

  try {
    await projectManager.initialize();

    const handleProgress = (progress: ProgressInfo) => {
      if (!options.dryRun) {
        console.log(chalk.gray(`${progress.phase}: ${progress.current}/${progress.total} ${progress.currentFile || progress.message || ''}`));
      }
    };

    const result = await projectManager.renameNoteType(oldName, newName, {
      newShortcode: options.shortcode,
      newDescription: options.description,
      dryRun: options.dryRun,
      skipConfirmation: options.yes,
      onProgress: handleProgress
    });

    return result;
  } finally {
    // Always cleanup watchers, even on error
    await projectManager.cleanup();
  }
}