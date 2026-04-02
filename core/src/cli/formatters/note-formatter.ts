/**
 * @implements {T003} - Folder-based notes display with 📁 emoji and additional files listing
 */
import chalk from 'chalk';
import type { Note } from '../../types/note';

export interface NoteFormatOptions {
  showMetadata?: boolean;
  showContent?: boolean;
  showReferences?: boolean;
  showSource?: boolean;
  delimiter?: string;
  colorize?: boolean;
}

const DEFAULT_DELIMITER = '\n' + '─'.repeat(80) + '\n';

/**
 * Format a single note for display
 */
export function formatNote(note: Note, options: NoteFormatOptions = {}): string {
  const {
    showMetadata = true,
    showContent = true,
    showReferences = true,
    showSource = true,
    colorize = true,
  } = options;

  const lines: string[] = [];
  const c = colorize
    ? chalk
    : { cyan: (s: string) => s, gray: (s: string) => s, yellow: (s: string) => s, green: (s: string) => s };

  // Header - format as "ID - Title"
  // If the title already includes the ID prefix, don't duplicate it
  if (note.title.startsWith(`${note.id} -`)) {
    lines.push(c.cyan(note.title));
  } else {
    lines.push(c.cyan(`${note.id} - ${note.title}`));
  }
  lines.push('');

  // Metadata
  if (showMetadata) {
    // Add folder indicator if this is a folder-based note
    if (note.isFolder) {
      lines.push(c.yellow('📁 This is a folder-based note'));
      if (note.folderPath) {
        lines.push(`${c.gray('Folder:')} ${c.green(note.folderPath)}`);
      }

      // Show additional files if present
      if (note.additionalFiles && note.additionalFiles.length > 0) {
        lines.push('');
        lines.push(c.gray('Additional context files:'));
        for (const file of note.additionalFiles) {
          lines.push(`  ${c.gray('-')} ${file.path} (${file.type})`);
        }
      }

      // Add LLM hint
      lines.push('');
      lines.push(c.gray('For LLMs: Read additional files in the folder for complete context.'));
      lines.push('');
    }

    lines.push(`${c.gray('Type:')} ${c.yellow(note.type)}`);

    // Show the file path if available
    if (note.filePath) {
      lines.push(`${c.gray('File:')} ${c.green(note.filePath)}`);
    }

    if (note.tags.length > 0) {
      lines.push(`${c.gray('Tags:')} ${note.tags.join(', ')}`);
    }

    lines.push(`${c.gray('Created:')} ${note.created.toISOString()}`);

    if (note.modified) {
      lines.push(`${c.gray('Modified:')} ${note.modified.toISOString()}`);
    }

    if (showSource && note.source) {
      lines.push(`${c.gray('Source:')} ${note.source.path}:${note.source.line}`);
    }

    lines.push('');
  }

  // References - removed from here as they're shown in the reference tree

  // Content
  // @implements {DD008.§2.DC.08} Syntax highlighting for note/claim references and annotations
  // @implements {DD008.§2.DC.09} Highlighting disabled when colorize is false (--no-format, JSON)
  if (showContent && note.content) {
    lines.push(c.gray('Content:'));
    lines.push('');
    if (colorize) {
      lines.push(highlightContent(note.content));
    } else {
      lines.push(note.content);
    }
  }

  return lines.join('\n');
}

/**
 * Apply syntax highlighting to note content.
 *
 * Highlights:
 * - {NOTEID} references (e.g., {R005}, {DD007}) -> cyan
 * - {NOTEID.section.PREFIX.NN} claim references -> cyan
 * - Bare NOTEID.section.PREFIX.NN without braces -> cyan
 * - @implements, @depends-on, @validates, @see, @addresses, @blocked-by -> green
 *
 * Uses a single regex pass per line for efficiency.
 *
 * @implements {DD008.§2.DC.08}
 * @implements {DD008.§2.DC.10} Single regex pass per line
 */
