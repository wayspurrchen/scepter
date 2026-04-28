/**
 * @implements {T003} - Folder-based notes list display with 📁 marker
 */
import { formatTable, formatList } from '../../formatters/table-formatter.js';
import { formatNotesAsJson, formatNoteStats } from '../../formatters/note-formatter.js';
import { formatTree } from '../../formatters/tree-formatter.js';
import { optionsToNoteQuery, type CommonFilterOptions } from './common-filters.js';
import type { Note, NoteQuery } from '../../../types/note.js';
import type { ReferenceManager } from '../../../references/reference-manager.js';
import type { NoteManager } from '../../../notes/note-manager.js';
import { StatusMappingResolver } from '../../../statuses/status-mapping-resolver.js';
import { generateStatusLegend } from '../../../statuses/status-legend-generator.js';
import type { CommandContext } from '../base-command.js';
import chalk from 'chalk';
import type { ProjectManager } from '../../../project/project-manager';

export interface ListOptions extends CommonFilterOptions {
  stats?: boolean;
  json?: boolean;
  contains?: string;
  treeDepth?: number;
  treeCompact?: boolean;
  filteredRefs?: boolean;
  showLegend?: boolean; // Show status legend at bottom
  noEmoji?: boolean; // Disable emoji display
}

export interface ListResult {
  notes: Note[];
  totalCount: number;
  hasMore: boolean;
  output: string;
  isStats: boolean;
  additionalVisibleCount?: number;
}

/**
 * List and filter notes
 */
