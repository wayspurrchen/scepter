/**
 * Shared structured-descriptor builder for the refs panel surfaced by
 * both the editor hover provider and the markdown-preview tooltip.
 *
 * Both surfaces previously forked their own copy of the
 * sources/notes-grouping logic and the citing-line snippet algorithm.
 * The forks drifted only in their wrappers (inline `style="opacity:0.6"`
 * for the editor's MarkdownString vs `class="scepter-snippet-dim"` for
 * the preview's stylesheet) and in their escape function (`escapeMarkdown`
 * for the editor, plain `escHtml` for the webview). Everything else —
 * the head-budget vs window-around-hit truncation, the
 * derivation-vs-reference classification, the per-note grouping, the
 * `firstSentence` heading-excerpt rule — was duplicated.
 *
 * This module produces a structured `RefsPanelDescriptor`. The two
 * surfaces walk it and apply their own escape + wrapper at the
 * rendering boundary. The descriptor's `SnippetSegment` list captures
 * the snippet algorithm output without committing to either surface's
 * formatting choices.
 *
 * @implements {R012.§2.AC.04} sources/notes split with counts; "no X references" lines when empty
 * @implements {R012.§2.AC.05} notes grouped by source noteId; derivation vs reference flag
 * @implements {R012.§2.AC.06} derivation: localId + heading excerpt; reference: localId + citing-line snippet
 * @implements {R012.§2.AC.07} head-budget vs window-around-hit truncation
 */

import * as path from 'path';
import { ClaimIndexCache, ClaimCrossReference } from './claim-index';
import { findAllMatches } from './patterns';

// --- Snippet budget tuning ---
// Single source of truth for the citing-line snippet truncation budgets.
// Both the editor hover and the preview tooltip walk the same
// SnippetDescriptor produced under these budgets, so output windows
// match across surfaces.
const SNIPPET_HEAD = 80;
const SNIPPET_WINDOW_BEFORE = 50;
const SNIPPET_WINDOW_AFTER = 70;
const SNIPPET_SIMPLE_CAP = 200;

// --- Descriptor types ---

export interface RefsPanelDescriptor {
  sources: SourceRefDescriptor[];
  noteGroups: NoteGroupDescriptor[];
}

export interface SourceRefDescriptor {
  /** Path relative to projectDir — what the user reads in the panel. */
  rel: string;
  /** Absolute path — used at the rendering boundary to construct hrefs. */
  abs: string;
  line: number;
}

export interface NoteGroupDescriptor {
  noteId: string;
  noteType: string;
  noteTitle: string;
  /** Note's primary file path (relative or absolute, as stored in the
   *  index). Surface code resolves to absolute via
   *  `index.resolveFilePath` when constructing the header link. */
  noteFilePath: string | null;
  items: RefItemDescriptor[];
}

export type RefItemDescriptor =
  | {
      kind: 'derivation';
      localId: string;
      headingExcerpt: string;
      line: number;
      abs: string;
    }
  | {
      kind: 'reference';
      localId: string;
      snippet: SnippetDescriptor;
      line: number;
      abs: string;
    };

export interface SnippetDescriptor {
  segments: SnippetSegment[];
}

export type SnippetSegment =
  | { kind: 'dim'; text: string }
  | { kind: 'hit'; text: string }
  | { kind: 'unavailable' }
  | { kind: 'empty' };

// --- Builder options ---

export interface BuildRefsPanelOptions {
  projectDir: string;
  /** Source for citing-line lookup. Both call sites pass the synchronous
   *  aggregated-line accessor `(id) => index.getAggregatedNoteLinesSync(id)`.
   *  The async path that previously lived in the editor hover (one
   *  `await` per distinct source note, in parallel) was the cause of
   *  the per-hover stall — see the architectural review doc dated
   *  2026-05-03. */
  getNoteLines: (noteId: string) => string[] | null;
}

// --- Public API ---

/**
 * Build the structured refs-panel descriptor for a given target FQID.
 * The two rendering surfaces (editor hover, preview tooltip) walk the
 * descriptor and apply their own escape + wrapper.
 */
export function buildRefsPanelDescriptor(
  index: ClaimIndexCache,
  targetFqid: string,
  options: BuildRefsPanelOptions,
): RefsPanelDescriptor {
  const incoming = index.incomingRefs(targetFqid);
  const sourceRefs = incoming.filter((r) => r.fromNoteId.startsWith('source:'));
  const noteRefs = incoming.filter((r) => !r.fromNoteId.startsWith('source:'));

  return {
    sources: buildSources(index, sourceRefs, options.projectDir),
    noteGroups: buildNoteGroups(index, noteRefs, targetFqid, options.getNoteLines),
  };
}

/**
 * Take the first sentence (or up to maxLen characters) of a heading.
 * Single source of truth for the heading-excerpt rule used by both
 * the refs panel (derivation rows) and the range-hover renderer.
 */
export function firstSentence(text: string, maxLen: number): string {
  const trimmed = text.trim();
  const period = trimmed.search(/[.!?](\s|$)/);
  const cutoff = period > 0 && period < maxLen ? period + 1 : maxLen;
  return trimmed.length <= cutoff ? trimmed : trimmed.slice(0, cutoff).trimEnd() + '…';
}

// --- Internals ---

function buildSources(
  index: ClaimIndexCache,
  sourceRefs: ClaimCrossReference[],
  projectDir: string,
): SourceRefDescriptor[] {
  const out: SourceRefDescriptor[] = [];
  for (const r of sourceRefs) {
    const abs = index.resolveFilePath(r.filePath) ?? r.filePath;
    const rel = path.relative(projectDir, abs);
    out.push({ rel, abs, line: r.line });
  }
  return out;
}

function buildNoteGroups(
  index: ClaimIndexCache,
  noteRefs: ClaimCrossReference[],
  targetFqid: string,
  getNoteLines: (noteId: string) => string[] | null,
): NoteGroupDescriptor[] {
  // Group refs by source note id, preserving insertion order.
  const grouped = new Map<string, ClaimCrossReference[]>();
  for (const r of noteRefs) {
    const arr = grouped.get(r.fromNoteId) ?? [];
    arr.push(r);
    grouped.set(r.fromNoteId, arr);
  }

  const groups: NoteGroupDescriptor[] = [];
  for (const [noteId, refs] of grouped) {
    const info = index.lookupNote(noteId);
    // Citing-line lookup is per-group: one cache hit per source note.
    // The sync accessor goes through the body resolver's bounded LRU
    // (see ClaimBodyResolver.getNoteLinesSync) — no filesystem await.
    const noteLines = getNoteLines(noteId);

    const items: RefItemDescriptor[] = [];
    for (const r of refs) {
      const sourceEntry = index.lookup(r.fromClaim);
      const isDerivation = sourceEntry?.derivedFrom.includes(targetFqid) ?? false;
      const abs = index.resolveFilePath(r.filePath) ?? r.filePath;
      const localId = r.fromClaim.startsWith(`${noteId}.`)
        ? r.fromClaim.slice(noteId.length + 1)
        : r.fromClaim;

      if (isDerivation && sourceEntry) {
        items.push({
          kind: 'derivation',
          localId,
          headingExcerpt: firstSentence(sourceEntry.heading, 80),
          line: r.line,
          abs,
        });
      } else {
        // When the source claim isn't in the index, fall back to a
        // synthetic "line N" label so the row still surfaces the ref.
        const refLocalId = sourceEntry ? localId : `line ${r.line}`;
        items.push({
          kind: 'reference',
          localId: refLocalId,
          snippet: buildSnippetDescriptor(noteLines, r.line, targetFqid, index),
          line: r.line,
          abs,
        });
      }
    }

    groups.push({
      noteId,
      noteType: info?.noteType ?? '',
      noteTitle: info?.noteTitle ?? noteId,
      noteFilePath: info?.noteFilePath ?? null,
      items,
    });
  }

  return groups;
}

/**
 * Build the snippet segment list for the line containing a reference.
 *
 * Long-line behavior: if the hit lives past the head budget, the
 * snippet shows the start of the line (so the reader keeps the
 * leading-context like "see also" or "derives from"), an ellipsis,
 * then a window centered on the hit. Without this, a citation that
 * appears 300 chars into a list-item line is completely cut off.
 *
 * The output is a list of `SnippetSegment`s. The renderer at each
 * surface applies escape + wrapper:
 *   editor:   wrap dim in `<span style="opacity:0.6">…</span>`,
 *             wrap hit in `<b>…</b>`, escape via escapeMarkdown.
 *   preview:  wrap dim in `<span class="scepter-snippet-dim">…</span>`,
 *             wrap hit in `<b>…</b>`, escape via escHtml.
 */
function buildSnippetDescriptor(
  noteLines: string[] | null | undefined,
  line: number,
  targetFqid: string,
  index: ClaimIndexCache,
): SnippetDescriptor {
  if (!noteLines || line < 1 || line > noteLines.length) {
    return { segments: [{ kind: 'unavailable' }] };
  }
  const raw = noteLines[line - 1].trim();
  if (raw.length === 0) {
    return { segments: [{ kind: 'empty' }] };
  }

  const matches = findAllMatches(raw, true, index.knownShortcodes);
  const hit = matches.find((m) => m.normalizedId === targetFqid);

  // No locatable hit: head-only truncation. The reader doesn't lose
  // anything by not seeing a bolded span.
  if (!hit) {
    const truncated = raw.length > SNIPPET_SIMPLE_CAP ? raw.slice(0, SNIPPET_SIMPLE_CAP) + '…' : raw;
    return { segments: [{ kind: 'dim', text: truncated }] };
  }

  // Hit is in the head budget: show start-of-line through hit-with-trail.
  if (hit.start < SNIPPET_HEAD) {
    const tailEnd = Math.min(raw.length, Math.max(SNIPPET_SIMPLE_CAP, hit.end + SNIPPET_WINDOW_AFTER));
    const before = raw.slice(0, hit.start);
    const matched = raw.slice(hit.start, Math.min(hit.end, tailEnd));
    const after = raw.slice(Math.min(hit.end, tailEnd), tailEnd);
    const ellipsis = tailEnd < raw.length ? '…' : '';
    return {
      segments: [
        { kind: 'dim', text: before },
        { kind: 'hit', text: matched },
        { kind: 'dim', text: after + ellipsis },
      ],
    };
  }

  // Hit is past the head budget: head + ellipsis + windowed-around-hit.
  const head = raw.slice(0, SNIPPET_HEAD);
  const winStart = Math.max(SNIPPET_HEAD, hit.start - SNIPPET_WINDOW_BEFORE);
  const winEnd = Math.min(raw.length, hit.end + SNIPPET_WINDOW_AFTER);
  const beforeHit = raw.slice(winStart, hit.start);
  const matched = raw.slice(hit.start, Math.min(hit.end, winEnd));
  const afterHit = raw.slice(Math.min(hit.end, winEnd), winEnd);
  const trailEllipsis = winEnd < raw.length ? '…' : '';
  return {
    segments: [
      { kind: 'dim', text: head + ' … ' + beforeHit },
      { kind: 'hit', text: matched },
      { kind: 'dim', text: afterHit + trailEllipsis },
    ],
  };
}
