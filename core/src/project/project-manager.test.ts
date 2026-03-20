import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectManager } from './project-manager';
import { ConfigManager } from '../config/config-manager';
import type { SCEpterConfig } from '../types/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('ProjectManager', () => {
  let projectManager: ProjectManager;
  let configManager: ConfigManager;
  const testProjectPath = path.join(process.cwd(), '.test-tmp', 'test-project-manager');

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectPath, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testProjectPath, { recursive: true });

    configManager = new ConfigManager(testProjectPath);

    // Set a default config for all tests
    const defaultTestConfig: SCEpterConfig = {
      noteTypes: {
        Requirement: { folder: 'requirements', shortcode: 'R' },
        Decision: { folder: 'decisions', shortcode: 'D' },
        Question: { folder: 'questions', shortcode: 'Q' },
      },
      paths: {
        notesRoot: '_scepter/notes',
        dataDir: '_scepter',
      },
    };
    await configManager.setConfig(defaultTestConfig);

    projectManager = new ProjectManager(testProjectPath, { configManager });
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(testProjectPath, { recursive: true, force: true });
    } catch {}
  });

  describe('Project Initialization', () => {
    it('should initialize a new project with default structure', async () => {
      await projectManager.initialize();

      // Check that required directories are created
      const config = await configManager.getConfig();

      // Data directory
      const dataDir = path.join(testProjectPath, config.paths?.dataDir || '_scepter');
      await expect(fs.access(dataDir)).resolves.not.toThrow();

      // Notes root directory
      const notesRoot = path.join(testProjectPath, config.paths?.notesRoot || '_scepter/notes');
      await expect(fs.access(notesRoot)).resolves.not.toThrow();

    });

    it('should create note type folders based on configuration', async () => {
      await projectManager.initialize();

      const config = await configManager.getConfig();
      const notesRoot = path.join(testProjectPath, config.paths?.notesRoot || '_scepter/notes');

      // Check each note type folder exists
      for (const [key, noteType] of Object.entries(config.noteTypes)) {
        const noteTypePath = path.join(notesRoot, noteType.folder);
        await expect(fs.access(noteTypePath)).resolves.not.toThrow();
      }
    });


    it('should not overwrite existing project structure', async () => {
      // Create some existing files
      const notesRoot = path.join(testProjectPath, '_scepter', 'notes');
      const existingFile = path.join(notesRoot, 'existing.md');
      await fs.mkdir(notesRoot, { recursive: true });
      await fs.writeFile(existingFile, 'existing content');

      await projectManager.initialize();

      // Check existing file is preserved
      const content = await fs.readFile(existingFile, 'utf-8');
      expect(content).toBe('existing content');
    });

    it('should create .gitkeep files in empty directories', async () => {
      await projectManager.initialize();

      const config = await configManager.getConfig();
      const notesRoot = path.join(testProjectPath, config.paths?.notesRoot || '_scepter/notes');

      // Check for .gitkeep in note type folders
      for (const [key, noteType] of Object.entries(config.noteTypes)) {
        const gitkeepPath = path.join(notesRoot, noteType.folder, '.gitkeep');
        await expect(fs.access(gitkeepPath)).resolves.not.toThrow();
      }
    });

    it('should validate project structure after initialization', async () => {
      await projectManager.initialize();

      const isValid = await projectManager.validateStructure();
      expect(isValid).toBe(true);
    });

    // Removed - project metadata now in scepter.config.json
    it.skip('should create project metadata file', async () => {
      await projectManager.initialize();

      const config = await configManager.getConfig();
      const metadataPath = path.join(testProjectPath, config.paths?.dataDir || '_scepter', 'project.json');

      await expect(fs.access(metadataPath)).resolves.not.toThrow();

      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      expect(metadata).toHaveProperty('version');
      expect(metadata).toHaveProperty('createdAt');
      expect(metadata).toHaveProperty('scepterVersion');
    });

    it('should handle initialization with custom config', async () => {
      // Create custom config
      const customConfig: Partial<SCEpterConfig> = {
        paths: {
          notesRoot: '_custom-scepter/notes',
          dataDir: '_custom-scepter',
        },
      };

      await configManager.mergeConfig(customConfig);
      await projectManager.initialize();

      // Check custom paths exist
      await expect(fs.access(path.join(testProjectPath, '_custom-scepter', 'notes'))).resolves.not.toThrow();
      await expect(fs.access(path.join(testProjectPath, '_custom-scepter'))).resolves.not.toThrow();
    });
  });

  describe('Project Validation', () => {
    it('should detect missing required directories', async () => {
      // Don't initialize, just validate
      const isValid = await projectManager.validateStructure();
      expect(isValid).toBe(false);

      const errors = await projectManager.getValidationErrors();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.type === 'missing_directory')).toBe(true);
    });

    it('should validate note type folder structure', async () => {
      await projectManager.initialize();

      // Remove a note type folder
      const config = await configManager.getConfig();
      const notesRoot = path.join(testProjectPath, config.paths?.notesRoot || '_scepter/notes');
      const firstNoteType = Object.values(config.noteTypes)[0];
      await fs.rm(path.join(notesRoot, firstNoteType.folder), { recursive: true });

      const isValid = await projectManager.validateStructure();
      expect(isValid).toBe(false);

      const errors = await projectManager.getValidationErrors();
      expect(errors.some((e) => e.type === 'missing_directory' && e.path.includes(firstNoteType.folder))).toBe(true);
    });

    it('should provide detailed validation report', async () => {
      const report = await projectManager.getValidationReport();

      expect(report).toHaveProperty('isValid');
      expect(report).toHaveProperty('errors');
      expect(report).toHaveProperty('warnings');
      expect(report).toHaveProperty('checkedPaths');
      expect(Array.isArray(report.errors)).toBe(true);
      expect(Array.isArray(report.warnings)).toBe(true);
      expect(Array.isArray(report.checkedPaths)).toBe(true);
    });
  });

  describe('Directory Management', () => {
    it('should handle adding new note type dynamically', async () => {
      await projectManager.initialize();

      // Add new note type via config
      await configManager.addNoteType('Epic', { folder: 'epics', shortcode: 'E' });

      // Update project structure
      await projectManager.updateStructure();

      // Check new folder exists
      const config = await configManager.getConfig();
      const notesRoot = path.join(testProjectPath, config.paths?.notesRoot || '_scepter/notes');
      const epicPath = path.join(notesRoot, 'epics');
      await expect(fs.access(epicPath)).resolves.not.toThrow();
    });


    it('should clean up removed note types (with user confirmation)', async () => {
      await projectManager.initialize();

      const config = await configManager.getConfig();
      const notesRoot = path.join(testProjectPath, config.paths?.notesRoot || '_scepter/notes');

      // Create an orphaned folder
      const orphanPath = path.join(notesRoot, 'orphaned');
      await fs.mkdir(orphanPath);
      await fs.writeFile(path.join(orphanPath, 'test.md'), 'content');

      // Get cleanup suggestions
      const suggestions = await projectManager.getCleanupSuggestions();
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.path.includes('orphaned'))).toBe(true);
    });
  });

  describe('Project Info', () => {
    it('should provide project statistics', async () => {
      await projectManager.initialize();

      // Initialize NoteManager to properly track notes
      await projectManager.noteManager.initialize();

      // Create a note through NoteManager instead of manually
      await projectManager.noteManager.createNote({
        type: 'Requirement',
        content: 'Test Requirement',
        tags: ['test'],
      });

      const stats = await projectManager.getStatistics();

      expect(stats).toHaveProperty('totalNotes');
      expect(stats).toHaveProperty('notesByType');
      expect(stats).toHaveProperty('notesByMode');
      expect(stats).toHaveProperty('lastModified');
      expect(stats).toHaveProperty('projectSize');
      expect(stats.totalNotes).toBeGreaterThanOrEqual(1);
    });

    it('should detect SCEpter project root correctly', async () => {
      await projectManager.initialize();

      // Create scepter.config.json to mark this as a SCEpter project
      await fs.writeFile(
        path.join(testProjectPath, '_scepter', 'scepter.config.json'),
        JSON.stringify({ noteTypes: {} }),
      );

      // Test from subdirectory
      const subDir = path.join(testProjectPath, 'some', 'deep', 'path');
      await fs.mkdir(subDir, { recursive: true });

      const foundRoot = await ProjectManager.findProjectRoot(subDir);
      expect(foundRoot).toBe(testProjectPath);
    });

    it('should return null when not in a SCEpter project', async () => {
      // Create a temporary directory in system temp to avoid finding parent project
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scepter-test-'));
      const nonProjectPath = path.join(tmpDir, 'non-project');
      await fs.mkdir(nonProjectPath, { recursive: true });

      const foundRoot = await ProjectManager.findProjectRoot(nonProjectPath);
      expect(foundRoot).toBeNull();

      await fs.rm(tmpDir, { recursive: true, force: true });
    });
  });
});

