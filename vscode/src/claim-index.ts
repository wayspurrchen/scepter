import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
// @implements {DD012.§DC.04} Import domain types from core barrel instead of duplicating
import type { ClaimIndexEntry, ClaimCrossReference, ClaimIndexData, SourceReference, TraceabilityMatrix, ConfidenceAuditResult } from 'scepter';
// @implements {DD012.§DC.07} ProjectManager as composition root
// @implements {DD012.§DC.08} ClaimIndex.build from core
// @implements {DD012.§DC.10} Note content reading via core
// @implements {DD013.§DC.07} View-oriented accessor methods
import {
  createFilesystemProject,
  type ProjectManager,
  type NoteWithContent,
  ClaimIndex,
  buildTraceabilityMatrix,
  auditConfidence,
} from 'scepter';

export type { ClaimIndexEntry, ClaimCrossReference, ClaimIndexData, SourceReference, TraceabilityMatrix, ConfidenceAuditResult };

// @implements {DD013.§DC.07} View-oriented accessor interfaces
export interface SectionWithClaims {
  sectionPath: string;
  sectionHeading: string;
  claims: ClaimIndexEntry[];
}

export interface NoteReferences {
  outgoing: Array<{ noteId: string; noteInfo: NoteInfo | undefined }>;
  incoming: Array<{ noteId: string; noteInfo: NoteInfo | undefined }>;
  source: SourceReference[];
}

export interface TraceResult {
  entry: ClaimIndexEntry;
  incoming: ClaimCrossReference[];
  verification?: {
    date: string;
    actor: string;
    method: string;
  };
  derivatives: string[];
}

export interface NoteInfo {
  noteId: string;
  noteType: string;
  noteFilePath: string;
  /** Full title extracted from file name, e.g. "Claim Index Search" */
  noteTitle: string;
  claimCount: number;
}

/**
 * Extract the human-readable title from a note file path.
 *
 * Handles two cases:
 * 1. Flat note:   ".../R007 Claim Index Search.md"     → "Claim Index Search"
 * 2. Folder note: ".../ARCH017 Versioned JSON/ARCH017.md" → "Versioned JSON"
 *
 * Falls back to reading the first H1 heading from the file.
 */
function extractNoteTitle(filePath: string, projectDir: string): string {
  const segments = filePath.replace(/\\/g, '/').split('/');
  const basename = segments.pop() ?? '';
  const parentDir = segments.pop() ?? '';
  const withoutExt = basename.replace(/\.md$/i, '');

  // Try the filename first: "R007 Claim Index Search"
  const fileMatch = withoutExt.match(/^[A-Z]{1,5}\d{3,5}\s+(.+)$/);
  if (fileMatch) return fileMatch[1];

  // Try the parent folder: "ARCH017 Versioned JSON Blob Migration Primitive"
  const dirMatch = parentDir.match(/^[A-Z]{1,5}\d{3,5}\s+(.+)$/);
  if (dirMatch) return dirMatch[1];

  // Try reading the first H1 from the file
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
    const content = fs.readFileSync(absPath, 'utf-8');
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      // Strip note ID prefix from heading too: "# ARCH017 — Versioned JSON" → "Versioned JSON"
      const heading = h1Match[1];
      const cleaned = heading.replace(/^[A-Z]{1,5}\d{3,5}\s*[—–-]\s*/, '');
      return cleaned || heading;
    }
  } catch {
    // File not readable, fall through
  }

  return withoutExt;
}

/**
 * Manages the cached claim index using the core library API directly.
 * @implements {DD012.§DC.07} ProjectManager as composition root
 */
