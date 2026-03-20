import { EventEmitter } from 'events';
import { ConfigManager } from '../config/config-manager';
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
import type { SCEpterConfig } from '../types/config';
import type { SimpleLLMFunction } from '../llm/types';
import * as fs from 'fs/promises';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
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
}

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

export interface ProjectStatistics {
  totalNotes: number;
  notesByType: Record<string, number>;
  notesByMode: Record<string, number>;
  lastModified: Date | null;
  projectSize: number; // in bytes
}

export interface ProjectMetadata {
  version: string;
  createdAt: string;
  scepterVersion: string;
  lastUpdated?: string;
}

const SCEPTER_VERSION = '1.0.0';
const PROJECT_VERSION = '1.0.0';

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

  private validationErrors: ValidationError[] = [];
  private llmFunction?: SimpleLLMFunction;

  constructor(
    public projectPath: string,
    deps: ProjectManagerDependencies = {},
  ) {
    super();

    // Store LLM function for TaskDispatcher creation
    this.llmFunction = deps.llmFunction;

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
  }

  async initialize(options?: { includeArchived?: boolean; includeDeleted?: boolean; startWatchers?: boolean }): Promise<void> {
    try {
      // First check if we can access the project path at all
      try {
        await fs.access(this.projectPath, fs.constants.W_OK);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Try to create the project path
          try {
            await fs.mkdir(this.projectPath, { recursive: true });
          } catch (mkdirError: any) {
            if (mkdirError.code === 'EACCES' || mkdirError.code === 'EPERM') {
              throw new Error(`Permission denied: cannot create project directory`);
            }
            throw new Error(`Invalid project path: ${this.projectPath}`);
          }
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
          throw new Error(`Permission denied: cannot access project directory`);
        }
      }

      // Check for any existing directories with permission issues
      try {
        const entries = await fs.readdir(this.projectPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const dirPath = path.join(this.projectPath, entry.name);
            try {
              await fs.access(dirPath, fs.constants.R_OK);
            } catch (error: any) {
              if (error.code === 'EACCES' || error.code === 'EPERM') {
                throw new Error(`Permission denied: cannot access directory ${entry.name}`);
              }
            }
          }
        }
      } catch (error: any) {
        if (error.message && error.message.includes('Permission denied')) {
          throw error;
        }
        // Ignore other errors
      }

      // Load config from filesystem if not already loaded
      // This makes initialize() more robust and prevents "No configuration loaded" errors
      let config: SCEpterConfig;
      try {
        config = this.configManager.getConfig();
      } catch (error) {
        // Config not loaded yet, try to load it
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

      // Create base directories
      await this.createBaseDirectories(config);

      // Create note type directories
      await this.createNoteTypeDirectories(config);

      // Create project metadata - now handled by scepter.config.json
      // await this.createProjectMetadata(config);

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
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Permission denied')) {
          throw error;
        }
        if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
          throw new Error(`Permission denied while initializing project: ${error.message}`);
        }
        // Only treat ENOENT as invalid path if it's about the project path itself
        if (error.message.includes('ENOENT') && error.message.includes('/invalid/')) {
          throw new Error(`Invalid project path: ${this.projectPath}`);
        }
      }
      throw error;
    }
  }

  async validateStructure(): Promise<boolean> {
    this.validationErrors = [];
    const checkedPaths: string[] = [];

    try {
      const config = await this.configManager.getConfig();

      // Check base directories
      const dataDir = path.join(this.projectPath, config.paths?.dataDir || '_scepter');
      const notesRoot = path.join(this.projectPath, config.paths?.notesRoot || '_scepter');

      await this.checkDirectory(dataDir, checkedPaths);
      await this.checkDirectory(notesRoot, checkedPaths);

      // Check optional directories only if they exist (don't flag missing ones as errors)
      await this.checkOptionalDirectory(path.join(this.projectPath, '_scepter/_templates'), checkedPaths);
      await this.checkOptionalDirectory(path.join(this.projectPath, '_scepter/_prompts'), checkedPaths);
      await this.checkOptionalDirectory(path.join(notesRoot, '_templates'), checkedPaths);

      // Check note type directories (only for types with a folder defined)
      for (const [key, noteType] of Object.entries(config.noteTypes)) {
        if (noteType.folder) {
          const noteTypePath = path.join(notesRoot, noteType.folder);
          await this.checkDirectory(noteTypePath, checkedPaths);
        }
      }

    } catch (error) {
      // Config loading error
      this.validationErrors.push({
        type: 'missing_directory',
        path: this.projectPath,
        message: 'Failed to load configuration',
      });
    }

    return this.validationErrors.length === 0;
  }

  async getValidationErrors(): Promise<ValidationError[]> {
    return [...this.validationErrors];
  }

  async getValidationReport(): Promise<ValidationReport> {
    await this.validateStructure();

    const warnings: ValidationError[] = [];
    const checkedPaths: string[] = [];

    // Re-run validation to collect all checked paths
    try {
      const config = await this.configManager.getConfig();
      const paths = [
        path.join(this.projectPath, config.paths?.dataDir || '_scepter'),
        path.join(this.projectPath, config.paths?.notesRoot || '_scepter'),
      ];

      for (const p of paths) {
        checkedPaths.push(p);
      }

      const notesRoot = path.join(this.projectPath, config.paths?.notesRoot || '_scepter');

      for (const noteType of Object.values(config.noteTypes)) {
        if (noteType.folder) {
          checkedPaths.push(path.join(notesRoot, noteType.folder));
        }
      }
    } catch { }

    return {
      isValid: this.validationErrors.length === 0,
      errors: [...this.validationErrors],
      warnings,
      checkedPaths,
    };
  }

  async updateStructure(): Promise<void> {
    const config = await this.configManager.getConfig();

    // Create any missing directories
    await this.createNoteTypeDirectories(config);

    this.emit('structure:updated');
  }

  async getCleanupSuggestions(): Promise<CleanupSuggestion[]> {
    const suggestions: CleanupSuggestion[] = [];
    const config = await this.configManager.getConfig();

    const notesRoot = path.join(this.projectPath, config.paths?.notesRoot || '_scepter');

    // Check for orphaned note type folders (only consider types that have folders)
    const expectedNoteFolders = new Set(
      Object.values(config.noteTypes)
        .map((nt) => nt.folder)
        .filter((f): f is string => !!f)
    );
    await this.checkOrphanedFolders(notesRoot, expectedNoteFolders, 'note type', suggestions);

    return suggestions;
  }

  async getStatistics(): Promise<ProjectStatistics> {
    const config = await this.configManager.getConfig();
    const notesRoot = path.join(this.projectPath, config.paths?.notesRoot || '_scepter');

    let totalNotes = 0;
    const notesByType: Record<string, number> = {};
    const notesByMode: Record<string, number> = {};
    let lastModified: Date | null = null;
    let projectSize = 0;

    // Use NoteManager for accurate statistics
    const stats = await this.noteManager.getStatistics();
    totalNotes = stats.totalNotes;
    Object.assign(notesByType, stats.notesByType);

    // Still need to calculate lastModified and projectSize from filesystem
    for (const [key, noteType] of Object.entries(config.noteTypes)) {
      if (!noteType.folder) continue;

      const noteTypePath = path.join(notesRoot, noteType.folder);

      // Update last modified
      const dirMtime = await this.getLastModifiedInDirectory(noteTypePath);
      if (dirMtime && (!lastModified || dirMtime > lastModified)) {
        lastModified = dirMtime;
      }

      // Add to project size
      projectSize += await this.getDirectorySize(noteTypePath);
    }

    return {
      totalNotes,
      notesByType,
      notesByMode,
      lastModified,
      projectSize,
    };
  }

  static async findProjectRoot(startPath: string): Promise<string | null> {
    let currentPath = path.resolve(startPath);

    while (currentPath !== path.dirname(currentPath)) {
      // Check for SCEpter markers - specifically the project metadata file
      try {
        const hasConfigJs = await fs
          .access(path.join(currentPath, 'scepter.config.js'))
          .then(() => true)
          .catch(() => false);

        const hasScepterConfigJson = await fs
          .access(path.join(currentPath, '_scepter', 'scepter.config.json'))
          .then(() => true)
          .catch(() => false);

        const hasLegacyConfigJson = await fs
          .access(path.join(currentPath, '_scepter', 'config.json'))
          .then(() => true)
          .catch(() => false);

        if (hasConfigJs || hasScepterConfigJson || hasLegacyConfigJson) {
          return currentPath;
        }
      } catch { }

      currentPath = path.dirname(currentPath);
    }

    return null;
  }

  // Private helper methods

  private async createBaseDirectories(config: SCEpterConfig): Promise<void> {
    const notesRoot = config.paths?.notesRoot || '_scepter';
    const dirs = [
      path.join(this.projectPath, config.paths?.dataDir || '_scepter'),
      path.join(this.projectPath, notesRoot),
      // Only include _templates/_prompts if they already exist on disk
    ];

    // Conditionally include optional directories only if they already exist
    const optionalDirs = [
      path.join(this.projectPath, '_scepter/_templates'),
      path.join(this.projectPath, '_scepter/_prompts'),
      path.join(this.projectPath, notesRoot, '_templates'),
    ];
    for (const optDir of optionalDirs) {
      try {
        const stats = await fs.stat(optDir);
        if (stats.isDirectory()) {
          dirs.push(optDir);
        }
      } catch {
        // Directory doesn't exist — don't create it
      }
    }

    for (const dir of dirs) {
      try {
        // Check parent directory for permission issues
        const parentDir = path.dirname(dir);
        if (parentDir !== this.projectPath) {
          try {
            await fs.access(parentDir, fs.constants.W_OK);
          } catch (error: any) {
            if (error.code === 'EACCES' || error.code === 'EPERM') {
              throw new Error(`Permission denied: cannot access ${parentDir}`);
            }
          }
        }

        await fs.mkdir(dir, { recursive: true });
      } catch (error: any) {
        if (error.code === 'EACCES' || error.code === 'EPERM') {
          throw new Error(`Permission denied: ${error.message}`);
        }
        throw error;
      }
    }
  }

  private async createNoteTypeDirectories(config: SCEpterConfig): Promise<void> {
    const notesRoot = path.join(this.projectPath, config.paths?.notesRoot || '_scepter');

    for (const [key, noteType] of Object.entries(config.noteTypes)) {
      // Only create directories for types that have a folder defined
      if (!noteType.folder) continue;

      const noteTypePath = path.join(notesRoot, noteType.folder);
      try {
        await fs.mkdir(noteTypePath, { recursive: true });
      } catch (error: any) {
        if (error.code === 'EACCES' || error.code === 'EPERM') {
          throw new Error(`Permission denied: ${error.message}`);
        }
        throw error;
      }

      // Create .gitkeep if directory is empty
      await this.ensureGitkeep(noteTypePath);
    }
  }

  private async createProjectMetadata(config: SCEpterConfig): Promise<void> {
    const metadataPath = path.join(this.projectPath, config.paths?.dataDir || '_scepter', 'project.json');

    const metadata: ProjectMetadata = {
      version: PROJECT_VERSION,
      createdAt: new Date().toISOString(),
      scepterVersion: SCEPTER_VERSION,
    };

    // Don't overwrite existing metadata
    try {
      await fs.access(metadataPath);
    } catch {
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    }
  }

  private async ensureGitkeep(dirPath: string): Promise<void> {
    const gitkeepPath = path.join(dirPath, '.gitkeep');

    try {
      const files = await fs.readdir(dirPath);
      // Only create .gitkeep if directory is empty or only has .gitkeep
      if (files.length === 0 || (files.length === 1 && files[0] === '.gitkeep')) {
        // IMPORTANT: do not rewrite .gitkeep if it already exists; this can cause
        // dev servers (Vite/HMR) to hot-reload on every request if initialization
        // runs often (e.g., per web request).
        try {
          await fs.writeFile(gitkeepPath, '', { flag: 'wx' });
        } catch {
          // ignore if already exists or cannot be created
        }
      }
    } catch {
      // Directory doesn't exist or other error
    }
  }

  private async checkDirectory(dirPath: string, checkedPaths: string[]): Promise<void> {
    checkedPaths.push(dirPath);

    try {
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) {
        this.validationErrors.push({
          type: 'not_a_directory',
          path: dirPath,
          message: `Path exists but is not a directory: ${dirPath}`,
        });
      }
    } catch (error) {
      this.validationErrors.push({
        type: 'missing_directory',
        path: dirPath,
        message: `Required directory is missing: ${dirPath}`,
      });
    }
  }

  /**
   * Check an optional directory — only flag errors if it exists but is not a directory.
   * Missing directories are silently ignored.
   */
  private async checkOptionalDirectory(dirPath: string, checkedPaths: string[]): Promise<void> {
    try {
      const stats = await fs.stat(dirPath);
      checkedPaths.push(dirPath);
      if (!stats.isDirectory()) {
        this.validationErrors.push({
          type: 'not_a_directory',
          path: dirPath,
          message: `Path exists but is not a directory: ${dirPath}`,
        });
      }
    } catch {
      // Directory doesn't exist — that's fine for optional directories
    }
  }

  private async checkOrphanedFolders(
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
          const hasContent = await this.directoryHasContent(folderPath);

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

  private async directoryHasContent(dirPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(dirPath);
      return files.some((f) => f !== '.gitkeep');
    } catch {
      return false;
    }
  }

  private async countFilesInDirectory(dirPath: string, extension: string): Promise<number> {
    let count = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(extension)) {
          count++;
        } else if (entry.isDirectory()) {
          count += await this.countFilesInDirectory(path.join(dirPath, entry.name), extension);
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return count;
  }

  private async getLastModifiedInDirectory(dirPath: string): Promise<Date | null> {
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
          const subDirMtime = await this.getLastModifiedInDirectory(entryPath);
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

  private async getDirectorySize(dirPath: string): Promise<number> {
    let size = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        const stats = await fs.stat(entryPath);

        if (entry.isFile()) {
          size += stats.size;
        } else if (entry.isDirectory()) {
          size += await this.getDirectorySize(entryPath);
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return size;
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
   * Cleanup all watchers and resources
   */
  async cleanup(): Promise<void> {
    // Stop note manager watching
    if (this.noteManager) {
      await this.noteManager.stopWatching();
    }

    // Stop source scanner watching
    if (this.sourceScanner) {
      await this.sourceScanner.stopWatching();
    }
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
      const templatePath = path.join(
        this.projectPath,
        config.templates?.paths?.types || '_scepter/templates/types',
        `${typeName}.md`
      );
      const hasTemplate = await fsExtra.pathExists(templatePath);

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
      const folderPath = path.join(
        this.projectPath,
        config.paths?.notesRoot || '_scepter',
        folder
      );
      await fsExtra.ensureDir(folderPath);
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

    // Check for template
    const templatePath = path.join(
      this.projectPath,
      config.templates?.paths?.types || '_scepter/templates/types',
      `${oldName}.md`
    );
    try {
      await fs.access(templatePath);
      result.changes.templateRenames = 1;
    } catch {
      // No template exists
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

      // Update note files
      for (const noteFile of result.details!.noteFiles) {
        const oldFullPath = path.join(this.projectPath, noteFile.oldPath);
        const newFullPath = path.join(this.projectPath, noteFile.newPath);

        if (oldFullPath !== newFullPath) {
          await fs.rename(oldFullPath, newFullPath);
        }
      }

      // Update config
      if (oldName !== newName) {
        // Remove old type
        await this.configManager.removeNoteType(oldName);

        // Add new type
        await this.configManager.addNoteType(newName, {
          ...oldTypeConfig,
          shortcode: newShortcode,
          ...(options?.newDescription && { description: options.newDescription })
        });
      } else {
        // Just update the existing type
        await this.configManager.updateNoteType(oldName, {
          shortcode: newShortcode,
          ...(options?.newDescription && { description: options.newDescription })
        });
      }

      // Update template if exists
      if (result.changes.templateRenames > 0) {
        const oldTemplatePath = path.join(
          this.projectPath,
          config.templates?.paths?.types || '_scepter/templates/types',
          `${oldName}.md`
        );
        const newTemplatePath = path.join(
          this.projectPath,
          config.templates?.paths?.types || '_scepter/templates/types',
          `${newName}.md`
        );
        await fs.rename(oldTemplatePath, newTemplatePath);
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
      // Execute the strategy
      if (strategy === 'archive') {
        // Archive notes by moving them to an archive folder
        const archiveDir = path.join(
          this.projectPath,
          config.paths?.notesRoot || '_scepter',
          '.archive',
          typeName
        );
        await fsExtra.ensureDir(archiveDir);

        for (const note of affectedNotes) {
          const archivePath = path.join(archiveDir, path.basename(note.filePath || ''));
          await fs.rename(note.filePath || '', archivePath);
        }
      } else if (strategy === 'move-to-uncategorized') {
        // Ensure target type exists or create Uncategorized
        const targetType = options?.targetType || 'Uncategorized';
        if (!config.noteTypes[targetType] && targetType === 'Uncategorized') {
          await this.configManager.addNoteType('Uncategorized', {
            shortcode: 'U',
            folder: 'uncategorized',
            description: 'Uncategorized notes from deleted types'
          });
        }

        // Move notes to target type
        for (const noteDetail of result.details!.affectedNotes) {
          if (noteDetail.action === 'moved' && noteDetail.newPath) {
            const oldFullPath = path.join(this.projectPath, noteDetail.path);
            const newFullPath = path.join(this.projectPath, noteDetail.newPath);

            // Ensure target directory exists
            await fsExtra.ensureDir(path.dirname(newFullPath));

            // Move the file
            await fs.rename(oldFullPath, newFullPath);

            // Update note content to reflect new type
            const content = await fs.readFile(newFullPath, 'utf-8');
            const updatedContent = content.replace(
              /^type:\s*\w+$/m,
              `type: ${targetType}`
            );
            await fs.writeFile(newFullPath, updatedContent);
          }
        }
      }

      // Remove the type from config
      await this.configManager.removeNoteType(typeName);

      // Remove empty folder (only if type has a folder defined)
      if (typeConfig.folder) {
        const typeFolder = path.join(
          this.projectPath,
          config.paths?.notesRoot || '_scepter',
          typeConfig.folder
        );
        try {
          const remaining = await fs.readdir(typeFolder);
          if (remaining.length === 0) {
            await fs.rmdir(typeFolder);
          }
        } catch {
          // Folder might not exist or already be deleted
        }
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
