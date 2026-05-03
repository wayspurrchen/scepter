/**
 * Lazy resolver for claim body excerpts and aggregated note lines.
 *
 * Replaces the eager `buildExcerptCache` pass that previously rendered
 * every claim body and every note body through markdown-it after each
 * index refresh. At ~10k+ claims that pass starved the extension host
 * event loop and blocked hover/preview rendering.
 *
 * Instead, bodies are rendered on demand:
 *
 *   - `resolveBody(fqid)` / `resolveBodySync(fqid)` render a single
 *     claim's body excerpt as HTML, caching the result in a
 *     bounded-LRU map.
 *
 *   - `resolveTransitive(seedFqids, depth, maxBodies)` performs a
 *     bounded BFS starting from a set of FQIDs (the FQIDs found in a
 *     particular markdown preview document), pulling in nested
 *     citations up to `depth` and `maxBodies` total. Used by the
 *     markdown-it preview plugin to inject a document-scoped
 *     `window.__scepterBodyMap` rather than the entire-corpus map the
 *     prior implementation injected.
 *
 *   - `resolveNoteBodySync(noteId)` renders a single note excerpt
 *     (frontmatter + H1 stripped, capped at 50 lines) for the
 *     `data-note-excerpt` attribute consumed by the preview's note
 *     hover panel.
 *
 *   - `getNoteLinesSync(noteId)` returns aggregated note lines (as
 *     `string[]`) used by the citing-line snippet builder. Routes
 *     through `ClaimIndexCache.getAggregatedContentsSync` so folder
 *     notes' companion `.md` files are concatenated the same way the
 *     indexer saw them. Async aggregation goes through
 *     `ClaimIndexCache.getAggregatedNoteLines` / `getAggregatedContents`.
 *
 * The resolver does not own the index; it queries it and reads files
 * directly. Cache invalidation is keyed on noteId so a single
 * file-change can drop just that note's bodies + line cache.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ClaimIndexCache, ClaimIndexEntry } from './claim-index';
import { createScepterPlugin } from './markdown-plugin';

const DEFAULT_BODY_CACHE_CAP = 1000;
const DEFAULT_NOTE_BODY_CACHE_CAP = 500;
const DEFAULT_NOTE_LINES_CACHE_CAP = 500;

/** Maximum lines per claim excerpt (mirrors prior `buildExcerptCache`). */
const CLAIM_CONTEXT_BEFORE = 1;
const CLAIM_CONTEXT_MAX_LINES = 200;
/** Cap for note excerpts before the `…content continues` truncation marker. */
const NOTE_EXCERPT_LINE_CAP = 50;

/**
 * Insertion-ordered Map with a hard size cap. On insert, if size
 * exceeds the cap, the oldest entry is evicted. This is the simplest
 * possible LRU and is sufficient for the access patterns here (most
 * recently rendered claim bodies stay hot; rare ones fall out).
 */
function lruSet<K, V>(map: Map<K, V>, key: K, value: V, cap: number): void {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > cap) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

export class ClaimBodyResolver {
  private bodyCache = new Map<string, string>();
  private noteBodyCache = new Map<string, string>();
  private noteLinesCache = new Map<string, string[]>();
  private excerptMd: any = null;

  /**
   * Re-entry guards. The SCEpter markdown-it plugin's text rule calls
   * resolver methods while rendering a body, which itself runs the
   * same plugin. If a body cites the same id we're rendering — or if
   * the citation graph cycles — we must short-circuit rather than
   * blow the stack. Safe net even after call sites are made
   * non-recursive; cheap to maintain.
   */
  private renderingClaims = new Set<string>();
  private renderingNotes = new Set<string>();

  constructor(private readonly index: ClaimIndexCache) {}

  /** Wipe every cached body and line read. Used on full project switch. */
  clear(): void {
    this.bodyCache.clear();
    this.noteBodyCache.clear();
    this.noteLinesCache.clear();
  }

  /**
   * Drop every cached body / note body / note-lines entry that
   * belongs to a particular note. Called by the index when a note
   * file changes so the next render picks up fresh content.
   */
  invalidate(noteId: string): void {
    this.noteBodyCache.delete(noteId);
    this.noteLinesCache.delete(noteId);

    const prefix = `${noteId}.`;
    for (const fqid of this.bodyCache.keys()) {
      // FQIDs always start with the noteId followed by a dot.
      if (fqid === noteId || fqid.startsWith(prefix)) {
        this.bodyCache.delete(fqid);
      }
    }
  }