describe('ProjectManager - Error Handling', () => {
  let projectManager: ProjectManager;
  let configManager: ConfigManager;
  const testProjectPath = path.join(process.cwd(), '.test-tmp', 'test-project-errors');

  beforeEach(async () => {
    try {
      await fs.rm(testProjectPath, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testProjectPath, { recursive: true });

    configManager = new ConfigManager(testProjectPath);

    // Set a default config for error tests
    const defaultTestConfig: SCEpterConfig = {
      noteTypes: {
        Requirement: { folder: 'requirements', shortcode: 'R' },
      },
    };
    await configManager.setConfig(defaultTestConfig);

    projectManager = new ProjectManager(testProjectPath, { configManager });
  });

  afterEach(async () => {
    try {
      await fs.rm(testProjectPath, { recursive: true, force: true });
    } catch {}
  });

  it('should handle permission errors gracefully', async () => {
    // Skip on Windows as permission handling is different
    if (process.platform === 'win32') {
      return;
    }

    // Create directory with restricted permissions
    await fs.mkdir(testProjectPath, { recursive: true });
    const restrictedPath = path.join(testProjectPath, 'restricted');
    await fs.mkdir(restrictedPath, { mode: 0o000 });

    // Attempt to initialize (should handle permission error)
    await expect(projectManager.initialize()).rejects.toThrow(/permission|access/i);

    // Cleanup
    await fs.chmod(restrictedPath, 0o755);
  });

  it('should handle invalid project paths', async () => {
    const invalidPath = '/invalid/path/that/does/not/exist';
    const invalidProjectManager = new ProjectManager(invalidPath, { configManager });

    await expect(invalidProjectManager.initialize()).rejects.toThrow();
  });
});
