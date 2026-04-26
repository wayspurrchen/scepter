/**
 * Shared helper for claim commands that need a built index.
 *
 * @implements {DD006.§3.DC.12} Lazy initialization via cached ensureIndex()
 * @implements {DD006.§3.DC.13} Module-level caching with --reindex bypass
 * @implements {R008.§2.AC.01} Claim index uses aggregated content for folder notes
 * @implements {DD014.§3.DC.44} ensureIndex commits suffix-grammar ingest deltas after build
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ProjectManager } from '../../../project/project-manager.js';
import type { ClaimIndexData, NoteWithContent } from '../../../claims/index.js';

/** Module-level cache for the claim index within a single CLI invocation. */
let cachedData: ClaimIndexData | null = null;

/**
 * Clear the module-level cache. Reserved for tests that run multiple CLI
 * invocations against different project fixtures in the same process.
 *
 * @internal
 */
export function _clearEnsureIndexCacheForTest(): void {
  cachedData = null;
}

/**
 * Build the claim index from all notes and source code references.
 *
 * Reads every note's content from disk, passes them to ClaimIndex.build(),
 * then incorporates source code references (if source scanning is enabled)
 * so that source files appear as a "Source" projection type in the
 * traceability matrix.
 *
 * Results are cached for the lifetime of the process. Pass `reindex: true`
 * to force a fresh build (bypasses cache).
 */
export async function ensureIndex(
  projectManager: ProjectManager,
  options?: { reindex?: boolean },
): Promise<ClaimIndexData> {
  // Return cached result if available and reindex not requested
  if (cachedData && !options?.reindex) {
    return cachedData;
  }

  const noteManager = projectManager.noteManager;
  if (!noteManager) {
    throw new Error('Note manager not initialized');
  }

  // Get all notes (no limit)
  const result = await noteManager.getNotes({});
  const notes = result.notes;

  // Read content for each note — use aggregated contents so that folder
  // notes have claims from companion sub-files included.
  const notesWithContent: NoteWithContent[] = await Promise.all(
    notes.map(async (note) => ({
      id: note.id,
      type: note.type,
      filePath: note.filePath || '',
      content: (await noteManager.noteFileManager.getAggregatedContents(note.id)) || '',
    })),
  );

  // Build the index from notes
  const data = projectManager.claimIndex.build(notesWithContent);

  // Incorporate source code references if the scanner is available
  const scanner = projectManager.sourceScanner;
  if (scanner?.isReady()) {
    const allRefs = scanner.getIndex().getAllReferences();
    projectManager.claimIndex.addSourceReferences(allRefs);
  }

  // @implements {DD014.§3.DC.44} Commit suffix-grammar ingest deltas after build.
  // Author tokens flow into the metadataStorage event log on every claim-index
  // (re)build. Idempotent on unchanged tokens (§DC.42).
  // @implements {DD014.§3.DC.40} actor=author:<notepath>; date=<note file mtime>
  if (projectManager.metadataStorage) {
    const projectPath = projectManager.projectPath;
    const notesById = new Map(notesWithContent.map((n) => [n.id, n]));

    // Pre-resolve mtimes once per note so the synchronous eventDateProvider
    // callback can do a sync lookup. Falls back to now() if the file is
    // unreadable — date is metadata for the event, not a fold input.
    const mtimeByNoteId = new Map<string, string>();
    for (const note of notesWithContent) {
      let iso: string;
      try {
        const stat = await fs.stat(note.filePath);
        iso = stat.mtime.toISOString();
      } catch {
        iso = new Date().toISOString();
      }
      mtimeByNoteId.set(note.id, iso);
    }

    await projectManager.claimIndex.applyAuthorDeltas(
      notesById,
      projectManager.metadataStorage,
      (note) => mtimeByNoteId.get(note.id) ?? new Date().toISOString(),
      (note) => relativeNotePath(projectPath, note.filePath),
    );
  }

  // Cache the result
  cachedData = data;

  return data;
}

function relativeNotePath(projectPath: string, filePath: string): string {
  if (!filePath) return '';
  const rel = path.relative(projectPath, filePath);
  // Normalize Windows separators if any leak through.
  return rel.split(path.sep).join('/');
}
