import { ProjectManager } from '../../../project/project-manager';
import { optionsToNoteQuery, patternsToContextHints } from './common-filters';
import type { Note } from '../../../types/note';
import type { ContextHints, GatheredNote } from '../../../types/context';
import type { GatherOptions } from '../../../context/context-gatherer';
import { formatGatheredNotes, type GatherFormatOptions } from '../../formatters/gather-formatter';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { CommandContext } from '../base-command';
import { scanFolderContents } from '../../../notes/folder-utils';

export interface GatherCommandOptions {
  // Gathering control
  refsOnly?: boolean;
  hintsOnly?: boolean;
  depth?: number;
  maxChars?: number;
  maxNotes?: number;

  // Reference direction
  outgoing?: boolean;
  incoming?: boolean;
  bidirectional?: boolean;

  // Context hint sources
  noNoteHints?: boolean;
  patterns?: string[];
  hintTypes?: string[];
  hintTags?: string[];

  // Output options
  includeMetadata?: boolean;
  noContent?: boolean;
  excerptLength?: number;
  includeContent?: boolean;
  includeTree?: boolean;
  includeFolderContents?: boolean; // --include-folder-contents flag to include folder file contents
  
  // Archive/Delete options
  includeArchived?: boolean;
  includeDeleted?: boolean;

  // Project directory
  projectDir?: string;
}

export interface FolderContentInfo {
  fileCount: number;
  totalCharacters: number;
  files: Array<{
    path: string;
    size: number;
    type: string; // 'text' | 'binary' | 'image' | 'data'
  }>;
  contents?: Array<{
    path: string;
    content: string;
    truncated?: boolean;
  }>;
}

export interface GatherResult {
  origin: Note;
  gathered: GatheredNote[];
  stats: {
    totalNotes: number;
    bySource: Record<string, number>;
    byDepth: Record<number, number>;
    gatherTimeMs: number;
  };
  folderInfo?: FolderContentInfo; // Information about folder contents if origin is folder-based
  output: string;
}

/**
 * Gather context for a note
 */
export async function gatherContext(
  noteId: string,
  options: GatherCommandOptions,
  context: CommandContext,
): Promise<GatherResult> {
  const startTime = Date.now();
  const { projectManager, projectPath } = context;

  const noteManager = projectManager.noteManager;
  const contextGatherer = projectManager.contextGatherer;

  if (!noteManager || !contextGatherer) {
    throw new Error('Note manager or context gatherer not initialized');
  }

  // Get the origin note (including archived/deleted if requested)
  const noteQuery = {
    ids: [noteId],
    includeArchived: options.includeArchived,
    includeDeleted: options.includeDeleted
  };
  const noteResult = await noteManager.getNotes(noteQuery);
  if (noteResult.notes.length === 0) {
    throw new Error(`Note ${noteId} not found`);
  }
  const origin = noteResult.notes[0];

  // Build context hints
  const hints = await buildContextHints(origin, options, projectManager);

  // Initialize gathered notes
  const gathered: GatheredNote[] = [];
  const stats = {
    bySource: {} as Record<string, number>,
    byDepth: {} as Record<number, number>,
  };
  const visited = new Set<string>([origin.id]);

  // 1. First, gather references if not hints-only
  if (!options.hintsOnly) {
    const referenceManager = projectManager.referenceManager;
    const depth = options.depth || 2;

    if (referenceManager) {
      const toProcess: Array<{ id: string; level: number; via: string }> = [
        { id: origin.id, level: 0, via: origin.id },
      ];

      while (toProcess.length > 0) {
        const current = toProcess.shift()!;

        if (current.level >= depth) continue;

        // Get references based on options
        const refMap = new Map<string, 'incoming' | 'outgoing' | 'bidirectional'>();

        if (!options.incoming || options.bidirectional || (!options.incoming && !options.outgoing)) {
          // Include outgoing references
          const outgoingRefs = referenceManager.getReferencesFrom(current.id);
          for (const ref of outgoingRefs) {
            refMap.set(ref.toId, 'outgoing');
          }
        }

        if (!options.outgoing || options.bidirectional || options.incoming) {
          // Include incoming references (exclude source references - we handle them separately)
          const incomingRefs = referenceManager.getReferencesTo(current.id, false);
          for (const ref of incomingRefs) {
            const existing = refMap.get(ref.fromId);
            if (existing === 'outgoing') {
              refMap.set(ref.fromId, 'bidirectional');
            } else {
              refMap.set(ref.fromId, 'incoming');
            }
          }
        }

        // Process each reference
        for (const [refId, direction] of refMap.entries()) {
          if (!visited.has(refId)) {
            visited.add(refId);

            const refResult = await noteManager.getNotes({
              ids: [refId],
              includeArchived: options.includeArchived,
              includeDeleted: options.includeDeleted
            });
            const refNote = refResult.notes.length > 0 ? refResult.notes[0] : null;
            if (refNote) {
              const gatheredNote: GatheredNote = {
                note: refNote as any,
                discovery: {
                  source: 'reference',
                  via: current.id,
                  direction,
                },
                depth: current.level + 1,
              };
              gathered.push(gatheredNote);

              // Update stats
              stats.bySource.reference = (stats.bySource.reference || 0) + 1;
              stats.byDepth[current.level + 1] = (stats.byDepth[current.level + 1] || 0) + 1;

              // Add to processing queue
              toProcess.push({
                id: refId,
                level: current.level + 1,
                via: refId,
              });
            }
          }
        }
      }
    }
  }

  // Include source code references if available (they are a type of reference)
  if (!options.hintsOnly && projectManager.sourceScanner) {
    const sourceRefs = projectManager.sourceScanner.getReferencesToNote(origin.id);

    for (const sourceRef of sourceRefs) {
      const sourceId = `source:${sourceRef.filePath}`;
      if (!visited.has(sourceId)) {
        visited.add(sourceId);

        // Create a synthetic note for the source file reference
        const relativePath = path.relative(projectPath, sourceRef.filePath);
        
        // Get file size for character count
        let fileSize = 0;
        try {
          const stats = await fs.stat(sourceRef.filePath);
          fileSize = stats.size;
        } catch (err) {
          // Ignore errors, use 0 as fallback
        }
        
        const sourceNote = {
          id: sourceId,
          title: relativePath, // Don't prefix with "Source:" here - formatter handles it
          type: 'source-reference',
          tags: ['source-code'],
          content: `Line ${sourceRef.line}: ${sourceRef.context || ''} {${sourceRef.toId}}`,
          created: new Date(),
          references: [],
          metadata: {
            filePath: relativePath,
            line: sourceRef.line,
            language: sourceRef.language,
            referenceType: sourceRef.referenceType,
            fileSize,
          },
        };

        const gatheredNote: GatheredNote = {
          note: sourceNote as any,
          discovery: {
            source: 'reference',
            via: origin.id,
            direction: 'incoming', // Source files reference the note
          },
          depth: 1,
        };
        gathered.push(gatheredNote);

        // Update stats
        stats.bySource['reference'] = (stats.bySource['reference'] || 0) + 1;
        stats.byDepth[1] = (stats.byDepth[1] || 0) + 1;
      }
    }
  }

  // 2. Then, gather context hints if not refs-only
  if (!options.refsOnly && (hints.patterns || hints.includeTags || hints.includeTypes)) {
    // Use context gatherer for pattern/tag/type matching
    const gatherOptions: GatherOptions = {
      maxDepth: 0, // Don't follow references from hint matches
      sortBy: 'relevance',
      includeArchived: options.includeArchived,
      includeDeleted: options.includeDeleted,
    };

    const hintResult = await contextGatherer.gatherContext(hints, gatherOptions);

    // Add hint matches to gathered notes
    for (const note of hintResult.contextHintNotes) {
      // Skip if already found via references
      if (!gathered.some((g) => g.note.id === note.id)) {
        const source = determineDiscoverySource(note, hints);
        const gatheredNote: GatheredNote = {
          note: note as any,
          discovery: { source },
          depth: 0,
        };
        gathered.push(gatheredNote);

        // Update stats
        stats.bySource[source] = (stats.bySource[source] || 0) + 1;
        stats.byDepth[0] = (stats.byDepth[0] || 0) + 1;
      }
    }
  }

  // Apply filters
  let filteredGathered = gathered;

  // Apply max notes limit
  if (options.maxNotes && filteredGathered.length > options.maxNotes) {
    // Sort by relevance/priority before truncating
    filteredGathered = filteredGathered
      .sort((a, b) => {
        // Prioritize direct references over context hints
        if (a.discovery.source === 'reference' && b.discovery.source !== 'reference') return -1;
        if (b.discovery.source === 'reference' && a.discovery.source !== 'reference') return 1;
        // Then by depth (lower is better)
        return a.depth - b.depth;
      })
      .slice(0, options.maxNotes);
  }

  // Analyze folder contents if origin is folder-based
  const folderInfo = await analyzeFolderContents(origin, !!options.includeFolderContents, projectPath);

  // Format output
  const formatOptions: GatherFormatOptions = {
    includeTree: options.includeTree,
    excerptLength: options.excerptLength,
    includeContent: options.includeContent,
    maxChars: options.maxChars,
    folderInfo, // Pass folder info to formatter
  };

  const output = formatGatheredNotes(origin, filteredGathered, formatOptions);

  // Build result
  const result: GatherResult = {
    origin,
    gathered: filteredGathered,
    stats: {
      totalNotes: filteredGathered.length,
      bySource: stats.bySource,
      byDepth: stats.byDepth,
      gatherTimeMs: Date.now() - startTime,
    },
    folderInfo,
    output,
  };

  return result;
}

/**
 * Build context hints from options and note
 */
