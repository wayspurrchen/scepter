import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
// @implements {DD012.§DC.04} Import domain types from core barrel instead of duplicating
import type { ClaimIndexEntry, ClaimCrossReference, ClaimIndexData, ClaimTreeError, ClaimNode, SourceReference, TraceabilityMatrix, ConfidenceAuditResult, Note } from 'scepter';
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
import { noteIdFromPath } from './patterns';

export type { ClaimIndexEntry, ClaimCrossReference, ClaimIndexData, ClaimTreeError, ClaimNode, SourceReference, TraceabilityMatrix, ConfidenceAuditResult };

// Bounded-concurrency parallel map. Used to keep file-read storms inside
// a sane handle/CPU budget while still being far faster than sequential
// awaits on multi-thousand-note projects.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * A section heading in a note, with enough metadata to render hovers,
 * navigate goto-definition, and decorate inline references.
 *
 * `fqid` is `{noteId}.{sectionPath.join('.')}` — e.g. `R005.1`, `DD036.2.3`.
 */
export interface SectionEntry {
  fqid: string;
  noteId: string;
  sectionId: string;
  sectionPath: number[];
  heading: string;
  line: number;
  endLine: number;
  noteFilePath: string;
  noteType: string;
}

// @implements {DD013.§DC.07} View-oriented accessor interfaces
export interface SectionWithClaims {
  sectionPath: string;
  sectionHeading: string;
  claims: ClaimIndexEntry[];
}

/**
 * A cross-project outgoing reference appearing in a local note. Per
 * R011.§4.AC.09, these MAY appear in the per-note outgoing-references
 * listing as long as they are visually distinguished from local refs.
 *
 * @implements {R011.§4.AC.09} cross-project outgoing refs in references view
 */
export interface CrossProjectOutgoingRef {
  aliasName: string;
  peerNoteId: string;
  /** The full raw reference (e.g., `vendor-lib/R005.§1.AC.01`). */
  raw: string;
  resolved: boolean;
}

export interface NoteReferences {
  outgoing: Array<{ noteId: string; noteInfo: NoteInfo | undefined }>;
  incoming: Array<{ noteId: string; noteInfo: NoteInfo | undefined }>;
  source: SourceReference[];
  /** Cross-project (alias-prefixed) outgoing references — kept SEPARATE
   * from `outgoing` so consumers can render them with a distinct badge
   * per R011.§4.AC.09. */
  crossProjectOutgoing: CrossProjectOutgoingRef[];
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
 * Walk a tree of ClaimNodes and invoke the visitor for every section. The
 * parser already encodes a section's full path in `node.id` (`## §3.1 Foo`
 * produces `id = "3.1"` regardless of whether it nests under `## §3` or sits
 * at the top), so we use `node.id` directly rather than rebuilding from
 * ancestor ids.
 */
