import * as vscode from 'vscode';
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

    for (let i = 0; i < doc.lineCount; i++) {
      const lineText = doc.lineAt(i).text;
      const matches = findAllMatches(lineText, isMarkdown, this.index.knownShortcodes);

      for (const match of matches) {
        const range = new vscode.Range(i, match.start, i, match.end);

        if (match.kind === 'section') {
          sections.push({ range });
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

    editor.setDecorations(resolvedDecoration, resolved);
    editor.setDecorations(unresolvedDecoration, unresolvedList);
    editor.setDecorations(sectionDecoration, sections);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    resolvedDecoration.dispose();
    unresolvedDecoration.dispose();
    sectionDecoration.dispose();
  }
}
