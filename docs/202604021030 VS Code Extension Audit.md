# VS Code Extension Audit

**Date:** 2026-04-02
**Extension:** `vscode/` directory ("scepter-claims" v0.0.1)
**Core library reference:** `core/src/`

## Executive Summary

The VS Code extension is architecturally sound in its high-level approach: it shells out to the `scepter` CLI to build the claim index, then uses that data to power hover, go-to-definition, decorations, and markdown preview enhancements. The pattern-matching layer in `patterns.ts` is independently well-crafted. However, the extension has several concrete issues that explain the three reported symptoms (broken refresh, missed note IDs, divergence from core).

**Critical issues:**

1. **File watcher only watches `_scepter/**/*.md`**, ignoring the core library's `discoveryPaths` config. Notes outside `_scepter/` are invisible to the watcher, so changes to them never trigger a refresh.
2. **JSON output from `claims index --json` omits `noteTypes`**, so the extension's `noteMap` is only populated from claim entries. Notes with zero claims are invisible -- they don't appear in hover, go-to-definition, or decorations.
3. **Config lookup only checks `_scepter/scepter.config.json`**, missing the root-level `scepter.config.json` that the core `ConfigManager` checks first.

**Moderate issues:**

4. The extension duplicates regex patterns in `markdown-plugin.ts` instead of importing from `patterns.ts`.
5. No support for note reference modifiers (`+`, `>`, `<`, `$`, `*`), tag extensions (`#tag1,tag2`), or content extensions (`: extended text}`).
6. The `ready` promise can resolve even when the CLI call fails, silently operating with an empty index.

**Minor issues:**

7. Missing CSS/Python/Go/Rust language support.
8. Hard-coded `scepter` CLI path with no fallback resolution.
9. No status bar indicator for index state.

---

## Issue 1: File Watcher Only Watches `_scepter/`

**Root cause of refresh failures.**

In `vscode/src/claim-index.ts:401-406`:

```typescript
private setupFileWatcher(): void {
  const notePattern = new vscode.RelativePattern(
    this.projectDir,
    '_scepter/**/*.md'
  );
  this.fileWatcher = vscode.workspace.createFileSystemWatcher(notePattern);
```

The glob pattern `_scepter/**/*.md` is hard-coded. The core library's `UnifiedDiscovery` (`core/src/discovery/unified-discovery.ts:104-106`) reads discovery paths from config:

```typescript
private getDiscoveryPaths(): string[] {
  const config = this.configManager.getConfig();
  return config.discoveryPaths || ['_scepter'];
}
```

