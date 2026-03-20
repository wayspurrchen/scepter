import { Command } from 'commander';
import fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { ConfigManager } from '../../config/config-manager.js';
import type { SCEpterConfig } from '../../types/config.js';

export const scaffoldCommand = new Command('scaffold')
  .description('Create SCEpter directory structure based on configuration file')
  .option('-c, --config <path>', 'Path to scepter.config.json file', '_scepter/scepter.config.json')
  .option('--force', 'Overwrite existing directories')
  .action(async (options) => {
    try {
      const projectPath = process.cwd();
      const configPath = path.resolve(projectPath, options.config);

      // Check if config file exists
      if (!await fs.pathExists(configPath)) {
        console.error(chalk.red(`Error: Configuration file not found at ${configPath}`));
        console.error(chalk.yellow('\nThe scaffold command requires an existing scepter.config.json file.'));
        console.error(chalk.yellow('Use `scepter init <template>` to create a new project from a template.'));
        process.exit(1);
      }

      // Load and validate config
      let config: SCEpterConfig;
      try {
        const configContent = await fs.readFile(configPath, 'utf-8');
        config = JSON.parse(configContent);
      } catch (error) {
        console.error(chalk.red('Error: Invalid configuration file'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }

      // Validate config structure
      if (!config.noteTypes || typeof config.noteTypes !== 'object') {
        console.error(chalk.red('Error: Configuration must include noteTypes'));
        process.exit(1);
      }

      console.log(chalk.blue('\nScaffolding SCEpter project structure...\n'));

      // Create _scepter directory if it doesn't exist
      const scepterDir = path.join(projectPath, '_scepter');
      await fs.ensureDir(scepterDir);

      // Create note type directories under notesRoot (defaults to _scepter itself)
      const notesDir = path.resolve(projectPath, config.paths?.notesRoot || '_scepter');
      await fs.ensureDir(notesDir);

      for (const [typeName, typeConfig] of Object.entries(config.noteTypes)) {
        // Only create directories for types that have a folder defined
        if (!typeConfig.folder) continue;

        const typeDir = path.join(notesDir, typeConfig.folder);

        if (await fs.pathExists(typeDir) && !options.force) {
          console.log(chalk.yellow(`  ⚠️  Directory exists: ${path.relative(projectPath, typeDir)}`));
        } else {
          await fs.ensureDir(typeDir);
          console.log(chalk.green(`  ✓ Created: ${path.relative(projectPath, typeDir)}`));

          // Create .gitkeep to preserve empty directories
          const gitkeepPath = path.join(typeDir, '.gitkeep');
          if (!await fs.pathExists(gitkeepPath)) {
            await fs.writeFile(gitkeepPath, '');
          }
        }
      }


      // Copy AI instructions file if available
      // Try to find the boilerplates directory relative to this module
      const moduleDir = path.dirname(new URL(import.meta.url).pathname);
      const instructionsSource = path.join(moduleDir, '..', '..', '..', 'boilerplates', 'CLAUDE_SCEPTER_INSTRUCTIONS_V2.md');
      const instructionsDest = path.join(scepterDir, 'CLAUDE_SCEPTER_INSTRUCTIONS.md');
      
      try {
        if (await fs.pathExists(instructionsSource)) {
          await fs.copyFile(instructionsSource, instructionsDest);
          console.log(chalk.green(`  ✓ Created: ${path.relative(projectPath, instructionsDest)}`));
        }
      } catch (error) {
        // Silently skip if source file not found (e.g., in production builds)
      }


      console.log(chalk.green('\n✅ Project structure created successfully!\n'));

      // Show summary
      console.log(chalk.blue('Project structure:'));
      console.log(chalk.white(`  Note types: ${Object.keys(config.noteTypes).length}`));

      console.log(chalk.blue('\nNext steps:'));
      console.log(chalk.white('  scepter context list    # View all notes'));
      console.log(chalk.white('  scepter context create  # Create a new note'));

    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });