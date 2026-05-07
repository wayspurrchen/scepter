/**
 * Lazy resolver for claim body excerpts and aggregated note lines.
 *
 * @implements {R012.§7.AC.01} ClaimBodyResolver owns body rendering; no eager corpus pass on activation/refresh
 * @implements {R012.§7.AC.02} LRU-bounded caches with module-level constants; per-note invalidation; clear on project switch
 * @implements {R012.§8.AC.04} caches invalidated on note file changes (per-note) and cleared on project switch
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

/** Wall-clock budget for `resolveTransitive` walks. Above this, the
 *  BFS aborts and returns whatever it has accumulated so far. The
 *  preview tooltip degrades to "no nested body" for unreached refs;
 *  the host event loop never blocks past this bound. This is the
 *  invariant that prevents indefinite "Loading…" hovers — see
 *  R012 §7 / §8 history (eager rendering starves the host event
 *  loop; the architecture mandates bounded lazy resolution). */
const TRANSITIVE_BUDGET_MS = 250;
/** Maximum number of uncapped note bodies a single `resolveTransitive`
 *  walk may render. Note bodies are an order of magnitude larger than
 *  claim bodies and rendering them through markdown-it with the
 *  SCEpter plugin recursively triggers per-span index lookups. Cap
 *  this hard so a document with many note mentions can't fan out
 *  catastrophically. Reachable bodies past this cap fall back to
 *  the capped excerpt. */
const TRANSITIVE_MAX_UNCAPPED_NOTE_BODIES = 4;
/** Hard line-count ceiling on uncapped note rendering. Above this,
 *  even an "uncapped" request degrades to the capped path. Defends
 *  against pathological notes (10k+ lines) that would still starve
 *  the host even with the body-count cap. */
