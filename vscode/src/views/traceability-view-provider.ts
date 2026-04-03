import * as vscode from 'vscode';
import type { ClaimIndexCache, TraceabilityMatrix } from '../claim-index';

// @implements {DD013.§DC.12} Dual-mode traceability view (sidebar webview + full panel)
// @implements {DD013.§DC.13} PostMessage protocol
// @implements {DD013.§DC.14} HTML structure with VS Code CSS variables
// @implements {DD013.§DC.17} Full-page WebviewPanel

interface MatrixPayload {
  noteId: string;
  noteTitle: string;
  columns: string[];
  columnShort: string[];
  rows: MatrixRow[];
  gapCount: number;
}

interface MatrixRow {
  claimFqid: string;
  claimShortId: string;
  claimHeading: string;
  importance: number | null;
  cells: MatrixCell[];
}

interface MatrixCell {
  covered: boolean;
  notes: string[];
  sources: string[];
}

export class TraceabilityViewProvider implements vscode.WebviewViewProvider {
  private activeNoteId: string | null = null;
  private webviewView: vscode.WebviewView | null = null;

  constructor(
    private index: ClaimIndexCache,
    private extensionUri: vscode.Uri,
  ) {
    index.onDidRefresh(() => this.updateWebview());
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    webviewView.webview.html = this.getHtml(webviewView.webview, true);
    this.updateWebview();
  }

  setActiveNote(noteId: string | null): void {
    // Only update if we have a new note — don't clear when focus moves to a non-note
    // (e.g., the full traceability panel, output panel, terminal, etc.)
    if (noteId !== null) {
      this.activeNoteId = noteId;
      this.updateWebview();
    }
  }

  openFullPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      'scepter.traceMatrixFull',
      this.activeNoteId
        ? `Traceability: ${this.activeNoteId}`
        : 'Traceability Matrix',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      },
    );

    panel.webview.html = this.getHtml(panel.webview, false);
    panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

    if (this.activeNoteId) {
      const matrix = this.index.getTraceabilityData(this.activeNoteId);
      if (matrix) {
        panel.webview.postMessage({
          type: 'update',
          ...this.buildPayload(matrix),
        });
      }
    }
  }

  private updateWebview(): void {
    if (!this.webviewView) return;

    if (!this.activeNoteId) {
      this.webviewView.webview.postMessage({ type: 'clear' });
      return;
    }

    const matrix = this.index.getTraceabilityData(this.activeNoteId);
    if (!matrix) {
      this.webviewView.webview.postMessage({ type: 'clear' });
      return;
    }

    this.webviewView.webview.postMessage({
      type: 'update',
      ...this.buildPayload(matrix),
    });
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'navigate': {
        const entry = this.index.lookup(msg.claimFqid);
        if (entry) {
          const filePath = this.index.resolveFilePath(entry.noteFilePath);
          const uri = vscode.Uri.file(filePath);
          vscode.workspace.openTextDocument(uri).then(doc => {
            vscode.window.showTextDocument(doc, { preserveFocus: false }).then(editor => {
              const line = Math.max(0, entry.line - 1);
              const range = new vscode.Range(line, 0, line, 0);
              editor.selection = new vscode.Selection(range.start, range.start);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            });
          });
        }
        break;
      }
      case 'openFullMatrix':
        this.openFullPanel();
        break;
      case 'filterGaps':
        // Filtering is handled client-side in traceability.js
        break;
    }
  }

  private buildPayload(matrix: TraceabilityMatrix): MatrixPayload {
    const noteInfo = this.index.lookupNote(matrix.sourceNoteId);
    const noteTitle = noteInfo?.noteTitle ?? matrix.sourceNoteId;

    // Build column list from projectionTypes, excluding the source note's own type
    const columns = matrix.projectionTypes.filter(t => t !== matrix.sourceNoteType);
    const columnShort = columns.map(c => {
      if (c === 'Source') return 'Src';
      return c.charAt(0);
    });

    let gapCount = 0;
    const rows: MatrixRow[] = matrix.rows.map(row => {
      const sectionPrefix = row.sectionPath.length > 0
        ? '§' + row.sectionPath.join('.') + '.'
        : '';
      const claimShortId = `${sectionPrefix}${row.claimPrefix}.${String(row.claimNumber).padStart(2, '0')}${row.claimSubLetter ?? ''}`;

      const cells: MatrixCell[] = columns.map(col => {
        const presences = row.projections.get(col) ?? [];
        const notes: string[] = [];
        const sources: string[] = [];
        for (const p of presences) {
          if (p.noteType === 'Source') {
            sources.push(p.noteId.replace(/^source:/, ''));
          } else {
            notes.push(p.noteId);
          }
        }
        return {
          covered: presences.length > 0,
          notes,
          sources,
        };
      });

      const hasGap = cells.some(c => !c.covered);
      if (hasGap) gapCount++;

      return {
        claimFqid: row.claimId,
        claimShortId,
        claimHeading: row.heading,
        importance: row.importance ?? null,
        cells,
      };
    });

    return {
      noteId: matrix.sourceNoteId,
      noteTitle,
      columns,
      columnShort,
      rows,
      gapCount,
    };
  }

  private getHtml(webview: vscode.Webview, compact: boolean): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'traceability.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'traceability.js')
    );
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body${compact ? ' class="compact"' : ''}>
  <div id="header">
    <span class="title" id="note-title"></span>
    <div class="controls">
      <label><input type="checkbox" id="gaps-only"> Gaps only</label>
      <button id="open-full" title="Open full matrix">&#x1f4cb;</button>
    </div>
  </div>
  <div id="matrix-container">
    <table id="matrix">
      <thead>
        <tr id="column-headers"></tr>
      </thead>
      <tbody id="matrix-body"></tbody>
    </table>
  </div>
  <div id="summary">
    <span id="gap-count"></span>
  </div>
  <div id="empty-state" style="display:none">
    Open a SCEpter note to see its traceability matrix.
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
