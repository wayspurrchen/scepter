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
import {
  buildRefsPanelDescriptor,
  firstSentence,
  RefsPanelDescriptor,
  SnippetDescriptor,
} from './refs-panel-builder';

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
    // @implements {R012.§1.AC.06} text-render path is preferred badge emission point (line tracker enables it)
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

    // Inject a document-scoped body map at the start of every
    // main-document render. The webview's tooltip body panel uses
    // `window.__scepterBodyMap[fqid]` to fetch a claim's pre-rendered
    // body excerpt at any nesting depth — that's how deeply-nested
    // hovers work without an exponential explosion of inlined data
    // attributes.
    //
    // The map is built lazily, scoped to FQIDs reachable from the
    // current document: we walk the token stream to collect every
    // matched FQID as a seed set, then ask the resolver to follow
    // citations transitively (bounded by depth + total bodies). This
    // replaces the prior approach of stringifying the entire corpus's
    // body cache into every preview render — that ballooned to tens
    // of megabytes on large projects and overwhelmed the webview.
    //
    // Excerpt renders themselves (signalled by `_scepterLineOffset`)
    // skip the injection: each excerpt is a partial document, and its
    // own body map gets stitched in by the parent main-document
    // render anyway via the BFS.
    // @implements {R012.§3.AC.08} body map carried via hidden div data attribute (not inline script)
    // @implements {R012.§8.AC.01} document-scoped body map via resolveTransitive(seeds, depth=5, maxBodies=500)
    // @implements {R012.§8.AC.02} hidden-div carrier survives default markdown preview content security
    md.core.ruler.push('scepter-body-map-inject', function (state: any) {
      if (state.env && typeof state.env._scepterLineOffset === 'number') return;
      if (state.tokens.length > 0 && (state.tokens[0] as any)._scepterBodyMap) return;

      const seeds = collectFqidSeeds(state.tokens, index.knownShortcodes);
      const bodyMap = index.getBodyResolver().resolveTransitive(
        seeds,
        /* maxDepth */ 5,
        /* maxBodies */ 500,
      );

      const obj: Record<string, string> = {};
      for (const [fqid, html] of bodyMap) {
        obj[fqid] = html;
      }
      const json = JSON.stringify(obj);

      // Inject the body map as a hidden DOM element rather than an
      // inline <script>. VS Code's markdown preview defaults to
      // strict content security, which strips inline scripts and
      // surfaces a "some content has been disabled" warning. A data
      // attribute on a regular element survives sanitization. The
      // preview-script.js reads it on load and after every preview
      // mutation and assigns to window.__scepterBodyMap.
      const html =
        '<div id="__scepter-body-map" data-scepter-body-map="' +
        escAttr(json) +
        '" style="display:none"></div>';
      const tok = new state.Token('html_block', '', 0);
      tok.content = html;
      (tok as any)._scepterBodyMap = true;
      state.tokens.unshift(tok);
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
    // @implements {R012.§1.AC.06} block-close fallback hook with dedup against inline emission
    // @implements {R012.§1.AC.07} returns '' when refs.length === 0 (badge omitted for zero-cite claims)
    // @implements {R012.§1.AC.08} excerpt-render line offset (`_scepterLineOffset`) shifts onto original doc coords
    function buildClaimBadgeForLine(line0: number | undefined, env: any): string {
      if (typeof line0 !== 'number') return '';
      const currentDocPath = env?.currentDocument?.fsPath ?? env?.docUri?.fsPath ?? null;
      const contextNoteId = currentDocPath ? noteIdFromPath(currentDocPath) : null;
      if (!contextNoteId) return '';
      const claims = index.claimsForNote(contextNoteId);
      // line0 is 0-indexed; entry.line is 1-indexed. When the renderer
      // is processing an excerpt (a slice of the original document),
      // _scepterLineOffset shifts line0 onto the original doc's lines.
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

    // @implements {R012.§1.AC.01} badge reaches heading-level claim definitions (`### AC.01 — title`)
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
    // @implements {R012.§1.AC.01} badge reaches paragraph-level claim definitions (`§5.AC.01 The system MUST...`)
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

/**
 * Walk a markdown-it token stream and collect every FQID-shaped
 * reference appearing in inline text. Used by the body-map-inject
 * ruler to seed the document-scoped transitive body map. We use the
 * same `findAllMatches` matcher the text renderer uses, so the seed
 * set matches exactly what will be rendered as `<a class="scepter-ref">`.
 *
 * Returns deduplicated normalized IDs; FQID resolution (note vs claim
 * vs section, alias-prefixed cross-project routing) happens later in
 * the resolver — this just feeds candidate ids through.
 */
function collectFqidSeeds(tokens: any[], knownShortcodes: Set<string>): string[] {
  const seen = new Set<string>();
  const visit = (toks: any[]): void => {
    for (const tok of toks) {
      if (tok.type === 'inline' && Array.isArray(tok.children)) {
        visit(tok.children);
        continue;
      }
      if (tok.type === 'text' && typeof tok.content === 'string' && tok.content.length > 0) {
        const matches = findAllMatches(tok.content, true, knownShortcodes);
        for (const m of matches) {
          // Cross-project aliases address peers, not the local body
          // map — skip them. The local body map only contains local
          // claim/note bodies.
          if (m.aliasPrefix) continue;
          if (m.rangeMembers && m.rangeMembers.length > 0) {
            for (const member of m.rangeMembers) {
              if (!seen.has(member)) seen.add(member);
            }
          } else if (!seen.has(m.normalizedId)) {
            seen.add(m.normalizedId);
          }
        }
      }
    }
  };
  visit(tokens);
  return Array.from(seen);
}

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

  // `_scepterLineOffset` is set by the resolver when it pre-renders
  // a body excerpt for the body cache. Body cache content is reused
  // across viewing contexts (a single claim's body shown in any
  // document's tooltip), so relative-path links — which the browser
  // resolves against the *viewer's* current URL, not the renderer's
  // — produce wrong targets when followed from a different document.
  // Switch to absolute file:// URIs in that case.
  const useAbsoluteHrefs = typeof env?._scepterLineOffset === 'number';

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
      useAbsoluteHrefs,
    );
    const linkTarget = buildLinkTarget(match.normalizedId, match.kind, index, currentDocDir, contextNoteId, useAbsoluteHrefs);
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
    // @implements {R012.§1.AC.02} badge displays total inbound count (sources + notes)
    // @implements {R012.§1.AC.03} color encodes source coverage: green for source, red for note-only
    // @implements {R012.§1.AC.05} preview emits inline `<span class="scepter-claim-badge">` adjacent to FQID
    // @implements {R012.§1.AC.06} text-render path is preferred badge emission point; dedup via _scepterBadgesEmitted
    if (
      sourceLine !== null &&
      contextNoteId &&
      (match.kind === 'claim' || match.kind === 'bare-claim')
    ) {
      const resolved = index.resolve(match.normalizedId, contextNoteId);
      if (
        resolved &&
        resolved.noteId === contextNoteId &&
        resolved.line === sourceLine + 1
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
  useAbsolute = false,
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

      // Body excerpt is no longer emitted as a per-ref data attribute.
      // Each claim's pre-rendered body HTML lives in the global
      // `window.__scepterBodyMap` (injected at the start of every
      // main-document render — see the body-map injection ruler);
      // the webview's tooltip body panel looks up by FQID at any
      // nesting depth so deeply-nested hovers work without exponential
      // data-attribute embedding.
      // @implements {R012.§7.AC.03} HTML excerpt available to webview via window.__scepterBodyMap[fqid]

      // Pre-built refs panel data — sources + grouped notes with
      // derivation/reference distinction and citing-line snippets.
      // Encoded as a JSON array on a data attribute so the webview can
      // build the panel DOM without round-tripping back to the host.
      // @implements {R012.§4.AC.08} pre-built JSON descriptor on `data-claim-refs`; webview drops into innerHTML without re-escape
      const refsJson = buildRefsJson(index, entry, currentDocDir, useAbsolute);
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

      // Note excerpt is intentionally NOT eagerly rendered here. Doing
      // so recurses without bound: rendering note A's body calls
      // buildDataAttrs for every note B it cites, which calls
      // resolveNoteBodySync(B), which renders B, etc. Cache doesn't
      // help because entries land after the render returns. Note
      // bodies belong in the body-map walk (resolveTransitive) so the
      // webview can fetch them from window.__scepterBodyMap on demand.
      // Until that's wired, preview note hovers omit the rich excerpt
      // and fall back to title + claim count.
      // @implements {R012.§7.AC.07} no eager resolveNoteBodySync in buildDataAttrs (recursion break)

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
  // @implements {R012.§5.AC.04} plugin emits `data-claim-range-members` JSON-encoded array
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
 *
 * @implements {R012.§4.AC.01} sources/notes split with counts
 * @implements {R012.§4.AC.02} sources rendered as `relative-path:line`
 * @implements {R012.§4.AC.03} notes grouped by source noteId with id/type/title header
 * @implements {R012.§4.AC.05} `kind` flag distinguishes derivation vs reference
 * @implements {R012.§4.AC.06} derivation refs carry localId + heading excerpt
 * @implements {R012.§4.AC.07} reference refs carry localId + citing-line snippetHtml
 * @implements {R012.§4.AC.09} returns null when zero refs (caller omits attribute)
 */
function buildRefsJson(
  index: ClaimIndexCache,
  entry: ClaimIndexEntry,
  currentDocDir: string,
  useAbsolute = false,
): string | null {
  const descriptor = buildRefsPanelDescriptor(index, entry.fullyQualified, {
    projectDir: index.projectDir,
    getNoteLines: (id) => index.getAggregatedNoteLinesSync(id),
  });

  // Skip the attribute entirely when there are no refs at all so the
  // webview can fall back to the simple original layout (no Sources /
  // Notes sections cluttering the tooltip).
  if (descriptor.sources.length === 0 && descriptor.noteGroups.length === 0) {
    return null;
  }

  // Walk the descriptor into the exact JSON shape the webview reads.
  // Field names (`rel`, `line`, `href`, `noteId`, `noteType`, `noteTitle`,
  // `noteHref`, `items[].kind`, `items[].localId`, `items[].headingExcerpt`,
  // `items[].snippetHtml`) match what `media/preview-script.js`
  // (buildRefsPanelHtml) consumes — see preview-script.js:392-471.
  const sources = descriptor.sources.map((src) => ({
    rel: src.rel,
    line: src.line,
    href: buildPreviewHref(src.abs, currentDocDir, src.line || 1, useAbsolute),
  }));

  const noteGroups = descriptor.noteGroups.map((group) => {
    const noteHref = group.noteFilePath
      ? buildPreviewHref(index.resolveFilePath(group.noteFilePath), currentDocDir, undefined, useAbsolute)
      : null;
    const items = group.items.map((item) => {
      const itemHref = buildPreviewHref(item.abs, currentDocDir, item.line || 1, useAbsolute);
      if (item.kind === 'derivation') {
        return {
          kind: 'derivation',
          localId: item.localId,
          headingExcerpt: item.headingExcerpt,
          href: itemHref,
          line: item.line,
        };
      }
      return {
        kind: 'reference',
        localId: item.localId,
        snippetHtml: renderSnippetPreviewHtml(item.snippet),
        href: itemHref,
        line: item.line,
      };
    });
    return {
      noteId: group.noteId,
      noteType: group.noteType,
      noteTitle: group.noteTitle,
      noteHref,
      items,
    };
  });

  return JSON.stringify({ sources, noteGroups });
}

/**
 * Walk a SnippetDescriptor into the preview's HTML snippet form. The
 * webview drops `snippetHtml` straight into `innerHTML` (see
 * `media/preview-script.js` buildRefsPanelHtml at the `item.snippetHtml`
 * site), so segments are escaped via `escHtml` and dim segments wear
 * the `scepter-snippet-dim` class — same shape `buildReferenceSnippetHtml`
 * used to produce inline. Hit segments are wrapped in `<b>`. Unavailable
 * and empty markers render the same `<i>(…)</i>` text inside the dim
 * wrapper as before.
 */
function renderSnippetPreviewHtml(snippet: SnippetDescriptor): string {
  let out = '';
  for (const seg of snippet.segments) {
    switch (seg.kind) {
      case 'dim':
        out += `<span class="scepter-snippet-dim">${escHtml(seg.text)}</span>`;
        break;
      case 'hit':
        out += `<b>${escHtml(seg.text)}</b>`;
        break;
      case 'unavailable':
        out += `<span class="scepter-snippet-dim"><i>(snippet unavailable)</i></span>`;
        break;
      case 'empty':
        out += `<span class="scepter-snippet-dim"><i>(empty line)</i></span>`;
        break;
    }
  }
  return out;
}

/**
 * Build a click-target href for the markdown preview, given an
 * absolute target file path, a current-document directory to
 * relativize against, and an optional 1-indexed line number.
 *
 * We use plain relative paths rather than `command:` URIs because VS
 * Code's markdown preview webview blocks `command:` schemes at its
 * CSP level — clicks on `<a href="command:...">` don't dispatch
 * (verified empirically: the bubble-phase listener sees
 * `defaultPrevented: false` and the browser then attempts to
 * navigate to the URL, which the CSP rejects with a "Framing ''
 * violates frame-src 'self'" error and a blank webview).
 *
 * Plain relative paths navigate correctly: VS Code's preview opens
 * the linked markdown in the editor. The `#L<line>` fragment is
 * NOT honored on this path, so the editor lands at the top of the
 * target file rather than at the cited claim. Exact-line jump from
 * the preview would require a webview message protocol the markdown
 * extension owns; for now, users who want line precision can
 * cmd-click via the editor hover (which uses a separate hover
 * renderer that DOES dispatch command URIs reliably).
 */
// @implements {R012.§9.AC.02} preview webview CSP blocks command: URI dispatch — use plain hrefs
// @implements {R012.§9.AC.03} main preview body uses relative paths (line fragment unsupported on this dispatch)
// @implements {R012.§9.AC.04} resolver-rendered body cache content uses absolute file:// URIs (cross-context safe)
function buildPreviewHref(
  absPath: string,
  currentDocDir: string,
  line?: number,
  useAbsolute = false,
): string {
  if (useAbsolute) {
    // file:///abs/path with each segment URL-encoded, preserving slashes.
    // Used for resolver-rendered content (body cache) where the link
    // is viewed in a context whose base URL differs from the renderer's.
    const encodedSegments = absPath.split('/').map((seg, i) => i === 0 ? seg : encodeURIComponent(seg));
    let href = 'file://' + encodedSegments.join('/');
    if (line && line > 1) href += '#L' + line;
    return href;
  }
  let rel = path.relative(currentDocDir, absPath);
  if (!rel.startsWith('.')) rel = './' + rel;
  rel = rel.split('/').map(encodeURIComponent).join('/');
  if (line && line > 1) rel += '#L' + line;
  return rel;
}

/**
 * Build a click-target href for a claim/note/section ref in the
 * markdown preview.
 *
 * Routes through `command:scepter.previewOpenAt?[absPath,line]` — the
 * same SCEpter-owned command the refs panel uses. The earlier
 * approach emitted relative paths with `#Lnnn` fragments; the
 * preview's built-in handler navigated to the file but ignored the
 * line fragment, dropping the user at the top of the target rather
 * than at the cited claim. The command form opens the file AND
 * reveals + selects the exact line, matching the editor hover's
 * cmd-click behavior.
 */
function buildLinkTarget(
  normalizedId: string,
  kind: string,
  index: ClaimIndexCache,
  currentDocDir: string,
  contextNoteId: string | null,
  useAbsolute = false,
): string | null {
  function open(filePath: string, line?: number): string {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(index.projectDir, filePath);
    return buildPreviewHref(abs, currentDocDir, line, useAbsolute);
  }

  if (kind === 'claim' || kind === 'bare-claim') {
    const entry = index.resolve(normalizedId, contextNoteId ?? undefined);
    if (entry?.noteFilePath) {
      return open(entry.noteFilePath, entry.line);
    }
  } else if (kind === 'note') {
    const noteInfo = index.lookupNote(normalizedId);
    if (noteInfo?.noteFilePath) {
      return open(noteInfo.noteFilePath);
    }
  } else if (kind === 'section') {
    const sectionEntry = index.lookupSection(normalizedId, contextNoteId ?? undefined);
    if (sectionEntry?.noteFilePath) {
      return open(sectionEntry.noteFilePath, sectionEntry.line);
    }
  }

  return null;
}
