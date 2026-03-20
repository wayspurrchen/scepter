/**
 * Migration utilities for converting between file and folder-based note formats
 * @implements {T003} - Migration utilities for folder-based notes feature
 *
 * These utilities provide safe, reversible migration between the two note formats
 * with proper validation and error handling.
 *
 * @module FolderMigration
 */

import * as path from 'path';
import fs from 'fs-extra';
import { NoteManager } from '../notes/note-manager';
import { NoteFileManager } from '../notes/note-file-manager';
import { detectFolderNote, scanFolderContents, createFolderStructure } from '../notes/folder-utils';
import type { Note } from '../types/note';
import type { ConfigManager } from '../config/config-manager';

export interface MigrationOptions {
  /** Create backup before migration */
  backup?: boolean;
  /** Directory for backups */
  backupDir?: string;
  /** Dry run - don't actually make changes */
  dryRun?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

export interface MigrationResult {
  success: boolean;
  noteId: string;
  fromFormat: 'file' | 'folder';
  toFormat: 'file' | 'folder';
  backupPath?: string;
  error?: string;
  warnings?: string[];
}

export class FolderMigration {
  constructor(
    private noteManager: NoteManager,
    private noteFileManager: NoteFileManager,
    private configManager: ConfigManager
  ) {}

  /**
   * Convert a single-file note to folder format
   *
   * @param noteId - ID of the note to convert
   * @param options - Migration options
   * @returns Migration result with status and details
   */
  async convertToFolder(noteId: string, options: MigrationOptions = {}): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      noteId,
      fromFormat: 'file',
      toFormat: 'folder',
      warnings: []
    };

    try {
      // Log if verbose
      if (options.verbose) {
        console.log(`Converting note ${noteId} to folder format...`);
      }

      // Get the note
      const note = await this.noteManager.getNoteById(noteId);
      if (!note) {
        result.error = `Note ${noteId} not found`;
        return result;
      }

      // Check if already a folder
      if (note.isFolder) {
        result.error = `Note ${noteId} is already in folder format`;
        return result;
      }

      // Get current file path
      const currentPath = note.filePath;
      if (!currentPath) {
        result.error = `Could not determine file path for note ${noteId}`;
        return result;
      }

      // Check note type supports folders
      const config = this.configManager.getConfig();
      const noteType = config.noteTypes[note.type];
      if (!noteType?.supportsFolderFormat) {
        result.warnings?.push(`Note type ${note.type} does not officially support folder format`);
      }

      // Create backup if requested
      if (options.backup && !options.dryRun) {
        const backupPath = await this.createBackup(currentPath, options.backupDir);
        result.backupPath = backupPath;
        if (options.verbose) {
          console.log(`Created backup at ${backupPath}`);
        }
      }

      // Dry run - just report what would happen
      if (options.dryRun) {
        const folderPath = currentPath.replace('.md', '');
        if (options.verbose) {
          console.log(`DRY RUN: Would create folder at ${folderPath}`);
          console.log(`DRY RUN: Would move ${currentPath} into folder as main file`);
        }
        result.success = true;
        return result;
      }

      // Perform the conversion
      const folderPath = currentPath.replace('.md', '');

      // Create folder
      await fs.ensureDir(folderPath);

      // Determine main file name
      const folderName = path.basename(folderPath);
      const mainFileName = `${folderName}.md`;
      const newMainPath = path.join(folderPath, mainFileName);

      // Move file into folder
      await fs.move(currentPath, newMainPath);

      // Update note metadata
      note.isFolder = true;
      note.folderPath = folderPath;
      note.filePath = newMainPath;

      // Refresh indexes
      await this.noteManager.refreshIndex();

      if (options.verbose) {
        console.log(`Successfully converted ${noteId} to folder format at ${folderPath}`);
      }

      result.success = true;
      return result;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Convert a folder-based note to single file format
   *
   * @param noteId - ID of the note to convert
   * @param options - Migration options
   * @returns Migration result with status and details
   */
  async convertToFile(noteId: string, options: MigrationOptions = {}): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      noteId,
      fromFormat: 'folder',
      toFormat: 'file',
      warnings: []
    };

