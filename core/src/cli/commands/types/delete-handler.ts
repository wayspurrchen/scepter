import { ProjectManager } from '../../../project/project-manager.js';
import type { DeleteResult } from '../../../project/types.js';
import chalk from 'chalk';

export interface DeleteOptions {
  strategy?: 'block' | 'archive' | 'move-to-uncategorized';
  targetType?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export async function deleteType(
  name: string,
  options: DeleteOptions,
  projectPath: string
): Promise<DeleteResult> {
  const projectManager = new ProjectManager(projectPath);

  try {
    await projectManager.initialize();

    // For non-dry-run and non-yes, ask for confirmation
    if (!options.dryRun && !options.yes) {
      // Get type info to show what will be affected
      const types = await projectManager.listNoteTypes();
      const typeInfo = types.find(t => t.type === name);

      if (!typeInfo) {
        throw new Error(`Note type '${name}' not found`);
      }

      let message = `Delete note type '${name}'?`;
      if (typeInfo.noteCount > 0) {
        message += chalk.yellow(`\n  This type has ${typeInfo.noteCount} notes.`);
        if (options.strategy === 'archive') {
          message += chalk.gray('\n  Notes will be archived.');
        } else if (options.strategy === 'move-to-uncategorized') {
          message += chalk.gray(`\n  Notes will be moved to ${options.targetType || 'Uncategorized'}.`);
        } else {
          message += chalk.red('\n  Operation will be blocked due to existing notes.');
        }
      }

      // Ask for confirmation using readline
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const confirmed = await new Promise<boolean>((resolve) => {
        rl.question(message + ' (y/N) ', (answer) => {
          rl.close();
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
      });

      if (!confirmed) {
        throw new Error('Operation cancelled');
      }
    }

    return await projectManager.deleteNoteType(name, {
      strategy: options.strategy,
      targetType: options.targetType,
      dryRun: options.dryRun,
      skipConfirmation: true // We already confirmed above
    });
  } finally {
    // Always cleanup watchers, even on error
    await projectManager.cleanup();
  }
}