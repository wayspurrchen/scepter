import * as vscode from 'vscode';
import * as path from 'path';
import { ClaimIndexCache } from './claim-index';
import { findAllMatches, noteIdFromPath } from './patterns';

// Resolved reference — dotted underline, subtle teal tint
const resolvedDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline dotted',
  color: '#4EC9B0',
  cursor: 'pointer',
  overviewRulerColor: '#4EC9B044',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
});

// Unresolved reference — dimmer, wavy underline
const unresolvedDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline wavy',
  color: '#808080',
  cursor: 'default',
});

// Section reference — very subtle, just a thin dotted underline
const sectionDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline dotted rgba(78, 201, 176, 0.4)',
});

// Cross-project resolved reference — purple hue, dotted underline.
// Visually distinct from local resolved (teal) per R011.§4.AC.05.
// Color choice (#C586C0) is the design decision recorded as DD015 DC.07.
// @implements {R011.§4.AC.05} cross-project decoration distinguishable from local
// @implements {DD015.§1.DC.07} purple `#C586C0` distinct from local teal `#4EC9B0`
const crossProjectResolvedDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline dotted',
  color: '#C586C0',
  cursor: 'pointer',
  overviewRulerColor: '#C586C044',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
});

// Cross-project unresolved reference — same purple hue, wavy underline so
// resolved/unresolved are also distinguishable per R011.§4.AC.05.
// @implements {R011.§4.AC.05} resolved vs unresolved cross-project distinct
// @implements {DD015.§1.DC.07} same purple hue, distinguishable underline style
const crossProjectUnresolvedDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline wavy',
  color: '#C586C0',
  cursor: 'default',
});

// Claim-definition badge — rendered as an `after` decoration anchored next to
// the claim id in its heading line. Color encodes source coverage (green if
// any source ref, red if only note-to-note refs). Count is total inbound refs.
const claimBadgeDecoration = vscode.window.createTextEditorDecorationType({});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class DecorationProvider {
  private disposables: vscode.Disposable[] = [];

  constructor(private index: ClaimIndexCache) {}

  activate(context: vscode.ExtensionContext): void {
    if (vscode.window.activeTextEditor) {
      this.updateDecorations(vscode.window.activeTextEditor);
    }

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.updateDecorations(editor);
      })
    );

    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
          if (changeTimer) clearTimeout(changeTimer);
          changeTimer = setTimeout(() => this.updateDecorations(editor), 300);
        }
      })
    );

    this.disposables.push(
      this.index.onDidRefresh(() => {
        if (vscode.window.activeTextEditor) {
          this.updateDecorations(vscode.window.activeTextEditor);
        }
      })
    );

    context.subscriptions.push({ dispose: () => this.dispose() });
  }

  private updateDecorations(editor: vscode.TextEditor): void {
    const doc = editor.document;
    const langId = doc.languageId;

    const supported = [
      'typescript', 'typescriptreact',
      'javascript', 'javascriptreact',
      'markdown',
    ];
    if (!supported.includes(langId)) return;

    const isMarkdown = langId === 'markdown';
    const contextNoteId = noteIdFromPath(doc.uri.fsPath);

    const resolved: vscode.DecorationOptions[] = [];
    const unresolvedList: vscode.DecorationOptions[] = [];
    const sections: vscode.DecorationOptions[] = [];
    const crossProjectResolved: vscode.DecorationOptions[] = [];
    const crossProjectUnresolved: vscode.DecorationOptions[] = [];
    const claimBadges: vscode.DecorationOptions[] = [];

    for (let i = 0; i < doc.lineCount; i++) {
      const lineText = doc.lineAt(i).text;
      const matches = findAllMatches(lineText, isMarkdown, this.index.knownShortcodes);

      for (const match of matches) {
        const range = new vscode.Range(i, match.start, i, match.end);

        // Cross-project routing first — these never use local
        // resolved/unresolved decorations regardless of kind.
        // @implements {R011.§4.AC.05} cross-project decoration routing
        if (match.aliasPrefix) {
          const aliasEntry = this.index.getAlias(match.aliasPrefix);
          if (aliasEntry?.resolved) {
            crossProjectResolved.push({
              range,
              hoverMessage: new vscode.MarkdownString(
                `*Cross-project citation* \`${match.aliasPrefix}/${match.normalizedId}\` — peer at ${aliasEntry.resolvedPath}`,
              ),
            });
          } else {
            crossProjectUnresolved.push({
              range,
              hoverMessage: new vscode.MarkdownString(
                `*Cross-project citation* \`${match.aliasPrefix}\` — ${aliasEntry ? `unresolved (${aliasEntry.unresolvedReason ?? 'unknown'})` : 'alias not declared'}`,
              ),
            });
          }
          continue;
        }

        if (match.kind === 'section') {
          // Resolve qualified ({R005.§1}) and bare (§2 with file context)
          // section refs against the index. Unknown sections fall through
          // to the same wavy-underline treatment as unknown claims so the
          // user can tell them apart from valid-but-bare formatting.
          const sectionEntry = this.index.lookupSection(
            match.normalizedId,
            contextNoteId ?? undefined,
          );
          if (sectionEntry) {
            sections.push({ range });
          } else {
            unresolvedList.push({
              range,
              hoverMessage: new vscode.MarkdownString(
                `*SCEpter section* \`§${match.normalizedId}\` — not found in index`
              ),
            });
          }
          continue;
        }

        const isKnown = this.index.isKnown(match.normalizedId, contextNoteId ?? undefined);

        if (isKnown) {
          resolved.push({ range });
        } else {
          unresolvedList.push({
            range,
            hoverMessage: new vscode.MarkdownString(
              `*SCEpter reference* \`${match.normalizedId}\` — not found in index`
            ),
          });
        }
      }
    }

    if (isMarkdown && contextNoteId) {
      this.collectClaimBadges(doc, contextNoteId, claimBadges);
    }

    editor.setDecorations(resolvedDecoration, resolved);
    editor.setDecorations(unresolvedDecoration, unresolvedList);
    editor.setDecorations(sectionDecoration, sections);
    editor.setDecorations(crossProjectResolvedDecoration, crossProjectResolved);
    editor.setDecorations(crossProjectUnresolvedDecoration, crossProjectUnresolved);
    editor.setDecorations(claimBadgeDecoration, claimBadges);
  }

  private collectClaimBadges(
    doc: vscode.TextDocument,
    contextNoteId: string,
    out: vscode.DecorationOptions[],
  ): void {
    const docPath = doc.uri.fsPath;
    const projectDir = this.index.projectDir;

    for (const entry of this.index.claimsForNote(contextNoteId)) {
      const entryAbs = this.index.resolveFilePath(entry.noteFilePath);
      if (entryAbs !== docPath) continue;
      const lineIdx = entry.line - 1;
      if (lineIdx < 0 || lineIdx >= doc.lineCount) continue;

      const refs = this.index.incomingRefs(entry.fullyQualified);
      const total = refs.length;
      if (total === 0) continue;

      // Locate the claim id in the actual line text so the badge sits next
      // to it, not at end of line. Heading line looks like
      // "### AC.01:tag Title…"; we anchor the decoration range on the id.
      const lineText = doc.lineAt(lineIdx).text;
      const padded = String(entry.claimNumber).padStart(2, '0');
      const idStr = `${entry.claimPrefix}.${padded}${entry.claimSubLetter ?? ''}`;
      const idIdx = lineText.indexOf(idStr);
      if (idIdx < 0) continue;
      const idEnd = idIdx + idStr.length;
      const range = new vscode.Range(lineIdx, idIdx, lineIdx, idEnd);

      const sourceRefs = refs.filter((r) => r.fromNoteId.startsWith('source:'));
      const noteRefs = refs.filter((r) => !r.fromNoteId.startsWith('source:'));
      const hasSource = sourceRefs.length > 0;
      const dotColor = hasSource ? '#6CC04A' : '#F48771';

      out.push({
        range,
        renderOptions: {
          after: {
            contentText: `●${total}`,
            color: dotColor,
            fontWeight: 'bold',
            margin: '0 0 0 2px',
          },
        },
      });
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    resolvedDecoration.dispose();
    unresolvedDecoration.dispose();
    sectionDecoration.dispose();
    crossProjectResolvedDecoration.dispose();
    crossProjectUnresolvedDecoration.dispose();
    claimBadgeDecoration.dispose();
  }
}
