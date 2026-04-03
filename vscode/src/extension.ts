import * as vscode from 'vscode';
// @implements {DD012.§DC.05} Config detection via findProjectRoot from core
import { findProjectRoot } from 'scepter';
import { ClaimIndexCache } from './claim-index';
import type { ClaimIndexEntry } from './claim-index';
import { ClaimHoverProvider } from './hover-provider';
import { ClaimDefinitionProvider } from './definition-provider';
import { DecorationProvider } from './decoration-provider';
import { registerTraceCommand } from './trace-provider';
// @implements {DD013.§DC.20} View provider imports
import { NotesTreeProvider, type NoteTreeItem } from './views/notes-tree-provider';
import { ClaimsTreeProvider, type ClaimLeafNode, truncate } from './views/claims-tree-provider';
import { ReferencesTreeProvider } from './views/references-tree-provider';
import { ConfidenceTreeProvider } from './views/confidence-tree-provider';
import { TraceabilityViewProvider } from './views/traceability-view-provider';
import { showClaimSearchQuickPick, navigateToClaim } from './views/search-command';
import { noteIdFromPath } from './patterns';

const SUPPORTED_LANGUAGES = [
  { language: 'typescript' },
  { language: 'typescriptreact' },
  { language: 'javascript' },
  { language: 'javascriptreact' },
  { language: 'markdown' },
];

