/**
 * Notes Anywhere: Discovers notes by ID prefix across configurable directories.
 * Notes can live in arbitrary folders and are discovered by their ID prefix
 * (shortcode), not by folder location.
 */
import { EventEmitter } from 'events';
import { readFile, stat } from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import * as chokidar from 'chokidar';
import matter from 'gray-matter';
import type { Note, NoteMetadata } from '../types/note';
import type { ConfigManager } from '../config/config-manager';
import { detectFolderNote } from '../notes/folder-utils';

export interface DiscoverySource {
  type: string;
  pattern: string;
  shortcode?: string;
  extractId: (filename: string) => string | null;
  enrichNote: (note: Note, filePath: string) => Note;
}

/** Regex to extract a note ID from a filename: e.g. "D001 Title.md" → "D001" */
const NOTE_ID_REGEX = /^([A-Z]{1,5}\d{3,5})(?:\s|\.md|$)/;

/** Directories that are never note storage */
const EXCLUDED_DIRS = new Set(['_templates', '_prompts']);

/** Default glob excludes applied when scanning outside _scepter/ */
const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.vscode',
  '.idea',
];

export class UnifiedDiscovery extends EventEmitter {
  private sources: DiscoverySource[] = [];
  private watcher?: chokidar.FSWatcher;
  private noteIndex: Map<string, string> = new Map(); // id -> filePath
  /** Map from uppercase shortcode to type name, built from config */
  private shortcodeToType: Map<string, string> = new Map();

  constructor(
    private projectPath: string,
    private configManager: ConfigManager,
  ) {
    super();
  }

  async initialize(): Promise<void> {
    this.sources = [];
    this.buildShortcodeMap();
    this.registerDefaultSources();
  }

  /**
   * Build a map from shortcode → type name from config.
   */
  private buildShortcodeMap(): void {
    this.shortcodeToType.clear();
    const config = this.configManager.getConfig();

    for (const [typeName, typeConfig] of Object.entries(config.noteTypes)) {
      this.shortcodeToType.set(typeConfig.shortcode.toUpperCase(), typeName);
    }

    // Virtual type: Task (T shortcode) — only add if not already claimed by config
    if (!this.shortcodeToType.has('T')) {
      this.shortcodeToType.set('T', 'Task');
    }
  }

  /**
   * Extract the shortcode prefix from a note ID.
   * e.g. "D001" → "D", "REQ001" → "REQ"
   */
  private extractShortcodeFromId(noteId: string): string | null {
    const match = noteId.match(/^([A-Z]{1,5})\d+$/);
    return match ? match[1] : null;
  }

  /**
   * Resolve a note's type from its ID prefix using the shortcode map.
   */
  private resolveTypeFromId(noteId: string): string | null {
    const shortcode = this.extractShortcodeFromId(noteId);
    if (!shortcode) return null;
    return this.shortcodeToType.get(shortcode.toUpperCase()) || null;
  }

  /**
   * Get the resolved discovery paths from config, defaulting to ["_scepter"].
   */
  private getDiscoveryPaths(): string[] {
    const config = this.configManager.getConfig();
    return config.discoveryPaths || ['_scepter'];
  }

  /**
   * Get the combined exclude patterns (built-in defaults + user config).
   */
  private getExcludePatterns(): string[] {
    const config = this.configManager.getConfig();
    const userExcludes = config.discoveryExclude || [];
    return [...DEFAULT_EXCLUDES, ...userExcludes];
  }

  /**
   * Check whether a file path is in an excluded directory.
   */
  private isExcludedPath(filePath: string): boolean {
    const relativePath = path.relative(this.projectPath, filePath);
    const parts = relativePath.split(path.sep);

    // Check structural excludes (_templates, _prompts)
    if (parts.some((part) => EXCLUDED_DIRS.has(part))) return true;

    // Check configurable excludes
    const excludes = this.getExcludePatterns();
    if (parts.some((part) => excludes.includes(part))) return true;

    return false;
  }

