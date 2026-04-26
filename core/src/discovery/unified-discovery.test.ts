import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as path from 'path';
import { glob } from 'glob';
import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';
import { UnifiedDiscovery, type DiscoverySource } from './unified-discovery';
import type { Note } from '../types/note';
import type { ConfigManager } from '../config/config-manager';
import type { SCEpterConfig } from '../types/config';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn().mockResolvedValue({
    birthtime: new Date('2025-01-01'),
    isDirectory: () => false,
  }),
}));
vi.mock('glob');
vi.mock('chokidar');

describe('UnifiedDiscovery', () => {
  let discovery: UnifiedDiscovery;
  let testProjectPath: string;
  let mockConfigManager: ConfigManager;
  let testConfig: SCEpterConfig;

  beforeEach(async () => {
    testProjectPath = '/test/project';

    // Create a minimal test config
    testConfig = {
      noteTypes: {
        Decision: {
          shortcode: 'D',
          folder: 'decisions',
          color: 'blue',
          icon: '🎯',
          prompts: {},
        },
        Requirement: {
          shortcode: 'R',
          folder: 'requirements',
          color: 'green',
          icon: '📋',
          prompts: {},
        },
      },

    } as SCEpterConfig;

    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue(testConfig),
    } as unknown as ConfigManager;

    discovery = new UnifiedDiscovery(testProjectPath, mockConfigManager);
    await discovery.initialize();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await discovery.stopWatching();
  });

  describe('initialization', () => {
    it('should extend EventEmitter', () => {
      expect(discovery).toBeInstanceOf(EventEmitter);
    });

    it('should register exactly one default source with recursive glob', () => {
      const sources = discovery.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0].pattern).toBe(
        path.join(testProjectPath, '_scepter/**/*.md'),
      );
    });

    it('should set source type to note', () => {
      const sources = discovery.getSources();
      expect(sources[0].type).toBe('note');
    });
  });

  describe('extractId', () => {
    it('should extract IDs from filenames with various shortcodes', () => {
      const source = discovery.getSources()[0];

      expect(source.extractId('D001 Use JWT.md')).toBe('D001');
      expect(source.extractId('R001 Auth requirement.md')).toBe('R001');
      expect(source.extractId('T001 Setup database.md')).toBe('T001');
      expect(source.extractId('REQ00001 Long shortcode.md')).toBe('REQ00001');
    });

    it('should return null for filenames without valid note IDs', () => {
      const source = discovery.getSources()[0];

      expect(source.extractId('Invalid filename.md')).toBeNull();
      expect(source.extractId('readme.md')).toBeNull();
      expect(source.extractId('no-id.md')).toBeNull();
    });
  });

  describe('enrichNote', () => {
    it('should determine type from ID prefix using shortcode map', () => {
      const source = discovery.getSources()[0];

      const baseNote: Note = {
        id: 'D001',
        type: 'Unknown',
        title: 'Test',
        content: 'Test',
        tags: [],
        created: new Date(),
      };

      const enriched = source.enrichNote(
        baseNote,
        '/test/project/_scepter/notes/decisions/D001 Test.md',
      );
      expect(enriched.type).toBe('Decision');
    });

    it('should resolve Task type for T prefix', () => {
      const source = discovery.getSources()[0];

      const baseNote: Note = {
        id: 'T001',
        type: 'Unknown',
        title: 'Test Task',
        content: 'Test',
        tags: [],
        created: new Date(),
      };

      const enriched = source.enrichNote(
        baseNote,
        '/test/project/_scepter/tasks/T001 Test Task.md',
      );
      expect(enriched.type).toBe('Task');
    });

    it('should tag notes as archived when path contains _archive/', () => {
      const source = discovery.getSources()[0];

      const baseNote: Note = {
        id: 'D001',
        type: 'Unknown',
        title: 'Test',
        content: 'Test',
        tags: [],
        created: new Date(),
      };

      const enriched = source.enrichNote(
        baseNote,
        '/test/project/_scepter/notes/decisions/_archive/D001 Test.md',
      );
      expect(enriched.tags).toContain('archived');
    });

    it('should tag notes as deleted when path contains _deleted/', () => {
      const source = discovery.getSources()[0];

      const baseNote: Note = {
        id: 'R001',
        type: 'Unknown',
        title: 'Test',
        content: 'Test',
        tags: [],
        created: new Date(),
      };

      const enriched = source.enrichNote(
        baseNote,
        '/test/project/_scepter/notes/requirements/_deleted/R001 Test.md',
      );
      expect(enriched.tags).toContain('deleted');
    });

    it('should not duplicate existing archived/deleted tags', () => {
      const source = discovery.getSources()[0];

      const baseNote: Note = {
        id: 'D001',
        type: 'Unknown',
        title: 'Test',
        content: 'Test',
        tags: ['archived'],
        created: new Date(),
      };

      const enriched = source.enrichNote(
        baseNote,
        '/test/project/_scepter/notes/decisions/_archive/D001 Test.md',
      );
      const archivedCount = enriched.tags.filter((t) => t === 'archived').length;
      expect(archivedCount).toBe(1);
    });

    it('should set filePath on the enriched note', () => {
      const source = discovery.getSources()[0];

      const baseNote: Note = {
        id: 'D001',
        type: 'Unknown',
        title: 'Test',
        content: 'Test',
        tags: [],
        created: new Date(),
      };

      const filePath = '/test/project/_scepter/notes/decisions/D001 Test.md';
      const enriched = source.enrichNote(baseNote, filePath);
      expect(enriched.filePath).toBe(filePath);
    });
  });

  describe('discoverAll', () => {
    it('should discover notes from standard folders', async () => {
      const mockNoteFiles = [
        path.join(testProjectPath, '_scepter/notes/requirements/R001 Auth requirement.md'),
        path.join(testProjectPath, '_scepter/notes/decisions/D001 Use JWT.md'),
      ];

      vi.mocked(glob).mockImplementation(async (pattern) => {
        if (typeof pattern === 'string' && pattern.includes('_scepter/**/*.md')) {
          return mockNoteFiles;
        }
        return [];
      });
      vi.mocked(fs.readFile).mockResolvedValue(
        '---\ncreated: 2025-01-01\n---\n# Test Note',
      );

      const notes = await discovery.discoverAll();

      expect(notes).toHaveLength(2);
      const requirement = notes.find((n) => n.id === 'R001');
      const decision = notes.find((n) => n.id === 'D001');

      expect(requirement).toBeDefined();
      expect(requirement!.type).toBe('Requirement');
      expect(decision).toBeDefined();
      expect(decision!.type).toBe('Decision');
    });

    it('should discover notes from arbitrary nested locations', async () => {
      const mockNoteFiles = [
        path.join(testProjectPath, '_scepter/some/deep/folder/D001 Nested Decision.md'),
        path.join(testProjectPath, '_scepter/tasks/T001 A Task.md'),
      ];

      vi.mocked(glob).mockImplementation(async (pattern) => {
        if (typeof pattern === 'string' && pattern.includes('_scepter/**/*.md')) {
          return mockNoteFiles;
        }
        return [];
      });
      vi.mocked(fs.readFile).mockResolvedValue('---\ncreated: 2025-01-01\n---\n# Test');

      const notes = await discovery.discoverAll();

      expect(notes).toHaveLength(2);
      expect(notes.find((n) => n.id === 'D001')?.type).toBe('Decision');
      expect(notes.find((n) => n.id === 'T001')?.type).toBe('Task');
    });

    it('should emit discovery events', async () => {
      const mockFiles = [
        path.join(testProjectPath, '_scepter/notes/requirements/R001 Test.md'),
      ];
      vi.mocked(glob).mockImplementation(async (pattern) => {
        if (typeof pattern === 'string' && pattern.includes('_scepter/**/*.md')) {
          return mockFiles;
        }
        return [];
      });
      vi.mocked(fs.readFile).mockResolvedValue('---\n---\n# Test');

      const discoveredNotes: Note[] = [];
      discovery.on('note:discovered', (note) => {
        discoveredNotes.push(note);
      });

      await discovery.discoverAll();

      expect(discoveredNotes).toHaveLength(1);
      expect(discoveredNotes[0].id).toBe('R001');
    });

    it('should handle missing directories gracefully', async () => {
      vi.mocked(glob).mockResolvedValue([]);

      const notes = await discovery.discoverAll();

      expect(notes).toEqual([]);
      expect(() => discovery.discoverAll()).not.toThrow();
    });
  });

  describe('archive/delete source registration', () => {
    it('areArchiveSourcesRegistered should always return true', () => {
      expect(discovery.areArchiveSourcesRegistered()).toBe(true);
    });

    it('registerArchiveDeleteSources should be a no-op', () => {
      const sourcesBefore = discovery.getSources().length;
      discovery.registerArchiveDeleteSources();
      const sourcesAfter = discovery.getSources().length;
      expect(sourcesAfter).toBe(sourcesBefore);
    });
  });

  describe('file watching', () => {
    it('should support file watching', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as any);

      await discovery.watch();

      expect(chokidar.watch).toHaveBeenCalledWith(
        [path.join(testProjectPath, '_scepter')],
        expect.objectContaining({
          persistent: true,
          ignoreInitial: true,
        }),
      );
      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
    });

    it('should emit events on file changes', async () => {
      const mockWatcher = {
        on: vi.fn((event, handler) => {
          if (event === 'add') {
            // Simulate file add with full path
            setTimeout(() => {
              handler(
                path.join(
                  testProjectPath,
                  '_scepter/notes/requirements/R002 New requirement.md',
                ),
              );
            }, 10);
          }
          return mockWatcher; // Return this for chaining
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as any);
      vi.mocked(fs.readFile).mockResolvedValue('---\n---\n# New Note');

      const addedNotes: Note[] = [];
      discovery.on('note:added', (note) => {
        addedNotes.push(note);
      });

      await discovery.watch();

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(addedNotes).toHaveLength(1);
      expect(addedNotes[0].id).toBe('R002');
    });
  });

  describe('custom sources', () => {
    it('should allow registering custom sources', () => {
      const customSource: DiscoverySource = {
        type: 'template',
        pattern: '_scepter/**/_templates/*.md',
        shortcode: 'TPL',
        extractId: (filename) => filename.match(/^(TPL\d+)/)?.[1] || null,
        enrichNote: (note) => ({ ...note, isTemplate: true }),
      };

      discovery.registerSource(customSource);

      const sources = discovery.getSources();
      expect(sources).toHaveLength(2); // 1 default + 1 custom
      expect(sources.find((s) => s.type === 'template')).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle file read errors gracefully', async () => {
      const mockFiles = [
        path.join(testProjectPath, '_scepter/notes/requirements/R001 Test.md'),
      ];
      vi.mocked(glob).mockImplementation(async (pattern) => {
        if (typeof pattern === 'string' && pattern.includes('_scepter/**/*.md')) {
          return mockFiles;
        }
        return [];
      });
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File read error'));

      const notes = await discovery.discoverAll();

      expect(notes).toEqual([]);
      // Should not throw
    });

    it('should handle malformed frontmatter', async () => {
      const mockFiles = [
        path.join(testProjectPath, '_scepter/notes/requirements/R001 Test.md'),
      ];
      vi.mocked(glob).mockImplementation(async (pattern) => {
        if (typeof pattern === 'string' && pattern.includes('_scepter/**/*.md')) {
          return mockFiles;
        }
        return [];
      });
      vi.mocked(fs.readFile).mockResolvedValue('Invalid YAML\n---\n# Test');

      const notes = await discovery.discoverAll();

      // Should still discover the note, just without metadata
      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe('R001');
    });
  });
});
