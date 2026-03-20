import { Command } from 'commander';
import chalk from 'chalk';
import { addType, type AddOptions } from './add-handler.js';

export const addCommand = new Command('add')
  .description('Add a new note type')
  .argument('<name>', 'Note type name')
  .argument('<shortcode>', 'Shortcode for the type (will be uppercased)')
  .option('-f, --folder <folder>', 'Custom folder name (defaults to lowercase type name)')
  .option('-d, --description <description>', 'Description of the note type')
  .action(async (name: string, shortcode: string, options: AddOptions & { projectDir?: string }) => {
    try {
      const projectPath = options.projectDir || process.cwd();
      const result = await addType(name, shortcode, options, projectPath);
      
      console.log(chalk.green(`Successfully added note type '${chalk.cyan(result.name)}'`));
      console.log(chalk.gray(`  Shortcode: ${result.shortcode}`));
      if (result.folder) {
        console.log(chalk.gray(`  Folder: ${result.folder}`));
      }
      if (result.description) {
        console.log(chalk.gray(`  Description: ${result.description}`));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });