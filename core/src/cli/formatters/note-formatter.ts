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
  if (showContent && note.content) {
    lines.push(c.gray('Content:'));
    lines.push('');
    lines.push(note.content);
  }

  return lines.join('\n');
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
