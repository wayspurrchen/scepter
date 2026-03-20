import { EventEmitter } from 'events';
import type { SCEpterConfig, NoteTypeConfig } from '../types/config';
import { ConfigValidator, ConfigValidationError, SCEpterConfigSchema } from './config-validator';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

export class ConfigManager extends EventEmitter {
  private config?: SCEpterConfig;
  private validator: ConfigValidator;

  constructor(private projectPath: string) {
    super();
    this.validator = new ConfigValidator();
  }

  async loadConfigFromFilesystem(): Promise<SCEpterConfig | null> {
    // Try to load config from various sources in priority order
    const configPaths = [
      path.join(this.projectPath, 'scepter.config.json'),
      path.join(this.projectPath, '_scepter', 'scepter.config.json'),
    ];

    let lastError: Error | null = null;
    let lastConfigPath: string | null = null;

    for (const configPath of configPaths) {
      try {
        // JSON config file
        const content = await fs.readFile(configPath, 'utf-8');
        const userConfig = JSON.parse(content);
        // Validate and return
        const validated = this.validateAndLoad(userConfig);
        return validated;
      } catch (error: any) {
        // Only continue to next path if file doesn't exist
        if (error.code === 'ENOENT') {
          continue;
        }

        // For all other errors (validation, parse, etc.), save and re-throw with context
        lastError = error;
        lastConfigPath = configPath;
        break; // Don't try other paths if we found a file but it's invalid
      }
    }

    // If we found a config file but it was invalid, throw with helpful context
    if (lastError && lastConfigPath) {
      this.throwHelpfulConfigError(lastError, lastConfigPath);
    }

    // No config found
    return null;
  }

  async setConfig(config: SCEpterConfig): Promise<SCEpterConfig> {
    // Replace current config completely
    const result = this.validateAndLoad(config);
    // Emit event after successful set
    this.emit('config:changed', result);
    return result;
  }

  async mergeConfig(config: Partial<SCEpterConfig>): Promise<SCEpterConfig> {
    // Merge with existing config
    if (!this.config) {
      throw new Error('No existing config to merge with. Use setConfig to set initial configuration.');
    }
    const merged = this.mergeConfigs(this.config, config);
    const result = this.validateAndLoad(merged);
    // Emit event after successful merge
    this.emit('config:changed', result);
    return result;
  }

