/**
 * `scepter meta` subcommand group: read and write claim metadata.
 *
 * Subcommands:
 *   - add CLAIM KEY=VALUE [...]      append `add` events
 *   - set CLAIM KEY=VALUE [...]      append `set` events (atomic replace)
 *   - unset CLAIM KEY [...]          clear named keys
 *   - clear CLAIM                    clear ALL keys on a claim
 *   - get CLAIM [KEY]                read folded state
 *   - log CLAIM                      read the event log
 *   - migrate-legacy                 one-shot migration from legacy verification.json
 *
 * @implements {R009.§2.AC.01} `meta` group with write subcommands
 * @implements {DD014.§3.DC.24} metaCommand barrel registers all six write/read commands plus migrate-legacy
 */

import { Command } from 'commander';
import { addCommand } from './add-command.js';
import { setCommand } from './set-command.js';
import { unsetCommand } from './unset-command.js';
import { clearCommand } from './clear-command.js';
import { getCommand } from './get-command.js';
import { logCommand } from './log-command.js';
import { migrateLegacyCommand } from './migrate-legacy-command.js';

export const metaCommand = new Command('meta')
  .description('Read and write claim metadata');

metaCommand.addCommand(addCommand);
metaCommand.addCommand(setCommand);
metaCommand.addCommand(unsetCommand);
metaCommand.addCommand(clearCommand);
metaCommand.addCommand(getCommand);
metaCommand.addCommand(logCommand);
metaCommand.addCommand(migrateLegacyCommand);
