/**
 * @implements {E002} Folder-Based Notes Implementation
 * Utilities for handling folder-based notes in SCEpter.
 * A folder-based note consists of a folder containing a main note file
 * plus additional context materials (images, data files, etc.).
 *
 * NOTE: This file uses native fs/promises for most operations because fs-extra
 * methods like stat, readdir, access don't work properly with Vite SSR transforms.
 * fs-extra is only used for higher-level operations like ensureDir, copy, move, remove.
 */

import * as fs from 'fs-extra';
import { stat as fsStat, readdir as fsReaddir, access as fsAccess, constants as fsConstants } from 'fs/promises';
import * as path from 'path';

/**
 * Detection result for folder-based notes
 */
export interface FolderNoteDetection {
  /** Whether the path represents a folder-based note */
  isFolder: boolean;
  /** Path to the main note file within the folder */
  mainFile?: string;
  /** Path to the folder itself */
  folderPath?: string;
}

/**
 * Detects if a given path represents a folder-based note.
 * A valid folder note has:
 * 1. A directory structure
 * 2. A main note file with the same name as the folder
 * 3. The folder name starts with a valid note ID pattern
 *
 * @param folderPath - Path to check for folder-based note
 * @returns Detection result with folder information
 */
export async function detectFolderNote(folderPath: string): Promise<FolderNoteDetection> {
  try {
    // Check if path exists and is a directory
    // Use native fs/promises.stat for Vite SSR compatibility (fs-extra.stat doesn't work in Vite SSR)
    const stats = await fsStat(folderPath);
    if (!stats.isDirectory()) {
      return { isFolder: false };
    }

    // Extract folder name
    const folderName = path.basename(folderPath);

    // Check if folder name starts with a note ID pattern (e.g., D001, REQ001, T001)
    const idMatch = folderName.match(/^([A-Z]+\d+)/);
    if (!idMatch) {
      return { isFolder: false };
    }

    // Look for main file - prefer ID pattern for consistency
    // Try both ID-only and full folder name patterns
    const possibleMainFiles = [
      path.join(folderPath, `${idMatch[1]}.md`),  // Preferred: D001.md
      path.join(folderPath, `${folderName}.md`)   // Legacy: D001 Decision Title.md
    ];

    for (const mainFile of possibleMainFiles) {
      if (await fs.pathExists(mainFile)) {
        return {
          isFolder: true,
          mainFile,
          folderPath
        };
      }
    }

    // No valid main file found
    return { isFolder: false };
  } catch (error) {
    // Path doesn't exist or other error
    return { isFolder: false };
  }
}

/**
 * Scans a folder for additional content files (excluding the main note file).
 * Filters out system files and the main note file itself.
 *
 * @param folderPath - Path to the folder to scan
 * @returns Array of relative file paths within the folder
 */
export async function scanFolderContents(folderPath: string): Promise<string[]> {
  try {
    // Use native fs/promises.readdir for Vite SSR compatibility
    const entries = await fsReaddir(folderPath, { withFileTypes: true });
    const files: string[] = [];

    // Extract folder name to identify main file
    const folderName = path.basename(folderPath);
    const idMatch = folderName.match(/^([A-Z]+\d+)/);
    const noteId = idMatch ? idMatch[1] : null;

    for (const entry of entries) {
      if (entry.isFile()) {
        const fileName = entry.name;

        // Skip system files
        if (fileName.startsWith('.')) {
          continue;
        }

        // Skip the main note file
        if (noteId && (fileName === `${folderName}.md` || fileName === `${noteId}.md`)) {
          continue;
        }

        files.push(fileName);
      } else if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subDirPath = path.join(folderPath, entry.name);
        const subFiles = await scanFolderContents(subDirPath);

        // Add subdirectory files with relative path
        for (const subFile of subFiles) {
          files.push(path.join(entry.name, subFile));
        }
      }
    }

    return files;
  } catch (error) {
    console.error(`Error scanning folder contents: ${error}`);
    return [];
  }
}

