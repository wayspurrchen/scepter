/**
 * @implements {T003} - Support for isFolder parameter in note creation
 * @implements {T011} Phase 4 - Status validation in NoteManager
 */
import { EventEmitter } from 'events';
import * as path from 'path';
import type { Note, NoteQuery, NoteQueryResult } from '../types/note';
import type { ContextHints } from '../types/context';
import type { Reference } from '../types/reference';
import type { ConfigManager } from '../config/config-manager';
import type { NoteFileManager } from './note-file-manager';
import type { NoteTypeResolver } from './note-type-resolver';
import type { NoteTypeTemplateManager } from '../templates/note-type-template-manager';
import type { ReferenceManager } from '../references/reference-manager';
import { StatusValidator } from '../statuses/status-validator';
import { parseNoteMentions } from '../parsers/note/note-parser';
import { UnifiedDiscovery } from '../discovery/unified-discovery';

// Type definitions for the API
export interface CreateNoteParams {
  type: string;
  id?: string;
  title?: string;
  content?: string;
  tags?: string[];
  contextHints?: ContextHints;
  mode?: string; // For task creation
  isFolder?: boolean; // For creating folder-based notes
  status?: string; // @implements {T009} - Note status for frontmatter
}

export interface QueryOptions {
  sortBy?: 'id' | 'created' | 'type';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface NoteStatistics {
  totalNotes: number;
  notesByType: Record<string, number>;
  notesByTag: Record<string, number>;
  recentNotes: Note[];
  archivedNotes?: number;
  deletedNotes?: number;
}

/**
 * NoteManager - Primary interface for all note-related operations in SCEpter
 *
 * Provides a high-level API for creating, querying, and managing notes while maintaining
 * an in-memory index for fast lookups. The NoteManager operates at the logical note level,
 * delegating physical file operations to NoteFileManager and template generation to
 * NoteTypeTemplateManager.
 *
 * ## Responsibilities
 *
 * **What NoteManager DOES handle:**
 * - Note CRUD operations (Create, Read, Update, Delete)
 * - ID generation and validation
 * - In-memory indexing for fast queries
 * - Note querying by various criteria (ID, type, tag, content, date)
 * - File path resolution and tracking
 * - Change detection via filesystem watching
 * - Event emission for note lifecycle events
 * - Note metadata extraction and management
 *
 * **What NoteManager DOES NOT handle:**
 * - Physical file I/O (delegated to NoteFileManager)
 * - Template content generation (delegated to NoteTypeTemplateManager)
 * - Note parsing from markdown (uses note-parser)
 * - Note type configuration (uses ConfigManager)
 * - Context gathering for tasks (handled by ContextGatherer)
 * - Work mode management (handled by WorkModeManager)
 *
 * ## Architecture
 *
 * The NoteManager maintains several indexes for efficient querying:
 * - noteIndex: Maps note IDs to Note objects
 * - typeIndex: Maps note types to sets of note IDs
 * - tagIndex: Maps tags to sets of note IDs
 * - fileIndex: Maps note IDs to file paths
 * - idCounters: Tracks the highest ID number for each shortcode
 *
 * ## Event Interface
 *
 * NoteManager extends EventEmitter and emits the following events:
 * - 'note:created': When a new note is created
 * - 'note:modified': When a note's content is modified
 * - 'note:deleted': When a note is deleted
 * - 'note:renamed': When a note file is renamed
 * - 'note:moved': When a note is moved to a different folder
 * - 'index:rebuilt': When the entire index is rebuilt
 * - 'error': When an error occurs during operations
 */
export class NoteManager extends EventEmitter {
  // Internal state
  private noteIndex: Map<string, Note> = new Map(); // noteId -> Note
  private typeIndex: Map<string, Set<string>> = new Map(); // noteType -> Set<noteId>
  private tagIndex: Map<string, Set<string>> = new Map(); // tag -> Set<noteId>
  private fileIndex: Map<string, string> = new Map(); // noteId -> filepath
  private idCounters: Map<string, number> = new Map(); // shortcode -> highest number
  private isInitialized: boolean = false;
  private unifiedDiscovery: UnifiedDiscovery;
  /**
   * @implements {T011} Status validator for note status enforcement/suggestion
   * Created lazily when first needed to ensure config is loaded
   */
  private statusValidator?: StatusValidator;

  constructor(
    private projectPath: string,
    private configManager: ConfigManager,
    private noteFileManager: NoteFileManager,
    private noteTypeResolver: NoteTypeResolver,
    private noteTypeTemplateManager: NoteTypeTemplateManager,
    private referenceManager?: ReferenceManager,
  ) {
    super();
    this.unifiedDiscovery = new UnifiedDiscovery(projectPath, configManager);
  }

  /**
   * Get or create the StatusValidator instance
   * @implements {T011} Lazy initialization ensures config is loaded
   */
  private getStatusValidator(): StatusValidator | undefined {
    if (!this.statusValidator) {
      try {
        const config = this.configManager.getConfig();
        this.statusValidator = new StatusValidator(config);
      } catch {
        // Config not loaded yet, return undefined
        return undefined;
      }
    }
    return this.statusValidator;
  }

  // Lifecycle Methods

  /**
   * Initializes the NoteManager by building the initial index from filesystem.
   * Scans all configured note type folders and parses existing notes into memory.
   * This method is idempotent - calling it multiple times has no additional effect.
   *
   * @emits index:rebuilt When initialization completes
   */
  async initialize(options?: { includeArchived?: boolean; includeDeleted?: boolean }): Promise<void> {
    if (this.isInitialized) return;

    // Clear all indexes
    this.noteIndex.clear();
    this.typeIndex.clear();
    this.tagIndex.clear();
    this.fileIndex.clear();
    this.idCounters.clear();

    // Skip manual scanning - UnifiedDiscovery handles all note discovery below
    /*
    // Scan all note type folders
    for (const [typeName, typeConfig] of Object.entries(config.noteTypes)) {
      const folderPath = path.join(this.projectPath, '_scepter/notes', typeConfig.folder);

      try {
        if (await fs.pathExists(folderPath)) {
          const files = await fs.readdir(folderPath);

          for (const file of files) {
            if (file.endsWith('.md')) {
              // Parse file to extract notes
              const filePath = path.join(folderPath, file);
              const content = await fs.readFile(filePath, 'utf-8');

              // Try to parse as new format first
              const note = await this.parseNoteFromFile(filePath, content, typeName);
              if (note) {
                this.addNoteToIndexes(note, filePath);

                // Extract references from the note content
                const mentions = parseNoteMentions(note.content);
                this.extractAndStoreReferences(note, mentions);
              } else {
                // Fall back to old format parsing
                const mentions = parseNoteMentions(content, { filePath });

                // Group mentions by ID to handle multiple extensions
                const mentionsByIdMap = new Map<string, typeof mentions>();
                for (const mention of mentions) {
                  // Only process mentions with extensions (i.e., note definitions/extensions)
                  if (mention.contentExtension !== undefined) {
                    const existing = mentionsByIdMap.get(mention.id) || [];
                    existing.push(mention);
                    mentionsByIdMap.set(mention.id, existing);
                  }
                }

                // Add each note to indexes
                for (const [id, mentionsForId] of mentionsByIdMap) {
                  const note = this.createNoteFromMentions(mentionsForId, typeName);
                  this.addNoteToIndexes(note, filePath);

                  // Extract references from the note content
                  this.extractAndStoreReferences(note, mentions);
                }
              }
            }
          }
        }
      } catch (error) {
        // Skip folders that don't exist or can't be read
        console.warn(`Could not read folder ${folderPath}:`, error);
      }
    }
    */

    // Initialize UnifiedDiscovery (loads config and sets up sources)
    await this.unifiedDiscovery.initialize();

    // Discover all notes using UnifiedDiscovery
    try {
      const discoveredNotes = await this.unifiedDiscovery.discoverAll();

      // Add all discovered notes to indexes
      for (const note of discoveredNotes) {
        // Add to indexes
        this.noteIndex.set(note.id, note);

        // Update type index
        if (!this.typeIndex.has(note.type)) {
          this.typeIndex.set(note.type, new Set());
        }
        this.typeIndex.get(note.type)!.add(note.id);

        // Update tag index
        for (const tag of note.tags) {
          if (!this.tagIndex.has(tag)) {
            this.tagIndex.set(tag, new Set());
          }
          this.tagIndex.get(tag)!.add(note.id);
        }

        // Update file index if available
        if (note.filePath) {
          this.fileIndex.set(note.id, note.filePath);
        }

        // Extract references from content
        const mentions = parseNoteMentions(note.content);
        this.extractAndStoreReferences(note, mentions);
      }
    } catch (error) {
      console.warn('Could not discover tasks:', error);
    }

    // Update ID counters based on existing notes
    this.updateIdCounters();

    this.isInitialized = true;
    this.emit('index:rebuilt');
  }

