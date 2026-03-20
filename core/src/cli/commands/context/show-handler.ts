import chalk from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { ProjectManager } from '../../../project/project-manager';
import { formatNote, formatNotes, formatNotesAsJson } from '../../formatters/note-formatter';
import { SourceCodeScanner } from '../../../scanners/source-code-scanner';
import type { Note } from '../../../types/note';
import type { SourceReference } from '../../../types/reference';
import type { CommandContext } from '../base-command';

import type { CommonFilterOptions } from './common-filters';

export interface ShowOptions extends Omit<CommonFilterOptions, 'format' | 'references'> {
  references?: boolean; // CLI --references option  
  includeIncomingRefs?: boolean;
  includeOutgoingRefs?: boolean;
  depth?: string;
  preview?: boolean;
  format?: boolean; // --no-format sets this to false
  json?: boolean;
  sourceFile?: string;
  includeFileRefs?: boolean;
  sourceRefs?: boolean; // --no-source-refs sets this to false
}

export interface ShowResult {
  notes: Note[];
  notFound: string[];
  output: string;
}

/**
 * Show notes by their IDs
 */
export async function showNotes(
  ids: string[],
  options: ShowOptions,
  context: CommandContext,
): Promise<ShowResult> {
  const { projectManager } = context;
  const noteManager = projectManager.noteManager;

  if (!noteManager) {
    throw new Error('Note manager not initialized');
  }

  // Get the requested notes
  const notes: Note[] = [];
  const notFound: string[] = [];
  const processedIds = new Set<string>(); // Track processed IDs to avoid duplicates

  // Check if any ID patterns contain glob characters
  const hasGlobPattern = ids.some((id) => /[*?[\]{}]/.test(id));

  if (hasGlobPattern) {
    // Get all notes first if we have glob patterns
    const allNotesResult = await noteManager.getNotes({ includeArchived: options.includeArchived, includeDeleted: options.includeDeleted });
    const allNotes = allNotesResult.notes;
    const allNoteIds = allNotes.map((n) => n.id);

    for (const pattern of ids) {
      if (/[*?[\]{}]/.test(pattern)) {
        // This is a glob pattern - use minimatch
        const matchingIds = allNoteIds.filter((id) => minimatch(id, pattern));

        if (matchingIds.length === 0) {
          notFound.push(pattern);
        } else {
          // Add all matching notes
          for (const matchId of matchingIds) {
            if (!processedIds.has(matchId)) {
              const note = allNotes.find((n) => n.id === matchId);
              if (note) {
                notes.push(note);
                processedIds.add(matchId);
              }
            }
          }
        }
      } else {
        // Regular ID lookup
        if (!processedIds.has(pattern)) {
          const noteResult = await noteManager.getNotes({ ids: [pattern], includeArchived: options.includeArchived, includeDeleted: options.includeDeleted });
          const note = noteResult.notes.length > 0 ? noteResult.notes[0] : undefined;
          if (note) {
            notes.push(note);
            processedIds.add(pattern);
          } else {
            notFound.push(pattern);
          }
        }
      }
    }
  } else {
    // No glob patterns, use the original logic
    const result = await noteManager.getNotes({ ids, includeArchived: options.includeArchived, includeDeleted: options.includeDeleted });
    notes.push(...result.notes);
    const foundIds = new Set(result.notes.map(n => n.id));
    ids.forEach(id => {
      if (!foundIds.has(id)) {
        notFound.push(id);
      }
    });
  }

  // Get referenced notes if requested with tree structure
  let allNotes = [...notes];
  const referenceTree = new Map<
    string,
    {
      note: Note;
      level: number;
      parent: string | null;
      direction: 'incoming' | 'outgoing' | 'both';
      rootId: string; // Track which primary note this reference belongs to
    }
  >();

  // Determine which references to include
  const includeRefs = options.references || options.includeIncomingRefs || options.includeOutgoingRefs;

  if (includeRefs) {
    const depth = parseInt(options.depth || '1', 10);
    const referenceManager = projectManager.referenceManager;

    if (referenceManager) {
      // Process each primary note separately to build its own reference tree
      for (const primaryNote of notes) {
        const visited = new Set<string>([primaryNote.id]);
        const toProcess: Array<{ id: string; level: number; parent: string | null; rootId: string }> = [
          { id: primaryNote.id, level: 0, parent: null, rootId: primaryNote.id },
        ];

        while (toProcess.length > 0) {
          const current = toProcess.shift()!;

          if (current.level >= depth) continue;

          // Get references based on options
          const outgoingRefs = referenceManager.getReferencesFrom(current.id);
          const outgoingIds = new Set(outgoingRefs.map((ref) => ref.toId));
          const incomingRefs = referenceManager.getReferencesTo(current.id);
          const incomingIds = new Set(incomingRefs.map((ref) => ref.fromId));

          // Process outgoing references if not restricted to incoming only
          if (!options.includeIncomingRefs || options.references) {
            for (const refId of outgoingIds) {
              if (!visited.has(refId)) {
                visited.add(refId);

                const refResult = await noteManager.getNotes({ ids: [refId], includeArchived: options.includeArchived, includeDeleted: options.includeDeleted });
                const refNote = refResult.notes.length > 0 ? refResult.notes[0] : undefined;
                if (refNote) {
                  // Only add to allNotes if not already present
                  if (!allNotes.some((n) => n.id === refId)) {
                    allNotes.push(refNote);
                  }

                  const direction = incomingIds.has(refId) ? 'both' : 'outgoing';

                  // Create a unique key for the reference tree that includes root and parent context
                  const treeKey = `${current.rootId}:${current.id}->${refId}`;
                  referenceTree.set(treeKey, {
                    note: refNote,
                    level: current.level + 1,
                    parent: current.id,
                    direction,
                    rootId: current.rootId,
                  });

                  // Add to processing queue for deeper traversal
                  toProcess.push({
                    id: refId,
                    level: current.level + 1,
                    parent: current.id,
                    rootId: current.rootId,
                  });
                }
              }
            }
          }

          // Process incoming references if not restricted to outgoing only
          if (!options.includeOutgoingRefs || options.references) {
            for (const refId of incomingIds) {
              if (!visited.has(refId)) {
                visited.add(refId);

                const refResult = await noteManager.getNotes({ ids: [refId], includeArchived: options.includeArchived, includeDeleted: options.includeDeleted });
                const refNote = refResult.notes.length > 0 ? refResult.notes[0] : undefined;
                if (refNote) {
                  // Only add to allNotes if not already present
                  if (!allNotes.some((n) => n.id === refId)) {
                    allNotes.push(refNote);
                  }

                  // Create a unique key for the reference tree that includes root and parent context
                  const treeKey = `${current.rootId}:${current.id}->${refId}`;
                  referenceTree.set(treeKey, {
                    note: refNote,
                    level: current.level + 1,
                    parent: current.id,
                    direction: 'incoming',
                    rootId: current.rootId,
                  });

                  // Add to processing queue for deeper traversal
                  toProcess.push({
                    id: refId,
                    level: current.level + 1,
                    parent: current.id,
                    rootId: current.rootId,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  // Format output
  let output: string;

  if (options.json) {
    output = formatNotesAsJson(allNotes);
  } else if (options.preview) {
    // Show only IDs and titles in preview mode
    output = allNotes.map((note) => `${chalk.cyan(note.id)} - ${note.title}`).join('\n');
  } else {
    // Separate primary notes from referenced notes
    const primaryNoteIds = new Set(notes.map((n) => n.id));
    const outputs: string[] = [];

    // Format each primary note individually with its own referenced notes
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];

      // Add delimiter for multiple notes with spacing
      if (notes.length > 1) {
        if (i > 0) {
          outputs.push(''); // Add blank line before delimiter (except for first note)
        }
        outputs.push(`=== NOTE: ${note.id} ===`);
        outputs.push(''); // Add blank line after delimiter
      }

      // Format the note based on format option
      if (options.format === false) {
        // Plain text output - just the content
        outputs.push(note.content);
      } else {
        // Formatted output
        outputs.push(
          formatNote(note, {
            showMetadata: true,
            showContent: true,
            showReferences: false, // References shown in tree below
          }),
        );
      }

      // Show source code references if enabled
      if (options.sourceRefs !== false && projectManager.sourceScanner) {
        const sourceRefs = projectManager.sourceScanner.getReferencesToNote(note.id);

        if (sourceRefs.length > 0) {
          outputs.push('');
          outputs.push(chalk.gray('─'.repeat(60)));
          outputs.push(chalk.gray('Referenced in source code:'));

          // Group by file
          const byFile = new Map<string, SourceReference[]>();
          for (const ref of sourceRefs) {
            if (!byFile.has(ref.filePath)) {
              byFile.set(ref.filePath, []);
            }
            byFile.get(ref.filePath)!.push(ref);
          }

          for (const [file, refs] of byFile) {
            const relativePath = path.relative(context.projectPath, file);
            outputs.push(chalk.dim(`  ${relativePath}`));

            for (const ref of refs) {
              const typeLabel = ref.referenceType !== 'mentions' ? chalk.yellow(`@${ref.referenceType}`) : '';
              outputs.push(
                `    ${chalk.gray(`L${ref.line}:`)} ${typeLabel} ${ref.context?.trim() || ''} {${ref.toId}}`,
              );
            }
          }
        }
      }

      // Add referenced notes for this specific note if requested
      if (includeRefs && referenceTree.size > 0) {
        const noteReferences: string[] = [];
        const displayedIds = new Set<string>();

        // Helper function to display a note and its children
        const displayNote = (treeKey: string, indent: string = '  ', currentDepth: number = 1) => {
          const noteInfo = referenceTree.get(treeKey);
          if (!noteInfo) return;

          const { note: refNote, direction, level } = noteInfo;
          const noteId = refNote.id;

          if (displayedIds.has(noteId)) return;
          displayedIds.add(noteId);

          const tags = refNote.tags.length > 0 ? ` [${refNote.tags.join(', ')}]` : '';

          // Choose arrow based on direction
          let arrow = '';
          if (direction === 'incoming') {
            arrow = '← ';
          } else if (direction === 'outgoing') {
            arrow = '→ ';
          } else if (direction === 'both') {
            arrow = '↔ ';
          }

          noteReferences.push(`${indent}${arrow}${chalk.cyan(refNote.id)} - ${refNote.title}${chalk.gray(tags)}`);

          // Find and display children only if we haven't reached the depth limit
          const requestedDepth = parseInt(options.depth || '1', 10);
          if (currentDepth < requestedDepth) {
            for (const [childKey, childInfo] of referenceTree.entries()) {
              if (childInfo.parent === noteId && childInfo.rootId === note.id) {
                displayNote(childKey, indent + '  ', currentDepth + 1);
              }
            }
          }
        };

        // Display only references that belong to this primary note
        for (const [treeKey, refInfo] of referenceTree.entries()) {
          if (refInfo.level === 1 && refInfo.rootId === note.id) {
            displayNote(treeKey);
          }
        }

        if (noteReferences.length > 0) {
          outputs.push('');
          outputs.push(chalk.gray('─'.repeat(60)));
          outputs.push(chalk.gray('Referenced Notes:'));
          outputs.push(...noteReferences);
        }
      }
    }

    output = outputs.join('\n');
  }

  return {
    notes: allNotes,
    notFound,
    output,
  };
}

/**
 * Write output to file or console
 */
export async function showSourceFile(
  filePath: string,
  options: ShowOptions,
  context: CommandContext,
): Promise<void> {
  const { projectManager, projectPath } = context;

  if (!projectManager.sourceScanner) {
    throw new Error('Source code integration is not enabled');
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);

  // Check if file exists
  if (!(await fs.pathExists(absolutePath))) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Scan the file for references
  const references = await projectManager.sourceScanner.scanFile(absolutePath);

  if (references.length === 0) {
    console.log(chalk.yellow(`No note references found in ${filePath}`));
    return;
  }

  // Group references by note ID
  const refsByNote = new Map<string, SourceReference[]>();
  for (const ref of references) {
    if (!refsByNote.has(ref.toId)) {
      refsByNote.set(ref.toId, []);
    }
    refsByNote.get(ref.toId)!.push(ref);
  }

  const outputs: string[] = [];
  const relativePath = path.relative(projectPath, absolutePath);

  outputs.push(chalk.bold(`Source File: ${relativePath}`));
  outputs.push(chalk.gray('─'.repeat(60)));
  outputs.push(
    `Found ${references.length} reference${references.length === 1 ? '' : 's'} to ${refsByNote.size} note${refsByNote.size === 1 ? '' : 's'}`,
  );
  outputs.push('');

  // Get all referenced notes
  const noteManager = projectManager.noteManager;
  if (!noteManager) {
    throw new Error('Note manager not initialized');
  }

  // Display each referenced note
  for (const [noteId, refs] of refsByNote) {
    const noteResult = await noteManager.getNotes({ ids: [noteId], includeArchived: options.includeArchived, includeDeleted: options.includeDeleted });
    const note = noteResult.notes.length > 0 ? noteResult.notes[0] : undefined;

    if (note) {
      // Note header
      outputs.push(chalk.cyan(note.id) + ' - ' + chalk.bold(note.title));

      if (note.tags.length > 0) {
        outputs.push(chalk.gray(`Tags: ${note.tags.join(', ')}`));
      }

      // Show references with line numbers
      outputs.push(chalk.gray('Referenced at:'));
      for (const ref of refs) {
        const typeLabel = ref.referenceType !== 'mentions' ? chalk.yellow(`@${ref.referenceType}`) : '';
        outputs.push(`  ${chalk.gray(`L${ref.line}:`)} ${typeLabel} {${ref.toId}} ${ref.context?.trim() || ''}`);
      }

      // Optionally show note content preview
      if (options.preview) {
        outputs.push('');
        const excerpt = note.content.split('\n').slice(0, 3).join('\n');
        outputs.push(chalk.gray('Preview:'));
        outputs.push(excerpt);
      }

      outputs.push('');
    } else {
      outputs.push(chalk.red(`Note not found: ${noteId}`));
      outputs.push(chalk.gray('Referenced at:'));
      for (const ref of refs) {
        outputs.push(`  ${chalk.gray(`L${ref.line}:`)} {${ref.toId}} ${ref.context?.trim() || ''}`);
      }
      outputs.push('');
    }
  }

  // Optionally include notes that reference this file path
  if (options.includeFileRefs && noteManager) {
    const allNotesResult = await noteManager.getNotes({ includeArchived: options.includeArchived, includeDeleted: options.includeDeleted });
    const allNotes = allNotesResult.notes;
    const notesReferencingFile: Note[] = [];

    for (const note of allNotes) {
      if (note.content.includes(relativePath) || note.content.includes(absolutePath)) {
        notesReferencingFile.push(note);
      }
    }

    if (notesReferencingFile.length > 0) {
      outputs.push(chalk.gray('─'.repeat(60)));
      outputs.push(chalk.gray('Notes referencing this file:'));
      outputs.push('');

      for (const note of notesReferencingFile) {
        outputs.push(`${chalk.cyan(note.id)} - ${note.title}`);
      }
      outputs.push('');
    }
  }

  await writeOutput(outputs.join('\n'), options.output);
}

/**
 * Write output to file or console
 */
export async function writeOutput(output: string, filePath?: string): Promise<void> {
  if (filePath) {
    await fs.writeFile(filePath, output, 'utf-8');
  } else {
    console.log(output);
  }
}
