import * as vscode from 'vscode';
import { DELETION_MARKER_RE } from 'scepter';
import type { ClaimIndexCache, ClaimTreeError } from './claim-index';

/**
 * Severity per ClaimTreeError.type.
 *
 * Hard violations of the syntax (forbidden forms, duplicates, structurally
 * broken references to removed/missing claims) are Errors. Softer issues —
 * unresolved references that may resolve once another note is authored,
 * monotonicity gaps, ambiguity — are Warnings so they stay visible without
 * blocking workflows.
 */
/**
 * Severity per ClaimTreeError.type.
 *
 * Cross-project errors (alias-unknown, peer-unresolved, peer-target-not-found,
 * cross-project-derives, cross-project-superseded) are Errors per
 * R011.§4.AC.06.
 *
 * @implements {R011.§4.AC.06} cross-project diagnostic severities
 * @implements {DD015.§1.DC.09} severity routing for `cross-project-derives` / `cross-project-superseded`
 */
const SEVERITY_BY_TYPE: Record<ClaimTreeError['type'], vscode.DiagnosticSeverity> = {
  'forbidden-form': vscode.DiagnosticSeverity.Error,
  'duplicate': vscode.DiagnosticSeverity.Error,
  'invalid-supersession-target': vscode.DiagnosticSeverity.Error,
  'unresolvable-derivation-target': vscode.DiagnosticSeverity.Error,
  'reference-to-removed': vscode.DiagnosticSeverity.Error,
  'multiple-lifecycle': vscode.DiagnosticSeverity.Error,
  'cross-project-derives': vscode.DiagnosticSeverity.Error,
  'cross-project-superseded': vscode.DiagnosticSeverity.Error,
  'alias-unknown': vscode.DiagnosticSeverity.Error,
  'peer-unresolved': vscode.DiagnosticSeverity.Warning,
  'peer-target-not-found': vscode.DiagnosticSeverity.Warning,
  'non-monotonic': vscode.DiagnosticSeverity.Warning,
  'ambiguous': vscode.DiagnosticSeverity.Warning,
  'unresolved-reference': vscode.DiagnosticSeverity.Warning,
  // ---- New resolver-emitted codes per {DD021.§10.DC.02} ----
  // @implements {DD021.§10.DC.09} severity mapping for new taxonomy codes (C.13b per Q25)
  'reference-to-unknown-note': vscode.DiagnosticSeverity.Error,
  'reference-to-undefined-claim': vscode.DiagnosticSeverity.Error,
  // @implements {R015.§1.AC.04b} archived-citation is a soft signal (warning)
  'reference-to-archived': vscode.DiagnosticSeverity.Warning,
  'malformed-claim-reference': vscode.DiagnosticSeverity.Error,
  'derivation-target-bare-note-id': vscode.DiagnosticSeverity.Error,
  'derivation-target-cross-project': vscode.DiagnosticSeverity.Error,
  // Lifecycle decoration codes are warnings (parallel today's derivation-from-* codes)
  'derivation-target-removed': vscode.DiagnosticSeverity.Warning,
  'derivation-target-superseded': vscode.DiagnosticSeverity.Warning,
  'derivation-target-ambiguous': vscode.DiagnosticSeverity.Error,
};

export class DiagnosticsProvider {
  private collection = vscode.languages.createDiagnosticCollection('scepter');
  private disposables: vscode.Disposable[] = [];

  constructor(private index: ClaimIndexCache) {}

  activate(context: vscode.ExtensionContext): void {
    this.rebuild();
    this.disposables.push(this.index.onDidRefresh(() => this.rebuild()));
    context.subscriptions.push({ dispose: () => this.dispose() });
  }

  private rebuild(): void {
    this.collection.clear();

    const errors = this.index.getErrors();
    if (errors.length === 0) return;

    const byUri = new Map<string, vscode.Diagnostic[]>();

    for (const err of errors) {
      // Errors without a noteFilePath cannot be located on disk; skip them
      // rather than dumping into a synthetic untitled buffer.
      if (!err.noteFilePath) continue;

      // Tombstoned references are a recognized lifecycle state, not a
      // broken reference. Core suppresses `unresolved-reference` for
      // tombstoned `derives=`/`superseded=` targets at the index level
      // (claim-index.ts § Phase 1.5/1.6), and the marker's leading
      // underscore disqualifies it from `parseClaimReferences`, so a
      // tombstoned token cannot become an unresolved-reference error
      // via the body-scan path either. This filter is a defensive
      // belt-and-suspenders short-circuit: any error whose claimId or
      // message embeds a deletion-marker token is dropped at the
      // diagnostic surface.
      // @implements {R015.§11.AC.01} unresolved-reference diagnostic MUST NOT fire on tombstoned refs
      // @implements {DD020.§6.DC.01} short-circuit when parsed note-ID portion satisfies isDeletionMarker
      if (
        err.type === 'unresolved-reference' &&
        (DELETION_MARKER_RE.test(err.claimId ?? '') || DELETION_MARKER_RE.test(err.message ?? ''))
      ) {
        continue;
      }

      const absPath = this.index.resolveFilePath(err.noteFilePath);
      const line = Math.max(0, (err.line ?? 1) - 1);
      const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

      const severity = SEVERITY_BY_TYPE[err.type] ?? vscode.DiagnosticSeverity.Warning;
      const diagnostic = new vscode.Diagnostic(range, err.message, severity);
      diagnostic.source = 'scepter';
      diagnostic.code = err.type;

      if (err.conflictingLines?.length) {
        const uri = vscode.Uri.file(absPath);
        diagnostic.relatedInformation = err.conflictingLines.map((conflictLine) => {
          const conflictRange = new vscode.Range(
            Math.max(0, conflictLine - 1), 0,
            Math.max(0, conflictLine - 1), Number.MAX_SAFE_INTEGER,
          );
          return new vscode.DiagnosticRelatedInformation(
            new vscode.Location(uri, conflictRange),
            `Conflicting definition on line ${conflictLine}`,
          );
        });
      }

      const list = byUri.get(absPath) ?? [];
      list.push(diagnostic);
      byUri.set(absPath, list);
    }

    for (const [absPath, diagnostics] of byUri) {
      this.collection.set(vscode.Uri.file(absPath), diagnostics);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.collection.dispose();
  }
}
