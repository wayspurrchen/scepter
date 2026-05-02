import { EventEmitter } from 'events';
import { ConfigManager } from '../config/config-manager';
import type { AliasResolution } from '../config/config-manager';
import { NoteManager } from '../notes/note-manager';
import { ReferenceManager } from '../references/reference-manager';
import { NoteFileManager } from '../notes/note-file-manager';
import { NoteTypeResolver } from '../notes/note-type-resolver';
import { NoteTypeTemplateManager } from '../templates/note-type-template-manager';
import { ContextGatherer } from '../context/context-gatherer';
import { TaskDispatcher } from '../tasks/task-dispatcher';
import { SourceCodeScanner } from '../scanners/source-code-scanner';
import { StatusValidator } from '../statuses/status-validator.js';
import { ClaimIndex } from '../claims/claim-index.js';
import { PeerProjectResolver, type PeerProjectFactory } from './peer-project-resolver';
import type { SCEpterConfig } from '../types/config';
import type { SimpleLLMFunction } from '../llm/types';
import type {
  NoteStorage,
  ConfigStorage,
  TemplateStorage,
  MetadataStorage,
  IdCounterStorage,
} from '../storage';
import * as path from 'path';
import * as fsProjectUtils from '../storage/filesystem/filesystem-project-utils';
import type {
  TypeInfo,
  RenameResult,
  DeleteResult,
  ProgressInfo,
  ReferenceLocation
} from './types';

export interface ProjectManagerDependencies {
  configManager?: ConfigManager;
  noteManager?: NoteManager;
  referenceManager?: ReferenceManager;
  noteFileManager?: NoteFileManager;
  noteTypeResolver?: NoteTypeResolver;
  noteTypeTemplateManager?: NoteTypeTemplateManager;
  contextGatherer?: ContextGatherer;
  taskDispatcher?: TaskDispatcher;
  sourceScanner?: SourceCodeScanner;
  llmFunction?: SimpleLLMFunction;
  /** Factory for instantiating peer-project ProjectManagers. Used by
   * PeerProjectResolver to resolve `<alias>/...` references. Defaults
   * to `createFilesystemProject` (the same factory the local project
   * uses). Tests inject a stub. */
  peerProjectFactory?: PeerProjectFactory;
  // Storage interfaces (new — injected by createFilesystemProject)
  noteStorage?: NoteStorage;
  configStorage?: ConfigStorage;
  templateStorage?: TemplateStorage;
  // @implements {DD014.§3.DC.45} verificationStorage slot renamed to metadataStorage
  // @implements {DD014.§3.DC.46} import switched from VerificationStorage to MetadataStorage
  metadataStorage?: MetadataStorage;
  idCounterStorage?: IdCounterStorage;
}

// Import filesystem-specific types used in public methods below,
// and re-export for backwards compatibility.
import type { ValidationError, ValidationReport, CleanupSuggestion } from '../storage/filesystem/filesystem-project-utils';
export type { ValidationError, ValidationReport, CleanupSuggestion };

export interface ProjectStatistics {
  totalNotes: number;
  notesByType: Record<string, number>;
  notesByMode: Record<string, number>;
  lastModified: Date | null;
  projectSize: number; // in bytes
}

/**
 * @implements {T011} Phase 3 - CLI Integration
 */
export class ProjectManager extends EventEmitter {
  public readonly configManager: ConfigManager;
  public readonly referenceManager: ReferenceManager;
  public readonly noteFileManager: NoteFileManager;
  public readonly noteTypeResolver: NoteTypeResolver;
  public readonly noteTypeTemplateManager: NoteTypeTemplateManager;
  public readonly noteManager: NoteManager;
  public readonly contextGatherer: ContextGatherer;
  public taskDispatcher: TaskDispatcher;
  public sourceScanner?: SourceCodeScanner;
  public statusValidator!: StatusValidator;
  public readonly claimIndex: ClaimIndex;

