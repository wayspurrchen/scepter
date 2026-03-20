import { Command } from 'commander';
import chalk from 'chalk';
import { renameType, type RenameOptions } from './rename-handler.js';

export const renameCommand = new Command('rename')
  .description('Rename a note type')
  .argument('<old>', 'Current type name')
  .argument('<new>', 'New type name')
  .option('-s, --shortcode <shortcode>', 'New shortcode (optional)')
  .option('-d, --description <description>', 'New description (optional)')
  .option('--dry-run', 'Show what would be changed without making changes')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (oldName: string, newName: string, options: RenameOptions & { projectDir?: string }) => {
    try {
      const projectPath = options.projectDir || process.cwd();
      const result = await renameType(oldName, newName, options, projectPath);
      
      if (options.dryRun) {
        console.log(chalk.yellow('DRY RUN - No changes were made'));
      }
      
      console.log(chalk.green(`Successfully ${options.dryRun ? 'would rename' : 'renamed'} type '${chalk.cyan(oldName)}' to '${chalk.cyan(newName)}'`));
      
      // Show summary of changes
      console.log(chalk.gray('\nChanges summary:'));
      console.log(chalk.gray(`  Notes updated: ${result.changes.noteRenames}`));
      console.log(chalk.gray(`  References updated: ${result.changes.referenceUpdates.totalReferences}`));
      console.log(chalk.gray(`  Template renamed: ${result.changes.templateRenames > 0 ? 'Yes' : 'No'}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });