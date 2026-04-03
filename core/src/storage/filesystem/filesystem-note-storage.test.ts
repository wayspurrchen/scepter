import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigManager } from '../../config/config-manager';
import { NoteFileManager } from '../../notes/note-file-manager';
import { NoteTypeResolver } from '../../notes/note-type-resolver';
import { UnifiedDiscovery } from '../../discovery/unified-discovery';
import { FilesystemNoteStorage } from './filesystem-note-storage';
import type { Note } from '../../types/note';
import type { SCEpterConfig } from '../../types/config';

const TEST_CONFIG: SCEpterConfig = {
  noteTypes: {
    Decision: { shortcode: 'D', folder: 'decisions' },
    Requirement: { shortcode: 'R', folder: 'requirements' },
  },
  paths: {
    notesRoot: '_scepter/notes',
    dataDir: '_scepter',
  },
};

describe('FilesystemNoteStorage', () => {
  const testDir = path.join(process.cwd(), '.test-tmp', 'fs-note-storage');
  let storage: FilesystemNoteStorage;
  let noteFileManager: NoteFileManager;
  let configManager: ConfigManager;
  let noteTypeResolver: NoteTypeResolver;
  let unifiedDiscovery: UnifiedDiscovery;

  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);

    // Set up config
    configManager = new ConfigManager(testDir);
    await configManager.setConfig(TEST_CONFIG);

    // Create directories
    const notesRoot = path.join(testDir, '_scepter', 'notes');
    await fs.ensureDir(path.join(notesRoot, 'decisions'));
    await fs.ensureDir(path.join(notesRoot, 'requirements'));

    // Set up subsystems
    noteFileManager = new NoteFileManager(testDir, configManager);
    noteTypeResolver = new NoteTypeResolver(configManager);
    noteTypeResolver.initialize();
    unifiedDiscovery = new UnifiedDiscovery(testDir, configManager);
    await unifiedDiscovery.initialize();

    storage = new FilesystemNoteStorage(
      noteFileManager,
      unifiedDiscovery,
      configManager,
      noteTypeResolver,
    );
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('createNote / getNote', () => {
    it('should create and retrieve a note', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Test Decision',
        content: 'This is a test decision.',
        tags: ['test'],
        created: new Date('2026-04-01'),
      };

      await storage.createNote(note);

      // Rebuild index so getNote can find the file
      await noteFileManager.buildIndex();

      const retrieved = await storage.getNote('D001');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('D001');
      expect(retrieved!.type).toBe('Decision');
    });
  });

  describe('getAllNotes', () => {
    it('should return empty array for empty project', async () => {
      const notes = await storage.getAllNotes();
      expect(notes).toEqual([]);
    });

    it('should discover notes created on disk', async () => {
      // Write a note file directly
      const notePath = path.join(testDir, '_scepter', 'notes', 'decisions', 'D001 Test.md');
      await fs.writeFile(notePath, '---\ncreated: 2026-04-01\ntags: []\n---\n\n# D001 - Test\n\nContent\n');

      const notes = await storage.getAllNotes();
      expect(notes.length).toBeGreaterThanOrEqual(1);
      expect(notes.some(n => n.id === 'D001')).toBe(true);
    });
  });

  describe('deleteNote modes', () => {
    it('should archive a note', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'To Archive',
        content: 'Archivable.',
        tags: [],
        created: new Date(),
      };
      await storage.createNote(note);
      await noteFileManager.buildIndex();

      await storage.deleteNote('D001', 'archive');

      // Note should be in _archive
      const archiveDir = path.join(testDir, '_scepter', 'notes', 'decisions', '_archive');
      const files = await fs.readdir(archiveDir);
      expect(files.some(f => f.includes('D001'))).toBe(true);
    });
  });

  describe('getStatistics', () => {
    it('should return correct type breakdown', async () => {
      // Create notes
      const decisionsDir = path.join(testDir, '_scepter', 'notes', 'decisions');
      await fs.writeFile(
        path.join(decisionsDir, 'D001 First.md'),
        '---\ncreated: 2026-04-01\ntags: []\n---\n\n# D001 - First\n\n',
      );
      await fs.writeFile(
        path.join(decisionsDir, 'D002 Second.md'),
        '---\ncreated: 2026-04-01\ntags: []\n---\n\n# D002 - Second\n\n',
      );

      const stats = await storage.getStatistics();
      expect(stats.noteCount).toBeGreaterThanOrEqual(2);
      expect(stats.typeBreakdown['Decision']).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getNotes (query)', () => {
    it('should filter by type', async () => {
      const decisionsDir = path.join(testDir, '_scepter', 'notes', 'decisions');
      const reqsDir = path.join(testDir, '_scepter', 'notes', 'requirements');
      await fs.writeFile(
        path.join(decisionsDir, 'D001 Dec.md'),
        '---\ncreated: 2026-04-01\ntags: []\n---\n\n# D001 - Dec\n\n',
      );
      await fs.writeFile(
        path.join(reqsDir, 'R001 Req.md'),
        '---\ncreated: 2026-04-01\ntags: []\n---\n\n# R001 - Req\n\n',
      );

      const result = await storage.getNotes({ types: ['Decision'] });
      expect(result.notes.every(n => n.type === 'Decision')).toBe(true);
      expect(result.notes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getAllReferences', () => {
    it('should extract references from note content', async () => {
      const decisionsDir = path.join(testDir, '_scepter', 'notes', 'decisions');
      await fs.writeFile(
        path.join(decisionsDir, 'D001 Dec.md'),
        '---\ncreated: 2026-04-01\ntags: []\n---\n\n# D001 - Dec\n\nRelates to {R001}.\n',
      );
      await fs.writeFile(
        path.join(testDir, '_scepter', 'notes', 'requirements', 'R001 Req.md'),
        '---\ncreated: 2026-04-01\ntags: []\n---\n\n# R001 - Req\n\n',
      );

      const refs = await storage.getAllReferences();
      expect(refs.some(r => r.fromId === 'D001' && r.toId === 'R001')).toBe(true);
    });
  });

  describe('getFilePath (filesystem-specific)', () => {
    it('should return undefined for unknown note', () => {
      expect(storage.getFilePath('NONEXISTENT')).toBeUndefined();
    });

    it('should return path after note creation', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Test',
        content: 'Content',
        tags: [],
        created: new Date(),
      };
      await storage.createNote(note);

      const filePath = storage.getFilePath('D001');
      expect(filePath).toBeDefined();
      expect(filePath!.endsWith('.md')).toBe(true);
    });
  });
});
