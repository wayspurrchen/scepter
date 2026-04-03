import { createFilesystemProject } from '../../storage/filesystem/create-filesystem-project.js';
import type { ProjectManager } from '../../project/project-manager.js';
import chalk from 'chalk';

export interface CommandContext {
  projectManager: ProjectManager;
  projectPath: string;
}

export interface CommandSetupOptions {
  projectDir?: string;
  requireNoteManager?: boolean;
  startWatching?: boolean;
  includeArchived?: boolean;
  includeDeleted?: boolean;
}

/**
 * Base command setup utility
 * Handles common initialization and cleanup for CLI commands
 *
 * @implements {DD010.§DC.15} BaseCommand uses createFilesystemProject() factory
 */
export class BaseCommand {
  /**
   * Setup command context with proper initialization
   */
  static async setup(options: CommandSetupOptions): Promise<CommandContext> {
    const projectPath = options.projectDir || process.cwd();
    const projectManager = await createFilesystemProject(projectPath);

    // Initialize the project with archive/delete options if needed
    await projectManager.initialize({
      includeArchived: options.includeArchived,
      includeDeleted: options.includeDeleted,
    });

    // Start watching if needed
    if (options.startWatching && projectManager.noteManager) {
      await projectManager.noteManager.startWatching();
    }

    // Validate required services
    if (options.requireNoteManager && !projectManager.noteManager) {
      throw new Error('Note manager not initialized');
    }

    return {
      projectManager,
      projectPath,
    };
  }

  /**
   * Execute a command with automatic setup and cleanup
   */
  static async execute<T>(
    options: CommandSetupOptions,
    handler: (context: CommandContext) => Promise<T>
  ): Promise<T> {
    const context = await this.setup(options);

    try {
      return await handler(context);
    } finally {
      await context.projectManager.cleanup();
    }
  }

  /**
   * Standard error handler for commands
   */
  static handleError(error: unknown): never {
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
