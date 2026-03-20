import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NoteManager } from './note-manager';
import { NoteFileManager } from './note-file-manager';
import { NoteTypeResolver } from './note-type-resolver';
import { ConfigManager } from '../config/config-manager';
import { NoteTypeTemplateManager } from '../templates/note-type-template-manager';
import { ReferenceManager } from '../references/reference-manager';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

describe('NoteManager - Archive/Delete/Restore with Reference Updates', () => {
  let noteManager: NoteManager;
  let noteFileManager: NoteFileManager;
  let referenceManager: ReferenceManager;
  let configManager: ConfigManager;
  let noteTypeResolver: NoteTypeResolver;
  let noteTypeTemplateManager: NoteTypeTemplateManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'note-manager-archive-test-'));
    
    // Set up mocks and instances
    configManager = new ConfigManager(tempDir);
    noteTypeResolver = new NoteTypeResolver(configManager);
    noteFileManager = new NoteFileManager(tempDir, configManager);
    noteTypeTemplateManager = new NoteTypeTemplateManager(tempDir, configManager);
    referenceManager = new ReferenceManager();
    
    // Create NoteManager with ReferenceManager
    noteManager = new NoteManager(
      tempDir,
      configManager,
      noteFileManager,
      noteTypeResolver,
      noteTypeTemplateManager,
      referenceManager
    );

    // Set default config
    await configManager.setConfig({
      noteTypes: {
        Decision: { shortcode: 'D', folder: 'decisions' },
        Requirement: { shortcode: 'R', folder: 'requirements' }
      },
    });
    
    // Create test note structure
    const notesDir = path.join(tempDir, '_scepter', 'notes', 'decisions');
    await fs.ensureDir(notesDir);
    
    // Create a note that references another note
    const d001Content = `---
created: 2024-01-01
---

# D001 - Test Decision

This decision references {D002} and {D003#important}.
`;
    
    const d002Content = `---
created: 2024-01-01
---

# D002 - Referenced Decision

This is referenced by D001.
`;
    
    await fs.writeFile(path.join(notesDir, 'D001 Test Decision.md'), d001Content);
    await fs.writeFile(path.join(notesDir, 'D002 Referenced Decision.md'), d002Content);
    
    // Initialize NoteManager
    await noteManager.initialize();
  });

  afterEach(async () => {
    // Clean up
    await fs.remove(tempDir);
  });

  describe('archiveNote', () => {
    it('should archive a note and update references with #deleted tag', async () => {
      // Spy on referenceManager methods
      const updateSpy = vi.spyOn(referenceManager, 'updateReferencesForDeletion');
      const consoleSpy = vi.spyOn(console, 'log');
      
      // Archive D002
      const archivedNote = await noteManager.archiveNote('D002', 'Test archive');
      
      // Verify the note was archived
      expect(archivedNote.id).toBe('D002');
      expect(archivedNote.tags).toContain('archived');
      
      // Verify reference update was called
      expect(updateSpy).toHaveBeenCalledWith('D002');
      
      // Verify console log about reference updates
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Would update')
      );
      
      // Check file was moved to archive
      const archivePath = path.join(tempDir, '_scepter', 'notes', 'decisions', '_archive', 'D002 Referenced Decision.md');
      expect(await fs.pathExists(archivePath)).toBe(true);
    });
  });

  describe('deleteNote', () => {
    it('should delete a note and update references with #deleted tag', async () => {
      // Spy on referenceManager methods
      const updateSpy = vi.spyOn(referenceManager, 'updateReferencesForDeletion');
      
      // Delete D002
      const deletedNote = await noteManager.deleteNote('D002', 'Test deletion');
      
      // Verify the note was deleted
      expect(deletedNote.id).toBe('D002');
      expect(deletedNote.tags).toContain('deleted');
      
      // Verify reference update was called
      expect(updateSpy).toHaveBeenCalledWith('D002');
      
      // Note: Outgoing references are intentionally kept for deleted notes
      // so that purgeDeletedNote can check for incoming references before allowing purge
      
      // Check file was moved to deleted
      const deletedPath = path.join(tempDir, '_scepter', 'notes', 'decisions', '_deleted', 'D002 Referenced Decision.md');
      expect(await fs.pathExists(deletedPath)).toBe(true);
    });
  });

  describe('restoreNote', () => {
    it('should restore an archived note and remove #deleted tag from references', async () => {
      // First archive the note
      await noteManager.archiveNote('D002', 'Test archive');
      
      // Spy on referenceManager methods
      const updateSpy = vi.spyOn(referenceManager, 'updateReferencesForRestore');
      
      // Restore the note
      const restoredNote = await noteManager.restoreNote('D002');
      
      // Verify the note was restored
      expect(restoredNote.id).toBe('D002');
      expect(restoredNote.tags).not.toContain('archived');
      expect(restoredNote.tags).not.toContain('deleted');
      
      // Verify reference update was called
      expect(updateSpy).toHaveBeenCalledWith('D002');
      
      // Check file was moved back from archive
      const originalPath = path.join(tempDir, '_scepter', 'notes', 'decisions', 'D002 Referenced Decision.md');
      expect(await fs.pathExists(originalPath)).toBe(true);
    });

    it('should restore a deleted note and remove #deleted tag from references', async () => {
      // First delete the note
      await noteManager.deleteNote('D002', 'Test deletion');
      
      // Spy on referenceManager methods
      const updateSpy = vi.spyOn(referenceManager, 'updateReferencesForRestore');
      
      // Restore the note
      const restoredNote = await noteManager.restoreNote('D002');
      
      // Verify the note was restored
      expect(restoredNote.id).toBe('D002');
      expect(restoredNote.tags).not.toContain('deleted');
      
      // Verify reference update was called
      expect(updateSpy).toHaveBeenCalledWith('D002');
      
      // Check file was moved back from deleted
      const originalPath = path.join(tempDir, '_scepter', 'notes', 'decisions', 'D002 Referenced Decision.md');
      expect(await fs.pathExists(originalPath)).toBe(true);
    });
  });

  describe('reference counting', () => {
    it('should track references correctly after archive/restore cycle', async () => {
      // Get initial reference counts
      const initialRefs = referenceManager.getReferencesTo('D002');
      expect(initialRefs.length).toBeGreaterThan(0);
      
      // Archive and restore
      await noteManager.archiveNote('D002');
      await noteManager.restoreNote('D002');
      
      // References should still be present
      const finalRefs = referenceManager.getReferencesTo('D002');
      expect(finalRefs.length).toBe(initialRefs.length);
    });
  });
});