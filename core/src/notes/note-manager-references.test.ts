import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { NoteManager } from './note-manager';
import { ReferenceManager } from '../references/reference-manager';
import { ConfigManager } from '../config/config-manager';
import { NoteFileManager } from './note-file-manager';
import { NoteIdGenerator } from './note-id-generator';
import { NoteTypeResolver } from './note-type-resolver';
import { NoteTypeTemplateManager } from '../templates/note-type-template-manager';
import type { Note } from '../types/note';
import type { SCEpterConfig } from '../types/config';
import fs from 'fs-extra';
import * as path from 'path';

describe('NoteManager with ReferenceManager Integration', () => {
  let noteManager: NoteManager;
  let referenceManager: ReferenceManager;
  let configManager: ConfigManager;
  let noteFileManager: NoteFileManager;
  let noteIdGenerator: NoteIdGenerator;
  let noteTypeResolver: NoteTypeResolver;
  let noteTypeTemplateManager: NoteTypeTemplateManager;
  let testDir: string;
  let projectTestDir: string;

  const testConfig: SCEpterConfig = {
    noteTypes: {
      Decision: { folder: 'decisions', shortcode: 'D' },
      Requirement: { folder: 'requirements', shortcode: 'R' },
      TODO: { folder: 'todos', shortcode: 'TD' },
      Architecture: { folder: 'architecture', shortcode: 'ARCH' },
    },
    paths: {
      notesRoot: '_scepter/notes',
    },
  };

  beforeAll(async () => {
    // Create a tmp directory in the project for all tests
    projectTestDir = path.join(process.cwd(), 'tmp', 'integration-tests');
    await fs.ensureDir(projectTestDir);
  });

  afterAll(async () => {
    // Clean up the entire test directory
    await fs.remove(projectTestDir);
  });

  beforeEach(async () => {
    // Create a unique test directory for this test
    testDir = path.join(projectTestDir, `test-${Date.now()}`);
    await fs.ensureDir(testDir);

    // Create the directory structure
    const notesRoot = path.join(testDir, testConfig.paths!.notesRoot!);
    await fs.ensureDir(notesRoot);
    for (const [_, typeConfig] of Object.entries(testConfig.noteTypes)) {
      await fs.ensureDir(path.join(notesRoot, typeConfig.folder));
    }

    configManager = new ConfigManager(testDir);

    // Save the config to disk
    await fs.writeJSON(path.join(testDir, '_scepter', 'config.json'), testConfig);

    // Create instances with correct parameters
    noteFileManager = new NoteFileManager(testDir, configManager);
    noteIdGenerator = new NoteIdGenerator(testConfig);

    // Make config available synchronously for NoteTypeResolver before creating it
    (configManager as any).config = testConfig;
    noteTypeResolver = new NoteTypeResolver(configManager);
    noteTypeResolver.initialize();

    noteTypeTemplateManager = new NoteTypeTemplateManager(testDir, configManager);
    referenceManager = new ReferenceManager();

    // Create NoteManager WITH ReferenceManager
    noteManager = new NoteManager(
      testDir,
      configManager,
      noteFileManager,
      noteTypeResolver,
      noteTypeTemplateManager,
      referenceManager,
    );

    // Initialize the manager and template manager
    await noteTypeTemplateManager.initialize();
    await noteManager.initialize();
  });

  afterEach(async () => {
    // Clean up this test's directory
    await fs.remove(testDir);
  });

  describe('Integration with ReferenceManager', () => {
    it('should extract references when creating notes', async () => {
      // Create a note with content containing references
      const note = await noteManager.createNote({
        type: 'Decision',
        content: 'Use JWT for authentication based on {R001} and {R002}',
      });

      // Verify references were automatically extracted
      const refs = referenceManager.getReferencedNoteIds(note.id);
      expect(refs.sort()).toEqual(['R001', 'R002']);
    });

    it('should extract references when notes are loaded from files', async () => {
      // Create markdown files with notes containing references
      const decisionContent = `{D001: Use JWT for authentication based on {R001} and {R002}}`;
      const todoContent = `{TD001: Implement JWT middleware referencing {D001} and {ARCH001}}`;

      // Write files  
      const decisionPath = path.join(testDir, testConfig.paths!.notesRoot!, 'decisions', 'D001.md');
      const todoPath = path.join(testDir, testConfig.paths!.notesRoot!, 'todos', 'TD001.md');
      await fs.writeFile(decisionPath, decisionContent);
      await fs.writeFile(todoPath, todoContent);

      // Re-initialize NoteManager to load the files
      await noteManager.initialize();

      // Verify references were extracted by checking the notes themselves
      const d001 = await noteManager.getNoteById('D001');
      expect(d001?.references?.outgoing.map(r => r.toId).sort()).toEqual(['R001', 'R002']);

      const td001 = await noteManager.getNoteById('TD001');
      expect(td001?.references?.outgoing.map(r => r.toId).sort()).toEqual(['ARCH001', 'D001']);
    });

    it('should update references when note content is modified', async () => {
      // Create a note with initial references
      await noteManager.createNote({
        type: 'Decision',
        id: 'D001',
        content: 'Use PostgreSQL based on {R001}',
      });

      // Verify initial reference
      expect(referenceManager.getReferencedNoteIds('D001')).toEqual(['R001']);

      // Update to have different references
      const filePath = path.join(testDir, testConfig.paths!.notesRoot!, 'decisions', 'D001 Use PostgreSQL based on R001.md');
      await fs.writeFile(filePath, `{D001: Use PostgreSQL based on {R002} and {R003}}`);
      await noteManager.refreshIndex();

      // Verify references were updated and old ones removed
      const refs = referenceManager.getReferencedNoteIds('D001');
      expect(refs.sort()).toEqual(['R002', 'R003']);

      // Update to have no references
      await fs.writeFile(filePath, `{D001: Use PostgreSQL for performance reasons}`);
      await noteManager.refreshIndex();
      expect(referenceManager.getReferencedNoteIds('D001')).toEqual([]);

      // Update to have one reference
      await fs.writeFile(filePath, `{D001: Use PostgreSQL based on {R004}}`);
      await noteManager.refreshIndex();
      expect(referenceManager.getReferencedNoteIds('D001')).toEqual(['R004']);
    });

    it('includes references in all note retrieval methods', async () => {
      // Setup: Create notes with references
      await noteManager.createNote({
        type: 'Decision',
        id: 'D001',
        content: 'Use PostgreSQL based on {R001}',
      });

      await noteManager.createNote({
        type: 'Requirement',
        id: 'R001',
        content: 'Must support transactions',
      });

      await noteManager.createNote({
        type: 'TODO',
        id: 'TD001',
        content: 'Implement database layer for {D001}',
      });

      // Test getNoteById includes references
      const noteById = await noteManager.getNoteById('D001');
      expect(noteById?.references?.outgoing.map(r => r.toId)).toEqual(['R001']);
      expect(noteById?.references?.incoming.map(r => r.fromId)).toEqual(['TD001']);

      // Test getNotesByType includes references
      const decisionNotes = await noteManager.getNotesByType('Decision');
      expect(decisionNotes[0]?.references?.outgoing.map(r => r.toId)).toEqual(['R001']);
      expect(decisionNotes[0]?.references?.incoming.map(r => r.fromId)).toEqual(['TD001']);

      // Test getAllNotes includes references
      const allNotes = await noteManager.getAllNotes();
      const d001FromAll = allNotes.find(n => n.id === 'D001');
      expect(d001FromAll?.references?.outgoing.map(r => r.toId)).toEqual(['R001']);
      expect(d001FromAll?.references?.incoming.map(r => r.fromId)).toEqual(['TD001']);
    });

    it('validateReferences checks reference integrity', async () => {
      // Create some notes with references
      await noteManager.createNote({
        type: 'Decision',
        id: 'D001',
        content: 'Use PostgreSQL based on {R001} and {R999}', // R999 doesn't exist
      });

      await noteManager.createNote({
        type: 'Requirement',
        id: 'R001',
        content: 'Must support transactions',
      });

      // Use the actual validateReferences method
      const validation = await noteManager.validateReferences();

      expect(validation.valid).toBe(false);
      expect(validation.broken).toHaveLength(1);
      expect(validation.broken[0].fromId).toBe('D001');
      expect(validation.broken[0].toId).toBe('R999');
      expect(validation.broken[0].error).toBe('Referenced note not found');
      expect(validation.broken[0].fromNote?.id).toBe('D001');
    });

    it('canSafelyDelete checks deletion impact', async () => {
      // Create notes with references
      await noteManager.createNote({
        type: 'Requirement',
        id: 'R001',
        content: 'Must support transactions',
      });

      await noteManager.createNote({
        type: 'Decision',
        id: 'D001',
        content: 'Use PostgreSQL based on {R001}',
      });

      // Use the actual canSafelyDelete method
      const deleteCheck = await noteManager.canSafelyDelete('R001');

      expect(deleteCheck.safe).toBe(false);
      expect(deleteCheck.reason).toBe('Note is referenced by 1 other notes');

      // Check that D001 can be safely deleted (no incoming references)
      const deleteCheckD001 = await noteManager.canSafelyDelete('D001');
      expect(deleteCheckD001.safe).toBe(true);
      expect(deleteCheckD001.reason).toBeUndefined();
    });

    it('should extract references with modifiers', async () => {
      // Create a note with references containing modifiers
      await noteManager.createNote({
        type: 'TODO',
        id: 'TD002',
        content: 'Must include {D001+} and check against {R003$}',
      });

      // Verify references with modifiers were extracted
      const storedRefs = referenceManager.getReferencesFrom('TD002');
      expect(storedRefs).toHaveLength(2);
      expect(storedRefs.find((r) => r.toId === 'D001')?.modifier).toBe('+');
      expect(storedRefs.find((r) => r.toId === 'R003')?.modifier).toBe('$');
    });
  });

  describe('Integration with ContextGatherer', () => {
    it('shows how ContextGatherer would use ReferenceManager', async () => {
      // Create interconnected notes with references in content
      await noteManager.createNote({
        id: 'R001',
        type: 'Requirement',
        title: 'Must support auth',
      content: 'Must support auth',
      });
      
      await noteManager.createNote({
        id: 'D001',
        type: 'Decision',
        title: 'Use JWT based on {R001}',
      content: 'Use JWT based on {R001}',
      });
      
      await noteManager.createNote({
        id: 'TD001',
        type: 'TODO',
        title: 'Implement auth for {D001}',
        content: 'Implement auth for {D001}',
      });

      // ContextGatherer would use ReferenceManager to follow references
      const referencedIds = await referenceManager.followReferences(['TD001'], 2);
      expect(referencedIds.sort()).toEqual(['D001', 'R001']);
    });
  });
});