  /**
   * Synchronous body resolver. Returns cached HTML or renders
   * on-the-fly via a sync file read. Returns null if the entry is
   * missing or the file cannot be read.
   *
   * Sync renders are bounded (single-file `fs.readFileSync` per
   * miss) and complete in milliseconds even for large notes. The
   * markdown preview's body-map injection uses this from inside
   * markdown-it's render pipeline, which is itself synchronous.
   */
  resolveBodySync(fqid: string): string | null {
    const cached = this.bodyCache.get(fqid);
    if (cached !== undefined) return cached;
    if (this.renderingClaims.has(fqid)) return null;

    const entry = this.index.lookup(fqid);
    if (!entry) return null;

    const content = this.readAggregatedSync(entry.noteId, entry.noteFilePath);
    if (content === null) return null;

    this.renderingClaims.add(fqid);
    let html: string | null;
    try {
      html = this.renderClaimContext(entry, content);
    } finally {
      this.renderingClaims.delete(fqid);
    }
    if (html === null) return null;

    lruSet(this.bodyCache, fqid, html, DEFAULT_BODY_CACHE_CAP);
    return html;
  }

  /**
   * Async body resolver. Same caching as the sync path but uses
   * `fs.promises.readFile` so a single hover request can't block
   * the event loop. Used by the editor hover provider.
   */
  async resolveBody(fqid: string): Promise<string | null> {
    const cached = this.bodyCache.get(fqid);
    if (cached !== undefined) return cached;
    if (this.renderingClaims.has(fqid)) return null;

    const entry = this.index.lookup(fqid);
    if (!entry) return null;

    const content = await this.readAggregatedAsync(entry.noteId, entry.noteFilePath);
    if (content === null) return null;

    this.renderingClaims.add(fqid);
    let html: string | null;
    try {
      html = this.renderClaimContext(entry, content);
    } finally {
      this.renderingClaims.delete(fqid);
    }
    if (html === null) return null;

    lruSet(this.bodyCache, fqid, html, DEFAULT_BODY_CACHE_CAP);
    return html;
  }

  /**
   * Render a note's excerpt (frontmatter + H1 stripped, capped at
   * NOTE_EXCERPT_LINE_CAP lines with a `…content continues` marker).
   * Synchronous because the markdown-it plugin emits it from inside
   * a render hook.
   */
  resolveNoteBodySync(noteId: string): string | null {
    const cached = this.noteBodyCache.get(noteId);
    if (cached !== undefined) return cached;
    if (this.renderingNotes.has(noteId)) return null;

    const noteInfo = this.index.lookupNote(noteId);
    if (!noteInfo?.noteFilePath) return null;

    const content = this.readAggregatedSync(noteId, noteInfo.noteFilePath);
    if (content === null) return null;

    const raw = stripFrontmatterAndTitle(content);
    if (!raw) return null;

    const lines = raw.split('\n');
    const capped = lines.length > NOTE_EXCERPT_LINE_CAP
      ? lines.slice(0, NOTE_EXCERPT_LINE_CAP).join('\n') + '\n\n---\n\n*…content continues*'
      : raw;

    this.renderingNotes.add(noteId);
    let html: string | null;
    try {
      html = this.renderMarkdown(capped);
    } finally {
      this.renderingNotes.delete(noteId);
    }
    if (html === null) return null;

    lruSet(this.noteBodyCache, noteId, html, DEFAULT_NOTE_BODY_CACHE_CAP);
    return html;
  }

  /**
   * Aggregated note lines, sync. Used by the citing-line snippet
   * builder in the preview plugin. The sync path reads only the
   * primary note file — folder-note companions are not aggregated
   * here. Misalignment for folder-note companion-defined claims is
   * an accepted compromise; the editor hover provider's async path
   * uses full aggregation via the core file manager.
   */
  getNoteLinesSync(noteId: string): string[] | null {
    const cached = this.noteLinesCache.get(noteId);
    if (cached !== undefined) return cached;

    const noteInfo = this.index.lookupNote(noteId);
    if (!noteInfo?.noteFilePath) return null;

    const content = this.readAggregatedSync(noteId, noteInfo.noteFilePath);
    if (content === null) return null;

    const lines = content.split('\n');
    lruSet(this.noteLinesCache, noteId, lines, DEFAULT_NOTE_LINES_CACHE_CAP);
    return lines;
  }

  /**
   * BFS over claim bodies starting from `seedFqids`. At each level,
   * the rendered HTML is scanned for nested FQIDs (`data-claim-fqid`
   * and `data-scepter-id` attributes), which become the next
   * level's seeds. The walk stops at `maxDepth` levels or
   * `maxBodies` total entries — whichever first.
   *
   * The result is the document-scoped body map injected into the
   * markdown preview as `window.__scepterBodyMap`. Bounded both ways
   * so a single document with cyclic refs can't run away.
   */
  resolveTransitive(
    seedFqids: readonly string[],
    maxDepth: number,
    maxBodies: number,
  ): Map<string, string> {
    const out = new Map<string, string>();
    if (seedFqids.length === 0 || maxBodies <= 0 || maxDepth <= 0) return out;

    const visited = new Set<string>();
    let frontier = Array.from(new Set(seedFqids));

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      for (const fqid of frontier) {
        if (visited.has(fqid)) continue;
        visited.add(fqid);
        if (out.size >= maxBodies) return out;

        const html = this.resolveBodySync(fqid);
        if (html === null) continue;
        out.set(fqid, html);
        if (out.size >= maxBodies) return out;

        // Discover next-hop FQIDs from the rendered HTML.
        for (const childFqid of extractFqidsFromHtml(html)) {
          if (!visited.has(childFqid) && !out.has(childFqid)) {
            nextFrontier.push(childFqid);
          }
        }
      }
      frontier = nextFrontier;
    }

