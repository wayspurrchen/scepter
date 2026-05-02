/**
 * @implements {DD008.§1.DC.03} Claim address detection before note lookup
 * @implements {DD008.§1.DC.04} Single claim display via formatClaimTrace
 * @implements {DD008.§1.DC.05} Ambiguous claim disambiguation listing
 * @implements {DD008.§1.DC.06} Zero-match fuzzy suggestions
 * @implements {DD008.§1.DC.07} Bare note ID zero-padding fallback
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { ProjectManager } from '../../../project/project-manager';
import { formatNote, formatNotes, formatNotesAsJson } from '../../formatters/note-formatter';
import { SourceCodeScanner } from '../../../scanners/source-code-scanner';
import { ensureIndex } from '../claims/ensure-index';
import { parseClaimAddress } from '../../../parsers/claim/claim-parser';
import { formatClaimTrace, groupVerifiedEvents } from '../../formatters/claim-formatter';
import { resolveClaimInput } from '../shared/resolve-claim-id';
import type { ClaimIndexData, ClaimIndexEntry } from '../../../claims/index';
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
 * Detect whether an ID begins with a cross-project alias prefix
 * (`<alias>/`). Mirrors `ALIAS_PREFIX_RE` in claim-parser.ts.
 *
 * @implements {R011.§3.AC.01} alias-prefixed argument routing in show
 */
function looksLikeCrossProjectId(id: string): boolean {
  return /^[a-z][a-z0-9-]*[a-z0-9]\//.test(id);
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

  // @implements {R011.§3.AC.01} cross-project show with peer-source header
  // Cross-project IDs (alias-prefixed) are routed to the peer resolver
  // and rendered with a clearly visible peer header before any local
  // processing.
  const crossProjectIds: string[] = [];
  const localIds: string[] = [];
  for (const id of ids) {
    if (looksLikeCrossProjectId(id)) {
      crossProjectIds.push(id);
    } else {
      localIds.push(id);
    }
  }

  let crossProjectOutput = '';
  if (crossProjectIds.length > 0) {
    crossProjectOutput = await resolveAndDisplayCrossProjectIds(crossProjectIds, projectManager);
    if (localIds.length === 0) {
      return { notes: [], notFound: [], output: crossProjectOutput };
    }
  }

  // @implements {DD008.§1.DC.03} Detect claim addresses before note lookup.
  // A claim address contains '.' and has a claim prefix pattern (e.g., DD007.1.DC.01).
  // Separate claim IDs from regular note IDs for different processing paths.
  const claimIds: string[] = [];
  const noteIds: string[] = [];
  for (const id of localIds) {
    if (looksLikeClaimAddress(id)) {
      claimIds.push(id);
    } else {
      noteIds.push(id);
    }
  }

  // Process claim IDs through the claim resolution path
  if (claimIds.length > 0) {
    const claimOutput = await resolveAndDisplayClaims(claimIds, options, context);
    if (claimOutput !== null) {
      // If we had ONLY claim IDs, return the claim output (prepended with any cross-project output)
      if (noteIds.length === 0) {
        const combined = [crossProjectOutput, claimOutput].filter(Boolean).join('\n\n');
        return { notes: [], notFound: [], output: combined };
      }
      // Mixed: prepend cross-project + claim output, continue with note IDs below
      const noteResult = await showNotesCore(noteIds, options, context);
      const combinedOutput = [crossProjectOutput, claimOutput, noteResult.output].filter(Boolean).join('\n\n');
      return { notes: noteResult.notes, notFound: noteResult.notFound, output: combinedOutput };
    }
  }

  // Fall through: process note IDs (or all local IDs if none were claims)
  const idsToProcess = claimIds.length > 0 ? noteIds : localIds;
  const localResult = await showNotesCore(idsToProcess, options, context);
  if (crossProjectOutput) {
    return {
      notes: localResult.notes,
      notFound: localResult.notFound,
      output: [crossProjectOutput, localResult.output].filter(Boolean).join('\n\n'),
    };
  }
  return localResult;
}

/**
 * Detect whether an input string looks like a claim address.
 * A claim address contains dots and includes a claim prefix pattern
 * (uppercase letters followed by a dot and digits).
 *
 * Also handles compressed-zero inputs like DD7.1.DC.1 by zero-padding
 * before attempting parse.
 *
 * @implements {DD008.§1.DC.03}
 */