  /**
   * Starts listening to NoteFileManager events for file changes.
   * Enables real-time synchronization between filesystem changes and the in-memory index.
   *
   * File events handled:
   * - file:created - New note files created externally
   * - file:modified - Note content changes
   * - file:deleted - Note files removed
   * - file:renamed - Note files renamed
   * - file:moved - Note files moved between folders
   */
  async startWatching(): Promise<void> {
    // Ensure index is built before starting to watch
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Subscribe to NoteFileManager events
    this.noteFileManager.on('file:created', this.handleFileCreated.bind(this));
    this.noteFileManager.on('file:modified', this.handleFileModified.bind(this));
    this.noteFileManager.on('file:deleted', this.handleFileDeleted.bind(this));
    this.noteFileManager.on('file:renamed', this.handleFileRenamed.bind(this));
    this.noteFileManager.on('file:moved', this.handleFileMoved.bind(this));

    // Start watching in NoteFileManager
    await this.noteFileManager.startWatching();
  }

  /**
   * Stops listening to file changes.
   * Removes all event listeners and stops the underlying file watcher.
   */
  async stopWatching(): Promise<void> {
    // Unsubscribe from NoteFileManager events
    this.noteFileManager.removeAllListeners('file:created');
    this.noteFileManager.removeAllListeners('file:modified');
    this.noteFileManager.removeAllListeners('file:deleted');
    this.noteFileManager.removeAllListeners('file:renamed');
    this.noteFileManager.removeAllListeners('file:moved');

    // Stop watching in NoteFileManager
    await this.noteFileManager.stopWatching();
  }

  /**
   * Rescans all notes from the filesystem and rebuilds the index.
   * This is useful when notes have been modified externally or when
   * integrating with new discovery sources.
   *
   * @emits index:rebuilt When rescan completes
   */
  async rescan(): Promise<void> {
    // Reset initialization flag to force rebuild
    this.isInitialized = false;

    // Stop watching if active
    if (this.unifiedDiscovery) {
      await this.unifiedDiscovery.stopWatching();
    }

    // Re-initialize to rebuild indexes
    await this.initialize();
  }

  // ID Generation Methods

  /**
   * Generates a new unique ID for the given note type.
   * IDs follow the format: [SHORTCODE][NUMBER] (e.g., D001, REQ001)
   * Numbers are zero-padded to 3 digits for single-char shortcodes, 5 for multi-char.
   *
   * @param noteType The type name (e.g., 'Decision', 'Requirement')
   * @returns The generated ID (e.g., 'D001')
   * @throws Error if note type is unknown or ID generation fails
   */
  async generateNoteId(noteType: string): Promise<string> {
    let shortcode: string;

    // Resolve type identifier (handles case-insensitive names and shortcodes)
    const resolvedType = this.noteTypeResolver.resolveTypeIdentifier(noteType);
    if (!resolvedType) {
      throw new Error(`Unknown note type: ${noteType}`);
    }

    // Get type info
    const typeInfo = this.noteTypeResolver.getType(resolvedType);
    if (!typeInfo) {
      throw new Error(`Unknown note type: ${resolvedType}`);
    }

    shortcode = typeInfo.shortcode;

    // Get next number
    const nextNumber = await this.getNextIdNumber(shortcode);

    // Format ID
    const paddedNumber = String(nextNumber).padStart(3, '0');
    const noteId = `${shortcode}${paddedNumber}`;

    // Validate uniqueness
    if (this.noteIndex.has(noteId)) {
      throw new Error(`Generated ID ${noteId} already exists`);
    }

    return noteId;
  }