export async function listNotes(options: ListOptions, context: CommandContext): Promise<ListResult> {
  const { projectManager } = context;
  const noteManager = projectManager.noteManager;

  if (!noteManager) {
    throw new Error('Note manager not initialized');
  }

  // Convert options to query — pass timestamp precision so sub-day cutoffs
  // ("10 minutes ago") snap to UTC day boundaries when notes store dates only.
  const query = optionsToNoteQuery(options, {
    timestampPrecision: projectManager.configManager.getConfig().timestampPrecision,
  });

  // Add content filter if specified
  if (options.contains) {
    query.contentContains = options.contains;
  }

  // Apply default limits if none specified
  if (!options.limit && !options.stats) {
    if (options.format === 'tree') {
      query.limit = 10;
    } else {
      query.limit = 25;
    }
  }

  // Get notes
  const result = await noteManager.getNotes(query);

  // Calculate visible notes for tree view (needed for pagination and optionally for filtered refs)
  let visibleNoteIds: Set<string> | undefined;
  if (options.format === 'tree') {
    // Always show both incoming and outgoing references
    const treeOptions = {
      showIncoming: true,
      showOutgoing: true,
    };
    visibleNoteIds = await collectVisibleNotesInTree(result.notes, projectManager, options.treeDepth || 2, treeOptions);

    // Apply filtered counts if requested
    if (options.filteredRefs) {
      await applyFilteredReferenceCounts(result.notes, visibleNoteIds, projectManager.noteManager!);
    }
  } else if (options.filteredRefs) {
    // For other formats with filtered refs, only the queried notes are visible
    visibleNoteIds = new Set(result.notes.map((n) => n.id));
    await applyFilteredReferenceCounts(result.notes, visibleNoteIds, projectManager.noteManager!);
  }

  // Build parameter summary
  const paramSummary = buildParameterSummary(options, query);

  // Format output
  let output: string;

  if (options.stats) {
    output = formatNoteStats(result.notes);
  } else if (options.json) {
    output = formatNotesAsJson(result.notes);
  } else if (options.format === 'list') {
    output =
      paramSummary + '\n' + formatList(result.notes, true, projectManager.configManager.getConfig(), options.noEmoji);
  } else if (options.format === 'tree') {
    // Tree format showing reference structure
    // Always show both incoming and outgoing references
    const treeOptions = {
      showIncoming: true,
      showOutgoing: true,
    };
    const treeOutput = await formatTreeView(
      result.notes,
      projectManager,
      options.treeDepth || 2,
      options.treeCompact,
      options.filteredRefs,
      treeOptions,
    );
    output = paramSummary + '\n' + treeOutput;
  } else {
    // Default to table format
    // Build columns dynamically
    const columns: any[] = [
      {
        key: 'id',
        header: 'ID',
        // No width specified - will auto-size
        format: (value: string, note: Note) => {
          // Add folder indicator for folder-based notes
          const folderPrefix = note.isFolder ? '📁 ' : '';
          return chalk.cyan(folderPrefix + value);
        },
      },
      {
        key: 'type',
        header: 'Type',
        width: 12,
        format: (value: string) => chalk.yellow(value),
      },
    ];

    // Add status column if any notes have status
    const notesWithStatus = result.notes.filter((n) => n.metadata?.status);
    if (notesWithStatus.length > 0) {
      // Create status resolver
      const statusResolver = new StatusMappingResolver(projectManager.configManager.getConfig());

      columns.push({
        key: 'metadata',
        header: 'Status',
        width: 14,
        format: (metadata: any, note: Note) => {
          const status = metadata?.status;
          if (!status) return chalk.gray('-');

          // Resolve status mapping
          const mapping = statusResolver.resolve(status, note.type);

          // Format with emoji (if not disabled) and status text
          if (mapping?.emoji && !options.noEmoji) {
            const color = mapping.color || 'white';
            // Use a safe color function
            const colorFn = (chalk as any)[color] || chalk.white;
            return colorFn(`${mapping.emoji} ${status}`);
          } else {
            // Fallback formatting without emoji
            return status;
          }
        },
      });
    }

    // Add remaining columns
    columns.push(
      {
        key: 'title',
        header: 'Title',
        width: 40,
        format: (value: string, note: Note) => {
          // Remove redundant ID from title for non-tasks
          if (note.type !== 'Task' && value.startsWith(note.id + ' - ')) {
            return value.substring(note.id.length + 3);
          }
          return value;
        },
      },
      {
        key: 'tags',
        header: 'Tags',
        width: 20,
        format: (value: string[]) => value.join(', '),
      },
      {
        key: 'references',
        header: 'Refs',
        // No width specified - will auto-size
        format: (value: any, note: any) => {
          if (options.filteredRefs && (note as any)._filteredRefs) {
            const { incoming, outgoing } = (note as any)._filteredRefs;
            return `${incoming}/${outgoing}`;
          } else {
            const incoming = note.references?.incoming?.length || 0;
            const outgoing = note.references?.outgoing?.length || 0;

            // Add source code reference count if available
            if (projectManager.referenceManager && 'getReferenceCounts' in projectManager.referenceManager) {
              const sourceCounts = (projectManager.referenceManager as any).getReferenceCounts(note.id);
              if (sourceCounts && sourceCounts.source > 0) {
                return `${incoming}/${outgoing}+${sourceCounts.source}s`;
              }
            }

            return `${incoming}/${outgoing}`;
          }
        },
      },
      {
        key: 'created',
        header: 'Created',
        // No width specified - will auto-size
        format: (value: Date) => value.toISOString().split('T')[0],
      },
      {
        key: 'modified',
        header: 'Modified',
        // No width specified - will auto-size
        format: (value?: Date) => (value ? value.toISOString().split('T')[0] : 'N/A'),
      },
    );

    output = formatTable(result.notes, {
      showHeaders: true,
      columns,
    });
    output = paramSummary + '\n' + output;
  }

  // Add status legend if requested and there are statuses
  if (options.showLegend && !options.stats && !options.json) {
    const usedStatuses = new Set<string>();
    result.notes.forEach((note) => {
      if (note.metadata?.status) {
        usedStatuses.add(note.metadata.status);
      }
    });

    if (usedStatuses.size > 0) {
      const statusResolver = new StatusMappingResolver(projectManager.configManager.getConfig());
      const legend = generateStatusLegend(statusResolver, Array.from(usedStatuses));
      if (legend) {
        output += '\n\n' + legend;
      }
    }
  }

  return {
    notes: result.notes,
    totalCount: result.totalCount,
    hasMore: result.hasMore,
    output,
    isStats: !!options.stats,
    additionalVisibleCount: visibleNoteIds ? visibleNoteIds.size - result.notes.length : 0,
  };
}

