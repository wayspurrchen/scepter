#!/usr/bin/env node

/**
 * @implements {R004.§7.AC.01} Register confidence audit command in CLI
 * @implements {R004.§7.AC.02} Register confidence mark command in CLI
 * @implements {DD006.§3.DC.01} Flatten command registration — import each command individually
 * @implements {DD006.§3.DC.02} Register former context subcommands directly on program
 * @implements {DD006.§3.DC.03} Register former claims subcommands directly on program
 * @implements {DD006.§3.DC.04} Delete argv-splicing hack
 * @implements {DD006.§3.DC.05} Hidden context/ctx backward-compat alias
 * @implements {DD006.§3.DC.06} Hidden claims backward-compat alias
 * @implements {DD006.§3.DC.07} Hidden notes backward-compat alias
 * @implements {DD006.§3.DC.08} Deprecation notice on alias use
 * @implements {DD006.§3.DC.09} Custom help formatter with grouped sections
 */

import { Command, Help } from 'commander';

// Direct context command imports {DD006.§3.DC.02}
import { showCommand } from './commands/context/show.js';
import { listCommand } from './commands/context/list.js';
import { createCommand } from './commands/context/create.js';
import { searchCommand } from './commands/context/search.js';
import { gatherCommand } from './commands/context/gather.js';
import { archiveCommand } from './commands/context/archive.js';
import { deleteCommand } from './commands/context/delete.js';
import { restoreCommand } from './commands/context/restore.js';
import { purgeCommand } from './commands/context/purge.js';
import { convertCommand } from './commands/context/convert.js';
import { ingestCommand } from './commands/context/ingest.js';

// Direct claims command imports {DD006.§3.DC.03}
// Note: scaffoldCommand, indexCommand, and claims searchCommand are NOT registered (being removed/absorbed)
import { traceCommand } from './commands/claims/trace-command.js';
import { gapsCommand } from './commands/claims/gaps-command.js';
import { lintCommand } from './commands/claims/lint-command.js';
import { verifyCommand } from './commands/claims/verify-command.js';
import { staleCommand } from './commands/claims/stale-command.js';
import { threadCommand } from './commands/claims/thread-command.js';
// @implements {DD014.§3.DC.24} `meta` subcommand group registered at top level
import { metaCommand } from './commands/claims/meta/index.js';

// Remaining top-level commands
import { typesCommand } from './commands/types/index.js';
import { initCommand } from './commands/init.js';

import { createConfigCommand } from './commands/config.js';
import { confidenceCommand } from './commands/confidence/index.js';
import path from 'path';

const program = new Command();

program
  .name('scepter')
  .description('SCEpter: Software Composition Environment CLI')
  .version('0.1.0')
  .option('--project-dir <path>', 'Project directory to run in', process.cwd());

// Store the project directory in a way that child commands can access
program.hook('preAction', (thisCommand, actionCommand) => {
  const projectDir = thisCommand.opts().projectDir;
  // Only set projectDir if it's not already set (to avoid doubling)
  if (!actionCommand.opts().projectDir) {
    // Make project directory absolute
    const absoluteProjectDir = path.isAbsolute(projectDir) ? projectDir : path.resolve(process.cwd(), projectDir);
    // Pass it down to all subcommands
    actionCommand.setOptionValue('projectDir', absoluteProjectDir);
  }
});

// Add commands
program.addCommand(initCommand);
program.addCommand(typesCommand);
program.addCommand(confidenceCommand);
program.addCommand(createConfigCommand());

// Context commands at top level {DD006.§3.DC.02}
program.addCommand(showCommand);
program.addCommand(listCommand);
program.addCommand(createCommand);
program.addCommand(searchCommand);
program.addCommand(gatherCommand);
program.addCommand(archiveCommand);
program.addCommand(deleteCommand);
program.addCommand(restoreCommand);
program.addCommand(purgeCommand);
program.addCommand(convertCommand);
program.addCommand(ingestCommand);

// Claims commands at top level {DD006.§3.DC.03}
program.addCommand(traceCommand);
program.addCommand(gapsCommand);
program.addCommand(lintCommand);
program.addCommand(verifyCommand);
program.addCommand(staleCommand);
program.addCommand(threadCommand);
program.addCommand(metaCommand);

