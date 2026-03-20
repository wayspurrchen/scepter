import chalk from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import type { CommandContext } from '../base-command';
import type { CommonFilterOptions } from './common-filters';
import { optionsToNoteQuery } from './common-filters';
import type { Note } from '../../../types/note';
import type { SourceReference } from '../../../types/reference';

export interface XrefSourcesOptions extends CommonFilterOptions {
  verbose?: boolean;
  json?: boolean;
  output?: string;
  direction?: 'note-to-source' | 'source-to-note' | 'both';
  groupBy?: 'note' | 'file' | 'none';
  includeArchived?: boolean;
  includeDeleted?: boolean;
}

export interface XrefEntry {
  noteId: string;
  noteTitle: string;
  noteType: string;
  noteStatus?: string;
  noteTags: string[];
  sourceFile: string;
  sourceFileAbsolute: string;
  line: number;
  referenceType: string;
  context?: string;
  modifier?: string;
  noteExcerpt?: string;
}

export interface XrefResult {
  entries: XrefEntry[];
  summary: {
    totalEntries: number;
    uniqueNotes: number;
    uniqueFiles: number;
    noteIdsWithNoSourceRefs: string[];
    filesWithNoNoteRefs: string[];
  };
  inputClassification: {
    noteInputs: string[];
    fileInputs: string[];
  };
}

/**
 * Classify a target string as either a note ID/pattern or a file path/glob.
 *
 * Heuristic:
 * - Contains path separators or starts with . or ~ -> file
 * - Ends with a known source extension -> file
 * - Matches note ID pattern (uppercase letters + optional digits/globs) -> note
 * - Fallback -> note
 */
export function classifyTarget(target: string, sourceExtensions: string[]): 'note' | 'file' {
  // Path separators -> file
  if (target.includes('/') || target.includes('\\')) {
    return 'file';
  }

  // Starts with . or ~ -> file (relative or home path)
  if (target.startsWith('.') || target.startsWith('~')) {
    return 'file';
  }

  // Ends with a known source extension -> file
  for (const ext of sourceExtensions) {
    if (target.endsWith(ext)) {
      return 'file';
    }
  }

  // Matches note ID pattern: uppercase letters followed by optional digits and glob chars
  // Examples: D001, Q*, REQ00[1-5], ARCH{001,002}
  if (/^[A-Z]+[\d*?\[\]{},-]*$/.test(target)) {
    return 'note';
  }

  // Fallback: treat as note
  return 'note';
}

/**
 * Resolve note targets into Note objects.
 */
async function resolveNotes(
  noteInputs: string[],
  options: XrefSourcesOptions,
  context: CommandContext,
): Promise<Note[]> {
  const { projectManager } = context;
  const noteManager = projectManager.noteManager;
  if (!noteManager) throw new Error('Note manager not initialized');

  const query = optionsToNoteQuery(options);
  query.includeArchived = options.includeArchived;
  query.includeDeleted = options.includeDeleted;

  // If we have specific note ID patterns, resolve them
  if (noteInputs.length > 0) {
    const hasGlob = noteInputs.some(id => /[*?\[\]{}]/.test(id));

    if (hasGlob) {
      // Get all notes matching the query filters, then apply glob patterns
      const allResult = await noteManager.getNotes(query);
      const allNoteIds = allResult.notes.map(n => n.id);
      const matched = new Set<string>();

      for (const pattern of noteInputs) {
        if (/[*?\[\]{}]/.test(pattern)) {
          for (const id of allNoteIds) {
            if (minimatch(id, pattern)) {
              matched.add(id);
            }
          }
        } else {
          matched.add(pattern);
        }
      }

      // Fetch the matched notes
      if (matched.size === 0) return [];
      const result = await noteManager.getNotes({
        ...query,
        ids: Array.from(matched),
      });
      return result.notes;
    } else {
      // Exact IDs only
      const result = await noteManager.getNotes({
        ...query,
        ids: noteInputs,
      });
      return result.notes;
    }
  }

  // No specific note inputs - check if we have filter options that narrow the query
  const hasFilters = options.types?.length || options.type?.length || options.tags?.length
    || options.status?.length || options.excludeTypes?.length || options.excludeTags?.length;

  if (hasFilters) {
    const result = await noteManager.getNotes(query);
    return result.notes;
  }

  // No inputs and no filters - return empty (full audit handled at caller level)
  return [];
}

/**
 * Resolve file targets into absolute file paths.
 */