    try {
      // Log if verbose
      if (options.verbose) {
        console.log(`Converting note ${noteId} to file format...`);
      }

      // Get the note
      const note = await this.noteManager.getNoteById(noteId);
      if (!note) {
        result.error = `Note ${noteId} not found`;
        return result;
      }

      // Check if already a file
      if (!note.isFolder) {
        result.error = `Note ${noteId} is already in file format`;
        return result;
      }

      // Get folder path
      const folderPath = note.folderPath;
      if (!folderPath || !await fs.pathExists(folderPath)) {
        result.error = `Folder path not found for note ${noteId}`;
        return result;
      }

      // Check for additional files
      const additionalFiles = await scanFolderContents(folderPath);
      if (additionalFiles.length > 0) {
        result.warnings?.push(`Found ${additionalFiles.length} additional files in folder`);
      }

      // Create backup if requested
      if (options.backup && !options.dryRun) {
        const backupPath = await this.createFolderBackup(folderPath, options.backupDir);
        result.backupPath = backupPath;
        if (options.verbose) {
          console.log(`Created backup at ${backupPath}`);
        }
      }

      // Get main file path
      const mainFile = note.filePath;
      if (!mainFile || !await fs.pathExists(mainFile)) {
        result.error = `Main file not found in folder for note ${noteId}`;
        return result;
      }

      // Determine new file path
      const parentDir = path.dirname(folderPath);
      const folderName = path.basename(folderPath);
      const newFilePath = path.join(parentDir, `${folderName}.md`);

      // Dry run - just report what would happen
      if (options.dryRun) {
        if (options.verbose) {
          console.log(`DRY RUN: Would move ${mainFile} to ${newFilePath}`);
          if (additionalFiles.length > 0) {
            console.log(`DRY RUN: Would archive ${additionalFiles.length} additional files`);
          }
          console.log(`DRY RUN: Would remove folder ${folderPath}`);
        }
        result.success = true;
        return result;
      }

      // Move main file out of folder
      await fs.move(mainFile, newFilePath);

      // Handle additional files
      if (additionalFiles.length > 0) {
        const archivePath = `${folderPath}_archived_${Date.now()}`;
        await fs.ensureDir(archivePath);

        for (const file of additionalFiles) {
          const sourcePath = path.join(folderPath, file);
          const destPath = path.join(archivePath, file);
          await fs.ensureDir(path.dirname(destPath));
          await fs.move(sourcePath, destPath);
        }

        result.warnings?.push(`Additional files archived at ${archivePath}`);

        if (options.verbose) {
          console.log(`Archived ${additionalFiles.length} additional files to ${archivePath}`);
        }
      }

      // Remove the now-empty folder
      await fs.remove(folderPath);

      // Update note metadata
      note.isFolder = false;
      note.folderPath = undefined;
      note.filePath = newFilePath;
      note.additionalFiles = undefined;

      // Refresh indexes
      await this.noteManager.refreshIndex();

      if (options.verbose) {
        console.log(`Successfully converted ${noteId} to file format at ${newFilePath}`);
      }

      result.success = true;
      return result;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Batch convert multiple notes to folder format
   *
   * @param noteIds - Array of note IDs to convert
   * @param options - Migration options
   * @returns Array of migration results
   */
  async batchConvertToFolder(
    noteIds: string[],
    options: MigrationOptions = {}
  ): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];

    for (const noteId of noteIds) {
      if (options.verbose) {
        console.log(`Processing ${noteId} (${noteIds.indexOf(noteId) + 1}/${noteIds.length})...`);
      }

      const result = await this.convertToFolder(noteId, options);
      results.push(result);

      // Stop on error unless in dry run
      if (!result.success && !options.dryRun) {
        if (options.verbose) {
          console.error(`Failed to convert ${noteId}: ${result.error}`);
        }
        break;
      }
    }

