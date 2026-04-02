/**
 * Shared helper for claim commands that need a built index.
 *
 * @implements {DD006.§3.DC.12} Lazy initialization via cached ensureIndex()
 * @implements {DD006.§3.DC.13} Module-level caching with --reindex bypass
 */

import type { ProjectManager } from '../../../project/project-manager.js';
import type { ClaimIndexData, NoteWithContent } from '../../../claims/index.js';

/** Module-level cache for the claim index within a single CLI invocation. */
let cachedData: ClaimIndexData | null = null;

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

  // Read content for each note
  const notesWithContent: NoteWithContent[] = await Promise.all(
    notes.map(async (note) => ({
      id: note.id,
      type: note.type,
      filePath: note.filePath || '',
      content: (await noteManager.noteFileManager.getFileContents(note.id)) || '',
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

  // Cache the result
  cachedData = data;

  return data;
}
