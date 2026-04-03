import * as vscode from 'vscode';
import type { ClaimIndexCache, ClaimIndexEntry } from '../claim-index';
import { truncate } from './claims-tree-provider';

// @implements {DD013.§DC.19} QuickPick claim search command

interface ClaimQuickPickItem extends vscode.QuickPickItem {
  entry: ClaimIndexEntry;
}

function buildDetailLine(entry: ClaimIndexEntry): string {
  const parts: string[] = [entry.noteType];
  if (entry.importance != null) parts.push(`importance: ${entry.importance}`);
  if (entry.lifecycle) parts.push(entry.lifecycle.type);
  if (entry.parsedTags.length > 0) parts.push(entry.parsedTags.join(', '));
  return parts.join(' | ');
}

export async function navigateToClaim(entry: ClaimIndexEntry, index: ClaimIndexCache): Promise<void> {
  const filePath = index.resolveFilePath(entry.noteFilePath);
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const line = Math.max(0, entry.line - 1);
  const range = new vscode.Range(line, 0, line, 0);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

export function showClaimSearchQuickPick(index: ClaimIndexCache): void {
  const quickPick = vscode.window.createQuickPick<ClaimQuickPickItem>();
  quickPick.placeholder = 'Search claims by ID, text, or tag...';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  const allEntries = [...index.getAllClaimEntries().values()];
  quickPick.items = allEntries.map(entry => ({
    label: `$(symbol-property) ${entry.fullyQualified}`,
    description: truncate(entry.heading, 60),
    detail: buildDetailLine(entry),
    entry,
  }));

  quickPick.onDidAccept(() => {
    const selected = quickPick.selectedItems[0];
    if (selected) {
      navigateToClaim(selected.entry, index);
    }
    quickPick.dispose();
  });

  quickPick.onDidHide(() => quickPick.dispose());

  quickPick.show();
}
