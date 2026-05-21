import * as vscode from 'vscode';
import * as path from 'path';
import { ClaimIndexCache, ClaimIndexEntry } from './claim-index';
import { findAllMatches, findDeletionMarkers, noteIdFromPath } from './patterns';

/**
 * Recognize a claim definition at the start of `lineText`.
 *
 * Accepts heading-form (`### §1.AC.01 Title`, `### AC.01 Title`),
 * paragraph-form (`§1.AC.01 prose…`, `AC.01 prose…`), and
 * bold-wrapped paragraph form (`**§1.AC.01** prose…`,
 * `**R049.LOCK.03** prose…`). Mirrors the patterns
 * `tryParseClaimText` accepts in the core parser, restricted to the
 * minimum needed to drive badge placement in the current document.
 *
 * Returns the bare claim id (e.g. `TM.01`), the inline section path
 * if the definition carried one (e.g. `[13]` from `§13.TM.01`), and
 * the column where the claim id starts in `lineText` so the caller
 * can anchor a badge decoration there.
 */
function tryParseClaimDefinitionLine(lineText: string): { bareId: string; sectionPath?: number[]; idIdx: number } | null {
  let work = lineText;
  let stripped = 0;
  const headingMatch = work.match(/^(#{1,6}\s+)/);
  if (headingMatch) {
    stripped = headingMatch[0].length;
    work = work.slice(stripped);
  }
  const re = /^(?:\*\*|__)?(?:[A-Z]{1,5}\d{3,5}\.)?§?(?:(\d+(?:\.\d+)*)\.)?§?([A-Z]+)\.(\d{2,3})([a-z])?(?:\*\*|__)?[\s:]/;
  const m = work.match(re);
  if (!m) return null;
  const [, secPath, claimPrefix, claimNum, subLetter] = m;
  const padded = String(parseInt(claimNum, 10)).padStart(2, '0');
  const bareId = `${claimPrefix}.${padded}${subLetter ?? ''}`;
  const sectionPath = secPath ? secPath.split('.').map((s) => parseInt(s, 10)) : undefined;
  const idIdxInWork = work.indexOf(`${claimPrefix}.${claimNum}`);
  if (idIdxInWork < 0) return null;
  return { bareId, sectionPath, idIdx: stripped + idIdxInWork };
}

function arrayEq(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Resolved reference — dotted underline, subtle teal tint
const resolvedDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline dotted',
  color: '#4EC9B0',
  cursor: 'pointer',
  overviewRulerColor: '#4EC9B044',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
});

// Unresolved reference — dimmer, wavy underline
const unresolvedDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline wavy',
  color: '#808080',
  cursor: 'default',
});

// Section reference — very subtle, just a thin dotted underline
const sectionDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline dotted rgba(78, 201, 176, 0.4)',
});

// Cross-project resolved reference — purple hue, dotted underline.
// Visually distinct from local resolved (teal) per R011.§4.AC.05.
// Color choice (#C586C0) is the design decision recorded as DD015 DC.07.
// @implements {R011.§4.AC.05} cross-project decoration distinguishable from local
// @implements {DD015.§1.DC.07} purple `#C586C0` distinct from local teal `#4EC9B0`
const crossProjectResolvedDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline dotted',
  color: '#C586C0',
  cursor: 'pointer',
  overviewRulerColor: '#C586C044',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
});

// Cross-project unresolved reference — same purple hue, wavy underline so
// resolved/unresolved are also distinguishable per R011.§4.AC.05.
// @implements {R011.§4.AC.05} resolved vs unresolved cross-project distinct
// @implements {DD015.§1.DC.07} same purple hue, distinguishable underline style
const crossProjectUnresolvedDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline wavy',
  color: '#C586C0',
  cursor: 'default',
});

// Tombstoned (deletion-marker) reference — dimmed strike-through styling so
// the lifecycle state is visually distinct from live, unresolved, and
// cross-project references. The marker is a recognized lifecycle state, not
// a broken reference; the styling signals "retired" rather than "error."
// Visual choice: muted gray (#888888) with line-through and italic, to read
// as deliberately retired rather than as a syntax violation.
// @implements {R015.§11.AC.04} editor visually distinguishes tombstoned references
// @implements {DD020.§6.DC.04} decoration applies to DELETION_MARKER_RE ranges
const tombstoneDecoration = vscode.window.createTextEditorDecorationType({
  textDecoration: 'line-through',
  color: '#888888',
  fontStyle: 'italic',
  opacity: '0.75',
  cursor: 'help',
});

