import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
// @implements {DD012.§DC.05} Config detection via findProjectRoot from core
import { findProjectRoot } from 'scepter';
import { ClaimIndexCache } from './claim-index';
import type { ClaimIndexEntry } from './claim-index';
import { ClaimHoverProvider } from './hover-provider';
import { ClaimDefinitionProvider } from './definition-provider';
import { DecorationProvider } from './decoration-provider';
import { DiagnosticsProvider } from './diagnostics-provider';
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

interface DiscoveredProject {
  name: string;
  projectDir: string;
}

/**
 * Discover all SCEpter projects in the workspace.
 * First tries upward walk from each workspace folder, then does a downward glob.
 */
async function discoverProjects(outputChannel: vscode.OutputChannel): Promise<DiscoveredProject[]> {
  const found = new Map<string, DiscoveredProject>(); // projectDir → project

  // Upward walk from each workspace folder
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      const dir = await findProjectRoot(folder.uri.fsPath);
      if (dir && !found.has(dir)) {
        found.set(dir, { name: path.basename(dir), projectDir: dir });
      }
    }
  }

  // Downward glob for nested projects
  const configFiles = await vscode.workspace.findFiles(
    '**/scepter.config.json',
    '{**/node_modules/**,**/dist/**,**/build/**}',
    20,
  );
  for (const uri of configFiles) {
    const configDir = uri.fsPath.replace(/[/\\]scepter\.config\.json$/, '');
    const candidate = configDir.endsWith('_scepter')
      ? configDir.replace(/[/\\]_scepter$/, '')
      : configDir;
    const dir = await findProjectRoot(candidate);
    if (dir && !found.has(dir)) {
      found.set(dir, { name: path.basename(dir), projectDir: dir });
    }
  }

  const projects = [...found.values()];
  outputChannel.appendLine(`Discovered ${projects.length} SCEpter project(s): ${projects.map(p => p.name).join(', ')}`);
  return projects;
}

/**
 * Among the discovered projects, return the one whose `projectDir` is the
 * longest ancestor of `filePath`. Returns undefined when no project contains
 * the file.
 */
function pickProjectForPath(
  projects: DiscoveredProject[],
  filePath: string,
): DiscoveredProject | undefined {
  let best: DiscoveredProject | undefined;
  for (const p of projects) {
    const dir = p.projectDir.endsWith(path.sep) ? p.projectDir : p.projectDir + path.sep;
    if (filePath.startsWith(dir) && (!best || p.projectDir.length > best.projectDir.length)) {
      best = p;
    }
  }
  return best;
}

// @implements {DD012.§DC.06} Async activation to await findProjectRoot
export async function activate(context: vscode.ExtensionContext): Promise<{ extendMarkdownIt?: (md: any) => any }> {
  const outputChannel = vscode.window.createOutputChannel('SCEpter Claims');
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('SCEpter Claims extension activating...');

  const projects = await discoverProjects(outputChannel);

  if (projects.length === 0) {
    outputChannel.appendLine('No SCEpter projects found in workspace.');
    return {};
  }

  // Multi-project state. When the workspace contains more than one SCEpter
  // project, pick the one that owns the file currently in focus rather than
  // defaulting to whichever project was discovered first
  const isMultiProject = projects.length > 1;
  const initialEditorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
  const initialProjectByEditor = initialEditorPath
    ? pickProjectForPath(projects, initialEditorPath)
    : undefined;
  let activeProject = initialProjectByEditor ?? projects[0];
  vscode.commands.executeCommand('setContext', 'scepter.multipleProjects', isMultiProject);

  outputChannel.appendLine(`Active project: ${activeProject.name} (${activeProject.projectDir})`);

  // Create and initialize the claim index cache
  const index = new ClaimIndexCache(activeProject.projectDir, outputChannel);
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

  // Surface ClaimIndex validation errors as VS Code diagnostics so the
  // Problems panel and editor squiggles light up on forbidden forms,
  // duplicates, unresolved references, etc.
  const diagnosticsProvider = new DiagnosticsProvider(index);
  diagnosticsProvider.activate(context);

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
  context.subscriptions.push(...claimsProvider.trackCollapseState(claimsTree));
  context.subscriptions.push(...referencesProvider.trackCollapseState(referencesTree));

  // @implements {DD013.§DC.12} Webview View Provider for traceability sidebar
  const traceabilityProvider = new TraceabilityViewProvider(index, context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('scepter.traceMatrix', traceabilityProvider)
  );

  // Helper: update the Notes view title to show active project
  function updateNotesViewTitle(): void {
    if (isMultiProject) {
      notesTree.description = activeProject.name;
    }
  }

  // Project switcher command
  context.subscriptions.push(
    vscode.commands.registerCommand('scepter.selectProject', async () => {
      const items = projects.map(p => ({
        label: p.name,
        description: p.projectDir,
        picked: p.projectDir === activeProject.projectDir,
        project: p,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: 'Select SCEpter Project',
        placeHolder: 'Choose which project to display',
      });
      if (picked && picked.project.projectDir !== activeProject.projectDir) {
        activeProject = picked.project;
        updateNotesViewTitle();
        vscode.commands.executeCommand('setContext', 'scepter.indexReady', false);
        await index.switchProject(activeProject.projectDir);
        vscode.commands.executeCommand('setContext', 'scepter.indexReady', true);
        outputChannel.appendLine(
          `Switched to project: ${activeProject.name} — ${index.size} claims, ${index.noteCount} notes`
        );
      }
    }),
  );

  let switchInFlight: Promise<void> | null = null;
  async function maybeAutoSwitchProject(filePath: string | undefined): Promise<void> {
    if (!filePath || !isMultiProject) return;
    const owning = pickProjectForPath(projects, filePath);
    if (!owning || owning.projectDir === activeProject.projectDir) return;

    // Coalesce rapid switches (e.g. tab cycling) by chaining onto the in-flight promise.
    const target = owning;
    const run = (switchInFlight ?? Promise.resolve()).then(async () => {
      if (target.projectDir === activeProject.projectDir) return;
      activeProject = target;
      updateNotesViewTitle();
      vscode.commands.executeCommand('setContext', 'scepter.indexReady', false);
      await index.switchProject(activeProject.projectDir);
      vscode.commands.executeCommand('setContext', 'scepter.indexReady', true);
      outputChannel.appendLine(
        `Auto-switched to project: ${activeProject.name} — ${index.size} claims, ${index.noteCount} notes`
      );
    });
    switchInFlight = run.catch(() => undefined);
    return run;
  }

  // @implements {DD013.§DC.22} Active editor tracking for context-sensitive views
  // Only update when a note is detected — when focus moves to a non-note
  // (markdown preview, traceability panel, terminal, etc.), retain the last note's data.
  function updateActiveNote(editor: vscode.TextEditor | undefined): void {
    if (editor) {
      void maybeAutoSwitchProject(editor.document.uri.fsPath);
    }
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
        void maybeAutoSwitchProject(doc.uri.fsPath);
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
    /**
     * Open `scepter.config.json` in an editor tab. If `projectAliases`
     * is declared, scrolls to that key; otherwise opens at the top of
     * the file. Per R011.§4.AC.10.
     *
     * @implements {R011.§4.AC.10} extension command opens config file
     */
    vscode.commands.registerCommand('scepter.openConfig', async () => {
      const configCandidates = [
        path.join(index.projectDir, 'scepter.config.json'),
        path.join(index.projectDir, '_scepter', 'scepter.config.json'),
      ];
      let configPath: string | null = null;
      for (const candidate of configCandidates) {
        try {
          await fs.promises.access(candidate);
          configPath = candidate;
          break;
        } catch {
          // try next
        }
      }
      if (!configPath) {
        vscode.window.showErrorMessage(
          'No scepter.config.json found in this project. Run `scepter init` first.',
        );
        return;
      }
      const uri = vscode.Uri.file(configPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      // Scroll to projectAliases if present.
      const text = doc.getText();
      const match = text.match(/"projectAliases"\s*:/);
      if (match) {
        const offset = match.index ?? 0;
        const pos = doc.positionAt(offset);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
        editor.selection = new vscode.Selection(pos, pos);
      }
    }),
    /**
     * Open a cross-project (alias-prefixed) reference. Dispatched from
     * the markdown preview (via `command:` URI on the `.scepter-cross-project`
     * `<a>` element) and available for any caller that wants to navigate
     * a peer note/claim.
     *
     * Args (positional):
     *   1. aliasName: string — the alias prefix (e.g. `vendor-lib`)
     *   2. normalizedId: string — the canonical no-§ id (e.g. `R005.1.AC.01`)
     *
     * On resolution success, opens the peer note's file in a new editor tab,
     * jumping to the claim's line if a claim address was supplied. On
     * failure, surfaces the typed reason via a warning message.
     *
     * @implements {R011.§4.AC.08} markdown preview click-target dispatcher
     */
    vscode.commands.registerCommand('scepter.openCrossProject', async (aliasName: string, normalizedId: string) => {
      const address = parseNormalizedAddressForOpen(normalizedId);
      if (!address) {
        vscode.window.showWarningMessage(
          `Cannot navigate cross-project reference: malformed address '${normalizedId}'.`,
        );
        return;
      }
      const result = await index.resolveCrossProject(aliasName, address);
      if (!result.ok) {
        vscode.window.showWarningMessage(
          `Cross-project reference '${aliasName}/${normalizedId}': ${result.reason}`,
        );
        return;
      }
      // Pick the file path + optional line from the lookup result.
      let filePath: string | undefined;
      let line: number | undefined;
      if ('entry' in result) {
        filePath = result.entry.noteFilePath;
        line = result.entry.line;
      } else if ('note' in result) {
        filePath = result.note.noteFilePath;
      }
      if (!filePath) {
        vscode.window.showWarningMessage(
          `Cross-project reference '${aliasName}/${normalizedId}' resolved but has no file path.`,
        );
        return;
      }
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      if (line && line > 0) {
        const pos = new vscode.Position(Math.max(0, line - 1), 0);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(pos, pos);
      }
    }),
    /**
     * `scepter.previewOpenAt(filePath, line)` — click-target for refs panel
     * links emitted by the markdown-it plugin (markdown-plugin.ts). The
     * preview's CSP allows `command:` URIs in `<a>` tags only when wired
     * to a registered command; passing a `vscode.Uri` argument through
     * `command:vscode.open?` works in trusted hovers but is unreliable
     * across all preview hosts. This thin wrapper takes plain string args
     * so the URI encoding stays simple.
     *
     * @implements {R012.§3.AC.05} command URI dispatch target for refs panel `<a href="command:...">` links
     */
    vscode.commands.registerCommand('scepter.previewOpenAt', async (filePath: string, line?: number) => {
      if (!filePath) return;
      try {
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        if (line && line > 0) {
          const pos = new vscode.Position(Math.max(0, line - 1), 0);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          editor.selection = new vscode.Selection(pos, pos);
        }
      } catch (err) {
        vscode.window.showWarningMessage(
          `SCEpter: Failed to open ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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

  // Set initial active note and project title
  updateActiveNote(vscode.window.activeTextEditor);
  updateNotesViewTitle();

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

  // One-shot post-activation preview refresh.
  //
  // The index rebuilds in stages — Phase A (active note), Phase B (full
  // corpus), then excerpt cache — and fires `onDidRefresh` after each.
  // A preview that rendered before all three settle ends up with empty
  // `data-claim-context`, `data-claim-refs`, etc. on its refs (the
  // user-visible "Loading"/"no references" tooltip).
  //
  // We coalesce all `onDidRefresh` events that fire within 1 second of
  // each other into a single preview refresh (so we land *after* the
  // excerpt cache settles), then disarm — no further auto-refresh. That
  // preserves the hover-stability win from removing the per-event
  // refresh while still seeding the initial preview with populated
  // data attrs.
  //
  // @implements {R012.§3.AC.07} no auto-refresh on index.onDidRefresh; preserves hover stability during background writes
  let initialPreviewRefreshDone = false;
  let initialRefreshDebounce: ReturnType<typeof setTimeout> | undefined;
  index.onDidRefresh(() => {
    if (initialPreviewRefreshDone) return;
    if (initialRefreshDebounce) clearTimeout(initialRefreshDebounce);
    initialRefreshDebounce = setTimeout(() => {
      initialPreviewRefreshDone = true;
      vscode.commands.executeCommand('markdown.preview.refresh').then(
        undefined,
        () => { /* no preview open — ignore */ },
      );
    }, 1000);
  });

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

/**
 * Parse a normalized claim ID (e.g. `R005.1.AC.01`) into address
 * components for `claimIndex.resolveCrossProject`. Local copy of the
 * helper that lives in hover-provider/definition-provider; inlined
 * here for the openCrossProject command rather than exporting from
 * either provider (avoids deepening the module graph for one command).
 */
function parseNormalizedAddressForOpen(
  normalized: string,
): { noteId: string; sectionPath?: number[]; claimPrefix?: string; claimNumber?: number } | null {
  const parts = normalized.split('.');
  if (parts.length === 0) return null;
  if (!/^[A-Z]{1,5}\d{3,5}$/.test(parts[0])) return null;
  const noteId = parts[0];
  if (parts.length === 1) return { noteId };
  const sectionParts: number[] = [];
  let i = 1;
  for (; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i])) sectionParts.push(parseInt(parts[i], 10));
    else break;
  }
  if (i < parts.length - 1 && /^[A-Z]+$/.test(parts[i]) && /^\d{2,3}[a-z]?$/.test(parts[i + 1])) {
    const claimNumMatch = parts[i + 1].match(/^(\d{2,3})([a-z])?$/)!;
    return {
      noteId,
      sectionPath: sectionParts.length > 0 ? sectionParts : undefined,
      claimPrefix: parts[i],
      claimNumber: parseInt(claimNumMatch[1], 10),
    };
  }
  return { noteId, sectionPath: sectionParts.length > 0 ? sectionParts : undefined };
}
