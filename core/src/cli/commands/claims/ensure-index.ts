/**
 * Shared helper for claim commands that need a built index.
 *
 * @implements {DD006.§3.DC.12} Lazy initialization via cached ensureIndex()
 * @implements {DD006.§3.DC.13} Module-level caching with --reindex bypass
 * @implements {R008.§2.AC.01} Claim index uses aggregated content for folder notes
 * @implements {DD019.§3.DC.09} Author-delta commit block removed; ensureIndex performs zero writes
 * @implements {DD019.§3.DC.10} Markdown-vs-CLI distinction is now structural (entry fields vs events)
 * @see {DD021.§10.DC.16} Planned: pass `{ includeArchived: true }` to `noteManager.getNotes()` so archived notes stay in-index for resolver per {R015.§1.AC.04a}; not yet realized in this file.
 */

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

  // Get all notes including archived and soft-deleted (no limit).
  // @implements {DD021.§10.DC.16} ensureIndex passes includeArchived: true
  // to noteManager.getNotes() so archived-note entries are present in the
  // index per {R015.§1.AC.04a} ("archived notes MUST stay in-index for
  // resolution"). Without this flag, the default note-manager filter at
  // note-manager.ts:1315-1317 excludes archived notes, and the resolver
  // (DD021.§10.DC.05/.06) degenerates archived citations to
  // reference-to-unknown-note. Paired in this commit with the findGaps
  // archived-skip in traceability.ts (B.5b) so the gap surface remains
  // correct: archived entries are in the index for resolution, but inert
  // for projection-coverage tally.
  //
  // @see {DD022.§8} `includeDeleted: true` keeps soft-deleted notes in the
  // index so the audit's `reference-to-soft-deleted` synthesis
  // ({DD022.§10.2.DC.07}) can fire. Without it, citations of soft-deleted
  // notes would degenerate to `reference-to-unknown-note`. Same shape as
  // the archive plumbing.
  const result = await noteManager.getNotes({ includeArchived: true, includeDeleted: true });
  const notes = result.notes;

  // Read content for each note — use aggregated contents so that folder
  // notes have claims from companion sub-files included.
  // @implements {DD021.§10.DC.17} NoteWithContent.tags plumbing — pass
  // note.tags so ClaimIndex.build() can populate entry.archived per
  // tags.includes('archived').
  const notesWithContent: NoteWithContent[] = await Promise.all(
    notes.map(async (note) => ({
      id: note.id,
      type: note.type,
      filePath: note.filePath || '',
      content: (await noteManager.getAggregatedContents(note.id)) || '',
      tags: note.tags,
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

  // @implements {DD019.§3.DC.09} No post-build event writes. Author suffix
  // tokens are read directly from ClaimIndexEntry fields (importance,
  // lifecycle, derivedFrom, parsedTags); the merge happens at filter time
  // via mergeMarkdownIntoFold (DD019.§3.DC.11). The metadata event log is
  // reserved for CLI/agent-issued metadata only.

  // Cache the result
  cachedData = data;

  return data;
}
