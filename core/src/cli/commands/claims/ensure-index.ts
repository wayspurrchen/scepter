/**
 * Shared helper for claim commands that need a built index.
 */

import type { ProjectManager } from '../../../project/project-manager.js';
import type { ClaimIndexData, NoteWithContent } from '../../../claims/index.js';

/**
 * Build the claim index from all notes and source code references.
 *
 * Reads every note's content from disk, passes them to ClaimIndex.build(),
 * then incorporates source code references (if source scanning is enabled)
 * so that source files appear as a "Source" projection type in the
 * traceability matrix.
 */
export async function ensureIndex(projectManager: ProjectManager): Promise<ClaimIndexData> {
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

  return data;
}
