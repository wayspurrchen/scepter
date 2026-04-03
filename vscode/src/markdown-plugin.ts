/**
 * markdown-it plugin factory for SCEpter claim references in the markdown preview.
 *
 * @implements {DD012.§DC.14} Uses findAllMatches from patterns.ts instead of duplicating regexes
 *
 * Wraps claim/note references in styled <span> elements with data-* attributes
 * containing claim metadata. The preview script (media/preview-script.js) reads
 * these attributes to show rich hover tooltips in the webview.
 *
 * This module runs in the extension host (NOT the webview), so it has access
 * to the claim index via the closure passed from extension.ts.
 */

import * as path from 'path';
import { ClaimIndexCache } from './claim-index';
import { findAllMatches, noteIdFromPath, type ClaimMatch } from './patterns';

interface Replacement {
  start: number;
  end: number;
  html: string;
}

/**
 * Create a markdown-it plugin that has access to the claim index.
 */
export function createScepterPlugin(index: ClaimIndexCache) {
  return function scepterPlugin(md: any): void {
    const defaultTextRender = md.renderer.rules.text ||
      function (tokens: any[], idx: number): string {
        return md.utils.escapeHtml(tokens[idx].content);
      };

    md.renderer.rules.text = function (
      tokens: any[],
      idx: number,
      options: any,
      env: any,
      self: any
    ): string {
      try {
        const text = tokens[idx].content;
        return highlightWithData(text, md.utils.escapeHtml, index, env);
      } catch (err) {
        // Never crash the renderer — fall back to default escaped text
        console.error('[SCEpter markdown plugin] render error:', err);
        return defaultTextRender(tokens, idx, options, env, self);
      }
    };

  };
}

const CSS_MAP: Record<ClaimMatch['kind'], string> = {
  'claim': 'scepter-claim',
  'bare-claim': 'scepter-bare-claim',
  'note': 'scepter-note',
  'section': 'scepter-section',
};

function highlightWithData(
  text: string,
  escapeHtml: (s: string) => string,
  index: ClaimIndexCache,
  env: any
): string {
  // Markdown preview always uses markdown mode + all known shortcodes
  const matches = findAllMatches(text, true, index.knownShortcodes);

  if (matches.length === 0) {
    return escapeHtml(text);
  }

  // Extract the current document's directory and note ID from env.
  const currentDocDir = resolveCurrentDocDir(env, index.projectDir);
  const currentDocPath = env?.currentDocument?.fsPath ?? env?.docUri?.fsPath ?? null;
  const contextNoteId = currentDocPath ? noteIdFromPath(currentDocPath) : null;

  // Sort by position (should already be ordered, but be safe)
  matches.sort((a, b) => a.start - b.start);

  let result = '';
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      result += escapeHtml(text.slice(cursor, match.start));
    }

    const cssClass = CSS_MAP[match.kind];
    const dataAttrs = buildDataAttrs(match.normalizedId, match.kind, index, contextNoteId);
    const linkTarget = buildLinkTarget(match.normalizedId, match.kind, index, currentDocDir, contextNoteId);
    const escaped = escapeHtml(match.raw);

    if (linkTarget) {
      result += `<a href="${linkTarget}" class="scepter-ref ${cssClass}" ${dataAttrs}>${escaped}</a>`;
    } else {
      result += `<span class="scepter-ref ${cssClass}" ${dataAttrs}>${escaped}</span>`;
    }
    cursor = match.end;
  }
  if (cursor < text.length) {
    result += escapeHtml(text.slice(cursor));
  }

  return result;
}

/**
 * Extract the directory of the currently-rendered markdown document from env.
 * VS Code's markdown extension may provide the URI in various env properties.
 * Falls back to the project root if not available.
 */
function resolveCurrentDocDir(env: any, projectDir: string): string {
  // VS Code's markdown extension passes the document URI in env.currentDocument
  if (env?.currentDocument?.fsPath) {
    return path.dirname(env.currentDocument.fsPath);
  }
  // Some versions use env.normalizeLink or env.docUri
  if (env?.docUri?.fsPath) {
    return path.dirname(env.docUri.fsPath);
  }
  // Fallback: assume we're at the project root
  return projectDir;
}