export class ClaimIndexCache {
  private entries = new Map<string, ClaimIndexEntry>();
  private crossRefs: ClaimCrossReference[] = [];
  private noteMap = new Map<string, NoteInfo>();
  /** Reverse index: bare claim suffix (e.g. "DC.01") → fully qualified IDs */
  private suffixIndex = new Map<string, string[]>();
  projectDir: string;
  private outputChannel: vscode.OutputChannel;
  private projectManager: ProjectManager | null = null;
  /** Known shortcodes from config, used for pattern matching (DC.13) */
  knownShortcodes: Set<string> = new Set();
  // @implements {DD012.§DC.15} Config-driven file watchers
  private fileWatchers: vscode.FileSystemWatcher[] = [];
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private isReconfiguring = false;
  private coreClaimIndex: ClaimIndex | null = null;
  /** Pre-cached raw markdown excerpts for notes */
  private noteExcerptCache = new Map<string, string>();
  /** Pre-rendered HTML excerpts for the markdown preview tooltips */
  private htmlExcerptCache = new Map<string, string>();
  /** Standalone markdown-it instance for rendering excerpts (no plugins) */
  private excerptMd: any = null;
  private _onDidRefresh = new vscode.EventEmitter<void>();
  readonly onDidRefresh = this._onDidRefresh.event;
  private ready: Promise<void>;
  private resolveReady!: () => void;

  constructor(projectDir: string, outputChannel: vscode.OutputChannel) {
    this.projectDir = projectDir;
    this.outputChannel = outputChannel;
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  // @implements {DD012.§DC.07} Initialize ProjectManager from core
  async initialize(): Promise<void> {
    try {
      this.projectManager = await createFilesystemProject(this.projectDir);
      await this.projectManager.initialize();

      // Build knownShortcodes from config for pattern matching (DC.13)
      const config = this.projectManager.configManager.getConfig();
      this.knownShortcodes = new Set(
        Object.values(config.noteTypes).map(nt => nt.shortcode)
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[ClaimIndex] ProjectManager init failed: ${message}`);
    }

    await this.refresh();
    this.setupFileWatcher();
  }

  async waitUntilReady(): Promise<void> {
    return this.ready;
  }

  /** Look up a claim by its fully-qualified ID. */
  lookup(fqid: string): ClaimIndexEntry | undefined {
    return this.entries.get(fqid);
  }

  /** Look up a note by its ID (e.g. "R004", "T001"). */
  lookupNote(noteId: string): NoteInfo | undefined {
    return this.noteMap.get(noteId);
  }

  /**
   * Resolve a bare claim ID (e.g. "DC.01") to index entries.
   * If contextNoteId is provided, prefer matches from that note.
   * Returns all matching entries, best match first.
   */
  resolveBare(bareId: string, contextNoteId?: string): ClaimIndexEntry[] {
    const fqids = this.suffixIndex.get(bareId) ?? [];
    const entries = fqids
      .map((fqid) => this.entries.get(fqid))
      .filter((e): e is ClaimIndexEntry => e !== undefined);

    if (contextNoteId && entries.length > 1) {
      // Sort: entries from the context note first
      entries.sort((a, b) => {
        const aMatch = a.noteId === contextNoteId ? 0 : 1;
        const bMatch = b.noteId === contextNoteId ? 0 : 1;
        return aMatch - bMatch;
      });
    }

    return entries;
  }

  /**
   * Smart resolve: try FQID first, then bare claim with context.
   * Returns the best-matching entry or undefined.
   */
  resolve(id: string, contextNoteId?: string): ClaimIndexEntry | undefined {
    // Try exact FQID match
    const exact = this.entries.get(id);
    if (exact) return exact;

    // Try as contextNote.id (e.g. "DD001" + "DC.01" → "DD001.DC.01")
    if (contextNoteId) {
      const withNote = this.entries.get(`${contextNoteId}.${id}`);
      if (withNote) return withNote;
    }

    // Try bare suffix match
    const bare = this.resolveBare(id, contextNoteId);
    return bare[0];
  }

  /** Check if an ID resolves to a claim, note, or bare claim. */
  isKnown(id: string, contextNoteId?: string): boolean {
    if (this.entries.has(id)) return true;
    if (this.noteMap.has(id)) return true;
    if (contextNoteId && this.entries.has(`${contextNoteId}.${id}`)) return true;
    if (this.suffixIndex.has(id)) return true;
    return false;
  }

  /** Find all entries whose fullyQualified starts with a prefix. */
  findByPrefix(prefix: string): ClaimIndexEntry[] {
    const results: ClaimIndexEntry[] = [];
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix)) {
        results.push(entry);
      }
    }
    return results;
  }

  incomingRefs(fqid: string): ClaimCrossReference[] {
    return this.crossRefs.filter((ref) => ref.toClaim === fqid);
  }

  outgoingRefs(fqid: string): ClaimCrossReference[] {
    return this.crossRefs.filter((ref) => ref.fromClaim === fqid);
  }

  noteRefs(noteId: string): ClaimCrossReference[] {
    return this.crossRefs.filter(
      (ref) => ref.fromNoteId === noteId || ref.toNoteId === noteId
    );
  }

  claimsForNote(noteId: string): ClaimIndexEntry[] {
    const results: ClaimIndexEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.noteId === noteId) {
        results.push(entry);
      }
    }
    return results;
  }

  get size(): number {
    return this.entries.size;
  }

  get noteCount(): number {
    return this.noteMap.size;
  }

  /**
   * Read context lines around a claim from its source file.
   * Returns the lines from claim start to endLine (plus a few before for heading context).
   * @implements {DD012.§DC.12} Async readClaimContext using core file manager
   */
  async readClaimContext(entry: ClaimIndexEntry, contextLinesBefore = 1, maxLines = 15): Promise<string | null> {
    try {
      let content: string | null = null;
      if (this.projectManager) {
        // @implements {DD012.§DC.10} Note content reading via ProjectManager
        content = await this.projectManager.noteFileManager.getFileContents(entry.noteId);
      }
      if (content === null) {
        content = await fs.promises.readFile(this.resolveFilePath(entry.noteFilePath), 'utf-8');
      }
      const lines = content.split('\n');

      const startLine = Math.max(0, entry.line - 1 - contextLinesBefore);
      const endLine = Math.min(lines.length, (entry.endLine || entry.line) + maxLines - (entry.endLine - entry.line));
      const contextLines = lines.slice(startLine, endLine);

      return contextLines.join('\n');
    } catch {
      return null;
    }
  }

  /** All note IDs in the index. */
  getAllNoteIds(): string[] {
    return [...this.noteMap.keys()];
  }

  /** All claim entries in the index. */
  getAllClaimEntries(): Map<string, ClaimIndexEntry> {
    return this.entries;
  }

  /**
   * Get a cached excerpt for a note (sync, for use in the markdown-it plugin).
   */
  getNoteExcerptSync(noteId: string): string | null {
    return this.noteExcerptCache.get(noteId) ?? null;
  }

  /**
   * Get a cached claim context as raw markdown.
   */
  getClaimContextSync(entry: ClaimIndexEntry): string | null {
    return this.noteExcerptCache.get('claim:' + entry.fullyQualified) ?? null;
  }

  /**
   * Get a pre-rendered HTML excerpt for a note (for preview tooltips).
   */
  getNoteExcerptHtml(noteId: string): string | null {
    return this.htmlExcerptCache.get(noteId) ?? null;
  }

  /**
   * Get a pre-rendered HTML context for a claim (for preview tooltips).
   */
  getClaimContextHtml(fqid: string): string | null {
    return this.htmlExcerptCache.get('claim:' + fqid) ?? null;
  }

  private getExcerptRenderer(): any {
    if (!this.excerptMd) {
      try {
        const MarkdownIt = require('markdown-it');
        this.excerptMd = new MarkdownIt({ html: false, linkify: true, breaks: true });
      } catch {
        // markdown-it not available — return null and skip HTML rendering
        return null;
      }
    }
    return this.excerptMd;
  }

  private renderMarkdownToHtml(raw: string): string | null {
    const md = this.getExcerptRenderer();
    if (!md) return null;
    try {
      return md.render(raw).trim();
    } catch {
      return null;
    }
  }

  private async buildExcerptCache(): Promise<void> {
    this.noteExcerptCache = new Map();
    this.htmlExcerptCache = new Map();

    // Note excerpts: full content sans frontmatter/title
    for (const [noteId] of this.noteMap) {
      const raw = await this.readNoteExcerpt(noteId, Infinity);
      if (raw) {
        this.noteExcerptCache.set(noteId, raw);
        // Pre-render to HTML for preview tooltips (cap at ~50 lines for attribute size)
        const lines = raw.split('\n');
        const capped = lines.length > 50 ? lines.slice(0, 50).join('\n') + '\n\n---\n\n*…content continues*' : raw;
        const html = this.renderMarkdownToHtml(capped);
        if (html) {
          this.htmlExcerptCache.set(noteId, html);
        }
      }
    }

    // Claim contexts
    for (const [fqid, entry] of this.entries) {
      const raw = await this.readClaimContext(entry, 1, 200);
      if (raw) {
        this.noteExcerptCache.set('claim:' + fqid, raw);
        const html = this.renderMarkdownToHtml(raw);
        if (html) {
          this.htmlExcerptCache.set('claim:' + fqid, html);
        }
      }
    }
  }

  /**
   * Read an excerpt from a note's content, skipping frontmatter and the title heading.
   * Returns the first `maxLines` meaningful lines of content.
   */
  async readNoteExcerpt(noteId: string, maxLines = 15): Promise<string | null> {
    try {
      let content: string | null = null;
      if (this.projectManager) {
        content = await this.projectManager.noteFileManager.getFileContents(noteId);
      }
      if (content === null) {
        const noteInfo = this.noteMap.get(noteId);
        if (!noteInfo?.noteFilePath) return null;
        content = await fs.promises.readFile(this.resolveFilePath(noteInfo.noteFilePath), 'utf-8');
      }

      const lines = content.split('\n');
      let startIdx = 0;

      // Skip YAML frontmatter (--- ... ---)
      if (lines[0]?.trim() === '---') {
        startIdx = 1;
        while (startIdx < lines.length && lines[startIdx]?.trim() !== '---') {
          startIdx++;
        }
        startIdx++; // skip closing ---
      }

      // Skip the first H1 heading and any immediately following blank lines
      while (startIdx < lines.length && lines[startIdx]?.trim() === '') startIdx++;
      if (startIdx < lines.length && /^#\s/.test(lines[startIdx])) {
        startIdx++;
      }
      while (startIdx < lines.length && lines[startIdx]?.trim() === '') startIdx++;

      const endIdx = maxLines === Infinity ? lines.length : startIdx + maxLines;
      const excerpt = lines.slice(startIdx, endIdx);
      const text = excerpt.join('\n').trim();
      return text || null;
    } catch {
      return null;
    }
  }

  // @implements {DD012.§DC.08} ClaimIndex.build from core library
  async refresh(): Promise<void> {
    try {
      this.outputChannel.appendLine(
        `[ClaimIndex] Refreshing index from ${this.projectDir}...`
      );

      if (!this.projectManager) {
        this.outputChannel.appendLine('[ClaimIndex] No ProjectManager available, skipping refresh');
        this.resolveReady();
        return;
      }

      // Force the underlying caches to re-read from disk. Without this,
      // getAllNotes() returns the in-memory index built at activation time
      // and "Refresh claim index" appears to do nothing for files added or
      // changed since startup.
      await this.projectManager.noteManager.rescan();
      await this.projectManager.noteFileManager.buildIndex();
      if (this.projectManager.sourceScanner) {
        await this.projectManager.sourceScanner.refresh();
        this.projectManager.referenceManager.setSourceIndex(
          this.projectManager.sourceScanner.getIndex(),
        );
      }

      // Get all notes and build NoteWithContent array
      const allNotes = await this.projectManager.noteManager.getAllNotes();
      const notesWithContent: NoteWithContent[] = [];
      for (const note of allNotes) {
        const content = await this.projectManager.noteFileManager.getFileContents(note.id);
        if (content !== null) {
          notesWithContent.push({
            id: note.id,
            type: note.type,
            filePath: note.filePath || '',
            content,
          });
        }
      }

      // Build claim index using core library
      const claimIndex = new ClaimIndex();
      const data: ClaimIndexData = claimIndex.build(notesWithContent);

      // @implements {DD012.§DC.11} Source reference integration
      if (this.projectManager.sourceScanner) {
        const sourceRefs = this.projectManager.sourceScanner.getIndex().getAllReferences();
        if (sourceRefs.length > 0) {
          claimIndex.addSourceReferences(sourceRefs);
        }
      }

      // Store for reuse in trace() — avoids rebuilding on every trace call
      this.coreClaimIndex = claimIndex;

      // Populate from ClaimIndexData (which uses Maps)
      this.entries = data.entries;
      this.crossRefs = data.crossRefs ?? [];

      // Build suffix index (bare claim ID → FQIDs)
      this.suffixIndex = new Map();
      for (const [fqid, entry] of this.entries) {
        const bareId = `${entry.claimPrefix}.${String(entry.claimNumber).padStart(2, '0')}${entry.claimSubLetter ?? ''}`;
        const existing = this.suffixIndex.get(bareId) ?? [];
        existing.push(fqid);
        this.suffixIndex.set(bareId, existing);

        // Also index by claimId (which includes section: "1.AC.01")
        if (entry.claimId !== bareId) {
          const byClaimId = this.suffixIndex.get(entry.claimId) ?? [];
          byClaimId.push(fqid);
          this.suffixIndex.set(entry.claimId, byClaimId);
        }
      }

      // Build note-level map — include ALL notes, not just those with claims
      this.noteMap = new Map();
      const noteLookup = new Map(allNotes.map(n => [n.id, n]));

      // First: populate from noteTypes (covers zero-claim notes)
      if (data.noteTypes) {
        for (const [noteId, noteType] of data.noteTypes) {
          const note = noteLookup.get(noteId);
          const filePath = note?.filePath || '';
          this.noteMap.set(noteId, {
            noteId,
            noteType,
            noteFilePath: filePath,
            noteTitle: filePath ? extractNoteTitle(filePath, this.projectDir) : noteId,
            claimCount: 0,
          });
        }
      }

      // Then: enrich from claim entries
      for (const entry of this.entries.values()) {
        let info = this.noteMap.get(entry.noteId);
        if (!info) {
          info = {
            noteId: entry.noteId,
            noteType: entry.noteType,
            noteFilePath: entry.noteFilePath,
            noteTitle: extractNoteTitle(entry.noteFilePath, this.projectDir),
            claimCount: 0,
          };
          this.noteMap.set(entry.noteId, info);
        }
        if (!info.noteFilePath) {
          info.noteFilePath = entry.noteFilePath;
          info.noteTitle = extractNoteTitle(entry.noteFilePath, this.projectDir);
        }
        info.claimCount++;
      }

      // Pre-cache note excerpts for sync access in the markdown-it plugin
      await this.buildExcerptCache();

      this.outputChannel.appendLine(
        `[ClaimIndex] Loaded ${this.entries.size} claims across ${this.noteMap.size} notes, ${this.crossRefs.length} cross-refs, ${this.suffixIndex.size} bare suffixes`
      );

      if (data.errors?.length) {
        this.outputChannel.appendLine(
          `[ClaimIndex] ${data.errors.length} parse errors (use CLI for details)`
        );
      }

      this.resolveReady();
      this._onDidRefresh.fire();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[ClaimIndex] Refresh failed: ${message}`);
      vscode.window.showWarningMessage(
        `SCEpter: Failed to refresh claim index: ${message}`
      );
      this.resolveReady();
    }
  }

  // @implements {DD012.§DC.09} Trace via getDerivatives
  async trace(claimId: string): Promise<TraceResult | null> {
    try {
      const entry = this.entries.get(claimId);
      if (!entry) return null;

      const incoming = this.incomingRefs(claimId);

      // Use the ClaimIndex instance cached during refresh()
      const derivatives = this.coreClaimIndex?.getDerivatives(claimId) ?? [];

      return {
        entry,
        incoming,
        derivatives,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[ClaimIndex] Trace failed: ${message}`);
      return null;
    }
  }

  resolveFilePath(noteFilePath: string): string {
    if (path.isAbsolute(noteFilePath)) {
      return noteFilePath;
    }
    return path.join(this.projectDir, noteFilePath);
  }

  private debouncedRefresh(): void {
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.refreshDebounceTimer = setTimeout(() => this.refresh(), 2000);
  }

  // @implements {DD012.§DC.15} Discovery-path file watchers from config
  // @implements {DD012.§DC.16} Source code directory watchers when enabled
  private setupFileWatcher(): void {
    if (!this.projectManager) return;

    const config = this.projectManager.configManager.getConfig();
    const discoveryPaths = config.discoveryPaths || ['_scepter'];

    // DC.15: Create a watcher for each discovery path
    for (const dp of discoveryPaths) {
      const pattern = new vscode.RelativePattern(
        this.projectDir,
        `${dp}/**/*.md`,
      );
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(() => this.debouncedRefresh());
      watcher.onDidCreate(() => this.debouncedRefresh());
      watcher.onDidDelete(() => this.debouncedRefresh());
      this.fileWatchers.push(watcher);
    }

    // DC.16: Watch source code directories when source integration is enabled
    if (config.sourceCodeIntegration?.enabled) {
      const srcFolders = config.sourceCodeIntegration.folders || [];
      const srcExtensions = config.sourceCodeIntegration.extensions || ['.ts', '.js'];
      for (const folder of srcFolders) {
        const extGlob = srcExtensions.map(e => `*${e}`).join(',');
        const pattern = new vscode.RelativePattern(
          this.projectDir,
          `${folder}/**/{${extGlob}}`,
        );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidChange(() => this.debouncedRefresh());
        watcher.onDidCreate(() => this.debouncedRefresh());
        watcher.onDidDelete(() => this.debouncedRefresh());
        this.fileWatchers.push(watcher);
      }
    }

    // Watch config file for discovery path changes
    const configPattern = new vscode.RelativePattern(
      this.projectDir,
      '{scepter.config.json,_scepter/scepter.config.json}',
    );
    const configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);
    configWatcher.onDidChange(async () => {
      if (this.isReconfiguring) return;
      this.isReconfiguring = true;
      try {
        if (!this.projectManager) return;
        await this.projectManager.configManager.reloadConfig();
        this.disposeWatchers();
        this.setupFileWatcher();
        this.debouncedRefresh();
      } catch (err) {
        this.outputChannel.appendLine(`[ClaimIndex] Config reload failed: ${err}`);
      } finally {
        this.isReconfiguring = false;
      }
    });
    this.fileWatchers.push(configWatcher);
  }

  // --- View-oriented accessor methods ---
  // @implements {DD013.§DC.07} getNotesByType aggregation
  getNotesByType(): Map<string, NoteInfo[]> {
    const grouped = new Map<string, NoteInfo[]>();
    for (const info of this.noteMap.values()) {
      const existing = grouped.get(info.noteType) ?? [];
      existing.push(info);
      grouped.set(info.noteType, existing);
    }
    for (const [, notes] of grouped) {
      notes.sort((a, b) => a.noteId.localeCompare(b.noteId));
    }
    return grouped;
  }

  // @implements {DD013.§DC.07} getClaimsBySection aggregation
  getClaimsBySection(noteId: string): SectionWithClaims[] {
    const claims = this.claimsForNote(noteId);
    const sectionMap = new Map<string, SectionWithClaims>();

    // Build a section heading lookup from the claim tree if available
    const sectionHeadings = new Map<string, string>();
    const data = this.coreClaimIndex?.getData();
    if (data?.trees) {
      const treeRoots = data.trees.get(noteId);
      if (treeRoots) {
        this.collectSectionHeadings(treeRoots, [], sectionHeadings);
      }
    }

    for (const claim of claims) {
      const sectionKey = claim.sectionPath?.join('.') ?? '';
      const treeHeading = sectionHeadings.get(sectionKey);
      const heading = treeHeading
        ? `§${sectionKey} ${treeHeading}`
        : sectionKey ? `§${sectionKey}` : '(root)';
      if (!sectionMap.has(sectionKey)) {
        sectionMap.set(sectionKey, {
          sectionPath: sectionKey,
          sectionHeading: heading,
          claims: [],
        });
      }
      sectionMap.get(sectionKey)!.claims.push(claim);
    }

    const sections = [...sectionMap.values()].sort((a, b) =>
      a.sectionPath.localeCompare(b.sectionPath, undefined, { numeric: true })
    );
    for (const section of sections) {
      section.claims.sort((a, b) => a.line - b.line);
    }
    return sections;
  }

  /** Recursively collect section headings from the claim tree. */
  private collectSectionHeadings(
    nodes: any[],
    parentPath: number[],
    result: Map<string, string>,
  ): void {
    for (const node of nodes) {
      if (node.type === 'section' && node.sectionNumber != null) {
        const path = [...parentPath, node.sectionNumber];
        const key = path.join('.');
        // Strip leading "§N " or "§N.M " prefix from heading text
        const heading = (node.heading || '').replace(/^§[\d.]+\s*[-—–]?\s*/, '').trim();
        if (heading) {
          result.set(key, heading);
        }
        if (node.children) {
          this.collectSectionHeadings(node.children, path, result);
        }
      }
    }
  }

  // @implements {DD013.§DC.07} getReferencesForNote aggregation
  getReferencesForNote(noteId: string): NoteReferences {
    const outgoingRefs = this.projectManager?.referenceManager?.getReferencesFrom(noteId) ?? [];
    const incomingRefs = this.projectManager?.referenceManager?.getReferencesTo(noteId, false) ?? [];
    const sourceRefs = this.projectManager?.sourceScanner?.getReferencesToNote(noteId) ?? [];

    return {
      outgoing: outgoingRefs.map(ref => ({
        noteId: ref.toId,
        noteInfo: this.noteMap.get(ref.toId),
      })),
      incoming: incomingRefs.map(ref => ({
        noteId: ref.fromId,
        noteInfo: this.noteMap.get(ref.fromId),
      })),
      source: sourceRefs,
    };
  }

  // @implements {DD013.§DC.07} getTraceabilityData delegation to core
  getTraceabilityData(noteId: string): TraceabilityMatrix | null {
    if (!this.coreClaimIndex) return null;
    const data = this.coreClaimIndex.getData();
    if (!data) return null;
    return buildTraceabilityMatrix(noteId, data);
  }

  // @implements {DD013.§DC.07} getConfidenceAudit delegation to core
  async getConfidenceAudit(): Promise<ConfidenceAuditResult | null> {
    if (!this.projectManager) return null;
    const config = this.projectManager.configManager.getConfig();
    const srcConfig = config.sourceCodeIntegration;
    if (!srcConfig?.enabled) return null;
    return auditConfidence(this.projectDir, srcConfig);
  }

  // @implements {DD013.§DC.07} getKnownNoteTypes from config
  getKnownNoteTypes(): Map<string, { shortcode: string; description: string }> {
    const config = this.projectManager?.configManager.getConfig();
    if (!config) return new Map();
    const result = new Map<string, { shortcode: string; description: string }>();
    for (const [name, typeConfig] of Object.entries(config.noteTypes)) {
      result.set(name, {
        shortcode: typeConfig.shortcode,
        description: typeConfig.description || name,
      });
    }
    return result;
  }

  private disposeWatchers(): void {
    for (const watcher of this.fileWatchers) {
      watcher.dispose();
    }
    this.fileWatchers = [];
  }

  /**
   * Switch to a different SCEpter project directory.
   * Tears down the current project and re-initializes with the new one.
   * All providers listening to onDidRefresh will update automatically.
   */
  async switchProject(newProjectDir: string): Promise<void> {
    this.disposeWatchers();
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.projectManager?.removeAllListeners();
    this.projectManager = null;
    this.coreClaimIndex = null;

    // Clear all caches
    this.entries = new Map();
    this.crossRefs = [];
    this.noteMap = new Map();
    this.suffixIndex = new Map();
    this.knownShortcodes = new Set();
    this.noteExcerptCache = new Map();
    this.htmlExcerptCache = new Map();

    // Reset ready gate
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    this.projectDir = newProjectDir;
    this.outputChannel.appendLine(`[ClaimIndex] Switching to project: ${newProjectDir}`);
    await this.initialize();
  }

  dispose(): void {
    this.disposeWatchers();
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this._onDidRefresh.dispose();
    this.projectManager?.removeAllListeners();
  }
}