    return out;
  }

  // -------- internals --------

  private renderClaimContext(entry: ClaimIndexEntry, content: string): string | null {
    const lines = content.split('\n');

    // Mirror ClaimIndexCache.readClaimContext exactly.
    const startLine = Math.max(0, entry.line - 1 - CLAIM_CONTEXT_BEFORE);
    const claimEnd = entry.endLine && entry.endLine >= entry.line
      ? entry.endLine
      : entry.line + CLAIM_CONTEXT_MAX_LINES - 1;
    const endLine = Math.min(lines.length, claimEnd, entry.line + CLAIM_CONTEXT_MAX_LINES - 1);
    const raw = lines.slice(startLine, endLine).join('\n');
    if (!raw) return null;

    return this.renderMarkdown(raw, {
      currentDocument: { fsPath: this.index.resolveFilePath(entry.noteFilePath) },
      // Setting `_scepterLineOffset` disables the body-map-inject
      // ruler for this nested render and shifts badge line lookups
      // onto the original document's coordinates.
      _scepterLineOffset: Math.max(0, entry.line - 1),
    });
  }

  private renderMarkdown(raw: string, envExtras?: any): string | null {
    const md = this.getRenderer();
    if (!md) return null;
    try {
      const env = envExtras ? { ...envExtras } : {};
      // Even when no envExtras were supplied (note excerpts), set the
      // line-offset sentinel so the nested body-map ruler skips itself.
      if (env._scepterLineOffset === undefined) {
        env._scepterLineOffset = 0;
      }
      return md.render(raw, env).trim();
    } catch {
      return null;
    }
  }

  private getRenderer(): any {
    if (!this.excerptMd) {
      try {
        const MarkdownIt = require('markdown-it');
        const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
        md.use(createScepterPlugin(this.index));
        this.excerptMd = md;
      } catch {
        return null;
      }
    }
    return this.excerptMd;
  }

  /**
   * Read a note's full aggregated content synchronously, going
   * through `ClaimIndexCache.getAggregatedContentsSync` so folder-note
   * companions are concatenated the same way the indexer saw them.
   * Falls back to a raw single-file read if the aggregator returns
   * null (e.g. project not yet loaded), so we still produce a body
   * for non-folder notes during edge cases.
   */
  private readAggregatedSync(noteId: string, noteFilePath: string): string | null {
    const aggregated = this.index.getAggregatedContentsSync(noteId);
    if (aggregated !== null) return aggregated;
    try {
      const abs = this.index.resolveFilePath(noteFilePath);
      return fs.readFileSync(abs, 'utf-8');
    } catch {
      return null;
    }
  }

  private async readAggregatedAsync(noteId: string, noteFilePath: string): Promise<string | null> {
    const aggregated = await this.index.getAggregatedContents(noteId);
    if (aggregated !== null) return aggregated;
    try {
      const abs = this.index.resolveFilePath(noteFilePath);
      return await fs.promises.readFile(abs, 'utf-8');
    } catch {
      return null;
    }
  }
}

/**
 * Strip YAML frontmatter and the leading H1 + blank lines, mirroring
 * `ClaimIndexCache.readNoteExcerpt`. Returns trimmed body content
 * suitable for rendering as the note's excerpt.
 */
function stripFrontmatterAndTitle(content: string): string | null {
  const lines = content.split('\n');
  let startIdx = 0;

  if (lines[0]?.trim() === '---') {
    startIdx = 1;
    while (startIdx < lines.length && lines[startIdx]?.trim() !== '---') {
      startIdx++;
    }
    startIdx++;
  }

  while (startIdx < lines.length && lines[startIdx]?.trim() === '') startIdx++;
  if (startIdx < lines.length && /^#\s/.test(lines[startIdx])) {
    startIdx++;
  }
  while (startIdx < lines.length && lines[startIdx]?.trim() === '') startIdx++;

  const text = lines.slice(startIdx).join('\n').trim();
  return text || null;
}

const FQID_ATTR_RE = /data-(?:claim-fqid|scepter-id)="([^"]+)"/g;

/**
 * Extract candidate FQIDs from a rendered HTML excerpt by scanning
 * the data attributes the SCEpter plugin emits on every claim/note
 * span. We don't filter by kind here — we let `resolveBodySync`'s
 * lookup miss for note-only or section-only ids, which is cheap.
 *
 * Regex over the attribute is the lightest possible parse. Pulling
 * in a DOM tokenizer would be overkill and slower at this scale.
 */
function extractFqidsFromHtml(html: string): string[] {
  const out: string[] = [];
  FQID_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FQID_ATTR_RE.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}
