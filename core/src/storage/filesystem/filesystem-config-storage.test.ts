import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { FilesystemConfigStorage } from './filesystem-config-storage';
import type { SCEpterConfig } from '../../types/config';

const MINIMAL_CONFIG: SCEpterConfig = {
  noteTypes: {
    Decision: { shortcode: 'D', folder: 'decisions' },
  },
};

describe('FilesystemConfigStorage', () => {
  const testDir = path.join(process.cwd(), '.test-tmp', 'fs-config-storage');
  let storage: FilesystemConfigStorage;

  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);
    storage = new FilesystemConfigStorage(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should return null when no config file exists', async () => {
    const config = await storage.load();
    expect(config).toBeNull();
  });

  it('should load config from _scepter/scepter.config.json', async () => {
    const configDir = path.join(testDir, '_scepter');
    await fs.ensureDir(configDir);
    await fs.writeJson(path.join(configDir, 'scepter.config.json'), MINIMAL_CONFIG);

    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.noteTypes.Decision.shortcode).toBe('D');
  });

  it('should load config from root scepter.config.json (higher priority)', async () => {
    // Place config at root level
    await fs.writeJson(path.join(testDir, 'scepter.config.json'), {
      noteTypes: { Requirement: { shortcode: 'R', folder: 'reqs' } },
    });

    // Also place one in _scepter (lower priority)
    const configDir = path.join(testDir, '_scepter');
    await fs.ensureDir(configDir);
    await fs.writeJson(path.join(configDir, 'scepter.config.json'), MINIMAL_CONFIG);

    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    // Root config should win
    expect(loaded!.noteTypes.Requirement).toBeDefined();
  });

  it('should save config to _scepter/scepter.config.json', async () => {
    await storage.save(MINIMAL_CONFIG);

    const filePath = path.join(testDir, '_scepter', 'scepter.config.json');
    expect(await fs.pathExists(filePath)).toBe(true);

    const content = await fs.readJson(filePath);
    expect(content.noteTypes.Decision.shortcode).toBe('D');
  });

  it('should round-trip config', async () => {
    await storage.save(MINIMAL_CONFIG);
    const loaded = await storage.load();
    expect(loaded!.noteTypes.Decision.shortcode).toBe('D');
    expect(loaded!.noteTypes.Decision.folder).toBe('decisions');
  });

  it('should create backup on save when file exists', async () => {
    // First save
    await storage.save(MINIMAL_CONFIG);

    // Second save — should create backup
    await storage.save({
      noteTypes: { Updated: { shortcode: 'U', folder: 'updated' } },
    });

    const backupPath = path.join(testDir, '_scepter', 'scepter.config.json.backup');
    expect(await fs.pathExists(backupPath)).toBe(true);

    // Backup should contain original config
    const backup = await fs.readJson(backupPath);
    expect(backup.noteTypes.Decision).toBeDefined();
  });
});
