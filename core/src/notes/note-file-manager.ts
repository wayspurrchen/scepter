import { EventEmitter } from 'events';
import * as path from 'path';
import fs from 'fs-extra';
import { readFileSync } from 'fs';
import { stat } from 'fs/promises';
import * as chokidar from 'chokidar';
import { glob } from 'glob';
import matter from 'gray-matter';
import { stringifyFrontmatter } from './yaml-frontmatter';
import type { Note } from '../types/note';
import type { ConfigManager } from '../config/config-manager';
import type { NoteTypeConfig } from '../types/config';
import { createFolderStructure, detectFolderNote, scanFolderContents, scanFolderContentsSync } from './folder-utils';
import { StagingArea, type StagedOperation } from '../lifecycle/atomicity/staging';

export class NoteFileManager extends EventEmitter {
  private noteIndex: Map<string, string> = new Map(); // noteId -> filePath
  private watcher?: chokidar.FSWatcher;
  private fileToNoteId: Map<string, string> = new Map(); // filePath -> noteId

  constructor(
    private projectPath: string,
    private configManager: ConfigManager,
  ) {
    super();
  }

  /**
   * Format a Date according to the configured timestampPrecision.
   * - 'datetime': full ISO 8601 (e.g. 2025-07-20T16:45:22.099Z)
   * - 'date' (default): date only (YYYY-MM-DD)
   */
  private formatTimestamp(date: Date): string {
    const config = this.configManager.getConfig();
    if (config.timestampPrecision === 'datetime') {
      return date.toISOString();
    }
    return date.toISOString().split('T')[0];
  }

  /**
   * Generate a filesystem-safe filename from note ID and title
   */
  generateFilename(note: Note): string {
    if (!note.title || note.title.trim() === '') {
      return `${note.id}.md`;
    }

    // Remove special characters and normalize the title
    const cleanTitle = note.title
      .replace(/[^a-zA-Z0-9\s-]/g, ' ') // Replace special chars with spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // Truncate if too long (keeping room for ID and .md extension)
    const maxLength = 80;
    const filename = `${note.id} ${cleanTitle}`.substring(0, maxLength).trim();

    return `${filename}.md`;
  }

  /**
   * Create a note file with the generated template
   * @implements {E002} Supports both file and folder-based notes
   */
  async createNoteFile(note: Note): Promise<void> {
    // Get current config
    const config = this.configManager.getConfig();

    // Get type configuration
    const typeConfig = await this.findTypeConfig(note.type);
    if (!typeConfig) {
      throw new Error(`Unknown note type: ${note.type}`);
    }

    // Check if this note should be created as a folder
    // Logic: Global setting (default true) AND type-level not explicitly disabled AND (user flag or type default)
    const globalEnabled = config.folderNotesEnabled !== false; // Defaults to true
    const typeEnabled = typeConfig.supportsFolderFormat !== false; // Defaults to true (opt-out)
    const createAsFolder = globalEnabled && typeEnabled &&
      (note.isFolder || typeConfig.defaultFormat === 'folder');

    // Derive folder name: use configured folder if present, otherwise lowercase type name + 's'
    const folderName = typeConfig.folder || `${note.type.toLowerCase()}s`;
    const baseFolderPath = path.join(
      this.projectPath,
      config.paths?.notesRoot || '_scepter',
      folderName,
    );

    await fs.ensureDir(baseFolderPath);

    // Prepare note content/template
    let fileContent: string;
    if (note.content && note.content.trim().startsWith('---')) {
      // Content already has frontmatter, use as-is
      fileContent = note.content;
    } else {
      // Create from template
      fileContent = this.getNoteTemplate(note);
    }

    if (createAsFolder) {
      // Create folder-based note structure
      const noteFolderPath = await createFolderStructure(
        note.id,
        note.title,
        baseFolderPath,
        fileContent  // This is correct - fileContent is the template
      );

      // The main file path within the folder
      const mainFilePath = path.join(noteFolderPath, `${note.id}.md`);

      // Update indexes with the main file path
      this.noteIndex.set(note.id, mainFilePath);
      this.fileToNoteId.set(mainFilePath, note.id);

      // Emit event with folder information
      this.emit('file:created', {
        noteId: note.id,
        filePath: mainFilePath,
        folderPath: noteFolderPath,
        type: note.type,
        isFolder: true,
      });
    } else {
      // Create traditional single file note
      const filename = this.generateFilename(note);
      const filePath = path.join(baseFolderPath, filename);

      // Check if file already exists
      const exists = await fs.pathExists(filePath);
      if (exists) {
        throw new Error('Note file already exists');
      }

      // Write content
      await fs.writeFile(filePath, fileContent);

      // Update indexes
      this.noteIndex.set(note.id, filePath);
      this.fileToNoteId.set(filePath, note.id);

      // Emit event
      this.emit('file:created', {
        noteId: note.id,
        filePath,
        type: note.type,
        isFolder: false,
      });
    }
  }

