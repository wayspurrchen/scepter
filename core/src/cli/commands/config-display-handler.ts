/**
 * @implements {T011} Phase 3 - CLI Integration for status sets display
 */
import type { ProjectManager } from '../../project/project-manager';
import type { SCEpterConfig, AllowedStatusesConfig } from '../../types/config';
import chalk from 'chalk';

export interface ConfigDisplayOptions {
  noteTypes?: boolean;
  paths?: boolean;
  source?: boolean;
  statusSets?: boolean; // @implements {T011.3.2} Display status sets
  json?: boolean;
  yaml?: boolean;
}

export class ConfigDisplayHandler {
  constructor(private projectManager: ProjectManager) {}

  async execute(options: ConfigDisplayOptions): Promise<void> {
    const config = this.projectManager.configManager.getConfig();
    
    // If specific format requested, output full config in that format
    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    
    if (options.yaml) {
      // For YAML output, we'll use JSON.stringify with proper formatting
      // since js-yaml is not installed. Users can pipe to a YAML converter if needed.
      console.log('# SCEpter Configuration (in JSON format, convert to YAML as needed)');
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    
    // If specific sections requested, show only those
    const showAll = !options.noteTypes && !options.paths && !options.source && !options.statusSets;

    console.log(chalk.bold('\n📋 SCEpter Configuration\n'));

    if (showAll || options.noteTypes) {
      this.displayNoteTypes(config);
    }

    if (showAll || options.paths) {
      this.displayPaths(config);
    }

    if (showAll || options.source) {
      this.displaySourceCodeIntegration(config);
    }

    // @implements {T011.3.2} Display status sets section
    if (showAll || options.statusSets) {
      this.displayStatusSets(config);
    }

    if (showAll) {
      this.displayOtherSettings(config);
    }
  }
  
  private displayNoteTypes(config: SCEpterConfig): void {
    console.log(chalk.cyan(chalk.bold('Note Types:')));
    console.log(chalk.dim('─'.repeat(60)));

    const noteTypes = Object.entries(config.noteTypes);
    const maxNameLength = Math.max(...noteTypes.map(([name]) => name.length));

    for (const [name, typeConfig] of noteTypes) {
      const paddedName = name.padEnd(maxNameLength);
      console.log(
        `  ${chalk.green(paddedName)} ${chalk.dim('│')} ${chalk.yellow(typeConfig.shortcode.padEnd(3))} ${chalk.dim('│')} ${typeConfig.folder || chalk.dim('(any)')}`
      );
      if (typeConfig.description) {
        console.log(`  ${chalk.dim(' '.repeat(maxNameLength))} ${chalk.dim('│')}     ${chalk.dim('│')} ${chalk.dim(typeConfig.description)}`);
      }

      // @implements {T011.3.2} Display allowed statuses per note type
      if (typeConfig.allowedStatuses) {
        const statusInfo = this.formatAllowedStatuses(typeConfig.allowedStatuses, config.statusSets);
        console.log(`  ${chalk.dim(' '.repeat(maxNameLength))} ${chalk.dim('│')}     ${chalk.dim('│')} ${statusInfo}`);
      }
    }
    console.log();
  }

  /**
   * Format allowed statuses configuration for display
   * @implements {T011.3.2} Status display formatting
   */
  private formatAllowedStatuses(
    allowedStatuses: string[] | AllowedStatusesConfig,
    statusSets?: Record<string, string[]>
  ): string {
    // Handle shorthand array syntax
    if (Array.isArray(allowedStatuses)) {
      const defaultValue = allowedStatuses[0];
      const values = allowedStatuses.join(', ');
      return chalk.dim(`Statuses (suggest): `) + chalk.cyan(values) + chalk.dim(` [default: ${defaultValue}]`);
    }

    // Handle full object syntax
    const mode = allowedStatuses.mode;
    const modeColor = mode === 'enforce' ? chalk.red : chalk.yellow;

    // Resolve all values from sets and literal values
    const allValues: string[] = [];
    if (allowedStatuses.sets && statusSets) {
      for (const setName of allowedStatuses.sets) {
        const setValues = statusSets[setName];
        if (setValues) {
          allValues.push(...setValues);
        }
      }
    }
    if (allowedStatuses.values) {
      allValues.push(...allowedStatuses.values);
    }

    const valuesDisplay = allValues.join(', ');
    const defaultDisplay = allowedStatuses.defaultValue
      ? chalk.dim(` [default: ${allowedStatuses.defaultValue}]`)
      : '';

    return chalk.dim(`Statuses (`) + modeColor(mode) + chalk.dim(`): `) + chalk.cyan(valuesDisplay) + defaultDisplay;
  }
  
  private displayPaths(config: SCEpterConfig): void {
    console.log(chalk.cyan(chalk.bold('Paths:')));
    console.log(chalk.dim('─'.repeat(60)));
    
    if (config.paths) {
      if (config.paths.notesRoot) {
        console.log(`  ${chalk.green('Notes Root:')}     ${config.paths.notesRoot}`);
      }
      if (config.paths.dataDir) {
        console.log(`  ${chalk.green('Data Directory:')} ${config.paths.dataDir}`);
      }
    }
    console.log();
  }
  
  private displaySourceCodeIntegration(config: SCEpterConfig): void {
    console.log(chalk.cyan(chalk.bold('Source Code Integration:')));
    console.log(chalk.dim('─'.repeat(60)));
    
    if (config.sourceCodeIntegration) {
      const sci = config.sourceCodeIntegration;
      console.log(`  ${chalk.green('Enabled:')}     ${sci.enabled ? '✓' : '✗'}`);
      
      if (sci.enabled) {
        console.log(`  ${chalk.green('Folders:')}     ${sci.folders.join(', ')}`);
        console.log(`  ${chalk.green('Extensions:')}  ${sci.extensions.join(', ')}`);
        if (sci.exclude.length > 0) {
          console.log(`  ${chalk.green('Exclude:')}     ${sci.exclude.join(', ')}`);
        }
        if (sci.cacheSourceRefs !== undefined) {
          console.log(`  ${chalk.green('Cache Refs:')}  ${sci.cacheSourceRefs ? '✓' : '✗'}`);
        }
        if (sci.validateOnStartup !== undefined) {
          console.log(`  ${chalk.green('Validate:')}    ${sci.validateOnStartup ? '✓' : '✗'}`);
        }
      }
    } else {
      console.log(`  ${chalk.dim('Not configured')}`);
    }
    console.log();
  }
  
  private displayOtherSettings(config: SCEpterConfig): void {
    // Project info
    if (config.project) {
      console.log(chalk.cyan(chalk.bold('Project:')));
      console.log(chalk.dim('─'.repeat(60)));
      if (config.project.name) {
        console.log(`  ${chalk.green('Name:')}        ${config.project.name}`);
      }
      if (config.project.description) {
        console.log(`  ${chalk.green('Description:')} ${config.project.description}`);
      }
      if (config.project.version) {
        console.log(`  ${chalk.green('Version:')}     ${config.project.version}`);
      }
      console.log();
    }
    
    // Notes settings
    if (config.notes) {
      console.log(chalk.cyan(chalk.bold('Notes Settings:')));
      console.log(chalk.dim('─'.repeat(60)));
      console.log(`  ${chalk.green('Auto Create:')}      ${config.notes.autoCreate ? '✓' : '✗'}`);
      if (config.notes.fileNamePattern) {
        console.log(`  ${chalk.green('Filename Pattern:')} ${config.notes.fileNamePattern}`);
      }
      console.log();
    }
    
    // Context settings
    if (config.context) {
      console.log(chalk.cyan(chalk.bold('Context Settings:')));
      console.log(chalk.dim('─'.repeat(60)));
      console.log(`  ${chalk.green('Default Depth:')} ${config.context.defaultDepth}`);
      console.log(`  ${chalk.green('Follow Hints:')}  ${config.context.followHints ? '✓' : '✗'}`);
      if (config.context.maxTokens) {
        console.log(`  ${chalk.green('Max Tokens:')}    ${config.context.maxTokens.toLocaleString()}`);
      }
      console.log();
    }
  }

  /**
   * Display status sets section
   * @implements {T011.3.2} Status sets display
   */
  private displayStatusSets(config: SCEpterConfig): void {
    console.log(chalk.cyan(chalk.bold('Status Sets:')));
    console.log(chalk.dim('─'.repeat(60)));

    if (!config.statusSets || Object.keys(config.statusSets).length === 0) {
      console.log(chalk.dim('  No status sets configured'));
      console.log();
      return;
    }

    const statusSets = Object.entries(config.statusSets);
    const maxNameLength = Math.max(...statusSets.map(([name]) => name.length));

    for (const [name, values] of statusSets) {
      const paddedName = name.padEnd(maxNameLength);
      const formattedValues = values.map(v => chalk.cyan(v)).join(chalk.dim(', '));
      console.log(`  ${chalk.green(paddedName)} ${chalk.dim('│')} ${formattedValues}`);
    }
    console.log();
  }
}