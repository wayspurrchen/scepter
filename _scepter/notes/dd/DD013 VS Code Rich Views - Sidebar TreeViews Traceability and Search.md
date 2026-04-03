---
created: 2026-04-02T20:40:58.899Z
tags: [vscode, sidebar, treeview, webview, traceability, search, views]
status: draft
---

# DD013 - VS Code Rich Views - Sidebar, TreeViews, Traceability, and Search

**Architecture:** {A003}
**Prerequisite DD:** {DD012} (VS Code Extension Migration -- implemented)
**Research:** `docs/202604021930 VS Code Extension Rich Views Research and UI Proposal.md`
**Date:** 2026-04-02
**Scope:** Implementation blueprint for seven sidebar views in the SCEpter VS Code extension: Activity Bar container, Notes Explorer, Active Note Claims, References, Traceability Matrix, Source Confidence, and Claim Search. All views consume from the existing `ClaimIndexCache`; no separate `ProjectManager` instances.

---

## Current State

The VS Code extension (post-{DD012} migration) provides hover tooltips, go-to-definition, decorations, inline trace, and a markdown preview plugin -- all consuming from `ClaimIndexCache`. There is no sidebar presence: no Activity Bar icon, no tree views, no visual browsing of notes or claims. Users must use the CLI or know file paths to navigate the knowledge graph.

The `ClaimIndexCache` already holds all the data these views need: `noteMap` (all notes with metadata), `entries` (all claims), `crossRefs` (note-to-note and claim-to-claim references), and access to `ProjectManager` for source references and confidence auditing. The `onDidRefresh` event provides the subscription point for view updates.

---

## Module Inventory

### Files Created

| File | Purpose |
|------|---------|
| `vscode/src/views/notes-tree-provider.ts` | TreeDataProvider for Notes Explorer |
| `vscode/src/views/claims-tree-provider.ts` | TreeDataProvider for Active Note Claims |
| `vscode/src/views/references-tree-provider.ts` | TreeDataProvider for References |
| `vscode/src/views/confidence-tree-provider.ts` | TreeDataProvider for Source Confidence |
| `vscode/src/views/traceability-view-provider.ts` | WebviewViewProvider for sidebar + WebviewPanel for full-page |
| `vscode/src/views/search-command.ts` | QuickPick claim search command |
| `vscode/media/scepter-icon.svg` | Activity Bar icon |
| `vscode/media/traceability.css` | Traceability webview styles |
| `vscode/media/traceability.js` | Traceability webview script |

### Files Modified

| File | Change |
|------|--------|
| `vscode/src/extension.ts` | Register all views, wire editor-tracking, set context keys |
| `vscode/src/claim-index.ts` | Add view-oriented accessor methods |
| `vscode/package.json` | Add viewsContainers, views, viewsWelcome, commands, menus, keybindings |

---

## Package.json Additions

### Activity Bar Container

§DC.01:derives=A003.§4.AC.01 The extension MUST register a SCEpter Activity Bar container with a custom icon.

The `contributes.viewsContainers.activitybar` array gains one entry:

```json
{
  "id": "scepter-sidebar",
  "title": "SCEpter",
  "icon": "media/scepter-icon.svg"
}
```

The icon is a 24x24 single-color SVG. VS Code replaces the fill color with the theme's icon color. See the Media Assets section for the SVG source.

### View Declarations

§DC.02:derives=A003.§4.AC.01 The sidebar MUST contain five views: Notes Explorer, Claims, References, Traceability (webview), and Confidence.

The `contributes.views["scepter-sidebar"]` array:

```json
[
  {
    "id": "scepter.notesExplorer",
    "name": "Notes",
    "contextualTitle": "SCEpter Notes"
  },
  {
    "id": "scepter.claimsOutline",
    "name": "Claims",
    "contextualTitle": "SCEpter Claims"
  },
  {
    "id": "scepter.referencesView",
    "name": "References",
    "contextualTitle": "SCEpter References"
  },
  {
    "type": "webview",
    "id": "scepter.traceMatrix",
    "name": "Traceability",
    "contextualTitle": "SCEpter Traceability",
    "visibility": "collapsed"
  },
  {
    "id": "scepter.confidenceView",
    "name": "Confidence",
    "contextualTitle": "SCEpter Confidence",
    "visibility": "collapsed"
  }
]
```

Traceability and Confidence start collapsed to avoid crowding the sidebar on first activation. Notes, Claims, and References start expanded.

### Welcome Views

§DC.03 The extension MUST provide welcome views for empty states, controlled by context keys.

The `contributes.viewsWelcome` array:

```json
[
  {
    "view": "scepter.notesExplorer",
    "contents": "No SCEpter project detected in this workspace.\n[Initialize Project](command:scepter.initProject)\n\nOr open a folder containing a `_scepter/` directory.",
    "when": "!scepter.projectDetected"
  },
  {
    "view": "scepter.notesExplorer",
    "contents": "$(loading~spin) Building claim index...",
    "when": "scepter.projectDetected && !scepter.indexReady"
  },
  {
    "view": "scepter.claimsOutline",
    "contents": "Open a SCEpter note to see its claims.\n\nClaims are acceptance criteria and other addressable items within notes.",
    "when": "scepter.indexReady && !scepter.activeNoteDetected"
  },
  {
    "view": "scepter.referencesView",
    "contents": "Open a SCEpter note to see its references.\n\nReferences show how notes connect to each other and to source code.",
    "when": "scepter.indexReady && !scepter.activeNoteDetected"
  },
  {
    "view": "scepter.confidenceView",
    "contents": "No confidence data available.\n\nAdd `@confidence` annotations to source files to track review status.",
    "when": "scepter.indexReady && !scepter.confidenceAvailable"
  }
]
```

