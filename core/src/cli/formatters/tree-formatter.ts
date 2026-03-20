import chalk from 'chalk';
import type { Note } from '../../types/note';

export interface TreeNode {
  note: Note;
  children: TreeNode[];
  visited?: boolean;
  depth?: number;
}

export interface TreeOptions {
  maxDepth?: number;
  showDetails?: boolean;
  showReferences?: boolean;
  includeExcerpt?: boolean;
  indentSize?: number;

  // New options for gather command
  showType?: boolean; // Show note type in brackets (default: true)
  showInlineTags?: boolean; // Show tags inline instead of in details
  showInlineRefCounts?: boolean; // Show reference counts inline
  showCharCount?: boolean; // Show character count of content
  showDiscoverySource?: boolean; // Show how the note was discovered (for gather command)
  includeLegend?: boolean; // Include legend at the bottom
  includeStats?: boolean; // Include stats summary at the bottom
  showDirectionalArrows?: boolean; // Show directional arrows (→, ←, ↔) based on reference direction
  showIncoming?: boolean; // Show incoming references (default: true when showDirectionalArrows is true)
  showOutgoing?: boolean; // Show outgoing references (default: true)
  showAlreadyExpanded?: boolean; // Show ↑ for nodes already expanded elsewhere
}

const TREE_CHARS = {
  VERTICAL: '│',
  HORIZONTAL: '─',
  BRANCH: '├',
  LAST_BRANCH: '└',
  JUNCTION: '┬',
  CIRCULAR: '↻',
};

/**
 * Format notes as a tree structure based on references
 */
export function formatTree(rootNotes: Note[], allNotes: Map<string, Note>, options: TreeOptions = {}): string {
  const {
    maxDepth = 3,
    showDetails = false,
    showReferences = true,
    indentSize = 2,
    includeLegend = false,
    includeStats = false,
    showDirectionalArrows = false,
    showIncoming = showDirectionalArrows ? true : false,
    showOutgoing = true,
    showAlreadyExpanded = false,
  } = options;

  const lines: string[] = [];
  const pathStack: string[] = []; // Track current path for circular detection
  const expandedNodes = new Set<string>(); // Track nodes that have been fully expanded

  // Stats tracking
  const stats = { refCount: 0, hintCount: 0 };

  rootNotes.forEach((note, index) => {
    const isLast = index === rootNotes.length - 1;
    if (index > 0) {
      lines.push(''); // Add blank line between root nodes
    }
    formatTreeNode(note, allNotes, lines, pathStack, expandedNodes, [], isLast, 0, maxDepth, options, stats);
  });

  // Add legend if requested
  if (includeLegend) {
    if (lines.length > 0) lines.push('');
    const legendItems = [];

    if (showDirectionalArrows) {
      legendItems.push('→ = outgoing', '← = incoming', '↔ = bidirectional');
    } else if (options.showDiscoverySource) {
      legendItems.push('→ = discovered via reference');
    }

    legendItems.push('↻ = circular reference');

    if (showAlreadyExpanded) {
      legendItems.push('↑ = already expanded above');
    }

    if (options.showDiscoverySource) {
      legendItems.push('~ = discovered via context hint');
    }

    if (legendItems.length > 0) {
      lines.push(chalk.gray('Legend: ' + legendItems.join(', ')));
    }
  }

  // Add stats if requested
  if (includeStats) {
    if (lines.length > 0 && !includeLegend) lines.push('');
    const totalNotes = expandedNodes.size;
    const statsMsg =
      options.showDiscoverySource && (stats.refCount > 0 || stats.hintCount > 0)
        ? `Stats: ${totalNotes} notes (${stats.refCount} refs, ${stats.hintCount} hints)`
        : `Stats: ${totalNotes} notes`;
    lines.push(chalk.gray(statsMsg));
  }

  return lines.join('\n');
}

/**
 * Format a single node in the tree
 */
