/**
 * Filesystem-specific project utility functions.
 *
 * Extracted from ProjectManager — these operations are inherently
 * filesystem-bound (stat, readdir, size calculation) and don't belong
 * in the backend-agnostic ProjectManager class.
 *
 * All functions take (projectPath, config) instead of relying on `this`,
 * making them pure utilities with no class coupling.
 *
 * @implements {DD010.§DC.18} Filesystem utilities extracted from ProjectManager
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SCEpterConfig } from '../../types/config';

// ── Types ───────────────────────────────────────────────────────────

export interface ValidationError {
  type: 'missing_directory' | 'not_a_directory' | 'permission_error';
  path: string;
  message: string;
}

export interface ValidationReport {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  checkedPaths: string[];
}

export interface CleanupSuggestion {
  path: string;
  reason: string;
  hasContent: boolean;
}

// ── Validation ──────────────────────────────────────────────────────

/**
 * Validate the filesystem structure of a SCEpter project.
 * Returns a list of validation errors (empty if valid).
 */
export async function validateStructure(
  projectPath: string,
  config: SCEpterConfig,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const checkedPaths: string[] = [];

  const dataDir = path.join(projectPath, config.paths?.dataDir || '_scepter');
  const notesRoot = path.join(projectPath, config.paths?.notesRoot || '_scepter');

  await checkDirectory(dataDir, checkedPaths, errors);
  await checkDirectory(notesRoot, checkedPaths, errors);

  // Check optional directories only if they exist
  await checkOptionalDirectory(path.join(projectPath, '_scepter/_templates'), checkedPaths, errors);
  await checkOptionalDirectory(path.join(projectPath, '_scepter/_prompts'), checkedPaths, errors);
  await checkOptionalDirectory(path.join(notesRoot, '_templates'), checkedPaths, errors);

  // Check note type directories (only for types with a folder defined)
  for (const [_key, noteType] of Object.entries(config.noteTypes)) {
    if (noteType.folder) {
      const noteTypePath = path.join(notesRoot, noteType.folder);
      await checkDirectory(noteTypePath, checkedPaths, errors);
    }
  }

  return errors;
}

/**
 * Build a full validation report including checked paths.
 */