Context keys set by the extension:
- `scepter.projectDetected` -- set `true` after `findProjectRoot` succeeds
- `scepter.indexReady` -- set `true` after `ClaimIndexCache.initialize()` completes
- `scepter.activeNoteDetected` -- set `true` when the active editor is a SCEpter note
- `scepter.confidenceAvailable` -- set `true` when confidence audit returns annotated files

### Command Declarations

§DC.04 The extension MUST declare all new commands required by the views.

New commands added to `contributes.commands`:

```json
[
  {
    "command": "scepter.searchClaims",
    "title": "SCEpter: Search Claims",
    "icon": "$(search)"
  },
  {
    "command": "scepter.openFullMatrix",
    "title": "SCEpter: Open Full Traceability Matrix",
    "icon": "$(table)"
  },
  {
    "command": "scepter.copyNoteId",
    "title": "SCEpter: Copy Note ID"
  },
  {
    "command": "scepter.openNote",
    "title": "SCEpter: Open Note"
  },
  {
    "command": "scepter.gatherContext",
    "title": "SCEpter: Gather Context",
    "icon": "$(search)"
  },
  {
    "command": "scepter.showDerivations",
    "title": "SCEpter: Show Derivation Chain",
    "icon": "$(references)"
  },
  {
    "command": "scepter.revealClaimInEditor",
    "title": "SCEpter: Reveal Claim in Editor"
  }
]
```

Existing commands `scepter.traceClaim` and `scepter.refreshIndex` are retained.

### Menu Contributions

§DC.05 The extension MUST contribute menus for view title bars and item context actions.

The `contributes.menus` section:

```json
{
  "view/title": [
    {
      "command": "scepter.refreshIndex",
      "when": "view =~ /^scepter\\./",
      "group": "navigation"
    },
    {
      "command": "scepter.searchClaims",
      "when": "view == scepter.claimsOutline",
      "group": "navigation"
    },
    {
      "command": "scepter.openFullMatrix",
      "when": "view == scepter.traceMatrix",
      "group": "navigation"
    }
  ],
  "view/item/context": [
    {
      "command": "scepter.gatherContext",
      "when": "view == scepter.notesExplorer && viewItem == noteItem",
      "group": "inline"
    },
    {
      "command": "scepter.copyNoteId",
      "when": "view == scepter.notesExplorer && viewItem == noteItem"
    },
    {
      "command": "scepter.openNote",
      "when": "view == scepter.notesExplorer && viewItem == noteItem"
    },
    {
      "command": "scepter.traceClaim",
      "when": "view == scepter.notesExplorer && viewItem == noteItem"
    },
    {
      "command": "scepter.showDerivations",
      "when": "view == scepter.claimsOutline && viewItem == claimItem",
      "group": "inline"
    },
    {
      "command": "scepter.revealClaimInEditor",
      "when": "view == scepter.claimsOutline && viewItem =~ /claimItem|sectionItem/"
    },
    {
      "command": "scepter.openNote",
      "when": "view == scepter.referencesView && viewItem =~ /refNote/"
    }
  ]
}
```

### Keybindings

§DC.06 The extension MUST register a keyboard shortcut for claim search.

```json
{
  "keybindings": [
    {
      "command": "scepter.searchClaims",
      "key": "ctrl+shift+s",
      "mac": "cmd+shift+s",
      "when": "scepter.indexReady"
    }
  ]
}
```

---

## ClaimIndexCache Extensions

§DC.07:derives=A003.§4.AC.01 ClaimIndexCache MUST expose view-oriented accessor methods that aggregate existing data without duplicating storage.

All new methods are read-only aggregations over existing internal state (`entries`, `noteMap`, `crossRefs`, `projectManager`). They do not add new caches or data structures.

### getNotesByType()

```typescript
getNotesByType(): Map<string, NoteInfo[]> {
  const grouped = new Map<string, NoteInfo[]>();
  for (const info of this.noteMap.values()) {
    const existing = grouped.get(info.noteType) ?? [];
    existing.push(info);
    grouped.set(info.noteType, existing);
  }
  // Sort notes within each group by ID
  for (const [, notes] of grouped) {
    notes.sort((a, b) => a.noteId.localeCompare(b.noteId));
  }
  return grouped;
}
```

Used by: Notes Explorer tree provider.

### getClaimsBySection()

```typescript
interface SectionWithClaims {
  sectionPath: string;
  sectionHeading: string;
  claims: ClaimIndexEntry[];
}

getClaimsBySection(noteId: string): SectionWithClaims[] {
  const claims = this.claimsForNote(noteId);
  const sectionMap = new Map<string, SectionWithClaims>();

  for (const claim of claims) {
    const sectionKey = claim.sectionPath?.join('.') ?? '';
    const heading = claim.sectionHeading ?? `Section ${sectionKey || '(root)'}`;
    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, {
        sectionPath: sectionKey,
        sectionHeading: heading,
        claims: [],
      });
    }
    sectionMap.get(sectionKey)!.claims.push(claim);
  }

  // Sort sections by their path, claims by line number within each section
  const sections = [...sectionMap.values()].sort((a, b) =>
    a.sectionPath.localeCompare(b.sectionPath, undefined, { numeric: true })
  );
  for (const section of sections) {
    section.claims.sort((a, b) => a.line - b.line);
  }
  return sections;
}
```