async function resolveFiles(
  fileInputs: string[],
  projectPath: string,
): Promise<string[]> {
  const resolvedFiles: string[] = [];

  for (const fileInput of fileInputs) {
    const absolutePattern = path.isAbsolute(fileInput)
      ? fileInput
      : path.resolve(projectPath, fileInput);

    // Check if it's a glob pattern
    if (/[*?\[\]{}]/.test(fileInput)) {
      const matches = await glob(absolutePattern, { nodir: true });
      resolvedFiles.push(...matches);
    } else {
      // Single file - check if it exists
      if (await fs.pathExists(absolutePattern)) {
        resolvedFiles.push(absolutePattern);
      }
    }
  }

  // Deduplicate
  return [...new Set(resolvedFiles)];
}

/**
 * Build cross-reference entries from source references.
 */
function sourceRefToXrefEntry(
  ref: SourceReference,
  projectPath: string,
): Omit<XrefEntry, 'noteTitle' | 'noteType' | 'noteStatus' | 'noteTags' | 'noteExcerpt'> {
  return {
    noteId: ref.toId,
    noteTitle: '',
    noteType: '',
    noteTags: [],
    sourceFile: path.relative(projectPath, ref.filePath),
    sourceFileAbsolute: ref.filePath,
    line: ref.line ?? 0,
    referenceType: ref.referenceType,
    context: ref.context,
    modifier: ref.modifier,
  };
}

/**
 * Main handler: build cross-reference map between notes and source files.
 */
export async function xrefSources(
  targets: string[],
  options: XrefSourcesOptions,
  context: CommandContext,
): Promise<XrefResult> {
  const { projectManager, projectPath } = context;
  const sourceScanner = projectManager.sourceScanner;
  const noteManager = projectManager.noteManager;

  if (!sourceScanner) throw new Error('Source code integration is not enabled');
  if (!noteManager) throw new Error('Note manager not initialized');

  // Get source extensions from config for classification
  const config = await projectManager.configManager.getConfig();
  const sourceExtensions = config.sourceCodeIntegration?.extensions ?? [];

  // Phase 1: Classify and resolve inputs
  const noteInputs: string[] = [];
  const fileInputs: string[] = [];

  for (const target of targets) {
    const type = classifyTarget(target, sourceExtensions);
    if (type === 'note') {
      noteInputs.push(target);
    } else {
      fileInputs.push(target);
    }
  }

  // Resolve notes
  let resolvedNotes = await resolveNotes(noteInputs, options, context);

  // Resolve files
  let resolvedFiles = await resolveFiles(fileInputs, projectPath);

  // If no targets and no filters provided, do a full audit
  const noTargets = targets.length === 0;
  const hasFilters = options.types?.length || options.type?.length || options.tags?.length
    || options.status?.length || options.excludeTypes?.length || options.excludeTags?.length;

  if (noTargets && !hasFilters) {
    // Full audit: get all notes and all indexed files
    const query = optionsToNoteQuery(options);
    query.includeArchived = options.includeArchived;
    query.includeDeleted = options.includeDeleted;
    const allNotes = await noteManager.getNotes(query);
    resolvedNotes = allNotes.notes;
    resolvedFiles = sourceScanner.getIndex().getIndexedFiles();
  } else if (noTargets && hasFilters) {
    // Filters but no targets: get filtered notes, use all indexed files
    resolvedFiles = sourceScanner.getIndex().getIndexedFiles();
  }

  // Phase 2: Build cross-reference entries (deduplicated)
  const entryMap = new Map<string, XrefEntry>();
  const direction = options.direction ?? 'both';

  // Track which input notes/files produced entries
  const noteIdsWithEntries = new Set<string>();
  const filesWithEntries = new Set<string>();

  // Direction: note -> source (find source files referencing each note)
  if (direction === 'both' || direction === 'note-to-source') {
    for (const note of resolvedNotes) {
      const sourceRefs = sourceScanner.getReferencesToNote(note.id);
      for (const ref of sourceRefs) {
        const key = `${ref.toId}:${ref.filePath}:${ref.line}`;
        if (!entryMap.has(key)) {
          entryMap.set(key, sourceRefToXrefEntry(ref, projectPath) as XrefEntry);
        }
        noteIdsWithEntries.add(note.id);
        filesWithEntries.add(ref.filePath);
      }
    }
  }

  // Direction: source -> note (find notes referenced in each file)
  if (direction === 'both' || direction === 'source-to-note') {
    for (const filePath of resolvedFiles) {
      const refs = sourceScanner.getReferencesFromFile(filePath);
      for (const ref of refs) {
        const key = `${ref.toId}:${ref.filePath}:${ref.line}`;
        if (!entryMap.has(key)) {
          entryMap.set(key, sourceRefToXrefEntry(ref, projectPath) as XrefEntry);
        }
        filesWithEntries.add(ref.filePath);
        noteIdsWithEntries.add(ref.toId);
      }
    }
  }

  // Phase 3: Enrich entries with note metadata
  let entries = Array.from(entryMap.values());
  const uniqueNoteIds = [...new Set(entries.map(e => e.noteId))];

  if (uniqueNoteIds.length > 0) {
    const noteLookup = await noteManager.getNotes({
      ids: uniqueNoteIds,
      includeArchived: options.includeArchived,
      includeDeleted: options.includeDeleted,
    });
    const noteMap = new Map(noteLookup.notes.map(n => [n.id, n]));

    for (const entry of entries) {
      const note = noteMap.get(entry.noteId);
      if (note) {
        entry.noteTitle = note.title;
        entry.noteType = note.type;
        entry.noteStatus = note.metadata?.status;
        entry.noteTags = note.tags;
        if (options.verbose) {
          entry.noteExcerpt = note.content.split('\n').slice(0, 3).join('\n');
        }
      } else {
        entry.noteTitle = '(not found)';
        entry.noteType = '?';
        entry.noteTags = [];
      }
    }
  }

  // Phase 4: Apply note-side filters to entries found via source->note direction.
  // When filters are active, only keep entries whose notes matched the resolved set.
  if (hasFilters) {
    const allowedNoteIds = new Set(resolvedNotes.map(n => n.id));
    entries = entries.filter(e => allowedNoteIds.has(e.noteId));
  }

  // Sort entries: by note ID then by file then by line
  entries.sort((a, b) => {
    const noteCompare = a.noteId.localeCompare(b.noteId);
    if (noteCompare !== 0) return noteCompare;
    const fileCompare = a.sourceFile.localeCompare(b.sourceFile);
    if (fileCompare !== 0) return fileCompare;
    return a.line - b.line;
  });

  // Compute orphans
  const inputNoteIds = new Set(resolvedNotes.map(n => n.id));
  const inputFiles = new Set(resolvedFiles);
  const noteIdsWithNoSourceRefs = [...inputNoteIds].filter(id => !noteIdsWithEntries.has(id));
  const filesWithNoNoteRefs = [...inputFiles]
    .filter(f => !filesWithEntries.has(f))
    .map(f => path.relative(projectPath, f));

  return {
    entries,
    summary: {
      totalEntries: entries.length,
      uniqueNotes: new Set(entries.map(e => e.noteId)).size,
      uniqueFiles: new Set(entries.map(e => e.sourceFile)).size,
      noteIdsWithNoSourceRefs,
      filesWithNoNoteRefs,
    },
    inputClassification: {
      noteInputs,
      fileInputs,
    },
  };
}

