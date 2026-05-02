import * as vscode from 'vscode';
import * as path from 'path';
import { ClaimIndexCache, ClaimIndexEntry, NoteInfo, SectionEntry } from './claim-index';
import { matchAtPosition, noteIdFromPath } from './patterns';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class ClaimHoverProvider implements vscode.HoverProvider {
  constructor(
    private index: ClaimIndexCache,
    private outputChannel: vscode.OutputChannel
  ) {}

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

    const incoming = this.index.incomingRefs(entry.fullyQualified);
    const sourceRefs = incoming.filter((r) => r.fromNoteId.startsWith('source:'));
    const noteRefs = incoming.filter((r) => !r.fromNoteId.startsWith('source:'));

    const refsHtml = this.buildRefsHtml(entry.fullyQualified, sourceRefs, noteRefs, projectDir);

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
    // claim body / metadata on the right.
    const contextText = await this.index.readClaimContext(entry, 1, 200);
    const bodyHtml = this.buildBodyHtml(entry, noteTitle, contextText, openCmd, badgeHtml);

    md.appendMarkdown(
      `<table><tr>` +
        `<td valign="top" width="40%">${refsHtml}</td>` +
        `<td valign="top" width="60%">${bodyHtml}</td>` +
      `</tr></table>`,
    );

    return md;
  }

  /**
   * Render the refs panel: a Sources subsection (clickable file:line) and a
   * Notes subsection grouped by source note (note id + type + title header,
   * with each ref labeled as derivation or reference and showing a short
   * heading excerpt). Empty subsections get an explicit "no refs" line so
   * the user knows the absence is informative, not a missing render.
   */
  private buildRefsHtml(
    targetFqid: string,
    sourceRefs: { fromClaim: string; fromNoteId: string; filePath: string; line: number }[],
    noteRefs: { fromClaim: string; fromNoteId: string; filePath: string; line: number }[],
    projectDir: string,
  ): string {
    const lines: string[] = [];

    // Sources
    lines.push(`<b>Sources (${sourceRefs.length})</b>`);
    if (sourceRefs.length === 0) {
      lines.push(`<i>No source references.</i>`);
    } else {
      for (const r of sourceRefs) {
        const abs = this.index.resolveFilePath(r.filePath) ?? r.filePath;
        const rel = path.relative(projectDir, abs);
        const u = vscode.Uri.file(abs).with({ fragment: `L${r.line || 1}` });
        lines.push(`<a href="${u.toString()}">${escapeHtml(rel)}:${r.line}</a>`);
      }
    }

    lines.push('');
    lines.push(`<b>Notes (${noteRefs.length})</b>`);
    if (noteRefs.length === 0) {
      lines.push(`<i>No note references.</i>`);
    } else {
      // Group by source note id so the user sees which note each ref lives in.
      const grouped = new Map<string, typeof noteRefs>();
      for (const r of noteRefs) {
        const arr = grouped.get(r.fromNoteId) ?? [];
        arr.push(r);
        grouped.set(r.fromNoteId, arr);
      }
      for (const [noteId, refs] of grouped) {
        const info = this.index.lookupNote(noteId);
        const typeLabel = info?.noteType ? escapeHtml(info.noteType) : '';
        const titleLabel = info?.noteTitle ? escapeHtml(info.noteTitle) : escapeHtml(noteId);
        lines.push(`<b>${escapeHtml(noteId)}</b>${typeLabel ? ` — <i>${typeLabel}</i>` : ''}: ${titleLabel}`);
        for (const r of refs) {
          const sourceEntry = this.index.lookup(r.fromClaim);
          const isDerivation = sourceEntry?.derivedFrom.includes(targetFqid) ?? false;
          const relLabel = isDerivation ? 'derivation' : 'reference';
          const abs = this.index.resolveFilePath(r.filePath) ?? r.filePath;
          const u = vscode.Uri.file(abs).with({ fragment: `L${r.line || 1}` });

          if (sourceEntry) {
            // Strip the noteId prefix to show just the local claim id.
            const localId = r.fromClaim.startsWith(`${noteId}.`)
              ? r.fromClaim.slice(noteId.length + 1)
              : r.fromClaim;
            const excerpt = this.firstSentence(sourceEntry.heading, 80);
            lines.push(
              `&nbsp;&nbsp;• <a href="${u.toString()}">${escapeHtml(localId)}</a> — <i>${relLabel}</i>: ${escapeHtml(excerpt)}`,
            );
          } else {
            // No containing claim — render as a line reference into the note.
            lines.push(
              `&nbsp;&nbsp;• <a href="${u.toString()}">line ${r.line}</a> — <i>${relLabel}</i>`,
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
    out.push(`<i>${escapeHtml(entry.noteType)}</i> — ${escapeHtml(noteTitle)}`);
    out.push(`<a href="${openCmd}">${escapeHtml(entry.noteFilePath)}:${entry.line}</a>`);
    if (badgeHtml) out.push(badgeHtml);
    if (contextText) {
      out.push(`<pre>${escapeHtml(contextText.trim())}</pre>`);
    }
    return out.join('<br>');
  }

  /** Take the first sentence (or up to maxLen characters) for ref previews. */
  private firstSentence(text: string, maxLen: number): string {
    const trimmed = text.trim();
    const period = trimmed.search(/[.!?](\s|$)/);
    const cutoff = period > 0 && period < maxLen ? period + 1 : maxLen;
    return trimmed.length <= cutoff ? trimmed : trimmed.slice(0, cutoff).trimEnd() + '…';
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

/**
 * Parse a normalized-id string (e.g. `R005.1.AC.01`) into address
 * components for `resolveCrossProject`. Returns null when the string
 * doesn't contain a recognizable note ID.
 */
function parseNormalizedAddress(
  normalized: string,
): { noteId: string; sectionPath?: number[]; claimPrefix?: string; claimNumber?: number } | null {
  const parts = normalized.split('.');
  if (parts.length === 0) return null;
  const noteIdMatch = parts[0].match(/^[A-Z]{1,5}\d{3,5}$/);
  if (!noteIdMatch) return null;
  const noteId = parts[0];
  if (parts.length === 1) return { noteId };

  // Trailing claim portion is `<PREFIX>.<NN>` — find the last all-uppercase
  // letters segment that's followed by a digits-only segment.
  const sectionParts: number[] = [];
  let i = 1;
  for (; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i])) {
      sectionParts.push(parseInt(parts[i], 10));
    } else {
      break;
    }
  }
  if (i < parts.length - 1 && /^[A-Z]+$/.test(parts[i]) && /^\d{2,3}[a-z]?$/.test(parts[i + 1])) {
    const claimNumMatch = parts[i + 1].match(/^(\d{2,3})([a-z])?$/)!;
    return {
      noteId,
      sectionPath: sectionParts.length > 0 ? sectionParts : undefined,
      claimPrefix: parts[i],
      claimNumber: parseInt(claimNumMatch[1], 10),
    };
  }
  return {
    noteId,
    sectionPath: sectionParts.length > 0 ? sectionParts : undefined,
  };
}