  /** Cross-project alias resolver. Lazily instantiated on first
   * access via `peerResolver` getter so unrelated code paths don't
   * pay the construction cost. */
  private _peerResolver?: PeerProjectResolver;
  private readonly peerProjectFactory?: PeerProjectFactory;

  // Storage interfaces (injected by factory, undefined in legacy construction path)
  public readonly noteStorage?: NoteStorage;
  public readonly configStorage?: ConfigStorage;
  public readonly templateStorage?: TemplateStorage;
  // @implements {DD014.§3.DC.45} verificationStorage field renamed to metadataStorage
  public readonly metadataStorage?: MetadataStorage;
  public readonly idCounterStorage?: IdCounterStorage;

  private validationErrors: ValidationError[] = [];
  private llmFunction?: SimpleLLMFunction;

  constructor(
    public projectPath: string,
    deps: ProjectManagerDependencies = {},
  ) {
    super();

    // Store LLM function for TaskDispatcher creation
    this.llmFunction = deps.llmFunction;

    // Store storage interfaces if provided (injected by createFilesystemProject)
    this.noteStorage = deps.noteStorage;
    this.configStorage = deps.configStorage;
    this.templateStorage = deps.templateStorage;
    this.metadataStorage = deps.metadataStorage;
    this.idCounterStorage = deps.idCounterStorage;

    // Create all dependencies with defaults if not provided
    this.configManager = deps.configManager || new ConfigManager(projectPath);
    this.referenceManager = deps.referenceManager || new ReferenceManager();
    this.noteFileManager = deps.noteFileManager || new NoteFileManager(projectPath, this.configManager);
    this.noteTypeResolver = deps.noteTypeResolver || new NoteTypeResolver(this.configManager);
    this.noteTypeTemplateManager =
      deps.noteTypeTemplateManager || new NoteTypeTemplateManager(projectPath, this.configManager);

    this.noteManager =
      deps.noteManager ||
      new NoteManager(
        projectPath,
        this.configManager,
        this.noteFileManager,
        this.noteTypeResolver,
        this.noteTypeTemplateManager,
        this.referenceManager,
      );

    this.contextGatherer =
      deps.contextGatherer || new ContextGatherer(this.noteManager, this.configManager, this.referenceManager);

    // Create TaskDispatcher with all dependencies
    this.taskDispatcher =
      deps.taskDispatcher ||
      new TaskDispatcher({
        llmFunction: this.llmFunction,
        noteManager: this.noteManager,
        contextGatherer: this.contextGatherer,
      });

    // Store source scanner if provided
    this.sourceScanner = deps.sourceScanner;

    // Claim index — built on-demand, not during initialization
    this.claimIndex = new ClaimIndex();

    // Peer-project factory for cross-project alias resolution. Stored
    // for lazy use by `peerResolver`.
    this.peerProjectFactory = deps.peerProjectFactory;

    // Wire alias-changed events from configManager.reloadConfig() to
    // the peer cache. Fires for the lifetime of this ProjectManager,
    // independent of `watchConfigChanges()`. Only does work when the
    // peerResolver has been lazily constructed; if it hasn't, the
    // cache is empty and there is nothing to invalidate.
    // @implements {R011.§4.AC.12} alias-changed → peer-cache invalidation
    this.configManager.on('aliases:changed', (payload: { prev: Map<string, AliasResolution>; next: Map<string, AliasResolution> }) => {
      if (this._peerResolver) {
        this._peerResolver.invalidateChanged(payload.prev, payload.next);
      }
    });
  }

  /**
   * Lazy accessor for the cross-project alias resolver. Constructed on
   * first access. Default factory is `createFilesystemProject`, but
   * callers may inject a stub via the `peerProjectFactory` dep.
   *
   * @implements {R011.§2.AC.05} cross-project resolver entry point
   * @implements {R011.§2.AC.06} per-CLI-invocation peer cache (resolver instance lifetime)
   */
  get peerResolver(): PeerProjectResolver {
    if (!this._peerResolver) {
      const factory: PeerProjectFactory = this.peerProjectFactory ?? (async (peerPath: string) => {
        // Lazy import to avoid pulling the filesystem factory into every
        // ProjectManager construction path. The dynamic import keeps the
        // baseline startup cost identical for projects that don't
        // exercise cross-project references.
        const { createFilesystemProject } = await import('../storage/filesystem/create-filesystem-project');
        return createFilesystemProject(peerPath);
      });
      this._peerResolver = new PeerProjectResolver(this.configManager, factory);
    }
    return this._peerResolver;
  }

  /**
   * Initialize the project. Directory bootstrapping and config loading are
   * handled by the factory (createFilesystemProject / bootstrapFilesystemDirs)
   * before this method is called. initialize() sets up in-memory subsystems only.
   *
   * @implements {DD010.§DC.18} ProjectManager.initialize() contains no direct filesystem operations
   */
  async initialize(options?: { includeArchived?: boolean; includeDeleted?: boolean; startWatchers?: boolean }): Promise<void> {
    // Load config if not already loaded by the factory
    let config: SCEpterConfig;
    try {
      config = this.configManager.getConfig();
    } catch (error) {
      const loaded = await this.configManager.loadConfigFromFilesystem();
      if (!loaded) {
        throw new Error('No configuration file found. Please run `scepter init` first.');
      }
      config = loaded;
    }

    // @implements {T011} Initialize status validator after config is loaded
    this.statusValidator = new StatusValidator(config);

    // Initialize note type resolver after config is loaded
    this.noteTypeResolver.initialize();

    // Initialize template manager
    await this.noteTypeTemplateManager.initialize();

    // Initialize note manager to discover tasks
    await this.noteManager.initialize(options);

    // Build the NoteFileManager index so getFileContents()/getFilePath() work
    // regardless of whether file watchers are started. This is the single
    // choke-point — every consumer (CLI, web, tests) goes through initialize().
    await this.noteFileManager.buildIndex();

    // Initialize TaskDispatcher with work modes from config
    this.taskDispatcher = await this.createTaskDispatcher();

    // Initialize source code scanner if enabled
    if (config.sourceCodeIntegration?.enabled) {
      this.sourceScanner = new SourceCodeScanner(this.projectPath, this.configManager);
      try {
        await this.sourceScanner.initialize();
        // Set up bidirectional integration with ReferenceManager
        this.referenceManager.setSourceIndex(this.sourceScanner.getIndex());
        // Start watching for changes only if requested (e.g., for daemon/watch mode)
        // Default is false to avoid hanging CLI commands
        if (options?.startWatchers) {
          await this.sourceScanner.startWatching();
        }
      } catch (error) {
        console.warn('Failed to initialize source code scanner:', error);
        this.sourceScanner = undefined;
      }
    }

    // Emit event
    this.emit('structure:changed');
  }

  /**
   * Validate the project's filesystem structure.
   * Delegates to filesystem-project-utils (inherently filesystem-bound).
   */
  async validateStructure(): Promise<boolean> {
    try {
      const config = this.configManager.getConfig();
      const errors = await fsProjectUtils.validateStructure(this.projectPath, config);
      this.validationErrors = errors;
    } catch {
      this.validationErrors = [{
        type: 'missing_directory',
        path: this.projectPath,
        message: 'Failed to load configuration',
      }];
    }
    return this.validationErrors.length === 0;
  }

  async getValidationErrors(): Promise<ValidationError[]> {
    return [...this.validationErrors];
  }

  async getValidationReport(): Promise<ValidationReport> {
    const config = this.configManager.getConfig();
    return fsProjectUtils.getValidationReport(this.projectPath, config);
  }

  async updateStructure(): Promise<void> {
    // Directory creation is handled by the factory/bootstrap — just emit event
    this.emit('structure:updated');
  }

  async getCleanupSuggestions(): Promise<CleanupSuggestion[]> {
    const config = this.configManager.getConfig();
    return fsProjectUtils.getCleanupSuggestions(this.projectPath, config);
  }