function looksLikeClaimAddress(id: string): boolean {
  if (!id.includes('.')) return false;
  // Normalize $ to § for detection
  let normalized = id.replace(/\$/g, '§');

  // Try parsing as-is first
  let addr = parseClaimAddress(normalized);
  if (addr !== null && addr.claimPrefix !== undefined) return true;

  // If parse fails, try zero-padding the note ID and claim number segments.
  // This handles cases like DD7.1.DC.1 where parseClaimAddress rejects DD7
  // because it expects 3-5 digit note IDs.
  normalized = preNormalizeForDetection(normalized);
  addr = parseClaimAddress(normalized);
  if (addr !== null && addr.claimPrefix !== undefined) return true;

  // Also match section references: NOTEID.SECTION (e.g., DD007.1, DD007.3.1)
  // These have a dot but no claim prefix — just note ID + numeric section path
  const stripped = id.replace(/\$/g, '§').replace(/§/g, '');
  const parts = stripped.split('.');
  if (parts.length >= 2 && /^[A-Z]{1,5}\d+$/.test(parts[0]) && parts.slice(1).every(p => /^\d+$/.test(p))) {
    return true;
  }

  return false;
}

/**
 * Pre-normalize a dotted string by zero-padding segments that look like
 * compressed note IDs or claim numbers, so that parseClaimAddress can
 * recognize them.
 */
function preNormalizeForDetection(input: string): string {
  const parts = input.replace(/§/g, '').split('.');
  if (parts.length === 0) return input;

  // Normalize first segment: note ID digits to exactly 3 (strip excess or pad short)
  const noteMatch = parts[0].match(/^([A-Z]{1,5})(\d+)$/);
  if (noteMatch) {
    const num = String(parseInt(noteMatch[2], 10));
    parts[0] = noteMatch[1] + num.padStart(3, '0');
  }

  // Normalize last segment: claim number to exactly 2 digits (strip excess or pad short)
  if (parts.length >= 2) {
    const lastIdx = parts.length - 1;
    const claimNumMatch = parts[lastIdx].match(/^(\d+)([a-z])?$/);
    if (claimNumMatch && /^[A-Z]+$/.test(parts[lastIdx - 1])) {
      const num = String(parseInt(claimNumMatch[1], 10));
      parts[lastIdx] = num.padStart(2, '0') + (claimNumMatch[2] || '');
    }
  }

  // Strip leading zeros from section path segments (between note ID and claim prefix)
  // Do NOT strip claim numbers (digits preceded by an uppercase prefix)
  for (let i = 1; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i]) && parts[i].length > 1) {
      const prev = parts[i - 1];
      // If previous part is an uppercase prefix, this is a claim number — don't strip
      if (/^[A-Z]+$/.test(prev)) continue;
      parts[i] = String(parseInt(parts[i], 10));
    }
  }

  return parts.join('.');
}

/**
 * Resolve claim IDs and format output for display.
 * Returns formatted output string, or null if resolution should be skipped.
 *
 * @implements {DD008.§1.DC.04} Single match -> formatClaimTrace display
 * @implements {DD008.§1.DC.05} Multiple matches -> disambiguation list
 * @implements {DD008.§1.DC.06} Zero matches -> "Claim not found" with fuzzy suggestions
 */
async function resolveAndDisplayClaims(
  claimIds: string[],
  options: ShowOptions,
  context: CommandContext,
): Promise<string | null> {
  const { projectManager } = context;
  const data = await ensureIndex(projectManager);

  // Load verification events from the metadata store for trace display.
  // @implements {DD014.§3.DC.54} show-handler reads via metadataStorage
  const verifiedEventList = await projectManager.metadataStorage!.query({ key: 'verified' });
  const verifiedEvents = groupVerifiedEvents(verifiedEventList);

  const outputs: string[] = [];

  for (const id of claimIds) {
    const result = resolveClaimInput(id, data);

    if (result.matches.length === 1) {
      // @implements {DD008.§1.DC.04} Single match: display with formatClaimTrace
      const entry = result.matches[0];
      const incoming = data.crossRefs.filter(ref => ref.toClaim === entry.fullyQualified);
      const traceOutput = await formatClaimTrace(entry, incoming, data.noteTypes, {}, verifiedEvents);
      outputs.push(traceOutput);

    } else if (result.matches.length > 1) {
      // @implements {DD008.§1.DC.05} Multiple matches: list for disambiguation
      outputs.push(chalk.yellow(`Ambiguous claim address "${id}" matches ${result.matches.length} claims:`));
      outputs.push('');
      for (const entry of result.matches) {
        const heading = entry.heading.replace(/\*\*/g, '').trim();
        outputs.push(`  ${chalk.cyan(entry.fullyQualified)}  ${heading}  ${chalk.gray(`L${entry.line}`)}`);
      }
      outputs.push('');
      outputs.push(chalk.gray('Specify the section number to disambiguate (e.g., ' +
        result.matches[0].fullyQualified + ')'));

    } else {
      // @implements {DD008.§1.DC.06} Zero matches: show not found with fuzzy suggestions
      outputs.push(chalk.red(`Claim not found: ${id}`));

      // Try fuzzy matching: extract the claim suffix and search for entries ending with it
      const normalized = id.replace(/\$/g, '§').replace(/§/g, '');
      const dotParts = normalized.split('.');
      if (dotParts.length >= 2) {
        const suffix = '.' + dotParts.slice(1).join('.');
        const candidates = [...data.entries.keys()].filter(k => k.endsWith(suffix));
        if (candidates.length > 0) {
          outputs.push('');
          outputs.push('Did you mean:');
          for (const c of candidates.slice(0, 5)) {
            outputs.push(`  ${c}`);
          }
        }
      }
    }
  }

  return outputs.length > 0 ? outputs.join('\n') : null;
}

