import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigManager } from './config-manager';
import * as path from 'path';
import { tmpdir } from 'os';

// Mock fs/promises module
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  copyFile: vi.fn(),
  rename: vi.fn(),
  access: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn()
}));

describe('ConfigManager Updates', () => {
  let configManager: ConfigManager;
  let projectPath: string;
  let configPath: string;
  let fsPromises: any;

  beforeEach(async () => {
    projectPath = path.join(tmpdir(), `test-project-${Date.now()}`);
    configPath = path.join(projectPath, '_scepter', 'scepter.config.json');
    configManager = new ConfigManager(projectPath);

    // Get mocked fs/promises
    fsPromises = await import('fs/promises');

    // Mock initial config
    const mockConfig = {
      noteTypes: {
        Decision: { shortcode: 'D', folder: 'decisions' },
        Requirement: { shortcode: 'R', folder: 'requirements' }
      },

    };

    await configManager.setConfig(mockConfig);

    // Mock fs methods
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.copyFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.rename).mockResolvedValue(undefined);
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fsPromises.readdir).mockResolvedValue([]);
    vi.mocked(fsPromises.unlink).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('updateNoteType', () => {
    it('should update existing note type', async () => {
      await configManager.updateNoteType('Decision', {
        shortcode: 'TD',
        description: 'Technical decisions'
      });

      const config = configManager.getConfig();
      expect(config.noteTypes.Decision).toEqual({
        shortcode: 'TD',
        folder: 'decisions',
        description: 'Technical decisions'
      });
    });

    it('should throw if type does not exist', async () => {
      await expect(
        configManager.updateNoteType('NonExistent', { shortcode: 'NE' })
      ).rejects.toThrow("Note type 'NonExistent' not found");
    });

    it('should validate shortcode uniqueness on update', async () => {
      await expect(
        configManager.updateNoteType('Decision', { shortcode: 'R' })
      ).rejects.toThrow("Shortcode 'R' is already used by type 'Requirement'");
    });

    it('should save config after update', async () => {
      await configManager.updateNoteType('Decision', {
        description: 'Important decisions'
      });

      expect(fsPromises.writeFile).toHaveBeenCalled();
    });

    it('should emit config:changed event', async () => {
      const listener = vi.fn();
      configManager.on('config:changed', listener);

      await configManager.updateNoteType('Decision', {
        description: 'Updated description'
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          noteTypes: expect.objectContaining({
            Decision: expect.objectContaining({
              description: 'Updated description'
            })
          })
        })
      );
    });
  });

  describe('removeNoteType', () => {
    it('should remove note type from config', async () => {
      await configManager.removeNoteType('Decision');

      const config = configManager.getConfig();
      expect(config.noteTypes.Decision).toBeUndefined();
      expect(config.noteTypes.Requirement).toBeDefined();
    });

    it('should throw if type does not exist', async () => {
      await expect(
        configManager.removeNoteType('NonExistent')
      ).rejects.toThrow("Note type 'NonExistent' not found");
    });

    it('should save config after removal', async () => {
      await configManager.removeNoteType('Decision');

      expect(fsPromises.writeFile).toHaveBeenCalled();
    });
  });

  describe('saveConfig', () => {
    it('should write config to file with proper formatting', async () => {
      await configManager.saveConfig();

      // Should have written to temp file first
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        `${configPath}.tmp`,
        expect.stringContaining('"noteTypes"')
      );

      // Check formatting (2-space indent)
      const writtenContent = vi.mocked(fsPromises.writeFile).mock.calls[0][1];
      expect(writtenContent).toMatch(/^{\n  /); // Starts with "{\n  "
    });

    it('should create backup if file exists', async () => {
      vi.mocked(fsPromises.access).mockResolvedValueOnce(undefined); // File exists

      await configManager.saveConfig();

      expect(fsPromises.copyFile).toHaveBeenCalledWith(
        configPath,
        `${configPath}.backup`
      );
    });

    it('should write to temp file first then rename', async () => {
      await configManager.saveConfig();

      // Should write to temp file
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        `${configPath}.tmp`,
        expect.any(String)
      );

      // Should rename temp to actual
      expect(fsPromises.rename).toHaveBeenCalledWith(
        `${configPath}.tmp`,
        configPath
      );
    });

    it('should ensure directory exists', async () => {
      await configManager.saveConfig();

      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        path.dirname(configPath),
        { recursive: true }
      );
    });
  });

  describe('createBackup', () => {
    it('should create timestamped backup', async () => {
      vi.mocked(fsPromises.access).mockResolvedValueOnce(undefined); // Config exists
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify({
        noteTypes: { Decision: { shortcode: 'D', folder: 'decisions' } }
      }));

      const backupPath = await configManager.createBackup();

      expect(backupPath).toMatch(/_scepter\/.backups\/scepter\.config\.json\.\d{8}\.\d{3}$/);
      expect(fsPromises.copyFile).toHaveBeenCalled();
    });

    it('should create backups directory if needed', async () => {
      await configManager.createBackup();

      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.backups'),
        { recursive: true }
      );
    });

    it('should clean up old backups keeping only last 5', async () => {
      // Mock: first readdir for counter, second for cleanup
      vi.mocked(fsPromises.readdir)
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([
          'scepter.config.json.20250101.001',
          'scepter.config.json.20250102.001',
          'scepter.config.json.20250103.001',
          'scepter.config.json.20250104.001',
          'scepter.config.json.20250105.001',
          'scepter.config.json.20250106.001'
        ] as any);

      await configManager.createBackup();

      // Should remove the oldest backup
      expect(fsPromises.unlink).toHaveBeenCalledWith(
        expect.stringContaining('20250101.001')
      );
    });
  });

  describe('restoreBackup', () => {
    beforeEach(() => {
      // Clear any previous mock implementations
      vi.mocked(fsPromises.readFile).mockClear();
    });

    it('should restore from backup file', async () => {
      const backupPath = path.join(projectPath, '_scepter/.backups/scepter.config.json.20250722.001');
      const backupConfig = {
        noteTypes: { OldType: { shortcode: 'OT', folder: 'old' } }
      };

      // Reset the mock and set up fresh implementation
      vi.mocked(fsPromises.readFile).mockReset();
      vi.mocked(fsPromises.readFile).mockImplementation(async (filePath: string) => {
        // Convert to string to handle both string and Buffer paths
        const pathStr = filePath.toString();
        if (pathStr === backupPath) {
          return JSON.stringify(backupConfig);
        }
        throw new Error(`File not found: ${pathStr}`);
      });

      await configManager.restoreBackup(backupPath);

      const config = configManager.getConfig();
      expect(config.noteTypes.OldType).toBeDefined();
    });

    it('should validate restored config', async () => {
      const backupPath = 'backup.json';
      
      // Mock readFile to return invalid JSON
      vi.mocked(fsPromises.readFile).mockImplementation(async (path) => {
        if (path === backupPath) {
          return 'invalid json';
        }
        throw new Error('File not found');
      });

      await expect(
        configManager.restoreBackup(backupPath)
      ).rejects.toThrow();
    });

    it('should save restored config', async () => {
      const backupPath = 'backup.json';
      const validConfig = {
        noteTypes: { Type: { shortcode: 'T', folder: 'types' } }
      };

      // Mock readFile to return valid config
      vi.mocked(fsPromises.readFile).mockImplementation(async (path) => {
        if (path === backupPath) {
          return JSON.stringify(validConfig);
        }
        throw new Error('File not found');
      });

      await configManager.restoreBackup(backupPath);

      expect(fsPromises.writeFile).toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('should validate shortcode format on update', async () => {
      await expect(
        configManager.updateNoteType('Decision', { shortcode: 'invalid!' })
      ).rejects.toThrow('Configuration validation failed');
    });

    it('should validate type name exists', async () => {
      await expect(
        configManager.updateNoteType('', { shortcode: 'D' })
      ).rejects.toThrow();
    });

    it('should prevent removing last note type', async () => {
      await configManager.removeNoteType('Decision');
      
      await expect(
        configManager.removeNoteType('Requirement')
      ).rejects.toThrow('Cannot remove last note type');
    });
  });
});