  /**
   * Get project statistics. Delegates filesystem-bound operations
   * (lastModified, projectSize) to noteStorage.getStatistics().
   *
   * @implements {DD010.§DC.27} getStatistics delegates to noteStorage
   */
  async getStatistics(): Promise<ProjectStatistics> {
    const noteManagerStats = await this.noteManager.getStatistics();

    // Delegate storage-level stats (lastModified, totalSize) to noteStorage if available
    let lastModified: Date | null = null;
    let projectSize = 0;
    if (this.noteStorage) {
      const storageStats = await this.noteStorage.getStatistics();
      lastModified = storageStats.lastModified || null;
      projectSize = storageStats.totalSize || 0;
    }

    return {
      totalNotes: noteManagerStats.totalNotes,
      notesByType: { ...noteManagerStats.notesByType },
      notesByMode: {},
      lastModified,
      projectSize,
    };
  }

  /**
   * @deprecated Use findProjectRoot() from create-filesystem-project.ts instead.
   * Kept as a static forwarding method for backwards compatibility.
   */
  static async findProjectRoot(startPath: string): Promise<string | null> {
    const { findProjectRoot } = await import('../storage/filesystem/create-filesystem-project');
    return findProjectRoot(startPath);
  }

  // Config change watching
  watchConfigChanges(): void {
    this.configManager.on('config:changed', async () => {
      await this.updateStructure();
      // Recreate TaskDispatcher with new work modes
      this.taskDispatcher = await this.createTaskDispatcher();
      this.emit('taskDispatcher:recreated');
    });
  }

  /**
   * Creates a new TaskDispatcher with current configuration
   */
  private async createTaskDispatcher(): Promise<TaskDispatcher> {
    const config = await this.configManager.getConfig();

    return new TaskDispatcher({
      llmFunction: this.llmFunction,
      noteManager: this.noteManager,
      contextGatherer: this.contextGatherer,
    });
  }

  /**
   * Cleanup all watchers and resources.
   * Runs stopWatching calls in parallel so slow teardown on one subsystem
   * (notably chokidar's recursive fs.watch on macOS) doesn't block the others.
   * Each stopWatching is individually bounded by its own timeout race.
   */
  async cleanup(): Promise<void> {
    const stops: Promise<void>[] = [];
    if (this.noteManager) {
      stops.push(this.noteManager.stopWatching());
    }
    if (this.sourceScanner) {
      stops.push(this.sourceScanner.stopWatching());
    }
    await Promise.all(stops);
  }

  // Type Management Operations

  /**
   * List all configured note types with statistics
   */
  async listNoteTypes(): Promise<TypeInfo[]> {
    const config = this.configManager.getConfig();
    const stats = await this.noteManager.getStatistics();
    const typeInfos: TypeInfo[] = [];

    for (const [typeName, typeConfig] of Object.entries(config.noteTypes)) {
      // Check template existence via storage interface
      const hasTemplate = this.templateStorage
        ? (await this.templateStorage.getTemplate(typeName)) !== null
        : false;

      // @implements {T011.3.3} Populate allowedStatuses info for type listing
      let allowedStatusesInfo: TypeInfo['allowedStatuses'];
      if (this.statusValidator && this.statusValidator.hasAllowedStatuses(typeName)) {
        const mode = this.statusValidator.getMode(typeName);
        const values = this.statusValidator.resolveAllowedStatuses(typeName) || [];
        const defaultValue = this.statusValidator.getDefaultStatus(typeName);
        allowedStatusesInfo = {
          mode,
          values,
          defaultValue: defaultValue || undefined,
        };
      }

      typeInfos.push({
        type: typeName,
        shortcode: typeConfig.shortcode,
        folder: typeConfig.folder,
        noteCount: stats.notesByType[typeName] || 0,
        hasTemplate,
        description: typeConfig.description,
        emoji: typeConfig.emoji,
        color: typeConfig.color,
        allowedStatuses: allowedStatusesInfo,
      });
    }

    return typeInfos.sort((a, b) => a.type.localeCompare(b.type));
  }