  /**
   * Gets the next available number for a given shortcode.
   * Maintains a cache of counters for performance.
   *
   * @param shortcode The note type shortcode
   * @returns The next available number
   */
  async getNextIdNumber(shortcode: string): Promise<number> {
    // Check cache first
    const cached = this.idCounters.get(shortcode);

    if (cached !== undefined) {
      const next = cached + 1;
      this.idCounters.set(shortcode, next);
      return next;
    }

    // Scan existing notes to find highest
    let highest = 0;
    for (const [noteId] of this.noteIndex) {
      if (noteId.startsWith(shortcode)) {
        const match = noteId.match(/^[A-Z]+(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          highest = Math.max(highest, num);
        }
      }
    }

    // Update cache and return
    const next = highest + 1;
    this.idCounters.set(shortcode, next);
    return next;
  }

  /**
   * Validates that a note ID follows the correct format.
   * Valid format: 1-5 uppercase letters followed by 3-5 digits.
   *
   * @param noteId The ID to validate
   * @returns true if valid, false otherwise
   */
  validateNoteId(noteId: string): boolean {
    // No state changes - pure validation
    const pattern = /^[A-Z]{1,5}\d{3,5}$/;
    return pattern.test(noteId);
  }

  // Note Creation Methods

  /**
   * Creates a new note with the specified parameters.
   *
   * Process:
   * 1. Validates input parameters
   * 2. Generates or validates the note ID
   * 3. Retrieves template content if not provided
   * 4. Creates the physical file via NoteFileManager
   * 5. Adds the note to all indexes
   * 6. Emits 'note:created' event
   *
   * @param params Note creation parameters
   * @returns The created Note object
   * @throws Error if type is unknown, ID is invalid, or file creation fails
   * @emits note:created With the created note
   */
  async createNote(params: CreateNoteParams): Promise<Note> {
    // Validate input
    if (!params.type) {
      throw new Error('Note type is required');
    }

    // Resolve type identifier (handles case-insensitive names and shortcodes)
    const resolvedType = this.noteTypeResolver.resolveTypeIdentifier(params.type);
    if (!resolvedType) {
      throw new Error(`Unknown note type: ${params.type}`);
    }

    // Generate or validate ID
    const id = params.id || (await this.generateNoteId(resolvedType));

    if (!this.validateNoteId(id)) {
      throw new Error(`Invalid note ID format: ${id}`);
    }

    if (params.id && this.noteIndex.has(id)) {
      throw new Error(`Note ${id} already exists`);
    }

    // @implements {T011.4.1} Status validation and default application
    let finalStatus = params.status;
    const statusValidator = this.getStatusValidator();
    if (statusValidator) {
      // Apply default status if none provided
      if (!finalStatus) {
        const defaultStatus = statusValidator.getDefaultStatus(resolvedType);
        if (defaultStatus) {
          finalStatus = defaultStatus;
        }
      }

      // Validate the status if one is set
      if (finalStatus) {
        const validationResult = statusValidator.validateStatus(finalStatus, resolvedType);

        if (!validationResult.valid) {
          // Enforce mode - throw error with allowed values
          const allowedList = validationResult.allowedValues?.join(', ') || '';
          throw new Error(
            `Invalid status '${finalStatus}' for type ${resolvedType}. Allowed: ${allowedList}`,
          );
        } else if (validationResult.message && validationResult.mode === 'suggest') {
          // Suggest mode - emit warning event but continue
          // Note: CLI will typically handle this, but NoteManager can also emit for programmatic use
          this.emit('warning', {
            type: 'status_suggestion',
            message: validationResult.message,
            noteType: resolvedType,
            status: finalStatus,
          });
        }
      }
    }

    // Get template content if not provided
    let content = params.content;
    if (!content) {
      const templateContent = await this.noteTypeTemplateManager.getTemplateContent(resolvedType);
      content = templateContent || ''; // Default to empty string if no template
    }

    // Extract title if not provided
    const title = params.title || this.extractTitleFromContent(content, resolvedType);

    // Create note object
    const note: Note = {
      id,
      type: resolvedType,
      title,
      content,
      tags: params.tags || [],
      created: new Date(),
      modified: new Date(), // Set modified same as created initially
      contextHints: params.contextHints,
      ...(params.isFolder && { isFolder: true }), // Requested as folder (may be overridden by type config)
      // @implements {T011.4.1} Use finalStatus which includes default application
      ...(finalStatus && { metadata: { status: finalStatus } }),
    };

    // Create physical file
    await this.noteFileManager.createNoteFile(note);
    const filepath = await this.noteFileManager.findNoteFile(id);
    if (!filepath) {
      // Enhanced error message with debugging information
      const debugInfo = `Note type: ${resolvedType}`;
      throw new Error(`Failed to find created note file for ${id}. ${debugInfo}`);
    }

    // Check if the actual file created is a folder-based note
    // (note-file-manager may have created a file if type doesn't support folders)
    // Folder-based notes have pattern: <folder>/<ID Title>/<ID>.md
    // Regular notes have pattern: <folder>/<ID Title>.md
    const parentDir = path.dirname(filepath);
    const parentDirName = path.basename(parentDir);
    const actuallyIsFolder = parentDirName.startsWith(id + ' ');

    // Update note object with actual folder status
    note.isFolder = actuallyIsFolder;
    if (actuallyIsFolder) {
      note.folderPath = parentDir;
    }

    // Add to indexes
    this.addNoteToIndexes(note, filepath);

    // Extract and store references from content
    const mentions = parseNoteMentions(note.content);
    this.extractAndStoreReferences(note, mentions);

    // Attach references to note object
    this.attachReferences(note);

    // Set the file path on the note object
    note.filePath = filepath;

    // Emit event
    this.emit('note:created', note);

    return note;
  }

  /**
   * Update an existing note's content and metadata
   * Automatically updates the modified date
   *
   * @param noteId - The ID of the note to update
   * @param updates - Partial note data to update
   * @returns The updated note
   * @throws Error if note doesn't exist
   * @emits note:modified With the updated note
   */
  async updateNote(
    noteId: string,
    updates: {
      content?: string;
      title?: string;
      tags?: string[];
      contextHints?: ContextHints;
    },
  ): Promise<Note> {
    // Get existing note
    const existingNote = await this.getNoteById(noteId);
    if (!existingNote) {
      throw new Error(`Note ${noteId} not found`);
    }

    // Apply updates
    const updatedNote: Note = {
      ...existingNote,
      ...updates,
      modified: new Date(),
    };

    // If content updated, re-extract references
    if (updates.content !== undefined) {
      const mentions = parseNoteMentions(updatedNote.content);
      this.extractAndStoreReferences(updatedNote, mentions);
    }

    // Update in indexes
    this.noteIndex.set(noteId, updatedNote);

    // Save to file
    await this.noteFileManager.updateNoteFile(updatedNote);

    // Attach references
    this.attachReferences(updatedNote);

    // Emit event
    this.emit('note:modified', updatedNote);

    return updatedNote;
  }

  // File Operation Methods

  /**
   * Finds the file path for a given note ID.
   * First checks the in-memory index, then searches the filesystem if needed.
   * Updates the index when a file is found on disk.
   *
   * @param noteId The note ID to search for
   * @returns The file path if found, null otherwise
   */
  async findNoteFile(noteId: string): Promise<string | null> {
    // Check index first — verify through NoteFileManager's index
    const cached = this.fileIndex.get(noteId);
    if (cached && this.noteFileManager.getFilePath(noteId)) {
      return cached;
    }

    // Search filesystem if not in index
    const filepath = await this.noteFileManager.findNoteFile(noteId);
    if (filepath) {
      // Update index for future lookups
      this.fileIndex.set(noteId, filepath);
    }

    return filepath;
  }

  /**
   * Checks if a note file exists without creating it.
   *
   * @param noteId The note ID to check
   * @returns true if the file exists, false otherwise
   */
  async ensureNoteFile(noteId: string): Promise<boolean> {
    const filepath = await this.findNoteFile(noteId);
    return filepath !== null;
  }

  /**
   * Archives a note and updates all references to it with #deleted tag
   *
   * @param noteId The note ID to archive
   * @param reason Optional reason for archiving
   * @returns The archived note
   * @emits note:archived
   */
  async archiveNote(noteId: string, reason?: string): Promise<Note> {
    // Get the note
    const note = await this.getNoteById(noteId);
    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    // Archive the file
    const archivePath = await this.noteFileManager.archiveNoteFile(noteId, reason);

    // Update references if ReferenceManager is available
    if (this.referenceManager) {
      const updateResult = await this.referenceManager.updateReferencesForDeletion(noteId);

      // If we had actual file operations, we would update the files here
      // For now, log what would be updated
      if (updateResult.totalUpdated > 0) {
        console.log(`Would update ${updateResult.totalUpdated} references to ${noteId} with #deleted tag`);
      }
    }

    // Update note status in index
    const archivedNote: Note = {
      ...note,
      tags: [...new Set([...note.tags, 'archived'])],
      modified: new Date(),
    };

    this.noteIndex.set(noteId, archivedNote);
    this.fileIndex.set(noteId, archivePath);

    // Update tag index for archived tag
    if (!this.tagIndex.has('archived')) {
      this.tagIndex.set('archived', new Set());
    }
    this.tagIndex.get('archived')!.add(noteId);

    this.emit('note:archived', { note: archivedNote, reason });

    return archivedNote;
  }

  /**
   * Deletes a note and updates all references to it with #deleted tag
   *
   * @param noteId The note ID to delete
   * @param reason Optional reason for deletion
   * @returns The deleted note
   * @emits note:deleted
   */
  async deleteNote(noteId: string, reason?: string): Promise<Note> {
    // Get the note
    const note = await this.getNoteById(noteId);
    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    // Delete the file
    const deletePath = await this.noteFileManager.deleteNoteFile(noteId, reason);

    // Update references if ReferenceManager is available
    if (this.referenceManager) {
      const updateResult = await this.referenceManager.updateReferencesForDeletion(noteId);

      // If we had actual file operations, we would update the files here
      // For now, log what would be updated
      if (updateResult.totalUpdated > 0) {
        console.log(`Would update ${updateResult.totalUpdated} references to ${noteId} with #deleted tag`);
      }
    }

    // Update note status in index
    const deletedNote: Note = {
      ...note,
      tags: [...new Set([...note.tags, 'deleted'])],
      modified: new Date(),
    };

    this.noteIndex.set(noteId, deletedNote);
    this.fileIndex.set(noteId, deletePath);

    // Update tag index for deleted tag
    if (!this.tagIndex.has('deleted')) {
      this.tagIndex.set('deleted', new Set());
    }
    this.tagIndex.get('deleted')!.add(noteId);

    // Note: We keep both incoming and outgoing references for deleted notes
    // so that purgeDeletedNote can check for incoming references before allowing purge
    // Only removeNote (called by purgeDeletedNote) will completely remove all references

    this.emit('note:deleted', { note: deletedNote, reason });

    return deletedNote;
  }

  /**
   * Restores a note from archived or deleted status and removes #deleted tag from references
   *
   * @param noteId The note ID to restore
   * @returns The restored note
   * @emits note:restored
   */
  async restoreNote(noteId: string): Promise<Note> {
    // Get the note (including archived/deleted)
    const note = await this.getNoteById(noteId);
    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    // Restore the file
    const restoredPath = await this.noteFileManager.restoreNoteFile(noteId);

    // Update references if ReferenceManager is available
    if (this.referenceManager) {
      const updateResult = await this.referenceManager.updateReferencesForRestore(noteId);

      // If we had actual file operations, we would update the files here
      // For now, log what would be updated
      if (updateResult.totalUpdated > 0) {
        console.log(`Would remove #deleted tag from ${updateResult.totalUpdated} references to ${noteId}`);
      }
    }

    // Update note status in index
    const restoredNote: Note = {
      ...note,
      tags: note.tags.filter((tag) => tag !== 'archived' && tag !== 'deleted'),
      modified: new Date(),
    };

    this.noteIndex.set(noteId, restoredNote);
    this.fileIndex.set(noteId, restoredPath);

    // Update tag indexes
    this.tagIndex.get('archived')?.delete(noteId);
    this.tagIndex.get('deleted')?.delete(noteId);

    // Re-extract references from the restored note
    const mentions = parseNoteMentions(restoredNote.content);
    this.extractAndStoreReferences(restoredNote, mentions);

    this.emit('note:restored', restoredNote);

    return restoredNote;
  }

  /**
   * Permanently delete a note from the _deleted folder
   * @param noteId The ID of the deleted note to purge
   * @throws Error if note not found, not deleted, or has incoming references
   */
  async purgeDeletedNote(noteId: string): Promise<void> {
    // Get the note (including deleted)
    const note = await this.getNoteById(noteId);
    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    // Verify note is deleted
    if (!note.tags.includes('deleted')) {
      throw new Error(`Note ${noteId} is not deleted. Only deleted notes can be purged.`);
    }

    // Check for incoming references
    if (this.referenceManager) {
      const incomingRefs = this.referenceManager.getReferencesTo(noteId);
      if (incomingRefs.length > 0) {
        throw new Error(`Cannot purge ${noteId}: has ${incomingRefs.length} incoming references`);
      }
    }

    // Purge the file
    await this.noteFileManager.purgeNoteFile(noteId);

    // Remove from reference manager
    if (this.referenceManager) {
      this.referenceManager.removeNote(noteId);
    }

    // Remove from all indexes
    this.noteIndex.delete(noteId);
    this.fileIndex.delete(noteId);

    // Remove from type index
    const typeSet = this.typeIndex.get(note.type);
    if (typeSet) {
      typeSet.delete(noteId);
    }

    // Remove from tag index
    for (const tag of note.tags) {
      const tagSet = this.tagIndex.get(tag);
      if (tagSet) {
        tagSet.delete(noteId);
      }
    }

    this.emit('note:purged', noteId);
  }

  /**
   * Moves a note to a different type folder and updates its ID.
   *
   * Process:
   * 1. Generates a new ID for the target type
   * 2. Creates a new file in the target folder
   * 3. Updates all indexes
   * 4. Deletes the old file
   * 5. Emits appropriate events
   *
   * @param noteId The current note ID
   * @param newType The target note type
   * @throws Error if note not found or move fails
   * @emits note:deleted For the old note
   * @emits note:created For the new note
   */
  async moveNoteToType(noteId: string, newType: string): Promise<void> {
    // Get existing note
    const note = this.noteIndex.get(noteId);
    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    // Get old file path
    const oldPath = this.fileIndex.get(noteId);
    if (!oldPath) {
      throw new Error(`File path not found for ${noteId}`);
    }

    // Generate new ID for new type
    const newId = await this.generateNoteId(newType);

    // Create updated note
    const updatedNote: Note = {
      ...note,
      id: newId,
      type: newType,
    };

    // Create new file
    await this.noteFileManager.createNoteFile(updatedNote);
    const newPath = await this.noteFileManager.findNoteFile(newId);
    if (!newPath) {
      throw new Error(`Failed to create new file for ${newId}`);
    }

    // Remove from old indexes
    this.removeNoteFromIndexes(noteId);

    // Add to new indexes
    this.addNoteToIndexes(updatedNote, newPath);

    // Delete old file via NoteFileManager
    await this.noteFileManager.removeFile(oldPath);

    // Emit events
    this.emit('note:deleted', { note: { id: noteId }, reason: 'moved to different type' });
    this.emit('note:created', updatedNote);
  }

  /**
   * Finds note files that exist on disk but aren't in the index.
   * Useful for detecting manually created files or index corruption.
   *
   * @returns Array of orphaned file paths
   */
  async detectOrphanedFiles(): Promise<string[]> {
    const orphaned: string[] = [];
    const { glob } = await import('glob');

    // Recursively find all .md files under _scepter/, excluding templates and prompts
    const scepterRoot = path.join(this.projectPath, '_scepter');
    const mdFiles = await glob('**/*.md', {
      cwd: scepterRoot,
      ignore: ['_templates/**', '_prompts/**'],
      nodir: true,
    });

    for (const relativePath of mdFiles) {
      const file = path.basename(relativePath);
      // Extract note ID from filename
      const match = file.match(/^([A-Z]+\d+)/);
      if (match) {
        const noteId = match[1];

        // Check if note is in index
        if (!this.noteIndex.has(noteId)) {
          orphaned.push(path.join(scepterRoot, relativePath));
        }
      }
    }

    return orphaned;
  }

  // Query Methods

  /**
   * Retrieves a single note by its ID.
   * First checks the in-memory index, then attempts to load from disk if not found.
   * Loading from disk will parse the file and update the index.
   *
   * @param noteId The note ID to retrieve
   * @returns The Note object if found, null otherwise
   */
  async getNoteById(noteId: string): Promise<Note | null> {
    // Check index
    const cached = this.noteIndex.get(noteId);
    if (cached) return this.attachReferences({ ...cached });

    // Try to load from file if not in index
    const filepath = await this.findNoteFile(noteId);
    if (!filepath) return null;

    // Read file content through NoteFileManager using the discovered path
    const content = await this.noteFileManager.readFileByPath(filepath);
    if (!content) return null;

    // Get note type
    const noteType = this.noteTypeResolver.getTypeFromNoteId(noteId);
    if (!noteType) return null;

    // Try new format first
    const note = await this.parseNoteFromFile(filepath, content, noteType);
    if (note) {
      // Extract references from the note content
      const mentions = parseNoteMentions(note.content);
      this.extractAndStoreReferences(note, mentions);

      // Add to index for future lookups
      this.addNoteToIndexes(note, filepath);

      return this.attachReferences(note);
    }

    // Fall back to old format
    const mentions = parseNoteMentions(content, { filePath: filepath });

    // Find mentions for this specific note ID
    const noteMentions = mentions.filter((m) => m.id === noteId && m.contentExtension !== undefined);
    if (noteMentions.length === 0) return null;

    const oldNote = this.createNoteFromMentions(noteMentions, noteType);

    // Extract references
    this.extractAndStoreReferences(oldNote, mentions);

    // Add to index for future lookups
    this.addNoteToIndexes(oldNote, filepath);

    return this.attachReferences(oldNote);
  }

  /**
   * Retrieves all notes of a specific type.
   * Uses the type index for O(1) lookup of note IDs.
   *
   * @param noteType The type name (e.g., 'Decision')
   * @returns Array of notes of the specified type
   */
  async getNotesByType(noteType: string): Promise<Note[]> {
    const result = await this.getNotes({ types: [noteType] });
    return result.notes;
  }

  /**
   * Retrieves all notes with the specified tag/tags.
   * Notes matching ANY of the provided tags are returned.
   * Tag matching is case-insensitive.
   *
   * @param tag Single tag or array of tags
   * @returns Array of notes matching the tags
   */
  async getNotesByTag(tag: string | string[]): Promise<Note[]> {
    const result = await this.getNotes({
      tags: Array.isArray(tag) ? tag : [tag],
    });
    return result.notes;
  }

  /**
   * Searches for notes containing the specified pattern in their content.
   * Supports both string (case-insensitive) and RegExp patterns.
   *
   * @param pattern Search pattern (string or RegExp)
   * @returns Array of notes matching the pattern
   */
  async searchNotesByContent(pattern: string | RegExp): Promise<Note[]> {
    const result = await this.getNotes({
      searchPatterns: [pattern instanceof RegExp ? pattern.source : pattern],
    });
    return result.notes;
  }

  /**
   * Retrieves notes created within the specified date range.
   * Results are sorted by creation date (oldest first).
   *
   * @param start Start date (inclusive)
   * @param end End date (inclusive, defaults to now)
   * @returns Array of notes within the date range
   */
  async getNotesByDateRange(start: Date, end?: Date): Promise<Note[]> {
    const result = await this.getNotes({
      createdAfter: start,
      createdBefore: end,
      sortBy: 'created',
      sortOrder: 'asc',
    });
    return result.notes;
  }

  /**
   * Retrieves all notes with optional sorting and pagination.
   *
   * @param options Query options for sorting and pagination
   * @returns Array of notes according to the options
   */
  async getAllNotes(options?: QueryOptions): Promise<Note[]> {
    // Get all notes from index with references attached
    let notes = Array.from(this.noteIndex.values()).map((note) => this.attachReferences({ ...note }));

    // Apply sorting
    if (options?.sortBy) {
      notes.sort((a, b) => {
        const order = options.sortOrder === 'desc' ? -1 : 1;

        switch (options.sortBy) {
          case 'id':
            return order * a.id.localeCompare(b.id);
          case 'created':
            return order * (a.created.getTime() - b.created.getTime());
          case 'type':
            return order * a.type.localeCompare(b.type);
          default:
            return 0;
        }
      });
    }

    // Apply pagination
    if (options?.limit) {
      const offset = options.offset || 0;
      notes = notes.slice(offset, offset + options.limit);
    }

    return notes;
  }

  /**
   * Validates all references in the system
   * @returns Validation result with broken references
   */
  async validateReferences(): Promise<{
    valid: boolean;
    broken: Array<
      Reference & {
        fromNote?: Note | null;
        error: string;
      }
    >;
  }> {
    if (!this.referenceManager) {
      return { valid: true, broken: [] };
    }

    const allNotes = await this.getAllNotes();
    const noteIds = new Set(allNotes.map((n) => n.id));
    const validation = await this.referenceManager.validateReferences(noteIds);

    // Enhance with note information
    const broken = await Promise.all(
      validation.broken.map(async (ref) => ({
        ...ref,
        fromNote: await this.getNoteById(ref.fromId),
        error: 'Referenced note not found',
      })),
    );

    return {
      valid: validation.valid,
      broken,
    };
  }

  /**
   * Returns statistics about the note collection.
   * Includes total count, distribution by type and tag, and recent notes.
   *
   * @returns Statistics object with counts and distributions
   */
  async getStatistics(): Promise<NoteStatistics> {
    // Get all notes including archived and deleted
    const allNotesResult = await this.getNotes({
      includeArchived: true,
      includeDeleted: true,
    });

    // Count active, archived, and deleted notes
    let archivedCount = 0;
    let deletedCount = 0;
    let activeCount = 0;

    for (const note of allNotesResult.notes) {
      if (note.tags.includes('archived')) {
        archivedCount++;
      } else if (note.tags.includes('deleted')) {
        deletedCount++;
      } else {
        activeCount++;
      }
    }

    const stats: NoteStatistics = {
      totalNotes: activeCount,
      notesByType: {},
      notesByTag: {},
      recentNotes: [],
      archivedNotes: archivedCount,
      deletedNotes: deletedCount,
    };

    // Count by type (active notes only)
    for (const [type, ids] of this.typeIndex) {
      // Filter out archived and deleted notes from the count
      const activeIds = Array.from(ids).filter((id) => {
        const note = this.noteIndex.get(id);
        return note && !note.tags.includes('archived') && !note.tags.includes('deleted');
      });
      stats.notesByType[type] = activeIds.length;
    }

    // Count by tag (active notes only)
    for (const [tag, ids] of this.tagIndex) {
      // Skip the special archived and deleted tags
      if (tag === 'archived' || tag === 'deleted') continue;

      // Filter out archived and deleted notes from the count
      const activeIds = Array.from(ids).filter((id) => {
        const note = this.noteIndex.get(id);
        return note && !note.tags.includes('archived') && !note.tags.includes('deleted');
      });
      stats.notesByTag[tag] = activeIds.length;
    }

    // Get recent notes (last 10 created, active only) with references attached
    const activeNotes = allNotesResult.notes.filter((n) => !n.tags.includes('archived') && !n.tags.includes('deleted'));
    activeNotes.sort((a, b) => b.created.getTime() - a.created.getTime());
    stats.recentNotes = activeNotes.slice(0, 10).map((note) => this.attachReferences({ ...note }));

    return stats;
  }

  /**
   * Query notes with flexible filtering and composition
   * All filters are AND'ed together, with arrays being OR'ed internally
   */
  async getNotes(query: NoteQuery): Promise<NoteQueryResult> {
    let notes: Note[] = await this.getAllNotes();
    let totalCount = notes.length;

    // Apply archive/delete filters
    if (!query.includeArchived && !query.onlyArchived) {
      notes = notes.filter((n) => !n.tags.includes('archived'));
    }
    if (!query.includeDeleted && !query.onlyDeleted) {
      notes = notes.filter((n) => !n.tags.includes('deleted'));
    }
    if (query.onlyArchived) {
      notes = notes.filter((n) => n.tags.includes('archived'));
    }
    if (query.onlyDeleted) {
      notes = notes.filter((n) => n.tags.includes('deleted'));
    }

    // Apply ID filter
    if (query.ids) {
      notes = notes.filter((n) => query.ids!.includes(n.id));
    }

    // Apply type filters (case-insensitive, supports shortcodes)
    if (query.types) {
      const normalizedQueryTypes: string[] = [];
      for (const type of query.types) {
        // Try as shortcode first
        const typeInfo = this.noteTypeResolver.getTypeByShortcode(type);
        if (typeInfo) {
          normalizedQueryTypes.push(typeInfo.name.toLowerCase());
        } else {
          // Otherwise treat as full type name
          normalizedQueryTypes.push(type.toLowerCase());
        }
      }
      notes = notes.filter((n) => normalizedQueryTypes.includes(n.type.toLowerCase()));
    }
    if (query.excludeTypes) {
      const normalizedExcludeTypes: string[] = [];
      for (const type of query.excludeTypes) {
        // Try as shortcode first
        const typeInfo = this.noteTypeResolver.getTypeByShortcode(type);
        if (typeInfo) {
          normalizedExcludeTypes.push(typeInfo.name.toLowerCase());
        } else {
          // Otherwise treat as full type name
          normalizedExcludeTypes.push(type.toLowerCase());
        }
      }
      notes = notes.filter((n) => !normalizedExcludeTypes.includes(n.type.toLowerCase()));
    }

    // Apply tag filters
    if (query.tags) {
      const normalizedQueryCats = query.tags.map((c) => c.toLowerCase());
      notes = notes.filter((n) => n.tags.some((cat) => normalizedQueryCats.includes(cat.toLowerCase())));
    }
    if (query.excludeTags) {
      const normalizedExcludeCats = query.excludeTags.map((c) => c.toLowerCase());
      notes = notes.filter((n) => !n.tags.some((cat) => normalizedExcludeCats.includes(cat.toLowerCase())));
    }

    // Apply content search
    if (query.searchPatterns) {
      notes = notes.filter((n) => {
        const searchFields = query.searchFields || ['all'];
        const content = searchFields.includes('content') || searchFields.includes('all') ? n.content : '';
        const title = searchFields.includes('title') || searchFields.includes('all') ? n.title : '';
        const searchText = content + ' ' + title;

        return query.searchPatterns!.some((pattern) => {
          const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : new RegExp(pattern);
          return regex.test(searchText);
        });
      });
    }

    // Apply exclude patterns
    if (query.excludePatterns) {
      notes = notes.filter((n) => {
        const searchText = n.content + ' ' + n.title;
        return !query.excludePatterns!.some((pattern) => {
          const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : new RegExp(pattern);
          return regex.test(searchText);
        });
      });
    }

    // Apply title search
    if (query.titleSearch) {
      const regex = new RegExp(query.titleSearch, 'i');
      notes = notes.filter((n) => regex.test(n.title));
    }

    // Apply simple content contains filter
    if (query.contentContains) {
      const searchText = query.contentContains.toLowerCase();
      notes = notes.filter(
        (n) => n.content.toLowerCase().includes(searchText) || n.title.toLowerCase().includes(searchText),
      );
    }

    // Apply date filters
    if (query.createdAfter) {
      notes = notes.filter((n) => n.created >= query.createdAfter!);
    }
    if (query.createdBefore) {
      notes = notes.filter((n) => n.created <= query.createdBefore!);
    }
    if (query.modifiedAfter) {
      notes = notes.filter((n) => n.modified && n.modified >= query.modifiedAfter!);
    }
    if (query.modifiedBefore) {
      notes = notes.filter((n) => n.modified && n.modified <= query.modifiedBefore!);
    }

    // Apply reference filters (requires ReferenceManager)
    if (this.referenceManager) {
      if (query.hasIncomingRefs !== undefined) {
        notes = notes.filter((n) => {
          const incoming = this.referenceManager!.getReferencesTo(n.id);
          return query.hasIncomingRefs ? incoming.length > 0 : incoming.length === 0;
        });
      }

      if (query.hasOutgoingRefs !== undefined) {
        notes = notes.filter((n) => {
          const outgoing = this.referenceManager!.getReferencesFrom(n.id);
          return query.hasOutgoingRefs ? outgoing.length > 0 : outgoing.length === 0;
        });
      }

      if (query.hasNoRefs) {
        notes = notes.filter((n) => {
          const incoming = this.referenceManager!.getReferencesTo(n.id);
          const outgoing = this.referenceManager!.getReferencesFrom(n.id);
          return incoming.length === 0 && outgoing.length === 0;
        });
      }

      if (query.referencedBy) {
        notes = notes.filter((n) => {
          const incoming = this.referenceManager!.getReferencesTo(n.id);
          return incoming.some((ref) => query.referencedBy!.includes(ref.fromId));
        });
      }

      if (query.references) {
        notes = notes.filter((n) => {
          const outgoing = this.referenceManager!.getReferencesFrom(n.id);
          return outgoing.some((ref) => query.references!.includes(ref.toId));
        });
      }

      if (query.minIncomingRefs !== undefined) {
        notes = notes.filter((n) => {
          const incoming = this.referenceManager!.getReferencesTo(n.id);
          return incoming.length >= query.minIncomingRefs!;
        });
      }

      if (query.minOutgoingRefs !== undefined) {
        notes = notes.filter((n) => {
          const outgoing = this.referenceManager!.getReferencesFrom(n.id);
          return outgoing.length >= query.minOutgoingRefs!;
        });
      }
    }

    // Apply task-specific filters
    if (query.statuses?.length) {
      notes = notes.filter((n) => {
        const status = n.metadata?.status || 'pending';
        return query.statuses!.includes(status);
      });
    }

    // Apply sorting
    if (query.sortBy) {
      notes.sort((a, b) => {
        const order = query.sortOrder === 'desc' ? -1 : 1;
        switch (query.sortBy) {
          case 'id':
            return order * a.id.localeCompare(b.id);
          case 'created':
            return order * (a.created.getTime() - b.created.getTime());
          case 'modified':
            const aTime = a.modified?.getTime() || a.created.getTime();
            const bTime = b.modified?.getTime() || b.created.getTime();
            return order * (aTime - bTime);
          case 'type':
            return order * a.type.localeCompare(b.type);
          case 'title':
            return order * a.title.localeCompare(b.title);
          default:
            return 0;
        }
      });
    }

    // Apply pagination
    totalCount = notes.length;
    if (query.limit || query.offset) {
      const offset = query.offset || 0;
      const limit = query.limit || notes.length;
      notes = notes.slice(offset, offset + limit);
    }

    return {
      notes,
      totalCount,
      hasMore: (query.offset || 0) + notes.length < totalCount,
    };
  }

  /**
   * Checks if a note can be safely deleted
   * @param noteId The note ID to check
   * @returns Object indicating if deletion is safe and reason if not
   */
  async canSafelyDelete(noteId: string): Promise<{ safe: boolean; reason?: string }> {
    if (!this.referenceManager) {
      return { safe: true };
    }

    const incoming = this.referenceManager.getReferencesTo(noteId);
    if (incoming.length > 0) {
      return {
        safe: false,
        reason: `Note is referenced by ${incoming.length} other notes`,
      };
    }

    return { safe: true };
  }

  // Index Management Methods

  /**
   * Rebuilds the entire index from the filesystem.
   * Useful for recovering from corruption or external changes.
   *
   * @emits index:rebuilt When rebuild completes
   */
  async refreshIndex(): Promise<void> {
    // Clear all references if ReferenceManager exists
    if (this.referenceManager) {
      // Get all note IDs and remove their references
      for (const noteId of this.noteIndex.keys()) {
        this.referenceManager.removeNote(noteId);
      }
    }

    // Same as initialize, but can be called manually
    this.isInitialized = false;
    await this.initialize();
  }

  /**
   * Adds a note to all relevant indexes.
   * Updates: noteIndex, typeIndex, tagIndex, fileIndex, and idCounters.
   *
   * @param note The note to add
   * @param filepath The file path where the note is stored
   */
  private addNoteToIndexes(note: Note, filepath: string): void {
    // Add to main index
    this.noteIndex.set(note.id, note);

    // Add to type index
    if (!this.typeIndex.has(note.type)) {
      this.typeIndex.set(note.type, new Set());
    }
    this.typeIndex.get(note.type)!.add(note.id);

    // Add to tag indexes (store in lowercase for case-insensitive lookup)
    for (const tag of note.tags) {
      const normalizedTag = tag.toLowerCase();
      if (!this.tagIndex.has(normalizedTag)) {
        this.tagIndex.set(normalizedTag, new Set());
      }
      this.tagIndex.get(normalizedTag)!.add(note.id);
    }

    // Add to file index
    this.fileIndex.set(note.id, filepath);

    // Update ID counter if needed
    const match = note.id.match(/^([A-Z]+)(\d+)$/);
    if (match) {
      const shortcode = match[1];
      const number = parseInt(match[2], 10);
      const current = this.idCounters.get(shortcode) || 0;
      if (number > current) {
        this.idCounters.set(shortcode, number);
      }
    }
  }

  /**
   * Removes a note from all indexes.
   * Cleans up empty sets in type and tag indexes.
   *
   * @param noteId The ID of the note to remove
   */
  private removeNoteFromIndexes(noteId: string): void {
    const note = this.noteIndex.get(noteId);
    if (!note) return;

    // Remove from main index
    this.noteIndex.delete(noteId);

    // Remove from type index
    const typeIds = this.typeIndex.get(note.type);
    if (typeIds) {
      typeIds.delete(noteId);
      if (typeIds.size === 0) {
        this.typeIndex.delete(note.type);
      }
    }

    // Remove from tag indexes (using lowercase for consistency)
    for (const tag of note.tags) {
      const normalizedTag = tag.toLowerCase();
      const catIds = this.tagIndex.get(normalizedTag);
      if (catIds) {
        catIds.delete(noteId);
        if (catIds.size === 0) {
          this.tagIndex.delete(normalizedTag);
        }
      }
    }

    // Remove from file index
    this.fileIndex.delete(noteId);

    // Remove from reference manager
    if (this.referenceManager) {
      this.referenceManager.removeNote(noteId);
    }
  }

  // File Event Handlers

  /**
   * Handles a new note file being created externally.
   * Parses the file, extracts note information, and adds to indexes.
   *
   * @param event File creation event from NoteFileManager
   * @emits note:created If note is successfully parsed and added
   * @emits error If file reading or parsing fails
   */
  private async handleFileCreated(event: { noteId: string; filePath: string }): Promise<void> {
    try {
      // Check if note already exists in index
      if (this.noteIndex.has(event.noteId)) {
        return; // Already indexed
      }

      // Read file content via NoteFileManager
      const fileContent = await this.noteFileManager.readFileByPath(event.filePath);
      if (!fileContent) {
        this.emit('error', new Error(`Failed to read file: ${event.filePath}`));
        return;
      }

      // Check if file uses old inline format or new frontmatter format
      const inlineMatch = fileContent.match(/^\{([A-Z]+\d+):\s*(.+?)\}(?:\n|$)/);

      let title: string;
      let content: string;
      let created = new Date();
      let modified: Date | undefined;
      let tags: string[] = [];

      if (inlineMatch && inlineMatch[1] === event.noteId) {
        // Old inline format: {ID: content}
        // Parse using the old method
        const mentions = parseNoteMentions(fileContent, { filePath: event.filePath });
        const noteMentions = mentions.filter((m) => m.id === event.noteId && m.contentExtension !== undefined);
        if (noteMentions.length === 0) return;

        const noteType = this.noteTypeResolver.getTypeFromNoteId(event.noteId);
        if (!noteType) return;

        const note = this.createNoteFromMentions(noteMentions, noteType);

        // Extract references
        this.extractAndStoreReferences(note, mentions);
        this.addNoteToIndexes(note, event.filePath);
        this.attachReferences(note);
        this.emit('note:created', note);
        return;
      }

      // New frontmatter format
      let contentWithoutFrontmatter = fileContent;

      const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (frontmatterMatch) {
        const frontmatterContent = frontmatterMatch[1];
        contentWithoutFrontmatter = frontmatterMatch[2];

        // Parse YAML frontmatter manually (simple parsing)
        const lines = frontmatterContent.split('\n');
        for (const line of lines) {
          const createdMatch = line.match(/^created:\s*(.+)$/);
          if (createdMatch) {
            created = new Date(createdMatch[1].trim());
          }

          const modifiedMatch = line.match(/^modified:\s*(.+)$/);
          if (modifiedMatch) {
            modified = new Date(modifiedMatch[1].trim());
          }

          const tagsMatch = line.match(/^tags:\s*\[(.*)\]$/);
          if (tagsMatch) {
            const catString = tagsMatch[1].trim();
            tags = catString ? catString.split(',').map((c) => c.trim()) : [];
          }
        }
      }

      // Extract title from first # heading
      const titleMatch = contentWithoutFrontmatter.match(/^#\s+(.+)$/m);
      if (!titleMatch) {
        // Fallback: extract title from filename
        // Filename format: "ID Title.md" or just "ID.md"
        const filename = path.basename(event.filePath, '.md');
        const parts = filename.split(' ');
        if (parts.length > 1) {
          // Remove the ID part and use the rest as title
          title = parts.slice(1).join(' ');
        } else {
          // No title in filename either, use a default
          title = `Untitled ${event.noteId}`;
        }
        console.warn(`No title found in content, using filename: ${title}`);
      } else {
        title = titleMatch[1].trim();
      }

      // Extract content after title
      if (titleMatch) {
        const titleIndex = contentWithoutFrontmatter.indexOf(titleMatch[0]);
        content = contentWithoutFrontmatter.substring(titleIndex + titleMatch[0].length).trim();
      } else {
        // No title in content, use all content
        content = contentWithoutFrontmatter.trim();
      }

      // Determine note type from ID
      const noteType = this.noteTypeResolver.getTypeFromNoteId(event.noteId);
      if (!noteType) {
        console.error(`Unknown note type for ${event.noteId}`);
        return; // Unknown note type
      }

      // Create the note object
      const note: Note = {
        id: event.noteId,
        type: noteType,
        title,
        content,
        tags,
        created,
        modified,
      };

      // Parse mentions from content for references
      const mentions = parseNoteMentions(content, { filePath: event.filePath });

      // Extract references
      this.extractAndStoreReferences(note, mentions);
      this.addNoteToIndexes(note, event.filePath);
      this.attachReferences(note);
      this.emit('note:created', note);
    } catch (error) {
      console.error(`Error processing ${event.filePath}:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Handles a note file being modified.
   * Re-parses the file and updates the note in all indexes.
   * If the note is removed from the file, it's deleted from indexes.
   *
   * @param event File modification event from NoteFileManager
   * @emits note:modified If note content is updated
   * @emits note:deleted If note is removed from file
   * @emits error If processing fails
   */
  private async handleFileModified(event: { noteId: string; filePath: string }): Promise<void> {
    try {
      // Get existing note
      const existingNote = this.noteIndex.get(event.noteId);
      if (!existingNote) return;

      // Re-read file content via NoteFileManager
      const fileContent = await this.noteFileManager.readFileByPath(event.filePath);
      if (!fileContent) return;

      // Check if file uses old inline format or new frontmatter format
      const inlineMatch = fileContent.match(/^\{([A-Z]+\d+):\s*(.+?)\}(?:\n|$)/);

      let updatedNote: Note;

      if (inlineMatch && inlineMatch[1] === event.noteId) {
        // Old inline format: {ID: content}
        const mentions = parseNoteMentions(fileContent, { filePath: event.filePath });
        const noteMentions = mentions.filter((m) => m.id === event.noteId && m.contentExtension !== undefined);

        if (noteMentions.length === 0) {
          // Note was removed from file
          this.removeNoteFromIndexes(event.noteId);
          this.emit('note:deleted', event.noteId);
          return;
        }

        // Update note from mentions
        updatedNote = this.createNoteFromMentions(noteMentions, existingNote.type, true);

        // Re-extract references
        this.extractAndStoreReferences(updatedNote, mentions);
      } else {
        // New frontmatter format - parse frontmatter and content
        let title: string;
        let content: string;
        let created = existingNote.created;
        let modified: Date | undefined = new Date();
        let tags: string[] = existingNote.tags || [];
        let status: string | undefined = existingNote.metadata?.status;

        let contentWithoutFrontmatter = fileContent;

        const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (frontmatterMatch) {
          const frontmatterContent = frontmatterMatch[1];
          contentWithoutFrontmatter = frontmatterMatch[2];

          // Parse YAML frontmatter manually (simple parsing)
          const lines = frontmatterContent.split('\n');
          for (const line of lines) {
            const createdMatch = line.match(/^created:\s*(.+)$/);
            if (createdMatch) {
              created = new Date(createdMatch[1].trim());
            }

            const modifiedMatch = line.match(/^modified:\s*(.+)$/);
            if (modifiedMatch) {
              modified = new Date(modifiedMatch[1].trim());
            }

            const tagsMatch = line.match(/^tags:\s*\[(.*)\]$/);
            if (tagsMatch) {
              const tagString = tagsMatch[1].trim();
              tags = tagString ? tagString.split(',').map((t) => t.trim()) : [];
            }

            const statusMatch = line.match(/^status:\s*(.+)$/);
            if (statusMatch) {
              status = statusMatch[1].trim();
            }
          }
        }

        // Extract title from first # heading
        const titleMatch = contentWithoutFrontmatter.match(/^#\s+(.+)$/m);
        if (!titleMatch) {
          // Fallback: use existing title
          title = existingNote.title;
        } else {
          title = titleMatch[1].trim();
        }

        // Extract content after title
        if (titleMatch) {
          const titleIndex = contentWithoutFrontmatter.indexOf(titleMatch[0]);
          content = contentWithoutFrontmatter.substring(titleIndex + titleMatch[0].length).trim();
        } else {
          content = contentWithoutFrontmatter.trim();
        }

        // Create the updated note object
        updatedNote = {
          id: event.noteId,
          type: existingNote.type,
          title,
          content,
          tags,
          created,
          modified,
          ...(status && { metadata: { ...existingNote.metadata, status } }),
        };

        // Parse mentions from content for references
        const mentions = parseNoteMentions(content, { filePath: event.filePath });

        // Extract references
        this.extractAndStoreReferences(updatedNote, mentions);
      }

      // Update indexes (remove old, add new)
      this.removeNoteFromIndexes(event.noteId);
      this.addNoteToIndexes(updatedNote, event.filePath);

      this.emit('note:modified', updatedNote);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Handles a note file being deleted.
   * Removes the note from all indexes.
   *
   * @param event File deletion event from NoteFileManager
   * @emits note:deleted With the deleted note ID
   */
  private async handleFileDeleted(event: { noteId: string; filePath: string }): Promise<void> {
    // Remove note from all indexes
    this.removeNoteFromIndexes(event.noteId);

    // Emit deletion event
    this.emit('note:deleted', event.noteId);
  }

  /**
   * Handles a note file being renamed.
   * Updates the file index with the new path.
   *
   * @param event File rename event from NoteFileManager
   * @emits note:renamed With note ID and path changes
   */
  private async handleFileRenamed(event: { noteId: string; oldPath: string; newPath: string }): Promise<void> {
    // Update file index with new path
    this.fileIndex.set(event.noteId, event.newPath);

    // Emit rename event
    this.emit('note:renamed', {
      noteId: event.noteId,
      oldPath: event.oldPath,
      newPath: event.newPath,
    });
  }

  /**
   * Handles a note file being moved to a different folder.
   * Updates the file index and checks if the note type changed.
   * If moved to a different type folder, updates the note's type.
   *
   * @param event File move event from NoteFileManager
   * @emits note:moved With movement details
   * @emits note:modified If the note type changed
   */
  private async handleFileMoved(event: { noteId: string; oldPath: string; newPath: string }): Promise<void> {
    // Update file index with new path. In notes-anywhere, moving a note
    // between folders does NOT change its type — type is determined by ID prefix.
    this.fileIndex.set(event.noteId, event.newPath);

    // Emit move event
    this.emit('note:moved', {
      noteId: event.noteId,
      oldPath: event.oldPath,
      newPath: event.newPath,
    });
  }

  // Helper Methods

  /**
   * Creates a Note object from a parsed note item.
   * Adds type information and formats the data structure.
   *
   * @param item Parsed note item from note-parser
   * @param noteType The note type name
   * @param clearExisting If true, clears existing references for this note before adding new ones
   * @returns Formatted Note object
   */
  private createNoteFromMentions(
    mentions: ReturnType<typeof parseNoteMentions>,
    noteType: string,
    clearExisting: boolean = false,
  ): Note {
    // Use the first mention for basic info
    const firstMention = mentions[0];

    // Merge all tags from all mentions
    const allTags = new Set<string>();
    for (const mention of mentions) {
      if (mention.tagExtensions) {
        for (const cat of mention.tagExtensions) {
          allTags.add(cat);
        }
      }
    }

    // Join all extension content
    const content = mentions
      .map((m) => m.contentExtension || '')
      .filter((ext) => ext.length > 0)
      .join('\n\n');

    const note: Note = {
      id: firstMention.id,
      type: noteType,
      title: this.extractTitleFromContent(content, noteType),
      content,
      tags: Array.from(allTags),
      created: new Date(), // This would ideally come from file metadata
      modified: new Date(), // Set same as created initially
      ...(firstMention.filePath && { source: { path: firstMention.filePath, line: firstMention.line } }),
    };

    // Clear existing references if updating
    if (clearExisting && this.referenceManager) {
      this.referenceManager.removeOutgoingReferences(firstMention.id);
    }

    return note;
  }

  private extractAndStoreReferences(note: Note, allMentions: ReturnType<typeof parseNoteMentions>): void {
    if (!this.referenceManager) return;

    // Create a map to track references with their modifiers
    const referencesMap = new Map<string, { modifier?: string }>();

    // Look for mentions without extensions (these are references)
    for (const mention of allMentions) {
      if (mention.contentExtension === undefined && mention.id !== note.id) {
        let modifier: string | undefined;
        if (mention.inclusionModifiers?.content) {
          modifier = '+';
        } else if (mention.inclusionModifiers?.outgoingReferences) {
          modifier = '>';
        } else if (mention.inclusionModifiers?.incomingReferences) {
          modifier = '<';
        } else if (mention.inclusionModifiers?.contextHints) {
          modifier = '$';
        } else if (mention.inclusionModifiers?.everything) {
          modifier = '*';
        }
        referencesMap.set(mention.id, { modifier });
      }
    }

    // Also extract references from the note's content
    // Parse again to capture any references within the extension content
    const contentMentions = parseNoteMentions(note.content);
    for (const mention of contentMentions) {
      if (mention.id !== note.id && !referencesMap.has(mention.id)) {
        let modifier: string | undefined;
        if (mention.inclusionModifiers?.content) {
          modifier = '+';
        } else if (mention.inclusionModifiers?.outgoingReferences) {
          modifier = '>';
        } else if (mention.inclusionModifiers?.incomingReferences) {
          modifier = '<';
        } else if (mention.inclusionModifiers?.contextHints) {
          modifier = '$';
        } else if (mention.inclusionModifiers?.everything) {
          modifier = '*';
        }
        referencesMap.set(mention.id, { modifier });
      }
    }

    // Store each reference
    for (const [refId, { modifier }] of referencesMap) {
      this.referenceManager.addReference({
        fromId: note.id,
        toId: refId,
        line: note.source?.line || 0,
        modifier,
      });
    }
  }

  /**
   * Attaches reference information to a note
   * @param note The note to attach references to
   * @returns The note with references attached
   */
  private attachReferences(note: Note): Note {
    // Attach file path from the file index
    const filePath = this.fileIndex.get(note.id);
    if (filePath) {
      note.filePath = filePath;
    }

    if (!this.referenceManager) return note;

    note.references = {
      outgoing: this.referenceManager.getReferencesFrom(note.id),
      incoming: this.referenceManager.getReferencesTo(note.id),
    };

    return note;
  }

  /**
   * Scans all notes to update ID counters.
   * Ensures the next generated ID will be unique.
   */
  private updateIdCounters(): void {
    // Scan all notes to update ID counters
    for (const [noteId] of this.noteIndex) {
      const match = noteId.match(/^([A-Z]+)(\d+)$/);
      if (match) {
        const shortcode = match[1];
        const number = parseInt(match[2], 10);
        const current = this.idCounters.get(shortcode) || 0;
        if (number > current) {
          this.idCounters.set(shortcode, number);
        }
      }
    }
  }


  /**
   * Extract a title from content if not provided
   * Uses the first heading or first line of content
   *
   * @param content - The note content
   * @param noteType - Optional note type for generating default title
   * @returns Extracted title
   */
  /**
   * Parse a note from file content in the new format
   */
  private async parseNoteFromFile(filePath: string, fileContent: string, noteType: string): Promise<Note | null> {
    // Extract note ID from filename
    const filename = path.basename(filePath, '.md');
    const idMatch = filename.match(/^([A-Z]+\d+)/);
    if (!idMatch) return null;

    const noteId = idMatch[1];

    // Check if this is the new format with frontmatter
    if (!fileContent.trim().startsWith('---')) {
      return null; // Not new format
    }

    let title = '';
    let content = fileContent;
    let tags: string[] = [];
    let created = new Date();
    let modified: Date | undefined;

    // Parse frontmatter
    const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (frontmatterMatch) {
      const frontmatterContent = frontmatterMatch[1];
      content = frontmatterMatch[2];

      // Parse YAML frontmatter manually (simple parsing)
      const lines = frontmatterContent.split('\n');
      for (const line of lines) {
        const createdMatch = line.match(/^created:\s*(.+)$/);
        if (createdMatch) {
          created = new Date(createdMatch[1].trim());
        }

        const modifiedMatch = line.match(/^modified:\s*(.+)$/);
        if (modifiedMatch) {
          modified = new Date(modifiedMatch[1].trim());
        }

        const tagsMatch = line.match(/^tags:\s*\[(.*)\]$/);
        if (tagsMatch) {
          const catString = tagsMatch[1].trim();
          tags = catString ? catString.split(',').map((c) => c.trim()) : [];
        }
      }
    }

    // Extract title from content
    const titleMatch = content.match(/^#\s+[A-Z]+\d+\s*-\s*(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].trim();
    } else {
      // Fallback: extract from filename
      const parts = filename.split(' ');
      if (parts.length > 1) {
        title = parts.slice(1).join(' ');
      }
    }

    return {
      id: noteId,
      type: noteType,
      title,
      content: content.trim(),
      tags,
      created,
      modified: modified || created, // Default to created if no modified date
    };
  }

  private extractTitleFromContent(content: string, noteType?: string): string {
    if (!content || content.trim() === '') {
      return noteType ? `Untitled ${noteType}` : 'Untitled Note';
    }

    // Try to find a markdown heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      let title = headingMatch[1].trim();

      // Remove note ID prefix if present (e.g., "R003 - API rate limiting" -> "API rate limiting")
      const idPrefixMatch = title.match(/^([A-Z]+\d+)\s*-\s*(.+)$/);
      if (idPrefixMatch) {
        title = idPrefixMatch[2].trim();
      }

      return title;
    }

    // Otherwise use the first line
    const lines = content.split('\n');
    const firstLine = lines[0].trim();

    if (!firstLine) {
      return 'Untitled Note';
    }

    // Truncate if too long
    if (firstLine.length > 100) {
      return firstLine.substring(0, 97) + '...';
    }

    return firstLine;
  }

  /**
   * Archive multiple notes in batch
   */
  async archiveNotes(
    noteIds: string[],
    reason?: string,
  ): Promise<Array<{ noteId: string; success: boolean; error?: string }>> {
    const results: Array<{ noteId: string; success: boolean; error?: string }> = [];

    for (const noteId of noteIds) {
      try {
        await this.archiveNote(noteId, reason);
        results.push({ noteId, success: true });
      } catch (error) {
        results.push({
          noteId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Delete multiple notes in batch
   */
  async deleteNotes(
    noteIds: string[],
    reason?: string,
  ): Promise<Array<{ noteId: string; success: boolean; error?: string }>> {
    const results: Array<{ noteId: string; success: boolean; error?: string }> = [];

    for (const noteId of noteIds) {
      try {
        await this.deleteNote(noteId, reason);
        results.push({ noteId, success: true });
      } catch (error) {
        results.push({
          noteId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Restore multiple notes in batch
   */
  async restoreNotes(noteIds: string[]): Promise<Array<{ noteId: string; success: boolean; error?: string }>> {
    const results: Array<{ noteId: string; success: boolean; error?: string }> = [];

    for (const noteId of noteIds) {
      try {
        await this.restoreNote(noteId);
        results.push({ noteId, success: true });
      } catch (error) {
        results.push({
          noteId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Get archived notes
   */
  async getArchivedNotes(query?: NoteQuery): Promise<NoteQueryResult> {
    return this.getNotes({
      ...query,
      onlyArchived: true,
    });
  }

  /**
   * Get deleted notes
   */
  async getDeletedNotes(query?: NoteQuery): Promise<NoteQueryResult> {
    return this.getNotes({
      ...query,
      onlyDeleted: true,
    });
  }
}