/**
 * Format xref results for display.
 */
export function formatXrefResults(
  result: XrefResult,
  options: XrefSourcesOptions,
): string {
  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  const { entries, summary } = result;
  const outputs: string[] = [];
  const groupBy = options.groupBy ?? 'none';

  // Header
  if (entries.length === 0) {
    outputs.push(chalk.yellow('No cross-references found.'));
    if (summary.noteIdsWithNoSourceRefs.length > 0) {
      outputs.push('');
      outputs.push(chalk.gray(`Notes checked: ${summary.noteIdsWithNoSourceRefs.join(', ')}`));
    }
    if (summary.filesWithNoNoteRefs.length > 0) {
      outputs.push('');
      outputs.push(chalk.gray(`Files checked: ${summary.filesWithNoNoteRefs.join(', ')}`));
    }
    return outputs.join('\n');
  }

  outputs.push(
    chalk.bold(`Cross-references: ${summary.totalEntries} entries across ${summary.uniqueNotes} note(s), ${summary.uniqueFiles} file(s)`),
  );
  outputs.push('');

  if (groupBy === 'note') {
    outputs.push(...formatGroupedByNote(entries, options));
  } else if (groupBy === 'file') {
    outputs.push(...formatGroupedByFile(entries, options));
  } else {
    outputs.push(...formatFlat(entries, options));
  }

  // Orphan summary
  if (summary.noteIdsWithNoSourceRefs.length > 0) {
    outputs.push('');
    outputs.push(
      chalk.yellow(`Notes with no source references: ${summary.noteIdsWithNoSourceRefs.join(', ')}`),
    );
  }
  if (summary.filesWithNoNoteRefs.length > 0) {
    outputs.push('');
    outputs.push(
      chalk.yellow(`Files with no note references: ${summary.filesWithNoNoteRefs.join(', ')}`),
    );
  }

  return outputs.join('\n');
}

/**
 * Flat table format (default).
 */
