import { Command } from 'commander';
import chalk from 'chalk';
import { deleteType, type DeleteOptions } from './delete-handler.js';

export const deleteCommand = new Command('delete')
  .description('Delete a note type')
  .argument('<name>', 'Type name to delete')
  .option('--strategy <strategy>', 'How to handle existing notes: block, archive, move-to-uncategorized (default: block)', 'block')
  .option('--target-type <type>', 'Target type when using move strategy')
  .option('--dry-run', 'Show what would be deleted without making changes')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (name: string, options: DeleteOptions & { projectDir?: string }) => {
    try {
      const projectPath = options.projectDir || process.cwd();
      const result = await deleteType(name, options, projectPath);
      
      if (options.dryRun) {
        console.log(chalk.yellow('DRY RUN - No changes were made'));
      }
      
      if (!result.executed && result.changes.notesAffected > 0) {
        console.log(chalk.red(`Cannot delete type '${name}' - it has ${result.changes.notesAffected} notes`));
        console.log(chalk.gray('Use --strategy=archive or --strategy=move-to-uncategorized to handle existing notes'));
        process.exit(1);
      }
      
      console.log(chalk.green(`Successfully ${options.dryRun ? 'would delete' : 'deleted'} type '${chalk.cyan(name)}'`));
      
      // Show summary
      if (result.changes.notesAffected > 0) {
        console.log(chalk.gray(`\nNotes handled: ${result.changes.notesAffected}`));
        if (result.strategy === 'archive') {
          console.log(chalk.gray(`  Strategy: Archived all notes`));
        } else if (result.strategy === 'move-to-uncategorized') {
          console.log(chalk.gray(`  Strategy: Moved to ${options.targetType || 'Uncategorized'}`));
        }
      }
      
      if (result.changes.foldersRemoved > 0) {
        console.log(chalk.gray(`Folders removed: ${result.changes.foldersRemoved}`));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });