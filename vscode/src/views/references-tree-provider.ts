import * as vscode from 'vscode';
import * as path from 'path';
import type { ClaimIndexCache, SourceReference } from '../claim-index';
import { getTypeIcon } from './notes-tree-provider';

// @implements {DD013.§DC.11} References tree provider

export type RefsTreeElement = RefDirectionGroup | RefNoteItem | RefSourceItem;

export interface RefDirectionGroup {
  kind: 'direction';
  direction: 'outgoing' | 'incoming' | 'source';
  count: number;
  noteId: string;
}

export interface RefNoteItem {
  kind: 'ref-note';
  noteId: string;
  noteTitle: string;
  noteType: string;
  direction: 'outgoing' | 'incoming';
}

export interface RefSourceItem {
  kind: 'ref-source';
  filePath: string;
  refType: string;
  line: number | undefined;
}

export class ReferencesTreeProvider implements vscode.TreeDataProvider<RefsTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RefsTreeElement | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private activeNoteId: string | null = null;
  /** Track which direction groups the user has expanded (persists across refreshes). */
  private expandedDirections = new Set<string>();

  constructor(private index: ClaimIndexCache) {
    index.onDidRefresh(() => this._onDidChangeTreeData.fire(undefined));
  }

  /** Call from extension.ts after creating the TreeView to track expand/collapse. */
  trackCollapseState(treeView: vscode.TreeView<RefsTreeElement>): vscode.Disposable[] {
    return [
      treeView.onDidExpandElement(e => {
        if (e.element.kind === 'direction') {
          this.expandedDirections.add(e.element.direction);
        }
      }),
      treeView.onDidCollapseElement(e => {
        if (e.element.kind === 'direction') {
          this.expandedDirections.delete(e.element.direction);
        }
      }),
    ];
  }

  setActiveNote(noteId: string | null): void {
    this.activeNoteId = noteId;
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(element?: RefsTreeElement): RefsTreeElement[] {
    if (!this.activeNoteId) return [];
    if (!element) {
      return this.getDirectionGroups();
    }
    if (element.kind === 'direction') {
      return this.getRefsForDirection(element);
    }
    return [];
  }

  getTreeItem(element: RefsTreeElement): vscode.TreeItem {
    if (element.kind === 'direction') {
      const labelMap = {
        outgoing: 'Outgoing',
        incoming: 'Incoming',
        source: 'Source References',
      };
      const iconMap = {
        outgoing: 'arrow-right',
        incoming: 'arrow-left',
        source: 'file-code',
      };
      const isExpanded = this.expandedDirections.has(element.direction);
      const item = new vscode.TreeItem(
        `${labelMap[element.direction]} (${element.count})`,
        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon(iconMap[element.direction]);
      item.contextValue = 'refGroup';
      return item;
    }

    if (element.kind === 'ref-note') {
      const item = new vscode.TreeItem(
        `${element.noteId} ${element.noteTitle}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = element.noteType;
      item.tooltip = new vscode.MarkdownString(
        `**${element.noteId}** ${element.noteTitle}\n\nType: ${element.noteType}`
      );
      item.iconPath = getTypeIcon(element.noteType);
      const noteInfo = this.index.lookupNote(element.noteId);
      if (noteInfo?.noteFilePath) {
        const absPath = this.index.resolveFilePath(noteInfo.noteFilePath);
        item.command = {
          command: 'vscode.open',
          title: 'Open Note',
          arguments: [vscode.Uri.file(absPath), { preserveFocus: true }],
        };
      }
      item.contextValue = 'refNote';
      return item;
    }

    // ref-source
    const relativePath = path.isAbsolute(element.filePath)
      ? path.relative(this.index.projectDir, element.filePath)
      : element.filePath;
    const item = new vscode.TreeItem(relativePath, vscode.TreeItemCollapsibleState.None);
    item.description = `@${element.refType}`;
    item.tooltip = new vscode.MarkdownString(
      `**${relativePath}**` +
      (element.line != null ? ` (line ${element.line})` : '') +
      `\n\nReference type: \`@${element.refType}\``
    );
    item.iconPath = new vscode.ThemeIcon('file-code');
    const absPath = path.isAbsolute(element.filePath)
      ? element.filePath
      : path.join(this.index.projectDir, element.filePath);
    const args: any[] = [vscode.Uri.file(absPath)];
    if (element.line != null) {
      args.push({
        selection: new vscode.Range(element.line - 1, 0, element.line - 1, 0),
        preserveFocus: true,
      });
    } else {
      args.push({ preserveFocus: true });
    }
    item.command = {
      command: 'vscode.open',
      title: 'Open Source File',
      arguments: args,
    };
    item.contextValue = 'refSource';
    return item;
  }

  private getDirectionGroups(): RefDirectionGroup[] {
    if (!this.activeNoteId) return [];
    const refs = this.index.getReferencesForNote(this.activeNoteId);
    const groups: RefDirectionGroup[] = [];

    if (refs.outgoing.length > 0) {
      groups.push({
        kind: 'direction',
        direction: 'outgoing',
        count: refs.outgoing.length,
        noteId: this.activeNoteId,
      });
    }
    if (refs.incoming.length > 0) {
      groups.push({
        kind: 'direction',
        direction: 'incoming',
        count: refs.incoming.length,
        noteId: this.activeNoteId,
      });
    }
    if (refs.source.length > 0) {
      groups.push({
        kind: 'direction',
        direction: 'source',
        count: refs.source.length,
        noteId: this.activeNoteId,
      });
    }
    return groups;
  }

  private getRefsForDirection(group: RefDirectionGroup): (RefNoteItem | RefSourceItem)[] {
    const refs = this.index.getReferencesForNote(group.noteId);

    if (group.direction === 'outgoing') {
      return refs.outgoing.map(ref => ({
        kind: 'ref-note' as const,
        noteId: ref.noteId,
        noteTitle: ref.noteInfo?.noteTitle ?? ref.noteId,
        noteType: ref.noteInfo?.noteType ?? 'Unknown',
        direction: 'outgoing' as const,
      }));
    }

    if (group.direction === 'incoming') {
      return refs.incoming.map(ref => ({
        kind: 'ref-note' as const,
        noteId: ref.noteId,
        noteTitle: ref.noteInfo?.noteTitle ?? ref.noteId,
        noteType: ref.noteInfo?.noteType ?? 'Unknown',
        direction: 'incoming' as const,
      }));
    }

    // source
    return refs.source.map((ref: SourceReference) => ({
      kind: 'ref-source' as const,
      filePath: ref.filePath,
      refType: ref.referenceType,
      line: ref.line,
    }));
  }
}
