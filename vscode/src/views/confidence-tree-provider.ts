import * as vscode from 'vscode';
import * as path from 'path';
import type { ClaimIndexCache, ConfidenceAuditResult } from '../claim-index';

// @implements {DD013.§DC.18} Confidence tree provider

export type ConfidenceTreeElement = ConfidenceTierGroup | ConfidenceFileItem;

export interface ConfidenceTierGroup {
  kind: 'tier';
  tier: 'unreviewed' | 'ai-low' | 'ai-high' | 'human-low' | 'human-high';
  label: string;
  count: number;
}

export interface ConfidenceFileItem {
  kind: 'file';
  filePath: string;
  relativePath: string;
  annotation: string;
}

type TierKey = ConfidenceTierGroup['tier'];

const TIER_ORDER: TierKey[] = ['unreviewed', 'ai-low', 'ai-high', 'human-low', 'human-high'];

const TIER_LABELS: Record<TierKey, string> = {
  unreviewed: 'Unreviewed',
  'ai-low': '🤖 Low (1-2)',
  'ai-high': '🤖 High (3-5)',
  'human-low': '👤 Low (1-2)',
  'human-high': '👤 High (3-5)',
};

const TIER_ICONS: Record<TierKey, vscode.ThemeIcon> = {
  unreviewed: new vscode.ThemeIcon('circle-outline'),
  'ai-low': new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconUnset')),
  'ai-high': new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.blue')),
  'human-low': new vscode.ThemeIcon('eye', new vscode.ThemeColor('testing.iconUnset')),
  'human-high': new vscode.ThemeIcon('verified', new vscode.ThemeColor('testing.iconPassed')),
};

export class ConfidenceTreeProvider implements vscode.TreeDataProvider<ConfidenceTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConfidenceTreeElement | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private auditResult: ConfidenceAuditResult | null = null;
  private tierFiles = new Map<TierKey, ConfidenceFileItem[]>();

  constructor(private index: ClaimIndexCache) {
    index.onDidRefresh(() => this.refreshData());
  }

  /** Trigger initial data load. Call after index is ready. */
  async refreshData(): Promise<void> {
    this.auditResult = await this.index.getConfidenceAudit();
    this.classifyFiles();
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Returns true if there are any annotated files. */
  get hasData(): boolean {
    return this.auditResult != null && this.auditResult.annotated > 0;
  }

  getChildren(element?: ConfidenceTreeElement): ConfidenceTreeElement[] {
    if (!this.auditResult) return [];
    if (!element) {
      return this.getTierGroups();
    }
    if (element.kind === 'tier') {
      return this.tierFiles.get(element.tier) ?? [];
    }
    return [];
  }

  getTreeItem(element: ConfidenceTreeElement): vscode.TreeItem {
    if (element.kind === 'tier') {
      const item = new vscode.TreeItem(
        `${element.label} (${element.count})`,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = TIER_ICONS[element.tier];
      item.contextValue = 'confidenceTier';
      return item;
    }

    // File item
    const item = new vscode.TreeItem(
      element.relativePath,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = element.annotation || undefined;
    item.tooltip = new vscode.MarkdownString(
      `**${element.relativePath}**\n\n` +
      (element.annotation ? `Confidence: \`${element.annotation}\`` : 'No confidence annotation')
    );
    item.iconPath = new vscode.ThemeIcon('file-code');
    const absPath = path.join(this.index.projectDir, element.relativePath);
    item.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [vscode.Uri.file(absPath)],
    };
    item.contextValue = 'confidenceFile';
    return item;
  }

  private classifyFiles(): void {
    this.tierFiles = new Map();
    for (const tier of TIER_ORDER) {
      this.tierFiles.set(tier, []);
    }

    if (!this.auditResult) return;

    // Annotated files: classify by reviewer and level
    for (const ann of this.auditResult.files) {
      const isHuman = ann.reviewer === '👤';
      const isLow = ann.level <= 2;
      let tier: TierKey;
      if (isHuman) {
        tier = isLow ? 'human-low' : 'human-high';
      } else {
        tier = isLow ? 'ai-low' : 'ai-high';
      }

      this.tierFiles.get(tier)!.push({
        kind: 'file',
        filePath: ann.filePath,
        relativePath: ann.filePath,
        annotation: `${ann.reviewer}${ann.level}`,
      });
    }

    // Unannotated files
    for (const filePath of this.auditResult.unannotatedFiles) {
      this.tierFiles.get('unreviewed')!.push({
        kind: 'file',
        filePath,
        relativePath: filePath,
        annotation: '',
      });
    }
  }

  private getTierGroups(): ConfidenceTierGroup[] {
    return TIER_ORDER
      .map(tier => ({
        kind: 'tier' as const,
        tier,
        label: TIER_LABELS[tier],
        count: this.tierFiles.get(tier)?.length ?? 0,
      }))
      .filter(g => g.count > 0);
  }
}