function highlightContent(content: string): string {
  // Combined pattern matching all highlight targets in a single pass:
  //   1. Braced note/claim references: {R005}, {DD007.§1.DC.03}
  //   2. Fully-qualified bare claims: R005.§1.AC.03, DD007.1.DC.01
  //   3. Bare §-prefixed claims/sections: §DC.01, §1.DC.01, §1, §3.1
  //   4. @keyword annotations
  const highlightPattern = new RegExp(
    // Group 1: Braced references {R005}, {DD007.§1.DC.03}, {A001.§2.AC.01,.AC.02}
    '(\\{[A-Z]{1,5}\\d{1,5}(?:\\.[^}]*)?\\})' +
    // Group 2: Fully-qualified bare claims: R005.§1.AC.03, DD007.1.DC.01
    '|(?<![A-Za-z0-9{])([A-Z]{1,5}\\d{3,5}\\.§?\\d+(?:\\.\\d+)*\\.§?[A-Z]+\\.\\d{2,3}[a-z]?)(?![A-Za-z0-9}])' +
    // Group 3: Bare §-prefixed: §DC.01, §1.DC.01, §1, §3.1
    '|(?<![A-Za-z0-9])(§\\d+(?:\\.\\d+)*(?:\\.[A-Z]+\\.\\d{2,3}[a-z]?)?|§[A-Z]+\\.\\d{2,3}[a-z]?)(?![A-Za-z0-9])' +
    // Group 4: Bare note IDs: DD007, R005, A001 (1-5 uppercase + 3-5 digits, not in braces)
    '|(?<![A-Za-z0-9{])([A-Z]{1,5}\\d{3,5})(?![A-Za-z0-9.}])' +
    // Group 5: @keyword annotations
    '|(@(?:implements|depends-on|validates|see|addresses|blocked-by))\\b',
    'g',
  );

  const lines = content.split('\n');
  const highlighted = lines.map(line => {
    return line.replace(highlightPattern, (match, braced, bare, section, noteId, keyword) => {
      if (braced) return chalk.cyan(braced);
      if (bare) return chalk.cyan(bare);
      if (section) return chalk.cyan(section);
      if (noteId) return chalk.cyan(noteId);
      if (keyword) return chalk.green(keyword);
      return match;
    });
  });

  return highlighted.join('\n');
}

/**
 * Format multiple notes with delimiters
 */
export function formatNotes(notes: Note[], options: NoteFormatOptions = {}): string {
  const delimiter = options.delimiter || DEFAULT_DELIMITER;

  return notes.map((note) => formatNote(note, options)).join(delimiter);
}

/**
 * Format notes as JSON
 */
export function formatNotesAsJson(notes: Note[], pretty: boolean = true): string {
  return JSON.stringify(notes, null, pretty ? 2 : 0);
}

/**
 * Format notes for LLM context
 */
export function formatNotesForLLM(notes: Note[], options: { maxTokens?: number } = {}): string {
  const lines: string[] = [];

  // Header
  lines.push('# Context Notes');
  lines.push('');

  // Group by type
  const notesByType = new Map<string, Note[]>();
  for (const note of notes) {
    const typeNotes = notesByType.get(note.type) || [];
    typeNotes.push(note);
    notesByType.set(note.type, typeNotes);
  }

  // Format each type group
  for (const [type, typeNotes] of notesByType) {
    lines.push(`## ${type}s`);
    lines.push('');

    for (const note of typeNotes) {
      const typeDisplay = note.type.charAt(0).toUpperCase() + note.type.slice(1);
      lines.push(`### ${typeDisplay} - ${note.id}: ${note.title}`);

      if (note.tags.length > 0) {
        lines.push(`Tags: ${note.tags.join(', ')}`);
      }

      lines.push('');
      lines.push(note.content);
      lines.push('');
    }
  }

  const result = lines.join('\n');

  // TODO: Implement token counting and truncation
  // For now, just return the full result
  return result;
}

/**
 * Format note statistics
 */
export function formatNoteStats(notes: Note[]): string {
  const stats = {
    total: notes.length,
    byType: new Map<string, number>(),
    byTag: new Map<string, number>(),
    withReferences: 0,
    orphaned: 0,
    recentlyModified: 0,
  };

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  for (const note of notes) {
    // Count by type
    stats.byType.set(note.type, (stats.byType.get(note.type) || 0) + 1);

    // Count by tag
    for (const tag of note.tags) {
      stats.byTag.set(tag, (stats.byTag.get(tag) || 0) + 1);
    }

    // Count references
    const hasRefs = (note.references?.incoming?.length || 0) > 0 || (note.references?.outgoing?.length || 0) > 0;
    if (hasRefs) {
      stats.withReferences++;
    } else {
      stats.orphaned++;
    }

    // Count recently modified
    if (note.modified && note.modified > oneWeekAgo) {
      stats.recentlyModified++;
    }
  }

  const lines: string[] = [];
  lines.push(chalk.bold('Note Statistics'));
  lines.push('');
  lines.push(`Total notes: ${chalk.cyan(stats.total)}`);
  lines.push(`With references: ${chalk.green(stats.withReferences)}`);
  lines.push(`Orphaned: ${chalk.yellow(stats.orphaned)}`);
  lines.push(`Recently modified: ${chalk.blue(stats.recentlyModified)}`);
  lines.push('');

  lines.push(chalk.bold('By Type:'));
  for (const [type, count] of stats.byType) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push('');

  if (stats.byTag.size > 0) {
    lines.push(chalk.bold('By Tag:'));
    const sortedTags = Array.from(stats.byTag.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [tag, count] of sortedTags) {
      lines.push(`  ${tag}: ${count}`);
    }

    if (stats.byTag.size > 10) {
      lines.push(`  ... and ${stats.byTag.size - 10} more tags`);
    }
  }

  return lines.join('\n');
}
