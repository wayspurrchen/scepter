import { Command } from 'commander';
import { listCommand } from './list.js';
import { addCommand } from './add.js';
import { renameCommand } from './rename.js';
import { deleteCommand } from './delete.js';

/**
 * Main types command that groups all type-related subcommands
 */
export const typesCommand = new Command('types')
  .description('Manage note types in the knowledge base')
  .alias('type');

// Add subcommands
typesCommand.addCommand(listCommand);
typesCommand.addCommand(addCommand);
typesCommand.addCommand(renameCommand);
typesCommand.addCommand(deleteCommand);