/**
 * Creates a folder structure for a new folder-based note.
 * Creates the folder and the main note file within it.
 *
 * @param noteId - The note ID (e.g., 'D001')
 * @param title - Optional title for the note
 * @param basePath - Base path where the folder should be created
 * @param template - Optional template content for the main note file
 * @returns Path to the created folder
 */
export async function createFolderStructure(
  noteId: string,
  title: string | undefined,
  basePath: string,
  template?: string
): Promise<string> {
  // Create folder name (ID + optional title)
  const folderName = title && title.trim()
    ? `${noteId} ${title.trim().replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').substring(0, 60)}`
    : noteId;

  const folderPath = path.join(basePath, folderName);

  // Ensure folder exists
  await fs.ensureDir(folderPath);

  // Create main note file (use note ID for consistency with detection logic)
  const mainFilePath = path.join(folderPath, `${noteId}.md`);

  // Write template or empty content
  await fs.writeFile(mainFilePath, template || '');

  return folderPath;
}

/**
 * Gets information about additional files in a folder-based note.
 * Returns metadata about each file including type, size, and modification date.
 *
 * @param folderPath - Path to the folder-based note
 * @returns Array of file metadata
 */
export async function getFolderFileMetadata(folderPath: string): Promise<Array<{
  path: string;
  type: 'markdown' | 'image' | 'data' | 'other';
  size: number;
  modified: Date;
}>> {
  const files = await scanFolderContents(folderPath);
  const metadata = [];

  for (const file of files) {
    const filePath = path.join(folderPath, file);

    try {
      // Use native fs/promises.stat for Vite SSR compatibility
      const stats = await fsStat(filePath);
      const ext = path.extname(file).toLowerCase();

      // Determine file type based on extension
      let type: 'markdown' | 'image' | 'data' | 'other';

      if (ext === '.md' || ext === '.markdown') {
        type = 'markdown';
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'].includes(ext)) {
        type = 'image';
      } else if (['.json', '.yaml', '.yml', '.csv', '.xml'].includes(ext)) {
        type = 'data';
      } else {
        type = 'other';
      }

      metadata.push({
        path: file,
        type,
        size: stats.size,
        modified: stats.mtime
      });
    } catch (error) {
      console.error(`Error getting metadata for file ${file}: ${error}`);
    }
  }

  return metadata;
}

/**
 * Validates folder structure for a folder-based note.
 * Checks that the folder has a valid main file and structure.
 *
 * @param folderPath - Path to validate
 * @returns True if folder structure is valid
 */
export async function validateFolderStructure(folderPath: string): Promise<boolean> {
  const detection = await detectFolderNote(folderPath);

  if (!detection.isFolder || !detection.mainFile) {
    return false;
  }

  // Check that main file exists and is readable
  // Use native fs/promises.access for Vite SSR compatibility
  try {
    await fsAccess(detection.mainFile, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies a folder-based note to a new location.
 * Preserves the folder structure and all contents.
 *
 * @param sourcePath - Source folder path
 * @param destinationPath - Destination folder path
 */
export async function copyFolderNote(sourcePath: string, destinationPath: string): Promise<void> {
  await fs.copy(sourcePath, destinationPath, {
    overwrite: false,
    errorOnExist: true
  });
}

/**
 * Moves a folder-based note to a new location.
 * Ensures atomic operation for folder moves.
 *
 * @param sourcePath - Source folder path
 * @param destinationPath - Destination folder path
 */
export async function moveFolderNote(sourcePath: string, destinationPath: string): Promise<void> {
  await fs.move(sourcePath, destinationPath, {
    overwrite: false
  });
}

/**
 * Deletes a folder-based note.
 * Removes the entire folder and all its contents.
 *
 * @param folderPath - Folder path to delete
 */
export async function deleteFolderNote(folderPath: string): Promise<void> {
  await fs.remove(folderPath);
}