  /**
   * Add a new note type
   */
  async addNoteType(
    name: string,
    shortcode: string,
    options?: {
      folder?: string;
      description?: string;
      emoji?: string;
      color?: string;
    }
  ): Promise<void> {
    // Validate inputs
    const validation = this.validateTypeInputs(name, shortcode);
    if (!validation.isValid) {
      throw new Error(validation.errors[0]);
    }

    // Check if type already exists
    const config = this.configManager.getConfig();
    if (config.noteTypes[name]) {
      throw new Error(`Note type '${name}' already exists`);
    }

    // Check if shortcode already exists
    for (const [existingType, typeConfig] of Object.entries(config.noteTypes)) {
      if (typeConfig.shortcode === shortcode.toUpperCase()) {
        throw new Error(`Shortcode '${shortcode}' is already used by type '${existingType}'`);
      }
    }

    // Determine folder name (only if explicitly provided)
    const folder = options?.folder;

    // Add to config
    await this.configManager.addNoteType(name, {
      shortcode: shortcode.toUpperCase(),
      ...(folder && { folder }),
      ...(options?.description && { description: options.description }),
      ...(options?.emoji && { emoji: options.emoji }),
      ...(options?.color && { color: options.color }),
    });

    // Create folder only if one was specified
    if (folder) {
      await fsProjectUtils.ensureNoteTypeDirectory(this.projectPath, config, folder);
    }

    // Reinitialize note manager to pick up new type
    await this.noteManager.initialize();
  }

