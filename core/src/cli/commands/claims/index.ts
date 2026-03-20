/**
 * @implements {R005.§3.AC.03} Register verify subcommand
 * @implements {R005.§4.AC.01} Register stale subcommand
 * @implements {R007.§5.AC.01} Register search subcommand
 */

import { Command } from 'commander';
import { indexCommand } from './index-command.js';
import { traceCommand } from './trace-command.js';
import { gapsCommand } from './gaps-command.js';
import { lintCommand } from './lint-command.js';
import { scaffoldCommand } from './scaffold-command.js';
import { verifyCommand } from './verify-command.js';
import { staleCommand } from './stale-command.js';
import { searchCommand } from './search-command.js';
import { threadCommand } from './thread-command.js';

/**
 * Main claims command that groups all claim-related subcommands.
 */
export const claimsCommand = new Command('claims')
  .description('Claim-level addressability: index, trace, lint, gap analysis, verification, search, and staleness');

claimsCommand.addCommand(indexCommand);
claimsCommand.addCommand(traceCommand);
claimsCommand.addCommand(gapsCommand);
claimsCommand.addCommand(lintCommand);
claimsCommand.addCommand(scaffoldCommand);
claimsCommand.addCommand(verifyCommand);
claimsCommand.addCommand(staleCommand);
claimsCommand.addCommand(searchCommand);
claimsCommand.addCommand(threadCommand);
