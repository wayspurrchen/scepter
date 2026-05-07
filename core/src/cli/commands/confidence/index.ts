/**
 * Confidence command group for SCEpter.
 *
 * File-level confidence annotations: audit, mark, and apply subcommands.
 *
 * @implements {R004.§7.AC.01} Register audit subcommand
 * @implements {R004.§7.AC.02} Register mark subcommand
 * @implements {R013.§3} Register apply subcommand
 * @implements {DD017.DC.29}
 */

import { Command } from 'commander';
import { auditCommand } from './audit-command.js';
import { markCommand } from './mark-command.js';
import { applyCommand } from './apply-command.js';

/**
 * Main confidence command that groups confidence subcommands.
 */
export const confidenceCommand = new Command('confidence')
  .description('File-level confidence annotations: audit, mark, and apply');

confidenceCommand.addCommand(auditCommand);
confidenceCommand.addCommand(markCommand);
confidenceCommand.addCommand(applyCommand);
