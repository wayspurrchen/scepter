/**
 * markdown-it plugin factory for SCEpter claim references in the markdown preview.
 *
 * @implements {DD012.§DC.14} Uses findAllMatches from patterns.ts instead of duplicating regexes
 *
 * Wraps claim/note references in styled <a>/<span> elements with data-*
 * attributes containing claim metadata. The preview script
 * (media/preview-script.js) reads these attributes to show rich hover
 * tooltips in the markdown preview.
 *
 * This module runs in the extension host (NOT the webview), so it has access
 * to the claim index via the closure passed from extension.ts. Anything that
 * the webview cannot compute synchronously (file reads, claim cross-ref
 * lookup, etc.) is pre-computed here and emitted as a data attribute.
 */

import * as path from 'path';
import { ClaimIndexCache, ClaimIndexEntry } from './claim-index';
import { findAllMatches, noteIdFromPath, type ClaimMatch } from './patterns';

/**
 * Create a markdown-it plugin that has access to the claim index.
 */
export function createScepterPlugin(index: ClaimIndexCache) {
  return function scepterPlugin(md: any): void {
    const defaultTextRender = md.renderer.rules.text ||
      function (tokens: any[], idx: number): string {
        return md.utils.escapeHtml(tokens[idx].content);
      };

    // Core ruler that propagates source-line numbers from inline tokens to
    // their text children, so the text renderer can correlate a rendered
    // claim id with its definition line.
    md.core.ruler.push('scepter-line-tracker', function (state: any) {
      for (const tok of state.tokens) {
        if (tok.type === 'inline' && Array.isArray(tok.children) && tok.map) {
          const parentLine = tok.map[0]; // 0-indexed
          for (const child of tok.children) {
            child._scepterLine = parentLine;
          }
        }
      }
    });

    // Build the crossref-count badge for a block whose source line we
    // know. Returns '' when no claim of the current note is defined at
    // that line, or when the claim has no inbound refs. Same color
    // encoding as the editor decoration: green = any source ref, red =
    // only note-to-note. Block close hooks (heading_close, paragraph_close)
    // call this so the badge appears just before the closing tag,
    // regardless of how the inline content was rendered.
    // Fallback path: if the text-render hook didn't emit the badge for
    // this block (e.g., tok.map missing on the inline child), emit it
    // here just before the closing tag. The text-render path is preferred
    // because it places the badge right after the FQID; this catches the
    // tail case so the badge never disappears entirely.
    function buildClaimBadgeForLine(line0: number | undefined, env: any): string {
      if (typeof line0 !== 'number') return '';
      const currentDocPath = env?.currentDocument?.fsPath ?? env?.docUri?.fsPath ?? null;
      const contextNoteId = currentDocPath ? noteIdFromPath(currentDocPath) : null;
      if (!contextNoteId) return '';
      const claims = index.claimsForNote(contextNoteId);
      // line0 is 0-indexed; entry.line is 1-indexed.
      const offset = typeof env?._scepterLineOffset === 'number' ? env._scepterLineOffset : 0;
      const entry = claims.find((e) => e.line === line0 + 1 + offset);
      if (!entry) return '';
      // Skip if the text-render path already emitted the badge inline.
      const emitted: Set<string> | undefined = env?._scepterBadgesEmitted;
      if (emitted && emitted.has(entry.fullyQualified)) return '';
      const refs = index.incomingRefs(entry.fullyQualified);
      if (refs.length === 0) return '';
      const hasSource = refs.some((r) => r.fromNoteId.startsWith('source:'));
      const cls = hasSource ? 'scepter-claim-badge-source' : 'scepter-claim-badge-note';
      return ` <span class="scepter-claim-badge ${cls}" data-scepter-claim-badge="1">●${refs.length}</span>`;
    }

    const defaultHeadingOpen = md.renderer.rules.heading_open ||
      function (tokens: any[], idx: number, options: any, env: any, self: any): string {
        return self.renderToken(tokens, idx, options);
      };
    const defaultHeadingClose = md.renderer.rules.heading_close ||
      function (tokens: any[], idx: number, options: any, env: any, self: any): string {
        return self.renderToken(tokens, idx, options);
      };
    const defaultParagraphOpen = md.renderer.rules.paragraph_open ||
      function (tokens: any[], idx: number, options: any, env: any, self: any): string {
        return self.renderToken(tokens, idx, options);
      };
    const defaultParagraphClose = md.renderer.rules.paragraph_close ||
      function (tokens: any[], idx: number, options: any, env: any, self: any): string {
        return self.renderToken(tokens, idx, options);
      };

    md.renderer.rules.heading_open = function (
      tokens: any[],
      idx: number,
      options: any,
      env: any,
      self: any,
    ): string {
      const tok = tokens[idx];
      if (tok.map) {
        env._scepterHeadingLine = tok.map[0]; // 0-indexed source line
      }
      return defaultHeadingOpen(tokens, idx, options, env, self);
    };
    md.renderer.rules.heading_close = function (
      tokens: any[],
      idx: number,
      options: any,
      env: any,
      self: any,
    ): string {
      const badgeHtml = buildClaimBadgeForLine(env?._scepterHeadingLine, env);
      env._scepterHeadingLine = undefined;
      return badgeHtml + defaultHeadingClose(tokens, idx, options, env, self);
    };

    // Paragraph claims (`§5.AC.01 Some text…` as a standalone paragraph)
    // are the dominant claim shape in real notes. Hook paragraph_open
    // to capture the source line and paragraph_close to emit the badge,
    // mirroring the heading hooks. List-item claims (in tight lists)
    // would need an additional list_item hook; not in scope here.
    md.renderer.rules.paragraph_open = function (
      tokens: any[],
      idx: number,
      options: any,
      env: any,
      self: any,
    ): string {
      const tok = tokens[idx];
      if (tok.map) {
        env._scepterParagraphLine = tok.map[0];
      }
      return defaultParagraphOpen(tokens, idx, options, env, self);
    };
    md.renderer.rules.paragraph_close = function (
      tokens: any[],
      idx: number,
      options: any,
      env: any,
      self: any,
    ): string {
      const badgeHtml = buildClaimBadgeForLine(env?._scepterParagraphLine, env);
      env._scepterParagraphLine = undefined;
      return badgeHtml + defaultParagraphClose(tokens, idx, options, env, self);
    };

    md.renderer.rules.text = function (
      tokens: any[],
      idx: number,
      options: any,
      env: any,
      self: any
    ): string {
      try {
        const tok = tokens[idx];
        const text = tok.content;
        const sourceLine = typeof tok._scepterLine === 'number' ? tok._scepterLine : null;
        const headingLine = typeof env?._scepterHeadingLine === 'number' ? env._scepterHeadingLine : null;
        return highlightWithData(text, md.utils.escapeHtml, index, env, sourceLine, headingLine);
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

// Tunable budgets for citing-line snippets — same numbers as
// hover-provider.buildReferenceSnippet so editor and preview render the
// same window.
const SNIPPET_HEAD = 80;
const SNIPPET_WINDOW_BEFORE = 50;
const SNIPPET_WINDOW_AFTER = 70;
const SNIPPET_SIMPLE_CAP = 200;

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightWithData(
  text: string,
  escapeHtml: (s: string) => string,
  index: ClaimIndexCache,
  env: any,
  /** 0-indexed line of the inline token in the source markdown. */
  sourceLine: number | null,
  /** 0-indexed line of the enclosing heading_open token, if any. */
  headingLine: number | null,
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
    // dispatches the `scepter.openCrossProject` command.
    // @implements {R011.§4.AC.08} markdown preview marks cross-project distinctly + click-target
    // @implements {DD015.§1.DC.07} class names match decoration-provider purple hue (visual cohesion editor↔preview)
    if (match.aliasPrefix) {
      const aliasEntry = index.getAlias(match.aliasPrefix);
      const cssClass = aliasEntry?.resolved
        ? 'scepter-cross-project scepter-cross-project-resolved'
        : 'scepter-cross-project scepter-cross-project-unresolved';
      const escaped = escapeHtml(match.raw);
      const titleSuffix = aliasEntry?.resolved
        ? `peer at ${aliasEntry.resolvedPath}`
        : aliasEntry
          ? `unresolved (${aliasEntry.unresolvedReason ?? 'unknown'})`
          : 'alias not declared';
      const cmdArgs = encodeURIComponent(JSON.stringify([match.aliasPrefix, match.normalizedId]));
      const href = `command:scepter.openCrossProject?${cmdArgs}`;
      const dataAttrs = `data-scepter-alias="${escAttr(match.aliasPrefix)}" data-scepter-id="${escAttr(match.normalizedId)}"`;
      const tooltip = `title="Cross-project: ${escAttr(match.aliasPrefix)}/${escAttr(match.normalizedId)} — ${escAttr(titleSuffix)}"`;
      result += `<a href="${href}" class="scepter-ref ${cssClass}" ${dataAttrs} ${tooltip}>${escaped}</a>`;
      cursor = match.end;
      continue;
    }

    const cssClass = CSS_MAP[match.kind];
    const dataAttrs = buildDataAttrs(
      match,
      index,
      contextNoteId,
      sourceLine,
      currentDocDir,
    );
    const linkTarget = buildLinkTarget(match.normalizedId, match.kind, index, currentDocDir, contextNoteId);
    const escaped = escapeHtml(match.raw);

    if (linkTarget) {
      result += `<a href="${linkTarget}" class="scepter-ref ${cssClass}" ${dataAttrs}>${escaped}</a>`;
    } else {
      result += `<span class="scepter-ref ${cssClass}" ${dataAttrs}>${escaped}</span>`;
    }

    // Inline crossref-count badge anchored right after the FQID. Same
    // placement as the editor decoration: badge sits between the claim
    // id and whatever text follows. We fire it when:
    //   - The match is a claim or bare-claim,
    //   - The text token's source line equals the matched entry's
    //     definition line (so this is the *defining* mention, not a
    //     citation of the same id elsewhere in the document),
    //   - The entry has inbound refs.
    // Dedupe via env._scepterBadgesEmitted: we set the entry's FQID
    // after emission so a block-close fallback hook can skip it.
    if (
      sourceLine !== null &&
      contextNoteId &&
      (match.kind === 'claim' || match.kind === 'bare-claim')
    ) {
      const offset = typeof env?._scepterLineOffset === 'number' ? env._scepterLineOffset : 0;
      const resolved = index.resolve(match.normalizedId, contextNoteId);
      if (
        resolved &&
        resolved.noteId === contextNoteId &&
        resolved.line === sourceLine + 1 + offset
      ) {
        const emitted: Set<string> = env._scepterBadgesEmitted || (env._scepterBadgesEmitted = new Set());
        if (!emitted.has(resolved.fullyQualified)) {
          const refs = index.incomingRefs(resolved.fullyQualified);
          if (refs.length > 0) {
            const hasSource = refs.some((r) => r.fromNoteId.startsWith('source:'));
            const cls = hasSource ? 'scepter-claim-badge-source' : 'scepter-claim-badge-note';
            result += `<span class="scepter-claim-badge ${cls}" data-scepter-claim-badge="1">●${refs.length}</span>`;
            emitted.add(resolved.fullyQualified);
          }
        }
      }
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
  if (env?.currentDocument?.fsPath) {
    return path.dirname(env.currentDocument.fsPath);
  }
  if (env?.docUri?.fsPath) {
    return path.dirname(env.docUri.fsPath);
  }
  return projectDir;
}

function buildDataAttrs(
  match: ClaimMatch,
  index: ClaimIndexCache,
  contextNoteId: string | null,
  sourceLine: number | null,
  currentDocDir: string,
): string {
  const attrs: string[] = [];
  const normalizedId = match.normalizedId;
  const kind = match.kind;

  attrs.push(`data-scepter-id="${escAttr(normalizedId)}"`);
  attrs.push(`data-scepter-kind="${kind}"`);

  // Source line of the rendered span (1-indexed). The webview uses this
  // to detect "original-claim" hover mode (source line equals the claim
  // definition line in the same note).
  if (sourceLine !== null) {
    attrs.push(`data-scepter-source-line="${sourceLine + 1}"`);
  }
  if (contextNoteId) {
    attrs.push(`data-scepter-context-note="${escAttr(contextNoteId)}"`);
  }

  if (kind === 'claim' || kind === 'bare-claim') {
    const entry = index.resolve(normalizedId, contextNoteId ?? undefined);
    if (entry) {
      attrs.push(`data-claim-fqid="${escAttr(entry.fullyQualified)}"`);
      attrs.push(`data-claim-heading="${escAttr(entry.heading)}"`);
      attrs.push(`data-claim-line="${entry.line}"`);

      const noteInfo = index.lookupNote(entry.noteId);
      attrs.push(`data-note-type="${escAttr(entry.noteType)}"`);
      attrs.push(`data-note-title="${escAttr(noteInfo?.noteTitle ?? entry.noteId)}"`);
      attrs.push(`data-note-file="${escAttr(entry.noteFilePath)}"`);

      if (entry.importance !== undefined) {
        attrs.push(`data-importance="${entry.importance}"`);
      }
      if (entry.lifecycle?.type) {
        attrs.push(`data-lifecycle="${escAttr(entry.lifecycle.type)}"`);
      }
      if (entry.derivedFrom && entry.derivedFrom.length > 0) {
        attrs.push(`data-derives-from="${escAttr(entry.derivedFrom.join(','))}"`);
      }

      // Pre-rendered HTML context for the preview tooltip body panel
      const contextHtml = index.getClaimContextHtml(entry.fullyQualified);
      if (contextHtml) {
        attrs.push(`data-claim-context="${escAttr(contextHtml)}"`);
      }
      // Raw claim body excerpt — used for "show more" expansion in the
      // body panel where the rendered HTML excerpt is too eager.
      const rawContext = index.getClaimContextSync(entry);
      if (rawContext) {
        attrs.push(`data-claim-context-raw="${escAttr(rawContext)}"`);
      }

      // Pre-built refs panel data — sources + grouped notes with
      // derivation/reference distinction and citing-line snippets.
      // Encoded as a JSON array on a data attribute so the webview can
      // build the panel DOM without round-tripping back to the host.
      const refsJson = buildRefsJson(index, entry, currentDocDir);
      if (refsJson) {
        attrs.push(`data-claim-refs="${escAttr(refsJson)}"`);
      }

      attrs.push(`title="${escAttr(entry.fullyQualified)} — ${escAttr(noteInfo?.noteTitle ?? entry.noteType)}"`);
    } else {
      attrs.push(`title="${escAttr(normalizedId)} — not in index"`);
    }
  } else if (kind === 'note') {
    const noteInfo = index.lookupNote(normalizedId);
    if (noteInfo) {
      attrs.push(`data-note-type="${escAttr(noteInfo.noteType)}"`);
      attrs.push(`data-note-title="${escAttr(noteInfo.noteTitle)}"`);
      attrs.push(`data-note-file="${escAttr(noteInfo.noteFilePath)}"`);
      attrs.push(`data-claim-count="${noteInfo.claimCount}"`);

      const excerptHtml = index.getNoteExcerptHtml(noteInfo.noteId);
      if (excerptHtml) {
        attrs.push(`data-note-excerpt="${escAttr(excerptHtml)}"`);
      }

      attrs.push(`title="${escAttr(normalizedId)} — ${escAttr(noteInfo.noteTitle)}"`);
    } else {
      attrs.push(`title="${escAttr(normalizedId)} — not in index"`);
    }
  } else if (kind === 'section') {
    const sectionEntry = index.lookupSection(normalizedId, contextNoteId ?? undefined);
    if (sectionEntry) {
      const noteInfo = index.lookupNote(sectionEntry.noteId);
      const noteTitle = noteInfo?.noteTitle ?? sectionEntry.noteId;
      attrs.push(`data-section-fqid="${escAttr(sectionEntry.fqid)}"`);
      attrs.push(`data-section-heading="${escAttr(sectionEntry.heading)}"`);
      attrs.push(`data-section-line="${sectionEntry.line}"`);
      attrs.push(`data-note-type="${escAttr(sectionEntry.noteType)}"`);
      attrs.push(`data-note-title="${escAttr(noteTitle)}"`);
      attrs.push(`data-note-file="${escAttr(sectionEntry.noteFilePath)}"`);
      attrs.push(`title="${escAttr(sectionEntry.fqid)} — ${escAttr(sectionEntry.heading)}"`);
    } else {
      attrs.push(`title="Section §${escAttr(normalizedId)} — not in index"`);
    }
  }

  // Range-expansion hover (one row per range member). Emit the array of
  // FQIDs as a JSON-encoded data attribute so the webview script can
  // render one row per member.
  // @implements {R011.§4.AC.08}
  if (match.rangeMembers && match.rangeMembers.length > 1) {
    const memberData = match.rangeMembers.map((fqid) => {
      const entry = index.resolve(fqid, contextNoteId ?? undefined);
      if (!entry) return { fqid, found: false };
      const noteInfo = index.lookupNote(entry.noteId);
      return {
        fqid,
        found: true,
        heading: firstSentence(entry.heading, 80),
        noteType: entry.noteType,
        noteTitle: noteInfo?.noteTitle ?? entry.noteId,
        noteFile: entry.noteFilePath,
        line: entry.line,
      };
    });
    attrs.push(`data-claim-range-members="${escAttr(JSON.stringify(memberData))}"`);
  }

  return attrs.join(' ');
}

/**
 * Build a JSON-encoded refs panel descriptor for the preview tooltip.
 * Mirrors the layout produced by `hover-provider.buildRefsHtml` but
 * structured (not stringified HTML) so the webview can build DOM, attach
 * click handlers, and apply collapsibles per group. Citing-line snippets
 * use the same head-budget / window-around-hit truncation as the editor
 * hover so output is visually consistent across surfaces.
 *
 * Returns null if there are no refs at all (caller skips the attribute).
 */
function buildRefsJson(
  index: ClaimIndexCache,
  entry: ClaimIndexEntry,
  currentDocDir: string,
): string | null {
  const projectDir = index.projectDir;
  const incoming = index.incomingRefs(entry.fullyQualified);
  const sourceRefs = incoming.filter((r) => r.fromNoteId.startsWith('source:'));
  const noteRefs = incoming.filter((r) => !r.fromNoteId.startsWith('source:'));

  // Sources subsection — list of file:line entries with command: hrefs.
  const sources = sourceRefs.map((r) => {
    const abs = index.resolveFilePath(r.filePath) ?? r.filePath;
    const rel = path.relative(projectDir, abs);
    const href = makeOpenCommandHref(abs, r.line || 1);
    return { rel, line: r.line, href };
  });

  // Notes subsection — group by source noteId. Per-ref item carries
  // either `derivation` (with heading excerpt) or `reference` (with
  // citing-line snippetHtml) flag.
  const targetFqid = entry.fullyQualified;
  const grouped = new Map<string, typeof noteRefs>();
  for (const r of noteRefs) {
    const arr = grouped.get(r.fromNoteId) ?? [];
    arr.push(r);
    grouped.set(r.fromNoteId, arr);
  }

  const noteGroups: any[] = [];
  for (const [noteId, refs] of grouped) {
    const info = index.lookupNote(noteId);
    const noteHref = info?.noteFilePath
      ? makeOpenCommandHref(index.resolveFilePath(info.noteFilePath), 1)
      : null;
    const items: any[] = [];
    const noteLines = index.getAggregatedNoteLinesSync(noteId);

    for (const r of refs) {
      const sourceEntry = index.lookup(r.fromClaim);
      const isDerivation = sourceEntry?.derivedFrom.includes(targetFqid) ?? false;
      const abs = index.resolveFilePath(r.filePath) ?? r.filePath;
      const itemHref = makeOpenCommandHref(abs, r.line || 1);

      if (isDerivation && sourceEntry) {
        const localId = r.fromClaim.startsWith(`${noteId}.`)
          ? r.fromClaim.slice(noteId.length + 1)
          : r.fromClaim;
        const excerpt = firstSentence(sourceEntry.heading, 80);
        items.push({
          kind: 'derivation',
          localId,
          headingExcerpt: excerpt,
          href: itemHref,
          line: r.line,
        });
      } else {
        const linkText = sourceEntry
          ? (r.fromClaim.startsWith(`${noteId}.`)
              ? r.fromClaim.slice(noteId.length + 1)
              : r.fromClaim)
          : `line ${r.line}`;
        const snippetHtml = buildReferenceSnippetHtml(noteLines, r.line, targetFqid, index);
        items.push({
          kind: 'reference',
          localId: linkText,
          snippetHtml,
          href: itemHref,
          line: r.line,
        });
      }
    }

    noteGroups.push({
      noteId,
      noteType: info?.noteType ?? '',
      noteTitle: info?.noteTitle ?? noteId,
      noteHref,
      items,
    });
  }

  // Skip the attribute entirely when there are no refs at all so the
  // webview can fall back to the simple original layout (no Sources /
  // Notes sections cluttering the tooltip).
  if (sources.length === 0 && noteGroups.length === 0) {
    return null;
  }

  return JSON.stringify({ sources, noteGroups });
}

/**
 * Build a `command:scepter.previewOpenAt?...` href that opens a file at a
 * given line. The markdown preview dispatches this URI the same way it
 * dispatches our cross-project alias links. We use a thin SCEpter-owned
 * command (registered in extension.ts) instead of `vscode.open` directly
 * because plain string args round-trip through the preview's CSP more
 * reliably than the `[vscode.Uri, options]` shape required by
 * `vscode.open`.
 */
function makeOpenCommandHref(absPath: string, line: number): string {
  const args = encodeURIComponent(JSON.stringify([absPath, line || 1]));
  return `command:scepter.previewOpenAt?${args}`;
}

/**
 * Build an HTML snippet for the line containing a reference. The
 * surrounding text is dimmed; the target FQID is bolded if locatable
 * via the same matcher the decoration layer uses. Mirrors the editor
 * hover algorithm in `hover-provider.buildReferenceSnippet`.
 */
function buildReferenceSnippetHtml(
  noteLines: string[] | null,
  line: number,
  targetFqid: string,
  index: ClaimIndexCache,
): string {
  if (!noteLines || line < 1 || line > noteLines.length) {
    return `<span class="scepter-snippet-dim"><i>(snippet unavailable)</i></span>`;
  }
  const raw = noteLines[line - 1].trim();
  if (raw.length === 0) {
    return `<span class="scepter-snippet-dim"><i>(empty line)</i></span>`;
  }

  const matches = findAllMatches(raw, true, index.knownShortcodes);
  const hit = matches.find((m) => m.normalizedId === targetFqid);

  if (!hit) {
    const truncated = raw.length > SNIPPET_SIMPLE_CAP ? raw.slice(0, SNIPPET_SIMPLE_CAP) + '…' : raw;
    return `<span class="scepter-snippet-dim">${escHtml(truncated)}</span>`;
  }

  if (hit.start < SNIPPET_HEAD) {
    const tailEnd = Math.min(raw.length, Math.max(SNIPPET_SIMPLE_CAP, hit.end + SNIPPET_WINDOW_AFTER));
    const before = raw.slice(0, hit.start);
    const matched = raw.slice(hit.start, Math.min(hit.end, tailEnd));
    const after = raw.slice(Math.min(hit.end, tailEnd), tailEnd);
    const ellipsis = tailEnd < raw.length ? '…' : '';
    return (
      `<span class="scepter-snippet-dim">${escHtml(before)}</span>` +
      `<b>${escHtml(matched)}</b>` +
      `<span class="scepter-snippet-dim">${escHtml(after)}${ellipsis}</span>`
    );
  }

  const head = raw.slice(0, SNIPPET_HEAD);
  const winStart = Math.max(SNIPPET_HEAD, hit.start - SNIPPET_WINDOW_BEFORE);
  const winEnd = Math.min(raw.length, hit.end + SNIPPET_WINDOW_AFTER);
  const beforeHit = raw.slice(winStart, hit.start);
  const matched = raw.slice(hit.start, Math.min(hit.end, winEnd));
  const afterHit = raw.slice(Math.min(hit.end, winEnd), winEnd);
  const trailEllipsis = winEnd < raw.length ? '…' : '';
  return (
    `<span class="scepter-snippet-dim">${escHtml(head)} … ${escHtml(beforeHit)}</span>` +
    `<b>${escHtml(matched)}</b>` +
    `<span class="scepter-snippet-dim">${escHtml(afterHit)}${trailEllipsis}</span>`
  );
}

/** Take the first sentence (or up to maxLen characters) for ref previews. */
function firstSentence(text: string, maxLen: number): string {
  const trimmed = text.trim();
  const period = trimmed.search(/[.!?](\s|$)/);
  const cutoff = period > 0 && period < maxLen ? period + 1 : maxLen;
  return trimmed.length <= cutoff ? trimmed : trimmed.slice(0, cutoff).trimEnd() + '…';
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
  contextNoteId: string | null,
): string | null {
  function toRelativeHref(filePath: string, line?: number): string {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(index.projectDir, filePath);
    let rel = path.relative(currentDocDir, abs);
    if (!rel.startsWith('.')) {
      rel = './' + rel;
    }
    rel = rel.split('/').map(encodeURIComponent).join('/');
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
