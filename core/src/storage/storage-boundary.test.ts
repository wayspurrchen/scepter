/**
 * Storage boundary tests — verify that storage protocol boundaries hold.
 *
 * These tests check structural properties (no fs imports in NoteManager)
 * and behavioral properties (the rerouted methods work correctly through
 * the NoteFileManager delegation).
 *
 * @validates {DD010.§DC.24} NoteManager routes fs calls through NoteFileManager
 * @validates {DD010.§DC.25} NoteManager has zero fs imports
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import {
  setupTestProject,
  cleanupTestProject,
  type TestContext,
} from '../test-utils/integration-test-helpers';

describe('Storage Protocol Boundary', () => {
  describe('NoteManager fs import removal (DC.25)', () => {
    it('should not import fs, fs-extra, or fs/promises', async () => {
      const noteManagerPath = path.resolve(__dirname, '../notes/note-manager.ts');
      const content = await fs.readFile(noteManagerPath, 'utf-8');

      // Check active (non-commented) import lines
      const lines = content.split('\n');
      const activeImports = lines.filter(line => {
        const trimmed = line.trim();
        // Skip comment lines and lines inside block comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          return false;
        }
        return trimmed.startsWith('import') && (
          trimmed.includes("'fs-extra'") ||
          trimmed.includes("'fs/promises'") ||
          trimmed.includes("'fs'")
        );
      });

      expect(activeImports).toEqual([]);
    });
  });

  describe('NoteManager rerouted methods (DC.24)', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      ctx = await setupTestProject('storage-boundary-test');
    });

    afterEach(async () => {
      await cleanupTestProject(ctx);
    });

    it('findNoteFile should work through NoteFileManager', async () => {
      // Create a note
      await ctx.noteManager.createNote({
        type: 'Decision',
        title: 'Find Me',
        content: 'Test content',
      });

      // findNoteFile should find it through NoteFileManager index
      const filePath = await ctx.noteManager.findNoteFile('D001');
      expect(filePath).not.toBeNull();
      expect(filePath!.endsWith('.md')).toBe(true);
    });

    it('getNoteById should read through NoteFileManager', async () => {
      await ctx.noteManager.createNote({
        type: 'Decision',
        title: 'Get By Id',
        content: 'Test content for get',
      });

      const note = await ctx.noteManager.getNoteById('D001');
      expect(note).not.toBeNull();
      expect(note!.id).toBe('D001');
      expect(note!.title).toContain('Get By Id');
    });

    it('moveNoteToType should use NoteFileManager.removeFile', async () => {
      await ctx.noteManager.createNote({
        type: 'Decision',
        title: 'Move Me',
        content: 'To be moved',
      });

      // Get original path
      const origPath = await ctx.noteManager.findNoteFile('D001');
      expect(origPath).not.toBeNull();

      // Move to Requirement type
      await ctx.noteManager.moveNoteToType('D001', 'Requirement');

      // Old file should be gone
      expect(await fs.pathExists(origPath!)).toBe(false);

      // New note should exist as R001
      const newNote = await ctx.noteManager.getNoteById('R001');
      expect(newNote).not.toBeNull();
      expect(newNote!.type).toBe('Requirement');
    });
  });

  describe('BaseCommand factory path', () => {
    it('should import createFilesystemProject, not ProjectManager constructor', async () => {
      const baseCommandPath = path.resolve(__dirname, '../cli/commands/base-command.ts');
      const content = await fs.readFile(baseCommandPath, 'utf-8');

      expect(content).toContain('createFilesystemProject');
      expect(content).not.toContain('new ProjectManager(');
    });
  });

  // @validates {DD014.§3.DC.54} Consumers migrated from verificationStorage to metadataStorage
  describe('Metadata consumer migration (DD014)', () => {
    const consumerFiles = [
      'src/cli/commands/claims/verify-command.ts',
      'src/cli/commands/claims/stale-command.ts',
      'src/cli/commands/claims/trace-command.ts',
      'src/cli/commands/claims/gaps-command.ts',
      'src/cli/commands/claims/thread-command.ts',
      'src/cli/commands/claims/index-command.ts',
      'src/cli/commands/context/show-handler.ts',
      'src/cli/commands/context/search.ts',
    ];

    for (const file of consumerFiles) {
      it(`${path.basename(file)} should not reference legacy verificationStorage`, async () => {
        const filePath = path.resolve(__dirname, '../..', file);
        const content = await fs.readFile(filePath, 'utf-8');

        const lines = content.split('\n');
        const legacyRefs = lines.filter(line => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
          return trimmed.includes('verificationStorage') ||
            trimmed.includes('loadVerificationStore') ||
            trimmed.includes('getLatestVerification');
        });

        expect(legacyRefs).toEqual([]);
      });

      it(`${path.basename(file)} should use metadataStorage`, async () => {
        const filePath = path.resolve(__dirname, '../..', file);
        const content = await fs.readFile(filePath, 'utf-8');

        expect(content).toContain('metadataStorage');
      });
    }
  });
});
