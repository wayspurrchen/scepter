import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ClaimIndexCache, NoteInfo } from '../claim-index';

// @implements {DD013.§DC.08} Notes Explorer tree provider

export type NotesTreeElement = NoteTypeGroup | NoteTreeItem | NoteFolderChild;

export interface NoteTypeGroup {
  kind: 'type-group';
  typeName: string;
  shortcode: string;
  count: number;
}

export interface NoteTreeItem {
  kind: 'note';
  noteId: string;
  title: string;
  typeName: string;
  shortcode: string;
  claimCount: number;
  filePath: string;
  isFolder: boolean;
}

export interface NoteFolderChild {
  kind: 'folder-child';
  fileName: string;
  absolutePath: string;
}

/** Map note type names to ThemeIcon identifiers. */
const TYPE_ICON_MAP: Record<string, string> = {
  Requirement: 'checklist',
  DetailedDesign: 'lightbulb',
  Architecture: 'layers',
  Specification: 'file-code',
  Task: 'tools',
  TestPlan: 'beaker',
};

/** Get a ThemeIcon for a note type name. Exported for reuse by references-tree-provider. */
export function getTypeIcon(typeName: string): vscode.ThemeIcon {
  const iconId = TYPE_ICON_MAP[typeName] ?? 'file-text';
  return new vscode.ThemeIcon(iconId);
}

export class NotesTreeProvider implements vscode.TreeDataProvider<NotesTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<NotesTreeElement | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private index: ClaimIndexCache) {
    index.onDidRefresh(() => this._onDidChangeTreeData.fire(undefined));
  }

  getChildren(element?: NotesTreeElement): NotesTreeElement[] | Thenable<NotesTreeElement[]> {
    if (!element) {
      return this.getTypeGroups();
    }
    if (element.kind === 'type-group') {
      return this.getNotesForType(element.typeName);
    }
    if (element.kind === 'note' && element.isFolder) {
      return this.getFolderChildren(element);
    }
    return [];
  }

  getTreeItem(element: NotesTreeElement): vscode.TreeItem {
    if (element.kind === 'type-group') {
      const item = new vscode.TreeItem(
        `${element.typeName} (${element.count})`,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = getTypeIcon(element.typeName);
      item.contextValue = 'noteTypeGroup';
      item.id = element.typeName;
      return item;
    }

    // Folder child item
    if (element.kind === 'folder-child') {
      const item = new vscode.TreeItem(
        element.fileName,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon('file');
      item.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [vscode.Uri.file(element.absolutePath)],
      };
      item.resourceUri = vscode.Uri.file(element.absolutePath);
      return item;
    }

    // Note item
    const item = new vscode.TreeItem(
      `${element.noteId} ${element.title}`,
      element.isFolder
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.description = element.claimCount > 0
      ? `${element.claimCount} claim${element.claimCount !== 1 ? 's' : ''}`
      : '';
    item.tooltip = new vscode.MarkdownString(
      `**${element.noteId}** ${element.title}\n\n` +
      `Type: ${element.typeName}\n\n` +
      (element.claimCount > 0 ? `Claims: ${element.claimCount}\n\n` : '') +
      `File: \`${element.filePath}\``
    );
    item.iconPath = getTypeIcon(element.typeName);
    const absPath = this.index.resolveFilePath(element.filePath);
    item.command = {
      command: 'vscode.open',
      title: 'Open Note',
      arguments: [vscode.Uri.file(absPath)],
    };
    item.contextValue = 'noteItem';
    item.id = element.noteId;
    return item;
  }

  private getTypeGroups(): NoteTypeGroup[] {
    const grouped = this.index.getNotesByType();
    const knownTypes = this.index.getKnownNoteTypes();
    const groups: NoteTypeGroup[] = [];

    for (const [typeName, notes] of grouped) {
      const typeInfo = knownTypes.get(typeName);
      groups.push({
        kind: 'type-group',
        typeName,
        shortcode: typeInfo?.shortcode ?? typeName.charAt(0),
        count: notes.length,
      });
    }

    groups.sort((a, b) => a.typeName.localeCompare(b.typeName));
    return groups;
  }

  private getNotesForType(typeName: string): NoteTreeItem[] {
    const grouped = this.index.getNotesByType();
    const notes = grouped.get(typeName) ?? [];
    const knownTypes = this.index.getKnownNoteTypes();
    const typeInfo = knownTypes.get(typeName);

    return notes.map((info: NoteInfo) => {
      // Detect folder note: main file is {ID}.md inside a directory named {ID} ...
      const absPath = this.index.resolveFilePath(info.noteFilePath);
      const dir = path.dirname(absPath);
      const dirName = path.basename(dir);
      const isFolder = dirName.startsWith(info.noteId + ' ') ||
        dirName === info.noteId;

      return {
        kind: 'note' as const,
        noteId: info.noteId,
        title: info.noteTitle,
        typeName,
        shortcode: typeInfo?.shortcode ?? typeName.charAt(0),
        claimCount: info.claimCount,
        filePath: info.noteFilePath,
        isFolder,
      };
    });
  }

  private async getFolderChildren(note: NoteTreeItem): Promise<NoteFolderChild[]> {
    const absPath = this.index.resolveFilePath(note.filePath);
    const dir = path.dirname(absPath);
    const mainFile = path.basename(absPath);

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const children: NoteFolderChild[] = [];

      for (const entry of entries) {
        // Skip the main note file and hidden files
        if (entry.name === mainFile || entry.name.startsWith('.')) continue;

        if (entry.isFile()) {
          children.push({
            kind: 'folder-child',
            fileName: entry.name,
            absolutePath: path.join(dir, entry.name),
          });
        } else if (entry.isDirectory()) {
          // Show subdirectories as a single entry (could expand further later)
          children.push({
            kind: 'folder-child',
            fileName: entry.name + '/',
            absolutePath: path.join(dir, entry.name),
          });
        }
      }

      children.sort((a, b) => a.fileName.localeCompare(b.fileName));
      return children;
    } catch {
      return [];
    }
  }
}