function formatFlat(entries: XrefEntry[], options: XrefSourcesOptions): string[] {
  const outputs: string[] = [];

  // Column widths
  const noteCol = Math.max(8, ...entries.map(e => e.noteId.length));
  const fileCol = Math.max(11, ...entries.map(e => e.sourceFile.length));
  const lineCol = 5;
  const typeCol = Math.max(10, ...entries.map(e => formatRefType(e.referenceType).length));
  const statusCol = Math.max(6, ...entries.map(e => (e.noteStatus ?? '-').length));

  // Header
  outputs.push(
    chalk.gray(
      `${'Note'.padEnd(noteCol)}  ${'Source File'.padEnd(fileCol)}  ${'Line'.padEnd(lineCol)}  ${'Ref Type'.padEnd(typeCol)}  ${'Status'.padEnd(statusCol)}`,
    ),
  );
  outputs.push(chalk.gray('─'.repeat(noteCol + fileCol + lineCol + typeCol + statusCol + 8)));

  for (const entry of entries) {
    const refType = formatRefType(entry.referenceType);
    const status = entry.noteStatus ?? '-';

    outputs.push(
      `${chalk.cyan(entry.noteId.padEnd(noteCol))}  ${entry.sourceFile.padEnd(fileCol)}  ${String(entry.line).padEnd(lineCol)}  ${chalk.yellow(refType.padEnd(typeCol))}  ${status.padEnd(statusCol)}`,
    );

    if (options.verbose && entry.context) {
      outputs.push(chalk.dim(`  ${entry.context.trim()}`));
    }
  }

  return outputs;
}

/**
 * Grouped by note format.
 */
function formatGroupedByNote(entries: XrefEntry[], options: XrefSourcesOptions): string[] {
  const outputs: string[] = [];
  const byNote = new Map<string, XrefEntry[]>();

  for (const entry of entries) {
    if (!byNote.has(entry.noteId)) {
      byNote.set(entry.noteId, []);
    }
    byNote.get(entry.noteId)!.push(entry);
  }

  for (const [noteId, noteEntries] of byNote) {
    const first = noteEntries[0];
    const statusLabel = first.noteStatus ? ` [${first.noteStatus}]` : '';
    const tagsLabel = first.noteTags.length > 0 ? chalk.gray(` #${first.noteTags.join(' #')}`) : '';

    outputs.push(`${chalk.cyan(noteId)} - ${chalk.bold(first.noteTitle)}${chalk.gray(statusLabel)}${tagsLabel}`);

    if (options.verbose && first.noteExcerpt) {
      for (const line of first.noteExcerpt.split('\n')) {
        outputs.push(chalk.dim(`  | ${line}`));
      }
      outputs.push('');
    }

    for (const entry of noteEntries) {
      const refType = entry.referenceType !== 'mentions' ? chalk.yellow(`@${entry.referenceType}`) : '';
      outputs.push(`  ${entry.sourceFile}:${entry.line}  ${refType}`);

      if (options.verbose && entry.context) {
        outputs.push(chalk.dim(`    ${entry.context.trim()}`));
      }
    }

    outputs.push('');
  }

  return outputs;
}

/**
 * Grouped by file format.
 */
function formatGroupedByFile(entries: XrefEntry[], options: XrefSourcesOptions): string[] {
  const outputs: string[] = [];
  const byFile = new Map<string, XrefEntry[]>();

  for (const entry of entries) {
    if (!byFile.has(entry.sourceFile)) {
      byFile.set(entry.sourceFile, []);
    }
    byFile.get(entry.sourceFile)!.push(entry);
  }

  for (const [file, fileEntries] of byFile) {
    outputs.push(chalk.bold(file));

    // Sort by line within file
    fileEntries.sort((a, b) => a.line - b.line);

    for (const entry of fileEntries) {
      const refType = entry.referenceType !== 'mentions' ? chalk.yellow(`@${entry.referenceType} `) : '';
      const status = entry.noteStatus ? chalk.gray(` [${entry.noteStatus}]`) : '';

      outputs.push(
        `  ${chalk.gray(`L${entry.line}:`)} ${chalk.cyan(entry.noteId)} ${refType}- ${entry.noteTitle}${status}`,
      );

      if (options.verbose && entry.context) {
        outputs.push(chalk.dim(`    ${entry.context.trim()}`));
      }
    }

    outputs.push('');
  }

  return outputs;
}

/**
 * Format reference type for display.
 */
function formatRefType(refType: string): string {
  return refType === 'mentions' ? 'mentions' : `@${refType}`;
}

/**
 * Write output to file or console.
 */
export async function writeXrefOutput(output: string, filePath?: string): Promise<void> {
  if (filePath) {
    // Strip ANSI color codes when writing to file
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
    await fs.writeFile(filePath, stripped, 'utf-8');
  } else {
    console.log(output);
  }
}
