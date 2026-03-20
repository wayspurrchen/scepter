#!/usr/bin/env node

/**
 * @implements {R004.§7.AC.01} Register confidence audit command in CLI
 * @implements {R004.§7.AC.02} Register confidence mark command in CLI
 */

import { Command } from 'commander';
// Old commands removed - use context subcommands instead
import { contextCommand } from './commands/context/index.js';
import { typesCommand } from './commands/types/index.js';
import { initCommand } from './commands/init.js';
import { scaffoldCommand } from './commands/scaffold.js';
import { createConfigCommand } from './commands/config.js';
import { claimsCommand } from './commands/claims/index.js';
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
program.addCommand(scaffoldCommand);
program.addCommand(contextCommand);
program.addCommand(typesCommand);
program.addCommand(claimsCommand);
program.addCommand(confidenceCommand);
program.addCommand(createConfigCommand());

// Enable context subcommands as top-level shortcuts.
// e.g., `scepter create Decision "Title"` works like `scepter ctx create Decision "Title"`
// This eliminates the most common CLI mistake where agents/users omit the `ctx` prefix.
const contextSubNames = new Set(contextCommand.commands.map((c: Command) => c.name()));
const topLevelNames = new Set(program.commands.flatMap((c: Command) => [c.name(), ...c.aliases()]));

let cmdArgIndex = 2;
while (cmdArgIndex < process.argv.length) {
  const arg = process.argv[cmdArgIndex];
  if (arg === '--' || !arg.startsWith('-')) break;
  if (arg === '--project-dir') {
    cmdArgIndex += 2; // skip option and its value
    continue;
  }
  cmdArgIndex++;
}

if (cmdArgIndex < process.argv.length) {
  const firstArg = process.argv[cmdArgIndex];
  if (contextSubNames.has(firstArg) && !topLevelNames.has(firstArg)) {
    process.argv.splice(cmdArgIndex, 0, 'ctx');
  }
}

// Parse command line arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
