import { EventEmitter } from 'events';
import fs from 'fs-extra';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { glob } from 'glob';
import { parseNoteMentions, type NoteMention, type CommentPatterns } from '../parsers/note/note-parser';
import { SourceReferenceIndex } from '../references/source-reference-index';
import type { ConfigManager } from '../config/config-manager';
import type { SourceCodeIntegrationConfig } from '../types/config';
import type { SourceReference, Language, SourceReferenceType } from '../types/reference';

export interface ScanResult {
  filesScanned: number;
  referencesFound: number;
  duration: number;
}

export interface FileCacheEntry {
  mtime: number;
  references: SourceReference[];
}

export interface ScanError {
  type: 'file-scan' | 'watch' | 'config';
  filePath?: string;
  error: Error;
  message: string;
}

/**
 * Scans source code files for note references and maintains an index.
 *
 * Responsibilities:
 * - Discover source files based on configuration
 * - Extract note mentions using language-specific comment patterns
 * - Watch for file changes and update references
 * - Emit events for reference changes
 */
export class SourceCodeScanner extends EventEmitter {
  private config?: SourceCodeIntegrationConfig;
  private index: SourceReferenceIndex;
  private fileCache: Map<string, FileCacheEntry>;
  private watcher?: chokidar.FSWatcher;
  private isInitialized: boolean = false;

  constructor(
    private projectPath: string,
    private configManager: ConfigManager,
  ) {
    super();
    this.index = new SourceReferenceIndex();
    this.fileCache = new Map();
  }

  /**
   * Initialize scanner with configuration
   * @throws {Error} If source code integration is disabled
   */
  async initialize(): Promise<void> {
    const config = await this.configManager.getConfig();
    this.config = config.sourceCodeIntegration;

    if (!this.config?.enabled) {
      throw new Error('Source code integration is not enabled');
    }

    this.isInitialized = true;
    await this.scanAllFiles();
  }

  /**
   * Check if scanner is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Scan all configured source directories
   *
   * Side effects:
   * - Updates internal index
   * - Emits 'scan:complete' event with statistics
   * - May emit multiple 'reference:found' events
   */
  async scanAllFiles(): Promise<ScanResult> {
    if (!this.config) {
      throw new Error('Scanner not initialized');
    }

    const startTime = Date.now();
    const files = await this.discoverSourceFiles();
    let totalReferences = 0;
    const errors: ScanError[] = [];

    for (const file of files) {
      try {
        const refs = await this.scanFile(file);
        totalReferences += refs.length;
      } catch (error) {
        this.handleFileError(file, error as Error);
        errors.push({
          type: 'file-scan',
          filePath: file,
          error: error as Error,
          message: `Failed to scan ${file}: ${(error as Error).message}`,
        });
      }
    }

    const result: ScanResult = {
      filesScanned: files.length,
      referencesFound: totalReferences,
      duration: Date.now() - startTime,
    };

    this.emit('scan:complete', result, errors);
    return result;
  }

  /**
   * Scan a single file for note references
   *
   * @returns Array of source references found
   *
   * Side effects:
   * - Updates file cache
   * - Updates index
   * - May emit 'reference:found' events
   */
  async scanFile(filePath: string): Promise<SourceReference[]> {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.projectPath, filePath);
    const fileStat = await fs.stat(absolutePath);

    // Check cache
    const cached = this.fileCache.get(absolutePath);
    if (cached && cached.mtime >= fileStat.mtime.getTime()) {
      return cached.references;
    }

    const content = await fs.readFile(absolutePath, 'utf8');
    const language = this.detectLanguage(filePath);
    const commentPatterns = this.getCommentPatterns(language);

    const mentions = parseNoteMentions(content, {
      commentPatterns,
      includeContext: true,
      filePath: absolutePath,
    });

    const references = mentions.map((mention) => this.mentionToReference(mention, absolutePath, language));

    // Remove old references from this file
    this.index.removeFileReferences(absolutePath);

    // Update cache
    this.fileCache.set(absolutePath, {
      mtime: fileStat.mtime.getTime(),
      references,
    });

    // Update index
    for (const ref of references) {
      this.index.addReference(ref);
      this.emit('reference:found', ref);
    }

