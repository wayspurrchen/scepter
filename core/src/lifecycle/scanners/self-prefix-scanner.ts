/**
 * Self-prefix scanner adapter for the rewriter engine.
 *
 * Emits `ReferenceSpan` records for self-prefixed claim definitions
 * inside the rename target's own file:
 *
 *   - `self-prefix-heading`: `### R005.LOCK.03 ...` or
 *     `#### R005.§3.LOCK.03 — ...`
 *   - `self-prefix-paragraph`: `**R005.§3.LOCK.03**: ...`
 *
 * Only emitted when scanning the renamed note's own file
 * (`expectedNoteId` provided AND the parsed self-prefix matches it).
 *
 * Under delete the file is removed entirely, so the scanner emits
 * NO spans for the deleted note's own file. This is enforced by the
 * orchestrator: scanners are only attached to files the orchestrator
 * intends to keep. The self-prefix scanner itself does not branch on
 * operation kind — it relies on the caller's discipline.
 *
 * @implements {DD020.§2.DC.14} self-prefix-heading and self-prefix-paragraph spans for renamed note's own file
 * @implements {DD020.§2.DC.15} under delete, no self-prefix spans for the deleted note's own file (caller discipline)
 */

import type { ReferenceSpan, ScannerAdapter } from '../rewriter';
import { buildSpanFromCandidate } from './markdown-body-scanner';

export interface SelfPrefixScannerOptions {
  /**
   * The note ID this file belongs to. Self-prefix spans are emitted
   * only when the parsed self-prefix in a claim definition matches
   * this value.
   */
  expectedNoteId: string;
}

/**
 * Build a self-prefix scanner closure.
 */
export function createSelfPrefixScanner(
  options: SelfPrefixScannerOptions,
): ScannerAdapter {
  return (filePath, content) =>
    scanSelfPrefixes(filePath, content, options);
}

/**
 * Scan content for self-prefixed claim definitions.
 *
 * Recognized shapes:
 *
 *   ### R005.LOCK.03 — heading form (heading level 1-6)
 *   ### R005.§3.LOCK.03 — heading with section
 *   **R005.LOCK.03** — bold-paragraph form
 *   **R005.§3.LOCK.03** — bold-paragraph with section
 *
 * Match anchors are line-leading for headings, bold-wrapper-leading
 * for paragraphs. Other occurrences of `<ID>.PREFIX.NN` in prose are
 * recognized by other scanners and are not "self-prefix" definitions.
 */
export function scanSelfPrefixes(
  filePath: string,
  content: string,
  options: SelfPrefixScannerOptions,
): ReferenceSpan[] {
  const { expectedNoteId } = options;
  if (!expectedNoteId) {
    return [];
  }
  const spans: ReferenceSpan[] = [];

  // Build the per-note ID regex. The body pattern matches:
  //   <ID>.<optional-§N path>.<PREFIX>.<NN>[<sub-letter>]
  //
  // We use a non-greedy section path and a strict claim suffix.
  const escapedId = expectedNoteId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const refBody = `${escapedId}(?:\\.§?\\d+(?:\\.\\d+)*)?\\.[A-Z]+\\.\\d{2,3}[a-z]?`;

  // Heading form: ^#+\s+<id-path>
  // The heading marker can be 1-6 `#`s; the claim can be followed by
  // trailing text (description). We only capture the address portion.
  const headingRe = new RegExp(`^(#{1,6})\\s+(${refBody})`, 'gm');
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(content)) !== null) {
    const hashes = m[1];
    const candidate = m[2];
    // candidateStart = start of line + `#`s + whitespace
    const hashStart = m.index;
    const candidateStart = hashStart + hashes.length;
    // Step past whitespace
    let ws = 0;
    while (
      candidateStart + ws < content.length &&
      content[candidateStart + ws] === ' '
    ) {
      ws++;
    }
    const span = buildSpanFromCandidate(
      filePath,
      content,
      candidate,
      candidateStart + ws,
      'self-prefix-heading',
    );
    if (span) {
      spans.push(span);
    }
  }

  // Bold-paragraph form: ^**<id-path>**
  const boldRe = new RegExp(`^\\*\\*(${refBody})\\*\\*`, 'gm');
  while ((m = boldRe.exec(content)) !== null) {
    const candidate = m[1];
    // candidateStart = start of line + `**`
    const candidateStart = m.index + 2;
    const span = buildSpanFromCandidate(
      filePath,
      content,
      candidate,
      candidateStart,
      'self-prefix-paragraph',
    );
    if (span) {
      spans.push(span);
    }
  }

  spans.sort((a, b) => a.byteRange[0] - b.byteRange[0]);
  return spans;
}