function buildDataAttrs(
  normalizedId: string,
  kind: string,
  index: ClaimIndexCache,
  contextNoteId: string | null
): string {
  const attrs: string[] = [];
  const esc = (s: string) => s.replace(/"/g, '&quot;').replace(/</g, '&lt;');

  attrs.push(`data-scepter-id="${esc(normalizedId)}"`);
  attrs.push(`data-scepter-kind="${kind}"`);

  if (kind === 'claim' || kind === 'bare-claim') {
    // Resolve with context note to disambiguate bare claims like DC.01
    const entry = index.resolve(normalizedId, contextNoteId ?? undefined);
    if (entry) {
      attrs.push(`data-claim-fqid="${esc(entry.fullyQualified)}"`);
      attrs.push(`data-claim-heading="${esc(entry.heading)}"`);
      attrs.push(`data-claim-line="${entry.line}"`);

      const noteInfo = index.lookupNote(entry.noteId);
      attrs.push(`data-note-type="${esc(entry.noteType)}"`);
      attrs.push(`data-note-title="${esc(noteInfo?.noteTitle ?? entry.noteId)}"`);
      attrs.push(`data-note-file="${esc(entry.noteFilePath)}"`);

      if (entry.importance !== undefined) {
        attrs.push(`data-importance="${entry.importance}"`);
      }

      // Pre-rendered HTML context for the preview tooltip
      const contextHtml = index.getClaimContextHtml(entry.fullyQualified);
      if (contextHtml) {
        attrs.push(`data-claim-context="${esc(contextHtml)}"`);
      }

      attrs.push(`title="${esc(entry.fullyQualified)} — ${esc(noteInfo?.noteTitle ?? entry.noteType)}"`);
    } else {
      attrs.push(`title="${esc(normalizedId)} — not in index"`);
    }
  } else if (kind === 'note') {
    const noteInfo = index.lookupNote(normalizedId);
    if (noteInfo) {
      attrs.push(`data-note-type="${esc(noteInfo.noteType)}"`);
      attrs.push(`data-note-title="${esc(noteInfo.noteTitle)}"`);
      attrs.push(`data-note-file="${esc(noteInfo.noteFilePath)}"`);
      attrs.push(`data-claim-count="${noteInfo.claimCount}"`);

      // Pre-rendered HTML excerpt for the preview tooltip
      const excerptHtml = index.getNoteExcerptHtml(noteInfo.noteId);
      if (excerptHtml) {
        attrs.push(`data-note-excerpt="${esc(excerptHtml)}"`);
      }

      attrs.push(`title="${esc(normalizedId)} — ${esc(noteInfo.noteTitle)}"`);
    } else {
      attrs.push(`title="${esc(normalizedId)} — not in index"`);
    }
  } else if (kind === 'section') {
    attrs.push(`title="Section §${esc(normalizedId)}"`);
  }

  return attrs.join(' ');
}

/**
 * Build a relative path link for the markdown preview.
 *
 * The preview's built-in click handler resolves relative hrefs against the
 * current document's directory — the same way regular markdown links work.
 * We compute a relative path from the current document to the target note file.
 * No special URI schemes needed.
 */
function buildLinkTarget(
  normalizedId: string,
  kind: string,
  index: ClaimIndexCache,
  currentDocDir: string,
  contextNoteId: string | null
): string | null {
  function toRelativeHref(filePath: string, line?: number): string {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(index.projectDir, filePath);
    let rel = path.relative(currentDocDir, abs);
    // Ensure it starts with ./ for clarity
    if (!rel.startsWith('.')) {
      rel = './' + rel;
    }
    // Encode path segments for spaces and special chars
    rel = rel.split('/').map(encodeURIComponent).join('/');
    // Line fragment — VS Code markdown preview supports #L<n> fragments
    if (line && line > 1) {
      rel += '#L' + line;
    }
    return rel;
  }

  if (kind === 'claim' || kind === 'bare-claim') {
    const entry = index.resolve(normalizedId, contextNoteId ?? undefined);
    if (entry?.noteFilePath) {
      return toRelativeHref(entry.noteFilePath, entry.line);
    }
  } else if (kind === 'note') {
    const noteInfo = index.lookupNote(normalizedId);
    if (noteInfo?.noteFilePath) {
      return toRelativeHref(noteInfo.noteFilePath);
    }
  }

  return null;
}
