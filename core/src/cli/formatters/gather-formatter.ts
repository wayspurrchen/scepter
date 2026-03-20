/**
 * @implements {T003} - Folder content formatting with smart defaults
 */
import chalk from 'chalk';
import type { Note } from '../../types/note';
import type { GatheredNote } from '../../types/context';
import { formatTree } from './tree-formatter';
import { extractExcerpt } from './excerpt-extractor';
import type { FolderContentInfo } from '../commands/context/gather-handler';

export interface GatherFormatOptions {
  includeTree?: boolean;
  excerptLength?: number;
  includeContent?: boolean;
  maxChars?: number;
  folderInfo?: FolderContentInfo; // Information about folder contents
}

/**
 * Format gathered notes for display
 */
export function formatGatheredNotes(origin: Note, gathered: GatheredNote[], options: GatherFormatOptions = {}): string {
  const { includeTree = false, excerptLength = 100, includeContent = false, maxChars, folderInfo } = options;

  // Apply character limit if specified
  let notesToDisplay = gathered;
  let truncated = false;
  if (maxChars) {
    let charCount = 0;
    const included: GatheredNote[] = [];

    // Always include origin
    charCount += origin.content?.length || 0;

    for (const note of gathered) {
      // Handle both Note and ExtendedNote - current implementation returns Note
      const noteObj = note.note;
      const content: string = 'content' in noteObj ? (noteObj as any).content : (noteObj as any).mergedContent || '';
      const noteChars = content.length;
      if (charCount + noteChars <= maxChars) {
        included.push(note);
        charCount += noteChars;
      } else {
        truncated = true;
        break;
      }
    }
    notesToDisplay = included;
  }

  // Always use markdown format
  return formatAsMarkdown(origin, notesToDisplay, includeTree, excerptLength, includeContent, truncated, folderInfo);
}

/**
 * Format as structured markdown (default)
 */
