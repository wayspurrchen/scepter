import * as vscode from 'vscode';
import { ClaimIndexCache, ClaimIndexEntry, NoteInfo, SectionEntry } from './claim-index';
import { matchAtPosition, noteIdFromPath, parseNormalizedAddress } from './patterns';
import {
  buildRefsPanelDescriptor,
  firstSentence,
  RefsPanelDescriptor,
  SnippetDescriptor,
} from './refs-panel-builder';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape characters that markdown-it would otherwise interpret as emphasis,
 *  so paths like `__tests__/foo.ts` don't get rendered as **tests** bold. */
function escapeMarkdown(s: string): string {
  return escapeHtml(s).replace(/_/g, '\\_').replace(/\*/g, '\\*');
}

/** Walk a SnippetDescriptor and produce the editor-hover HTML form:
 *  dim segments wrapped in `<span style="opacity:0.6">…</span>`, hits
 *  in `<b>…</b>`, escape via escapeMarkdown so paths/identifiers in
 *  the snippet don't get treated as bold/italic by the MarkdownString
 *  renderer. The unavailable/empty markers carry their own italic
 *  inside the dim wrapper. */
function renderSnippetEditorHtml(snippet: SnippetDescriptor): string {
  let out = '';
  for (const seg of snippet.segments) {
    switch (seg.kind) {
      case 'dim':
        out += `<span style="opacity:0.6">${escapeMarkdown(seg.text)}</span>`;
        break;
      case 'hit':
        out += `<b>${escapeMarkdown(seg.text)}</b>`;
        break;
      case 'unavailable':
        out += `<span style="opacity:0.6"><i>(snippet unavailable)</i></span>`;
        break;
      case 'empty':
        out += `<span style="opacity:0.6"><i>(empty line)</i></span>`;
        break;
    }
  }
  return out;
}

/** Inline style for a hover-cell scroll region. VS Code's hover renderer
 *  may strip some style props; we keep what's most likely to survive
 *  (vertical-align, max-height, overflow). */
const CELL_STYLE = 'vertical-align: top; max-height: 360px; overflow-y: auto; overflow-x: hidden;';

export class ClaimHoverProvider implements vscode.HoverProvider {
  constructor(
    private index: ClaimIndexCache,
    private outputChannel: vscode.OutputChannel
  ) {}

  // @implements {R012.§2.AC.08} fallback message when reference recognized but not in index
  // @implements {R012.§2.AC.09} every hover attempt logged with line/char/kind/snippet
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    await this.index.waitUntilReady();

    const line = document.lineAt(position.line).text;
    const match = matchAtPosition(line, position.character, this.index.knownShortcodes);

    // Diagnostic: log every hover attempt on markdown files
    if (document.languageId === 'markdown') {
      this.outputChannel.appendLine(
        `[Hover] md L${position.line}:${position.character} match=${match ? `${match.kind}:${match.normalizedId}` : 'null'} text="${line.substring(Math.max(0, position.character - 10), position.character + 15).trim()}"`
      );
    }

    if (!match) return null;

    const range = new vscode.Range(
      position.line, match.start,
      position.line, match.end
    );

    const contextNoteId = noteIdFromPath(document.uri.fsPath);

    // --- Cross-project hover ---
    // @implements {R011.§4.AC.03} cross-project hover with peer-source header
    if (match.aliasPrefix) {
      return new vscode.Hover(
        await this.buildCrossProjectHover(match),
        range,
      );
    }

    // --- Claim-level hover ---
    if (match.kind === 'claim' || match.kind === 'bare-claim') {
      // Range expansions (`{AC.01-06}`) carry every member's FQID on
      // `match.rangeMembers`; show a compact one-per-row summary so the
      // user can scan all members of the range without opening each.
      // @implements {R012.§5.AC.03} editor hover detects range matches and routes to range renderer
      if (match.rangeMembers && match.rangeMembers.length > 1) {
        return new vscode.Hover(
          await this.buildClaimRangeHover(match, contextNoteId ?? undefined),
          range,
        );
      }
      const entry = this.index.resolve(match.normalizedId, contextNoteId ?? undefined);
      if (entry) {
        const isOriginal = this.isOnClaimDefinition(entry, document, position);
        return new vscode.Hover(await this.buildClaimHover(entry, isOriginal), range);
      }
    }

