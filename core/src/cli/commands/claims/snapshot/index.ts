/**
 * `scepter snapshot` subcommand group.
 *
 * Wires the five capture/management/diff subcommands: `save`, `list`,
 * `show`, `rm`, `diff`.
 *
 * The parent command is registered at the top level of the CLI program
 * (`program.addCommand(snapshotCommand)` at
 * `core/src/cli/index.ts`) per the DD006 flat-registration rule and
 * the DD014 `meta/` precedent.  The legacy form
 * `scepter claims snapshot <subcmd>` continues to work via the
 * existing `createBackwardCompatAlias('claims')` path.
 *
 * @implements {DD018.§3.DC.63} snapshotCommand barrel with five children including diff
 * @implements {DD018.§3.DC.64} CLI files nested under claims/snapshot/
 */

import { Command } from 'commander';
import { saveCommand } from './save-command.js';
import { listCommand } from './list-command.js';
import { showCommand } from './show-command.js';
import { rmCommand } from './rm-command.js';
import { diffCommand } from './diff-command.js';

export const snapshotCommand = new Command('snapshot').description(
  'Capture, manage, and diff claim-index snapshots',
);

snapshotCommand.addCommand(saveCommand);
snapshotCommand.addCommand(listCommand);
snapshotCommand.addCommand(showCommand);
snapshotCommand.addCommand(rmCommand);
snapshotCommand.addCommand(diffCommand);
