import * as vscode from 'vscode';
import { ClaimIndexCache } from './claim-index';
import {
  deletionMarkerAtPosition,
  matchAtPosition,
  noteIdFromPath,
  parseNormalizedAddress,
} from './patterns';

export class ClaimDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private index: ClaimIndexCache) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location | null> {
    await this.index.waitUntilReady();

    const line = document.lineAt(position.line).text;

    // Tombstoned references are a recognized lifecycle state. Go-to-
    // definition returns null (recognized no-op) rather than falling
    // through to the unknown-reference path that would surface a
    // "could not find symbol" error in VS Code's peek UI. The hover
    // provider surfaces the deletion provenance for users who want to
    // inspect the marker.
    // @implements {R015.§11.AC.03} go-to-definition on tombstoned reference is a recognized no-op
    // @implements {DD020.§6.DC.03} definition provider detects via isDeletionMarker, returns null without erroring
    if (deletionMarkerAtPosition(line, position.character)) {
      return null;
    }

    const match = matchAtPosition(line, position.character, this.index.knownShortcodes);
    if (!match) return null;

    const contextNoteId = noteIdFromPath(document.uri.fsPath);

    // Cross-project goto: resolve the alias to a peer file path.
    // @implements {R011.§4.AC.04} cross-project go-to-definition opens peer file
    if (match.aliasPrefix) {
      return await this.provideCrossProjectDefinition(match);
    }

    // Try claim-level resolve (handles FQID, bare claims, section-prefixed)
    if (match.kind === 'claim' || match.kind === 'bare-claim') {
      const entry = this.index.resolve(match.normalizedId, contextNoteId ?? undefined, {
        selfScoped: match.selfScoped,
      });
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

    // Section-level — go to the section heading
    if (match.kind === 'section') {
      const sectionEntry = this.index.lookupSection(match.normalizedId, contextNoteId ?? undefined);
      if (sectionEntry?.noteFilePath) {
        const absPath = this.index.resolveFilePath(sectionEntry.noteFilePath);
        return new vscode.Location(
          vscode.Uri.file(absPath),
          new vscode.Position(Math.max(0, sectionEntry.line - 1), 0)
        );
      }
    }

    return null;
  }

  /**
   * Resolve an alias-prefixed reference to a peer file location.
   *
   * @implements {R011.§4.AC.04} cross-project go-to-definition
   */
  private async provideCrossProjectDefinition(match: {
    aliasPrefix?: string;
    normalizedId: string;
    kind: string;
  }): Promise<vscode.Location | null> {
    const aliasName = match.aliasPrefix!;
    const aliasEntry = this.index.getAlias(aliasName);
    if (!aliasEntry?.resolved) return null;

    const address = parseNormalizedAddress(match.normalizedId);
    if (!address) return null;
    const result = await this.index.resolveCrossProject(aliasName, address);
    if (!result.ok) return null;

    if ('entry' in result) {
      // Claim — navigate to the peer file at the claim's line.
      const peerFile = result.entry.noteFilePath;
      if (!peerFile) return null;
      return new vscode.Location(
        vscode.Uri.file(peerFile),
        new vscode.Position(Math.max(0, (result.entry.line ?? 1) - 1), 0),
      );
    }
    if ('note' in result) {
      const peerFile = result.note.noteFilePath;
      if (!peerFile) return null;
      return new vscode.Location(vscode.Uri.file(peerFile), new vscode.Position(0, 0));
    }
    return null;
  }
}