Used by: Active Note Claims tree provider.

### getReferencesForNote()

```typescript
interface NoteReferences {
  outgoing: Array<{ noteId: string; noteInfo: NoteInfo | undefined }>;
  incoming: Array<{ noteId: string; noteInfo: NoteInfo | undefined }>;
  source: SourceReference[];
}

getReferencesForNote(noteId: string): NoteReferences {
  const outgoingRefs = this.projectManager?.referenceManager?.getReferencesFrom(noteId) ?? [];
  const incomingRefs = this.projectManager?.referenceManager?.getReferencesTo(noteId, false) ?? [];
  const sourceRefs = this.projectManager?.sourceScanner?.getIndex().getReferencesToNote(noteId) ?? [];

  return {
    outgoing: outgoingRefs.map(ref => ({
      noteId: ref.toId,
      noteInfo: this.noteMap.get(ref.toId),
    })),
    incoming: incomingRefs.map(ref => ({
      noteId: ref.fromId,
      noteInfo: this.noteMap.get(ref.fromId),
    })),
    source: sourceRefs,
  };
}
```

Used by: References tree provider.

### getTraceabilityData()

```typescript
getTraceabilityData(noteId: string): TraceabilityMatrix | null {
  if (!this.coreClaimIndex) return null;
  const data = this.coreClaimIndex.getData();
  if (!data) return null;
  return buildTraceabilityMatrix(noteId, data);
}
```

This wraps the core library's `buildTraceabilityMatrix()`. The `coreClaimIndex` is already cached during `refresh()`.

Used by: Traceability webview provider.

### getConfidenceAudit()

```typescript
async getConfidenceAudit(): Promise<ConfidenceAuditResult | null> {
  if (!this.projectManager) return null;
  const config = this.projectManager.configManager.getConfig();
  const srcConfig = config.sourceCodeIntegration;
  if (!srcConfig?.enabled) return null;

  return auditConfidence(
    this.projectDir,
    srcConfig.folders,
    srcConfig.extensions,
    srcConfig.exclude,
  );
}
```

Used by: Confidence tree provider.

### getKnownNoteTypes()

```typescript
getKnownNoteTypes(): Map<string, { shortcode: string; description: string }> {
  const config = this.projectManager?.configManager.getConfig();
  if (!config) return new Map();
  const result = new Map<string, { shortcode: string; description: string }>();
  for (const [name, typeConfig] of Object.entries(config.noteTypes)) {
    result.set(name, {
      shortcode: typeConfig.shortcode,
      description: typeConfig.description || name,
    });
  }
  return result;
}
```

Used by: Notes Explorer (for type group display names and icons).

---

## View 1: Notes Explorer

### File

`vscode/src/views/notes-tree-provider.ts`

### Tree Element Types

§DC.08:derives=A003.§4.AC.01 The Notes Explorer MUST display all notes grouped by type, with click-to-open and inline actions.

```typescript
type NotesTreeElement = NoteTypeGroup | NoteTreeItem;

interface NoteTypeGroup {
  kind: 'type-group';
  typeName: string;
  shortcode: string;
  count: number;
}

interface NoteTreeItem {
  kind: 'note';
  noteId: string;
  title: string;
  typeName: string;
  shortcode: string;
  claimCount: number;
  filePath: string;
}
```

### Class: NotesTreeProvider

```typescript
class NotesTreeProvider implements vscode.TreeDataProvider<NotesTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<NotesTreeElement | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private index: ClaimIndexCache) {
    index.onDidRefresh(() => this._onDidChangeTreeData.fire(undefined));
  }

  getChildren(element?: NotesTreeElement): NotesTreeElement[] {
    if (!element) {
      return this.getTypeGroups();
    }
    if (element.kind === 'type-group') {
      return this.getNotesForType(element.typeName);
    }
    return [];
  }

  getTreeItem(element: NotesTreeElement): vscode.TreeItem { ... }

  private getTypeGroups(): NoteTypeGroup[] { ... }
  private getNotesForType(typeName: string): NoteTreeItem[] { ... }
}
```

### Data Source

- `getTypeGroups()` calls `index.getNotesByType()` and the note type config from `index.getKnownNoteTypes()`.
- `getNotesForType()` returns the notes array from the grouped map.
- Subscribes to `index.onDidRefresh` to fire `onDidChangeTreeData`.

### TreeItem Rendering

**Type group nodes:**
- `label`: Type name with count, e.g. "Requirement (4)"
- `collapsibleState`: `Collapsed`
- `iconPath`: Per-type `ThemeIcon`:
  - Requirement: `new ThemeIcon('checklist')`
  - DetailedDesign: `new ThemeIcon('lightbulb')`
  - Architecture: `new ThemeIcon('layers')`
  - Specification: `new ThemeIcon('file-code')`
  - Task: `new ThemeIcon('tools')`
  - TestPlan: `new ThemeIcon('beaker')`
  - Default: `new ThemeIcon('file-text')`
- `contextValue`: `"noteTypeGroup"`

**Note item nodes:**
- `label`: `"{noteId} {title}"` (e.g. "R004 Data Validation")
- `description`: Claim count string, e.g. "12 claims" or empty if zero
- `tooltip`: `MarkdownString` with type, claim count, file path
- `iconPath`: Same `ThemeIcon` as the parent type group
- `command`: `{ command: 'vscode.open', arguments: [Uri.file(absolutePath)] }`
- `contextValue`: `"noteItem"`
- `id`: `noteId` (preserves expansion state across refreshes)