// Claim-definition badge — rendered as an `after` decoration anchored next to
// the claim id in its heading line. Color encodes source coverage (green if
// any source ref, red if only note-to-note refs). Count is total inbound refs.
// @implements {R012.§1.AC.04} editor badge via `after`-decoration mechanism
const claimBadgeDecoration = vscode.window.createTextEditorDecorationType({});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class DecorationProvider {
  private disposables: vscode.Disposable[] = [];

  constructor(private index: ClaimIndexCache) {}

  activate(context: vscode.ExtensionContext): void {
    if (vscode.window.activeTextEditor) {
      this.updateDecorations(vscode.window.activeTextEditor);
    }

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.updateDecorations(editor);
      })
    );

    // @implements {R012.§1.AC.04} editor badge refreshes on document change (debounced) and index refresh
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
          if (changeTimer) clearTimeout(changeTimer);
          changeTimer = setTimeout(() => this.updateDecorations(editor), 300);
        }
      })
    );

    this.disposables.push(
      this.index.onDidRefresh(() => {
        if (vscode.window.activeTextEditor) {
          this.updateDecorations(vscode.window.activeTextEditor);
        }
      })
    );

    context.subscriptions.push({ dispose: () => this.dispose() });
  }

  private updateDecorations(editor: vscode.TextEditor): void {
    const doc = editor.document;
    const langId = doc.languageId;

    const supported = [
      'typescript', 'typescriptreact',
      'javascript', 'javascriptreact',
      'markdown',
    ];
    if (!supported.includes(langId)) return;

    const isMarkdown = langId === 'markdown';
    const contextNoteId = noteIdFromPath(doc.uri.fsPath);

    const resolved: vscode.DecorationOptions[] = [];
    const unresolvedList: vscode.DecorationOptions[] = [];
    const sections: vscode.DecorationOptions[] = [];
    const crossProjectResolved: vscode.DecorationOptions[] = [];
    const crossProjectUnresolved: vscode.DecorationOptions[] = [];
    const tombstones: vscode.DecorationOptions[] = [];
    const claimBadges: vscode.DecorationOptions[] = [];

    for (let i = 0; i < doc.lineCount; i++) {
      const lineText = doc.lineAt(i).text;

      // Tombstoned references are parser-invisible — collect them
      // separately so the styling pass distinguishes them from live
      // references. The marker scan runs before findAllMatches so the
      // range covers the marker + any address tail.
      // @implements {R015.§11.AC.04} editor styling distinguishes tombstoned references
      // @implements {DD020.§6.DC.04} decoration scans DELETION_MARKER_RE per line
      for (const tomb of findDeletionMarkers(lineText)) {
        const range = new vscode.Range(i, tomb.start, i, tomb.end);
        tombstones.push({
          range,
          hoverMessage: new vscode.MarkdownString(
            `*Tombstoned reference* — deleted note \`${tomb.originalId}\` at \`${tomb.timestamp}\`. ` +
            `Recognized lifecycle state, not a broken reference.`,
          ),
        });
      }

      const matches = findAllMatches(lineText, isMarkdown, this.index.knownShortcodes);

      for (const match of matches) {
        const range = new vscode.Range(i, match.start, i, match.end);

        // Cross-project routing first — these never use local
        // resolved/unresolved decorations regardless of kind.
        // @implements {R011.§4.AC.05} cross-project decoration routing
        if (match.aliasPrefix) {
          const aliasEntry = this.index.getAlias(match.aliasPrefix);
          if (aliasEntry?.resolved) {
            crossProjectResolved.push({
              range,
              hoverMessage: new vscode.MarkdownString(
                `*Cross-project citation* \`${match.aliasPrefix}/${match.normalizedId}\` — peer at ${aliasEntry.resolvedPath}`,
              ),
            });
          } else {
            crossProjectUnresolved.push({
              range,
              hoverMessage: new vscode.MarkdownString(
                `*Cross-project citation* \`${match.aliasPrefix}\` — ${aliasEntry ? `unresolved (${aliasEntry.unresolvedReason ?? 'unknown'})` : 'alias not declared'}`,
              ),
            });
          }
          continue;
        }

        if (match.kind === 'section') {
          // Resolve qualified ({R005.§1}) and bare (§2 with file context)
          // section refs against the index. Unknown sections fall through
          // to the same wavy-underline treatment as unknown claims so the
          // user can tell them apart from valid-but-bare formatting.
          const sectionEntry = this.index.lookupSection(
            match.normalizedId,
            contextNoteId ?? undefined,
          );
          if (sectionEntry) {
            sections.push({ range });
          } else {
            // Qualified ids (e.g., E032.5.2 from binding) print as-is;
            // bare numeric ids print with leading § for the user-facing
            // form they wrote.
            const isQualified = /^[A-Z]/.test(match.normalizedId);
            const display = isQualified ? match.normalizedId : `§${match.normalizedId}`;
            // Distinguish two failure modes per {R012.§2.AC.13}: parent
            // note known but section heading unregistered vs. note unknown.
            let cause: string;
            if (isQualified) {
              const dotIdx = match.normalizedId.indexOf('.');
              const noteId = dotIdx > 0 ? match.normalizedId.slice(0, dotIdx) : match.normalizedId;
              const sectionPart = dotIdx > 0 ? match.normalizedId.slice(dotIdx + 1) : '';
              const noteInfo = this.index.lookupNote(noteId);
              cause = noteInfo
                ? `${noteId} is indexed but has no \`§${sectionPart}\` section heading registered`
                : `note \`${noteId}\` not indexed`;
            } else {
              cause = 'section not registered in the current document';
            }
            unresolvedList.push({
              range,
              hoverMessage: new vscode.MarkdownString(
                `*SCEpter section* \`${display}\` — ${cause}`,
              ),
            });
          }
          continue;
        }

        const isKnown = this.index.isKnown(match.normalizedId, contextNoteId ?? undefined, {
          selfScoped: match.selfScoped,
        });

        if (isKnown) {
          resolved.push({ range });
        } else {
          unresolvedList.push({
            range,
            hoverMessage: new vscode.MarkdownString(
              `*SCEpter reference* \`${match.normalizedId}\` — not found in index`
            ),
          });
        }
      }
    }

    if (isMarkdown && contextNoteId) {
      this.collectClaimBadges(doc, contextNoteId, claimBadges);
    }

    editor.setDecorations(resolvedDecoration, resolved);
    editor.setDecorations(unresolvedDecoration, unresolvedList);
    editor.setDecorations(sectionDecoration, sections);
    editor.setDecorations(crossProjectResolvedDecoration, crossProjectResolved);
    editor.setDecorations(crossProjectUnresolvedDecoration, crossProjectUnresolved);
    editor.setDecorations(tombstoneDecoration, tombstones);
    editor.setDecorations(claimBadgeDecoration, claimBadges);
  }

  // @implements {R012.§1.AC.02} badge displays total inbound count (sources + notes)
  // @implements {R012.§1.AC.03} badge color encodes source coverage (green for source, red for note-only)
  // @implements {R012.§1.AC.04} editor badge anchored on claim id range via `after`-decoration
  // @implements {R012.§1.AC.06} badge appears only on claim definition, not citations
  // @implements {R012.§1.AC.07} badge omitted when total === 0
  // @implements {R008.§1.AC.05} badges appear on folder-form companion files too,
  //   by scanning the open doc rather than trusting entry.line (which is the
  //   aggregated-stream line for folder notes)
  private collectClaimBadges(
    doc: vscode.TextDocument,
    contextNoteId: string,
    out: vscode.DecorationOptions[],
  ): void {
    // Index entries from this note keyed by their bare claim id ("TM.01").
    // For folder-form notes the entry.noteFilePath points at the parent
    // root file and entry.line is the line in the aggregated content
    // stream — neither maps cleanly back to a companion sub-file. We
    // instead walk the open doc and look up each definition we find.
    const candidatesByBareId = new Map<string, ClaimIndexEntry[]>();
    for (const entry of this.index.claimsForNote(contextNoteId)) {
      const padded = String(entry.claimNumber).padStart(2, '0');
      const bareId = `${entry.claimPrefix}.${padded}${entry.claimSubLetter ?? ''}`;
      const arr = candidatesByBareId.get(bareId) ?? [];
      arr.push(entry);
      candidatesByBareId.set(bareId, arr);
    }
    if (candidatesByBareId.size === 0) return;

    for (let lineIdx = 0; lineIdx < doc.lineCount; lineIdx++) {
      const lineText = doc.lineAt(lineIdx).text;
      const def = tryParseClaimDefinitionLine(lineText);
      if (!def) continue;
      const candidates = candidatesByBareId.get(def.bareId);
      if (!candidates || candidates.length === 0) continue;

      // Pick the entry whose sectionPath matches the line's inline
      // section path (if any). Without a section qualifier, fall back
      // to the unique candidate, or the first if multiple exist.
      let entry: ClaimIndexEntry | undefined;
      if (def.sectionPath) {
        entry = candidates.find(
          (c) => arrayEq(c.sectionPath, def.sectionPath!),
        );
      }
      if (!entry) entry = candidates[0];

      const refs = this.index.incomingRefs(entry.fullyQualified);
      const total = refs.length;
      if (total === 0) continue;

      const padded = String(entry.claimNumber).padStart(2, '0');
      const idStr = `${entry.claimPrefix}.${padded}${entry.claimSubLetter ?? ''}`;
      const idIdx = lineText.indexOf(idStr, def.idIdx);
      if (idIdx < 0) continue;
      const idEnd = idIdx + idStr.length;
      const range = new vscode.Range(lineIdx, idIdx, lineIdx, idEnd);

      const sourceRefs = refs.filter((r) => r.fromNoteId.startsWith('source:'));
      const hasSource = sourceRefs.length > 0;
      const dotColor = hasSource ? '#6CC04A' : '#F48771';

      out.push({
        range,
        renderOptions: {
          after: {
            contentText: `●${total}`,
            color: dotColor,
            fontWeight: 'bold',
            margin: '0 0 0 2px',
          },
        },
      });
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    resolvedDecoration.dispose();
    unresolvedDecoration.dispose();
    sectionDecoration.dispose();
    crossProjectResolvedDecoration.dispose();
    crossProjectUnresolvedDecoration.dispose();
    tombstoneDecoration.dispose();
    claimBadgeDecoration.dispose();
  }
}