export async function getValidationReport(
  projectPath: string,
  config: SCEpterConfig,
): Promise<ValidationReport> {
  const errors = await validateStructure(projectPath, config);

  const checkedPaths: string[] = [];
  const dataDir = path.join(projectPath, config.paths?.dataDir || '_scepter');
  const notesRoot = path.join(projectPath, config.paths?.notesRoot || '_scepter');

  checkedPaths.push(dataDir, notesRoot);

  for (const noteType of Object.values(config.noteTypes)) {
    if (noteType.folder) {
      checkedPaths.push(path.join(notesRoot, noteType.folder));
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
    checkedPaths,
  };
}

// ── Cleanup ─────────────────────────────────────────────────────────

/**
 * Suggest cleanup actions for orphaned or unexpected directories.
 */
export async function getCleanupSuggestions(
  projectPath: string,
  config: SCEpterConfig,
): Promise<CleanupSuggestion[]> {
  const suggestions: CleanupSuggestion[] = [];
  const notesRoot = path.join(projectPath, config.paths?.notesRoot || '_scepter');

  // Check for orphaned note type folders (only consider types that have folders)
  const expectedNoteFolders = new Set(
    Object.values(config.noteTypes)
      .map((nt) => nt.folder)
      .filter((f): f is string => !!f),
  );
  await checkOrphanedFolders(notesRoot, expectedNoteFolders, 'note type', suggestions);

  return suggestions;
}

// ── Directory statistics ────────────────────────────────────────────

/**
 * Count files with a given extension in a directory tree.
 */
export async function countFilesInDirectory(dirPath: string, extension: string): Promise<number> {
  let count = 0;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(extension)) {
        count++;
      } else if (entry.isDirectory()) {
        count += await countFilesInDirectory(path.join(dirPath, entry.name), extension);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return count;
}

/**
 * Find the most recent modification time in a directory tree.
 */
export async function getLastModifiedInDirectory(dirPath: string): Promise<Date | null> {
  let lastModified: Date | null = null;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const stats = await fs.stat(entryPath);

      if (!lastModified || stats.mtime > lastModified) {
        lastModified = stats.mtime;
      }

      if (entry.isDirectory()) {
        const subDirMtime = await getLastModifiedInDirectory(entryPath);
        if (subDirMtime && (!lastModified || subDirMtime > lastModified)) {
          lastModified = subDirMtime;
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return lastModified;
}

/**
 * Calculate the total size of all files in a directory tree.
 */
export async function getDirectorySize(dirPath: string): Promise<number> {
  let size = 0;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const stats = await fs.stat(entryPath);

      if (entry.isFile()) {
        size += stats.size;
      } else if (entry.isDirectory()) {
        size += await getDirectorySize(entryPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return size;
}

// ── Internal helpers ────────────────────────────────────────────────

async function checkDirectory(
  dirPath: string,
  checkedPaths: string[],
  errors: ValidationError[],
): Promise<void> {
  checkedPaths.push(dirPath);

  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      errors.push({
        type: 'not_a_directory',
        path: dirPath,
        message: `Path exists but is not a directory: ${dirPath}`,
      });
    }
  } catch {
    errors.push({
      type: 'missing_directory',
      path: dirPath,
      message: `Required directory is missing: ${dirPath}`,
    });
  }
}

async function checkOptionalDirectory(
  dirPath: string,
  checkedPaths: string[],
  errors: ValidationError[],
): Promise<void> {
  try {
    const stats = await fs.stat(dirPath);
    checkedPaths.push(dirPath);
    if (!stats.isDirectory()) {
      errors.push({
        type: 'not_a_directory',
        path: dirPath,
        message: `Path exists but is not a directory: ${dirPath}`,
      });
    }
  } catch {
    // Directory doesn't exist — that's fine for optional directories
  }
}

async function checkOrphanedFolders(
  rootPath: string,
  expectedFolders: Set<string>,
  folderType: string,
  suggestions: CleanupSuggestion[],
): Promise<void> {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !expectedFolders.has(entry.name)) {
        const folderPath = path.join(rootPath, entry.name);
        const hasContent = await directoryHasContent(folderPath);

        suggestions.push({
          path: folderPath,
          reason: `Orphaned ${folderType} folder not in configuration`,
          hasContent,
        });
      }
    }
  } catch {
    // Directory doesn't exist
  }
}

async function directoryHasContent(dirPath: string): Promise<boolean> {
  try {
    const files = await fs.readdir(dirPath);
    return files.some((f) => f !== '.gitkeep');
  } catch {
    return false;
  }
}

// ── Type management utilities ──────────────────────────────────────

/**
 * Ensure a note type directory exists.
 * Used by addNoteType() after config update.
 */
export async function ensureNoteTypeDirectory(
  projectPath: string,
  config: SCEpterConfig,
  folder: string,
): Promise<void> {
  const folderPath = path.join(
    projectPath,
    config.paths?.notesRoot || '_scepter',
    folder,
  );
  await fs.mkdir(folderPath, { recursive: true });
}

/**
 * Rename a template file from one type name to another.
 * Returns true if a template was renamed, false if none existed.
 */
export async function renameTemplate(
  projectPath: string,
  config: SCEpterConfig,
  oldName: string,
  newName: string,
): Promise<boolean> {
  const templateDir = path.join(
    projectPath,
    config.templates?.paths?.types || '_scepter/templates/types',
  );
  const oldPath = path.join(templateDir, `${oldName}.md`);
  const newPath = path.join(templateDir, `${newName}.md`);
  try {
    await fs.rename(oldPath, newPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a directory if it exists and is empty.
 * Used during type deletion to clean up empty type folders.
 */
export async function removeEmptyDirectory(dirPath: string): Promise<void> {
  try {
    const remaining = await fs.readdir(dirPath);
    if (remaining.length === 0) {
      await fs.rmdir(dirPath);
    }
  } catch {
    // Folder might not exist or already be deleted
  }
}
