import * as vscode from 'vscode';
import { ClaimIndexCache } from './claim-index';
import { matchAtPosition, noteIdFromPath } from './patterns';

export class ClaimDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private index: ClaimIndexCache) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location | null> {
    await this.index.waitUntilReady();

    const line = document.lineAt(position.line).text;
    const match = matchAtPosition(line, position.character, this.index.knownShortcodes);
    if (!match) return null;

    const contextNoteId = noteIdFromPath(document.uri.fsPath);

    // Try claim-level resolve (handles FQID, bare claims, section-prefixed)
    if (match.kind === 'claim' || match.kind === 'bare-claim') {
      const entry = this.index.resolve(match.normalizedId, contextNoteId ?? undefined);
      if (entry) {
        const absPath = this.index.resolveFilePath(entry.noteFilePath);
        return new vscode.Location(
          vscode.Uri.file(absPath),
          new vscode.Position(entry.line - 1, 0)
        );
      }
    }

    // Note-level — go to the note file
    if (match.kind === 'note') {
      const noteInfo = this.index.lookupNote(match.normalizedId);
      if (noteInfo?.noteFilePath) {
        const absPath = this.index.resolveFilePath(noteInfo.noteFilePath);
        return new vscode.Location(
          vscode.Uri.file(absPath),
          new vscode.Position(0, 0)
        );
      }
    }

    return null;
  }
}