  /**
   * Get the original file contents for a note
   */
  async getFileContents(noteId: string): Promise<string | null> {
    const filePath = this.noteIndex.get(noteId);
    if (!filePath) {
      return null;
    }

    try {
      const contents = await fs.readFile(filePath, 'utf-8');
      return contents;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get aggregated file contents for a note, including companion markdown
   * files in folder-based notes. For non-folder notes this behaves
   * identically to getFileContents(). For folder notes it concatenates the
   * main file with every companion .md file (sorted alphabetically for
   * determinism), stripping frontmatter from companions so only one
   * frontmatter block (the main file's) appears in the result.
   *
   * This is the method claim indexing and linting should use so that claims
   * scattered across sub-files within a folder note are treated as part of
   * one unified note.
   *
   * @implements {R008.§1.AC.01} Reads main file + all companion .md files, returns concatenated string
   * @implements {R008.§1.AC.02} Companion files sorted alphabetically before concatenation
   * @implements {R008.§1.AC.03} Frontmatter stripped from companion files via gray-matter
   * @implements {R008.§1.AC.04} Only .md files included; non-markdown files excluded
   * @implements {R008.§1.AC.05} Non-folder notes return single file content (identical to getFileContents)
   * @implements {R008.§1.AC.06} Returns null if noteId not found in index
   * @implements {R008.§1.AC.07} Returns null on filesystem errors (catch block)
   */
  async getAggregatedContents(noteId: string): Promise<string | null> {
    const filePath = this.noteIndex.get(noteId);
    if (!filePath) return null;

    try {
      const mainContent = await fs.readFile(filePath, 'utf-8');

      // Detect folder note: parent directory name starts with the note ID
      const dir = path.dirname(filePath);
      const dirName = path.basename(dir);
      const idMatch = dirName.match(/^([A-Z]+\d+)/);

      if (!idMatch || idMatch[1] !== noteId) {
        // Not a folder note — return main file only
        return mainContent;
      }

      // Folder note — find companion .md files
      const companionFiles = await scanFolderContents(dir);
      const mdCompanions = companionFiles
        .filter((f) => f.endsWith('.md'))
        .sort(); // alphabetical for determinism

      if (mdCompanions.length === 0) {
        return mainContent;
      }

      let aggregated = mainContent;
      for (const companion of mdCompanions) {
        const raw = await fs.readFile(path.join(dir, companion), 'utf-8');
        // Strip frontmatter from companions so only the main file's
        // frontmatter survives in the concatenated output.
        const { content: body } = matter(raw);
        aggregated += '\n\n' + body;
      }
      return aggregated;
    } catch {
      return null;
    }
  }

  /**
   * Synchronous companion to getAggregatedContents. Same folder-note
   * aggregation semantics — main file plus alphabetized companion .md
   * files with their frontmatter stripped — but uses sync filesystem
   * primitives so it can be called from a markdown-it render hook.
   *
   * @implements {R012.§7.AC.05} sync aggregation mirror used by ClaimBodyResolver's sync path
   */
  getAggregatedContentsSync(noteId: string): string | null {
    const filePath = this.noteIndex.get(noteId);
    if (!filePath) return null;

    try {
      const mainContent = readFileSync(filePath, 'utf-8');

      const dir = path.dirname(filePath);
      const dirName = path.basename(dir);
      const idMatch = dirName.match(/^([A-Z]+\d+)/);

      if (!idMatch || idMatch[1] !== noteId) {
        return mainContent;
      }

      const companionFiles = scanFolderContentsSync(dir);
      const mdCompanions = companionFiles
        .filter((f) => f.endsWith('.md'))
        .sort();

      if (mdCompanions.length === 0) return mainContent;

      let aggregated = mainContent;
      for (const companion of mdCompanions) {
        const raw = readFileSync(path.join(dir, companion), 'utf-8');
        const { content: body } = matter(raw);
        aggregated += '\n\n' + body;
      }
      return aggregated;
    } catch {
      return null;
    }
  }

  /**
   * Get the file path for a note
   */
  getFilePath(noteId: string): string | undefined {
    return this.noteIndex.get(noteId);
  }

  /**
   * Update an existing note file
   */
  async updateNoteFile(note: Note): Promise<void> {
    const filePath = this.noteIndex.get(note.id);
    if (!filePath) {
      throw new Error(`No file found for note ${note.id}`);
    }

    // Check if file exists
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      throw new Error(`Note file does not exist: ${filePath}`);
    }

    // Write updated content
    // If note already has content with frontmatter, use it as-is
    // Otherwise, create from template
    let fileContent: string;
    if (note.content && note.content.trim().startsWith('---')) {
      // Content already has frontmatter, use as-is
      fileContent = note.content;
    } else {
      // Create from template
      fileContent = this.getNoteTemplate(note);
    }
    await fs.writeFile(filePath, fileContent);

    // Emit event
    this.emit('file:modified', {
      noteId: note.id,
      filePath,
    });
  }

  /**
   * Find a note file by ID.
   * Notes Anywhere: uses in-memory index first, then falls back to recursive glob under _scepter/.
   * @implements {E002} Checks for folder-based notes first, then falls back to files
   */
  async findNoteFile(noteId: string, options?: { includeArchived?: boolean; includeDeleted?: boolean }): Promise<string | null> {
    // 1. Check in-memory index first
    const cachedPath = this.noteIndex.get(noteId);
    if (cachedPath && await fs.pathExists(cachedPath)) {
      // Verify the cached path is allowed by archive/deleted options
      const inArchive = cachedPath.includes('/_archive/');
      const inDeleted = cachedPath.includes('/_deleted/');
      if (inArchive && !options?.includeArchived) {
        // Skip — caller doesn't want archived results, fall through to glob
      } else if (inDeleted && !options?.includeDeleted) {
        // Skip — caller doesn't want deleted results, fall through to glob
      } else {
        return cachedPath;
      }
    }

    // 2. Fall back to recursive glob across all discovery paths
    const discoveryRoots = this.getDiscoveryRoots();

    // Build ID match regex: noteId followed by space, .md, or end of string
    const idRegex = new RegExp(`^${noteId}(\\s|\\.|$)`);

    for (const root of discoveryRoots) {
      if (!await fs.pathExists(root)) continue;

      const globPattern = path.join(root, '**', `${noteId}*`);
      const matches = await glob(globPattern, { dot: false });

      for (const matchPath of matches) {
        const basename = path.basename(matchPath);

        // Verify basename actually starts with the noteId (not a partial match)
        if (!idRegex.test(basename)) continue;

        // Exclude _templates/ and _prompts/
        const relToRoot = path.relative(root, matchPath);
        const parts = relToRoot.split(path.sep);
        if (parts.some(p => p === '_templates' || p === '_prompts')) continue;

        // Conditionally exclude _archive/ and _deleted/
        const inArchive = parts.some(p => p === '_archive');
        const inDeleted = parts.some(p => p === '_deleted');
        if (inArchive && !options?.includeArchived) continue;
        if (inDeleted && !options?.includeDeleted) continue;

        try {
          const stats = await stat(matchPath);

          if (stats.isDirectory()) {
            // Check if this is a folder-based note
            const detection = await detectFolderNote(matchPath);
            if (detection.isFolder && detection.mainFile) {
              return detection.mainFile;
            }
          } else if (stats.isFile() && matchPath.endsWith('.md')) {
            return matchPath;
          }
        } catch {
          // Skip inaccessible paths
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Check if a note file exists
   */
  async ensureNoteFile(noteId: string): Promise<boolean> {
    const filePath = await this.findNoteFile(noteId);
    return filePath !== null;
  }

  /**
   * Generate the markdown template for a note
   */
  getNoteTemplate(note: Note): string {
    const lines: string[] = [];

    // Add frontmatter
    lines.push('---');
    lines.push(`created: ${this.formatTimestamp(note.created)}`);

    // Add modified date if different from created
    if (note.modified && note.modified.getTime() !== note.created.getTime()) {
      lines.push(`modified: ${this.formatTimestamp(note.modified)}`);
    }

    // Add tags array
    if (note.tags && note.tags.length > 0) {
      lines.push(`tags: [${note.tags.join(', ')}]`);
    } else {
      lines.push('tags: []');
    }

    // @implements {T009} - Add status from metadata for any note type
    if (note.metadata?.status) {
      lines.push(`status: ${note.metadata.status}`);
    }

    // @implements {R018.§2.AC.01} Stamp each declared field into new-note frontmatter
    // @implements {R018.§2.AC.02} Stamp the configured default when no caller value
    // @implements {R018.§2.AC.03} Stamp an empty placeholder when no default and no caller value
    // @implements {R018.§2.AC.04} Caller-supplied metadata value takes precedence over the default
    // @implements {R018.§2.AC.05} Type without `fields` produces byte-identical output
    // Stamp declared per-type frontmatter fields so each is always present to
    // edit. A field the caller already supplied via metadata takes precedence
    // over the declared default. Gated on `fields` being present: a type
    // without `fields` produces byte-identical output.
    const declaredFields = this.configManager.getConfig().noteTypes?.[note.type]?.fields;
    if (declaredFields) {
      for (const field of declaredFields) {
        const supplied = note.metadata?.[field.name];
        const value = supplied !== undefined && supplied !== null ? supplied : field.default ?? '';
        lines.push(`${field.name}: ${value}`);
      }
    }

    lines.push('---');
    lines.push('');

    // Add the title with standard format
    lines.push(`# ${note.id} - ${note.title}`);
    lines.push('');

    // Add content
    if (note.content) {
      lines.push(note.content);
    } else {
      // Empty line for content placeholder
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Archive a note file - move to _archive subfolder.
   *
   * For folder-form notes (per {R008}), the entire folder unit — root .md
   * file plus every companion file — is relocated atomically as a single
   * transaction via the staging-area primitive. For single-file notes the
   * existing direct file-move behavior is preserved byte-equivalent.
   *
   * @implements {DD020.§3.DC.11} Atomicity guarantee applies to archive operation on the full note unit
   * @implements {DD020.§3.DC.12} Note unit definition (folder + companions for folder-form, single file otherwise) per R008
   * @implements {DD020.§3.DC.13} Folder-unit-aware path beneath archiveNoteFile committed as a single staged transaction
   * @implements {DD020.§3.DC.14} Existing-path bug-fix: companion files now move with the folder; single-file behavior unchanged
   */
  async archiveNoteFile(noteId: string, reason?: string): Promise<string> {
    return this.relocateNoteUnit(noteId, 'archive', reason);
  }

  /**
   * Delete a note file - move to _deleted subfolder (soft-delete).
   *
   * For folder-form notes (per {R008}), the entire folder unit — root .md
   * file plus every companion file — is relocated atomically as a single
   * transaction via the staging-area primitive. For single-file notes the
   * existing direct file-move behavior is preserved byte-equivalent.
   *
   * @implements {DD020.§3.DC.11} Atomicity guarantee applies to soft-delete operation on the full note unit
   * @implements {DD020.§3.DC.12} Note unit definition (folder + companions for folder-form, single file otherwise) per R008
   * @implements {DD020.§3.DC.13} Folder-unit-aware path beneath deleteNoteFile (soft-delete) committed as a single staged transaction
   * @implements {DD020.§3.DC.14} Existing-path bug-fix: companion files now move with the folder; single-file behavior unchanged
   */
  async deleteNoteFile(noteId: string, reason?: string): Promise<string> {
    return this.relocateNoteUnit(noteId, 'delete', reason);
  }

  /**
   * Shared implementation for archive and soft-delete relocation.
   *
   * Detects whether the note is folder-form vs single-file and dispatches
   * to the appropriate path. The folder-form path stages every file in
   * the unit through StagingArea and commits atomically; the single-file
   * path preserves the legacy direct file operations to remain
   * byte-equivalent for that case.
   */
  private async relocateNoteUnit(
    noteId: string,
    mode: 'archive' | 'delete',
    reason?: string,
  ): Promise<string> {
    const findOpts = mode === 'archive'
      ? { includeArchived: true }
      : { includeDeleted: true };
    const filePath = await this.findNoteFile(noteId, findOpts);
    if (!filePath) {
      throw new Error(`Note file not found: ${noteId}`);
    }

    if (mode === 'archive' && filePath.includes('/_archive/')) {
      throw new Error(`Note is already archived: ${noteId}`);
    }
    if (mode === 'delete' && filePath.includes('/_deleted/')) {
      throw new Error(`Note already deleted: ${noteId}`);
    }

    // Detect folder-form: parent directory matches the noteId pattern AND
    // resolves as a folder-based note via the folder-utils detection.
    const containingDir = path.dirname(filePath);
    const containingDirName = path.basename(containingDir);
    const dirIdMatch = containingDirName.match(/^([A-Z]+\d+)/);
    let isFolderForm = false;
    if (dirIdMatch && dirIdMatch[1] === noteId) {
      const detection = await detectFolderNote(containingDir);
      isFolderForm = detection.isFolder === true;
    }

    if (isFolderForm) {
      return this.relocateFolderUnit(noteId, filePath, containingDir, mode, reason);
    }
    return this.relocateSingleFile(noteId, filePath, mode, reason);
  }

  /**
   * Single-file relocation path. Preserves the legacy direct file
   * operations — content read, frontmatter update, write to subfolder,
   * unlink original — so that the observable behavior for single-file
   * notes is byte-equivalent to the pre-refactor implementation.
   */
  private async relocateSingleFile(
    noteId: string,
    filePath: string,
    mode: 'archive' | 'delete',
    reason?: string,
  ): Promise<string> {
    const subDirName = mode === 'archive' ? '_archive' : '_deleted';
    const eventName = mode === 'archive' ? 'file:archived' : 'file:deleted';

    const content = await fs.readFile(filePath, 'utf-8');
    const updatedContent = this.applyRelocationFrontmatter(content, mode, reason);

    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    const targetDir = path.join(dir, subDirName);
    const targetPath = path.join(targetDir, filename);

    await fs.ensureDir(targetDir);
    await fs.writeFile(targetPath, updatedContent);
    await fs.unlink(filePath);

    this.noteIndex.set(noteId, targetPath);
    this.fileToNoteId.delete(filePath);
    this.fileToNoteId.set(targetPath, noteId);

    if (mode === 'archive') {
      this.emit(eventName, {
        noteId,
        oldPath: filePath,
        newPath: targetPath,
        reason,
      });
    } else {
      this.emit(eventName, {
        noteId,
        oldPath: filePath,
        newPath: targetPath,
        reason,
        requiresReferenceUpdate: true,
      });
    }

    return targetPath;
  }

  /**
   * Folder-form relocation path. Enumerates every file in the unit
   * (root .md + companion files), stages all moves through StagingArea,
   * and commits atomically. On failure the staging area is rolled back
   * and the source folder remains untouched.
   */
  private async relocateFolderUnit(
    noteId: string,
    mainFilePath: string,
    folderPath: string,
    mode: 'archive' | 'delete',
    reason?: string,
  ): Promise<string> {
    const subDirName = mode === 'archive' ? '_archive' : '_deleted';
    const eventName = mode === 'archive' ? 'file:archived' : 'file:deleted';

    // The folder lives at <type-folder>/<folder-name>/; the subfolder
    // (_archive/ or _deleted/) is created as a sibling of <folder-name>
    // inside <type-folder>, and the entire folder is relocated under it.
    const folderName = path.basename(folderPath);
    const typeFolder = path.dirname(folderPath);
    const targetSubDir = path.join(typeFolder, subDirName);
    const targetFolderPath = path.join(targetSubDir, folderName);

    // Refuse if a folder of the same name already exists in the target
    // location. This mirrors the StagingArea rename semantics
    // (`overwrite: false`) and gives a clear error before staging starts.
    if (await fs.pathExists(targetFolderPath)) {
      const verb = mode === 'archive' ? 'archive' : 'delete';
      throw new Error(
        `Cannot ${verb} folder-form note ${noteId}: target path already exists at ${targetFolderPath}`,
      );
    }

    // Read main file content and update its frontmatter. The main file
    // will be staged as a `write` op (new content) at the new location;
    // companion files are staged as `rename` ops (no content change).
    const mainContent = await fs.readFile(mainFilePath, 'utf-8');
    const updatedMainContent = this.applyRelocationFrontmatter(mainContent, mode, reason);

    const mainFilename = path.basename(mainFilePath);
    const newMainFilePath = path.join(targetFolderPath, mainFilename);

    // Enumerate companion files (relative paths under folderPath).
    const companions = await scanFolderContents(folderPath);

    const operations: StagedOperation[] = [];

    // Write the main file's updated content directly at the new location.
    // The original main file is left behind inside the source folder and
    // will be cleaned up by the final `remove-folder` op below.
    operations.push({
      kind: 'write',
      targetPath: newMainFilePath,
      content: updatedMainContent,
    });

    // Rename each companion file from its original location to the
    // mirrored path inside the relocated folder.
    for (const rel of companions) {
      operations.push({
        kind: 'rename',
        from: path.join(folderPath, rel),
        to: path.join(targetFolderPath, rel),
      });
    }

    // After all per-file operations the source folder contains only the
    // original main file (companions were renamed out; the new main
    // content was written to a different path). Recursively remove the
    // source folder to complete the relocation.
    operations.push({
      kind: 'remove-folder',
      targetPath: folderPath,
    });

    const staging = new StagingArea(this.projectPath);
    try {
      await staging.prepare(operations);
      await staging.commit();
    } catch (err) {
      // Best-effort rollback. The staging area handles its own cleanup;
      // target files are not touched until commit, so the source folder
      // remains intact on prepare-time failure. A commit-time partial
      // failure leaves the staging directory in place for inspection
      // (per DD020.§3.DC.02), and we propagate the error.
      try {
        await staging.rollback();
      } catch {
        // rollback errors after a partial commit are deliberately
        // swallowed; the staging directory survives for operator
        // inspection.
      }
      throw err;
    }

    // Update indexes: the main file moved to its new path. Companion
    // files are not tracked in noteIndex/fileToNoteId so no per-companion
    // index update is needed.
    this.noteIndex.set(noteId, newMainFilePath);
    this.fileToNoteId.delete(mainFilePath);
    this.fileToNoteId.set(newMainFilePath, noteId);

    if (mode === 'archive') {
      this.emit(eventName, {
        noteId,
        oldPath: mainFilePath,
        newPath: newMainFilePath,
        reason,
      });
    } else {
      this.emit(eventName, {
        noteId,
        oldPath: mainFilePath,
        newPath: newMainFilePath,
        reason,
        requiresReferenceUpdate: true,
      });
    }

    return newMainFilePath;
  }

  /**
   * Apply the frontmatter updates corresponding to an archive or
   * soft-delete relocation. Shared between the single-file and
   * folder-form paths so that the metadata semantics are identical.
   */
  private applyRelocationFrontmatter(
    content: string,
    mode: 'archive' | 'delete',
    reason?: string,
  ): string {
    const parsed = matter(content);
    const currentStatus = parsed.data.status || 'active';
    const now = new Date();

    if (mode === 'archive') {
      const updates: Record<string, any> = {
        status: 'archived',
        archived_at: this.formatTimestamp(now),
        archive_prior_status: currentStatus,
      };
      if (reason) {
        updates.archive_reason = reason;
      }
      return this.updateFrontmatter(content, updates);
    }

    const updates: Record<string, any> = {
      status: 'deleted',
      deleted_at: this.formatTimestamp(now),
      delete_prior_status: currentStatus,
    };
    if (reason) {
      updates.delete_reason = reason;
    }
    return this.updateFrontmatter(content, updates);
  }

  /**
   * Restore a note from archive or deleted status
   */
  async restoreNoteFile(noteId: string): Promise<string> {
    const filePath = await this.findNoteFile(noteId, { includeArchived: true, includeDeleted: true });
    if (!filePath) {
      throw new Error(`Note file not found: ${noteId}`);
    }

    // Check if file is archived or deleted
    const isArchived = filePath.includes('/_archive/');
    const isDeleted = filePath.includes('/_deleted/');
    
    if (!isArchived && !isDeleted) {
      throw new Error(`Note is not archived or deleted: ${noteId}`);
    }

    // Read current content
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Parse frontmatter to get prior status
    const parsed = matter(content);
    const priorStatus = isArchived 
      ? parsed.data.archive_prior_status || 'active'
      : parsed.data.delete_prior_status || 'active';

    // Remove archive/delete metadata and restore status
    const fieldsToRemove = isArchived 
      ? ['archived_at', 'archive_reason', 'archive_prior_status']
      : ['deleted_at', 'delete_reason', 'delete_prior_status'];
    
    const updatedContent = this.updateFrontmatter(content, {
      status: priorStatus
    }, fieldsToRemove);

    // Create restore path
    const dir = path.dirname(filePath);
    const parentDir = path.dirname(dir); // Go up from _archive or _deleted
    const filename = path.basename(filePath);
    const restorePath = path.join(parentDir, filename);

    // Check if restore path already exists
    if (await fs.pathExists(restorePath)) {
      throw new Error(`Cannot restore - file already exists at: ${restorePath}`);
    }

    // Write restored content
    await fs.writeFile(restorePath, updatedContent);

    // Remove archived/deleted file
    await fs.unlink(filePath);

    // Update indexes
    this.noteIndex.set(noteId, restorePath);
    this.fileToNoteId.delete(filePath);
    this.fileToNoteId.set(restorePath, noteId);

    // Emit event
    this.emit('file:restored', {
      noteId,
      oldPath: filePath,
      newPath: restorePath,
      wasDeleted: isDeleted
    });

    return restorePath;
  }

  /**
   * Permanently delete a note file
   */
  async purgeNoteFile(noteId: string): Promise<void> {
    const filePath = await this.findNoteFile(noteId, { includeArchived: true, includeDeleted: true });
    if (!filePath) {
      throw new Error(`Note file not found: ${noteId}`);
    }

    // Only allow purging from _deleted folder
    if (!filePath.includes('/_deleted/')) {
      throw new Error(`Can only purge deleted notes: ${noteId}`);
    }

    // Remove the file
    await fs.unlink(filePath);

    // Update indexes
    this.noteIndex.delete(noteId);
    this.fileToNoteId.delete(filePath);

    // Emit event
    this.emit('file:purged', {
      noteId,
      filePath
    });
  }

  /**
   * Remove a file by its absolute path and clean up indexes.
   * Used when a note file needs to be removed after being relocated
   * (e.g., changeNoteType creates a new file then removes the old one).
   */
  async removeFile(filePath: string): Promise<void> {
    await fs.unlink(filePath);
    const noteId = this.fileToNoteId.get(filePath);
    if (noteId) {
      this.noteIndex.delete(noteId);
      this.fileToNoteId.delete(filePath);
    }
  }

  /**
   * Resolve a note's filesystem layout — file vs folder, main file path
   * and (for folder-form) folder path. This is the read-side surface
   * the lifecycle command paths use to plan filesystem mutations
   * without touching disk.
   *
   * Returns `null` when the note is not in the index.
   *
   * @implements {DD020.§2.DC.16} filesystem-path scanner resolves note's filesystem entry via NoteFileManager.noteIndex
   * @implements {DD020.§2.DC.17} resolution surface for folder-vs-file disposition under hard-delete
   */
  resolveNoteLayout(noteId: string): { kind: 'file'; filePath: string } | { kind: 'folder'; folderPath: string; mainFilePath: string } | null {
    const filePath = this.noteIndex.get(noteId);
    if (!filePath) {
      return null;
    }
    const containingDir = path.dirname(filePath);
    const containingDirName = path.basename(containingDir);
    const dirIdMatch = containingDirName.match(/^([A-Z]+\d+)/);
    if (dirIdMatch && dirIdMatch[1] === noteId) {
      return { kind: 'folder', folderPath: containingDir, mainFilePath: filePath };
    }
    return { kind: 'file', filePath };
  }

  /**
   * Hard-unlink a note from disk. The file (for file-based notes) or
   * the entire folder including all companion files (for folder-based
   * notes per {R008}) is removed outright. Hard-delete does NOT
   * relocate to `_deleted/`; that location is reserved for soft-delete.
   *
   * Uses the staging-area primitive so the removal commits atomically
   * with any sibling staged operations the caller has queued.
   *
   * Index entries for the noteId are cleared on commit; the caller is
   * responsible for invoking the rewriter and the index refresh that
   * surround this primitive.
   *
   * @implements {DD020.§3.DC.15} hard-delete removes the note unit outright; folder-form removes companions; bypasses `_deleted/`
   * @implements {DD020.§3.DC.13} folder-unit-aware operation consumed by hard-delete code path
   * @implements {R015.§3.AC.15} hard-delete file disposition
   */
  async removeNoteEntry(noteId: string): Promise<void> {
    const layout = this.resolveNoteLayout(noteId);
    if (!layout) {
      throw new Error(`Note file not found: ${noteId}`);
    }

    const operations: StagedOperation[] = [];
    if (layout.kind === 'file') {
      operations.push({ kind: 'remove', targetPath: layout.filePath });
    } else {
      operations.push({ kind: 'remove-folder', targetPath: layout.folderPath });
    }

    const staging = new StagingArea(this.projectPath);
    try {
      await staging.prepare(operations);
      await staging.commit();
    } catch (err) {
      try {
        await staging.rollback();
      } catch {
        // Swallow rollback errors — staging directory remains for inspection.
      }
      throw err;
    }

    // Index cleanup.
    const mainFilePath = layout.kind === 'file' ? layout.filePath : layout.mainFilePath;
    this.noteIndex.delete(noteId);
    this.fileToNoteId.delete(mainFilePath);

    this.emit('file:removed', {
      noteId,
      kind: layout.kind,
      path: layout.kind === 'file' ? layout.filePath : layout.folderPath,
    });
  }

  /**
   * Rename a note's filesystem entry from `sourceId` to `targetId`.
   *
   * For file-based notes the file is renamed in place (preserving the
   * title portion of the basename). For folder-based notes the folder
   * is renamed AND the inner main file is renamed; companion files
   * move with the folder as a unit per {R008}.
   *
   * Uses the staging-area primitive so the rename commits atomically
   * with any sibling staged operations the caller has queued (e.g.,
   * frontmatter rewrites of the renamed note's `id` field).
   *
   * Returns the new main file path. The caller is responsible for
   * invoking the rewriter and the index refresh that surround this
   * primitive; this method only owns the filesystem rename.
   *
   * @implements {DD020.§3.DC.13} folder-unit-aware operation consumed by rename code path
   * @implements {DD020.§4.DC.06} renames file for file-based notes; folder + inner main for folder-based notes; companions move with folder
   */
  async renameNoteEntry(sourceId: string, targetId: string): Promise<string> {
    const layout = this.resolveNoteLayout(sourceId);
    if (!layout) {
      throw new Error(`Note file not found: ${sourceId}`);
    }

    const operations: StagedOperation[] = [];
    let newMainFilePath: string;

    if (layout.kind === 'file') {
      const newPath = this.renameIdInPath(layout.filePath, sourceId, targetId);
      if (newPath === layout.filePath) {
        throw new Error(
          `Cannot rename ${sourceId}: filesystem entry does not start with the source ID at ${layout.filePath}`,
        );
      }
      operations.push({ kind: 'rename', from: layout.filePath, to: newPath });
      newMainFilePath = newPath;
    } else {
      const newFolderPath = this.renameIdInPath(layout.folderPath, sourceId, targetId);
      if (newFolderPath === layout.folderPath) {
        throw new Error(
          `Cannot rename ${sourceId}: folder name does not start with the source ID at ${layout.folderPath}`,
        );
      }
      const oldMainBasename = path.basename(layout.mainFilePath);
      const newMainBasename = this.renameIdInBasename(oldMainBasename, sourceId, targetId);
      newMainFilePath = path.join(newFolderPath, newMainBasename);

      // Stage folder rename first, then inner main-file rename. The
      // staging-area commit applies them sequentially.
      operations.push({ kind: 'rename', from: layout.folderPath, to: newFolderPath });
      if (oldMainBasename !== newMainBasename) {
        operations.push({
          kind: 'rename',
          from: path.join(newFolderPath, oldMainBasename),
          to: newMainFilePath,
        });
      }
    }

    const staging = new StagingArea(this.projectPath);
    try {
      await staging.prepare(operations);
      await staging.commit();
    } catch (err) {
      try {
        await staging.rollback();
      } catch {
        // Swallow rollback errors — staging directory remains for inspection.
      }
      throw err;
    }

    // Index update. We swap the cache from source to target.
    const oldMainPath = layout.kind === 'file' ? layout.filePath : layout.mainFilePath;
    this.noteIndex.delete(sourceId);
    this.fileToNoteId.delete(oldMainPath);
    this.noteIndex.set(targetId, newMainFilePath);
    this.fileToNoteId.set(newMainFilePath, targetId);

    this.emit('file:renamed', {
      sourceId,
      targetId,
      oldPath: oldMainPath,
      newPath: newMainFilePath,
    });

    return newMainFilePath;
  }

  /**
   * Helper: rename the leading <sourceId> in a path's basename to
   * <targetId>, preserving the directory and trailing parts. Returns
   * the input unchanged if the basename does not start with sourceId
   * followed by a non-alphanumeric boundary.
   */
  private renameIdInPath(filePath: string, sourceId: string, targetId: string): string {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const newBase = this.renameIdInBasename(base, sourceId, targetId);
    if (newBase === base) {
      return filePath;
    }
    if (dir === '.' || dir === '') {
      return newBase;
    }
    return path.join(dir, newBase);
  }

  /**
   * Helper: replace a leading <sourceId> with <targetId> in a basename,
   * respecting word-boundary rules so longer ID-shaped substrings are
   * not modified.
   */
  private renameIdInBasename(basename: string, sourceId: string, targetId: string): string {
    if (!basename.startsWith(sourceId)) {
      return basename;
    }
    if (basename.length > sourceId.length) {
      const boundary = basename[sourceId.length];
      if (/[A-Za-z0-9]/.test(boundary)) {
        return basename;
      }
    }
    return targetId + basename.slice(sourceId.length);
  }

  /**
   * Read file contents by absolute path.
   * Used by watcher event handlers that receive file paths directly.
   */
  async readFileByPath(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Write file contents at an absolute path. Routes through this
   * manager so callers (e.g. NoteManager's auto-insert hook) don't
   * need a direct fs-extra import; the storage protocol boundary
   * keeps NoteManager fs-import-free.
   *
   * @see {DD010.§DC.25} NoteManager fs-import-free invariant
   */
  async writeFileByPath(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Update frontmatter fields in content
   */
  private updateFrontmatter(content: string, updates: Record<string, any>, removeFields?: string[]): string {
    const parsed = matter(content);
    
    // Apply updates
    for (const [key, value] of Object.entries(updates)) {
      parsed.data[key] = value;
    }

    // Remove specified fields
    if (removeFields) {
      for (const field of removeFields) {
        delete parsed.data[field];
      }
    }

    // Rebuild content with updated frontmatter
    return stringifyFrontmatter(parsed.content, parsed.data);
  }

  /**
   * Start watching for file changes
   * Notes Anywhere: watches all discovery paths recursively
   */
  async startWatching(): Promise<void> {
    // Ensure index is built (idempotent — skips work if already populated)
    await this.buildIndex();

    // Emit events for all found files
    for (const [noteId, filePath] of this.noteIndex) {
      this.emit('file:created', { noteId, filePath });
    }

    // Watch all discovery paths
    const watchRoots = this.getDiscoveryRoots();
    for (const root of watchRoots) {
      await fs.ensureDir(root);
    }

    const config = this.configManager.getConfig();
    const userExcludes = config.discoveryExclude || [];
    const defaultExcludes = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.turbo', '.cache'];
    const allExcludes = [...defaultExcludes, ...userExcludes];

    this.watcher = chokidar.watch(watchRoots, {
      persistent: true,
      ignoreInitial: true,
      ignored: [
        /(^|[/\\])\../, // dotfiles
        /_templates/,
        /_prompts/,
        ...allExcludes.map((ex) => new RegExp(`(^|[/\\\\])${ex}([/\\\\]|$)`)),
      ],
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    // Track pending unlinks for rename detection
    const pendingUnlinks = new Map<string, NodeJS.Timeout>();

    // Handle file removals
    this.watcher.on('unlink', async (filePath) => {
      const noteId = this.fileToNoteId.get(filePath);
      if (noteId) {
        // Wait a bit to see if this is part of a rename
        const timeout = setTimeout(() => {
          pendingUnlinks.delete(filePath);
          this.handleFileRemove(filePath);
        }, 100);
        pendingUnlinks.set(filePath, timeout);
      }
    });

    // Handle file additions/changes
    this.watcher.on('add', async (filePath) => {
      const filename = path.basename(filePath);
      const noteId = this.extractNoteIdFromFilename(filename);

      if (noteId) {
        // Check if this is part of a rename
        const oldPath = this.noteIndex.get(noteId);
        if (oldPath && pendingUnlinks.has(oldPath)) {
          // Cancel the deletion - this is a rename
          clearTimeout(pendingUnlinks.get(oldPath)!);
          pendingUnlinks.delete(oldPath);
        }
      }

      await this.handleFileAdd(filePath);
    });

    this.watcher.on('change', async (filePath) => {
      // File content changed
      const noteId = this.fileToNoteId.get(filePath);
      if (noteId) {
        this.emit('file:modified', {
          noteId,
          filePath,
        });
      }
    });

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', () => resolve());
    });
  }

  /**
   * Stop watching for file changes
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      // Race chokidar close against a short timeout. On some macOS versions
      // (observed on Sonoma 14.1), fs_events teardown takes 1-4s per watched
      // path, which hangs CLI exit. Drop the reference and let the process
      // clean up native handles on exit if close doesn't return in time.
      const closed = this.watcher.close().catch(() => {});
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 250));
      await Promise.race([closed, timeout]);
      this.watcher = undefined;
    }
  }

  /**
   * Get the resolved discovery root directories.
   */
  private getDiscoveryRoots(): string[] {
    const config = this.configManager.getConfig();
    const discoveryPaths = config.discoveryPaths || ['_scepter'];
    return discoveryPaths.map((dp) => path.resolve(this.projectPath, dp));
  }

  /**
   * Check if a path is in an excluded directory.
   */
  private isExcludedDir(parts: string[]): boolean {
    const config = this.configManager.getConfig();
    const userExcludes = config.discoveryExclude || [];
    const defaultExcludes = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.turbo', '.cache'];
    const allExcludes = new Set([...defaultExcludes, ...userExcludes, '_templates', '_prompts']);
    return parts.some((p) => allExcludes.has(p));
  }

  /**
   * Build the noteId→filePath index from disk.
   *
   * This is the single choke-point for populating the in-memory index that
   * getFileContents(), getFilePath(), and all mutation methods rely on.
   * Must be called during ProjectManager.initialize() so the index is
   * available regardless of whether file watchers are started.
   *
   * Notes Anywhere: scans all configured discoveryPaths.
   */
  async buildIndex(): Promise<void> {
    const roots = this.getDiscoveryRoots();

    for (const root of roots) {
      if (!await fs.pathExists(root)) continue;

      // Scan for .md files recursively
      const mdPattern = path.join(root, '**', '*.md');
      const mdFiles = await glob(mdPattern, { dot: false });

      for (const filePath of mdFiles) {
        const relToRoot = path.relative(root, filePath);
        const parts = relToRoot.split(path.sep);
        if (this.isExcludedDir(parts)) continue;

        const filename = path.basename(filePath);
        const noteId = this.extractNoteIdFromFilename(filename);
        if (noteId && !this.noteIndex.has(noteId)) {
          this.noteIndex.set(noteId, filePath);
          this.fileToNoteId.set(filePath, noteId);
        }
      }

      // Scan for folder-based note directories matching ID pattern
      const dirPattern = path.join(root, '**');
      const allPaths = await glob(dirPattern, { dot: false });

      for (const p of allPaths) {
        const relToRoot = path.relative(root, p);
        const parts = relToRoot.split(path.sep);
        if (this.isExcludedDir(parts)) continue;

        const basename = path.basename(p);
        const noteId = this.extractNoteIdFromFilename(basename);
        if (!noteId) continue;

        // Only check directories we haven't already indexed via the .md scan
        if (this.noteIndex.has(noteId)) continue;

        try {
          const stats = await stat(p);
          if (stats.isDirectory()) {
            const detection = await detectFolderNote(p);
            if (detection.isFolder && detection.mainFile) {
              this.noteIndex.set(noteId, detection.mainFile);
              this.fileToNoteId.set(detection.mainFile, noteId);
            }
          }
        } catch {
          // Skip inaccessible paths
        }
      }
    }
  }

  /**
   * Extract note ID from filename
   */
  private extractNoteIdFromFilename(filename: string): string | null {
    // Match patterns like "D001 something.md" or "REQ001.md"
    const match = filename.match(/^([A-Z]+\d+)(?:\s|\.md)/);
    return match ? match[1] : null;
  }

  /**
   * Handle file addition
   * Notes Anywhere: no "expected folder" check — notes can live anywhere under _scepter/
   */
  private async handleFileAdd(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const noteId = this.extractNoteIdFromFilename(filename);

    if (!noteId) return;

    // Check if this note already exists elsewhere
    const oldPath = this.noteIndex.get(noteId);

    if (oldPath && oldPath !== filePath) {
      // This is a rename/move
      this.noteIndex.set(noteId, filePath);
      this.fileToNoteId.delete(oldPath);
      this.fileToNoteId.set(filePath, noteId);

      this.emit('file:moved', {
        noteId,
        oldPath,
        newPath: filePath,
      });
    } else if (!oldPath) {
      // New file created manually
      this.noteIndex.set(noteId, filePath);
      this.fileToNoteId.set(filePath, noteId);
    }
  }

  /**
   * Handle file removal
   */
  private async handleFileRemove(filePath: string): Promise<void> {
    const noteId = this.fileToNoteId.get(filePath);

    if (noteId) {
      // Check if this is the current path for the note
      const currentPath = this.noteIndex.get(noteId);

      if (currentPath === filePath) {
        // File was deleted (not moved)
        this.noteIndex.delete(noteId);
        this.fileToNoteId.delete(filePath);

        this.emit('file:deleted', {
          noteId,
          filePath,
        });
      }
    }
  }

  /**
   * Find type config by type name
   */
  private async findTypeConfig(type: string): Promise<NoteTypeConfig | null> {
    const config = this.configManager.getConfig();
    
    return config.noteTypes[type] || null;
  }

  /**
   * Find type config by note ID prefix
   * Sorts by shortcode length descending to ensure longer/more specific prefixes match first
   * (e.g., "CAP" matches before "C" for note ID "CAP001")
   */
  private async findTypeConfigByNoteId(noteId: string): Promise<NoteTypeConfig | null> {
    const config = this.configManager.getConfig();
    // Sort by shortcode length descending so longer prefixes match first
    const sortedTypes = Object.entries(config.noteTypes).sort(
      ([, a], [, b]) => b.shortcode.length - a.shortcode.length,
    );
    for (const [, typeConfig] of sortedTypes) {
      if (noteId.startsWith(typeConfig.shortcode)) {
        return typeConfig;
      }
    }
    return null;
  }

}