A project with `"discoveryPaths": ["docs", "specs", "."]` in its config would have notes scattered across many directories. The extension watcher would miss all of them. Even the default `_scepter` path requires `_scepter/notes/` as the actual note storage location (per the config's `paths.notesRoot`), but the glob `_scepter/**/*.md` does catch this via `**`.

**Impact:** When a user edits a note outside `_scepter/`, the debounced refresh never fires. The only recovery is a manual `scepter.refreshIndex` command.

**Fix:** Read `scepter.config.json`, extract `discoveryPaths`, and create a watcher for each. Fall back to `_scepter/**/*.md` if config is unreadable. Also watch the config file itself to re-initialize watchers when discovery paths change.

---

## Issue 2: `noteTypes` Not in JSON Output

**Root cause of missing note IDs in the index.**

The CLI's `index-command.ts:37-44` serializes:

```typescript
const serializable = {
  entries: Object.fromEntries(data.entries),
  trees: Object.fromEntries([...data.trees.entries()].map(([k, v]) => [k, v])),
  crossRefs: data.crossRefs,
  errors: data.errors,
};
```

The core `ClaimIndexData` interface (`core/src/claims/claim-index.ts:78-83`) includes `noteTypes: Map<string, string>` which maps every note ID to its type name -- even notes that have zero claims. But the JSON serialization does not include it.

The extension's `ClaimIndexData` interface (`vscode/src/claim-index.ts:41-46`) expects `noteTypes?: Record<string, string>`, and at line 318-328, it tries to use it:

```typescript
if (data.noteTypes) {
  for (const [noteId, noteType] of Object.entries(data.noteTypes)) {
    this.noteMap.set(noteId, { ... });
  }
}
```

Since `data.noteTypes` is always `undefined` (the CLI never sends it), the `noteMap` is only built from notes that have at least one claim entry (lines 330-347). Any note without claims -- which is common for Task notes, Architecture notes, etc. -- is invisible to hover and go-to-definition.

**Impact:** Hovering over `{T001}` shows "not in current index" if T001 has no claims. Go-to-definition fails for such notes. Decorations show the wavy unresolved underline instead of the resolved dotted underline.

**Fix (two options):**
- **Extension side:** After refreshing the claim index, also run a separate command (e.g., `scepter ctx list --json`) to get the full list of notes.
- **CLI side:** Add `noteTypes: Object.fromEntries(data.noteTypes)` to the JSON serialization in `index-command.ts`.

The CLI fix is simpler and correct -- the data already exists; it just isn't serialized.

---

## Issue 3: Config Lookup Path Mismatch

In `vscode/src/extension.ts:100-116`:

```typescript
function findScepterProject(): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return null;
  for (const folder of workspaceFolders) {
    const configPath = path.join(folder.uri.fsPath, '_scepter', 'scepter.config.json');
    if (fs.existsSync(configPath)) {
      return folder.uri.fsPath;
    }
  }
  return null;
}
```

The core `ConfigManager` (`core/src/config/config-manager.ts:18-22`) checks two paths in priority order:

```typescript
const configPaths = [
  path.join(this.projectPath, 'scepter.config.json'),       // root-level first
  path.join(this.projectPath, '_scepter', 'scepter.config.json'),
];
```

The extension only checks `_scepter/scepter.config.json`. A project that places its config at the root level (which the core explicitly supports and checks first) would not be detected by the extension at all -- the extension would silently deactivate with "No SCEpter project found."

**Impact:** Extension fails to activate in projects using root-level config. Currently the SCEpter project itself uses `_scepter/scepter.config.json` so this hasn't been encountered yet, but it will break for other users.

**Fix:** Check both paths in the same priority order as `ConfigManager`.

---

## Issue 4: Duplicated Regex Patterns in `markdown-plugin.ts`

`vscode/src/markdown-plugin.ts:16-27` duplicates all six regex patterns from `vscode/src/patterns.ts`:

```typescript
// markdown-plugin.ts (lines 16-27)
const BRACED_CLAIM = /\{([A-Z]{1,5}\d{3,5}...)\}/g;
const BRACED_NOTE = /\{([A-Z]{1,5}\d{3,5})([^.}][^}]*)?\}/g;
const BARE_FQID = /(?<![A-Za-z0-9{])([A-Z]{1,5}\d{3,5}...)/g;
// ... etc.
```

The comment at line 14 says "Inline the patterns -- same as patterns.ts but we need them here because the markdown-it text renderer operates on raw text tokens." This reasoning is incorrect. The markdown-it plugin runs in the extension host (as stated in the module's own docstring at line 8), not in the webview. It has full access to imports. The duplication is unnecessary.

The `highlightWithData` function in `markdown-plugin.ts` reimplements essentially the same overlap-prevention logic as `findAllMatches` in `patterns.ts`, with the same priority order. This is a maintenance burden -- if a regex is updated in one file, the other may be forgotten.

**Fix:** Import `findAllMatches` from `patterns.ts` and rewrite `highlightWithData` to use it.

---

## Issue 5: Incomplete Reference Syntax Support

The extension's `patterns.ts` regex patterns handle the core claim reference syntax well but miss several features the core library supports:

### Modifiers (`+`, `>`, `<`, `$`, `*`)

The core `note-parser.ts:191` captures modifiers:
```typescript
const startRegex = /\{([A-Z]{1,5}\d{3,5})(?!\d)...?([$+><*]+)?(?:#([^:}\n]+))?/g;
```

The extension's `BRACED_NOTE_RE` at `patterns.ts:46`:
```typescript
const BRACED_NOTE_RE = /\{([A-Z]{1,5}\d{3,5})([^.}][^}]*)?\}/g;
```

This regex *does* match modifiers (the `[^.}][^}]*` group captures everything after the note ID that isn't a dot or closing brace), but it captures them as part of group 2 and discards them. The note ID extraction `(m) => m[1]` at line 140 correctly ignores the modifier, so the note ID resolves fine. However, the extension has no awareness of what modifier was used, so it can't display modifier information in hover or decorations.

### Tag Extensions (`{ID#tag1,tag2}`)

The core supports `{D001#security,auth}` with tag parsing. The extension's `BRACED_NOTE_RE` captures `#security,auth` as part of group 2 but discards it silently. There's no tag-aware filtering or display.

### Content Extensions (`{ID: extended text}`)

The core supports `{D001: additional context here}` with multi-line content. The extension's `BRACED_NOTE_RE` group 2 would match `: additional context here` but again discards it. More importantly, the extension's overlap-prevention system and line-by-line processing would struggle with multi-line content extensions.

**Impact:** These are feature gaps rather than bugs. References with modifiers/tags/extensions still get recognized as note references, just without the additional metadata being surfaced.

---

## Issue 6: Ready Promise Resolves on Failure

In `vscode/src/claim-index.ts:361-368`:

```typescript
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  this.outputChannel.appendLine(`[ClaimIndex] Refresh failed: ${message}`);
  vscode.window.showWarningMessage(
    `SCEpter: Failed to refresh claim index. Is 'scepter' on your PATH?`
  );
  this.resolveReady();  // <-- resolves even on failure
}
```

When the `scepter` CLI is not found or crashes, `resolveReady()` is called, which means `waitUntilReady()` resolves. All providers (hover, definition, decoration) then proceed with an empty index and return no results silently. The user sees a warning message but may not connect it to all hover/go-to-def being broken.

Additionally, `this.resolveReady` is a one-shot. After the first resolution (successful or failed), subsequent calls to `waitUntilReady()` resolve immediately even if a later `refresh()` is in progress. There should be a mechanism to re-gate readiness during a refresh cycle.

**Fix:** Track an `isReady` boolean and an `error` state. Let providers check `isReady` before attempting lookups, and show appropriate messages when the index is in a failed state. Consider making `ready` a re-assignable promise that resets on each `refresh()`.

---

## Issue 7: Regex Pattern Comparison -- Extension vs. Core

This section provides a detailed comparison of how the extension and core library detect references.

### Extension approach (patterns.ts)

The extension uses six independent regex patterns applied in priority order with character-level overlap prevention:

| Pattern | Regex | Purpose |
|---------|-------|---------|
| `BRACED_CLAIM_RE` | `/\{([A-Z]{1,5}\d{3,5}(?:\.§?\d+)*\.§?[A-Z]+\.\d{2,3}[a-z]?...)\}/g` | Braced claims with optional metadata |
| `BRACED_NOTE_RE` | `/\{([A-Z]{1,5}\d{3,5})([^.}][^}]*)?\}/g` | Braced bare note IDs |
| `BARE_FQID_RE` | `/(?<![A-Za-z0-9{])([A-Z]{1,5}\d{3,5}(?:\.§?\d+)*\.§?[A-Z]+\.\d{2,3}[a-z]?)(?![A-Za-z0-9}])/g` | Unbraced fully-qualified claims |
| `SECTION_PREFIXED_RE` | `/(?<![A-Za-z0-9.])§((?:\d+(?:\.\d+)*\.)?[A-Z]+\.\d{2,3}[a-z]?)(?=[:\s)\]}>—,;|]|$)/g` | Section-prefixed claims |
| `BARE_CLAIM_RE` | `/(?<![A-Za-z0-9.§{])(\*\*)?([A-Z]{1,5}\.\d{2,3}[a-z]?)(\*\*)?(?=[:\s)\]}>—,;|*]|$)/g` | Bare claims (markdown only) |
| `BARE_NOTE_RE` | `/(?<![A-Za-z0-9.{])([A-Z]{1,5}\d{3,5})(?![A-Za-z0-9.}])/g` | Bare note IDs (markdown only) |

### Core approach (claim-parser.ts + note-parser.ts)

The core has two separate parsing systems:

1. **`note-parser.ts`** for note-level references (`{ID}`, `{ID+}`, `{ID#tags}`, `{ID: content}`). Uses a single complex regex with manual brace-counting for content extensions.

2. **`claim-parser.ts`** for claim-level references. Uses `parseClaimAddress()` for structural parsing (not regex matching), and `buildBracelessPatterns()` for braceless reference detection.

### Key Divergences

**1. The extension's `BRACED_NOTE_RE` has a subtle matching issue.**

Pattern: `/\{([A-Z]{1,5}\d{3,5})([^.}][^}]*)?\}/g`

The `[^.}]` in group 2 means the first character after the note ID must NOT be a dot or closing brace. This is meant to exclude claim references like `{R004.1.AC.01}` (which start with a dot). But it also means `{D001}` matches (group 2 is undefined), and `{D001+ some text}` matches (group 2 starts with `+`), which is correct. However, a reference like `{D001}` with no space before the closing brace is matched -- which is fine. But `{D001.}` would NOT match via BRACED_NOTE_RE (the dot triggers the negative character class), so it falls through to... nothing. In the core, `{D001.}` would be parsed by `note-parser.ts`'s regex which explicitly handles the `.` modifier. This is a minor edge case.

**2. The extension's `BARE_NOTE_RE` has no shortcode validation.**

Pattern: `/(?<![A-Za-z0-9.{])([A-Z]{1,5}\d{3,5})(?![A-Za-z0-9.}])/g`

In the core's `claim-parser.ts:534-537`, bare note IDs are only matched if their shortcode is in `knownShortcodes`:
```typescript
if (knownShortcodes && knownShortcodes.size > 0) {
  patterns.push(/(?<![A-Za-z0-9.{])[A-Z]{1,5}\d{3,5}(?![A-Za-z0-9.}])/g);
}
```

And even then, each match is validated:
```typescript
const parsed = parseNoteId(address.noteId);
if (!parsed || !knownShortcodes.has(parsed.shortcode)) {
  continue;
}
```

The extension applies `BARE_NOTE_RE` in markdown files without any shortcode validation. This means strings like `HTTP200`, `UTF001`, or `JSON999` could be falsely highlighted as note references. The extension partially mitigates this by checking `isKnown()` against the claim index, but the unresolved decoration (wavy underline) would still appear for false positives, which is misleading.

**3. The extension doesn't support range references.**

The core's `claim-parser.ts` supports `AC.01-06` and `AC.01-AC.06` range syntax via `parseRangeSuffix()` and `expandClaimRange()`. The extension has no range support. A reference like `{R004.§1.AC.01-06}` would be matched by `BRACED_CLAIM_RE` and the entire string `R004.§1.AC.01-06` would be treated as a single claim ID, which would fail to resolve in the index.

**4. The extension doesn't handle comma-separated references in braces.**

The `BRACED_CLAIM_RE` includes `(?:,\.?§?[A-Z]*\.?\d{2,3}[a-z]?)*)` to match comma-separated claims like `{R005.§4.AC.01,.AC.02}`. However, only the first claim is extracted via `rawId.split(',')[0]` at `patterns.ts:126`. The second claim (`.AC.02`) is silently discarded. In the core, the comma syntax is not directly supported by `parseClaimAddress` either, so this is more of a display issue than a logic divergence.

---

## Issue 8: No Config Reading by the Extension

The extension never reads `scepter.config.json` itself. It delegates everything to the CLI via `execFile('scepter', ['claims', 'index', ...])`. This means:

1. **Discovery paths** cannot be used for file watching (Issue 1).
2. **Known shortcodes** cannot be used for bare note ID validation (Issue 7.2).
3. **Note types** cannot be used to build the note map independently of claims.

The extension treats the CLI as a black box. This is a reasonable architectural choice for reducing code duplication, but it means the extension lacks the contextual information it needs for features that operate between CLI invocations (file watching, live decoration, immediate hover resolution).

**Recommendation:** Have the extension read and parse `scepter.config.json` directly for discovery paths and note type definitions. This is a small JSON file; Zod validation is not needed in the extension (the CLI validates on its side). A simple `JSON.parse(fs.readFileSync(...))` with basic field extraction would suffice.

---

## Issue 9: Decoration Provider Scans Entire Document Per Keystroke

In `vscode/src/decoration-provider.ts:82-107`, every text change triggers a full document scan (after a 300ms debounce):

```typescript
for (let i = 0; i < doc.lineCount; i++) {
  const lineText = doc.lineAt(i).text;
  const matches = findAllMatches(lineText, isMarkdown);
  ...
}
```

For large markdown notes (hundreds of lines), this iterates every line and runs 4-7 regex patterns per line on every keystroke. The 300ms debounce helps, but the full-document scan is still costly.

**Impact:** Noticeable input lag on large notes, especially in markdown where all seven patterns are applied.

**Fix:** Track dirty line ranges from the `TextDocumentChangeEvent.contentChanges` and only re-scan affected lines plus a small buffer. Cache results for unchanged lines.

---

## Issue 10: Missing `noteTypes` in the Note Map Initialization

Even if the CLI did send `noteTypes`, the extension's current logic has a gap. At `claim-index.ts:318-328`:

```typescript
if (data.noteTypes) {
  for (const [noteId, noteType] of Object.entries(data.noteTypes)) {
    this.noteMap.set(noteId, {
      noteId,
      noteType,
      noteFilePath: '',       // <-- empty
      noteTitle: noteId,      // <-- just the ID
      claimCount: 0,
    });
  }
}
```

Notes from the `noteTypes` map get placeholder entries with empty `noteFilePath` and the note ID as the title. Lines 330-347 then try to fill these in from claim entries:

```typescript
for (const entry of this.entries.values()) {
  let info = this.noteMap.get(entry.noteId);
  if (!info) { /* create */ }
  if (!info.noteFilePath) {
    info.noteFilePath = entry.noteFilePath;
    info.noteTitle = extractNoteTitle(entry.noteFilePath);
  }
  info.claimCount++;
}
```

This means notes that have zero claims but are in `noteTypes` will keep the empty file path and bare ID title. Go-to-definition would fail (empty path), and hover would show just the ID with no title or file link.

**Fix:** The CLI should also emit file paths in its noteTypes output, or the extension should separately query for note metadata.

---

## Code Quality Issues

### Good Patterns (credit where due)

- **Overlap prevention** in `patterns.ts` via the `covered` Set is solid and correct.
- **Priority ordering** of regex patterns (most specific first) prevents ambiguous matches.
- **Debounced refresh** in the file watcher prevents thrashing.
- **EventEmitter for refresh notification** allows all providers to react to index changes.
- **Error recovery** in the markdown-it plugin (`try/catch` around render) prevents crashes.
- **Title extraction** in `extractNoteTitle` handles both flat and folder notes correctly.
- **The `resolve()` method** with FQID -> context-qualified -> bare suffix fallback is well-designed.

### Issues

1. **No test files.** The extension has zero tests. Given the regex complexity, this is a significant gap. The core library has extensive tests in `__tests__/` directories.

2. **Synchronous file reads in hover.** `readClaimContext()` at `claim-index.ts:253-267` does `fs.readFileSync()`. This blocks the extension host thread. Should be async.

3. **Synchronous file reads in title extraction.** `extractNoteTitle()` at `claim-index.ts:92-104` does `fs.readFileSync()`. Called during index refresh for every note, potentially hundreds of synchronous reads.

4. **No cancellation token respect.** The hover and definition providers receive `CancellationToken` but never check `token.isCancellationRequested`. Long-running operations could continue unnecessarily.

5. **Missing `dispose()` for decoration types.** In `decoration-provider.ts:114-119`, `resolvedDecoration.dispose()` etc. are called in `dispose()`, but these are module-level singletons. If the extension is deactivated and reactivated (unlikely but possible in testing), the disposed decoration types would throw.

6. **The `path.isAbsolute` no-op.** In `claim-index.ts:93`:
   ```typescript
   const absPath = path.isAbsolute(filePath) ? filePath : filePath;
   ```
   Both branches return `filePath`. This should presumably call `path.resolve()` or `path.join(this.projectDir, filePath)` in the else branch. The `resolveFilePath` method at line 394 does handle this correctly, but `extractNoteTitle` doesn't use it.

7. **Language support is narrow.** Only TypeScript/JavaScript and Markdown are supported. The core library's `SourceCodeScanner` also handles Python. Adding Python, CSS, HTML, and other comment-supporting languages would provide broader coverage.

---

## Prioritized Recommendations

### P0 -- Fix the three reported issues

1. **Fix file watcher to respect discovery paths.** Read config, create watchers for all discovery paths. This fixes the refresh problem.

2. **Fix the CLI to emit `noteTypes` in JSON output.** Add `noteTypes: Object.fromEntries(data.noteTypes)` to the serialization in `index-command.ts`. This fixes the missing note ID problem.

3. **Fix config detection to check root-level path.** Add `scepter.config.json` as the first check in `findScepterProject()`. This fixes activation for root-config projects.

### P1 -- Correctness improvements

4. **Add shortcode validation for `BARE_NOTE_RE`.** Read note types from config and filter bare note matches against known shortcodes. Reduces false positives in markdown.

5. **Make file reads async.** Replace `readFileSync` in `readClaimContext()` and `extractNoteTitle()` with `readFile` from `fs/promises`.

6. **Fix the `path.isAbsolute` no-op** in `extractNoteTitle()`.

7. **Improve ready-state management.** Track error state explicitly. Reset readiness on refresh start.

### P2 -- Feature improvements

8. **De-duplicate regex patterns.** Have `markdown-plugin.ts` import from `patterns.ts`.

9. **Add range reference support.** Detect `AC.01-06` syntax and expand to individual claim lookups.

10. **Add support for more languages** (Python, CSS, Go, Rust, Java).

11. **Optimize decoration provider.** Use incremental line scanning instead of full-document re-scan.

12. **Add tests.** Port the core library's claim parser test patterns to validate the extension's regex matching.

### P3 -- Nice to have

13. **Add status bar indicator** showing index state (loading, N claims, error).

14. **Surface modifier and tag information** in hover tooltips.

15. **Watch config file** for changes and reinitialize watchers/index.

16. **Add completion provider** for claim references.