const UNCAPPED_NOTE_HARD_LINE_CEILING = 5000;

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
  // Uncapped note bodies are cached separately so the capped path
  // (editor hover) and the uncapped path (preview note hover scroll
  // region — see {R012.§7.AC.06} / {R012.§3.AC.09}) coexist without
  // either evicting the other.
  private noteBodyCacheUncapped = new Map<string, string>();
  private noteLinesCache = new Map<string, string[]>();
  private excerptMd: any = null;

  /**
   * Re-entry guards. The SCEpter markdown-it plugin's text rule calls
   * resolver methods while rendering a body, which itself runs the
   * same plugin. If a body cites the same id we're rendering — or if
   * the citation graph cycles — we must short-circuit rather than
   * blow the stack. Safe net even after call sites are made
   * non-recursive; cheap to maintain.
   *
   * @implements {R012.§7.AC.04} re-entrancy guard: cyclic citations short-circuit to null, no stack overflow
   */
  private renderingClaims = new Set<string>();
  private renderingNotes = new Set<string>();

  constructor(private readonly index: ClaimIndexCache) {}

  /** Wipe every cached body and line read. Used on full project switch. */
  clear(): void {
    this.bodyCache.clear();
    this.noteBodyCache.clear();
    this.noteBodyCacheUncapped.clear();
    this.noteLinesCache.clear();
  }

  /**
   * Drop every cached body / note body / note-lines entry that
   * belongs to a particular note. Called by the index when a note
   * file changes so the next render picks up fresh content.
   */
  invalidate(noteId: string): void {
    this.noteBodyCache.delete(noteId);
    this.noteBodyCacheUncapped.delete(noteId);
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
   *
   * Pass `{ uncapped: true }` to render the full note body without
   * the line cap or truncation marker — used by the markdown preview
   * note hover (see {R012.§7.AC.06}, {R012.§3.AC.09}) where the
   * rendered body lives inside a fixed-height scroll container so
   * visual height is bounded regardless of body size. Capped and
   * uncapped renders cache separately so neither evicts the other.
   *
   * @implements {R012.§7.AC.06} surface-specific carve-out: capped for flat surfaces, uncapped for scroll-bounded preview note hover
   */
  resolveNoteBodySync(noteId: string, opts?: { uncapped?: boolean }): string | null {
    const uncapped = opts?.uncapped === true;
    const cache = uncapped ? this.noteBodyCacheUncapped : this.noteBodyCache;
    const cached = cache.get(noteId);
    if (cached !== undefined) return cached;
    if (this.renderingNotes.has(noteId)) return null;

    const noteInfo = this.index.lookupNote(noteId);
    if (!noteInfo?.noteFilePath) return null;

    const content = this.readAggregatedSync(noteId, noteInfo.noteFilePath);
    if (content === null) return null;

    const raw = stripFrontmatterAndTitle(content);
    if (!raw) return null;

    let toRender: string;
    if (uncapped) {
      toRender = raw;
    } else {
      const lines = raw.split('\n');
      toRender = lines.length > NOTE_EXCERPT_LINE_CAP
        ? lines.slice(0, NOTE_EXCERPT_LINE_CAP).join('\n') + '\n\n---\n\n*…content continues*'
        : raw;
    }

    this.renderingNotes.add(noteId);
    let html: string | null;
    try {
      html = this.renderMarkdown(toRender);
    } finally {
      this.renderingNotes.delete(noteId);
    }
    if (html === null) return null;

    lruSet(cache, noteId, html, DEFAULT_NOTE_BODY_CACHE_CAP);
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
   *
   * @implements {R012.§8.AC.01} document-scoped body map via bounded BFS (depth + total bodies caps)
   */
  resolveTransitive(
    seedFqids: readonly string[],
    maxDepth: number,
    maxBodies: number,
  ): Map<string, string> {
    const out = new Map<string, string>();
    if (seedFqids.length === 0 || maxBodies <= 0 || maxDepth <= 0) return out;

    const startedAt = Date.now();
    const visited = new Set<string>();
    let frontier = Array.from(new Set(seedFqids));
    let uncappedNoteBodiesRendered = 0;

    // Hard wall-clock guard. Even with depth/maxBodies caps, a single
    // walk can chew through hundreds of milliseconds if note bodies
    // are large or the citation graph fans out. The host event loop
    // must NOT be blocked past TRANSITIVE_BUDGET_MS — that's the
    // invariant whose violation surfaces as indefinite "Loading…"
    // hovers in the editor and a stalled Cmd+Shift+V in the preview.
    // R012 history: 2026-05-03 incident, eager `buildExcerptCache`
    // pass starved the host on 11k-claim projects; the architecture
    // was rewritten to lazy/bounded resolution; this budget is the
    // explicit time-side bound that pairs with the existing depth
    // and body-count bounds.
    // @implements {R012.§8.AC.06} resolveTransitive wall-clock budget bounds preview render latency
    const overBudget = (): boolean => Date.now() - startedAt > TRANSITIVE_BUDGET_MS;

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      if (overBudget()) return out;
      const nextFrontier: string[] = [];
      for (const fqid of frontier) {
        if (overBudget()) return out;
        if (visited.has(fqid)) continue;
        visited.add(fqid);
        if (out.size >= maxBodies) return out;

        // Bare note ids (no dot) route to the note body resolver in
        // uncapped mode. The preview note hover reads
        // window.__scepterBodyMap[noteId] for its scrollable body
        // region. Note ids cannot collide with claim FQIDs because
        // every claim FQID contains at least one dot.
        //
        // Two extra bounds beyond the shared depth/maxBodies/budget:
        // (a) `TRANSITIVE_MAX_UNCAPPED_NOTE_BODIES` caps how many
        //     uncapped note bodies we render per walk. Note bodies
        //     are an order of magnitude larger than claim bodies and
        //     each goes through the SCEpter plugin (per-span index
        //     lookups). Past the cap, additional notes degrade to
        //     the capped excerpt (still useful, much cheaper).
        // (b) `UNCAPPED_NOTE_HARD_LINE_CEILING` defends against
        //     pathological 10k-line notes by routing them to the
        //     capped path even when uncapped was requested.
        // @implements {R012.§3.AC.09} uncapped note bodies for preview hover, bounded by maxUncappedBodies
        // @implements {R012.§7.AC.06} surface-specific carve-out: capped fallback when uncapped budgets exhausted
        // @implements {R012.§8.AC.07} uncapped note rendering bounded by per-walk count + per-body line ceiling
        let html: string | null;
        if (isBareNoteId(fqid)) {
          if (uncappedNoteBodiesRendered < TRANSITIVE_MAX_UNCAPPED_NOTE_BODIES &&
              this.noteBodyLineCount(fqid) <= UNCAPPED_NOTE_HARD_LINE_CEILING) {
            html = this.resolveNoteBodySync(fqid, { uncapped: true });
            if (html !== null) uncappedNoteBodiesRendered++;
          } else {
            html = this.resolveNoteBodySync(fqid);
          }
        } else {
          html = this.resolveBodySync(fqid);
        }
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

  /**
   * Cheap line-count peek for a note's aggregated content. Used as
   * the safety check for uncapped rendering: if the note exceeds the
   * hard ceiling, we degrade to the capped path even when uncapped
   * was requested. Reads through the existing line cache so repeat
   * calls inside one walk don't re-read the file.
   */
  private noteBodyLineCount(noteId: string): number {
    const lines = this.getNoteLinesSync(noteId);
    return lines === null ? 0 : lines.length;
  }

  // -------- internals --------

  // @implements {R012.§7.AC.03} resolver render env carries currentDocument.fsPath and _scepterLineOffset
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
   *
   * @implements {R012.§7.AC.05} folder-note aggregation routes through noteFileManager (sync mirror)
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
const BARE_NOTE_ID_RE = /^[A-Z]{1,5}\d{3,5}$/;

/** True when `fqid` is a bare note id (no dot) — e.g. `R044`, `DD012`.
 *  Used by the body-map BFS to route note seeds to the note body
 *  resolver instead of the claim body resolver. */
function isBareNoteId(fqid: string): boolean {
  return BARE_NOTE_ID_RE.test(fqid);
}

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