  validateAndLoad(config: unknown): SCEpterConfig {
    try {
      // Use Zod to parse and validate
      const parsed = SCEpterConfigSchema.parse(config);

      this.config = parsed;
      return parsed;
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Transform Zod errors to match test expectations
        const firstError = error.errors[0];

        if (firstError.message.includes('unique') && firstError.message.includes('shortcode')) {
          throw new Error('Found duplicate shortcode in configuration');
        }

        // Let other errors pass through as-is
        throw error;
      }
      throw error;
    }
  }

  getConfig(): SCEpterConfig {
    if (!this.config) {
      throw new Error('No configuration loaded. Use setConfig or loadConfigFromFilesystem first.');
    }
    return this.config;
  }


  async addNoteType(name: string, config: NoteTypeConfig): Promise<void> {
    const current = this.getConfig();
    const updated = {
      ...current,
      noteTypes: {
        ...current.noteTypes,
        [name]: config,
      },
    };

    // Validate the updated config
    this.validator.validateOrThrow(updated);
    this.config = updated;

    // Save to disk
    await this.saveConfig();

    this.emit('config:changed', updated);
  }

  async saveConfig(): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration to save');
    }

    // Validate before saving
    try {
      this.validator.validateOrThrow(this.config);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw new Error(`Configuration validation failed: ${error.message}`);
      }
      throw error;
    }

    const configPath = path.join(this.projectPath, '_scepter', 'scepter.config.json');
    const tempPath = `${configPath}.tmp`;

    // Create backup if file exists
    try {
      await fs.access(configPath);
      const backupPath = configPath + '.backup';
      await fs.copyFile(configPath, backupPath);
    } catch (error) {
      // No existing file to backup
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    // Write to temp file first
    await fs.writeFile(tempPath, JSON.stringify(this.config, null, 2));

    // Atomic rename
    await fs.rename(tempPath, configPath);
  }

  async reloadConfig(): Promise<void> {
    // Clear cached config to force reload from disk
    const loaded = await this.loadConfigFromFilesystem();
    if (loaded) {
      this.config = loaded;
    } else {
      throw new Error('No configuration file found to reload');
    }
  }

  async updateNoteType(typeName: string, updates: Partial<NoteTypeConfig>): Promise<void> {
    const config = this.getConfig();

    // Check if type exists
    if (!config.noteTypes[typeName]) {
      throw new Error(`Note type '${typeName}' not found`);
    }

    // Validate shortcode uniqueness if updating
    if (updates.shortcode) {
      for (const [name, typeConfig] of Object.entries(config.noteTypes)) {
        if (name !== typeName && typeConfig.shortcode === updates.shortcode) {
          throw new Error(`Shortcode '${updates.shortcode}' is already used by type '${name}'`);
        }
      }
    }

    // Update the type
    config.noteTypes[typeName] = {
      ...config.noteTypes[typeName],
      ...updates
    };

    // Save and emit change
    await this.saveConfig();
    this.emit('config:changed', config);
  }

  async removeNoteType(typeName: string): Promise<void> {
    const config = this.getConfig();

    // Check if type exists
    if (!config.noteTypes[typeName]) {
      throw new Error(`Note type '${typeName}' not found`);
    }

    // Prevent removing last type
    if (Object.keys(config.noteTypes).length === 1) {
      throw new Error('Cannot remove last note type');
    }

    // Remove the type
    delete config.noteTypes[typeName];

    // Save and emit change
    await this.saveConfig();
    this.emit('config:changed', config);
  }

  async createBackup(): Promise<string> {
    const configPath = path.join(this.projectPath, '_scepter', 'scepter.config.json');
    const backupsDir = path.join(this.projectPath, '_scepter', '.backups');

    // Ensure backups directory exists
    await fs.mkdir(backupsDir, { recursive: true });

    // Create date-based backup filename with incrementing counter
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const existing = (await fs.readdir(backupsDir).catch(() => []))
      .filter(f => f.startsWith(`scepter.config.json.${dateStr}.`));
    const counter = String(existing.length + 1).padStart(3, '0');
    const backupPath = path.join(backupsDir, `scepter.config.json.${dateStr}.${counter}`);

    // Copy config to backup
    try {
      await fs.copyFile(configPath, backupPath);
    } catch (error) {
      // If config doesn't exist, save current config as backup
      if (this.config) {
        await fs.writeFile(backupPath, JSON.stringify(this.config, null, 2));
      }
    }

    // Clean up old backups (keep only last 5)
    const backups = await fs.readdir(backupsDir);
    const configBackups = backups
      .filter(f => f.startsWith('scepter.config.json.'))
      .sort()
      .reverse();

    for (let i = 5; i < configBackups.length; i++) {
      await fs.unlink(path.join(backupsDir, configBackups[i]));
    }

    return backupPath;
  }

  async listBackups(): Promise<Array<{ path: string; date: Date; size: number }>> {
    const backupsDir = path.join(this.projectPath, '_scepter', '.backups');

    try {
      const files = await fs.readdir(backupsDir);
      const backups = [];

      for (const file of files) {
        if (file.startsWith('scepter.config.json.')) {
          const fullPath = path.join(backupsDir, file);
          const stats = await fs.stat(fullPath);
          const suffix = file.replace('scepter.config.json.', '');
          const datePart = suffix.split('.')[0];
          const year = datePart.slice(0, 4);
          const month = datePart.slice(4, 6);
          const day = datePart.slice(6, 8);

          backups.push({
            path: fullPath,
            date: new Date(`${year}-${month}-${day}`),
            size: stats.size
          });
        }
      }

      return backups.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch (error) {
      return [];
    }
  }

  async restoreBackup(backupPath: string): Promise<void> {
    // Read and validate backup
    const backupContent = await fs.readFile(backupPath, 'utf-8');
    const backupConfig = JSON.parse(backupContent);

    // Validate the backup
    this.validateAndLoad(backupConfig);

    // Save as current config
    await this.saveConfig();
    this.emit('config:changed', this.config);
  }

  private mergeConfigs(defaults: SCEpterConfig, userConfig: Partial<SCEpterConfig>): SCEpterConfig {
    return {
      noteTypes: { ...defaults.noteTypes, ...(userConfig.noteTypes || {}) },
      notes: userConfig.notes || defaults.notes,
      context: userConfig.context || defaults.context,
      tasks: userConfig.tasks || defaults.tasks,
      paths: userConfig.paths || defaults.paths,
      project: {
        ...(defaults.project || {}),
        ...(userConfig.project || {}),
      },
      sourceCodeIntegration: userConfig.sourceCodeIntegration || defaults.sourceCodeIntegration,
    };
  }

  private throwHelpfulConfigError(error: Error, configPath: string): never {
    const relPath = path.relative(this.projectPath, configPath);

    // Handle JSON parse errors
    if (error instanceof SyntaxError) {
      throw new Error(
        `Configuration file has invalid JSON syntax in ${relPath}:\n` +
        `  ${error.message}\n\n` +
        `Please check your JSON syntax and try again.`
      );
    }

    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      const missingFields: string[] = [];
      const otherErrors: string[] = [];

      for (const err of error.errors) {
        const fieldPath = err.path.join('.');

        // Check for missing required fields
        if (err.code === 'invalid_type' && err.received === 'undefined') {
          missingFields.push(fieldPath || err.message);
        } else {
          otherErrors.push(`  - ${fieldPath ? fieldPath + ': ' : ''}${err.message}`);
        }
      }

      let errorMessage = `Configuration validation failed in ${relPath}:\n`;

      if (missingFields.length > 0) {
        errorMessage += `\nMissing required fields:\n`;
        missingFields.forEach(field => {
          errorMessage += `  - ${field}\n`;
        });
      }

      if (otherErrors.length > 0) {
        errorMessage += `\nValidation errors:\n${otherErrors.join('\n')}\n`;
      }

      errorMessage += `\nTo fix this:\n`;

      if (missingFields.some(f => f.includes('noteTypes') || f === 'noteTypes')) {
        errorMessage += `  - Add note types: scepter types add <TypeName>\n`;
        errorMessage += `  - View type commands: scepter types --help\n`;
      }

      errorMessage += `  - Or reinitialize from template: scepter init <template-name>\n`;

      throw new Error(errorMessage);
    }

    // For other errors, re-throw with file context
    throw new Error(
      `Error loading configuration from ${relPath}:\n` +
      `  ${error.message}`
    );
  }
}
