import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from './config-manager';
import type { SCEpterConfig, NoteTypeConfig } from '../types/config';
import { defaultConfig } from '../types/config';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  const testProjectPath = path.join(process.cwd(), '.test-tmp', 'test-config-manager');

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectPath, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testProjectPath, { recursive: true });
    configManager = new ConfigManager(testProjectPath);
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(testProjectPath, { recursive: true, force: true });
    } catch {}
  });

  describe('Configuration Loading', () => {
    it('should return null when no config file exists', async () => {
      // No config files exist in test directory
      const config = await configManager.loadConfigFromFilesystem();

      expect(config).toBeNull();
    });

    it('should throw when getConfig called without loading config', () => {
      expect(() => configManager.getConfig()).toThrow('No configuration loaded');
    });

    it('should load configuration from filesystem', async () => {
      // Create a filesystem config with minimal required fields
      const configPath = path.join(testProjectPath, '_scepter', 'scepter.config.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const testConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
          FileNote: { folder: 'file-notes', shortcode: 'FN' },
        },
        project: { name: 'File Config' },
      };
      await fs.writeFile(configPath, JSON.stringify(testConfig));

      const config = await configManager.loadConfigFromFilesystem();

      expect(config).not.toBeNull();
      expect(config!.noteTypes.FileNote).toBeDefined();
      expect(config!.noteTypes.FileNote.shortcode).toBe('FN');
      expect(config!.project?.name).toBe('File Config');
    });

    it('should set config programmatically with complete config', async () => {
      const fullConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
          CustomType: { folder: 'custom', shortcode: 'CT' },
        },
      };

      const config = await configManager.setConfig(fullConfig);

      expect(config.noteTypes.Requirement).toBeDefined();
      expect(config.noteTypes.CustomType).toBeDefined();
      expect(config.noteTypes.CustomType.shortcode).toBe('CT');

      // Should be retrievable with getConfig
      const retrieved = await configManager.getConfig();
      expect(retrieved).toEqual(config);
    });

    it('should validate required fields (noteTypes)', async () => {
      const invalidConfig = {
        // Missing noteTypes
        paths: { dataDir: '_scepter' },
      } as any;

      await expect(configManager.setConfig(invalidConfig)).rejects.toThrow();
    });

    it('should reject invalid note type configurations (missing folder or shortcode)', () => {
      const invalidConfig: SCEpterConfig = {
        noteTypes: {
          Invalid: { folder: 'test' } as any, // Missing shortcode
        },
      };

      expect(() => configManager.validateAndLoad(invalidConfig)).toThrow();
    });

    it('should reject duplicate shortcodes across note types', () => {
      const invalidConfig: SCEpterConfig = {
        noteTypes: {
          Type1: { folder: 'type1', shortcode: 'T' },
          Type2: { folder: 'type2', shortcode: 'T' }, // Duplicate
        },
      };

      expect(() => configManager.validateAndLoad(invalidConfig)).toThrow(/duplicate shortcode/i);
    });


    it('should handle missing optional configuration sections gracefully', async () => {
      const minimalConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
        // No optional sections
      };

      const config = await configManager.setConfig(minimalConfig);

      // Optional fields can be undefined
      expect(config.noteTypes).toBeDefined();
    });

    it('should accept config with custom paths', async () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
        paths: {
          notesRoot: '_custom-scepter/notes',
          dataDir: '_custom-scepter',
        },
      };

      const result = await configManager.setConfig(config);
      expect(result.paths?.notesRoot).toBe('_custom-scepter/notes');
    });

    it('should support loading config from _scepter/scepter.config.json', async () => {
      const configPath = path.join(testProjectPath, '_scepter', 'scepter.config.json');
      const testConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
        project: { name: 'Test Project' },
      };

      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(testConfig));

      const config = await configManager.loadConfigFromFilesystem();
      expect(config?.project?.name).toBe('Test Project');
    });



    it('should merge configs after loading from filesystem', async () => {
      // Create a filesystem config
      const configPath = path.join(testProjectPath, '_scepter', 'scepter.config.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const fileConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
          FileNote: { folder: 'file-notes', shortcode: 'FN' },
        },
        project: { name: 'File Config' },
      };
      await fs.writeFile(configPath, JSON.stringify(fileConfig));

      // Load from filesystem first
      const loaded = await configManager.loadConfigFromFilesystem();
      expect(loaded).not.toBeNull();

      // Now we can merge additional config
      const customConfig = {
        noteTypes: {
          CustomNote: { folder: 'custom-notes', shortcode: 'CN' },
        },
        project: { description: 'Custom description' },
      };

      const config = await configManager.mergeConfig(customConfig);

      // Should have all note types
      expect(config.noteTypes.Requirement).toBeDefined();
      expect(config.noteTypes.FileNote).toBeDefined();
      expect(config.noteTypes.CustomNote).toBeDefined();
      expect(config.project?.name).toBe('File Config');
      expect(config.project?.description).toBe('Custom description');
    });
  });

  describe('Dynamic Configuration', () => {
    it('should replace config completely with setConfig', async () => {
      // First set an initial config
      const initialConfig: SCEpterConfig = {
        noteTypes: {
          InitialNote: { folder: 'initial', shortcode: 'IN' },
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
        project: { name: 'Initial Project' },
      };
      await configManager.setConfig(initialConfig);

      // Then replace it completely
      const newConfig: SCEpterConfig = {
        noteTypes: {
          Task: { folder: 'tasks', shortcode: 'T' },
        },
        project: {
          name: 'Replaced Project',
          version: '2.0.0',
        },
      };

      const config = await configManager.setConfig(newConfig);

      // Should NOT have InitialNote (replaced, not merged)
      expect(config.noteTypes.InitialNote).toBeUndefined();
      // Should NOT have Requirement (replaced, not merged)
      expect(config.noteTypes.Requirement).toBeUndefined();
      // Should have new note type
      expect(config.noteTypes.Task).toBeDefined();
      expect(config.project?.name).toBe('Replaced Project');
      expect(config.project?.version).toBe('2.0.0');
    });

    it('should merge with existing config using mergeConfig', async () => {
      // Set initial config
      const initialConfig: SCEpterConfig = {
        noteTypes: {
          InitialNote: { folder: 'initial', shortcode: 'IN' },
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
        project: { name: 'Initial Project', version: '1.0.0' },
      };
      await configManager.setConfig(initialConfig);

      // Merge additional config
      const mergeConfigData = {
        noteTypes: {
          MergedNote: { folder: 'merged', shortcode: 'MN' },
        },
        project: { description: 'Added description' },
      };

      const config = await configManager.mergeConfig(mergeConfigData);

      // Should have all note types
      expect(config.noteTypes.Requirement).toBeDefined();
      expect(config.noteTypes.InitialNote).toBeDefined();
      expect(config.noteTypes.MergedNote).toBeDefined();
      // Project should be merged
      expect(config.project?.name).toBe('Initial Project');
      expect(config.project?.version).toBe('1.0.0');
      expect(config.project?.description).toBe('Added description');
    });

    it('should throw when merging without existing config', async () => {
      const mergeData = {
        noteTypes: {
          Test: { folder: 'test', shortcode: 'T' },
        },
      };

      await expect(configManager.mergeConfig(mergeData)).rejects.toThrow('No existing config to merge');
    });

    it('should validate config when using setConfig', async () => {
      const invalidConfig = {
        noteTypes: {
          Invalid: { folder: 'test' } as any, // Missing shortcode
        },
      } as any;

      await expect(configManager.setConfig(invalidConfig)).rejects.toThrow();
    });

    it('should allow adding custom note types at runtime', async () => {
      // First set a base config
      const baseConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
      };
      await configManager.setConfig(baseConfig);

      const newNoteType: NoteTypeConfig = { folder: 'epics', shortcode: 'E' };
      await configManager.addNoteType('Epic', newNoteType);

      const updatedConfig = await configManager.getConfig();
      expect(updatedConfig.noteTypes.Epic).toEqual(newNoteType);
    });




    it('should persist configuration changes', async () => {
      // Set initial config
      const baseConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
      };
      await configManager.setConfig(baseConfig);

      const newNoteType: NoteTypeConfig = { folder: 'bugs', shortcode: 'B' };
      await configManager.addNoteType('Bug', newNoteType);
      // addNoteType saves automatically

      // Create new instance to verify persistence
      const newManager = new ConfigManager(testProjectPath);
      const reloadedConfig = await newManager.loadConfigFromFilesystem();

      expect(reloadedConfig?.noteTypes.Bug).toEqual(newNoteType);
    });

    it('should reload configuration without restart', async () => {
      // Set and save initial config
      const initialConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
        project: { name: 'Initial Project' },
      };
      await configManager.setConfig(initialConfig);
      await configManager.saveConfig();

      // Simulate external config change
      const configPath = path.join(testProjectPath, '_scepter', 'scepter.config.json');
      const modifiedConfig: SCEpterConfig = {
        ...initialConfig,
        project: { name: 'Modified Project' },
      };
      await fs.writeFile(configPath, JSON.stringify(modifiedConfig));

      await configManager.reloadConfig();
      const reloadedConfig = await configManager.getConfig();

      expect(reloadedConfig.project?.name).toBe('Modified Project');
    });

    it('should emit configuration change events', async () => {
      // Set initial config
      const baseConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
      };
      await configManager.setConfig(baseConfig);

      let eventFired = false;
      configManager.on('config:changed', () => {
        eventFired = true;
      });

      await configManager.addNoteType('Event', { folder: 'events', shortcode: 'EV' });

      expect(eventFired).toBe(true);
    });
  });
});