    // --- Note-level hover ---
    if (match.kind === 'note') {
      const noteInfo = this.index.lookupNote(match.normalizedId);
      if (noteInfo) {
        return new vscode.Hover(await this.buildNoteHover(noteInfo), range);
      }
    }

    // --- Section reference ---
    if (match.kind === 'section') {
      const sectionEntry = this.index.lookupSection(match.normalizedId, contextNoteId ?? undefined);
      if (sectionEntry) {
        return new vscode.Hover(await this.buildSectionHover(sectionEntry), range);
      }
    }

    // --- Fallback: reference recognized but not in index ---
    // Still show something so the user knows the extension sees it
    const fallbackMd = new vscode.MarkdownString();
    fallbackMd.appendMarkdown(
      `**${match.normalizedId}** — *not in current index*\n\n` +
      `Run **SCEpter: Refresh Claim Index** to rebuild.`
    );
    return new vscode.Hover(fallbackMd, range);
  }

  /**
   * Detect whether the hover is on the claim's own definition heading
   * (same file, same line as `entry.line`). When true, the user is
   * already reading the claim — no point showing its body excerpt;
   * surface metadata + sources/refs instead. When false, this is a
   * reference to the claim from elsewhere; show the body excerpt
   * alongside refs so they can preview without navigating.
   *
   * @implements {R012.§2.AC.01} two-mode hover detection (original-claim vs reference-to-claim)
   */
  private isOnClaimDefinition(
    entry: ClaimIndexEntry,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): boolean {
    const entryAbs = this.index.resolveFilePath(entry.noteFilePath);
    if (entryAbs !== document.uri.fsPath) return false;
    return position.line === entry.line - 1;
  }

  // @implements {R012.§2.AC.01} original-claim mode: metadata + refs only, body omitted
  // @implements {R012.§2.AC.02} reference-to-claim mode: two-column layout with independent scroll
  private async buildClaimHover(
    entry: ClaimIndexEntry,
    isOriginal: boolean,
  ): Promise<vscode.MarkdownString> {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    const noteInfo = this.index.lookupNote(entry.noteId);
    const noteTitle = noteInfo?.noteTitle ?? entry.noteId;
    const projectDir = this.index.projectDir;

    const absPath = this.index.resolveFilePath(entry.noteFilePath);
    const uri = vscode.Uri.file(absPath);
    const openCmd = `command:vscode.open?${encodeURIComponent(JSON.stringify([uri, { selection: { startLineNumber: entry.line, startColumn: 1 } }]))}`;

    // Refs panel: build the structured descriptor synchronously through
    // the body resolver's bounded LRU. The previous editor path awaited
    // one filesystem read per distinct source note in parallel — which
    // (a) stalled the hover during cold-cache renders and (b) duplicated
    // the preview's own panel-build logic. The shared builder fixes both.
    // @implements {R012.§4.AC.10} shared RefsPanelDescriptor builder consumed by editor and preview
    // @implements {R012.§8.AC.03} editor refs panel built sync via resolver's note-lines LRU (no async storm)
    const descriptor = buildRefsPanelDescriptor(this.index, entry.fullyQualified, {
      projectDir,
      getNoteLines: (id) => this.index.getAggregatedNoteLinesSync(id),
    });
    const refsHtml = this.buildRefsHtml(descriptor);

    const badges: string[] = [];
    if (entry.importance !== undefined) badges.push(`importance: ${entry.importance}`);
    if (entry.lifecycle) badges.push(`lifecycle: ${entry.lifecycle.type}`);
    if (entry.derivedFrom.length > 0) badges.push(`derives from: ${entry.derivedFrom.join(', ')}`);
    const badgeHtml = badges.length > 0 ? `<i>${escapeHtml(badges.join(' · '))}</i>` : '';

    if (isOriginal) {
      // The user is reading the claim's own definition — skip body excerpt
      // and the file:line link (they're already in the file). Surface
      // metadata + refs.
      md.appendMarkdown(`**${escapeHtml(entry.fullyQualified)}**\n\n`);
      md.appendMarkdown(`*${escapeHtml(entry.noteType)}* — ${escapeHtml(noteTitle)}\n\n`);
      if (badges.length > 0) md.appendMarkdown(`${badgeHtml}\n\n`);
      md.appendMarkdown(`---\n\n${refsHtml}`);
      return md;
    }

    // Reference-to-claim hover: 2-column layout — refs on the left,
    // claim body / metadata on the right. Body excerpt is the raw
    // claim text rendered as preformatted+wrapped content. We tried
    // embedding rendered HTML (markdown-it output) here, but VS Code's
    // hover MarkdownString renderer strips most of the styling that
    // makes that output legible, so the previous raw-text behavior is
    // both more reliable and visually closer to what users had before.
    // @implements {R012.§7.AC.08} editor hover body uses raw text + escapeMarkdown + white-space:pre-wrap
    // @implements {R012.§9.AC.01} editor hover metadata link uses command:vscode.open (different surface from preview)
    const contextText = await this.index.readClaimContext(entry, 1, 200);
    const bodyHtml = this.buildBodyHtml(entry, noteTitle, contextText, openCmd, badgeHtml);

    md.appendMarkdown(
      `<table><tr>` +
        `<td valign="top" width="50%" style="${CELL_STYLE}">${refsHtml}</td>` +
        `<td valign="top" width="50%" style="${CELL_STYLE}">${bodyHtml}</td>` +
      `</tr></table>`,
    );

    return md;
  }

  /**
   * Render the refs panel from a structured descriptor. Sources subsection
   * (clickable file:line) followed by a Notes subsection grouped by source
   * note (note id + type + title header, with each ref labeled as derivation
   * or reference and showing a short heading excerpt or citing-line snippet).
   * Empty subsections get an explicit "no refs" line so the user knows the
   * absence is informative, not a missing render.
   *
   * Synchronous: the descriptor is built ahead of time via the shared
   * `buildRefsPanelDescriptor`, which sources citing lines from the body
   * resolver's bounded LRU. The previous editor path awaited one filesystem
   * read per distinct source note in parallel — see the architectural
   * review for the hover-stall background.
   *
   * @implements {R012.§2.AC.04} sources/notes split with counts; "No X references" lines when empty
   * @implements {R012.§2.AC.05} notes grouped by source noteId; derivation vs reference flag
   * @implements {R012.§2.AC.06} derivation: localId + heading excerpt; reference: localId + citing-line snippet
   */
  private buildRefsHtml(descriptor: RefsPanelDescriptor): string {
    const { sources, noteGroups } = descriptor;
    const lines: string[] = [];

    lines.push(`<b>Sources (${sources.length})</b>`);
    if (sources.length === 0) {
      lines.push(`<i>No source references.</i>`);
    } else {
      for (const src of sources) {
        const u = vscode.Uri.file(src.abs).with({ fragment: `L${src.line || 1}` });
        lines.push(`<a href="${u.toString()}">${escapeMarkdown(src.rel)}:${src.line}</a>`);
      }
    }

    // Total note-ref count is the sum of items across groups (matches
    // the previous behavior, where the count was `noteRefs.length`).
    const totalNoteRefs = noteGroups.reduce((acc, g) => acc + g.items.length, 0);

    lines.push('');
    lines.push(`<b>Notes (${totalNoteRefs})</b>`);
    if (totalNoteRefs === 0) {
      lines.push(`<i>No note references.</i>`);
    } else {
      for (const group of noteGroups) {
        const typeLabel = group.noteType ? escapeHtml(group.noteType) : '';
        const titleLabel = group.noteTitle
          ? escapeMarkdown(group.noteTitle)
          : escapeMarkdown(group.noteId);
        lines.push(
          `<b>${escapeHtml(group.noteId)}</b>${typeLabel ? ` — <i>${typeLabel}</i>` : ''}: ${titleLabel}`,
        );
        for (const item of group.items) {
          const u = vscode.Uri.file(item.abs).with({ fragment: `L${item.line || 1}` });
          if (item.kind === 'derivation') {
            lines.push(
              `&nbsp;&nbsp;• <a href="${u.toString()}">${escapeHtml(item.localId)}</a> — ` +
                `<i>derivation</i>: ${escapeMarkdown(item.headingExcerpt)}`,
            );
          } else {
            const snippet = renderSnippetEditorHtml(item.snippet);
            lines.push(
              `&nbsp;&nbsp;• <a href="${u.toString()}">${escapeHtml(item.localId)}</a> — ${snippet}`,
            );
          }
        }
      }
    }

    return lines.join('<br>');
  }

  private buildBodyHtml(
    entry: ClaimIndexEntry,
    noteTitle: string,
    contextText: string | null,
    openCmd: string,
    badgeHtml: string,
  ): string {
    const out: string[] = [];
    out.push(`<b>${escapeHtml(entry.fullyQualified)}</b>`);
    out.push(`<i>${escapeHtml(entry.noteType)}</i> — ${escapeMarkdown(noteTitle)}`);
    out.push(`<a href="${openCmd}">${escapeMarkdown(entry.noteFilePath)}:${entry.line}</a>`);
    if (badgeHtml) out.push(badgeHtml);
    let html = out.join('<br>');
    if (contextText) {
      // word-wrap the body excerpt rather than rendering in a <pre> that
      // forces horizontal scroll. Keep newlines visible via white-space rule.
      html += `<br><div style="white-space: pre-wrap; word-break: break-word; opacity: 0.95;">${escapeMarkdown(contextText.trim())}</div>`;
    }
    return html;
  }

  /**
   * Render a compact summary for a range expansion like `{AC.01-06}` or
   * `{R004.§1.AC.01-AC.06}`. One row per expanded member: clickable FQID,
   * note type, and a heading excerpt — enough to scan the whole range
   * without dispatching N separate hovers. The same shape can be carried
   * to the markdown preview tooltip via a `data-claim-range-members` JSON
   * attribute on the wrapping span; the preview script iterates the same
   * member list to render the same rows.
   *
   * Cross-project ranges (with `match.aliasPrefix`) fall back to a single
   * line per member showing only the FQID — peer resolution per-member
   * would round-trip too many file reads for a hover surface.
   *
   * @implements {R012.§2.AC.03} range hover renders one row per member; cross-project falls back to listing-only
   * @implements {R012.§5.AC.06} cross-project ranges fall back to listing-only mode
   */
  private async buildClaimRangeHover(
    match: { normalizedId: string; rangeMembers?: string[]; aliasPrefix?: string },
    contextNoteId: string | undefined,
  ): Promise<vscode.MarkdownString> {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    const members = match.rangeMembers ?? [match.normalizedId];
    const first = members[0];
    const last = members[members.length - 1];
    const isCrossProject = !!match.aliasPrefix;

    const headerPrefix = isCrossProject ? `\`${match.aliasPrefix}/\` ` : '';
    md.appendMarkdown(
      `${headerPrefix}**Range** \`${first}\` – \`${last}\` · *${members.length} claim${members.length !== 1 ? 's' : ''}*\n\n`,
    );

    if (isCrossProject) {
      // Listing-only view — peer lookup per member is too expensive on
      // a hover. The member list still gives the user the full enumerated
      // address range so they can inspect individually if needed.
      for (const fqid of members) {
        md.appendMarkdown(`- \`${match.aliasPrefix}/${fqid}\`\n`);
      }
      return md;
    }

    for (const fqid of members) {
      const entry = this.index.resolve(fqid, contextNoteId);
      if (!entry) {
        md.appendMarkdown(`- **${escapeHtml(fqid)}** — *not in index*\n`);
        continue;
      }
      const noteInfo = this.index.lookupNote(entry.noteId);
      const noteTitle = noteInfo?.noteTitle;
      const absPath = this.index.resolveFilePath(entry.noteFilePath);
      const uri = vscode.Uri.file(absPath);
      const openCmd = `command:vscode.open?${encodeURIComponent(
        JSON.stringify([uri, { selection: { startLineNumber: entry.line, startColumn: 1 } }]),
      )}`;
      const headingPreview = firstSentence(entry.heading, 80);
      const titlePart = noteTitle ? ` (${escapeMarkdown(noteTitle)})` : '';
      md.appendMarkdown(
        `- [**${escapeHtml(entry.fullyQualified)}**](${openCmd}) — *${escapeHtml(entry.noteType)}*${titlePart}: ${escapeMarkdown(headingPreview)}\n`,
      );
    }

    return md;
  }

  private async buildSectionHover(entry: SectionEntry): Promise<vscode.MarkdownString> {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    const noteInfo = this.index.lookupNote(entry.noteId);
    const noteTitle = noteInfo?.noteTitle ?? entry.noteId;

    md.appendMarkdown(`**${entry.fqid}** — *§${entry.sectionId}*\n\n`);
    md.appendMarkdown(`*${entry.noteType || 'Section'}* — ${noteTitle}\n\n`);
    md.appendMarkdown(`### ${entry.heading}\n\n`);

    const absPath = this.index.resolveFilePath(entry.noteFilePath);
    const uri = vscode.Uri.file(absPath);
    const openCmd = `command:vscode.open?${encodeURIComponent(JSON.stringify([uri, { selection: { startLineNumber: entry.line, startColumn: 1 } }]))}`;
    md.appendMarkdown(`[${entry.noteFilePath}:${entry.line}](${openCmd})\n\n`);

    const sectionText = await this.index.readSectionContent(entry, 200);
    if (sectionText) {
      md.appendMarkdown(`---\n\n`);
      md.appendCodeblock(sectionText.trim(), 'markdown');
      md.appendMarkdown(`\n`);
    }

    return md;
  }

  private async buildNoteHover(noteInfo: NoteInfo): Promise<vscode.MarkdownString> {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    // Show full note title prominently
    md.appendMarkdown(`**${noteInfo.noteId}** — ${noteInfo.noteTitle}\n\n`);
    md.appendMarkdown(`*${noteInfo.noteType}* · ${noteInfo.claimCount} claim${noteInfo.claimCount !== 1 ? 's' : ''}\n\n`);

    if (noteInfo.noteFilePath) {
      const absPath = this.index.resolveFilePath(noteInfo.noteFilePath);
      const openCmd = `command:vscode.open?${encodeURIComponent(JSON.stringify([vscode.Uri.file(absPath)]))}`;
      md.appendMarkdown(`[${noteInfo.noteFilePath}](${openCmd})\n\n`);
    }

    // Show the note content (after frontmatter/title)
    const excerpt = await this.index.readNoteExcerpt(noteInfo.noteId, Infinity);
    if (excerpt) {
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(excerpt.trim() + '\n');
      md.appendMarkdown(`\n`);
    }

    // Show claims preview
    const claims = this.index.claimsForNote(noteInfo.noteId);
    if (claims.length > 0) {
      md.appendMarkdown(`---\n\n**Claims** (${claims.length}):\n\n`);
      for (const claim of claims.slice(0, 8)) {
        const absPath = this.index.resolveFilePath(claim.noteFilePath);
        const openCmd = `command:vscode.open?${encodeURIComponent(JSON.stringify([vscode.Uri.file(absPath), { selection: { startLineNumber: claim.line, startColumn: 1 } }]))}`;
        md.appendMarkdown(`- [\`${claim.fullyQualified}\`](${openCmd}) ${claim.heading.substring(0, 80)}\n`);
      }
      if (claims.length > 8) {
        md.appendMarkdown(`- *...and ${claims.length - 8} more*\n`);
      }
    }

    const refs = this.index.noteRefs(noteInfo.noteId);
    if (refs.length > 0) {
      const inbound = refs.filter((r) => r.toNoteId === noteInfo.noteId).length;
      const outbound = refs.filter((r) => r.fromNoteId === noteInfo.noteId).length;
      md.appendMarkdown(`\n${inbound} incoming, ${outbound} outgoing references\n`);
    }

    return md;
  }

  /**
   * Build a hover for a cross-project (alias-prefixed) reference. The
   * alias is resolved against the local config; on hit, the peer's
   * note (or claim) is fetched and rendered with a peer-source header
   * so the user can never confuse it with local content. On miss, a
   * distinct failure message names the failure mode.
   *
   * @implements {R011.§4.AC.03} cross-project hover with peer header
   * @implements {DD015.§1.DC.08} fixed peer-source header `**Cross-project citation: <alias>** (<peer-path>)` + horizontal rule
   */
  private async buildCrossProjectHover(match: { aliasPrefix?: string; normalizedId: string; kind: string }): Promise<vscode.MarkdownString> {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;
    const aliasName = match.aliasPrefix!;

    // First check if the alias is even declared.
    const aliasEntry = this.index.getAlias(aliasName);
    if (!aliasEntry) {
      md.appendMarkdown(`**Alias unknown:** \`${aliasName}\`\n\n`);
      md.appendMarkdown(`The alias \`${aliasName}\` is not declared in the project's \`projectAliases\`.`);
      return md;
    }
    if (!aliasEntry.resolved) {
      md.appendMarkdown(`**Cross-project citation:** \`${aliasName}\` *(unresolved)*\n\n`);
      md.appendMarkdown(`Configured target: \`${aliasEntry.resolvedPath}\`\n\n`);
      md.appendMarkdown(`Reason: ${aliasEntry.unresolvedReason ?? 'unknown'}`);
      return md;
    }

    // Header makes peer-source unmistakable.
    md.appendMarkdown(
      `**Cross-project citation:** \`${aliasName}\` *(${aliasEntry.resolvedPath})*\n\n`,
    );
    md.appendMarkdown(`---\n\n`);

    // Parse the normalizedId into address components.
    // normalizedId is in the canonical form `R005.1.AC.01` (no §).
    const address = parseNormalizedAddress(match.normalizedId);
    if (!address) {
      md.appendMarkdown(`*Could not parse cross-project address \`${match.normalizedId}\`.*`);
      return md;
    }

    const result = await this.index.resolveCrossProject(aliasName, address);
    if (!result.ok) {
      md.appendMarkdown(`**Lookup failed:** ${result.reason}`);
      return md;
    }

    if ('entry' in result) {
      const entry = result.entry;
      md.appendMarkdown(`**${entry.fullyQualified}**\n\n`);
      md.appendMarkdown(`*${entry.noteType ?? 'Peer'}* — ${entry.noteId}\n\n`);
      md.appendMarkdown(`${entry.heading}\n\n`);
    } else if ('note' in result) {
      const note = result.note;
      md.appendMarkdown(`**${note.noteId}** — ${note.noteTitle}\n\n`);
      md.appendMarkdown(`*${note.noteType ?? 'Peer'}*\n\n`);
    }

    return md;
  }
}

