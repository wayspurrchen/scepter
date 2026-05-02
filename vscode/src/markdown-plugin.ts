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

    // Cross-project routing — route alias-prefixed matches to a distinct
    // CSS class (`scepter-cross-project`) and a click-target that
    // dispatches the `scepter.openCrossProject` command. The peer file
    // path is not known at render time (resolution is async), so the
    // command handler in extension.ts resolves and opens at click time.
    // The data attributes stay on the element so the tooltip/webview
    // script can also dispatch via postMessage if `command:` URIs are
    // blocked by the host.
    // @implements {R011.§4.AC.08} markdown preview marks cross-project distinctly + click-target
    // @implements {DD015.§1.DC.07} class names match decoration-provider purple hue (visual cohesion editor↔preview)
    if (match.aliasPrefix) {
      const aliasEntry = index.getAlias(match.aliasPrefix);
      const cssClass = aliasEntry?.resolved
        ? 'scepter-cross-project scepter-cross-project-resolved'
        : 'scepter-cross-project scepter-cross-project-unresolved';
      const escaped = escapeHtml(match.raw);
      const escAttr = (s: string) => s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const titleSuffix = aliasEntry?.resolved
        ? `peer at ${aliasEntry.resolvedPath}`
        : aliasEntry
          ? `unresolved (${aliasEntry.unresolvedReason ?? 'unknown'})`
          : 'alias not declared';
      // Build a command: URI for click dispatch. Args are JSON-encoded
      // [aliasName, normalizedId] so the handler can call
      // claimIndex.resolveCrossProject(aliasName, address) at click time.
      const cmdArgs = encodeURIComponent(JSON.stringify([match.aliasPrefix, match.normalizedId]));
      const href = `command:scepter.openCrossProject?${cmdArgs}`;
      const dataAttrs = `data-scepter-alias="${escAttr(match.aliasPrefix)}" data-scepter-id="${escAttr(match.normalizedId)}"`;
      const tooltip = `title="Cross-project: ${escAttr(match.aliasPrefix)}/${escAttr(match.normalizedId)} — ${escAttr(titleSuffix)}"`;
      // Wrap in <a> so the markdown preview's click handler dispatches.
      // If `command:` URIs are blocked by the preview host, the link
      // renders but the click is a no-op; the visual styling and
      // hover/decoration paths still convey the citation.
      result += `<a href="${href}" class="scepter-ref ${cssClass}" ${dataAttrs} ${tooltip}>${escaped}</a>`;
      cursor = match.end;
      continue;
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
    const sectionEntry = index.lookupSection(normalizedId, contextNoteId ?? undefined);
    if (sectionEntry) {
      const noteInfo = index.lookupNote(sectionEntry.noteId);
      const noteTitle = noteInfo?.noteTitle ?? sectionEntry.noteId;
      attrs.push(`data-section-fqid="${esc(sectionEntry.fqid)}"`);
      attrs.push(`data-section-heading="${esc(sectionEntry.heading)}"`);
      attrs.push(`data-section-line="${sectionEntry.line}"`);
      attrs.push(`data-note-type="${esc(sectionEntry.noteType)}"`);
      attrs.push(`data-note-title="${esc(noteTitle)}"`);
      attrs.push(`data-note-file="${esc(sectionEntry.noteFilePath)}"`);
      attrs.push(`title="${esc(sectionEntry.fqid)} — ${esc(sectionEntry.heading)}"`);
    } else {
      attrs.push(`title="Section §${esc(normalizedId)} — not in index"`);
    }
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
  } else if (kind === 'section') {
    const sectionEntry = index.lookupSection(normalizedId, contextNoteId ?? undefined);
    if (sectionEntry?.noteFilePath) {
      return toRelativeHref(sectionEntry.noteFilePath, sectionEntry.line);
    }
  }

  return null;
}
