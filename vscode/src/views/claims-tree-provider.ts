import * as vscode from 'vscode';
import type { ClaimIndexCache, ClaimIndexEntry } from '../claim-index';

// @implements {DD013.§DC.09} Active Note Claims tree provider
// @implements {DD013.§DC.10} Reveal claim in editor command support

export type ClaimsTreeElement = ClaimSectionNode | ClaimLeafNode;

export interface ClaimSectionNode {
  kind: 'section';
  sectionPath: string;
  sectionHeading: string;
  claimCount: number;
  noteId: string;
}

export interface ClaimLeafNode {
  kind: 'claim';
  entry: ClaimIndexEntry;
  noteId: string;
}

/** Truncate a string to maxLen, appending '...' if truncated. Exported for reuse. */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/** Get lifecycle icon based on actual LifecycleType values. */
function getLifecycleIcon(entry: ClaimIndexEntry): vscode.ThemeIcon {
  if (!entry.lifecycle) {
    // No lifecycle tag = active claim
    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
  }
  switch (entry.lifecycle.type) {
    case 'closed':
      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    case 'deferred':
      return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('testing.iconQueued'));
    case 'removed':
      return new vscode.ThemeIcon('close', new vscode.ThemeColor('testing.iconFailed'));
    case 'superseded':
      return new vscode.ThemeIcon('arrow-swap', new vscode.ThemeColor('testing.iconUnset'));
    default:
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
  }
}

export class ClaimsTreeProvider implements vscode.TreeDataProvider<ClaimsTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ClaimsTreeElement | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private activeNoteId: string | null = null;
  /** Track which sections the user has collapsed (they start expanded by default). */
  private collapsedSections = new Set<string>();

  constructor(private index: ClaimIndexCache) {
    index.onDidRefresh(() => this._onDidChangeTreeData.fire(undefined));
  }

  /** Call from extension.ts after creating the TreeView to track expand/collapse. */
  trackCollapseState(treeView: vscode.TreeView<ClaimsTreeElement>): vscode.Disposable[] {
    return [
      treeView.onDidExpandElement(e => {
        if (e.element.kind === 'section') {
          this.collapsedSections.delete(e.element.sectionPath);
        }
      }),
      treeView.onDidCollapseElement(e => {
        if (e.element.kind === 'section') {
          this.collapsedSections.add(e.element.sectionPath);
        }
      }),
    ];
  }

  setActiveNote(noteId: string | null): void {
    if (noteId !== this.activeNoteId) {
      // New note: reset collapse tracking so sections start expanded
      this.collapsedSections.clear();
    }
    this.activeNoteId = noteId;
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(element?: ClaimsTreeElement): ClaimsTreeElement[] {
    if (!this.activeNoteId) return [];
    if (!element) {
      return this.getSections();
    }
    if (element.kind === 'section') {
      return this.getClaimsInSection(element);
    }
    return [];
  }

  getTreeItem(element: ClaimsTreeElement): vscode.TreeItem {
    if (element.kind === 'section') {
      const isCollapsed = this.collapsedSections.has(element.sectionPath);
      const item = new vscode.TreeItem(
        element.sectionHeading,
        isCollapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.description = `${element.claimCount} claim${element.claimCount !== 1 ? 's' : ''}`;
      item.iconPath = new vscode.ThemeIcon('symbol-namespace');
      item.contextValue = 'sectionItem';
      item.id = `${element.noteId}.section.${element.sectionPath}`;
      return item;
    }

    // Claim leaf node
    const entry = element.entry;
    // claimId is section-qualified (e.g. "1.AC.01"), display with § prefix
    const label = `§${entry.claimId}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = truncate(entry.heading, 60);
    item.iconPath = getLifecycleIcon(entry);

    // Build tooltip with full details
    const tooltipParts: string[] = [
      `**${entry.fullyQualified}**`,
      '',
      entry.heading,
    ];
    if (entry.importance != null) {
      tooltipParts.push('', `Importance: ${entry.importance}`);
    }
    if (entry.lifecycle) {
      const lifecycleText = entry.lifecycle.target
        ? `${entry.lifecycle.type} → ${entry.lifecycle.target}`
        : entry.lifecycle.type;
      tooltipParts.push('', `Lifecycle: ${lifecycleText}`);
    }
    if (entry.derivedFrom.length > 0) {
      tooltipParts.push('', `Derives from: ${entry.derivedFrom.join(', ')}`);
    }
    if (entry.parsedTags.length > 0) {
      tooltipParts.push('', `Tags: ${entry.parsedTags.join(', ')}`);
    }
    item.tooltip = new vscode.MarkdownString(tooltipParts.join('\n'));

    item.command = {
      command: 'scepter.revealClaimInEditor',
      title: 'Reveal Claim',
      arguments: [entry],
    };
    item.contextValue = 'claimItem';
    item.id = entry.fullyQualified;
    return item;
  }

  private getSections(): ClaimsTreeElement[] {
    if (!this.activeNoteId) return [];
    const sections = this.index.getClaimsBySection(this.activeNoteId);

    // If only one section, show claims flat (skip section grouping)
    if (sections.length === 1) {
      return sections[0].claims.map(claim => ({
        kind: 'claim' as const,
        entry: claim,
        noteId: this.activeNoteId!,
      }));
    }

    return sections.map(section => ({
      kind: 'section' as const,
      sectionPath: section.sectionPath,
      sectionHeading: section.sectionHeading,
      claimCount: section.claims.length,
      noteId: this.activeNoteId!,
    }));
  }

  private getClaimsInSection(section: ClaimSectionNode): ClaimLeafNode[] {
    const sections = this.index.getClaimsBySection(section.noteId);
    const match = sections.find(s => s.sectionPath === section.sectionPath);
    if (!match) return [];
    return match.claims.map(claim => ({
      kind: 'claim' as const,
      entry: claim,
      noteId: section.noteId,
    }));
  }
}