/**
 * Core note display logic, extracted from showNotes to allow claim IDs to be
 * processed separately.
 */
/**
 * Resolve cross-project (alias-prefixed) IDs against the peer resolver
 * and render each with a distinct header indicating the source alias
 * and resolved peer path. Per R011.§3.AC.01, the displayed peer note
 * MUST NOT be confusable with a local note — we prepend a horizontal
 * rule and a labeled banner to make the source unmistakable.
 *
 * @implements {R011.§3.AC.01} show with peer-source header
 */
async function resolveAndDisplayCrossProjectIds(
  ids: string[],
  projectManager: ProjectManager,
): Promise<string> {
  const blocks: string[] = [];
  for (const fullId of ids) {
    const slash = fullId.indexOf('/');
    if (slash === -1) {
      blocks.push(chalk.red(`Malformed cross-project ID: ${fullId}`));
      continue;
    }
    const aliasName = fullId.slice(0, slash);
    const remainder = fullId.slice(slash + 1);

    // We only support alias/<noteId> here; alias/<note>.<section>.<claim>
    // would require routing through the claim-display path. Document the
    // simple-case-only behavior by returning a clear message for now.
    // The remainder must be a bare note ID for this dispatch.
    if (!/^[A-Z]{1,5}\d{3,5}$/.test(remainder)) {
      blocks.push(
        chalk.yellow(
          `Cross-project show currently supports bare note IDs only (got '${fullId}'). For claims use the claim-trace path.`,
        ),
      );
      continue;
    }

    const lookup = await projectManager.peerResolver.lookupNote(aliasName, remainder);
    if (!lookup.ok) {
      blocks.push(chalk.red(`${fullId}: ${lookup.message}`));
      continue;
    }

    // Render with peer-source header.
    const header = chalk.bold(
      `From peer project: ${chalk.cyan(lookup.peer.aliasName)} (${lookup.peer.resolvedPath})`,
    );
    const rule = chalk.dim('─'.repeat(60));
    const formatted = formatNote(lookup.note, { showContent: true });
    blocks.push(`${header}\n${rule}\n${formatted}`);
  }
  return blocks.join('\n\n');
}

async function showNotesCore(
  ids: string[],
  options: ShowOptions,
  context: CommandContext,
): Promise<ShowResult> {
  const { projectManager } = context;
  const noteManager = projectManager.noteManager;

  if (!noteManager) {
    throw new Error('Note manager not initialized');
  }

  if (ids.length === 0) {
    return { notes: [], notFound: [], output: '' };
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

  // @implements {DD008.§1.DC.07} Zero-padding fallback for bare note IDs.
  // When a bare note ID like "DD7" is not found, try zero-padding to "DD007".
  if (notFound.length > 0) {
    const stillNotFound: string[] = [];
    for (const id of notFound) {
      const padded = zeroPadNoteId(id);
      if (padded && padded !== id) {
        const retryResult = await noteManager.getNotes({
          ids: [padded],
          includeArchived: options.includeArchived,
          includeDeleted: options.includeDeleted,
        });
        if (retryResult.notes.length > 0 && !processedIds.has(padded)) {
          notes.push(retryResult.notes[0]);
          processedIds.add(padded);
        } else {
          stillNotFound.push(id);
        }
      } else {
        stillNotFound.push(id);
      }
    }
    notFound.length = 0;
    notFound.push(...stillNotFound);
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

/**
 * Try to zero-pad a bare note ID (e.g., "DD7" -> "DD007").
 * Returns the padded ID if it looks like a shortcode+digits pattern,
 * or null if the input doesn't match.
 *
 * @implements {DD008.§1.DC.07}
 */
function zeroPadNoteId(id: string): string | null {
  const match = id.match(/^([A-Z]{1,5})(\d+)$/);
  if (!match) return null;

  const shortcode = match[1];
  const digits = match[2];

  // Pad to at least 3 digits (the standard width for note IDs)
  if (digits.length >= 3) return null; // Already sufficient width
  return shortcode + digits.padStart(3, '0');
}
