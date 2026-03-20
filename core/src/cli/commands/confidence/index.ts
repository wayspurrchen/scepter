/**
 * Confidence command group for SCEpter.
 *
 * File-level confidence annotations: audit and mark subcommands.
 *
 * @implements {R004.§7.AC.01} Register audit subcommand
 * @implements {R004.§7.AC.02} Register mark subcommand
 */

import { Command } from 'commander';
import { auditCommand } from './audit-command.js';
import { markCommand } from './mark-command.js';

/**
 * Main confidence command that groups confidence subcommands.
 */
export const confidenceCommand = new Command('confidence')
  .description('File-level confidence annotations: audit and mark');

confidenceCommand.addCommand(auditCommand);
confidenceCommand.addCommand(markCommand);