// @implements {DD012.§DC.06} Async activation to await findProjectRoot
export async function activate(context: vscode.ExtensionContext): Promise<{ extendMarkdownIt?: (md: any) => any }> {
  const outputChannel = vscode.window.createOutputChannel('SCEpter Claims');
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('SCEpter Claims extension activating...');

  // @implements {DD012.§DC.05} Replace findScepterProject with findProjectRoot
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let projectDir: string | null = null;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      projectDir = await findProjectRoot(folder.uri.fsPath);
      if (projectDir) break;
    }
  }

  if (!projectDir) {
    outputChannel.appendLine(
      'No SCEpter project found (no scepter.config.json in workspace folders)'
    );
    return {};
  }

  outputChannel.appendLine(`SCEpter project: ${projectDir}`);

  // Create and initialize the claim index cache
  const index = new ClaimIndexCache(projectDir, outputChannel);
  context.subscriptions.push({ dispose: () => index.dispose() });

  // Register hover and definition providers
  const hoverProvider = new ClaimHoverProvider(index, outputChannel);
  const definitionProvider = new ClaimDefinitionProvider(index);

  for (const selector of SUPPORTED_LANGUAGES) {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(selector, hoverProvider)
    );
    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider(selector, definitionProvider)
    );
  }

  // Register decoration provider — visual underlines for references
  const decorationProvider = new DecorationProvider(index);
  decorationProvider.activate(context);

  // Register commands
  registerTraceCommand(context, index, outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand('scepter.refreshIndex', async () => {
      await index.refresh();
      vscode.window.showInformationMessage(
        `SCEpter: Refreshed claim index (${index.size} claims, ${index.noteCount} notes)`
      );
    })
  );

  // @implements {DD013.§DC.20} Context keys
  vscode.commands.executeCommand('setContext', 'scepter.projectDetected', true);

  // @implements {DD013.§DC.20} Tree View Providers
  // @implements {DD013.§DC.22} All views subscribe to onDidRefresh
  const notesProvider = new NotesTreeProvider(index);
  const claimsProvider = new ClaimsTreeProvider(index);
  const referencesProvider = new ReferencesTreeProvider(index);
  const confidenceProvider = new ConfidenceTreeProvider(index);

  const notesTree = vscode.window.createTreeView('scepter.notesExplorer', {
    treeDataProvider: notesProvider,
    showCollapseAll: true,
  });
  const claimsTree = vscode.window.createTreeView('scepter.claimsOutline', {
    treeDataProvider: claimsProvider,
    showCollapseAll: true,
  });
  const referencesTree = vscode.window.createTreeView('scepter.referencesView', {
    treeDataProvider: referencesProvider,
    showCollapseAll: true,
  });
  const confidenceTree = vscode.window.createTreeView('scepter.confidenceView', {
    treeDataProvider: confidenceProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(notesTree, claimsTree, referencesTree, confidenceTree);

  // @implements {DD013.§DC.12} Webview View Provider for traceability sidebar
  const traceabilityProvider = new TraceabilityViewProvider(index, context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('scepter.traceMatrix', traceabilityProvider)
  );

  // @implements {DD013.§DC.22} Active editor tracking for context-sensitive views
  // Only update when a note is detected — when focus moves to a non-note
  // (markdown preview, traceability panel, terminal, etc.), retain the last note's data.
  function updateActiveNote(editor: vscode.TextEditor | undefined): void {
    const noteId = editor ? noteIdFromPath(editor.document.uri.fsPath) : null;
    if (noteId) {
      claimsProvider.setActiveNote(noteId);
      referencesProvider.setActiveNote(noteId);
      traceabilityProvider.setActiveNote(noteId);
      vscode.commands.executeCommand('setContext', 'scepter.activeNoteDetected', true);
    }
    // When noteId is null (non-note focused), keep showing the previous note's data
  }
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateActiveNote)
  );

  // Also track when documents are opened (e.g., via link click in markdown preview)
  // The preview navigates to a new file but doesn't change the active text editor.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => {
      if (doc.languageId === 'markdown') {
        const noteId = noteIdFromPath(doc.uri.fsPath);
        if (noteId) {
          claimsProvider.setActiveNote(noteId);
          referencesProvider.setActiveNote(noteId);
          traceabilityProvider.setActiveNote(noteId);
          vscode.commands.executeCommand('setContext', 'scepter.activeNoteDetected', true);
        }
      }
    })
  );

  // @implements {DD013.§DC.20} New commands for views
  context.subscriptions.push(
    vscode.commands.registerCommand('scepter.searchClaims', () => {
      showClaimSearchQuickPick(index);
    }),
    vscode.commands.registerCommand('scepter.openFullMatrix', () => {
      traceabilityProvider.openFullPanel();
    }),
    vscode.commands.registerCommand('scepter.copyNoteId', (item: NoteTreeItem) => {
      vscode.env.clipboard.writeText(item.noteId);
      vscode.window.showInformationMessage(`Copied: ${item.noteId}`);
    }),
    vscode.commands.registerCommand('scepter.openNote', (item: { noteId?: string }) => {
      const noteId = item?.noteId;
      if (!noteId) return;
      const noteInfo = index.lookupNote(noteId);
      if (noteInfo?.noteFilePath) {
        const absPath = index.resolveFilePath(noteInfo.noteFilePath);
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(absPath));
      }
    }),
    vscode.commands.registerCommand('scepter.revealClaimInEditor', async (entry: ClaimIndexEntry) => {
      const filePath = index.resolveFilePath(entry.noteFilePath);
      const uri = vscode.Uri.file(filePath);
      const line = Math.max(0, entry.line - 1);
      const range = new vscode.Range(line, 0, line, 0);

      // Check if a markdown preview is visible for this file — if so, reveal
      // in the source editor without stealing focus so the preview follows the scroll.
      const isPreviewVisible = vscode.window.tabGroups.all.some(group =>
        group.tabs.some(tab =>
          tab.label.startsWith('Preview') &&
          tab.input instanceof vscode.TabInputWebview
        )
      );

      const doc = await vscode.workspace.openTextDocument(uri);
      // Find existing editor for this file, or open one
      let editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === uri.fsPath);
      if (!editor) {
        // Open in a column that won't replace the preview
        editor = await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: isPreviewVisible,
        });
      }
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }),
    vscode.commands.registerCommand('scepter.showDerivations', async (item: ClaimLeafNode) => {
      const result = await index.trace(item.entry.fullyQualified);
      if (!result || result.derivatives.length === 0) {
        vscode.window.showInformationMessage(
          `${item.entry.fullyQualified}: No derivatives found.`
        );
        return;
      }
      const items = result.derivatives.map(fqid => {
        const entry = index.lookup(fqid);
        return {
          label: fqid,
          description: entry ? truncate(entry.heading, 50) : '',
          detail: entry?.noteType ?? '',
          fqid,
        };
      });
      const picked = await vscode.window.showQuickPick(items, {
        title: `Derivatives of ${item.entry.fullyQualified}`,
      });
      if (picked) {
        const entry = index.lookup(picked.fqid);
        if (entry) {
          navigateToClaim(entry, index);
        }
      }
    }),
    vscode.commands.registerCommand('scepter.gatherContext', async (item: NoteTreeItem) => {
      const noteInfo = index.lookupNote(item.noteId);
      if (noteInfo?.noteFilePath) {
        const filePath = index.resolveFilePath(noteInfo.noteFilePath);
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
      }
    }),
  );

  // Initialize index, then refresh any open markdown preview so the
  // markdown-it plugin re-renders with populated data-* attributes.
  await index.initialize();
  // @implements {DD013.§DC.20} Post-initialization context keys
  vscode.commands.executeCommand('setContext', 'scepter.indexReady', true);
  outputChannel.appendLine(
    `SCEpter Claims ready: ${index.size} claims across ${index.noteCount} notes`
  );

  // Set initial active note
  updateActiveNote(vscode.window.activeTextEditor);

  // @implements {DD013.§DC.08} Notes Explorer badge
  notesTree.badge = { value: index.noteCount, tooltip: `${index.noteCount} notes` };
  index.onDidRefresh(() => {
    notesTree.badge = { value: index.noteCount, tooltip: `${index.noteCount} notes` };
  });

  // @implements {DD013.§DC.18} Confidence context key
  confidenceProvider.refreshData().then(() => {
    vscode.commands.executeCommand(
      'setContext', 'scepter.confidenceAvailable', confidenceProvider.hasData
    );
  });
  index.onDidRefresh(() => {
    confidenceProvider.refreshData().then(() => {
      vscode.commands.executeCommand(
        'setContext', 'scepter.confidenceAvailable', confidenceProvider.hasData
      );
    });
  });

  // Small delay to let the preview settle before refreshing
  setTimeout(() => {
    vscode.commands.executeCommand('markdown.preview.refresh').then(
      undefined,
      () => { /* no preview open — ignore */ }
    );
  }, 500);

  // Return the markdown-it plugin for the preview pane.
  return {
    extendMarkdownIt(md: any) {
      try {
        const { createScepterPlugin } = require('./markdown-plugin');
        createScepterPlugin(index)(md);
      } catch (err) {
        outputChannel.appendLine(`[MarkdownPlugin] Failed to load: ${err}`);
      }
      return md;
    },
  };
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