### Registration

In `extension.ts`:

```typescript
const notesProvider = new NotesTreeProvider(index);
const notesTree = vscode.window.createTreeView('scepter.notesExplorer', {
  treeDataProvider: notesProvider,
  showCollapseAll: true,
});
context.subscriptions.push(notesTree);
```

After index initialization:

```typescript
notesTree.badge = { value: index.noteCount, tooltip: `${index.noteCount} notes` };
index.onDidRefresh(() => {
  notesTree.badge = { value: index.noteCount, tooltip: `${index.noteCount} notes` };
});
```

---

## View 2: Active Note Claims

### File

`vscode/src/views/claims-tree-provider.ts`

### Tree Element Types

§DC.09:derives=A003.§4.AC.01 The Claims view MUST display claims for the active editor's note, grouped by section, updating on editor change.

```typescript
type ClaimsTreeElement = ClaimSectionNode | ClaimLeafNode;

interface ClaimSectionNode {
  kind: 'section';
  sectionPath: string;
  sectionHeading: string;
  claimCount: number;
  noteId: string;
}

interface ClaimLeafNode {
  kind: 'claim';
  entry: ClaimIndexEntry;
  noteId: string;
}
```

### Class: ClaimsTreeProvider

```typescript
class ClaimsTreeProvider implements vscode.TreeDataProvider<ClaimsTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ClaimsTreeElement | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private activeNoteId: string | null = null;

  constructor(private index: ClaimIndexCache) {
    index.onDidRefresh(() => this._onDidChangeTreeData.fire(undefined));
  }

  setActiveNote(noteId: string | null): void {
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

  getTreeItem(element: ClaimsTreeElement): vscode.TreeItem { ... }

  private getSections(): ClaimsTreeElement[] { ... }
  private getClaimsInSection(section: ClaimSectionNode): ClaimLeafNode[] { ... }
}
```

### Data Source

- `getSections()` calls `index.getClaimsBySection(activeNoteId)`.
- If a note has no sections (all claims at root level), a single implicit root section is used.
- If a note has only one section, the section node is omitted and claims are shown flat at the root.
- `setActiveNote()` is called from the `onDidChangeActiveTextEditor` handler in `extension.ts`.

### TreeItem Rendering

**Section nodes:**
- `label`: Section heading text (e.g. "Input Validation")
- `description`: Claim count (e.g. "3 claims")
- `collapsibleState`: `Expanded` (sections start open so claims are visible)
- `iconPath`: `new ThemeIcon('symbol-namespace')`
- `contextValue`: `"sectionItem"`
- `id`: `"${noteId}.section.${sectionPath}"` (stable across refreshes)

**Claim nodes:**
- `label`: Claim prefix and number with section path (e.g. "AC.01" or "§1.AC.01")
- `description`: Heading text truncated to 60 characters
- `tooltip`: `MarkdownString` with fully qualified ID, full heading, importance, lifecycle, derivation chain, verification status
- `collapsibleState`: `None`
- `iconPath`: Lifecycle-colored icon:
  - Active (or no lifecycle tag): `new ThemeIcon('circle-filled', new ThemeColor('testing.iconPassed'))` (green)
  - Draft: `new ThemeIcon('circle-outline', new ThemeColor('testing.iconQueued'))` (gray)
  - Deprecated: `new ThemeIcon('warning', new ThemeColor('testing.iconUnset'))` (yellow)
  - Removed: `new ThemeIcon('close', new ThemeColor('testing.iconFailed'))` (red)
  - Deferred: `new ThemeIcon('debug-pause', new ThemeColor('testing.iconQueued'))` (gray)
- `command`: `{ command: 'scepter.revealClaimInEditor', arguments: [entry] }` -- scrolls the editor to the claim's line in the note file
- `contextValue`: `"claimItem"`
- `id`: `entry.fullyQualified` (stable across refreshes)

### Reveal Claim Command

§DC.10 The `scepter.revealClaimInEditor` command MUST scroll the active editor to the claim's line number and select the line.

```typescript
vscode.commands.registerCommand('scepter.revealClaimInEditor', async (entry: ClaimIndexEntry) => {
  const filePath = index.resolveFilePath(entry.noteFilePath);
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });
  const line = Math.max(0, entry.line - 1);
  const range = new vscode.Range(line, 0, line, 0);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
});
```

### Registration

```typescript
const claimsProvider = new ClaimsTreeProvider(index);
const claimsTree = vscode.window.createTreeView('scepter.claimsOutline', {
  treeDataProvider: claimsProvider,
  showCollapseAll: true,
});
context.subscriptions.push(claimsTree);
```

---

## View 3: References

### File

`vscode/src/views/references-tree-provider.ts`

### Tree Element Types

§DC.11:derives=A003.§4.AC.01 The References view MUST display incoming, outgoing, and source references for the active note, updating on editor change.

```typescript
type RefsTreeElement = RefDirectionGroup | RefNoteItem | RefSourceItem;

interface RefDirectionGroup {
  kind: 'direction';
  direction: 'outgoing' | 'incoming' | 'source';
  count: number;
  noteId: string;
}

interface RefNoteItem {
  kind: 'ref-note';
  noteId: string;
  noteTitle: string;
  noteType: string;
  direction: 'outgoing' | 'incoming';
}

interface RefSourceItem {
  kind: 'ref-source';
  filePath: string;
  refType: string;  // 'implements', 'validates', 'depends-on', 'see', 'mention'
  line: number;
}
```

### Class: ReferencesTreeProvider

```typescript
class ReferencesTreeProvider implements vscode.TreeDataProvider<RefsTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RefsTreeElement | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private activeNoteId: string | null = null;

  constructor(private index: ClaimIndexCache) {
    index.onDidRefresh(() => this._onDidChangeTreeData.fire(undefined));
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

  getTreeItem(element: RefsTreeElement): vscode.TreeItem { ... }

  private getDirectionGroups(): RefDirectionGroup[] { ... }
  private getRefsForDirection(group: RefDirectionGroup): (RefNoteItem | RefSourceItem)[] { ... }
}
```

### Data Source

- `getDirectionGroups()` calls `index.getReferencesForNote(activeNoteId)` and returns up to three groups (omitting empty groups).
- Outgoing and incoming groups return `RefNoteItem` children.
- Source group returns `RefSourceItem` children.
- Subscribes to both `index.onDidRefresh` and `setActiveNote()`.

### TreeItem Rendering

**Direction group nodes:**
- `label`: Direction with count (e.g. "Outgoing (3)", "Incoming (2)", "Source References (4)")
- `collapsibleState`: `Collapsed`
- `iconPath`:
  - Outgoing: `new ThemeIcon('arrow-right')`
  - Incoming: `new ThemeIcon('arrow-left')`
  - Source: `new ThemeIcon('file-code')`
- `contextValue`: `"refGroup"`

**Reference note items:**
- `label`: `"{noteId} {title}"` (e.g. "R004 Data Validation")
- `description`: Note type name (e.g. "Requirement")
- `tooltip`: `MarkdownString` with note metadata
- `iconPath`: Type-appropriate `ThemeIcon` (same mapping as Notes Explorer)
- `command`: `{ command: 'vscode.open', arguments: [Uri.file(absolutePath)] }`
- `contextValue`: `"refNote"`

**Source reference items:**
- `label`: Relative file path (relative to `projectDir`)
- `description`: Reference type (e.g. "@implements", "@validates", "@depends-on")
- `tooltip`: `MarkdownString` with full path and line number
- `iconPath`: `new ThemeIcon('file-code')`
- `command`: `{ command: 'vscode.open', arguments: [Uri.file(absolutePath)] }` -- opens the file and reveals the line
- `contextValue`: `"refSource"`

### Registration

```typescript
const referencesProvider = new ReferencesTreeProvider(index);
const referencesTree = vscode.window.createTreeView('scepter.referencesView', {
  treeDataProvider: referencesProvider,
  showCollapseAll: true,
});
context.subscriptions.push(referencesTree);
```

---

## View 4: Traceability Matrix

### File

`vscode/src/views/traceability-view-provider.ts`

### Dual Rendering

§DC.12:derives=A003.§4.AC.01 The Traceability view MUST provide a compact sidebar webview and a full-page WebviewPanel, both rendering the same matrix data.

The sidebar `WebviewView` (300-400px wide) shows a compact grid with single-character column headers and colored circle cells. The full-page `WebviewPanel` (opened via `scepter.openFullMatrix`) shows the same data with full column labels, heading text, and filter controls.

Both share the same HTML generation logic and CSS, parameterized by a `compact: boolean` flag.

### Class: TraceabilityViewProvider

```typescript
class TraceabilityViewProvider implements vscode.WebviewViewProvider {
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
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    this.updateWebview();
  }

  setActiveNote(noteId: string | null): void {
    this.activeNoteId = noteId;
    this.updateWebview();
  }

  openFullPanel(): void { ... }

  private updateWebview(): void { ... }
  private handleMessage(msg: any): void { ... }
  private getHtml(webview: vscode.Webview, compact: boolean): string { ... }
}
```

### PostMessage Protocol

§DC.13 The traceability webview MUST communicate with the extension via a defined postMessage protocol.

**Extension to Webview messages:**

| `type` | Payload | When sent |
|--------|---------|-----------|
| `update` | `{ noteId, noteTitle, rows, columns, gapCount }` | On note change or index refresh |
| `clear` | `{}` | When no note is active |

**Webview to Extension messages:**

| `type` | Payload | Action |
|--------|---------|--------|
| `navigate` | `{ claimFqid }` | Open the claim's note file and scroll to the claim's line |
| `openFullMatrix` | `{}` | Open the full-page WebviewPanel |
| `filterGaps` | `{ gapsOnly: boolean }` | Re-render showing only rows with gaps |

### Matrix Data Structure

The `update` message payload:

```typescript
interface MatrixPayload {
  noteId: string;
  noteTitle: string;
  columns: string[];          // Projection type names from config
  columnShort: string[];      // Single-char abbreviations (R, S, D, Src)
  rows: MatrixRow[];
  gapCount: number;
}

interface MatrixRow {
  claimFqid: string;
  claimShortId: string;       // e.g. "§1.AC.01"
  claimHeading: string;       // Full heading text (for full panel)
  importance: number | null;
  cells: MatrixCell[];
}

interface MatrixCell {
  covered: boolean;
  notes: string[];            // Note IDs that provide coverage
  sources: string[];          // Source file paths that provide coverage
}
```

Column abbreviations for compact mode: the first character of each projection type name (e.g., "Requirement" -> "R", "Specification" -> "S", "DetailedDesign" -> "D"). "Source" is always the last column, abbreviated "Src".

### HTML Structure

§DC.14 The traceability webview MUST use plain HTML/CSS with VS Code CSS variables for theming.

The webview HTML structure:

```html
<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="header">
    <span class="title" id="note-title"></span>
    <div class="controls">
      <label><input type="checkbox" id="gaps-only"> Gaps only</label>
      <button id="open-full" title="Open full matrix">$(table)</button>
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
</html>
```

### CSS Theming (traceability.css)

§DC.15 The traceability webview CSS MUST use VS Code CSS variables exclusively for colors.

```css
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  padding: 0;
  margin: 0;
}

#matrix {
  border-collapse: collapse;
  width: 100%;
  table-layout: fixed;
}

#matrix th {
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
  padding: 2px 4px;
  font-weight: 600;
  font-size: 11px;
  text-align: center;
}

#matrix td {
  border: 1px solid var(--vscode-panel-border);
  padding: 2px 4px;
  text-align: center;
  cursor: pointer;
}

#matrix td.claim-id {
  text-align: left;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-covered {
  color: var(--vscode-testing-iconPassed);
}

.cell-gap {
  color: var(--vscode-testing-iconFailed);
}

.cell-covered::after { content: '●'; }
.cell-gap::after { content: '○'; }

.row-has-gap {
  background: color-mix(in srgb, var(--vscode-testing-iconFailed) 10%, transparent);
}

#header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.controls {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
}

#summary {
  padding: 4px 8px;
  font-size: 11px;
  border-top: 1px solid var(--vscode-panel-border);
  color: var(--vscode-descriptionForeground);
}

#empty-state {
  padding: 16px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
}
```

### JavaScript Logic (traceability.js)

§DC.16 The traceability webview script MUST render the matrix from postMessage data and send navigation events back to the extension.

```javascript
(function () {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let gapsOnly = false;

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'update') {
      currentData = msg;
      render();
    } else if (msg.type === 'clear') {
      currentData = null;
      renderEmpty();
    }
  });

  document.getElementById('gaps-only')?.addEventListener('change', e => {
    gapsOnly = e.target.checked;
    vscode.postMessage({ type: 'filterGaps', gapsOnly });
    render();
  });

  document.getElementById('open-full')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openFullMatrix' });
  });

  function render() {
    if (!currentData) { renderEmpty(); return; }
    const { noteId, noteTitle, columns, columnShort, rows, gapCount } = currentData;

    document.getElementById('note-title').textContent =
      `${noteId} ${noteTitle}`;
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('matrix-container').style.display = '';

    // Column headers
    const headerRow = document.getElementById('column-headers');
    headerRow.innerHTML = '<th>Claim</th>' +
      (columnShort || columns).map(c => `<th>${c}</th>`).join('');

    // Rows
    const tbody = document.getElementById('matrix-body');
    tbody.innerHTML = '';
    for (const row of rows) {
      const hasGap = row.cells.some(c => !c.covered);
      if (gapsOnly && !hasGap) continue;

      const tr = document.createElement('tr');
      if (hasGap) tr.classList.add('row-has-gap');

      const idTd = document.createElement('td');
      idTd.classList.add('claim-id');
      idTd.textContent = row.claimShortId;
      idTd.title = row.claimFqid + ': ' + row.claimHeading;
      idTd.addEventListener('click', () =>
        vscode.postMessage({ type: 'navigate', claimFqid: row.claimFqid }));
      tr.appendChild(idTd);

      for (const cell of row.cells) {
        const td = document.createElement('td');
        td.classList.add(cell.covered ? 'cell-covered' : 'cell-gap');
        const tooltip = cell.covered
          ? cell.notes.concat(cell.sources).join(', ')
          : 'No coverage';
        td.title = tooltip;
        if (cell.covered) {
          td.addEventListener('click', () => {
            const target = cell.notes[0] || cell.sources[0];
            if (target) vscode.postMessage({ type: 'navigate', claimFqid: row.claimFqid });
          });
        }
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    document.getElementById('gap-count').textContent =
      `${gapCount} gap${gapCount !== 1 ? 's' : ''} of ${rows.length} claims`;
    document.getElementById('summary').style.display = '';
  }

  function renderEmpty() {
    document.getElementById('matrix-container').style.display = 'none';
    document.getElementById('summary').style.display = 'none';
    document.getElementById('empty-state').style.display = '';
  }
})();
```

### Full-Page Panel

§DC.17 The `scepter.openFullMatrix` command MUST open a `WebviewPanel` in the editor area with the full traceability matrix.

```typescript
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

  panel.webview.html = this.getHtml(panel.webview, false /* compact=false */);
  panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

  // Send current data
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
```

The full-page panel uses the same CSS and JS. The `compact=false` flag in `getHtml()` uses full column names instead of abbreviations and includes the heading text in each row.

---

## View 5: Source Confidence

### File

`vscode/src/views/confidence-tree-provider.ts`

### Tree Element Types

§DC.18:derives=A003.§4.AC.01 The Confidence view MUST display source files grouped by confidence tier, updating on index refresh.

```typescript
type ConfidenceTreeElement = ConfidenceTierGroup | ConfidenceFileItem;

interface ConfidenceTierGroup {
  kind: 'tier';
  tier: 'unreviewed' | 'ai-low' | 'ai-high' | 'human';
  label: string;
  count: number;
}

interface ConfidenceFileItem {
  kind: 'file';
  filePath: string;
  relativePath: string;
  annotation: string;  // e.g. "AI3", "Human4", or ""
}
```

### Tier Classification

Files are classified into four tiers:

| Tier | Condition | Label |
|------|-----------|-------|
| `unreviewed` | No `@confidence` annotation | "Unreviewed" |
| `ai-low` | AI reviewer, level 1-2 | "AI Low (1-2)" |
| `ai-high` | AI reviewer, level 3-5 | "AI High (3-5)" |
| `human` | Human reviewer, any level | "Human Reviewed" |

### Class: ConfidenceTreeProvider

```typescript
class ConfidenceTreeProvider implements vscode.TreeDataProvider<ConfidenceTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConfidenceTreeElement | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private auditResult: ConfidenceAuditResult | null = null;

  constructor(private index: ClaimIndexCache) {
    index.onDidRefresh(() => this.refreshData());
  }

  private async refreshData(): Promise<void> {
    this.auditResult = await this.index.getConfidenceAudit();
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(element?: ConfidenceTreeElement): ConfidenceTreeElement[] {
    if (!this.auditResult) return [];
    if (!element) {
      return this.getTierGroups();
    }
    if (element.kind === 'tier') {
      return this.getFilesForTier(element.tier);
    }
    return [];
  }

  getTreeItem(element: ConfidenceTreeElement): vscode.TreeItem { ... }

  private getTierGroups(): ConfidenceTierGroup[] { ... }
  private getFilesForTier(tier: string): ConfidenceFileItem[] { ... }
}
```

### TreeItem Rendering

**Tier group nodes:**
- `label`: Tier label with count (e.g. "Unreviewed (18)")
- `collapsibleState`: `Collapsed`
- `iconPath`: Tier-specific icon:
  - Unreviewed: `new ThemeIcon('circle-outline')` (default color)
  - AI Low: `new ThemeIcon('warning', new ThemeColor('testing.iconUnset'))`
  - AI High: `new ThemeIcon('pass', new ThemeColor('charts.blue'))`
  - Human: `new ThemeIcon('verified', new ThemeColor('testing.iconPassed'))`
- `contextValue`: `"confidenceTier"`

**File items:**
- `label`: Relative file path
- `description`: Annotation text (e.g. "AI3", "Human4") or empty for unreviewed
- `tooltip`: `MarkdownString` with full path and annotation details
- `iconPath`: `new ThemeIcon('file-code')`
- `command`: `{ command: 'vscode.open', arguments: [Uri.file(absolutePath)] }`
- `contextValue`: `"confidenceFile"`

### Initial Data Load

The confidence view calls `refreshData()` at construction time (after index is ready). The `auditConfidence()` call is async and may take a moment for large projects, but the view starts collapsed so it only runs when first expanded.

### Registration

```typescript
const confidenceProvider = new ConfidenceTreeProvider(index);
const confidenceTree = vscode.window.createTreeView('scepter.confidenceView', {
  treeDataProvider: confidenceProvider,
  showCollapseAll: true,
});
context.subscriptions.push(confidenceTree);
```

---

## View 6: Claim Search (QuickPick Command)

### File

`vscode/src/views/search-command.ts`

### Implementation

§DC.19:derives=A003.§4.AC.01 The `scepter.searchClaims` command MUST open a QuickPick with all claims, supporting fuzzy search on ID, heading text, note type, and tags.

```typescript
interface ClaimQuickPickItem extends vscode.QuickPickItem {
  entry: ClaimIndexEntry;
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

  quickPick.show();
}
```

### Detail Line Format

```typescript
function buildDetailLine(entry: ClaimIndexEntry): string {
  const parts: string[] = [entry.noteType];
  if (entry.importance) parts.push(`importance: ${entry.importance}`);
  if (entry.lifecycle) parts.push(entry.lifecycle);
  if (entry.metadata?.tags?.length) parts.push(entry.metadata.tags.join(', '));
  return parts.join(' | ');
}
```

### Navigation

```typescript
async function navigateToClaim(entry: ClaimIndexEntry, index: ClaimIndexCache): Promise<void> {
  const filePath = index.resolveFilePath(entry.noteFilePath);
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const line = Math.max(0, entry.line - 1);
  const range = new vscode.Range(line, 0, line, 0);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}
```

### Registration

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('scepter.searchClaims', () => {
    showClaimSearchQuickPick(index);
  })
);
```

---

## Extension.ts Changes

§DC.20 The `activate()` function MUST register all view providers, wire editor tracking, and set context keys.

### Updated Activation Flow

The existing `activate()` function gains these blocks after the index is created:

```typescript
// --- Context keys ---
vscode.commands.executeCommand('setContext', 'scepter.projectDetected', true);

// --- Tree View Providers ---
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

// --- Webview View Provider ---
const traceabilityProvider = new TraceabilityViewProvider(index, context.extensionUri);
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider('scepter.traceMatrix', traceabilityProvider)
);

// --- Active Editor Tracking ---
function updateActiveNote(editor: vscode.TextEditor | undefined): void {
  const noteId = editor ? noteIdFromPath(editor.document.uri.fsPath) : null;
  claimsProvider.setActiveNote(noteId);
  referencesProvider.setActiveNote(noteId);
  traceabilityProvider.setActiveNote(noteId);
  vscode.commands.executeCommand('setContext', 'scepter.activeNoteDetected', !!noteId);
}

context.subscriptions.push(
  vscode.window.onDidChangeActiveTextEditor(updateActiveNote)
);