function formatAsMarkdown(
  origin: Note,
  gathered: GatheredNote[],
  includeTree: boolean,
  excerptLength: number,
  includeContent: boolean,
  truncated: boolean,
  folderInfo?: FolderContentInfo,
): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.bold(`# Context for ${origin.id}: ${origin.title}`));
  lines.push('');
  lines.push(`Origin: ${chalk.cyan(origin.id)} - ${origin.title} [${origin.mode || origin.type}]`);
  if (origin.filePath) {
    lines.push(`File: ${chalk.green(origin.filePath)}`);
  }
  lines.push(`Gathered: ${gathered.length} notes`);
  lines.push('');

  // Legend
  const noteTypes = new Set<string>();
  gathered.forEach((g) => noteTypes.add(g.note.type));
  const legend = generateLegend(Array.from(noteTypes));
  lines.push(legend);
  lines.push('');

  // Origin Note Content
  if (origin.content) {
    lines.push(chalk.bold('## Origin Note'));
    lines.push('');
    lines.push(origin.content);
    lines.push('');
  }

  // Folder Contents Section (if origin is folder-based)
  if (folderInfo) {
    lines.push(chalk.bold('## 📁 Folder Contents'));
    lines.push('');

    if (!folderInfo.contents) {
      // Default behavior: Show summary only
      lines.push(chalk.yellow(`This note has ${folderInfo.fileCount} additional files (${folderInfo.totalCharacters.toLocaleString()} characters total).`));
      lines.push('');
      lines.push('Files:');
      folderInfo.files.forEach(file => {
        const sizeStr = file.type === 'text'
          ? `${file.size.toLocaleString()} chars`
          : file.type === 'binary' || file.type === 'image'
          ? `${(file.size / 1024).toFixed(1)}KB`
          : `${file.size} bytes`;
        lines.push(`  - ${chalk.cyan(file.path)} (${sizeStr})`);
      });
      lines.push('');
      lines.push(chalk.gray('💡 Recommendation: Review these files if they\'re relevant to your task.'));
      lines.push(chalk.gray('Use --include-folder-contents flag to include their contents in the gather output.'));
      lines.push('');
    } else {
      // Opt-in behavior: Show actual contents
      lines.push(chalk.green(`Including contents of ${folderInfo.contents.length} files:`));
      lines.push('');

      folderInfo.contents.forEach(file => {
        lines.push(chalk.bold(`=== ${file.path} ===`));
        lines.push('');
        lines.push(file.content);
        if (file.truncated) {
          lines.push(chalk.yellow('[File truncated due to size]'));
        }
        lines.push('');
      });

      // List any files that weren't included
      const includedPaths = new Set(folderInfo.contents.map(f => f.path));
      const skippedFiles = folderInfo.files.filter(f => !includedPaths.has(f.path));
      if (skippedFiles.length > 0) {
        lines.push(chalk.yellow(`⚠️  ${skippedFiles.length} files not included:`));
        skippedFiles.forEach(file => {
          const reason = file.type === 'binary' || file.type === 'image'
            ? `(${file.type} file, ${(file.size / 1024).toFixed(1)}KB)`
            : `(${file.size > 100 * 1024 ? 'too large' : 'skipped'})`;
          lines.push(`  - ${file.path} ${reason}`);
        });
        lines.push('');
      }
    }
  }

  // Separate by discovery source
  const directRefs = gathered.filter((g) => g.discovery.source === 'reference' && g.depth <= 1);
  const indirectRefs = gathered.filter((g) => g.discovery.source === 'reference' && g.depth > 1);
  const patterns = gathered.filter((g) => g.discovery.source === 'pattern');
  const tags = gathered.filter((g) => g.discovery.source === 'tag');

  // Direct References
  if (directRefs.length > 0) {
    lines.push(chalk.bold('## Direct References'));
    lines.push('');

    // Group by direction
    const outgoing = directRefs.filter((g) => g.discovery.direction === 'outgoing');
    const incoming = directRefs.filter((g) => g.discovery.direction === 'incoming');
    const bidirectional = directRefs.filter((g) => g.discovery.direction === 'bidirectional');

    if (outgoing.length > 0) {
      lines.push(chalk.gray('### Outgoing (this note references)'));
      lines.push('');
      outgoing.forEach((g) => {
        lines.push(formatNoteEntry(extendedNoteToNote(g.note), excerptLength, includeContent));
        lines.push('');
      });
    }

    if (incoming.length > 0) {
      lines.push(chalk.gray('### Incoming (referenced by)'));
      lines.push('');
      incoming.forEach((g) => {
        lines.push(formatNoteEntry(extendedNoteToNote(g.note), excerptLength, includeContent));
        lines.push('');
      });
    }

    if (bidirectional.length > 0) {
      lines.push(chalk.gray('### Bidirectional (mutual references)'));
      lines.push('');
      bidirectional.forEach((g) => {
        lines.push(formatNoteEntry(extendedNoteToNote(g.note), excerptLength, includeContent));
        lines.push('');
      });
    }
  }

  // Indirect References
  if (indirectRefs.length > 0) {
    lines.push(chalk.bold('## Indirect References'));
    lines.push('');

    // Group by depth
    const byDepth = new Map<number, GatheredNote[]>();
    indirectRefs.forEach((g) => {
      const depth = g.depth;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth)!.push(g);
    });

    // Sort depths and display
    const depths = Array.from(byDepth.keys()).sort();
    depths.forEach((depth) => {
      if (depths.length > 1) {
        lines.push(chalk.gray(`### Depth ${depth}`));
        lines.push('');
      }
      byDepth.get(depth)!.forEach((g) => {
        lines.push(formatNoteEntry(extendedNoteToNote(g.note), excerptLength, includeContent));
        lines.push('');
      });
    });
  }

  // Source references are now included in the incoming/outgoing sections above

  // Context Hints
  if (patterns.length > 0 || tags.length > 0) {
    lines.push(chalk.bold('## Context Hints'));
    lines.push('');

    if (patterns.length > 0) {
      lines.push(chalk.gray('### Pattern Matches'));
      lines.push('');
      patterns.forEach((g) => {
        lines.push(formatNoteEntry(extendedNoteToNote(g.note), excerptLength, includeContent));
        lines.push('');
      });
    }

    if (tags.length > 0) {
      lines.push(chalk.gray('### Tag Matches'));
      lines.push('');
      tags.forEach((g) => {
        lines.push(formatNoteEntry(extendedNoteToNote(g.note), excerptLength, includeContent));
        lines.push('');
      });
    }
  }

  // Summary
  lines.push(chalk.bold('## Summary'));
  lines.push('');
  const refCount = directRefs.length + indirectRefs.length;
  const sourceCount = directRefs.filter(g => g.note.type === 'source-reference').length;
  const hintCount = patterns.length + tags.length;

  // Count reference directions
  const outgoingCount = directRefs.filter((g) => g.discovery.direction === 'outgoing').length;
  const incomingCount = directRefs.filter((g) => g.discovery.direction === 'incoming').length;
  const bidirectionalCount = directRefs.filter((g) => g.discovery.direction === 'bidirectional').length;

  const refDetails = [];
  if (outgoingCount > 0) refDetails.push(`${outgoingCount} outgoing`);
  if (incomingCount > 0) refDetails.push(`${incomingCount} incoming`);
  if (bidirectionalCount > 0) refDetails.push(`${bidirectionalCount} bidirectional`);

  const refSummary = refDetails.length > 0 ? ` (${refDetails.join(', ')})` : '';

  const summaryParts = [];
  if (refCount > 0) summaryParts.push(`${refCount} references${refSummary}`);
  if (sourceCount > 0) summaryParts.push(`${sourceCount} source code references`);
  if (hintCount > 0) summaryParts.push(`${hintCount} context hints`);

  lines.push(`Total: ${gathered.length} notes (${summaryParts.join(', ')})`);

  if (truncated) {
    lines.push(chalk.yellow('Note: Output truncated due to character limit'));
  }

  // Tree view if requested
  if (includeTree) {
    lines.push('');
    lines.push(chalk.bold('## Reference Tree'));
    lines.push('');
    lines.push(formatAsTree(origin, gathered));
  }

  return lines.join('\n');
}

/**
 * Format a single note entry
 */
/**
 * Convert ExtendedNote to Note format for display
 */
function extendedNoteToNote(note: any): Note {
  // If it's already a Note (has content property), return as-is
  if ('content' in note && 'title' in note && 'tags' in note) {
    return note as Note;
  }
  
  // Otherwise, construct a Note from ExtendedNote
  // This is a temporary solution until ExtendedNote is properly implemented
  return {
    id: note.id,
    type: note.type,
    title: note.id, // ExtendedNote doesn't have title, use ID as fallback
    content: note.mergedContent || note.originalContent || '',
    tags: note.mergedTags || note.originalTags || [],
    created: note.created,
    modified: note.modified,
    filePath: note.filePath,
    contextHints: note.contextHints,
    metadata: note.metadata,
  } as Note;
}

function formatNoteEntry(note: Note, excerptLength: number, includeContent: boolean = false): string {
  const parts: string[] = [];

  // Note header with metadata
  // For source references, prepend "Source:" to the title with blue color
  const displayTitle = note.type === 'source-reference' ? `${chalk.blue('Source:')} ${note.title}` : note.title;
  // For source references, don't show the ID (it contains the full path with source: prefix)
  const header = note.type === 'source-reference' 
    ? [displayTitle]
    : [chalk.cyan(note.id), '-', displayTitle];

  // Tags
  if (note.tags.length > 0) {
    header.push(chalk.gray(`[${note.tags.join(', ')}]`));
  }

  // Reference counts - omit for source references
  if (note.type !== 'source-reference') {
    const incoming = note.references?.incoming?.length || 0;
    const outgoing = note.references?.outgoing?.length || 0;
    header.push(chalk.blue(`(${incoming}/${outgoing})`));
  }

  // Character count
  // For source references, use file size from metadata if available
  let charCount = note.content?.length || 0;
  if (note.type === 'source-reference' && note.metadata?.fileSize !== undefined) {
    charCount = note.metadata.fileSize as number;
  }
  header.push(chalk.green(formatCharCount(charCount)));

  parts.push(header.join(' '));

  // Content or excerpt
  if (note.content) {
    if (includeContent) {
      // Include full content with proper indentation
      parts.push('');
      const contentLines = note.content.split('\n');
      contentLines.forEach((line) => {
        parts.push('  ' + line);
      });
    } else {
      // Show excerpt only
      const excerpt = extractExcerpt(note.content, excerptLength);
      parts.push(chalk.gray(`"${excerpt}"`));
    }
  }

  return parts.join('\n');
}