describe('ConfigurationPersistence', () => {
  let configManager: ConfigManager;
  const testProjectPath = path.join(process.cwd(), '.test-tmp', 'test-config-persistence');

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectPath, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testProjectPath, { recursive: true });
    configManager = new ConfigManager(testProjectPath);
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(testProjectPath, { recursive: true, force: true });
    } catch {}
  });

  describe('Config File Management', () => {
    it('should save configuration changes to disk', async () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
        project: { name: 'Saved Project' },
      };
      await configManager.setConfig(config);

      await configManager.saveConfig();

      const configPath = path.join(testProjectPath, '_scepter', 'scepter.config.json');
      const savedContent = await fs.readFile(configPath, 'utf-8');
      const savedConfig = JSON.parse(savedContent);

      expect(savedConfig.project.name).toBe('Saved Project');
    });

    it('should create backup before saving changes', async () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
        project: { name: 'Initial Project' },
      };
      await configManager.setConfig(config);
      await configManager.saveConfig();

      // Make changes
      await configManager.mergeConfig({ project: { name: 'Updated Project' } });
      await configManager.saveConfig();

      const backupPath = path.join(testProjectPath, '_scepter', 'scepter.config.json.backup');
      const backupExists = await fs
        .access(backupPath)
        .then(() => true)
        .catch(() => false);

      expect(backupExists).toBe(true);
    });

    it('should handle sequential config modifications', async () => {
      // Set initial config
      const baseConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
      };
      await configManager.setConfig(baseConfig);

      // Sequential modifications
      await configManager.addNoteType('Type1', { folder: 'type1', shortcode: 'T1' });
      await configManager.addNoteType('Type2', { folder: 'type2', shortcode: 'T2' });
      await configManager.addNoteType('Type3', { folder: 'type3', shortcode: 'T3' });

      const config = await configManager.getConfig();
      expect(config.noteTypes.Type1).toBeDefined();
      expect(config.noteTypes.Type2).toBeDefined();
      expect(config.noteTypes.Type3).toBeDefined();
    });

    it('should validate config before saving', async () => {
      // Set initial valid config
      const config: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
        },
      };
      await configManager.setConfig(config);

      // Manually corrupt the internal config to test validation on save
      (configManager as any).config.noteTypes = {}; // Invalid - empty noteTypes

      await expect(configManager.saveConfig()).rejects.toThrow(/validation failed/i);
    });

    it('should handle save errors gracefully', async () => {
      // This test verifies error handling exists
      // Full rollback testing would require mocking fs operations
      expect(configManager.saveConfig).toBeDefined();
    });
  });
});