function formatTreeNode(
  note: Note,
  allNotes: Map<string, Note>,
  lines: string[],
  pathStack: string[],
  expandedNodes: Set<string>,
  prefix: string[],
  isLast: boolean,
  depth: number,
  maxDepth: number,
  options: TreeOptions,
  stats?: { refCount: number; hintCount: number },
): void {
  const isCircular = pathStack.includes(note.id);
  const alreadyExpanded = expandedNodes.has(note.id) && depth > 0;

  // Build the tree branch
  let branch = '';

  // Only add branch prefix for non-root nodes
  if (depth > 0) {
    branch = prefix.join('') + (isLast ? TREE_CHARS.LAST_BRANCH : TREE_CHARS.BRANCH) + TREE_CHARS.HORIZONTAL;

    // Add arrow or discovery indicator
    if (options.showDirectionalArrows) {
      // This will be set by the parent when calling this function
      const direction = (note as any)._treeDirection || 'out';
      if (direction === 'in') branch += ' ← ';
      else if (direction === 'both') branch += ' ↔ ';
      else branch += ' → ';
    } else if (options.showDiscoverySource) {
      const discovery = (note as any)._discoverySource;
      if (discovery === 'pattern' || discovery === 'tag') {
        branch += ' ~ ';
      } else {
        branch += ' → ';
      }
    } else {
      branch += ' ';
    }
  }

  // Format the note
  const noteStr = formatNoteInTree(note, isCircular, alreadyExpanded, options);
  lines.push(branch + noteStr);

  // Add details if requested
  if (options.showDetails && !isCircular && !alreadyExpanded) {
    const detailPrefix = prefix.join('') + (isLast ? '  ' : TREE_CHARS.VERTICAL + ' ');

    if (note.tags.length > 0 && !options.showInlineTags) {
      lines.push(detailPrefix + '  ' + chalk.gray(`Tags: ${note.tags.join(', ')}`));
    }

    if (options.showReferences && !options.showInlineRefCounts) {
      const incoming = note.references?.incoming?.length || 0;
      const outgoing = note.references?.outgoing?.length || 0;
      lines.push(detailPrefix + '  ' + chalk.gray(`References: ${incoming} incoming, ${outgoing} outgoing`));
    }

    if (options.includeExcerpt && note.content) {
      const excerpt = note.content.substring(0, 100).replace(/\n/g, ' ');
      lines.push(detailPrefix + '  ' + chalk.gray(`"${excerpt}${note.content.length > 100 ? '...' : ''}"`));
    }
  }

  // Don't traverse children if circular, already expanded, or at max depth
  if (isCircular || (alreadyExpanded && options.showAlreadyExpanded) || depth >= maxDepth) {
    return;
  }

  // Mark as expanded and add to path
  if (!alreadyExpanded) {
    expandedNodes.add(note.id);
  }
  pathStack.push(note.id);

  // Count for stats if enabled
  if (stats && options.showDiscoverySource && options.includeStats) {
    const discovery = (note as any)._discoverySource;
    if (discovery === 'reference') {
      stats.refCount++;
    } else if (discovery === 'pattern' || discovery === 'tag') {
      stats.hintCount++;
    }
  }

  // Collect children based on options
  type ChildInfo = { note: Note; direction: 'in' | 'out' | 'both' };
  const childInfos: ChildInfo[] = [];
  const seenChildren = new Map<string, 'in' | 'out' | 'both'>();

  if (options.showDirectionalArrows) {
    // Collect outgoing references
    if (options.showOutgoing !== false) {
      const outgoingIds = note.references?.outgoing?.map((ref) => ref.toId) || [];
      outgoingIds.forEach((id) => {
        if (allNotes.has(id)) {
          seenChildren.set(id, 'out');
        }
      });
    }

    // Collect incoming references
    if (options.showIncoming) {
      const incomingIds = note.references?.incoming?.map((ref) => ref.fromId) || [];
      incomingIds.forEach((id) => {
        if (allNotes.has(id)) {
          const existing = seenChildren.get(id);
          seenChildren.set(id, existing === 'out' ? 'both' : 'in');
        }
      });
    }

    // Build child info list
    for (const [childId, direction] of seenChildren) {
      const childNote = allNotes.get(childId);
      if (childNote) {
        childInfos.push({ note: childNote, direction });
      }
    }
  } else {
    // Original behavior - just follow outgoing references
    const childIds = note.references?.outgoing?.map((ref) => ref.toId) || [];
    childIds.forEach((id) => {
      const childNote = allNotes.get(id);
      if (childNote) {
        childInfos.push({ note: childNote, direction: 'out' });
      }
    });
  }

  // Add children
  const newPrefix = [...prefix, isLast ? '  ' : TREE_CHARS.VERTICAL + ' '];

  childInfos.forEach((childInfo, index) => {
    const isLastChild = index === childInfos.length - 1;
    // Set direction on child for arrow display
    (childInfo.note as any)._treeDirection = childInfo.direction;
    formatTreeNode(
      childInfo.note,
      allNotes,
      lines,
      pathStack,
      expandedNodes,
      newPrefix,
      isLastChild,
      depth + 1,
      maxDepth,
      options,
      stats,
    );
  });

  // Remove from path stack
  pathStack.pop();
}

/**
 * Format a note for display in the tree
 */
function formatNoteInTree(note: Note, isCircular: boolean, alreadyExpanded: boolean, options: TreeOptions): string {
  const parts: string[] = [];

  // ID with color
  parts.push(chalk.cyan(note.id));

  // Separator
  parts.push('-');

  // Title
  parts.push(note.title || chalk.gray('(no title)'));

  // Type (if enabled, default true for backward compatibility)
  if (options.showType !== false && !options.showInlineTags) {
    parts.push(chalk.gray(`[${note.type}]`));
  }

  // Inline tags
  if (options.showInlineTags) {
    const tags = note.tags.length > 0 ? `[${note.tags.join(', ')}]` : '[]';
    parts.push(chalk.gray(tags));
  }

  // Inline reference counts
  if (options.showInlineRefCounts) {
    const incoming = note.references?.incoming?.length || 0;
    const outgoing = note.references?.outgoing?.length || 0;
    parts.push(chalk.blue(`(${incoming}/${outgoing})`));
  }

  // Character count
  if (options.showCharCount) {
    const charCount = note.content?.length || 0;
    const formatted = formatCharCount(charCount);
    parts.push(chalk.green(formatted));
  }

  // Already expanded indicator
  if (alreadyExpanded && options.showAlreadyExpanded) {
    parts.push(chalk.gray('↑'));
  }

  // Circular reference indicator
  if (isCircular) {
    parts.push(chalk.yellow(TREE_CHARS.CIRCULAR));
  }

  return parts.join(' ');
}

/**
 * Format character count with appropriate units
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

/**
 * Format notes as an indented tree (simpler format)
 */
export function formatIndentedTree(notes: (Note & { depth?: number })[], options: { indentSize?: number; showType?: boolean } = {}): string {
  const { indentSize = 2, showType = true } = options;

  return notes
    .map((note) => {
      const depth = note.depth || 0;
      const indent = ' '.repeat(depth * indentSize);
      const type = showType ? chalk.gray(`[${note.type}]`) : '';
      return `${indent}${chalk.cyan(note.id)} ${type} ${note.title}`;
    })
    .join('\n');
}