/**
 * Format pagination info
 */
export function formatPaginationInfo(
  result: ListResult,
  offset?: number,
  format?: string,
  additionalCount?: number,
): string | null {
  // Always show pagination info if there are notes (for tree format) or if paginating
  if (!result.notes.length || (!result.hasMore && !offset && format !== 'tree')) {
    return null;
  }

  const start = (offset || 0) + 1;
  const end = start + result.notes.length - 1;

  if (format === 'tree' && additionalCount !== undefined && additionalCount > 0) {
    return `Showing ${start}-${end} of ${result.totalCount} root notes (${additionalCount} additional referenced notes displayed)`;
  } else if (format === 'tree') {
    return `Showing ${start}-${end} of ${result.totalCount} root notes`;
  }

  return `Showing ${start}-${end} of ${result.totalCount} notes`;
}

/**
 * Build parameter summary for display
 */
function buildParameterSummary(options: ListOptions, query: NoteQuery): string {
  const params: string[] = [];

  // Format
  if (options.format && options.format !== 'table') {
    params.push(`Format: ${options.format}`);
  }

  // Tree depth
  if (options.format === 'tree') {
    params.push(`Tree depth: ${options.treeDepth || 2}`);
  }

  // Types filter
  if (query.types && query.types.length > 0) {
    params.push(`Types: ${query.types.join(', ')}`);
  }
  if (query.excludeTypes && query.excludeTypes.length > 0) {
    params.push(`Exclude types: ${query.excludeTypes.join(', ')}`);
  }

  // Tags filter
  if (query.tags && query.tags.length > 0) {
    params.push(`Tags: ${query.tags.join(', ')}`);
  }
  if (query.excludeTags && query.excludeTags.length > 0) {
    params.push(`Exclude tags: ${query.excludeTags.join(', ')}`);
  }

  // Content filter
  if (options.contains) {
    params.push(`Contains: "${options.contains}"`);
  }

  // Date filters
  if (query.createdAfter) {
    params.push(`Created after: ${query.createdAfter.toISOString().split('T')[0]}`);
  }
  if (query.createdBefore) {
    params.push(`Created before: ${query.createdBefore.toISOString().split('T')[0]}`);
  }

  // Reference filters
  if (query.minIncomingRefs !== undefined) {
    params.push(`Min incoming refs: ${query.minIncomingRefs}`);
  }
  if (query.minOutgoingRefs !== undefined) {
    params.push(`Min outgoing refs: ${query.minOutgoingRefs}`);
  }
  if (query.hasNoRefs) {
    params.push(`No references`);
  }

  if (query.statuses && query.statuses.length > 0) {
    params.push(`Statuses: ${query.statuses.join(', ')}`);
  }

  // Sort
  if (query.sortBy) {
    params.push(`Sort: ${query.sortBy} ${query.sortOrder || 'desc'}`);
  }

  // Limit
  if (query.limit) {
    params.push(`Limit: ${query.limit}`);
  }

  if (params.length === 0) {
    params.push('No filters applied');
  }

  // Add reference count clarification
  const refNote = options.filteredRefs
    ? chalk.gray('Reference counts show only references within filtered results')
    : chalk.gray('Reference counts show total references (not filtered)');

  return chalk.gray(params.join(' | ')) + '\n' + refNote;
}

/**
 * Format notes in tree view showing reference structure
 */