  /**
   * Rename a note type with optional shortcode and description updates
   */
  async renameNoteType(
    oldName: string,
    newName: string,
    options?: {
      newShortcode?: string;
      newDescription?: string;
      dryRun?: boolean;
      skipConfirmation?: boolean;
      onProgress?: (progress: ProgressInfo) => void;
    }
  ): Promise<RenameResult> {
    const config = this.configManager.getConfig();

    // Check if old type exists
    if (!config.noteTypes[oldName]) {
      throw new Error(`Note type '${oldName}' not found`);
    }

    const oldTypeConfig = config.noteTypes[oldName];
    const oldShortcode = oldTypeConfig.shortcode;
    const newShortcode = options?.newShortcode?.toUpperCase() || oldShortcode;

    // Validate new name if different
    if (oldName !== newName) {
      const validation = this.validateTypeInputs(newName, newShortcode);
      if (!validation.isValid) {
        throw new Error(validation.errors[0]);
      }

      // Check if new name already exists
      if (config.noteTypes[newName]) {
        throw new Error(`Note type '${newName}' already exists`);
      }
    }

    // Check if new shortcode already exists (if changing)
    if (newShortcode !== oldShortcode) {
      for (const [typeName, typeConfig] of Object.entries(config.noteTypes)) {
        if (typeName !== oldName && typeConfig.shortcode === newShortcode) {
          throw new Error(`Shortcode '${newShortcode}' is already used by type '${typeName}'`);
        }
      }
    }

    // Gather all notes of this type
    const notes = await this.noteManager.getAllNotes();
    const affectedNotes = notes.filter(note =>
      (note.noteType || note.type) === oldName || note.id.startsWith(oldShortcode)
    );

    // Find all references - always search to get accurate counts
    options?.onProgress?.({
      phase: 'analyzing',
      current: 0,
      total: 1
    });

    const { findAllReferencesToType } = await import('./type-reference-utils');
    const references = await findAllReferencesToType(oldShortcode, this.projectPath);

    // Build the result object
    const result: RenameResult = {
      executed: false,
      changes: {
        configUpdates: 0,
        folderRenames: 0,
        noteRenames: 0,
        frontmatterUpdates: 0,
        referenceUpdates: {
          fileCount: 0,
          totalReferences: 0
        },
        templateRenames: 0
      },
      details: {
        oldFolder: oldTypeConfig.folder,
        newFolder: oldTypeConfig.folder,
        noteFiles: [],
        referenceFiles: []
      }
    };

    // Calculate changes
    if (oldName !== newName || newShortcode !== oldShortcode || options?.newDescription) {
      result.changes.configUpdates = 1;
    }

    // Calculate folder renames (only if old type had a folder)
    if (oldName !== newName && oldTypeConfig.folder) {
      result.changes.folderRenames = 1;
      result.details!.newFolder = this.pluralize(newName.toLowerCase());
    }

    // Prepare note renames
    for (const note of affectedNotes) {
      const oldPath = note.filePath || '';
      let newPath = oldPath;

      // Calculate new path - may change due to folder rename or shortcode change
      const fileName = path.basename(oldPath);
      let newFileName = fileName;

      // Update filename if shortcode changes
      if (newShortcode !== oldShortcode) {
        newFileName = fileName.replace(
          new RegExp(`^${oldShortcode}(\\d{3,5})`),
          `${newShortcode}$1`
        );
      }

      // Update path if folder changes (folderRenames > 0 only when folder is defined)
      if (result.changes.folderRenames > 0 && result.details!.newFolder) {
        newPath = path.join(
          this.projectPath,
          config.paths?.notesRoot || '_scepter',
          result.details!.newFolder,
          newFileName
        );
      } else if (newFileName !== fileName) {
        newPath = path.join(path.dirname(oldPath), newFileName);
      }

      // Count as rename if path changed
      if (newPath !== oldPath) {
        result.changes.noteRenames++;
      }

      // Count frontmatter updates (always needed when renaming type)
      if (oldName !== newName) {
        result.changes.frontmatterUpdates++;
      }

      result.details!.noteFiles.push({
        oldPath: path.relative(this.projectPath, oldPath),
        newPath: path.relative(this.projectPath, newPath)
      });
    }

    // Prepare reference updates
    const referencesByFile = new Map<string, ReferenceLocation[]>();
    for (const ref of references) {
      const existing = referencesByFile.get(ref.filePath) || [];
      existing.push(ref);
      referencesByFile.set(ref.filePath, existing);
    }

    result.changes.referenceUpdates.fileCount = referencesByFile.size;
    result.changes.referenceUpdates.totalReferences = references.length;

    for (const [filePath, fileRefs] of referencesByFile) {
      result.details!.referenceFiles.push({
        path: path.relative(this.projectPath, filePath),
        referenceCount: fileRefs.length,
        examples: fileRefs.slice(0, 3).map(ref => ref.referenceText)
      });
    }

    // Check for template via storage interface
    if (this.templateStorage) {
      const template = await this.templateStorage.getTemplate(oldName);
      if (template !== null) {
        result.changes.templateRenames = 1;
      }
    }

    // If dry run, return here
    if (options?.dryRun) {
      return result;
    }

    // Mark as will be executed
    result.executed = true;

    // Create backup
    options?.onProgress?.({
      phase: 'backup',
      message: 'Creating backup...',
      current: 1,
      total: 1
    });
    const backupPath = await this.configManager.createBackup();

    try {
      // Update references if shortcode changed
      if (newShortcode !== oldShortcode) {
        options?.onProgress?.({
          phase: 'updating',
          message: 'Updating references...',
          current: 0,
          total: referencesByFile.size
        });

        const { updateReferencesForTypeRename } = await import('./type-reference-utils');
        await updateReferencesForTypeRename(this.projectPath, oldShortcode, newShortcode);
      }

      // Update config BEFORE renaming notes — the adapter's createNoteFile()
      // calls findTypeConfig(newName), which must find the new type entry
      // (including its folder) so files are created in the correct location.
      // @implements {DD010.§DC.27} renameNoteType delegates to noteStorage.renameNotesOfType
      if (oldName !== newName) {
        const newFolder = result.details!.newFolder || oldTypeConfig.folder;
        await this.configManager.removeNoteType(oldName);
        await this.configManager.addNoteType(newName, {
          ...oldTypeConfig,
          shortcode: newShortcode,
          ...(newFolder && { folder: newFolder }),
          ...(options?.newDescription && { description: options.newDescription })
        });
      } else {
        await this.configManager.updateNoteType(oldName, {
          shortcode: newShortcode,
          ...(options?.newDescription && { description: options.newDescription })
        });
      }

      // Ensure the new type's folder exists before moving files into it
      if (result.changes.folderRenames > 0 && result.details!.newFolder) {
        await fsProjectUtils.ensureNoteTypeDirectory(
          this.projectPath,
          this.configManager.getConfig(),
          result.details!.newFolder,
        );
      }

      // Now rename note files via storage interface — config is updated,
      // so createNoteFile() will find the new type and its folder.
      // NOTE: This works because UnifiedDiscovery.shortcodeToType is cached
      // from initialization and NOT refreshed by programmatic config changes,
      // so the adapter still resolves old-prefix notes correctly. If auto-refresh
      // of the shortcode map on config change is ever added, this will break.
      if (this.noteStorage && (newShortcode !== oldShortcode || oldName !== newName)) {
        await this.noteStorage.renameNotesOfType(oldName, newName, newShortcode);
      }

      // Rename template via filesystem utilities
      if (result.changes.templateRenames > 0) {
        await fsProjectUtils.renameTemplate(this.projectPath, config, oldName, newName);
      }

      // Reinitialize to pick up changes
      await this.noteManager.initialize();

      options?.onProgress?.({
        phase: 'complete',
        message: 'Rename complete',
        current: 1,
        total: 1
      });

    } catch (error) {
      // Restore from backup on error
      options?.onProgress?.({
        phase: 'error',
        message: 'Error occurred, restoring backup...',
        current: 0,
        total: 1
      });

      await this.configManager.restoreBackup(backupPath);
      throw error;
    }

    return result;
  }