  /**
   * Register discovery sources for each configured discovery path.
   */
  private registerDefaultSources(): void {
    const discoveryPaths = this.getDiscoveryPaths();

    for (const dp of discoveryPaths) {
      const absoluteBase = path.resolve(this.projectPath, dp);
      const pattern = path.join(absoluteBase, '**/*.md');

      const source: DiscoverySource = {
        type: 'note',
        pattern,
        extractId: (filename: string) => {
          const match = filename.match(NOTE_ID_REGEX);
          return match ? match[1] : null;
        },
        enrichNote: (note: Note, filePath: string) => {
          // Determine type from ID prefix
          const typeName = this.resolveTypeFromId(note.id);

          // Detect archive/deleted from path
          const tags = [...note.tags];
          if (filePath.includes('/_archive/') || filePath.includes('\\_archive\\')) {
            if (!tags.includes('archived')) tags.push('archived');
          }
          if (filePath.includes('/_deleted/') || filePath.includes('\\_deleted\\')) {
            if (!tags.includes('deleted')) tags.push('deleted');
          }

          return {
            ...note,
            type: typeName || note.type,
            tags,
            filePath,
          };
        },
      };

      this.sources.push(source);
    }
  }

  registerSource(source: DiscoverySource): void {
    this.sources.push(source);
  }

  /**
   * @deprecated Archive/delete sources are no longer separate — the single recursive glob catches everything.
   */
  areArchiveSourcesRegistered(): boolean {
    return true;
  }

  /**
   * @deprecated No-op. Archive and delete notes are now always discovered by the recursive glob.
   */
  registerArchiveDeleteSources(): void {
    // No-op: archive/deleted notes are discovered by the default patterns
  }

  getSources(): DiscoverySource[] {
    return [...this.sources];
  }

  async discoverAll(): Promise<Note[]> {
    const allNotes: Note[] = [];
    const seenIds = new Set<string>();

    for (const source of this.sources) {
      try {
        // Discover regular files
        const files = await glob(source.pattern);

        for (const filePath of files) {
          if (this.isExcludedPath(filePath)) continue;

          const note = await this.processFile(filePath, source);
          if (note && !seenIds.has(note.id)) {
            seenIds.add(note.id);
            allNotes.push(note);
            this.noteIndex.set(note.id, filePath);
            this.emit('note:discovered', note);
          }
        }

        // Discover folder-based notes
        const folderPattern = source.pattern.replace(/\*\.md$/, '*/');
        const allPaths = await glob(folderPattern);

        const folders = [];
        for (const p of allPaths) {
          if (this.isExcludedPath(p)) continue;
          try {
            const stats = await stat(p);
            if (stats.isDirectory()) {
              folders.push(p);
            }
          } catch {
            // Skip if path doesn't exist or we can't stat it
          }
        }

        for (const folderPath of folders) {
          const detection = await detectFolderNote(folderPath);
          if (detection.isFolder && detection.mainFile) {
            const note = await this.processFile(detection.mainFile, source, {
              isFolder: true,
              folderPath: folderPath,
            });
            if (note && !seenIds.has(note.id)) {
              seenIds.add(note.id);
              note.isFolder = true;
              note.folderPath = folderPath;

              allNotes.push(note);
              this.noteIndex.set(note.id, detection.mainFile);
              this.emit('note:discovered', note);
            }
          }
        }
      } catch (error) {
        console.error(`Error discovering files for pattern ${source.pattern}:`, error);
      }
    }

    return allNotes;
  }

