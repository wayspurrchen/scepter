/**
 * Tests for the filesystem-path scanner.
 *
 * @validates {R015.§3.AC.14} filesystem rename plan (file and folder forms)
 * @validates {R015.§3.AC.15} filesystem removal plan (hard-delete)
 * @validates {DD020.§2.DC.16} folder rename moves companions as a unit
 * @validates {DD020.§2.DC.17} folder removal includes the entire folder
 */

import { describe, it, expect } from 'vitest';
import {
  scanFilesystemForDelete,
  scanFilesystemForRename,
} from './filesystem-path-scanner';

describe('scanFilesystemForDelete', () => {
  it('produces a single file target for a file-based note', () => {
    const plan = scanFilesystemForDelete({
      kind: 'file',
      filePath: '/proj/_scepter/notes/reqs/R005 Title.md',
    });
    expect(plan.targets).toEqual([
      { kind: 'file', path: '/proj/_scepter/notes/reqs/R005 Title.md' },
    ]);
  });

  it('produces a single folder target for a folder-based note (companions move with the folder)', () => {
    const plan = scanFilesystemForDelete({
      kind: 'folder',
      folderPath: '/proj/_scepter/notes/reqs/R005 Title',
      mainFilePath: '/proj/_scepter/notes/reqs/R005 Title/R005.md',
    });
    expect(plan.targets).toEqual([
      { kind: 'folder', path: '/proj/_scepter/notes/reqs/R005 Title' },
    ]);
  });
});

describe('scanFilesystemForRename', () => {
  it('renames a file-based note in place', () => {
    const plan = scanFilesystemForRename('R005', 'R042', {
      kind: 'file',
      filePath: '/proj/_scepter/notes/reqs/R005 Title.md',
    });
    expect(plan.operations).toEqual([
      {
        kind: 'file',
        from: '/proj/_scepter/notes/reqs/R005 Title.md',
        to: '/proj/_scepter/notes/reqs/R042 Title.md',
      },
    ]);
  });

  it('handles a file-based note with bare-ID filename (R005.md → R042.md)', () => {
    const plan = scanFilesystemForRename('R005', 'R042', {
      kind: 'file',
      filePath: '/proj/_scepter/notes/reqs/R005.md',
    });
    expect(plan.operations).toEqual([
      {
        kind: 'file',
        from: '/proj/_scepter/notes/reqs/R005.md',
        to: '/proj/_scepter/notes/reqs/R042.md',
      },
    ]);
  });

  it('renames folder + inner main file for folder-based note', () => {
    const plan = scanFilesystemForRename('R005', 'R042', {
      kind: 'folder',
      folderPath: '/proj/_scepter/notes/reqs/R005 Title',
      mainFilePath: '/proj/_scepter/notes/reqs/R005 Title/R005.md',
    });
    expect(plan.operations).toEqual([
      {
        kind: 'folder',
        from: '/proj/_scepter/notes/reqs/R005 Title',
        to: '/proj/_scepter/notes/reqs/R042 Title',
      },
      {
        kind: 'file',
        from: '/proj/_scepter/notes/reqs/R042 Title/R005.md',
        to: '/proj/_scepter/notes/reqs/R042 Title/R042.md',
      },
    ]);
  });

  it('does not mangle longer ID-shaped names that share a prefix', () => {
    // `R0051.md` should NOT become `R0421.md`.
    const plan = scanFilesystemForRename('R005', 'R042', {
      kind: 'file',
      filePath: '/proj/_scepter/notes/reqs/R0051.md',
    });
    expect(plan.operations[0].to).toBe(
      '/proj/_scepter/notes/reqs/R0051.md',
    );
  });
});
