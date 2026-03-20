import { Command } from 'commander';
import chalk from 'chalk';
import { listTypes, type ListOptions } from './list-handler.js';

export const listCommand = new Command('list')
  .description('List all note types with their details')
  .option('--json', 'Output as JSON')
  .option('--stats', 'Include statistics for each type')
  .action(async (options: ListOptions & { projectDir?: string }) => {
    try {
      const projectPath = options.projectDir || process.cwd();
      const result = await listTypes(options, projectPath);
      
      console.log(result.output);
      
      if (result.typeCount === 0) {
        console.log(chalk.yellow('No note types found'));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });