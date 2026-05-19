/**
 * Tests for the new lifecycle primitives on NoteFileManager:
 *   - removeNoteEntry: hard-unlink the note unit (file or folder).
 *   - renameNoteEntry: rename the file or folder + inner main file.
 *   - resolveNoteLayout: file vs folder disposition resolver.
 *
 * Tests target {DD020.§3.DC.13}, {DD020.§3.DC.15}, {DD020.§4.DC.06}.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import fs from 'fs-extra';
import { NoteFileManager } from './note-file-manager';
import type { Note } from '../types/note';
import type { NoteTypeConfig, SCEpterConfig } from '../types/config';
import type { ConfigManager } from '../config/config-manager';

async function createTempDirectory(): Promise<string> {
  return await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'scepter-test-rename-'));
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

function createMockConfigManager(noteTypes: Record<string, NoteTypeConfig>): ConfigManager {
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

describe('NoteFileManager lifecycle primitives (DD020 Phase 4b)', () => {
  let manager: NoteFileManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    const configManager = createMockConfigManager({
      Requirement: { folder: 'requirements', shortcode: 'R' },
      Decision: { folder: 'decisions', shortcode: 'D' },
    });
    manager = new NoteFileManager(tempDir, configManager);
  });

  afterEach(async () => {
    await manager.stopWatching();
    await removeTempDirectory(tempDir);
  });

  describe('resolveNoteLayout', () => {
    it('returns null when the note is not in the index', () => {
      expect(manager.resolveNoteLayout('R999')).toBeNull();
    });

    it('returns {kind: "file"} for single-file notes', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'First',
        content: '',
        tags: [],
        created: new Date(),
      };
      await manager.createNoteFile(note);

      const layout = manager.resolveNoteLayout('R001');
      expect(layout).not.toBeNull();
      expect(layout?.kind).toBe('file');
      if (layout?.kind === 'file') {
        expect(layout.filePath.endsWith('R001 First.md')).toBe(true);
      }
    });

    it('returns {kind: "folder"} for folder-based notes', async () => {
      const note: Note = {
        id: 'R002',
        type: 'Requirement',
        title: 'Folder note',
        content: '',
        tags: [],
        created: new Date(),
        isFolder: true,
      };
      await manager.createNoteFile(note);

      const layout = manager.resolveNoteLayout('R002');
      expect(layout).not.toBeNull();
      expect(layout?.kind).toBe('folder');
      if (layout?.kind === 'folder') {
        expect(path.basename(layout.folderPath).startsWith('R002')).toBe(true);
        expect(layout.mainFilePath.endsWith('R002.md')).toBe(true);
      }
    });
  });

  describe('removeNoteEntry (hard-unlink)', () => {
    it('removes a single-file note outright (no relocation to _deleted/)', async () => {
      const note: Note = {
        id: 'R001',
        type: 'Requirement',
        title: 'Doomed',
        content: '',
        tags: [],
        created: new Date(),
      };
      await manager.createNoteFile(note);

      const layoutBefore = manager.resolveNoteLayout('R001');
      expect(layoutBefore).not.toBeNull();
      const pathBefore = layoutBefore?.kind === 'file' ? layoutBefore.filePath : '';
      expect(await fileExists(pathBefore)).toBe(true);

      await manager.removeNoteEntry('R001');

      // File is gone outright.
      expect(await fileExists(pathBefore)).toBe(false);
      // _deleted/ does NOT contain a relocated copy.
      const deletedDir = path.join(
        tempDir,
        '_scepter',
        'notes',
        'requirements',
        '_deleted',
      );
      const deletedExists = await fs.pathExists(deletedDir);
      if (deletedExists) {
        const contents = await fs.readdir(deletedDir);
        expect(contents.some((c) => c.startsWith('R001'))).toBe(false);
      }
      // Index cleared.
      expect(manager.resolveNoteLayout('R001')).toBeNull();
    });

    it('removes a folder-based note as a unit, including companion files', async () => {
      const note: Note = {
        id: 'R003',
        type: 'Requirement',
        title: 'Folder doomed',
        content: '',
        tags: [],
        created: new Date(),
        isFolder: true,
      };
      await manager.createNoteFile(note);

      const layout = manager.resolveNoteLayout('R003');
      expect(layout?.kind).toBe('folder');
      const folderPath = layout?.kind === 'folder' ? layout.folderPath : '';

      // Add a companion file.
      const companionPath = path.join(folderPath, 'companion.md');
      await fs.writeFile(companionPath, '# Companion\n\nSome content.');
      expect(await fileExists(companionPath)).toBe(true);

      await manager.removeNoteEntry('R003');

      // Folder, main, and companion are all gone.
      expect(await fs.pathExists(folderPath)).toBe(false);
      expect(await fileExists(companionPath)).toBe(false);
      expect(manager.resolveNoteLayout('R003')).toBeNull();
    });

    it('throws when the note is not in the index', async () => {
      await expect(manager.removeNoteEntry('R999')).rejects.toThrow(/not found/);
    });
  });

  describe('renameNoteEntry', () => {
    it('renames a single-file note in place, preserving the title', async () => {
      const note: Note = {
        id: 'R005',
        type: 'Requirement',
        title: 'My note',
        content: '',
        tags: [],
        created: new Date(),
      };
      await manager.createNoteFile(note);

      const layoutBefore = manager.resolveNoteLayout('R005');
      const oldPath = layoutBefore?.kind === 'file' ? layoutBefore.filePath : '';
      expect(await fileExists(oldPath)).toBe(true);

      const newMainPath = await manager.renameNoteEntry('R005', 'R042');
      expect(path.basename(newMainPath)).toBe('R042 My note.md');
      expect(await fileExists(newMainPath)).toBe(true);
      expect(await fileExists(oldPath)).toBe(false);

      // Index swapped.
      expect(manager.resolveNoteLayout('R005')).toBeNull();
      const newLayout = manager.resolveNoteLayout('R042');
      expect(newLayout?.kind).toBe('file');
    });

    it('renames a folder-based note: folder + inner main file together', async () => {
      const note: Note = {
        id: 'R006',
        type: 'Requirement',
        title: 'Folder rename',
        content: '',
        tags: [],
        created: new Date(),
        isFolder: true,
      };
      await manager.createNoteFile(note);

      const layoutBefore = manager.resolveNoteLayout('R006');
      const oldFolder =
        layoutBefore?.kind === 'folder' ? layoutBefore.folderPath : '';
      const oldMain = layoutBefore?.kind === 'folder' ? layoutBefore.mainFilePath : '';

      // Add a companion.
      const companionPath = path.join(oldFolder, 'extra.md');
      await fs.writeFile(companionPath, '# extra');

      const newMainPath = await manager.renameNoteEntry('R006', 'R077');

      // Folder is renamed.
      expect(await fs.pathExists(oldFolder)).toBe(false);
      const newFolder = path.dirname(newMainPath);
      expect(path.basename(newFolder).startsWith('R077')).toBe(true);
      // Inner main file is renamed.
      expect(path.basename(newMainPath)).toBe('R077.md');
      expect(await fileExists(newMainPath)).toBe(true);
      // Companion files move with the folder.
      const newCompanion = path.join(newFolder, 'extra.md');
      expect(await fileExists(newCompanion)).toBe(true);
      // Old main is gone.
      expect(await fileExists(oldMain)).toBe(false);

      // Index swap.
      expect(manager.resolveNoteLayout('R006')).toBeNull();
      const newLayout = manager.resolveNoteLayout('R077');
      expect(newLayout?.kind).toBe('folder');
    });

    it('throws when the source note is not in the index', async () => {
      await expect(manager.renameNoteEntry('R999', 'R888')).rejects.toThrow(/not found/);
    });
  });
});
