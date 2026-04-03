import * as vscode from 'vscode';
import { ClaimIndexCache, ClaimIndexEntry, NoteInfo } from './claim-index';
import { matchAtPosition, noteIdFromPath } from './patterns';

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

    // --- Claim-level hover ---
    if (match.kind === 'claim' || match.kind === 'bare-claim') {
      const entry = this.index.resolve(match.normalizedId, contextNoteId ?? undefined);
      if (entry) {
        return new vscode.Hover(await this.buildClaimHover(entry), range);
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
      return new vscode.Hover(
        new vscode.MarkdownString(`*Section §${match.normalizedId}*`),
        range
      );
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

  private async buildClaimHover(entry: ClaimIndexEntry): Promise<vscode.MarkdownString> {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    // Get the note's full title for context
    const noteInfo = this.index.lookupNote(entry.noteId);
    const noteTitle = noteInfo?.noteTitle ?? entry.noteId;

    // Header: FQID + note title (not just type)
    md.appendMarkdown(`**${entry.fullyQualified}**\n\n`);
    md.appendMarkdown(`*${entry.noteType}* — ${noteTitle}\n\n`);

    // Heading text (the claim content)
    md.appendMarkdown(`${entry.heading}\n\n`);

    // Clickable link to exact line
    const absPath = this.index.resolveFilePath(entry.noteFilePath);
    const uri = vscode.Uri.file(absPath);
    const openCmd = `command:vscode.open?${encodeURIComponent(JSON.stringify([uri, { selection: { startLineNumber: entry.line, startColumn: 1 } }]))}`;
    md.appendMarkdown(`[${entry.noteFilePath}:${entry.line}](${openCmd})\n\n`);

    // Metadata badges
    const badges: string[] = [];
    if (entry.importance !== undefined) {
      badges.push(`importance: ${entry.importance}`);
    }
    if (entry.lifecycle) {
      badges.push(`lifecycle: ${entry.lifecycle.type}`);
    }
    if (entry.derivedFrom.length > 0) {
      badges.push(`derives from: ${entry.derivedFrom.join(', ')}`);
    }
    if (badges.length > 0) {
      md.appendMarkdown(`*${badges.join(' · ')}*\n\n`);
    }

    // Context text from the source file
    const contextText = await this.index.readClaimContext(entry, 1, 200);
    if (contextText) {
      md.appendMarkdown(`---\n\n`);
      md.appendCodeblock(contextText.trim(), 'markdown');
      md.appendMarkdown(`\n`);
    }

    // Mini trace
    const incoming = this.index.incomingRefs(entry.fullyQualified);
    if (incoming.length > 0) {
      md.appendMarkdown(`---\n\n**Referenced by** (${incoming.length}):\n\n`);
      for (const ref of incoming.slice(0, 5)) {
        md.appendMarkdown(`- \`${ref.fromClaim}\` in ${ref.filePath}:${ref.line}\n`);
      }
      if (incoming.length > 5) {
        md.appendMarkdown(
          `- *...and ${incoming.length - 5} more (use Trace Claim)*\n`
        );
      }
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
}