async function formatTreeView(
  notes: Note[],
  projectManager: ProjectManager,
  depth: number = 2,
  compact: boolean = false,
  filteredRefs: boolean = false,
  options?: { showIncoming?: boolean; showOutgoing?: boolean },
): Promise<string> {
  const referenceManager = projectManager.referenceManager;
  const noteManager = projectManager.noteManager;

  if (!referenceManager || !noteManager) {
    return 'Reference manager not available';
  }

  const lines: string[] = [];
  const expandedNodes = new Set<string>(); // Track which nodes have been fully expanded
  const noteData = new Map<string, { title: string; refCount: { incoming: number; outgoing: number } }>();

  // Add legend at the beginning
  lines.push(chalk.gray('Legend: ↻ = circular reference, ↑ = already expanded above'));
  lines.push('');

  // Pre-populate note data for all notes to ensure correct titles
  for (const note of notes) {
    let refCount;
    if (filteredRefs && (note as any)._filteredRefs) {
      refCount = (note as any)._filteredRefs;
    } else {
      refCount = {
        incoming: note.references?.incoming?.length || 0,
        outgoing: note.references?.outgoing?.length || 0,
      };
    }

    noteData.set(note.id, {
      title: note.title,
      refCount,
    });
  }

  // Track paths to detect cycles
  const pathStack: string[] = [];

  const displayNote = async (
    note: Note,
    linePrefix: string = '',
    continuationPrefix: string = '',
    currentDepth: number = 0,
    isRootLevel: boolean = false,
  ) => {
    // Check for cycles
    if (pathStack.includes(note.id)) {
      lines.push(linePrefix + chalk.cyan(note.id) + ' ' + chalk.gray('↻'));
      return;
    }

    // Add to path stack
    pathStack.push(note.id);

    // Build the display text
    let displayText = '';

    // For notes being displayed as children, check if they exist in noteData
    // If not, add them to ensure we have their proper title
    if (!noteData.has(note.id)) {
      noteData.set(note.id, {
        title: note.title,
        refCount: {
          incoming: note.references?.incoming?.length || 0,
          outgoing: note.references?.outgoing?.length || 0,
        },
      });
    }

    const data = noteData.get(note.id)!;
    const refCountStr = chalk.gray(` (${data.refCount.incoming}/${data.refCount.outgoing})`);

    // Add status emoji if available
    let statusEmoji = '';
    if (note.metadata?.status && !(options as any).noEmoji) {
      const statusResolver = new StatusMappingResolver(projectManager.configManager.getConfig());
      const mapping = statusResolver.resolve(note.metadata.status, note.type);
      if (mapping?.emoji) {
        statusEmoji = mapping.emoji + ' ';
      }
    }

    // Add folder indicator if this is a folder-based note
    const folderIndicator = note.isFolder ? '📁 ' : '';

    // Check if this node has already been fully expanded elsewhere
    const alreadyExpanded = expandedNodes.has(note.id) && !isRootLevel;

    if (alreadyExpanded) {
      // Show that this node was already expanded above
      displayText = statusEmoji + folderIndicator + chalk.cyan(note.id) + ' ' + data.title + ' ' + chalk.gray('↑');
    } else {
      // Show full title
      displayText = statusEmoji + folderIndicator + chalk.cyan(note.id) + ' ' + data.title + refCountStr;
    }

    lines.push(linePrefix + displayText);

    // Don't expand if already expanded elsewhere or beyond specified depth
    if (alreadyExpanded || currentDepth >= depth) {
      pathStack.pop();
      return;
    }

    // Mark this node as expanded
    expandedNodes.add(note.id);

    // Determine which references to show (default to both)
    const showIncoming = options?.showIncoming ?? true;
    const showOutgoing = options?.showOutgoing ?? true;

    type ChildInfo = { note: Note; direction: 'in' | 'out' | 'both' };
    const childInfos: ChildInfo[] = [];
    const seenChildren = new Map<string, 'in' | 'out' | 'both'>();

    // Collect outgoing references
    if (showOutgoing) {
      const outgoingRefs = referenceManager.getReferencesFrom(note.id);
      for (const ref of outgoingRefs) {
        let childNote = notes.find((n) => n.id === ref.toId);
        if (!childNote) {
          childNote = (await noteManager.getNoteById(ref.toId)) || undefined;
        }
        if (childNote) {
          seenChildren.set(childNote.id, 'out');
        }
      }
    }

    // Collect incoming references
    if (showIncoming) {
      const incomingRefs = referenceManager.getReferencesTo(note.id);
      for (const ref of incomingRefs) {
        let childNote = notes.find((n) => n.id === ref.fromId);
        if (!childNote) {
          childNote = (await noteManager.getNoteById(ref.fromId)) || undefined;
        }
        if (childNote) {
          const existing = seenChildren.get(childNote.id);
          seenChildren.set(childNote.id, existing === 'out' ? 'both' : 'in');
        }
      }
    }

    // Build child info list
    for (const [childId, direction] of seenChildren) {
      const childNote = await noteManager.getNoteById(childId);
      if (childNote) {
        childInfos.push({ note: childNote, direction });
      }
    }

    // Display children with appropriate arrows
    for (let index = 0; index < childInfos.length; index++) {
      const { note: child, direction } = childInfos[index];
      const isLast = index === childInfos.length - 1;

      let arrow = '→';
      if (direction === 'in') arrow = '←';
      else if (direction === 'both') arrow = '↔';

      const childLinePrefix = continuationPrefix + (isLast ? `└── ${arrow} ` : `├── ${arrow} `);
      const childContinuationPrefix = continuationPrefix + (isLast ? '    ' : '│   ');

      await displayNote(child, childLinePrefix, childContinuationPrefix, currentDepth + 1, false);
    }

    // Remove from path stack when done
    pathStack.pop();
  };

  // Process each root note
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];
    if (index > 0) {
      lines.push(''); // Empty line between root notes
    }
    await displayNote(note, '', '', 0, true);
  }

  return lines.join('\n');
}