function collectSections(
  nodes: ClaimNode[],
  visit: (node: ClaimNode, path: number[]) => void,
): void {
  for (const node of nodes) {
    if (node.type === 'section') {
      const path = node.id.split('.').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
      if (path.length > 0) visit(node, path);
    }
    if (node.children?.length) {
      collectSections(node.children, visit);
    }
  }
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
/**
 * A resolved cross-project alias entry. Mirrors the core's
 * `AliasResolution` shape but flattened for the extension's display
 * needs.
 *
 * @implements {R011.§4.AC.02} extension-side alias map
 */
export interface AliasMapEntry {
  aliasName: string;
  resolvedPath: string;
  resolved: boolean;
  /** When `resolved` is false, a human-readable reason. */
  unresolvedReason?: string;
  description?: string;
}

/** Cross-project lookup result for the extension providers. */
export type CrossProjectLookup =
  | { ok: true; entry: ClaimIndexEntry; aliasName: string; peerPath: string }
  | { ok: true; note: NoteInfo; aliasName: string; peerPath: string }
  | { ok: false; reason: string; aliasName: string };

export class ClaimIndexCache {
  private entries = new Map<string, ClaimIndexEntry>();
  private crossRefs: ClaimCrossReference[] = [];
  /**
   * Cross-project (alias-prefixed) references encountered in local
   * notes' content. Kept SEPARATE from `crossRefs` so they don't
   * pollute the local trace matrix or gap report per R011.§3.AC.04.
   *
   * @implements {R011.§3.AC.03} cross-project refs tracked separately
   */
  private crossProjectRefs: ClaimIndexData['crossProjectRefs'] = [];
  private noteMap = new Map<string, NoteInfo>();
  /** Section headings, keyed by fqid (`R005.1`, `DD036.2.3`, …). */
  private sections = new Map<string, SectionEntry>();
  /** Validation errors from the last build, used to drive VS Code diagnostics. */
  private latestErrors: ClaimTreeError[] = [];
  /** Reverse index: bare claim suffix (e.g. "DC.01") → fully qualified IDs */
  private suffixIndex = new Map<string, string[]>();
  /**
   * Alias map populated from the loaded config's `projectAliases` at
   * refresh time. Used by hover/definition/decoration/diagnostics
   * providers to determine whether an alias is declared and resolved.
   *
   * @implements {R011.§4.AC.02} extension-side alias map
   */
  private aliasMap = new Map<string, AliasMapEntry>();
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
   * Get the alias resolution entry for the given alias name, or
   * `undefined` if the alias is not declared in `projectAliases`.
   *
   * @implements {R011.§4.AC.02} extension-side alias map query
   */
  getAlias(aliasName: string): AliasMapEntry | undefined {
    return this.aliasMap.get(aliasName);
  }

  /** All declared aliases — for diagnostics and the openConfig command. */
  getAllAliases(): AliasMapEntry[] {
    return Array.from(this.aliasMap.values());
  }

  /**
   * Resolve a cross-project reference to a peer note or peer claim.
   * The peer's project is loaded lazily via the core's
   * `peerResolver`, which caches loads for the lifetime of the
   * extension's `ProjectManager` instance.
   *
   * Pass either:
   *   - `{ noteId: 'R042' }` to look up a peer note by ID
   *   - `{ noteId: 'R005', sectionPath: [1], claimPrefix: 'AC', claimNumber: 1 }` to look up a claim
   *
   * Returns a `CrossProjectLookup` discriminated by the `ok` flag.
   *
   * @implements {R011.§4.AC.07} lazy peer-index cache via core resolver
   */
  async resolveCrossProject(
    aliasName: string,
    address: { noteId: string; sectionPath?: number[]; claimPrefix?: string; claimNumber?: number; claimSubLetter?: string },
  ): Promise<CrossProjectLookup> {
    if (!this.projectManager) {
      return { ok: false, reason: 'Project manager not initialized', aliasName };
    }
    const resolver = this.projectManager.peerResolver;
    if (address.claimPrefix !== undefined && address.claimNumber !== undefined) {
      const claimResult = await resolver.lookupClaim({
        raw: `${aliasName}/${address.noteId}`,
        aliasPrefix: aliasName,
        noteId: address.noteId,
        sectionPath: address.sectionPath,
        claimPrefix: address.claimPrefix,
        claimNumber: address.claimNumber,
        ...(address.claimSubLetter ? { claimSubLetter: address.claimSubLetter } : {}),
      });
      if (claimResult.ok) {
        return { ok: true, entry: claimResult.entry, aliasName, peerPath: claimResult.peer.resolvedPath };
      }
      return { ok: false, reason: claimResult.message, aliasName };
    }
    const noteResult = await resolver.lookupNote(aliasName, address.noteId);
    if (noteResult.ok) {
      const peer = noteResult.note;
      // Map the peer Note to a NoteInfo. We don't have claimCount easily
      // available without rebuilding the peer index here; report 0 to
      // signal "unknown" without mis-counting.
      return {
        ok: true,
        note: {
          noteId: peer.id,
          noteType: peer.type ?? '',
          noteFilePath: peer.filePath ?? '',
          noteTitle: peer.title ?? peer.id,
          claimCount: 0,
        },
        aliasName,
        peerPath: noteResult.peer.resolvedPath,
      };
    }
    return { ok: false, reason: noteResult.message, aliasName };
  }

  /**
   * Validate cross-project references and produce ClaimTreeError
   * entries for alias-unknown / peer-unresolved / peer-target-not-found.
   * Mirrors the logic in `lint-command.validateAliasReferences` but is
   * used for the diagnostics-provider integration.
   *
   * @implements {R011.§4.AC.06} alias-validation errors as diagnostics
   */
  private async validateCrossProjectReferences(
    refs: ClaimIndexData['crossProjectRefs'],
  ): Promise<ClaimTreeError[]> {
    if (!this.projectManager) return [];
    const out: ClaimTreeError[] = [];
    for (const ref of refs) {
      const aliasName = ref.aliasPrefix;
      const addr = ref.address;
      const aliasEntry = this.aliasMap.get(aliasName);
      if (!aliasEntry) {
        out.push({
          type: 'alias-unknown',
          claimId: addr.raw,
          line: ref.line,
          message: `Alias '${aliasName}' is not declared in projectAliases.`,
          noteId: ref.fromNoteId,
          noteFilePath: ref.filePath,
        });
        continue;
      }
      if (!aliasEntry.resolved) {
        out.push({
          type: 'peer-unresolved',
          claimId: addr.raw,
          line: ref.line,
          message: aliasEntry.unresolvedReason ?? `Peer project for alias '${aliasName}' is unresolved.`,
          noteId: ref.fromNoteId,
          noteFilePath: ref.filePath,
        });
        continue;
      }
      // Peer is reachable. Check the note (and claim) exists.
      try {
        if (addr.claimPrefix !== undefined && addr.claimNumber !== undefined) {
          const r = await this.projectManager.peerResolver.lookupClaim(addr);
          if (!r.ok) {
            out.push({
              type: 'peer-target-not-found',
              claimId: addr.raw,
              line: ref.line,
              message: r.message,
              noteId: ref.fromNoteId,
              noteFilePath: ref.filePath,
            });
          }
        } else if (addr.noteId) {
          const r = await this.projectManager.peerResolver.lookupNote(aliasName, addr.noteId);
          if (!r.ok) {
            out.push({
              type: 'peer-target-not-found',
              claimId: addr.raw,
              line: ref.line,
              message: r.message,
              noteId: ref.fromNoteId,
              noteFilePath: ref.filePath,
            });
          }
        }
      } catch (err) {
        this.outputChannel.appendLine(`[ClaimIndex] cross-project lookup failed: ${(err as Error).message}`);
      }
    }
    return out;
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

  /** Check if an ID resolves to a claim, note, section, or bare claim. */
  isKnown(id: string, contextNoteId?: string): boolean {
    if (this.entries.has(id)) return true;
    if (this.noteMap.has(id)) return true;
    if (this.sections.has(id)) return true;
    if (contextNoteId && this.entries.has(`${contextNoteId}.${id}`)) return true;
    if (contextNoteId && this.sections.has(`${contextNoteId}.${id}`)) return true;
    if (this.suffixIndex.has(id)) return true;
    return false;
  }

  /**
   * Resolve a section reference by its normalized id. Accepts:
   *   - Fully-qualified: `R005.1`, `DD036.2.3`
   *   - Bare in current note: `1`, `2.3` (with contextNoteId)
   */
  lookupSection(id: string, contextNoteId?: string): SectionEntry | undefined {
    const direct = this.sections.get(id);
    if (direct) return direct;
    if (contextNoteId) {
      return this.sections.get(`${contextNoteId}.${id}`);
    }
    return undefined;
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
  /**
   * Return the aggregated content of a note as a line array, using the same
   * note-file-manager path as `readClaimContext` so line numbers align with
   * the indexer's view of the file (folder notes' companions concatenated).
   */
  async getAggregatedNoteLines(noteId: string): Promise<string[] | null> {
    if (!this.projectManager) return null;
    try {
      const content = await this.projectManager.noteFileManager.getAggregatedContents(noteId);
      return content === null ? null : content.split('\n');
    } catch {
      return null;
    }
  }

  async readClaimContext(entry: ClaimIndexEntry, contextLinesBefore = 1, maxLines = 15): Promise<string | null> {
    try {
      let content: string | null = null;
      if (this.projectManager) {
        // @implements {DD012.§DC.10} Note content reading via ProjectManager.
        // Aggregated so claim line numbers (which were assigned against the
        // aggregated stream during index build) resolve correctly.
        content = await this.projectManager.noteFileManager.getAggregatedContents(entry.noteId);
      }
      if (content === null) {
        content = await fs.promises.readFile(this.resolveFilePath(entry.noteFilePath), 'utf-8');
      }
      const lines = content.split('\n');

      // entry.endLine is the parser-computed boundary (next sibling claim,
      // shallower heading, or end of file). Treat maxLines as a safety cap,
      // not a fixed window — the previous arithmetic algebraically reduced
      // to `entry.line + maxLines`, ignoring endLine entirely and spilling
      // the excerpt into following claims on long notes.
      const startLine = Math.max(0, entry.line - 1 - contextLinesBefore);
      const claimEnd = entry.endLine && entry.endLine >= entry.line
        ? entry.endLine
        : entry.line + maxLines - 1;
      const endLine = Math.min(lines.length, claimEnd, entry.line + maxLines - 1);
      const contextLines = lines.slice(startLine, endLine);

      return contextLines.join('\n');
    } catch {
      return null;
    }
  }

  /**
   * Read a section's content from line to endLine (inclusive). Falls back to
   * a fixed window when endLine is missing or matches line (one-line stub).
   */
  async readSectionContent(entry: SectionEntry, maxLines = 200): Promise<string | null> {
    try {
      let content: string | null = null;
      if (this.projectManager) {
        content = await this.projectManager.noteFileManager.getAggregatedContents(entry.noteId);
      }
      if (content === null) {
        content = await fs.promises.readFile(this.resolveFilePath(entry.noteFilePath), 'utf-8');
      }
      const lines = content.split('\n');
      const startIdx = Math.max(0, entry.line - 1);
      const stubEnd = entry.endLine && entry.endLine > entry.line ? entry.endLine : startIdx + maxLines;
      const endIdx = Math.min(lines.length, Math.min(stubEnd, startIdx + maxLines));
      return lines.slice(startIdx, endIdx).join('\n');
    } catch {
      return null;
    }
  }

  /** All note IDs in the index. */
  getAllNoteIds(): string[] {
    return [...this.noteMap.keys()];
  }

  /** Validation errors from the most recent build. */
  getErrors(): readonly ClaimTreeError[] {
    return this.latestErrors;
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
    const noteExcerpts = new Map<string, string>();
    const htmlExcerpts = new Map<string, string>();

    const noteIds = Array.from(this.noteMap.keys());
    await mapWithConcurrency(noteIds, 32, async (noteId) => {
      const raw = await this.readNoteExcerpt(noteId, Infinity);
      if (!raw) return null;
      noteExcerpts.set(noteId, raw);
      const lines = raw.split('\n');
      const capped = lines.length > 50
        ? lines.slice(0, 50).join('\n') + '\n\n---\n\n*…content continues*'
        : raw;
      const html = this.renderMarkdownToHtml(capped);
      if (html) htmlExcerpts.set(noteId, html);
      return null;
    });

    const entries = Array.from(this.entries.entries());
    await mapWithConcurrency(entries, 32, async ([fqid, entry]) => {
      const raw = await this.readClaimContext(entry, 1, 200);
      if (!raw) return null;
      noteExcerpts.set('claim:' + fqid, raw);
      const html = this.renderMarkdownToHtml(raw);
      if (html) htmlExcerpts.set('claim:' + fqid, html);
      return null;
    });

    this.noteExcerptCache = noteExcerpts;
    this.htmlExcerptCache = htmlExcerpts;
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

  /**
   * Refresh the alias map from the loaded config's projectAliases.
   * Cheap and safe to call from either Phase A or Phase B.
   *
   * @implements {R011.§4.AC.02} extension reloads alias map on refresh
   * @implements {DD015.§1.DC.06} extension reads alias map from in-process ConfigManager (no CLI JSON serialization)
   */
  private refreshAliasMap(): void {
    if (!this.projectManager) return;
    const next = new Map<string, AliasMapEntry>();
    try {
      const resolutions = this.projectManager.configManager.getAllAliasResolutions();
      for (const r of resolutions) {
        next.set(r.aliasName, {
          aliasName: r.aliasName,
          resolvedPath: r.resolvedPath,
          resolved: r.resolved,
          unresolvedReason: r.resolved ? undefined : r.message,
          description: r.resolved ? r.description : undefined,
        });
      }
    } catch (err) {
      // Older builds may not have getAllAliasResolutions; leave map empty.
      this.outputChannel.appendLine(`[ClaimIndex] alias map skipped: ${(err as Error).message}`);
    }
    this.aliasMap = next;
  }

  /**
   * Compute the derived cache structures (sections, suffixIndex, noteMap)
   * from a built ClaimIndexData and the corresponding note list. Returns
   * locally-built maps so callers can swap them in atomically.
   *
   * Used by both Phase A (single-note partial build) and Phase B (full
   * corpus build) of `refresh()`.
   */
  private computeDerivedIndex(
    data: ClaimIndexData,
    allNotes: readonly Note[],
  ): {
    sections: Map<string, SectionEntry>;
    suffixIndex: Map<string, string[]>;
    noteMap: Map<string, NoteInfo>;
  } {
    // Sections: per-note trees so qualified section refs like {R005.§1}
    // resolve to a heading + line + content.
    const sections = new Map<string, SectionEntry>();
    const noteTypes = data.noteTypes ?? new Map<string, string>();
    const noteFilePaths = new Map<string, string>();
    for (const note of allNotes) {
      if (note.filePath) noteFilePaths.set(note.id, note.filePath);
    }
    for (const [noteId, roots] of data.trees) {
      const noteType = noteTypes.get(noteId) ?? '';
      const noteFilePath = noteFilePaths.get(noteId) ?? '';
      collectSections(roots, (node, path) => {
        const sectionId = path.join('.');
        const fqid = `${noteId}.${sectionId}`;
        sections.set(fqid, {
          fqid,
          noteId,
          sectionId,
          sectionPath: [...path],
          heading: node.heading,
          line: node.line,
          endLine: node.endLine,
          noteFilePath,
          noteType,
        });
      });
    }

    // Suffix index: bare claim ID → FQIDs.
    const suffixIndex = new Map<string, string[]>();
    for (const [fqid, entry] of data.entries) {
      const bareId = `${entry.claimPrefix}.${String(entry.claimNumber).padStart(2, '0')}${entry.claimSubLetter ?? ''}`;
      const existing = suffixIndex.get(bareId) ?? [];
      existing.push(fqid);
      suffixIndex.set(bareId, existing);

      // Also index by claimId (which includes section: "1.AC.01")
      if (entry.claimId !== bareId) {
        const byClaimId = suffixIndex.get(entry.claimId) ?? [];
        byClaimId.push(fqid);
        suffixIndex.set(entry.claimId, byClaimId);
      }
    }

    // Note-level map — include ALL notes, not just those with claims.
    const noteMap = new Map<string, NoteInfo>();
    const noteLookup = new Map(allNotes.map(n => [n.id, n]));

    if (data.noteTypes) {
      for (const [noteId, noteType] of data.noteTypes) {
        const note = noteLookup.get(noteId);
        const filePath = note?.filePath || '';
        noteMap.set(noteId, {
          noteId,
          noteType,
          noteFilePath: filePath,
          noteTitle: filePath ? extractNoteTitle(filePath, this.projectDir) : noteId,
          claimCount: 0,
        });
      }
    }

    for (const entry of data.entries.values()) {
      let info = noteMap.get(entry.noteId);
      if (!info) {
        info = {
          noteId: entry.noteId,
          noteType: entry.noteType,
          noteFilePath: entry.noteFilePath,
          noteTitle: extractNoteTitle(entry.noteFilePath, this.projectDir),
          claimCount: 0,
        };
        noteMap.set(entry.noteId, info);
      }
      if (!info.noteFilePath) {
        info.noteFilePath = entry.noteFilePath;
        info.noteTitle = extractNoteTitle(entry.noteFilePath, this.projectDir);
      }
      info.claimCount++;
    }

    return { sections, suffixIndex, noteMap };
  }

  /**
   * Atomically swap a freshly-built ClaimIndexData and its derived caches
   * into the live fields. Done in a single synchronous block so subscribers
   * never observe torn state across `entries` / `sections` / `suffixIndex` /
   * `noteMap`.
   */
  private applyClaimIndexData(
    data: ClaimIndexData,
    allNotes: readonly Note[],
    coreClaimIndex: ClaimIndex | null,
  ): void {
    const { sections, suffixIndex, noteMap } = this.computeDerivedIndex(data, allNotes);
    this.entries = data.entries;
    this.crossRefs = data.crossRefs ?? [];
    this.crossProjectRefs = data.crossProjectRefs ?? [];
    this.sections = sections;
    this.suffixIndex = suffixIndex;
    this.noteMap = noteMap;
    if (coreClaimIndex) {
      this.coreClaimIndex = coreClaimIndex;
    }
  }

  /**
   * Identify the active editor's note ID, if and only if it points at a
   * markdown file inside this project. Returns null when there's no active
   * editor, the file isn't markdown, the path is outside the project, or
   * no note ID can be parsed from the basename.
   */
  private getActiveNoteId(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    const doc = editor.document;
    if (doc.languageId !== 'markdown' && !doc.fileName.toLowerCase().endsWith('.md')) {
      return null;
    }
    const fsPath = doc.uri.fsPath;
    const rel = path.relative(this.projectDir, fsPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return noteIdFromPath(fsPath);
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
      // changed since startup. Phase A (active-file priority) also depends
      // on noteFileManager.getAggregatedContents working, which requires
      // the file index to be present.
      await this.projectManager.noteManager.rescan();
      await this.projectManager.noteFileManager.buildIndex();
      if (this.projectManager.sourceScanner) {
        await this.projectManager.sourceScanner.refresh();
        this.projectManager.referenceManager.setSourceIndex(
          this.projectManager.sourceScanner.getIndex(),
        );
      }

      const allNotes = await this.projectManager.noteManager.getAllNotes();
      const fileManager = this.projectManager.noteFileManager;

      // Alias map is sourced from config and is cheap; populate up-front so
      // both phases see resolved aliases.
      this.refreshAliasMap();

      // -------- Phase A: active-file priority -----------------------------
      // Build a partial index over JUST the active file's content so badges,
      // hovers, and decorations light up before the full corpus is parsed.
      // Cross-refs *to* the active note's claims won't be populated yet
      // (we haven't scanned other files); Phase B fixes that.
      //
      // Phase A *merges* into existing caches rather than replacing them, so
      // a debounced re-refresh doesn't transiently wipe data for non-active
      // notes between Phase A and Phase B. On first refresh the prior caches
      // are empty, so merge == replace and the active file's data lights up
      // immediately.
      const activeNoteId = this.getActiveNoteId();
      if (activeNoteId) {
        const phaseAStart = Date.now();
        const activeNote = allNotes.find((n) => n.id === activeNoteId);
        if (activeNote) {
          try {
            const content = await fileManager.getAggregatedContents(activeNoteId);
            if (content !== null) {
              const partial: NoteWithContent[] = [{
                id: activeNote.id,
                type: activeNote.type,
                filePath: activeNote.filePath || '',
                content,
              }];
              const partialIndex = new ClaimIndex();
              const partialData = partialIndex.build(partial);
              const partialDerived = this.computeDerivedIndex(partialData, [activeNote]);

              // Atomic merge into live caches. Drop any prior entries /
              // sections / suffix index buckets that belonged to the active
              // note, then layer the freshly-parsed ones on top. Other notes'
              // data is preserved untouched.
              const nextEntries = new Map(this.entries);
              for (const [fqid, entry] of nextEntries) {
                if (entry.noteId === activeNoteId) nextEntries.delete(fqid);
              }
              for (const [fqid, entry] of partialData.entries) {
                nextEntries.set(fqid, entry);
              }

              const nextSections = new Map(this.sections);
              for (const [fqid, section] of nextSections) {
                if (section.noteId === activeNoteId) nextSections.delete(fqid);
              }
              for (const [fqid, section] of partialDerived.sections) {
                nextSections.set(fqid, section);
              }

              // Suffix index: rebuild from nextEntries since buckets can mix
              // FQIDs from multiple notes per key. Cheap relative to parsing.
              const nextSuffix = new Map<string, string[]>();
              for (const [fqid, entry] of nextEntries) {
                const bareId = `${entry.claimPrefix}.${String(entry.claimNumber).padStart(2, '0')}${entry.claimSubLetter ?? ''}`;
                const existingBare = nextSuffix.get(bareId) ?? [];
                existingBare.push(fqid);
                nextSuffix.set(bareId, existingBare);
                if (entry.claimId !== bareId) {
                  const existingByClaimId = nextSuffix.get(entry.claimId) ?? [];
                  existingByClaimId.push(fqid);
                  nextSuffix.set(entry.claimId, existingByClaimId);
                }
              }

              const nextNoteMap = new Map(this.noteMap);
              const partialActiveInfo = partialDerived.noteMap.get(activeNoteId);
              if (partialActiveInfo) {
                nextNoteMap.set(activeNoteId, partialActiveInfo);
              }

              this.entries = nextEntries;
              this.sections = nextSections;
              this.suffixIndex = nextSuffix;
              this.noteMap = nextNoteMap;
              // Leave coreClaimIndex untouched: trace() / getTraceabilityData()
              // would return half-corpus answers if we swapped it now.
              // Leave crossRefs / crossProjectRefs / latestErrors untouched
              // for the same reason — Phase B replaces them.

              this.outputChannel.appendLine(
                `[ClaimIndex] Phase A (${activeNoteId}): ${partialData.entries.size} claims merged in ${Date.now() - phaseAStart}ms — partial index visible`,
              );

              // Wake any waiters and let subscribers re-render with what we
              // have so far. Phase B will fire again with the full corpus.
              this.resolveReady();
              this._onDidRefresh.fire();
            }
          } catch (err) {
            this.outputChannel.appendLine(
              `[ClaimIndex] Phase A skipped: ${(err as Error).message}`,
            );
          }
        }
      } else {
        this.outputChannel.appendLine('[ClaimIndex] Phase A skipped: no active markdown editor');
      }

      // -------- Phase B: full corpus build --------------------------------
      // Use aggregated contents so folder-note claims defined in companion
      // files (e.g. DD052/07-module-inventory.md) are indexed under the
      // parent note's ID. Reads are parallelized with bounded concurrency —
      // sequential awaits were the dominant cost on multi-thousand-note
      // projects (DD012 §perf).
      const phaseBStart = Date.now();
      const aggregated = await mapWithConcurrency(allNotes, 32, async (note) => {
        const content = await fileManager.getAggregatedContents(note.id);
        return content !== null
          ? { id: note.id, type: note.type, filePath: note.filePath || '', content }
          : null;
      });
      const notesWithContent: NoteWithContent[] = aggregated.filter(
        (n): n is NoteWithContent => n !== null,
      );

      const claimIndex = new ClaimIndex();
      const data: ClaimIndexData = claimIndex.build(notesWithContent);

      // @implements {DD012.§DC.11} Source reference integration
      if (this.projectManager.sourceScanner) {
        const sourceRefs = this.projectManager.sourceScanner.getIndex().getAllReferences();
        if (sourceRefs.length > 0) {
          claimIndex.addSourceReferences(sourceRefs);
        }
      }

      // Atomic swap: build derived caches into locals, then assign all
      // fields in one synchronous block so subscribers never observe
      // torn state across entries / sections / suffixIndex / noteMap.
      this.applyClaimIndexData(data, allNotes, claimIndex);

      this.outputChannel.appendLine(
        `[ClaimIndex] Phase B: loaded ${this.entries.size} claims across ${this.noteMap.size} notes, ${this.crossRefs.length} cross-refs, ${this.suffixIndex.size} bare suffixes in ${Date.now() - phaseBStart}ms`,
      );

      this.latestErrors = data.errors ?? [];

      // Validate cross-project references and append resulting errors so
      // they appear in the Problems panel alongside the index errors.
      // @implements {R011.§4.AC.06} surface alias-related errors as diagnostics
      if (data.crossProjectRefs && data.crossProjectRefs.length > 0) {
        const aliasErrors = await this.validateCrossProjectReferences(data.crossProjectRefs);
        this.latestErrors = [...this.latestErrors, ...aliasErrors];
      }

      if (this.latestErrors.length) {
        this.outputChannel.appendLine(
          `[ClaimIndex] ${this.latestErrors.length} parse errors surfaced as diagnostics`
        );
      }

      // Fire refresh BEFORE the excerpt cache builds so badges, hover, and
      // decorations light up immediately. The excerpt cache feeds the rich
      // markdown-preview tooltips and can populate in the background — when
      // it finishes, fire refresh again so preview tooltips upgrade.
      this.resolveReady();
      this._onDidRefresh.fire();

      this.buildExcerptCache().then(() => {
        this._onDidRefresh.fire();
      }).catch((err) => {
        this.outputChannel.appendLine(
          `[ClaimIndex] Excerpt cache build failed: ${(err as Error).message}`,
        );
      });
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
  // @implements {R011.§4.AC.09} cross-project outgoing refs included separately
  getReferencesForNote(noteId: string): NoteReferences {
    const outgoingRefs = this.projectManager?.referenceManager?.getReferencesFrom(noteId) ?? [];
    const incomingRefs = this.projectManager?.referenceManager?.getReferencesTo(noteId, false) ?? [];
    const sourceRefs = this.projectManager?.sourceScanner?.getReferencesToNote(noteId) ?? [];

    // Collect cross-project outgoing refs (deduped by aliasName + raw).
    const seen = new Set<string>();
    const crossProjectOutgoing: CrossProjectOutgoingRef[] = [];
    for (const cpRef of this.crossProjectRefs) {
      if (cpRef.fromNoteId !== noteId) continue;
      const key = `${cpRef.aliasPrefix}|${cpRef.address.raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const aliasEntry = this.aliasMap.get(cpRef.aliasPrefix);
      crossProjectOutgoing.push({
        aliasName: cpRef.aliasPrefix,
        peerNoteId: cpRef.address.noteId ?? '(unknown)',
        raw: cpRef.address.raw,
        resolved: aliasEntry?.resolved ?? false,
      });
    }

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
      crossProjectOutgoing,
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
    this.sections = new Map();
    this.latestErrors = [];
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
