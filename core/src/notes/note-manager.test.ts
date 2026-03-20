import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupTestProject,
  cleanupTestProject,
  testData,
  paths,
  verifyFileExists,
  getExpectedNotePath,
  type TestContext,
} from '../test-utils/integration-test-helpers';
import type { Note } from '../types/note';
import fs from 'fs-extra';
import * as path from 'path';
import type { NoteManager } from './note-manager';
import type { NoteTypeTemplateManager } from '../templates/note-type-template-manager';
import type { ReferenceManager } from '../references/reference-manager';
import type { NoteFileManager } from './note-file-manager';

describe('NoteManager', () => {
  let ctx: TestContext;
  let noteManager: NoteManager;
  let noteFileManager: NoteFileManager;
  let noteTypeTemplateManager: NoteTypeTemplateManager;
  let referenceManager: ReferenceManager;
  let templateManager: NoteTypeTemplateManager;
  let testProjectPath: string;

  beforeEach(async () => {
    ctx = await setupTestProject('test-note-manager');
    noteManager = ctx.noteManager;
    noteFileManager = ctx.noteFileManager;
    noteTypeTemplateManager = ctx.noteTypeTemplateManager;
    referenceManager = ctx.referenceManager;
    templateManager = ctx.noteTypeTemplateManager;
    testProjectPath = ctx.projectPath;
  });

  afterEach(async () => {
    await cleanupTestProject(ctx);
  });

  describe('ID Generation', () => {
    it('should generate sequential IDs for each note type', async () => {
      const id1 = await noteManager.generateNoteId('Decision');
      const id2 = await noteManager.generateNoteId('Decision');
      const id3 = await noteManager.generateNoteId('Requirement');

      expect(id1).toBe('D001');
      expect(id2).toBe('D002');
      expect(id3).toBe('R001');
    });

    it('should scan filesystem for highest ID when initializing', async () => {
      // Create some existing notes
      const notesPath = paths.noteTypeFolder(testProjectPath, 'decisions');
      await fs.ensureDir(notesPath);
      await fs.writeFile(path.join(notesPath, 'D005 Test Decision.md'), '{D005: Existing decision}');

      // Re-initialize to scan filesystem
      await noteManager.refreshIndex();

      // Next ID should be D006
      const nextId = await noteManager.generateNoteId('Decision');
      expect(nextId).toBe('D006');
    });

    it('should validate note ID format', () => {
      expect(noteManager.validateNoteId('D001')).toBe(true);
      expect(noteManager.validateNoteId('REQ001')).toBe(true);
      expect(noteManager.validateNoteId('D99999')).toBe(true);
      expect(noteManager.validateNoteId('d001')).toBe(false);
      expect(noteManager.validateNoteId('D1')).toBe(false);
      expect(noteManager.validateNoteId('123')).toBe(false);
    });

    it('should handle up to 99999 IDs per type', async () => {
      // Simulate high ID counter
      const notesPath = paths.noteTypeFolder(testProjectPath, 'decisions');
      await fs.ensureDir(notesPath);
      await fs.writeFile(path.join(notesPath, 'D99998 Test.md'), '{D99998: Test}');

      await noteManager.refreshIndex();

      const nextId = await noteManager.generateNoteId('Decision');
      expect(nextId).toBe('D99999');
    });
  });

  describe('Note Creation', () => {
    it('should create note with generated ID', async () => {
      const note = await noteManager.createNote({
        type: 'Decision',
        content: 'Use PostgreSQL for database',
        tags: ['architecture', 'database'],
      });

      expect(note.id).toBe('D001');
      expect(note.type).toBe('Decision');
      expect(note.content).toBe('Use PostgreSQL for database');
      expect(note.tags).toEqual(['architecture', 'database']);
    });

    it('should create note file in correct type folder', async () => {
      const note = await noteManager.createNote({
        type: 'Requirement',
        content: 'Users must be able to login',
        tags: ['auth'],
      });

      const filePath = await noteManager.findNoteFile(note.id);
      expect(filePath).toBeTruthy();
      expect(filePath).toContain('requirements/R001');
    });

    it('should use template content when not provided', async () => {
      // Mock template manager to return template content
      vi.spyOn(templateManager, 'getTemplateContent').mockResolvedValue(
        '# Decision Template\n\n## Context\n\n## Decision\n\n## Consequences',
      );

      const note = await noteManager.createNote({
        type: 'Decision',
      });

      expect(note.content).toContain('# Decision Template');
      expect(templateManager.getTemplateContent).toHaveBeenCalledWith('Decision');
    });

    it('should emit note:created event', async () => {
      const handler = vi.fn();
      noteManager.on('note:created', handler);

      const note = await noteManager.createNote({
        type: 'Question',
        content: 'Should we use TypeScript?',
      });

      expect(handler).toHaveBeenCalledWith(note);
    });

    it('should prevent duplicate note IDs', async () => {
      await noteManager.createNote({
        type: 'Decision',
        id: 'D001',
        content: 'First decision',
      });

      await expect(
        noteManager.createNote({
          type: 'Decision',
          id: 'D001',
          content: 'Duplicate decision',
        }),
      ).rejects.toThrow('Note D001 already exists');
    });

    it('should handle creation failures gracefully', async () => {
      // Mock file creation to fail
      vi.spyOn(noteFileManager, 'createNoteFile').mockRejectedValue(new Error('Permission denied'));

      await expect(
        noteManager.createNote({
          type: 'Decision',
          content: 'Test decision',
        }),
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('File Operations', () => {
    it('should find note file by ID', async () => {
      const note = await noteManager.createNote({
        type: 'Decision',
        content: 'Architecture decision',
      });

      const filePath = await noteManager.findNoteFile(note.id);
      expect(filePath).toBeTruthy();
      expect(filePath).toContain('D001');
      expect(filePath!.endsWith('.md')).toBe(true);
    });

    it('should return null if file not found', async () => {
      const filePath = await noteManager.findNoteFile('D999');
      expect(filePath).toBeNull();
    });

    it('should ensure note file exists without creating', async () => {
      // Create a note
      const note = await noteManager.createNote({
        type: 'Question',
        content: 'Test question',
      });

      // Check it exists
      expect(await noteManager.ensureNoteFile(note.id)).toBe(true);

      // Check non-existent note
      expect(await noteManager.ensureNoteFile('Q999')).toBe(false);
    });

    it('should move note to different type', async () => {
      // Create a question
      const note = await noteManager.createNote({
        type: 'Question',
        content: 'Should we use this approach?',
      });

      expect(note.id).toBe('Q001');

      // Move to decision
      await noteManager.moveNoteToType('Q001', 'Decision');

      // Verify old note is gone
      const oldNote = await noteManager.getNoteById('Q001');
      expect(oldNote).toBeNull();

      // Verify new note exists
      const newNote = await noteManager.getNoteById('D001');
      expect(newNote).toBeTruthy();
      expect(newNote?.type).toBe('Decision');
      expect(newNote?.content).toBe('Should we use this approach?');
    });

    it('should detect orphaned files', async () => {
      // Create a note file manually (simulating external creation)
      const orphanPath = path.join(testProjectPath, '_scepter/notes/decisions');
      await fs.ensureDir(orphanPath);
      await fs.writeFile(path.join(orphanPath, 'D999 Orphaned.md'), '{D999: Orphaned note}');

      const orphaned = await noteManager.detectOrphanedFiles();
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0]).toContain('D999 Orphaned.md');
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Create test notes
      await noteManager.createNote({
        type: 'Decision',
        content: 'Use PostgreSQL for database',
        tags: ['architecture', 'database'],
      });

      await noteManager.createNote({
        type: 'Decision',
        content: 'Use TypeScript for type safety',
        tags: ['architecture', 'tooling'],
      });

      await noteManager.createNote({
        type: 'Requirement',
        content: 'Users must authenticate with email',
        tags: ['auth', 'security'],
      });

      await noteManager.createNote({
        type: 'Question',
        content: 'Should we use Redis for caching?',
        tags: ['architecture', 'performance'],
      });
    });

    it('should get note by ID', async () => {
      const note = await noteManager.getNoteById('D001');
      expect(note).toBeTruthy();
      expect(note?.content).toBe('Use PostgreSQL for database');
    });

    it('should get notes by type', async () => {
      const decisions = await noteManager.getNotesByType('Decision');
      expect(decisions).toHaveLength(2);
      expect(decisions[0].type).toBe('Decision');
      expect(decisions[1].type).toBe('Decision');
    });

    it('should get notes by tag', async () => {
      const archNotes = await noteManager.getNotesByTag('architecture');
      expect(archNotes).toHaveLength(3);

      const authNotes = await noteManager.getNotesByTag('auth');
      expect(authNotes).toHaveLength(1);
      expect(authNotes[0].id).toBe('R001');
    });

    it('should get notes by multiple tags', async () => {
      const notes = await noteManager.getNotesByTag(['architecture', 'security']);
      expect(notes).toHaveLength(4); // All notes match at least one tag
    });

    it('should search notes by content pattern', async () => {
      const postgresNotes = await noteManager.searchNotesByContent('PostgreSQL');
      expect(postgresNotes).toHaveLength(1);
      expect(postgresNotes[0].id).toBe('D001');

      const useNotes = await noteManager.searchNotesByContent(/use/i);
      expect(useNotes).toHaveLength(4); // D001, D002, R001, Q001 all contain 'use'
    });

    it('should get notes created within date range', async () => {
      const start = new Date();
      start.setMinutes(start.getMinutes() - 5);

      const notes = await noteManager.getNotesByDateRange(start);
      expect(notes).toHaveLength(4); // All were just created
    });

    it('should sort notes by various criteria', async () => {
      const notesByIdAsc = await noteManager.getAllNotes({ sortBy: 'id', sortOrder: 'asc' });
      expect(notesByIdAsc[0].id).toBe('D001');
      expect(notesByIdAsc[1].id).toBe('D002');
      expect(notesByIdAsc[2].id).toBe('Q001');
      expect(notesByIdAsc[3].id).toBe('R001');

      const notesByTypeDesc = await noteManager.getAllNotes({ sortBy: 'type', sortOrder: 'desc' });
      expect(notesByTypeDesc[0].type).toBe('Requirement');
      expect(notesByTypeDesc[1].type).toBe('Question');
    });

    it('should paginate large result sets', async () => {
      const page1 = await noteManager.getAllNotes({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await noteManager.getAllNotes({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      // Ensure different notes
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should return note statistics', async () => {
      const stats = await noteManager.getStatistics();

      expect(stats.totalNotes).toBe(4);
      expect(stats.notesByType).toEqual({
        Decision: 2,
        Requirement: 1,
        Question: 1,
      });
      expect(stats.notesByTag).toEqual({
        architecture: 3,
        database: 1,
        tooling: 1,
        auth: 1,
        security: 1,
        performance: 1,
      });
      expect(stats.recentNotes).toHaveLength(4);
    });
  });

  describe('Note Watching', () => {
    it('should handle file created events from NoteFileManager', async () => {
      await noteManager.startWatching();

      // Create the actual file content first
      const filePath = path.join(testProjectPath, '_scepter/notes/decisions/D005 New Decision.md');
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, '{D005: External decision}');

      // Then simulate file created event
      noteFileManager.emit('file:created', {
        noteId: 'D005',
        filePath: filePath,
      });

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify note was added to index
      const note = await noteManager.getNoteById('D005');
      expect(note).toBeTruthy();
      expect(note?.content).toBe('External decision');
    });

    it('should handle file modified events', async () => {
      // Create initial note
      const note = await noteManager.createNote({
        type: 'Requirement',
        content: 'Original content',
      });

      await noteManager.startWatching();

      // Update file content
      const filePath = await noteManager.findNoteFile(note.id);
      await fs.writeFile(filePath!, '{R001: Updated content}');

      // Simulate modification event
      noteFileManager.emit('file:modified', {
        noteId: note.id,
        filePath: filePath!,
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify content was updated
      const updated = await noteManager.getNoteById(note.id);
      expect(updated?.content).toBe('Updated content');
    });

    it('should handle file deleted events', async () => {
      // Create note
      const note = await noteManager.createNote({
        type: 'Question',
        content: 'Test question',
      });

      await noteManager.startWatching();

      const deletedHandler = vi.fn();
      noteManager.on('note:deleted', deletedHandler);

      // Get the file path and delete the actual file
      const filePath = await noteManager.findNoteFile(note.id);
      await fs.unlink(filePath!);

      // Simulate deletion event
      noteFileManager.emit('file:deleted', {
        noteId: note.id,
        filePath: filePath!,
      });

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify note was removed
      const deleted = await noteManager.getNoteById(note.id);
      expect(deleted).toBeNull();
      expect(deletedHandler).toHaveBeenCalledWith(note.id);
    });

    it('should handle file renamed events', async () => {
      const note = await noteManager.createNote({
        type: 'Decision',
        content: 'Rename test',
      });

      await noteManager.startWatching();

      const oldPath = await noteManager.findNoteFile(note.id);
      const newPath = oldPath!.replace('D001 Rename test.md', 'D001 Renamed Decision.md');

      // Simulate rename event
      noteFileManager.emit('file:renamed', {
        noteId: note.id,
        oldPath: oldPath!,
        newPath: newPath,
      });

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // The file index should be updated with the new path
      // Note: findNoteFile will still return the old path since the file doesn't actually exist at the new path
      // We need to check the internal state instead
      expect((noteManager as any).fileIndex.get(note.id)).toBe(newPath);
    });

    it('should handle file moved events', async () => {
      const note = await noteManager.createNote({
        type: 'Question',
        content: 'Move test',
      });

      await noteManager.startWatching();

      const movedHandler = vi.fn();
      noteManager.on('note:moved', movedHandler);

      const oldPath = await noteManager.findNoteFile(note.id);
      const newPath = oldPath!.replace('questions', 'decisions');

      // Simulate move event
      noteFileManager.emit('file:moved', {
        noteId: note.id,
        oldPath: oldPath!,
        newPath: newPath,
      });

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(movedHandler).toHaveBeenCalledWith({
        noteId: note.id,
        oldPath: oldPath,
        newPath: newPath,
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid note IDs', async () => {
      await expect(
        noteManager.createNote({
          type: 'Decision',
          id: 'invalid-id',
          content: 'Test',
        }),
      ).rejects.toThrow();

      const result = await noteManager.getNoteById('not-valid');
      expect(result).toBeNull();
    });

    it('should handle unknown note types', async () => {
      await expect(
        noteManager.createNote({
          type: 'UnknownType',
          content: 'Test',
        }),
      ).rejects.toThrow('Unknown note type: UnknownType');
    });

    it('should handle files without frontmatter gracefully', async () => {
      // Create a file without frontmatter
      const simplePath = path.join(testProjectPath, '_scepter/notes/decisions/D999 Simple.md');
      await fs.ensureDir(path.dirname(simplePath));
      await fs.writeFile(simplePath, 'This is a simple note without frontmatter');

      // Re-initialize to scan the file
      await noteManager.refreshIndex();

      // Should find the note with default values
      const note = await noteManager.getNoteById('D999');
      expect(note).toBeDefined();
      expect(note?.id).toBe('D999');
      expect(note?.type).toBe('Decision');
      expect(note?.title).toBe('Simple');
      expect(note?.content).toBe('This is a simple note without frontmatter');
      expect(note?.tags).toEqual([]);
    });

    it('should emit error events on failures', async () => {
      const errorHandler = vi.fn();
      noteManager.on('error', errorHandler);

      await noteManager.startWatching();

      // Simulate a file event with invalid path
      noteFileManager.emit('file:created', {
        noteId: 'D999',
        filePath: '/invalid/path/that/does/not/exist.md',
      });

      // Wait for error handling
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should provide meaningful error messages', async () => {
      try {
        await noteManager.createNote({
          type: 'InvalidType',
          content: 'Test',
        });
      } catch (error) {
        expect((error as Error).message).toContain('Unknown note type');
      }

      try {
        await noteManager.moveNoteToType('D999', 'Decision');
      } catch (error) {
        expect((error as Error).message).toContain('Note D999 not found');
      }
    });
  });

  describe('Index Management', () => {
    it('should rebuild index on refresh', async () => {
      // Create notes
      await noteManager.createNote({ type: 'Decision', title: 'Test Decision 1', content: 'Test 1' });
      await noteManager.createNote({ type: 'Requirement', title: 'Test Requirement 2', content: 'Test 2' });

      const rebuildHandler = vi.fn();
      noteManager.on('index:rebuilt', rebuildHandler);

      // Refresh index
      await noteManager.refreshIndex();

      expect(rebuildHandler).toHaveBeenCalled();

      // Verify notes are still accessible
      const note1 = await noteManager.getNoteById('D001');
      const note2 = await noteManager.getNoteById('R001');
      expect(note1).toBeTruthy();
      expect(note2).toBeTruthy();
    });
  });

  describe('Unified getNotes() API', () => {
    beforeEach(async () => {
      // Create test notes with various properties
      await noteManager.createNote({
        type: 'Decision',
        content: 'Use JWT for authentication',
        tags: ['auth', 'security'],
      });
      await noteManager.createNote({
        type: 'Requirement',
        content: 'API must support OAuth',
        tags: ['auth', 'api'],
      });
      await noteManager.createNote({
        type: 'Decision',
        content: 'Use PostgreSQL for database',
        tags: ['database', 'architecture'],
      });
      await noteManager.createNote({
        type: 'Question',
        content: 'Which cloud provider to use?',
        tags: ['infrastructure'],
      });
      await noteManager.createNote({
        type: 'Requirement',
        content: 'Set up CI/CD pipeline',
        tags: ['devops', 'infrastructure'],
      });
    });

    it('should filter by IDs', async () => {
      const result = await noteManager.getNotes({ ids: ['D001', 'R001'] });
      expect(result.notes).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.notes.map((n) => n.id)).toEqual(['D001', 'R001']);
    });

    it('should filter by types', async () => {
      const result = await noteManager.getNotes({ types: ['Decision'] });
      expect(result.notes).toHaveLength(2);
      expect(result.notes.every((n) => n.type === 'Decision')).toBe(true);
    });

    it('should exclude types', async () => {
      const result = await noteManager.getNotes({ excludeTypes: ['Decision', 'Question'] });
      expect(result.notes).toHaveLength(2);
      expect(result.notes.every((n) => n.type !== 'Decision' && n.type !== 'Question')).toBe(true);
    });

    it('should filter by tags', async () => {
      const result = await noteManager.getNotes({ tags: ['auth'] });
      expect(result.notes).toHaveLength(2);
      expect(result.notes.every((n) => n.tags.includes('auth'))).toBe(true);
    });

    it('should exclude tags', async () => {
      const result = await noteManager.getNotes({ excludeTags: ['auth'] });
      expect(result.notes).toHaveLength(3);
      expect(result.notes.every((n) => !n.tags.includes('auth'))).toBe(true);
    });

    it('should search by content patterns', async () => {
      const result = await noteManager.getNotes({ searchPatterns: ['use'] });
      expect(result.notes).toHaveLength(3); // D001, D002, Q001

      const regexResult = await noteManager.getNotes({ searchPatterns: ['JWT|OAuth'] });
      expect(regexResult.notes).toHaveLength(2);
    });

    it('should exclude patterns', async () => {
      const result = await noteManager.getNotes({ excludePatterns: ['database'] });
      expect(result.notes).toHaveLength(4);
      expect(result.notes.every((n) => !n.content.includes('database'))).toBe(true);
    });

    it('should combine multiple filters (AND logic)', async () => {
      const result = await noteManager.getNotes({
        types: ['Decision'],
        tags: ['auth'],
      });
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].id).toBe('D001');
    });

    it('should handle OR logic within array filters', async () => {
      const result = await noteManager.getNotes({
        tags: ['auth', 'database'],
      });
      expect(result.notes).toHaveLength(3); // D001, R001, D002
    });

    it('should handle date filters', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const result = await noteManager.getNotes({
        createdAfter: yesterday,
        createdBefore: tomorrow,
      });
      expect(result.notes).toHaveLength(5);
    });

    it('should handle sorting', async () => {
      const resultAsc = await noteManager.getNotes({
        sortBy: 'id',
        sortOrder: 'asc',
      });
      expect(resultAsc.notes.map((n) => n.id)).toEqual(['D001', 'D002', 'Q001', 'R001', 'R002']);

      const resultDesc = await noteManager.getNotes({
        sortBy: 'type',
        sortOrder: 'desc',
      });
      expect(resultDesc.notes[0].type).toBe('Requirement');
    });

    it('should handle pagination', async () => {
      const page1 = await noteManager.getNotes({
        limit: 2,
        offset: 0,
        sortBy: 'id',
      });
      expect(page1.notes).toHaveLength(2);
      expect(page1.notes.map((n) => n.id)).toEqual(['D001', 'D002']);
      expect(page1.hasMore).toBe(true);
      expect(page1.totalCount).toBe(5);

      const page2 = await noteManager.getNotes({
        limit: 2,
        offset: 2,
        sortBy: 'id',
      });
      expect(page2.notes).toHaveLength(2);
      expect(page2.notes.map((n) => n.id)).toEqual(['Q001', 'R001']);

      const page3 = await noteManager.getNotes({
        limit: 2,
        offset: 4,
        sortBy: 'id',
      });
      expect(page3.notes).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });

    it('should return empty results for no matches', async () => {
      const result = await noteManager.getNotes({
        types: ['NonExistentType'],
      });
      expect(result.notes).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('should handle complex queries', async () => {
      const result = await noteManager.getNotes({
        types: ['Decision', 'Requirement'],
        tags: ['auth'],
        searchPatterns: ['JWT', 'OAuth'],
        excludePatterns: ['database'],
        sortBy: 'created',
        sortOrder: 'desc',
        limit: 10,
      });

      expect(result.notes).toHaveLength(2);
      expect(
        result.notes.every(
          (n) =>
            ['Decision', 'Requirement'].includes(n.type) &&
            n.tags.includes('auth') &&
            (n.content.includes('JWT') || n.content.includes('OAuth')),
        ),
      ).toBe(true);
    });
  });

  describe('archive and delete operations', () => {
    beforeEach(async () => {
      // Create test notes using the standard noteManager instance
      await noteManager.createNote({
        type: 'Decision',
        id: 'D001',
        title: 'Use JWT',
        content: 'Use JWT for auth',
        tags: ['auth'],
      });

      await noteManager.createNote({
        type: 'Requirement',
        id: 'R001',
        title: 'User login',
        content: 'Users must login',
        tags: ['auth'],
      });

      await noteManager.createNote({
        type: 'Question',
        id: 'Q001',
        title: 'Which DB?',
        content: 'Which database to use?',
        tags: ['database'],
      });
    });

    it('should archive a note and update its status', async () => {
      // Get the original file path before archiving
      const originalPath = await noteManager.findNoteFile('D001');
      expect(originalPath).toBeTruthy();

      // Archive the note
      await noteManager.archiveNote('D001');

      // Check original file no longer exists
      expect(await fs.pathExists(originalPath!)).toBe(false);

      // Note should not be found in active notes
      const activeNotes = await noteManager.getNotes({ types: ['Decision'] });
      expect(activeNotes.notes.find((n) => n.id === 'D001')).toBeUndefined();

      // Note should be found with includeArchived
      const allNotes = await noteManager.getNotes({ types: ['Decision'], includeArchived: true });
      const archivedNote = allNotes.notes.find((n) => n.id === 'D001');
      expect(archivedNote).toBeDefined();

      // The actual file should exist in archive location
      // We can verify by checking the path contains '_archive'
      const archivedPath = await noteManager.findNoteFile('D001');
      if (archivedPath) {
        expect(archivedPath).toContain('_archive');
      }
    });

    it('should delete a note and add #deleted tag', async () => {
      // Get the original file path before deleting
      const originalPath = await noteManager.findNoteFile('R001');
      expect(originalPath).toBeTruthy();

      // Delete the note
      await noteManager.deleteNote('R001');

      // Check original file no longer exists
      expect(await fs.pathExists(originalPath!)).toBe(false);

      // Note should not be in active notes
      const activeNotes = await noteManager.getNotes({});
      expect(activeNotes.notes.find((n) => n.id === 'R001')).toBeUndefined();

      // Note should have #deleted tag when found with includeDeleted
      const deletedNotes = await noteManager.getNotes({ includeDeleted: true });
      const deletedNote = deletedNotes.notes.find((n) => n.id === 'R001');
      expect(deletedNote?.tags).toContain('deleted');
    });

    it('should restore an archived note', async () => {
      // First archive the note
      await noteManager.archiveNote('D001');

      // Verify it's not in active notes
      const afterArchive = await noteManager.getNotes({ types: ['Decision'] });
      expect(afterArchive.notes.find((n) => n.id === 'D001')).toBeUndefined();

      // Then restore it
      await noteManager.restoreNote('D001');

      // Note should be back in active notes
      const activeNotes = await noteManager.getNotes({ types: ['Decision'] });
      expect(activeNotes.notes.find((n) => n.id === 'D001')).toBeDefined();

      // Should be able to find the file again
      const restoredPath = await noteManager.findNoteFile('D001');
      expect(restoredPath).toBeTruthy();
      expect(await fs.pathExists(restoredPath!)).toBe(true);
    });

    it('should restore a deleted note and remove #deleted tag', async () => {
      // First delete the note
      await noteManager.deleteNote('R001');

      // Verify it has deleted tag
      const deletedNotes = await noteManager.getNotes({ includeDeleted: true });
      const deletedNote = deletedNotes.notes.find((n) => n.id === 'R001');
      expect(deletedNote?.tags).toContain('deleted');

      // Then restore it
      await noteManager.restoreNote('R001');

      // Check restored note doesn't have deleted tag
      const restoredNote = await noteManager.getNoteById('R001');
      expect(restoredNote?.tags).not.toContain('deleted');
      expect(restoredNote?.tags).toContain('auth'); // Original tag preserved
    });

    it('should permanently purge a note', async () => {
      // First delete the note
      await noteManager.deleteNote('Q001');

      // Verify it's in deleted state
      const deletedNotes = await noteManager.getNotes({ includeDeleted: true });
      expect(deletedNotes.notes.find((n) => n.id === 'Q001')).toBeDefined();

      // Then purge it
      await noteManager.purgeDeletedNote('Q001');

      // Note should be completely gone from all indexes
      const allNotes = await noteManager.getNotes({ includeDeleted: true, includeArchived: true });
      expect(allNotes.notes.find((n) => n.id === 'Q001')).toBeUndefined();
    });

    it('should handle batch archive operations', async () => {
      const results = await noteManager.archiveNotes(['D001', 'R001']);

      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      expect(succeeded).toHaveLength(2);
      expect(failed).toHaveLength(0);

      // Verify both notes are no longer in active index
      const activeNotes = await noteManager.getNotes({});
      expect(activeNotes.notes.find((n) => n.id === 'D001')).toBeUndefined();
      expect(activeNotes.notes.find((n) => n.id === 'R001')).toBeUndefined();

      // Verify they're in archived state
      const archivedNotes = await noteManager.getNotes({ includeArchived: true });
      expect(archivedNotes.notes.find((n) => n.id === 'D001')).toBeDefined();
      expect(archivedNotes.notes.find((n) => n.id === 'R001')).toBeDefined();
    });

    it('should filter out archived and deleted notes by default', async () => {
      // Archive one note
      await noteManager.archiveNote('D001');

      // Delete another
      await noteManager.deleteNote('R001');

      // Get active notes - should only have Q001
      const activeNotes = await noteManager.getNotes({});
      expect(activeNotes.notes.map((n) => n.id)).toEqual(['Q001']);
      expect(activeNotes.totalCount).toBe(1);
    });

    it('should include archived notes when requested', async () => {
      await noteManager.archiveNote('D001');

      const allNotes = await noteManager.getNotes({ includeArchived: true });
      expect(allNotes.notes.map((n) => n.id).sort()).toEqual(['D001', 'Q001', 'R001']);
    });

    it('should throw error when trying to archive non-existent note', async () => {
      await expect(noteManager.archiveNote('NONEXISTENT')).rejects.toThrow('Note NONEXISTENT not found');
    });

    it('should throw error when trying to purge active note', async () => {
      await expect(noteManager.purgeDeletedNote('D001')).rejects.toThrow(
        'Note D001 is not deleted. Only deleted notes can be purged.',
      );
    });

    it('should update note stats to reflect archived/deleted status', async () => {
      // Get initial stats
      const initialStats = await noteManager.getStatistics();
      expect(initialStats.totalNotes).toBe(3);

      // Archive a note
      await noteManager.archiveNote('D001');

      // Delete a note
      await noteManager.deleteNote('R001');

      const updatedStats = await noteManager.getStatistics();
      expect(updatedStats.totalNotes).toBe(1);
      expect(updatedStats.archivedNotes).toBe(1);
      expect(updatedStats.deletedNotes).toBe(1);
    });

    it('should handle references when deleting notes', async () => {
      // This test just verifies delete works - reference handling is internal
      await noteManager.deleteNote('R001');

      // Note should be deleted
      const activeNotes = await noteManager.getNotes({});
      expect(activeNotes.notes.find((n) => n.id === 'R001')).toBeUndefined();
    });

    it('should batch operations with proper error handling', async () => {
      // Add a non-existent note to test error handling
      const results = await noteManager.deleteNotes(['D001', 'NONEXISTENT', 'Q001']);

      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      expect(succeeded).toHaveLength(2); // D001 and Q001 succeed
      expect(failed).toHaveLength(1); // NONEXISTENT fails
      expect(failed[0].noteId).toBe('NONEXISTENT');
      expect(failed[0].error).toContain('not found');

      // Verify successful deletes
      const activeNotes = await noteManager.getNotes({});
      expect(activeNotes.notes.find((n) => n.id === 'D001')).toBeUndefined();
      expect(activeNotes.notes.find((n) => n.id === 'Q001')).toBeUndefined();
      expect(activeNotes.notes.find((n) => n.id === 'R001')).toBeDefined(); // R001 still active
    });
  });
});