    return results;
  }

  /**
   * Batch convert multiple notes to file format
   *
   * @param noteIds - Array of note IDs to convert
   * @param options - Migration options
   * @returns Array of migration results
   */
  async batchConvertToFile(
    noteIds: string[],
    options: MigrationOptions = {}
  ): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];

    for (const noteId of noteIds) {
      if (options.verbose) {
        console.log(`Processing ${noteId} (${noteIds.indexOf(noteId) + 1}/${noteIds.length})...`);
      }

      const result = await this.convertToFile(noteId, options);
      results.push(result);

      // Stop on error unless in dry run
      if (!result.success && !options.dryRun) {
        if (options.verbose) {
          console.error(`Failed to convert ${noteId}: ${result.error}`);
        }
        break;
      }
    }

    return results;
  }

  /**
   * Convert all notes of a specific type to folder format
   *
   * @param noteType - The note type to convert
   * @param options - Migration options
   * @returns Array of migration results
   */
  async convertTypeToFolder(
    noteType: string,
    options: MigrationOptions = {}
  ): Promise<MigrationResult[]> {
    if (options.verbose) {
      console.log(`Converting all ${noteType} notes to folder format...`);
    }

    // Get all notes of the type
    const allNotes = await this.noteManager.getAllNotes();
    const typeNotes = allNotes.filter(n => n.type === noteType && !n.isFolder);

    if (typeNotes.length === 0) {
      if (options.verbose) {
        console.log(`No file-based ${noteType} notes found to convert`);
      }
      return [];
    }

    const noteIds = typeNotes.map(n => n.id);
    return this.batchConvertToFolder(noteIds, options);
  }

  /**
   * Convert all notes of a specific type to file format
   *
   * @param noteType - The note type to convert
   * @param options - Migration options
   * @returns Array of migration results
   */
  async convertTypeToFile(
    noteType: string,
    options: MigrationOptions = {}
  ): Promise<MigrationResult[]> {
    if (options.verbose) {
      console.log(`Converting all ${noteType} notes to file format...`);
    }

    // Get all notes of the type
    const allNotes = await this.noteManager.getAllNotes();
    const typeNotes = allNotes.filter(n => n.type === noteType && n.isFolder);

    if (typeNotes.length === 0) {
      if (options.verbose) {
        console.log(`No folder-based ${noteType} notes found to convert`);
      }
      return [];
    }

    const noteIds = typeNotes.map(n => n.id);
    return this.batchConvertToFile(noteIds, options);
  }

  /**
   * Create a backup of a file
   *
   * @private
   * @param filePath - Path to the file to backup
   * @param backupDir - Optional backup directory
   * @returns Path to the backup
   */
  private async createBackup(filePath: string, backupDir?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = path.basename(filePath);
    const backupName = `${fileName}.backup-${timestamp}`;

    const dir = backupDir || path.join(path.dirname(filePath), '.backups');
    await fs.ensureDir(dir);

    const backupPath = path.join(dir, backupName);
    await fs.copy(filePath, backupPath);

    return backupPath;
  }

  /**
   * Create a backup of a folder
   *
   * @private
   * @param folderPath - Path to the folder to backup
   * @param backupDir - Optional backup directory
   * @returns Path to the backup
   */
  private async createFolderBackup(folderPath: string, backupDir?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folderName = path.basename(folderPath);
    const backupName = `${folderName}.backup-${timestamp}`;

    const dir = backupDir || path.join(path.dirname(folderPath), '.backups');
    await fs.ensureDir(dir);

    const backupPath = path.join(dir, backupName);
    await fs.copy(folderPath, backupPath);

    return backupPath;
  }

  /**
   * Get migration statistics for a project
   *
   * @returns Statistics about note formats in the project
   */
  async getMigrationStats(): Promise<{
    totalNotes: number;
    fileNotes: number;
    folderNotes: number;
    byType: Record<string, { file: number; folder: number }>;
  }> {
    const allNotes = await this.noteManager.getAllNotes();

    const stats = {
      totalNotes: allNotes.length,
      fileNotes: 0,
      folderNotes: 0,
      byType: {} as Record<string, { file: number; folder: number }>
    };

    for (const note of allNotes) {
      if (note.isFolder) {
        stats.folderNotes++;
      } else {
        stats.fileNotes++;
      }

      if (!stats.byType[note.type]) {
        stats.byType[note.type] = { file: 0, folder: 0 };
      }

      if (note.isFolder) {
        stats.byType[note.type].folder++;
      } else {
        stats.byType[note.type].file++;
      }
    }

    return stats;
  }

  /**
   * Validate a note can be migrated
   *
   * @param noteId - Note ID to validate
   * @param toFormat - Target format
   * @returns Validation result with any issues found
   */
  async validateMigration(
    noteId: string,
    toFormat: 'file' | 'folder'
  ): Promise<{
    valid: boolean;
    issues: string[];
    warnings: string[];
  }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    const note = await this.noteManager.getNoteById(noteId);
    if (!note) {
      issues.push(`Note ${noteId} not found`);
      return { valid: false, issues, warnings };
    }

    if (toFormat === 'folder') {
      if (note.isFolder) {
        issues.push(`Note ${noteId} is already in folder format`);
      }

      // Check type support
      const config = this.configManager.getConfig();
      const noteType = config.noteTypes[note.type];
      if (!noteType?.supportsFolderFormat) {
        warnings.push(`Note type ${note.type} does not officially support folder format`);
      }

      // Check if folder name would be valid
      const currentPath = note.filePath;
      if (currentPath) {
        const folderPath = currentPath.replace('.md', '');
        if (await fs.pathExists(folderPath)) {
          issues.push(`Folder already exists at ${folderPath}`);
        }
      }

    } else {
      if (!note.isFolder) {
        issues.push(`Note ${noteId} is already in file format`);
      }

      // Check for additional files
      if (note.folderPath) {
        const additionalFiles = await scanFolderContents(note.folderPath);
        if (additionalFiles.length > 0) {
          warnings.push(`Note has ${additionalFiles.length} additional files that will be archived`);
        }
      }

      // Check if target file exists
      if (note.folderPath) {
        const parentDir = path.dirname(note.folderPath);
        const folderName = path.basename(note.folderPath);
        const targetPath = path.join(parentDir, `${folderName}.md`);
        if (await fs.pathExists(targetPath)) {
          issues.push(`File already exists at ${targetPath}`);
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      warnings
    };
  }
}