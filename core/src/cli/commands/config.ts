import { Command } from 'commander';
import { ProjectManager } from '../../project/project-manager';
import { ConfigDisplayHandler } from './config-display-handler';
import chalk from 'chalk';

export function createConfigCommand(): Command {
  return new Command('config')
    .description('Display current SCEpter configuration')
    .option('--note-types', 'Show only note types configuration')
    .option('--paths', 'Show only paths configuration')
    .option('--source', 'Show only source code integration configuration')
    .option('--json', 'Output in JSON format')
    .option('--yaml', 'Output in YAML format')
    .action(async (options: any) => {
      try {
        const projectPath = options.projectDir || process.cwd();
        
        // Find project root
        const projectRoot = await ProjectManager.findProjectRoot(projectPath);
        if (!projectRoot) {
          console.error(chalk.red('Error: Not in a SCEpter project directory'));
          console.error(chalk.gray('Run this command from within a SCEpter project or use --project-dir'));
          process.exit(1);
        }
        
        // Initialize project manager
        const projectManager = new ProjectManager(projectRoot);
        
        // Load config from filesystem first
        await projectManager.configManager.loadConfigFromFilesystem();
        
        await projectManager.initialize();
        
        // Create and execute handler
        const handler = new ConfigDisplayHandler(projectManager);
        await handler.execute(options);
        
        // Cleanup
        await projectManager.cleanup();
      } catch (error) {
        console.error(chalk.red('Error displaying configuration:'), error);
        process.exit(1);
      }
    });
}