async function buildContextHints(
  note: Note,
  options: GatherCommandOptions,
  projectManager: ProjectManager,
): Promise<ContextHints> {
  const hints: ContextHints = {};

  // Handle refs-only mode
  if (options.refsOnly) {
    // Return empty hints to only follow references
    return hints;
  }

  // Start with note's own context hints
  if (!options.noNoteHints && note.contextHints) {
    Object.assign(hints, note.contextHints);
  }

  // Add explicit patterns from command line
  if (options.patterns?.length) {
    hints.patterns = [...(hints.patterns || []), ...options.patterns];
  }

  // Add hint types and tags
  if (options.hintTypes?.length) {
    hints.includeTypes = [...(hints.includeTypes || []), ...options.hintTypes];
  }
  if (options.hintTags?.length) {
    hints.includeTags = [...(hints.includeTags || []), ...options.hintTags];
  }

  // Handle hints-only mode
  if (options.hintsOnly) {
    // Set max depth to 0 to prevent reference following
    // This is handled in the gather options
  }

  // Remove duplicates
  if (hints.patterns) {
    hints.patterns = [...new Set(hints.patterns)];
  }
  if (hints.includeTags) {
    hints.includeTags = [...new Set(hints.includeTags)];
  }
  if (hints.includeTypes) {
    hints.includeTypes = [...new Set(hints.includeTypes)];
  }

  return hints;
}

/**
 * Determine how a note was discovered
 */
function determineDiscoverySource(note: Note, hints: ContextHints): 'pattern' | 'tag' | 'type' {
  // Check if note matches any patterns
  if (hints.patterns?.length) {
    for (const pattern of hints.patterns) {
      if (note.content?.includes(pattern) || note.title.includes(pattern)) {
        return 'pattern';
      }
    }
  }

  // Check if note matches tags
  if (hints.includeTags?.length) {
    for (const tag of hints.includeTags) {
      if (note.tags.includes(tag)) {
        return 'tag';
      }
    }
  }

  // Default to type match
  return 'type';
}

/**
 * Calculate depth from origin to target note
 */
async function calculateDepth(targetId: string, originId: string, projectManager: ProjectManager): Promise<number> {
  // Simple implementation - could be enhanced with actual path tracing
  if (targetId === originId) return 0;

  const referenceManager = projectManager.referenceManager;
  if (!referenceManager) return 1;

  // Check if target is directly referenced by origin
  const originRefs = referenceManager.getReferencesFrom(originId);
  if (originRefs.some((ref) => ref.toId === targetId)) {
    return 1;
  }

  // Otherwise estimate depth 2+
  // In a full implementation, we'd trace the actual path
  return 2;
}

/**
 * Analyze folder contents for a folder-based note
 * @implements {E002} Phase 4 - Context Gathering for folder-based notes
 */
async function analyzeFolderContents(
  note: Note,
  includeFolderContents: boolean,
  projectPath: string
): Promise<FolderContentInfo | undefined> {
  // Check if note is folder-based
  if (!note.isFolder || !note.folderPath) {
    return undefined;
  }

  try {
    // Scan folder for additional files
    const additionalFiles = await scanFolderContents(note.folderPath);

    if (additionalFiles.length === 0) {
      return undefined; // No additional files
    }

    const fileInfo: FolderContentInfo['files'] = [];
    const contents: FolderContentInfo['contents'] = [];
    let totalCharacters = 0;
    const maxFileSize = 100 * 1024; // 100KB limit per file
    const maxTotalSize = 500 * 1024; // 500KB total limit

    for (const relPath of additionalFiles) {
      const fullPath = path.join(note.folderPath, relPath);

      try {
        const stats = await fs.stat(fullPath);
        const fileExt = path.extname(relPath).toLowerCase();

        // Determine file type
        let fileType = 'data';
        if (['.md', '.txt', '.json', '.yaml', '.yml', '.xml', '.csv', '.log'].includes(fileExt)) {
          fileType = 'text';
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(fileExt)) {
          fileType = 'image';
        } else if (stats.size > 1024 * 1024) { // Files > 1MB considered binary
          fileType = 'binary';
        }

        fileInfo.push({
          path: relPath,
          size: stats.size,
          type: fileType
        });

        // Count characters for text files
        if (fileType === 'text' && stats.size < maxFileSize) {
          totalCharacters += stats.size;
        }

        // Include actual content if flag is set
        if (includeFolderContents && fileType === 'text' &&
            stats.size < maxFileSize && totalCharacters < maxTotalSize) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const truncated = content.length > 10000; // Truncate very long files
            contents.push({
              path: relPath,
              content: truncated ? content.substring(0, 10000) + '\n... [truncated]' : content,
              truncated
            });
          } catch (readErr) {
            // Skip files that can't be read as text
            console.warn(`Could not read file ${relPath}: ${readErr}`);
          }
        }
      } catch (statErr) {
        console.warn(`Could not stat file ${relPath}: ${statErr}`);
      }
    }

    return {
      fileCount: fileInfo.length,
      totalCharacters,
      files: fileInfo,
      contents: includeFolderContents && contents.length > 0 ? contents : undefined
    };
  } catch (error) {
    console.error(`Error analyzing folder contents: ${error}`);
    return undefined;
  }
}
