/**
 * @implements {C002} Init Command - Boilerplate Initialization
 * @implements {F002} Agent Instructions Auto-Copy on Init
 * @depends-on {D002} CLI-First Architecture Pivot
 */
import { Command } from 'commander';
import fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the package root directory by looking for package.json
 */
function findPackageRoot(startPath: string): string {
  let currentPath = startPath;
  
  // Traverse up the directory tree
  while (currentPath !== path.dirname(currentPath)) {
    const packageJsonPath = path.join(currentPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = fs.readJsonSync(packageJsonPath);
        // Verify this is the scepter package
        if (packageJson.name === 'scepter') {
          return currentPath;
        }
      } catch {
        // Continue searching if we can't read the package.json
      }
    }
    currentPath = path.dirname(currentPath);
  }
  
  // Fallback to relative path from compiled location
  // This handles the case where we're running from dist/
  return path.resolve(__dirname, '../..');
}

export const initCommand = new Command('init')
  .description('Initialize a SCEpter project from a boilerplate template')
  .argument('[template]', 'Name of the boilerplate template to use')
  .option('-t, --target <path>', 'Target directory (defaults to current directory)', '.')
  .option('-l, --list', 'List available boilerplate templates')
  .option('--force', 'Overwrite existing files')
  .action(async (templateName: string | undefined, options) => {
    try {
      // Find boilerplates directory from the package root
      const packageRoot = findPackageRoot(__dirname);
      const boilerplatesDir = path.join(packageRoot, 'core', 'boilerplates');
      
      // List mode
      if (options.list || !templateName) {
        await listBoilerplates(boilerplatesDir);
        return;
      }

      // Copy mode
      await copyBoilerplate(boilerplatesDir, templateName, options.target, options.force);

    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * List all available boilerplate templates
 */
async function listBoilerplates(boilerplatesDir: string): Promise<void> {
  if (!await fs.pathExists(boilerplatesDir)) {
    console.error(chalk.red('Error: Boilerplates directory not found'));
    return;
  }

  const entries = await fs.readdir(boilerplatesDir, { withFileTypes: true });
  const boilerplates = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

  if (boilerplates.length === 0) {
    console.log(chalk.yellow('No boilerplate templates found.'));
    return;
  }

  console.log(chalk.blue('\nAvailable SCEpter boilerplate templates:\n'));
  
  for (const name of boilerplates) {
    const boilerplatePath = path.join(boilerplatesDir, name);
    
    // Try to read a description from README or config
    let description = '';
    const readmePath = path.join(boilerplatePath, 'README.md');
    const configPath = path.join(boilerplatePath, '_scepter', 'scepter.config.json');
    
    if (await fs.pathExists(readmePath)) {
      const content = await fs.readFile(readmePath, 'utf-8');
      const firstLine = content.split('\n')[0];
      if (firstLine.startsWith('# ')) {
        description = firstLine.substring(2);
      }
    } else if (await fs.pathExists(configPath)) {
      try {
        const config = await fs.readJson(configPath);
        description = config.project?.description || config.project?.name || '';
      } catch {
        // Ignore config read errors
      }
    }

    console.log(chalk.green(`  ${name}`));
    if (description) {
      console.log(chalk.gray(`    ${description}`));
    }
    
    // Show structure preview
    const noteTypes = await getBoilerplateNoteTypes(boilerplatePath);
    if (noteTypes.length > 0) {
      console.log(chalk.gray(`    Note types: ${noteTypes.join(', ')}`));
    }
    
    console.log(); // Empty line between templates
  }

  console.log(chalk.blue('Usage:'));
  console.log(chalk.white('  scepter init <template-name> [--target ./my-project]'));
  console.log();
  console.log(chalk.blue('Example:'));
  console.log(chalk.white('  scepter init standard-project --target ./my-new-project'));
}

/**
 * Copy a boilerplate template to the target directory
 * @implements {F002} Agent Instructions Auto-Copy on Init
 * @depends-on {D002} CLI-First Architecture Pivot
 */
async function copyBoilerplate(
  boilerplatesDir: string,
  templateName: string,
  targetPath: string,
  force: boolean
): Promise<void> {
  const sourcePath = path.join(boilerplatesDir, templateName);
  const absoluteTarget = path.resolve(targetPath);

  // Validate source exists
  if (!await fs.pathExists(sourcePath)) {
    console.error(chalk.red(`Error: Boilerplate template '${templateName}' not found.`));
    console.error(chalk.yellow('\nRun `scepter init --list` to see available templates.'));
    process.exit(1);
  }

  // Check if target exists
  if (await fs.pathExists(absoluteTarget)) {
    const files = await fs.readdir(absoluteTarget);
    if (files.length > 0 && !force) {
      console.error(chalk.red(`Error: Target directory '${absoluteTarget}' is not empty.`));
      console.error(chalk.yellow('\nUse --force to overwrite existing files.'));
      process.exit(1);
    }
  }

  // Create target directory
  await fs.ensureDir(absoluteTarget);

  console.log(chalk.blue(`\nInitializing SCEpter project from '${templateName}' template...`));
  console.log(chalk.gray(`Source: ${sourcePath}`));
  console.log(chalk.gray(`Target: ${absoluteTarget}`));
  console.log();

  // Copy files
  try {
    await copyDirectory(sourcePath, absoluteTarget, force);
    
    // Copy _prompts directory from boilerplates directory
    // Feature {F002}: Ensures AI agents have immediate access to SCEpter instructions
    const promptsSource = path.join(boilerplatesDir, '_prompts');
    const promptsTarget = path.join(absoluteTarget, '_scepter', '_prompts');

    if (await fs.pathExists(promptsSource)) {
      await fs.ensureDir(path.join(absoluteTarget, '_scepter'));

      // Check if target exists AND is not empty
      const targetExists = await fs.pathExists(promptsTarget);
      const targetIsEmpty = targetExists ? await isDirectoryEmpty(promptsTarget) : true;

      if (!force && targetExists && !targetIsEmpty) {
        console.log(chalk.yellow(`  ⚠️  Skipping existing directory: _scepter/_prompts/`));
      } else {
        // Ensure target directory exists before copying
        await fs.ensureDir(promptsTarget);
        await copyDirectory(promptsSource, promptsTarget, force);
        console.log(chalk.green(`  ✓ Created: _scepter/_prompts/ with SCEpter instructions`));
      }
    }
    
    // Also check for legacy AGENT_SCEPTER_INSTRUCTIONS.md for backward compatibility
    const legacyInstructionsSource = path.join(boilerplatesDir, 'AGENT_SCEPTER_INSTRUCTIONS.md');
    if (await fs.pathExists(legacyInstructionsSource)) {
      const legacyTarget = path.join(absoluteTarget, 'AGENT_SCEPTER_INSTRUCTIONS.md');
      if (!await fs.pathExists(promptsSource)) {
        // Only copy legacy file if new prompts directory doesn't exist
        if (!force && await fs.pathExists(legacyTarget)) {
          console.log(chalk.yellow(`  ⚠️  Skipping existing file: AGENT_SCEPTER_INSTRUCTIONS.md`));
        } else {
          await fs.copyFile(legacyInstructionsSource, legacyTarget);
          console.log(chalk.green(`  ✓ Created: AGENT_SCEPTER_INSTRUCTIONS.md (legacy)`));
        }
      }
    }
    
    console.log(chalk.green('\n✅ Project initialized successfully!'));
    
    // Show next steps
    console.log(chalk.blue('\nNext steps:'));
    if (targetPath !== '.') {
      console.log(chalk.white(`  cd ${path.relative(process.cwd(), absoluteTarget)}`));
    }
    console.log(chalk.white('  scepter scaffold    # Create project structure from config'));
    console.log(chalk.white('  scepter context list    # View all notes'));
    console.log(chalk.white('  scepter context show --help    # Learn more commands'));
    
    // Check if there's a project-specific README
    const projectReadme = path.join(absoluteTarget, 'README.md');
    if (await fs.pathExists(projectReadme)) {
      console.log(chalk.gray('\nSee README.md for project-specific instructions.'));
    }
    
  } catch (error) {
    console.error(chalk.red('\nError copying template:'), error);
    process.exit(1);
  }
}

/**
 * Check if a directory is empty (contains no files or subdirectories)
 */
async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.length === 0;
  } catch {
    return true; // If we can't read it, treat as empty
  }
}

/**
 * Recursively copy directory with progress logging
 */
async function copyDirectory(src: string, dest: string, force: boolean): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await fs.ensureDir(destPath);
      await copyDirectory(srcPath, destPath, force);
    } else {
      if (!force && await fs.pathExists(destPath)) {
        console.log(chalk.yellow(`  ⚠️  Skipping existing file: ${path.relative(dest, destPath)}`));
      } else {
        await fs.copyFile(srcPath, destPath);
        console.log(chalk.green(`  ✓ Created: ${path.relative(dest, destPath)}`));
      }
    }
  }
}

/**
 * Get note types from a boilerplate
 */
async function getBoilerplateNoteTypes(boilerplatePath: string): Promise<string[]> {
  // Try to read from config first
  const configPath = path.join(boilerplatePath, '_scepter', 'scepter.config.json');
  if (await fs.pathExists(configPath)) {
    try {
      const config = await fs.readJson(configPath);
      if (config.noteTypes && typeof config.noteTypes === 'object') {
        return Object.keys(config.noteTypes);
      }
    } catch {
      // Fall through to directory reading
    }
  }
  
  // Fall back to reading directories
  const notesPath = path.join(boilerplatePath, '_scepter', 'notes');
  if (!await fs.pathExists(notesPath)) {
    return [];
  }
  
  try {
    const entries = await fs.readdir(notesPath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('_'))
      .map(e => e.name);
  } catch {
    return [];
  }
}