  private async processFile(
    filePath: string,
    source: DiscoverySource,
    folderInfo?: { isFolder: boolean; folderPath: string },
  ): Promise<Note | null> {
    try {
      const filename = path.basename(filePath);
      const id = source.extractId(filename);

      if (!id) {
        return null;
      }

      const fileContent = await readFile(filePath, 'utf-8');

      // Parse frontmatter with gray-matter
      const { data: frontmatter, content: body } = matter(fileContent);

      // Extract title from filename (or folder name for folder-based notes)
      let title: string;
      if (folderInfo?.isFolder && folderInfo.folderPath) {
        const folderName = path.basename(folderInfo.folderPath);
        const folderTitleMatch = folderName.match(/^[A-Z]+\d+\s+(.+)$/);
        title = folderTitleMatch ? folderTitleMatch[1] : folderName;
      } else {
        const titleMatch = filename.match(/^[A-Z]+\d+\s+(.+)\.md$/);
        title = titleMatch ? titleMatch[1] : filename.replace('.md', '');
      }

      // Determine note type from ID prefix
      const noteType = this.resolveTypeFromId(id) || 'Unknown';

      // Parse tags - support string, comma-separated, or array
      let tags: string[] = [];
      if (frontmatter.tags) {
        if (Array.isArray(frontmatter.tags)) {
          tags = frontmatter.tags;
        } else if (typeof frontmatter.tags === 'string') {
          tags = frontmatter.tags
            .split(',')
            .map((c: string) => c.trim())
            .filter((c: string) => c);
        }
      }

      // Resolve created date with fallback chain
      let createdDate: Date;
      if (frontmatter.created) {
        createdDate = new Date(frontmatter.created);
      } else {
        const contentDate = this.extractCreatedDateFromContent(fileContent);
        if (contentDate) {
          createdDate = contentDate;
        } else {
          const fileStat = await stat(filePath);
          createdDate = fileStat.birthtime;
        }
      }

      const note: Note = {
        id,
        type: noteType,
        title,
        content: body,
        tags,
        created: createdDate,
        metadata: {
          ...frontmatter,
          created: createdDate,
        } as NoteMetadata,
      };

      // Apply source-specific enrichment (sets type, archive/deleted tags, filePath)
      return source.enrichNote(note, filePath);
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Attempt to extract a created date from the first few lines of file content.
   */
  private extractCreatedDateFromContent(fileContent: string): Date | null {
    const lines = fileContent.split('\n').slice(0, 10);
    for (const line of lines) {
      const match = line.match(/^[-*\s]*\*{0,2}created\*{0,2}\s*:\s*\*{0,2}\s*(.+?)\s*\*{0,2}\s*$/i);
      if (match) {
        const dateStr = match[1].trim();
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
    return null;
  }

  async watch(): Promise<void> {
    const discoveryPaths = this.getDiscoveryPaths();
    const excludes = this.getExcludePatterns();

    const watchPaths = discoveryPaths.map((dp) => path.resolve(this.projectPath, dp));

    const ignoredPatterns: Array<RegExp | string | ((path: string) => boolean)> = [
      /(^|[\/\\])\../, // dotfiles
      /_templates/,
      /_prompts/,
      ...excludes.map((ex) => new RegExp(`(^|[/\\\\])${ex}([/\\\\]|$)`)),
    ];

    this.watcher = chokidar.watch(watchPaths, {
      ignored: ignoredPatterns,
      persistent: true,
      ignoreInitial: true,
    });

    const mainSource = this.sources[0];
    if (!mainSource) return;

    this.watcher
      .on('add', async (filePath) => {
        if (!filePath.endsWith('.md')) return;
        if (this.isExcludedPath(filePath)) return;

        const note = await this.processFile(filePath, mainSource);
        if (note) {
          this.noteIndex.set(note.id, filePath);
          this.emit('note:added', note);
        }
      })
      .on('change', async (filePath) => {
        if (!filePath.endsWith('.md')) return;
        if (this.isExcludedPath(filePath)) return;

        const note = await this.processFile(filePath, mainSource);
        if (note) {
          this.emit('note:changed', note);
        }
      })
      .on('unlink', (filePath) => {
        for (const [id, notePath] of this.noteIndex.entries()) {
          if (notePath === filePath) {
            this.noteIndex.delete(id);
            this.emit('note:deleted', id);
            break;
          }
        }
      });
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }
}
