/**
 * Shared preamble printer for claim-targeted CLI commands.
 *
 * Commands like `meta get`, `meta log`, `verify`, and the `meta` write
 * subcommands resolve a claim and operate on it. Showing the canonical
 * claim ID, parent note title, and a short preview of the claim text
 * gives the user enough context to confirm "yes, that's the claim I
 * meant" before the command's main output.
 *
 * The preview pulls from the claim's actual body content (lines between
 * `entry.line + 1` and `entry.endLine`), with a fallback to the heading
 * itself for single-line inline claims (e.g., AC paragraphs whose entire
 * content is the heading line).
 *
 * The preamble is suppressed when `--json` is set so machine-readable
 * output stays clean.
 */

import * as fs from 'fs/promises';
import chalk from 'chalk';
import type { ClaimIndexEntry } from '../../../claims/index.js';
import type { Note } from '../../../types/note.js';
import type { NoteManager } from '../../../notes/note-manager.js';
import { extractTitle, truncateString } from '../../formatters/claim-formatter.js';

/** Maximum length for the claim-text preview before ellipsis. */
const PREVIEW_MAX_CHARS = 500;

/**
 * Resolve the parent note for a claim. Returns null if the note can't
 * be loaded (e.g., entry references a note that was just deleted).
 */
export async function getClaimNote(
  noteId: string,
  noteManager: NoteManager,
): Promise<Note | null> {
  try {
    return await noteManager.getNoteById(noteId);
  } catch {
    return null;
  }
}

/**
 * Strip Markdown noise from a body fragment so it renders as a readable
 * preview line. Removes bold/italic markers, code-fence backticks, and
 * common heading/list prefixes; collapses interior whitespace.
 */
function flattenMarkdown(raw: string): string {
  return raw
    .replace(/```[a-zA-Z0-9_-]*\n/g, '')      // strip code-fence open lines (```, ```ts, etc.)
    .replace(/```/g, '')                      // strip remaining code-fence markers
    .replace(/^#{1,6}\s+/gm, '')              // strip heading markers
    .replace(/^\s*[-*]\s+/gm, '')             // strip list bullets
    .replace(/\*\*/g, '')                     // strip bold
    .replace(/(?<!\\)`([^`]+)`/g, '$1')       // unwrap inline code
    .replace(/\s+/g, ' ')                     // collapse whitespace/newlines
    .trim();
}

/**
 * Extract the claim's body content from the source file. For heading-style
 * claims (OQs, sections) this returns the prose between the heading and
 * the next claim. For single-line inline claims (most ACs/DCs whose body
 * IS the heading line), returns null and the caller falls back to the
 * heading text itself.
 *
 * Reads `entry.noteFilePath` directly because the claim-index line numbers
 * are computed against the raw file (frontmatter included), but
 * `note.content` from the NoteManager is the post-frontmatter body — the
 * indices wouldn't match. Going through the filesystem keeps the offset
 * authoritative.
 */
async function extractClaimBody(entry: ClaimIndexEntry): Promise<string | null> {
  // Lines in the index are 1-indexed; arrays are 0-indexed.
  const startIdx = entry.line; // first line AFTER the heading (entry.line is the heading)
  const endIdx = entry.endLine; // exclusive boundary (next claim's heading line)
  if (endIdx <= startIdx) return null;
  let raw: string;
  try {
    raw = await fs.readFile(entry.noteFilePath, 'utf-8');
  } catch {
    return null;
  }
  const lines = raw.split('\n');
  const bodyLines = lines.slice(startIdx, Math.min(endIdx, lines.length));
  const flat = flattenMarkdown(bodyLines.join('\n'));
  return flat.length > 0 ? flat : null;
}

/**
 * Format the two-line preamble for a claim and print it to stdout.
 *
 * Output shape:
 *   <fully-qualified claim ID> · <note title>
 *   > <claim text preview>
 *   <blank line>
 *
 * The preview prefers the claim's body content (multi-line prose for OQs,
 * sections, etc.) and falls back to the heading text for single-line
 * inline claims. If neither yields meaningful text, the preview line is
 * suppressed.
 */
export async function printClaimPreamble(
  entry: ClaimIndexEntry,
  note: Note | null,
): Promise<void> {
  const idPart = chalk.cyan.bold(entry.fullyQualified);
  const titlePart = note?.title ? chalk.gray(` · ${note.title}`) : '';
  console.log(`${idPart}${titlePart}`);

  // Prefer body content when the claim has prose below the heading.
  const body = await extractClaimBody(entry);
  let preview = body;
  if (!preview) {
    // Fall back to the heading itself (single-line inline claims like ACs).
    const headingPreview = extractTitle(entry.heading).trim();
    if (headingPreview.length > 0 && headingPreview !== entry.heading) {
      preview = headingPreview;
    }
  }
  if (preview) {
    const truncated = truncateString(preview, PREVIEW_MAX_CHARS);
    console.log(chalk.dim(`> ${truncated}`));
  }

  console.log('');
}

/**
 * Convenience wrapper: resolve the parent note and print the preamble.
 * Skips printing when `json` is true.
 */
export async function emitClaimPreamble(
  entry: ClaimIndexEntry,
  noteManager: NoteManager,
  options?: { json?: boolean },
): Promise<void> {
  if (options?.json) return;
  const note = await getClaimNote(entry.noteId, noteManager);
  await printClaimPreamble(entry, note);
}