    return references;
  }

  /**
   * Start watching source files for changes
   *
   * Side effects:
   * - Creates filesystem watchers
   * - Will emit events on file changes
   * - Consumes system resources
   */
  async startWatching(): Promise<void> {
    if (!this.config) {
      throw new Error('Scanner not initialized');
    }

    if (this.watcher) return;

    this.watcher = chokidar.watch(this.config.folders, {
      ignored: this.config.exclude,
      cwd: this.projectPath,
      ignoreInitial: true,
    });

    this.watcher
      .on('add', (path: string) => this.handleFileAdded(path))
      .on('change', (path: string) => this.handleFileChanged(path))
      .on('unlink', (path: string) => this.handleFileRemoved(path))
      .on('error', (error: unknown) => this.handleWatchError(error as Error));

    this.emit('watch:started');
  }

  /**
   * Stop watching source files
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      // Race chokidar close against a short timeout. See note-file-manager.ts
      // stopWatching for the macOS Sonoma fs_events teardown issue.
      const closed = this.watcher.close().catch(() => {});
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 250));
      await Promise.race([closed, timeout]);
      this.watcher = undefined;
      this.emit('watch:stopped');
    }
  }

  /**
   * Get all source references for a note
   */
  getReferencesToNote(noteId: string): SourceReference[] {
    return this.index.getReferencesToNote(noteId);
  }

  /**
   * Get all notes referenced in a file
   */
  getReferencesFromFile(filePath: string): SourceReference[] {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.projectPath, filePath);
    return this.index.getReferencesFromFile(absolutePath);
  }

  /**
   * Get index statistics
   */
  getStats(): Readonly<ReturnType<SourceReferenceIndex['getStats']>> {
    return this.index.getStats();
  }

  /**
   * Clear all cached data and rescan
   */
  async refresh(): Promise<ScanResult> {
    this.fileCache.clear();
    this.index.clear();
    return this.scanAllFiles();
  }

  /**
   * Get the internal index (for integration with ReferenceManager)
   */
  getIndex(): SourceReferenceIndex {
    return this.index;
  }

  // Private helper methods

  private async discoverSourceFiles(): Promise<string[]> {
    if (!this.config) return [];

    const files: string[] = [];

    for (const folder of this.config.folders) {
      const pattern = path.join(folder, '**/*');
      const matches = await glob(pattern, {
        cwd: this.projectPath,
        ignore: this.config.exclude,
        nodir: true,
        dot: true,
      });

      const sourceFiles = matches.filter((file) => this.config!.extensions.some((ext) => file.endsWith(ext)));

      files.push(...sourceFiles);
    }

    return files;
  }

  private detectLanguage(filePath: string): Language {
    const ext = path.extname(filePath);

    const languageMap: Record<string, Language> = {
      '.ts': 'typescript',
      '.js': 'javascript',
      '.tsx': 'typescript',
      '.jsx': 'javascript',
      '.py': 'python',
    };

    return languageMap[ext] || 'unknown';
  }

  private getCommentPatterns(language: Language): CommentPatterns {
    const patterns: Record<Language, CommentPatterns> = {
      javascript: {
        single: /^\/\//,
        blockStart: /\/\*/,
        blockEnd: /\*\//,
        blockLine: /^\s*\*/,
      },
      typescript: {
        single: /^\/\//,
        blockStart: /\/\*/,
        blockEnd: /\*\//,
        blockLine: /^\s*\*/,
      },
      python: {
        single: /^#/,
        blockStart: /^"""/,
        blockEnd: /^"""/,
      },
      unknown: {
        single: /^\/\//,
      },
    };

    return patterns[language] || patterns.unknown;
  }

  private mentionToReference(mention: NoteMention, filePath: string, language: Language): SourceReference {
    const ref: SourceReference = {
      fromId: `source:${filePath}`,
      toId: mention.id,
      sourceType: 'source',
      filePath,
      line: mention.line,
      context: mention.context,
      modifier: this.extractModifierFromMention(mention),
      language,
      referenceType: this.detectReferenceType(mention.context),
    };

    if (mention.claimPath) {
      ref.claimPath = mention.claimPath;
    }

    return ref;
  }

  private extractModifierFromMention(mention: NoteMention): string | undefined {
    if (!mention.inclusionModifiers) return undefined;

    const modifiers: string[] = [];
    if (mention.inclusionModifiers.content) modifiers.push('+');
    if (mention.inclusionModifiers.outgoingReferences) modifiers.push('>');
    if (mention.inclusionModifiers.incomingReferences) modifiers.push('<');
    if (mention.inclusionModifiers.contextHints) modifiers.push('$');
    if (mention.inclusionModifiers.everything) modifiers.push('*');

    return modifiers.length > 0 ? modifiers.join('') : undefined;
  }

  private detectReferenceType(context?: string): SourceReferenceType {
    if (!context) return 'mentions';

    const patterns = {
      implements: /(?:@implements|implements)$/i,
      'depends-on': /(?:@depends-on|depends\s+on)$/i,
      addresses: /(?:@addresses|addresses)$/i,
      validates: /(?:@validates|validates)$/i,
      'blocked-by': /(?:@blocked-by|blocked\s+by)$/i,
      see: /(?:@see|see)$/i,
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(context)) {
        return type as SourceReferenceType;
      }
    }

    return 'mentions';
  }

  private async handleFileAdded(filePath: string): Promise<void> {
    try {
      await this.scanFile(filePath);
      this.emit('file:added', filePath);
    } catch (error) {
      this.handleFileError(filePath, error as Error);
    }
  }

  private async handleFileChanged(filePath: string): Promise<void> {
    try {
      await this.scanFile(filePath);
      this.emit('file:updated', filePath);
    } catch (error) {
      this.handleFileError(filePath, error as Error);
    }
  }

  private async handleFileRemoved(filePath: string): Promise<void> {
    const absolutePath = path.resolve(this.projectPath, filePath);
    this.index.removeFileReferences(absolutePath);
    this.fileCache.delete(absolutePath);
    this.emit('file:removed', filePath);
  }

  private handleFileError(filePath: string, error: Error): void {
    this.emit('error', {
      type: 'file-scan',
      filePath,
      error,
      message: `Failed to scan ${filePath}: ${error.message}`,
    });
  }

  private handleWatchError(error: Error): void {
    this.emit('error', {
      type: 'watch',
      error,
      message: `File watching error: ${error.message}`,
    });
  }
}