/**
 * Collect all notes that will be visible in the tree view
 */
async function collectVisibleNotesInTree(
  rootNotes: Note[],
  projectManager: ProjectManager,
  depth: number,
  options?: { showIncoming?: boolean; showOutgoing?: boolean },
): Promise<Set<string>> {
  const visible = new Set<string>();
  const expandedNodes = new Set<string>();

  // Add all root notes
  rootNotes.forEach((note) => visible.add(note.id));

  const collectReferences = async (noteId: string, currentDepth: number) => {
    if (currentDepth >= depth || expandedNodes.has(noteId)) {
      return;
    }

    expandedNodes.add(noteId);

    const showIncoming = options?.showIncoming ?? true;
    const showOutgoing = options?.showOutgoing ?? true;

    // Collect outgoing references
    if (showOutgoing) {
      const references = projectManager.referenceManager!.getReferencesFrom(noteId);
      for (const ref of references) {
        visible.add(ref.toId);

        // Get the referenced note to continue traversal
        const childNote = await projectManager.noteManager!.getNoteById(ref.toId);
        if (childNote) {
          await collectReferences(ref.toId, currentDepth + 1);
        }
      }
    }

    // Collect incoming references
    if (showIncoming) {
      const references = projectManager.referenceManager!.getReferencesTo(noteId);
      for (const ref of references) {
        visible.add(ref.fromId);

        // Get the referencing note to continue traversal
        const parentNote = await projectManager.noteManager!.getNoteById(ref.fromId);
        if (parentNote) {
          await collectReferences(ref.fromId, currentDepth + 1);
        }
      }
    }
  };

  // Traverse from each root note
  for (const note of rootNotes) {
    await collectReferences(note.id, 0);
  }

  return visible;
}

/**
 * Apply filtered reference counts to notes based on visible set
 */
async function applyFilteredReferenceCounts(
  notes: Note[],
  visibleNoteIds: Set<string>,
  noteManager: NoteManager,
): Promise<void> {
  // We need to apply counts to ALL visible notes, not just the root notes
  const allVisibleNotes = new Map<string, Note>();

  // Add root notes
  for (const note of notes) {
    allVisibleNotes.set(note.id, note);
  }

  // Fetch all other visible notes
  for (const noteId of visibleNoteIds) {
    if (!allVisibleNotes.has(noteId)) {
      const note = await noteManager.getNoteById(noteId);
      if (note) {
        allVisibleNotes.set(noteId, note);
      }
    }
  }

  // Apply filtered counts to all visible notes
  for (const note of allVisibleNotes.values()) {
    if (note.references) {
      // Count only references that point to/from notes in the visible set
      const filteredIncoming = note.references.incoming.filter((ref) => visibleNoteIds.has(ref.fromId));
      const filteredOutgoing = note.references.outgoing.filter((ref) => visibleNoteIds.has(ref.toId));

      // Store filtered counts for display
      (note as any)._filteredRefs = {
        incoming: filteredIncoming.length,
        outgoing: filteredOutgoing.length,
      };
    }
  }
}
