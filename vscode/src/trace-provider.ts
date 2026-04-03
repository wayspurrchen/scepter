import * as vscode from 'vscode';
import { ClaimIndexCache, TraceResult } from './claim-index';
import { matchAtPosition } from './patterns';

/**
 * Registers the scepter.traceClaim command that shows the trace matrix
 * for the claim under the cursor.
 */
export function registerTraceCommand(
  context: vscode.ExtensionContext,
  index: ClaimIndexCache,
  outputChannel: vscode.OutputChannel
): void {
  const command = vscode.commands.registerCommand(
    'scepter.traceClaim',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      await index.waitUntilReady();

      // Try to get claim ID from selection first, then from cursor position
      let claimId: string | null = null;

      const selection = editor.selection;
      if (!selection.isEmpty) {
        claimId = editor.document.getText(selection).trim();
        // Strip braces if present
        if (claimId.startsWith('{') && claimId.endsWith('}')) {
          claimId = claimId.slice(1, -1);
        }
      } else {
        const line = editor.document.lineAt(selection.active.line).text;
        const match = matchAtPosition(line, selection.active.character, index.knownShortcodes);
        claimId = match?.normalizedId ?? null;
      }

      if (!claimId) {
        vscode.window.showWarningMessage(
          'No claim reference found at cursor position'
        );
        return;
      }

      // Verify it exists in the index
      const entry = index.lookup(claimId);
      if (!entry) {
        vscode.window.showWarningMessage(
          `Claim "${claimId}" not found in index`
        );
        return;
      }

      // Run trace
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Tracing ${claimId}...`,
          cancellable: false,
        },
        async () => index.trace(claimId!)
      );

      if (!result) {
        vscode.window.showErrorMessage(
          `Failed to trace claim "${claimId}". Check the output channel for details.`
        );
        return;
      }

      showTraceResult(result, outputChannel);
    }
  );

  context.subscriptions.push(command);
}

function showTraceResult(
  result: TraceResult,
  outputChannel: vscode.OutputChannel
): void {
  outputChannel.clear();
  outputChannel.show(true);

  const entry = result.entry;

  outputChannel.appendLine('═══════════════════════════════════════════════');
  outputChannel.appendLine(`  SCEpter Claim Trace: ${entry.fullyQualified}`);
  outputChannel.appendLine('═══════════════════════════════════════════════');
  outputChannel.appendLine('');

  // Claim details
  outputChannel.appendLine(`Type:     ${entry.noteType}`);
  outputChannel.appendLine(`Heading:  ${entry.heading}`);
  outputChannel.appendLine(`File:     ${entry.noteFilePath}:${entry.line}`);

  if (entry.importance !== undefined) {
    outputChannel.appendLine(`Importance: ${entry.importance}`);
  }
  if (entry.lifecycle) {
    outputChannel.appendLine(`Lifecycle:  ${entry.lifecycle.type}`);
  }
  if (entry.derivedFrom.length > 0) {
    outputChannel.appendLine(`Derives from: ${entry.derivedFrom.join(', ')}`);
  }

  outputChannel.appendLine('');

  // Incoming references
  if (result.incoming.length > 0) {
    outputChannel.appendLine(
      `── Incoming References (${result.incoming.length}) ──`
    );
    outputChannel.appendLine('');
    for (const ref of result.incoming) {
      const resolved = ref.unresolved ? ' [UNRESOLVED]' : '';
      outputChannel.appendLine(
        `  ${ref.fromClaim} → ${ref.toClaim}${resolved}`
      );
      outputChannel.appendLine(`    in ${ref.filePath}:${ref.line}`);
    }
    outputChannel.appendLine('');
  } else {
    outputChannel.appendLine('── No incoming references ──');
    outputChannel.appendLine('');
  }

  // Derivatives
  if (result.derivatives.length > 0) {
    outputChannel.appendLine(
      `── Derivatives (${result.derivatives.length}) ──`
    );
    outputChannel.appendLine('');
    for (const d of result.derivatives) {
      outputChannel.appendLine(`  → ${d}`);
    }
    outputChannel.appendLine('');
  }

  // Verification status
  if (result.verification) {
    outputChannel.appendLine('── Verification ──');
    outputChannel.appendLine('');
    outputChannel.appendLine(`  Status:  verified`);
    outputChannel.appendLine(`  By:      ${result.verification.actor}`);
    outputChannel.appendLine(`  Method:  ${result.verification.method}`);
    outputChannel.appendLine(`  Date:    ${result.verification.date}`);
  } else {
    outputChannel.appendLine('── Not verified ──');
  }

  outputChannel.appendLine('');
  outputChannel.appendLine('═══════════════════════════════════════════════');
}