/**
 * Format as tree view using the extended tree formatter
 */
function formatAsTree(origin: Note, gathered: GatheredNote[]): string {
  // Build a map of all notes
  const allNotes = new Map<string, Note>();
  allNotes.set(origin.id, origin);

  // Add gathered notes and mark their discovery source
  gathered.forEach((g) => {
    // Convert to Note format and add discovery source
    const note = extendedNoteToNote(g.note);
    const noteWithDiscovery = {
      ...note,
      _discoverySource: g.discovery.source,
    };
    allNotes.set(g.note.id, noteWithDiscovery);
  });

  // Use the extended tree formatter
  return formatTree([origin], allNotes, {
    maxDepth: 2,
    showDetails: false,
    showReferences: false, // We show inline ref counts instead
    includeExcerpt: false,
    showType: false, // We already show type in brackets in the main view
    showInlineTags: false, // Tags shown in main view
    showInlineRefCounts: true,
    showCharCount: false, // Char count shown in main view
    showDiscoverySource: false, // Don't show discovery source, show actual relationships
    showDirectionalArrows: true, // Show bidirectional arrows like list command
    showIncoming: true,
    showOutgoing: true,
    showAlreadyExpanded: false, // Not needed for gather view
    includeLegend: true,
    includeStats: true,
  });
}

/**
 * Generate note type legend with colored formatting
 */
function generateLegend(types: string[]): string {
  const configuredTypes: Record<string, string> = {
    Decision: 'D',
    Requirement: 'R',
    Component: 'C',
    Question: 'Q',
    Milestone: 'M',
    Task: 'T',
    TODO: 'T',
    Assumption: 'A',
  };

  const legendParts = types
    .filter((type) => configuredTypes[type])
    .map((type) => {
      const shortcode = configuredTypes[type];
      const fullName = type;

      // Check if shortcode is single character and matches first letter
      if (shortcode.length === 1 && fullName[0] === shortcode) {
        // Highlight both the shortcode and first letter of full name
        return chalk.cyan(shortcode) + chalk.gray('=') + chalk.cyan(fullName[0]) + chalk.gray(fullName.slice(1));
      } else {
        // Only highlight the shortcode
        return chalk.cyan(shortcode) + chalk.gray('=') + chalk.gray(fullName);
      }
    });

  return chalk.white('Legend: ') + legendParts.join(chalk.gray(', '));
}

/**
 * Format character count with units
 */
function formatCharCount(count: number): string {
  if (count < 1000) {
    return `(${count} chars)`;
  } else if (count < 1000000) {
    const k = count / 1000;
    return `(${k.toFixed(1)}k chars)`;
  } else {
    const m = count / 1000000;
    return `(${m.toFixed(1)}m chars)`;
  }
}