  /**
   * Delete a note type with various strategies
   */
  async deleteNoteType(
    typeName: string,
    options?: {
      strategy?: 'block' | 'archive' | 'move-to-uncategorized';
      targetType?: string;
      dryRun?: boolean;
      skipConfirmation?: boolean;
    }
  ): Promise<DeleteResult> {
    const config = this.configManager.getConfig();
    const strategy = options?.strategy || 'block';

    // Check if type exists
    if (!config.noteTypes[typeName]) {
      throw new Error(`Note type '${typeName}' not found`);
    }

    // Prevent deleting last type
    if (Object.keys(config.noteTypes).length === 1) {
      throw new Error('Cannot delete the last note type');
    }

    const typeConfig = config.noteTypes[typeName];
    const shortcode = typeConfig.shortcode;

    // Gather all notes of this type
    const notes = await this.noteManager.getAllNotes();
    const affectedNotes = notes.filter(note =>
      (note.noteType || note.type) === typeName || note.id.startsWith(shortcode)
    );

    // For move-to-uncategorized, validate target type
    if (strategy === 'move-to-uncategorized' && options?.targetType) {
      if (!config.noteTypes[options.targetType]) {
        throw new Error(`Target type '${options.targetType}' not found`);
      }
      if (options.targetType === typeName) {
        throw new Error('Cannot move notes to the same type being deleted');
      }
    }

    // Build result
    const result: DeleteResult = {
      executed: false,
      strategy,
      changes: {
        configUpdates: 0,
        foldersRemoved: 0,
        notesAffected: affectedNotes.length,
        notesArchived: 0,
        notesMoved: 0,
        referencesMarked: 0
      },
      details: {
        affectedNotes: []
      }
    };

    // Check blocking conditions
    if (strategy === 'block' && affectedNotes.length > 0) {
      const errorMessage = `Cannot delete type '${typeName}': ${affectedNotes.length} notes exist`;
      if (options?.dryRun) {
        result.details!.affectedNotes = affectedNotes.map(note => ({
          id: note.id,
          title: note.title || '',
          path: path.relative(this.projectPath, note.filePath || ''),
          action: 'blocked' as const
        }));
        return result;
      }
      throw new Error(errorMessage);
    }

    // Prepare operations for dry run
    if (strategy === 'archive') {
      result.changes.notesArchived = affectedNotes.length;
      result.details!.affectedNotes = affectedNotes.map(note => ({
        id: note.id,
        title: note.title || '',
        path: path.relative(this.projectPath, note.filePath || ''),
        action: 'archived' as const
      }));
    } else if (strategy === 'move-to-uncategorized') {
      const targetTypeConfig = config.noteTypes[options?.targetType || 'Uncategorized'];
      const targetShortcode = targetTypeConfig?.shortcode || 'U';

      result.changes.notesMoved = affectedNotes.length;

      for (const note of affectedNotes) {
        const oldPath = note.filePath || '';
        const fileName = path.basename(oldPath);
        const newFileName = fileName.replace(
          new RegExp(`^${shortcode}(\\d{3,5})`),
          `${targetShortcode}$1`
        );
        const targetFolder = targetTypeConfig?.folder || 'uncategorized';
        const newPath = path.join(
          this.projectPath,
          config.paths?.notesRoot || '_scepter',
          targetFolder,
          newFileName
        );

        result.details!.affectedNotes.push({
          id: note.id,
          title: note.title || '',
          path: path.relative(this.projectPath, oldPath),
          action: 'moved' as const,
          newPath: path.relative(this.projectPath, newPath)
        });
      }
    }

    // Will update config and remove folder (if one exists)
    result.changes.configUpdates = 1;
    result.changes.foldersRemoved = typeConfig.folder ? 1 : 0;

    // If dry run, return here
    if (options?.dryRun) {
      return result;
    }

    // Mark as will be executed
    result.executed = true;

    // Create backup
    const backupPath = await this.configManager.createBackup();

    try {
      // Execute the strategy via storage interfaces
      // @implements {DD010.§DC.27} deleteNoteType delegates to noteStorage
      if (strategy === 'archive') {
        if (this.noteStorage) {
          await this.noteStorage.archiveNotesOfType(typeName);
        }
      } else if (strategy === 'move-to-uncategorized') {
        const targetType = options?.targetType || 'Uncategorized';
        if (!config.noteTypes[targetType] && targetType === 'Uncategorized') {
          await this.configManager.addNoteType('Uncategorized', {
            shortcode: 'U',
            folder: 'uncategorized',
            description: 'Uncategorized notes from deleted types'
          });
        }

        const targetTypeConfig = config.noteTypes[targetType] ||
          { shortcode: 'U', folder: 'uncategorized' };
        const targetShortcode = targetTypeConfig.shortcode || 'U';

        if (this.noteStorage) {
          await this.noteStorage.renameNotesOfType(typeName, targetType, targetShortcode);
        }
      }

      // Remove the type from config
      await this.configManager.removeNoteType(typeName);

      // Remove empty folder via filesystem utilities (only if type has a folder)
      if (typeConfig.folder) {
        const typeFolder = path.join(
          this.projectPath,
          config.paths?.notesRoot || '_scepter',
          typeConfig.folder
        );
        await fsProjectUtils.removeEmptyDirectory(typeFolder);
      }

      // Reinitialize to pick up changes
      await this.noteManager.initialize();

    } catch (error) {
      // Restore from backup on error
      await this.configManager.restoreBackup(backupPath);
      throw error;
    }

    return result;
  }

  // Helper methods

  private validateTypeInputs(name: string, shortcode: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate name
    if (!name || !name.match(/^[A-Za-z]/)) {
      errors.push('Type name must start with a letter');
    }

    // Validate shortcode
    if (!shortcode || !shortcode.match(/^[A-Z]{1,5}$/i)) {
      errors.push('Shortcode must be 1-5 letters');
    }

    return { isValid: errors.length === 0, errors };
  }

  private pluralize(word: string): string {
    // Simple pluralization
    if (word.endsWith('y')) {
      return word.slice(0, -1) + 'ies';
    }
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch')) {
      return word + 'es';
    }
    return word + 's';
  }
}