// --- New Commands ---
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
  vscode.commands.registerCommand('scepter.revealClaimInEditor', async (entry: ClaimIndexEntry) => {
    const filePath = index.resolveFilePath(entry.noteFilePath);
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });
    const line = Math.max(0, entry.line - 1);
    const range = new vscode.Range(line, 0, line, 0);
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
    // Open the note and show a notification
    const filePath = index.resolveFilePath(
      index.lookupNote(item.noteId)?.noteFilePath ?? ''
    );
    if (filePath) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    }
    // Show referenced notes in the References view by switching editor focus
    // The References view will auto-update via onDidChangeActiveTextEditor
  }),
);

// --- Post-initialization ---
await index.initialize();
vscode.commands.executeCommand('setContext', 'scepter.indexReady', true);

// Set initial active note
updateActiveNote(vscode.window.activeTextEditor);

// Badge
notesTree.badge = { value: index.noteCount, tooltip: `${index.noteCount} notes` };
index.onDidRefresh(() => {
  notesTree.badge = { value: index.noteCount, tooltip: `${index.noteCount} notes` };
});
```

### Import Additions

```typescript
import { NotesTreeProvider, type NoteTreeItem } from './views/notes-tree-provider';
import { ClaimsTreeProvider, type ClaimLeafNode } from './views/claims-tree-provider';
import { ReferencesTreeProvider } from './views/references-tree-provider';
import { ConfidenceTreeProvider } from './views/confidence-tree-provider';
import { TraceabilityViewProvider } from './views/traceability-view-provider';
import { showClaimSearchQuickPick, navigateToClaim } from './views/search-command';
import { noteIdFromPath } from './patterns';
```

---

## Media Assets

### Activity Bar Icon (media/scepter-icon.svg)

§DC.21 The extension MUST include a 24x24 single-color SVG icon for the Activity Bar.

The icon is a stylized "S" with a trident-like top element, suggesting both "SCEpter" (scepter) and structured hierarchy:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="#C5C5C5" d="M12 2 L12 6 M9 3 L9 6 M15 3 L15 6
    M9 6 Q9 8 12 8 Q15 8 15 6
    M12 8 L12 20
    M8 20 L16 20
    M10 18 L14 18"/>
  <path fill="none" stroke="#C5C5C5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    d="M12 2 L12 6 M9 3 L9 6 M15 3 L15 6
    M9 6 Q9 8 12 8 Q15 8 15 6
    M12 8 L12 20
    M8 20 L16 20
    M10 18 L14 18"/>
</svg>
```

VS Code replaces the fill and stroke colors with the active theme's icon color. The SVG uses a single `#C5C5C5` color (VS Code's default dark icon color) as a placeholder.

---

## Refresh and Event Flow

§DC.22 All views MUST refresh from `ClaimIndexCache.onDidRefresh` and context-sensitive views MUST additionally track `onDidChangeActiveTextEditor`.

### Event Subscription Summary

| View | Subscribes to `onDidRefresh` | Subscribes to `onDidChangeActiveTextEditor` |
|------|------------------------------|---------------------------------------------|
| Notes Explorer | Yes (full tree refresh) | No |
| Active Note Claims | Yes (refresh if same note) | Yes (via `setActiveNote()`) |
| References | Yes (refresh if same note) | Yes (via `setActiveNote()`) |
| Traceability | Yes (re-send matrix data) | Yes (via `setActiveNote()`) |
| Confidence | Yes (re-audit) | No |

### Sequence: User Opens a Note

1. User opens `R004 Data Validation.md` in the editor.
2. VS Code fires `onDidChangeActiveTextEditor`.
3. `updateActiveNote()` in `extension.ts` extracts `noteId = "R004"` via `noteIdFromPath()`.
4. Sets `scepter.activeNoteDetected` context key to `true`.
5. Calls `claimsProvider.setActiveNote("R004")` -- Claims view rebuilds with R004's sections and claims.
6. Calls `referencesProvider.setActiveNote("R004")` -- References view rebuilds with R004's references.
7. Calls `traceabilityProvider.setActiveNote("R004")` -- Traceability webview receives new matrix data.

### Sequence: File Watcher Triggers Refresh

1. User saves a note file.
2. `ClaimIndexCache`'s file watcher fires after 2-second debounce.
3. `refresh()` rebuilds the claim index from `ProjectManager`.
4. `_onDidRefresh.fire()` emits.
5. All five view providers receive the event and call their own `refresh()` / `fire(undefined)`.
6. VS Code re-requests `getChildren()` and `getTreeItem()` for visible tree nodes.
7. Traceability webview receives a new `update` message.

---

## Projection Coverage

| Projection | Status | Notes |
|------------|--------|-------|
| Source | Target of this DD | All files listed in Module Inventory |
| Tests | Not started | Test files for each tree provider and the search command |
| CLI | Not applicable | Views are VS Code-only; CLI already covers the equivalent functionality |
| UI | This DD IS the UI projection | All views defined here |
| Documentation | Not started | VS Code extension README should document the sidebar |

---

## Open Questions

1. **DocumentSymbolProvider complement.** The research recommends adding a `DocumentSymbolProvider` that exposes claims in the built-in Outline view and breadcrumbs. This is complementary to the dedicated Claims TreeView and could be added as a follow-up without affecting any claims in this DD.

2. **Interactive reference graph.** A force-directed graph visualization (using d3-force or similar in a WebviewPanel) could complement the References TreeView for understanding the knowledge graph topology. Deferred -- the TreeView covers the functional need.

3. **Large project performance.** For projects with 500+ notes, `getChildren()` implementations should be profiled. The lazy expansion pattern (children computed only when a node is expanded) mitigates most concerns, but the Notes Explorer root-level type grouping iterates all notes on every refresh.
