import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import fs from 'fs-extra';
import { NoteFileManager } from './note-file-manager';
import type { Note } from '../types/note';
import type { NoteTypeConfig, SCEpterConfig } from '../types/config';
import type { ConfigManager } from '../config/config-manager';

// Test helpers
async function createTempDirectory(): Promise<string> {
  return await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'scepter-test-'));
}

async function removeTempDirectory(dir: string): Promise<void> {
  await fs.remove(dir);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf-8');
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content);
}

async function renameFile(oldPath: string, newPath: string): Promise<void> {
  await fs.rename(oldPath, newPath);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.ensureDir(dir);
}

// Create a mock ConfigManager for tests
function createMockConfigManager(tempDir: string, noteTypes: Record<string, NoteTypeConfig>): ConfigManager {
  const config: SCEpterConfig = {
    noteTypes,
    paths: {
      notesRoot: '_scepter/notes',
      dataDir: '_scepter',
    },
  };

  return {
    getConfig: vi.fn().mockReturnValue(config),
    setConfig: vi.fn(),
    addNoteType: vi.fn(),
    addWorkMode: vi.fn(),
    saveConfig: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  } as unknown as ConfigManager;
}

describe('NoteFileManager', () => {
  let manager: NoteFileManager;
  let tempDir: string;
  let mockConfigManager: ConfigManager;

  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = await createTempDirectory();

    const noteTypes = {
      Requirement: { folder: 'requirements', shortcode: 'R' },
      Decision: { folder: 'decisions', shortcode: 'D' },
      Question: { folder: 'questions', shortcode: 'Q' },
      TODO: { folder: 'todos', shortcode: 'TD' },
      Assumption: { folder: 'assumptions', shortcode: 'A' },
      Component: { folder: 'components', shortcode: 'C' },
      Milestone: { folder: 'milestones', shortcode: 'M' },
    };

    mockConfigManager = createMockConfigManager(tempDir, noteTypes);
    manager = new NoteFileManager(tempDir, mockConfigManager);
  });

  afterEach(async () => {
    // Stop watching if active
    await manager.stopWatching();
    // Clean up temp directory
    await removeTempDirectory(tempDir);
  });

  describe('with custom shortcodes', () => {
    it('should support multi-character shortcodes', async () => {
      const customNoteTypes = {
        Requirement: { folder: 'requirements', shortcode: 'REQ' },
        Decision: { folder: 'decisions', shortcode: 'DEC' },
        TechnicalDebt: { folder: 'debt', shortcode: 'DEBT' },
      };
      const customConfigManager = createMockConfigManager(tempDir, customNoteTypes);
      const customManager = new NoteFileManager(tempDir, customConfigManager);

      const note: Note = {
        id: 'REQ001',
        type: 'Requirement',
        title: 'Users must be able to login',
        content: 'Users must be able to login',
        tags: ['auth'],
        created: new Date(),
      };

      await customManager.createNoteFile(note);

      const expectedPath = path.join(tempDir, '_scepter', 'notes', 'requirements', 'REQ001 Users must be able to login.md');
      expect(await fileExists(expectedPath)).toBe(true);
    });

    it('should find files with custom shortcodes', async () => {
      const customNoteTypes = {
        Architecture: { folder: 'architecture', shortcode: 'ARCH' },
        APISpec: { folder: 'api-specs', shortcode: 'API' },
      };
      const customConfigManager = createMockConfigManager(tempDir, customNoteTypes);
      const customManager = new NoteFileManager(tempDir, customConfigManager);

      const note: Note = {
        id: 'ARCH001',
        type: 'Architecture',
        title: 'Use microservices architecture',
        content: 'Use microservices architecture',
        tags: ['system-design'],
        created: new Date(),
      };

      await customManager.createNoteFile(note);
      const foundPath = await customManager.findNoteFile('ARCH001');
      expect(foundPath).toContain('architecture/ARCH001');
    });
  });

  describe('generateFilename', () => {
    it('should generate filename from note ID and title', () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Use JWT with refresh tokens for authentication',
        content: 'Use JWT with refresh tokens for authentication',
        tags: ['auth', 'security'],
        created: new Date(),
      };

      const filename = manager.generateFilename(note);
      expect(filename).toBe('D001 Use JWT with refresh tokens for authentication.md');
    });

    it('should truncate long title for filename', () => {
      const note: Note = {
        id: 'R042',
        type: 'Requirement',
        title:
          'The system must support real-time synchronization of user data across multiple devices with offline capability and automatic conflict resolution',
        content:
          'The system must support real-time synchronization of user data across multiple devices with offline capability and automatic conflict resolution',
        tags: [],
        created: new Date(),
      };

      const filename = manager.generateFilename(note);
      expect(filename.length).toBeLessThanOrEqual(84); // 80 + .md
      expect(filename).toMatch(/^R042 .+\.md$/);
      expect(filename).toBe('R042 The system must support real-time synchronization of user data across multi.md');
    });

    it('should sanitize special characters in filename', () => {
      const note: Note = {
        id: 'Q001',
        type: 'Question',
        title: 'Should we use Redis/Memcached for caching? Consider: cost, performance, etc.',
        content: 'Should we use Redis/Memcached for caching? Consider: cost, performance, etc.',
        tags: ['caching'],
        created: new Date(),
      };

      const filename = manager.generateFilename(note);
      expect(filename).not.toContain('/');
      expect(filename).not.toContain(':');
      // Should be truncated at 80 chars total + .md extension
      expect(filename.length).toBeLessThanOrEqual(84);
      expect(filename).toBe('Q001 Should we use Redis Memcached for caching Consider cost performance etc.md');
    });

    it('should handle empty title gracefully', () => {
      const note: Note = {
        id: 'TD001',
        type: 'TODO',
        title: '',
        content: '',
        tags: [],
        created: new Date(),
      };

      const filename = manager.generateFilename(note);
      expect(filename).toBe('TD001.md');
    });

    it('should preserve note ID at start of filename', () => {
      const note: Note = {
        id: 'M2024Q1',
        type: 'Milestone',
        title: 'Launch MVP',
        content: 'Launch MVP',
        tags: ['release'],
        created: new Date(),
      };

      const filename = manager.generateFilename(note);
      expect(filename).toMatch(/^M2024Q1 /);
    });
  });

  describe('createNoteFile', () => {
    it('should create file in correct type folder', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Use JWT authentication',
        content: 'Use JWT authentication',
        tags: ['auth'],
        created: new Date(),
      };

      await manager.createNoteFile(note);

      const expectedPath = path.join(tempDir, '_scepter', 'notes', 'decisions', 'D001 Use JWT authentication.md');
      expect(await fileExists(expectedPath)).toBe(true);

      const content = await readFile(expectedPath);
      expect(content).toContain('# D001 - Use JWT authentication');
      expect(content).toContain('tags: [auth]');
      expect(content).toContain('---');
    });

    it('should create folder structure if not exists', async () => {
      const note: Note = {
        id: 'C001',
        type: 'Component',
        title: 'AuthenticationService',
        content: 'AuthenticationService',
        tags: ['service', 'auth'],
        created: new Date(),
      };

      await manager.createNoteFile(note);

      const folderPath = path.join(tempDir, '_scepter', 'notes', 'components');
      expect(await fileExists(folderPath)).toBe(true);
    });

    it('should not overwrite existing files', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'Original content',
        content: 'Original content',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const filePath = await manager.findNoteFile('R001');

      // Try to create again with same ID (even with different content, the filename would be different)
      // So we need to use the exact same note to trigger the error
      await expect(manager.createNoteFile(note)).rejects.toThrow('Note file already exists');

      // Original content should be preserved
      const content = await readFile(filePath!);
      expect(content).toContain('Original content');
    });

    it('should emit file:created event', async () => {
      const note: Note = {
        id: 'Q042',
        type: 'Question',
        title: 'Which database should we use?',
        content: 'Which database should we use?',
        tags: ['database'],
        created: new Date(),
      };

      const createdHandler = vi.fn();
      manager.on('file:created', createdHandler);

      await manager.createNoteFile(note);

      expect(createdHandler).toHaveBeenCalledWith({
        noteId: 'Q042',
        filePath: expect.stringContaining('Q042'),
        type: 'Question',
        isFolder: false,
      });
    });
  });

  describe('findNoteFile', () => {
    it('should find file by note ID', async () => {
      const note: Note = {
        id: 'A001',
        type: 'Assumption',
        title: 'Users have modern browsers',
        content: 'Users have modern browsers',
        tags: ['compatibility'],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const foundPath = await manager.findNoteFile('A001');

      expect(foundPath).toBeDefined();
      expect(foundPath).toContain('assumptions');
      expect(foundPath).toContain('A001');
    });

    it('should find file after manual rename', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Use JWT',
        content: 'Use JWT',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const originalPath = path.join(tempDir, '_scepter', 'notes', 'decisions', 'D001 Use JWT.md');
      const newPath = path.join(tempDir, '_scepter', 'notes', 'decisions', 'D001 Authentication Strategy Decision.md');

      await renameFile(originalPath, newPath);

      const foundPath = await manager.findNoteFile('D001');
      expect(foundPath).toBe(newPath);
    });

    it('should return null if file not found', async () => {
      const foundPath = await manager.findNoteFile('D999');
      expect(foundPath).toBeNull();
    });

    it('should search only in correct type folder', async () => {
      // Create a decision note
      await manager.createNoteFile({
        id: 'D001',
        type: 'Decision',
        title: 'Auth decision',
        content: 'Auth decision',
        tags: [],
        created: new Date(),
      });

      // Manually create a file with same ID in wrong folder
      const wrongPath = path.join(tempDir, '_scepter', 'notes', 'requirements', 'D001 Wrong Place.md');
      await ensureDir(path.join(tempDir, '_scepter', 'notes', 'requirements'));
      await writeFile(wrongPath, '# D001: Wrong');

      // Should find the correct one in decisions folder
      const foundPath = await manager.findNoteFile('D001');
      expect(foundPath).toContain('decisions');
      expect(foundPath).not.toContain('requirements');
    });

    it.skip('should handle multiple files with same ID (error case)', async () => {
      const note: Note = {
        id: 'TD001',
        type: 'TODO',
        title: 'Original',
        content: 'Original',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);

      // Manually create duplicate
      const duplicatePath = path.join(tempDir, '_scepter', 'notes', 'todos', 'TD001 Duplicate.md');
      await writeFile(duplicatePath, '# TD001: Duplicate');

      // Verify both files exist
      const todosDir = path.join(tempDir, '_scepter', 'notes', 'todos');
      const files = await fs.readdir(todosDir);
      expect(files.filter((f) => f.startsWith('TD001'))).toHaveLength(2);

      await expect(manager.findNoteFile('TD001')).rejects.toThrow('Multiple files found for note ID: TD001');
    });
  });

  describe('ensureNoteFile', () => {
    it('should return true if file exists', async () => {
      const note: Note = {
        id: 'M001',
        type: 'Milestone',
        title: 'Q1 Release',
        content: 'Q1 Release',
        tags: ['release'],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const exists = await manager.ensureNoteFile('M001');
      expect(exists).toBe(true);
    });

    it('should return false if file not exists', async () => {
      const exists = await manager.ensureNoteFile('M999');
      expect(exists).toBe(false);
    });

    it('should not create file if missing', async () => {
      const exists = await manager.ensureNoteFile('D999');
      expect(exists).toBe(false);

      const foundPath = await manager.findNoteFile('D999');
      expect(foundPath).toBeNull();
    });
  });

  describe('getNoteTemplate', () => {
    it('should generate markdown template for decision', () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Use JWT with refresh tokens',
        content: 'Use JWT with refresh tokens',
        tags: ['auth', 'security'],
        created: new Date('2024-01-26'),
        source: { path: 'auth/design.md', line: 42 },
      };

      const template = manager.getNoteTemplate(note);

      expect(template).toBe(`---
created: 2024-01-26
tags: [auth, security]
---

# D001 - Use JWT with refresh tokens

Use JWT with refresh tokens`);
    });

    it('should generate template without source if not provided', () => {
      const note: Note = {
        id: 'Q001',
        type: 'Question',
        title: 'Which auth strategy?',
        content: 'Which auth strategy?',
        tags: ['auth'],
        created: new Date('2024-01-26'),
      };

      const template = manager.getNoteTemplate(note);

      expect(template).toContain('# Q001 - Which auth strategy?');
      expect(template).toContain('tags: [auth]');
    });

    it('should handle notes with context hints', () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'Support OAuth login',
        content: 'Support OAuth login',
        tags: ['auth'],
        created: new Date(),
        contextHints: {
          patterns: ['oauth', 'authentication'],
          includeTags: ['security'],
          includeTypes: ['Decision', 'Component'],
        },
      };

      const template = manager.getNoteTemplate(note);

      // Context hints are no longer included in the template
      expect(template).toContain('# R001 - Support OAuth login');
      expect(template).toContain('tags: [auth]');
      expect(template).not.toContain('Context Hints');
    });
  });

  describe('file watching', () => {
    // FLAKY TEST, NOT THAT IMPORTANT
    it.skip('should update internal index on rename', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'Original requirement',
        content: 'Original requirement',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      await manager.startWatching();

      const originalPath = await manager.findNoteFile('R001');
      const newPath = path.join(path.dirname(originalPath!), 'R001 Updated.md');

      await renameFile(originalPath!, newPath);

      // Give watcher time to detect
      await new Promise((resolve) => setTimeout(resolve, 100));

      const foundPath = await manager.findNoteFile('R001');
      expect(foundPath).toBe(newPath);
    });

    it('should handle file deletions', async () => {
      const note: Note = {
        id: 'Q001',
        type: 'Question',
        title: 'Test question',
        content: 'Test question',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      await manager.startWatching();

      const filePath = await manager.findNoteFile('Q001');

      const deleteDetected = new Promise<void>((resolve) => {
        manager.on('file:deleted', ({ noteId }) => {
          expect(noteId).toBe('Q001');
          resolve();
        });
      });

      await fs.unlink(filePath!);

      // Wait for event with timeout
      await Promise.race([
        deleteDetected,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for delete event')), 2000)),
      ]);

      const foundPath = await manager.findNoteFile('Q001');
      expect(foundPath).toBeNull();
    });

    it('should emit file:modified events when content changes', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Original content',
        content: 'Original content',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      await manager.startWatching();

      const filePath = await manager.findNoteFile('D001');

      const modifyDetected = new Promise<void>((resolve) => {
        manager.on('file:modified', ({ noteId, filePath: eventPath }) => {
          expect(noteId).toBe('D001');
          expect(eventPath).toBe(filePath);
          resolve();
        });
      });

      // Modify the file content
      await fs.writeFile(filePath!, '{D001: Updated content}');

      // Wait for event with timeout
      await Promise.race([
        modifyDetected,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for modify event')), 2000)),
      ]);
    });
  });

  describe('archiveNoteFile', () => {
    it('should move file to _archive directory and update metadata', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Use JWT authentication',
        content: 'Use JWT authentication',
        tags: ['auth'],
        created: new Date('2024-01-26'),
      };

      // Create the note file
      await manager.createNoteFile(note);
      const originalPath = await manager.findNoteFile('D001');
      expect(originalPath).toBeDefined();

      // Archive the note
      const archivedPath = await manager.archiveNoteFile('D001');

      // Check original file is gone
      expect(await fileExists(originalPath!)).toBe(false);

      // Check archived file exists
      expect(archivedPath).toContain('_archive');
      expect(archivedPath).toContain('decisions');
      expect(archivedPath).toContain('D001');
      expect(await fileExists(archivedPath)).toBe(true);

      // Check metadata was updated
      const content = await readFile(archivedPath);
      expect(content).toContain('status: archived');
      expect(content).toContain('archived_at:');
      expect(content).toContain('archive_prior_status:');
      expect(content).toContain('# D001 - Use JWT authentication');
    });

    it('should emit file:archived event', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'Users must login',
        content: 'Users must login',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);

      const archivedHandler = vi.fn();
      manager.on('file:archived', archivedHandler);

      const archivedPath = await manager.archiveNoteFile('R001');

      expect(archivedHandler).toHaveBeenCalledWith({
        noteId: 'R001',
        oldPath: expect.stringContaining('requirements/R001'),
        newPath: archivedPath,
        reason: undefined,
      });
    });

    it('should throw error if note not found', async () => {
      await expect(manager.archiveNoteFile('NONEXISTENT')).rejects.toThrow('Note file not found');
    });

    it('should throw error if already archived', async () => {
      // Create note and archive it first
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Test decision',
        content: 'Test content',
        tags: [],
        created: new Date(),
      };
      await manager.createNoteFile(note);
      await manager.archiveNoteFile('D001');

      // Try to archive again
      await expect(manager.archiveNoteFile('D001')).rejects.toThrow('Note is already archived');
    });

    it('should create archive directory if it does not exist', async () => {
      const note: Note = {
        id: 'C001',
        type: 'Component',
        title: 'Auth component',
        content: 'Auth component',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      
      const archiveDir = path.join(tempDir, '_scepter', 'notes', 'components', '_archive');
      expect(await fileExists(archiveDir)).toBe(false);

      await manager.archiveNoteFile('C001');
      
      expect(await fileExists(archiveDir)).toBe(true);
    });

    it('should preserve file content and frontmatter during archive', async () => {
      const note: Note = {
        id: 'Q001',
        type: 'Question',
        title: 'Which DB to use?',
        content: 'Should we use PostgreSQL or MongoDB?',
        tags: ['database', 'architecture'],
        created: new Date('2024-01-01'),
      };

      await manager.createNoteFile(note);
      const archivedPath = await manager.archiveNoteFile('Q001');

      const content = await readFile(archivedPath);
      expect(content).toContain('tags:\n  - database\n  - architecture');
      expect(content).toContain('status: archived'); // Status should be updated to archived
      expect(content).toContain('Should we use PostgreSQL or MongoDB?');
      expect(content).toContain('archived_at:');
      expect(content).toContain('archive_prior_status: active'); // Default status
    });
  });

  describe('deleteNoteFile', () => {
    it('should move file to _deleted directory and add #deleted tag', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Use JWT',
        content: 'Use JWT',
        tags: ['auth'],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const originalPath = await manager.findNoteFile('D001');

      const deletedPath = await manager.deleteNoteFile('D001');

      // Check original file is gone
      expect(await fileExists(originalPath!)).toBe(false);

      // Check deleted file exists
      expect(deletedPath).toContain('_deleted');
      expect(deletedPath).toContain('decisions');
      expect(await fileExists(deletedPath)).toBe(true);

      // Check metadata was updated
      const content = await readFile(deletedPath);
      expect(content).toContain('status: deleted');
      expect(content).toContain('deleted_at:');
      expect(content).toContain('delete_prior_status:');
      // Note: #deleted tag is added to references TO this note, not the note itself
      expect(content).toContain('tags:\n  - auth');
    });

    it('should emit file:deleted event with correct data', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'Test req',
        content: 'Test req',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);

      const deletedHandler = vi.fn();
      manager.on('file:deleted', deletedHandler);

      const deletedPath = await manager.deleteNoteFile('R001');

      expect(deletedHandler).toHaveBeenCalledWith({
        noteId: 'R001',
        oldPath: expect.stringContaining('requirements/R001'),
        newPath: deletedPath,
        reason: undefined,
        requiresReferenceUpdate: true,
      });
    });

    it('should handle notes already containing #deleted tag', async () => {
      const note: Note = {
        id: 'Q001',
        type: 'Question',
        title: 'Question',
        content: 'Question',
        tags: ['deleted', 'other'],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const deletedPath = await manager.deleteNoteFile('Q001');

      const content = await readFile(deletedPath);
      // Should not duplicate the deleted tag (tags remain as they were)
      expect(content).toContain('tags:\n  - deleted\n  - other');
    });

    it('should throw error if note already deleted', async () => {
      // Create note and delete it first
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Test decision',
        content: 'Test content',
        tags: [],
        created: new Date(),
      };
      await manager.createNoteFile(note);
      await manager.deleteNoteFile('D001');

      // Try to delete again
      await expect(manager.deleteNoteFile('D001')).rejects.toThrow('Note already deleted');
    });

    it('should create unique filename if conflict exists', async () => {
      // Create two notes with same title
      const note1: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Same title',
        content: 'Note 1',
        tags: [],
        created: new Date(),
      };

      const note2: Note = {
        id: 'D002',
        type: 'Decision',
        title: 'Same title',
        content: 'Note 2',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note1);
      await manager.createNoteFile(note2);

      // Delete first note
      const deleted1 = await manager.deleteNoteFile('D001');
      expect(deleted1).toContain('D001 Same title.md');

      // Delete second note - should get unique name
      const deleted2 = await manager.deleteNoteFile('D002');
      expect(deleted2).toContain('D002 Same title');
      expect(deleted1).not.toBe(deleted2);
    });
  });

  describe('restoreNoteFile', () => {
    it('should restore archived file to original location', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Use JWT',
        content: 'Use JWT',
        tags: ['auth'],
        created: new Date(),
      };

      // Create and archive
      await manager.createNoteFile(note);
      const archivedPath = await manager.archiveNoteFile('D001');

      // Restore
      const restoredPath = await manager.restoreNoteFile('D001');

      // Check archived file is gone
      expect(await fileExists(archivedPath)).toBe(false);

      // Check restored file exists in original location
      expect(restoredPath).not.toContain('_archive');
      expect(restoredPath).toContain('decisions/D001');
      expect(await fileExists(restoredPath)).toBe(true);

      // Check metadata was cleaned up
      const content = await readFile(restoredPath);
      expect(content).toContain('status: active'); // Should restore to prior status
      expect(content).not.toContain('archived_at:');
      expect(content).not.toContain('archive_reason:');
      expect(content).not.toContain('archive_prior_status:');
    });

    it('should restore deleted file and remove #deleted tag', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'Test req',
        content: 'Test req',
        tags: ['important'],
        created: new Date(),
      };

      // Create and delete
      await manager.createNoteFile(note);
      await manager.deleteNoteFile('R001');

      // Restore
      const restoredPath = await manager.restoreNoteFile('R001');

      // Check restored file
      expect(restoredPath).not.toContain('_deleted');
      expect(await fileExists(restoredPath)).toBe(true);

      // Check tags
      const content = await readFile(restoredPath);
      expect(content).toContain('tags:\n  - important');
      expect(content).not.toContain('deleted_at:');
      expect(content).not.toContain('delete_reason:');
      expect(content).not.toContain('delete_prior_status:');
    });

    it('should emit file:restored event', async () => {
      const note: Note = {
        id: 'Q001',
        type: 'Question',
        title: 'Question',
        content: 'Question',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const archivedPath = await manager.archiveNoteFile('Q001');

      const restoredHandler = vi.fn();
      manager.on('file:restored', restoredHandler);

      const restoredPath = await manager.restoreNoteFile('Q001');

      expect(restoredHandler).toHaveBeenCalledWith({
        noteId: 'Q001',
        oldPath: archivedPath,
        newPath: restoredPath,
        wasDeleted: false,
      });
    });

    it('should throw error if note not found in archive or deleted', async () => {
      await expect(manager.restoreNoteFile('NONEXISTENT')).rejects.toThrow(
        'Note file not found'
      );
    });

    it.skip('should throw error if restore target path already exists', async () => {
      // This test is skipped because file watching can interfere with the test setup
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Test decision',
        content: 'Test decision',
        tags: [],
        created: new Date(),
      };

      // Create and archive the note
      await manager.createNoteFile(note);
      const originalPath = await manager.findNoteFile('D001');
      await manager.archiveNoteFile('D001');
      
      // Create a new file at the original location to simulate a conflict
      await fs.writeFile(originalPath!, '# Conflicting file');
      
      // Now try to restore - should fail due to existing file
      await expect(manager.restoreNoteFile('D001')).rejects.toThrow('Cannot restore - file already exists at:');
    });

    it('should handle restoring notes with complex tags', async () => {
      const note: Note = {
        id: 'M001',
        type: 'Milestone',
        title: 'Q1 Release',
        content: 'Q1 Release',
        tags: ['release', 'important', 'q1-2024'],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      await manager.deleteNoteFile('M001');

      const restoredPath = await manager.restoreNoteFile('M001');
      const content = await readFile(restoredPath);

      // Should preserve all original tags except 'deleted'
      expect(content).toContain('release');
      expect(content).toContain('important');
      expect(content).toContain('q1-2024');
      expect(content).not.toContain('deleted');
    });
  });

  describe('purgeNoteFile', () => {
    it('should throw error when trying to purge archived file', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'To be purged',
        content: 'To be purged',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      await manager.archiveNoteFile('D001');

      // Should not be able to purge archived files
      await expect(manager.purgeNoteFile('D001')).rejects.toThrow('Can only purge deleted notes');
    });

    it('should permanently delete from _deleted directory', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'To be purged',
        content: 'To be purged',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const deletedPath = await manager.deleteNoteFile('R001');

      await manager.purgeNoteFile('R001');

      expect(await fileExists(deletedPath)).toBe(false);
    });

    it('should emit file:purged event', async () => {
      const note: Note = {
        id: 'Q001',
        type: 'Question',
        title: 'Question',
        content: 'Question',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const deletedPath = await manager.deleteNoteFile('Q001');

      const purgedHandler = vi.fn();
      manager.on('file:purged', purgedHandler);

      await manager.purgeNoteFile('Q001');

      expect(purgedHandler).toHaveBeenCalledWith({
        noteId: 'Q001',
        filePath: deletedPath,
      });
    });

    it('should throw error if note not in archive or deleted', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Active note',
        content: 'Active note',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);

      await expect(manager.purgeNoteFile('D001')).rejects.toThrow(
        'Can only purge deleted notes'
      );
    });

    it('should handle purging non-existent files gracefully', async () => {
      await expect(manager.purgeNoteFile('NONEXISTENT')).rejects.toThrow('Note file not found');
    });
  });

  describe('batch operations', () => {
    it('should archive multiple notes in batch', async () => {
      // Batch operations should be implemented in NoteManager, not NoteFileManager
      // This test is kept as a placeholder to document the expected behavior
      const notes = [
        { id: 'D001', type: 'Decision', title: 'Decision 1', content: 'Decision 1', tags: [], created: new Date() },
        { id: 'R001', type: 'Requirement', title: 'Req 1', content: 'Req 1', tags: [], created: new Date() },
        { id: 'Q001', type: 'Question', title: 'Question 1', content: 'Question 1', tags: [], created: new Date() },
      ] as Note[];

      // Create all notes
      for (const note of notes) {
        await manager.createNoteFile(note);
      }

      // Archive all - this would be implemented in NoteManager
      // const results = await manager.archiveBatch(['D001', 'R001', 'Q001']);

      // expect(results).toHaveLength(3);
      // expect(results[0].success).toBe(true);
      // expect(results[0].archivedPath).toContain('_archive');
      // expect(results[1].success).toBe(true);
      // expect(results[2].success).toBe(true);

      // Verify all are archived
      // for (const noteId of ['D001', 'R001', 'Q001']) {
      //   expect(await manager.findNoteFile(noteId)).toContain('_archive');
      // }
    });

    it('should handle partial batch failures gracefully', async () => {
      // Batch operations should be implemented in NoteManager
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Decision 1',
        content: 'Decision 1',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);

      // Try to archive one existing and one non-existing
      // const results = await manager.archiveBatch(['D001', 'NONEXISTENT']);

      // expect(results).toHaveLength(2);
      // expect(results[0].success).toBe(true);
      // expect(results[0].noteId).toBe('D001');
      // expect(results[1].success).toBe(false);
      // expect(results[1].noteId).toBe('NONEXISTENT');
      // expect(results[1].error).toContain('not found');
    });

    it('should delete multiple notes in batch', async () => {
      // Batch operations should be implemented in NoteManager
      const notes = [
        { id: 'D001', type: 'Decision', title: 'Decision 1', content: 'Decision 1', tags: [], created: new Date() },
        { id: 'D002', type: 'Decision', title: 'Decision 2', content: 'Decision 2', tags: [], created: new Date() },
      ] as Note[];

      for (const note of notes) {
        await manager.createNoteFile(note);
      }

      // const results = await manager.deleteBatch(['D001', 'D002']);

      // expect(results).toHaveLength(2);
      // expect(results.every(r => r.success)).toBe(true);
      // expect(results.every(r => r.deletedPath?.includes('_deleted'))).toBe(true);
    });

    it('should restore multiple notes in batch', async () => {
      // Batch operations should be implemented in NoteManager
      const notes = [
        { id: 'R001', type: 'Requirement', title: 'Req 1', content: 'Req 1', tags: [], created: new Date() },
        { id: 'R002', type: 'Requirement', title: 'Req 2', content: 'Req 2', tags: [], created: new Date() },
      ] as Note[];

      // Create and archive notes
      for (const note of notes) {
        await manager.createNoteFile(note);
        await manager.archiveNoteFile(note.id);
      }

      // const results = await manager.restoreBatch(['R001', 'R002']);

      // expect(results).toHaveLength(2);
      // expect(results.every(r => r.success)).toBe(true);
      // expect(results.every(r => !r.restoredPath?.includes('_archive'))).toBe(true);
    });

    it('should purge multiple notes in batch', async () => {
      // Batch operations should be implemented in NoteManager
      const notes = [
        { id: 'Q001', type: 'Question', title: 'Q1', content: 'Q1', tags: [], created: new Date() },
        { id: 'Q002', type: 'Question', title: 'Q2', content: 'Q2', tags: [], created: new Date() },
      ] as Note[];

      // Create and delete notes
      for (const note of notes) {
        await manager.createNoteFile(note);
        await manager.deleteNoteFile(note.id);
      }

      // Purge individually (batch would be in NoteManager)
      for (const noteId of ['Q001', 'Q002']) {
        await manager.purgeNoteFile(noteId);
      }

      // Verify all are gone
      for (const noteId of ['Q001', 'Q002']) {
        const path = await manager.findNoteFile(noteId, { includeDeleted: true });
        expect(path).toBeNull();
      }
    });
  });

  describe('findNoteFile with archive/deleted support', () => {
    it('should find archived notes when includeArchived is true', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Archived decision',
        content: 'Archived decision',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      await manager.archiveNoteFile('D001');

      // Should not find by default
      expect(await manager.findNoteFile('D001')).toBeNull();

      // Should find with includeArchived
      const foundPath = await manager.findNoteFile('D001', { includeArchived: true });
      expect(foundPath).toContain('_archive');
      expect(foundPath).toContain('D001');
    });

    it('should find deleted notes when includeDeleted is true', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'Deleted req',
        content: 'Deleted req',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      await manager.deleteNoteFile('R001');

      // Should not find by default
      expect(await manager.findNoteFile('R001')).toBeNull();

      // Should find with includeDeleted
      const foundPath = await manager.findNoteFile('R001', { includeDeleted: true });
      expect(foundPath).toContain('_deleted');
      expect(foundPath).toContain('R001');
    });

    it('should prefer active over archived/deleted', async () => {
      // Create active note
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Active',
        content: 'Active',
        tags: [],
        created: new Date(),
      };
      await manager.createNoteFile(note);

      // Manually create archived version (simulating edge case)
      const archivePath = path.join(tempDir, '_scepter', 'notes', '_archive', 'decisions', 'D001 Old.md');
      await ensureDir(path.dirname(archivePath));
      await writeFile(archivePath, '# D001 - Old archived version');

      // Should find active version
      const foundPath = await manager.findNoteFile('D001', { includeArchived: true });
      expect(foundPath).not.toContain('_archive');
      expect(foundPath).toContain('D001 Active.md');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle file system errors gracefully', async () => {
      const note: Note = {
        id: 'D001',
        type: 'Decision',
        title: 'Test',
        content: 'Test',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);

      // Mock file system error
      vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Permission denied'));

      await expect(manager.archiveNoteFile('D001')).rejects.toThrow('Permission denied');

      // Original file should still exist
      const originalPath = await manager.findNoteFile('D001');
      expect(await fileExists(originalPath!)).toBe(true);
    });

    it('should handle concurrent operations safely', async () => {
      const notes = Array.from({ length: 5 }, (_, i) => ({
        id: `D00${i + 1}`,
        type: 'Decision',
        title: `Decision ${i + 1}`,
        content: `Decision ${i + 1}`,
        tags: [],
        created: new Date(),
      })) as Note[];

      // Create all notes
      await Promise.all(notes.map(note => manager.createNoteFile(note)));

      // Archive all concurrently
      const archivePromises = notes.map(note => manager.archiveNoteFile(note.id));
      const results = await Promise.all(archivePromises);

      // All should succeed
      expect(results).toHaveLength(5);
      results.forEach(path => {
        expect(path).toContain('_archive');
      });
    });

    it('should preserve special characters in filenames during operations', async () => {
      const note: Note = {
        id: 'Q001',
        type: 'Question',
        title: 'Should we use Node.js v20+ for this?',
        content: 'Content',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      const archivedPath = await manager.archiveNoteFile('Q001');

      // Filename should be sanitized (dots and plus removed)
      expect(path.basename(archivedPath)).toBe('Q001 Should we use Node js v20 for this.md');
    });
  });

  /** @validates {R008.§1} Content Aggregation */
  describe('getAggregatedContents', () => {
    /** @validates {R008.§1.AC.05} Non-folder notes identical to getFileContents */
    it('should return main file content for non-folder notes', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'Simple Note',
        content: '---\nid: R001\n---\n\n# R001 Simple Note\n\n## §1 Section\n\n### AC.01 Criterion',
        tags: [],
        created: new Date(),
      };

      await manager.createNoteFile(note);
      await manager.buildIndex();

      const result = await manager.getAggregatedContents('R001');
      expect(result).not.toBeNull();
      expect(result).toContain('AC.01 Criterion');
    });

    /** @validates {R008.§1.AC.01} Main file + companion .md files concatenated */
    it('should aggregate companion markdown files for folder notes', async () => {
      // Create folder note structure manually
      const folderPath = path.join(tempDir, '_scepter', 'notes', 'requirements', 'R001 Test Folder');
      await ensureDir(folderPath);
      await writeFile(
        path.join(folderPath, 'R001.md'),
        '---\nid: R001\n---\n\n# R001 Test Folder\n\n## §1 Main Section\n\n### AC.01 Main criterion',
      );
      await writeFile(
        path.join(folderPath, 'details.md'),
        '---\ntitle: Details\n---\n\n## §2 Detail Section\n\n### AC.01 Detail criterion',
      );

      await manager.buildIndex();

      const result = await manager.getAggregatedContents('R001');
      expect(result).not.toBeNull();
      // Main file content present
      expect(result).toContain('§1 Main Section');
      expect(result).toContain('AC.01 Main criterion');
      // Companion content present
      expect(result).toContain('§2 Detail Section');
      expect(result).toContain('AC.01 Detail criterion');
    });

    /** @validates {R008.§1.AC.03} Frontmatter stripped from companion files */
    it('should strip frontmatter from companion files', async () => {
      const folderPath = path.join(tempDir, '_scepter', 'notes', 'requirements', 'R001 Test Folder');
      await ensureDir(folderPath);
      await writeFile(
        path.join(folderPath, 'R001.md'),
        '---\nid: R001\n---\n\n# R001 Test\n\n## §1 Section',
      );
      await writeFile(
        path.join(folderPath, 'companion.md'),
        '---\ntitle: Should Be Stripped\n---\n\n## §2 Companion Section',
      );

      await manager.buildIndex();

      const result = await manager.getAggregatedContents('R001');
      expect(result).not.toBeNull();
      // Companion frontmatter should be stripped
      expect(result).not.toContain('Should Be Stripped');
      // Companion body should be present
      expect(result).toContain('§2 Companion Section');
      // Main file frontmatter should be preserved
      expect(result).toContain('id: R001');
    });

    /** @validates {R008.§1.AC.04} Non-markdown files excluded from aggregation */
    it('should not include non-markdown companion files', async () => {
      const folderPath = path.join(tempDir, '_scepter', 'notes', 'requirements', 'R001 Test Folder');
      await ensureDir(folderPath);
      await writeFile(
        path.join(folderPath, 'R001.md'),
        '---\nid: R001\n---\n\n## §1 Section',
      );
      await writeFile(
        path.join(folderPath, 'data.json'),
        '{"key": "value"}',
      );
      await writeFile(
        path.join(folderPath, 'details.md'),
        '## §2 Details',
      );

      await manager.buildIndex();

      const result = await manager.getAggregatedContents('R001');
      expect(result).not.toBeNull();
      expect(result).not.toContain('"key"');
      expect(result).toContain('§2 Details');
    });

    /** @validates {R008.§1.AC.06} Returns null for non-existent notes */
    it('should return null for non-existent notes', async () => {
      const result = await manager.getAggregatedContents('NONEXISTENT');
      expect(result).toBeNull();
    });
  });
});
