/**
 * Filesystem adapter for configuration persistence.
 *
 * Extracts the filesystem I/O from ConfigManager.loadConfigFromFilesystem()
 * and ConfigManager.saveConfig(). After extraction, ConfigManager receives
 * config via setConfig() — it no longer reads from disk itself.
 *
 * @implements {A002.§3.AC.03} Filesystem adapter for ConfigStorage
 * @implements {DD010.§DC.10} FilesystemConfigStorage wraps ConfigManager I/O
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ConfigStorage } from '../storage-backend';
import type { SCEpterConfig } from '../../types/config';

export class FilesystemConfigStorage implements ConfigStorage {
  constructor(private projectPath: string) {}

  async load(): Promise<SCEpterConfig | null> {
    const configPaths = [
      path.join(this.projectPath, 'scepter.config.json'),
      path.join(this.projectPath, '_scepter', 'scepter.config.json'),
    ];

    for (const configPath of configPaths) {
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        return JSON.parse(content) as SCEpterConfig;
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
    }

    return null;
  }

  async save(config: SCEpterConfig): Promise<void> {
    const configPath = path.join(this.projectPath, '_scepter', 'scepter.config.json');
    const tempPath = `${configPath}.tmp`;

    // Create backup if file exists
    try {
      await fs.access(configPath);
      const backupPath = configPath + '.backup';
      await fs.copyFile(configPath, backupPath);
    } catch {
      // No existing file to backup
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    // Write to temp file first
    await fs.writeFile(tempPath, JSON.stringify(config, null, 2));

    // Atomic rename
    await fs.rename(tempPath, configPath);
  }
}
