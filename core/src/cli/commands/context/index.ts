import { Command } from 'commander';
import { showCommand } from './show';
import { listCommand } from './list';
import { createCommand } from './create';
import { searchCommand } from './search';
import { gatherCommand } from './gather';
import { archiveCommand } from './archive';
import { deleteCommand } from './delete';
import { restoreCommand } from './restore';
import { purgeCommand } from './purge';
import { convertCommand } from './convert';
import { xrefSourcesCommand } from './xref-sources';
import { ingestCommand } from './ingest';

/**
 * Main context command that groups all context-related subcommands
 */
export const contextCommand = new Command('context')
  .description('Manage and query notes in the knowledge base')
  .alias('ctx');

// Add implemented subcommands
contextCommand.addCommand(showCommand);
contextCommand.addCommand(listCommand);
contextCommand.addCommand(createCommand);
contextCommand.addCommand(searchCommand);
contextCommand.addCommand(gatherCommand);

// Archive/Delete commands
contextCommand.addCommand(archiveCommand);
contextCommand.addCommand(deleteCommand);
contextCommand.addCommand(restoreCommand);
contextCommand.addCommand(purgeCommand);

// Conversion commands
contextCommand.addCommand(convertCommand);

// Cross-reference audit
contextCommand.addCommand(xrefSourcesCommand);

// Ingestion
contextCommand.addCommand(ingestCommand);


