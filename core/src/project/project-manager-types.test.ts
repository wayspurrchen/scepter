import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProjectManager } from './project-manager';
import { ConfigManager } from '../config/config-manager';
import { NoteManager } from '../notes/note-manager';
import * as fs from 'fs-extra';
import * as path from 'path';
import { tmpdir } from 'os';
import { glob } from 'glob';
import type { TypeInfo, RenameResult, DeleteResult, ProgressInfo } from './types';

vi.mock('fs-extra', () => ({
  pathExists: vi.fn(),
  ensureDir: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  copyFile: vi.fn(),
  rmdir: vi.fn()
}));

vi.mock('glob', () => ({
  glob: vi.fn()
}));

vi.mock('fs/promises', () => ({
  access: vi.fn().mockRejectedValue(new Error('Not found')),
  rename: vi.fn(),
  readFile: vi.fn().mockResolvedValue('---\ntitle: Test\ntype: Test\n---\nContent'),
  writeFile: vi.fn(),
  readdir: vi.fn().mockResolvedValue([]),
  rmdir: vi.fn()
}));

describe('ProjectManager Type Operations', () => {
  let projectPath: string;
  let projectManager: ProjectManager;
  let mockConfigManager: any;
  let mockNoteManager: any;

  beforeEach(async () => {
    // Create temp directory
    projectPath = path.join(tmpdir(), `test-project-${Date.now()}`);
    
    // Mock dependencies
    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        noteTypes: {
          Decision: { shortcode: 'D', folder: 'decisions' },
          Requirement: { shortcode: 'R', folder: 'requirements' }
        },
        paths: {
          notesRoot: '_scepter/notes',
          templatesRoot: '_scepter/templates'
        }
      }),
      addNoteType: vi.fn(),
      updateNoteType: vi.fn(),
      removeNoteType: vi.fn(),
      saveConfig: vi.fn(),
      createBackup: vi.fn().mockResolvedValue('/backup/path'),
      restoreBackup: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    };

    mockNoteManager = {
      getStatistics: vi.fn().mockResolvedValue({
        totalNotes: 10,
        notesByType: {
          Decision: 5,
          Requirement: 3
        }
      }),
      initialize: vi.fn(),
      getNotes: vi.fn().mockResolvedValue({ notes: [], totalCount: 0, hasMore: false }),
      getAllNotes: vi.fn().mockResolvedValue([]),
      on: vi.fn()
    };

    // Mock fs methods
    vi.mocked(fs.pathExists).mockResolvedValue(false);
    vi.mocked(fs.ensureDir).mockResolvedValue();
    vi.mocked(fs.readdir).mockResolvedValue([]);

    projectManager = new ProjectManager(projectPath, {
      configManager: mockConfigManager,
      noteManager: mockNoteManager
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('listNoteTypes', () => {
    it('should return all configured note types with counts', async () => {
      const types = await projectManager.listNoteTypes();
      
      expect(types).toHaveLength(2);
      expect(types[0]).toEqual({
        type: 'Decision',
        shortcode: 'D',
        folder: 'decisions',
        noteCount: 5,
        hasTemplate: false,
        description: undefined
      });
      expect(types[1]).toEqual({
        type: 'Requirement',
        shortcode: 'R',
        folder: 'requirements',
        noteCount: 3,
        hasTemplate: false,
        description: undefined
      });
    });

    it('should handle empty type configuration', async () => {
      mockConfigManager.getConfig.mockReturnValue({
        noteTypes: {},
        paths: {}
      });

      const types = await projectManager.listNoteTypes();
      expect(types).toHaveLength(0);
    });

    it('should include template existence info', async () => {
      // Mock that Decision has a template
      vi.mocked(fs.pathExists).mockImplementation(async (p) => {
        return p.toString().includes('Decision.md');
      });

      const types = await projectManager.listNoteTypes();
      expect(types[0].hasTemplate).toBe(true);
      expect(types[1].hasTemplate).toBe(false);
    });

    it('should include description if present', async () => {
      mockConfigManager.getConfig.mockReturnValue({
        noteTypes: {
          Decision: { 
            shortcode: 'D', 
            folder: 'decisions',
            description: 'Technical decisions and choices'
          }
        },
        paths: {}
      });

      const types = await projectManager.listNoteTypes();
      expect(types[0].description).toBe('Technical decisions and choices');
    });
  });

  describe('addNoteType', () => {
    it('should add new type to config without folder when not provided', async () => {
      await projectManager.addNoteType('Architecture', 'ARCH');

      expect(mockConfigManager.addNoteType).toHaveBeenCalledWith('Architecture', {
        shortcode: 'ARCH',
      });
    });

    it('should create type folder only when folder is explicitly provided', async () => {
      await projectManager.addNoteType('Architecture', 'ARCH', {
        folder: 'architectures'
      });

      expect(fs.ensureDir).toHaveBeenCalledWith(
        path.join(projectPath, '_scepter/notes/architectures')
      );
    });

    it('should not create folder when none is specified', async () => {
      await projectManager.addNoteType('Architecture', 'ARCH');

      expect(fs.ensureDir).not.toHaveBeenCalled();
    });

    it('should reject duplicate type names', async () => {
      await expect(
        projectManager.addNoteType('Decision', 'DEC')
      ).rejects.toThrow("Note type 'Decision' already exists");
    });

    it('should reject invalid shortcodes', async () => {
      await expect(
        projectManager.addNoteType('Test', 'TEST123')
      ).rejects.toThrow('Shortcode must be 1-5 letters');

      await expect(
        projectManager.addNoteType('Test', '123')
      ).rejects.toThrow('Shortcode must be 1-5 letters');
    });

    it('should reject duplicate shortcodes', async () => {
      await expect(
        projectManager.addNoteType('NewType', 'D')
      ).rejects.toThrow("Shortcode 'D' is already used by type 'Decision'");
    });

    it('should use custom folder name', async () => {
      await projectManager.addNoteType('UserStory', 'US', {
        folder: 'user-stories'
      });

      expect(mockConfigManager.addNoteType).toHaveBeenCalledWith('UserStory', {
        shortcode: 'US',
        folder: 'user-stories'
      });
    });

    it('should add description if provided', async () => {
      await projectManager.addNoteType('Bug', 'BUG', {
        description: 'Tracks defects and issues'
      });

      expect(mockConfigManager.addNoteType).toHaveBeenCalledWith('Bug', {
        shortcode: 'BUG',
        description: 'Tracks defects and issues'
      });
    });

    it('should reinitialize note manager after adding type', async () => {
      await projectManager.addNoteType('Architecture', 'ARCH');

      expect(mockNoteManager.initialize).toHaveBeenCalled();
    });
  });

  describe('renameNoteType', () => {
    describe('planning phase', () => {
      beforeEach(() => {
        // Mock notes for the type
        mockNoteManager.getNotes.mockResolvedValue({
          notes: [
            { id: 'D001', type: 'Decision', title: 'Use PostgreSQL' },
            { id: 'D002', type: 'Decision', title: 'Use TypeScript' }
          ],
          totalCount: 2,
          hasMore: false
        });
        
        // Mock getAllNotes to return same notes
        mockNoteManager.getAllNotes.mockResolvedValue([
          { 
            id: 'D001', 
            noteType: 'Decision', 
            title: 'Use PostgreSQL',
            filePath: '/test/project/_scepter/notes/decisions/D001 Use PostgreSQL.md'
          },
          { 
            id: 'D002', 
            noteType: 'Decision', 
            title: 'Use TypeScript',
            filePath: '/test/project/_scepter/notes/decisions/D002 Use TypeScript.md'
          }
        ]);

        // Mock file system for references
        vi.mocked(fs.readdir).mockResolvedValue(['src']);
        vi.mocked(fs.readFile).mockResolvedValue(
          'This implements {D001} for database\nAnd {D002} for language choice'
        );
        
        // Mock glob to return a test file
        vi.mocked(glob).mockResolvedValue([
          path.join(projectPath, 'src', 'test.ts')
        ]);
      });

      it('should calculate all required changes', async () => {
        const result = await projectManager.renameNoteType(
          'Decision',
          'TechnicalDecision',
          { dryRun: true }
        );

        expect(result.executed).toBe(false);
        expect(result.changes).toEqual({
          configUpdates: 1,
          folderRenames: 1,
          noteRenames: 2,
          frontmatterUpdates: 2,
          referenceUpdates: {
            fileCount: 1,
            totalReferences: 2
          },
          templateRenames: 0
        });
      });

      it('should find all notes of the type', async () => {
        const result = await projectManager.renameNoteType(
          'Decision',
          'TechnicalDecision',
          { dryRun: true }
        );

        expect(mockNoteManager.getAllNotes).toHaveBeenCalled();
        expect(result.changes.noteRenames).toBe(2);
      });

      it('should find all references to update', async () => {
        const result = await projectManager.renameNoteType(
          'Decision',
          'TechnicalDecision',
          { dryRun: true }
        );

        expect(result.details?.referenceFiles).toHaveLength(1);
        expect(result.details?.referenceFiles[0]).toMatchObject({
          path: expect.stringContaining('src'),
          referenceCount: 2,
          examples: expect.arrayContaining(['{D001}', '{D002}'])
        });
      });

      it('should return accurate counts', async () => {
        const result = await projectManager.renameNoteType(
          'Decision',
          'TechnicalDecision',
          { dryRun: true }
        );

        expect(result.changes.noteRenames).toBe(2);
        expect(result.changes.referenceUpdates.totalReferences).toBe(2);
      });
    });

    describe('execution phase', () => {
      beforeEach(() => {
        // Set up the same mocks as planning phase
        mockNoteManager.getAllNotes.mockResolvedValue([
          { 
            id: 'D001', 
            noteType: 'Decision', 
            title: 'Use PostgreSQL',
            filePath: '/test/project/_scepter/notes/decisions/D001 Use PostgreSQL.md'
          },
          { 
            id: 'D002', 
            noteType: 'Decision', 
            title: 'Use TypeScript',
            filePath: '/test/project/_scepter/notes/decisions/D002 Use TypeScript.md'
          }
        ]);
        
        // Mock glob to return a test file
        vi.mocked(glob).mockResolvedValue([
          path.join(projectPath, 'src', 'test.ts')
        ]);
        
        // Mock file content
        vi.mocked(fs.readFile).mockResolvedValue(
          'This implements {D001} for database\nAnd {D002} for language choice' as any
        );
      });
      
      it('should rename type in config', async () => {
        const result = await projectManager.renameNoteType(
          'Decision',
          'TechnicalDecision',
          { skipConfirmation: true }
        );

        // When renaming type name, it removes old and adds new
        expect(mockConfigManager.removeNoteType).toHaveBeenCalledWith('Decision');
        expect(mockConfigManager.addNoteType).toHaveBeenCalledWith(
          'TechnicalDecision',
          expect.objectContaining({
            shortcode: 'D',
            folder: 'decisions'
          })
        );
      });

      it('should rename folder on disk', async () => {
        // Test will be implemented with actual rename logic
      });

      it('should update note file names with new shortcode', async () => {
        // Test will be implemented with actual rename logic
      });

      it('should update type in note frontmatter', async () => {
        // Test will be implemented with actual rename logic
      });

      it('should update all references across codebase', async () => {
        // Test will be implemented with actual rename logic
      });

      it('should rename template if exists', async () => {
        // Test will be implemented with actual rename logic
      });

      it('should rollback on failure', async () => {
        // Test will be implemented with actual rename logic
      });

      it('should skip with dry-run option', async () => {
        const result = await projectManager.renameNoteType(
          'Decision',
          'TechnicalDecision',
          { dryRun: true }
        );

        expect(result.executed).toBe(false);
        expect(mockConfigManager.updateNoteType).not.toHaveBeenCalled();
        expect(fs.rename).not.toHaveBeenCalled();
      });
    });

    describe('shortcode changes', () => {
      beforeEach(() => {
        // Set up the same mocks as planning phase
        mockNoteManager.getAllNotes.mockResolvedValue([
          { 
            id: 'D001', 
            noteType: 'Decision', 
            title: 'Use PostgreSQL',
            filePath: '/test/project/_scepter/notes/decisions/D001 Use PostgreSQL.md'
          },
          { 
            id: 'D002', 
            noteType: 'Decision', 
            title: 'Use TypeScript',
            filePath: '/test/project/_scepter/notes/decisions/D002 Use TypeScript.md'
          }
        ]);
        
        // Mock glob to return a test file
        vi.mocked(glob).mockResolvedValue([
          path.join(projectPath, 'src', 'test.ts')
        ]);
        
        // Mock file content
        vi.mocked(fs.readFile).mockResolvedValue(
          'This implements {D001} for database\nAnd {D002} for language choice' as any
        );
      });
      
      it('should update note IDs when shortcode changes', async () => {
        const result = await projectManager.renameNoteType(
          'Decision',
          'TechDecision',
          { 
            newShortcode: 'TD',
            dryRun: true 
          }
        );

        expect(result.details?.noteFiles).toContainEqual({
          oldPath: expect.stringContaining('D001'),
          newPath: expect.stringContaining('TD001')
        });
      });

      it('should update references with new shortcode', async () => {
        // Test will be implemented with actual rename logic
      });
    });
  });

  describe('deleteNoteType', () => {
    beforeEach(() => {
      mockNoteManager.getNotes.mockResolvedValue({
        notes: [
          { id: 'D001', type: 'Decision', title: 'Use PostgreSQL' }
        ],
        totalCount: 1,
        hasMore: false
      });
      
      // Mock getAllNotes to return same notes
      mockNoteManager.getAllNotes.mockResolvedValue([
        { 
          id: 'D001', 
          noteType: 'Decision', 
          title: 'Use PostgreSQL',
          filePath: '/test/project/_scepter/notes/decisions/D001 Use PostgreSQL.md'
        }
      ]);
      
      // Mock file content for move operations
      vi.mocked(fs.readFile).mockResolvedValue(`---
title: Use PostgreSQL
type: Decision
status: draft
---

# Use PostgreSQL

We will use PostgreSQL as our database.` as any);
    });

    it('should block deletion if notes exist (default)', async () => {
      await expect(
        projectManager.deleteNoteType('Decision')
      ).rejects.toThrow("Cannot delete type 'Decision': 1 notes exist");
    });

    it('should archive all notes with archive strategy', async () => {
      const result = await projectManager.deleteNoteType('Decision', {
        strategy: 'archive',
        skipConfirmation: true
      });

      expect(result.executed).toBe(true);
      expect(result.changes.notesArchived).toBe(1);
    });

    it('should move notes to Uncategorized type', async () => {
      const result = await projectManager.deleteNoteType('Decision', {
        strategy: 'move-to-uncategorized',
        skipConfirmation: true
      });

      expect(result.executed).toBe(true);
      expect(result.changes.notesMoved).toBe(1);
    });

    it('should remove type from config', async () => {
      mockNoteManager.getNotes.mockResolvedValue({
        notes: [],
        totalCount: 0,
        hasMore: false
      });
      mockNoteManager.getAllNotes.mockResolvedValue([]);

      await projectManager.deleteNoteType('Decision', {
        skipConfirmation: true
      });

      expect(mockConfigManager.removeNoteType).toHaveBeenCalledWith('Decision');
    });

    it('should remove empty folder', async () => {
      mockNoteManager.getNotes.mockResolvedValue({
        notes: [],
        totalCount: 0,
        hasMore: false
      });
      mockNoteManager.getAllNotes.mockResolvedValue([]);
      
      // Mock readdir to return empty array
      vi.mocked(fs.readdir).mockResolvedValue([]);

      await projectManager.deleteNoteType('Decision', {
        skipConfirmation: true
      });

      const { rmdir } = await import('fs/promises');
      expect(rmdir).toHaveBeenCalledWith(
        expect.stringContaining('decisions')
      );
    });

    it('should handle missing folder gracefully', async () => {
      mockNoteManager.getNotes.mockResolvedValue({
        notes: [],
        totalCount: 0,
        hasMore: false
      });
      mockNoteManager.getAllNotes.mockResolvedValue([]);
      
      // Mock readdir to throw error for missing folder
      const { readdir } = await import('fs/promises');
      vi.mocked(readdir).mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

      const result = await projectManager.deleteNoteType('Decision', {
        skipConfirmation: true
      });

      expect(result.executed).toBe(true);
      const { rmdir } = await import('fs/promises');
      expect(rmdir).not.toHaveBeenCalled();
    });
  });
});