// Backward-compatible hidden aliases {DD006.§3.DC.05}, {DD006.§3.DC.06}, {DD006.§3.DC.07}
// These intercept old-style `scepter ctx <cmd>`, `scepter claims <cmd>`, `scepter notes <cmd>`
// and re-dispatch to the top-level command with a deprecation notice.
function createBackwardCompatAlias(name: string, ...aliases: string[]) {
  const cmd = program
    .command(name, { hidden: true })
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async (_options: Record<string, unknown>, command: Command) => {
      const args = command.args;
      if (args.length === 0) {
        console.error('Usage: scepter <command> [options]');
        process.exit(1);
      }
      // Deprecation notice {DD006.§3.DC.08}
      if (process.env.SCEPTER_NO_DEPRECATION_WARNINGS !== '1') {
        const usedName = aliases.find(a => process.argv.includes(a)) ?? name;
        process.stderr.write(
          `Note: 'scepter ${usedName} ${args[0]}' is deprecated. Use 'scepter ${args[0]}' directly.\n`
        );
      }
      // Re-dispatch to the top-level command
      await program.parseAsync(args, { from: 'user' });
    });
  for (const alias of aliases) {
    cmd.alias(alias);
  }
  return cmd;
}

createBackwardCompatAlias('context', 'ctx');
createBackwardCompatAlias('claims');
createBackwardCompatAlias('notes');

// Help output grouping {DD006.§3.DC.09}
const COMMAND_GROUPS: Record<string, string[]> = {
  'Note CRUD': ['create', 'show', 'list', 'search', 'delete', 'archive', 'restore', 'purge', 'convert', 'ingest'],
  'Connection Understanding': ['trace', 'thread', 'gather', 'gaps'],
  'Quality and Hygiene': ['lint', 'verify', 'stale'],
  'Configuration': ['types', 'confidence', 'config', 'init'],
};

program.configureHelp({
  formatHelp(cmd: Command, helper: Help): string {
    const termWidth = helper.padWidth(cmd, helper);
    const helpWidth = helper.helpWidth || 80;
    const itemIndentWidth = 2;
    const itemSeparatorWidth = 2;

    function formatItem(term: string, description: string): string {
      if (description) {
        const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
        return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth);
      }
      return term;
    }
    function formatList(textArray: string[]): string {
      return textArray.join('\n').replace(/^/gm, ' '.repeat(itemIndentWidth));
    }

    // Usage
    let output = [`Usage: ${helper.commandUsage(cmd)}`, ''];

    // Description
    const commandDescription = helper.commandDescription(cmd);
    if (commandDescription.length > 0) {
      output = output.concat([helper.wrap(commandDescription, helpWidth, 0), '']);
    }

    // Arguments
    const argumentList = helper.visibleArguments(cmd).map((argument) => {
      return formatItem(helper.argumentTerm(argument), helper.argumentDescription(argument));
    });
    if (argumentList.length > 0) {
      output = output.concat(['Arguments:', formatList(argumentList), '']);
    }

    // Options
    const optionList = helper.visibleOptions(cmd).map((option) => {
      return formatItem(helper.optionTerm(option), helper.optionDescription(option));
    });
    if (optionList.length > 0) {
      output = output.concat(['Options:', formatList(optionList), '']);
    }

    // Commands — grouped by COMMAND_GROUPS
    const visibleCmds = helper.visibleCommands(cmd);
    if (visibleCmds.length > 0) {
      // Build a lookup from command name to its formatted item
      const cmdMap = new Map<string, string>();
      const helpCmd: string[] = [];
      for (const sub of visibleCmds) {
        const item = formatItem(helper.subcommandTerm(sub), helper.subcommandDescription(sub));
        if (sub.name() === 'help') {
          helpCmd.push(item);
        } else {
          cmdMap.set(sub.name(), item);
        }
      }

      // Emit each group
      const placed = new Set<string>();
      for (const [groupName, cmdNames] of Object.entries(COMMAND_GROUPS)) {
        const groupItems: string[] = [];
        for (const name of cmdNames) {
          const item = cmdMap.get(name);
          if (item) {
            groupItems.push(item);
            placed.add(name);
          }
        }
        if (groupItems.length > 0) {
          output = output.concat([`${groupName}:`, formatList(groupItems), '']);
        }
      }

      // Any ungrouped commands go into "Other"
      const ungrouped: string[] = [];
      for (const [name, item] of cmdMap) {
        if (!placed.has(name)) {
          ungrouped.push(item);
        }
      }
      if (ungrouped.length > 0) {
        output = output.concat(['Other:', formatList(ungrouped), '']);
      }

      // help command at the end
      if (helpCmd.length > 0) {
        output = output.concat(helpCmd.map(h => ' '.repeat(itemIndentWidth) + h), ['']);
      }
    }

    return output.join('\n');
  },
});

// Parse command line arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
